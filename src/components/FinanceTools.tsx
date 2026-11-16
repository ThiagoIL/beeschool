"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { toast } from "./Toast";
import { useRun } from "./client";
import { generateTuitionAction, importStatementAction, type ImportPreview } from "@/server/finance-actions";
import { readSpreadsheet } from "@/lib/sheet";
import { rowsFromSheet, type SheetRow } from "@/lib/finance-rules";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function TuitionForm({ competence, companies, categories, defaultCategory }: { competence: string; companies: [string, string][]; categories: [string, string, string, string][]; defaultCategory: string }) {
  const [f, setF] = useState({ competence, companyId: "", categoryId: defaultCategory });
  const { run, pending } = useRun();
  return (
    <div className="form">
      <div className="fld"><label htmlFor="mc">Competência</label><input id="mc" type="month" value={f.competence} onChange={(e) => setF({ ...f, competence: e.target.value })} /></div>
      <div className="fld"><label htmlFor="me">Empresa</label><select id="me" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}><option value="">Todas</option>{companies.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="fld full"><label htmlFor="mk">Categoria</label><select id="mk" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Selecione…</option>{categories.map(([v, l, g]) => <option key={v} value={v}>{l} · {g}</option>)}</select></div>
      <div className="full form-foot"><button type="button" className="btn btn-primary" disabled={pending || !f.categoryId || !f.competence}
        onClick={() => { if (confirm(`Gerar as mensalidades de ${f.competence.slice(5)}/${f.competence.slice(0, 4)} para os alunos ativos?`)) run(() => generateTuitionAction({ competence: f.competence, companyId: f.companyId || null, categoryId: f.categoryId })); }}>
        <Icon name="calendar" size={16} /> {pending ? "Gerando…" : "Gerar mensalidades"}</button></div>
    </div>
  );
}

/** Importação em três passos: escolher conta e arquivo → conferir o resumo → importar. */
export function ImportWizard({ accounts }: { accounts: { company: string; accounts: [string, string][] }[] }) {
  const router = useRouter();
  const [acc, setAcc] = useState(accounts.find((c) => c.accounts.length)?.accounts[0]?.[0] ?? "");
  const [file, setFile] = useState<{ name: string; rows: SheetRow[]; skipped: number } | null>(null);
  const [prev, setPrev] = useState<ImportPreview | null>(null);
  const [opt, setOpt] = useState({ skipDuplicates: true, allowUncategorized: false });
  const [pending, start] = useTransition();

  const preview = (rows: SheetRow[], name: string, account = acc) => start(async () => {
    const r = await importStatementAction({ bankAccountId: account, fileName: name, rows, dryRun: true });
    if (r.error) { toast(r.error, true); setPrev(null); return; }
    setPrev(r);
  });
  const onFile = async (fl: File | undefined) => {
    setPrev(null); setFile(null);
    if (!fl) return;
    if (fl.size > 8 * 1024 * 1024) { toast("Arquivo muito grande (máximo 8 MB).", true); return; }
    if (!/\.(xlsx|csv)$/i.test(fl.name)) { toast("Use um arquivo .xlsx ou .csv.", true); return; }
    try {
      const grid = await readSpreadsheet(new Uint8Array(await fl.arrayBuffer()), fl.name);
      const r = rowsFromSheet(grid);
      if (r.error) { toast(r.error, true); return; }
      if (!r.rows.length) { toast("Nenhuma linha com data e valor foi encontrada.", true); return; }
      setFile({ name: fl.name, rows: r.rows, skipped: r.skipped });
      if (acc) preview(r.rows, fl.name);
    } catch (e) {
      toast((e as Error).message || "Não foi possível ler a planilha.", true);
    }
  };
  const doImport = () => start(async () => {
    if (!file) return;
    const r = await importStatementAction({ bankAccountId: acc, fileName: file.name, rows: file.rows, dryRun: false, ...opt });
    if (r.error) { toast(r.error, true); return; }
    toast(r.message ?? "Importado.");
    setFile(null); setPrev(null);
    router.refresh();
  });

  return (
    <div className="form">
      <div className="fld"><label htmlFor="im_acc">Conta de destino</label>
        <select id="im_acc" value={acc} onChange={(e) => { setAcc(e.target.value); if (file) preview(file.rows, file.name, e.target.value); }}>
          {accounts.map((c) => <optgroup key={c.company} label={c.company}>{c.accounts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
        </select></div>
      <div className="fld"><label htmlFor="im_f">Planilha (.xlsx ou .csv)</label><input id="im_f" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])} /></div>
      {file && (
        <div className="full">
          <div className="infoline">{file.name}: {file.rows.length} linhas com valor{file.skipped ? ` · ${file.skipped} ignoradas (sem data ou sem valor, como os totais)` : ""}.</div>
          {pending && !prev && <p className="muted">Conferindo…</p>}
          {prev && (
            <>
              <div className="kpis k4 money" style={{ margin: "12px 0" }}>
                <div className="kpi"><b>{prev.rows}</b><span>Movimentos</span></div>
                <div className="kpi"><b>{brl(prev.entradas ?? 0)}</b><span>Entradas</span></div>
                <div className="kpi"><b>{brl(prev.saidas ?? 0)}</b><span>Saídas</span></div>
                <div className={`kpi${prev.duplicates ? " alert" : ""}`}><b>{prev.duplicates ?? 0}</b><span>Já lançados nesta conta</span></div>
              </div>
              {!!prev.unknown?.length && <div className="alert warn">Categorias que não existem no sistema: <b>{prev.unknown.join(", ")}</b>. Cadastre-as em Configurações › Categorias (o nome precisa ser igual, sem importar acentos e maiúsculas) ou importe essas linhas sem categoria.</div>}
              <div className="chk-row" style={{ margin: "10px 0" }}>
                <label className="chk"><input type="checkbox" checked={opt.skipDuplicates} onChange={(e) => setOpt({ ...opt, skipDuplicates: e.target.checked })} /> Pular os que já estão lançados</label>
                {!!prev.unknown?.length && <label className="chk"><input type="checkbox" checked={opt.allowUncategorized} onChange={(e) => setOpt({ ...opt, allowUncategorized: e.target.checked })} /> Importar linhas de categoria desconhecida sem categoria</label>}
              </div>
              <div className="table-preview tbl">
                <table><thead><tr><th>Data</th><th>Descrição</th><th className="num">Entrada</th><th className="num">Saída</th><th>Classificação</th><th>Nota</th></tr></thead>
                  <tbody>{file.rows.slice(0, 8).map((r, i) => <tr key={i}><td className="code">{r.date.split("-").reverse().join("/")}</td><td>{r.category}</td><td className="num">{r.inValue ? brl(r.inValue) : ""}</td><td className="num">{r.outValue ? brl(r.outValue) : ""}</td><td className="ell">{r.detail}</td><td>{r.nota}</td></tr>)}</tbody></table>
              </div>
              {file.rows.length > 8 && <p className="muted" style={{ fontSize: 12.5 }}>…e mais {file.rows.length - 8} linhas.</p>}
              <div className="form-foot"><button type="button" className="btn btn-primary" disabled={pending || (!!prev.unknown?.length && !opt.allowUncategorized)} onClick={doImport}><Icon name="upload" size={16} /> {pending ? "Importando…" : "Importar"}</button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
