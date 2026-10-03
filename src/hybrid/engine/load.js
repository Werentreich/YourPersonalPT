/* Eén belastingsmaat voor kracht, duur, WOD's en Hyrox.

   Basis is sRPE: inspanning (0–10) × minuten (Foster C. e.a. 2001, J Strength
   Cond Res 15(1)). Dat werkt voor elke discipline. Ontbreekt de RPE, dan
   schatten we die uit de hartslag (duur), uit de RIR van de sets (kracht,
   RPE ≈ 10 − RIR, Zourdos M. e.a. 2016) of uit het soort sessie.

   TRIMP (Banister E.W. 1991) bij hartslagdata, ter controle en voor de
   verdeling over de zones.

   Fitheid (CTL, 42 dagen), vermoeidheid (ATL, 7 dagen) en vorm (TSB = CTL −
   ATL aan het eind van de dag): het impulse-responsmodel van Banister (1975), zoals
   gangbaar uitgewerkt met exponentieel voortschrijdende gemiddelden.
   De verhouding acuut/chronisch is alleen een signaal, geen harde grens
   (Impellizzeri F.M. e.a. 2020, IJSPP 15(6)). */

import { SPORTS, ENDURANCE_TYPES, DAY_MS, dayNum, isoOfNum, mondayOf, pillarOf, hyroxTotal, num } from "./model.js";
import { hrAnchors, hrZoneOf, seilerOf } from "./zones.js";
import { blocksOf, blockDuration, blocksSystems, pillarShares, sessionVolume, blockScore, blockResult, blockHeader } from "./blocks.js";
import { movementById } from "./movements.js";

/* Duur van een sessie in seconden. Ingevuld gaat voor; anders de som van
   de blokken (een AMRAP van 12 min duurt 12 min, sets ~2,5 min per set). */
export function durationOf(s) {
  if (s.durationSec) return s.durationSec;
  if (s.kind === "hyrox") {
    const t = hyroxTotal(s);
    if (t) return t;
  }
  const bl = blocksOf(s);
  if (bl.length) {
    const sum = bl.reduce((a, b) => a + (blockDuration(b) || 0), 0);
    if (sum) return Math.round(sum);
  }
  if (s.kind === "wod" && s.capSec) return s.capSec;
  return null;
}

