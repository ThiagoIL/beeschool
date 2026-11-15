import { asc, eq } from "drizzle-orm";
import { page } from "@/lib/access";
import * as E from "@/db/erp";
import { Empty, Kpi, PageHead, Panel } from "@/components/ui";
import { FilterBar, FilterTabs } from "@/components/client";
import { Sel } from "@/components/SearchPicker";
import { DreTable } from "@/components/DreTable";
import { TargetsEditor } from "@/components/PanelsUI";
import { Donut, DivBars, Gauge, HBars, VBars, kfmt } from "@/components/Charts";
import { lookupsFin, openPayables, realizedByCategory, realizedByMonth, realizedCategoryTotals } from "@/server/finance-queries";
import { buildDre, type DreLine } from "@/lib/dre";
import { fmtMoney, fmtPct } from "@/lib/format";
import { today } from "@/lib/dates";
import { MONTHS, type DreSection } from "@/lib/consts";

type SP = Record<string, string | string[] | undefined>;
const arr = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const one = (v: string | string[] | undefined) => arr(v)[0]?.slice(0, 64);

/** Filtros dos painéis (iguais aos do Power BI): Ano, Mês (vários), Banco e Empresa. */
function dashFilter(sp: SP) {
  const cy = Number(today().slice(0, 4)), cm = Number(today().slice(5, 7));
  const year = /^\d{4}$/.test(one(sp.ano) ?? "") ? Number(one(sp.ano)) : cy;
  let months = arr(sp.mes).map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  const explicit = months.length > 0;
  if (!months.length) { const last = year === cy ? cm : 12; months = last > 1 ? [last - 1, last] : [last]; }
  months = [...new Set(months)].sort((a, b) => a - b);
  const periods = months.map((m) => `${year}-${String(m).padStart(2, "0")}`);
  const from = `${periods[0]}-01`;
  const lastP = periods[periods.length - 1];
  const to = new Date(Date.UTC(year, Number(lastP.slice(5)), 0)).toISOString().slice(0, 10);
  return { year, months, explicit, periods, from, to, emp: one(sp.emp), conta: one(sp.conta) };
}
type DF = ReturnType<typeof dashFilter>;

