/* Live GPS-opname: rekenkern zonder browser of React.

   Een fix is { lat, lon, acc (m), t (ms), alt?, speed? (m/s) }.
   - Onnauwkeurige fixes (acc > 35 m) tellen niet.
   - Sprongen die fysiek niet kunnen (sneller dan het maximum van de sport)
     tellen niet: typisch een GPS-uitschieter tussen gebouwen.
   - Stilstaan: kleine verschuivingen binnen de nauwkeurigheid tellen niet
     als afstand (anders "loopt" een stilstaande telefoon kilometers).
   - Automatische pauze: geen beweging gedurende AUTO_PAUSE_SEC telt niet als
     bewegingstijd. Een handmatige pauze telt helemaal niet.
   - Splits per kilometer (bij fietsen per 5 km).

   De opname staat alleen op het apparaat (zoals routes uit bestanden). */

import { haversine } from "../import/files.js";
import { localISO } from "./model.js";

export const MAX_ACC = 35;
export const AUTO_PAUSE_SEC = 12;
export const LIVE_SPORTS = {
  hardlopen: { label: "Hardlopen", maxSpeed: 9, moveSpeed: 0.8, split: 1000 },
  wandelen: { label: "Wandelen", maxSpeed: 4, moveSpeed: 0.4, split: 1000 },
  fietsen: { label: "Fietsen", maxSpeed: 25, moveSpeed: 1.5, split: 5000 },
};

export function newTrack(sport = "hardlopen", now = Date.now()) {
  return { v: 1, sport: LIVE_SPORTS[sport] ? sport : "hardlopen", startedAt: now, status: "loopt", pauses: [], points: [], distance: 0, moving: 0, splits: [], rejected: 0, lastMoveAt: now, anchor: null };
}

/* Drempel waaronder een verschuiving ruis is: de helft van de gezamenlijke
   onnauwkeurigheid, tussen 4 en 20 m. Afstand wordt gemeten vanaf het
   laatste geaccepteerde punt (het anker), zodat langzaam bewegen niet
   wegvalt: na een paar fixes is de verplaatsing groter dan de drempel. */
function noiseOf(a, b) {
  return Math.max(4, Math.min(20, ((a.acc || 10) + (b.acc || 10)) / 2));
}

/* Fix verwerken; geeft een nieuwe track (onveranderlijk). */
export function addFix(track, fix) {
  if (!track || track.status !== "loopt") return track;
  if (!fix || !isFinite(fix.lat) || !isFinite(fix.lon) || !isFinite(fix.t)) return track;
  if (fix.acc != null && fix.acc > MAX_ACC) return { ...track, rejected: track.rejected + 1 };
  const sp = LIVE_SPORTS[track.sport];
  const p = { lat: fix.lat, lon: fix.lon, t: fix.t, acc: fix.acc != null ? Math.round(fix.acc) : null, alt: fix.alt != null ? Math.round(fix.alt) : null };
  const a = track.anchor;
  if (!a) return { ...track, anchor: p, points: [...track.points, p], lastMoveAt: fix.t };
  const dt = (fix.t - a.t) / 1000;
  if (dt <= 0) return track;
  const d = haversine(a, p);
  if (d < noiseOf(a, p)) {
    // stilstand of ruis. Langer dan AUTO_PAUSE_SEC: automatische pauze; het
    // anker schuift in de tijd mee zodat die stilstand later niet meetelt.
    return dt > AUTO_PAUSE_SEC ? { ...track, anchor: { ...a, t: fix.t } } : track;
  }
  const v = d / dt;
  if (v > sp.maxSpeed) return { ...track, rejected: track.rejected + 1 };
  const moving = v >= sp.moveSpeed;
  const distance = track.distance + d;
  const movingSec = track.moving + (moving ? dt : 0);
  // splits: elke keer dat een grens wordt gepasseerd, de tijd interpoleren
  const splits = [...track.splits];
  const unit = sp.split;
  let nextMark = (splits.length + 1) * unit;
  while (distance >= nextMark) {
    const frac = (nextMark - track.distance) / d;
    const at = track.moving + (moving ? dt * Math.max(0, Math.min(1, frac)) : 0);
    const prev = splits.reduce((x, s) => x + s, 0);
    splits.push(Math.round(at - prev));
    nextMark += unit;
  }
  return { ...track, anchor: p, points: [...track.points, p], distance, moving: movingSec, splits, lastMoveAt: moving ? fix.t : track.lastMoveAt };
}

