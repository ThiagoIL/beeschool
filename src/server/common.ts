import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/lib/db";
import * as E from "@/db/erp";
import type { DreSection } from "@/lib/consts";

/** Erro de regra de negócio com mensagem para o usuário. */
export class RuleError extends Error {}

/** Traduz erros do banco em mensagens seguras (sem detalhes internos). */
export function ruleMsg(err: unknown, fallback = "Não foi possível salvar. Tente novamente."): string {
  if (err instanceof RuleError) return err.message;
  const e = err as { code?: string; cause?: { code?: string; constraint?: string; message?: string }; constraint?: string; message?: string };
  const code = e?.cause?.code ?? e?.code;
  const constraint = e?.cause?.constraint ?? e?.constraint ?? "";
  const msg = e?.cause?.message ?? e?.message ?? "";
  if (code === "P0001" && msg.includes("ERP_RULE:")) {
    const m = msg.split("ERP_RULE:")[1].trim();
    return m.charAt(0).toUpperCase() + m.slice(1) + ".";
  }
  if (code === "23505") {
    if (constraint.includes("tuition")) return "Este aluno já tem mensalidade nesta competência.";
    if (constraint.includes("name")) return "Já existe um registro com este nome.";
    return "Já existe um registro com estes dados.";
  }
  if (code === "23503") return "Este registro está ligado a outros dados e não pode ser excluído. Marque como inativo.";
  if (code === "23514") return "Os dados informados não passaram nas regras de validação.";
  console.error("[bee]", code, msg);
  return fallback;
}

// ------------------------------------------------------------------------------------
// Cadastros padrão (plano de contas da DRE do cliente, empresas, contas, indicadores)
// ------------------------------------------------------------------------------------
const DEFAULTS_VERSION = 1;
const done = new Set<string>();

/** Grupos da DRE e categorias, na mesma classificação usada nas planilhas e no Power BI. */
export const DEFAULT_PLAN: { group: string; section: DreSection; base?: boolean; cats: string[] }[] = [
  { group: "Mensalidade", section: "RECEITA", base: true, cats: ["Recebimentos de mensalidade"] },
  { group: "Outras receitas", section: "RECEITA", cats: ["Matrícula", "Recebimento com eventos", "Recebimento da cantina", "Recebimento de fardamento", "Recebimento material didático", "Rendimentos de aplicações", "Serviços prestados", "Mensalidade esportes", "Caixa ano anterior"] },
  { group: "Despesas com Impostos e Taxas", section: "DEDUCAO", cats: ["Simples Nacional", "ICMS diferença de alíquota", "IOF", "Juros passivos", "Juros sobre empréstimos e financiamentos", "Movimentação entre contas", "Tarifas bancárias"] },
  { group: "Despesas Variáveis", section: "VARIAVEL", cats: ["Despesas com a cantina", "Despesas com formatura", "Despesas com internet", "Fardamento escolar", "Fornecedores", "Material uso e consumo"] },
  { group: "Despesas com Logística", section: "VARIAVEL", cats: ["Despesa com deslocamento", "Fretes e carretos", "Confraternizações e eventos"] },
  { group: "Despesas com Marketing", section: "OPERACIONAL", cats: ["Despesas com eventos", "Marketing"] },
  { group: "Despesas Administrativas", section: "OPERACIONAL", cats: ["Despesas com material didático"] },
  { group: "Despesas Diversas", section: "OPERACIONAL", cats: ["Desconto concedidos", "Despesas diversas", "Despesas com combustível", "Desistência de matrícula", "Estacionamento"] },
  { group: "Despesas com Pessoal", section: "OPERACIONAL", cats: ["Vale transporte", "Pró-labore", "Férias", "Salários e ordenados", "Despesas alimentação sócios e/ou administradores", "FGTS", "Fardamento funcionários", "Honorários contábeis", "Refeição", "Rescisões", "Serviços prestados por terceiros", "Serviços consultivos"] },
  { group: "Despesas com Ocupação", section: "OPERACIONAL", cats: ["Aluguéis de imóveis", "Depreciações", "Energia elétrica", "IPTU", "Manutenção e reparos", "Material de higiene e limpeza", "Água e esgoto"] },
  { group: "Despesa com TI e Telecomunicação", section: "OPERACIONAL", cats: ["Despesas com sistemas"] },
  { group: "Investimento", section: "INVESTIMENTO", cats: ["Aplicação financeira"] },
];

/** Indicadores do painel (iguais ao Power BI) e metas do orçamento da Bee Light. */
const DEFAULT_INDICATORS: { name: string; group?: string; cats?: string[]; light?: number }[] = [
  { name: "Despesas com Pessoal", group: "Despesas com Pessoal", light: 61.75 },
  { name: "Despesas com Ocupação", group: "Despesas com Ocupação", light: 17.2 },
  { name: "Despesas com Marketing", group: "Despesas com Marketing", light: 0.91 },
  { name: "Despesas com TI", group: "Despesa com TI e Telecomunicação", light: 1.01 },
  { name: "Despesas com Administração", group: "Despesas Administrativas", light: 1.04 },
  { name: "Juros sobre Empréstimo", cats: ["Juros sobre empréstimos e financiamentos"], light: 4.86 },
  { name: "Despesas com Contabilidade", cats: ["Honorários contábeis"], light: 1.0 },
  { name: "Despesas com Consultorias", cats: ["Serviços consultivos"], light: 1.04 },
  { name: "Despesas com Pró-Labore", cats: ["Pró-labore"], light: 1.38 },
  { name: "Despesas com Alimentação Sócios", cats: ["Despesas alimentação sócios e/ou administradores"], light: 4.14 },
];

