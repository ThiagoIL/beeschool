import { NextResponse, type NextRequest } from "next/server";
import { parseHost } from "@/lib/host";
import { moduleForPath } from "@/lib/modules";

/**
 * 1) Recusa domínios que não pertencem ao sistema (IP direto, domínio de terceiros).
 * 2) No sistema do cliente, confere em todo GET de página/exportação o acesso ao módulo da rota
 *    (catálogo em src/lib/modules.ts). Sem acesso → início com aviso; cliente bloqueado → "Acesso suspenso".
 *    As páginas repetem a verificação e as ações exigem EDIT (act()).
 */
export async function middleware(req: NextRequest) {
  const info = parseHost(req.headers.get("host"), process.env.ROOT_DOMAIN ?? "", process.env.ADMIN_SUBDOMAIN ?? "admin");
  if (info.area === "unknown") return new NextResponse("Domínio não configurado.", { status: 404 });
  if (info.area !== "tenant" || req.method !== "GET") return NextResponse.next();

  const path = req.nextUrl.pathname;
  const mod = moduleForPath(path);
  if (!mod) return NextResponse.next();

  // importação tardia: só carrega o acesso ao banco quando a rota exige um módulo
  const { COOKIE, findTenantBySlug, loadAccess, sessionFromToken, tenantBlocked } = await import("@/lib/session-core");
  const isApi = path.startsWith("/api/");
  const deny = (to: string, status = 403) => isApi ? new NextResponse("Sem acesso.", { status }) : NextResponse.redirect(new URL(to, req.url));

  const tenant = await findTenantBySlug(info.slug);
  if (!tenant) return NextResponse.next(); // a página responde 404
  if (tenantBlocked(tenant)) return deny("/suspenso", 423);
  const s = await sessionFromToken(req.cookies.get(COOKIE)?.value, "TENANT", tenant.id);
  if (!s) return deny("/login", 401);
  const access = await loadAccess(s.user, tenant);
  if (access.mods[mod] === "NONE") return deny(`/?erro=${encodeURIComponent("Seu perfil não tem acesso a essa área.")}`);
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/|api/health|favicon.ico|icon.svg|robots.txt|brand/).*)"],
};
