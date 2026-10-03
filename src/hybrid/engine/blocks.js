/* Blokken: de bouwstenen van een hybride sessie.

   Een sessie bestaat uit één of meer blokken, bijvoorbeeld eerst zware squats
   in sets en daarna een AMRAP. Elk blok heeft bewegingen (items) met hun
   eigen maten (meters, tijd, calorieën, herhalingen, kg, hoogte) en een
   resultaat dat past bij het type.

   blok = {
     id, type, name?,                    // name: bijv. "Fran" (benchmark)
     rounds?, repScheme?,                // rondes, of een reeks zoals 21-15-9
     capSec?,                            // tijdslimiet (AMRAP-duur, For Time-cap)
     durationSec?, everySec?, emomMode?, // EMOM: totale duur, elke X sec, "wissel" of "alles"
     restSec?,                           // intervallen: rust tussen de herhalingen
     items: [{ moveId, name, reps, distanceM, timeSec, cal, kg, heightCm, sets? }],
     result: { timeSec?, rounds?, reps?, completed?, splits?, text? },
     text?                               // vrij blok
   }
   Bij type "sets" heeft elk item `sets: [{ kg, reps, rir }]` (klassiek kracht). */

import { movementById, movementSystems, isCardio } from "./movements.js";
import { num, fmtDuration, newId, sessionTitle as baseTitle } from "./model.js";

export const BLOCK_TYPES = {
  sets: { label: "Sets", hint: "klassiek kracht: sets × herhalingen × kg", pillar: "kracht" },
  rondes: { label: "Rondes", hint: "een aantal rondes, zo snel mogelijk of op tempo", pillar: "conditie" },
  amrap: { label: "AMRAP", hint: "zoveel mogelijk rondes binnen de tijd", pillar: "conditie" },
  emom: { label: "EMOM", hint: "elke minuut op de minuut", pillar: "conditie" },
  fortime: { label: "For Time", hint: "één keer door, zo snel mogelijk (ook chipper)", pillar: "conditie" },
  interval: { label: "Intervallen", hint: "werk en rust, bijv. 6 × 500 m roeien", pillar: "duur" },
  doorlopend: { label: "Doorlopend", hint: "één stuk, bijv. 20 min roeien of 5 km lopen", pillar: "duur" },
  vrij: { label: "Vrij", hint: "omschrijving in eigen woorden", pillar: null },
};

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
  if (type === "interval") return { ...base, rounds: 6, restSec: 90, ...extra };
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

/* Aantal herhalingen van een item in ronde r (repScheme gaat voor). */
const repsIn = (b, it, r) => (Array.isArray(b.repScheme) && b.repScheme.length ? num(b.repScheme[r], 0) : num(it.reps, 0));

/* Hoe vaak elk item is uitgevoerd. AMRAP: volle rondes plus losse
   herhalingen die in volgorde over de items vallen. */
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
  if (b.type === "rondes" || b.type === "interval") return items.map(() => (Array.isArray(b.repScheme) && b.repScheme.length ? b.repScheme.length : num(b.rounds, 1)));
  if (b.type === "fortime") return items.map(() => (Array.isArray(b.repScheme) && b.repScheme.length ? b.repScheme.length : Math.max(1, num(b.rounds, 1))));
  return items.map(() => 1);
}

/* Volume van een blok: herhalingen, meters per beweging en per sport,
   calorieën, tonnage (kg × herhalingen) en geschatte werktijd. */
