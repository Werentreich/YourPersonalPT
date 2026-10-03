/* Hybride voeding: energie en koolhydraten die meebewegen met de training.

   - Rustmetabolisme en eiwit zoals in Nexa (Mifflin-St Jeor of, met
     vetpercentage, Katch-McArdle; eiwit 1,8–2,2 g/kg of naar vetvrije massa).
     De interface geeft Nexa's eigen rustverbruik mee, zodat beide apps
     hetzelfde rekenen; zonder Nexa-profiel valt dit terug op dezelfde
     formules met een activiteitsfactor.
   - Verbruik per sessie met MET-waarden (Ainsworth B.E. e.a. 2011,
     Compendium of Physical Activities), netto zoals Nexa:
     (MET − 1) × 3,5 × kg / 200 × minuten. Met vermogensdata (fietsen):
     kJ arbeid ≈ kcal verbruik (bij ~24% efficiëntie).
   - Koolhydraten per dag naar belasting (Thomas D.T., Erdman K.A.,
     Burke L.M. 2016, ACSM/AND/DC-standpunt, Med Sci Sports Exerc 48(3)):
     licht 3–5, gemiddeld 5–7, zwaar 6–10, zeer zwaar 8–12 g/kg.
     "Fuel for the work required": een zware sessie morgen telt mee
     (Impey S.G. e.a. 2018, Sports Med 48(5)).
   - Tijdens de training: vanaf ~60–75 min 30–60 g/u, boven 2,5 uur tot
     90 g/u met glucose + fructose (Jeukendrup A. 2014, Sports Med 44(S1)).
     Vocht 0,4–0,8 l/u, natrium 300–600 mg/u bij lange of warme sessies
     (Sawka M.N. e.a. 2007, ACSM-standpunt).
   - Na de training: 0,3 g/kg eiwit; bij minder dan 8 uur tot de volgende
     sessie 1,0–1,2 g/kg/u koolhydraten in de eerste uren (ACSM 2016).
   - Wedstrijd: carb-loading 10–12 g/kg/dag 36–48 uur vooraf bij > 90 min;
     ontbijt 1–4 g/kg 1–4 uur vooraf; cafeïne 3–6 mg/kg ~60 min vooraf
     (Guest N.S. e.a. 2021, ISSN-standpunt).
   - Energiebeschikbaarheid: (inname − trainingsverbruik) / vetvrije massa;
     onder 30 kcal/kg VVM per dag is een risico (Mountjoy M. e.a. 2018,
     IOC-consensus RED-S). */

import { num, dayNum, isoOfNum, mondayOf, SPORTS } from "./model.js";
import { durationOf, pillarSplit } from "./load.js";
import { pillarShares, blocksOf } from "./blocks.js";

/* ---------------- basis ---------------- */
export function calcBMR({ sex, weight, height, age, bodyFat, useBodyFat }) {
  if (useBodyFat && bodyFat >= 4 && bodyFat <= 60) return 370 + 21.6 * (weight * (1 - bodyFat / 100));
  return sex === "man" ? 10 * weight + 6.25 * height - 5 * age + 5 : 10 * weight + 6.25 * height - 5 * age - 161;
}

export function proteinPerKg({ weight, bodyFat, useBodyFat, goal }) {
  if (useBodyFat && bodyFat >= 4 && bodyFat <= 60) {
    const lbm = weight * (1 - bodyFat / 100);
    const f = goal === "cut" ? 2.6 : goal === "bulk" ? 2.2 : 2.3;
    return (lbm * f) / weight;
  }
  return goal === "cut" ? 2.2 : goal === "bulk" ? 1.8 : 1.9;
}

/* Vetvrije massa (kg): uit het vetpercentage, anders een schatting. */
export const ffmOf = (n) => n.weight * (1 - (n.useBodyFat && n.bodyFat >= 4 && n.bodyFat <= 60 ? n.bodyFat : n.sex === "vrouw" ? 25 : 15) / 100);

