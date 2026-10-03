/* Blokken: de bouwstenen van een hybride sessie.

   Een sessie bestaat uit één of meer blokken, bijvoorbeeld een warming-up,
   zware squats in sets, een EMOM en een cooling-down. Elk blok heeft
   bewegingen (items) met hun eigen maten (meters, tijd, calorieën,
   herhalingen, kg, hoogte) en een resultaat dat past bij het type.

   blok = {
     id, type, name?,              name: bijv. "Fran" (benchmark of eigen naam)
     role?,                        warmup, techniek, kracht, metcon, afsluiter, cooldown
     rounds?, repScheme?,          rondes, of een reeks zoals 21-15-9
     capSec?,                      tijdslimiet (AMRAP-duur, For Time-cap, test-duur)
     durationSec?, everySec?,      EMOM: totale duur en elke X sec (ook 4 of 5 min)
     emomMode?,                    "wissel" (om de beurt) of "alles"
     restSec?,                     rust tussen rondes of herhalingen
     workSec?, tabataMode?,        Tabata/tijdintervallen: werk en volgorde
     step?,                        Death by: herhalingen erbij per minuut
     testMetric?,                  test: time, kg, reps, distance of cal
     sets?,                        complex: [{ kg }] per set
     superset?,                    sets: oefeningen afwisselend (A1/A2)
     partners?, vestKg?, scaling?, met partner/team, gewichtsvest, rx/geschaald
     intensity?,                   doel, bijv. "zone 2", "1:45/500 m", "RPE 8"
     items: [{ moveId, name, metric?, reps, distanceM, timeSec, cal, kg,
               heightCm, perSide?, tempo?, restSec?, pct?, sets? }],
     result: { timeSec?, capped?, repsLeft?, rounds?, reps?, completed?,
               low?, value?, metric?, values?, splits?, distances?,
               distanceM?, avgWatt?, text? },
     text?                         vrij blok of oude omschrijving
   }
   Bij type "sets" heeft elk item `sets: [{ kg, reps, rir, kind? }]`
   (kind: warmup, work, amrap, drop). */

import { movementById, movementSystems, isCardio } from "./movements.js";
import { num, fmtDuration, newId, sessionTitle as baseTitle } from "./model.js";

export const BLOCK_TYPES = {
  sets: { label: "Sets", hint: "klassiek kracht: sets × herhalingen × kg, ook supersets", pillar: "kracht" },
  complex: { label: "Complex", hint: "meerdere halteroefeningen achter elkaar als één set", pillar: "kracht" },
  rondes: { label: "Rondes", hint: "een aantal rondes, ook reeksen zoals 21-15-9", pillar: "conditie" },
  amrap: { label: "AMRAP", hint: "zoveel mogelijk rondes binnen de tijd", pillar: "conditie" },
  emom: { label: "EMOM / every X min", hint: "elke minuut, of elke 2, 3, 4 of 5 min", pillar: "conditie" },
  fortime: { label: "For Time", hint: "één keer door zo snel mogelijk, ook chipper", pillar: "conditie" },
  tabata: { label: "Tabata / werk-rust", hint: "vaste werk- en rusttijd, bijv. 8 × 20/10 of 40/20", pillar: "conditie" },
  deathby: { label: "Death by", hint: "elke minuut één herhaling meer, tot het niet meer lukt", pillar: "conditie" },
  interval: { label: "Intervallen", hint: "herhalingen met rust, bijv. 6 × 500 m roeien", pillar: "duur" },
  doorlopend: { label: "Doorlopend", hint: "één stuk, bijv. 20 min roeien of 5 km lopen", pillar: "duur" },
  test: { label: "Test / max", hint: "1RM, max herhalingen, max cal in 1 min, 2 km-tijdrit", pillar: "conditie" },
  vrij: { label: "Vrij", hint: "omschrijving in eigen woorden", pillar: null },
};

export const ROLES = {
  warmup: { label: "Warming-up" },
  techniek: { label: "Techniek" },
  kracht: { label: "Kracht" },
  metcon: { label: "Metcon" },
  afsluiter: { label: "Afsluiter" },
  cooldown: { label: "Cooling-down" },
};

export const SCALING = { rx: { label: "Rx" }, scaled: { label: "Geschaald" }, eigen: { label: "Eigen versie" } };

export const SET_KINDS = { work: "Werkset", warmup: "Warming-up", amrap: "AMRAP-set", drop: "Dropset" };

export const TEST_METRICS = {
  time: { label: "Snelste tijd", hint: "voor een vaste afstand of aantal, bijv. 2 km roeien" },
  kg: { label: "Zwaarste gewicht", hint: "voor een aantal herhalingen, bijv. 1RM of 3RM" },
  reps: { label: "Meeste herhalingen", hint: "bijv. max pull-ups, eventueel binnen een tijd" },
  distance: { label: "Meeste meters", hint: "binnen een tijd, bijv. 1 min SkiErg" },
  cal: { label: "Meeste calorieën", hint: "binnen een tijd, bijv. 1 min air bike" },
};

export const INTERVAL_METRICS = { time: "Tijd", distance: "Meters", cal: "Calorieën", watt: "Watt", reps: "Herhalingen" };

export const newItem = (mv, extra = {}) => {
  const m = typeof mv === "string" ? movementById(mv) : mv;
  return { moveId: m ? m.id : null, name: m ? m.name : extra.name || "", reps: null, distanceM: null, timeSec: null, cal: null, kg: null, heightCm: null, ...extra };
};

export function newBlock(type, extra = {}) {
  const base = { id: newId(), type, items: [], result: {} };
  if (type === "rondes") return { ...base, rounds: 3, ...extra };
  if (type === "amrap") return { ...base, capSec: 12 * 60, ...extra };
  if (type === "emom") return { ...base, durationSec: 12 * 60, everySec: 60, emomMode: "wissel", ...extra };
  if (type === "fortime") return { ...base, capSec: null, ...extra };
  if (type === "tabata") return { ...base, rounds: 8, workSec: 20, restSec: 10, tabataMode: "volgorde", ...extra };
  if (type === "deathby") return { ...base, step: 1, ...extra };
  if (type === "interval") return { ...base, rounds: 6, restSec: 90, ...extra };
  if (type === "test") return { ...base, testMetric: "time", ...extra };
  if (type === "complex") return { ...base, sets: [{ kg: null }], ...extra };
  if (type === "vrij") return { ...base, text: "", ...extra };
  return { ...base, ...extra };
}

