import { requireAdmin } from "@/lib/context";
import { AccountPage, toSessionRows } from "@/components/AccountPage";
import { userSessions } from "@/lib/session";
import { env } from "@/lib/env";

export default async function ContaConsole() {
  const s = await requireAdmin({ allowSetup: true });
  return <AccountPage user={s.user} mustChange={s.user.mustChangePassword} sessions={toSessionRows(await userSessions(s.user.id), s.sessionId)}
    roleLabel={s.user.isMaster ? "Administrador do console · conta master" : "Administrador do console"} twoFactor={{ enabled: !!s.user.totpEnabledAt, required: env.twoFactorRequired }} />;
}
