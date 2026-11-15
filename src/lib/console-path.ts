/**
 * Onde o console do fornecedor responde. Sem dependências: usado também pelo middleware.
 *
 * O console fica num caminho do próprio domínio da escola (padrão /sistema-admin, configurável em
 * PLATFORM_ADMIN_PATH — escolha algo pouco óbvio). O middleware reescreve esse caminho para as telas
 * internas /console/*; o caminho interno /console não existe fora dele (404).
 */

/** Header interno com a área da requisição ("console" ou "app"). Sempre definido pelo middleware. */
export const AREA_HEADER = "x-bee-area";
export const CONSOLE_INTERNAL = "/console";
const DEFAULT_PATH = "/sistema-admin";

/** Caminhos que o console nunca pode ocupar (são do sistema da escola ou do Next). */
const RESERVED = ["/login", "/api", "/_next", "/console", "/suspenso", "/conta", "/usuarios", "/perfis", "/empresa",
  "/financeiro", "/paineis", "/academico", "/esqueci-senha", "/redefinir-senha", "/brand"];

/** Normaliza o caminho configurado; valores inválidos ou reservados voltam ao padrão. */
export function consoleBase(raw = process.env.PLATFORM_ADMIN_PATH): string {
  const n = `/${(raw ?? "").trim().replace(/^\/+|\/+$/g, "")}`.toLowerCase();
  if (n === "/" || !/^\/[a-z0-9][a-z0-9/_-]{1,60}$/.test(n) || RESERVED.some((r) => n === r || n.startsWith(`${r}/`))) return DEFAULT_PATH;
  return n;
}

/** Se `pathname` está no console, devolve o caminho interno dele ("/", "/auditoria"…); senão, null. */
export function stripConsoleBase(pathname: string, base: string): string | null {
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}

/** Monta um endereço público do console a partir de um caminho interno ("/" → "/sistema-admin"). */
export function consoleHref(p = "/", base = consoleBase()): string {
  return p === "/" ? base : `${base}${p.startsWith("/") ? p : `/${p}`}`;
}
