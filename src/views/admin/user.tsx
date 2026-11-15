import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { requireAdmin, toActor } from "@/lib/context";
import { UserEditor } from "@/components/UserEditor";
import { ROLE_LABEL } from "@/lib/rules";
import { consoleHref } from "@/lib/console-path";

export async function AdminUser({ id }: { id: string }) {
  const s = await requireAdmin();
  const [u] = await db.select().from(users).where(eq(users.id, id.slice(0, 64))).limit(1);
  if (!u) notFound();
  const console = u.role === "SUPER_ADMIN";
  const back = console ? consoleHref("/administradores") : consoleHref("/");
  return (
    <>
      <div className="ph"><div><Link className="back" href={back}>‹ {console ? "Administradores" : "Licença e módulos"}</Link><h1>{u.name}</h1><p>{u.email} · {ROLE_LABEL[u.role]}{console ? "" : " · escola"}</p></div></div>
      <div style={{ maxWidth: 720 }}><UserEditor user={u} actor={toActor(s)} back={back} /></div>
    </>
  );
}
