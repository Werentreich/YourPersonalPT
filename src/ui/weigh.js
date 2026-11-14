/* Snel wegen op Vandaag (zuiver, zonder React).

   Wegen is de enige dagelijkse invoer die de bijsturing nodig heeft. Daarom
   staat het veld op Vandaag zolang er vandaag nog niet is gewogen; daarna
   toont dezelfde regel het gewicht met het verschil over een week. */

const DAY = 864e5;
const dn = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);

export const validWeight = (w) => Number.isFinite(w) && w >= 30 && w <= 300;

/* log: [{ date, weight }]. Geeft de weging van vandaag, de laatste eerdere
   weging en het verschil van het zevendaags gemiddelde met een week eerder. */
export function weighSummary(log, todayISO) {
  const pts = (log || []).filter((e) => e && e.date && validWeight(Number(e.weight))).sort((a, b) => a.date.localeCompare(b.date));
  const today = pts.find((e) => e.date === todayISO) || null;
  const before = pts.filter((e) => e.date < todayISO);
  const last = before.length ? before[before.length - 1] : null;
  const t = dn(todayISO);
  const avg = (from, to) => {
    const xs = pts.filter((e) => dn(e.date) >= from && dn(e.date) <= to).map((e) => Number(e.weight));
    return xs.length >= 2 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const now = avg(t - 6, t);
  const prev = avg(t - 13, t - 7);
  return {
    today: today ? Number(today.weight) : null,
    last: last ? { date: last.date, weight: Number(last.weight), daysAgo: t - dn(last.date) } : null,
    avg7: now,
    weekDelta: now != null && prev != null ? now - prev : null,
    streak: (() => {
      let n = 0;
      const have = new Set(pts.map((e) => e.date));
      for (let d = today ? t : t - 1; have.has(new Date(d * DAY).toISOString().slice(0, 10)); d--) n++;
      return n;
    })(),
  };
}

/* Log met de weging van vandaag toegevoegd of vervangen. */
export function withWeight(log, dateISO, weight) {
  return [...(log || []).filter((e) => e.date !== dateISO), { date: dateISO, weight }].sort((a, b) => a.date.localeCompare(b.date));
}