/* Oude sessies (fase 1) omzetten: kracht met `exercises`, WOD met tekst. */
export function blocksOf(s) {
  if (Array.isArray(s.blocks) && s.blocks.length) return s.blocks;
  if (s.kind === "kracht" && Array.isArray(s.exercises) && s.exercises.length) {
    return [{ id: s.id + "-b0", type: "sets", items: s.exercises.map((e) => ({ moveId: e.exId ? "nexa:" + e.exId : null, name: e.name, muscle: e.muscle, sets: e.sets || [] })), result: {} }];
  }
  if (s.kind === "wod" && (s.movements || s.score || s.format)) {
    const type = s.format === "emom" ? "emom" : s.format === "amrap" ? "amrap" : s.format === "interval" ? "interval" : "fortime";
    return [{ id: s.id + "-b0", type, capSec: s.capSec || null, durationSec: type === "emom" ? s.capSec || null : undefined, items: [], text: s.movements || "", result: { text: s.score || "" } }];
  }
  return [];
}

const hasScheme = (b) => Array.isArray(b.repScheme) && b.repScheme.length > 0;
/* Herhalingen van een item in ronde r (reeks gaat voor; per kant telt dubbel). */
const repsIn = (b, it, r) => (hasScheme(b) ? num(b.repScheme[r], 0) : num(it.reps, 0)) * (it.perSide ? 2 : 1);
const isEasy = (b) => b.role === "warmup" || b.role === "cooldown";

/* Tabata: totaal aantal werkintervallen. */
export function tabataSlots(b) {
  const n = (b.items || []).length || 1;
  return b.tabataMode === "wissel" ? num(b.rounds, 8) : num(b.rounds, 8) * n;
}

/* Hoe vaak elk item is uitgevoerd. */
export function itemCounts(b) {
  const items = b.items || [];
  const n = items.length;
  if (!n) return [];
  if (b.type === "emom") {
    const every = num(b.everySec, 60) || 60;
    const slots = Math.floor(num(b.durationSec, 0) / every);
    if (b.emomMode === "alles") return items.map(() => slots);
    return items.map((_, i) => Math.floor(slots / n) + (i < slots % n ? 1 : 0));
  }
  if (b.type === "amrap") return items.map(() => num(b.result && b.result.rounds, 0));
  if (b.type === "rondes") return items.map(() => (hasScheme(b) ? b.repScheme.length : num(b.rounds, 1)));
  if (b.type === "interval") return items.map(() => (hasScheme(b) ? b.repScheme.length : num(b.rounds, 1)));
  if (b.type === "fortime") return items.map(() => (hasScheme(b) ? b.repScheme.length : Math.max(1, num(b.rounds, 1))));
  if (b.type === "tabata") {
    const slots = tabataSlots(b);
    if (b.tabataMode === "wissel") return items.map((_, i) => Math.floor(slots / n) + (i < slots % n ? 1 : 0));
    return items.map(() => num(b.rounds, 8));
  }
  if (b.type === "complex") return items.map(() => (b.sets || []).filter((x) => x && x.kg != null).length || (b.sets || []).length);
  return items.map(() => 1);
}

/* Werktijd van een item volgens de beweging (per herhaling, meter of cal). */
function workOf(mv, reps, dist, cal, time) {
  if (mv && mv.work) return reps * (mv.work.reps || 0) + dist * (mv.work.distance || 0) + cal * (mv.work.cal || 0) + time * (mv.work.time || 1);
  return reps * 2.5 + time + dist * 0.5 + cal * 4;
}

/* Volume van een blok: herhalingen, meters per beweging en per sport,
   calorieën, tonnage (kg × herhalingen) en geschatte werktijd. Bij een
   partner- of teamworkout wordt het werk gedeeld. */
