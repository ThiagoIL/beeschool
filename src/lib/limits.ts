import "server-only";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { sessions, users } from "@/db/schema";
import { getSystem } from "./session-core";

/**
 * Limites do plano (definidos no console do fornecedor):
 *  - usuários cadastrados: quantos usuários ativos a escola pode ter;
 *  - usuários simultâneos: quantas pessoas diferentes podem estar conectadas ao mesmo tempo.
 * Conectado = sessão da escola ainda válida e usada dentro do tempo de inatividade (SESSION_IDLE_MINUTES).
 */
const liveSession = () => and(eq(sessions.area, "APP"), gt(sessions.expiresAt, sql`now()`),
  gt(sessions.lastSeenAt, sql`now() - make_interval(mins => ${env.SESSION_IDLE_MINUTES})`));

export async function activeUsers(): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(ne(users.role, "SUPER_ADMIN"), eq(users.status, "ACTIVE")));
  return n;
}

/** Pessoas conectadas agora (cada pessoa conta uma vez, mesmo em vários aparelhos). */
export async function onlineUserIds(): Promise<string[]> {
  const rows = await db.selectDistinct({ id: sessions.userId }).from(sessions).where(liveSession());
  return rows.map((r) => r.id);
}

export type Online = { sessionId: string; userId: string; name: string; email: string; since: Date; lastSeen: Date; ip: string | null; device: string | null };
export async function onlineSessions(): Promise<Online[]> {
  const rows = await db.select({ s: sessions, u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(liveSession()).orderBy(sql`${sessions.lastSeenAt} desc`);
  return rows.map(({ s, u }) => ({ sessionId: s.id, userId: u.id, name: u.name, email: u.email, since: s.createdAt, lastSeen: s.lastSeenAt, ip: s.ip, device: deviceOf(s.userAgent) }));
}

const deviceOf = (ua: string | null) => {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || null;
};

export type Usage = { maxUsers: number | null; maxSessions: number | null; users: number; online: number };
export async function usageOf(): Promise<Usage> {
  const t = await getSystem();
  return { maxUsers: t.maxUsers, maxSessions: t.maxSessions, users: await activeUsers(), online: (await onlineUserIds()).length };
}

/** Mensagem de erro se cadastrar (ou reativar) mais um usuário passar do limite do plano. */
export async function userLimitError(): Promise<string | null> {
  const { maxUsers: mu } = await getSystem();
  if (mu == null) return null;
  const n = await activeUsers();
  return n >= mu ? `O plano permite ${mu} ${mu === 1 ? "usuário ativo" : "usuários ativos"} e já há ${n}. Inative um usuário ou fale com o fornecedor para aumentar.` : null;
}

/** Mensagem de erro se esta pessoa entrar e passar do limite de conectados ao mesmo tempo. */
export async function sessionLimitError(userId: string): Promise<string | null> {
  const { maxSessions: ms } = await getSystem();
  if (ms == null) return null;
  const ids = await onlineUserIds();
  if (ids.includes(userId) || ids.length < ms) return null; // quem já está conectado (outro aparelho) não ocupa outra vaga
  return `Limite de ${ms} ${ms === 1 ? "pessoa conectada" : "pessoas conectadas"} ao mesmo tempo atingido. Peça para alguém sair do sistema ou aguarde e tente de novo.`;
}
