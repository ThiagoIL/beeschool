import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { page } from "@/lib/access";
import * as E from "@/db/erp";
import { Kpi, PageHead, Panel } from "@/components/ui";
import { accountBalances } from "@/server/finance-queries";
import { fmtMoney } from "@/lib/format";
import { addDays, fmtD, today } from "@/lib/dates";
import { daysToBlock } from "@/lib/license";

/** Início: números do dia (o que vence e o saldo), conforme o acesso de cada um. */
export async function AppHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await page(null);
  const sp = await searchParams;
  const fin = s.access.mods.financeiro !== "NONE";
  const hoje = today();
  const d = await s.tx(async (tx) => {
    const k = fin ? (await tx.execute<{ rv: string; rh: string; pv: string; ph: string; p7: string }>(sql`
      select coalesce(sum(amount) filter (where kind = 'RECEBER' and due_date < ${hoje}), 0)::text rv,
             coalesce(sum(amount) filter (where kind = 'RECEBER' and due_date = ${hoje}), 0)::text rh,
             coalesce(sum(amount) filter (where kind = 'PAGAR' and due_date < ${hoje}), 0)::text pv,
             coalesce(sum(amount) filter (where kind = 'PAGAR' and due_date = ${hoje}), 0)::text ph,
             coalesce(sum(amount) filter (where kind = 'PAGAR' and due_date between ${hoje} and ${addDays(hoje, 7)}), 0)::text p7
      from fin_titles where status = 'ABERTO'`)).rows[0] : null;
    const saldo = fin ? (await accountBalances(tx)).filter((a) => a.active).reduce((x, a) => x + a.balance, 0) : 0;
    const next = fin ? await tx.select({ t: E.finTitles, al: E.students.name, p: E.people.name }).from(E.finTitles).leftJoin(E.students, eq(E.students.id, E.finTitles.studentId)).leftJoin(E.people, eq(E.people.id, E.finTitles.personId))
      .where(and(eq(E.finTitles.status, "ABERTO"), sql`${E.finTitles.dueDate} <= ${addDays(hoje, 7)}`)).orderBy(asc(E.finTitles.dueDate)).limit(10) : [];
    return { k, saldo, next };
  });
  const left = daysToBlock({ status: s.system.status, paidUntil: s.system.paidUntil, graceDays: s.system.graceDays }, hoje);
  return (
    <>
      <PageHead title={`Olá, ${s.user.name.split(" ")[0]}.`} sub={`${s.system.name} · ${fmtD(hoje)}`} />
      {sp.erro && <div className="alert warn">{sp.erro.slice(0, 200)}</div>}
      {s.access.isAdmin && left != null && left <= 10 && <div className="alert warn">A licença do sistema vence em breve: o acesso será bloqueado em {left} {left === 1 ? "dia" : "dias"} se não for renovada.</div>}
      {fin && d.k && (
        <div className="kpis k5 money">
          <Kpi value={fmtMoney(d.saldo)} label="Saldo nas contas hoje" href="/financeiro/fluxo" alert={d.saldo < 0} />
          <Kpi value={fmtMoney(d.k.rh)} label="A receber hoje" href={`/financeiro/receber?de=${hoje}&ate=${hoje}`} />
          <Kpi value={fmtMoney(d.k.rv)} label="Recebimentos vencidos" href="/financeiro/receber?st=vencido" alert={Number(d.k.rv) > 0} />
          <Kpi value={fmtMoney(d.k.ph)} label="A pagar hoje" href={`/financeiro/pagar?de=${hoje}&ate=${hoje}`} alert={Number(d.k.ph) > 0} />
          <Kpi value={fmtMoney(d.k.pv)} label="Pagamentos vencidos" href="/financeiro/pagar?st=vencido" alert={Number(d.k.pv) > 0} />
        </div>
      )}
      <div className="dgrid">
        {fin && (
          <Panel className="span2" title="Vence nos próximos 7 dias" sub={d.k ? `${fmtMoney(d.k.p7)} a pagar` : undefined}>
            <div className="tbl solo" style={{ border: 0, borderRadius: 0 }}>{d.next.length ? <table><tbody>{d.next.map(({ t, al, p }) => (
              <tr key={t.id}><td className={`code${t.dueDate < hoje ? " t-bad" : ""}`}>{fmtD(t.dueDate)}</td><td><span className={`badge ${t.kind === "RECEBER" ? "ok" : "bad"}`}>{t.kind === "RECEBER" ? "Receber" : "Pagar"}</span></td>
                <td className="ell"><Link href={`/financeiro/${t.kind === "RECEBER" ? "receber" : "pagar"}?id=${t.id}`} style={{ color: "inherit" }}>{t.description}</Link>{(al || p) && <div className="t-sub">{al || p}</div>}</td><td className="num"><b>{fmtMoney(t.amount)}</b></td></tr>))}</tbody></table>
              : <div className="empty">Nada vencendo nos próximos dias.</div>}</div>
          </Panel>
        )}
      </div>
    </>
  );
}