export function blockVolume(b) {
  const out = { reps: 0, cal: 0, tonnage: 0, workSec: 0, distance: {}, sport: {}, byMove: [] };
  const items = b.items || [];
  const share = 1 / Math.max(1, num(b.partners, 1));
  const add = (it, mv, reps, dist, cal, w, kgEach) => {
    reps *= share;
    dist *= share;
    cal *= share;
    w *= share;
    out.reps += reps;
    out.cal += cal;
    out.tonnage += (kgEach || 0) * reps;
    if (dist) {
      const key = it.moveId || it.name;
      out.distance[key] = (out.distance[key] || 0) + dist;
      if (mv && mv.sport) out.sport[mv.sport] = (out.sport[mv.sport] || 0) + dist;
    }
    out.workSec += w;
    out.byMove.push({ it, work: w });
  };

  if (b.type === "sets") {
    for (const it of items) {
      const sets = (it.sets || []).filter((x) => x && (x.reps || x.kg));
      const per = it.perSide ? 2 : 1;
      const reps = sets.reduce((a, x) => a + num(x.reps, 0) * per, 0);
      const ton = sets.reduce((a, x) => a + num(x.kg, 0) * num(x.reps, 0) * per, 0);
      out.reps += reps;
      out.tonnage += ton;
      const w = sets.length * 40; // ~40 s werk per set
      out.workSec += w;
      out.byMove.push({ it, work: w });
    }
    return out;
  }

  if (b.type === "complex") {
    const sets = (b.sets || []).filter((x) => x && x.kg != null);
    for (const it of items) {
      const mv = movementById(it.moveId);
      const per = num(it.reps, 1) * (it.perSide ? 2 : 1);
      const reps = per * sets.length;
      const ton = sets.reduce((a, x) => a + num(x.kg, 0) * per, 0);
      out.reps += reps;
      out.tonnage += ton;
      const w = workOf(mv, reps, 0, 0, 0);
      out.workSec += w;
      out.byMove.push({ it, work: w });
    }
    return out;
  }

  if (b.type === "deathby") {
    const r = b.result || {};
    const mins = num(r.rounds, 0);
    const step = num(b.step, 1) || 1;
    items.forEach((it) => {
      const mv = movementById(it.moveId);
      const base = (step * mins * (mins + 1)) / 2 + num(r.reps, 0);
      const reps = base * (it.perSide ? 2 : 1);
      add(it, mv, reps, 0, 0, workOf(mv, reps, 0, 0, 0), num(it.kg, 0) * (mv && mv.perHand ? 2 : 1));
    });
    return out;
  }

  if (b.type === "test") {
    const it = items[0];
    if (!it) return out;
    const mv = movementById(it.moveId);
    const r = b.result || {};
    const v = num(r.value);
    const m = b.testMetric || "time";
    const reps = m === "reps" ? v || 0 : m === "kg" ? num(it.reps, 1) : num(it.reps, 0);
    const dist = m === "distance" ? v || 0 : num(it.distanceM, 0);
    const cal = m === "cal" ? v || 0 : num(it.cal, 0);
    const time = m === "time" ? v || 0 : num(b.capSec, 0);
    const kg = m === "kg" ? v || 0 : num(it.kg, 0);
    const w = m === "time" && v ? v : time || workOf(mv, reps, dist, cal, 0);
    add(it, mv, reps, dist, cal, w, kg * (mv && mv.perHand ? 2 : 1));
    return out;
  }

  if (b.type === "tabata") {
    // werktijd ligt vast; herhalingen uit het resultaat (totaal) als dat er is
    const counts = itemCounts(b);
    const totalReps = num(b.result && b.result.reps, 0);
    const slots = tabataSlots(b) || 1;
    items.forEach((it, i) => {
      const mv = movementById(it.moveId);
      const k = counts[i] || 0;
      const w = k * num(b.workSec, 20);
      const reps = totalReps ? (totalReps * k) / slots : 0;
      add(it, mv, reps, num(it.distanceM, 0) * k, num(it.cal, 0) * k, w, num(it.kg, 0) * (mv && mv.perHand ? 2 : 1));
    });
    return out;
  }

  const counts = itemCounts(b);
  let left = b.type === "amrap" ? num(b.result && b.result.reps, 0) : 0;
  items.forEach((it, i) => {
    const mv = movementById(it.moveId);
    const k = counts[i] || 0;
    let reps = 0;
    for (let r = 0; r < k; r++) reps += repsIn(b, it, r);
    // AMRAP: losse herhalingen in de onvolledige ronde, in volgorde
    if (left > 0) {
      const per = repsIn(b, it, 0) || 0;
      const take = per ? Math.min(per, left) : 0;
      reps += take;
      left -= take;
    }
    let dist = num(it.distanceM, 0) * k;
    const cal = num(it.cal, 0) * k;
    let time = num(it.timeSec, 0) * k;
    // intervallen met een reeks: afstand of tijd per herhaling (bijv. 250-500-750 m)
    if (b.type === "interval" && hasScheme(b) && i === 0) {
      const sum = b.repScheme.reduce((a, x) => a + num(x, 0), 0);
      reps = 0;
      if (intervalUnit(b) === "time") time = sum;
      else dist = sum;
    }
    add(it, mv, reps, dist, cal, workOf(mv, reps, dist, cal, time), num(it.kg, 0) * (mv && mv.perHand ? 2 : 1));
  });
  // For Time met cap niet gehaald: resterende herhalingen eraf
  if (b.type === "fortime" && b.result && b.result.capped && num(b.result.repsLeft)) out.reps = Math.max(0, out.reps - num(b.result.repsLeft) * share);
  return out;
}

/* Eenheid van een intervalreeks: tijd als het eerste item op tijd staat. */
export const intervalUnit = (b) => {
  const it = (b.items || [])[0];
  return it && (it.metric === "time" || (num(it.timeSec) && !num(it.distanceM))) ? "time" : "distance";
};

/* Waarden per herhaling van een intervalblok, met de maat erbij. */
export function intervalValues(b) {
  const r = b.result || {};
  if (Array.isArray(r.values) && r.metric) return { metric: r.metric, values: r.values.filter((x) => x > 0) };
  if (Array.isArray(r.distances) && r.distances.some((x) => x > 0)) return { metric: "distance", values: r.distances.filter((x) => x > 0) };
  return { metric: "time", values: (r.splits || []).filter((x) => x > 0) };
}

/* Geschatte duur van een blok in seconden. Een gemeten resultaat gaat voor. */
export function blockDuration(b) {
  const r = b.result || {};
  const restRounds = (n) => num(b.restSec, 0) * Math.max(0, n - 1);
  if (b.type === "amrap") return num(b.capSec, 0) || null;
  if (b.type === "emom") return num(b.durationSec, 0) || null;
  if (b.type === "tabata") return tabataSlots(b) * (num(b.workSec, 20) + num(b.restSec, 10)) || null;
  if (b.type === "deathby") return num(r.rounds) != null ? (num(r.rounds, 0) + 1) * 60 : null;
  if (b.type === "rondes" && num(r.timeSec)) return num(r.timeSec);
  if (b.type === "fortime" && num(r.timeSec)) return num(r.timeSec);
  if (b.type === "fortime" && r.capped && num(b.capSec)) return num(b.capSec);
  if (b.type === "interval") {
    const n = num(b.rounds, 1);
    const iv = intervalValues(b);
    const work = iv.metric === "time" && iv.values.length ? (iv.values.reduce((a, x) => a + x, 0) / iv.values.length) * n : blockVolume(b).workSec * Math.max(1, num(b.partners, 1));
    return Math.round(work + restRounds(n)) || null;
  }
  if (b.type === "doorlopend" && num(r.timeSec)) return num(r.timeSec);
  if (b.type === "test") {
    if (b.testMetric === "time" && num(r.value)) return num(r.value);
    if (num(b.capSec)) return num(b.capSec);
    if (b.testMetric === "kg") return 15 * 60; // opbouw naar een zware single
  }
  if (b.type === "fortime" && num(b.capSec)) return Math.min(num(b.capSec), Math.round(blockVolume(b).workSec * Math.max(1, num(b.partners, 1)) * 1.3)) || null;
  if (b.type === "sets") {
    const sets = (b.items || []).reduce((a, it) => a + (it.sets || []).filter((x) => x && (x.reps || x.kg)).length, 0);
    const rest = (b.items || []).find((it) => num(it.restSec)) ? num((b.items || []).find((it) => num(it.restSec)).restSec) : 110;
    return Math.round(sets * (b.superset ? (40 + rest) / 1.6 : 40 + rest)) || null;
  }
  if (b.type === "complex") return (b.sets || []).length * 150 || null;
  const w = blockVolume(b).workSec * Math.max(1, num(b.partners, 1));
  const rounds = b.type === "rondes" ? num(b.rounds, 1) : 1;
  return w ? Math.round(w * (b.type === "doorlopend" ? 1 : 1.25) + restRounds(rounds)) : null;
}

