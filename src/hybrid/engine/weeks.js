/* Weken van het schema vastleggen: deze week én volgende week.

   - Volgende week staat altijd klaar en is aan te passen (verplaatsen,
     lichter maken, overslaan). Hij wordt berekend alsof de rest van deze
     week gaat zoals gepland ("projectie"), zodat bijvoorbeeld het volgende
     niveau van het startersprogramma al zichtbaar is.
   - Begint die week, dan rekent de app opnieuw met wat er echt gebeurde.
     Sessies die u zelf hebt aangepast blijven staan; de rest wordt alleen
     vervangen als er iets verandert, en de wijzigingen worden getoond.

   Puur JavaScript, zodat de tests het los draaien. */

import { dayNum, isoOfNum, mondayOf } from "./model.js";
import { generateWeek, SLOTS } from "./planner.js";

const DAY = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const endOf = (monday) => isoOfNum(dayNum(monday) + 6);
const inWeek = (x, monday) => x.date >= monday && x.date <= endOf(monday);
const dayName = (iso) => DAY[(dayNum(iso) - dayNum(mondayOf(iso))) % 7];

/* Geplande sessies omzetten naar "gedane" sessies voor de projectie. */
export function projectSessions(items, fromISO, toISO) {
  return (items || [])
    .filter((x) => x.status === "gepland" && !x.optional && x.date >= fromISO && x.date <= toISO && x.slot !== "M_MOB")
    .map((x) => ({
      id: `proj-${x.id}`,
      date: x.date,
      kind: x.kind,
      sport: x.sport,
      type: x.type,
      title: x.title,
      durationSec: (x.targetMin || 0) * 60 || null,
      rpe: x.rpeTarget != null ? x.rpeTarget : 5,
      blocks: x.blocks || [],
      source: "projectie",
      createdAt: 0,
    }));
}

/* Context voor een week in de toekomst: echte sessies plus de geplande
   sessies tussen vandaag en die week, alsof ze gedaan zijn. */
export function projectedCtx(d, todayISO, monday) {
  const until = isoOfNum(dayNum(monday) - 1);
  const proj = projectSessions(d.plan.items, todayISO, until);
  const projIds = new Set(proj.map((p) => p.id.slice(5)));
  return {
    sessions: [...(d.sessions || []), ...proj],
    profile: d.profile,
    checkins: d.checkins,
    planItems: d.plan.items.map((x) => (projIds.has(x.id) ? { ...x, status: "gedaan" } : x)),
  };
}

const meta = (wk, V, extra = {}) => ({ v: V, phase: wk.phase, phaseInfo: wk.phaseInfo, reasons: wk.reasons, factor: wk.factor, enduranceMin: wk.enduranceMin, ...extra });

/* Nieuwe sessies samenvoegen met wat er al staat in [from, eind van de week]:
   gedane/overgeslagen en zelf aangepaste sessies blijven; de rest wordt
   vervangen, met hetzelfde id als slot en dag gelijk blijven. */
function merge(items, fresh, monday, from) {
  const end = endOf(monday);
  const zone = (x) => x.date >= from && x.date <= end;
  const old = items.filter((x) => zone(x) && x.status === "gepland");
  const kept = old.filter((x) => x.edited);
  const replaced = old.filter((x) => !x.edited);
  const busy = new Set(items.filter((x) => inWeek(x, monday) && x.status !== "gepland").map((x) => x.date));
  // slots die al door een eigen aanpassing worden ingevuld, niet dubbel
  const held = {};
  kept.forEach((x) => (held[x.slot] = (held[x.slot] || 0) + 1));
  const used = new Set();
  const add = [];
  for (const f of fresh) {
    if (f.date < from || busy.has(f.date)) continue;
    if (held[f.slot]) {
      held[f.slot]--;
      continue;
    }
    const same = replaced.find((r) => !used.has(r.id) && r.slot === f.slot && r.date === f.date);
    if (same) used.add(same.id);
    add.push(same ? { ...f, id: same.id } : f);
  }
  const others = items.filter((x) => !(zone(x) && x.status === "gepland" && !x.edited));
  return { items: [...others, ...add], replaced, added: add };
}

