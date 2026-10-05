/* Grafieken van Nexa Hybrid (inline SVG, geen bibliotheek).
   Regels (dataviz): één as per grafiek, dunne lijnen (2 px), staven met
   4 px afgeronde top en 2 px ruimte tussen segmenten, terughoudend raster,
   tekst in teksttokens, legenda bij twee of meer reeksen, tooltip bij hover
   en aanraken, en altijd een tabelweergave. */
import React, { useRef, useState } from "react";
import { C, R } from "../../App.jsx";
import { K } from "../theme.js";
import { dateLabel } from "./kit.jsx";

const W = 340;
const fmt = (v) => String(Math.round(v)).replace("-", "−");

function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
          <span aria-hidden="true" style={{ width: it.line ? 14 : 8, height: it.line ? 2 : 8, borderRadius: it.line ? 1 : 2, background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, children }) {
  const left = Math.min(Math.max(x, 0.16), 0.84) * 100;
  return (
    <div
      className="absolute pointer-events-none text-xs px-2.5 py-1.5"
      style={{ left: `${left}%`, top: 0, transform: "translate(-50%, -105%)", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: C.shadow, color: C.ink, whiteSpace: "nowrap", zIndex: 2 }}
      role="status"
    >
      {children}
    </div>
  );
}

/* Index onder de aanwijzer (muis of vinger) binnen een SVG van breedte W. */
function useHover(n, padL, padR) {
  const ref = useRef(null);
  const [i, setI] = useState(null);
  const at = (clientX) => {
    const r = ref.current && ref.current.getBoundingClientRect();
    if (!r || n < 1) return;
    const x = ((clientX - r.left) / r.width) * W;
    const k = Math.round(((x - padL) / (W - padL - padR)) * (n - 1));
    setI(Math.max(0, Math.min(n - 1, k)));
  };
  const handlers = {
    onPointerMove: (e) => at(e.clientX),
    onPointerDown: (e) => at(e.clientX),
    onPointerLeave: () => setI(null),
  };
  return [ref, i, handlers];
}

function TableView({ caption, head, rows }) {
  return (
    <details className="mt-2">
      <summary className="tap text-xs cursor-pointer" style={{ color: C.muted }}>
        Als tabel tonen
      </summary>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-xs tnum" style={{ color: C.ink, borderCollapse: "collapse" }}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="text-left py-1 pr-3" style={{ color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.line}` }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="py-1 pr-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ---------------- fitheid en vermoeidheid ---------------- */
export function FitnessChart({ series }) {
  const H = 150,
    padL = 30,
    padR = 8,
    padT = 10,
    padB = 22;
  const n = series.length;
  const [ref, hi, on] = useHover(n, padL, padR);
  if (n < 2) return null;
  const max = Math.max(10, ...series.map((p) => Math.max(p.ctl, p.atl))) * 1.1;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const path = (k) => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join("");
  const ticks = [0, max / 2, max].map((v) => Math.round(v / 10) * 10);
  const months = series.map((p, i) => [p.date, i]).filter(([d], i) => i === 0 || d.slice(8) === "01");
  const p = hi != null ? series[hi] : null;
  return (
    <div>
      <Legend
        items={[
          { label: "Fitheid (42 dagen)", color: "var(--tide-fill)", line: true },
          { label: "Vermoeidheid (7 dagen)", color: "var(--ember-fill)", line: true },
        ]}
      />
      <div className="relative">
        {p && (
          <Tooltip x={x(hi) / W}>
            <div style={{ color: C.muted }}>{dateLabel(p.date)}</div>
            <div>
              Fitheid <strong className="tnum">{fmt(p.ctl)}</strong> · Vermoeidheid <strong className="tnum">{fmt(p.atl)}</strong>
            </div>
            <div style={{ color: C.muted }}>Belasting die dag {fmt(p.load)}</div>
          </Tooltip>
        )}
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ touchAction: "pan-y" }} role="img" aria-label="Fitheid en vermoeidheid over de tijd" {...on}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted)" className="tnum">
                {t}
              </text>
            </g>
          ))}
          {months.map(([d, i]) => (
            <text key={d} x={x(i)} y={H - 6} fontSize="9.5" fill="var(--muted)" textAnchor={i === 0 ? "start" : "middle"}>
              {dateLabel(d, { month: "short" })}
            </text>
          ))}
          <path d={path("atl")} fill="none" stroke="var(--ember-fill)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path("ctl")} fill="none" stroke="var(--tide-fill)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {p && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={padT} y2={H - padB} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
              <circle cx={x(hi)} cy={y(p.atl)} r="4" fill="var(--ember-fill)" stroke="var(--surface)" strokeWidth="2" />
              <circle cx={x(hi)} cy={y(p.ctl)} r="4" fill="var(--tide-fill)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>
      <TableView
        caption="Fitheid en vermoeidheid per week"
        head={["Datum", "Fitheid", "Vermoeidheid", "Vorm"]}
        rows={series.filter((_, i) => (n - 1 - i) % 7 === 0).map((q) => [dateLabel(q.date), fmt(q.ctl), fmt(q.atl), fmt(q.tsb)])}
      />
    </div>
  );
}

