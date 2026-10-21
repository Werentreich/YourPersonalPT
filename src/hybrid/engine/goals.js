/* Doelen in het schema: een hoofddoel en tussendoelen (zuiver, zonder React).

   Hoofddoel (settings.goalDate): de dag waarop u zo fit mogelijk wilt zijn.
   Het schema bouwt daarnaar op met basis, opbouw, piek, taper en een
   wedstrijdweek (zie phaseFor in planner.js). Taper 1–2 weken met ongeveer
   40–60% minder volume en dezelfde intensiteit (Bosquet L. e.a. 2007, Med
   Sci Sports Exerc 39(8)).

   Tussendoelen (settings.subGoals): wedstrijden onderweg. Het schema traint
   erdoor, met een korte aanloop zoals bij een B-wedstrijd: twee en drie
   dagen ervoor de zware sessies wat korter, de dag ervoor alleen rustig, de
   dag erna herstel. Daarna gaat de opbouw gewoon verder (Mujika I. & Padilla
   S. 2003, Med Sci Sports Exerc 35(7): een korte taper van een paar dagen
   houdt de fitheid vast en haalt een deel van de vermoeidheid weg). */

import { dayNum, isoOfNum } from "./model.js";

export const RACE_KINDS = { hyrox: "Hyrox", hardlopen: "Hardlopen", anders: "Anders" };
export const RUN_KM = [5, 10, 21.1, 42.2];
const GOAL_KM = { "5k": 5, "10k": 10, halve: 21.1, marathon: 42.2 };
const MAX_SUBS = 6;

const validISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(dayNum(s));
const kmText = (km) => (km === 21.1 ? "halve marathon" : km === 42.2 ? "marathon" : `${String(km).replace(".", ",")} km`);

/* Soort wedstrijd die bij het doel van het schema past. */
export function defaultKind(goal) {
  if (goal === "hyrox") return "hyrox";
  if (GOAL_KM[goal]) return "hardlopen";
  return "anders";
}

export function goalLabel(g) {
  if (!g) return "";
  if (g.name) return g.name;
  if (g.kind === "hyrox") return "Hyrox";
  if (g.kind === "hardlopen") return g.km ? kmText(g.km).replace(/^./, (c) => c.toUpperCase()) : "Hardloopwedstrijd";
  return g.main ? "Uw doel" : "Wedstrijd";
}

/* Het hoofddoel, of null. */
export function mainGoal(settings) {
  if (!settings || !validISO(settings.goalDate)) return null;
  const kind = RACE_KINDS[settings.goalKind] ? settings.goalKind : defaultKind(settings.goal);
  const km = kind === "hardlopen" ? Number(settings.goalKm) || GOAL_KM[settings.goal] || null : null;
  return { id: "main", date: settings.goalDate, name: (settings.goalName || "").trim(), kind, km, main: true };
}

