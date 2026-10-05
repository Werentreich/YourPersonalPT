/* Live opname met GPS (hardlopen, wandelen, fietsen).
   Schermvullend, grote cijfers. De lopende opname staat tussendoor op het
   apparaat (nexa:hybrid-live), zodat herladen of een crash niets kost. */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, R, TBtn } from "../../App.jsx";
import { fmtDuration, fmtKm } from "../engine/model.js";
import { LIVE_SPORTS, newTrack, addFix, pauseTrack, resumeTrack, stopTrack, trackStats, trackToDraft, elapsedOf } from "../engine/gps.js";
import { advance, guideState, cueText, startCursor, programSeconds } from "../engine/guide.js";
import { unlockCues, cue, beep, speak, setMuted, isMuted } from "./cues.js";
import { watchLocation, keepAwake, geoAvailable, backgroundCapable } from "../native/geo.js";
import { Choice } from "./kit.jsx";

export const LIVE_KEY = "nexa:hybrid-live";
const save = (t) => {
  try {
    if (t) localStorage.setItem(LIVE_KEY, JSON.stringify(t));
    else localStorage.removeItem(LIVE_KEY);
  } catch (e) {
    /* geen opslag: opname loopt in het geheugen door */
  }
};
export const savedLive = () => {
  try {
    const t = JSON.parse(localStorage.getItem(LIVE_KEY) || "null");
    return t && t.v === 1 && t.status !== "klaar" ? t : null;
  } catch (e) {
    return null;
  }
};

const paceText = (sport, secPerKm, kmh) => {
  if (sport === "fietsen") return kmh ? `${kmh.toFixed(1).replace(".", ",")}` : "–";
  return secPerKm ? fmtDuration(secPerKm) : "–:–";
};

function Big({ label, value, unit, small }) {
  return (
    <div className="text-center">
      <div className={`disp tnum leading-none ${small ? "text-[40px]" : "text-[76px]"}`} style={{ color: C.ink, fontWeight: 600 }}>
        {value}
      </div>
      <div className="text-xs mt-1.5 uppercase tracking-wide" style={{ color: C.muted, fontWeight: 600 }}>
        {label}
        {unit ? ` · ${unit}` : ""}
      </div>
    </div>
  );
}

const SEG_COLOR = { work: "var(--ember-fill)", walk: "var(--tide-fill)", rest: "var(--tide-fill)", warmup: "var(--accent)", cooldown: "var(--accent)" };
const fmtLeft = (sec) => fmtDuration(Math.max(0, sec));

/* Korte omschrijving van het programma voor het startscherm. */
function programSummary(program) {
  const out = [];
  for (let i = 0; i < program.length; i++) {
    const s = program[i];
    if (s.kind === "work" && s.rounds > 1 && s.round === 1) {
      const rest = program[i + 1] && program[i + 1].round === 1 && program[i + 1].kind !== "work" ? program[i + 1] : null;
      out.push(`${s.rounds} × ${s.sec ? fmtDuration(s.sec) : fmtKm(s.meters)} ${s.label.toLowerCase()}${rest ? `, ${fmtDuration(rest.sec)} ${rest.label.toLowerCase()} ertussen` : ""}`);
      while (program[i + 1] && program[i + 1].rounds === s.rounds && program[i + 1].round) i++;
    } else out.push(`${s.sec ? fmtDuration(s.sec) : fmtKm(s.meters)} ${s.label.toLowerCase()}`);
  }
  return out;
}