/* Gecombineerd voedingsprofiel. n: { sex, age, height, weight, bodyFat,
   useBodyFat, goal (cut/onderhoud/bulk), rate (% lichaamsgewicht per week),
   restKcal? (uit Nexa), activityFactor?, proteinPerKg? } */
export function nutritionBase(n) {
  const w = num(n.weight, 75);
  const base = { sex: n.sex || "man", age: num(n.age, 30), height: num(n.height, 178), weight: w, bodyFat: num(n.bodyFat, 0), useBodyFat: !!n.useBodyFat, goal: n.goal || "onderhoud" };
  const bmr = calcBMR(base);
  const rest = num(n.restKcal) || bmr * (num(n.activityFactor) || 1.35);
  const rate = num(n.rate, base.goal === "cut" ? -0.5 : base.goal === "bulk" ? 0.25 : 0);
  // dagelijks tekort of overschot zoals Nexa: 7700 kcal per kg afvallen, 5500 per kg aankomen
  const delta = base.goal === "onderhoud" ? 0 : ((rate / 100) * w * (base.goal === "bulk" ? 5500 : 7700)) / 7;
  return { ...base, bmr, rest, delta, rate, protein: num(n.proteinPerKg) || proteinPerKg(base), ffm: ffmOf(base) };
}

/* ---------------- verbruik per sessie ---------------- */
const RUN = { herstel: 7, rustig: 8.5, lang: 8.5, techniek: 7.5, tempo: 10.5, fartlek: 10, drempel: 11, interval: 11.5, heuvel: 11, wedstrijd: 12 };
const ENDURANCE_MET = {
  hardlopen: RUN,
  fietsen: { herstel: 5.5, rustig: 6.8, lang: 7, tempo: 8.5, drempel: 9.5, interval: 10, wedstrijd: 10.5 },
  roeien: { herstel: 4.8, rustig: 6, lang: 6.5, tempo: 8.5, drempel: 9.5, interval: 11, wedstrijd: 12 },
  skierg: { herstel: 4.8, rustig: 6, lang: 6.5, tempo: 8.5, drempel: 9.5, interval: 11, wedstrijd: 12 },
  zwemmen: { herstel: 5, rustig: 6, lang: 6.5, tempo: 8.3, drempel: 9.5, interval: 10, wedstrijd: 10 },
  wandelen: { herstel: 3.5, rustig: 4.3, lang: 5, tempo: 6.5 },
  stepper: { rustig: 8.8, tempo: 9.5, interval: 10 },
  multisport: { rustig: 7.5, lang: 7.5, tempo: 9.5, interval: 10.5, wedstrijd: 11 },
};
const PILLAR_MET = { kracht: 5, conditie: 8.5, mobiliteit: 2.5 };

export const netKcal = (met, minutes, weight) => Math.max(0, (((met - 1) * 3.5 * weight) / 200) * minutes);

/* Werkt voor vastgelegde sessies en geplande sessies (targetMin). */
export function sessionKcal(s, weight) {
  const minutes = s.planned ? num(s.targetMin, 0) : (durationOf(s) || 0) / 60;
  if (!minutes) return 0;
  if (s.kind === "duur") {
    if (s.sport === "fietsen" && num(s.avgPower) && num(s.durationSec)) return Math.round((num(s.avgPower) * num(s.durationSec)) / 1000);
    const t = ENDURANCE_MET[s.sport] || RUN;
    const met = t[s.type] || t.rustig || 7;
    return Math.round(netKcal(met, minutes, weight));
  }
  if (s.kind === "mobiliteit") return Math.round(netKcal(PILLAR_MET.mobiliteit, minutes, weight));
  if (s.kind === "hyrox" && !(s.blocks || []).length) return Math.round(netKcal(9.5, minutes, weight));
  // gemengde sessies: per pijler naar verhouding van de blokken
  const shares = s.planned ? pillarShares((s.blocks || []).filter((b) => b.type !== "vrij"), s.kind === "kracht" ? "kracht" : "conditie") : pillarSplit(s);
  let met = 0;
  for (const [p, sh] of Object.entries(shares)) met += sh * (p === "duur" ? 8.5 : PILLAR_MET[p] || 6);
  if (s.kind === "hyrox") met = Math.max(met, 9);
  return Math.round(netKcal(met || 6, minutes, weight));
}

