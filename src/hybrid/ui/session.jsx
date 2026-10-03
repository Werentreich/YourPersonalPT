/* Sessie vastleggen of wijzigen: kracht, duur, WOD, Hyrox en mobiliteit,
   plus een activiteit importeren uit een FIT-, GPX- of TCX-bestand. */
import React, { useMemo, useRef, useState } from "react";
import { C, R, Sheet, TBtn, EXERCISES } from "../../App.jsx";
import { K } from "../theme.js";
import {
  SPORTS,
  ENDURANCE_TYPES,
  WOD_FORMATS,
  HYROX_STATIONS,
  HYROX_MODES,
  KINDS,
  newSession,
  fmtPace,
  fmtDuration,
  fmtKm,
  hyroxTotal,
  sessionTitle,
} from "../engine/model.js";
import { sessionLoad } from "../engine/load.js";
import { importActivity } from "../import/files.js";
import { Field, TextInput, NumInput, DurationInput, Choice, RpeInput, HIcon, PillarDot } from "./kit.jsx";

export const EX_INDEX = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/* ---------------- soort kiezen ---------------- */
const STARTS = [
  { id: "kracht", label: "Kracht", kind: "kracht" },
  { id: "hardlopen", label: "Hardlopen", kind: "duur", sport: "hardlopen" },
  { id: "fietsen", label: "Fietsen", kind: "duur", sport: "fietsen" },
  { id: "roeien", label: "Roeien", kind: "duur", sport: "roeien" },
  { id: "skierg", label: "SkiErg", kind: "duur", sport: "skierg" },
  { id: "zwemmen", label: "Zwemmen", kind: "duur", sport: "zwemmen" },
  { id: "wandelen", label: "Wandelen / rucken", kind: "duur", sport: "wandelen" },
  { id: "wod", label: "WOD", kind: "wod" },
  { id: "hyrox", label: "Hyrox", kind: "hyrox" },
  { id: "mobiliteit", label: "Mobiliteit", kind: "mobiliteit" },
];

