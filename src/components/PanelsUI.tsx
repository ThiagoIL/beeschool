"use client";
import { useState } from "react";
import { Icon } from "./Icon";
import { Modal, useRun } from "./client";
import { deleteIndicatorAction, saveIndicatorAction, saveTargetsAction } from "@/server/finance-actions";

type Opt = [string, string];
type Ind = { id: string; name: string; groupId: string; categoryIds: string[]; position: number; active: boolean };
type Tgt = { indicatorId: string; companyId: string; pct: number };

/** Metas por empresa (uma coluna por empresa) e cadastro dos indicadores. */
export function TargetsEditor({ companies, groups, categories, indicators, targets, canEdit }: { companies: Opt[]; groups: Opt[]; categories: Opt[]; indicators: Ind[]; targets: Tgt[]; canEdit: boolean }) {
  const key = (i: string, c: string) => `${i}|${c}`;
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(targets.map((t) => [key(t.indicatorId, t.companyId), String(t.pct).replace(".", ",")])));
  const [edit, setEdit] = useState<Ind | null>(null);
  const { run, pending } = useRun();
  const gName = new Map(groups), cName = new Map(categories);
  const saveCompany = (c: string) => run(() => saveTargetsAction({
    companyId: c,
    targets: indicators.map((i) => { const raw = (vals[key(i.id, c)] ?? "").trim(); const n = Number(raw.replace(",", ".")); return { indicatorId: i.id, pct: raw === "" || !Number.isFinite(n) ? null : n }; }),
  }));
  return (
    <>
      <div className="tbl">
        <table>
          <thead><tr><th>Indicador</th><th>Soma</th>{companies.map(([c, n]) => <th key={c} className="num">Meta · {n}</th>)}<th /></tr></thead>
          <tbody>
            {indicators.map((i) => (
              <tr key={i.id} style={i.active ? undefined : { opacity: 0.55 }}>
                <td className="desc">{i.name}</td>
                <td style={{ fontSize: 12.5 }}>{i.groupId ? `Grupo: ${gName.get(i.groupId) ?? "—"}` : i.categoryIds.map((c) => cName.get(c) ?? "?").join(", ")}</td>
                {companies.map(([c]) => (
                  <td key={c} className="num"><span className="pct-in"><input inputMode="decimal" aria-label={`Meta de ${i.name}`} disabled={!canEdit} value={vals[key(i.id, c)] ?? ""} placeholder="—"
                    onChange={(e) => setVals({ ...vals, [key(i.id, c)]: e.target.value })} />%</span></td>
                ))}
                <td className="acts show">{canEdit && <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={`Editar ${i.name}`} onClick={() => setEdit(i)}><Icon name="edit" size={15} /></button>}</td>
              </tr>
            ))}
          </tbody>
          {canEdit && <tfoot><tr><td colSpan={2}><button type="button" className="btn btn-sm" onClick={() => setEdit({ id: "", name: "", groupId: "", categoryIds: [], position: (indicators.length + 1) * 10, active: true })}><Icon name="plus" size={14} /> Novo indicador</button></td>
            {companies.map(([c, n]) => <td key={c} className="num"><button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => saveCompany(c)}>Salvar metas {n}</button></td>)}<td /></tr></tfoot>}
        </table>
      </div>
      {edit && <IndicatorModal ind={edit} groups={groups} categories={categories} onClose={() => setEdit(null)} />}
    </>
  );
}

function IndicatorModal({ ind, groups, categories, onClose }: { ind: Ind; groups: Opt[]; categories: Opt[]; onClose: () => void }) {
  const [d, setD] = useState(ind);
  const [mode, setMode] = useState<"g" | "c">(ind.groupId || !ind.categoryIds.length ? "g" : "c");
  const { run, pending } = useRun();
  return (
    <Modal title={d.id ? "Indicador" : "Novo indicador"} onClose={onClose} foot={<>
      {d.id && <button type="button" className="btn btn-danger left" disabled={pending} onClick={() => { if (confirm("Excluir o indicador e as metas dele?")) run(() => deleteIndicatorAction(d.id), onClose); }}><Icon name="trash" size={16} /> Excluir</button>}
      <button type="button" className="btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => saveIndicatorAction({ id: d.id || undefined, name: d.name, groupId: mode === "g" ? d.groupId || null : null, categoryIds: mode === "c" ? d.categoryIds : [], position: d.position, active: d.active }), onClose)}>Salvar</button>
    </>}>
      <div className="form">
        <div className="fld full"><label htmlFor="in_n">Nome</label><input id="in_n" value={d.name} maxLength={120} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
        <div className="fld full"><div className="seg"><button type="button" aria-pressed={mode === "g"} onClick={() => setMode("g")}>Grupo da DRE</button><button type="button" aria-pressed={mode === "c"} onClick={() => setMode("c")}>Categorias</button></div></div>
        {mode === "g" ? (
          <div className="fld full"><label htmlFor="in_g">Grupo</label><select id="in_g" value={d.groupId} onChange={(e) => setD({ ...d, groupId: e.target.value })}><option value="">Selecione…</option>{groups.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        ) : (
          <div className="fld full"><span className="flabel">Categorias somadas</span><div className="chk-grid">{categories.map(([v, l]) => (
            <label key={v} className="chk"><input type="checkbox" checked={d.categoryIds.includes(v)} onChange={(e) => setD({ ...d, categoryIds: e.target.checked ? [...d.categoryIds, v] : d.categoryIds.filter((x) => x !== v) })} /> {l}</label>))}</div></div>
        )}
        <div className="fld"><label htmlFor="in_p">Ordem</label><input id="in_p" type="number" min={0} value={d.position} onChange={(e) => setD({ ...d, position: Number(e.target.value) || 0 })} /></div>
        <div className="fld"><span className="flabel">&nbsp;</span><label className="chk"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Mostrar no painel</label></div>
      </div>
    </Modal>
  );
}
