import { describe, expect, it } from "vitest";
import { buildDre, horizontal, lineTotal } from "../src/lib/dre";
import type { DreSection } from "../src/lib/consts";

// Plano no formato do cliente; valores de setembro do painel "Análise DRE" (um valor por grupo)
const G: [string, DreSection, number, boolean?][] = [
  ["Mensalidade", "RECEITA", 202091, true],
  ["Receita Bruta", "RECEITA", 109290.18],
  ["Despesas com Impostos e Taxas", "DEDUCAO", -32322.15],
  ["Despesas Variáveis", "VARIAVEL", -25702.67],
  ["Despesas com Logística", "VARIAVEL", -4895.48],
  ["Despesas com Marketing", "OPERACIONAL", -10041.78],
  ["Despesas Administrativas", "OPERACIONAL", -2752.8],
  ["Despesas Diversas", "OPERACIONAL", -23851.93],
  ["Despesas com Pessoal", "OPERACIONAL", -114625.95],
  ["Despesas com Ocupação", "OPERACIONAL", -35921.52],
  ["Despesa com TI e Telecomunicação", "OPERACIONAL", -1530.69],
  ["Investimento", "INVESTIMENTO", -62648.24],
];
const groups = G.map(([name, section, , isBase], i) => ({ id: `g${i}`, name, section, position: i, isBase: !!isBase }));
const categories = G.map((_, i) => ({ id: `c${i}`, name: `cat ${i}`, groupId: `g${i}` }));
const amounts = G.map(([, , v], i) => ({ categoryId: `c${i}`, period: "2026-09", value: v }));

describe("DRE gerencial", () => {
  const d = buildDre({ groups, categories, amounts, periods: ["2026-09"] });
  it("soma as seções e calcula os resultados em cascata", () => {
    expect(lineTotal(d, "RB")).toBe(311381.18);
    expect(lineTotal(d, "RL")).toBe(279059.03);
    expect(lineTotal(d, "MB")).toBe(248460.88);
    expect(lineTotal(d, "RO")).toBe(59736.21);
    expect(lineTotal(d, "RF")).toBe(-2912.03);
  });
  it("ordem das linhas igual à do painel", () => {
    expect(d.lines.filter((l) => l.kind !== "category").map((l) => l.label)).toEqual([
      "Receita Bruta", "Mensalidade", "Receita Bruta", "Despesas com Impostos e Taxas", "Receita Líquida", "Despesas Variáveis", "Despesas com Logística", "Margem Bruta",
      "Despesas com Marketing", "Despesas Administrativas", "Despesas Diversas", "Despesas com Pessoal", "Despesas com Ocupação", "Despesa com TI e Telecomunicação",
      "Resultado Operacional", "Investimento", "Resultado Final Gerencial",
    ]);
  });
  it("percentual sobre o faturamento de mensalidades (como no painel: Pessoal 56,72%, Impostos 15,99%)", () => {
    const pct = (name: string) => d.lines.find((l) => l.kind === "group" && l.label === name)!.pct[0]!;
    expect(pct("Despesas com Pessoal").toFixed(2)).toBe("56.72");
    expect(pct("Despesas com Impostos e Taxas").toFixed(2)).toBe("15.99");
    expect(pct("Despesas com Marketing").toFixed(2)).toBe("4.97");
  });
  it("base pela Receita Bruta quando configurado", () => {
    const r = buildDre({ groups, categories, amounts, periods: ["2026-09"], baseMode: "RECEITA_BRUTA" });
    expect(r.baseTotal).toBe(311381.18);
  });
  it("lançamento sem categoria não entra na DRE e é informado", () => {
    const r = buildDre({ groups, categories, amounts: [...amounts, { categoryId: null, period: "2026-09", value: -50 }], periods: ["2026-09"] });
    expect(lineTotal(r, "RF")).toBe(-2912.03);
    expect(r.uncategorized).toEqual([-50]);
  });
});

describe("% AH (análise horizontal)", () => {
  it("variação sobre o valor absoluto do período anterior (igual ao painel)", () => {
    // Despesas Variáveis: set −25.702,67 → out −15.772,04 = +39%
    expect(Math.round(horizontal(-15772.04, -25702.67)!)).toBe(39);
    // Impostos: −32.322,15 → −32.534,11 = −1%
    expect(Math.round(horizontal(-32534.11, -32322.15)!)).toBe(-1);
    expect(horizontal(10, 0)).toBeNull();
  });
  it("entre meses da própria DRE e contra o mês anterior ao período", () => {
    const am = [{ categoryId: "c8", period: "2026-09", value: -100 }, { categoryId: "c8", period: "2026-10", value: -80 }];
    const r = buildDre({ groups, categories, amounts: am, periods: ["2026-09", "2026-10"], previous: [{ categoryId: "c8", period: "2026-08", value: -200 }] });
    const l = r.lines.find((x) => x.key === "g:g8")!;
    expect(l.ah).toEqual([50, 20]);
  });
});