/* Borg CR10 uit percentage hartslagreserve (benadering). */
export function rpeFromHrr(hrr) {
  if (hrr == null) return null;
  const pts = [
    [0.4, 1.5],
    [0.5, 2.5],
    [0.6, 3.5],
    [0.7, 5],
    [0.8, 6.5],
    [0.88, 8],
    [0.95, 9.5],
  ];
  if (hrr <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (hrr <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((hrr - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 10;
}

/* Hartslagreserve-fractie van een gemiddelde hartslag. */
export function hrrOf(profile, avgHr) {
  const { hrMax, hrRest } = hrAnchors(profile);
  const hr = num(avgHr);
  if (!hr || !hrMax) return null;
  const rest = hrRest || 60;
  if (hrMax <= rest) return null;
  return Math.min(1, Math.max(0, (hr - rest) / (hrMax - rest)));
}

/* RPE van een sessie: ingevuld, anders geschat, met de bron erbij. */
export function rpeOf(s, profile) {
  const given = num(s.rpe);
  if (given != null) return { rpe: given, est: false, from: "invoer" };
  if (s.kind === "duur" || s.kind === "hyrox") {
    const r = rpeFromHrr(hrrOf(profile, s.avgHr));
    if (r != null) return { rpe: Math.round(r * 10) / 10, est: true, from: "hartslag" };
  }
  if (s.kind === "kracht") {
    const rirs = blocksOf(s)
      .filter((b) => b.type === "sets")
      .flatMap((b) => (b.items || []).flatMap((e) => (e.sets || []).map((x) => num(x && x.rir))))
      .filter((x) => x != null);
    if (rirs.length) {
      const avg = rirs.reduce((a, b) => a + b, 0) / rirs.length;
      // sessie-RPE ligt iets onder de RPE van de zwaarste sets (warming-up, rust)
      return { rpe: Math.min(10, Math.max(5, 10 - avg - 1)), est: true, from: "rir" };
    }
    return { rpe: 7, est: true, from: "standaard" };
  }
  if (s.kind === "duur") return { rpe: (ENDURANCE_TYPES[s.type] || ENDURANCE_TYPES.rustig).rpe, est: true, from: "soort" };
  if (s.kind === "wod") return { rpe: 8, est: true, from: "standaard" };
  if (s.kind === "hyrox") return { rpe: s.mode === "deel" ? 7 : 9, est: true, from: "standaard" };
  return { rpe: 2, est: true, from: "standaard" };
}

/* Banister-TRIMP. Mannen 0,64·e^(1,92x), vrouwen 0,86·e^(1,67x). */
export function trimpOf(s, profile) {
  const hrr = hrrOf(profile, s.avgHr);
  const sec = durationOf(s);
  if (hrr == null || !sec) return null;
  const f = profile && profile.sex === "vrouw" ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr);
  return Math.round((sec / 60) * hrr * f);
}

/* Aandeel van de belasting per systeem: benen, bovenlichaam, centraal.
   Met blokken: gewogen naar de geschatte werktijd per beweging. */
export function systemSplit(s) {
  if (s.kind === "duur") {
    const sp = SPORTS[s.sport] || SPORTS.hardlopen;
    return { legs: sp.legs, upper: sp.upper, central: 1 - sp.legs - sp.upper };
  }
  const bl = blocksOf(s);
  const fromBlocks = bl.length ? blocksSystems(bl) : null;
  if (fromBlocks) {
    // kracht: 15% centraal; metcon en Hyrox: hart en longen wegen zwaarder
    const central = s.kind === "kracht" && bl.every((x) => x.type === "sets") ? 0.15 : 0.3;
    const k = (1 - central) / (fromBlocks.legs + fromBlocks.upper || 1);
    return { legs: fromBlocks.legs * k, upper: fromBlocks.upper * k, central };
  }
  if (s.kind === "hyrox") return { legs: 0.5, upper: 0.2, central: 0.3 };
  if (s.kind === "wod") return { legs: 0.35, upper: 0.35, central: 0.3 };
  if (s.kind === "kracht") return { legs: 0.425, upper: 0.425, central: 0.15 };
  return { legs: 0.3, upper: 0.3, central: 0.4 };
}

/* Belasting verdeeld over de pijlers. Een krachtsessie met een AMRAP als
   afsluiter telt deels als conditie, naar verhouding van de blokduur. */
export function pillarSplit(s) {
  const base = pillarOf(s);
  if (s.kind === "duur" || s.kind === "mobiliteit") return { [base]: 1 };
  const bl = blocksOf(s).filter((b) => b.type !== "vrij");
  if (!bl.length) return { [base]: 1 };
  return pillarShares(bl, base);
}

/* Alle afgeleide belastingswaarden van één sessie. */
export function sessionLoad(s, profile) {
  const sec = durationOf(s);
  const r = rpeOf(s, profile);
  const minutes = sec ? sec / 60 : 0;
  const srpe = Math.round(r.rpe * minutes);
  const split = systemSplit(s);
  const shares = pillarSplit(s);
  return {
    minutes,
    rpe: r.rpe,
    rpeEst: r.est,
    rpeFrom: r.from,
    srpe,
    trimp: trimpOf(s, profile),
    pillar: pillarOf(s),
    pillars: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, Math.round(srpe * v)])),
    systems: { legs: Math.round(srpe * split.legs), upper: Math.round(srpe * split.upper), central: Math.round(srpe * split.central) },
    zone: s.kind === "duur" ? hrZoneOf(profile, num(s.avgHr)) : null,
  };
}

