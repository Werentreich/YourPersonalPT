/* Adaptieve planner van Nexa Hybrid.

   Maakt per week een schema met kracht, duur en conditie, en stuurt bij op
   wat u werkelijk doet en hoe u herstelt. Uitgangspunten:

   - Verdeling over de pijlers naar het doel (hybride, Hyrox, 5/10 km, halve
     of hele marathon, kracht eerst, conditie).
   - Duur gepolariseerd: het meeste rustig, weinig maar echt zwaar
     (Seiler S. 2010, IJSPP 5(3)).
   - Interferentie beperken: geen zware beentraining de dag vóór een
     sleutelsessie duur, en harde dagen niet achter elkaar
     (Wilson J.M. e.a. 2012, J Strength Cond Res 26(8); Methenitis S. 2018,
     Sports 6(4)).
   - Periodisering: blokken van drie weken opbouw en een herstelweek; met
     een doeldatum: basis, opbouw, piek, taper en wedstrijd
     (taper 1–2 weken, ~40–60% minder volume, intensiteit behouden:
     Bosquet L. e.a. 2007, Med Sci Sports Exerc 39(8)).
   - Opbouw van het duurvolume met hoogstens ~10% per week.
   - Krachtgewichten uit uw eigen records (geschatte 1RM, Epley), terug te
     rekenen naar herhalingen en RIR.

   Alles is puur JavaScript zonder React, zodat de tests het los draaien. */

import { SPORTS, num, dayNum, isoOfNum, mondayOf, newId, localISO } from "./model.js";
import { newBlock, newItem, blockDuration } from "./blocks.js";
import { movementById } from "./movements.js";
import { fitnessSeries, sessionLoad, strengthRecords, durationOf } from "./load.js";
import { runPaceZones, powerZones, rowZones, hrZones } from "./zones.js";
import { readinessAverage } from "./readiness.js";
import { fmtDuration } from "./model.js";

/* ---------------- doelen en sessietypen ---------------- */
export const GOALS = {
  hybride: { label: "Algemeen hybride", sub: "kracht en duur in balans", slots: ["K_LOWER", "D_EASY", "K_UPPER", "D_INT", "D_LONG", "C_METCON", "D_EASY"], taper: 1, run: false },
  hyrox: { label: "Hyrox", sub: "lopen met stations, wedstrijd als doel", slots: ["K_FULL", "D_INT", "C_HYROX", "D_EASY", "K_FULL", "D_LONG", "C_METCON"], taper: 1, run: true },
  "5k": { label: "5 km", sub: "snelheid en drempel", slots: ["D_INT", "D_LONG", "K_FULL", "D_EASY", "D_TEMPO", "D_EASY", "K_FULL"], taper: 1, run: true, raceKm: 5 },
  "10k": { label: "10 km", sub: "drempel en uithoudingsvermogen", slots: ["D_INT", "D_LONG", "K_FULL", "D_EASY", "D_TEMPO", "D_EASY", "K_FULL"], taper: 1, run: true, raceKm: 10 },
  halve: { label: "Halve marathon", sub: "duur en tempo", slots: ["D_INT", "D_LONG", "K_FULL", "D_EASY", "D_TEMPO", "D_EASY", "K_FULL"], taper: 2, run: true, raceKm: 21.1 },
  marathon: { label: "Marathon", sub: "lange duur centraal", slots: ["D_LONG", "D_INT", "K_FULL", "D_EASY", "D_TEMPO", "D_EASY", "D_EASY"], taper: 2, run: true, raceKm: 42.2 },
  kracht: { label: "Kracht eerst", sub: "sterker worden, conditie onderhouden", slots: ["K_LOWER", "K_UPPER", "D_EASY", "K_LOWER", "K_UPPER", "D_INT", "C_METCON"], taper: 1, run: false },
  conditie: { label: "Conditie / functional fitness", sub: "metcons, motor en kracht", slots: ["C_METCON", "K_FULL", "D_EASY", "C_METCON", "K_FULL", "D_INT", "D_LONG"], taper: 1, run: false },
};

export const SLOTS = {
  K_LOWER: { kind: "kracht", label: "Kracht onderlichaam", hard: true, legs: true },
  K_UPPER: { kind: "kracht", label: "Kracht bovenlichaam", hard: false, legs: false },
  K_FULL: { kind: "kracht", label: "Kracht volledig lichaam", hard: true, legs: true },
  D_EASY: { kind: "duur", label: "Rustige duur", hard: false },
  D_LONG: { kind: "duur", label: "Lange duur", hard: false, key: true },
  D_INT: { kind: "duur", label: "Intervallen", hard: true, key: true },
  D_TEMPO: { kind: "duur", label: "Tempo / drempel", hard: true, key: true },
  C_METCON: { kind: "wod", label: "Conditie", hard: true, legs: true },
  C_HYROX: { kind: "hyrox", label: "Hyrox-specifiek", hard: true, key: true, legs: true },
  M_MOB: { kind: "mobiliteit", label: "Mobiliteit", hard: false },
};

export const EXPERIENCE = { beginner: "Beginner", gevorderd: "Gevorderd", ervaren: "Ervaren" };
/* Bij duur ook "starter": (weer) beginnen met hardlopen, met loop-wandelen. */
export const EXPERIENCE_DUUR = { starter: "Net (weer) begonnen", ...EXPERIENCE };
/* Hoeveel kan de starter nu al achter elkaar hardlopen? Bepaalt het startniveau. */
export const RUN_NOW = { 1: "± 1 minuut", 3: "± 3 minuten", 8: "5–10 minuten", 20: "20 minuten of meer" };
export const EQUIPMENT = { gym: "Volledige gym", basis: "Dumbbells, kettlebells en optrekstang", thuis: "Alleen lichaamsgewicht" };
export const DAY_NAMES = ["ma", "di", "wo", "do", "vr", "za", "zo"];

export const SETTINGS_DEFAULT = {
  goal: "hybride",
  goalDate: null,
  days: [0, 1, 3, 5, 6],
  longDay: 6,
  minutes: 60,
  longMinutes: 100,
  exp: { kracht: "gevorderd", duur: "gevorderd" },
  equipment: "gym",
  cardio: ["hardlopen", "fietsen", "roeien"],
  mobility: true,
  auto: false,
  startDate: null,
};

/* ---------------- fasen ---------------- */
export const PHASES = {
  basis: { label: "Basis", text: "Fundament leggen: veel rustig, kracht met wat meer herhalingen." },
  opbouw: { label: "Opbouw", text: "Meer volume en zwaardere intervallen; kracht zwaarder met minder herhalingen." },
  piek: { label: "Piek", text: "Wedstrijdspecifiek: intensiteit houden, kracht onderhouden." },
  taper: { label: "Taper", text: "Minder volume, intensiteit vasthouden, fris worden voor de wedstrijd." },
  wedstrijd: { label: "Wedstrijdweek", text: "Kort en scherp, zo fris mogelijk aan de start." },
  herstel: { label: "Herstelweek", text: "Minder volume en lichter, zodat het werk van de afgelopen weken landt." },
  na: { label: "Na de wedstrijd", text: "Rustig herstellen, daarna een nieuw blok." },
};