export function LiveRecorder({ onClose, onFinish, guide: guideIn = null }) {
  const [track, setTrack] = useState(() => savedLive());
  const guide = (track && track.guide) || guideIn;
  const [sport, setSport] = useState((track && track.sport) || (guideIn && guideIn.sport) || "hardlopen");
  const [mute, setMute] = useState(isMuted());
  const [err, setErr] = useState(null);
  const [, tick] = useState(0);
  const [confirmStop, setConfirmStop] = useState(false);
  const ref = useRef(track);
  ref.current = track;
  const running = !!track && track.status !== "klaar";

  // locatie volgen zolang er een opname loopt
  useEffect(() => {
    if (!running) return;
    let stop = () => {};
    let release = () => {};
    let alive = true;
    (async () => {
      stop = await watchLocation(
        (fix) => {
          setErr(null);
          setTrack((t) => addFix(t, fix));
        },
        (m) => alive && setErr(m)
      );
      if (!backgroundCapable()) release = await keepAwake();
    })();
    return () => {
      alive = false;
      stop();
      release();
    };
  }, [running]);

  // begeleiding: elke halve seconde kijken of er een nieuw segment begint
  useEffect(() => {
    if (!running || !guide) return;
    const iv = setInterval(() => {
      const t = ref.current;
      if (!t || t.status !== "loopt") return;
      const el = elapsedOf(t);
      const c0 = t.cursor || startCursor();
      const c = advance(guide.program, c0, el, t.distance);
      const gs = guideState(guide.program, c, el, t.distance);
      if (c.index !== c0.index) {
        cue(cueText(guide.program[c.index], guide.program[c.index + 1]));
        setTrack((x) => ({ ...x, cursor: c }));
      } else if (gs && gs.left != null && gs.left <= 3 && gs.left >= 1 && t.lastBeep !== `${c.index}-${gs.left}`) {
        beep(gs.left === 1 ? 990 : 660, 120);
        if (gs.left === 3 && gs.next) speak(`Zo meteen ${gs.next.label.toLowerCase()}`);
        setTrack((x) => ({ ...x, lastBeep: `${c.index}-${gs.left}` }));
      }
    }, 500);
    return () => clearInterval(iv);
  }, [running, guide]);

  // klok en tussentijds bewaren
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    const sv = setInterval(() => save(ref.current), 10000);
    return () => {
      clearInterval(iv);
      clearInterval(sv);
    };
  }, [running]);
  useEffect(() => {
    if (track && (track.status === "pauze" || track.points.length === 1)) save(track);
  }, [track && track.status, track && track.points.length === 1]);

  const start = () => {
    unlockCues();
    const t = { ...newTrack(guide ? guide.sport : sport), ...(guide ? { guide, cursor: startCursor() } : {}) };
    save(t);
    setTrack(t);
    if (guide && guide.program.length) setTimeout(() => cue(`Daar gaan we. ${cueText(guide.program[0])}`), 200);
  };
  const finish = () => {
    const done = stopTrack(ref.current);
    save(null);
    setTrack(null);
    onFinish({ ...trackToDraft(done), guide: done.guide || null });
  };
  const discard = () => {
    save(null);
    setTrack(null);
    onClose();
  };

  const st = track ? trackStats(track) : null;
  const gs = track && guide ? guideState(guide.program, track.cursor || startCursor(), elapsedOf(track), track.distance) : null;
  const bike = (track ? track.sport : sport) === "fietsen";
  const lastSplit = st && st.splits.length ? st.splits[st.splits.length - 1] : null;

  const view = (
    <div className="fixed inset-0 flex flex-col hybrid perf macroapp" style={{ background: C.bg, color: C.ink, zIndex: 80, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }} role="dialog" aria-modal="true" aria-label="Live opname">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="eyebrow">{track ? `${LIVE_SPORTS[track.sport].label} · ${track.status === "pauze" ? "gepauzeerd" : "live"}` : "Live opnemen"}</span>
        {!track && (
          <button onClick={onClose} className="tap text-sm" style={{ color: C.muted }}>
            Sluiten
          </button>
        )}
      </div>

      {!track ? (
        <div className="flex-1 flex flex-col justify-center px-5 gap-5 max-w-md mx-auto w-full">
          {guide ? (
            <div>
              <div className="eyebrow">Begeleide training · ± {Math.round(programSeconds(guide.program) / 60)} min</div>
              <h2 className="disp text-[28px] leading-tight mt-1" style={{ color: C.ink, fontWeight: 600 }}>
                {guide.title}
              </h2>
              <ul className="mt-3 space-y-1.5">
                {programSummary(guide.program).map((t, i) => (
                  <li key={i} className="text-sm flex gap-2" style={{ color: C.ink }}>
                    <span className="shrink-0 mt-[7px]" style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent)" }} />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="text-sm leading-relaxed mt-3" style={{ color: C.muted }}>
                De app zegt bij elke wissel wat u moet doen, met een piep en trilling. Zet het geluid van uw telefoon aan, of gebruik oortjes.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h2 className="disp text-[30px] leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
                  Training opnemen met GPS
                </h2>
                <p className="text-sm leading-relaxed mt-2" style={{ color: C.muted }}>
                  Tijd, afstand, tempo en splits per {sport === "fietsen" ? "5 km" : "kilometer"}. De route blijft alleen op dit apparaat.
                </p>
              </div>
              <Choice options={Object.entries(LIVE_SPORTS).map(([value, s]) => ({ value, label: s.label }))} value={sport} onChange={setSport} ariaLabel="Sport" />
            </>
          )}
          {!backgroundCapable() && (
            <p className="text-xs leading-relaxed px-3 py-2.5" style={{ color: C.ink, background: "var(--accent-soft)", borderRadius: R.field }}>
              In de browser loopt de opname alleen door zolang de app in beeld is. Het scherm blijft daarom aan. Met de app uit de App Store of Play Store gaat het ook door met het scherm uit.
            </p>
          )}
          {!geoAvailable() && (
            <p className="text-xs" style={{ color: C.train }} role="alert">
              Dit apparaat geeft geen locatie door.
            </p>
          )}
          <button onClick={start} disabled={!geoAvailable()} className="tap w-full py-4 disp text-2xl" style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}>
            Start
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between px-5 pb-5 max-w-md mx-auto w-full">
          {gs ? (
            <div className="flex-1 flex flex-col justify-center gap-6">
              {gs.done ? (
                <div className="text-center">
                  <div className="disp text-[44px] leading-none" style={{ color: C.accent, fontWeight: 600 }}>
                    Klaar!
                  </div>
                  <p className="text-sm mt-2" style={{ color: C.muted }}>
                    Goed gedaan. Druk op Stop om op te slaan.
                  </p>
                </div>
              ) : (
                <div className="text-center px-4 py-6" style={{ borderRadius: 20, background: "var(--accent-soft)", borderTop: `6px solid ${SEG_COLOR[gs.seg.kind]}` }}>
                  <div className="disp text-[40px] leading-none uppercase" style={{ color: C.ink, fontWeight: 700 }}>
                    {gs.seg.label}
                  </div>
                  <div className="disp tnum text-[84px] leading-none mt-2" style={{ color: C.ink, fontWeight: 600 }}>
                    {gs.left != null ? fmtLeft(gs.left) : fmtKm(gs.leftM)}
                  </div>
                  <div className="text-sm mt-2" style={{ color: C.muted }}>
                    {gs.seg.rounds > 1 ? `Ronde ${gs.seg.round} van ${gs.seg.rounds} · ` : ""}
                    {gs.next ? `daarna ${gs.next.label.toLowerCase()} ${gs.next.sec ? fmtDuration(gs.next.sec) : fmtKm(gs.next.meters)}` : "laatste stuk"}
                  </div>
                  {gs.seg.hint && (
                    <div className="text-xs mt-1.5" style={{ color: C.muted }}>
                      {gs.seg.hint}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <Big small label="Tijd" value={fmtDuration(st.elapsed)} />
                <Big small label="Afstand" value={(st.distanceM / 1000).toFixed(2).replace(".", ",")} unit="km" />
                <Big small label="Tempo" unit="/km" value={paceText(track.sport, st.pace)} />
              </div>
              {(err || !st.gpsOk) && (
                <p className="text-center text-xs" style={{ color: err ? C.train : C.muted }} role="status">
                  {err || "Locatie zoeken… De begeleiding loopt al; afstand volgt zodra er GPS is."}
                </p>
              )}
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    setMuted(!mute);
                    setMute(!mute);
                  }}
                  className="tap text-sm"
                  style={{ color: C.muted }}
                >
                  {mute ? "Geluid aan" : "Geluid uit"}
                </button>
              </div>
            </div>
          ) : (
          <div className="flex-1 flex flex-col justify-center gap-8">
            <Big label="Tijd" value={fmtDuration(st.elapsed)} />
            <Big label="Afstand" value={st.distanceM >= 1000 ? (st.distanceM / 1000).toFixed(2).replace(".", ",") : String(st.distanceM)} unit={st.distanceM >= 1000 ? "km" : "m"} />
            <div className="grid grid-cols-2 gap-4">
              <Big small label={bike ? "Snelheid" : "Tempo nu"} unit={bike ? "km/u" : "/km"} value={bike ? paceText("fietsen", null, st.avgSpeed) : paceText(track.sport, st.pace)} />
              <Big small label={bike ? "Laatste 5 km" : "Laatste km"} value={lastSplit ? fmtDuration(lastSplit) : "–"} />
            </div>
            {!st.gpsOk && !err && (
              <p className="text-center text-sm" style={{ color: C.muted }} role="status">
                Locatie zoeken… Ga naar buiten, met vrij zicht op de lucht.
              </p>
            )}
            {err && (
              <p className="text-center text-sm" style={{ color: C.train }} role="alert">
                {err}
              </p>
            )}
          </div>
          )}
          {confirmStop ? (
            <div className="space-y-2.5">
              <p className="text-sm text-center" style={{ color: C.ink }}>
                {fmtKm(st.distanceM)} in {fmtDuration(st.moving || st.elapsed)}. Opslaan?
              </p>
              <TBtn full onClick={finish}>
                Opslaan en afronden
              </TBtn>
              <div className="grid grid-cols-2 gap-2.5">
                <TBtn
                  full
                  kind="ghost"
                  onClick={() => {
                    if (confirmStop.resume) setTrack((t) => resumeTrack(t));
                    setConfirmStop(false);
                  }}
                >
                  Doorgaan
                </TBtn>
                <TBtn full kind="danger" onClick={discard}>
                  Weggooien
                </TBtn>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {track.status === "pauze" ? (
                <button onClick={() => setTrack((t) => resumeTrack(t))} className="tap py-4 disp text-xl" style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}>
                  Hervat
                </button>
              ) : (
                <button onClick={() => setTrack((t) => pauseTrack(t))} className="tap py-4 disp text-xl" style={{ background: "var(--accent-soft)", color: C.ink, borderRadius: R.field, fontWeight: 600 }}>
                  Pauze
                </button>
              )}
              <button
                onClick={() => {
                  setConfirmStop({ resume: track.status === "loopt" });
                  setTrack((t) => (t.status === "loopt" ? pauseTrack(t) : t));
                }}
                className="tap py-4 disp text-xl"
                style={{ background: "var(--ember-fill)", color: "#FFFFFF", borderRadius: R.field, fontWeight: 600 }}
              >
                Stop
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
  return createPortal(view, document.body);
}
