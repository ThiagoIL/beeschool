/**
 * DRE gerencial (regra pura, testada) — mesma lógica das planilhas e do painel "Análise DRE" do cliente.
 *
 *  - Cada lançamento realizado entra com sinal (entrada +, saída −) na categoria; a categoria soma no grupo.
 *  - Linhas calculadas: Receita Bruta (grupos RECEITA) → Receita Líquida (+ DEDUCAO) → Margem Bruta (+ VARIAVEL)
 *    → Resultado Operacional (+ OPERACIONAL) → Resultado Final Gerencial (+ INVESTIMENTO).
 *  - % AH (análise horizontal) = variação sobre o período anterior: (atual − anterior) / |anterior|.
 *  - % = participação sobre o faturamento (base: grupos marcados como base — Mensalidade — ou a Receita Bruta).
 *    Para despesas o percentual é positivo quando é gasto (−valor / base).
 */
import type { DreSection } from "./consts";

export type DreGroupIn = { id: string; name: string; section: DreSection; position: number; isBase: boolean };
export type DreCatIn = { id: string; name: string; groupId: string };
export type DreAmount = { categoryId: string | null; period: string; value: number };

export type DreLine = {
  key: string;
  kind: "total" | "group" | "category";
  label: string;
  section?: DreSection;
  parent?: string;
  values: number[]; // por período
  total: number;
  ah: (number | null)[]; // % AH por período (o primeiro compara com `previous`)
  pct: (number | null)[]; // % sobre a base, por período
  pctTotal: number | null;
};

export type DreResult = { periods: string[]; lines: DreLine[]; base: number[]; baseTotal: number; uncategorized: number[] };

const ORDER: DreSection[] = ["RECEITA", "DEDUCAO", "VARIAVEL", "OPERACIONAL", "INVESTIMENTO"];
const TOTAL_AFTER: Record<DreSection, { key: string; label: string } | null> = {
  RECEITA: null,
  DEDUCAO: { key: "RL", label: "Receita Líquida" },
  VARIAVEL: { key: "MB", label: "Margem Bruta" },
  OPERACIONAL: { key: "RO", label: "Resultado Operacional" },
  INVESTIMENTO: { key: "RF", label: "Resultado Final Gerencial" },
};

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function horizontal(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export function buildDre(input: {
  groups: DreGroupIn[]; categories: DreCatIn[]; amounts: DreAmount[]; periods: string[];
  /** valores do período anterior ao primeiro (para o % AH do primeiro período), por chave de linha */
  previous?: DreAmount[]; baseMode?: "MENSALIDADE" | "RECEITA_BRUTA";
}): DreResult {
  const { groups, categories, periods } = input;
  const n = periods.length;
  const pIdx = new Map(periods.map((p, i) => [p, i]));
  const catGroup = new Map(categories.map((c) => [c.id, c.groupId]));

  const zero = () => Array<number>(n).fill(0);
  const byCat = new Map<string, number[]>();
  const uncategorized = zero();
  for (const a of input.amounts) {
    const i = pIdx.get(a.period);
    if (i == null) continue;
    if (!a.categoryId || !catGroup.has(a.categoryId)) { uncategorized[i] += a.value; continue; }
    const arr = byCat.get(a.categoryId) ?? zero();
    arr[i] += a.value;
    byCat.set(a.categoryId, arr);
  }
  // valores do período anterior, por categoria (um único número)
  const prevCat = new Map<string, number>();
  for (const a of input.previous ?? []) if (a.categoryId && catGroup.has(a.categoryId)) prevCat.set(a.categoryId, (prevCat.get(a.categoryId) ?? 0) + a.value);

  const sumArr = (xs: number[][]) => xs.reduce((acc, x) => acc.map((v, i) => v + x[i]), zero());
  const groupVals = new Map<string, number[]>();
  const groupPrev = new Map<string, number>();
  for (const g of groups) {
    const cats = categories.filter((c) => c.groupId === g.id);
    groupVals.set(g.id, sumArr(cats.map((c) => byCat.get(c.id) ?? zero())));
    groupPrev.set(g.id, cats.reduce((t, c) => t + (prevCat.get(c.id) ?? 0), 0));
  }
  const secGroups = (s: DreSection) => groups.filter((g) => g.section === s).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));
  const secVals = (s: DreSection) => sumArr(secGroups(s).map((g) => groupVals.get(g.id)!));
  const secPrev = (s: DreSection) => secGroups(s).reduce((t, g) => t + (groupPrev.get(g.id) ?? 0), 0);

  const receita = secVals("RECEITA");
  const baseGroups = groups.filter((g) => g.isBase);
  const base = input.baseMode === "RECEITA_BRUTA" || !baseGroups.length ? receita : sumArr(baseGroups.map((g) => groupVals.get(g.id)!));
  const baseTotal = base.reduce((a, b) => a + b, 0);

  const lines: DreLine[] = [];
  const mk = (key: string, kind: DreLine["kind"], label: string, values: number[], prev: number | null, sign: 1 | -1, extra: Partial<DreLine> = {}): DreLine => {
    const total = values.reduce((a, b) => a + b, 0);
    return {
      key, kind, label, values: values.map(r2), total: r2(total),
      ah: values.map((v, i) => horizontal(v, i === 0 ? prev : values[i - 1])),
      pct: values.map((v, i) => (base[i] ? ((sign * v) / base[i]) * 100 : null)),
      pctTotal: baseTotal ? ((sign * total) / baseTotal) * 100 : null,
      ...extra,
    };
  };
  const pushGroup = (g: DreGroupIn, parent?: string) => {
    const sign = g.section === "RECEITA" ? 1 : -1;
    lines.push(mk(`g:${g.id}`, "group", g.name, groupVals.get(g.id)!, groupPrev.get(g.id) ?? null, sign, { section: g.section, parent }));
    for (const c of categories.filter((x) => x.groupId === g.id).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) {
      const v = byCat.get(c.id);
      if (!v || v.every((x) => x === 0)) continue;
      lines.push(mk(`c:${c.id}`, "category", c.name, v, prevCat.get(c.id) ?? null, sign, { section: g.section, parent: `g:${g.id}` }));
    }
  };

  let running = zero();
  let runningPrev = 0;
  for (const s of ORDER) {
    const vals = secVals(s);
    running = running.map((v, i) => v + vals[i]);
    runningPrev += secPrev(s);
    if (s === "RECEITA") {
      lines.push(mk("RB", "total", "Receita Bruta", receita, secPrev("RECEITA"), 1, { section: "RECEITA" }));
      for (const g of secGroups(s)) pushGroup(g, "RB");
      continue;
    }
    for (const g of secGroups(s)) pushGroup(g);
    const t = TOTAL_AFTER[s]!;
    lines.push(mk(t.key, "total", t.label, running, runningPrev, 1, { section: s }));
  }
  return { periods, lines, base: base.map(r2), baseTotal: r2(baseTotal), uncategorized: uncategorized.map(r2) };
}

/** Valor de uma linha calculada (RB, RL, MB, RO, RF) somando todos os períodos. */
export const lineTotal = (d: DreResult, key: string) => d.lines.find((l) => l.key === key)?.total ?? 0;
