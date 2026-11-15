"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessions, tenants, users } from "@/db/schema";
import { SESSION_EXPIRED, adminForAction, requestArea, tenantUserForAction } from "@/lib/context";
import { validateSlug } from "@/lib/host";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { friendlyDbError } from "@/lib/errors";
import { formObject, keepValues, zEmail, zName, zodFail } from "@/lib/forms";
import type { ActionState } from "@/lib/action";
import { BIZ_MODULES } from "@/lib/modules";
import { isDate } from "@/lib/dates";

const zDoc = z.string().trim().max(20).transform((s) => s.replace(/[^\d./-]/g, "")).optional();

/** Campo de limite do plano: vazio = sem limite. */
const zLimit = z.string().trim().max(6).optional().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100000) { ctx.addIssue({ code: "custom", message: "Use um número inteiro a partir de 1, ou deixe vazio para não limitar." }); return z.NEVER; }
  return n;
});

const newTenant = z.object({
  max_usuarios: zLimit,
  max_simultaneos: zLimit,
  slug: z.string().trim().toLowerCase().superRefine((s, ctx) => { const e = validateSlug(s); if (e) ctx.addIssue({ code: "custom", message: e }); }),
  nome: zName,
  documento: zDoc,
  admin_nome: zName,
  admin_email: zEmail,
});

/** Cria a base da empresa e o primeiro administrador dela, com senha provisória. */
export async function createTenantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await adminForAction();
  if (!s) return SESSION_EXPIRED;
  const raw = formObject(fd);
  const p = newTenant.safeParse(raw);
  if (!p.success) return zodFail(p.error, raw);
  const d = p.data;
  const [exists] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, d.slug)).limit(1);
  if (exists) return { fields: { slug: "Este endereço já está em uso." }, error: "Confira os campos destacados.", values: keepValues(raw) };

  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  let tenantId = "";
  try {
    await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: d.slug, name: d.nome, document: d.documento || null, maxUsers: d.max_usuarios, maxSessions: d.max_simultaneos }).returning({ id: tenants.id });
      tenantId = t.id;
      await tx.insert(users).values({ tenantId: t.id, name: d.admin_nome, email: d.admin_email, role: "TENANT_ADMIN", passwordHash: hash, mustChangePassword: true });
    });
  } catch (err) {
    return { error: friendlyDbError(err), values: keepValues(raw) };
  }
  await audit({ action: "cliente.criado", tenantId, userId: s.user.id, userEmail: s.user.email, entity: "empresa", entityId: tenantId, data: { slug: d.slug, admin: d.admin_email } });
  return { ok: true, message: `Cliente criado. Endereço de acesso: ${d.slug}.${process.env.ROOT_DOMAIN}. Administrador: ${d.admin_email}.`, secret: temp, values: {} };
}

const editTenant = z.object({
  id: z.string().min(1).max(64),
  nome: zName,
  documento: zDoc,
  situacao: z.enum(["ACTIVE", "SUSPENDED"]),
  mensagem: z.string().trim().max(500).optional(),
  pago_ate: z.string().trim().max(10).optional().refine((v) => !v || isDate(v), "Data inválida."),
  tolerancia: z.coerce.number().int().min(0, "De 0 a 90 dias.").max(90, "De 0 a 90 dias.").default(5),
  observacoes: z.string().trim().max(1000).optional(),
  max_usuarios: zLimit,
  max_simultaneos: zLimit,
});

export async function updateTenantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await adminForAction();
  if (!s) return SESSION_EXPIRED;
  const raw = formObject(fd);
  const p = editTenant.safeParse(raw);
  if (!p.success) return zodFail(p.error, raw);
  const [before] = await db.select().from(tenants).where(eq(tenants.id, p.data.id)).limit(1);
  if (!before) return { error: "Cliente não encontrado." };
  const modules = BIZ_MODULES.filter((m) => fd.get(`mod_${m}`) === "on");
  try {
    await db.update(tenants).set({ name: p.data.nome, document: p.data.documento || null, status: p.data.situacao, notes: p.data.observacoes || null,
      blockMessage: p.data.mensagem || null, paidUntil: p.data.pago_ate || null, graceDays: p.data.tolerancia, modules,
      maxUsers: p.data.max_usuarios, maxSessions: p.data.max_simultaneos })
      .where(eq(tenants.id, before.id));
  } catch (err) {
    return { error: friendlyDbError(err), values: keepValues(raw) };
  }
  const suspendeu = p.data.situacao === "SUSPENDED" && before.status !== "SUSPENDED";
  if (suspendeu) await db.delete(sessions).where(eq(sessions.tenantId, before.id));
  await audit({ action: suspendeu ? "cliente.bloqueado" : before.status === "SUSPENDED" && p.data.situacao === "ACTIVE" ? "cliente.liberado" : "cliente.alterado", tenantId: before.id, userId: s.user.id, userEmail: s.user.email, entity: "empresa", entityId: before.id,
    data: { situacao: { antes: before.status, depois: p.data.situacao }, nome: p.data.nome, licenca: { antes: before.paidUntil, depois: p.data.pago_ate || null }, modulos: { antes: before.modules, depois: modules },
      plano: { usuarios: { antes: before.maxUsers, depois: p.data.max_usuarios }, simultaneos: { antes: before.maxSessions, depois: p.data.max_simultaneos } } } });
  return { ok: true, message: suspendeu ? "Cliente bloqueado. Todos os usuários foram desconectados e veem a tela de acesso suspenso." : "Alterações salvas." };
}


/** Desconecta uma sessão aberta numa empresa (painel do sistema ou administrador da própria empresa). */
export async function disconnectSessionAction(sessionId: string): Promise<ActionState> {
  const info = await requestArea();
  const admin = info.area === "admin" ? await adminForAction() : null;
  const tenantAdmin = info.area === "tenant" ? await tenantUserForAction({ admin: true }) : null;
  if (!admin && !tenantAdmin) return SESSION_EXPIRED;
  const [row] = await db.select({ s: sessions, email: users.email }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, String(sessionId).slice(0, 64))).limit(1);
  if (!row || row.s.area !== "TENANT" || (tenantAdmin && row.s.tenantId !== tenantAdmin.tenant.id)) return { error: "Sessão não encontrada." };
  if (tenantAdmin && row.s.id === tenantAdmin.sessionId) return { error: "Esta é a sua própria sessão. Use Sair." };
  await db.delete(sessions).where(eq(sessions.id, row.s.id));
  const by = admin ?? tenantAdmin!;
  await audit({ action: "sessao.desconectada", tenantId: row.s.tenantId, userId: by.user.id, userEmail: by.user.email, entity: "usuario", entityId: row.s.userId, data: { usuario: row.email } });
  return { ok: true, message: `${row.email} foi desconectado.` };
}
