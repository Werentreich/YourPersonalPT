/* Training bezig: een geplande kracht- of hybride sessie set voor set
   afwerken, in de stijl van de Nexa-krachttraining. Afvinken start de rust;
   aan het eind van de rust een piep, trilling en de volgende oefening. */
import React, { useEffect, useRef, useState } from "react";
import { C, R, TBtn, EXERCISES } from "../App.jsx";
import { num } from "../hybrid/engine/model.js";
import { blockHeader, ROLES } from "../hybrid/engine/blocks.js";
import { unlockCues, beep, buzz, speak } from "../hybrid/ui/cues.js";
import { RpeInput } from "../hybrid/ui/kit.jsx";
import { MOVEMENTS, movementById, searchMovements } from "../hybrid/engine/movements.js";
import { MUSCLES_OF } from "../hybrid/engine/planner.js";
import {
  toggleSet,
  setField,
  addSet,
  removeSet,
  progress,
  anyDone,
  liftToSession,
  isTimed,
  lastFor,
  lastText,
  storeLift,
  savedLift,
  order,
  addExercise,
  swapExercise,
  removeExercise,
  muscleKey,
} from "./lift.js";

const mmss = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(ms, on = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}

const inputStyle = () => ({ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink });

/* Rusttimer onderin, boven de navigatie (zoals de Nexa-dock). */
function RestDock({ rest, onAdjust, onStop, title, onOpen }) {
  const now = useNow(250, !!rest);
  const left = rest ? (rest.endsAt - now) / 1000 : 0;
  const sec = Math.ceil(left);
  const pipped = useRef(null);
  const fired = useRef(null);
  useEffect(() => {
    if (!rest || rest.total <= 5) return;
    const key = `${rest.endsAt}:${sec}`;
    if (sec >= 1 && sec <= 3 && pipped.current !== key) {
      pipped.current = key;
      beep(660, 90);
    }
  }, [sec, rest && rest.endsAt]);
  useEffect(() => {
    if (!rest || left > 0 || fired.current === rest.endsAt) return;
    fired.current = rest.endsAt;
    // een rust die al lang voorbij was (bijv. na terugkomen in de app) niet alsnog melden
    if (left > -10) {
      beep(990, 260);
      buzz([200, 100, 200]);
      speak(rest.kind === "wissel" ? `Wissel. ${rest.next || ""}` : `Rust voorbij. ${rest.next || ""}`);
    }
  }, [left <= 0, rest && rest.endsAt]);
  if (!rest && !onOpen) return null;
  const over = rest && left <= 0;
  const pct = rest ? Math.max(0, Math.min(100, (left / Math.max(1, rest.total)) * 100)) : 0;
  return (
    <div className="no-print fixed left-0 right-0 px-3" style={{ bottom: "calc(62px + env(safe-area-inset-bottom, 0px))", zIndex: 45 }}>
      <div
        className="macroapp mx-auto max-w-2xl hero-in overflow-hidden px-3 py-2"
        style={{ background: C.dark, color: C.darkInk, borderRadius: 14, boxShadow: "0 12px 30px -12px rgba(0,0,0,.6)", border: `1px solid ${C.darkLine}` }}
        role="status"
        aria-live="polite"
      >
        {onOpen && (
          <button onClick={onOpen} className="tap w-full text-left py-1 flex items-center gap-2" style={{ borderBottom: rest ? `1px solid ${C.darkLine}` : "none", marginBottom: rest ? 6 : 0 }}>
            <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: "var(--carb-fill)" }} />
            <span className="text-xs flex-1 truncate">
              <strong>Training bezig</strong> · {title}
            </span>
            <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
              Verder
            </span>
          </button>
        )}
        {rest && (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs truncate" style={{ color: over ? "var(--carb-fill)" : C.darkMuted }}>
                {over ? (rest.kind === "wissel" ? "Wisselen" : "Rust voorbij") : rest.kind === "wissel" ? "Wissel" : "Rust"}
                {rest.next ? ` · ${rest.next}` : ""}
              </div>
              <div className="disp text-3xl font-bold tnum leading-none" style={{ color: over ? "var(--carb-fill)" : C.darkInk }}>
                {over ? "Go" : mmss(left)}
              </div>
            </div>
            {!over && (
              <>
                <button
                  onClick={() => onAdjust(-15)}
                  className="tap px-2.5 py-2 text-xs font-semibold"
                  style={{ border: `1px solid ${C.darkLine}`, borderRadius: R.field }}
                  aria-label="15 seconden korter"
                >
                  −15
                </button>
                <button
                  onClick={() => onAdjust(15)}
                  className="tap px-2.5 py-2 text-xs font-semibold"
                  style={{ border: `1px solid ${C.darkLine}`, borderRadius: R.field }}
                  aria-label="15 seconden langer"
                >
                  +15
                </button>
              </>
            )}
            <button onClick={onStop} className="tap px-3 py-2 text-xs font-semibold" style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: R.field }}>
              {over ? "Sluiten" : "Overslaan"}
            </button>
          </div>
        )}
        {rest && (
          <div className="mt-2" style={{ height: 4, background: "rgba(255,255,255,.12)", borderRadius: 2 }}>
            <div style={{ height: 4, width: `${pct}%`, background: over ? "var(--carb-fill)" : "var(--accent)", borderRadius: 2, transition: "width .25s linear" }} />
          </div>
        )}
      </div>
    </div>
  );
}

