import { requireAdmin } from "@/lib/context";
import { AccountPage, toSessionRows } from "@/components/AccountPage";
import { userSessions } from "@/lib/session";

export default async function ContaConsole() {
  const s = await requireAdmin({ allowPasswordChange: true });
  return <AccountPage user={s.user} mustChange={s.user.mustChangePassword} sessions={toSessionRows(await userSessions(s.user.id), s.sessionId)}
    roleLabel={s.user.isMaster ? "Administrador do console · conta master" : "Administrador do console"} />;
}
