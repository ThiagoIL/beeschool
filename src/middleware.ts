import { NextResponse, type NextRequest } from "next/server";
import { AREA_HEADER, CONSOLE_INTERNAL, consoleBase, stripConsoleBase } from "@/lib/console-path";
import { moduleForPath } from "@/lib/modules";

/**
 * Porta de entrada de todas as requisições:
 *  - console do fornecedor, no caminho PLATFORM_ADMIN_PATH (padrão /sistema-admin) → telas internas /console/*;
 *  - o caminho interno /console não existe fora dele (404);
 *  - o resto é o sistema da escola: em todo GET de página/exportação confere o acesso ao módulo da rota
 *    (catálogo em src/lib/modules.ts). Sem acesso → início com aviso; sistema bloqueado → "Acesso suspenso".
 *    As páginas repetem a verificação e as ações exigem EDIT (act()).
 * O header AREA_HEADER é sempre sobrescrito aqui: o navegador não consegue escolher a área.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const headers = new Headers(req.headers);

  const inner = stripConsoleBase(pathname, consoleBase());
  if (inner !== null) {
    headers.set(AREA_HEADER, "console");
    return NextResponse.rewrite(new URL(`${CONSOLE_INTERNAL}${inner === "/" ? "" : inner}${search}`, req.url), { request: { headers } });
  }
  if (pathname === CONSOLE_INTERNAL || pathname.startsWith(`${CONSOLE_INTERNAL}/`)) return new NextResponse("Não encontrado.", { status: 404 });

  headers.set(AREA_HEADER, "app");
  const next = () => NextResponse.next({ request: { headers } });
  const mod = req.method === "GET" ? moduleForPath(pathname) : null;
  if (!mod) return next();

  // importação tardia: só carrega o acesso ao banco quando a rota exige um módulo
  const { APP_COOKIE, getSystem, loadAccess, sessionFromToken, systemBlocked } = await import("@/lib/session-core");
  const isApi = pathname.startsWith("/api/");
  const deny = (to: string, status = 403) => isApi ? new NextResponse("Sem acesso.", { status }) : NextResponse.redirect(new URL(to, req.url));

  const sys = await getSystem();
  if (systemBlocked(sys)) return deny("/suspenso", 423);
  const s = await sessionFromToken(req.cookies.get(APP_COOKIE)?.value, "APP");
  if (!s) return deny("/login", 401);
  const access = await loadAccess(s.user, sys);
  if (access.mods[mod] === "NONE") return deny(`/?erro=${encodeURIComponent("Seu perfil não tem acesso a essa área.")}`);
  return next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/|api/health|favicon.ico|icon.svg|robots.txt|brand/).*)"],
};
