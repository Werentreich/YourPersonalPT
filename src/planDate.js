/* Meerwekenplan (voeding) met een einddatum (zuiver, zonder React).

   De horizon van het plan kan op drie manieren:
   - weken: een vast aantal weken vanaf de startdatum;
   - datum: tot een zelf gekozen dag;
   - wedstrijd: tot het hoofddoel uit het trainingsschema (src/hybrid,
     settings.goalDate). Verandert die datum in het trainingsschema, dan
     schuift de horizon mee, zodat voeding en training naar dezelfde dag
     werken.
   Zonder eigen keuze volgt het plan de wedstrijd als die er is.

   De laatste week van een plan dat op een wedstrijd eindigt, is de
   wedstrijdweek: een cut staat dan op onderhoud (zie raceDayFuel in
   src/hybrid/engine/goals.js), zodat u met volle voorraden start. */

const DAY = 864e5;
const dn = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
const valid = (iso) => typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(dn(iso));

export const MIN_WEEKS = 4;
export const MAX_WEEKS = 78;

/* Aantal planweken vanaf start tot en met de einddag. */
export const weeksUntil = (startISO, endISO) => Math.ceil((dn(endISO) - dn(startISO) + 1) / 7);

/* Welke horizon geldt? raceDate: hoofddoel uit het trainingsschema of null. */
export function planHorizon({ mode, weeks, endDate, raceDate, start }) {
  const m = mode || (valid(raceDate) && raceDate >= start ? "wedstrijd" : "weken");
  const end = m === "wedstrijd" ? (valid(raceDate) ? raceDate : null) : m === "datum" ? (valid(endDate) ? endDate : null) : null;
  if (!end || !valid(start)) return { mode: m, weeks: Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Number(weeks) || 26)), end: null, raw: null };
  const raw = weeksUntil(start, end);
  return { mode: m, weeks: Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, raw)), end, raw, tooShort: raw < MIN_WEEKS, tooLong: raw > MAX_WEEKS, past: end < start };
}

/* Doel eerder bereikt dan de wedstrijd: tot de wedstrijd onderhoud, zodat
   voeding en training op dezelfde dag eindigen. */
export function padToWeeks(rows, weeks) {
  if (!rows || !rows.length || rows.length >= weeks) return rows;
  const last = rows[rows.length - 1];
  const pad = Array.from({ length: weeks - rows.length }, (_, k) => ({
    week: (last.week || rows.length) + k + 1,
    phase: "onderhoud",
    weight: last.weight,
    bodyFat: last.bodyFat,
    kcal: last.tdee,
    tdee: last.tdee,
    note: k === 0 ? "Doel bereikt: onderhoud tot de wedstrijd, zodat u het resultaat vasthoudt en fris aan de start staat." : null,
  }));
  return [...rows, ...pad];
}

/* Laatste week = wedstrijdweek: een tekort wordt onderhoud. */
export function withRaceWeek(rows, label) {
  if (!rows || !rows.length) return rows;
  const last = rows[rows.length - 1];
  const note = `Wedstrijdweek${label ? ` (${label})` : ""}: onderhoud, zodat u fris en met volle voorraden start; de dag ervoor extra koolhydraten.`;
  if (last.phase === "cut" || last.phase === "minicut") return [...rows.slice(0, -1), { ...last, phase: "onderhoud", kcal: last.tdee, note, raceWeek: true }];
  return [...rows.slice(0, -1), { ...last, note: last.note || note, raceWeek: true }];
}

/* Eindigt een actief plan rond de wedstrijd? (binnen drie dagen) */
export function planMatchesRace(autoStart, weeks, raceDate) {
  if (!valid(autoStart) || !valid(raceDate) || !weeks) return true;
  const lastDay = dn(autoStart) + weeks * 7 - 1;
  return Math.abs(lastDay - dn(raceDate)) <= 6 && dn(raceDate) <= lastDay;
}
