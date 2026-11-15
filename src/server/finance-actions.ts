"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { act, NO_ACCESS } from "@/lib/access";
import { audit } from "@/lib/audit";
import { createId } from "@/lib/ids";
import * as E from "@/db/erp";
import { ruleMsg, RuleError } from "./common";
import { addMonths, isDate, today } from "@/lib/dates";
import { normKey, tuitionDue, tuitionValue } from "@/lib/finance-rules";
import type { ActionState } from "@/lib/action";

const id64 = z.string().max(64);
const opt = z.string().max(64).optional().nullable().transform((v) => v || null);
const money = z.number().finite().positive("Informe o valor.").max(1e10);

// ------------------------------------------------------------------------------------
// Lançamentos (contas a receber e a pagar)
// ------------------------------------------------------------------------------------
const titleSchema = z.object({
  id: id64.optional(), kind: z.enum(["RECEBER", "PAGAR"]), companyId: id64.min(1, "Escolha a empresa."),
  description: z.string().trim().min(2, "Informe a descrição.").max(200), document: z.string().trim().max(60).optional().nullable(),
  personId: opt, studentId: opt, categoryId: opt, issueDate: z.string().optional().nullable(), dueDate: z.string().refine(isDate, "Informe o vencimento."),
  amount: money, paymentMethodId: opt, situationId: opt, invoice: z.enum(["COM", "SEM"]).optional().nullable(), notes: z.string().max(2000).optional().nullable(),
  repeat: z.number().int().min(1).max(60).default(1),
  /** lançar já baixado (movimento que já aconteceu, como uma linha da planilha) */
  paidNow: z.object({ paidAt: z.string().refine(isDate, "Data da baixa inválida."), bankAccountId: id64.min(1, "Escolha a conta.") }).optional().nullable(),
});

export async function saveTitleAction(input: z.input<typeof titleSchema>): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const p = titleSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira o lançamento." };
  const d = p.data;
  const base = {
    kind: d.kind, companyId: d.companyId, description: d.description, document: d.document || null, personId: d.personId, studentId: d.studentId,
    categoryId: d.categoryId, issueDate: d.issueDate && isDate(d.issueDate) ? d.issueDate : today(), amount: String(d.amount),
    paymentMethodId: d.paymentMethodId, situationId: d.situationId, invoice: d.invoice ?? null, notes: d.notes?.trim() || null,
  };
  try {
    await s.tx(async (tx) => {
      if (d.id) {
        const [cur] = await tx.select().from(E.finTitles).where(eq(E.finTitles.id, d.id)).limit(1);
        if (!cur) throw new RuleError("Lançamento não encontrado.");
        if (cur.status === "CANCELADO") throw new RuleError("Reative o lançamento antes de alterar.");
        // baixado: valor e empresa ficam presos à baixa (estorne para mudar)
        const locked = cur.status === "PAGO" ? { amount: cur.amount, companyId: cur.companyId } : {};
        await tx.update(E.finTitles).set({ ...base, ...locked, dueDate: d.dueDate }).where(eq(E.finTitles.id, d.id));
      } else {
        const rows = Array.from({ length: d.paidNow ? 1 : d.repeat }, (_, i) => ({
          ...base, tenantId: s.tenant.id, dueDate: i ? addMonths(d.dueDate, i) : d.dueDate, userName: s.userName,
          installment: d.repeat > 1 && !d.paidNow ? `${i + 1}/${d.repeat}` : null, originType: "MANUAL",
          ...(d.paidNow ? { status: "PAGO", paidAt: d.paidNow.paidAt, paidAmount: String(d.amount), bankAccountId: d.paidNow.bankAccountId } : { status: "ABERTO" }),
        }));
        await tx.insert(E.finTitles).values(rows);
      }
    });
  } catch (err) {
    return { error: ruleMsg(err) };
  }
  await audit({ action: d.id ? "lancamento.alterado" : "lancamento.criado", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "lancamento", entityId: d.id, data: { tipo: d.kind, valor: d.amount, repeticoes: d.repeat } });
  return { ok: true, message: d.id ? "Lançamento salvo." : d.paidNow ? "Movimento registrado." : d.repeat > 1 ? `${d.repeat} lançamentos criados.` : "Lançamento criado." };
}

