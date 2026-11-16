import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { Sel } from "@/components/SearchPicker";
import { page, type PageCtx } from "@/lib/access";
import * as E from "@/db/erp";
import { Empty, Kpi, PageHead, Panel } from "@/components/ui";
import { ActionButton, FilterBar, FilterTabs } from "@/components/client";
import { Icon } from "@/components/Icon";
import { BankButtons, DeleteEntryButton, NewTitleButton, PayButton, TitlesTable, type FinOpts, type TitleRow } from "@/components/FinanceUI";
import { ImportWizard, TuitionForm } from "@/components/FinanceTools";
import { accountBalances, lookupsFin, weeklyFlow } from "@/server/finance-queries";
import { undoImportAction } from "@/server/finance-actions";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { addDays, fmtD, fmtDM, isDate, today } from "@/lib/dates";
import { VBars } from "@/components/Charts";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 64);

export async function finOpts(s: PageCtx): Promise<FinOpts & { raw: Awaited<ReturnType<typeof lookupsFin>> }> {
  const raw = await s.tx(lookupsFin);
  const gname = new Map(raw.groups.map((g) => [g.id, g.name]));
  const gpos = new Map(raw.groups.map((g) => [g.id, g.position]));
  return {
    raw,
    companies: raw.companies.filter((c) => c.active).map((c) => [c.id, c.name]),
    accounts: raw.accounts.filter((a) => a.active).map((a) => [a.id, a.name, a.companyId]),
    categories: raw.categories.filter((c) => c.active).sort((a, b) => (gpos.get(a.groupId)! - gpos.get(b.groupId)!) || a.name.localeCompare(b.name, "pt-BR")).map((c) => [c.id, c.name, gname.get(c.groupId) ?? "", c.kind]),
    methods: raw.methods.filter((m) => m.active).map((m) => [m.id, m.n]),
    situations: raw.situations.filter((x) => x.active).map((x) => [x.id, x.name]),
  };
}

