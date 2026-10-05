/* Trainingszones. Elke functie werkt met wat de gebruiker weet en schat de
   rest verantwoord in.

   Bronnen:
   - Tanaka H. e.a. (2001), JACC 37(1): HRmax ≈ 208 − 0,7 × leeftijd.
   - Karvonen M. e.a. (1957): zones als percentage van de hartslagreserve.
   - Friel J. (2009), The Triathlete's Training Bible: zones naar
     lactaatdrempelhartslag (LTHR).
   - Riegel P. (1981), American Scientist 69: t2 = t1 × (d2/d1)^1,06.
   - Coggan A. & Allen H. (2010), Training and Racing with a Power Meter:
     vermogenszones naar FTP.
   - Seiler S. (2010), IJSPP 5(3): drie intensiteitszones voor de verdeling. */

import { num } from "./model.js";

export const ZONE_NAMES = ["Herstel", "Duur", "Tempo", "Drempel", "VO2max"];

export function ageOf(profile, now = new Date()) {
  const y = num(profile && profile.birthYear);
  return y ? now.getFullYear() - y : null;
}

/* Hartslag-ankers: gemeten waarden gaan voor, anders een schatting. */
export function hrAnchors(profile) {
  const age = ageOf(profile);
  const measuredMax = num(profile && profile.hrMax);
  const hrMax = measuredMax || (age ? Math.round(208 - 0.7 * age) : null);
  const hrRest = num(profile && profile.hrRest);
  const lthr = num(profile && profile.lthr);
  return { hrMax, hrRest, lthr, estimatedMax: !measuredMax && !!hrMax };
}

/* Vijf hartslagzones: [ondergrens, bovengrens] in slagen per minuut.
   Volgorde van voorkeur: LTHR (Friel), hartslagreserve (Karvonen), % HRmax. */
export function hrZones(profile) {
  const { hrMax, hrRest, lthr } = hrAnchors(profile);
  let bounds, method;
  if (lthr) {
    method = "lthr";
    bounds = [0.81, 0.89, 0.93, 1.0].map((f) => lthr * f);
  } else if (hrMax && hrRest) {
    method = "reserve";
    bounds = [0.6, 0.7, 0.8, 0.9].map((f) => hrRest + (hrMax - hrRest) * f);
  } else if (hrMax) {
    method = "max";
    bounds = [0.68, 0.78, 0.86, 0.93].map((f) => hrMax * f);
  } else return null;
  const b = bounds.map(Math.round);
  const top = hrMax || Math.round((lthr || 0) * 1.1);
  return {
    method,
    zones: ZONE_NAMES.map((name, i) => ({ name, lo: i ? b[i - 1] : 0, hi: i < 4 ? b[i] : top })),
  };
}

/* Zone (0..4) van een hartslag. */
export function hrZoneOf(profile, hr) {
  const z = hrZones(profile);
  if (!z || !hr) return null;
  const i = z.zones.findIndex((x) => hr < x.hi);
  return i === -1 ? 4 : i;
}

/* Drempeltempo hardlopen (s/km) uit een 5 km-tijd: het tempo dat u ongeveer
   een uur volhoudt, via Riegel. */
export function runThresholdPace(run5kSec) {
  const t = num(run5kSec);
  if (!t || t < 600 || t > 3600) return null;
  const d60 = 5000 * Math.pow(3600 / t, 1 / 1.06); // meters in 60 min
  return 3600 / (d60 / 1000);
}

/* Riegel-voorspelling voor een andere afstand. */
export const riegel = (t1, d1, d2) => t1 * Math.pow(d2 / d1, 1.06);

/* Tempozones hardlopen als s/km [snelste, langzaamste]. */
export function runPaceZones(run5kSec) {
  const thr = runThresholdPace(run5kSec);
  if (!thr) return null;
  const f = [
    [1.29, 1.5],
    [1.14, 1.29],
    [1.06, 1.14],
    [0.99, 1.06],
    [0.9, 0.99],
  ];
  return ZONE_NAMES.map((name, i) => ({ name, fast: thr * f[i][0], slow: thr * f[i][1] }));
}

/* Coggan-vermogenszones (eerste vijf), in watt. */
export function powerZones(ftp) {
  const p = num(ftp);
  if (!p) return null;
  const f = [
    [0, 0.55],
    [0.56, 0.75],
    [0.76, 0.9],
    [0.91, 1.05],
    [1.06, 1.2],
  ];
  return ZONE_NAMES.map((name, i) => ({ name, lo: Math.round(p * f[i][0]), hi: Math.round(p * f[i][1]) }));
}

/* Zwemmen: zones rond de critical swim speed (s per 100 m). */
export function swimZones(css100) {
  const c = num(css100);
  if (!c) return null;
  const off = [
    [12, 20],
    [6, 12],
    [2, 6],
    [-2, 2],
    [-8, -2],
  ];
  return ZONE_NAMES.map((name, i) => ({ name, fast: c + off[i][0], slow: c + off[i][1] }));
}

/* Roeien: drempeltempo per 500 m ≈ 2 km-tempo + 10 % (vuistregel,
   vergelijkbaar met de 2k-gebaseerde zones van Concept2). */
export function rowZones(row2kSec) {
  const t = num(row2kSec);
  if (!t) return null;
  const split = t / 4; // per 500 m
  const thr = split * 1.1;
  const f = [
    [1.18, 1.3],
    [1.1, 1.18],
    [1.04, 1.1],
    [0.98, 1.04],
    [0.91, 0.98],
  ];
  return ZONE_NAMES.map((name, i) => ({ name, fast: thr * f[i][0], slow: thr * f[i][1] }));
}

/* Drie-zonemodel (Seiler) uit vijf zones: 1 = Z1–Z2, 2 = Z3, 3 = Z4–Z5. */
export const seilerOf = (zone5) => (zone5 == null ? null : zone5 <= 1 ? 1 : zone5 === 2 ? 2 : 3);
