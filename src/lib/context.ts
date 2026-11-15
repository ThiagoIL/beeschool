import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { System } from "@/db/schema";
import { readSession, type SessionCtx } from "./session";
import { getSystem as loadSystem, systemBlocked } from "./session-core";
import { AREA_HEADER, consoleHref } from "./console-path";
import type { Actor } from "./rules";

export type RequestArea = { area: "console" } | { area: "app" };

/**
 * Área da requisição, definida pelo middleware: o caminho do console (PLATFORM_ADMIN_PATH) é o console
 * do fornecedor; todo o resto é o sistema da escola. O navegador não consegue forjar esse valor.
 */
export const requestArea = cache(async (): Promise<RequestArea> => {
  const h = await headers();
  return h.get(AREA_HEADER) === "console" ? { area: "console" } : { area: "app" };
});

/** Endereço público dentro da área atual (no console, ganha o prefixo /sistema-admin). */
export async function areaHref(p: string): Promise<string> {
  return (await requestArea()).area === "console" ? consoleHref(p) : p;
}

/** Configuração do fornecedor (licença, bloqueio, módulos), uma vez por requisição. */
export const getSystem = cache(async (): Promise<System> => loadSystem());

export const consoleSession = cache(async (): Promise<SessionCtx | null> => {
  if ((await requestArea()).area !== "console") return null;
  return readSession("CONSOLE");
});

export const appSession = cache(async (): Promise<SessionCtx | null> => {
  if ((await requestArea()).area !== "app") return null;
  if (systemBlocked(await getSystem())) return null;
  return readSession("APP");
});

export function toActor(s: SessionCtx): Actor {
  return { id: s.user.id, role: s.user.role };
}

/**
 * Exige administrador do console logado. Com troca de senha pendente, só a página "Minha conta" abre.
 * Fora do console: 404.
 */
export async function requireAdmin(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionCtx> {
  if ((await requestArea()).area !== "console") notFound();
  const s = await consoleSession();
  if (!s) redirect(consoleHref("/login"));
  if (s.user.mustChangePassword && !opts.allowPasswordChange) redirect(consoleHref("/conta?trocar=1"));
  return s;
}

export type UserCtx = SessionCtx & { system: System };

/** Exige usuário da escola logado; com admin, exige administrador. Sistema bloqueado: tela "Acesso suspenso". */
export async function requireUser(opts: { admin?: boolean; allowPasswordChange?: boolean } = {}): Promise<UserCtx> {
  if ((await requestArea()).area !== "app") notFound();
  const system = await getSystem();
  if (systemBlocked(system)) redirect("/suspenso");
  const s = await appSession();
  if (!s) redirect("/login");
  if (s.user.mustChangePassword && !opts.allowPasswordChange) redirect("/conta?trocar=1");
  if (opts.admin && s.user.role !== "ADMIN") redirect("/?erro=" + encodeURIComponent("Área só para administradores."));
  return { ...s, system };
}

/**
 * Versões para ações de formulário: em vez de redirecionar, devolvem null e a ação responde
 * com o endereço para onde o navegador deve ir.
 */
export async function adminForAction(): Promise<SessionCtx | null> {
  const s = await consoleSession();
  return s && !s.user.mustChangePassword ? s : null;
}

export async function userForAction(opts: { admin?: boolean } = {}): Promise<UserCtx | null> {
  const s = await appSession();
  if (!s || s.user.mustChangePassword) return null;
  if (opts.admin && s.user.role !== "ADMIN") return null;
  return { ...s, system: await getSystem() };
}

export const SESSION_EXPIRED = { error: "Sua sessão expirou ou você não tem permissão para esta ação. Entre novamente.", redirectTo: "/login" } as const;
/** Mesmo aviso, para ações do console (o login fica no caminho do console). */
export const consoleExpired = () => ({ ...SESSION_EXPIRED, redirectTo: consoleHref("/login") });
