/* Op welke dagen geldt een maaltijd? (zuiver, zonder React)

   De samenstelling van een maaltijd (welke producten) staat in lagen:
   alle dagen (def), per dagtype (training / rust) en per dag (0–6). Een dag
   leest de eerste laag die de maaltijd heeft: dag, dan dagtype, dan alle.
   De grammen volgen per dag uit de calorieën en macro's van die dag; hier
   gaat het alleen om de producten.

   De gebruiker kiest zelf de dagen. Die keuze wordt zo zuinig mogelijk
   opgeslagen:
   - alle zeven dagen        -> laag "alle", andere lagen voor deze maaltijd weg
   - precies alle dagen van één dagtype -> laag van dat type, daglagen van die
     dagen weg (zo volgt het schema als de trainingsdagen veranderen)
   - elke andere selectie    -> een eigen laag per gekozen dag
   Dagen die niet gekozen zijn, veranderen nooit. */

const clean = (items) => JSON.stringify((items || []).map((x) => x));
export const sameItems = (a, b) => clean(a) === clean(b);

/* Dagen (0–6) waarop deze maaltijd nu hetzelfde is als op `day`.
   `itemsOf(d)`: de producten van deze maaltijd op dag d. */
export function sharedDays(itemsOf, day) {
  const ref = itemsOf(day);
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => d === day || sameItems(itemsOf(d), ref));
}

const drop = (out, key, i) => {
  if (!out[key] || out[key][i] === undefined) return;
  const c = { ...out[key] };
  delete c[i];
  out[key] = c;
};
const copy = (items) => (items || []).map((x) => ({ ...x }));

/* Maaltijd `i` met `items` op precies deze dagen zetten. `types`: dagtype
   per dag ("training" of "rust"). Geeft nieuwe lagen terug. */
export function writeDays(plans, types, i, days, items) {
  const set = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const out = { ...(plans || {}) };
  if (!set.length) return out;
  if (set.length === 7) {
    for (let d = 0; d < 7; d++) drop(out, d, i);
    drop(out, "training", i);
    drop(out, "rust", i);
    out.def = { ...(out.def || {}), [i]: copy(items) };
    return out;
  }
  for (const t of ["training", "rust"]) {
    const ofType = [0, 1, 2, 3, 4, 5, 6].filter((d) => types[d] === t);
    if (ofType.length && ofType.length === set.length && ofType.every((d, k) => d === set[k])) {
      for (const d of set) drop(out, d, i);
      out[t] = { ...(out[t] || {}), [i]: copy(items) };
      return out;
    }
  }
  for (const d of set) out[d] = { ...(out[d] || {}), [i]: copy(items) };
  return out;
}

/* Korte omschrijving van een selectie dagen. */
export function daysLabel(days, types, selDay, short, full) {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "Alle dagen";
  if (set.length === 1 && set[0] === selDay) return `Alleen ${full[selDay].toLowerCase()}`;
  for (const [t, label] of [["training", "Alle trainingsdagen"], ["rust", "Alle rustdagen"]]) {
    const ofType = [0, 1, 2, 3, 4, 5, 6].filter((d) => types[d] === t);
    if (ofType.length && ofType.join() === set.join()) return label;
  }
  return set.map((d) => short[d]).join(", ");
}
