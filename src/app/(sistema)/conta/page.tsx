import { notFound } from "next/navigation";
import { requestArea, requireAdmin, requireTenantUser } from "@/lib/context";
import { AccountPage, toSessionRows } from "@/components/AccountPage";
import { userSessions } from "@/lib/session";
import { env } from "@/lib/env";
import { ROLE_LABEL } from "@/lib/rules";

export default async function Conta() {
  const info = await requestArea();
  if (info.area === "admin") {
    const s = await requireAdmin({ allowSetup: true });
    return <AccountPage user={s.user} mustChange={s.user.mustChangePassword} sessions={toSessionRows(await userSessions(s.user.id), s.sessionId)}
      roleLabel={s.user.isMaster ? "Administrador do sistema · conta master" : "Administrador do sistema"} twoFactor={{ enabled: !!s.user.totpEnabledAt, required: env.twoFactorRequired }} />;
  }
  if (info.area === "tenant") {
    const s = await requireTenantUser({ allowPasswordChange: true });
    return <AccountPage user={s.user} mustChange={s.user.mustChangePassword} sessions={toSessionRows(await userSessions(s.user.id), s.sessionId)} roleLabel={`${ROLE_LABEL[s.user.role]} · ${s.tenant.name}`} />;
  }
  notFound();
}
