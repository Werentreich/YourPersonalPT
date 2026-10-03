/* Blokken bewerken: sets, rondes, AMRAP, EMOM, For Time, intervallen,
   doorlopend en vrij. Elke beweging toont alleen de maten die bij haar
   passen (meters, tijd, calorieën, herhalingen, kg, hoogte). */
import React, { useMemo, useState } from "react";
import { C, R } from "../../App.jsx";
import { BLOCK_TYPES, TEMPLATES, newBlock, newItem, blockHeader, blockResult, blockVolume, blockDuration } from "../engine/blocks.js";
import { METRICS, movementById, searchMovements } from "../engine/movements.js";
import { fmtDuration, fmtKm, num } from "../engine/model.js";
import { Field, TextInput, NumInput, DurationInput, Choice, HIcon } from "./kit.jsx";

const small = { fontSize: 12, color: C.muted };

/* ---------------- beweging kiezen ---------------- */
function MovementPicker({ onAdd, placeholder = "Beweging zoeken, bijv. roeien, wall balls, squat" }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchMovements(q, 7), [q]);
  const add = (mv) => {
    onAdd(mv ? newItem(mv) : newItem(null, { name: q.trim() }));
    setQ("");
  };
  return (
    <div>
      <TextInput value={q} onChange={setQ} placeholder={placeholder} ariaLabel="Beweging zoeken" />
      {q.trim() && (
        <div className="mt-1.5 overflow-hidden" style={{ border: `1px solid ${C.line}`, borderRadius: R.field }}>
          {hits.map((m) => (
            <button key={m.id} type="button" onClick={() => add(m)} className="tap w-full text-left px-3 py-2 text-sm flex items-baseline justify-between gap-2" style={{ color: C.ink, borderBottom: `1px solid ${C.lineSoft}`, background: C.panel }}>
              <span>{m.name}</span>
              <span style={small}>{m.metrics.filter((x) => x !== "kg" && x !== "height").map((x) => METRICS[x].short).join(" / ")}</span>
            </button>
          ))}
          <button type="button" onClick={() => add(null)} className="tap w-full text-left px-3 py-2 text-sm" style={{ color: C.accent, background: C.panel, fontWeight: 600 }}>
            "{q.trim()}" toevoegen als eigen beweging
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- één beweging ---------------- */
const PRIMARY = ["reps", "distance", "time", "cal"];
const FIELD = { reps: "reps", distance: "distanceM", time: "timeSec", cal: "cal" };

function primaryOf(it, mv) {
  if (it.metric) return it.metric;
  for (const m of PRIMARY) if (num(it[FIELD[m]])) return m;
  const opts = mv ? mv.metrics.filter((m) => PRIMARY.includes(m)) : ["reps", "distance", "time", "cal"];
  return opts[0] || "reps";
}

function ValueInput({ metric, it, set, label }) {
  if (metric === "time") return <DurationInput value={it.timeSec} onChange={(v) => set({ timeSec: v })} placeholder="m:ss" ariaLabel={`${label}: tijd`} />;
  if (metric === "distance") return <NumInput value={it.distanceM} onChange={(v) => set({ distanceM: v })} unit="m" step="1" ariaLabel={`${label}: meters`} />;
  if (metric === "cal") return <NumInput value={it.cal} onChange={(v) => set({ cal: v })} unit="cal" step="1" ariaLabel={`${label}: calorieën`} />;
  return <NumInput value={it.reps} onChange={(v) => set({ reps: v })} unit="herh." step="1" ariaLabel={`${label}: herhalingen`} />;
}

function MovementRow({ it, b, set, remove }) {
  const mv = movementById(it.moveId);
  const label = it.name || (mv && mv.name) || "Beweging";
  const opts = (mv ? mv.metrics : ["reps", "distance", "time", "cal", "kg"]).filter((m) => PRIMARY.includes(m));
  const metric = primaryOf(it, mv);
  const scheme = Array.isArray(b.repScheme) && b.repScheme.length;
  const hasKg = !mv || mv.metrics.includes("kg");
  const hasHeight = mv && mv.metrics.includes("height");
  const switchMetric = (m) => set({ metric: m, reps: m === "reps" ? it.reps : null, distanceM: m === "distance" ? it.distanceM : null, timeSec: m === "time" ? it.timeSec : null, cal: m === "cal" ? it.cal : null });
  const showValue = !(scheme && metric === "reps");
  return (
    <div className="py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
          {label}
          {mv && mv.perHand && hasKg ? <span style={{ ...small, fontWeight: 400 }}> · kg per hand</span> : null}
        </span>
        <button type="button" onClick={remove} className="tap p-1" style={{ color: C.muted }} aria-label={`${label} verwijderen`}>
          <HIcon name="trash" size={17} />
        </button>
      </div>
      {opts.length > 1 && (
        <div className="flex gap-1 mb-1.5" role="radiogroup" aria-label={`${label}: maat`}>
          {opts.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => switchMetric(m)}
              className="tap px-2 py-0.5 text-xs"
              style={{ borderRadius: 999, border: `1px solid ${metric === m ? C.accent : C.line}`, background: metric === m ? "var(--accent-soft)" : "transparent", color: C.ink, fontWeight: metric === m ? 600 : 500 }}
            >
              {METRICS[m].label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${(showValue ? 1 : 0) + (hasKg ? 1 : 0) + (hasHeight ? 1 : 0) || 1}, minmax(0, 1fr))` }}>
        {showValue && <ValueInput metric={metric} it={it} set={set} label={label} />}
        {hasKg && <NumInput value={it.kg} onChange={(v) => set({ kg: v })} unit="kg" ariaLabel={`${label}: gewicht`} placeholder="kg" />}
        {hasHeight && <NumInput value={it.heightCm} onChange={(v) => set({ heightCm: v })} unit="cm" step="1" ariaLabel={`${label}: hoogte`} placeholder="hoogte" />}
      </div>
      {scheme && metric === "reps" && <div style={small} className="mt-1">Herhalingen volgen de reeks {b.repScheme.join("-")}.</div>}
    </div>
  );
}

/* Klassieke sets: kg × herhalingen × RIR per set. */
function SetsRow({ it, set, remove }) {
  const sets = it.sets || [];
  const setRow = (j, patch) => set({ sets: sets.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
  const label = it.name || "Oefening";
  return (
    <div className="py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
          {label}
        </span>
        <button type="button" onClick={remove} className="tap p-1" style={{ color: C.muted }} aria-label={`${label} verwijderen`}>
          <HIcon name="trash" size={17} />
        </button>
      </div>
      <div className="grid gap-1.5 mb-1" style={{ gridTemplateColumns: "28px 1fr 1fr 1fr 24px", ...small }}>
        <span>Set</span>
        <span>kg</span>
        <span>Herh.</span>
        <span title="Herhalingen in reserve">RIR</span>
        <span />
      </div>
      {sets.map((x, j) => (
        <div key={j} className="grid gap-1.5 items-center mb-1.5" style={{ gridTemplateColumns: "28px 1fr 1fr 1fr 24px" }}>
          <span className="text-sm tnum" style={{ color: C.muted }}>
            {j + 1}
          </span>
          <NumInput value={x.kg} onChange={(v) => setRow(j, { kg: v })} ariaLabel={`${label} set ${j + 1} kilogram`} />
          <NumInput value={x.reps} onChange={(v) => setRow(j, { reps: v })} step="1" ariaLabel={`${label} set ${j + 1} herhalingen`} />
          <NumInput value={x.rir} onChange={(v) => setRow(j, { rir: v })} step="1" ariaLabel={`${label} set ${j + 1} herhalingen in reserve`} />
          <button type="button" onClick={() => set({ sets: sets.filter((_, k) => k !== j) })} className="tap" style={{ color: C.muted }} aria-label={`${label} set ${j + 1} verwijderen`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set({ sets: [...sets, { ...(sets[sets.length - 1] || { kg: null, reps: null, rir: null }) }] })} className="tap text-sm mt-1" style={{ color: C.accent, fontWeight: 600 }}>
        + Set
      </button>
    </div>
  );
}

/* ---------------- instellingen en resultaat per bloktype ---------------- */
const parseScheme = (t) => {
  const xs = String(t || "")
    .split(/[^0-9]+/)
    .map(Number)
    .filter((x) => x > 0);
  return xs.length > 1 ? xs : null;
};

function BlockSettings({ b, set }) {
  const [schemeText, setSchemeText] = useState(Array.isArray(b.repScheme) ? b.repScheme.join("-") : "");
  const schemeField = (
    <Field label="Of een reeks" hint="bijv. 21-15-9 of 10-8-6-4-2">
      <TextInput
        value={schemeText}
        onChange={(t) => {
          setSchemeText(t);
          set({ repScheme: parseScheme(t) });
        }}
        inputMode="numeric"
        ariaLabel="Herhalingsreeks"
      />
    </Field>
  );
  if (b.type === "rondes")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rondes">
          <NumInput value={b.rounds} onChange={(v) => set({ rounds: v })} step="1" ariaLabel="Aantal rondes" />
        </Field>
        {schemeField}
      </div>
    );
  if (b.type === "amrap")
    return (
      <Field label="Duur">
        <DurationInput value={b.capSec} onChange={(v) => set({ capSec: v })} placeholder="min" ariaLabel="Duur van de AMRAP" />
      </Field>
    );
  if (b.type === "emom")
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Totale duur">
            <DurationInput value={b.durationSec} onChange={(v) => set({ durationSec: v })} placeholder="min" ariaLabel="Totale duur van de EMOM" />
          </Field>
          <Field label="Elke">
            <Choice
              options={[60, 90, 120, 180].map((s) => ({ value: s, label: s === 90 ? "1:30" : `${s / 60} min` }))}
              value={b.everySec || 60}
              onChange={(v) => set({ everySec: v })}
              ariaLabel="Interval"
            />
          </Field>
        </div>
        <Field label="Per interval">
          <Choice
            options={[
              { value: "wissel", label: "Om de beurt één beweging" },
              { value: "alles", label: "Alle bewegingen" },
            ]}
            value={b.emomMode || "wissel"}
            onChange={(v) => set({ emomMode: v })}
            ariaLabel="Wat per interval"
          />
        </Field>
      </div>
    );
  if (b.type === "fortime")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tijdslimiet (optioneel)">
          <DurationInput value={b.capSec} onChange={(v) => set({ capSec: v })} placeholder="min" ariaLabel="Tijdslimiet" />
        </Field>
        {schemeField}
      </div>
    );
  if (b.type === "interval")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Herhalingen">
          <NumInput value={b.rounds} onChange={(v) => set({ rounds: v })} step="1" ariaLabel="Aantal herhalingen" />
        </Field>
        <Field label="Rust ertussen">
          <DurationInput value={b.restSec} onChange={(v) => set({ restSec: v })} placeholder="m:ss" ariaLabel="Rust tussen de herhalingen" />
        </Field>
      </div>
    );
  return null;
}

function BlockResult({ b, set }) {
  const r = b.result || {};
  const setR = (patch) => set({ result: { ...r, ...patch } });
  if (b.type === "amrap")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rondes">
          <NumInput value={r.rounds} onChange={(v) => setR({ rounds: v })} step="1" ariaLabel="Volle rondes" />
        </Field>
        <Field label="+ losse herhalingen">
          <NumInput value={r.reps} onChange={(v) => setR({ reps: v })} step="1" ariaLabel="Losse herhalingen" />
        </Field>
      </div>
    );
  if (b.type === "emom") {
    const slots = Math.floor(num(b.durationSec, 0) / (num(b.everySec, 60) || 60));
    return (
      <Field label={`Intervallen gehaald${slots ? ` (van ${slots})` : ""}`}>
        <NumInput value={r.completed} onChange={(v) => setR({ completed: v })} step="1" ariaLabel="Intervallen gehaald" />
      </Field>
    );
  }
  if (b.type === "fortime" || b.type === "rondes")
    return (
      <Field label="Eindtijd">
        <DurationInput value={r.timeSec} onChange={(v) => setR({ timeSec: v })} placeholder="m:ss" ariaLabel="Eindtijd" />
      </Field>
    );
  if (b.type === "doorlopend") {
    const it = (b.items || [])[0];
    const byDist = it && num(it.distanceM);
    return byDist ? (
      <Field label="Tijd">
        <DurationInput value={r.timeSec} onChange={(v) => setR({ timeSec: v })} placeholder="m:ss" ariaLabel="Tijd" />
      </Field>
    ) : (
      <Field label="Afstand">
        <NumInput value={r.distanceM} onChange={(v) => setR({ distanceM: v })} unit="m" step="1" ariaLabel="Afstand" />
      </Field>
    );
  }
  if (b.type === "interval") {
    const n = Math.min(30, Math.max(0, num(b.rounds, 0)));
    const it = (b.items || [])[0];
    const byTime = b.items && b.items.length === 1 && it && num(it.timeSec) && !num(it.distanceM);
    const arr = byTime ? r.distances || [] : r.splits || [];
    const put = (i, v) => {
      const next = Array.from({ length: n }, (_, k) => (k === i ? v : arr[k] ?? null));
      setR(byTime ? { distances: next } : { splits: next });
    };
    return (
      <div>
        <div className="text-xs mb-1" style={{ color: C.muted, fontWeight: 500 }}>
          {byTime ? "Meters per herhaling (optioneel)" : "Tijd per herhaling (optioneel)"}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: n }, (_, i) =>
            byTime ? (
              <NumInput key={i} value={arr[i]} onChange={(v) => put(i, v)} unit="m" step="1" ariaLabel={`Herhaling ${i + 1} meters`} placeholder={`#${i + 1}`} />
            ) : (
              <DurationInput key={i} value={arr[i]} onChange={(v) => put(i, v)} placeholder={`#${i + 1}`} ariaLabel={`Herhaling ${i + 1} tijd`} />
            )
          )}
        </div>
      </div>
    );
  }
  return null;
}

/* Samenvatting onder een blok: wat het opleverde. */
function BlockSummary({ b }) {
  const v = blockVolume(b);
  const d = blockDuration(b);
  const bits = [];
  if (d) bits.push(`± ${fmtDuration(d, { long: true })}`);
  if (v.reps) bits.push(`${v.reps} herh.`);
  for (const [k, m] of Object.entries(v.distance)) bits.push(`${fmtKm(m)} ${(movementById(k) || { name: k }).name.toLowerCase().replace(/ \(.*\)/, "")}`);
  if (v.cal) bits.push(`${v.cal} cal`);
  if (v.tonnage) bits.push(`${Math.round(v.tonnage).toLocaleString("nl-NL")} kg totaal`);
  if (!bits.length) return null;
  return (
    <div className="text-xs tnum mt-2" style={{ color: C.muted }}>
      {bits.join(" · ")}
    </div>
  );
}

/* ---------------- één blok ---------------- */
function BlockCard({ b, set, remove, move, index, count }) {
  const [open, setOpen] = useState(true);
  const t = BLOCK_TYPES[b.type];
  const items = b.items || [];
  const setItem = (i, patch) => set({ items: items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const removeItem = (i) => set({ items: items.filter((_, k) => k !== i) });
  const result = blockResult(b);
  return (
    <div className="p-3" style={{ border: `1px solid ${C.line}`, borderRadius: R.field, background: C.panel }}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="tap text-left min-w-0" aria-expanded={open}>
          <span className="block eyebrow">
            Blok {index + 1} · {t.label}
          </span>
          <span className="block text-sm" style={{ color: C.ink, fontWeight: 600 }}>
            {blockHeader(b)}
            {result ? <span style={{ color: C.muted, fontWeight: 500 }}> · {result}</span> : null}
          </span>
        </button>
        <span className="flex shrink-0">
          {index > 0 && (
            <button type="button" onClick={() => move(-1)} className="tap px-1.5 text-sm" style={{ color: C.muted }} aria-label="Blok omhoog">
              ↑
            </button>
          )}
          {index < count - 1 && (
            <button type="button" onClick={() => move(1)} className="tap px-1.5 text-sm" style={{ color: C.muted }} aria-label="Blok omlaag">
              ↓
            </button>
          )}
          <button type="button" onClick={remove} className="tap p-1" style={{ color: C.muted }} aria-label="Blok verwijderen">
            <HIcon name="trash" size={17} />
          </button>
        </span>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {b.type !== "sets" && b.type !== "vrij" && (
            <Field label="Naam (optioneel)" hint="Geef een vaste workout een naam, dan ziet u uw beste resultaat terug.">
              <TextInput value={b.name} onChange={(v) => set({ name: v || undefined })} placeholder="bijv. Fran of Vrijdag-engine" ariaLabel="Naam van het blok" />
            </Field>
          )}
          <BlockSettings b={b} set={set} />
          {b.type === "vrij" ? (
            <Field label="Omschrijving">
              <TextInput multiline rows={4} value={b.text} onChange={(v) => set({ text: v })} ariaLabel="Omschrijving" />
            </Field>
          ) : (
            <div>
              {b.text && (
                <p className="text-xs mb-2 whitespace-pre-line" style={{ color: C.muted }}>
                  {b.text}
                </p>
              )}
              {items.map((it, i) =>
                b.type === "sets" ? (
                  <SetsRow key={i} it={it} set={(p) => setItem(i, p)} remove={() => removeItem(i)} />
                ) : (
                  <MovementRow key={i} it={it} b={b} set={(p) => setItem(i, p)} remove={() => removeItem(i)} />
                )
              )}
              <div className="pt-2">
                <MovementPicker
                  placeholder={b.type === "sets" ? "Oefening zoeken, bijv. squat of bankdrukken" : undefined}
                  onAdd={(it) => set({ items: [...items, b.type === "sets" ? { ...it, sets: [{ kg: null, reps: null, rir: null }] } : it] })}
                />
              </div>
            </div>
          )}
          {b.type !== "sets" && b.type !== "vrij" && items.length > 0 && (
            <div className="pt-1">
              <div className="eyebrow mb-1.5">Resultaat</div>
              <BlockResult b={b} set={set} />
            </div>
          )}
          <BlockSummary b={b} />
        </div>
      )}
    </div>
  );
}

/* ---------------- alle blokken van een sessie ---------------- */
export function BlocksEditor({ blocks, onChange, kind, types, startAdding = false }) {
  const [adding, setAdding] = useState(!blocks.length && (kind === "wod" || startAdding));
  const allowed = types || Object.keys(BLOCK_TYPES);
  const setBlock = (i, patch) => onChange(blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const move = (i, d) => {
    const next = [...blocks];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  const add = (b) => {
    onChange([...blocks, b]);
    setAdding(false);
  };
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <BlockCard key={b.id || i} b={b} index={i} count={blocks.length} set={(p) => setBlock(i, p)} remove={() => onChange(blocks.filter((_, k) => k !== i))} move={(d) => move(i, d)} />
      ))}
      {adding ? (
        <div className="p-3 space-y-3" style={{ border: `1.5px dashed ${C.line}`, borderRadius: R.field }}>
          <div className="eyebrow">Soort blok</div>
          <div className="grid grid-cols-2 gap-2">
            {allowed.map((k) => (
              <button key={k} type="button" onClick={() => add(newBlock(k))} className="tap text-left px-3 py-2" style={{ border: `1px solid ${C.line}`, borderRadius: R.field, background: C.panel }}>
                <span className="block text-sm" style={{ color: C.ink, fontWeight: 600 }}>
                  {BLOCK_TYPES[k].label}
                </span>
                <span className="block text-xs leading-snug" style={{ color: C.muted }}>
                  {BLOCK_TYPES[k].hint}
                </span>
              </button>
            ))}
          </div>
          {kind !== "duur" && (
            <>
              <div className="eyebrow pt-1">Of begin met een bekende workout</div>
              <div className="space-y-1.5">
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" onClick={() => add(t.make())} className="tap w-full text-left px-3 py-2" style={{ border: `1px solid ${C.line}`, borderRadius: R.field, background: C.panel }}>
                    <span className="block text-sm" style={{ color: C.ink, fontWeight: 600 }}>
                      {t.label}
                    </span>
                    <span className="block text-xs" style={{ color: C.muted }}>
                      {t.sub}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {(blocks.length > 0 || startAdding) && (
            <button type="button" onClick={() => setAdding(false)} className="tap text-sm" style={{ color: C.muted }}>
              Annuleren
            </button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="tap w-full flex items-center justify-center gap-1.5 py-2.5 text-sm" style={{ border: `1.5px dashed ${C.line}`, borderRadius: R.field, color: C.accent, fontWeight: 600 }}>
          <HIcon name="plus" size={16} /> Blok toevoegen
        </button>
      )}
    </div>
  );
}