const paySchema = z.object({ id: id64, paidAt: z.string().refine(isDate, "Data inválida."), paidAmount: z.number().finite().min(0).max(1e10), bankAccountId: id64.min(1, "Escolha a conta."), paymentMethodId: opt });
export async function payTitleAction(input: z.input<typeof paySchema>): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const p = paySchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira a baixa." };
  const d = p.data;
  try {
    const r = await s.tx((tx) => tx.update(E.finTitles).set({ status: "PAGO", paidAt: d.paidAt, paidAmount: String(d.paidAmount), bankAccountId: d.bankAccountId, ...(d.paymentMethodId ? { paymentMethodId: d.paymentMethodId } : {}) })
      .where(and(eq(E.finTitles.id, d.id), eq(E.finTitles.status, "ABERTO"))).returning({ k: E.finTitles.kind }));
    if (!r.length) return { error: "Este lançamento não está em aberto." };
    await audit({ action: "lancamento.baixado", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "lancamento", entityId: d.id, data: { valor: d.paidAmount, data: d.paidAt } });
    return { ok: true, message: r[0].k === "RECEBER" ? "Recebimento registrado." : "Pagamento registrado." };
  } catch (err) {
    return { error: ruleMsg(err) };
  }
}

export async function reversePaymentAction(id: string): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const r = await s.tx((tx) => tx.update(E.finTitles).set({ status: "ABERTO", paidAt: null, paidAmount: null, bankAccountId: null })
    .where(and(eq(E.finTitles.id, String(id).slice(0, 64)), eq(E.finTitles.status, "PAGO"))).returning({ id: E.finTitles.id }));
  if (!r.length) return { error: "Este lançamento não está baixado." };
  await audit({ action: "lancamento.estornado", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "lancamento", entityId: id });
  return { ok: true, message: "Baixa estornada. O lançamento voltou para em aberto." };
}

export async function cancelTitleAction(id: string, undo = false): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  try {
    const r = await s.tx((tx) => tx.update(E.finTitles).set({ status: undo ? "ABERTO" : "CANCELADO" })
      .where(and(eq(E.finTitles.id, String(id).slice(0, 64)), eq(E.finTitles.status, undo ? "CANCELADO" : "ABERTO"))).returning({ id: E.finTitles.id }));
    if (!r.length) return { error: undo ? "O lançamento não está cancelado." : "Só lançamentos em aberto podem ser cancelados." };
  } catch (err) {
    return { error: ruleMsg(err) };
  }
  await audit({ action: undo ? "lancamento.reativado" : "lancamento.cancelado", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "lancamento", entityId: id });
  return { ok: true, message: undo ? "Lançamento reativado." : "Lançamento cancelado. Ele deixa de contar no fluxo de caixa." };
}

export async function deleteTitleAction(id: string): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  try {
    await s.tx(async (tx) => {
      const [t] = await tx.select().from(E.finTitles).where(eq(E.finTitles.id, String(id).slice(0, 64)));
      if (!t) throw new RuleError("Lançamento não encontrado.");
      if (t.status === "PAGO") throw new RuleError("Estorne a baixa antes de excluir.");
      if (t.originType === "MENSALIDADE") throw new RuleError("Mensalidade gerada: cancele em vez de excluir, para manter o histórico do aluno.");
      await tx.delete(E.finTitles).where(eq(E.finTitles.id, t.id));
    });
  } catch (err) {
    return { error: ruleMsg(err) };
  }
  await audit({ action: "lancamento.excluido", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "lancamento", entityId: id });
  return { ok: true, message: "Lançamento excluído." };
}

// ------------------------------------------------------------------------------------
// Extrato: ajustes de saldo e transferências entre contas (não entram na DRE)
// ------------------------------------------------------------------------------------
const entrySchema = z.object({ bankAccountId: id64.min(1), date: z.string().refine(isDate, "Data inválida."), description: z.string().trim().min(2, "Informe a descrição.").max(200),
  amount: z.number().finite().refine((v) => v !== 0, "Informe o valor.").refine((v) => Math.abs(v) < 1e10), notes: z.string().max(500).optional().nullable() });
export async function saveBankEntryAction(input: z.input<typeof entrySchema>): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const p = entrySchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira o lançamento." };
  try {
    await s.tx((tx) => tx.insert(E.bankEntries).values({ ...p.data, amount: String(p.data.amount), notes: p.data.notes?.trim() || null, tenantId: s.tenant.id }));
  } catch (err) { return { error: ruleMsg(err) }; }
  await audit({ action: "extrato.ajuste_criado", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "conta", entityId: p.data.bankAccountId, data: { valor: p.data.amount } });
  return { ok: true, message: "Ajuste registrado no extrato." };
}

