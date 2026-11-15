import { describe, expect, it } from "vitest";
import { normKey, parseBrDate, parseBrMoney, rowsFromSheet, tuitionDue, tuitionValue } from "../src/lib/finance-rules";

describe("valores e datas das planilhas", () => {
  it("dinheiro no formato brasileiro", () => {
    expect(parseBrMoney("R$ 1.727,00")).toBe(1727);
    expect(parseBrMoney("R$ 17 219,23")).toBe(17219.23);
    expect(parseBrMoney("-R$ 426,80")).toBe(-426.8);
    expect(parseBrMoney("382,93")).toBe(382.93);
    expect(parseBrMoney("1.000")).toBe(1000);
    expect(parseBrMoney("")).toBe(0);
    expect(Number.isNaN(parseBrMoney("abc"))).toBe(true);
  });
  it("datas dd/mm/aaaa, ISO e número do Excel", () => {
    expect(parseBrDate("03/11/2026")).toBe("2026-11-03");
    expect(parseBrDate("3/11/26")).toBe("2026-11-03");
    expect(parseBrDate("2026-11-03")).toBe("2026-11-03");
    expect(parseBrDate("46329")).toBe("2026-11-03");
    expect(parseBrDate("31/02/2026")).toBeNull();
  });
  it("compara nomes sem acento e caixa", () => expect(normKey("  MATRÍCULA ")).toBe(normKey("matricula")));
});

describe("mensalidades", () => {
  it("valor líquido em centavos, nunca negativo", () => {
    expect(tuitionValue("1200.10", "200.05")).toBe(1000.05);
    expect(tuitionValue(100, 150)).toBe(0);
  });
  it("vencimento no dia do aluno (1 a 28)", () => {
    expect(tuitionDue("2026-12", 10)).toBe("2026-12-10");
    expect(tuitionDue("2026-02", 31)).toBe("2026-02-28");
  });
});

describe("leitura da planilha de fluxo de caixa", () => {
  const grid = [
    ["", "", "", "", "", "", "", "Entradas", "R$ 19 050,72"],
    ["Data", "Descrição", "Entrada", "Saída", "CLASSIFICAÇÃO", "NOTA"],
    ["03/11/2026", "RECEBIMENTO COM EVENTOS", "R$ 100,00", "", "MURILO GOMES - RITO PASSAGEM", ""],
    ["04/11/2026", "APLICAÇÃO FINANCEIRA", "", "R$ 17 219,23", "APLICAÇÃO FINANCEIRA", ""],
    ["04/11/2026", "DESPESAS DIVERSAS", "", "R$ 426,80", "ARCOIRIS - PAPELARIA", "C/NF"],
    ["05/11/2026", "MATRICULA", "", "R$ 881,25", "CANCELAMENTO DE MATRICULA", "S/NF"],
    ["06/11/2026", "", "R$ 400,26", "", "RECEBIMENTO MATRICULA PROESC", ""],
    ["", "Total", "", "", "", ""],
  ];
  it("acha o cabeçalho e lê as colunas pelo nome", () => {
    const r = rowsFromSheet(grid);
    expect(r.error).toBeUndefined();
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0]).toEqual({ date: "2026-11-03", category: "RECEBIMENTO COM EVENTOS", inValue: 100, outValue: 0, detail: "MURILO GOMES - RITO PASSAGEM", nota: "" });
    expect(r.rows[1].outValue).toBe(17219.23);
    expect(r.rows[2].nota).toBe("C/NF");
    expect(r.skipped).toBe(1);
  });
  it("valor negativo na entrada vira saída", () => {
    const r = rowsFromSheet([["Data", "Descrição", "Entrada", "Saída"], ["01/11/2026", "X", "-50", ""]]);
    expect(r.rows[0]).toMatchObject({ inValue: 0, outValue: 50 });
  });
  it("avisa quando faltam colunas", () => expect(rowsFromSheet([["Data", "Valor"]]).error).toBeTruthy());
});
