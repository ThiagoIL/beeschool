import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db, type Tx } from "./db";
import { requireUser, userForAction, SESSION_EXPIRED, type UserCtx } from "./context";
import { loadAccess } from "./session-core";
import type { Access, ModuleKey } from "./modules";

export const accessOf = cache(async (s: UserCtx): Promise<Access> => loadAccess(s.user, s.system));

/** Transação no banco (várias operações que precisam valer juntas). */
const tx = <T,>(fn: (t: Tx) => Promise<T>) => db.transaction(fn);

export type PageCtx = UserCtx & {
  access: Access;
  /** pode alterar o módulo da página */
  edit: boolean;
  tx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

/**
 * Para páginas: exige login e acesso de consulta ao módulo. O middleware já barrou o GET sem acesso;
 * esta verificação repete a regra (defesa em profundidade).
 */
export async function page(mod: ModuleKey | null, opts: { edit?: boolean } = {}): Promise<PageCtx> {
  const s = await requireUser();
  const access = await accessOf(s);
  if (mod) {
    const l = access.mods[mod];
    if (l === "NONE" || (opts.edit && l !== "EDIT")) redirect(`/?erro=${encodeURIComponent("Seu perfil não tem acesso a essa área.")}`);
  }
  return { ...s, access, edit: mod ? access.mods[mod] === "EDIT" : true, tx };
}

export type ActCtx = UserCtx & { access: Access; tx: PageCtx["tx"]; userName: string };

/** Para ações: exige EDIT no módulo. Devolve null quando não pode. */
export async function act(mod: ModuleKey | ModuleKey[]): Promise<ActCtx | null> {
  const s = await userForAction();
  if (!s) return null;
  const access = await accessOf(s);
  const mods = Array.isArray(mod) ? mod : [mod];
  if (!mods.some((m) => access.mods[m] === "EDIT")) return null;
  return { ...s, access, tx, userName: s.user.name };
}

export const NO_ACCESS = { error: "Você não tem permissão para alterar esta área, ou a sua sessão expirou. Entre novamente se for o caso." } as const;
export { SESSION_EXPIRED };
