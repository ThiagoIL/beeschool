"use client";
import { Fragment, useState } from "react";
import type { DreLine } from "@/lib/dre";
import { Icon } from "./Icon";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`);

/**
 * Matriz da DRE como no Power BI: por período, Valor DRE · % AH · % (sobre o faturamento).
 * Grupos expandem para mostrar as categorias. Linhas calculadas ficam destacadas.
 */
export function DreTable({ periods, lines, showTotal }: { periods: { key: string; label: string }[]; lines: DreLine[]; showTotal?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(periods.length > 3);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const visible = lines.filter((l) => l.kind !== "category" || open.has(l.parent!));
  const hasCats = (k: string) => lines.some((l) => l.parent === k && l.kind === "category");
  return (
    <div className="dre-wrap">
      <div className="dre-tools">
        <button type="button" className="btn btn-sm" onClick={() => setOpen(open.size ? new Set() : new Set(lines.filter((l) => l.kind === "group").map((l) => l.key)))}>{open.size ? "Recolher categorias" : "Abrir categorias"}</button>
        {periods.length > 1 && <label className="chk"><input type="checkbox" checked={!compact} onChange={(e) => setCompact(!e.target.checked)} /> Mostrar % AH e % em todos os meses</label>}
      </div>
      <div className="tbl dre">
        <table>
          <thead>
            <tr><th rowSpan={2} className="dre-name">Grupo</th>{periods.map((p) => <th key={p.key} colSpan={compact ? 1 : 3} className="dre-per">{p.label}</th>)}{showTotal && <th colSpan={2} className="dre-per">Total</th>}</tr>
            <tr>{periods.map((p) => <Fragment key={p.key}><th className="num">Valor DRE</th>{!compact && <><th className="num">% AH</th><th className="num">%</th></>}</Fragment>)}{showTotal && <><th className="num">Valor</th><th className="num">%</th></>}</tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.key} className={`dre-${l.kind}`}>
                <td className="dre-name">
                  {l.kind === "group" && hasCats(l.key) ? <button type="button" className="dre-tg" aria-expanded={open.has(l.key)} onClick={() => toggle(l.key)}><Icon name={open.has(l.key) ? "minus" : "plus"} size={11} /></button> : <span className="dre-sp" />}
                  {l.label}
                </td>
                {periods.map((p, i) => (
                  <Fragment key={p.key}>
                    <td className={`num${l.values[i] < 0 ? " neg" : ""}`}>{l.values[i] ? brl(l.values[i]) : "—"}</td>
                    {!compact && <><td className={`num small${(l.ah[i] ?? 0) < 0 ? " t-bad" : ""}`}>{pct(l.ah[i], 0)}</td><td className="num small">{l.kind === "total" && l.key !== "RB" ? "" : pct(l.pct[i])}</td></>}
                  </Fragment>
                ))}
                {showTotal && <><td className={`num${l.total < 0 ? " neg" : ""}`}><b>{brl(l.total)}</b></td><td className="num small">{pct(l.pctTotal)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