async function DashFilters({ f, o, extra }: { f: DF; o: Awaited<ReturnType<typeof lookupsFin>>; extra?: React.ReactNode }) {
  const years = Array.from({ length: 6 }, (_, i) => Number(today().slice(0, 4)) + 1 - i);
  return (
    <FilterBar>
      <select name="ano" defaultValue={String(f.year)} aria-label="Ano">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
      <div className="month-chips" role="group" aria-label="Meses">
        {MONTHS.map((m, i) => <label key={m} className="mchip"><input type="checkbox" name="mes" value={i + 1} defaultChecked={f.explicit && f.months.includes(i + 1)} /><span>{m}</span></label>)}
      </div>
      <Sel name="conta" defaultValue={f.conta ?? ""} aria-label="Banco"><option value="">Todos os bancos</option>{o.companies.map((c) => <optgroup key={c.id} label={c.name}>{o.accounts.filter((a) => a.companyId === c.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}</Sel>
      {o.companies.length > 1 && <select name="emp" defaultValue={f.emp ?? ""} aria-label="Empresa"><option value="">Todas as empresas</option>{o.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      {extra}
    </FilterBar>
  );
}
const periodLabel = (f: DF) => `${f.months.map((m) => MONTHS[m - 1]).join(", ")} de ${f.year}${f.explicit ? "" : " (escolha os meses acima)"}`;

async function dreFor(f: DF, s: Awaited<ReturnType<typeof page>>, o: Awaited<ReturnType<typeof lookupsFin>>) {
  const prevMonthStart = new Date(Date.UTC(f.year, f.months[0] - 2, 1)).toISOString().slice(0, 10);
  const prevMonthEnd = new Date(Date.UTC(f.year, f.months[0] - 1, 0)).toISOString().slice(0, 10);
  const d = await s.tx(async (tx) => {
    const [cs] = await tx.select({ b: E.companySettings.pctBase }).from(E.companySettings).limit(1);
    return {
      amounts: await realizedByCategory(tx, f.from, f.to, { companyId: f.emp, accountId: f.conta }),
      previous: await realizedByCategory(tx, prevMonthStart, prevMonthEnd, { companyId: f.emp, accountId: f.conta }),
      baseMode: cs?.b === "RECEITA_BRUTA" ? "RECEITA_BRUTA" as const : "MENSALIDADE" as const,
    };
  });
  return buildDre({ groups: o.groups.filter((g) => g.active).map((g) => ({ ...g, section: g.section as DreSection })), categories: o.categories, amounts: d.amounts.filter((a) => f.periods.includes(a.period)), previous: d.previous, periods: f.periods, baseMode: d.baseMode });
}
const byName = (lines: DreLine[], re: RegExp) => lines.filter((l) => l.kind === "group" && re.test(l.label)).reduce((a, l) => a + l.total, 0);
const bySection = (lines: DreLine[], s: DreSection) => lines.filter((l) => l.kind === "group" && l.section === s).reduce((a, l) => a + l.total, 0);

// ------------------------------------------------------------------------------------
export async function DrePanel({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await page("paineis");
  const f = dashFilter(await searchParams);
  const o = await s.tx(lookupsFin);
  const dre = await dreFor(f, s, o);
  const rl = dre.lines.find((l) => l.key === "RL")?.total ?? 0;
  return (
    <>
      <PageHead title="Visão financeira · Análise DRE" sub={periodLabel(f)} />
      <DashFilters f={f} o={o} />
      <div className="kpis k4 money">
        <Kpi value={fmtMoney(rl)} label="Receita Líquida" />
        <Kpi value={fmtMoney(Math.abs(byName(dre.lines, /pessoal/i)))} label="Despesas com Pessoal" />
        <Kpi value={fmtMoney(Math.abs(bySection(dre.lines, "VARIAVEL")))} label="Despesas Variáveis" />
        <Kpi value={fmtMoney(Math.abs(byName(dre.lines, /ocupa/i)))} label="Custos Fixos (Ocupação)" />
      </div>
      <DreTable periods={f.periods.map((p) => ({ key: p, label: MONTHS[Number(p.slice(5)) - 1] }))} lines={dre.lines} showTotal={f.periods.length > 1} />
    </>
  );
}

// ------------------------------------------------------------------------------------
export async function CashPanel({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await page("paineis");
  const sp = await searchParams;
  const f = dashFilter(sp);
  const ag = ["ano", "tri", "sem", "mes"].includes(one(sp.ag) ?? "") ? one(sp.ag)! : "mes";
  const o = await s.tx(lookupsFin);
  const scope = { companyId: f.emp, accountId: f.conta };
  const d = await s.tx(async (tx) => ({
    months: (await realizedByMonth(tx, f.from, f.to, scope)).filter((m) => f.periods.includes(m.period)),
    cats: await realizedCategoryTotals(tx, f.from, f.to, scope),
    payables: await openPayables(tx, f.to, scope),
  }));
  const ent = d.months.reduce((a, m) => a + m.e, 0), sai = d.months.reduce((a, m) => a + m.s, 0);
  const ne = d.months.reduce((a, m) => a + m.ne, 0), ns = d.months.reduce((a, m) => a + m.ns, 0);
  const ap = d.months.reduce((a, m) => a + m.ap, 0);
  const keyOf = (p: string) => { const m = Number(p.slice(5)); return ag === "ano" ? p.slice(0, 4) : ag === "tri" ? `${Math.ceil(m / 3)}º tri` : ag === "sem" ? `${Math.ceil(m / 6)}º sem` : MONTHS[m - 1]; };
  const buckets = [...new Set(f.periods.map(keyOf))];
  const sumB = (k: "e" | "s") => buckets.map((b) => d.months.filter((m) => keyOf(m.period) === b).reduce((a, m) => a + m[k], 0));
  const top = (k: "RECEBER" | "PAGAR") => d.cats.filter((c) => c.kind === k).slice(0, 14).map((c) => ({ l: c.name, v: c.v, c: k === "RECEBER" ? "var(--brand)" : "var(--ink)" }));
  return (
    <>
      <PageHead title="Visão financeira · Fluxo de caixa" sub={periodLabel(f)} />
      <DashFilters f={f} o={o} extra={<FilterTabs name="ag" value={ag === "mes" ? "" : ag} options={[{ v: "ano", label: "Ano" }, { v: "tri", label: "Trimestre" }, { v: "sem", label: "Semestre" }, { v: "", label: "Mês" }]} />} />
      <div className="kpis k5 money">
        <Kpi value={fmtMoney(ent)} label={`Entradas · Qtd: ${ne} · Ticket médio: ${fmtMoney(ne ? ent / ne : 0)}`} />
        <Kpi value={fmtMoney(sai)} label={`Saídas · Qtd: ${ns} · Ticket médio: ${fmtMoney(ns ? sai / ns : 0)}`} />
        <Kpi value={fmtMoney(ap)} label="Aplicação financeira" />
        <Kpi value={fmtMoney(d.payables)} label="Contas a pagar (em aberto até o fim do período)" alert={d.payables > 0} />
        <Kpi value={fmtMoney(ent - sai)} label="Saldo (entradas − saídas)" alert={ent - sai < 0} />
      </div>
      <div className="dgrid">
        <Panel className="span2" title="Fluxo de caixa" sub={ag === "ano" ? "por ano" : ag === "tri" ? "por trimestre" : ag === "sem" ? "por semestre" : "por mês"}>
          <div className="pb"><VBars labels={buckets} sets={[{ n: "Entradas", c: "var(--brand)", v: sumB("e") }, { n: "Saídas", c: "var(--ink)", v: sumB("s") }]} label="Entradas e saídas" /></div>
        </Panel>
        <Panel title="Resultado por mês"><div className="pb"><DivBars rows={d.months.map((m) => ({ l: MONTHS[Number(m.period.slice(5)) - 1], v: m.e - m.s }))} fmt={kfmt} /></div></Panel>
        <Panel title="Composição financeira"><div className="pb"><Donut fmt={fmtMoney} rows={[{ l: "Entradas", v: ent, c: "var(--brand)" }, { l: "Saídas", v: sai, c: "var(--ink)" }, { l: "Contas a pagar", v: d.payables, c: "var(--muted)" }]} /></div></Panel>
        <Panel title="Entradas por categoria"><div className="pb"><HBars rows={top("RECEBER")} fmt={fmtMoney} /></div></Panel>
        <Panel title="Saídas por categoria"><div className="pb"><HBars rows={top("PAGAR")} fmt={fmtMoney} /></div></Panel>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------
async function indicatorsData(s: Awaited<ReturnType<typeof page>>) {
  return s.tx(async (tx) => ({
    inds: await tx.select().from(E.indicators).where(eq(E.indicators.active, true)).orderBy(asc(E.indicators.position), asc(E.indicators.name)),
    targets: await tx.select().from(E.indicatorTargets),
  }));
}

export async function IndicatorsPanel({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await page("paineis");
  const sp = await searchParams;
  const f = dashFilter(sp);
  const o = await s.tx(lookupsFin);
  const orc = one(sp.orc) ?? f.emp ?? o.companies.find((c) => c.active)?.id ?? "";
  const dre = await dreFor(f, s, o);
  const { inds, targets } = await indicatorsData(s);
  const base = dre.baseTotal;
  const catTotal = new Map(dre.lines.filter((l) => l.kind === "category").map((l) => [l.key.slice(2), l.total]));
  const grpTotal = new Map(dre.lines.filter((l) => l.kind === "group").map((l) => [l.key.slice(2), l.total]));
  const pctOf = (v: number) => (base ? ((-v / base) * 100) || 0 : null);
  const rb = dre.lines.find((l) => l.key === "RB")?.total ?? 0;
  const pess = byName(dre.lines, /pessoal/i), vari = bySection(dre.lines, "VARIAVEL"), ocup = byName(dre.lines, /ocupa/i);
  const tgt = new Map(targets.filter((t) => t.companyId === orc).map((t) => [t.indicatorId, Number(t.targetPct)]));
  return (
    <>
      <PageHead title="Visão financeira · Análise de indicadores" sub={`${periodLabel(f)} · percentuais sobre o faturamento (${fmtMoney(base)})`} />
      <DashFilters f={f} o={o} extra={o.companies.length > 0 && (<><input type="hidden" name="orc" value={orc} />
        <div className="seg orc" role="group" aria-label="Orçamento">{o.companies.filter((c) => c.active).map((c) => (
          <a key={c.id} href={`?${new URLSearchParams([...Object.entries(sp).flatMap(([k, v]) => arr(v).map((x) => [k, x] as [string, string])).filter(([k]) => k !== "orc"), ["orc", c.id]])}`} aria-pressed={c.id === orc}>Orçamento · {c.name}</a>))}</div></>)} />
      <div className="kpis k4 money">
        <Kpi value={fmtMoney(rb)} label={`Receita Bruta · ${fmtPct(base ? (rb / base) * 100 : null)} do faturamento`} />
        <Kpi value={fmtMoney(Math.abs(pess))} label={`Despesas com Pessoal · ${fmtPct(pctOf(pess))}`} />
        <Kpi value={fmtMoney(Math.abs(vari))} label={`Despesas Variáveis · ${fmtPct(pctOf(vari))}`} />
        <Kpi value={fmtMoney(Math.abs(ocup))} label={`Despesas com Ocupação · ${fmtPct(pctOf(ocup))}`} />
      </div>
      {inds.length ? (
        <div className="gauges">
          {inds.map((i) => {
            const v = i.groupId ? grpTotal.get(i.groupId) ?? 0 : i.categoryIds.reduce((a, c) => a + (catTotal.get(c) ?? 0), 0);
            const p = pctOf(v);
            const t = tgt.get(i.id) ?? null;
            return (
              <section key={i.id} className={`gauge-card${t != null && p != null && p > t ? " over" : ""}`}>
                <h3>{i.name}</h3>
                <Gauge value={p} target={t} label={i.name} />
                <p className="muted">{fmtMoney(Math.abs(v))}{t != null ? ` · meta ${fmtPct(t)}` : " · sem meta"}</p>
              </section>
            );
          })}
        </div>
      ) : <Panel><Empty title="Nenhum indicador">Cadastre em Painéis › Orçamento e metas.</Empty></Panel>}
    </>
  );
}

// ------------------------------------------------------------------------------------
export async function TargetsPage() {
  const s = await page("paineis");
  const o = await s.tx(lookupsFin);
  const all = await s.tx(async (tx) => ({
    inds: await tx.select().from(E.indicators).orderBy(asc(E.indicators.position), asc(E.indicators.name)),
    targets: await tx.select().from(E.indicatorTargets),
  }));
  return (
    <>
      <PageHead title="Orçamento e metas" sub="Teto de cada indicador em % do faturamento, por empresa. No painel de indicadores, o traço do velocímetro é a meta e o preenchimento fica vermelho quando passa dela." />
      <TargetsEditor canEdit={s.edit}
        companies={o.companies.filter((c) => c.active).map((c) => [c.id, c.name])}
        groups={o.groups.map((g) => [g.id, g.name])}
        categories={o.categories.filter((c) => c.active).map((c) => [c.id, c.name])}
        indicators={all.inds.map((i) => ({ id: i.id, name: i.name, groupId: i.groupId ?? "", categoryIds: i.categoryIds, position: i.position, active: i.active }))}
        targets={all.targets.map((t) => ({ indicatorId: t.indicatorId, companyId: t.companyId, pct: Number(t.targetPct) }))} />
    </>
  );
}
