/* Live timer voor een blok: EMOM, Tabata/werk-rust, intervallen, Death by,
   AMRAP en For Time/rondes. Aftellen met piepjes en trillen; het resultaat
   (tijd, rondes, splits) gaat na afloop terug naar het blok.

   De tijd wordt elke tik opnieuw berekend uit Date.now(), zodat de timer
   klopt als de telefoon even op de achtergrond was. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, R, TBtn } from "../../App.jsx";
import { itemLine, tabataSlots, intervalUnit } from "../engine/blocks.js";
import { fmtDuration, num } from "../engine/model.js";

const PREP = 10;
const linesOf = (b) => (b.items || []).map((it) => itemLine(it, b));

/* Programma: een reeks fasen met vaste duur, of een open fase (stopwatch). */
export function timerProgram(b) {
  const items = linesOf(b);
  const n = items.length || 1;
  const ph = [];
  if (b.type === "emom") {
    const every = num(b.everySec, 60) || 60;
    const slots = Math.max(1, Math.floor(num(b.durationSec, 0) / every));
    for (let i = 0; i < slots; i++) ph.push({ kind: "work", sec: every, label: `Ronde ${i + 1} van ${slots}`, what: b.emomMode === "alles" ? items.join(" · ") : items[i % n] });
    return { phases: ph, mode: "fases" };
  }
  if (b.type === "tabata") {
    const slots = tabataSlots(b);
    const per = num(b.rounds, 8);
    for (let i = 0; i < slots; i++) {
      const what = b.tabataMode === "wissel" ? items[i % n] : items[Math.floor(i / per)] || items[n - 1];
      ph.push({ kind: "work", sec: num(b.workSec, 20), label: `Werk ${i + 1} van ${slots}`, what });
      if (i < slots - 1) ph.push({ kind: "rest", sec: num(b.restSec, 10), label: "Rust", what: `Hierna: ${b.tabataMode === "wissel" ? items[(i + 1) % n] : items[Math.floor((i + 1) / per)] || items[n - 1]}` });
    }
    return { phases: ph, mode: "fases" };
  }
  if (b.type === "deathby") {
    const step = num(b.step, 1) || 1;
    for (let i = 1; i <= 60; i++) ph.push({ kind: "work", sec: 60, label: `Minuut ${i}`, what: `${i * step} × ${(items[0] || "").toLowerCase()}`, minute: i });
    return { phases: ph, mode: "deathby" };
  }
  if (b.type === "interval") {
    const scheme = Array.isArray(b.repScheme) && b.repScheme.length ? b.repScheme : null;
    const rounds = scheme ? scheme.length : num(b.rounds, 1);
    const byTime = intervalUnit(b) === "time";
    for (let i = 0; i < rounds; i++) {
      const sec = byTime ? (scheme ? num(scheme[i], 60) : num((b.items[0] || {}).timeSec, 60)) : null;
      ph.push({ kind: "work", sec, open: !byTime, label: `Herhaling ${i + 1} van ${rounds}`, what: scheme && !byTime ? `${scheme[i]} m ${(items[0] || "").replace(/^\S+ m /, "")}` : items.join(" + "), rep: i });
      if (i < rounds - 1 && num(b.restSec)) ph.push({ kind: "rest", sec: num(b.restSec), label: "Rust", what: `Hierna herhaling ${i + 2}` });
    }
    return { phases: ph, mode: "interval", byTime };
  }
  if (b.type === "amrap") return { phases: [{ kind: "work", sec: num(b.capSec, 600), label: "AMRAP", what: items.join(" · ") }], mode: "amrap" };
  // For Time, rondes, doorlopend, test: stopwatch, eventueel met cap
  return { phases: [{ kind: "work", sec: null, open: true, cap: num(b.capSec) || null, label: b.type === "rondes" ? `${num(b.rounds, 1)} rondes` : "For Time", what: items.join(" · ") }], mode: "stopwatch" };
}

export const canTime = (b) => ["emom", "tabata", "deathby", "interval", "amrap", "fortime", "rondes", "doorlopend", "test"].includes(b.type) && (b.items || []).length > 0;