const muscleOf = (it) => muscleKey((MUSCLES_OF[it.moveId] || [])[0] || (movementById(it.moveId) || {}).muscle);

/* Oefening kiezen: eerst alternatieven voor dezelfde spiergroep, of zoeken. */
function ExercisePicker({ title, muscle, exclude, onPick, onClose }) {
  const [q, setQ] = useState("");
  const ex = new Set(exclude || []);
  const own = muscle ? MOVEMENTS.filter((m) => muscleKey((MUSCLES_OF[m.id] || [])[0]) === muscle) : [];
  const names = new Set(own.map((m) => m.name.toLowerCase()));
  const nexa = muscle
    ? (EXERCISES || [])
        .filter((e) => muscleKey((e.pri || [])[0]) === muscle && !names.has(e.name.toLowerCase()))
        .map((e) => movementById("nexa:" + e.id))
        .filter(Boolean)
    : [];
  const sugg = [...own, ...nexa].filter((m) => !ex.has(m.id)).slice(0, 10);
  const hits = q.trim() ? searchMovements(q, 10).filter((m) => !ex.has(m.id)) : [];
  const list = q.trim() ? hits : sugg;
  return (
    <div className="mb-4 px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.accent}`, borderRadius: R.card, boxShadow: C.shadow }}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-sm font-semibold">{title}</div>
        <button onClick={onClose} className="tap text-xs" style={{ color: C.muted }}>
          Annuleren
        </button>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Oefening zoeken, bijv. squat of roeien"
        className="w-full px-3 py-2.5 text-sm"
        style={inputStyle()}
        aria-label="Oefening zoeken"
        autoFocus={!muscle}
      />
      {!q.trim() && muscle && sugg.length > 0 && (
        <div className="text-[11px] uppercase tracking-wide mt-3 mb-1" style={{ color: C.muted, fontWeight: 600 }}>
          Zelfde spiergroep
        </div>
      )}
      <div className="mt-1.5 overflow-hidden" style={{ border: list.length ? `1px solid ${C.line}` : "none", borderRadius: R.field }}>
        {list.map((m) => (
          <button
            key={m.id}
            onClick={() => onPick(m)}
            className="tap w-full text-left px-3 py-2.5 text-sm"
            style={{ color: C.ink, borderBottom: `1px solid ${C.lineSoft || C.line}`, background: C.panel }}
          >
            {m.name}
          </button>
        ))}
      </div>
      {q.trim() && (
        <button onClick={() => onPick({ id: null, name: q.trim(), metrics: ["reps", "kg"] })} className="tap mt-2 text-sm" style={{ color: C.accent, fontWeight: 600 }}>
          "{q.trim()}" toevoegen als eigen oefening
        </button>
      )}
    </div>
  );
}