export function phaseFor(settings, mondayISO) {
  const start = mondayOf(settings.startDate || mondayISO);
  const w = Math.max(0, Math.round((dayNum(mondayISO) - dayNum(start)) / 7));
  const goal = GOALS[settings.goal] || GOALS.hybride;
  if (settings.goalDate) {
    const left = Math.round((dayNum(mondayOf(settings.goalDate)) - dayNum(mondayISO)) / 7);
    if (left < 0) return { phase: left === -1 ? "na" : "opbouw", week: w, blockWeek: w % 4, weeksLeft: left, deload: left === -1 };
    if (left === 0) return { phase: "wedstrijd", week: w, blockWeek: 0, weeksLeft: 0, deload: false };
    if (left <= goal.taper) return { phase: "taper", week: w, blockWeek: 0, weeksLeft: left, deload: false };
    if (left <= goal.taper + 3) return { phase: "piek", week: w, blockWeek: goal.taper + 3 - left, weeksLeft: left, deload: false };
    // tellen vanaf het begin van de piek terug, zodat de herstelweek vlak vóór de piek valt
    const toPeak = left - goal.taper - 3;
    // herstelweek vlak vóór elk blok van drie, maar nooit in de eerste drie weken van het schema
    const deload = toPeak % 4 === 1 && toPeak > 0 && w >= 3;
    return { phase: deload ? "herstel" : left > 12 + goal.taper ? "basis" : "opbouw", week: w, blockWeek: (4 - (toPeak % 4)) % 4, weeksLeft: left, deload };
  }
  const blockWeek = w % 4;
  return { phase: blockWeek === 3 ? "herstel" : w < 4 ? "basis" : "opbouw", week: w, blockWeek, weeksLeft: null, deload: blockWeek === 3 };
}

/* Volumefactor van een week ten opzichte van de basis. */
export function volumeFactor(ph, goal) {
  if (ph.deload || ph.phase === "herstel" || ph.phase === "na") return 0.65;
  if (ph.phase === "wedstrijd") return 0.4;
  if (ph.phase === "taper") return (GOALS[goal] || GOALS.hybride).taper === 2 && ph.weeksLeft === 2 ? 0.75 : 0.6;
  if (ph.phase === "piek") return 1.1;
  if (ph.phase === "basis") return 1 + 0.05 * Math.min(2, ph.blockWeek);
  return 1.05 + 0.06 * Math.min(2, ph.blockWeek);
}

