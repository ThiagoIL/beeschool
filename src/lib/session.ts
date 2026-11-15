import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { sessions, type User } from "@/db/schema";
import { clientIp, userAgent } from "./request";
import { COOKIE, sessionFromToken, sha256, type Area, type SessionCtx } from "./session-core";

export type { Area, SessionCtx };

/** Abre a sessão: token aleatório de 256 bits no cookie; no banco fica só o SHA-256. */
export async function createSession(user: User, area: Area): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_HOURS * 3600_000);
  await db.insert(sessions).values({
    tokenHash: sha256(token), userId: user.id, tenantId: user.tenantId, area,
    ip: await clientIp(), userAgent: await userAgent(), expiresAt,
  });
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, new Date())));
  // "__Host-": o navegador só aceita o cookie seguro, sem Domain, preso a este subdomínio exato
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: env.cookieSecure, sameSite: "lax", path: "/", expires: expiresAt });
}

export async function readSession(area: Area, tenantId: string | null): Promise<SessionCtx | null> {
  return sessionFromToken((await cookies()).get(COOKIE)?.value, area, tenantId);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(COOKIE);
}

/** Encerra todas as sessões do usuário (troca de senha, desativação, redefinição, mudança de nível). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Sessões ativas do próprio usuário (Minha conta). */
export async function userSessions(userId: string) {
  return db.select().from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`), gt(sessions.lastSeenAt, sql`now() - make_interval(mins => ${env.SESSION_IDLE_MINUTES})`)))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeOwnSession(userId: string, sessionId: string): Promise<boolean> {
  const r = await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId))).returning({ id: sessions.id });
  return r.length > 0;
}

export async function revokeOtherSessions(userId: string, keepId: string): Promise<number> {
  const r = await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepId))).returning({ id: sessions.id });
  return r.length;
}
