/* Geschatte duur van een training op basis van eerdere, soortgelijke
   trainingen (zuiver, zonder React).

   Het schema schat de duur uit sets, herhalingen en rust. In de praktijk
   duurt een training vaak langer: opbouwsets, wachten op een toestel,
   wisselen, drinken. Daarom leert de app per persoon hoe de werkelijke duur
   zich verhoudt tot de schatting:

     verhouding = werkelijke duur / geschatte duur van die keer

   De mediaan van de laatste vijf soortgelijke trainingen corrigeert de
   schatting van de volgende. Soortgelijk is eerst dezelfde soort sessie in
   het schema (bijvoorbeeld Kracht A), anders dezelfde soort training (kracht,
   hardlopen) zodra daar minstens twee van zijn. De mediaan houdt een
   uitschieter (training vergeten te stoppen) buiten de schatting; langer dan
   vier uur of een verhouding buiten 0,5–2,5 telt niet mee. */

export const LEARN_N = 5;
const MAX_SEC = 4 * 3600;
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.5;
const KIND_MIN = 2; // zonder dezelfde sessie: minstens twee van dezelfde soort

const pos = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* Verhouding uit metingen [{ sec, planned (min), at }]; nieuwste eerst. */
export function durationRatio(samples) {
  const ok = (samples || [])
    .filter((s) => pos(s.sec) && pos(s.planned) && s.sec <= MAX_SEC)
    .map((s) => ({ ...s, r: s.sec / 60 / s.planned }))
    .filter((s) => s.r >= MIN_RATIO && s.r <= MAX_RATIO)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, LEARN_N);
  if (!ok.length) return null;
  return { ratio: median(ok.map((s) => s.r)), n: ok.length };
}

/* Hybride schema: metingen uit vastgelegde sessies die bij een geplande
   sessie horen. De geschatte duur staat op de sessie (plannedMin) of, bij
   oudere sessies, op de geplande sessie zelf. */
function hybridSamples(sessions, byId) {
  const out = [];
  for (const s of sessions || []) {
    const it = s.planItemId ? byId[s.planItemId] : null;
    const planned = pos(s.plannedMin) || (it && pos(it.baseMin != null ? it.baseMin : it.targetMin));
    if (!planned || !pos(s.durationSec)) continue;
    out.push({ sec: Number(s.durationSec), planned, at: `${s.date || ""}|${s.createdAt || 0}`, slot: s.slot || (it && it.slot) || null, kind: s.kind || (it && it.kind) || null, sport: s.sport || (it && it.sport) || null });
  }
  return out;
}

/* Geleerde duur voor één geplande sessie, of null als er te weinig is. */
export function learnedMinutes(item, samples) {
  const base = pos(item.baseMin != null ? item.baseMin : item.targetMin);
  if (!base || item.status !== "gepland" || item.slot === "RACE") return null;
  const sameKind = (s) => s.kind === item.kind && (item.kind !== "duur" || (s.sport || "hardlopen") === (item.sport || "hardlopen"));
  let r = item.slot ? durationRatio(samples.filter((s) => s.slot === item.slot && sameKind(s))) : null;
  let tier = "sessie";
  if (!r) {
    r = durationRatio(samples.filter(sameKind));
    tier = "soort";
    if (r && r.n < KIND_MIN) r = null;
  }
  if (!r) return null;
  return { min: Math.max(5, Math.round(base * r.ratio)), base, n: r.n, tier };
}

/* Weergave van de opslag met geleerde duur in de geplande sessies.
   targetMin wordt de geleerde duur; baseMin bewaart de schatting van het
   schema. De opslag zelf verandert niet. */
export function withLearnedDurations(data) {
  if (!data || !data.plan || !Array.isArray(data.plan.items) || !(data.sessions || []).length) return data;
  const byId = Object.fromEntries(data.plan.items.map((x) => [x.id, x]));
  const samples = hybridSamples(data.sessions, byId);
  if (!samples.length) return data;
  let changed = false;
  const items = data.plan.items.map((x) => {
    const l = learnedMinutes(x, samples);
    if (!l) return x;
    changed = true;
    return { ...x, targetMin: l.min, baseMin: l.base, learned: { n: l.n, tier: l.tier, min: l.min } };
  });
  return changed ? { ...data, plan: { ...data.plan, items } } : data;
}

/* Terug naar de opslag (bijv. na bewerken): de schatting van het schema
   herstellen, tenzij de duur zelf is aangepast. */
export function unlearn(item) {
  if (!item || !item.learned) return item;
  const { learned, baseMin, ...rest } = item;
  return rest.targetMin === learned.min ? { ...rest, targetMin: baseMin } : rest;
}

/* Bij het vastleggen: de schatting en de soort sessie op de sessie zelf
   bewaren, zodat de meting blijft kloppen als het schema later verandert. */
export function stampPlanned(s, item) {
  if (!item) return s;
  const planned = pos(item.baseMin != null ? item.baseMin : item.targetMin);
  return { ...s, ...(s.plannedMin == null && planned ? { plannedMin: planned } : {}), ...(s.slot == null && item.slot ? { slot: item.slot } : {}) };
}

/* Nexa-training (programmadag): zelfde idee met de eerdere trainingen van
   dezelfde dag. est = schatting van nu; estMin op de training is de
   schatting van toen. Afgerond op 5 minuten, zoals de schatting zelf. */
export function learnedDayMinutes(day, sessions, est) {
  if (!day || !pos(est)) return null;
  const samples = (sessions || [])
    .filter((s) => s.dayId === day.id && s.start != null && s.end > s.start)
    .map((s) => ({ sec: (s.end - s.start) / 1000, planned: pos(s.estMin) || est, at: String(s.start).padStart(15, "0") }));
  const r = durationRatio(samples);
  if (!r) return null;
  return { min: Math.max(15, Math.round((est * r.ratio) / 5) * 5), base: est, n: r.n };
}

export const learnedNote = (n) => `op basis van uw ${n === 1 ? "vorige training" : `laatste ${n} trainingen`}`;