/* ---------------- dagen indelen ---------------- */
/* Strafpunten voor een indeling (lager is beter). */
export function arrangementPenalty(arr, settings) {
  // arr: [{ day (0..6), slot }], gesorteerd op dag
  let p = 0;
  const byDay = {};
  arr.forEach((x) => (byDay[x.day] = x.slot));
  for (const x of arr) {
    const s = SLOTS[x.slot];
    const next = byDay[(x.day + 1) % 7] && x.day < 6 ? SLOTS[byDay[x.day + 1]] : null;
    if (!next) continue;
    if (s.hard && next.hard) p += 10; // twee zware dagen achter elkaar
    if (s.legs && next.key && SLOTS[byDay[x.day + 1]].kind !== "kracht") p += 15; // zware benen vóór sleutelsessie duur
    if (x.slot === "D_LONG" && next.hard) p += 5;
    if (s.kind === "kracht" && next.kind === "kracht") p += x.slot === byDay[x.day + 1] ? 6 : 2;
  }
  const long = arr.find((x) => x.slot === "D_LONG");
  if (long && settings.longDay != null && long.day !== settings.longDay) p += 4;
  return p;
}

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  const out = [];
  const seen = new Set();
  xs.forEach((x, i) => {
    if (seen.has(x)) return;
    seen.add(x);
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

/* Beste indeling van de sessietypen over de beschikbare dagen. */
export function arrangeWeek(slots, days, settings) {
  const ds = [...days].sort((a, b) => a - b);
  let best = null;
  for (const perm of permutations(slots)) {
    const arr = perm.map((slot, i) => ({ day: ds[i], slot }));
    const pen = arrangementPenalty(arr, settings);
    if (!best || pen < best.pen) best = { arr, pen };
    if (pen === 0) break;
  }
  return best ? best.arr : [];
}

/* ---------------- volume ---------------- */
const EXP_MIN = { starter: 60, beginner: 80, gevorderd: 150, ervaren: 220 };

/* ---------------- starters: loop-wandelen ----------------
   Opbouw in kleine stappen: elke week iets langer hardlopen en korter
   wandelen, tot 30 minuten aan één stuk (zelfde idee als het NHS-programma
   Couch to 5K: drie keer per week, ongeveer negen weken). Een niveau omhoog
   alleen als u de week ervoor minstens twee keer hebt gelopen en het niet
   te zwaar was (inspanning onder 8). [hardlopen s, wandelen s, herhalingen] */
export const STARTER_LEVELS = [
  [60, 90, 8],
  [90, 120, 6],
  [120, 90, 6],
  [180, 90, 5],
  [300, 120, 4],
  [480, 120, 3],
  [600, 90, 3],
  [900, 120, 2],
  [1500, 0, 1],
  [1800, 0, 1],
];
const RUN_NOW_LEVEL = { 1: 0, 3: 3, 8: 5, 20: 8 };

const isRun = (s) => s.kind === "duur" && (s.sport || "hardlopen") === "hardlopen";

/* Niveau (0-gebaseerd) voor de week van mondayISO. */
export function starterLevel(settings, sessions, mondayISO) {
  let lvl = RUN_NOW_LEVEL[settings.runNow] ?? 0;
  const start = dayNum(mondayOf(settings.startDate || mondayISO));
  const now = dayNum(mondayISO);
  for (let w = start; w < now; w += 7) {
    const runs = (sessions || []).filter((s) => isRun(s) && dayNum(s.date) >= w && dayNum(s.date) < w + 7);
    const tooHard = runs.some((s) => num(s.rpe, 0) >= 8);
    if (runs.length >= 2 && !tooHard) lvl++;
  }
  return Math.min(lvl, STARTER_LEVELS.length);
}

const walk = (min, role, text) => newBlock("doorlopend", { role, intensity: text, items: [newItem("walk", { timeSec: min * 60 })] });

/* Een loop-wandeltraining op niveau lvl (0-gebaseerd). */
export function starterSession(lvl) {
  const [run, rest, reps] = STARTER_LEVELS[Math.max(0, Math.min(lvl, STARTER_LEVELS.length - 1))];
  const main = rest
    ? newBlock("interval", { name: "Loop-wandel", rounds: reps, restSec: rest, restLabel: "Wandelen", intensity: "rustig hardlopen, praattempo", items: [newItem("run", { timeSec: run })] })
    : newBlock("doorlopend", { intensity: "rustig hardlopen, praattempo", items: [newItem("run", { timeSec: run })] });
  const blocks = [walk(5, "warmup", "stevig wandelen"), main, walk(5, "cooldown", "rustig uitwandelen")];
  const fmt = (x) => (x % 60 ? fmtDuration(x) : `${x / 60} min`);
  const title = rest ? `Loop-wandel: ${reps} × ${fmt(run)} hardlopen` : `${run / 60} minuten hardlopen aan één stuk`;
  return {
    sport: "hardlopen",
    type: "rustig",
    title,
    targetMin: Math.round(blocks.reduce((a, b) => a + (blockDuration(b) || 0), 0) / 60),
    rpeTarget: 4,
    starterLevel: lvl + 1,
    blocks,
    note: rest
      ? `Afwisselend ${fmt(run)} rustig hardlopen en ${fmt(rest)} wandelen. Zo rustig dat u kunt praten. Te zwaar? Geef een hoge inspanning op, dan herhaalt de app dit niveau.`
      : "Rustig en gelijkmatig. Wandelen mag altijd even; liever langzaam dan stoppen.",
  };
} // minuten duur per week als vertrekpunt

/* Duurminuten per week in de laatste vier volledige weken. */
export function enduranceHistory(sessions, profile, mondayISO) {
  const m = dayNum(mondayISO);
  const weeks = [0, 0, 0, 0];
  for (const s of sessions) {
    const k = Math.floor((m - dayNum(s.date) - 1) / 7);
    if (k < 0 || k > 3) continue;
    const L = sessionLoad(s, profile);
    const share = (L.pillars.duur || 0) / (L.srpe || 1);
    weeks[k] += (L.minutes || 0) * (L.srpe ? share : s.kind === "duur" ? 1 : 0);
  }
  const done = weeks.filter((x) => x > 0);
  return { last: weeks[0], avg: done.length ? done.reduce((a, b) => a + b, 0) / done.length : 0, weeks };
}

export function enduranceTarget(settings, ctx, mondayISO, factor) {
  const hist = enduranceHistory(ctx.sessions || [], ctx.profile || {}, mondayISO);
  const floor = EXP_MIN[(settings.exp || {}).duur] || 150;
  const base = Math.max(floor, hist.avg);
  let target = base * factor;
  if (hist.last > 0 && factor >= 1) target = Math.min(target, Math.max(hist.last * 1.1, floor)); // hoogstens ~10% erbij
  return Math.round(target);
}

/* ---------------- voorschriften ---------------- */
const SPORT_MOVE = { hardlopen: "run", fietsen: "cycle", roeien: "row", skierg: "ski", zwemmen: "swim_free", wandelen: "walk", stepper: "stair" };

/* Doeltempo of -zone in gewone tekst, uit het profiel. */
export function intensityText(profile, sport, zone) {
  const zi = { herstel: 0, rustig: 1, tempo: 2, drempel: 3, vo2: 4 }[zone];
  const label = { herstel: "herstel", rustig: "zone 2, praattempo", tempo: "tempo", drempel: "drempel", vo2: "VO2max" }[zone];
  if (sport === "hardlopen") {
    const z = runPaceZones(profile.run5k);
    if (z) return `${label}: ${fmtDuration(z[zi].fast)}–${fmtDuration(z[zi].slow)} /km`;
  }
  if (sport === "fietsen") {
    const z = powerZones(profile.ftp);
    if (z) return `${label}: ${zi === 0 ? `< ${z[0].hi}` : `${z[zi].lo}–${z[zi].hi}`} W`;
  }
  if (sport === "roeien") {
    const z = rowZones(profile.row2k);
    if (z) return `${label}: ${fmtDuration(z[zi].fast)}–${fmtDuration(z[zi].slow)} /500 m`;
  }
  const hz = hrZones(profile);
  if (hz) {
    const z = hz.zones[zi];
    return `${label}: ${zi === 0 ? `< ${z.hi}` : `${z.lo}–${z.hi - 1}`} bpm`;
  }
  return `${label}: RPE ${["2", "3", "5–6", "7", "8–9"][zi]}`;
}

const warmup = (sport, min = 10) => newBlock("doorlopend", { role: "warmup", intensity: "rustig inlopen", items: [newItem(SPORT_MOVE[sport] || "run", { timeSec: min * 60 })] });
const cooldown = (sport, min = 10) => newBlock("doorlopend", { role: "cooldown", intensity: "uitlopen", items: [newItem(SPORT_MOVE[sport] || "run", { timeSec: min * 60 })] });

function pickSport(settings, slot, n) {
  const goal = GOALS[settings.goal] || GOALS.hybride;
  const cardio = (settings.cardio || []).filter((s) => SPORT_MOVE[s]);
  const list = cardio.length ? cardio : ["hardlopen"];
  const runs = list.includes("hardlopen");
  if (goal.run && runs && (slot === "D_INT" || slot === "D_LONG" || slot === "D_TEMPO")) return "hardlopen";
  if (goal.run && runs && slot === "D_EASY") {
    // rustige duur: om en om lopen en een sport met minder impact
    const other = list.filter((s) => s !== "hardlopen");
    return n % 2 === 0 || !other.length ? "hardlopen" : other[(n >> 1) % other.length];
  }
  return list[n % list.length];
}

function enduranceSession(slot, ph, settings, ctx, minutes, n) {
  const sport = pickSport(settings, slot, n);
  const profile = ctx.profile || {};
  const goal = settings.goal;
  const mv = SPORT_MOVE[sport];
  if (slot === "D_EASY" || slot === "D_LONG") {
    const zone = slot === "D_LONG" ? "rustig" : ph.phase === "herstel" || ph.deload ? "herstel" : "rustig";
    return {
      sport,
      type: slot === "D_LONG" ? "lang" : ph.deload ? "herstel" : "rustig",
      targetMin: minutes,
      rpeTarget: slot === "D_LONG" ? 4 : 3,
      blocks: [newBlock("doorlopend", { intensity: intensityText(profile, sport, zone), items: [newItem(mv, { timeSec: minutes * 60 })] })],
      note: slot === "D_LONG" ? "Rustig en lang: de basis van uw uithoudingsvermogen." : "Echt rustig: u moet kunnen praten.",
    };
  }
  // intervallen en tempo: warming-up, kern, cooling-down
  const exp = (settings.exp || {}).duur || "gevorderd";
  const beginner = exp === "beginner";
  const wu = beginner ? 8 : 10,
    cd = beginner ? 5 : 8;
  let main, type, note, rpe;
  // Beginners: eerst een aerobe basis. In de basisfase (en herstelweken)
  // geen drempel- of VO2max-werk, alleen rustig lopen met een paar korte
  // versnellingen; daarna voorzichtig drempelwerk, nooit VO2max-blokken.
  if (beginner && (ph.phase === "basis" || ph.deload || ph.phase === "herstel" || ph.phase === "na")) {
    const easy = slot === "D_TEMPO" ? 25 : 20;
    const blocks = [newBlock("doorlopend", { intensity: intensityText(profile, sport, "rustig"), items: [newItem(mv, { timeSec: easy * 60 })] })];
    if (slot === "D_INT" && !ph.deload) blocks.push(newBlock("interval", { rounds: 4, restSec: 60, intensity: "vlot maar ontspannen, geen sprint", items: [newItem(mv, { timeSec: 20 })] }));
    blocks.push(cooldown(sport, cd));
    const out = { sport, type: slot === "D_INT" && !ph.deload ? "fartlek" : "rustig", rpeTarget: 4, blocks, note: slot === "D_INT" ? "U bouwt eerst een basis: rustig lopen met een paar korte versnellingen. Echte intervallen komen later." : "Rustig, op praattempo. Snelheid komt later." };
    return { ...out, targetMin: minutesOf(out.blocks) };
  }
  if (beginner && slot !== "D_TEMPO" && (ph.phase === "opbouw" || ph.phase === "piek")) {
    main = newBlock("interval", { rounds: 4, restSec: 120, intensity: intensityText(profile, sport, "drempel"), items: [newItem(mv, { timeSec: 4 * 60 })] });
    const out = { sport, type: "drempel", rpeTarget: 7, blocks: [warmup(sport, wu), main, cooldown(sport, cd)], note: "Stevig maar beheerst: u kunt nog een paar woorden zeggen." };
    return { ...out, targetMin: minutesOf(out.blocks) };
  }
  if (slot === "D_TEMPO") {
    const blockMin = beginner ? 6 : ph.phase === "basis" ? 10 : 12;
    main = newBlock("interval", { rounds: ph.deload ? 1 : 2, restSec: 180, intensity: intensityText(profile, sport, "drempel"), items: [newItem(mv, { timeSec: blockMin * 60 })] });
    type = "drempel";
    rpe = 7;
    note = "Comfortabel zwaar: u kunt nog een paar woorden zeggen.";
  } else if (ph.phase === "basis" || ph.deload) {
    main = newBlock("interval", { rounds: ph.deload ? 2 : 3, restSec: 120, intensity: intensityText(profile, sport, "drempel"), items: [newItem(mv, { timeSec: 8 * 60 })] });
    type = "drempel";
    rpe = 7;
    note = "Drempelintervallen bouwen uw motor zonder te veel vermoeidheid.";
  } else if (ph.phase === "opbouw") {
    main = n % 2 === 0
      ? newBlock("interval", { name: "Noorse 4×4", rounds: 4, restSec: 180, intensity: intensityText(profile, sport, "vo2"), items: [newItem(mv, { timeSec: 240 })] })
      : newBlock("interval", { rounds: 5, restSec: 120, intensity: intensityText(profile, sport, "vo2"), items: [newItem(mv, { timeSec: 180 })] });
    type = "interval";
    rpe = 8;
    note = "Zwaar, maar gelijkmatig: de laatste herhaling net zo snel als de eerste.";
  } else if (ph.phase === "piek") {
    if (goal === "5k") main = newBlock("interval", { rounds: 6, restSec: 120, intensity: "5 km-wedstrijdtempo", items: [newItem("run", { distanceM: 800 })] });
    else if (goal === "10k") main = newBlock("interval", { rounds: 5, restSec: 90, intensity: "10 km-wedstrijdtempo", items: [newItem("run", { distanceM: 1000 })] });
    else if (goal === "halve" || goal === "marathon") main = newBlock("interval", { rounds: 3, restSec: 180, intensity: goal === "halve" ? "halvemarathontempo" : "marathontempo", items: [newItem("run", { distanceM: 3000 })] });
    else if (goal === "hyrox") main = newBlock("interval", { rounds: 8, restSec: 60, intensity: "Hyrox-looptempo", items: [newItem("run", { distanceM: 1000 })] });
    else main = newBlock("interval", { rounds: 6, restSec: 120, intensity: intensityText(profile, sport, "vo2"), items: [newItem(mv, { timeSec: 180 })] });
    type = "interval";
    rpe = 8;
    note = "Wedstrijdspecifiek: wennen aan het tempo dat u wilt lopen.";
  } else {
    main = newBlock("interval", { rounds: 4, restSec: 120, intensity: intensityText(profile, sport, "drempel"), items: [newItem(mv, { timeSec: 120 })] });
    type = "interval";
    rpe = 6;
    note = "Kort en scherp, zonder moe te worden.";
  }
  const blocks = [warmup(sport, wu), main, cooldown(sport, cd)];
  // de geplande duur volgt uit wat er werkelijk in de sessie staat
  return { sport, type, targetMin: minutesOf(blocks), rpeTarget: rpe, blocks, note };
}

/* Totale duur van een geplande sessie in minuten (opwarmen, kern, rust, uitlopen). */
function minutesOf(blocks) {
  return Math.round(blocks.reduce((a, b) => a + (blockDuration(b) || 0), 0) / 60);
}

/* Krachtoefeningen per materiaal. Eerste oefening = hoofdoefening. */
const STRENGTH = {
  gym: {
    K_LOWER: ["back_squat", "rdl", "bulgarian", "copenhagen"],
    K_UPPER: ["bench_press", "strict_pull_ups", "strict_press", "bb_row"],
    K_FULL: ["trap_bar_dl", "push_press", "strict_pull_ups", "front_rack_lunge"],
  },
  basis: {
    K_LOWER: ["kb_goblet", "bulgarian", "db_step_ups", "kb_swings"],
    K_UPPER: ["push_ups", "pull_ups", "kb_press", "renegade_row"],
    K_FULL: ["kb_swings", "db_thrusters", "pull_ups", "walking_lunges"],
  },
  thuis: {
    K_LOWER: ["bulgarian", "pistols", "nordic", "side_plank"],
    K_UPPER: ["push_ups", "pike_push_ups", "inverted_rows", "hollow_hold"],
    K_FULL: ["burpees", "jump_squats", "push_ups", "inverted_rows"],
  },
};

/* Sets, herhalingen en RIR per fase: [hoofd, hulp]. */
function strengthDose(ph, exp) {
  let d;
  if (ph.deload || ph.phase === "herstel" || ph.phase === "na") d = { main: [2, 5, 4], acc: [2, 8, 4] };
  else if (ph.phase === "wedstrijd" || ph.phase === "taper") d = { main: [2, 3, 3], acc: null };
  else if (ph.phase === "piek") d = { main: [3, 3, 2], acc: [2, 6, 2] };
  else if (ph.phase === "opbouw") d = { main: [4, 5, Math.max(1, 2 - Math.min(1, ph.blockWeek))], acc: [3, 8, 2] };
  else d = { main: [3, 8, 2], acc: [3, 10, 2] };
  if (exp === "beginner") {
    d.main = [Math.min(3, d.main[0]), d.main[1], Math.max(2, d.main[2])];
    if (d.acc) d.acc = [Math.min(2, d.acc[0]), d.acc[1], Math.max(2, d.acc[2])];
  }
  return d;
}

/* Gewicht uit de geschatte 1RM: kg = 1RM / (1 + (herh + RIR) / 30), op 2,5 kg. */
export function suggestKg(e1rm, reps, rir) {
  if (!e1rm) return null;
  return Math.round(e1rm / (1 + (reps + rir) / 30) / 2.5) * 2.5;
}

function strengthSession(slot, ph, settings, ctx) {
  const eq = STRENGTH[settings.equipment] ? settings.equipment : "gym";
  const list = STRENGTH[eq][slot] || STRENGTH[eq].K_FULL;
  const d = strengthDose(ph, (settings.exp || {}).kracht);
  const recs = Object.fromEntries(strengthRecords(ctx.sessions || []).map((r) => [r.name, r]));
  const items = list
    .map((id, i) => {
      const dose = i === 0 ? d.main : d.acc;
      if (!dose) return null;
      const mv = movementById(id);
      if (!mv) return null;
      const [sets, reps, rir] = dose;
      const timed = mv.metrics[0] === "time";
      const rec = recs[mv.name];
      const kg = !timed && mv.metrics.includes("kg") ? suggestKg(rec && rec.e1rm, reps, rir) : null;
      return {
        ...newItem(mv),
        perSide: !!mv.uni && !timed,
        restSec: i === 0 ? 150 : 90,
        sets: Array.from({ length: sets }, () => ({ kg, reps: timed ? null : reps, rir: null, target: { reps: timed ? null : reps, rir, sec: timed ? 30 : null } })),
      };
    })
    .filter(Boolean);
  const block = newBlock("sets", { items });
  const minutes = Math.round((items.reduce((a, it) => a + it.sets.length, 0) * (40 + 100)) / 60) + 10;
  return {
    targetMin: minutes,
    rpeTarget: ph.deload ? 5 : 7,
    blocks: [newBlock("doorlopend", { role: "warmup", intensity: "rustig", items: [newItem(settings.equipment === "thuis" ? "jump_rope" : "row", { timeSec: 300 })] }), block],
    note: `${d.main[0]} × ${d.main[1]} op de hoofdoefening met ${d.main[2]} herhalingen over (RIR ${d.main[2]}).`,
  };
}

/* Conditie: wisselende workouts, passend bij materiaal en fase. */
const METCONS = {
  gym: ["emom_engine", "4020", "e4m", "amrap_mix"],
  basis: ["emom_kb", "4020_kb", "amrap_bw", "e4m_kb"],
  thuis: ["amrap_bw", "tabata_bw", "emom_bw", "deathby_burpees"],
};
function metconBlock(id) {
  const I = newItem;
  switch (id) {
    case "emom_engine":
      return newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("row", { cal: 15 }), I("kb_swings", { reps: 12 }), I("burpees", { reps: 10 })] });
    case "4020":
      return newBlock("tabata", { rounds: 12, workSec: 40, restSec: 20, tabataMode: "wissel", items: [I("air_bike", { metric: "cal" }), I("wall_balls"), I("kb_swings"), I("burpees")] });
    case "e4m":
      return newBlock("emom", { everySec: 240, durationSec: 1200, emomMode: "alles", items: [I("row", { distanceM: 500 }), I("wall_balls", { reps: 15 }), I("burpees", { reps: 10 })] });
    case "amrap_mix":
      return newBlock("amrap", { capSec: 900, items: [I("run", { distanceM: 200 }), I("wall_balls", { reps: 12 }), I("t2b", { reps: 8 })] });
    case "emom_kb":
      return newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("kb_swings", { reps: 15 }), I("burpees", { reps: 10 }), I("kb_goblet", { reps: 12 })] });
    case "4020_kb":
      return newBlock("tabata", { rounds: 12, workSec: 40, restSec: 20, tabataMode: "wissel", items: [I("kb_swings"), I("db_thrusters"), I("burpees"), I("mountain_climbers")] });
    case "e4m_kb":
      return newBlock("emom", { everySec: 240, durationSec: 1200, emomMode: "alles", items: [I("run", { distanceM: 400 }), I("kb_swings", { reps: 20 }), I("push_ups", { reps: 10 })] });
    case "tabata_bw":
      return newBlock("tabata", { tabataMode: "volgorde", items: [I("air_squats"), I("push_ups"), I("mountain_climbers"), I("burpees")] });
    case "emom_bw":
      return newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("burpees", { reps: 10 }), I("air_squats", { reps: 20 }), I("push_ups", { reps: 12 })] });
    case "deathby_burpees":
      return newBlock("deathby", { items: [I("burpees")] });
    default:
      return newBlock("amrap", { capSec: 900, items: [I("burpees", { reps: 10 }), I("air_squats", { reps: 15 }), I("push_ups", { reps: 10 }), I("sit_ups", { reps: 15 })] });
  }
}

