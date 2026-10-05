/* Herstel (readiness): hoe staat u er vandaag bij?

   - Vragenlijst naar de Hooper-index (Hooper S.L. & Mackinnon L.T. 1995,
     Sports Med 20(5)): slaapkwaliteit, vermoeidheid, stress en spierpijn,
     aangevuld met slaapduur en energie. Elke vraag 1–5, 5 = best.
   - HRV ten opzichte van uw eigen basislijn (Plews D.J. e.a. 2013,
     Sports Med 43(9)): ln(rMSSD), gemiddelde van 7 dagen tegenover de
     normale bandbreedte van 60 dagen. Lager dan normaal = minder herstel.
   - Rusthartslag: duidelijk hoger dan uw basislijn is een waarschuwing.

   Uitkomst 0–100, met een duiding in gewone woorden. Het is een signaal om
   bij te sturen, geen diagnose. */

import { num, dayNum, isoOfNum } from "./model.js";

export const QUESTIONS = [
  { id: "sleepQ", label: "Slaapkwaliteit", low: "slecht", high: "uitstekend" },
  { id: "energy", label: "Energie", low: "leeg", high: "vol energie" },
  { id: "soreness", label: "Spierpijn", low: "veel", high: "geen" },
  { id: "stress", label: "Stress", low: "veel", high: "ontspannen" },
  { id: "mood", label: "Zin om te trainen", low: "geen", high: "veel" },
];

/* Score van één check-in uit de vragenlijst en slaapduur (0–100). */
export function questionnaireScore(c) {
  if (!c) return null;
  const vals = QUESTIONS.map((q) => num(c[q.id])).filter((x) => x != null);
  if (!vals.length && num(c.sleepH) == null) return null;
  const q = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length - 1) / 4 : null; // 0..1
  const h = num(c.sleepH);
  const sleep = h == null ? null : Math.max(0, Math.min(1, (h - 4) / 4)); // 4 u = 0, 8 u+ = 1
  const parts = [q != null ? [q, 0.75] : null, sleep != null ? [sleep, 0.25] : null].filter(Boolean);
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return Math.round((parts.reduce((a, [v, x]) => a + v * x, 0) / w) * 100);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/* HRV-signaal: gemiddelde ln(rMSSD) van 7 dagen tegenover 60 dagen. */
export function hrvSignal(checkins, todayISO) {
  const t = dayNum(todayISO);
  const pts = checkins.filter((c) => num(c.hrv) > 0 && dayNum(c.date) <= t && dayNum(c.date) > t - 60).map((c) => ({ n: dayNum(c.date), v: Math.log(num(c.hrv)) }));
  if (pts.length < 14) return null; // te weinig om een basislijn te bepalen
  const base = pts.map((p) => p.v);
  const week = pts.filter((p) => p.n > t - 7).map((p) => p.v);
  if (!week.length) return null;
  const m = mean(base);
  const s = sd(base) || 0.05;
  const z = (mean(week) - m) / s;
  return { z, low: z < -1, high: z > 1 };
}

/* Rusthartslag-signaal: vandaag tegenover het gemiddelde van 30 dagen. */
export function rhrSignal(checkins, todayISO) {
  const t = dayNum(todayISO);
  const today = checkins.find((c) => c.date === todayISO && num(c.rhr) > 0);
  const base = checkins.filter((c) => num(c.rhr) > 0 && dayNum(c.date) < t && dayNum(c.date) >= t - 30).map((c) => num(c.rhr));
  if (!today || base.length < 7) return null;
  const diff = num(today.rhr) - mean(base);
  return { diff, high: diff >= 5 };
}

/* Herstel van vandaag: vragenlijst, bijgesteld met HRV en rusthartslag. */
export function readinessFor(checkins, todayISO) {
  const c = (checkins || []).find((x) => x.date === todayISO) || null;
  let score = questionnaireScore(c);
  const notes = [];
  const hrv = hrvSignal(checkins || [], todayISO);
  const rhr = rhrSignal(checkins || [], todayISO);
  if (score == null && (hrv || rhr)) score = 70;
  if (score == null) return { score: null, checkedIn: !!c, level: null, notes };
  if (hrv && hrv.low) {
    score -= 15;
    notes.push("Uw HRV ligt deze week onder uw normale bandbreedte.");
  }
  if (rhr && rhr.high) {
    score -= 10;
    notes.push(`Uw rusthartslag is ${Math.round(rhr.diff)} slagen hoger dan normaal.`);
  }
  if (c && num(c.sleepH) != null && num(c.sleepH) < 6) notes.push("Korte nacht: minder dan 6 uur slaap.");
  if (c && num(c.soreness) != null && num(c.soreness) <= 2) notes.push("Veel spierpijn.");
  if (c && c.ill) {
    score = Math.min(score, 20);
    notes.push("U voelt zich ziek: rust gaat voor.");
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? "goed" : score >= 50 ? "matig" : "laag";
  return { score, checkedIn: !!c, level, notes, hrv, rhr };
}

export const READINESS_TEXT = {
  goed: { label: "Goed hersteld", text: "U kunt de training doen zoals gepland." },
  matig: { label: "Matig hersteld", text: "Train, maar houd wat over: iets minder volume of intensiteit." },
  laag: { label: "Weinig hersteld", text: "Vandaag liever rustig: een herstelsessie of rust." },
};

/* Gemiddelde herstelscore van de laatste n dagen (alleen dagen met check-in). */
export function readinessAverage(checkins, todayISO, days = 7) {
  const t = dayNum(todayISO);
  const scores = [];
  for (let i = 0; i < days; i++) {
    const r = readinessFor(checkins, isoOfNum(t - i));
    if (r.score != null && r.checkedIn) scores.push(r.score);
  }
  return scores.length ? Math.round(mean(scores)) : null;
}