/* Pijler van een blok: sets en complex = kracht; intervallen, doorlopend en
   tests met alleen cardio = duur; alleen mobiliteit = mobiliteit; anders
   conditie. Een test van kracht (1RM) telt als kracht. */
export function blockPillar(b, fallback = "conditie") {
  const t = BLOCK_TYPES[b.type];
  if (!t) return fallback;
  const items = b.items || [];
  const mvs = items.map((it) => movementById(it.moveId));
  if (items.length && mvs.every((m) => m && m.cat === "mobiliteit")) return "mobiliteit";
  if (b.type === "test") {
    if (b.testMetric === "kg") return "kracht";
    return items.length && mvs.every(isCardio) ? "duur" : "conditie";
  }
  if (b.type === "interval" || b.type === "doorlopend") return items.length && mvs.every(isCardio) ? "duur" : "conditie";
  return t.pillar || fallback;
}

/* Systeemverdeling over blokken, gewogen naar geschatte werktijd. */
const LEGS = ["quadriceps", "hamstrings", "bilspieren", "kuiten"];
export function blocksSystems(blocks) {
  let w = 0,
    legs = 0,
    upper = 0;
  for (const b of blocks) {
    for (const { it, work } of blockVolume(b).byMove) {
      const mv = movementById(it.moveId) || (it.muscle ? { cat: "gewicht", legs: LEGS.includes(it.muscle) ? 0.85 : 0.05, upper: LEGS.includes(it.muscle) ? 0.05 : 0.85 } : null);
      const s = movementSystems(mv);
      const ww = (work || 1) * (isEasy(b) ? 0.3 : 1);
      w += ww;
      legs += s.legs * ww;
      upper += s.upper * ww;
    }
  }
  if (!w) return null;
  return { legs: legs / w, upper: upper / w, central: Math.max(0, 1 - legs / w - upper / w) };
}

/* Aandeel per pijler binnen een sessie, gewogen naar blokduur. Warming-up
   en cooling-down tellen niet mee in de verdeling. */
export function pillarShares(blocks, fallback) {
  const acc = {};
  let tot = 0;
  for (const b of blocks) {
    if (isEasy(b)) continue;
    const d = blockDuration(b) || 60;
    const p = blockPillar(b, fallback);
    acc[p] = (acc[p] || 0) + d;
    tot += d;
  }
  if (!tot) return { [fallback]: 1 };
  for (const k of Object.keys(acc)) acc[k] /= tot;
  return acc;
}

/* Totalen over alle blokken. */
export function sessionVolume(blocks) {
  const out = { reps: 0, cal: 0, tonnage: 0, sport: {} };
  for (const b of blocks) {
    const v = blockVolume(b);
    out.reps += v.reps;
    out.cal += v.cal;
    out.tonnage += v.tonnage;
    for (const [k, d] of Object.entries(v.sport)) out.sport[k] = (out.sport[k] || 0) + d;
  }
  return out;
}

/* ---------------- weergave ---------------- */

/* Titel van een sessie, met de blokken erbij (bijv. "WOD · Fran"). */
export function titleOf(s) {
  if (s.kind === "duur") return baseTitle(s);
  if (s.title) return s.title;
  const bl = blocksOf(s).filter((b) => !isEasy(b));
  if (s.kind === "wod" && bl.length) {
    const named = bl.find((b) => b.name);
    if (named) return `WOD · ${named.name}`;
    const t = bl.find((b) => b.type !== "sets" && b.type !== "vrij") || bl[0];
    return `WOD · ${BLOCK_TYPES[t.type].label.split(" /")[0]}`;
  }
  if (s.kind === "kracht" && bl.some((b) => b.type !== "sets" && b.type !== "complex" && !(b.type === "test" && b.testMetric === "kg"))) return "Kracht + conditie";
  return baseTitle(s);
}

const nl = (x) => String(x).replace(".", ",");
const fmtDist = (m) => (m >= 1000 && m % 100 === 0 ? `${nl(m / 1000)} km` : `${m} m`);
const shortName = (it, mv) => (it.name || (mv && mv.name) || "Beweging").replace(/ \(.*\)$/, "");

export function itemLine(it, b) {
  const mv = movementById(it.moveId);
  const name = shortName(it, mv);
  const parts = [];
  if (!(b && hasScheme(b)) && num(it.reps)) parts.push(`${num(it.reps)}`);
  if (num(it.distanceM)) parts.push(fmtDist(num(it.distanceM)));
  if (num(it.cal)) parts.push(`${num(it.cal)} cal`);
  if (num(it.timeSec)) parts.push(fmtDuration(num(it.timeSec)));
  const head = parts.length ? `${parts.join(" ")} ${name.toLowerCase()}` : name;
  const extra = [];
  if (it.perSide) extra.push("per kant");
  if (num(it.kg)) extra.push(`${nl(num(it.kg))} kg${mv && mv.perHand ? " p.h." : ""}`);
  if (num(it.pct)) extra.push(`${num(it.pct)}% 1RM`);
  if (num(it.heightCm)) extra.push(`${num(it.heightCm)} cm`);
  if (it.tempo) extra.push(`tempo ${it.tempo}`);
  return extra.length ? `${head} (${extra.join(", ")})` : head;
}

const everyLabel = (sec) => (sec === 60 ? "EMOM" : sec % 60 === 0 ? `E${sec / 60}MOM` : `elke ${fmtDuration(sec)}`);