const transferSchema = z.object({ from: id64.min(1), to: id64.min(1), date: z.string().refine(isDate, "Informe a data."), amount: money, description: z.string().trim().max(200).optional() });
export async function transferAction(input: z.input<typeof transferSchema>): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const p = transferSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira a transferência." };
  const d = p.data;
  if (d.from === d.to) return { error: "Escolha contas de origem e destino diferentes." };
  const desc = d.description || "Transferência entre contas";
  const transferId = createId();
  try {
    await s.tx((tx) => tx.insert(E.bankEntries).values([
      { tenantId: s.tenant.id, bankAccountId: d.from, date: d.date, description: desc, amount: String(-d.amount), transferId },
      { tenantId: s.tenant.id, bankAccountId: d.to, date: d.date, description: desc, amount: String(d.amount), transferId },
    ]));
  } catch (err) { return { error: ruleMsg(err) }; }
  await audit({ action: "extrato.transferencia_criada", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "transferencia", entityId: transferId, data: { valor: d.amount } });
  return { ok: true, message: "Transferência registrada nas duas contas." };
}

/** Exclui um movimento avulso (na transferência, exclui as duas pontas). */
export async function deleteBankEntryAction(id: string): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const n = await s.tx(async (tx) => {
    const [e] = await tx.select().from(E.bankEntries).where(eq(E.bankEntries.id, String(id).slice(0, 64))).limit(1);
    if (!e) return 0;
    const r = await tx.delete(E.bankEntries).where(e.transferId ? eq(E.bankEntries.transferId, e.transferId) : eq(E.bankEntries.id, e.id)).returning({ id: E.bankEntries.id });
    return r.length;
  });
  if (!n) return { error: "Movimento não encontrado." };
  await audit({ action: "extrato.movimento_excluido", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "movimento", entityId: id });
  return { ok: true, message: n > 1 ? "Transferência excluída das duas contas." : "Movimento excluído do extrato." };
}

