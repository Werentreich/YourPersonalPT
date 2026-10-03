/* Blokken bewerken: alle vormen van hybride training. Elke beweging toont
   alleen de maten die bij haar passen; elk bloktype zijn eigen instellingen
   en zijn eigen soort resultaat. */
import React, { useMemo, useState } from "react";
import { C, R } from "../../App.jsx";
import {
  BLOCK_TYPES,
  ROLES,
  SCALING,
  SET_KINDS,
  TEST_METRICS,
  INTERVAL_METRICS,
  TEMPLATES,
  TEMPLATE_CATS,
  newBlock,
  newItem,
  blockHeader,
  blockResult,
  blockVolume,
  blockDuration,
  tabataSlots,
  intervalUnit,
  freshBlock,
} from "../engine/blocks.js";
import { METRICS, movementById, searchMovements } from "../engine/movements.js";
import { fmtDuration, fmtKm, num } from "../engine/model.js";
import { Field, TextInput, NumInput, DurationInput, Choice, HIcon } from "./kit.jsx";
import { TimerSheet, canTime } from "./timer.jsx";

const small = { fontSize: 12, color: C.muted };
const chip = (on) => ({ borderRadius: 999, border: `1px solid ${on ? C.accent : C.line}`, background: on ? "var(--accent-soft)" : "transparent", color: C.ink, fontWeight: on ? 600 : 500 });

function Toggle({ on, onChange, children }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} onClick={() => onChange(!on)} className="tap px-2.5 py-1 text-xs" style={chip(on)}>
      {children}
    </button>
  );
}

/* ---------------- beweging kiezen ---------------- */
function MovementPicker({ onAdd, placeholder = "Beweging zoeken, bijv. roeien, wall balls, sled push" }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchMovements(q, 8), [q]);
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
  const opts = mv ? mv.metrics.filter((m) => PRIMARY.includes(m)) : PRIMARY;
  return opts[0] || "reps";
}

function ValueInput({ metric, it, set, label }) {
  if (metric === "time") return <DurationInput value={it.timeSec} onChange={(v) => set({ timeSec: v })} placeholder="m:ss" ariaLabel={`${label}: tijd`} />;
  if (metric === "distance") return <NumInput value={it.distanceM} onChange={(v) => set({ distanceM: v })} unit="m" step="1" ariaLabel={`${label}: meters`} />;
  if (metric === "cal") return <NumInput value={it.cal} onChange={(v) => set({ cal: v })} unit="cal" step="1" ariaLabel={`${label}: calorieën`} />;
  return <NumInput value={it.reps} onChange={(v) => set({ reps: v })} unit={it.perSide ? "p. kant" : "herh."} step="1" ariaLabel={`${label}: herhalingen`} />;
}

/* Welke velden een beweging in een blok toont. */
function fieldsFor(b, it, mv) {
  const metrics = mv ? mv.metrics : ["reps", "distance", "time", "cal", "kg"];
  const opts = metrics.filter((m) => PRIMARY.includes(m));
  const metric = primaryOf(it, mv);
  let showValue = true;
  // vaste werktijd of een reeks bepaalt de hoeveelheid al
  if (b.type === "tabata" || b.type === "deathby") showValue = false;
  if (hasSchemeB(b) && (metric === "reps" || b.type === "interval")) showValue = false;
  if (b.type === "test") {
    const m = b.testMetric || "time";
    showValue = m === "time"; // tijdrit: vaste hoeveelheid; anders is de hoeveelheid het resultaat
  }
  const showReps = b.type === "test" && b.testMetric === "kg";
  const hasKg = metrics.includes("kg") && !(b.type === "test" && b.testMetric === "kg");
  return { opts, metric, showValue, showReps, hasKg, hasHeight: metrics.includes("height") };
}
const hasSchemeB = (b) => Array.isArray(b.repScheme) && b.repScheme.length > 0;