/* Zwaarte van een sessie: minuten en of hij intensief is. */
function sessionLoadClass(s) {
  const minutes = s.planned ? num(s.targetMin, 0) : (durationOf(s) || 0) / 60;
  const hard = s.planned ? !!s.hard : ["tempo", "drempel", "interval", "heuvel", "wedstrijd", "fartlek"].includes(s.type) || s.kind === "wod" || s.kind === "hyrox" || num(s.rpe, 0) >= 7;
  return { minutes, hard, kind: s.kind, long: minutes >= 90 };
}

/* ---------------- dagklassen ---------------- */
export const DAY_CLASSES = {
  rust: { label: "Rustdag", carbs: [3, 4, 5], text: "Geen of alleen lichte training." },
  licht: { label: "Lichte dag", carbs: [4, 4.5, 5], text: "Korte of rustige training." },
  gemiddeld: { label: "Gemiddelde dag", carbs: [5, 6, 6.5], text: "Ongeveer een uur, of een stevige sessie." },
  zwaar: { label: "Zware dag", carbs: [6.5, 7.5, 8], text: "Lang of zwaar, of twee sessies." },
  zeerzwaar: { label: "Zeer zware dag", carbs: [8, 9, 10], text: "Meer dan 2,5 uur of een wedstrijd." },
};
const ORDER = ["rust", "licht", "gemiddeld", "zwaar", "zeerzwaar"];
const goalIdx = (goal) => (goal === "cut" ? 0 : goal === "bulk" ? 2 : 1);

/* Dagklasse uit de sessies van vandaag en morgen. */
export function dayClass(todaySessions, tomorrowSessions = []) {
  const ls = todaySessions.map(sessionLoadClass).filter((x) => x.kind !== "mobiliteit" || x.minutes > 30);
  const total = ls.reduce((a, x) => a + x.minutes, 0);
  const anyHard = ls.some((x) => x.hard);
  const race = todaySessions.some((s) => s.type === "wedstrijd" || s.slot === "RACE");
  let c = "rust";
  const reasons = [];
  if (race || total >= 150) {
    c = "zeerzwaar";
    reasons.push(race ? "wedstrijddag" : `${Math.round(total)} min training`);
  } else if (total >= 90 || ls.length >= 2 || (anyHard && total >= 75)) {
    c = "zwaar";
    reasons.push(ls.length >= 2 ? "twee sessies" : `${Math.round(total)} min training${anyHard ? ", deels intensief" : ""}`);
  } else if (total >= 50 || anyHard) {
    c = "gemiddeld";
    reasons.push(`${Math.round(total)} min${anyHard ? ", intensief" : ""}`);
  } else if (total > 0) {
    c = "licht";
    reasons.push(`${Math.round(total)} min rustig`);
  }
  // morgen een lange of zware sessie: vandaag al bijtanken
  const tm = tomorrowSessions.map(sessionLoadClass);
  const tmLong = tm.some((x) => x.long) || tomorrowSessions.some((s) => s.type === "wedstrijd" || s.slot === "RACE");
  const tmHard = tm.some((x) => x.hard && x.minutes >= 45);
  if (tmLong && ORDER.indexOf(c) < ORDER.indexOf("gemiddeld")) {
    c = "gemiddeld";
    reasons.push("morgen een lange sessie of wedstrijd");
  } else if (tmHard && c === "rust") {
    c = "licht";
    reasons.push("morgen een zware sessie");
  }
  return { cls: c, reasons, minutes: total };
}