// ------------------------------------------------------------------------------------
// Mensalidades: gera as contas a receber do mês para os alunos ativos
// ------------------------------------------------------------------------------------
const tuitionSchema = z.object({ competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Escolha o mês."), companyId: opt, categoryId: id64.min(1, "Escolha a categoria das mensalidades.") });
export async function generateTuitionAction(input: z.input<typeof tuitionSchema>): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const p = tuitionSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira os dados." };
  const d = p.data;
  const [y, m] = d.competence.split("-");
  try {
    const r = await s.tx(async (tx) => {
      const [cat] = await tx.select({ id: E.finCategories.id }).from(E.finCategories).where(eq(E.finCategories.id, d.categoryId)).limit(1);
      if (!cat) throw new RuleError("Categoria não encontrada.");
      const studs = await tx.select().from(E.students).where(and(eq(E.students.status, "ATIVO"), d.companyId ? eq(E.students.companyId, d.companyId) : sql`true`));
      const rows = studs.filter((st) => tuitionValue(st.monthlyFee, st.discount) > 0).map((st) => ({
        tenantId: s.tenant.id, kind: "RECEBER", companyId: st.companyId, description: `Mensalidade ${m}/${y} — ${st.name}`, personId: st.guardianId, studentId: st.id,
        categoryId: cat.id, issueDate: today(), dueDate: tuitionDue(d.competence, st.dueDay), competence: d.competence, amount: String(tuitionValue(st.monthlyFee, st.discount)),
        status: "ABERTO", originType: "MENSALIDADE", userName: s.userName,
      }));
      if (!rows.length) return { created: 0, total: 0 };
      const ins = await tx.insert(E.finTitles).values(rows).onConflictDoNothing().returning({ id: E.finTitles.id });
      return { created: ins.length, total: rows.length };
    });
    await audit({ action: "mensalidade.geradas", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "competencia", entityId: d.competence, data: r });
    if (!r.total) return { ok: true, message: "Nenhum aluno ativo com mensalidade a gerar." };
    const skipped = r.total - r.created;
    return { ok: true, message: `${r.created} ${r.created === 1 ? "mensalidade gerada" : "mensalidades geradas"}${skipped ? ` · ${skipped} já existiam e foram mantidas` : ""}.` };
  } catch (err) {
    return { error: ruleMsg(err) };
  }
}

// ------------------------------------------------------------------------------------
// Importação das planilhas de fluxo de caixa (Data, Descrição, Entrada, Saída, Classificação, Nota)
// ------------------------------------------------------------------------------------
const importRow = z.object({ date: z.string().refine(isDate), category: z.string().max(200), inValue: z.number().finite().min(0).max(1e10), outValue: z.number().finite().min(0).max(1e10),
  detail: z.string().max(300).default(""), nota: z.string().max(20).default("") });
const importSchema = z.object({ bankAccountId: id64.min(1, "Escolha a conta."), fileName: z.string().trim().min(1).max(200), rows: z.array(importRow).min(1, "A planilha não tem linhas válidas.").max(5000, "Importe no máximo 5.000 linhas por vez."),
  dryRun: z.boolean().default(true), skipDuplicates: z.boolean().default(true), allowUncategorized: z.boolean().default(false) });

export type ImportPreview = { ok?: boolean; error?: string; message?: string; rows?: number; entradas?: number; saidas?: number; unknown?: string[]; duplicates?: number; created?: number };

export async function importStatementAction(input: z.input<typeof importSchema>): Promise<ImportPreview> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  const p = importSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira a planilha." };
  const d = p.data;
  try {
    return await s.tx(async (tx) => {
      const [acc] = await tx.select().from(E.bankAccounts).where(eq(E.bankAccounts.id, d.bankAccountId)).limit(1);
      if (!acc) throw new RuleError("Conta não encontrada.");
      const cats = await tx.select().from(E.finCategories);
      const byName = new Map(cats.map((c) => [normKey(c.name), c.id]));
      const unknown = [...new Set(d.rows.map((r) => r.category.trim()).filter((c) => c && !byName.has(normKey(c))))].sort();
      // um movimento por valor: a linha com entrada e saída vira dois lançamentos
      const items = d.rows.flatMap((r) => ([["RECEBER", r.inValue], ["PAGAR", r.outValue]] as const).filter(([, v]) => v > 0).map(([kind, v]) => ({
        kind, v, date: r.date, categoryId: byName.get(normKey(r.category)) ?? null,
        description: (r.detail.trim() || r.category.trim() || "Movimento importado").slice(0, 200),
        invoice: /s\s*\/?\s*nf/i.test(r.nota) ? "SEM" : /c\s*\/?\s*nf/i.test(r.nota) ? "COM" : null,
      })));
      if (!items.length) throw new RuleError("Nenhuma linha com valor de entrada ou saída.");
      // possíveis duplicados: mesma conta, data, tipo, valor e descrição já lançados
      const dates = [...new Set(items.map((i) => i.date))];
      const existing = await tx.select({ k: E.finTitles.kind, d: E.finTitles.paidAt, v: E.finTitles.paidAmount, x: E.finTitles.description }).from(E.finTitles)
        .where(and(eq(E.finTitles.bankAccountId, acc.id), eq(E.finTitles.status, "PAGO"), inArray(E.finTitles.paidAt, dates)));
      const seen = new Set(existing.map((e) => `${e.k}|${e.d}|${Number(e.v).toFixed(2)}|${normKey(e.x)}`));
      const isDup = (i: (typeof items)[number]) => seen.has(`${i.kind}|${i.date}|${i.v.toFixed(2)}|${normKey(i.description)}`);
      const duplicates = items.filter(isDup).length;
      const entradas = items.filter((i) => i.kind === "RECEBER").reduce((a, i) => a + i.v, 0);
      const saidas = items.filter((i) => i.kind === "PAGAR").reduce((a, i) => a + i.v, 0);
      const summary = { rows: items.length, entradas, saidas, unknown, duplicates };
      if (d.dryRun) return { ok: true, ...summary };
      if (unknown.length && !d.allowUncategorized) throw new RuleError(`Categorias não encontradas: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? "…" : ""}. Cadastre-as ou marque para importar sem categoria.`);
      const toInsert = d.skipDuplicates ? items.filter((i) => !isDup(i)) : items;
      if (!toInsert.length) throw new RuleError("Todas as linhas já estavam lançadas nesta conta.");
      const [imp] = await tx.insert(E.finImports).values({ tenantId: s.tenant.id, bankAccountId: acc.id, fileName: d.fileName, rows: toInsert.length, total: String(toInsert.reduce((a, i) => a + (i.kind === "RECEBER" ? i.v : -i.v), 0)), userName: s.userName }).returning();
      for (let k = 0; k < toInsert.length; k += 500) {
        await tx.insert(E.finTitles).values(toInsert.slice(k, k + 500).map((i) => ({
          tenantId: s.tenant.id, kind: i.kind, companyId: acc.companyId, description: i.description, categoryId: i.categoryId, issueDate: i.date, dueDate: i.date,
          amount: String(i.v), status: "PAGO", paidAt: i.date, paidAmount: String(i.v), bankAccountId: acc.id, invoice: i.invoice, originType: "IMPORTACAO", originId: imp.id, userName: s.userName,
        })));
      }
      await audit({ action: "importacao.criada", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "importacao", entityId: imp.id, data: { arquivo: d.fileName, linhas: toInsert.length, conta: acc.name } });
      return { ok: true, ...summary, created: toInsert.length, message: `${toInsert.length} movimentos importados em ${acc.name}.` };
    });
  } catch (err) {
    return { error: ruleMsg(err, "Não foi possível importar.") };
  }
}