function MovementRow({ it, b, set, remove }) {
  const mv = movementById(it.moveId);
  const label = it.name || (mv && mv.name) || "Beweging";
  const f = fieldsFor(b, it, mv);
  const switchMetric = (m) => set({ metric: m, reps: m === "reps" ? it.reps : null, distanceM: m === "distance" ? it.distanceM : null, timeSec: m === "time" ? it.timeSec : null, cal: m === "cal" ? it.cal : null });
  const cols = (f.showValue ? 1 : 0) + (f.showReps ? 1 : 0) + (f.hasKg ? 1 : 0) + (f.hasHeight ? 1 : 0);
  const hideMetricChoice = b.type === "test" && b.testMetric !== "time";
  return (
    <div className="py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
          {label}
          {mv && mv.perHand && f.hasKg ? <span style={{ ...small, fontWeight: 400 }}> · kg per hand</span> : null}
        </span>
        <span className="flex items-center gap-1.5">
          {(!mv || mv.uni) && f.metric === "reps" && (
            <Toggle on={it.perSide} onChange={(v) => set({ perSide: v })}>
              per kant
            </Toggle>
          )}
          <button type="button" onClick={remove} className="tap p-1" style={{ color: C.muted }} aria-label={`${label} verwijderen`}>
            <HIcon name="trash" size={17} />
          </button>
        </span>
      </div>
      {f.opts.length > 1 && !hideMetricChoice && (
        <div className="flex flex-wrap gap-1 mb-1.5" role="radiogroup" aria-label={`${label}: maat`}>
          {f.opts.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={f.metric === m} onClick={() => switchMetric(m)} className="tap px-2 py-0.5 text-xs" style={chip(f.metric === m)}>
              {METRICS[m].label}
            </button>
          ))}
        </div>
      )}
      {cols > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {f.showValue && <ValueInput metric={f.metric} it={it} set={set} label={label} />}
          {f.showReps && <NumInput value={it.reps} onChange={(v) => set({ reps: v })} unit="herh." step="1" ariaLabel={`${label}: aantal herhalingen (bijv. 1 voor 1RM)`} placeholder="1" />}
          {f.hasKg && <NumInput value={it.kg} onChange={(v) => set({ kg: v })} unit="kg" ariaLabel={`${label}: gewicht`} placeholder="kg" />}
          {f.hasHeight && <NumInput value={it.heightCm} onChange={(v) => set({ heightCm: v })} unit="cm" step="1" ariaLabel={`${label}: hoogte`} placeholder="hoogte" />}
        </div>
      )}
      {hasSchemeB(b) && f.metric === "reps" && b.type !== "interval" && <div style={small} className="mt-1">Herhalingen volgen de reeks {b.repScheme.join("-")}.</div>}
    </div>
  );
}

