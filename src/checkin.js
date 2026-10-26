/* Wekelijkse check-in: hoe ging de voeding? (zuiver, zonder React)

   De bijsturing kijkt naar het gewichtsverloop. Dat verloop zegt iets over
   wat u werkelijk at, niet over het schema. Liep een paar dagen anders
   (minder of meer gegeten), dan corrigeert de app daarvoor:

   - het tempo: het gewichtsverloop zoals het zou zijn als u het schema had
     gevolgd (verloop min het effect van de afwijkende dagen);
   - het gemeten onderhoud: uw werkelijke inname, niet de voorgeschreven.

   Zo verhoogt de app uw calorieën niet omdat u sneller afviel door een
   paar dagen minder te eten, en verlaagt hij ze niet omdat u een feestje
   had. Per afwijkende dag kiest u een grootte; dat is een schatting, en
   bij veel afwijkende dagen (vier of meer) stuurt de app niet bij maar
   vraagt eerst het schema te volgen. */

export const DEV_SIZES = {
  klein: { kcal: 250, label: "Een beetje", hint: "± 250 kcal, bijvoorbeeld een tussendoortje meer of minder" },
  flink: { kcal: 500, label: "Flink", hint: "± 500 kcal, bijvoorbeeld een maaltijd overgeslagen of een uitgebreid diner" },
  veel: { kcal: 1000, label: "Veel", hint: "± 1000 kcal of meer, bijvoorbeeld een feest of een dag nauwelijks gegeten" },
};
export const SLECHT_DAYS = 4;

const DAY = 864e5;
const isoPlus = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

/* De zeven dagen waar een check-in op `dateISO` over gaat: de week tot en
   met gisteren (de check-in doet u 's ochtends). */
export const checkinDays = (dateISO) => Array.from({ length: 7 }, (_, k) => isoPlus(dateISO, k - 7));

/* Afwijking per dag (kcal, negatief = minder gegeten). */
export function dayDeviations(food) {
  const out = {};
  if (!food || !food.days) return out;
  const less = (DEV_SIZES[food.less] || DEV_SIZES.flink).kcal;
  const more = (DEV_SIZES[food.more] || DEV_SIZES.flink).kcal;
  for (const [iso, v] of Object.entries(food.days)) {
    if (v === "minder") out[iso] = -less;
    else if (v === "meer") out[iso] = more;
  }
  return out;
}

/* Samenvatting van een week. */
export function foodSummary(food) {
  const dev = dayDeviations(food);
  const vals = Object.values(dev);
  const lessDays = vals.filter((v) => v < 0).length;
  const moreDays = vals.filter((v) => v > 0).length;
  const week = vals.reduce((a, v) => a + v, 0);
  return { offDays: lessDays + moreDays, lessDays, moreDays, week, perDay: Math.round(week / 7) };
}

/* Trouw volgt uit de afwijkende dagen. */
export function adherenceOf(food) {
  const { offDays } = foodSummary(food);
  return offDays === 0 ? "goed" : offDays < SLECHT_DAYS ? "meestal" : "slecht";
}

/* Gemiddelde afwijking per dag (kcal) over [fromISO, toISO], uit alle
   check-ins. Dagen zonder check-in tellen als volgens schema. */
export function deviationBetween(checkins, fromISO, toISO) {
  if (!fromISO || !toISO || toISO < fromISO) return 0;
  const all = {};
  for (const c of checkins || []) Object.assign(all, dayDeviations(c && c.food));
  const n = Math.round((Date.parse(toISO) - Date.parse(fromISO)) / DAY) + 1;
  let total = 0;
  for (let k = 0; k < n; k++) total += all[isoPlus(fromISO, k)] || 0;
  return n > 0 ? total / n : 0;
}

/* kg per week door een afwijking van `perDay` kcal per dag (zelfde
   energiewaarden als de coach: 7700 kcal per kg verlies, 5500 per kg aanzet). */
export const kgOfDeviation = (perDay) => (perDay * 7) / (perDay < 0 ? 7700 : 5500);

/* Het tempo zoals het met het schema was geweest. */
export function adjustTrend(trend, perDay) {
  if (!trend || !trend.ok || !perDay) return trend;
  return { ...trend, raw: trend.kgPerWeek, devPerDay: perDay, kgPerWeek: trend.kgPerWeek - kgOfDeviation(perDay) };
}

/* Venster van een gewichtstrend: van (laatste meting - span) tot de laatste meting. */
export function trendWindow(log, span) {
  const dates = (log || []).filter((e) => e && e.weight > 0 && e.date).map((e) => e.date).sort();
  if (!dates.length) return null;
  const to = dates[dates.length - 1];
  return { from: isoPlus(to, -Math.round(span || 0)), to };
}