function Check({ done, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="tap flex items-center justify-center"
      style={{
        height: 38,
        borderRadius: R.field,
        background: done ? "var(--carb-fill)" : C.surface2,
        color: done ? "#04140E" : C.muted,
        border: `1px solid ${done ? "var(--carb-fill)" : C.line}`,
        fontWeight: 700,
      }}
      aria-label={label}
      aria-pressed={done}
    >
      ✓
    </button>
  );
}

export function LiveLift({ live, setLive, sessions, onSave, onEdit, onDiscard }) {
  const now = useNow(1000);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [rpe, setRpe] = useState(null);
  const [pick, setPick] = useState(null);
  const [open, setOpen] = useState(() => {
    const p = order(live).find((x) => x.ii != null && !live.blocks[x.bi].items[x.ii].sets[x.j].done);
    return p ? `${p.bi}:${p.ii}` : null;
  });
  useEffect(() => storeLift(live), [live]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  const tick = (bi, ii, j) => {
    unlockCues();
    const r = toggleSet(live, bi, ii, j);
    if (r.error) return setToast(r.error);
    setLive(r.live);
    if (r.next && r.next.ii != null) setOpen(`${r.next.bi}:${r.next.ii}`);
    if (r.finished) setToast("Alles gedaan. Rond de training af om hem op te slaan.");
  };
  const adjust = (d) => setLive((x) => (x.rest ? { ...x, rest: { ...x.rest, endsAt: Math.max(Date.now() + 1000, x.rest.endsAt + d * 1000), total: Math.max(5, x.rest.total + d) } } : x));
  const stopRest = () => setLive((x) => ({ ...x, rest: null }));
  const finish = () => {
    if (!anyDone(live)) return setConfirm("leeg");
    setLive((x) => ({ ...x, rest: null }));
    setConfirm("klaar");
  };

  const { total, done } = progress(live);
  const elapsed = Math.max(0, Math.floor((now - live.start) / 1000));
  const cols = { gridTemplateColumns: "30px minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) 42px" };

  return (
    <div style={{ paddingBottom: live.rest ? 96 : 0 }}>
      {toast && (
        <div className="fixed left-0 right-0 flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", zIndex: 70 }} role="status">
          <div className="hero-in px-4 py-2.5 text-sm font-semibold" style={{ background: C.dark, color: C.darkInk, borderRadius: 12, boxShadow: C.shadow, maxWidth: 420 }}>
            {toast}
          </div>
        </div>
      )}

      <div className="hero-in relative overflow-hidden mb-4 px-4 pt-4 pb-4" style={{ background: C.dark, color: C.darkInk, borderRadius: 18, boxShadow: C.shadow }}>
        <div className="text-xs font-semibold" style={{ color: C.darkMuted }}>
          Training bezig
        </div>
        <div className="flex items-end justify-between gap-3 mt-1">
          <h2 className="disp text-3xl font-bold uppercase leading-none">{live.title}</h2>
          <div className="text-right shrink-0">
            <div className="disp text-2xl font-bold leading-none tnum">{mmss(elapsed)}</div>
            <div className="text-xs tnum" style={{ color: C.darkMuted }}>
              {done}/{total} sets
            </div>
          </div>
        </div>
        <div className="mt-3" style={{ height: 5, background: "rgba(255,255,255,.12)", borderRadius: 3 }}>
          <div className="bar-fill" style={{ height: 5, width: `${total ? (done / total) * 100 : 0}%`, background: "var(--accent)", borderRadius: 3 }} />
        </div>
      </div>

      {live.blocks.map((b, bi) => {
        if (b.type !== "sets")
          return (
            <div key={b.id || bi} className="mb-3 px-4 py-3 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card, boxShadow: C.shadow }}>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide" style={{ color: C.muted, fontWeight: 600 }}>
                  {b.role && ROLES[b.role] ? ROLES[b.role].label : "Blok"}
                </div>
                <div className="text-sm font-semibold">{blockHeader(b)}</div>
                {b.intensity && (
                  <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                    {b.intensity}
                  </div>
                )}
              </div>
              <div style={{ width: 42 }} className="shrink-0">
                <Check done={b.done} onClick={() => tick(bi, null, null)} label={b.done ? "Blok ongedaan maken" : "Blok afronden"} />
              </div>
            </div>
          );
        const ss = b.superset && b.items.length > 1;
        return (
          <div key={b.id || bi} className="mb-4">
            {(b.name || ss) && (
              <div className="flex items-baseline justify-between gap-2 px-1 mb-1.5 text-xs">
                <span className="font-semibold" style={{ color: ss ? C.accent : C.ink }}>
                  {b.name || "Kracht"}
                </span>
                {ss && <span style={{ color: C.muted }}>om de beurt, één set van elk</span>}
              </div>
            )}
            {b.text && (
              <p className="px-1 mb-2 text-xs leading-relaxed" style={{ color: C.muted }}>
                {b.text}
              </p>
            )}
            {b.items.map((it, ii) => {
              const key = `${bi}:${ii}`;
              const isOpen = open === key;
              const timed = isTimed(it);
              const work = it.sets.filter((s) => s.kind !== "warmup");
              const nDone = work.filter((s) => s.done).length;
              const complete = it.sets.length > 0 && it.sets.every((s) => s.done);
              const t = (it.sets[0] && it.sets[0].target) || {};
              const last = isOpen ? lastText(lastFor(sessions, it.moveId, it.name), timed) : null;
              const label = ss ? `${((b.name || "").match(/Superset ([A-Z])/) || [])[1] || "S"}${ii + 1}` : null;
              return (
                <div
                  key={key}
                  className={`${ss && ii < b.items.length - 1 ? "mb-1.5" : "mb-3"} overflow-hidden`}
                  style={{ background: C.panel, border: `1px solid ${isOpen ? C.accent : C.line}`, borderLeft: ss ? `4px solid ${C.accent}` : undefined, borderRadius: R.card, boxShadow: C.shadow }}
                >
                  <button onClick={() => setOpen(isOpen ? null : key)} className="tap w-full text-left px-4 py-3 flex items-center gap-3" aria-expanded={isOpen}>
                    <span
                      className="shrink-0 flex items-center justify-center disp font-bold text-sm"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        background: complete ? "var(--carb-fill)" : C.surface2,
                        color: complete ? "#04140E" : C.muted,
                        border: `1px solid ${complete ? "var(--carb-fill)" : C.line}`,
                      }}
                    >
                      {complete ? "✓" : label || ii + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold block truncate">{it.name}</span>
                      <span className="text-xs block" style={{ color: C.muted }}>
                        {work.length} × {timed ? `${t.sec || "?"} s` : it.repRange || t.reps || "?"}
                        {it.perSide ? " per kant" : ""}
                        {t.rir != null ? ` · RIR ${t.rir}` : ""}
                        {` · rust ${mmss(num(it.restSec, 90))}`}
                      </span>
                    </span>
                    <span className="text-xs tnum shrink-0" style={{ color: complete ? C.carb : C.muted }}>
                      {nDone}/{work.length}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-3" style={{ borderTop: `1px solid ${C.lineSoft || C.line}` }}>
                      <div className="pt-2 text-xs leading-relaxed" style={{ color: C.muted }}>
                        <span style={{ color: C.ink, fontWeight: 600 }}>
                          Doel: {it.sets[0] && it.sets[0].kg != null ? `${String(it.sets[0].kg).replace(".", ",")} kg · ` : ""}
                          {timed ? `${t.sec || "?"} s` : `${it.repRange || t.reps || "?"} herhalingen`}
                          {t.rir != null ? ` · ${t.rir} in reserve` : ""}
                        </span>
                        {last && <span className="block mt-0.5">Vorige keer: {last}</span>}
                        {it.tempo && <span className="block mt-0.5">Tempo {it.tempo}</span>}
                      </div>
                      <div className="grid gap-1.5 mt-3 text-xs" style={{ ...cols, color: C.muted }}>
                        <span>Set</span>
                        <span className="text-center">kg</span>
                        <span className="text-center">{timed ? "Sec" : "Herh."}</span>
                        <span className="text-center" title="Herhalingen in reserve">
                          RIR
                        </span>
                        <span />
                      </div>
                      {it.sets.map((s, j) => {
                        const warm = s.kind === "warmup";
                        const n = warm ? "W" : it.sets.slice(0, j + 1).filter((x) => x.kind !== "warmup").length;
                        const tg = s.target || {};
                        return (
                          <div key={j} className="grid items-center gap-1.5 py-1" style={{ ...cols, background: s.done ? "rgba(0,195,137,.08)" : "transparent", borderRadius: 8 }}>
                            <span className="disp text-sm font-bold text-center" style={{ color: warm ? C.muted : C.ink }}>
                              {n}
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              min="0"
                              value={s.kg ?? ""}
                              placeholder="kg"
                              onChange={(ev) => setLive((x) => setField(x, bi, ii, j, "kg", ev.target.value === "" ? null : Number(ev.target.value)))}
                              className="w-full px-1 py-2 text-sm text-center tnum"
                              style={inputStyle()}
                              aria-label={`${it.name} set ${n} kilogram`}
                            />
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              value={(timed ? s.sec : s.reps) ?? ""}
                              placeholder={timed ? String(tg.sec || "") : tg.repsMax ? `${tg.reps}-${tg.repsMax}` : String(tg.reps || "")}
                              onChange={(ev) => setLive((x) => setField(x, bi, ii, j, timed ? "sec" : "reps", ev.target.value === "" ? null : Number(ev.target.value)))}
                              className="w-full px-1 py-2 text-sm text-center tnum"
                              style={inputStyle()}
                              aria-label={`${it.name} set ${n} ${timed ? "seconden" : "herhalingen"}`}
                            />
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="10"
                              value={s.rir ?? ""}
                              placeholder={tg.rir != null ? String(tg.rir) : "–"}
                              onChange={(ev) => setLive((x) => setField(x, bi, ii, j, "rir", ev.target.value === "" ? null : Number(ev.target.value)))}
                              className="w-full px-1 py-2 text-sm text-center tnum"
                              style={inputStyle()}
                              aria-label={`${it.name} set ${n} herhalingen in reserve`}
                            />
                            <Check done={s.done} onClick={() => tick(bi, ii, j)} label={s.done ? `Set ${n} ongedaan maken` : `Set ${n} afronden`} />
                          </div>
                        );
                      })}
                      <div className="flex gap-4 mt-2 text-sm">
                        <button onClick={() => setLive((x) => addSet(x, bi, ii))} className="tap" style={{ color: C.accent, fontWeight: 600 }}>
                          + Set
                        </button>
                        {it.sets.length > 1 && it.sets.some((s) => !s.done) && (
                          <button onClick={() => setLive((x) => removeSet(x, bi, ii))} className="tap" style={{ color: C.muted }}>
                            − Set
                          </button>
                        )}
                        <span className="flex-1" />
                        {!it.sets.some((s) => s.done) && (
                          <>
                            <button onClick={() => setPick({ mode: "swap", bi, ii, muscle: muscleOf(it), name: it.name })} className="tap" style={{ color: C.accent, fontWeight: 600 }}>
                              Wisselen
                            </button>
                            <button onClick={() => setLive((x) => removeExercise(x, bi, ii))} className="tap" style={{ color: C.muted }}>
                              Weg
                            </button>
                          </>
                        )}
                      </div>
                      {it.swappedFrom && (
                        <p className="text-[11px] mt-1" style={{ color: C.muted }}>
                          In plaats van {it.swappedFrom}
                        </p>
                      )}
                      {pick && pick.mode === "swap" && pick.bi === bi && pick.ii === ii && (
                        <div className="mt-3">
                          <ExercisePicker
                            title={`${pick.name} vervangen`}
                            muscle={pick.muscle}
                            exclude={[it.moveId]}
                            onClose={() => setPick(null)}
                            onPick={(mv) => {
                              setLive((x) => swapExercise(x, bi, ii, mv, sessions));
                              setPick(null);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {pick && pick.mode === "add" ? (
        <ExercisePicker
          title="Oefening toevoegen"
          muscle={null}
          exclude={[]}
          onClose={() => setPick(null)}
          onPick={(mv) => {
            setLive((x) => addExercise(x, mv, sessions));
            setOpen(`${live.blocks.length}:0`);
            setPick(null);
          }}
        />
      ) : (
        confirm !== "klaar" && (
          <button
            onClick={() => setPick({ mode: "add" })}
            className="tap w-full mb-4 py-3 text-sm"
            style={{ border: `1px dashed ${C.line}`, borderRadius: R.card, color: C.accent, fontWeight: 600, background: "transparent" }}
          >
            + Oefening toevoegen
          </button>
        )
      )}

      {!live.blocks.length && !pick && (
        <p className="text-sm mb-4 px-1" style={{ color: C.muted }}>
          Voeg uw eerste oefening toe. Per set vult u kg en herhalingen in en vinkt u hem af; de rust loopt dan vanzelf.
        </p>
      )}

      {confirm === "leeg" ? (
        <div className="mb-4 px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card }}>
          <p className="text-sm mb-2">Nog niets afgevinkt. Training stoppen zonder op te slaan?</p>
          <div className="flex gap-2">
            <TBtn small onClick={onDiscard}>
              Stoppen
            </TBtn>
            <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
              Doorgaan
            </TBtn>
          </div>
        </div>
      ) : confirm === "weg" ? (
        <div className="mb-4 px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card }}>
          <p className="text-sm mb-2">De afgevinkte sets gaan verloren. Weet u het zeker?</p>
          <div className="flex gap-2">
            <TBtn small onClick={onDiscard}>
              Weggooien
            </TBtn>
            <TBtn small kind="ghost" onClick={() => setConfirm(null)}>
              Doorgaan
            </TBtn>
          </div>
        </div>
      ) : confirm === "klaar" ? (
        <div className="mb-4 px-4 py-4 space-y-3" style={{ background: C.panel, border: `1px solid ${C.accent}`, borderRadius: R.card, boxShadow: C.shadow }}>
          <div className="disp text-lg font-bold uppercase leading-none">Training klaar</div>
          <p className="text-xs" style={{ color: C.muted }}>
            {done} {done === 1 ? "set" : "sets"} in {mmss(elapsed)}. Alleen afgevinkte sets worden opgeslagen.
          </p>
          <RpeInput value={rpe} onChange={setRpe} />
          <div className="flex gap-2">
            <TBtn onClick={() => onSave({ ...liftToSession(live), rpe })}>Opslaan</TBtn>
            <TBtn kind="ghost" onClick={() => onEdit({ ...liftToSession(live), rpe })}>
              Eerst bewerken
            </TBtn>
          </div>
          <button onClick={() => setConfirm(null)} className="tap text-xs" style={{ color: C.muted }}>
            Toch nog niet klaar
          </button>
        </div>
      ) : null}

      {confirm !== "klaar" && (
        <div className="space-y-2 mb-6">
          <TBtn full onClick={finish}>
            Training afronden
          </TBtn>
          <button onClick={() => (anyDone(live) ? setConfirm("weg") : onDiscard())} className="tap block w-full text-center text-xs py-1" style={{ color: C.muted }}>
            Stoppen zonder opslaan
          </button>
        </div>
      )}

      <RestDock rest={live.rest} onAdjust={adjust} onStop={stopRest} />
    </div>
  );
}

/* Op andere tabbladen: de lopende training en de rust blijven zichtbaar,
   met piep en trilling aan het eind (zoals de Nexa-dock). */
export function LiftDock({ onOpen }) {
  const [live, setLive] = useState(() => savedLift());
  useEffect(() => {
    const id = setInterval(() => setLive(savedLift()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!live) return null;
  const write = (f) => {
    const next = f(live);
    storeLift(next);
    setLive(next);
  };
  return (
    <RestDock
      rest={live.rest}
      title={live.title}
      onOpen={onOpen}
      onAdjust={(d) => write((x) => (x.rest ? { ...x, rest: { ...x.rest, endsAt: Math.max(Date.now() + 1000, x.rest.endsAt + d * 1000), total: Math.max(5, x.rest.total + d) } } : x))}
      onStop={() => write((x) => ({ ...x, rest: null }))}
    />
  );
}