function metconSession(ph, settings, n) {
  const list = METCONS[settings.equipment] || METCONS.gym;
  const b = metconBlock(list[n % list.length]);
  if (ph.deload || ph.phase === "taper" || ph.phase === "wedstrijd") {
    if (b.type === "emom") b.durationSec = Math.round((b.durationSec * 0.6) / b.everySec) * b.everySec;
    if (b.type === "tabata") b.rounds = Math.max(4, Math.round(b.rounds * 0.6));
    if (b.type === "amrap") b.capSec = Math.round(b.capSec * 0.6);
  }
  return {
    targetMin: Math.round((10 * 60 + (b.durationSec || b.capSec || (b.rounds || 8) * ((b.workSec || 20) + (b.restSec || 10)) || 900)) / 60) + 5,
    rpeTarget: ph.deload ? 6 : 8,
    blocks: [newBlock("rondes", { role: "warmup", rounds: 2, items: [newItem("row", { distanceM: 250 }), newItem("air_squats", { reps: 10 }), newItem("push_ups", { reps: 8 })] }), b],
    note: "Stevig doorwerken op een tempo dat u de hele workout volhoudt.",
  };
}

function hyroxSession(ph) {
  const I = newItem;
  let b, note;
  if (ph.phase === "basis" || ph.deload) {
    b = newBlock("rondes", { name: "Hyrox-stations", rounds: ph.deload ? 2 : 4, items: [I("run", { distanceM: 1000 }), I("sled_push", { distanceM: 50 }), I("wall_balls", { reps: 20 })] });
    note = "Techniek en tempo op de stations, rustig lopen ertussen.";
  } else if (ph.phase === "opbouw") {
    b = newBlock("rondes", { name: "Compromised running", rounds: 4, items: [I("wall_balls", { reps: 25 }), I("burpee_bj", { distanceM: 20 }), I("run", { distanceM: 1000 })] });
    note = "Lopen met vermoeide benen, precies zoals in de wedstrijd.";
  } else if (ph.phase === "piek") {
    b = newBlock("fortime", {
      name: "Halve Hyrox",
      items: [I("run", { distanceM: 1000 }), I("ski", { distanceM: 1000 }), I("run", { distanceM: 1000 }), I("sled_push", { distanceM: 50 }), I("run", { distanceM: 1000 }), I("sled_pull", { distanceM: 50 }), I("run", { distanceM: 1000 }), I("burpee_bj", { distanceM: 80 })],
    });
    note = "Simulatie op wedstrijdtempo: oefen uw verdeling en overgangen.";
  } else {
    b = newBlock("rondes", { name: "Hyrox-scherpte", rounds: 2, items: [I("run", { distanceM: 500 }), I("sled_push", { distanceM: 25 }), I("wall_balls", { reps: 15 })] });
    note = "Kort en scherp, niet vermoeien.";
  }
  return { targetMin: 50, rpeTarget: ph.deload ? 6 : 8, blocks: [newBlock("doorlopend", { role: "warmup", intensity: "rustig", items: [I("run", { timeSec: 600 })] }), b], note };
}

