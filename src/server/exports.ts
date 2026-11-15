import "server-only";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import * as E from "@/db/erp";
import type { ModuleKey } from "@/lib/modules";
import { brDate, toCsv } from "./csv";
import { accountBalances, lookupsFin, realizedByCategory, weeklyFlow } from "./finance-queries";
import { addDays, diffDays, isDate, today } from "@/lib/dates";
import { buildDre } from "@/lib/dre";
import { INVOICE_LABEL, ORIGIN_LABEL, STUDENT_STATUS, type DreSection } from "@/lib/consts";

type SP = Record<string, string | undefined>;
export type Export = { mod: ModuleKey; run: (tx: Tx, sp: SP) => Promise<{ name: string; csv: string }> };

function period(sp: SP) {
  const de = sp.de && isDate(sp.de) ? sp.de : today().slice(0, 8) + "01";
  const ate = sp.ate && isDate(sp.ate) ? sp.ate : today();
  return { de, ate };
}
const str = (v: string | undefined) => (v ? v.slice(0, 64) : undefined);

async function titlesCsv(tx: Tx, kind: "RECEBER" | "PAGAR", sp: SP) {
  const c: SQL[] = [eq(E.finTitles.kind, kind)];
  if (sp.de && isDate(sp.de)) c.push(sql`${E.finTitles.dueDate} >= ${sp.de}`);
  if (sp.ate && isDate(sp.ate)) c.push(sql`${E.finTitles.dueDate} <= ${sp.ate}`);
  if (sp.st === "aberto") c.push(eq(E.finTitles.status, "ABERTO"));
  else if (sp.st === "vencido") c.push(sql`${E.finTitles.status} = 'ABERTO' and ${E.finTitles.dueDate} < ${today()}`);
  else if (sp.st === "pago") c.push(eq(E.finTitles.status, "PAGO"));
  else if (sp.st === "cancelado") c.push(eq(E.finTitles.status, "CANCELADO"));
  if (str(sp.emp)) c.push(eq(E.finTitles.companyId, str(sp.emp)!));
  if (str(sp.cat)) c.push(eq(E.finTitles.categoryId, str(sp.cat)!));
  const rows = await tx.select({ t: E.finTitles, p: E.people.name, al: E.students.name, cat: E.finCategories.name, emp: E.companies.name, pm: E.paymentMethods.name, acc: E.bankAccounts.name })
    .from(E.finTitles).innerJoin(E.companies, eq(E.companies.id, E.finTitles.companyId)).leftJoin(E.people, eq(E.people.id, E.finTitles.personId))
    .leftJoin(E.students, eq(E.students.id, E.finTitles.studentId)).leftJoin(E.finCategories, eq(E.finCategories.id, E.finTitles.categoryId))
    .leftJoin(E.paymentMethods, eq(E.paymentMethods.id, E.finTitles.paymentMethodId)).leftJoin(E.bankAccounts, eq(E.bankAccounts.id, E.finTitles.bankAccountId))
    .where(and(...c)).orderBy(asc(E.finTitles.dueDate)).limit(50000);
  const st = (t: typeof E.finTitles.$inferSelect) => t.status === "PAGO" ? (kind === "RECEBER" ? "Recebido" : "Pago") : t.status === "CANCELADO" ? "Cancelado" : t.dueDate < today() ? "Vencido" : "Em aberto";
  return { name: `contas-a-${kind === "RECEBER" ? "receber" : "pagar"}-${today()}.csv`, csv: toCsv(
    ["Vencimento", "Empresa", "Descrição", "Documento", "Pessoa", "Aluno", "Categoria", "Competência", "Parcela", "Forma", "Nota", "Valor", "Status", "Baixado em", "Valor baixado", "Conta", "Origem"],
    rows.map(({ t, p, al, cat, emp, pm, acc }) => [brDate(t.dueDate), emp, t.description, t.document, p, al, cat, t.competence, t.installment, pm, t.invoice ? INVOICE_LABEL[t.invoice] : "", Number(t.amount), st(t), brDate(t.paidAt), t.paidAmount == null ? "" : Number(t.paidAmount), acc, ORIGIN_LABEL[t.originType]])) };
}