export async function undoImportAction(id: string): Promise<ActionState> {
  const s = await act("financeiro");
  if (!s) return NO_ACCESS;
  try {
    const n = await s.tx(async (tx) => {
      const [imp] = await tx.select().from(E.finImports).where(eq(E.finImports.id, String(id).slice(0, 64))).limit(1);
      if (!imp) throw new RuleError("Importação não encontrada.");
      const r = await tx.delete(E.finTitles).where(and(eq(E.finTitles.originType, "IMPORTACAO"), eq(E.finTitles.originId, imp.id))).returning({ id: E.finTitles.id });
      await tx.delete(E.finImports).where(eq(E.finImports.id, imp.id));
      return r.length;
    });
    await audit({ action: "importacao.desfeita", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "importacao", entityId: id, data: { lancamentos: n } });
    return { ok: true, message: `Importação desfeita: ${n} movimentos removidos.` };
  } catch (err) {
    return { error: ruleMsg(err) };
  }
}

// ------------------------------------------------------------------------------------
// Metas do orçamento (indicadores por empresa)
// ------------------------------------------------------------------------------------
const targetsSchema = z.object({ companyId: id64.min(1), targets: z.array(z.object({ indicatorId: id64, pct: z.number().finite().min(0).max(1000).nullable() })).max(100) });
export async function saveTargetsAction(input: z.input<typeof targetsSchema>): Promise<ActionState> {
  const s = await act("paineis");
  if (!s) return NO_ACCESS;
  const p = targetsSchema.safeParse(input);
  if (!p.success) return { error: "Confira as metas (de 0% a 1000%)." };
  const d = p.data;
  try {
    await s.tx(async (tx) => {
      for (const t of d.targets) {
        if (t.pct == null) { await tx.delete(E.indicatorTargets).where(and(eq(E.indicatorTargets.indicatorId, t.indicatorId), eq(E.indicatorTargets.companyId, d.companyId))); continue; }
        await tx.insert(E.indicatorTargets).values({ tenantId: s.tenant.id, indicatorId: t.indicatorId, companyId: d.companyId, targetPct: String(t.pct) })
          .onConflictDoUpdate({ target: [E.indicatorTargets.tenantId, E.indicatorTargets.indicatorId, E.indicatorTargets.companyId], set: { targetPct: String(t.pct) } });
      }
    });
  } catch (err) {
    return { error: ruleMsg(err) };
  }
  await audit({ action: "metas.alteradas", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "empresa", entityId: d.companyId });
  return { ok: true, message: "Metas salvas." };
}

const indicatorSchema = z.object({ id: id64.optional(), name: z.string().trim().min(2, "Informe o nome.").max(120), groupId: opt, categoryIds: z.array(id64).max(50).default([]), position: z.number().int().min(0).max(100000).default(0), active: z.boolean().default(true) });
export async function saveIndicatorAction(input: z.input<typeof indicatorSchema>): Promise<ActionState> {
  const s = await act("paineis");
  if (!s) return NO_ACCESS;
  const p = indicatorSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira o indicador." };
  const d = p.data;
  if (!d.groupId && !d.categoryIds.length) return { error: "Escolha um grupo da DRE ou ao menos uma categoria." };
  try {
    await s.tx(async (tx) => {
      const v = { name: d.name, groupId: d.groupId, categoryIds: d.groupId ? [] : d.categoryIds, position: d.position, active: d.active };
      if (d.id) await tx.update(E.indicators).set(v).where(eq(E.indicators.id, d.id));
      else await tx.insert(E.indicators).values({ ...v, tenantId: s.tenant.id });
    });
  } catch (err) {
    return { error: ruleMsg(err) };
  }
  await audit({ action: d.id ? "indicador.alterado" : "indicador.criado", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "indicador", entityId: d.id });
  return { ok: true, message: d.id ? "Indicador salvo." : "Indicador criado." };
}

export async function deleteIndicatorAction(id: string): Promise<ActionState> {
  const s = await act("paineis");
  if (!s) return NO_ACCESS;
  await s.tx((tx) => tx.delete(E.indicators).where(eq(E.indicators.id, String(id).slice(0, 64))));
  await audit({ action: "indicador.excluido", tenantId: s.tenant.id, userId: s.user.id, userEmail: s.user.email, entity: "indicador", entityId: id });
  return { ok: true, message: "Indicador excluído." };
}
