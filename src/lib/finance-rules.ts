/** Regras puras do financeiro (servidor e navegador), cobertas por testes. */

/** Chave para comparar nomes sem acento, caixa ou espaços extras ("MATRÍCULA " = "matricula"). */
export const normKey = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Valor da mensalidade: cheia − desconto, nunca negativo, em reais com 2 casas. */
export function tuitionValue(fee: string | number, discount: string | number): number {
  return Math.max(0, cents(fee) - cents(discount)) / 100;
}

/** Vencimento da mensalidade na competência (AAAA-MM) no dia escolhido (1 a 28). */
export function tuitionDue(competence: string, dueDay: number): string {
  const d = Math.min(28, Math.max(1, Math.trunc(dueDay) || 10));
  return `${competence}-${String(d).padStart(2, "0")}`;
}

/**
 * Valor em formato brasileiro das planilhas: "R$ 1.727,00", "1727,5", "-R$ 426,80", "17 219,23".
 * Devolve 0 para vazio e NaN para texto inválido.
 */
export function parseBrMoney(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  let s = String(raw ?? "").trim();
  if (!s || s === "-") return 0;
  const neg = /^-|^\(.*\)$|-$/.test(s.replace(/\s/g, ""));
  s = s.replace(/R\$|\s| |\(|\)|-/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

/** Data das planilhas: "03/11/2026", "3/11/26", "2026-11-03" ou número serial do Excel. Devolve AAAA-MM-DD ou null. */
export function parseBrDate(raw: unknown): string | null {
  if (typeof raw === "string" && /^\d{5}(\.\d+)?$/.test(raw.trim())) raw = Number(raw.trim());
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return valid(y, +m[2], +m[1]); }
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/**
 * Lê as linhas de uma planilha de fluxo de caixa no layout do cliente
 * (Data | Descrição | Entrada | Saída | Classificação | Nota). A primeira linha com "Data" é o cabeçalho;
 * as colunas são achadas pelo nome. Linhas sem data ou sem valor são ignoradas e contadas.
 */
export type SheetRow = { date: string; category: string; inValue: number; outValue: number; detail: string; nota: string };
export function rowsFromSheet(grid: unknown[][]): { rows: SheetRow[]; skipped: number; error?: string } {
  const hi = grid.findIndex((r) => r.some((c) => normKey(String(c ?? "")) === "data"));
  if (hi < 0) return { rows: [], skipped: 0, error: "Não achei o cabeçalho (coluna “Data”)." };
  const h = grid[hi].map((c) => normKey(String(c ?? "")));
  const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const cD = col("data"), cDesc = col("descricao", "categoria"), cIn = col("entrada", "entradas"), cOut = col("saida", "saidas");
  const cCls = col("classificacao", "historico", "detalhe"), cNota = col("nota", "nf");
  if (cDesc < 0 || cIn < 0 || cOut < 0) return { rows: [], skipped: 0, error: "A planilha precisa das colunas Data, Descrição, Entrada e Saída." };
  const rows: SheetRow[] = [];
  let skipped = 0;
  for (const r of grid.slice(hi + 1)) {
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
    const date = parseBrDate(r[cD]);
    const a = parseBrMoney(r[cIn]), b = parseBrMoney(r[cOut]);
    if (!date || Number.isNaN(a) || Number.isNaN(b) || (a === 0 && b === 0)) { skipped++; continue; }
    // valor negativo na coluna de entrada é saída (e vice-versa)
    const inValue = (a > 0 ? a : 0) + (b < 0 ? -b : 0);
    const outValue = (b > 0 ? b : 0) + (a < 0 ? -a : 0);
    rows.push({ date, category: String(r[cDesc] ?? "").trim(), inValue: Math.round(inValue * 100) / 100, outValue: Math.round(outValue * 100) / 100,
      detail: cCls >= 0 ? String(r[cCls] ?? "").trim() : "", nota: cNota >= 0 ? String(r[cNota] ?? "").trim() : "" });
  }
  return { rows, skipped };
}