/* Geldige tussendoelen, op datum; niet op de dag van het hoofddoel. */
export function subGoals(settings) {
  const main = settings && settings.goalDate;
  return ((settings && settings.subGoals) || [])
    .filter((g) => g && validISO(g.date) && g.date !== main)
    .map((g) => ({ id: g.id || g.date, date: g.date, name: (g.name || "").trim(), kind: RACE_KINDS[g.kind] ? g.kind : "anders", km: g.kind === "hardlopen" ? Number(g.km) || null : null, main: false }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, MAX_SUBS);
}

export const allGoals = (settings) => [mainGoal(settings), ...subGoals(settings)].filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/* Geplande sessie voor de wedstrijd zelf. */
export function raceItem(g, newId) {
  const label = goalLabel(g);
  const base = { id: newId(), planned: true, status: "gepland", date: g.date, slot: "RACE", type: "wedstrijd", hard: true, key: true, targetMin: null, rpeTarget: 9, blocks: [], race: { kind: g.kind, km: g.km, name: g.name, main: g.main } };
  const title = `${g.main ? "Wedstrijd" : "Tussendoel"}: ${label}`;
  const note = g.main ? "Succes! Begin rustig en bouw op." : "Tussendoel: train erdoor. Begin rustig en ga voluit als het goed voelt; na morgen gaat de opbouw verder.";
  if (g.kind === "hyrox") return { ...base, kind: "hyrox", title, note };
  if (g.kind === "hardlopen") return { ...base, kind: "duur", sport: "hardlopen", title, note, ...(g.km ? { distanceKm: g.km } : {}) };
  return { ...base, kind: "wod", title, note };
}

/* Tussendoelen in een week verwerken: aanloop, wedstrijd en herstel.
   lighten(item, "minder" | "rustig") komt uit de planner. */
export function applySubGoals(items, settings, mondayISO, { lighten, newId }) {
  const mon = dayNum(mondayISO);
  const subs = subGoals(settings).filter((g) => {
    const r = dayNum(g.date);
    return r >= mon - 1 && r <= mon + 9; // aanloop (3 dagen) en herstel (1 dag) kunnen over de week heen vallen
  });
  if (!subs.length) return { items, touched: false };
  let out = [...items];
  for (const g of subs) {
    const r = dayNum(g.date);
    const label = goalLabel(g);
    const why = (t) => `${t} vanwege uw tussendoel ${label} op ${new Date(g.date + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}.`;
    out = out
      .map((x) => {
        if (x.slot === "RACE" || x.slot === "M_MOB" || x.status !== "gepland") return x;
        const off = dayNum(x.date) - r;
        if (off === 0) return null;
        if (off === -1) {
          if (x.kind === "kracht") return null;
          if (!x.hard) return x;
          const y = lighten(x, "rustig");
          return { ...y, targetMin: Math.min(30, y.targetMin || 30), note: why("Kort en rustig") };
        }
        if ((off === -2 || off === -3) && x.hard) return { ...lighten(x, "minder"), note: why("Iets korter, zelfde intensiteit,") };
        if (off === 1 && (x.hard || x.kind === "kracht")) return { ...lighten(x, "rustig"), note: why("Herstel") };
        return x;
      })
      .filter(Boolean);
    if (r >= mon && r <= mon + 6) out.push(raceItem(g, newId));
  }
  return { items: out, touched: true };
}

/* Aftellen voor het scherm Vandaag: het eerstvolgende doel, of null. */
export function countdown(settings, todayISO) {
  const t = dayNum(todayISO);
  const next = allGoals(settings).find((g) => dayNum(g.date) >= t);
  if (!next) return null;
  const main = mainGoal(settings);
  const days = dayNum(next.date) - t;
  return {
    goal: next,
    label: goalLabel(next),
    days,
    main: main && dayNum(main.date) >= t ? { ...main, label: goalLabel(main), days: dayNum(main.date) - t } : null,
  };
}

/* Waarschuwing: een tussendoel vlak vóór het hoofddoel kost frisheid. */
export function subWarning(sub, settings) {
  const main = mainGoal(settings);
  if (!main || !validISO(sub.date)) return null;
  const gap = dayNum(main.date) - dayNum(sub.date);
  if (gap > 0 && gap < 14) return `Ligt ${gap} ${gap === 1 ? "dag" : "dagen"} voor uw hoofddoel. Daar gaat de taper voor; overweeg om dit tussendoel rustig te lopen of over te slaan.`;
  if (gap < 0) return "Ligt na uw hoofddoel. Het schema plant hier wel omheen.";
  return null;
}

/* Dagen tot de wedstrijd waarop de voeding naar onderhoud gaat. */
export const RACE_WEEK_DAYS = 6;

/* Voeding rond het hoofddoel, voor dag `iso`. estMin: verwachte duur.
   - de laatste week (6 dagen ervoor tot en met de wedstrijd): een cut gaat
     naar onderhoud, zodat u met volle voorraden start;
   - koolhydraten stapelen: langer dan 90 minuten de laatste 36–48 uur
     10 g/kg (twee dagen), anders de dag ervoor 8 g/kg (7–10 g/kg)
     (Burke L.M. e.a. 2011, J Sports Sci 29 S1; Thomas D.T. e.a. 2016,
     ACSM-standpunt, Med Sci Sports Exerc 48(3)). */
export function raceDayFuel(settings, iso, estMin = 90) {
  const main = mainGoal(settings);
  if (!main) return null;
  const left = dayNum(main.date) - dayNum(iso);
  if (left < 0 || left > RACE_WEEK_DAYS) return null;
  const long = estMin > 90;
  const loadDays = long ? [1, 2] : [1];
  return { goal: main, label: goalLabel(main), left, race: left === 0, long, perKg: loadDays.includes(left) ? (long ? 10 : 8) : null };
}

/* Oud gebruik (aftelkaart): load = vandaag of morgen extra koolhydraten. */
export function raceFuel(settings, todayISO, estMin = 90) {
  const r = raceDayFuel(settings, todayISO, estMin);
  return r ? { ...r, load: r.perKg != null } : null;
}

/* Koolhydraten ophogen tot perKg: eerst vet tot het minimum ruilen, de rest
   komt erbij (een stapeldag mag boven onderhoud uitkomen). */
export function carbLoadMacros(m, weight, perKg, minFatPerKg = 0.6) {
  const target = perKg * weight;
  if (!(m.carbs < target)) return m;
  const need = (target - m.carbs) * 4;
  const fatRoom = Math.max(0, (m.fat - minFatPerKg * weight) * 9);
  const fromFat = Math.min(need, fatRoom);
  const fat = m.fat - fromFat / 9;
  const carbs = target;
  return { ...m, fat, carbs, kcal: m.protein * 4 + fat * 9 + carbs * 4, loaded: true };
}

export const isoPlus = (iso, n) => isoOfNum(dayNum(iso) + n);