const CompanyFilter = ({ o, value }: { o: FinOpts; value?: string }) => o.companies.length > 1
  ? <select name="emp" defaultValue={value ?? ""} aria-label="Empresa"><option value="">Todas as empresas</option>{o.companies.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : null;

// ------------------------------------------------------------------------------------
// Contas a receber e a pagar
// ------------------------------------------------------------------------------------
export async function TitlesPage({ kind, searchParams }: { kind: "RECEBER" | "PAGAR"; searchParams: Promise<SP> }) {
  const s = await page("financeiro");
  const spr = await searchParams;
  const sp = Object.fromEntries(Object.entries(spr).map(([k, v]) => [k, one(v)])) as Record<string, string | undefined>;
  const R = kind === "RECEBER";
  const st = sp.st ?? (sp.id ? "todas" : "aberto");
  const hoje = today();
  const o = await finOpts(s);
  const c: SQL[] = [eq(E.finTitles.kind, kind)];
  if (st === "aberto") c.push(eq(E.finTitles.status, "ABERTO"));
  else if (st === "vencido") c.push(sql`${E.finTitles.status} = 'ABERTO' and ${E.finTitles.dueDate} < ${hoje}`);
  else if (st === "pago") c.push(eq(E.finTitles.status, "PAGO"));
  else if (st === "cancelado") c.push(eq(E.finTitles.status, "CANCELADO"));
  if (sp.q) { const q = `%${sp.q.trim().slice(0, 80)}%`; c.push(or(ilike(E.finTitles.description, q), ilike(E.finTitles.document, q), ilike(E.people.name, q), ilike(E.students.name, q))!); }
  if (sp.emp) c.push(eq(E.finTitles.companyId, sp.emp));
  if (sp.cat) c.push(eq(E.finTitles.categoryId, sp.cat));
  if (sp.de && isDate(sp.de)) c.push(gte(E.finTitles.dueDate, sp.de));
  if (sp.ate && isDate(sp.ate)) c.push(lte(E.finTitles.dueDate, sp.ate));
  if (sp.sit) c.push(eq(E.finTitles.situationId, sp.sit));
  if (sp.forma) c.push(eq(E.finTitles.paymentMethodId, sp.forma));
  if (sp.conta) c.push(eq(E.finTitles.bankAccountId, sp.conta));
  if (sp.origem) c.push(eq(E.finTitles.originType, sp.origem));
  if (sp.comp && /^\d{4}-\d{2}$/.test(sp.comp)) c.push(eq(E.finTitles.competence, sp.comp));
  if (sp.id) { c.length = 1; c.push(eq(E.finTitles.id, sp.id)); }
  const d = await s.tx(async (tx) => {
    const rows = await tx.select({ t: E.finTitles, p: E.people.name, al: E.students.name, emp: E.companies.name }).from(E.finTitles)
      .innerJoin(E.companies, eq(E.companies.id, E.finTitles.companyId)).leftJoin(E.people, eq(E.people.id, E.finTitles.personId)).leftJoin(E.students, eq(E.students.id, E.finTitles.studentId))
      .where(and(...c)).orderBy(st === "pago" ? desc(E.finTitles.paidAt) : asc(E.finTitles.dueDate)).limit(1000);
    const mesIni = hoje.slice(0, 8) + "01";
    const [k] = await tx.select({
      aberto: sql<string>`coalesce(sum(amount) filter (where status = 'ABERTO'), 0)::text`,
      vencido: sql<string>`coalesce(sum(amount) filter (where status = 'ABERTO' and due_date < ${hoje}), 0)::text`,
      d30: sql<string>`coalesce(sum(amount) filter (where status = 'ABERTO' and due_date between ${hoje} and ${addDays(hoje, 30)}), 0)::text`,
      mes: sql<string>`coalesce(sum(paid_amount) filter (where status = 'PAGO' and paid_at >= ${mesIni}), 0)::text`,
    }).from(E.finTitles).where(and(eq(E.finTitles.kind, kind), sp.emp ? eq(E.finTitles.companyId, sp.emp) : sql`true`));
    return { rows, k };
  });
  const sit = new Map(o.raw.situations.map((x) => [x.id, x]));
  const cat = new Map(o.raw.categories.map((x) => [x.id, x.name]));
  const showPaid = st === "pago" || st === "todas";
  const moreActive = ["sit", "forma", "conta", "origem", "comp"].filter((x) => sp[x]).length;
  const qs = new URLSearchParams(Object.entries({ ...sp, st }).filter(([, v]) => v) as [string, string][]);
  const rows: TitleRow[] = d.rows.map(({ t, p, al, emp }) => ({
    id: t.id, kind, companyId: t.companyId, description: t.description, document: t.document ?? "", personId: t.personId ?? "", personName: p ?? "", studentId: t.studentId ?? "", studentName: al ?? "",
    categoryId: t.categoryId ?? "", issueDate: t.issueDate ?? "", dueDate: t.dueDate, amount: Number(t.amount), paymentMethodId: t.paymentMethodId ?? "", situationId: t.situationId ?? "",
    invoice: (t.invoice ?? "") as TitleRow["invoice"], notes: t.notes ?? "", status: t.status, paidAt: t.paidAt, paidAmount: t.paidAmount == null ? null : Number(t.paidAmount), bankAccountId: t.bankAccountId,
    originType: t.originType, installment: t.installment, competence: t.competence,
    person: p ?? "", student: al ?? "", company: emp, category: t.categoryId ? cat.get(t.categoryId) ?? "" : "",
    situation: t.situationId && sit.get(t.situationId) ? { name: sit.get(t.situationId)!.name, color: sit.get(t.situationId)!.color } : null, late: t.status === "ABERTO" && t.dueDate < hoje,
  }));
  return (
    <>
      <PageHead title={R ? "Contas a receber" : "Contas a pagar"}
        actions={<><a className="btn" href={`/api/export/${R ? "fin-receber" : "fin-pagar"}?${qs}`}><Icon name="download" size={16} /> Exportar CSV</a>{s.edit && <NewTitleButton kind={kind} o={o} label={R ? "Nova conta a receber" : "Nova conta a pagar"} />}</>} />
      <div className="kpis k4 money">
        <Kpi value={fmtMoney(d.k.aberto)} label="Em aberto" />
        <Kpi value={fmtMoney(d.k.vencido)} label={R ? "Vencido (inadimplência)" : "Vencido"} alert={Number(d.k.vencido) > 0} />
        <Kpi value={fmtMoney(d.k.d30)} label="Vence em 30 dias" />
        <Kpi value={fmtMoney(d.k.mes)} label={R ? "Recebido no mês" : "Pago no mês"} />
      </div>
      <FilterBar moreActive={moreActive} right={<span className="count">{d.rows.length} lançamentos</span>}
        tabs={<FilterTabs name="st" value={st === "aberto" ? "" : st} options={[{ v: "", label: "Em aberto" }, { v: "vencido", label: "Vencidas" }, { v: "pago", label: R ? "Recebidas" : "Pagas" }, { v: "cancelado", label: "Canceladas" }, { v: "todas", label: "Todas" }]} />}
        more={<>
          <Sel name="sit" defaultValue={sp.sit ?? ""} aria-label="Situação"><option value="">Qualquer situação</option>{o.situations.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
          <Sel name="forma" defaultValue={sp.forma ?? ""} aria-label="Forma"><option value="">Qualquer forma</option>{o.methods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
          <Sel name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta"><option value="">Qualquer conta</option>{o.accounts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
          <select name="origem" defaultValue={sp.origem ?? ""} aria-label="Origem"><option value="">Qualquer origem</option><option value="MANUAL">Lançamento manual</option>{R && <option value="MENSALIDADE">Mensalidades</option>}<option value="IMPORTACAO">Importação</option></select>
          {R && <label className="fl">Competência <input type="month" name="comp" defaultValue={sp.comp ?? ""} /></label>}
        </>}>
        <div className="search"><Icon name="search" size={16} /><input type="search" name="q" defaultValue={sp.q ?? ""} placeholder={R ? "Descrição, documento, aluno ou responsável" : "Descrição, documento ou favorecido"} aria-label="Buscar" /></div>
        <CompanyFilter o={o} value={sp.emp} />
        <Sel name="cat" defaultValue={sp.cat ?? ""} aria-label="Categoria"><option value="">Todas as categorias</option>{o.categories.filter(([v, , , k]) => k === kind || v === sp.cat).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
        <label className="fl">Vence de <input type="date" name="de" defaultValue={sp.de ?? ""} /></label>
        <label className="fl">até <input type="date" name="ate" defaultValue={sp.ate ?? ""} /></label>
      </FilterBar>
      <div className="tbl">
        {rows.length ? <TitlesTable R={R} showPaid={showPaid} canEdit={s.edit} o={o} openId={sp.id} rows={rows} />
          : <Empty title="Nenhum lançamento neste filtro">Ajuste os filtros ou crie um lançamento.</Empty>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------
// Extrato (como a planilha de cada banco: Data, Descrição, Entrada, Saída, Classificação, Nota)
// ------------------------------------------------------------------------------------
export async function StatementPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await page("financeiro");
  const spr = await searchParams;
  const sp = Object.fromEntries(Object.entries(spr).map(([k, v]) => [k, one(v)])) as Record<string, string | undefined>;
  const o = await finOpts(s);
  const accId = sp.conta ?? o.raw.accounts.find((a) => a.active)?.id ?? "";
  const de = sp.de && isDate(sp.de) ? sp.de : today().slice(0, 8) + "01";
  const ate = sp.ate && isDate(sp.ate) ? sp.ate : today();
  const acc = o.raw.accounts.find((a) => a.id === accId);
  const emp = acc ? o.raw.companies.find((c) => c.id === acc.companyId) : null;
  const d = acc ? await s.tx(async (tx) => {
    const before = (await accountBalances(tx, addDays(de, -1))).find((a) => a.id === accId)?.balance ?? Number(acc.initialBalance);
    const tits = await tx.select({ t: E.finTitles, c: E.finCategories.name }).from(E.finTitles).leftJoin(E.finCategories, eq(E.finCategories.id, E.finTitles.categoryId))
      .where(and(eq(E.finTitles.bankAccountId, accId), eq(E.finTitles.status, "PAGO"), gte(E.finTitles.paidAt, de), lte(E.finTitles.paidAt, ate), acc.initialDate ? gte(E.finTitles.paidAt, acc.initialDate) : sql`true`));
    const ents = await tx.select().from(E.bankEntries).where(and(eq(E.bankEntries.bankAccountId, accId), gte(E.bankEntries.date, de), lte(E.bankEntries.date, ate), acc.initialDate ? gte(E.bankEntries.date, acc.initialDate) : sql`true`));
    const lines = [
      ...tits.map(({ t, c }) => ({ id: t.id, entry: false, date: t.paidAt!, cat: c ?? "Sem categoria", desc: t.description, nota: t.invoice === "COM" ? "C/NF" : t.invoice === "SEM" ? "S/NF" : "", v: (t.kind === "RECEBER" ? 1 : -1) * Number(t.paidAmount), href: `/financeiro/${t.kind === "RECEBER" ? "receber" : "pagar"}?id=${t.id}` })),
      ...ents.map((e) => ({ id: e.id, entry: true, date: e.date, cat: e.transferId ? "Transferência entre contas" : "Ajuste de saldo", desc: e.description, nota: "", v: Number(e.amount), href: "" })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let run = before;
    return { before, lines: lines.map((l) => ({ ...l, bal: (run += l.v) })) };
  }) : null;
  const ent = d ? d.lines.filter((l) => l.v > 0).reduce((a, l) => a + l.v, 0) : 0;
  const sai = d ? d.lines.filter((l) => l.v < 0).reduce((a, l) => a - l.v, 0) : 0;
  return (
    <>
      <PageHead title="Extrato"
        actions={<>{acc && <a className="btn" href={`/api/export/fin-extrato?conta=${accId}&de=${de}&ate=${ate}`}><Icon name="download" size={16} /> Exportar CSV</a>}
          {s.edit && acc && <BankButtons accountId={accId} accounts={o.accounts.map(([a, b]) => [a, b])} />}
          {s.edit && <NewTitleButton kind="PAGAR" o={o} label="Nova saída" primary={false} />}{s.edit && <NewTitleButton kind="RECEBER" o={o} label="Nova entrada" />}</>} />
      <FilterBar right={acc && <span className="count">{d?.lines.length ?? 0} movimentos</span>}>
        <Sel name="conta" defaultValue={accId} aria-label="Conta">{o.raw.companies.map((c) => <optgroup key={c.id} label={c.name}>{o.raw.accounts.filter((a) => a.companyId === c.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}</Sel>
        <label className="fl">De <input type="date" name="de" defaultValue={de} /></label>
        <label className="fl">até <input type="date" name="ate" defaultValue={ate} /></label>
      </FilterBar>
      {acc && d ? (
        <>
          <div className="kpis k4 money">
            <Kpi value={fmtMoney(ent)} label="Entradas no período" />
            <Kpi value={fmtMoney(sai)} label="Saídas no período" />
            <Kpi value={fmtMoney(ent - sai)} label="Resultado do período" alert={ent - sai < 0} />
            <Kpi value={fmtMoney(d.before + ent - sai)} label={`Saldo em ${fmtD(ate)} · ${emp?.name ?? ""}`} alert={d.before + ent - sai < 0} />
          </div>
          <div className="tbl">
            <table><thead><tr><th>Data</th><th>Descrição</th><th className="num">Entrada</th><th className="num">Saída</th><th>Classificação</th><th>Nota</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr><td className="code">{fmtD(addDays(de, -1))}</td><td colSpan={5}><b>Saldo anterior</b></td><td className="num"><b>{fmtMoney(d.before)}</b></td></tr>
                {d.lines.map((l) => (
                  <tr key={l.id}><td className="code">{fmtD(l.date)}</td><td style={{ fontSize: 12.5 }}>{l.cat}</td>
                    <td className="num t-ok">{l.v > 0 ? fmtMoney(l.v) : ""}</td><td className="num t-bad">{l.v < 0 ? fmtMoney(-l.v) : ""}</td>
                    <td className="desc">{l.href ? <a href={l.href} style={{ color: "inherit" }}>{l.desc}</a> : l.desc}{l.entry && s.edit && <span className="mini-acts"><DeleteEntryButton id={l.id} /></span>}</td>
                    <td>{l.nota}</td><td className="num"><b className={l.bal < 0 ? "t-bad" : ""}>{fmtMoney(l.bal)}</b></td></tr>))}
              </tbody>
              <tfoot><tr><td colSpan={2}>Totais do período</td><td className="num">{fmtMoney(ent)}</td><td className="num">{fmtMoney(sai)}</td><td colSpan={2} /><td className="num">{fmtMoney(d.before + ent - sai)}</td></tr></tfoot></table>
          </div>
        </>
      ) : <div className="panel"><Empty title="Cadastre uma conta">Em Financeiro › Configurações › Contas e caixas.</Empty></div>}
    </>
  );
}

// ------------------------------------------------------------------------------------
// Fluxo de caixa previsto
// ------------------------------------------------------------------------------------
export async function CashFlowPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await page("financeiro");
  const sp = await searchParams;
  const nn = Number(one(sp.n));
  const n = [4, 8, 13, 26].includes(nn) ? nn : 8;
  const emp = one(sp.emp);
  const hoje = today();
  const o = await finOpts(s);
  const d = await s.tx(async (tx) => ({
    flow: await weeklyFlow(tx, n, { companyId: emp }),
    accs: await accountBalances(tx),
    next: await tx.select({ t: E.finTitles, p: E.people.name, al: E.students.name }).from(E.finTitles).leftJoin(E.people, eq(E.people.id, E.finTitles.personId)).leftJoin(E.students, eq(E.students.id, E.finTitles.studentId))
      .where(and(eq(E.finTitles.status, "ABERTO"), emp ? eq(E.finTitles.companyId, emp) : sql`true`)).orderBy(asc(E.finTitles.dueDate)).limit(12),
  }));
  const ws = d.flow.weeks;
  const e = ws.reduce((a, w) => a + w.e, 0), sa = ws.reduce((a, w) => a + w.s, 0);
  const fim = ws[ws.length - 1]?.saldo ?? d.flow.start;
  const minS = Math.min(...ws.map((w) => w.saldo));
  const comp = new Map(o.raw.companies.map((c) => [c.id, c.name]));
  return (
    <>
      <PageHead title="Fluxo de caixa previsto" />
      <FilterBar tabs={<FilterTabs name="n" value={n === 8 ? "" : String(n)} options={[{ v: "4", label: "4 semanas" }, { v: "", label: "8 semanas" }, { v: "13", label: "3 meses" }, { v: "26", label: "6 meses" }]} />}>
        <CompanyFilter o={o} value={emp} />
      </FilterBar>
      <div className="kpis k5 money">
        <Kpi value={fmtMoney(d.flow.start)} label="Saldo em contas hoje" />
        <Kpi value={fmtMoney(e)} label="Entradas previstas" />
        <Kpi value={fmtMoney(sa)} label="Saídas previstas" />
        <Kpi value={fmtMoney(fim)} label="Saldo no fim do período" alert={fim < 0} />
        <Kpi value={fmtMoney(minS)} label="Menor saldo no período" alert={minS < 0} />
      </div>
      <div className="dgrid">
        <Panel className="span2" title="Entradas e saídas previstas" sub="por semana"><div className="pb"><VBars labels={ws.map((w) => fmtDM(w.ini))} sets={[{ n: "Entradas", c: "var(--brand)", v: ws.map((w) => w.e) }, { n: "Saídas", c: "var(--ink)", v: ws.map((w) => w.s) }]} /></div></Panel>
        <Panel className="span2" title="Semana a semana"><div className="pb">
          <table className="fl-tab"><thead><tr><th>Semana</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Resultado</th><th className="num">Saldo projetado</th></tr></thead>
            <tbody>{ws.map((w, i) => <tr key={i}><td>{fmtDM(w.ini)} a {fmtDM(w.fim)}{i === 0 && <span className="muted"> (inclui vencidos)</span>}</td><td className="num t-ok">{fmtMoney(w.e)}</td><td className="num t-bad">{fmtMoney(w.s)}</td>
              <td className={`num${w.res < 0 ? " t-bad" : ""}`}>{fmtMoney(w.res)}</td><td className="num"><b className={w.saldo < 0 ? "t-bad" : ""}>{fmtMoney(w.saldo)}</b></td></tr>)}</tbody></table>
        </div></Panel>
        <Panel title="Saldo por conta"><div className="pb"><table className="fl-tab"><tbody>{d.accs.filter((a) => a.active && (!emp || a.companyId === emp)).map((a) => <tr key={a.id}><td><a href={`/financeiro/extrato?conta=${a.id}`}>{a.name}</a><div className="t-sub">{comp.get(a.companyId)}</div></td><td className="num"><b className={a.balance < 0 ? "t-bad" : ""}>{fmtMoney(a.balance)}</b></td></tr>)}</tbody></table></div></Panel>
        <Panel title="Próximos vencimentos">
          <div className="tbl solo" style={{ border: 0, borderRadius: 0, maxHeight: "none" }}><table>
            <tbody>{d.next.map(({ t, p, al }) => <tr key={t.id}><td className={`code${t.dueDate < hoje ? " t-bad" : ""}`}>{fmtD(t.dueDate)}</td><td><span className={`badge ${t.kind === "RECEBER" ? "ok" : "bad"}`}>{t.kind === "RECEBER" ? "Receber" : "Pagar"}</span></td>
              <td className="ell">{t.description}{(al || p) && <div className="t-sub">{al || p}</div>}</td><td className="num"><b>{fmtMoney(t.amount)}</b></td>
              <td className="acts show">{s.edit && <PayButton o={o} t={{ id: t.id, kind: t.kind as "RECEBER", companyId: t.companyId, description: t.description, document: "", personId: "", studentId: "", categoryId: "", issueDate: "", dueDate: t.dueDate, amount: Number(t.amount), paymentMethodId: t.paymentMethodId ?? "", situationId: "", invoice: "", notes: "" }} />}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------
// Mensalidades
// ------------------------------------------------------------------------------------
export async function TuitionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await page("financeiro");
  const sp = await searchParams;
  const o = await finOpts(s);
  const hoje = today();
  const next = hoje.slice(8) > "20" ? addDays(hoje.slice(0, 8) + "28", 7).slice(0, 7) : hoje.slice(0, 7);
  const comp = /^\d{4}-\d{2}$/.test(one(sp.comp) ?? "") ? one(sp.comp)! : next;
  const d = await s.tx(async (tx) => {
    const st = await tx.execute<{ emp: string; ativos: number; total: string }>(sql`
      select c.name emp, count(*)::int ativos, coalesce(sum(greatest(s.monthly_fee - s.discount, 0)), 0)::text total
      from students s join companies c on c.id = s.company_id where s.status = 'ATIVO' group by 1 order by 1`);
    const gen = await tx.execute<{ status: string; late: boolean; n: number; v: string }>(sql`
      select status, (status = 'ABERTO' and due_date < ${hoje}) late, count(*)::int n, coalesce(sum(case when status = 'PAGO' then paid_amount else amount end), 0)::text v
      from fin_titles where origin_type = 'MENSALIDADE' and competence = ${comp} group by 1, 2`);
    return { st: st.rows, gen: gen.rows };
  });
  const base = o.raw.groups.find((g) => g.isBase);
  const defCat = o.raw.categories.find((c) => c.groupId === base?.id && c.active)?.id ?? "";
  const sum = (f: (r: (typeof d.gen)[number]) => boolean) => d.gen.filter(f).reduce((a, r) => ({ n: a.n + r.n, v: a.v + Number(r.v) }), { n: 0, v: 0 });
  const pago = sum((r) => r.status === "PAGO"), aberto = sum((r) => r.status === "ABERTO" && !r.late), venc = sum((r) => r.status === "ABERTO" && r.late);
  const [y, m] = comp.split("-");
  return (
    <>
      <PageHead title="Mensalidades" />
      <FilterBar><label className="fl">Competência <input type="month" name="comp" defaultValue={comp} /></label></FilterBar>
      <div className="kpis k4 money">
        <Kpi value={fmtMoney(pago.v)} label={`Recebidas (${pago.n})`} />
        <Kpi value={fmtMoney(aberto.v)} label={`A vencer (${aberto.n})`} />
        <Kpi value={fmtMoney(venc.v)} label={`Vencidas (${venc.n})`} alert={venc.v > 0} href={`/financeiro/receber?st=vencido&origem=MENSALIDADE&comp=${comp}`} />
        <Kpi value={pago.v + aberto.v + venc.v ? `${Math.round((pago.v / (pago.v + aberto.v + venc.v)) * 100)}%` : "—"} label={`Recebido de ${m}/${y}`} />
      </div>
      <div className="grid2">
        <Panel title="Gerar mensalidades">
          <div className="pb">{s.edit ? <TuitionForm competence={comp} companies={o.companies} categories={o.categories.filter(([, , , k]) => k === "RECEBER")} defaultCategory={defCat} /> : <p className="muted">Seu perfil só consulta o financeiro.</p>}</div>
        </Panel>
        <Panel title="Alunos ativos" sub="mensalidade líquida prevista">
          <div className="pb"><table className="fl-tab"><thead><tr><th>Empresa</th><th className="num">Alunos</th><th className="num">Total por mês</th></tr></thead>
            <tbody>{d.st.length ? d.st.map((r) => <tr key={r.emp}><td>{r.emp}</td><td className="num">{r.ativos}</td><td className="num"><b>{fmtMoney(r.total)}</b></td></tr>) : <tr><td colSpan={3} className="muted">Nenhum aluno ativo. Cadastre em Acadêmico › Alunos.</td></tr>}</tbody></table>
            <p style={{ marginTop: 12 }}><a href={`/financeiro/receber?st=todas&origem=MENSALIDADE&comp=${comp}`}>Ver as mensalidades de {m}/{y} em Contas a receber ›</a></p></div>
        </Panel>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------
// Importar planilha
// ------------------------------------------------------------------------------------
export async function ImportPage() {
  const s = await page("financeiro", { edit: true });
  const o = await finOpts(s);
  const imports = await s.tx((tx) => tx.select({ i: E.finImports, a: E.bankAccounts.name }).from(E.finImports).innerJoin(E.bankAccounts, eq(E.bankAccounts.id, E.finImports.bankAccountId)).orderBy(desc(E.finImports.createdAt)).limit(30));
  return (
    <>
      <PageHead title="Importar planilha de fluxo de caixa" />
      <Panel title="Nova importação"><div className="pb"><ImportWizard accounts={o.raw.companies.map((c) => ({ company: c.name, accounts: o.raw.accounts.filter((a) => a.companyId === c.id && a.active).map((a) => [a.id, a.name] as [string, string]) }))} /></div></Panel>
      <h2 style={{ margin: "22px 0 10px" }}>Importações feitas</h2>
      <div className="tbl">{imports.length ? (
        <table><thead><tr><th>Quando</th><th>Arquivo</th><th>Conta</th><th className="num">Movimentos</th><th className="num">Resultado</th><th>Por</th><th /></tr></thead>
          <tbody>{imports.map(({ i, a }) => <tr key={i.id}><td className="code">{fmtDateTime(i.createdAt)}</td><td className="desc">{i.fileName}</td><td>{a}</td><td className="num">{i.rows}</td><td className="num">{fmtMoney(i.total)}</td><td>{i.userName}</td>
            <td className="acts show"><ActionButton className="btn btn-sm" action={undoImportAction.bind(null, i.id)} confirm={`Desfazer a importação de "${i.fileName}"? Os ${i.rows} movimentos dela serão removidos.`}>Desfazer</ActionButton></td></tr>)}</tbody></table>
      ) : <Empty title="Nenhuma importação ainda" />}</div>
    </>
  );
}

