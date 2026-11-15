// Sem "server-only" e sem next/headers: usado também pelo middleware (runtime Node.js).
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, withTenant } from "./db";
import { env } from "./env";
import { sessions, tenants, users, type Tenant, type User } from "@/db/schema";
import { accessProfiles } from "@/db/erp";
import { licenseBlock } from "./license";
import { computeAccess, type Access } from "./modules";

export type Area = "ADMIN" | "TENANT";
export const COOKIE = env.cookieSecure ? "__Host-bee_sess" : "bee_sess";
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type SessionCtx = { sessionId: string; user: User; tenant: Tenant | null };

/** Data de hoje (AAAA-MM-DD) no fuso da aplicação. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const tenantBlocked = (t: Tenant) => licenseBlock({ status: t.status, paidUntil: t.paidUntil, graceDays: t.graceDays }, todayIso());

/**
 * Valida o token de sessão para a área e o cliente atuais. Uma sessão aberta num cliente nunca vale
 * no console do fornecedor (e vice-versa). Cliente suspenso ou com licença vencida invalida a sessão na hora.
 */
export async function sessionFromToken(token: string | undefined, area: Area, tenantId: string | null): Promise<SessionCtx | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await db.select({ s: sessions, u: users, t: tenants }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(sessions.tokenHash, sha256(token))).limit(1);
  const r = rows[0];
  if (!r) return null;
  const now = Date.now();
  const valid =
    r.s.area === area &&
    r.s.expiresAt.getTime() > now &&
    now - r.s.lastSeenAt.getTime() < env.SESSION_IDLE_MINUTES * 60_000 &&
    r.u.status === "ACTIVE" &&
    (r.s.tenantId ?? null) === (tenantId ?? null) &&
    (r.u.tenantId ?? null) === (tenantId ?? null) &&
    // sessões abertas antes da última troca de senha deixam de valer
    r.s.createdAt.getTime() >= r.u.passwordChangedAt.getTime() - 1000 &&
    (area === "ADMIN" ? r.u.role === "SUPER_ADMIN" : r.u.role !== "SUPER_ADMIN" && !!r.t && !tenantBlocked(r.t));
  if (!valid) return null;
  if (now - r.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: sql`now()` }).where(eq(sessions.id, r.s.id));
  }
  return { sessionId: r.s.id, user: r.u, tenant: r.t };
}

/** Acesso do usuário aos módulos (módulos liberados ao cliente × papel × perfil). */
export async function loadAccess(user: User, tenant: Tenant): Promise<Access> {
  const isAdmin = user.role === "TENANT_ADMIN";
  let profile: { name: string; permissions: Record<string, unknown> } | null = null;
  if (!isAdmin && user.profileId) {
    const [p] = await withTenant(tenant.id, (tx) => tx.select().from(accessProfiles).where(eq(accessProfiles.id, user.profileId!)).limit(1));
    if (p) profile = { name: p.name, permissions: p.permissions };
  }
  return computeAccess({ isAdmin, enabled: tenant.modules, profile });
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return t ?? null;
}
