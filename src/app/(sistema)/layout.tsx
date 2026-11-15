import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { adminSession, currentTenant, requestArea, tenantSession } from "@/lib/context";
import { accessOf } from "@/lib/access";
import { ADMIN_NAV, TENANT_NAV } from "@/lib/modules";
import { ensureDefaults, logoUrl } from "@/server/common";
import { tenantBlocked } from "@/lib/session-core";
import type { Tenant } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Moldura do sistema: escolhe o menu conforme o domínio (console do fornecedor ou cliente). */
export default async function SistemaLayout({ children }: { children: React.ReactNode }) {
  const info = await requestArea();

  if (info.area === "admin") {
    const s = await adminSession();
    if (!s) redirect("/login");
    // sem 2FA configurado, o console mostra só "Minha conta" (sem menu)
    const nav = s.user.totpEnabledAt && !s.user.mustChangePassword ? ADMIN_NAV : [];
    return <Shell nav={nav} user={s.user} roleLabel={s.user.isMaster ? "Administrador do sistema · master" : "Administrador do sistema"}>{children}</Shell>;
  }

  if (info.area === "tenant") {
    const t = await currentTenant();
    if (tenantBlocked(t)) redirect("/suspenso");
    const s = await tenantSession();
    if (!s) redirect("/login");
    await ensureDefaults(t.id);
    const access = await accessOf({ ...s, tenant: s.tenant as Tenant });
    const nav = TENANT_NAV.filter((m) => !m.perm || access.mods[m.perm] !== "NONE");
    const readOnly = Object.entries(access.mods).filter(([, l]) => l === "VIEW").map(([k]) => k);
    return (
      <Shell nav={nav} context={t.name} logo={await logoUrl(t.id)} user={s.user} readOnly={readOnly}
        roleLabel={access.isAdmin ? "Administrador" : access.profileName ?? "Usuário"}>
        {children}
      </Shell>
    );
  }

  return <>{children}</>;
}