/* ---------------- vorm (fitheid − vermoeidheid) ---------------- */
export function FormChart({ series }) {
  const H = 90,
    padL = 30,
    padR = 8,
    padT = 8,
    padB = 8;
  const n = series.length;
  const [ref, hi, on] = useHover(n, padL, padR);
  if (n < 2) return null;
  const ext = Math.max(10, ...series.map((p) => Math.abs(p.tsb))) * 1.1;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v + ext) / (2 * ext)) * (H - padT - padB);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.tsb).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1)} ${y(0)}L${x(0)} ${y(0)}Z`;
  const p = hi != null ? series[hi] : null;
  return (
    <div className="relative">
      {p && (
        <Tooltip x={x(hi) / W}>
          <span style={{ color: C.muted }}>{dateLabel(p.date)}</span> · vorm <strong className="tnum">{fmt(p.tsb)}</strong>
        </Tooltip>
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ touchAction: "pan-y" }} role="img" aria-label="Vorm: fitheid min vermoeidheid" {...on}>
        <text x={padL - 6} y={padT + 8} textAnchor="end" fontSize="9.5" fill="var(--muted)">
          fris
        </text>
        <text x={padL - 6} y={H - padB} textAnchor="end" fontSize="9.5" fill="var(--muted)">
          moe
        </text>
        <path d={area} fill="var(--muted)" opacity=".12" />
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="1" />
        <path d={line} fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {p && <circle cx={x(hi)} cy={y(p.tsb)} r="4" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />}
      </svg>
    </div>
  );
}

/* ---------------- weekbelasting per pijler ---------------- */
const PILLARS = ["kracht", "duur", "conditie", "mobiliteit"];
export function WeekBars({ weeks }) {
  const H = 150,
    padL = 30,
    padR = 4,
    padT = 10,
    padB = 22;
  const n = weeks.length;
  const [ref, hi, on] = useHover(n, padL + 12, padR + 12);
  const max = Math.max(100, ...weeks.map((w) => w.total)) * 1.1;
  const slot = (W - padL - padR) / n;
  const bw = Math.min(26, slot * 0.6);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const base = y(0);
  const ticks = [0, max / 2, max].map((v) => Math.round(v / 50) * 50);
  const present = PILLARS.filter((k) => weeks.some((w) => w.pillars[k] > 0));
  const w = hi != null ? weeks[hi] : null;
  return (
    <div>
      <Legend items={(present.length ? present : PILLARS.slice(0, 2)).map((k) => ({ label: K[k].label, color: K[k].fill }))} />
      <div className="relative">
        {w && (
          <Tooltip x={(padL + slot * (hi + 0.5)) / W}>
            <div style={{ color: C.muted }}>Week van {dateLabel(w.monday, { day: "numeric", month: "short" })}</div>
            <div>
              Totaal <strong className="tnum">{fmt(w.total)}</strong> · {w.count} {w.count === 1 ? "sessie" : "sessies"}
            </div>
            {PILLARS.filter((k) => w.pillars[k] > 0).map((k) => (
              <div key={k}>
                {K[k].label} <span className="tnum">{fmt(w.pillars[k])}</span>
              </div>
            ))}
          </Tooltip>
        )}
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ touchAction: "pan-y" }} role="img" aria-label="Belasting per week, per pijler" {...on}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--muted)" className="tnum">
                {t}
              </text>
            </g>
          ))}
          {weeks.map((wk, i) => {
            const cx = padL + slot * (i + 0.5);
            let top = base;
            const segs = PILLARS.filter((k) => wk.pillars[k] > 0).map((k) => {
              const h = base - y(wk.pillars[k]);
              const seg = { k, y: top - h, h };
              top -= h;
              return seg;
            });
            return (
              <g key={wk.monday} opacity={hi == null || hi === i ? 1 : 0.55}>
                {segs.map((sg, j) => {
                  const last = j === segs.length - 1;
                  const h = Math.max(0, sg.h - (j ? 2 : 0)); // 2 px ruimte tussen segmenten
                  const r = last ? Math.min(4, h) : 0;
                  const x0 = cx - bw / 2;
                  const y0 = sg.y;
                  const d = r
                    ? `M${x0} ${y0 + h}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}H${x0 + bw - r}Q${x0 + bw} ${y0} ${x0 + bw} ${y0 + r}V${y0 + h}Z`
                    : `M${x0} ${y0 + h}V${y0}H${x0 + bw}V${y0 + h}Z`;
                  return <path key={sg.k} d={d} fill={K[sg.k].fill} />;
                })}
                <text x={cx} y={H - 6} fontSize="9.5" fill={hi === i ? "var(--ink)" : "var(--muted)"} textAnchor="middle" className="tnum">
                  {dateLabel(wk.monday, { day: "numeric", month: "numeric" })}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <TableView
        caption="Belasting per week"
        head={["Week", "Totaal", ...PILLARS.map((k) => K[k].label)]}
        rows={weeks.map((wk) => [dateLabel(wk.monday, { day: "numeric", month: "short" }), fmt(wk.total), ...PILLARS.map((k) => fmt(wk.pillars[k]))])}
      />
    </div>
  );
}

/* ---------------- intensiteitsverdeling (één reeks, oplopend) ---------------- */
const INT = [
  { k: 1, label: "Rustig", sub: "zone 1–2", color: "var(--seq-1)" },
  { k: 2, label: "Gemiddeld", sub: "zone 3", color: "var(--seq-2)" },
  { k: 3, label: "Zwaar", sub: "zone 4–5", color: "var(--seq-3)" },
];
export function IntensityBar({ dist }) {
  if (!dist || !dist.total) return null;
  const parts = INT.map((z) => ({ ...z, share: dist.share[z.k], min: dist.minutes[z.k] })).filter((z) => z.share > 0);
  return (
    <div>
      <div className="flex w-full overflow-hidden" style={{ height: 14, borderRadius: 4, gap: 2 }} role="img" aria-label={parts.map((z) => `${z.label} ${Math.round(z.share * 100)} procent`).join(", ")}>
        {parts.map((z) => (
          <span key={z.k} title={`${z.label}: ${Math.round(z.min)} min`} style={{ width: `${z.share * 100}%`, background: z.color }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {INT.map((z) => (
          <div key={z.k} className="text-xs">
            <div className="flex items-center gap-1.5" style={{ color: C.muted }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: z.color }} />
              {z.label}
            </div>
            <div className="tnum" style={{ color: C.ink, fontWeight: 600 }}>
              {Math.round((dist.share[z.k] || 0) * 100)}% <span style={{ color: C.muted, fontWeight: 400 }}>· {Math.round(dist.minutes[z.k])} min</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Kleine staafjes per pijler voor op Vandaag (deze week). */
export function PillarMini({ week }) {
  const max = Math.max(1, ...PILLARS.map((k) => week.pillars[k]));
  return (
    <div className="space-y-1.5">
      {PILLARS.map((k) => (
        <div key={k} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: "76px 1fr 38px" }}>
          <span style={{ color: C.muted }}>{K[k].label}</span>
          <span className="block" style={{ height: 8, background: C.surface2, borderRadius: 4 }}>
            <span className="block bar-fill" style={{ width: `${(week.pillars[k] / max) * 100}%`, height: 8, background: K[k].fill, borderRadius: 4 }} />
          </span>
          <span className="tnum text-right" style={{ color: C.ink }}>
            {fmt(week.pillars[k])}
          </span>
        </div>
      ))}
    </div>
  );
}