/* Piep via WebAudio (geen bestanden nodig). */
function useBeep() {
  const ctx = useRef(null);
  return (freq = 880, ms = 160) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx.current) ctx.current = new AC();
      const a = ctx.current;
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.value = freq;
      o.connect(g);
      g.connect(a.destination);
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
      o.start();
      o.stop(a.currentTime + ms / 1000 + 0.02);
    } catch (e) {
      /* geen geluid beschikbaar */
    }
    try {
      navigator.vibrate && navigator.vibrate(ms);
    } catch (e) {
      /* geen trilfunctie */
    }
  };
}

export function TimerSheet({ block, onClose, onResult }) {
  const prog = useMemo(() => timerProgram(block), [block]);
  const beep = useBeep();
  const [state, setState] = useState({ i: -1, startedAt: null, pausedAt: null, offset: 0, rounds: 0, splits: [], done: false });
  const [, tick] = useState(0);
  const lastSec = useRef(null);
  const wake = useRef(null);

  // scherm aan houden tijdens de timer
  useEffect(() => {
    (async () => {
      try {
        if (navigator.wakeLock) wake.current = await navigator.wakeLock.request("screen");
      } catch (e) {
        /* niet ondersteund */
      }
    })();
    return () => {
      try {
        wake.current && wake.current.release();
      } catch (e) {
        /* al vrijgegeven */
      }
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 200);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const running = state.startedAt != null && state.pausedAt == null && !state.done;
  const elapsed = state.startedAt == null ? 0 : ((state.pausedAt || now) - state.startedAt) / 1000 - state.offset;
  const phase = state.i >= 0 ? prog.phases[state.i] : { kind: "prep", sec: PREP, label: "Klaar voor de start", what: prog.phases[0] && prog.phases[0].what };
  const remaining = phase.sec != null ? Math.max(0, phase.sec - elapsed) : null;
  const shown = phase.open ? elapsed : remaining;

  const goNext = (extra = {}) => {
    setState((s) => {
      const ni = s.i + 1;
      if (ni >= prog.phases.length) return { ...s, ...extra, done: true, pausedAt: Date.now() };
      return { ...s, ...extra, i: ni, startedAt: Date.now(), pausedAt: null, offset: 0 };
    });
    beep(ni_is_rest(prog, state.i + 1) ? 520 : 990, 260);
  };

  // automatisch naar de volgende fase en piepjes in de laatste 3 seconden
  useEffect(() => {
    if (!running) return;
    if (phase.cap && elapsed >= phase.cap) {
      setState((s) => ({ ...s, done: true, capped: true, pausedAt: Date.now() }));
      beep(400, 600);
      return;
    }
    if (remaining == null) return;
    const sec = Math.ceil(remaining);
    if (sec !== lastSec.current && sec <= 3 && sec > 0) beep(660, 90);
    lastSec.current = sec;
    if (remaining <= 0) goNext();
  });

  const start = () => setState((s) => ({ ...s, startedAt: Date.now(), pausedAt: null, offset: 0, i: -1 }));
  const pause = () => setState((s) => ({ ...s, pausedAt: Date.now() }));
  const resume = () => setState((s) => ({ ...s, offset: s.offset + (Date.now() - s.pausedAt) / 1000, pausedAt: null }));

  /* Resultaat terug naar het blok. */
  const finish = (extra = {}) => {
    const r = { ...(block.result || {}) };
    const total = prog.phases.reduce((a, p) => a + (p.sec || 0), 0);
    if (prog.mode === "stopwatch") {
      if (state.capped || extra.capped) {
        r.capped = true;
        r.timeSec = null;
      } else r.timeSec = Math.round(elapsed);
      if (block.type === "test" && block.testMetric === "time") r.value = Math.round(elapsed);
      if (block.type === "doorlopend") r.timeSec = Math.round(elapsed);
    }
    if (prog.mode === "amrap") r.rounds = state.rounds;
    if (prog.mode === "fases" && block.type === "emom") r.completed = r.completed ?? Math.round(total / (num(block.everySec, 60) || 60));
    if (prog.mode === "deathby") r.rounds = Math.max(0, (extra.minute || phase.minute || 1) - 1);
    if (prog.mode === "interval" && !prog.byTime) r.splits = state.splits;
    onResult(r);
  };

  const big = shown == null ? "–" : fmtDuration(Math.ceil(phase.open ? Math.floor(shown) : shown));
  const bg = phase.kind === "rest" ? "var(--accent-soft)" : phase.kind === "prep" ? C.surface2 : C.panel;
  const progress = phase.sec ? 1 - (remaining || 0) / phase.sec : null;

  // via een portal naar <body>: een ouder met transform (de sheet-animatie)
  // zou position: fixed anders tot die ouder beperken
  return createPortal(
    <div className="fixed inset-0 flex flex-col hybrid perf macroapp" style={{ background: bg, color: C.ink, zIndex: 80, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }} role="dialog" aria-modal="true" aria-label="Timer">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="eyebrow">{phase.label}</span>
        <button onClick={onClose} className="tap text-sm" style={{ color: C.muted }}>
          Sluiten
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="disp tnum leading-none" style={{ fontSize: "min(32vw, 180px)", fontWeight: 600, color: phase.kind === "rest" ? C.accent : C.ink }} aria-live="off">
          {big}
        </div>
        {progress != null && (
          <div className="w-full max-w-sm mt-4" style={{ height: 6, background: C.line, borderRadius: 3 }}>
            <div style={{ width: `${Math.min(100, progress * 100)}%`, height: 6, background: phase.kind === "rest" ? "var(--tide-fill)" : "var(--ember-fill)", borderRadius: 3, transition: "width .2s linear" }} />
          </div>
        )}
        <p className="text-lg mt-5 leading-snug" style={{ color: C.ink, maxWidth: "28ch", fontWeight: 500 }}>
          {phase.what}
        </p>
        {phase.cap && <p className="text-sm mt-2" style={{ color: C.muted }}>Tijdslimiet {fmtDuration(phase.cap)}</p>}
        {(prog.mode === "amrap" || prog.mode === "stopwatch") && state.startedAt != null && (
          <button onClick={() => setState((s) => ({ ...s, rounds: s.rounds + 1 }))} className="tap mt-6 px-6 py-3 text-base" style={{ border: `1.5px solid ${C.line}`, borderRadius: R.field, background: C.panel, color: C.ink, fontWeight: 600 }}>
            Ronde klaar · {state.rounds}
          </button>
        )}
        {state.done && (
          <div className="mt-6 space-y-2">
            <p className="text-base" style={{ color: C.ink, fontWeight: 600 }}>
              {state.capped ? "Tijdslimiet bereikt" : "Klaar!"}
            </p>
            <TBtn onClick={() => finish()}>Resultaat invullen in het blok</TBtn>
          </div>
        )}
      </div>
      {!state.done && (
        <div className="px-4 pb-5 grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {state.startedAt == null ? (
            <div className="col-span-2">
              <TBtn full onClick={start}>
                Start
              </TBtn>
            </div>
          ) : (
            <>
              {running ? (
                <TBtn kind="ghost" full onClick={pause}>
                  Pauze
                </TBtn>
              ) : (
                <TBtn full onClick={resume}>
                  Doorgaan
                </TBtn>
              )}
              {prog.mode === "stopwatch" ? (
                <TBtn full onClick={() => setState((s) => ({ ...s, done: true, pausedAt: Date.now() }))}>
                  Klaar
                </TBtn>
              ) : prog.mode === "deathby" ? (
                <TBtn kind="danger" full onClick={() => { setState((s) => ({ ...s, done: true, pausedAt: Date.now() })); finish({ minute: phase.minute }); }}>
                  Niet gehaald
                </TBtn>
              ) : phase.open ? (
                <TBtn
                  full
                  onClick={() => {
                    const sp = [...state.splits];
                    sp[phase.rep] = Math.round(elapsed);
                    goNext({ splits: sp });
                  }}
                >
                  Herhaling klaar
                </TBtn>
              ) : (
                <TBtn kind="ghost" full onClick={() => goNext()}>
                  Volgende
                </TBtn>
              )}
            </>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

const ni_is_rest = (prog, i) => !!(prog.phases[i] && prog.phases[i].kind === "rest");
