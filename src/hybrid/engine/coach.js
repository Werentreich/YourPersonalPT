/* AI-coach: wat de app naar de coach stuurt.

   Alleen afgeleide cijfers (belasting, vorm, minuten, verdeling, herstel,
   naleving van het schema), geen notities, geen routes, geen namen.

   Trainingen die uit Strava komen gaan NIET mee: de Strava API Agreement
   staat niet toe dat Strava-gegevens aan AI-diensten worden gegeven. Ze
   worden geteld zodat de coach weet dat het beeld onvolledig is.

   Puur JavaScript zonder React, zodat de tests het los draaien. */

import { KINDS, SPORTS, dayNum, isoOfNum, mondayOf, num, sessionTitle } from "./model.js";
import { fitnessSeries, formStatus, weekSummary, intensityDistribution, strengthRecords, rpeOf, durationOf } from "./load.js";
import { readinessFor, readinessAverage, READINESS_TEXT } from "./readiness.js";
import { GOALS, PHASES, EXPERIENCE, phaseFor } from "./planner.js";
import { titleOf } from "./blocks.js";

export const COACH_WEEKS = 4;
export const MAX_CONTEXT_CHARS = 12000;
export const MAX_QUESTION = 600;
export const MAX_HISTORY = 6;

const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r0 = (v) => (v == null || !isFinite(v) ? null : Math.round(v));

export const fromStrava = (s) => s.source === "strava";

export function buildCoachContext(data, todayISO) {
  const all = data.sessions || [];
  const own = all.filter((s) => !fromStrava(s));
  const skipped = all.length - own.length;
  const profile = data.profile || {};
  const plan = data.plan;
  const t = dayNum(todayISO);
  const monday = mondayOf(todayISO);

  const ctx = { vandaag: todayISO };

  const age = profile.birthYear ? new Date(todayISO).getUTCFullYear() - Number(profile.birthYear) : null;
  ctx.sporter = { geslacht: profile.sex === "vrouw" ? "vrouw" : "man", leeftijd: age, gewichtKg: r0(num(profile.weight)) };

  if (plan && plan.settings) {
    const s = plan.settings;
    const ph = phaseFor(s, monday);
    ctx.doel = {
      doel: (GOALS[s.goal] || GOALS.hybride).label,
      doeldatum: s.goalDate || null,
      wekenTotDoel: ph.weeksLeft,
      fase: (PHASES[ph.phase] || {}).label || ph.phase,
      trainingsdagenPerWeek: (s.days || []).length,
      ervaring: { kracht: EXPERIENCE[(s.exp || {}).kracht] || null, duur: EXPERIENCE[(s.exp || {}).duur] || null },
    };
  } else ctx.doel = null;

  // vorm (fitheid / vermoeidheid / vorm), alleen eigen trainingen
  const series = fitnessSeries(own, profile, isoOfNum(t - 1), todayISO);
  const p = series[series.length - 1];
  if (p) {
    const fs = formStatus(p);
    ctx.vorm = { fitheid: r0(p.ctl), vermoeidheid: r0(p.atl), vorm: r0(p.tsb), duiding: fs.label, genoegHistorie: fs.key !== "start" };
  }

  // laatste weken
  ctx.weken = [];
  for (let i = COACH_WEEKS - 1; i >= 0; i--) {
    const m = isoOfNum(dayNum(monday) - i * 7);
    const end = isoOfNum(dayNum(m) + 6);
    const w = weekSummary(own, profile, m);
    const dist = intensityDistribution(own, profile, m, end);
    const items = plan ? plan.items.filter((x) => x.date >= m && x.date <= end && !x.optional) : [];
    const past = items.filter((x) => x.date < todayISO || x.status !== "gepland");
    const sports = {};
    for (const [k, v] of Object.entries(w.sports)) sports[(SPORTS[k] || {}).label || k] = { km: r1(v.distanceM / 1000), min: r0(v.minutes) };
    ctx.weken.push({
      week: m,
      lopend: i === 0,
      trainingen: w.count,
      minuten: r0(w.minutes),
      belasting: r0(w.total),
      perPijler: Object.fromEntries(Object.entries(w.pillars).map(([k, v]) => [k, r0(v)])),
      sporten: sports,
      intensiteit: dist.share ? { rustig: r0(dist.share[1] * 100), midden: r0(dist.share[2] * 100), zwaar: r0(dist.share[3] * 100) } : null,
      schema: items.length ? { gepland: past.length, gedaan: past.filter((x) => x.status === "gedaan").length, overgeslagen: past.filter((x) => x.status === "overgeslagen").length } : null,
      herstelGemiddeld: readinessAverage(data.checkins || [], end < todayISO ? end : todayISO, 7),
    });
  }

  // recente trainingen (titel, soort, minuten, inspanning)
  ctx.recent = own
    .filter((s) => dayNum(s.date) > t - 14 && s.date <= todayISO)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 12)
    .map((s) => {
      const o = { datum: s.date, soort: (KINDS[s.kind] || {}).label || s.kind, titel: String(titleOf(s) || sessionTitle(s)).slice(0, 60), min: r0((durationOf(s) || 0) / 60), rpe: r1(rpeOf(s, profile)) };
      if (s.kind === "duur" && s.distanceM) o.km = r1(s.distanceM / 1000);
      return o;
    });

  // schema van deze week (wat nog komt)
  ctx.komend = plan
    ? plan.items
        .filter((x) => x.date >= todayISO && x.date <= isoOfNum(dayNum(monday) + 6) && x.status === "gepland")
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(0, 8)
        .map((x) => ({ datum: x.date, titel: String(x.title || "").slice(0, 60), min: x.targetMin || null, zwaar: !!x.hard }))
    : [];

  // herstel vandaag
  const rd = readinessFor(data.checkins || [], todayISO);
  ctx.herstel = rd.score != null ? { score: rd.score, niveau: (READINESS_TEXT[rd.level] || {}).label || rd.level, ingevuld: !!rd.checkedIn, signalen: (rd.notes || []).slice(0, 3) } : null;

  // krachtrecords (geschatte 1RM), top 5
  ctx.kracht = strengthRecords(own)
    .slice(0, 5)
    .map((x) => ({ oefening: String(x.name || "").slice(0, 40), e1rmKg: r0(x.e1rm) }));

  const n = data.nutrition || {};
  ctx.voedingsdoel = n.source === "eigen" ? n.goal || "onderhoud" : null;
  ctx.weggelaten = { stravaTrainingen: skipped };

  // te groot? oudste weken en recente trainingen inkorten
  let out = ctx;
  while (JSON.stringify(out).length > MAX_CONTEXT_CHARS && (out.recent.length > 3 || out.weken.length > 2)) {
    out = { ...out, recent: out.recent.slice(0, Math.max(3, out.recent.length - 3)), weken: out.weken.length > 2 ? out.weken.slice(1) : out.weken };
  }
  return out;
}

/* Gesprek inkorten tot wat de server accepteert. */
export function trimHistory(chat) {
  return (chat || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
}

/* Week waarvoor de analyse geldt (maandag). Na zaterdag: deze week,
   anders de afgelopen week plus wat er deze week al gedaan is. */
export const reviewWeekOf = (todayISO) => mondayOf(todayISO);
