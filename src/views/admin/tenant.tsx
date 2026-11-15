import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, tenants, users } from "@/db/schema";
import { requireAdmin } from "@/lib/context";
import { Check, Field, Form, Hidden, Submit } from "@/components/Form";
import { UserTable } from "@/components/UserTable";
import { updateTenantAction } from "@/server/admin-actions";
import { createUserAction } from "@/server/user-actions";
import { fmtDateTime, tenantUrl } from "@/lib/format";
import { onlineSessions, usageOf } from "@/lib/limits";
import { OnlineTable, PlanBars } from "@/components/PlanUsage";
import { MODULES } from "@/lib/modules";
import { daysToBlock, licenseBlock } from "@/lib/license";
import { todayIso } from "@/lib/session-core";
import { fmtD } from "@/lib/dates";

export async function AdminTenant({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id.slice(0, 64))).limit(1);
  if (!t) notFound();
  const [us, usage, online, events] = await Promise.all([
    db.select().from(users).where(eq(users.tenantId, t.id)).orderBy(asc(users.name)),
    usageOf(t.id), onlineSessions(t.id),
    db.select().from(auditLogs).where(eq(auditLogs.tenantId, t.id)).orderBy(desc(auditLogs.createdAt)).limit(40),
  ]);
  const lic = { status: t.status, paidUntil: t.paidUntil, graceDays: t.graceDays };
  const block = licenseBlock(lic, todayIso());
  const left = daysToBlock(lic, todayIso());
  return (
    <>
      <div className="ph"><div><Link className="back" href="/clientes">‹ Clientes</Link><h1>{t.name}</h1>
        <p><a href={tenantUrl(t.slug)} target="_blank" rel="noopener noreferrer">{t.slug}.{process.env.ROOT_DOMAIN}</a> · criado em {fmtDateTime(t.createdAt)}</p></div></div>
      {block ? <div className="alert bad">Acesso bloqueado agora: {block.reason === "SUSPENDED" ? "suspenso manualmente" : `licença vencida em ${fmtD(t.paidUntil)} (tolerância de ${t.graceDays} dias encerrada)`}. Os usuários veem a tela “Acesso suspenso”.</div>
        : left != null && left <= 10 ? <div className="alert warn">A licença vence em {fmtD(t.paidUntil)}: o bloqueio automático acontece em {left} {left === 1 ? "dia" : "dias"}.</div> : null}
      <div className="grid2">
        <section className="panel"><h2>Licença, bloqueio e módulos</h2><div className="pb">
          <Form action={updateTenantAction}>
            <Hidden name="id" value={t.id} />
            <Field name="nome" label="Nome" defaultValue={t.name} required full />
            <div className="fld"><label htmlFor="f_slug_ro">Subdomínio</label><input id="f_slug_ro" value={t.slug} disabled readOnly /><small>Não muda depois de criado.</small></div>
            <Field name="documento" label="CNPJ" defaultValue={t.document} />
            <Field name="situacao" label="Situação" options={[["ACTIVE", "Liberado"], ["SUSPENDED", "Bloqueado (suspende o acesso na hora)"]]} defaultValue={t.status} full />
            <Field name="mensagem" label="Mensagem da tela “Acesso suspenso”" type="textarea" full maxLength={500} defaultValue={t.blockMessage}
              hint="Ex.: Identificamos pendência financeira. Fale com o fornecedor para regularizar." />
            <Field name="pago_ate" label="Licença paga até" type="date" defaultValue={t.paidUntil} hint="Vazio = sem vencimento." />
            <Field name="tolerancia" label="Tolerância (dias)" type="number" defaultValue={t.graceDays} hint="Depois do vencimento, bloqueia sozinho." />
            <div className="full"><h3 className="sec" style={{ margin: "6px 0 0" }}>Módulos liberados</h3></div>
            {MODULES.map(([k, l]) => <Check key={k} name={`mod_${k}`} label={l} defaultChecked={t.modules.includes(k)} />)}
            <div className="full"><h3 className="sec" style={{ margin: "6px 0 0" }}>Plano de usuários</h3></div>
            <Field name="max_usuarios" label="Usuários cadastrados (máximo)" type="number" defaultValue={t.maxUsers} placeholder="Sem limite" />
            <Field name="max_simultaneos" label="Usuários simultâneos (máximo)" type="number" defaultValue={t.maxSessions} placeholder="Sem limite" />
            <Field name="observacoes" label="Observações internas" type="textarea" defaultValue={t.notes} full maxLength={1000} />
            <div className="full form-foot"><Submit>Salvar</Submit></div>
          </Form>
        </div></section>
        <div>
          <section className="panel"><h2>Adicionar usuário</h2><div className="pb">
            <Form action={createUserAction}>
              <Hidden name="empresa" value={t.id} />
              <Field name="nome" label="Nome" required full />
              <Field name="email" label="E-mail" type="email" required />
              <Field name="papel" label="Nível de acesso" options={[["TENANT_USER", "Usuário"], ["TENANT_ADMIN", "Administrador"]]} defaultValue="TENANT_USER" />
              <div className="full form-foot"><Submit pending="Criando…">Criar usuário</Submit></div>
            </Form>
          </div></section>
          <section className="panel" style={{ marginTop: 18 }}><h2>Uso do plano</h2>
            <div className="pb"><PlanBars u={usage} /></div>
            <h3 className="sec" style={{ margin: "0 18px 8px" }}>Conectados agora</h3>
            <OnlineTable rows={online} />
          </section>
        </div>
      </div>
      <h2 style={{ margin: "22px 0 10px" }}>Usuários</h2>
      <UserTable users={us} hrefBase="/usuarios" />
      <h2 style={{ margin: "22px 0 10px" }}>Histórico de eventos</h2>
      <div className="tbl">{events.length ? <table><thead><tr><th>Quando</th><th>Evento</th><th>Quem</th><th>IP</th></tr></thead>
        <tbody>{events.map((a) => <tr key={a.id}><td className="code">{fmtDateTime(a.createdAt)}</td><td>{a.action}</td><td>{a.userEmail ?? "—"}</td><td>{a.ip}</td></tr>)}</tbody></table>
        : <div className="empty">Nada registrado ainda.</div>}</div>
      <p className="muted" style={{ fontSize: 12.5 }}><Link href={`/auditoria?empresa=${t.id}`}>Ver todo o histórico na auditoria ›</Link></p>
    </>
  );
}