/* ---------------- doelen per dag ---------------- */
export function dayTargets(base, todaySessions, tomorrowSessions = []) {
  const { cls, reasons, minutes } = dayClass(todaySessions, tomorrowSessions);
  const w = base.weight;
  const exercise = todaySessions.reduce((a, s) => a + sessionKcal(s, w), 0);
  let kcal = base.rest + exercise + base.delta;
  const carbsPerKg = DAY_CLASSES[cls].carbs[goalIdx(base.goal)];
  const protein = Math.round(base.protein * w);
  let carbs = Math.round(carbsPerKg * w);
  const fatMin = Math.round(0.8 * w);
  let fat = Math.round((kcal - protein * 4 - carbs * 4) / 9);
  const notes = [];
  let raised = false;
  if (fat < fatMin) {
    // eerst koolhydraten omlaag: tot de cut-waarde van één klasse lager (nooit
    // onder 3 g/kg), pas daarna meer energie
    const lower = ORDER[Math.max(0, ORDER.indexOf(cls) - 1)];
    const floorCarbs = Math.round(Math.max(3, DAY_CLASSES[lower].carbs[0]) * w);
    carbs = Math.max(floorCarbs, Math.round((kcal - protein * 4 - fatMin * 9) / 4));
    fat = Math.round((kcal - protein * 4 - carbs * 4) / 9);
    if (fat < fatMin) {
      fat = fatMin;
      kcal = protein * 4 + carbs * 4 + fat * 9;
      raised = true;
      notes.push("Uw tekort is te groot voor deze trainingsdag. Vandaag eet u iets meer, zodat u genoeg brandstof heeft.");
    }
  }
  const intake = protein * 4 + carbs * 4 + fat * 9;
  const ea = (intake - exercise) / base.ffm;
  if (ea < 30) notes.push(`Lage energiebeschikbaarheid (${Math.round(ea)} kcal per kg vetvrije massa). Langdurig onder 30 is een risico voor herstel, hormonen en botten. Overweeg een kleiner tekort.`);
  return { cls, label: DAY_CLASSES[cls].label, reasons, minutes, exercise: Math.round(exercise), kcal: Math.round(intake), protein, carbs, fat, carbsPerKg: Math.round((carbs / w) * 10) / 10, ea: Math.round(ea), raised, notes };
}

/* ---------------- rond de training ---------------- */
export function fuelingFor(s, weight, { nextWithinHours = null } = {}) {
  const L = sessionLoadClass(s);
  const min = L.minutes;
  const out = { before: null, during: null, after: null, fluids: null };
  if (!min) return out;
  const w = weight;
  const r5 = (x) => Math.round(x / 5) * 5;
  // vooraf
  if (min >= 90 || (L.hard && min >= 60)) out.before = `1–4 uur vooraf een maaltijd met ${r5(1 * w)}–${r5(2 * w)} g koolhydraten, weinig vet en vezels.`;
  else if (L.hard || min >= 45) out.before = "Licht verteerbaar: een banaan of boterham 1–2 uur vooraf.";
  else out.before = "Niets bijzonders nodig; train niet met een lege maag als u zich dan slap voelt.";
  // tijdens
  if (min >= 150) out.during = "60–90 g koolhydraten per uur, liefst glucose én fructose (sportdrank, gels, repen). Begin na 20–30 min en neem elke 15–20 min wat.";
  else if (min >= 75) out.during = "30–60 g koolhydraten per uur: sportdrank, gel of banaan.";
  else if (L.hard && min >= 45) out.during = "Water volstaat; spoelen met sportdrank kan het tempo helpen.";
  else out.during = "Water volstaat.";
  // vocht
  if (min >= 60) out.fluids = `0,4–0,8 liter per uur${min >= 120 ? ", met 300–600 mg natrium per uur (zeker bij warmte of veel zweten)" : ""}.`;
  // na
  const prot = r5(0.3 * w);
  if (nextWithinHours != null && nextWithinHours < 8) out.after = `Snel herstellen: ${prot} g eiwit en ${r5(1 * w)}–${r5(1.2 * w)} g koolhydraten per uur in de eerste 3–4 uur; de volgende sessie volgt binnen ${Math.round(nextWithinHours)} uur.`;
  else if (s.kind === "kracht") out.after = `Binnen een paar uur een maaltijd met ${prot} g eiwit.`;
  else out.after = `Een gewone maaltijd met ${prot} g eiwit en koolhydraten${min >= 90 || L.hard ? "; vul de voorraad goed aan" : ""}.`;
  return out;
}