export function pauseTrack(track, now = Date.now()) {
  if (!track || track.status !== "loopt") return track;
  return { ...track, status: "pauze", pauses: [...track.pauses, { from: now, to: null }] };
}

export function resumeTrack(track, now = Date.now()) {
  if (!track || track.status !== "pauze") return track;
  const pauses = track.pauses.map((p, i) => (i === track.pauses.length - 1 && p.to == null ? { ...p, to: now } : p));
  // na een pauze opnieuw beginnen vanaf de eerstvolgende fix (geen rechte lijn over de pauze)
  return { ...track, status: "loopt", pauses, anchor: null, lastMoveAt: now };
}

export function elapsedOf(track, now = Date.now()) {
  if (!track) return 0;
  const end = track.status === "klaar" ? track.endedAt : now;
  const paused = track.pauses.reduce((a, p) => a + ((p.to == null ? end : p.to) - p.from), 0);
  return Math.max(0, Math.round((end - track.startedAt - paused) / 1000));
}

/* Huidig tempo uit de laatste ~30 seconden (s per km), of null. */
export function currentPace(track, windowSec = 30) {
  const pts = track && track.points;
  if (!pts || pts.length < 2) return null;
  const last = pts[pts.length - 1];
  let d = 0;
  let i = pts.length - 1;
  while (i > 0 && (last.t - pts[i - 1].t) / 1000 <= windowSec) {
    d += haversine(pts[i - 1], pts[i]);
    i--;
  }
  const dt = (last.t - pts[i].t) / 1000;
  if (dt < 8 || d < 15) return null;
  return (dt / d) * 1000;
}

export function trackStats(track, now = Date.now()) {
  const elapsed = elapsedOf(track, now);
  const moving = Math.min(elapsed, Math.round(track.moving));
  const km = track.distance / 1000;
  return {
    elapsed,
    moving,
    distanceM: Math.round(track.distance),
    avgPace: km >= 0.05 && moving > 0 ? moving / km : null,
    avgSpeed: moving > 0 ? (track.distance / moving) * 3.6 : null,
    pace: currentPace(track),
    splits: track.splits,
    gpsOk: track.points.length > 0,
    rejected: track.rejected,
  };
}

export function stopTrack(track, now = Date.now()) {
  if (!track) return track;
  let t = track.status === "pauze" ? resumeTrack(track, now) : track;
  return { ...t, status: "klaar", endedAt: now };
}

function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
}

/* Hoogtemeters met een licht gladgestreken profiel. */
function gain(points) {
  const e = points.map((p) => p.alt).filter((x) => x != null);
  if (e.length < 5) return null;
  const sm = e.map((_, i) => {
    const s = e.slice(Math.max(0, i - 2), i + 3);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  let g = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i] > sm[i - 1]) g += sm[i] - sm[i - 1];
  return Math.round(g);
}

/* Opname naar conceptsessie + route (zelfde vorm als bij bestandsimport). */
export function trackToDraft(track) {
  const end = track.endedAt || Date.now();
  const st = trackStats(track, end);
  const start = new Date(track.startedAt);
  const draft = {
    kind: "duur",
    sport: track.sport,
    type: "rustig",
    date: localISO(start),
    startTime: start.toISOString(),
    durationSec: st.moving || st.elapsed || null,
    distanceM: st.distanceM || null,
    elevGain: gain(track.points),
    kmSplits: st.splits.length ? { unit: LIVE_SPORTS[track.sport].split, sec: st.splits } : undefined,
    source: "gps",
    sportDetected: true,
  };
  const route = track.points.length > 1 ? downsample(track.points, 600).map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]) : null;
  return { draft, route };
}
