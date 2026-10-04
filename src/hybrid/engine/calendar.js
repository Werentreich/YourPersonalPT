/* Welke sessies komen in de agenda? De opgeslagen weken van het schema
   (vanaf twee weken terug) plus een voorbeeld van de komende weken die nog
   niet gemaakt zijn. Dat voorbeeld wordt bij aanvang van de week opnieuw
   berekend met wat u dan gedaan hebt; de agenda volgt vanzelf. */
import { normalizeStore, dayNum, isoOfNum, mondayOf } from "./model.js";
import { previewWeek } from "./weeks.js";

export function calendarItems(raw, todayISO, weeksAhead = 3) {
  const d = normalizeStore(raw);
  if (!d.plan) return [];
  const from = isoOfNum(dayNum(todayISO) - 14);
  const stored = d.plan.items.filter((x) => x.date >= from);
  const known = new Set(Object.keys(d.plan.weeks || {}));
  const out = [...stored];
  const m0 = mondayOf(todayISO);
  for (let w = 0; w <= weeksAhead; w++) {
    const monday = isoOfNum(dayNum(m0) + w * 7);
    if (known.has(monday) || stored.some((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6))) continue;
    // stabiele id's voor voorbeeldweken, zodat de agenda geen dubbele afspraken maakt
    const wk = previewWeek(d, todayISO, monday);
    wk.items.forEach((x, i) => out.push({ ...x, id: `p${monday.replace(/-/g, "")}${i}` }));
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
