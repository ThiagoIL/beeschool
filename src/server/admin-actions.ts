"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessions, systemSettings, users } from "@/db/schema";
import { adminForAction, consoleExpired, getSystem, requestArea, SESSION_EXPIRED, userForAction } from "@/lib/context";
import { audit } from "@/lib/audit";
import { friendlyDbError } from "@/lib/errors";
import { formObject, keepValues, zName, zodFail } from "@/lib/forms";
import type { ActionState } from "@/lib/action";
import { BIZ_MODULES } from "@/lib/modules";
import { isDate } from "@/lib/dates";

/** Campo de limite do plano: vazio = sem limite. */
const zLimit = z.string().trim().max(6).optional().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100000) { ctx.addIssue({ code: "custom", message: "Use um número inteiro a partir de 1, ou deixe vazio para não limitar." }); return z.NEVER; }
  return n;
});

const editSystem = z.object({
  nome: zName,
  situacao: z.enum(["ACTIVE", "SUSPENDED"]),
  mensagem: z.string().trim().max(500).optional(),
  pago_ate: z.string().trim().max(10).optional().refine((v) => !v || isDate(v), "Data inválida."),
  tolerancia: z.coerce.number().int().min(0, "De 0 a 90 dias.").max(90, "De 0 a 90 dias.").default(5),
  observacoes: z.string().trim().max(1000).optional(),
  max_usuarios: zLimit,
  max_simultaneos: zLimit,
});

/** Console: licença, bloqueio, módulos liberados e limites do plano da escola. */
export async function updateSystemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await adminForAction();
  if (!s) return consoleExpired();
  const raw = formObject(fd);
  const p = editSystem.safeParse(raw);
  if (!p.success) return zodFail(p.error, raw);
  const before = await getSystem();
  const modules = BIZ_MODULES.filter((m) => fd.get(`mod_${m}`) === "on");
  try {
    await db.update(systemSettings).set({ name: p.data.nome, status: p.data.situacao, notes: p.data.observacoes || null,
      blockMessage: p.data.mensagem || null, paidUntil: p.data.pago_ate || null, graceDays: p.data.tolerancia, modules,
      maxUsers: p.data.max_usuarios, maxSessions: p.data.max_simultaneos })
      .where(eq(systemSettings.id, "main"));
  } catch (err) {
    return { error: friendlyDbError(err), values: keepValues(raw) };
  }
  const suspendeu = p.data.situacao === "SUSPENDED" && before.status !== "SUSPENDED";
  if (suspendeu) await db.delete(sessions).where(eq(sessions.area, "APP"));
  await audit({ action: suspendeu ? "sistema.bloqueado" : before.status === "SUSPENDED" && p.data.situacao === "ACTIVE" ? "sistema.liberado" : "sistema.alterado", userId: s.user.id, userEmail: s.user.email, entity: "sistema",
    data: { situacao: { antes: before.status, depois: p.data.situacao }, nome: p.data.nome, licenca: { antes: before.paidUntil, depois: p.data.pago_ate || null }, modulos: { antes: before.modules, depois: modules },
      plano: { usuarios: { antes: before.maxUsers, depois: p.data.max_usuarios }, simultaneos: { antes: before.maxSessions, depois: p.data.max_simultaneos } } } });
  return { ok: true, message: suspendeu ? "Sistema bloqueado. Todos os usuários da escola foram desconectados e veem a tela de acesso suspenso." : "Alterações salvas." };
}

/** Desconecta uma sessão da escola (console ou administrador da escola). */
export async function disconnectSessionAction(sessionId: string): Promise<ActionState> {
  const console = (await requestArea()).area === "console";
  const by = console ? await adminForAction() : await userForAction({ admin: true });
  if (!by) return console ? consoleExpired() : SESSION_EXPIRED;
  const [row] = await db.select({ s: sessions, email: users.email }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, String(sessionId).slice(0, 64))).limit(1);
  if (!row || row.s.area !== "APP") return { error: "Sessão não encontrada." };
  if (row.s.id === by.sessionId) return { error: "Esta é a sua própria sessão. Use Sair." };
  await db.delete(sessions).where(eq(sessions.id, row.s.id));
  await audit({ action: "sessao.desconectada", userId: by.user.id, userEmail: by.user.email, entity: "usuario", entityId: row.s.userId, data: { usuario: row.email } });
  return { ok: true, message: `${row.email} foi desconectado.` };
}