export function blockVolume(b) {
  const out = { reps: 0, cal: 0, tonnage: 0, workSec: 0, distance: {}, sport: {}, byMove: [] };
  const items = b.items || [];
  if (b.type === "sets") {
    for (const it of items) {
      const sets = (it.sets || []).filter((x) => x && (x.reps || x.kg));
      const reps = sets.reduce((a, x) => a + num(x.reps, 0), 0);
      const ton = sets.reduce((a, x) => a + num(x.kg, 0) * num(x.reps, 0), 0);
      out.reps += reps;
      out.tonnage += ton;
      const w = sets.length * 40; // ~40 s werk per set
      out.workSec += w;
      out.byMove.push({ it, work: w });
    }
    return out;
  }
  const counts = itemCounts(b);
  const partial = b.type === "amrap" ? num(b.result && b.result.reps, 0) : 0;
  let left = partial;
  items.forEach((it, i) => {
    const mv = movementById(it.moveId);
    const k = counts[i] || 0;
    let reps = 0;
    for (let r = 0; r < k; r++) reps += repsIn(b, it, r);
    // AMRAP: losse herhalingen in de onvolledige ronde
    if (left > 0) {
      const per = repsIn(b, it, 0) || 0;
      const take = per ? Math.min(per, left) : 0;
      reps += take;
      left -= take;
    }
    const dist = num(it.distanceM, 0) * k;
    const cal = num(it.cal, 0) * k;
    const time = num(it.timeSec, 0) * k;
    const kg = num(it.kg, 0) * (mv && mv.perHand ? 2 : 1);
    out.reps += reps;
    out.cal += cal;
    out.tonnage += kg * reps;
    if (dist) {
      const key = it.moveId || it.name;
      out.distance[key] = (out.distance[key] || 0) + dist;
      if (mv && mv.sport) out.sport[mv.sport] = (out.sport[mv.sport] || 0) + dist;
    }
    const w = mv && mv.work ? reps * (mv.work.reps || 0) + dist * (mv.work.distance || 0) + cal * (mv.work.cal || 0) + time * (mv.work.time || 1) : reps * 2.5 + time + dist * 0.5 + cal * 4;
    out.workSec += w;
    out.byMove.push({ it, work: w });
  });
  return out;
}

/* Geschatte duur van een blok in seconden. Een gemeten resultaat gaat voor. */
export function blockDuration(b) {
  const r = b.result || {};
  if (b.type === "amrap") return num(b.capSec, 0) || null;
  if (b.type === "emom") return num(b.durationSec, 0) || null;
  if ((b.type === "fortime" || b.type === "rondes") && num(r.timeSec)) return num(r.timeSec);
  if (b.type === "interval") {
    const n = num(b.rounds, 1);
    const splits = (r.splits || []).filter((x) => x > 0);
    const work = splits.length ? (splits.reduce((a, x) => a + x, 0) / splits.length) * n : blockVolume(b).workSec;
    return Math.round(work + num(b.restSec, 0) * Math.max(0, n - 1)) || null;
  }
  if (b.type === "doorlopend" && num(r.timeSec)) return num(r.timeSec);
  if (b.type === "fortime" && num(b.capSec)) return Math.min(num(b.capSec), Math.round(blockVolume(b).workSec * 1.3)) || null;
  if (b.type === "sets") {
    const sets = (b.items || []).reduce((a, it) => a + (it.sets || []).filter((x) => x && (x.reps || x.kg)).length, 0);
    return sets * 150 || null; // inclusief rust
  }
  const w = blockVolume(b).workSec;
  return w ? Math.round(w * (b.type === "doorlopend" ? 1 : 1.25)) : null;
}

/* Pijler van een blok: sets = kracht; intervallen en doorlopend met alleen
   cardio = duur, anders conditie; metcons = conditie. */
export function blockPillar(b, fallback = "conditie") {
  const t = BLOCK_TYPES[b.type];
  if (!t) return fallback;
  if (b.type === "interval" || b.type === "doorlopend") {
    const items = b.items || [];
    return items.length && items.every((it) => isCardio(movementById(it.moveId))) ? "duur" : "conditie";
  }
  return t.pillar || fallback;
}

/* Systeemverdeling over blokken, gewogen naar geschatte werktijd. */
export function blocksSystems(blocks) {
  let w = 0,
    legs = 0,
    upper = 0;
  for (const b of blocks) {
    for (const { it, work } of blockVolume(b).byMove) {
      const mv = movementById(it.moveId) || (it.muscle ? { cat: "gewicht", legs: ["quadriceps", "hamstrings", "bilspieren", "kuiten"].includes(it.muscle) ? 0.85 : 0.05, upper: ["quadriceps", "hamstrings", "bilspieren", "kuiten"].includes(it.muscle) ? 0.05 : 0.85 } : null);
      const s = movementSystems(mv);
      const ww = work || 1;
      w += ww;
      legs += s.legs * ww;
      upper += s.upper * ww;
    }
  }
  if (!w) return null;
  return { legs: legs / w, upper: upper / w, central: Math.max(0, 1 - legs / w - upper / w) };
}

