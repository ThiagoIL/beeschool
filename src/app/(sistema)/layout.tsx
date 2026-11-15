import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { appSession, getSystem, requestArea } from "@/lib/context";
import { accessOf } from "@/lib/access";
import { APP_NAV } from "@/lib/modules";
import { ensureDefaults, logoUrl } from "@/server/common";
import { systemBlocked } from "@/lib/session-core";

export const dynamic = "force-dynamic";

/** Moldura do sistema da escola: menu conforme os módulos liberados e o perfil do usuário. */
export default async function SistemaLayout({ children }: { children: React.ReactNode }) {
  if ((await requestArea()).area !== "app") notFound();
  const system = await getSystem();
  if (systemBlocked(system)) redirect("/suspenso");
  const s = await appSession();
  if (!s) redirect("/login");
  await ensureDefaults();
  const access = await accessOf({ ...s, system });
  const nav = APP_NAV.filter((m) => !m.perm || access.mods[m.perm] !== "NONE");
  const readOnly = Object.entries(access.mods).filter(([, l]) => l === "VIEW").map(([k]) => k);
  return (
    <Shell nav={nav} context={system.name} logo={await logoUrl()} user={s.user} readOnly={readOnly}
      roleLabel={access.isAdmin ? "Administrador" : access.profileName ?? "Usuário"}>
      {children}
    </Shell>
  );
}