export function blockHeader(b, { withName = true } = {}) {
  const scheme = hasScheme(b) ? b.repScheme.join("-") : null;
  const name = b.name && withName ? `${b.name}: ` : "";
  const items = (b.items || []).map((it) => itemLine(it, b)).join(" + ");
  switch (b.type) {
    case "sets":
      return `${name}${b.superset ? "Superset" : "Kracht"}`;
    case "complex":
      return `${name}Complex: ${(b.items || []).map((it) => `${num(it.reps, 1)} ${shortName(it, movementById(it.moveId)).toLowerCase()}`).join(" + ") || "—"}`;
    case "rondes":
      return `${name}${scheme || `${num(b.rounds, 1)} rondes`}${num(b.restSec) ? `, ${fmtDuration(num(b.restSec))} rust` : ""}`;
    case "amrap":
      return `${name}AMRAP ${Math.round(num(b.capSec, 0) / 60)} min`;
    case "emom": {
      const every = num(b.everySec, 60) || 60;
      const slots = Math.floor(num(b.durationSec, 0) / every);
      return every === 60 || every % 60 !== 0 ? `${name}${everyLabel(every)} ${Math.round(num(b.durationSec, 0) / 60)} min` : `${name}${everyLabel(every)} ${Math.round(num(b.durationSec, 0) / 60)} min (${slots} rondes)`;
    }
    case "fortime":
      return `${name}For Time${scheme ? ` ${scheme}` : num(b.rounds, 1) > 1 ? `, ${num(b.rounds)} rondes` : ""}${num(b.capSec) ? ` (cap ${Math.round(num(b.capSec) / 60)} min)` : ""}`;
    case "tabata": {
      const isClassic = num(b.workSec) === 20 && num(b.restSec) === 10 && num(b.rounds) === 8;
      const list = (b.items || []).map((it) => itemLine(it, b)).map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(" + ");
      return `${name}${isClassic ? "Tabata" : `${num(b.rounds, 8)} × ${num(b.workSec, 20)}/${num(b.restSec, 10)} s`}${list ? `: ${list}` : ""}`;
    }
    case "deathby":
      return `${name}Death by ${(b.items || []).map((it) => shortName(it, movementById(it.moveId)).toLowerCase()).join(" + ") || "…"}${num(b.step, 1) > 1 ? ` (+${num(b.step)} per min)` : ""}`;
    case "interval": {
      const rest = num(b.restSec) ? `, ${fmtDuration(num(b.restSec))} rust` : "";
      if (hasScheme(b)) {
        const it = (b.items || [])[0];
        const nm = it ? shortName(it, movementById(it.moveId)).toLowerCase() : "";
        const seq = intervalUnit(b) === "time" ? b.repScheme.map((x) => fmtDuration(num(x, 0))).join("-") : `${b.repScheme.join("-")} m`;
        return `${name}${seq} ${nm}${rest}`;
      }
      return `${name}${num(b.rounds, 1)} × ${items || "interval"}${rest}`;
    }
    case "doorlopend":
      return `${name}${items || "Doorlopend"}`;
    case "test": {
      const it = (b.items || [])[0];
      const mvName = it ? shortName(it, movementById(it.moveId)).toLowerCase() : "…";
      const m = b.testMetric || "time";
      if (m === "kg") return `${name}${it && num(it.reps, 1) > 1 ? `${num(it.reps)}RM` : "1RM"} ${mvName}`;
      if (m === "time") return `${name}Tijdrit ${it ? itemLine(it, b).toLowerCase() : mvName}`;
      const cap = num(b.capSec) ? ` in ${fmtDuration(num(b.capSec))}` : "";
      return `${name}Max ${m === "reps" ? "herhalingen" : m === "cal" ? "calorieën" : "meters"} ${mvName}${cap}`;
    }
    default:
      return b.name || "Vrij";
  }
}

const unitOf = (metric, v) =>
  metric === "time" ? fmtDuration(v) : metric === "distance" ? `${Math.round(v)} m` : metric === "cal" ? `${Math.round(v)} cal` : metric === "watt" ? `${Math.round(v)} W` : metric === "kg" ? `${nl(v)} kg` : `${Math.round(v)}`;

export function blockResult(b) {
  const r = b.result || {};
  if (r.text) return r.text;
  const tag = b.scaling && b.scaling !== "rx" ? ` (${SCALING[b.scaling].label.toLowerCase()})` : b.scaling === "rx" ? " Rx" : "";
  if (b.type === "amrap") return num(r.rounds) != null ? `${num(r.rounds)}${num(r.reps) ? ` + ${num(r.reps)}` : ""} rondes${tag}` : null;
  if (b.type === "emom") {
    const slots = Math.floor(num(b.durationSec, 0) / (num(b.everySec, 60) || 60));
    return num(r.completed) != null ? `${num(r.completed)} van ${slots} gehaald` : null;
  }
  if (b.type === "fortime" || b.type === "rondes") {
    if (r.capped) return `cap${num(r.repsLeft) ? `, ${num(r.repsLeft)} herh. over` : ""}${tag}`;
    return num(r.timeSec) ? `${fmtDuration(num(r.timeSec))}${tag}` : null;
  }
  if (b.type === "tabata") {
    const bits = [];
    if (num(r.reps)) bits.push(`${num(r.reps)} herh. totaal`);
    if (num(r.low) != null && r.low !== "" && r.low != null) bits.push(`laagste ronde ${num(r.low)}`);
    return bits.length ? bits.join(" · ") : null;
  }
  if (b.type === "deathby") return num(r.rounds) != null ? `${num(r.rounds)} min${num(r.reps) ? ` + ${num(r.reps)}` : ""}` : null;
  if (b.type === "interval") {
    const { metric, values } = intervalValues(b);
    if (!values.length) return null;
    const avg = values.reduce((a, x) => a + x, 0) / values.length;
    const best = metric === "time" ? Math.min(...values) : Math.max(...values);
    return `gem. ${unitOf(metric, avg)} · ${metric === "time" ? "snelste" : "beste"} ${unitOf(metric, best)}`;
  }
  if (b.type === "doorlopend") {
    if (num(r.timeSec)) return fmtDuration(num(r.timeSec));
    if (num(r.distanceM)) return `${Math.round(num(r.distanceM))} m`;
    return null;
  }
  if (b.type === "test") return num(r.value) ? unitOf(b.testMetric || "time", num(r.value)) : null;
  if (num(r.timeSec)) return fmtDuration(num(r.timeSec));
  return null;
}

/* Score om te vergelijken (hoger is beter). Niet binnen de cap is altijd
   slechter dan wel binnen de cap. */
