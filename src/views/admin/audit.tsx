import { and, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/db/schema";
import { requireAdmin } from "@/lib/context";
import { fmtDateTime } from "@/lib/format";

export async function AdminAudit({ searchParams }: { searchParams: Promise<{ acao?: string; area?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const conds: SQL[] = [];
  if (sp.acao) conds.push(ilike(auditLogs.action, `%${sp.acao.slice(0, 40)}%`));
  if (sp.area === "CONSOLE" || sp.area === "APP") conds.push(eq(auditLogs.area, sp.area));
  const rows = await db.select().from(auditLogs).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLogs.createdAt)).limit(300);
  return (
    <>
      <div className="ph"><div><h1>Auditoria</h1><p>Acessos e alterações feitos no sistema (últimos 300 registros do filtro).</p></div></div>
      <form className="bar" role="search">
        <input type="search" name="acao" defaultValue={sp.acao ?? ""} placeholder="Ação (ex.: login, usuario, lancamento)" aria-label="Filtrar por ação" />
        <select name="area" defaultValue={sp.area ?? ""} aria-label="Área" style={{ maxWidth: 220 }}>
          <option value="">Escola e console</option><option value="APP">Só a escola</option><option value="CONSOLE">Só o console</option>
        </select>
        <button className="btn" type="submit">Filtrar</button>
      </form>
      <div className="tbl">
        {rows.length ? <table><thead><tr><th>Quando</th><th>Ação</th><th>Área</th><th>Quem</th><th>Detalhes</th><th>IP</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}><td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.createdAt)}</td><td>{a.action}</td><td>{a.area === "CONSOLE" ? "Console" : "Escola"}</td><td>{a.userEmail ?? "—"}</td>
              <td style={{ fontSize: 12, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.data ? JSON.stringify(a.data) : ""}>{a.data ? JSON.stringify(a.data) : ""}</td><td>{a.ip}</td></tr>))}
          </tbody></table> : <div className="empty">Nenhum registro.</div>}
      </div>
    </>
  );
}