/** Movimento realizado no layout das planilhas do cliente (Data, Descrição, Entrada, Saída, Classificação, Nota). */
async function movementsCsv(tx: Tx, sp: SP) {
  const { de, ate } = period(sp);
  const c: SQL[] = [sql`${E.finTitles.status} = 'PAGO' and ${E.finTitles.paidAt} between ${de} and ${ate}`];
  if (str(sp.emp)) c.push(eq(E.finTitles.companyId, str(sp.emp)!));
  if (str(sp.conta)) c.push(eq(E.finTitles.bankAccountId, str(sp.conta)!));
  const rows = await tx.select({ t: E.finTitles, cat: E.finCategories.name, grp: E.dreGroups.name, emp: E.companies.name, acc: E.bankAccounts.name }).from(E.finTitles)
    .innerJoin(E.companies, eq(E.companies.id, E.finTitles.companyId)).leftJoin(E.finCategories, eq(E.finCategories.id, E.finTitles.categoryId))
    .leftJoin(E.dreGroups, eq(E.dreGroups.id, E.finCategories.groupId)).leftJoin(E.bankAccounts, eq(E.bankAccounts.id, E.finTitles.bankAccountId))
    .where(and(...c)).orderBy(asc(E.finTitles.paidAt)).limit(50000);
  return { name: `movimentos-${de}-a-${ate}.csv`, csv: toCsv(["Data", "Descrição", "Entrada", "Saída", "Classificação", "Nota", "Grupo DRE", "Empresa", "Conta"],
    rows.map(({ t, cat, grp, emp, acc }) => [brDate(t.paidAt), cat ?? "", t.kind === "RECEBER" ? Number(t.paidAmount) : "", t.kind === "PAGAR" ? Number(t.paidAmount) : "", t.description, t.invoice ? INVOICE_LABEL[t.invoice] : "", grp, emp, acc])) };
}

