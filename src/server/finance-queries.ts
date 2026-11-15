import "server-only";
import { asc, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import * as E from "@/db/erp";
import { addDays, today } from "@/lib/dates";
import type { DreAmount } from "@/lib/dre";

/** Filtro comum dos painéis e relatórios: empresa e/ou conta. */
export type Scope = { companyId?: string | null; accountId?: string | null };

const scopeSql = (s: Scope, alias = "t"): SQL => {
  const c: SQL[] = [];
  const a = sql.raw(alias);
  if (s.companyId) c.push(sql`${a}.company_id = ${s.companyId}`);
  if (s.accountId) c.push(sql`${a}.bank_account_id = ${s.accountId}`);
  return c.length ? sql.join(c, sql` and `) : sql`true`;
};

/** Saldo de cada conta até uma data: saldo inicial + recebimentos − pagamentos + movimentos avulsos (transferências, ajustes). */
export async function accountBalances(tx: Tx, until = today()) {
  const accs = await tx.select().from(E.bankAccounts).orderBy(asc(E.bankAccounts.name));
  const r = await tx.execute<{ id: string; v: string }>(sql`
    select a.id, (a.initial_balance
      + coalesce((select sum(case when t.kind = 'RECEBER' then t.paid_amount else -t.paid_amount end) from fin_titles t
          where t.bank_account_id = a.id and t.status = 'PAGO' and t.paid_at <= ${until} and (a.initial_date is null or t.paid_at >= a.initial_date)), 0)
      + coalesce((select sum(e.amount) from bank_entries e where e.bank_account_id = a.id and e.date <= ${until} and (a.initial_date is null or e.date >= a.initial_date)), 0))::text v
    from bank_accounts a`);
  const m = new Map(r.rows.map((x) => [x.id, Number(x.v)]));
  return accs.map((a) => ({ ...a, balance: m.get(a.id) ?? Number(a.initialBalance) }));
}

/** Fluxo previsto por semana a partir de hoje (vencidos e não pagos entram na primeira semana). */
export async function weeklyFlow(tx: Tx, weeks: number, scope: Scope = {}) {
  const accs = (await accountBalances(tx)).filter((a) => a.active && (!scope.companyId || a.companyId === scope.companyId) && (!scope.accountId || a.id === scope.accountId));
  let saldo = accs.reduce((x, a) => x + a.balance, 0);
  const start = saldo;
  const hoje = today();
  const end = addDays(hoje, weeks * 7 - 1);
  const r = await tx.execute<{ kind: string; due: string; amount: string }>(sql`
    select t.kind, t.due_date::text due, t.amount::text amount from fin_titles t
    where t.status = 'ABERTO' and t.due_date <= ${end} and ${scopeSql({ companyId: scope.companyId })}`);
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const ini = addDays(hoje, i * 7), fim = addDays(hoje, i * 7 + 6);
    const tt = r.rows.filter((t) => (i === 0 ? t.due <= fim : t.due >= ini && t.due <= fim));
    const e = tt.filter((t) => t.kind === "RECEBER").reduce((a, t) => a + Number(t.amount), 0);
    const s = tt.filter((t) => t.kind === "PAGAR").reduce((a, t) => a + Number(t.amount), 0);
    saldo += e - s;
    out.push({ ini, fim, e, s, res: e - s, saldo });
  }
  return { start, weeks: out };
}

/**
 * Movimento realizado (regime de caixa, como as planilhas): lançamentos baixados no período,
 * com sinal (+ recebido, − pago), somados por categoria e mês (AAAA-MM).
 */
export async function realizedByCategory(tx: Tx, from: string, to: string, scope: Scope = {}): Promise<DreAmount[]> {
  const r = await tx.execute<{ c: string | null; p: string; v: string }>(sql`
    select t.category_id c, to_char(t.paid_at, 'YYYY-MM') p,
      sum(case when t.kind = 'RECEBER' then t.paid_amount else -t.paid_amount end)::text v
    from fin_titles t
    where t.status = 'PAGO' and t.paid_at between ${from} and ${to} and ${scopeSql(scope)}
    group by 1, 2`);
  return r.rows.map((x) => ({ categoryId: x.c, period: x.p, value: Number(x.v) }));
}

/** Entradas e saídas realizadas por mês, com quantidade (para ticket médio). */
export async function realizedByMonth(tx: Tx, from: string, to: string, scope: Scope = {}) {
  const r = await tx.execute<{ p: string; e: string; s: string; ne: number; ns: number; ap: string }>(sql`
    select to_char(t.paid_at, 'YYYY-MM') p,
      coalesce(sum(t.paid_amount) filter (where t.kind = 'RECEBER'), 0)::text e,
      coalesce(sum(t.paid_amount) filter (where t.kind = 'PAGAR'), 0)::text s,
      (count(*) filter (where t.kind = 'RECEBER'))::int ne,
      (count(*) filter (where t.kind = 'PAGAR'))::int ns,
      coalesce(sum(t.paid_amount) filter (where t.kind = 'PAGAR' and g.section = 'INVESTIMENTO'), 0)::text ap
    from fin_titles t
    left join fin_categories c on c.id = t.category_id
    left join dre_groups g on g.id = c.group_id
    where t.status = 'PAGO' and t.paid_at between ${from} and ${to} and ${scopeSql(scope)}
    group by 1 order by 1`);
  return r.rows.map((x) => ({ period: x.p, e: Number(x.e), s: Number(x.s), ne: x.ne, ns: x.ns, ap: Number(x.ap) }));
}

/** Total realizado por categoria e tipo no período (barras de entradas e saídas por categoria). */
export async function realizedCategoryTotals(tx: Tx, from: string, to: string, scope: Scope = {}) {
  const r = await tx.execute<{ kind: string; name: string | null; v: string }>(sql`
    select t.kind, c.name, sum(t.paid_amount)::text v
    from fin_titles t left join fin_categories c on c.id = t.category_id
    where t.status = 'PAGO' and t.paid_at between ${from} and ${to} and ${scopeSql(scope)}
    group by 1, 2 order by 3::numeric desc`);
  return r.rows.map((x) => ({ kind: x.kind as "RECEBER" | "PAGAR", name: x.name ?? "Sem categoria", v: Number(x.v) }));
}

/** Em aberto a pagar (para o card "Contas a pagar" do painel). */
export async function openPayables(tx: Tx, until: string, scope: Scope = {}) {
  const r = await tx.execute<{ v: string }>(sql`
    select coalesce(sum(t.amount), 0)::text v from fin_titles t
    where t.status = 'ABERTO' and t.kind = 'PAGAR' and t.due_date <= ${until} and ${scopeSql({ companyId: scope.companyId })}`);
  return Number(r.rows[0]?.v ?? 0);
}

export async function lookupsFin(tx: Tx) {
  return {
    companies: await tx.select().from(E.companies).orderBy(asc(E.companies.name)),
    accounts: await tx.select().from(E.bankAccounts).orderBy(asc(E.bankAccounts.name)),
    methods: await tx.select({ id: E.paymentMethods.id, n: E.paymentMethods.name, active: E.paymentMethods.active }).from(E.paymentMethods).orderBy(asc(E.paymentMethods.name)),
    groups: await tx.select().from(E.dreGroups).orderBy(asc(E.dreGroups.position)),
    categories: await tx.select().from(E.finCategories).orderBy(asc(E.finCategories.name)),
    situations: await tx.select().from(E.finSituations).orderBy(asc(E.finSituations.name)),
  };
}