function mobilitySession() {
  const I = newItem;
  return { targetMin: 15, rpeTarget: 2, blocks: [newBlock("doorlopend", { role: "cooldown", items: [I("mob_flow", { timeSec: 300 }), I("stretch_hips", { timeSec: 300 }), I("thoracic_mob", { timeSec: 300 })] })], note: "Rustig bewegen helpt herstellen." };
}

/* ---------------- bijsturen per week ---------------- */
export function weekAdjust(settings, ctx, mondayISO) {
  const reasons = [];
  let factor = 1;
  let forceDeload = false;
  const prevMon = isoOfNum(dayNum(mondayISO) - 7);
  const prev = (ctx.planItems || []).filter((x) => x.date >= prevMon && x.date < mondayISO && x.slot !== "M_MOB");
  if (prev.length >= 3) {
    const done = prev.filter((x) => x.status === "gedaan").length;
    const comp = done / prev.length;
    if (comp < 0.6) {
      factor = Math.min(factor, 1 / 1.07); // geen opbouw
      reasons.push(`Vorige week lukten ${done} van de ${prev.length} trainingen. Het volume blijft gelijk.`);
    }
    const deltas = prev
      .filter((x) => x.status === "gedaan" && x.doneId)
      .map((x) => {
        const s = (ctx.sessions || []).find((y) => y.id === x.doneId);
        return s && num(s.rpe) != null && x.rpeTarget ? num(s.rpe) - x.rpeTarget : null;
      })
      .filter((x) => x != null);
    if (deltas.length >= 2) {
      const d = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      if (d >= 1.5) {
        factor = Math.min(factor, 1 / 1.07);
        reasons.push("De trainingen voelden zwaarder dan bedoeld. We bouwen deze week niet verder op.");
      } else if (d <= -1 && comp >= 0.9) {
        factor *= 1.05;
        reasons.push("Het ging makkelijker dan verwacht. Er komt iets meer bij.");
      }
    }
  }
  const rAvg = readinessAverage(ctx.checkins || [], isoOfNum(dayNum(mondayISO) - 1), 7);
  if (rAvg != null && rAvg < 40) {
    forceDeload = true;
    reasons.push(`Uw herstel was de afgelopen week laag (gemiddeld ${rAvg}). Deze week wordt een herstelweek.`);
  } else if (rAvg != null && rAvg < 55) {
    factor *= 0.85;
    reasons.push(`Uw herstel was matig (gemiddeld ${rAvg}). Iets minder volume deze week.`);
  }
  const series = fitnessSeries(ctx.sessions || [], ctx.profile || {}, isoOfNum(dayNum(mondayISO) - 1), isoOfNum(dayNum(mondayISO) - 1));
  const pt = series[series.length - 1];
  if (pt && pt.ctl > 20 && pt.since >= 21 && pt.tsb / pt.ctl < -0.35 && !forceDeload) {
    factor *= 0.85;
    reasons.push("De vermoeidheid is flink opgelopen. Deze week iets minder volume.");
  }
  return { factor, forceDeload, reasons, readiness: rAvg };
}

