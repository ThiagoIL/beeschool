/**
 * Catálogo de módulos, níveis de acesso e rotas (usado no middleware, no servidor e no navegador).
 * Sem dependências de servidor: o middleware importa este arquivo.
 */
import type { IconName } from "@/components/Icon";

/** Módulos que o fornecedor libera por cliente e que os perfis de acesso controlam. */
export const MODULES = [
  ["financeiro", "Financeiro"],
  ["paineis", "Painéis"],
  ["academico", "Acadêmico"],
] as const;
export type BizModule = (typeof MODULES)[number][0];
export type ModuleKey = BizModule | "admin";
export const BIZ_MODULES: BizModule[] = MODULES.map(([k]) => k);
export const isBizModule = (k: string): k is BizModule => (BIZ_MODULES as string[]).includes(k);

export type Level = "NONE" | "VIEW" | "EDIT";
export const LEVELS: Level[] = ["NONE", "VIEW", "EDIT"];
export const LEVEL_LABEL: Record<Level, string> = { NONE: "Sem acesso", VIEW: "Consultar", EDIT: "Editar" };

export type Access = {
  mods: Record<ModuleKey, Level>;
  isAdmin: boolean;
  profileName: string | null;
};

export const canSee = (a: Access, m: ModuleKey) => a.mods[m] !== "NONE";
export const canEdit = (a: Access, m: ModuleKey) => a.mods[m] === "EDIT";

/**
 * Nível de acesso efetivo (regra pura, testada):
 *  - módulo não liberado pelo fornecedor para o cliente → NONE para todos;
 *  - administrador do cliente → EDIT em tudo que está liberado (e Administração);
 *  - usuário com perfil → o que o perfil define (Administração nunca);
 *  - usuário sem perfil → EDIT nos módulos liberados (Administração nunca).
 */
export function computeAccess(input: { isAdmin: boolean; enabled: readonly string[]; profile?: { name: string; permissions: Record<string, unknown> } | null }): Access {
  const mods = { admin: input.isAdmin ? "EDIT" : "NONE" } as Record<ModuleKey, Level>;
  for (const k of BIZ_MODULES) {
    if (!input.enabled.includes(k)) { mods[k] = "NONE"; continue; }
    if (input.isAdmin || !input.profile) { mods[k] = "EDIT"; continue; }
    const v = input.profile.permissions[k];
    mods[k] = v === "EDIT" || v === "VIEW" ? v : "NONE";
  }
  return { mods, isAdmin: input.isAdmin, profileName: input.isAdmin ? "Administrador" : input.profile?.name ?? null };
}

// ------------------------------------------------------------------------------------
// Rotas: qual módulo cada caminho exige (o prefixo mais longo vence). Checado no middleware (GET)
// e de novo em cada página; as ações conferem EDIT com act().
// ------------------------------------------------------------------------------------
export const ROUTE_MODULES: [string, ModuleKey][] = [
  ["/financeiro", "financeiro"],
  ["/paineis", "paineis"],
  ["/academico", "academico"],
  ["/usuarios", "admin"],
  ["/perfis", "admin"],
  ["/empresa", "admin"],
  ["/api/export/fin-", "financeiro"],
  ["/api/export/acad-", "academico"],
];

export function moduleForPath(path: string): ModuleKey | null {
  let best: [string, ModuleKey] | null = null;
  for (const r of ROUTE_MODULES) {
    const hit = r[0].endsWith("-") ? path.startsWith(r[0]) : path === r[0] || path.startsWith(r[0] + "/");
    if (hit && (!best || r[0].length > best[0].length)) best = r;
  }
  return best ? best[1] : null;
}

// ------------------------------------------------------------------------------------
// Menu
// ------------------------------------------------------------------------------------
export type NavTab = { href: string; label: string };
export type NavItem = { href: string; label: string; tabs?: NavTab[] };
export type NavModule = { id: string; label: string; icon: IconName; href?: string; perm?: ModuleKey; items?: NavItem[] };

export const APP_NAV: NavModule[] = [
  { id: "inicio", label: "Início", icon: "home", href: "/" },
  {
    id: "financeiro", label: "Financeiro", icon: "money", perm: "financeiro", items: [
      { href: "/financeiro/receber", label: "Contas a receber" },
      { href: "/financeiro/pagar", label: "Contas a pagar" },
      { href: "/financeiro/extrato", label: "Extrato" },
      { href: "/financeiro/fluxo", label: "Fluxo de caixa" },
      { href: "/financeiro/mensalidades", label: "Mensalidades" },
      { href: "/financeiro/configuracoes", label: "Configurações", tabs: [
        { href: "/financeiro/configuracoes", label: "Empresas" },
        { href: "/financeiro/configuracoes/contas", label: "Contas e caixas" },
        { href: "/financeiro/configuracoes/grupos", label: "Grupos da DRE" },
        { href: "/financeiro/configuracoes/categorias", label: "Categorias" },
        { href: "/financeiro/configuracoes/formas", label: "Formas de pagamento" },
        { href: "/financeiro/configuracoes/situacoes", label: "Situações" },
        { href: "/financeiro/configuracoes/pessoas", label: "Pessoas e fornecedores" },
        { href: "/financeiro/configuracoes/importar", label: "Importar planilha" },
      ] },
    ],
  },
  {
    id: "paineis", label: "Painéis", icon: "chart", perm: "paineis", items: [
      { href: "/paineis", label: "Análise DRE" },
      { href: "/paineis/fluxo", label: "Fluxo de caixa" },
      { href: "/paineis/indicadores", label: "Indicadores" },
      { href: "/paineis/metas", label: "Orçamento e metas" },
    ],
  },
  {
    id: "academico", label: "Acadêmico", icon: "users", perm: "academico", items: [
      { href: "/academico/alunos", label: "Alunos" },
      { href: "/academico/turmas", label: "Turmas" },
      { href: "/academico/responsaveis", label: "Responsáveis" },
    ],
  },
  {
    id: "admin", label: "Administração", icon: "shield", perm: "admin", items: [
      { href: "/usuarios", label: "Usuários" },
      { href: "/perfis", label: "Perfis de acesso" },
      { href: "/empresa", label: "Instituição" },
    ],
  },
];

/** Menu do console do fornecedor; `base` é o caminho do console (ex.: /sistema-admin). */
export const consoleNav = (base: string): NavModule[] => [
  { id: "painel", label: "Licença e módulos", icon: "home", href: base },
  { id: "administradores", label: "Administradores", icon: "users", href: `${base}/administradores` },
  { id: "auditoria", label: "Auditoria", icon: "doc", href: `${base}/auditoria` },
];

/** Encontra o módulo, o item e a aba do menu para um caminho (o prefixo mais longo vence). */
export function matchNav(nav: NavModule[], path: string) {
  let best: { mod: NavModule; item?: NavItem; tab?: NavTab; len: number } | null = null;
  const hit = (href: string) => href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  for (const mod of nav) {
    if (mod.href && hit(mod.href) && (!best || mod.href.length > best.len)) best = { mod, len: mod.href.length };
    for (const item of mod.items ?? []) {
      if (hit(item.href) && (!best || item.href.length > best.len)) best = { mod, item, len: item.href.length };
      for (const tab of item.tabs ?? []) if (hit(tab.href) && (!best || tab.href.length > best.len)) best = { mod, item, tab, len: tab.href.length };
    }
  }
  return best;
}