export function blockScore(b) {
  const r = b.result || {};
  if (b.type === "amrap") {
    const per = (b.items || []).reduce((a, it) => a + (num(it.reps, 0) || (num(it.distanceM, 0) ? 1 : 0) || (num(it.cal, 0) ? 1 : 0)), 0) || 1;
    return num(r.rounds) != null ? num(r.rounds) + num(r.reps, 0) / per : null;
  }
  if ((b.type === "fortime" || b.type === "rondes") && r.capped) return -1e6 - num(r.repsLeft, 0);
  if ((b.type === "fortime" || b.type === "rondes" || b.type === "doorlopend") && num(r.timeSec)) return -num(r.timeSec);
  if (b.type === "emom" && num(r.completed) != null) return num(r.completed);
  if (b.type === "deathby" && num(r.rounds) != null) return num(r.rounds) + num(r.reps, 0) / 100;
  if (b.type === "tabata" && num(r.reps)) return num(r.reps);
  if (b.type === "test" && num(r.value)) return b.testMetric === "time" ? -num(r.value) : num(r.value);
  return null;
}

/* Sleutel voor benchmarks: naam plus schaling (Rx en geschaald apart). */
export const benchmarkKey = (b) => `${String(b.name || "").trim().toLowerCase()}|${b.scaling || "rx"}${num(b.vestKg) ? "|vest" : ""}`;

/* Kopie van een blok zonder resultaat, om opnieuw te doen. */
export function freshBlock(b) {
  const copy = JSON.parse(JSON.stringify(b));
  copy.id = newId();
  copy.result = {};
  if (copy.type === "sets") copy.items = (copy.items || []).map((it) => ({ ...it, sets: (it.sets || []).map((x) => ({ ...x, rir: null })) }));
  return copy;
}

/* ---------------- bekende workouts en testen ----------------
   Gewichten als man/vrouw zoals gangbaar voorgeschreven; vooraf ingevuld
   met de eerste waarde en altijd aan te passen. */
const I = (moveId, extra) => newItem(moveId, extra);
const HYROX = [
  ["ski", { distanceM: 1000 }],
  ["sled_push", { distanceM: 50 }],
  ["sled_pull", { distanceM: 50 }],
  ["burpee_bj", { distanceM: 80 }],
  ["row", { distanceM: 1000 }],
  ["farmers", { distanceM: 200 }],
  ["sandbag_lunges", { distanceM: 100 }],
  ["wall_balls", { reps: 100 }],
];
const hyroxItems = (n) => HYROX.slice(0, n).flatMap(([id, x]) => [I("run", { distanceM: 1000 }), I(id, x)]);

export const TEMPLATE_CATS = ["Benchmark", "Hyrox", "Conditie", "Duur", "Kracht", "Test", "Mobiliteit"];