/* Wat is er anders dan wat de sporter zag? Korte zinnen per dag. */
export function describeChanges(before, after) {
  const out = [];
  const label = (x) => `${x.title || (SLOTS[x.slot] || {}).label || "training"}${x.targetMin ? ` (${x.targetMin} min)` : ""}`;
  const byKey = (x) => `${x.slot}|${x.date}`;
  const a = new Map(after.map((x) => [byKey(x), x]));
  const b = new Map(before.map((x) => [byKey(x), x]));
  for (const x of before) {
    const y = a.get(byKey(x));
    if (!y) {
      const moved = after.find((z) => z.slot === x.slot && !b.has(byKey(z)));
      out.push(moved ? `${label(x)}: van ${dayName(x.date)} naar ${dayName(moved.date)}` : `${dayName(x.date)}: ${label(x)} vervalt`);
    } else if (y.title !== x.title || y.targetMin !== x.targetMin) out.push(`${dayName(x.date)}: ${label(x)} → ${label(y)}`);
  }
  for (const y of after) if (!b.has(byKey(y)) && !before.some((x) => x.slot === y.slot && !a.has(byKey(x)))) out.push(`${dayName(y.date)}: nieuw, ${label(y)}`);
  return out.slice(0, 8);
}

/* Deze week en volgende week op orde brengen. Geeft het (eventueel nieuwe)
   plan terug; ongewijzigd = hetzelfde object. */
export function ensurePlanWeeks(d, todayISO, V) {
  let plan = d.plan;
  if (!plan) return plan;
  const m0 = mondayOf(todayISO);
  const m1 = isoOfNum(dayNum(m0) + 7);
  const start = mondayOf(plan.settings.startDate || m0);

  // deze week
  if (m0 >= start) {
    const known = (plan.weeks || {})[m0];
    if (!known || (known.v || 1) < V || known.projected) {
      const ctx = { sessions: d.sessions, profile: d.profile, checkins: d.checkins, planItems: plan.items };
      const wk = generateWeek(plan.settings, ctx, m0);
      const from = known ? todayISO : m0;
      const r = merge(plan.items, wk.items, m0, from);
      const changes = known && known.projected ? describeChanges(r.replaced, r.added) : [];
      plan = { ...plan, items: r.items, weeks: { ...(plan.weeks || {}), [m0]: meta(wk, V, changes.length ? { changes } : {}) } };
    }
  }

  // volgende week: vooruit, op basis van de projectie
  if (m1 >= start) {
    const known1 = (plan.weeks || {})[m1];
    if (!known1 || (known1.v || 1) < V) {
      const ctx = projectedCtx({ ...d, plan }, todayISO, m1);
      const wk = generateWeek(plan.settings, ctx, m1);
      const r = merge(plan.items, wk.items, m1, m1);
      plan = { ...plan, items: r.items, weeks: { ...(plan.weeks || {}), [m1]: meta(wk, V, { projected: true }) } };
    }
  }
  return plan;
}

/* Voorbeeld van een week verder weg (niet opgeslagen), op dezelfde manier
   geprojecteerd vanuit alles wat er tot die week gepland staat. */
export function previewWeek(d, todayISO, monday) {
  const ctx = projectedCtx(d, todayISO, monday);
  return generateWeek(d.plan.settings, ctx, monday);
}

/* Plan na een wijziging van de instellingen: alles na deze week opnieuw. */
export function dropFuture(plan, todayISO) {
  const end = endOf(mondayOf(todayISO));
  const weeks = Object.fromEntries(Object.entries(plan.weeks || {}).filter(([k]) => k <= end));
  return { ...plan, items: plan.items.filter((x) => x.date <= end || x.status !== "gepland"), weeks };
}
