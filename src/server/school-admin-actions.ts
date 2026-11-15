"use server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { userForAction } from "@/lib/context";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import * as E from "@/db/erp";
import { audit } from "@/lib/audit";
import { revokeUserSessions } from "@/lib/session";
import { MODULES } from "@/lib/modules";
import { cnpjValid, maskDoc, onlyDigits } from "@/lib/doc";
import { formObject, keepValues, zodFail } from "@/lib/forms";
import { ruleMsg } from "./common";
import type { ActionState } from "@/lib/action";

const ADMIN_ONLY = { error: "Só administradores podem alterar esta área." } as const;

const profSchema = z.object({
  id: z.string().max(64).optional(), name: z.string().trim().min(2, "Informe o nome do perfil.").max(80), description: z.string().max(300).optional().nullable(),
  permissions: z.record(z.string().max(40), z.enum(["NONE", "VIEW", "EDIT"])),
});
export async function saveProfileAction(input: z.input<typeof profSchema>): Promise<ActionState> {
  const s = await userForAction({ admin: true });
  if (!s) return ADMIN_ONLY;
  const p = profSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Confira o perfil." };
  const d = p.data;
  const perms: Record<string, string> = {};
  for (const [k] of MODULES) perms[k] = d.permissions[k] ?? "NONE";
  try {
    await db.transaction(async (tx) => {
      if (d.id) await tx.update(E.accessProfiles).set({ name: d.name, description: d.description?.trim() || null, permissions: perms }).where(eq(E.accessProfiles.id, d.id));
      else await tx.insert(E.accessProfiles).values({ name: d.name, description: d.description?.trim() || null, permissions: perms });
    });
  } catch (err) {
    return { error: ruleMsg(err) };
  }
  await audit({ action: d.id ? "perfil.alterado" : "perfil.criado", userId: s.user.id, userEmail: s.user.email, entity: "perfil", data: { nome: d.name } });
  return { ok: true, message: "Perfil salvo." };
}

export async function deleteProfileAction(id: string): Promise<ActionState> {
  const s = await userForAction({ admin: true });
  if (!s) return ADMIN_ONLY;
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(users).where(eq(users.profileId, id));
  if (c) return { error: "Há usuários com este perfil. Troque o perfil deles antes de excluir." };
  await db.transaction((tx) => tx.delete(E.accessProfiles).where(eq(E.accessProfiles.id, id)));
  await audit({ action: "perfil.excluido", userId: s.user.id, userEmail: s.user.email, entity: "perfil", entityId: id });
  return { ok: true, message: "Perfil excluído." };
}

export async function setUserProfileAction(userId: string, profileId: string | null): Promise<ActionState> {
  const s = await userForAction({ admin: true });
  if (!s) return ADMIN_ONLY;
  if (profileId) {
    const [p] = await db.transaction((tx) => tx.select({ id: E.accessProfiles.id }).from(E.accessProfiles).where(eq(E.accessProfiles.id, profileId)).limit(1));
    if (!p) return { error: "Perfil não encontrado." };
  }
  const r = await db.update(users).set({ profileId }).where(and(eq(users.id, userId))).returning({ id: users.id });
  if (!r.length) return { error: "Usuário não encontrado." };
  await revokeUserSessions(userId).catch(() => {});
  await audit({ action: "usuario.perfil", userId: s.user.id, userEmail: s.user.email, entity: "usuario", entityId: userId, data: { perfil: profileId } });
  return { ok: true, message: "Perfil do usuário alterado. Ele precisará entrar de novo." };
}

const opt = (max = 200) => z.string().trim().max(max).optional().transform((v) => v || null);
const companySchema = z.object({ razao: opt(), fantasia: opt(), cnpj: opt(20), telefone: opt(30), email: opt(160), cidade: opt(100), uf: opt(2), base: z.enum(["MENSALIDADE", "RECEITA_BRUTA"]).default("MENSALIDADE") });
export async function saveCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await userForAction({ admin: true });
  if (!s) return ADMIN_ONLY;
  const raw = formObject(fd);
  const p = companySchema.safeParse(raw);
  if (!p.success) return zodFail(p.error, raw);
  const d = p.data;
  if (d.cnpj && !cnpjValid(d.cnpj)) return { error: "Confira os campos destacados.", fields: { cnpj: "CNPJ inválido." }, values: keepValues(raw) };
  const v = { legalName: d.razao, tradeName: d.fantasia, document: d.cnpj ? maskDoc(onlyDigits(d.cnpj)) : null, phone: d.telefone, email: d.email, city: d.cidade, uf: d.uf?.toUpperCase() ?? null, pctBase: d.base };
  await db.transaction(async (tx) => {
    const [cur] = await tx.select({ id: E.companySettings.id }).from(E.companySettings).limit(1);
    if (cur) await tx.update(E.companySettings).set(v).where(eq(E.companySettings.id, cur.id));
    else await tx.insert(E.companySettings).values({ ...v });
  });
  await audit({ action: "instituicao.alterada", userId: s.user.id, userEmail: s.user.email, entity: "instituicao" });
  return { ok: true, message: "Dados da instituição salvos." };
}
