import { requireUser } from "@/lib/context";
import { AccountPage, toSessionRows } from "@/components/AccountPage";
import { userSessions } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/rules";

export default async function Conta() {
  const s = await requireUser({ allowPasswordChange: true });
  return <AccountPage user={s.user} mustChange={s.user.mustChangePassword} sessions={toSessionRows(await userSessions(s.user.id), s.sessionId)} roleLabel={`${ROLE_LABEL[s.user.role]} · ${s.system.name}`} />;
}
