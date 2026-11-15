"use server";
/**
 * Gestão de usuários, usada pelo console do fornecedor (administradores do console e usuários da escola)
 * e pela escola (administrador da escola). As regras estão em src/lib/rules.ts e as críticas também são
 * garantidas pelo banco. Contas do console (SUPER_ADMIN) e da escola nunca se misturam.
 */
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accessProfiles } from "@/db/erp";
import { users, type User } from "@/db/schema";
import { SESSION_EXPIRED, adminForAction, consoleExpired, requestArea, toActor, userForAction } from "@/lib/context";
import { canChangeRole, canChangeStatus, canDelete, canManage, canResetPassword, type Actor, type Target } from "@/lib/rules";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { revokeUserSessions } from "@/lib/session";
import { audit } from "@/lib/audit";
import { userLimitError } from "@/lib/limits";
import { friendlyDbError } from "@/lib/errors";
import { formObject, keepValues, zEmail, zName, zodFail } from "@/lib/forms";
import { consoleBase } from "@/lib/console-path";
import type { ActionState } from "@/lib/action";

/** Quem está agindo, conforme a área acessada (console ou escola). */
async function actorCtx(): Promise<{ actor: Actor; email: string; console: boolean } | null> {
  if ((await requestArea()).area === "console") {
    const s = await adminForAction();
    return s && { actor: toActor(s), email: s.user.email, console: true };
  }
  const s = await userForAction({ admin: true });
  return s && { actor: toActor(s), email: s.user.email, console: false };
}
const expired = async () => ((await requestArea()).area === "console" ? consoleExpired() : SESSION_EXPIRED);

const toTarget = (u: User): Target => ({ id: u.id, role: u.role, isMaster: u.isMaster, status: u.status });

async function loadTarget(id: string, actor: Actor): Promise<User | null> {
  if (!id || id.length > 64) return null;
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) return null;
  return canManage(actor, toTarget(u)).ok ? u : null;
}

// ---------- criar ----------
const createSchema = z.object({
  nome: zName,
  email: zEmail,
  papel: z.enum(["ADMIN", "USER", "SUPER_ADMIN"]),
});

export async function createUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await actorCtx();
  if (!ctx) return expired();
  const raw = formObject(fd);
  const p = createSchema.safeParse(raw);
  if (!p.success) return zodFail(p.error, raw);
  const { nome, email, papel } = p.data;
  const consoleUser = papel === "SUPER_ADMIN";
  if (consoleUser && !ctx.console) return { error: "Nível de acesso não permitido.", values: keepValues(raw) };

  // limite do plano: usuários ativos cadastrados na escola
  if (!consoleUser) {
    const full = await userLimitError();
    if (full) return { error: full, values: keepValues(raw) };
  }

  const dup = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, email), consoleUser ? eq(users.role, "SUPER_ADMIN") : ne(users.role, "SUPER_ADMIN"))).limit(1);
  if (dup.length) return { fields: { email: "Já existe um usuário com este e-mail." }, error: "Confira os campos destacados.", values: keepValues(raw) };

  const temp = generateTempPassword();
  try {
    let profileId: string | null = null;
    const perfil = typeof raw.perfil === "string" ? raw.perfil.slice(0, 64) : "";
    if (perfil && papel === "USER") {
      const [pr] = await db.select({ id: accessProfiles.id }).from(accessProfiles).where(eq(accessProfiles.id, perfil)).limit(1);
      profileId = pr?.id ?? null;
    }
    const [u] = await db.insert(users).values({
      name: nome, email, role: papel, passwordHash: await hashPassword(temp), mustChangePassword: true, profileId,
    }).returning({ id: users.id });
    await audit({ action: "usuario.criado", userId: ctx.actor.id, userEmail: ctx.email, entity: "usuario", entityId: u.id, data: { email, papel } });
  } catch (err) {
    return { error: friendlyDbError(err), values: keepValues(raw) };
  }
  return { ok: true, message: `Usuário ${email} criado.`, secret: temp, values: {} };
}

// ---------- editar nome, nível e situação ----------
const updateSchema = z.object({
  id: z.string().min(1).max(64),
  nome: zName,
  papel: z.enum(["ADMIN", "USER", "SUPER_ADMIN"]),
  situacao: z.enum(["ACTIVE", "INACTIVE"]),
});

