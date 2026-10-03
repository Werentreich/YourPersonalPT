/* Live opname met GPS (hardlopen, wandelen, fietsen).
   Schermvullend, grote cijfers. De lopende opname staat tussendoor op het
   apparaat (nexa:hybrid-live), zodat herladen of een crash niets kost. */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, R, TBtn } from "../../App.jsx";
import { fmtDuration, fmtKm } from "../engine/model.js";
import { LIVE_SPORTS, newTrack, addFix, pauseTrack, resumeTrack, stopTrack, trackStats, trackToDraft } from "../engine/gps.js";
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

export function LiveRecorder({ onClose, onFinish }) {
  const [track, setTrack] = useState(() => savedLive());
  const [sport, setSport] = useState((track && track.sport) || "hardlopen");
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
    const t = newTrack(sport);
    save(t);
    setTrack(t);
  };
  const finish = () => {
    const done = stopTrack(ref.current);
    save(null);
    setTrack(null);
    onFinish(trackToDraft(done));
  };
  const discard = () => {
    save(null);
    setTrack(null);
    onClose();
  };

  const st = track ? trackStats(track) : null;
  const bike = (track ? track.sport : sport) === "fietsen";
  const lastSplit = st && st.splits.length ? st.splits[st.splits.length - 1] : null;

  const view = (
    <div className="fixed inset-0 flex flex-col hybrid macroapp" style={{ background: C.bg, color: C.ink, zIndex: 80, paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }} role="dialog" aria-modal="true" aria-label="Live opname">
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
          <div>
            <h2 className="disp text-[30px] leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
              Training opnemen met GPS
            </h2>
            <p className="text-sm leading-relaxed mt-2" style={{ color: C.muted }}>
              Tijd, afstand, tempo en splits per {sport === "fietsen" ? "5 km" : "kilometer"}. De route blijft alleen op dit apparaat.
            </p>
          </div>
          <Choice options={Object.entries(LIVE_SPORTS).map(([value, s]) => ({ value, label: s.label }))} value={sport} onChange={setSport} ariaLabel="Sport" />
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