/* Dagelijkse belasting van `from` t/m `to` (ISO-datums). */
export function dailyLoads(sessions, profile, from, to) {
  const a = dayNum(from),
    b = dayNum(to);
  const days = Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => ({ date: isoOfNum(a + i), load: 0, legs: 0, upper: 0, central: 0 }));
  for (const s of sessions) {
    const i = dayNum(s.date) - a;
    if (i < 0 || i >= days.length) continue;
    const L = sessionLoad(s, profile);
    const d = days[i];
    d.load += L.srpe;
    d.legs += L.systems.legs;
    d.upper += L.systems.upper;
    d.central += L.systems.central;
  }
  return days;
}

/* Fitheid, vermoeidheid en vorm per dag. De reeks begint bij de eerste
   sessie, zodat ook de eerste getoonde waarden de hele historie bevatten.
   `since`: dagen sinds de eerste sessie (voor "nog aan het opbouwen"). */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
export function fitnessSeries(sessions, profile, from, to) {
  const first = sessions.length ? sessions.reduce((m, s) => (s.date < m ? s.date : m), "9999-12-31") : null;
  const start = first && first < from ? first : from;
  const firstN = first ? dayNum(first) : null;
  const days = dailyLoads(sessions, profile, start, to);
  const kc = 1 - Math.exp(-1 / CTL_DAYS);
  const ka = 1 - Math.exp(-1 / ATL_DAYS);
  let ctl = 0,
    atl = 0;
  const out = [];
  for (const d of days) {
    ctl += (d.load - ctl) * kc;
    atl += (d.load - atl) * ka;
    /* Vorm aan het eind van de dag, zodat fitheid − vermoeidheid = vorm op
       elk scherm klopt. (TrainingPeaks gebruikt de stand van gisteren; dat
       oogt voor gebruikers als een rekenfout.) */
    const tsb = ctl - atl;
    if (d.date >= from) out.push({ date: d.date, load: d.load, ctl, atl, tsb, acwr: ctl > 1 ? atl / ctl : null, since: firstN == null ? -1 : dayNum(d.date) - firstN });
  }
  return out;
}

/* Duiding van de vorm, in gewone woorden. Grenzen als gangbare vuistregels
   bij sRPE-schaal (geschaald naar de eigen fitheid). */
export const MIN_HISTORY_DAYS = 21;
export function formStatus(point) {
  if (!point || point.since < MIN_HISTORY_DAYS || point.ctl < 5) return { key: "start", label: "Nog aan het opbouwen", text: "Log een paar weken uw trainingen; daarna ziet u hier hoe uw vorm zich ontwikkelt." };
  const rel = point.tsb / point.ctl;
  if (rel > 0.25) return { key: "fris", label: "Fris", text: "U bent goed uitgerust. Een prima moment voor een zware sessie of een test." };
  if (rel > -0.1) return { key: "neutraal", label: "In balans", text: "Belasting en herstel zijn in evenwicht." };
  if (rel > -0.3) return { key: "opbouw", label: "Productieve opbouw", text: "U traint meer dan gewoonlijk. Zo wordt u fitter, zolang het herstel meekomt." };
  return { key: "zwaar", label: "Zware belasting", text: "De vermoeidheid loopt flink op. Plan binnenkort een rustigere dag." };
}