/* Klassieke sets: per set kg × herhalingen × RIR, met soort set en details. */
function SetsRow({ it, set, remove, letter }) {
  const [more, setMore] = useState(!!(it.tempo || it.restSec || it.pct || it.perSide));
  const sets = it.sets || [];
  const mv = movementById(it.moveId);
  const setRow = (j, patch) => set({ sets: sets.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
  const label = it.name || "Oefening";
  const cols = "26px 1fr 1fr 1fr 64px 20px";
  return (
    <div className="py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
          {letter && <span style={{ color: C.muted }}>{letter} </span>}
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <Toggle on={more} onChange={setMore}>
            details
          </Toggle>
          <button type="button" onClick={remove} className="tap p-1" style={{ color: C.muted }} aria-label={`${label} verwijderen`}>
            <HIcon name="trash" size={17} />
          </button>
        </span>
      </div>
      {more && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          <Field label="Tempo" hint="bijv. 3-1-1-0">
            <TextInput value={it.tempo} onChange={(v) => set({ tempo: v || undefined })} ariaLabel={`${label}: tempo`} />
          </Field>
          <Field label="Rust per set">
            <DurationInput value={it.restSec} onChange={(v) => set({ restSec: v })} placeholder="m:ss" ariaLabel={`${label}: rust per set`} />
          </Field>
          <Field label="% van 1RM">
            <NumInput value={it.pct} onChange={(v) => set({ pct: v })} unit="%" step="1" ariaLabel={`${label}: percentage van 1RM`} />
          </Field>
          {(!mv || mv.uni) && (
            <div className="col-span-3">
              <Toggle on={it.perSide} onChange={(v) => set({ perSide: v })}>
                herhalingen per kant
              </Toggle>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-1.5 mb-1" style={{ gridTemplateColumns: cols, ...small }}>
        <span>Set</span>
        <span>kg</span>
        <span>Herh.</span>
        <span title="Herhalingen in reserve">RIR</span>
        <span>Soort</span>
        <span />
      </div>
      {sets.map((x, j) => (
        <div key={j} className="grid gap-1.5 items-center mb-1.5" style={{ gridTemplateColumns: cols }}>
          <span className="text-sm tnum" style={{ color: x.kind === "warmup" ? C.muted : C.ink }}>
            {x.kind === "warmup" ? "W" : j + 1 - sets.slice(0, j).filter((y) => y.kind === "warmup").length}
          </span>
          <NumInput value={x.kg} onChange={(v) => setRow(j, { kg: v })} ariaLabel={`${label} set ${j + 1} kilogram`} />
          <NumInput value={x.reps} onChange={(v) => setRow(j, { reps: v })} step="1" ariaLabel={`${label} set ${j + 1} herhalingen`} />
          <NumInput value={x.rir} onChange={(v) => setRow(j, { rir: v })} step="1" ariaLabel={`${label} set ${j + 1} herhalingen in reserve`} />
          <select
            value={x.kind || "work"}
            onChange={(e) => setRow(j, { kind: e.target.value === "work" ? undefined : e.target.value })}
            aria-label={`${label} set ${j + 1} soort`}
            className="w-full px-1 py-2.5 text-xs"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink }}
          >
            {Object.entries(SET_KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => set({ sets: sets.filter((_, k) => k !== j) })} className="tap" style={{ color: C.muted }} aria-label={`${label} set ${j + 1} verwijderen`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set({ sets: [...sets, { ...(sets[sets.length - 1] || { kg: null, reps: null, rir: null }), kind: undefined }] })} className="tap text-sm mt-1" style={{ color: C.accent, fontWeight: 600 }}>
        + Set
      </button>
    </div>
  );
}

/* ---------------- instellingen per bloktype ---------------- */
const parseScheme = (t) => {
  const xs = String(t || "")
    .split(/[^0-9:]+/)
    .filter(Boolean)
    .map((x) => (x.includes(":") ? x.split(":").reduce((a, y) => a * 60 + Number(y), 0) : Number(x)))
    .filter((x) => x > 0);
  return xs.length > 1 ? xs : null;
};

function SchemeField({ b, set, label = "Of een reeks", hint = "bijv. 21-15-9 of 10-8-6-4-2" }) {
  const [text, setText] = useState(hasSchemeB(b) ? (b.type === "interval" && intervalUnit(b) === "time" ? b.repScheme.map((x) => fmtDuration(x)).join("-") : b.repScheme.join("-")) : "");
  return (
    <Field label={label} hint={hint}>
      <TextInput
        value={text}
        onChange={(t) => {
          setText(t);
          set({ repScheme: parseScheme(t) });
        }}
        inputMode="numeric"
        ariaLabel={label}
      />
    </Field>
  );
}

const EVERY = [60, 90, 120, 180, 240, 300];

function BlockSettings({ b, set }) {
  if (b.type === "rondes")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rondes">
          <NumInput value={b.rounds} onChange={(v) => set({ rounds: v })} step="1" ariaLabel="Aantal rondes" />
        </Field>
        <Field label="Rust tussen rondes">
          <DurationInput value={b.restSec} onChange={(v) => set({ restSec: v })} placeholder="m:ss" ariaLabel="Rust tussen rondes" />
        </Field>
        <div className="col-span-2">
          <SchemeField b={b} set={set} />
        </div>
      </div>
    );
  if (b.type === "amrap")
    return (
      <Field label="Duur">
        <DurationInput value={b.capSec} onChange={(v) => set({ capSec: v })} placeholder="min" ariaLabel="Duur van de AMRAP" />
      </Field>
    );
  if (b.type === "emom") {
    const every = num(b.everySec, 60) || 60;
    const rounds = Math.floor(num(b.durationSec, 0) / every);
    return (
      <div className="space-y-3">
        <Field label="Elke">
          <Choice options={EVERY.map((s) => ({ value: s, label: s === 90 ? "1:30" : `${s / 60} min` }))} value={EVERY.includes(every) ? every : null} onChange={(v) => set({ everySec: v, durationSec: v * (rounds || 10) })} ariaLabel="Interval" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Eigen interval">
            <DurationInput value={every} onChange={(v) => v && set({ everySec: v, durationSec: v * (rounds || 1) })} placeholder="m:ss" ariaLabel="Eigen interval" />
          </Field>
          <Field label="Rondes">
            <NumInput value={rounds || null} onChange={(v) => set({ durationSec: (v || 0) * every })} step="1" ariaLabel="Aantal rondes" />
          </Field>
          <Field label="Totaal">
            <DurationInput value={b.durationSec} onChange={(v) => set({ durationSec: v })} placeholder="min" ariaLabel="Totale duur" />
          </Field>
        </div>
        <Field label="Per interval" hint={every > 60 ? "De tijd die overblijft is rust." : null}>
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
  }
  if (b.type === "fortime")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tijdslimiet (optioneel)">
          <DurationInput value={b.capSec} onChange={(v) => set({ capSec: v })} placeholder="min" ariaLabel="Tijdslimiet" />
        </Field>
        <Field label="Rondes">
          <NumInput value={b.rounds} onChange={(v) => set({ rounds: v })} step="1" placeholder="1" ariaLabel="Aantal rondes" />
        </Field>
        <div className="col-span-2">
          <SchemeField b={b} set={set} />
        </div>
      </div>
    );
  if (b.type === "tabata") {
    const slots = tabataSlots(b);
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label={b.tabataMode === "wissel" ? "Intervallen" : "Rondes per beweging"}>
            <NumInput value={b.rounds} onChange={(v) => set({ rounds: v })} step="1" ariaLabel="Rondes" />
          </Field>
          <Field label="Werk">
            <NumInput value={b.workSec} onChange={(v) => set({ workSec: v })} unit="s" step="1" ariaLabel="Werktijd in seconden" />
          </Field>
          <Field label="Rust">
            <NumInput value={b.restSec} onChange={(v) => set({ restSec: v })} unit="s" step="1" ariaLabel="Rusttijd in seconden" />
          </Field>
        </div>
        <Field label="Volgorde" hint={`${slots} intervallen, totaal ${fmtDuration(blockDuration(b) || 0)}`}>
          <Choice
            options={[
              { value: "volgorde", label: "Per beweging alle rondes" },
              { value: "wissel", label: "Om de beurt" },
            ]}
            value={b.tabataMode || "volgorde"}
            onChange={(v) => set({ tabataMode: v })}
            ariaLabel="Volgorde"
          />
        </Field>
      </div>
    );
  }
  if (b.type === "deathby")
    return (
      <Field label="Erbij per minuut" hint="Minuut 1: 1 herhaling, minuut 2: 2, enzovoort.">
        <NumInput value={b.step} onChange={(v) => set({ step: v })} step="1" ariaLabel="Herhalingen erbij per minuut" />
      </Field>
    );
  if (b.type === "interval")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Herhalingen">
          <NumInput value={hasSchemeB(b) ? b.repScheme.length : b.rounds} onChange={(v) => set({ rounds: v })} step="1" ariaLabel="Aantal herhalingen" />
        </Field>
        <Field label="Rust ertussen">
          <DurationInput value={b.restSec} onChange={(v) => set({ restSec: v })} placeholder="m:ss" ariaLabel="Rust tussen de herhalingen" />
        </Field>
        <div className="col-span-2">
          <SchemeField b={b} set={set} label="Of per herhaling anders" hint="meters (400-800-1200-800-400) of tijd (1:00-2:00-3:00)" />
        </div>
      </div>
    );
  if (b.type === "test")
    return (
      <div className="space-y-3">
        <Field label="Wat test u?" hint={TEST_METRICS[b.testMetric || "time"].hint}>
          <Choice options={Object.entries(TEST_METRICS).map(([value, t]) => ({ value, label: t.label }))} value={b.testMetric || "time"} onChange={(v) => set({ testMetric: v, result: {} })} ariaLabel="Soort test" />
        </Field>
        {(b.testMetric === "reps" || b.testMetric === "cal" || b.testMetric === "distance") && (
          <Field label={b.testMetric === "reps" ? "Binnen een tijd (optioneel)" : "Tijd"}>
            <DurationInput value={b.capSec} onChange={(v) => set({ capSec: v })} placeholder="m:ss" ariaLabel="Tijd van de test" />
          </Field>
        )}
      </div>
    );
  if (b.type === "complex") {
    const sets = b.sets || [];
    return (
      <div>
        <div className="text-xs mb-1" style={{ color: C.muted, fontWeight: 500 }}>
          Gewicht per set
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {sets.map((x, j) => (
            <NumInput key={j} value={x.kg} onChange={(v) => set({ sets: sets.map((y, k) => (k === j ? { kg: v } : y)) })} unit="kg" ariaLabel={`Set ${j + 1} kilogram`} placeholder={`#${j + 1}`} />
          ))}
        </div>
        <div className="flex gap-3 mt-1.5">
          <button type="button" onClick={() => set({ sets: [...sets, { kg: sets.length ? sets[sets.length - 1].kg : null }] })} className="tap text-sm" style={{ color: C.accent, fontWeight: 600 }}>
            + Set
          </button>
          {sets.length > 1 && (
            <button type="button" onClick={() => set({ sets: sets.slice(0, -1) })} className="tap text-sm" style={{ color: C.muted }}>
              − Set
            </button>
          )}
        </div>
      </div>
    );
  }
  return null;
}

/* Rol, partner, vest, schaling en doel: voor alle blokken behalve vrij. */
function BlockOptions({ b, set }) {
  const [open, setOpen] = useState(!!(num(b.partners, 1) > 1 || b.vestKg || b.scaling));
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="tap text-xs" style={{ color: C.muted }}>
        + Meer opties (rol, partner, vest, Rx, doel)
      </button>
    );
  const canIntensity = ["interval", "doorlopend", "tabata", "emom", "rondes"].includes(b.type);
  return (
    <div className="space-y-3 p-3" style={{ background: C.surface2, borderRadius: R.field }}>
      <Field label="Rol in de training">
        <Choice options={[{ value: "", label: "Geen" }, ...Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label }))]} value={b.role || ""} onChange={(v) => set({ role: v || undefined })} ariaLabel="Rol van het blok" />
      </Field>
      {b.type !== "sets" && b.type !== "complex" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Met partner of team" hint="Het werk wordt verdeeld.">
            <Choice options={[1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? "Alleen" : `${n} pers.` }))} value={num(b.partners, 1)} onChange={(v) => set({ partners: v === 1 ? undefined : v })} ariaLabel="Aantal personen" />
          </Field>
          <Field label="Gewichtsvest">
            <NumInput value={b.vestKg} onChange={(v) => set({ vestKg: v })} unit="kg" ariaLabel="Gewichtsvest in kilogram" />
          </Field>
        </div>
      )}
      {(b.name || ["amrap", "fortime", "rondes", "emom"].includes(b.type)) && (
        <Field label="Uitvoering">
          <Choice options={[{ value: "", label: "–" }, ...Object.entries(SCALING).map(([value, s]) => ({ value, label: s.label }))]} value={b.scaling || ""} onChange={(v) => set({ scaling: v || undefined })} ariaLabel="Rx of geschaald" />
        </Field>
      )}
      {canIntensity && (
        <Field label="Doel" hint="bijv. zone 2, 1:45/500 m, 90% HRmax of RPE 8">
          <TextInput value={b.intensity} onChange={(v) => set({ intensity: v || undefined })} ariaLabel="Doel of intensiteit" />
        </Field>
      )}
    </div>
  );
}