export async function updateUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await actorCtx();
  if (!ctx) return expired();
  const raw = formObject(fd);
  const p = updateSchema.safeParse(raw);
  if (!p.success) return zodFail(p.error, raw);
  const target = await loadTarget(p.data.id, ctx.actor);
  if (!target) return { error: "Usuário não encontrado." };
  const t = toTarget(target);

  const r1 = canChangeRole(ctx.actor, t, p.data.papel);
  if (!r1.ok) return { error: r1.reason, values: keepValues(raw) };
  const r2 = canChangeStatus(ctx.actor, t, p.data.situacao);
  if (!r2.ok) return { error: r2.reason, values: keepValues(raw) };

  // reativar um usuário da escola ocupa de novo uma vaga do plano
  if (target.role !== "SUPER_ADMIN" && target.status !== "ACTIVE" && p.data.situacao === "ACTIVE") {
    const full = await userLimitError();
    if (full) return { error: full, values: keepValues(raw) };
  }
  try {
    await db.update(users).set({ name: p.data.nome, role: p.data.papel, status: p.data.situacao }).where(eq(users.id, target.id));
  } catch (err) {
    return { error: friendlyDbError(err), values: keepValues(raw) };
  }
  if (p.data.situacao === "INACTIVE" || p.data.papel !== target.role) await revokeUserSessions(target.id);
  await audit({
    action: "usuario.alterado", userId: ctx.actor.id, userEmail: ctx.email, entity: "usuario", entityId: target.id,
    data: { antes: { nome: target.name, papel: target.role, situacao: target.status }, depois: { nome: p.data.nome, papel: p.data.papel, situacao: p.data.situacao } },
  });
  return { ok: true, message: "Alterações salvas." };
}

// ---------- redefinir senha (gera provisória) ----------
export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await actorCtx();
  if (!ctx) return expired();
  const target = await loadTarget(String(fd.get("id") ?? ""), ctx.actor);
  if (!target) return { error: "Usuário não encontrado." };
  const v = canResetPassword(ctx.actor, toTarget(target));
  if (!v.ok) return { error: v.reason };
  const temp = generateTempPassword();
  try {
    await db.update(users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true, failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date() })
      .where(eq(users.id, target.id));
  } catch (err) {
    return { error: friendlyDbError(err) };
  }
  await revokeUserSessions(target.id);
  await audit({ action: "usuario.senha_redefinida", userId: ctx.actor.id, userEmail: ctx.email, entity: "usuario", entityId: target.id });
  return { ok: true, message: "Senha redefinida. As sessões abertas do usuário foram encerradas.", secret: temp };
}

// ---------- desbloquear após tentativas erradas ----------
export async function unlockUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await actorCtx();
  if (!ctx) return expired();
  const target = await loadTarget(String(fd.get("id") ?? ""), ctx.actor);
  if (!target) return { error: "Usuário não encontrado." };
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, target.id));
  await audit({ action: "usuario.desbloqueado", userId: ctx.actor.id, userEmail: ctx.email, entity: "usuario", entityId: target.id });
  return { ok: true, message: "Usuário desbloqueado." };
}

// ---------- excluir ----------
export async function deleteUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await actorCtx();
  if (!ctx) return expired();
  const target = await loadTarget(String(fd.get("id") ?? ""), ctx.actor);
  if (!target) return { error: "Usuário não encontrado." };
  const v = canDelete(ctx.actor, toTarget(target));
  if (!v.ok) return { error: v.reason };
  try {
    await db.delete(users).where(eq(users.id, target.id));
  } catch (err) {
    return { error: friendlyDbError(err, "Não foi possível excluir. Se o usuário já tem histórico, prefira desativá-lo.") };
  }
  await audit({ action: "usuario.excluido", userId: ctx.actor.id, userEmail: ctx.email, entity: "usuario", entityId: target.id, data: { email: target.email } });
  const back = String(fd.get("voltar") ?? "");
  const fallback = ctx.console ? consoleBase() : "/";
  return { ok: true, redirectTo: /^\/[a-z0-9/_-]*$/i.test(back) ? back : fallback };
}