function KindPicker({ onPick, onImported }) {
  const file = useRef(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    if (f.size > 25 * 1024 * 1024) return setErr("Dit bestand is groter dan 25 MB.");
    setBusy(true);
    try {
      const r = importActivity(f.name, await f.arrayBuffer());
      onImported(r);
    } catch (x) {
      setErr((x && x.message) || "Dit bestand kon niet worden gelezen.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {STARTS.map((s) => {
          const pillar = KINDS[s.kind].pillar;
          return (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="tap flex items-center gap-2.5 px-3 py-3 text-left text-sm"
              style={{ border: `1px solid ${C.line}`, borderRadius: R.field, background: C.panel, color: C.ink, fontWeight: 600 }}
            >
              <PillarDot pillar={pillar} size={10} />
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="pt-1">
        <input ref={file} type="file" accept=".fit,.gpx,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml,application/octet-stream" className="hidden" onChange={onFile} />
        <button
          onClick={() => file.current && file.current.click()}
          disabled={busy}
          className="tap w-full flex items-center justify-center gap-2 py-3 text-sm"
          style={{ border: `1.5px dashed ${C.line}`, borderRadius: R.field, color: C.accent, fontWeight: 600, background: "transparent" }}
        >
          <HIcon name="upload" size={18} /> {busy ? "Bestand lezen…" : "Importeren uit bestand (FIT, GPX, TCX)"}
        </button>
        <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
          Van uw horloge of fietscomputer: Garmin, Coros, Polar, Suunto, Wahoo, of een export uit Strava. Een route blijft alleen op dit apparaat.
        </p>
        {err && (
          <p className="text-xs mt-2" style={{ color: C.train }} role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- formulieren per soort ---------------- */
const sportOpts = Object.entries(SPORTS).map(([value, s]) => ({ value, label: s.label }));
const typeOpts = Object.entries(ENDURANCE_TYPES).map(([value, t]) => ({ value, label: t.label }));

function EnduranceForm({ s, set }) {
  const pace = fmtPace(s.sport, s.durationSec, s.distanceM);
  const powerSport = s.sport === "fietsen" || s.sport === "roeien" || s.sport === "skierg";
  return (
    <div className="space-y-4">
      <Field label="Sport" hint={s.source !== "handmatig" && !s.sportDetected ? "De sport stond niet in het bestand; kies hem hier." : null}>
        <Choice options={sportOpts} value={s.sport} onChange={(v) => set({ sport: v })} ariaLabel="Sport" />
      </Field>
      <Field label="Soort training">
        <Choice options={typeOpts} value={s.type} onChange={(v) => set({ type: v })} ariaLabel="Soort training" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tijd" hint="bijv. 45 of 1:02:15">
          <DurationInput value={s.durationSec} onChange={(v) => set({ durationSec: v })} ariaLabel="Tijd" />
        </Field>
        <Field label="Afstand" hint={pace ? `tempo ${pace}` : null}>
          <NumInput value={s.distanceM != null ? Math.round(s.distanceM / 10) / 100 : null} onChange={(v) => set({ distanceM: v == null ? null : v * 1000 })} unit="km" ariaLabel="Afstand in kilometer" />
        </Field>
        <Field label="Gem. hartslag">
          <NumInput value={s.avgHr} onChange={(v) => set({ avgHr: v })} unit="bpm" ariaLabel="Gemiddelde hartslag" />
        </Field>
        <Field label="Max. hartslag">
          <NumInput value={s.maxHr} onChange={(v) => set({ maxHr: v })} unit="bpm" ariaLabel="Maximale hartslag" />
        </Field>
        {powerSport && (
          <Field label="Gem. vermogen">
            <NumInput value={s.avgPower} onChange={(v) => set({ avgPower: v })} unit="W" ariaLabel="Gemiddeld vermogen" />
          </Field>
        )}
        {(s.sport === "hardlopen" || s.sport === "fietsen" || s.sport === "wandelen") && (
          <Field label="Hoogtemeters">
            <NumInput value={s.elevGain} onChange={(v) => set({ elevGain: v })} unit="m" ariaLabel="Hoogtemeters" />
          </Field>
        )}
      </div>
    </div>
  );
}

function ExercisePicker({ onAdd }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return EXERCISES.filter((e) => e.name.toLowerCase().includes(t)).slice(0, 6);
  }, [q]);
  const add = (ex) => {
    onAdd(ex ? { exId: ex.id, name: ex.name, muscle: ex.pri[0] } : { name: q.trim() });
    setQ("");
  };
  return (
    <div>
      <TextInput value={q} onChange={setQ} placeholder="Oefening zoeken of typen, bijv. squat" ariaLabel="Oefening zoeken" />
      {q.trim() && (
        <div className="mt-1.5 overflow-hidden" style={{ border: `1px solid ${C.line}`, borderRadius: R.field }}>
          {hits.map((e) => (
            <button key={e.id} onClick={() => add(e)} className="tap w-full text-left px-3 py-2 text-sm" style={{ color: C.ink, borderBottom: `1px solid ${C.lineSoft}`, background: C.panel }}>
              {e.name}
            </button>
          ))}
          <button onClick={() => add(null)} className="tap w-full text-left px-3 py-2 text-sm" style={{ color: C.accent, background: C.panel, fontWeight: 600 }}>
            "{q.trim()}" toevoegen als eigen oefening
          </button>
        </div>
      )}
    </div>
  );
}

function StrengthForm({ s, set }) {
  const ex = s.exercises || [];
  const upd = (i, patch) => set({ exercises: ex.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const setRow = (i, j, patch) => upd(i, { sets: ex[i].sets.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-4">
      <Field label="Naam (optioneel)">
        <TextInput value={s.title} onChange={(v) => set({ title: v })} placeholder="bijv. Onderlichaam zwaar" ariaLabel="Naam van de training" />
      </Field>
      {ex.map((e, i) => (
        <div key={i} className="p-3" style={{ border: `1px solid ${C.line}`, borderRadius: R.field }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
              {e.name}
            </span>
            <button onClick={() => set({ exercises: ex.filter((_, k) => k !== i) })} className="tap p-1" style={{ color: C.muted }} aria-label={`${e.name} verwijderen`}>
              <HIcon name="trash" size={18} />
            </button>
          </div>
          <div className="grid gap-1.5 text-xs mb-1" style={{ gridTemplateColumns: "28px 1fr 1fr 1fr 28px", color: C.muted }}>
            <span>Set</span>
            <span>kg</span>
            <span>Herh.</span>
            <span title="Herhalingen in reserve">RIR</span>
            <span />
          </div>
          {e.sets.map((x, j) => (
            <div key={j} className="grid gap-1.5 items-center mb-1.5" style={{ gridTemplateColumns: "28px 1fr 1fr 1fr 28px" }}>
              <span className="text-sm tnum" style={{ color: C.muted }}>
                {j + 1}
              </span>
              <NumInput value={x.kg} onChange={(v) => setRow(i, j, { kg: v })} ariaLabel={`Set ${j + 1} kilogram`} />
              <NumInput value={x.reps} onChange={(v) => setRow(i, j, { reps: v })} step="1" ariaLabel={`Set ${j + 1} herhalingen`} />
              <NumInput value={x.rir} onChange={(v) => setRow(i, j, { rir: v })} step="1" ariaLabel={`Set ${j + 1} herhalingen in reserve`} />
              <button onClick={() => upd(i, { sets: e.sets.filter((_, k) => k !== j) })} className="tap" style={{ color: C.muted }} aria-label={`Set ${j + 1} verwijderen`}>
                ×
              </button>
            </div>
          ))}
          <button onClick={() => upd(i, { sets: [...e.sets, { ...(e.sets[e.sets.length - 1] || { kg: null, reps: null, rir: null }) }] })} className="tap text-sm mt-1" style={{ color: C.accent, fontWeight: 600 }}>
            + Set
          </button>
        </div>
      ))}
      <ExercisePicker onAdd={(e) => set({ exercises: [...ex, { ...e, sets: [{ kg: null, reps: null, rir: null }] }] })} />
      <Field label="Tijd (optioneel)" hint="Leeg laten: de app schat de duur uit het aantal sets.">
        <DurationInput value={s.durationSec} onChange={(v) => set({ durationSec: v })} ariaLabel="Tijd" />
      </Field>
    </div>
  );
}

const wodOpts = Object.entries(WOD_FORMATS).map(([value, w]) => ({ value, label: w.label }));
function WodForm({ s, set }) {
  const f = WOD_FORMATS[s.format] || WOD_FORMATS.amrap;
  return (
    <div className="space-y-4">
      <Field label="Vorm" hint={f.hint}>
        <Choice options={wodOpts} value={s.format} onChange={(v) => set({ format: v })} ariaLabel="WOD-vorm" />
      </Field>
      <Field label="Oefeningen" hint="Eén per regel, bijv. 10 thrusters 40 kg">
        <TextInput multiline rows={4} value={s.movements} onChange={(v) => set({ movements: v })} ariaLabel="Oefeningen" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={s.format === "fortime" || s.format === "chipper" ? "Tijdslimiet" : "Duur"}>
          <DurationInput value={s.capSec} onChange={(v) => set({ capSec: v })} ariaLabel="Tijdslimiet of duur" />
        </Field>
        <Field label="Score" hint={s.format === "amrap" ? "rondes + herhalingen, bijv. 7+12" : s.format === "fortime" || s.format === "chipper" ? "eindtijd, bijv. 12:34" : "bijv. alle rondes"}>
          <TextInput value={s.score} onChange={(v) => set({ score: v })} ariaLabel="Score" />
        </Field>
      </div>
      <Field label="Totale tijd van de sessie (optioneel)" hint="Inclusief warming-up; anders telt de duur hierboven.">
        <DurationInput value={s.durationSec} onChange={(v) => set({ durationSec: v })} ariaLabel="Totale tijd" />
      </Field>
    </div>
  );
}

const hyroxModeOpts = Object.entries(HYROX_MODES).map(([value, m]) => ({ value, label: m.label }));
function HyroxForm({ s, set }) {
  const [splitsOpen, setSplitsOpen] = useState(() => [...(s.splits?.runs || []), ...(s.splits?.stations || [])].some((x) => x));
  const sp = s.splits || { runs: Array(8).fill(null), stations: Array(8).fill(null) };
  const setSplit = (k, i, v) => set({ splits: { ...sp, [k]: sp[k].map((x, j) => (j === i ? v : x)) } });
  const total = hyroxTotal({ ...s, durationSec: null });
  return (
    <div className="space-y-4">
      <Field label="Soort">
        <Choice options={hyroxModeOpts} value={s.mode} onChange={(v) => set({ mode: v })} ariaLabel="Soort Hyrox-sessie" />
      </Field>
      <Field label="Totale tijd" hint={total && !s.durationSec ? `uit de splits: ${fmtDuration(total)}` : null}>
        <DurationInput value={s.durationSec} onChange={(v) => set({ durationSec: v })} ariaLabel="Totale tijd" />
      </Field>
      <Field label="Gem. hartslag (optioneel)">
        <NumInput value={s.avgHr} onChange={(v) => set({ avgHr: v })} unit="bpm" ariaLabel="Gemiddelde hartslag" />
      </Field>
      <button onClick={() => setSplitsOpen(!splitsOpen)} className="tap text-sm" style={{ color: C.accent, fontWeight: 600 }} aria-expanded={splitsOpen}>
        {splitsOpen ? "Splits verbergen" : "Splits per ronde invullen"}
      </button>
      {splitsOpen && (
        <div className="space-y-1.5">
          {HYROX_STATIONS.map((st, i) => (
            <div key={st.id} className="grid gap-2 items-center" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Field label={`Run ${i + 1} · 1 km`}>
                <DurationInput value={sp.runs[i]} onChange={(v) => setSplit("runs", i, v)} placeholder="m:ss" ariaLabel={`Run ${i + 1}`} />
              </Field>
              <Field label={`${st.label} · ${st.amount}`}>
                <DurationInput value={sp.stations[i]} onChange={(v) => setSplit("stations", i, v)} placeholder="m:ss" ariaLabel={st.label} />
              </Field>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MobilityForm({ s, set }) {
  return (
    <div className="space-y-4">
      <Field label="Tijd">
        <DurationInput value={s.durationSec} onChange={(v) => set({ durationSec: v })} ariaLabel="Tijd" />
      </Field>
      <Field label="Wat heeft u gedaan? (optioneel)">
        <TextInput value={s.title} onChange={(v) => set({ title: v })} placeholder="bijv. heupen en enkels, yoga" ariaLabel="Omschrijving" />
      </Field>
    </div>
  );
}

/* ---------------- sheet ---------------- */
export function SessionSheet({ initial, profile, onSave, onDelete, onClose }) {
  const [s, setS] = useState(initial || null);
  const [route, setRoute] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const editing = !!(initial && initial.createdAt && onDelete);
  const load = s ? sessionLoad(s, profile, EX_INDEX) : null;

  if (!s) {
    return (
      <Sheet title="Training vastleggen" onClose={onClose}>
        <KindPicker
          onPick={(p) => setS(newSession(p.kind, p.sport ? { sport: p.sport } : {}))}
          onImported={(r) => {
            setS(newSession("duur", { ...r.draft, source: r.format, date: r.draft.date || newSession("duur").date }));
            setRoute(r.route);
          }}
        />
      </Sheet>
    );
  }

  const canSave = s.kind === "kracht" ? (s.exercises || []).length > 0 || s.durationSec : s.kind === "hyrox" ? !!hyroxTotal(s) : s.kind === "wod" ? !!(s.durationSec || s.capSec) : !!s.durationSec;
  return (
    <Sheet title={editing ? sessionTitle(s) : `${s.kind === "duur" ? (SPORTS[s.sport] || SPORTS.hardlopen).label : (KINDS[s.kind] || {}).label || "Training"} vastleggen`} onClose={onClose}>
      <div className="space-y-5 pb-2">
        {s.source && s.source !== "handmatig" && (
          <p className="text-xs leading-relaxed px-3 py-2" style={{ background: "var(--accent-soft)", color: C.ink, borderRadius: R.field }}>
            Geïmporteerd uit een {s.source.toUpperCase()}-bestand
            {s.name ? ` ("${s.name}")` : ""}
            {s.distanceM ? `: ${fmtKm(s.distanceM)}` : ""}
            {s.durationSec ? ` in ${fmtDuration(s.durationSec)}` : ""}. Controleer de sport en vul de inspanning in.
          </p>
        )}
        <Field label="Datum">
          <input
            type="date"
            value={s.date}
            onChange={(e) => e.target.value && set({ date: e.target.value })}
            className="w-full px-3 py-2.5 text-sm tnum"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink }}
            aria-label="Datum"
          />
        </Field>
        {s.kind === "duur" && <EnduranceForm s={s} set={set} />}
        {s.kind === "kracht" && <StrengthForm s={s} set={set} />}
        {s.kind === "wod" && <WodForm s={s} set={set} />}
        {s.kind === "hyrox" && <HyroxForm s={s} set={set} />}
        {s.kind === "mobiliteit" && <MobilityForm s={s} set={set} />}
        <RpeInput value={s.rpe} onChange={(v) => set({ rpe: v })} estimate={load && load.rpeEst && load.minutes ? Math.round(load.rpe * 10) / 10 : null} />
        <Field label="Notitie (optioneel)">
          <TextInput multiline rows={2} value={s.notes} onChange={(v) => set({ notes: v })} ariaLabel="Notitie" />
        </Field>
        {load && load.minutes > 0 && (
          <div className="flex items-baseline justify-between px-3 py-2.5" style={{ background: C.surface2, borderRadius: R.field }}>
            <span className="text-xs" style={{ color: C.muted }}>
              Belasting{load.rpeEst ? " (geschat)" : ""}
            </span>
            <span className="text-sm tnum" style={{ color: C.ink, fontWeight: 600 }}>
              {load.srpe} · {String(Math.round(load.rpe * 10) / 10).replace(".", ",")} × {Math.round(load.minutes)} min
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <TBtn full disabled={!canSave} onClick={() => onSave(s, route)}>
            {editing ? "Opslaan" : "Vastleggen"}
          </TBtn>
        </div>
        {editing &&
          (confirmDel ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm" style={{ color: C.ink }}>
                Deze training verwijderen?
              </span>
              <span className="flex gap-2">
                <TBtn small kind="ghost" onClick={() => setConfirmDel(false)}>
                  Nee
                </TBtn>
                <TBtn small kind="danger" onClick={() => onDelete(s.id)}>
                  Verwijderen
                </TBtn>
              </span>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} className="tap text-sm" style={{ color: C.train }}>
              Training verwijderen
            </button>
          ))}
      </div>
    </Sheet>
  );
}