/* ---------------- een week maken ---------------- */
export function generateWeek(settingsIn, ctx, mondayISO) {
  const settings = { ...SETTINGS_DEFAULT, ...settingsIn, startDate: settingsIn.startDate || mondayISO };
  const goal = GOALS[settings.goal] || GOALS.hybride;
  let ph = phaseFor(settings, mondayISO);
  const adj = weekAdjust(settings, ctx, mondayISO);
  if (adj.forceDeload && !ph.deload && ph.phase !== "taper" && ph.phase !== "wedstrijd") ph = { ...ph, deload: true, phase: "herstel", forced: true };
  const factor = volumeFactor(ph, settings.goal) * adj.factor;
  const days = [...new Set((settings.days || []).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  let slots = goal.slots.slice(0, days.length);
  // wedstrijdweek: alleen kort en scherp, de wedstrijd zelf op de doeldag
  const raceDay = settings.goalDate && ph.phase === "wedstrijd" ? dayNum(settings.goalDate) - dayNum(mondayISO) : null;
  let arr = arrangeWeek(slots, days, settings);
  if (raceDay != null) arr = arr.filter((x) => x.day < raceDay - 1 && SLOTS[x.slot].kind !== "kracht").slice(0, 2);

  // starter klaar met het programma: verder als beginner
  const lvl = (settings.exp || {}).duur === "starter" ? starterLevel(settings, ctx.sessions, mondayISO) : null;
  const starter = lvl != null && lvl < STARTER_LEVELS.length;
  if (lvl != null && !starter) settings.exp = { ...settings.exp, duur: "beginner" };
  const endurMin = enduranceTarget(settings, ctx, mondayISO, factor);
  const dSlots = arr.filter((x) => SLOTS[x.slot].kind === "duur");
  // schatting voor de verdeling van de weekminuten; de echte duur volgt uit de inhoud
  const hardMin = Math.min(settings.minutes, { beginner: 30, gevorderd: 45, ervaren: 55 }[(settings.exp || {}).duur] || 45);
  const longFloor = (settings.exp || {}).duur === "beginner" ? 30 : 45;
  const longMin = Math.round(Math.min(settings.longMinutes || 100, Math.max(longFloor, endurMin * 0.33)));
  const fixed = dSlots.reduce((a, x) => a + (x.slot === "D_LONG" ? longMin : x.slot === "D_EASY" ? 0 : hardMin), 0);
  const easyN = dSlots.filter((x) => x.slot === "D_EASY").length;
  const easyMin = easyN ? Math.round(Math.max(25, Math.min(settings.minutes, (endurMin - fixed) / easyN))) : 0;
  const scale = ph.deload ? 0.75 : 1;

  // starter: hoogstens drie loop-wandeltrainingen, niet op opeenvolgende dagen;
  // de andere duursessies worden rustig wandelen of fietsen
  const starterRun = new Set();
  if (starter) {
    let last = -9;
    for (const x of arr.filter((y) => SLOTS[y.slot].kind === "duur")) {
      if (starterRun.size < 3 && x.day - last >= 2) {
        starterRun.add(x);
        last = x.day;
      }
    }
  }
  const crossSport = (settings.cardio || []).find((c) => c !== "hardlopen" && SPORT_MOVE[c]) || "wandelen";
  const counters = {};
  const items = arr.map((x) => {
    const n = (counters[x.slot] = (counters[x.slot] || 0) + 1) - 1 + ph.week; // wisselen per week
    const date = isoOfNum(dayNum(mondayISO) + x.day);
    const S = SLOTS[x.slot];
    let p;
    if (S.kind === "duur" && starter) {
      p = starterRun.has(x)
        ? starterSession(ph.deload ? Math.max(0, lvl - 1) : lvl)
        : { sport: crossSport, type: "rustig", targetMin: 30, rpeTarget: 3, blocks: [newBlock("doorlopend", { intensity: "rustig, u kunt praten", items: [newItem(SPORT_MOVE[crossSport], { timeSec: 30 * 60 })] })], note: "Rustig bewegen zonder de impact van hardlopen. Goed voor uw conditie en herstel." };
      return { id: newId(), planned: true, status: "gepland", date, slot: x.slot, kind: S.kind, hard: false, key: false, ...p, title: p.title || (crossSport === "wandelen" ? "Stevig wandelen" : `Rustig ${SPORTS[crossSport].label.toLowerCase()}`) };
    }
    if (S.kind === "duur") p = enduranceSession(x.slot, ph, settings, ctx, Math.round((x.slot === "D_LONG" ? longMin : x.slot === "D_EASY" ? easyMin : hardMin) * scale), n);
    else if (S.kind === "kracht") p = strengthSession(x.slot, ph, settings, ctx);
    else if (S.kind === "hyrox") p = hyroxSession(ph);
    else p = metconSession(ph, settings, n);
    return { id: newId(), planned: true, status: "gepland", date, slot: x.slot, kind: S.kind, title: S.label, hard: !!S.hard, key: !!S.key, ...p };
  });
  // conditie hoort bij hybride training: past er geen aparte sessie in, dan
  // een korte afsluiter na de krachtsessie die de benen het minst belast
  if (goal.slots.includes("C_METCON") && !items.some((x) => x.kind === "wod" || x.kind === "hyrox") && !ph.deload && ph.phase !== "taper" && ph.phase !== "wedstrijd") {
    const host = items.find((x) => x.slot === "K_UPPER") || items.find((x) => x.kind === "kracht");
    if (host) {
      const I = newItem;
      const fin = settings.equipment === "thuis"
        ? newBlock("amrap", { role: "afsluiter", capSec: 480, items: [I("burpees", { reps: 8 }), I("air_squats", { reps: 12 }), I("push_ups", { reps: 8 })] })
        : newBlock("emom", { role: "afsluiter", durationSec: 480, everySec: 60, emomMode: "wissel", items: [I(settings.equipment === "gym" ? "row" : "kb_swings", settings.equipment === "gym" ? { cal: 12 } : { reps: 15 }), I("burpees", { reps: 8 })] });
      host.blocks = [...host.blocks, fin];
      host.targetMin += 10;
      host.title = `${host.title} + afsluiter`;
      host.note = `${host.note} Daarna een korte afsluiter voor de conditie.`;
    }
  }
  if (raceDay != null && raceDay >= 0 && raceDay <= 6) {
    items.push({ id: newId(), planned: true, status: "gepland", date: settings.goalDate, slot: "RACE", kind: goal.run ? "duur" : "hyrox", sport: goal.run ? "hardlopen" : undefined, type: "wedstrijd", title: `Wedstrijd: ${goal.label}`, hard: true, key: true, targetMin: null, rpeTarget: 9, blocks: [], note: "Succes! Begin rustig en bouw op." });
  }
  // mobiliteit op een rustdag
  if (settings.mobility) {
    const used = new Set(items.map((x) => dayNum(x.date) - dayNum(mondayISO)));
    const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !used.has(d));
    if (free.length) {
      const d = free[Math.floor(free.length / 2)];
      items.push({ id: newId(), planned: true, status: "gepland", date: isoOfNum(dayNum(mondayISO) + d), slot: "M_MOB", kind: "mobiliteit", title: "Mobiliteit", hard: false, key: false, optional: true, ...mobilitySession() });
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { monday: mondayISO, phase: ph.phase, phaseInfo: ph, factor: Math.round(factor * 100) / 100, enduranceMin: endurMin, reasons: adj.reasons, readiness: adj.readiness, items };
}

/* ---------------- dagelijks bijsturen ---------------- */
/* Interferentie tussen twee geplande dagen (voor waarschuwingen). */
export function conflictsFor(items, mondayISO) {
  const out = [];
  const week = items.filter((x) => x.date >= mondayISO && x.date < isoOfNum(dayNum(mondayISO) + 7) && x.slot !== "M_MOB" && x.status !== "overgeslagen");
  for (const a of week) {
    for (const b of week) {
      if (dayNum(b.date) - dayNum(a.date) !== 1) continue;
      const A = SLOTS[a.slot] || {},
        B = SLOTS[b.slot] || {};
      if (A.legs && B.key && B.kind !== "kracht") out.push({ a: a.id, b: b.id, text: `${a.title} staat vlak vóór ${b.title.toLowerCase()}. Zware benen maken die sessie minder effectief.` });
      else if (A.hard && B.hard) out.push({ a: a.id, b: b.id, text: `Twee zware dagen achter elkaar: ${a.title.toLowerCase()} en ${b.title.toLowerCase()}.` });
    }
  }
  return out;
}

/* Beste vrije dag voor een sessie in de rest van de week. */
export function bestDayFor(item, items, fromISO, mondayISO, settings) {
  const end = dayNum(mondayISO) + 6;
  let best = null;
  for (let d = Math.max(dayNum(fromISO), dayNum(mondayISO)); d <= end; d++) {
    const iso = isoOfNum(d);
    const taken = items.some((x) => x.id !== item.id && x.date === iso && x.slot !== "M_MOB" && x.status !== "overgeslagen");
    if (taken) continue;
    const trial = items.filter((x) => x.slot !== "M_MOB" && x.status !== "overgeslagen").map((x) => (x.id === item.id ? { ...x, date: iso } : x));
    const arr = trial.filter((x) => x.date >= mondayISO && dayNum(x.date) <= end && SLOTS[x.slot]).map((x) => ({ day: dayNum(x.date) - dayNum(mondayISO), slot: x.slot }));
    const pen = arrangementPenalty(arr, settings || {}) + (d - dayNum(fromISO)) * 0.5;
    if (!best || pen < best.pen) best = { date: iso, pen };
  }
  return best && best.pen < 15 ? best.date : null;
}

/* Lichtere versie van een sessie: minder volume of een rustige vervanger. */
export function lightenItem(item, level, ctx = {}, settings = SETTINGS_DEFAULT) {
  if (level === "rust") {
    const m = mobilitySession();
    return { ...item, kind: "mobiliteit", slot: item.slot, title: "Herstel: mobiliteit", hard: false, key: false, sport: undefined, type: undefined, ...m, changed: "rust", original: item.original || item };
  }
  if (level === "rustig") {
    const sport = item.sport || pickSport(settings, "D_EASY", 0);
    const p = enduranceSession("D_EASY", { phase: "herstel", deload: true, week: 0, blockWeek: 0 }, settings, ctx, Math.min(40, item.targetMin || 40), 0);
    return { ...item, kind: "duur", title: "Rustige duur (in plaats van zwaar)", hard: false, key: false, ...p, sport, changed: "rustig", original: item.original || item };
  }
  // "minder": ongeveer 20–30% minder volume, intensiteit gelijk
  const blocks = (item.blocks || []).map((b) => {
    const c = JSON.parse(JSON.stringify(b));
    if (c.role) return c;
    if (c.type === "sets") c.items = c.items.map((it) => ({ ...it, sets: it.sets.slice(0, Math.max(1, it.sets.length - 1)) }));
    if (c.type === "interval" || c.type === "rondes") c.rounds = Math.max(1, Math.round(num(c.rounds, 1) * 0.7));
    if (c.type === "emom") c.durationSec = Math.max(c.everySec, Math.round((c.durationSec * 0.7) / c.everySec) * c.everySec);
    if (c.type === "amrap") c.capSec = Math.round(c.capSec * 0.7);
    if (c.type === "tabata") c.rounds = Math.max(4, Math.round(c.rounds * 0.7));
    if (c.type === "doorlopend") c.items = c.items.map((it) => (it.timeSec ? { ...it, timeSec: Math.round(it.timeSec * 0.75) } : it.distanceM ? { ...it, distanceM: Math.round(it.distanceM * 0.75) } : it));
    return c;
  });
  return { ...item, blocks, targetMin: item.targetMin ? Math.round(item.targetMin * 0.75) : item.targetMin, rpeTarget: Math.max(3, (item.rpeTarget || 6) - 1), changed: "minder", original: item.original || item };
}

/* Voorstellen voor vandaag: gemiste sessies en herstel. */
export function dailySuggestions(items, todayISO, readiness, settings, ctx = {}) {
  const out = [];
  const monday = mondayOf(todayISO);
  const week = items.filter((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6));
  // gemist: eerder deze week, nog gepland
  for (const x of week.filter((y) => y.date < todayISO && y.status === "gepland" && !y.optional && y.slot !== "RACE")) {
    const day = bestDayFor(x, week, todayISO, monday, settings);
    if (day && (x.key || SLOTS[x.slot].kind === "kracht")) out.push({ id: `move-${x.id}`, type: "verplaats", itemId: x.id, date: day, text: `${x.title} is nog niet gedaan. Verplaatsen naar ${new Date(day + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long" })}?` });
    else out.push({ id: `skip-${x.id}`, type: "overslaan", itemId: x.id, text: `${x.title} is nog niet gedaan en past niet meer goed in de week. Laten vallen?` });
  }
  // herstel van vandaag tegenover een zware sessie
  const today = week.find((x) => x.date === todayISO && x.status === "gepland" && x.hard && x.slot !== "RACE");
  // ook een gewone sessie: bij laag herstel lichter, bij zeer laag herstel rust
  const plain = !today && week.find((x) => x.date === todayISO && x.status === "gepland" && !x.optional && x.slot !== "RACE" && x.slot !== "M_MOB" && !x.changed);
  if (plain && readiness && readiness.score != null && readiness.level === "laag") {
    if (readiness.score < 25) out.push({ id: `rest-${plain.id}`, type: "lichter", level: "rust", itemId: plain.id, text: `Uw herstel is erg laag (${readiness.score}). Neem vandaag rust: alleen rustig bewegen.` });
    else out.push({ id: `less-${plain.id}`, type: "lichter", level: "minder", itemId: plain.id, text: `Uw herstel is laag (${readiness.score}). Doe ${plain.title.toLowerCase()} met minder volume.` });
  }
  if (today && readiness && readiness.score != null) {
    if (readiness.level === "laag") {
      out.push({ id: `light-${today.id}`, type: "lichter", level: today.kind === "kracht" ? "rust" : "rustig", itemId: today.id, text: `Uw herstel is laag (${readiness.score}). Maak van ${today.title.toLowerCase()} een ${today.kind === "kracht" ? "mobiliteitssessie" : "rustige duursessie"}.` });
      const day = bestDayFor(today, week, isoOfNum(dayNum(todayISO) + 1), monday, settings);
      if (day) out.push({ id: `later-${today.id}`, type: "verplaats", itemId: today.id, date: day, text: `Of verplaats ${today.title.toLowerCase()} naar ${new Date(day + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long" })}.` });
    } else if (readiness.level === "matig") {
      out.push({ id: `less-${today.id}`, type: "lichter", level: "minder", itemId: today.id, text: `Uw herstel is matig (${readiness.score}). Doe ${today.title.toLowerCase()} met ongeveer een kwart minder volume.` });
    }
  }
  return out;
}

/* Voorstel toepassen op de lijst geplande sessies. */
export function applySuggestion(items, sug, ctx = {}, settings = SETTINGS_DEFAULT) {
  return items.map((x) => {
    if (x.id !== sug.itemId) return x;
    if (sug.type === "verplaats") return { ...x, date: sug.date, moved: true };
    if (sug.type === "overslaan") return { ...x, status: "overgeslagen" };
    if (sug.type === "lichter") return lightenItem(x, sug.level, ctx, settings);
    return x;
  });
}

/* Geplande sessie naar een conceptsessie om vast te leggen. */
export function draftFromItem(item) {
  const fresh = (item.blocks || []).map((b) => {
    const c = JSON.parse(JSON.stringify(b));
    c.id = newId();
    c.result = {};
    if (c.type === "sets") c.items = c.items.map((it) => ({ ...it, sets: it.sets.map((s) => ({ kg: s.kg, reps: s.reps, rir: null, kind: s.kind })) }));
    return c;
  });
  const base = { id: newId(), date: localISO(), kind: item.kind, rpe: null, notes: "", source: "handmatig", createdAt: Date.now(), planItemId: item.id, title: item.kind === "duur" || item.slot === "RACE" ? undefined : item.title, blocks: fresh };
  if (item.kind === "duur") return { ...base, sport: item.sport || "hardlopen", type: item.type || "rustig", durationSec: item.targetMin ? item.targetMin * 60 : null, distanceM: null, avgHr: null, maxHr: null, avgPower: null, elevGain: null };
  if (item.kind === "hyrox") return { ...base, mode: item.slot === "RACE" ? "race" : "deel", splits: { runs: Array(8).fill(null), stations: Array(8).fill(null) } };
  return base;
}

/* Korte samenvatting van een geplande sessie. */
export function itemSummary(item) {
  const bits = [];
  if (item.targetMin) bits.push(`± ${item.targetMin} min`);
  if (item.sport && SPORTS[item.sport]) bits.push(SPORTS[item.sport].label.toLowerCase());
  return bits.join(" · ");
}

export { durationOf };