/* Weekoverzicht: belasting per pijler, minuten en afstand per sport. */
export function weekSummary(sessions, profile, mondayISO) {
  const a = dayNum(mondayISO);
  const inWeek = sessions.filter((s) => {
    const n = dayNum(s.date) - a;
    return n >= 0 && n < 7;
  });
  const pillars = { kracht: 0, duur: 0, conditie: 0, mobiliteit: 0 };
  const sports = {};
  let total = 0,
    minutes = 0;
  for (const s of inWeek) {
    const L = sessionLoad(s, profile);
    for (const [k, v] of Object.entries(L.pillars)) pillars[k] = (pillars[k] || 0) + v;
    total += L.srpe;
    minutes += L.minutes;
    if (s.kind === "duur") {
      const k = s.sport || "hardlopen";
      sports[k] = sports[k] || { count: 0, distanceM: 0, minutes: 0, inBlocks: 0 };
      sports[k].count++;
      sports[k].distanceM += num(s.distanceM, 0);
      sports[k].minutes += L.minutes;
    } else {
      // meters binnen WOD's en intervallen (bijv. 5 × 500 m roeien) tellen mee
      for (const [k, d] of Object.entries(sessionVolume(blocksOf(s)).sport)) {
        sports[k] = sports[k] || { count: 0, distanceM: 0, minutes: 0, inBlocks: 0 };
        sports[k].distanceM += d;
        sports[k].inBlocks += d;
      }
    }
  }
  return { monday: mondayISO, count: inWeek.length, total, minutes, pillars, sports };
}

export function weeklySeries(sessions, profile, weeks, todayISO) {
  const m = dayNum(mondayOf(todayISO));
  return Array.from({ length: weeks }, (_, i) => weekSummary(sessions, profile, isoOfNum(m - (weeks - 1 - i) * 7)));
}

/* Intensiteitsverdeling van duursessies (Seiler, drie zones), in minuten.
   Per sessie de zone van de gemiddelde hartslag, anders het soort sessie. */
const TYPE_ZONE = { rustig: 1, lang: 1, tempo: 2, drempel: 3, interval: 3, heuvel: 3, wedstrijd: 3 };

/* Minuten per hartslagzone (vijf zones) uit het histogram van een
   geïmporteerd bestand (seconden per bak van 5 slagen). */
export function zoneMinutesFromHist(hist, profile) {
  if (!hist) return null;
  const out = [0, 0, 0, 0, 0];
  let any = false;
  for (const [b, sec] of Object.entries(hist)) {
    const z = hrZoneOf(profile, Number(b) + 2.5);
    if (z == null) return null;
    out[z] += sec / 60;
    any = true;
  }
  return any ? out : null;
}

export function intensityDistribution(sessions, profile, fromISO, toISO) {
  const out = { 1: 0, 2: 0, 3: 0 };
  for (const s of sessions) {
    if (s.kind !== "duur" || s.date < fromISO || s.date > toISO) continue;
    const zm = zoneMinutesFromHist(s.hrHist, profile);
    if (zm) {
      zm.forEach((m, z) => (out[seilerOf(z)] += m));
      continue;
    }
    // intervallen in de sessie: het werk telt als zwaar, de rest als rustig
    const iv = blocksOf(s).filter((b) => b.type === "interval");
    if (iv.length && (s.type === "rustig" || s.type === "lang" || !s.type)) {
      const total = (durationOf(s) || 0) / 60;
      const work = Math.min(total, iv.reduce((a, b) => {
        const sp = ((b.result && b.result.splits) || []).filter((x) => x > 0);
        const per = sp.length ? sp.reduce((x, y) => x + y, 0) / sp.length : (blockDuration(b) || 0) / Math.max(1, num(b.rounds, 1)) / 2;
        return a + (per * num(b.rounds, 1)) / 60;
      }, 0));
      out[3] += work;
      out[1] += Math.max(0, total - work);
      continue;
    }
    const min = (durationOf(s) || 0) / 60;
    const z = (s.type && s.type !== "rustig" && s.type !== "lang" ? TYPE_ZONE[s.type] : null) || seilerOf(hrZoneOf(profile, num(s.avgHr))) || TYPE_ZONE[s.type] || 1;
    out[z] += min;
  }
  const tot = out[1] + out[2] + out[3];
  return { minutes: out, total: tot, share: tot ? { 1: out[1] / tot, 2: out[2] / tot, 3: out[3] / tot } : null };
}