export const TEMPLATES = [
  // benchmarks
  { id: "cindy", cat: "Benchmark", label: "Cindy", sub: "AMRAP 20: 5 pull-ups, 10 push-ups, 15 air squats", make: () => newBlock("amrap", { name: "Cindy", capSec: 1200, items: [I("pull_ups", { reps: 5 }), I("push_ups", { reps: 10 }), I("air_squats", { reps: 15 })] }) },
  { id: "fran", cat: "Benchmark", label: "Fran", sub: "21-15-9 thrusters (43/30 kg) en pull-ups", make: () => newBlock("fortime", { name: "Fran", repScheme: [21, 15, 9], items: [I("thrusters", { kg: 43 }), I("pull_ups")] }) },
  { id: "helen", cat: "Benchmark", label: "Helen", sub: "3 rondes: 400 m lopen, 21 KB swings (24/16 kg), 12 pull-ups", make: () => newBlock("rondes", { name: "Helen", rounds: 3, items: [I("run", { distanceM: 400 }), I("kb_swings", { reps: 21, kg: 24 }), I("pull_ups", { reps: 12 })] }) },
  { id: "grace", cat: "Benchmark", label: "Grace", sub: "30 clean and jerks (61/43 kg) for time", make: () => newBlock("fortime", { name: "Grace", items: [I("clean_jerk", { reps: 30, kg: 61 })] }) },
  { id: "isabel", cat: "Benchmark", label: "Isabel", sub: "30 snatches (61/43 kg) for time", make: () => newBlock("fortime", { name: "Isabel", items: [I("snatch", { reps: 30, kg: 61 })] }) },
  { id: "karen", cat: "Benchmark", label: "Karen", sub: "150 wall balls (9/6 kg) for time", make: () => newBlock("fortime", { name: "Karen", items: [I("wall_balls", { reps: 150, kg: 9 })] }) },
  { id: "diane", cat: "Benchmark", label: "Diane", sub: "21-15-9 deadlifts (102/70 kg) en handstand push-ups", make: () => newBlock("fortime", { name: "Diane", repScheme: [21, 15, 9], items: [I("deadlift", { kg: 102 }), I("hspu")] }) },
  { id: "annie", cat: "Benchmark", label: "Annie", sub: "50-40-30-20-10 double unders en sit-ups", make: () => newBlock("fortime", { name: "Annie", repScheme: [50, 40, 30, 20, 10], items: [I("double_unders"), I("sit_ups")] }) },
  { id: "jackie", cat: "Benchmark", label: "Jackie", sub: "1000 m roeien, 50 thrusters (20 kg), 30 pull-ups", make: () => newBlock("fortime", { name: "Jackie", items: [I("row", { distanceM: 1000 }), I("thrusters", { reps: 50, kg: 20 }), I("pull_ups", { reps: 30 })] }) },
  { id: "dt", cat: "Benchmark", label: "DT", sub: "5 rondes: 12 deadlifts, 9 hang power cleans, 6 push jerks (70/47,5 kg)", make: () => newBlock("rondes", { name: "DT", rounds: 5, items: [I("deadlift", { reps: 12, kg: 70 }), I("hang_power_clean", { reps: 9, kg: 70 }), I("push_jerk", { reps: 6, kg: 70 })] }) },
  { id: "nancy", cat: "Benchmark", label: "Nancy", sub: "5 rondes: 400 m lopen, 15 overhead squats (43/30 kg)", make: () => newBlock("rondes", { name: "Nancy", rounds: 5, items: [I("run", { distanceM: 400 }), I("ohs", { reps: 15, kg: 43 })] }) },
  { id: "kelly", cat: "Benchmark", label: "Kelly", sub: "5 rondes: 400 m lopen, 30 box jumps (61/51 cm), 30 wall balls (9/6 kg)", make: () => newBlock("rondes", { name: "Kelly", rounds: 5, items: [I("run", { distanceM: 400 }), I("box_jumps", { reps: 30, heightCm: 61 }), I("wall_balls", { reps: 30, kg: 9 })] }) },
  { id: "barbara", cat: "Benchmark", label: "Barbara", sub: "5 rondes: 20 pull-ups, 30 push-ups, 40 sit-ups, 50 squats, 3 min rust", make: () => newBlock("rondes", { name: "Barbara", rounds: 5, restSec: 180, items: [I("pull_ups", { reps: 20 }), I("push_ups", { reps: 30 }), I("sit_ups", { reps: 40 }), I("air_squats", { reps: 50 })] }) },
  { id: "chelsea", cat: "Benchmark", label: "Chelsea", sub: "EMOM 30: 5 pull-ups, 10 push-ups, 15 air squats", make: () => newBlock("emom", { name: "Chelsea", durationSec: 1800, everySec: 60, emomMode: "alles", items: [I("pull_ups", { reps: 5 }), I("push_ups", { reps: 10 }), I("air_squats", { reps: 15 })] }) },
  { id: "murph", cat: "Benchmark", label: "Murph", sub: "1 mijl lopen, 100 pull-ups, 200 push-ups, 300 squats, 1 mijl lopen (vest 9/6 kg)", make: () => newBlock("fortime", { name: "Murph", items: [I("run", { distanceM: 1609 }), I("pull_ups", { reps: 100 }), I("push_ups", { reps: 200 }), I("air_squats", { reps: 300 }), I("run", { distanceM: 1609 })] }) },
  {
    id: "filthy50",
    cat: "Benchmark",
    label: "Filthy Fifty",
    sub: "chipper: 50 × tien bewegingen",
    make: () =>
      newBlock("fortime", {
        name: "Filthy Fifty",
        items: [I("box_jumps", { reps: 50, heightCm: 61 }), I("pull_ups", { reps: 50 }), I("kb_swings", { reps: 50, kg: 16 }), I("walking_lunges", { reps: 50 }), I("k2e", { reps: 50 }), I("push_press", { reps: 50, kg: 20 }), I("back_ext", { reps: 50 }), I("wall_balls", { reps: 50, kg: 9 }), I("burpees", { reps: 50 }), I("double_unders", { reps: 50 })],
      }),
  },

  // Hyrox
  { id: "hyrox_full", cat: "Hyrox", label: "Hyrox-simulatie (volledig)", sub: "8 × 1 km lopen met de 8 stations", make: () => newBlock("fortime", { name: "Hyrox-simulatie", items: hyroxItems(8) }) },
  { id: "hyrox_half", cat: "Hyrox", label: "Halve Hyrox-simulatie", sub: "4 × 1 km lopen met de eerste 4 stations", make: () => newBlock("fortime", { name: "Halve Hyrox", items: hyroxItems(4) }) },
  { id: "hyrox_stations", cat: "Hyrox", label: "Hyrox-stations", sub: "4 rondes: 1 km lopen, 50 m sled push, 20 wall balls", make: () => newBlock("rondes", { name: "Hyrox-stations", rounds: 4, items: [I("run", { distanceM: 1000 }), I("sled_push", { distanceM: 50 }), I("wall_balls", { reps: 20 })] }) },
  { id: "compromised", cat: "Hyrox", label: "Compromised running", sub: "4 rondes: 25 wall balls, 1 km lopen op wedstrijdtempo", make: () => newBlock("rondes", { name: "Compromised running", rounds: 4, items: [I("wall_balls", { reps: 25 }), I("run", { distanceM: 1000 })] }) },
  { id: "sled_intervals", cat: "Hyrox", label: "Sled-intervallen", sub: "6 × 25 m sled push + 25 m sled pull, 2 min rust", make: () => newBlock("interval", { rounds: 6, restSec: 120, items: [I("sled_push", { distanceM: 25 }), I("sled_pull", { distanceM: 25 })] }) },

  // conditie
  { id: "emom_engine", cat: "Conditie", label: "EMOM 12: motor", sub: "om de beurt 15 cal roeien, 12 KB swings, 10 burpees", make: () => newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("row", { cal: 15 }), I("kb_swings", { reps: 12, kg: 24 }), I("burpees", { reps: 10 })] }) },
  { id: "tabata_squat", cat: "Conditie", label: "Tabata air squats", sub: "8 × 20 s werk / 10 s rust", make: () => newBlock("tabata", { items: [I("air_squats")] }) },
  { id: "tabata_4", cat: "Conditie", label: "Tabata, vier bewegingen", sub: "per beweging 8 × 20/10: roeien, squats, push-ups, sit-ups", make: () => newBlock("tabata", { tabataMode: "volgorde", items: [I("row", { metric: "cal" }), I("air_squats"), I("push_ups"), I("sit_ups")] }) },
  { id: "4020", cat: "Conditie", label: "40/20 circuit", sub: "3 rondes om de beurt: air bike, wall balls, KB swings, burpees", make: () => newBlock("tabata", { rounds: 12, workSec: 40, restSec: 20, tabataMode: "wissel", items: [I("air_bike", { metric: "cal" }), I("wall_balls"), I("kb_swings"), I("burpees")] }) },
  { id: "deathby_burpees", cat: "Conditie", label: "Death by burpees", sub: "minuut 1: 1, minuut 2: 2, … tot het niet meer lukt", make: () => newBlock("deathby", { items: [I("burpees")] }) },
  { id: "e4m", cat: "Conditie", label: "Every 4 min × 5", sub: "500 m roeien, 15 wall balls, 10 burpees; rest is rust", make: () => newBlock("emom", { everySec: 240, durationSec: 1200, emomMode: "alles", items: [I("row", { distanceM: 500 }), I("wall_balls", { reps: 15 }), I("burpees", { reps: 10 })] }) },
  { id: "ladder", cat: "Conditie", label: "Ladder 10 tot 1", sub: "KB swings en burpees, 10-9-8-…-1", make: () => newBlock("fortime", { name: "Ladder 10-1", repScheme: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], items: [I("kb_swings", { kg: 24 }), I("burpees")] }) },
  { id: "partner", cat: "Conditie", label: "Partner-chipper", sub: "met z'n tweeën verdelen: 100 cal roeien, 100 wall balls, 100 burpees", make: () => newBlock("fortime", { partners: 2, items: [I("row", { cal: 100 }), I("wall_balls", { reps: 100 }), I("burpees", { reps: 100 })] }) },

  // duur
  { id: "row500", cat: "Duur", label: "6 × 500 m roeien", sub: "intervallen met 1:30 rust", make: () => newBlock("interval", { rounds: 6, restSec: 90, items: [I("row", { distanceM: 500 })] }) },
  { id: "norway4x4", cat: "Duur", label: "Noorse 4 × 4", sub: "4 × 4 min op 90–95% van uw max hartslag, 3 min rustig", make: () => newBlock("interval", { name: "Noorse 4×4", rounds: 4, restSec: 180, intensity: "90–95% HRmax", items: [I("run", { timeSec: 240 })] }) },
  { id: "run400", cat: "Duur", label: "10 × 400 m", sub: "baanintervallen met 1 min rust", make: () => newBlock("interval", { rounds: 10, restSec: 60, items: [I("run", { distanceM: 400 })] }) },
  { id: "3030", cat: "Duur", label: "30/30 lopen", sub: "20 × 30 s snel / 30 s rustig", make: () => newBlock("tabata", { rounds: 20, workSec: 30, restSec: 30, items: [I("run")] }) },
  { id: "z2", cat: "Duur", label: "Zone 2", sub: "45 min rustig fietsen, praattempo", make: () => newBlock("doorlopend", { intensity: "zone 2", items: [I("cycle", { timeSec: 2700 })] }) },
  { id: "ski_pyramid", cat: "Duur", label: "SkiErg-piramide", sub: "250-500-750-500-250 m, 1:30 rust", make: () => newBlock("interval", { rounds: 5, restSec: 90, repScheme: [250, 500, 750, 500, 250], items: [I("ski", { metric: "distance" })] }) },
  { id: "brick", cat: "Duur", label: "Brick: fietsen en lopen", sub: "30 min fietsen direct gevolgd door 5 km lopen", make: () => newBlock("doorlopend", { name: "Brick", items: [I("cycle", { timeSec: 1800 }), I("run", { distanceM: 5000 })] }) },

  // kracht
  { id: "5x5", cat: "Kracht", label: "5 × 5 back squat", sub: "vijf werksets van vijf", make: () => newBlock("sets", { items: [{ ...I("back_squat"), sets: Array.from({ length: 5 }, () => ({ kg: null, reps: 5, rir: null })) }] }) },
  { id: "e2m_clean", cat: "Kracht", label: "E2MOM 10: power cleans", sub: "elke 2 min 3 power cleans, 5 rondes", make: () => newBlock("emom", { everySec: 120, durationSec: 600, emomMode: "alles", items: [I("power_clean", { reps: 3 })] }) },
  { id: "complex", cat: "Kracht", label: "Haltercomplex", sub: "1 power clean + 1 front squat + 1 push jerk, 5 sets", make: () => newBlock("complex", { items: [I("power_clean", { reps: 1 }), I("front_squat", { reps: 1 }), I("push_jerk", { reps: 1 })], sets: Array.from({ length: 5 }, () => ({ kg: null })) }) },
  { id: "superset", cat: "Kracht", label: "Superset boven", sub: "bankdrukken en barbell rows afwisselend, 4 sets", make: () => newBlock("sets", { superset: true, items: [{ ...I("bench_press"), sets: Array.from({ length: 4 }, () => ({ kg: null, reps: 8, rir: null })) }, { ...I("bb_row"), sets: Array.from({ length: 4 }, () => ({ kg: null, reps: 8, rir: null })) }] }) },

  // testen
  { id: "t_row2k", cat: "Test", label: "2 km roeitest", sub: "zo snel mogelijk", make: () => newBlock("test", { name: "2 km roeien", testMetric: "time", items: [I("row", { distanceM: 2000 })] }) },
  { id: "t_run5k", cat: "Test", label: "5 km tijdrit", sub: "zo snel mogelijk lopen", make: () => newBlock("test", { name: "5 km", testMetric: "time", items: [I("run", { distanceM: 5000 })] }) },
  { id: "t_ski1k", cat: "Test", label: "1 km SkiErg", sub: "zo snel mogelijk", make: () => newBlock("test", { name: "1 km SkiErg", testMetric: "time", items: [I("ski", { distanceM: 1000 })] }) },
  { id: "t_1rm", cat: "Test", label: "1RM back squat", sub: "opbouwen naar één zware herhaling", make: () => newBlock("test", { testMetric: "kg", items: [I("back_squat", { reps: 1 })] }) },
  { id: "t_cal", cat: "Test", label: "1 min max cal air bike", sub: "zoveel mogelijk calorieën in 1 minuut", make: () => newBlock("test", { testMetric: "cal", capSec: 60, items: [I("air_bike")] }) },
  { id: "t_pullups", cat: "Test", label: "Max pull-ups", sub: "zoveel mogelijk achter elkaar", make: () => newBlock("test", { testMetric: "reps", items: [I("pull_ups")] }) },
  { id: "t_burpees", cat: "Test", label: "Max burpees in 7 min", sub: "zoveel mogelijk binnen de tijd", make: () => newBlock("test", { testMetric: "reps", capSec: 420, items: [I("burpees")] }) },

  // mobiliteit
  { id: "mob_hips", cat: "Mobiliteit", label: "Heupen en enkels", sub: "15 min rustig: flow, heupen, enkels", make: () => newBlock("doorlopend", { role: "cooldown", items: [I("mob_flow", { timeSec: 300 }), I("stretch_hips", { timeSec: 300 }), I("ankle_mob", { timeSec: 300 })] }) },
  { id: "warmup", cat: "Mobiliteit", label: "Algemene warming-up", sub: "2 rondes: 250 m roeien, 10 air squats, 10 push-ups, 5 CARs", make: () => newBlock("rondes", { role: "warmup", rounds: 2, items: [I("row", { distanceM: 250 }), I("air_squats", { reps: 10 }), I("push_ups", { reps: 10 }), I("cars", { reps: 5 })] }) },
];