/** Cria (uma vez) os cadastros básicos para o sistema já sair usável. Pode rodar de novo sem duplicar. */
export async function ensureDefaults(): Promise<void> {
  if (done.has("main")) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bee:defaults'))`);
    const [cs] = await tx.select().from(E.companySettings).limit(1);
    if (cs && cs.defaultsVersion >= DEFAULTS_VERSION) return;
    const empty = async (t: PgTable) => (await tx.select({ c: sql<number>`count(*)::int` }).from(t))[0].c === 0;

    if (await empty(E.companies)) {
      const [school] = await tx.insert(E.companies).values({ name: "Bee School", color: "#E9AE20" }).returning();
      const [light] = await tx.insert(E.companies).values({ name: "Bee Light", color: "#1A1A1A" }).returning();
      const acc = (companyId: string, name: string, kind = "BANCO") => ({ companyId, name, kind, bank: name.replace(/ ·.*$/, "") });
      await tx.insert(E.bankAccounts).values([
        acc(school.id, "Inter"), acc(school.id, "C6"), acc(school.id, "Cora"), acc(school.id, "Itaú"), acc(school.id, "Sicredi 1"),
        acc(school.id, "Sicredi 2"), acc(school.id, "Nordeste"), acc(school.id, "Caixa dinheiro", "CAIXA"),
        acc(light.id, "Cora · Bee Light"), acc(light.id, "Sicredi 1 · Bee Light"), acc(light.id, "Sicredi 2 · Bee Light"),
      ]);
    }
    if (await empty(E.dreGroups)) {
      for (const [i, p] of DEFAULT_PLAN.entries()) {
        const [g] = await tx.insert(E.dreGroups).values({ name: p.group, section: p.section, position: (i + 1) * 10, isBase: !!p.base }).returning();
        await tx.insert(E.finCategories).values(p.cats.map((name) => ({ name, groupId: g.id })));
      }
    }
    if (await empty(E.indicators)) {
      const groups = new Map((await tx.select().from(E.dreGroups)).map((g) => [g.name, g.id]));
      const cats = new Map((await tx.select().from(E.finCategories)).map((c) => [c.name, c.id]));
      const [light] = await tx.select().from(E.companies).where(eq(E.companies.name, "Bee Light")).limit(1);
      for (const [i, d] of DEFAULT_INDICATORS.entries()) {
        const groupId = d.group ? groups.get(d.group) ?? null : null;
        const categoryIds = (d.cats ?? []).map((c) => cats.get(c)).filter(Boolean) as string[];
        if (!groupId && !categoryIds.length) continue;
        const [ind] = await tx.insert(E.indicators).values({ name: d.name, groupId, categoryIds, position: (i + 1) * 10 }).returning();
        if (light && d.light != null) await tx.insert(E.indicatorTargets).values({ indicatorId: ind.id, companyId: light.id, targetPct: String(d.light) });
      }
    }
    if (await empty(E.paymentMethods)) await tx.insert(E.paymentMethods).values(["PIX", "Boleto", "Transferência", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Débito automático"].map((name) => ({ name })));
    if (await empty(E.finSituations)) await tx.insert(E.finSituations).values([["Aguardando aprovação", "#B7791F"], ["Aprovado para pagamento", "#2E7D4F"], ["Agendado", "#2F6E9A"]].map(([name, color]) => ({ name, color })));

    if (cs) await tx.update(E.companySettings).set({ defaultsVersion: DEFAULTS_VERSION }).where(eq(E.companySettings.id, cs.id));
    else await tx.insert(E.companySettings).values({ defaultsVersion: DEFAULTS_VERSION });
  });
  done.add("main");
}

// ------------------------------------------------------------------------------------
// Consultas pequenas e reaproveitadas
// ------------------------------------------------------------------------------------
export async function namesById<T extends PgTable>(tx: Tx, table: T, idCol: PgColumn, nameCol: PgColumn, ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter(Boolean))] as string[];
  if (!u.length) return new Map<string, string>();
  const rows = await tx.select({ id: idCol, n: nameCol }).from(table as PgTable).where(inArray(idCol, u));
  return new Map(rows.map((r) => [String(r.id), String(r.n)]));
}

/** Endereço da logo da instituição (com versão), ou null. */
export async function logoUrl(): Promise<string | null> {
  const [c] = await db.select({ at: E.companySettings.logoAt }).from(E.companySettings).limit(1);
  return c?.at ? `/api/logo?v=${c.at.getTime()}` : null;
}

export { and, eq };