/* Krachtrecords: beste geschatte 1RM per oefening (Epley). */
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? (reps === 1 ? kg : kg * (1 + reps / 30)) : 0);
export function strengthRecords(sessions) {
  const best = {};
  for (const s of sessions) {
    for (const b of blocksOf(s)) {
      if (b.type !== "sets") continue;
      for (const e of b.items || []) {
        for (const x of e.sets || []) {
          const v = e1rm(num(x && x.kg, 0), num(x && x.reps, 0));
          const key = e.moveId || e.name;
          if (v && (!best[key] || v > best[key].e1rm)) best[key] = { name: e.name, e1rm: v, kg: num(x.kg), reps: num(x.reps), date: s.date };
        }
      }
    }
  }
  return Object.values(best).sort((a, b) => b.e1rm - a.e1rm);
}

/* Beste tijden op vaste afstanden binnen blokken: intervallen (snelste
   split) en doorlopende stukken, bijv. 500 m roeien of 1000 m SkiErg. */
export function pieceRecords(sessions) {
  const best = {};
  const put = (mv, dist, sec, date) => {
    if (!mv || !dist || !sec) return;
    const key = `${mv.id}:${dist}`;
    if (!best[key] || sec < best[key].sec) best[key] = { moveId: mv.id, name: mv.name, distanceM: dist, sec, date };
  };
  for (const s of sessions) {
    for (const b of blocksOf(s)) {
      const items = b.items || [];
      if (items.length !== 1) continue;
      const it = items[0];
      const mv = movementById(it.moveId);
      const dist = num(it.distanceM);
      if (!mv || !dist) continue;
      if (b.type === "interval") for (const sp of (b.result && b.result.splits) || []) if (sp > 0) put(mv, dist, sp, s.date);
      if (b.type === "doorlopend") put(mv, dist, num(b.result && b.result.timeSec), s.date);
    }
    // losse duursessies op een standaardafstand (roeien en SkiErg)
    if (s.kind === "duur" && (s.sport === "roeien" || s.sport === "skierg") && [500, 1000, 2000, 5000].includes(Math.round(num(s.distanceM, 0)))) {
      put(movementById(s.sport === "roeien" ? "row" : "ski"), Math.round(s.distanceM), s.durationSec, s.date);
    }
  }
  return Object.values(best).sort((a, b) => a.name.localeCompare(b.name) || a.distanceM - b.distanceM);
}

/* Benchmarks: blokken met een naam (bijv. "Fran") en hun beste resultaat. */
export function benchmarkRecords(sessions) {
  const best = {};
  for (const s of sessions) {
    for (const b of blocksOf(s)) {
      if (!b.name) continue;
      const sc = blockScore(b);
      if (sc == null) continue;
      const key = b.name.toLowerCase();
      const entry = { name: b.name, score: sc, result: blockResult(b), header: blockHeader(b), date: s.date, count: ((best[key] && best[key].count) || 0) + 1 };
      if (!best[key] || sc > best[key].score) best[key] = entry;
      else best[key].count = entry.count;
    }
  }
  return Object.values(best).sort((a, b) => a.name.localeCompare(b.name));
}

/* Duurrecords: snelste gemiddelde tempo op standaardafstanden (hardlopen),
   gemeten over sessies die minstens die afstand besloegen. */
export function runRecords(sessions) {
  const marks = [
    [5000, "5 km"],
    [10000, "10 km"],
    [21097, "Halve marathon"],
    [42195, "Marathon"],
  ];
  return marks
    .map(([d, label]) => {
      let best = null;
      for (const s of sessions) {
        if (s.kind !== "duur" || s.sport !== "hardlopen" || !s.distanceM || !s.durationSec || s.distanceM < d * 0.98) continue;
        const pace = s.durationSec / s.distanceM;
        if (!best || pace < best.pace) best = { pace, date: s.date, est: (pace * d) };
      }
      return best ? { label, distance: d, ...best } : null;
    })
    .filter(Boolean);
}

export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