/* ---------------- wedstrijd ---------------- */
export function raceNutrition(goal, weight, estMinutes) {
  const w = weight;
  const r5 = (x) => Math.round(x / 5) * 5;
  const long = estMinutes >= 90;
  return {
    estMinutes,
    loading: long
      ? `Carb-loading: de laatste 36–48 uur ${r5(10 * w)}–${r5(12 * w)} g koolhydraten per dag (10–12 g/kg), met minder vezels en vet. U wordt daar 1–2 kilo zwaarder van; dat is opgeslagen glycogeen en vocht.`
      : `De dag ervoor ruim koolhydraten (${r5(7 * w)}–${r5(10 * w)} g, 7–10 g/kg); echt carb-loaden is bij minder dan 90 minuten niet nodig.`,
    breakfast: `2–4 uur voor de start een bekend ontbijt met ${r5(1 * w)}–${r5(3 * w)} g koolhydraten (1–3 g/kg). Niets nieuws op de wedstrijddag.`,
    caffeine: `Optioneel: ${Math.round(3 * w)}–${Math.round(6 * w)} mg cafeïne (3–6 mg/kg) zo'n 60 minuten voor de start, alleen als u het in training heeft geprobeerd.`,
    during: estMinutes >= 150 ? "60–90 g koolhydraten per uur met glucose en fructose, vanaf het begin." : estMinutes >= 75 ? "30–60 g koolhydraten per uur; bij Hyrox bijvoorbeeld een gel halverwege." : "Water of een slok sportdrank is genoeg.",
    after: `Herstel: ${r5(0.3 * w)} g eiwit en ${r5(1 * w)}–${r5(1.2 * w)} g koolhydraten per uur in de eerste uren.`,
  };
}

/* Verwachte wedstrijdduur in minuten. */
export function raceMinutes(goal, profile) {
  const t5 = num(profile && profile.run5k);
  const riegel = (km) => (t5 ? (t5 * Math.pow(km / 5, 1.06)) / 60 : null);
  if (goal === "5k") return riegel(5) || 30;
  if (goal === "10k") return riegel(10) || 60;
  if (goal === "halve") return riegel(21.1) || 120;
  if (goal === "marathon") return riegel(42.2) || 255;
  if (goal === "hyrox") return 90;
  return 60;
}

/* ---------------- week ---------------- */
/* Sessies van een dag: vastgelegd gaat voor, anders gepland (niet overgeslagen). */
export function sessionsOfDay(iso, sessions, planItems) {
  const done = sessions.filter((s) => s.date === iso);
  const doneIds = new Set(done.map((s) => s.planItemId).filter(Boolean));
  const planned = (planItems || []).filter((x) => x.date === iso && x.status === "gepland" && !doneIds.has(x.id) && !x.optional);
  return [...done, ...planned];
}

export function weekNutrition(base, mondayISO, sessions, planItems) {
  return Array.from({ length: 7 }, (_, d) => {
    const iso = isoOfNum(dayNum(mondayISO) + d);
    const tomorrow = isoOfNum(dayNum(mondayISO) + d + 1);
    return { date: iso, ...dayTargets(base, sessionsOfDay(iso, sessions, planItems), sessionsOfDay(tomorrow, sessions, planItems)) };
  });
}

/* Uren tot de volgende sessie (voor snel herstel bij twee keer per dag). */
export function hoursToNext(s, sessions, planItems) {
  const all = [...sessionsOfDay(s.date, sessions, planItems), ...sessionsOfDay(isoOfNum(dayNum(s.date) + 1), sessions, planItems)].filter((x) => x.id !== s.id);
  if (!all.length) return null;
  const sameDay = all.filter((x) => x.date === s.date);
  return sameDay.length ? 6 : 20; // zonder kloktijden: zelfde dag ≈ 6 uur, volgende dag ≈ 20 uur
}

export { SPORTS };