export const EXPORTS: Record<string, Export> = {
  "fin-receber": { mod: "financeiro", run: (tx, sp) => titlesCsv(tx, "RECEBER", sp) },
  "fin-pagar": { mod: "financeiro", run: (tx, sp) => titlesCsv(tx, "PAGAR", sp) },
  "fin-movimentos": { mod: "financeiro", run: movementsCsv },
  "fin-dre": {
    mod: "financeiro",
    run: async (tx, sp) => {
      const y = /^\d{4}$/.test(sp.ano ?? "") ? Number(sp.ano) : Number(today().slice(0, 4));
      const periods = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
      const L = await lookupsFin(tx);
      const [cs] = await tx.select({ b: E.companySettings.pctBase }).from(E.companySettings).limit(1);
      const amounts = await realizedByCategory(tx, `${y}-01-01`, `${y}-12-31`, { companyId: str(sp.emp), accountId: str(sp.conta) });
      const d = buildDre({ groups: L.groups.map((g) => ({ ...g, section: g.section as DreSection })), categories: L.categories, amounts, periods, baseMode: cs?.b === "RECEITA_BRUTA" ? "RECEITA_BRUTA" : "MENSALIDADE" });
      const head = ["Linha", "Tipo", ...periods.map((p) => `${p.slice(5)}/${p.slice(0, 4)}`), "Total", "% sobre faturamento"];
      return { name: `dre-${y}.csv`, csv: toCsv(head, d.lines.map((l) => [l.kind === "category" ? `   ${l.label}` : l.label, l.kind === "total" ? "Resultado" : l.kind === "group" ? "Grupo" : "Categoria", ...l.values, l.total, l.pctTotal == null ? "" : Math.round(l.pctTotal * 100) / 100])) };
    },
  },
  "fin-categorias": {
    mod: "financeiro",
    run: async (tx, sp) => {
      const { de, ate } = period(sp);
      const r = await tx.execute<{ g: string | null; c: string | null; e: string; s: string }>(sql`
        select g.name g, c.name c, coalesce(sum(t.paid_amount) filter (where t.kind = 'RECEBER'), 0)::text e, coalesce(sum(t.paid_amount) filter (where t.kind = 'PAGAR'), 0)::text s
        from fin_titles t left join fin_categories c on c.id = t.category_id left join dre_groups g on g.id = c.group_id
        where t.status = 'PAGO' and t.paid_at between ${de} and ${ate} ${str(sp.emp) ? sql`and t.company_id = ${str(sp.emp)}` : sql``}
        group by 1, 2 order by 1, 2`);
      return { name: `resultado-por-categoria-${de}-a-${ate}.csv`, csv: toCsv(["Grupo DRE", "Categoria", "Entradas", "Saídas", "Resultado"], r.rows.map((x) => [x.g ?? "Sem grupo", x.c ?? "Sem categoria", Number(x.e), Number(x.s), Number(x.e) - Number(x.s)])) };
    },
  },
  "fin-inadimplencia": {
    mod: "financeiro",
    run: async (tx) => {
      const hoje = today();
      const rows = await tx.select({ t: E.finTitles, p: E.people.name, phone: E.people.phone, al: E.students.name }).from(E.finTitles)
        .leftJoin(E.people, eq(E.people.id, E.finTitles.personId)).leftJoin(E.students, eq(E.students.id, E.finTitles.studentId))
        .where(sql`${E.finTitles.kind} = 'RECEBER' and ${E.finTitles.status} = 'ABERTO' and ${E.finTitles.dueDate} < ${hoje}`).orderBy(asc(E.finTitles.dueDate));
      return { name: `inadimplencia-${hoje}.csv`, csv: toCsv(["Vencimento", "Dias em atraso", "Aluno", "Responsável", "Telefone", "Descrição", "Valor"], rows.map(({ t, p, phone, al }) => [brDate(t.dueDate), diffDays(t.dueDate, hoje), al, p, phone, t.description, Number(t.amount)])) };
    },
  },
  "fin-fluxo": {
    mod: "financeiro",
    run: async (tx) => {
      const f = await weeklyFlow(tx, 13);
      return { name: `fluxo-previsto-${today()}.csv`, csv: toCsv(["Semana de", "até", "Entradas", "Saídas", "Resultado", "Saldo projetado"], [["Hoje", "", "", "", "", f.start], ...f.weeks.map((w) => [brDate(w.ini), brDate(w.fim), w.e, w.s, w.res, w.saldo])]) };
    },
  },
  "fin-extrato": {
    mod: "financeiro",
    run: async (tx, sp) => {
      const { de, ate } = period(sp);
      const [acc] = await tx.select().from(E.bankAccounts).where(eq(E.bankAccounts.id, str(sp.conta) ?? "")).limit(1);
      if (!acc) return { name: "extrato.csv", csv: toCsv(["Conta não encontrada"], []) };
      const before = (await accountBalances(tx, addDays(de, -1))).find((a) => a.id === acc.id)?.balance ?? 0;
      const tits = await tx.select({ t: E.finTitles, c: E.finCategories.name }).from(E.finTitles).leftJoin(E.finCategories, eq(E.finCategories.id, E.finTitles.categoryId))
        .where(sql`${E.finTitles.bankAccountId} = ${acc.id} and ${E.finTitles.status} = 'PAGO' and ${E.finTitles.paidAt} between ${de} and ${ate}`);
      const ents = await tx.select().from(E.bankEntries).where(sql`${E.bankEntries.bankAccountId} = ${acc.id} and ${E.bankEntries.date} between ${de} and ${ate}`);
      const lines = [...tits.map(({ t, c }) => ({ d: t.paidAt!, cat: c ?? "", x: t.description, v: (t.kind === "RECEBER" ? 1 : -1) * Number(t.paidAmount) })), ...ents.map((e) => ({ d: e.date, cat: e.transferId ? "Transferência" : "Ajuste", x: e.description, v: Number(e.amount) }))].sort((a, b) => a.d.localeCompare(b.d));
      let run = before;
      return { name: `extrato-${acc.name}-${de}-a-${ate}.csv`, csv: toCsv(["Data", "Descrição", "Classificação", "Entrada", "Saída", "Saldo"],
        [["", "Saldo anterior", "", "", "", before], ...lines.map((l) => { run += l.v; return [brDate(l.d), l.cat, l.x, l.v > 0 ? l.v : "", l.v < 0 ? -l.v : "", run]; })]) };
    },
  },
  "acad-alunos": {
    mod: "academico",
    run: async (tx) => {
      const rows = await tx.select({ s: E.students, t: E.classes.name, g: E.people.name, gp: E.people.phone, emp: E.companies.name }).from(E.students)
        .innerJoin(E.companies, eq(E.companies.id, E.students.companyId)).leftJoin(E.classes, eq(E.classes.id, E.students.classId)).leftJoin(E.people, eq(E.people.id, E.students.guardianId))
        .orderBy(asc(E.students.name));
      return { name: `alunos-${today()}.csv`, csv: toCsv(["Aluno", "Empresa", "Turma", "Responsável", "Telefone", "Situação", "Mensalidade", "Desconto", "Vencimento (dia)", "Código Proesc"],
        rows.map(({ s, t, g, gp, emp }) => [s.name, emp, t, g, gp, STUDENT_STATUS[s.status]?.label ?? s.status, Number(s.monthlyFee), Number(s.discount), s.dueDay, s.externalCode])) };
    },
  },
};
