"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PickField, Sel } from "./SearchPicker";
import { Icon } from "./Icon";
import { MoneyInput, Modal, parseMoney, useRun } from "./client";
import { cancelTitleAction, deleteBankEntryAction, deleteTitleAction, payTitleAction, reversePaymentAction, saveBankEntryAction, saveTitleAction, transferAction } from "@/server/finance-actions";
import { searchPeopleAction, searchStudentsAction } from "@/server/search-actions";
import { fmtD, today, addDays } from "@/lib/dates";

type Opt = [string, string];
/** Opções dos formulários. Contas trazem a empresa; categorias trazem o grupo da DRE e o tipo (RECEBER/PAGAR). */
export type FinOpts = { companies: Opt[]; accounts: [string, string, string][]; categories: [string, string, string, string][]; methods: Opt[]; situations: Opt[] };
export type Title = {
  id?: string; kind: "RECEBER" | "PAGAR"; companyId: string; description: string; document: string; personId: string; personName?: string; studentId: string; studentName?: string;
  categoryId: string; issueDate: string; dueDate: string; amount: number; paymentMethodId: string; situationId: string; invoice: "" | "COM" | "SEM"; notes: string;
  status?: string; paidAt?: string | null; paidAmount?: number | null; bankAccountId?: string | null; originType?: string; installment?: string | null; competence?: string | null;
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Categorias do tipo do lançamento (receita no a receber, despesa no a pagar), agrupadas pelo grupo da DRE.
 * É uma função (não um componente) porque o `Sel` só enxerga <option>/<optgroup> diretos nos filhos.
 * A categoria já gravada no lançamento continua na lista mesmo que seja do outro tipo.
 */
function categoryOptions(cats: FinOpts["categories"], kind: "RECEBER" | "PAGAR", current: string) {
  const m = new Map<string, Opt[]>();
  for (const [id, n, g, k] of cats) if (k === kind || id === current) m.set(g, [...(m.get(g) ?? []), [id, n]]);
  return [...m].map(([g, list]) => <optgroup key={g} label={g}>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>);
}

export function TitleModal({ t, o, onClose }: { t: Title; o: FinOpts; onClose: () => void }) {
  const [d, setD] = useState(t);
  const [rep, setRep] = useState(1);
  const [paid, setPaid] = useState(false);
  const [paidAt, setPaidAt] = useState(today());
  const accs = o.accounts.filter(([, , c]) => c === d.companyId);
  const [acc, setAcc] = useState("");
  const { run, pending } = useRun();
  const R = d.kind === "RECEBER";
  const isPaid = d.status === "PAGO";
  const set = (p: Partial<Title>) => setD({ ...d, ...p });
  useEffect(() => { if (!accs.some(([v]) => v === acc)) setAcc(accs[0]?.[0] ?? ""); }, [d.companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => run(() => saveTitleAction({
    id: d.id, kind: d.kind, companyId: d.companyId, description: d.description, document: d.document, personId: d.personId, studentId: d.studentId, categoryId: d.categoryId,
    issueDate: d.issueDate, dueDate: paid ? paidAt : d.dueDate, amount: d.amount, paymentMethodId: d.paymentMethodId, situationId: d.situationId, invoice: d.invoice || null, notes: d.notes,
    repeat: rep, paidNow: !d.id && paid ? { paidAt, bankAccountId: acc } : null,
  }), onClose);
  return (
    <Modal title={d.id ? (R ? "Conta a receber" : "Conta a pagar") : R ? "Nova entrada" : "Nova saída"} size="wide" onClose={onClose}
      foot={<>
        {d.id && d.status === "ABERTO" && d.originType !== "MENSALIDADE" && <button type="button" className="btn btn-danger left" disabled={pending} onClick={() => { if (confirm("Excluir este lançamento?")) run(() => deleteTitleAction(d.id!), onClose); }}><Icon name="trash" size={16} /> Excluir</button>}
        {d.id && d.status === "ABERTO" && <button type="button" className={`btn${d.originType === "MENSALIDADE" ? " left" : ""}`} disabled={pending} onClick={() => { if (confirm("Cancelar este lançamento? Ele deixa de contar no fluxo de caixa.")) run(() => cancelTitleAction(d.id!), onClose); }}>Cancelar lançamento</button>}
        {d.id && d.status === "CANCELADO" && <button type="button" className="btn left" disabled={pending} onClick={() => run(() => cancelTitleAction(d.id!, true), onClose)}>Reativar</button>}
        {isPaid && <button type="button" className="btn left" disabled={pending} onClick={() => { if (confirm("Estornar a baixa? O lançamento volta para em aberto e sai do extrato.")) run(() => reversePaymentAction(d.id!), onClose); }}>Estornar {R ? "recebimento" : "pagamento"}</button>}
        <button type="button" className="btn" onClick={onClose}>Fechar</button>
        {d.status !== "CANCELADO" && <button type="button" className="btn btn-primary" disabled={pending || (paid && !acc)} onClick={save}>Salvar</button>}
      </>}>
      {d.originType === "MENSALIDADE" && <div className="infoline">Mensalidade gerada {d.competence ? `(competência ${d.competence.slice(5)}/${d.competence.slice(0, 4)})` : ""}.</div>}
      {d.originType === "IMPORTACAO" && <div className="infoline">Movimento importado de planilha.</div>}
      {isPaid && <div className="infoline ok">{R ? "Recebido" : "Pago"} em {fmtD(d.paidAt)} · {brl(d.paidAmount ?? d.amount)} · {o.accounts.find(([v]) => v === d.bankAccountId)?.[1] ?? ""}. Para mudar valor, conta ou empresa, estorne a baixa.</div>}
      <div className="form">
        <div className="fld full"><label htmlFor="t_d">Descrição <span className="req">*</span></label><input id="t_d" value={d.description} maxLength={200} onChange={(e) => set({ description: e.target.value })} autoFocus={!d.id} placeholder={R ? "Ex.: Matrícula 2027 — Enzo" : "Ex.: Energia elétrica outubro"} /></div>
        <div className="fld"><label htmlFor="t_emp">Empresa <span className="req">*</span></label>
          <select id="t_emp" value={d.companyId} disabled={isPaid} onChange={(e) => set({ companyId: e.target.value })}>{o.companies.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="fld"><label htmlFor="t_c">Categoria</label><Sel id="t_c" value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}><option value="">Sem categoria</option>{categoryOptions(o.categories, d.kind, d.categoryId)}</Sel></div>
        <div className="fld"><label htmlFor="t_v">Valor <span className="req">*</span></label><MoneyInput id="t_v" value={d.amount} disabled={isPaid} min={0} onChange={(v) => set({ amount: v })} /></div>
        {!paid && <div className="fld"><label htmlFor="t_ve">Vencimento <span className="req">*</span></label><input id="t_ve" type="date" value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></div>}
        <PickField id="t_p" label={R ? "Responsável / pagador" : "Fornecedor / favorecido"} value={d.personId ? { id: d.personId, label: d.personName ?? "" } : null}
          onChange={(r) => set({ personId: r?.id ?? "", personName: r?.label })} picker={{ title: "Pesquisar pessoa", fetcher: searchPeopleAction, placeholder: "Nome, CPF/CNPJ, e-mail ou telefone", columns: ["Nome", "Tipo", "CPF/CNPJ", "Telefone"] }} />
        {R && <PickField id="t_al" label="Aluno" value={d.studentId ? { id: d.studentId, label: d.studentName ?? "" } : null}
          onChange={(r) => set({ studentId: r?.id ?? "", studentName: r?.label, ...(r?.data?.guardianId && !d.personId ? { personId: r.data.guardianId } : {}), ...(r?.data?.companyId && !isPaid ? { companyId: r.data.companyId } : {}) })}
          picker={{ title: "Pesquisar aluno", fetcher: searchStudentsAction, placeholder: "Nome do aluno ou código Proesc", columns: ["Aluno", "Turma", "Responsável", "Situação"] }} />}
        <div className="fld"><label htmlFor="t_doc">Documento</label><input id="t_doc" value={d.document} maxLength={60} onChange={(e) => set({ document: e.target.value })} placeholder="NF, boleto, contrato…" /></div>
        <div className="fld"><label htmlFor="t_nf">Nota fiscal</label><select id="t_nf" value={d.invoice} onChange={(e) => set({ invoice: e.target.value as Title["invoice"] })}><option value="">—</option><option value="COM">Com nota (C/NF)</option><option value="SEM">Sem nota (S/NF)</option></select></div>
        <div className="fld"><label htmlFor="t_f">Forma de pagamento</label><Sel id="t_f" value={d.paymentMethodId} onChange={(e) => set({ paymentMethodId: e.target.value })}><option value="">—</option>{o.methods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel></div>
        {!isPaid && <div className="fld"><label htmlFor="t_s">Situação interna</label><Sel id="t_s" value={d.situationId} onChange={(e) => set({ situationId: e.target.value })}><option value="">—</option>{o.situations.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel></div>}
        {!d.id && (
          <div className="fld full"><label className="chk"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Já {R ? "recebido" : "pago"} (registrar direto no extrato, como uma linha da planilha)</label></div>
        )}
        {!d.id && paid && <>
          <div className="fld"><label htmlFor="t_pd">Data do {R ? "recebimento" : "pagamento"}</label><input id="t_pd" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>
          <div className="fld"><label htmlFor="t_acc">Conta <span className="req">*</span></label><select id="t_acc" value={acc} onChange={(e) => setAcc(e.target.value)}>{accs.length ? accs.map(([v, l]) => <option key={v} value={v}>{l}</option>) : <option value="">Cadastre uma conta desta empresa</option>}</select></div>
        </>}
        {!d.id && !paid && <div className="fld"><label htmlFor="t_rep">Repetir mensalmente</label><input id="t_rep" type="number" min={1} max={60} value={rep} onChange={(e) => setRep(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} /><small>Meses, incluindo este. Para aluguel, energia, folha…</small></div>}
        <div className="fld full"><label htmlFor="t_o">Observações</label><textarea id="t_o" rows={2} maxLength={2000} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

export function PayModal({ t, o, onClose }: { t: Title; o: FinOpts; onClose: () => void }) {
  const R = t.kind === "RECEBER";
  const accs = o.accounts.filter(([, , c]) => c === t.companyId);
  const [f, setF] = useState({ paidAt: today(), amount: t.amount, account: accs[0]?.[0] ?? "", method: t.paymentMethodId });
  const { run, pending } = useRun();
  return (
    <Modal title={R ? "Registrar recebimento" : "Registrar pagamento"} size="narrow" onClose={onClose}
      foot={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={pending || !f.account}
        onClick={() => run(() => payTitleAction({ id: t.id!, paidAt: f.paidAt, paidAmount: f.amount, bankAccountId: f.account, paymentMethodId: f.method || null }), onClose)}>{R ? "Confirmar recebimento" : "Confirmar pagamento"}</button></>}>
      <p style={{ marginTop: 0 }}><b>{t.description}</b><br /><span className="muted">vence {fmtD(t.dueDate)} · {brl(t.amount)}</span></p>
      <div className="form">
        <div className="fld"><label htmlFor="b_d">Data</label><input id="b_d" type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></div>
        <div className="fld"><label htmlFor="b_v">Valor</label><MoneyInput id="b_v" value={f.amount} min={0} onChange={(v) => setF({ ...f, amount: v })} /><small>Com juros ou desconto, informe o valor efetivo.</small></div>
        <div className="fld full"><label htmlFor="b_c">Conta</label><select id="b_c" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>{accs.length ? accs.map(([v, l]) => <option key={v} value={v}>{l}</option>) : <option value="">Cadastre uma conta desta empresa</option>}</select></div>
        <div className="fld full"><label htmlFor="b_f">Forma</label><Sel id="b_f" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">—</option>{o.methods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel></div>
      </div>
    </Modal>
  );
}

export type TitleRow = Title & { person: string; student: string; category: string; company: string; situation: { name: string; color: string } | null; late: boolean };

/** Lista de contas: abre a edição ao clicar na linha e a baixa pelo botão. */
export function TitlesTable({ rows, o, R, showPaid, canEdit, openId }: { rows: TitleRow[]; o: FinOpts; R: boolean; showPaid: boolean; canEdit: boolean; openId?: string }) {
  const [edit, setEdit] = useState<Title | null>(null);
  const [pay, setPay] = useState<Title | null>(null);
  const router = useRouter(); const path = usePathname();
  useEffect(() => { if (openId) { const t = rows.find((r) => r.id === openId); if (t) setEdit(t); } }, [openId, rows]);
  const total = rows.filter((r) => r.status !== "CANCELADO").reduce((a, r) => a + r.amount, 0);
  const close = () => { setEdit(null); if (openId) router.replace(path, { scroll: false }); };
  return (
    <>
      <table>
        <thead><tr><th>Vencimento</th><th>Descrição</th><th>{R ? "Aluno / responsável" : "Favorecido"}</th><th>Categoria</th><th data-hide>Empresa</th><th className="num">Valor</th><th>Situação</th>{showPaid && <th>{R ? "Recebido em" : "Pago em"}</th>}<th><span className="sr">Ações</span></th></tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id} className="click" style={t.status === "CANCELADO" ? { opacity: 0.55 } : undefined} onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) setEdit(t); }}>
            <td className={`code${t.late ? " t-bad" : ""}`}>{fmtD(t.dueDate)}</td>
            <td className="desc" style={{ minWidth: 200 }}>{t.description}{(t.document || t.installment) && <div className="t-sub">{[t.document, t.installment && `parcela ${t.installment}`].filter(Boolean).join(" · ")}</div>}</td>
            <td>{t.student || t.person || "—"}{t.student && t.person && <div className="t-sub">{t.person}</div>}</td>
            <td style={{ fontSize: 12.5 }}>{t.category || "—"}</td><td data-hide>{t.company}</td>
            <td className="num"><b>{brl(t.amount)}</b></td>
            <td>{t.status === "PAGO" ? <span className="badge ok">{R ? "Recebido" : "Pago"}</span> : t.status === "CANCELADO" ? <span className="badge">Cancelado</span> : t.late ? <span className="badge bad">Vencido</span> : <span className="badge warn">Em aberto</span>}
              {t.situation && <div className="t-sub"><span className="sdot" style={{ background: t.situation.color }} />{t.situation.name}</div>}</td>
            {showPaid && <td className="code">{fmtD(t.paidAt)}</td>}
            <td className="acts show">{canEdit && t.status === "ABERTO" && <button type="button" className="btn btn-sm" onClick={() => setPay(t)}>{R ? "Receber" : "Pagar"}</button>}</td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={5}>Total (sem cancelados)</td><td className="num">{brl(total)}</td><td colSpan={showPaid ? 3 : 2} /></tr></tfoot>
      </table>
      {edit && <TitleModal t={edit} o={o} onClose={close} />}
      {pay && <PayModal t={pay} o={o} onClose={() => setPay(null)} />}
    </>
  );
}

export function NewTitleButton({ kind, o, label, primary = true }: { kind: "RECEBER" | "PAGAR"; o: FinOpts; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn${primary ? " btn-primary" : ""}`} onClick={() => setOpen(true)} disabled={!o.companies.length}><Icon name="plus" size={16} /> {label ?? (kind === "RECEBER" ? "Nova entrada" : "Nova saída")}</button>
      {open && <TitleModal o={o} onClose={() => setOpen(false)} t={{ kind, companyId: o.companies[0]?.[0] ?? "", description: "", document: "", personId: "", studentId: "", categoryId: "", issueDate: today(), dueDate: addDays(today(), 30), amount: 0, paymentMethodId: "", situationId: "", invoice: "", notes: "" }} />}
    </>
  );
}

export function PayButton({ t, o }: { t: Title; o: FinOpts }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>{t.kind === "RECEBER" ? "Receber" : "Pagar"}</button>{open && <PayModal t={t} o={o} onClose={() => setOpen(false)} />}</>;
}

/** Transferência entre contas e ajuste de saldo (não entram na DRE). */
export function BankButtons({ accountId, accounts }: { accountId: string; accounts: Opt[] }) {
  const [open, setOpen] = useState<"ajuste" | "transf" | null>(null);
  const [f, setF] = useState({ date: today(), description: "", amount: "", sign: "-", to: "" });
  const { run, pending } = useRun();
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen("transf")}><Icon name="swap" size={16} /> Transferir entre contas</button>
      <button type="button" className="btn" onClick={() => setOpen("ajuste")}><Icon name="edit" size={16} /> Ajuste de saldo</button>
      {open && <Modal title={open === "ajuste" ? "Ajuste de saldo" : "Transferência entre contas"} size="narrow" onClose={() => setOpen(null)}
        foot={<><button type="button" className="btn" onClick={() => setOpen(null)}>Cancelar</button><button type="button" className="btn btn-primary" disabled={pending}
          onClick={() => {
            const v = parseMoney(f.amount);
            if (open === "ajuste") run(() => saveBankEntryAction({ bankAccountId: accountId, date: f.date, description: f.description, amount: f.sign === "-" ? -v : v }), () => setOpen(null));
            else run(() => transferAction({ from: accountId, to: f.to, date: f.date, amount: v, description: f.description }), () => setOpen(null));
          }}>Registrar</button></>}>
        <p className="muted" style={{ marginTop: 0 }}>{open === "ajuste" ? "Corrige o saldo da conta sem entrar na DRE (ex.: diferença de conferência). Receitas e despesas devem ser lançadas como entrada ou saída." : "Sai desta conta e entra na de destino, sem entrar na DRE."}</p>
        <div className="form">
          {open === "ajuste" && <div className="fld full"><div className="seg"><button type="button" aria-pressed={f.sign === "-"} onClick={() => setF({ ...f, sign: "-" })}>Diminui o saldo</button><button type="button" aria-pressed={f.sign === "+"} onClick={() => setF({ ...f, sign: "+" })}>Aumenta o saldo</button></div></div>}
          {open === "transf" && <div className="fld full"><label htmlFor="tr_to">Conta de destino</label><Sel id="tr_to" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">Selecione…</option>{accounts.filter(([v]) => v !== accountId).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel></div>}
          <div className="fld"><label htmlFor="bk_d">Data</label><input id="bk_d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div className="fld"><label htmlFor="bk_v">Valor (R$)</label><input id="bk_v" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="fld full"><label htmlFor="bk_x">Descrição</label><input id="bk_x" maxLength={200} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={open === "ajuste" ? "Ajuste de conferência" : "Transferência entre contas"} /></div>
        </div>
      </Modal>}
    </>
  );
}

export function DeleteEntryButton({ id }: { id: string }) {
  const { run, pending } = useRun();
  return <button type="button" className="mini-btn danger" title="Excluir movimento" disabled={pending} onClick={() => { if (confirm("Excluir este movimento do extrato? Numa transferência, as duas pontas saem.")) run(() => deleteBankEntryAction(id)); }}><Icon name="trash" size={12} /></button>;
}