/* Aandeel per pijler binnen een sessie, gewogen naar blokduur. */
export function pillarShares(blocks, fallback) {
  const acc = {};
  let tot = 0;
  for (const b of blocks) {
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
  const bl = blocksOf(s);
  if (s.kind === "wod" && bl.length) {
    const named = bl.find((b) => b.name);
    if (named) return `WOD · ${named.name}`;
    const t = bl.find((b) => b.type !== "sets" && b.type !== "vrij") || bl[0];
    return `WOD · ${BLOCK_TYPES[t.type].label}`;
  }
  if (s.kind === "kracht" && bl.some((b) => b.type !== "sets")) return "Kracht + conditie";
  return baseTitle(s);
}

const nl = (x) => String(x).replace(".", ",");

export function itemLine(it, b) {
  const mv = movementById(it.moveId);
  const name = (it.name || (mv && mv.name) || "Beweging").replace(/ \(.*\)$/, "");
  const parts = [];
  if (!(b && Array.isArray(b.repScheme) && b.repScheme.length) && num(it.reps)) parts.push(`${num(it.reps)}`);
  if (num(it.distanceM)) parts.push(num(it.distanceM) >= 1000 && num(it.distanceM) % 100 === 0 ? `${nl(num(it.distanceM) / 1000)} km` : `${num(it.distanceM)} m`);
  if (num(it.cal)) parts.push(`${num(it.cal)} cal`);
  if (num(it.timeSec)) parts.push(fmtDuration(num(it.timeSec)));
  const head = parts.length ? `${parts.join(" ")} ${name.toLowerCase()}` : name;
  const extra = [];
  if (num(it.kg)) extra.push(`${nl(num(it.kg))} kg${mv && mv.perHand ? " p.h." : ""}`);
  if (num(it.heightCm)) extra.push(`${num(it.heightCm)} cm`);
  return extra.length ? `${head} (${extra.join(", ")})` : head;
}

export function blockHeader(b, { withName = true } = {}) {
  const scheme = Array.isArray(b.repScheme) && b.repScheme.length ? b.repScheme.join("-") : null;
  const name = b.name && withName ? `${b.name}: ` : "";
  switch (b.type) {
    case "sets":
      return `${name}Kracht`;
    case "rondes":
      return `${name}${scheme || `${num(b.rounds, 1)} rondes`}`;
    case "amrap":
      return `${name}AMRAP ${Math.round(num(b.capSec, 0) / 60)} min`;
    case "emom": {
      const every = num(b.everySec, 60);
      const mins = Math.round(num(b.durationSec, 0) / 60);
      return `${name}${every === 60 ? "EMOM" : `E${every / 60}MOM`} ${mins} min`;
    }
    case "fortime":
      return `${name}For Time${scheme ? ` ${scheme}` : num(b.rounds, 1) > 1 ? `, ${num(b.rounds)} rondes` : ""}${num(b.capSec) ? ` (cap ${Math.round(num(b.capSec) / 60)} min)` : ""}`;
    case "interval":
      return `${name}${num(b.rounds, 1)} × ${(b.items || []).map((it) => itemLine(it, b)).join(" + ") || "interval"}${num(b.restSec) ? `, ${fmtDuration(num(b.restSec))} rust` : ""}`;
    case "doorlopend":
      return `${name}${(b.items || []).map((it) => itemLine(it, b)).join(" + ") || "Doorlopend"}`;
    default:
      return b.name || "Vrij";
  }
}

export function blockResult(b) {
  const r = b.result || {};
  if (r.text) return r.text;
  if (b.type === "amrap") return num(r.rounds) != null ? `${num(r.rounds)}${num(r.reps) ? ` + ${num(r.reps)}` : ""} rondes` : null;
  if (b.type === "emom") return num(r.completed) != null ? `${num(r.completed)} van ${Math.floor(num(b.durationSec, 0) / num(b.everySec, 60))} gehaald` : null;
  if (b.type === "interval") {
    const s = (r.splits || []).filter((x) => x > 0);
    if (!s.length) return null;
    const best = Math.min(...s);
    const avg = s.reduce((a, x) => a + x, 0) / s.length;
    return `gem. ${fmtDuration(avg)} · snelste ${fmtDuration(best)}`;
  }
  if (num(r.timeSec)) return fmtDuration(num(r.timeSec));
  return null;
}

/* Score om te vergelijken (hoger is beter). */
export function blockScore(b) {
  const r = b.result || {};
  if (b.type === "amrap") {
    const per = (b.items || []).reduce((a, it) => a + (num(it.reps, 0) || (num(it.distanceM, 0) ? 1 : 0) || (num(it.cal, 0) ? 1 : 0)), 0) || 1;
    return num(r.rounds) != null ? num(r.rounds) + num(r.reps, 0) / per : null;
  }
  if ((b.type === "fortime" || b.type === "rondes" || b.type === "doorlopend") && num(r.timeSec)) return -num(r.timeSec);
  if (b.type === "emom" && num(r.completed) != null) return num(r.completed);
  return null;
}

/* ---------------- bekende workouts ---------------- */
const I = (moveId, extra) => newItem(moveId, extra);
export const TEMPLATES = [
  { id: "cindy", label: "Cindy", sub: "AMRAP 20: 5 pull-ups, 10 push-ups, 15 air squats", make: () => newBlock("amrap", { name: "Cindy", capSec: 1200, items: [I("pull_ups", { reps: 5 }), I("push_ups", { reps: 10 }), I("air_squats", { reps: 15 })] }) },
  { id: "fran", label: "Fran", sub: "21-15-9 thrusters (43/30 kg) en pull-ups", make: () => newBlock("fortime", { name: "Fran", repScheme: [21, 15, 9], items: [I("thrusters", { kg: 43 }), I("pull_ups")] }) },
  { id: "helen", label: "Helen", sub: "3 rondes: 400 m lopen, 21 KB swings (24/16 kg), 12 pull-ups", make: () => newBlock("rondes", { name: "Helen", rounds: 3, items: [I("run", { distanceM: 400 }), I("kb_swings", { reps: 21, kg: 24 }), I("pull_ups", { reps: 12 })] }) },
  { id: "grace", label: "Grace", sub: "30 clean and jerks (61/43 kg) for time", make: () => newBlock("fortime", { name: "Grace", items: [I("clean_jerk", { reps: 30, kg: 61 })] }) },
  { id: "murph", label: "Murph", sub: "1 mijl lopen, 100 pull-ups, 200 push-ups, 300 squats, 1 mijl lopen", make: () => newBlock("fortime", { name: "Murph", items: [I("run", { distanceM: 1609 }), I("pull_ups", { reps: 100 }), I("push_ups", { reps: 200 }), I("air_squats", { reps: 300 }), I("run", { distanceM: 1609 })] }) },
  { id: "row500", label: "6 × 500 m roeien", sub: "intervallen met 1:30 rust", make: () => newBlock("interval", { rounds: 6, restSec: 90, items: [I("row", { distanceM: 500 })] }) },
  { id: "hyrox_stations", label: "Hyrox-stations", sub: "4 rondes: 1 km lopen, 50 m sled push, 20 wall balls", make: () => newBlock("rondes", { name: "Hyrox-stations", rounds: 4, items: [I("run", { distanceM: 1000 }), I("sled_push", { distanceM: 50 }), I("wall_balls", { reps: 20 })] }) },
  { id: "emom_engine", label: "EMOM 12: motor", sub: "wisselend 15 cal roeien, 12 KB swings, 10 burpees", make: () => newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("row", { cal: 15 }), I("kb_swings", { reps: 12, kg: 24 }), I("burpees", { reps: 10 })] }) },
];
