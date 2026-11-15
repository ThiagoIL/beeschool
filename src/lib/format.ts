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
const scheme = () => {
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
  return secure ? "https" : "http";
};
export function tenantUrl(slug: string): string {
  return `${scheme()}://${slug}.${process.env.ROOT_DOMAIN ?? ""}`;
}
export function adminUrl(): string {
  return `${scheme()}://${process.env.ADMIN_SUBDOMAIN ?? "admin"}.${process.env.ROOT_DOMAIN ?? ""}`;
}
