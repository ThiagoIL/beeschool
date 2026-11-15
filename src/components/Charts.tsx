// Gráficos simples em SVG (mesmos do protótipo), renderizados no servidor.
const kfmt = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
export const PAL = ["#E9AE20", "#1A1A1A", "#808080", "#B7791F", "#4A4A4A", "#F3D27A", "#2E7D4F", "#B3261E"];
function niceMax(v: number) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

export type HRow = { l: string; v: number; c?: string; sub?: string };
export function HBars({ rows, fmt = (v) => v.toLocaleString("pt-BR") }: { rows: HRow[]; fmt?: (v: number) => string }) {
  if (!rows.length || !rows.some((r) => r.v)) return <div className="chart-empty">Sem dados no período.</div>;
  const max = Math.max(...rows.map((r) => r.v));
  return (
    <div className="hb">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="hb-r"><span className="hb-l" title={r.l}>{r.l}</span><span className="hb-t"><i style={{ width: `${max ? (r.v / max) * 100 : 0}%`, background: r.c ?? "var(--link)" }} /></span><span className="hb-v">{fmt(r.v)}</span></div>
          {r.sub && <div className="hb-s">{r.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function VBars({ labels, sets, stack, int, fmt = kfmt, label = "Gráfico" }: { labels: string[]; sets: { n: string; c: string; v: number[] }[]; stack?: boolean; int?: boolean; fmt?: (v: number) => string; label?: string }) {
  const W = 620, H = 220, pl = 48, pr = 6, pt = 12, pb = 26, iw = W - pl - pr, ih = H - pt - pb, n = labels.length;
  const tot = labels.map((_, i) => (stack ? sets.reduce((t, s) => t + (s.v[i] || 0), 0) : Math.max(...sets.map((s) => s.v[i] || 0))));
  if (!tot.some(Boolean)) return <div className="chart-empty">Sem dados no período.</div>;
  let max = niceMax(Math.max(...tot));
  if (int) max = Math.max(4, Math.ceil(Math.max(...tot) / 4) * 4);
  const gw = iw / n, bw = stack ? Math.min(26, gw * 0.62) : Math.min(n <= 4 ? 56 : n <= 8 ? 28 : 14, (gw * 0.7) / sets.length);
  const step = n > 16 ? 3 : n > 9 ? 2 : 1;
  return (
    <>
      <svg className="vb" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {[0, 1, 2, 3, 4].map((k) => { const y = pt + ih - (ih * k) / 4; return <g key={k}><line x1={pl} x2={W - pr} y1={y} y2={y} stroke="var(--line-2)" /><text x={pl - 7} y={y + 4} textAnchor="end" className="ax">{fmt((max * k) / 4)}</text></g>; })}
        {labels.map((l, i) => {
          const cx = pl + gw * i + gw / 2; let acc = 0;
          return (
            <g key={i}>
              {sets.map((s, j) => {
                const v = s.v[i] || 0, h = (ih * v) / max;
                if (!h) return null;
                if (stack) { const y = pt + ih - acc - h; acc += h; return <rect key={j} x={cx - bw / 2} y={y} width={bw} height={h} fill={s.c}><title>{`${l} · ${s.n}: ${fmt(v)}`}</title></rect>; }
                const x = cx - (bw * sets.length) / 2 + j * bw;
                return <rect key={j} x={x} y={pt + ih - h} width={bw - 1.5} height={h} fill={s.c}><title>{`${l} · ${s.n}: ${fmt(v)}`}</title></rect>;
              })}
              {(n - 1 - i) % step === 0 && <text x={cx} y={H - 8} textAnchor="middle" className="ax">{l}</text>}
            </g>
          );
        })}
      </svg>
      <div className="lg">{sets.map((s) => <span key={s.n}><i style={{ background: s.c }} />{s.n}</span>)}</div>
    </>
  );
}

export function Donut({ rows, fmt }: { rows: HRow[]; fmt: (v: number) => string }) {
  const rs = rows.filter((r) => r.v > 0);
  const tot = rs.reduce((t, r) => t + r.v, 0);
  if (!tot) return <div className="chart-empty">Sem dados.</div>;
  const R = 56, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="dn">
      <svg viewBox="0 0 160 160" width={150} height={150} role="img" aria-label="Distribuição">
        {rs.map((r, i) => { const len = (C * r.v) / tot; const el = <circle key={i} r={R} cx={80} cy={80} fill="none" stroke={r.c} strokeWidth={22} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 80 80)"><title>{`${r.l}: ${fmt(r.v)}`}</title></circle>; off += len; return el; })}
        <text x={80} y={80} textAnchor="middle" className="dn-v">{kfmt(tot)}</text><text x={80} y={97} textAnchor="middle" className="ax">R$ total</text>
      </svg>
      <ul>{rs.map((r, i) => <li key={i}><i style={{ background: r.c }} /><span>{r.l}</span><b>{fmt(r.v)}</b><em>{((r.v / tot) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</em></li>)}</ul>
    </div>
  );
}
export { kfmt };

/**
 * Velocímetro (meia-lua) do indicador: preenchimento = % atual sobre o faturamento; o traço marca a meta do orçamento.
 * Acima da meta, o preenchimento fica vermelho.
 */
export function Gauge({ value, target, label }: { value: number | null; target: number | null; label: string }) {
  const v = value ?? 0;
  const max = Math.max(target != null ? target * 1.6 : 0, v * 1.15, 5);
  const R = 70, cx = 90, cy = 86;
  const pt = (p: number) => { const a = Math.PI * (1 - Math.min(1, Math.max(0, p / max))); return [cx + R * Math.cos(a), cy - R * Math.sin(a)] as const; };
  const arc = (p: number) => { const [x, y] = pt(p); return `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`; };
  const over = target != null && v > target;
  const [tx1, ty1] = target != null ? (() => { const a = Math.PI * (1 - Math.min(1, target / max)); return [cx + (R - 16) * Math.cos(a), cy - (R - 16) * Math.sin(a)]; })() : [0, 0];
  const [tx2, ty2] = target != null ? (() => { const a = Math.PI * (1 - Math.min(1, target / max)); return [cx + (R + 16) * Math.cos(a), cy - (R + 16) * Math.sin(a)]; })() : [0, 0];
  const f = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return (
    <svg viewBox="-24 -14 228 114" className="gauge" role="img" aria-label={`${label}: ${value == null ? "sem faturamento" : f(v)}${target != null ? `, meta ${f(target)}` : ""}`}>
      <path d={arc(max)} fill="none" stroke="var(--line-2)" strokeWidth={22} />
      {v > 0 && <path d={arc(v)} fill="none" stroke={over ? "var(--bad)" : "var(--brand)"} strokeWidth={22} />}
      {target != null && <><line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--ink)" strokeWidth={1.6} /><text x={tx2 + (tx2 < cx ? -2 : 2)} y={ty2 - 3} textAnchor={tx2 < cx ? "end" : "start"} className="ax">{f(target)}</text></>}
      <text x={cx} y={cy - 6} textAnchor="middle" className="gauge-v">{value == null ? "—" : f(v)}</text>
    </svg>
  );
}

/** Barras horizontais com valores positivos e negativos (resultado por mês). */
export function DivBars({ rows, fmt }: { rows: { l: string; v: number }[]; fmt: (v: number) => string }) {
  if (!rows.length) return <div className="chart-empty">Sem dados no período.</div>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className="divb">{rows.map((r) => (
      <div key={r.l} className="divb-r"><span className="divb-l">{r.l}</span>
        <span className="divb-t"><span className="divb-neg">{r.v < 0 && <i style={{ width: `${(-r.v / max) * 100}%` }} />}</span><span className="divb-pos">{r.v > 0 && <i style={{ width: `${(r.v / max) * 100}%` }} />}</span></span>
        <span className={`divb-v${r.v < 0 ? " t-bad" : ""}`}>{fmt(r.v)}</span></div>))}
    </div>
  );
}
