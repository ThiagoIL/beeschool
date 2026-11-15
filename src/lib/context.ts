import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "./env";
import { parseHost, type HostInfo } from "./host";
import type { Tenant } from "@/db/schema";
import { readSession, type SessionCtx } from "./session";
import { findTenantBySlug, tenantBlocked } from "./session-core";
import type { Actor } from "./rules";

/**
 * Área da requisição, lida do domínio acessado (Host): admin.<domínio> = console do fornecedor,
 * <slug>.<domínio> = sistema do cliente, <domínio> = página inicial.
 */
export const requestArea = cache(async (): Promise<HostInfo> => {
  const h = await headers();
  return parseHost(h.get("host"), env.ROOT_DOMAIN, env.ADMIN_SUBDOMAIN);
});

export const findTenant = cache(async (slug: string): Promise<Tenant | null> => findTenantBySlug(slug));

/** Cliente do subdomínio atual (404 se não for área de cliente ou se não existir). */
export async function currentTenant(): Promise<Tenant> {
  const info = await requestArea();
  if (info.area !== "tenant") notFound();
  const t = await findTenant(info.slug);
  if (!t) notFound();
  return t;
}

export const adminSession = cache(async (): Promise<SessionCtx | null> => {
  if ((await requestArea()).area !== "admin") return null;
  return readSession("ADMIN", null);
});

export const tenantSession = cache(async (): Promise<SessionCtx | null> => {
  const info = await requestArea();
  if (info.area !== "tenant") return null;
  const t = await findTenant(info.slug);
  if (!t || tenantBlocked(t)) return null;
  return readSession("TENANT", t.id);
});

export function toActor(s: SessionCtx): Actor {
  return { id: s.user.id, role: s.user.role, tenantId: s.user.tenantId };
}

/** Administrador ainda precisa configurar o 2FA (só quando ADMIN_REQUIRE_2FA=true). */
export function needsTwoFactorSetup(user: { totpEnabledAt: Date | null }): boolean {
  return env.twoFactorRequired && !user.totpEnabledAt;
}

/**
 * Exige administrador do sistema logado. Com 2FA obrigatório e ainda não ativo, só a página
 * "Minha conta" abre (para configurar o autenticador). Fora do console: 404.
 */
export async function requireAdmin(opts: { allowSetup?: boolean } = {}): Promise<SessionCtx> {
  if ((await requestArea()).area !== "admin") notFound();
  const s = await adminSession();
  if (!s) redirect("/login");
  if (!opts.allowSetup) {
    if (s.user.mustChangePassword) redirect("/conta?trocar=1");
    if (needsTwoFactorSetup(s.user)) redirect("/conta?2fa=1");
  }
  return s;
}

/** Exige usuário do cliente logado; com admin, exige administrador. Cliente bloqueado: tela "Acesso suspenso". */
export async function requireTenantUser(opts: { admin?: boolean; allowPasswordChange?: boolean } = {}): Promise<SessionCtx & { tenant: Tenant }> {
  const t = await currentTenant();
  if (tenantBlocked(t)) redirect("/suspenso");
  const s = await tenantSession();
  if (!s || !s.tenant) redirect("/login");
  if (s.user.mustChangePassword && !opts.allowPasswordChange) redirect("/conta?trocar=1");
  if (opts.admin && s.user.role !== "TENANT_ADMIN") redirect("/?erro=" + encodeURIComponent("Área só para administradores."));
  return s as SessionCtx & { tenant: Tenant };
}

/**
 * Versões para ações de formulário: em vez de redirecionar, devolvem null e a ação responde
 * com o endereço para onde o navegador deve ir.
 */
export async function adminForAction(): Promise<SessionCtx | null> {
  if ((await requestArea()).area !== "admin") return null;
  const s = await adminSession();
  return s && !s.user.mustChangePassword && !needsTwoFactorSetup(s.user) ? s : null;
}

export async function tenantUserForAction(opts: { admin?: boolean } = {}): Promise<(SessionCtx & { tenant: Tenant }) | null> {
  const s = await tenantSession();
  if (!s || !s.tenant || s.user.mustChangePassword) return null;
  if (opts.admin && s.user.role !== "TENANT_ADMIN") return null;
  return s as SessionCtx & { tenant: Tenant };
}

export const SESSION_EXPIRED = { error: "Sua sessão expirou ou você não tem permissão para esta ação. Entre novamente.", redirectTo: "/login" } as const;
