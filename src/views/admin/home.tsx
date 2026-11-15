import Link from "next/link";
import { asc, desc, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/db/schema";
import { getSystem, requireAdmin } from "@/lib/context";
import { Check, Field, Form, Submit } from "@/components/Form";
import { UserTable } from "@/components/UserTable";
import { updateSystemAction } from "@/server/admin-actions";
import { createUserAction } from "@/server/user-actions";
import { fmtDateTime } from "@/lib/format";
import { onlineSessions, usageOf } from "@/lib/limits";
import { OnlineTable, PlanBars } from "@/components/PlanUsage";
import { MODULES } from "@/lib/modules";
import { daysToBlock, licenseBlock } from "@/lib/license";
import { todayIso } from "@/lib/session-core";
import { consoleHref } from "@/lib/console-path";
import { fmtD } from "@/lib/dates";

/** Início do console: licença, bloqueio, módulos e plano da escola, usuários e histórico. */
export async function ConsoleHome() {
  const s = await requireAdmin();
  const t = await getSystem();
  const [us, usage, online, events] = await Promise.all([
    db.select().from(users).where(ne(users.role, "SUPER_ADMIN")).orderBy(asc(users.name)),
    usageOf(), onlineSessions(),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(25),
  ]);
  const lic = { status: t.status, paidUntil: t.paidUntil, graceDays: t.graceDays };
  const block = licenseBlock(lic, todayIso());
  const left = daysToBlock(lic, todayIso());
  return (
    <>
      <div className="ph"><div><h1>Olá, {s.user.name.split(" ")[0]}.</h1><p>{t.name}: licença, bloqueio, módulos liberados e usuários do sistema da escola.</p></div></div>
      {block ? <div className="alert bad">Acesso da escola bloqueado agora: {block.reason === "SUSPENDED" ? "suspenso manualmente" : `licença vencida em ${fmtD(t.paidUntil)} (tolerância de ${t.graceDays} dias encerrada)`}. Os usuários veem a tela “Acesso suspenso”.</div>
        : left != null && left <= 10 ? <div className="alert warn">A licença vence em {fmtD(t.paidUntil)}: o bloqueio automático acontece em {left} {left === 1 ? "dia" : "dias"}.</div> : null}
      <div className="grid2">
        <section className="panel"><h2>Licença, bloqueio e módulos</h2><div className="pb">
          <Form action={updateSystemAction}>
            <Field name="nome" label="Nome da instituição" defaultValue={t.name} required full />
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
          <section className="panel"><h2>Adicionar usuário da escola</h2><div className="pb">
            <Form action={createUserAction}>
              <Field name="nome" label="Nome" required full />
              <Field name="email" label="E-mail" type="email" required />
              <Field name="papel" label="Nível de acesso" options={[["USER", "Usuário"], ["ADMIN", "Administrador"]]} defaultValue="ADMIN" />
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
      <h2 style={{ margin: "22px 0 10px" }}>Usuários da escola</h2>
      <UserTable users={us} hrefBase={consoleHref("/usuarios")} />
      <h2 style={{ margin: "22px 0 10px" }}>Atividade recente</h2>
      <div className="tbl">{events.length ? <table><thead><tr><th>Quando</th><th>Evento</th><th>Área</th><th>Quem</th><th>IP</th></tr></thead>
        <tbody>{events.map((a) => <tr key={a.id}><td className="code">{fmtDateTime(a.createdAt)}</td><td>{a.action}</td><td>{a.area === "CONSOLE" ? "Console" : "Escola"}</td><td>{a.userEmail ?? "—"}</td><td>{a.ip}</td></tr>)}</tbody></table>
        : <div className="empty">Nada registrado ainda.</div>}</div>
      <p className="muted" style={{ fontSize: 12.5 }}><Link href={consoleHref("/auditoria")}>Ver todo o histórico na auditoria ›</Link></p>
    </>
  );
}
