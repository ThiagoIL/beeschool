// Sem "server-only" e sem next/headers: usado também pelo middleware (runtime Node.js).
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { sessions, systemSettings, users, type System, type User } from "@/db/schema";
import { accessProfiles } from "@/db/erp";
import { licenseBlock } from "./license";
import { computeAccess, type Access } from "./modules";
import { hmacToken } from "./token";

/** CONSOLE = console do fornecedor; APP = sistema da escola. */
export type Area = "CONSOLE" | "APP";
/** "__Host-": só por HTTPS, sem Domain, no caminho "/" — o cookie da escola. */
export const APP_COOKIE = env.cookieSecure ? "__Host-bee_sess" : "bee_sess";
/** O cookie do console só é enviado ao caminho do console (Path = PLATFORM_ADMIN_PATH). */
export const CONSOLE_COOKIE = env.cookieSecure ? "__Secure-bee_console" : "bee_console";
export const cookieOf = (area: Area) => (area === "CONSOLE" ? CONSOLE_COOKIE : APP_COOKIE);
/**
 * Hash dos tokens de sessão e dos links de senha: HMAC-SHA256 com o AUTH_SECRET. O banco guarda só o hash;
 * trocar o AUTH_SECRET invalida na hora todas as sessões abertas e todos os links de senha pendentes.
 */
export const hashToken = (v: string) => hmacToken(env.AUTH_SECRET, v);

export type SessionCtx = { sessionId: string; user: User };

/** Data de hoje (AAAA-MM-DD) no fuso da aplicação. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Configuração do fornecedor (linha única). Cria a linha padrão se ainda não existir. */
export async function getSystem(): Promise<System> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.id, "main")).limit(1);
  if (row) return row;
  await db.insert(systemSettings).values({ id: "main" }).onConflictDoNothing();
  const [created] = await db.select().from(systemSettings).where(eq(systemSettings.id, "main")).limit(1);
  return created;
}

export const systemBlocked = (t: System) => licenseBlock({ status: t.status, paidUntil: t.paidUntil, graceDays: t.graceDays }, todayIso());

/**
 * Valida o token de sessão para a área atual. Uma sessão da escola nunca vale no console (e vice-versa).
 * Sistema suspenso ou com licença vencida invalida as sessões da escola na hora.
 */
export async function sessionFromToken(token: string | undefined, area: Area): Promise<SessionCtx | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await db.select({ s: sessions, u: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token))).limit(1);
  const r = rows[0];
  if (!r) return null;
  const now = Date.now();
  const valid =
    r.s.area === area &&
    r.s.expiresAt.getTime() > now &&
    now - r.s.lastSeenAt.getTime() < env.SESSION_IDLE_MINUTES * 60_000 &&
    r.u.status === "ACTIVE" &&
    // sessões abertas antes da última troca de senha deixam de valer
    r.s.createdAt.getTime() >= r.u.passwordChangedAt.getTime() - 1000 &&
    (area === "CONSOLE" ? r.u.role === "SUPER_ADMIN" : r.u.role !== "SUPER_ADMIN" && !systemBlocked(await getSystem()));
  if (!valid) return null;
  if (now - r.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: sql`now()` }).where(eq(sessions.id, r.s.id));
  }
  return { sessionId: r.s.id, user: r.u };
}

/** Acesso do usuário aos módulos (módulos liberados pelo fornecedor × papel × perfil). */
export async function loadAccess(user: User, sys: System): Promise<Access> {
  const isAdmin = user.role === "ADMIN";
  let profile: { name: string; permissions: Record<string, unknown> } | null = null;
  if (!isAdmin && user.profileId) {
    const [p] = await db.select().from(accessProfiles).where(eq(accessProfiles.id, user.profileId)).limit(1);
    if (p) profile = { name: p.name, permissions: p.permissions };
  }
  return computeAccess({ isAdmin, enabled: sys.modules, profile });
}
