/**
 * Licença do cliente (regra pura, testada). O acesso fica bloqueado quando:
 *  - o fornecedor suspendeu o cliente no console; ou
 *  - a licença venceu (paid_until) e passaram os dias de tolerância (grace_days).
 * Vale na hora: toda requisição confere o cliente no banco.
 */
export type LicenseInfo = { status: "ACTIVE" | "SUSPENDED"; paidUntil: string | null; graceDays: number };
export type Block = { reason: "SUSPENDED" | "OVERDUE"; since: string | null } | null;

const addDays = (iso: string, n: number) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function licenseBlock(t: LicenseInfo, today: string): Block {
  if (t.status === "SUSPENDED") return { reason: "SUSPENDED", since: null };
  if (t.paidUntil) {
    const limit = addDays(t.paidUntil, Math.max(0, t.graceDays));
    if (today > limit) return { reason: "OVERDUE", since: addDays(limit, 1) };
  }
  return null;
}

/** Dias até o bloqueio automático (para avisar o cliente). Nulo = sem vencimento. */
export function daysToBlock(t: LicenseInfo, today: string): number | null {
  if (!t.paidUntil || t.status !== "ACTIVE") return null;
  const limit = addDays(t.paidUntil, Math.max(0, t.graceDays));
  return Math.round((Date.parse(limit) - Date.parse(today)) / 864e5);
}