/* ---------------- resultaat per bloktype ---------------- */
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
      <div className="space-y-2">
        {!r.capped ? (
          <Field label="Eindtijd">
            <DurationInput value={r.timeSec} onChange={(v) => setR({ timeSec: v })} placeholder="m:ss" ariaLabel="Eindtijd" />
          </Field>
        ) : (
          <Field label="Herhalingen nog over bij de cap">
            <NumInput value={r.repsLeft} onChange={(v) => setR({ repsLeft: v })} step="1" ariaLabel="Herhalingen over" />
          </Field>
        )}
        {(num(b.capSec) || r.capped) && (
          <Toggle on={r.capped} onChange={(v) => setR({ capped: v || undefined, timeSec: v ? null : r.timeSec })}>
            niet binnen de tijdslimiet
          </Toggle>
        )}
      </div>
    );
  if (b.type === "tabata")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Herhalingen totaal">
          <NumInput value={r.reps} onChange={(v) => setR({ reps: v })} step="1" ariaLabel="Herhalingen totaal" />
        </Field>
        <Field label="Laagste ronde" hint="de klassieke Tabata-score">
          <NumInput value={r.low} onChange={(v) => setR({ low: v })} step="1" ariaLabel="Laagste ronde" />
        </Field>
      </div>
    );
  if (b.type === "deathby")
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minuten volgehouden">
          <NumInput value={r.rounds} onChange={(v) => setR({ rounds: v })} step="1" ariaLabel="Minuten volgehouden" />
        </Field>
        <Field label="+ herhalingen in de laatste">
          <NumInput value={r.reps} onChange={(v) => setR({ reps: v })} step="1" ariaLabel="Herhalingen in de laatste minuut" />
        </Field>
      </div>
    );
  if (b.type === "doorlopend") {
    const it = (b.items || [])[0];
    const byDist = it && num(it.distanceM);
    return (
      <div className="grid grid-cols-2 gap-3">
        {byDist ? (
          <Field label="Tijd">
            <DurationInput value={r.timeSec} onChange={(v) => setR({ timeSec: v })} placeholder="m:ss" ariaLabel="Tijd" />
          </Field>
        ) : (
          <Field label="Afstand">
            <NumInput value={r.distanceM} onChange={(v) => setR({ distanceM: v })} unit="m" step="1" ariaLabel="Afstand" />
          </Field>
        )}
        <Field label="Gem. vermogen (optioneel)">
          <NumInput value={r.avgWatt} onChange={(v) => setR({ avgWatt: v })} unit="W" step="1" ariaLabel="Gemiddeld vermogen" />
        </Field>
      </div>
    );
  }
  if (b.type === "test") {
    const m = b.testMetric || "time";
    return m === "time" ? (
      <Field label="Tijd">
        <DurationInput value={r.value} onChange={(v) => setR({ value: v })} placeholder="m:ss" ariaLabel="Testtijd" />
      </Field>
    ) : (
      <Field label={m === "kg" ? "Gewicht" : m === "reps" ? "Herhalingen" : m === "cal" ? "Calorieën" : "Meters"}>
        <NumInput value={r.value} onChange={(v) => setR({ value: v })} unit={m === "kg" ? "kg" : m === "cal" ? "cal" : m === "distance" ? "m" : "herh."} ariaLabel="Testresultaat" />
      </Field>
    );
  }
  if (b.type === "interval") {
    const n = Math.min(30, Math.max(0, hasSchemeB(b) ? b.repScheme.length : num(b.rounds, 0)));
    const it = (b.items || [])[0];
    const defMetric = b.items && b.items.length === 1 && it && (num(it.timeSec) || it.metric === "time") && !num(it.distanceM) ? "distance" : "time";
    const metric = r.metric || (Array.isArray(r.distances) && r.distances.some((x) => x > 0) ? "distance" : Array.isArray(r.splits) && r.splits.some((x) => x > 0) ? "time" : defMetric);
    const arr = r.metric ? r.values || [] : metric === "distance" ? r.distances || [] : r.splits || [];
    const put = (i, v) => {
      const next = Array.from({ length: n }, (_, k) => (k === i ? v : arr[k] ?? null));
      if (metric === "time") setR({ metric: undefined, values: undefined, splits: next });
      else if (metric === "distance") setR({ metric: undefined, values: undefined, distances: next });
      else setR({ metric, values: next });
    };
    const switchMetric = (m) => setR({ metric: m === "time" || m === "distance" ? undefined : m, values: m === "time" || m === "distance" ? undefined : [], splits: m === "time" ? r.splits || [] : undefined, distances: m === "distance" ? r.distances || [] : undefined });
    return (
      <div>
        <div className="flex flex-wrap gap-1 mb-1.5" role="radiogroup" aria-label="Resultaat per herhaling in">
          {Object.entries(INTERVAL_METRICS).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={metric === k} onClick={() => switchMetric(k)} className="tap px-2 py-0.5 text-xs" style={chip(metric === k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: n }, (_, i) =>
            metric === "time" ? (
              <DurationInput key={i} value={arr[i]} onChange={(v) => put(i, v)} placeholder={`#${i + 1}`} ariaLabel={`Herhaling ${i + 1} tijd`} />
            ) : (
              <NumInput key={i} value={arr[i]} onChange={(v) => put(i, v)} unit={metric === "distance" ? "m" : metric === "cal" ? "cal" : metric === "watt" ? "W" : ""} step="1" ariaLabel={`Herhaling ${i + 1} ${INTERVAL_METRICS[metric].toLowerCase()}`} placeholder={`#${i + 1}`} />
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
  if (v.reps) bits.push(`${Math.round(v.reps)} herh.`);
  for (const [k, m] of Object.entries(v.distance)) bits.push(`${fmtKm(m)} ${(movementById(k) || { name: k }).name.toLowerCase().replace(/ \(.*\)/, "")}`);
  if (v.cal) bits.push(`${Math.round(v.cal)} cal`);
  if (v.tonnage) bits.push(`${Math.round(v.tonnage).toLocaleString("nl-NL")} kg totaal`);
  if (num(b.partners, 1) > 1) bits.push(`uw deel bij ${b.partners} personen`);
  if (!bits.length) return null;
  return (
    <div className="text-xs tnum mt-2" style={{ color: C.muted }}>
      {bits.join(" · ")}
    </div>
  );
}

/* ---------------- één blok ---------------- */
function BlockCard({ b, set, remove, move, duplicate, saveTemplate, onTimer, index, count }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  const t = BLOCK_TYPES[b.type];
  const items = b.items || [];
  const setItem = (i, patch) => set({ items: items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const removeItem = (i) => set({ items: items.filter((_, k) => k !== i) });
  const result = blockResult(b);
  const isSets = b.type === "sets";
  const oneItem = b.type === "test";
  return (
    <div className="p-3" style={{ border: `1px solid ${C.line}`, borderRadius: R.field, background: C.panel }}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="tap text-left min-w-0" aria-expanded={open}>
          <span className="block eyebrow">
            Blok {index + 1} · {t.label}
            {b.role ? ` · ${ROLES[b.role].label}` : ""}
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
          {b.type !== "vrij" && (
            <Field label="Naam (optioneel)" hint={b.type === "sets" ? null : "Geef een vaste workout een naam, dan ziet u uw beste resultaat terug."}>
              <TextInput value={b.name} onChange={(v) => set({ name: v || undefined })} placeholder={isSets ? "bijv. Hoofdlift" : "bijv. Fran of Vrijdag-engine"} ariaLabel="Naam van het blok" />
            </Field>
          )}
          {isSets && (
            <Toggle on={b.superset} onChange={(v) => set({ superset: v || undefined })}>
              superset: oefeningen afwisselen
            </Toggle>
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
                isSets ? (
                  <SetsRow key={i} it={it} set={(p) => setItem(i, p)} remove={() => removeItem(i)} letter={b.superset ? `A${i + 1}` : null} />
                ) : b.type === "complex" ? (
                  <div key={i} className="py-2 flex items-center gap-2" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                    <span className="text-sm flex-1" style={{ color: C.ink, fontWeight: 600 }}>
                      {it.name}
                    </span>
                    <div style={{ width: 110 }}>
                      <NumInput value={it.reps} onChange={(v) => setItem(i, { reps: v })} unit="herh." step="1" ariaLabel={`${it.name}: herhalingen per set`} />
                    </div>
                    <button type="button" onClick={() => removeItem(i)} className="tap p-1" style={{ color: C.muted }} aria-label={`${it.name} verwijderen`}>
                      <HIcon name="trash" size={17} />
                    </button>
                  </div>
                ) : (
                  <MovementRow key={i} it={it} b={b} set={(p) => setItem(i, p)} remove={() => removeItem(i)} />
                )
              )}
              {!(oneItem && items.length >= 1) && (
                <div className="pt-2">
                  <MovementPicker
                    placeholder={isSets || b.type === "complex" ? "Oefening zoeken, bijv. squat of power clean" : undefined}
                    onAdd={(it) => set({ items: [...items, isSets ? { ...it, sets: [{ kg: null, reps: null, rir: null }] } : b.type === "complex" ? { ...it, reps: 1 } : it] })}
                  />
                </div>
              )}
            </div>
          )}
          {b.type !== "vrij" && <BlockOptions b={b} set={set} />}
          {!isSets && b.type !== "vrij" && b.type !== "complex" && items.length > 0 && (
            <div className="pt-1">
              <div className="eyebrow mb-1.5">Resultaat</div>
              <BlockResult b={b} set={set} />
            </div>
          )}
          <BlockSummary b={b} />
          {onTimer && canTime(b) && (
            <button type="button" onClick={onTimer} className="tap w-full py-2.5 text-sm" style={{ border: `1px solid ${C.accent}`, borderRadius: R.field, color: C.accent, fontWeight: 600, background: "transparent" }}>
              Timer starten
            </button>
          )}
          <div className="flex gap-4 pt-1">
            <button type="button" onClick={duplicate} className="tap text-xs" style={{ color: C.muted }}>
              Blok dupliceren
            </button>
            {saveTemplate && b.type !== "vrij" && items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  saveTemplate(b);
                  setSaved(true);
                }}
                className="tap text-xs"
                style={{ color: saved ? C.accent : C.muted }}
              >
                {saved ? "Bewaard als eigen template" : "Bewaren als eigen template"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- templates kiezen ---------------- */
function TemplatePicker({ onPick, custom = [], onDeleteCustom, kind }) {
  const [cat, setCat] = useState(custom.length ? "Eigen" : kind === "kracht" ? "Kracht" : kind === "mobiliteit" ? "Mobiliteit" : kind === "duur" ? "Duur" : kind === "hyrox" ? "Hyrox" : "Benchmark");
  const [q, setQ] = useState("");
  const cats = [...(custom.length ? ["Eigen"] : []), ...TEMPLATE_CATS];
  const list = q.trim()
    ? [...custom.map((c) => ({ ...c, cat: "Eigen" })), ...TEMPLATES].filter((t) => (t.label + " " + (t.sub || "")).toLowerCase().includes(q.trim().toLowerCase()))
    : cat === "Eigen"
    ? custom.map((c) => ({ ...c, cat: "Eigen" }))
    : TEMPLATES.filter((t) => t.cat === cat);
  return (
    <div className="space-y-2">
      <TextInput value={q} onChange={setQ} placeholder="Zoek een workout, bijv. Murph of 4×4" ariaLabel="Workout zoeken" />
      {!q.trim() && (
        <div className="flex flex-wrap gap-1">
          {cats.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className="tap px-2.5 py-1 text-xs" style={chip(cat === c)} aria-pressed={cat === c}>
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {list.map((t) => (
          <div key={t.id} className="flex items-stretch gap-1">
            <button type="button" onClick={() => onPick(t.cat === "Eigen" ? freshBlock(t.block) : t.make())} className="tap flex-1 text-left px-3 py-2" style={{ border: `1px solid ${C.line}`, borderRadius: R.field, background: C.panel }}>
              <span className="block text-sm" style={{ color: C.ink, fontWeight: 600 }}>
                {t.label}
              </span>
              <span className="block text-xs" style={{ color: C.muted }}>
                {t.sub}
              </span>
            </button>
            {t.cat === "Eigen" && onDeleteCustom && (
              <button type="button" onClick={() => onDeleteCustom(t.id)} className="tap px-2" style={{ color: C.muted }} aria-label={`${t.label} verwijderen`}>
                <HIcon name="trash" size={16} />
              </button>
            )}
          </div>
        ))}
        {!list.length && <p className="text-xs" style={{ color: C.muted }}>Niets gevonden.</p>}
      </div>
    </div>
  );
}

/* ---------------- alle blokken van een sessie ---------------- */
export function BlocksEditor({ blocks, onChange, kind, types, startAdding = false, customTemplates, onSaveTemplate, onDeleteTemplate }) {
  const [adding, setAdding] = useState(!blocks.length && (kind === "wod" || startAdding));
  const [mode, setMode] = useState("type");
  const [timerFor, setTimerFor] = useState(null);
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
        <BlockCard
          key={b.id || i}
          b={b}
          index={i}
          count={blocks.length}
          set={(p) => setBlock(i, p)}
          remove={() => onChange(blocks.filter((_, k) => k !== i))}
          move={(d) => move(i, d)}
          duplicate={() => onChange([...blocks.slice(0, i + 1), freshBlock(b), ...blocks.slice(i + 1)])}
          saveTemplate={onSaveTemplate}
          onTimer={() => setTimerFor(i)}
        />
      ))}
      {timerFor != null && blocks[timerFor] && (
        <TimerSheet
          block={blocks[timerFor]}
          onClose={() => setTimerFor(null)}
          onResult={(result) => {
            setBlock(timerFor, { result });
            setTimerFor(null);
          }}
        />
      )}
      {adding ? (
        <div className="p-3 space-y-3" style={{ border: `1.5px dashed ${C.line}`, borderRadius: R.field }}>
          <div className="flex gap-1">
            <button type="button" onClick={() => setMode("type")} className="tap px-2.5 py-1 text-xs" style={chip(mode === "type")} aria-pressed={mode === "type"}>
              Soort blok
            </button>
            <button type="button" onClick={() => setMode("tpl")} className="tap px-2.5 py-1 text-xs" style={chip(mode === "tpl")} aria-pressed={mode === "tpl"}>
              Bekende workouts en testen
            </button>
          </div>
          {mode === "type" ? (
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
          ) : (
            <TemplatePicker onPick={add} custom={customTemplates || []} onDeleteCustom={onDeleteTemplate} kind={kind} />
          )}
          {(blocks.length > 0 || startAdding) && (
            <button type="button" onClick={() => setAdding(false)} className="tap text-sm" style={{ color: C.muted }}>
              Annuleren
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setMode("type");
            setAdding(true);
          }}
          className="tap w-full flex items-center justify-center gap-1.5 py-2.5 text-sm" style={{ border: `1.5px dashed ${C.line}`, borderRadius: R.field, color: C.accent, fontWeight: 600 }}>
          <HIcon name="plus" size={16} /> Blok toevoegen
        </button>
      )}
    </div>
  );
}
