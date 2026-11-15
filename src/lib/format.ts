const TZ = process.env.APP_TIMEZONE ?? "America/Sao_Paulo";

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(d);
}
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: TZ }).format(d);
}
export function fmtMoney(v: string | number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));
}
export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
/** Valor numérico para preencher um campo de formulário no padrão brasileiro. */
export function toInput(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return n ? String(n).replace(".", ",") : "";
}
