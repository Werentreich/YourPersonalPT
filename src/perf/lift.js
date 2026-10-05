/* Krachttraining live afwerken, zoals in Nexa-bodybuilding: per set kg en
   herhalingen invullen, afvinken, en de rust loopt vanzelf af.

   Werkt op een geplande sessie uit het schema (kracht of hybride). Blokken
   van het type "sets" worden per set afgevinkt; andere blokken (warming-up,
   intervallen, metcon) vinkt u in één keer af.

   live = {
     itemId, title, start,
     blocks: [kopie van de blokken; bij "sets" krijgt elke set done/t],
     rest: { endsAt, total, next, kind } | null      kind: rust | wissel
   } */

import { num, newId, localISO } from "../hybrid/engine/model.js";

export const LIFT_KEY = "nexa:perf-lift";
export const SWITCH_SEC = 15; // wisselen binnen een superset
const DEFAULT_REST = 90;

const setsBlocks = (blocks) => (blocks || []).filter((b) => b.type === "sets" && (b.items || []).some((it) => (it.sets || []).length));

/* Kan deze geplande sessie set voor set worden afgewerkt? */
export const liftable = (item) => !!item && item.status === "gepland" && setsBlocks(item.blocks).length > 0;

/* Laatste keer dat deze beweging is gedaan: datum en de werksets. */
export function lastFor(sessions, moveId, name) {
  let best = null;
  for (const s of sessions || []) {
    for (const b of s.blocks || []) {
      if (b.type !== "sets") continue;
      for (const it of b.items || []) {
        if (!(moveId ? it.moveId === moveId : it.name === name)) continue;
        const sets = (it.sets || []).filter((x) => x.kind !== "warmup" && (num(x.reps) || num(x.sec)));
        if (!sets.length) continue;
        const key = `${s.date}|${s.createdAt || 0}`;
        if (!best || key > best.key) best = { key, date: s.date, sets };
      }
    }
  }
  return best && { date: best.date, sets: best.sets };
}

export const isTimed = (it) => (it.sets || []).some((x) => x.target && x.target.sec);

export function lastText(last, timed) {
  if (!last) return null;
  const kg = last.sets.find((x) => num(x.kg) != null);
  const amounts = last.sets.map((x) => (timed ? `${num(x.sec, 0)} s` : num(x.reps, 0))).join(", ");
  return kg && num(kg.kg) ? `${String(kg.kg).replace(".", ",")} kg × ${amounts}` : amounts;
}

/* Begin van de training: kopie van het schema, kg van de vorige keer als het
   schema er geen voorstelt. */
export function startLift(item, sessions, now = Date.now()) {
  const blocks = (item.blocks || []).map((b) => {
    const c = JSON.parse(JSON.stringify(b));
    if (c.type !== "sets") return { ...c, done: false };
    c.items = (c.items || []).map((it) => {
      const last = lastFor(sessions, it.moveId, it.name);
      const lastKg = last && last.sets.map((x) => num(x.kg)).find((v) => v != null);
      return {
        ...it,
        sets: (it.sets || []).map((s) => ({ ...s, kg: s.kg != null ? s.kg : lastKg != null ? lastKg : null, reps: null, sec: null, rir: null, done: false })),
      };
    });
    return c;
  });
  return { itemId: item.id, title: item.title || "Kracht", kind: item.kind || "kracht", start: now, blocks, rest: null, note: item.userNote || "" };
}

/* Volgorde waarin de sets worden gedaan. Superset: per ronde één set van elke
   oefening (A1, A2, A1, A2 …); anders alle sets van een oefening achter elkaar. */
export function order(live) {
  const out = [];
  live.blocks.forEach((b, bi) => {
    if (b.type !== "sets") {
      out.push({ bi, ii: null, j: null });
      return;
    }
    const items = b.items || [];
    if (b.superset && items.length > 1) {
      const rounds = Math.max(0, ...items.map((it) => (it.sets || []).length));
      for (let j = 0; j < rounds; j++) items.forEach((it, ii) => j < (it.sets || []).length && out.push({ bi, ii, j }));
    } else items.forEach((it, ii) => (it.sets || []).forEach((_, j) => out.push({ bi, ii, j })));
  });
  return out;
}

const isDone = (live, p) => (p.ii == null ? !!live.blocks[p.bi].done : !!live.blocks[p.bi].items[p.ii].sets[p.j].done);
const same = (a, b) => a.bi === b.bi && a.ii === b.ii && a.j === b.j;

export function stepName(live, p) {
  if (!p) return null;
  const b = live.blocks[p.bi];
  if (p.ii == null) return b.name || (b.role === "cooldown" ? "Cooling-down" : b.role === "warmup" ? "Warming-up" : "Volgend blok");
  const it = b.items[p.ii];
  return `${it.name}, set ${p.j + 1}`;
}

/* Na het afvinken van positie p: wat is de volgende stap en hoe lang rust? */
export function nextStep(live, p) {
  const seq = order(live);
  const k = seq.findIndex((x) => same(x, p));
  const next = seq.slice(k + 1).find((x) => !isDone(live, x)) || seq.slice(0, Math.max(0, k)).find((x) => !isDone(live, x)) || null;
  if (!next || p.ii == null) return { next, rest: 0, kind: "rust" };
  const b = live.blocks[p.bi];
  const it = b.items[p.ii];
  const ss = b.superset && (b.items || []).length > 1;
  // in een superset: kort wisselen naar de volgende oefening van dezelfde ronde
  if (ss && next.bi === p.bi && next.j === p.j && next.ii > p.ii) return { next, rest: SWITCH_SEC, kind: "wissel" };
  const rest = ss ? Math.max(...b.items.map((x) => num(x.restSec, 0))) || DEFAULT_REST : num(it.restSec, DEFAULT_REST) || DEFAULT_REST;
  return { next, rest, kind: "rust" };
}

/* Set afvinken (of weer openzetten). Geeft { live, error? } terug. */
export function toggleSet(live, bi, ii, j, now = Date.now()) {
  const b = live.blocks[bi];
  if (ii == null) {
    const blocks = live.blocks.map((x, k) => (k === bi ? { ...x, done: !x.done } : x));
    return { live: { ...live, blocks, rest: null } };
  }
  const it = b.items[ii];
  const s = it.sets[j];
  const timed = isTimed(it);
  if (!s.done && !(timed ? num(s.sec) > 0 : num(s.reps) > 0)) return { live, error: timed ? "Vul eerst het aantal seconden in." : "Vul eerst het aantal herhalingen in." };
  const sets = it.sets.map((x, m) => (m === j ? { ...x, done: !x.done, t: !x.done ? now : undefined } : x));
  const blocks = live.blocks.map((x, k) => (k === bi ? { ...x, items: x.items.map((y, n) => (n === ii ? { ...y, sets } : y)) } : x));
  const after = { ...live, blocks };
  if (s.done) return { live: { ...after, rest: null } };
  const st = nextStep(after, { bi, ii, j });
  const rest = st.next && st.rest > 0 ? { endsAt: now + st.rest * 1000, total: st.rest, next: stepName(after, st.next), kind: st.kind } : null;
  return { live: { ...after, rest }, next: st.next, finished: !st.next };
}

/* Waarde in een set wijzigen. Een nieuw gewicht geldt ook voor de volgende,
   nog open sets met hetzelfde gewicht (zoals in Nexa). */
export function setField(live, bi, ii, j, key, val) {
  const blocks = live.blocks.map((b, k) => {
    if (k !== bi) return b;
    return {
      ...b,
      items: b.items.map((it, n) => {
        if (n !== ii) return it;
        const cur = it.sets[j];
        const sets = it.sets.map((s, m) => {
          if (m === j) return { ...s, [key]: val };
          if (key === "kg" && m > j && !s.done && s.kind !== "warmup" && s.kg === cur.kg) return { ...s, kg: val };
          return s;
        });
        return { ...it, sets };
      }),
    };
  });
  return { ...live, blocks };
}

export function addSet(live, bi, ii) {
  const blocks = live.blocks.map((b, k) =>
    k !== bi
      ? b
      : {
          ...b,
          items: b.items.map((it, n) => (n !== ii ? it : { ...it, sets: [...it.sets, { ...(it.sets[it.sets.length - 1] || {}), reps: null, sec: null, rir: null, done: false, t: undefined }] })),
        },
  );
  return { ...live, blocks };
}

export function removeSet(live, bi, ii) {
  const blocks = live.blocks.map((b, k) => {
    if (k !== bi) return b;
    return {
      ...b,
      items: b.items.map((it, n) => {
        if (n !== ii || it.sets.length <= 1) return it;
        const j = it.sets.map((s) => !s.done).lastIndexOf(true);
        return j < 0 ? it : { ...it, sets: it.sets.filter((_, m) => m !== j) };
      }),
    };
  });
  return { ...live, blocks };
}

export function progress(live) {
  let total = 0;
  let done = 0;
  for (const b of live.blocks) if (b.type === "sets") for (const it of b.items || []) for (const s of it.sets || []) if (s.kind !== "warmup") (total++, s.done && done++);
  return { total, done };
}

export const anyDone = (live) => live.blocks.some((b) => (b.type === "sets" ? (b.items || []).some((it) => (it.sets || []).some((s) => s.done)) : b.done));

/* Afgeronde training naar een sessie om op te slaan (met planItemId, zodat
   de geplande sessie op gedaan gaat). Alleen afgevinkte sets tellen. */
export function liftToSession(live, now = Date.now()) {
  const blocks = [];
  for (const b of live.blocks) {
    if (b.type !== "sets") {
      if (!b.done) continue;
      const { done, ...rest } = b;
      blocks.push({ ...rest, id: newId(), result: {} });
      continue;
    }
    const items = (b.items || [])
      .map((it) => ({
        ...it,
        sets: (it.sets || [])
          .filter((s) => s.done)
          .map((s) => ({ kg: s.kg ?? null, reps: s.reps ?? null, ...(num(s.sec) ? { sec: s.sec } : {}), rir: s.rir ?? null, ...(s.kind ? { kind: s.kind } : {}) })),
      }))
      .filter((it) => it.sets.length);
    if (items.length) blocks.push({ ...b, id: newId(), items, result: {} });
  }
  const startDate = localISO(new Date(live.start));
  return {
    id: newId(),
    date: startDate,
    kind: live.kind || "kracht",
    title: live.title,
    rpe: null,
    notes: String(live.note || "").trim(),
    source: "handmatig",
    live: true,
    createdAt: now,
    planItemId: live.itemId || undefined,
    durationSec: Math.max(60, Math.round((now - live.start) / 1000)),
    blocks,
  };
}

export function savedLift() {
  try {
    const t = JSON.parse(localStorage.getItem(LIFT_KEY) || "null");
    return t && Array.isArray(t.blocks) ? t : null;
  } catch (e) {
    return null;
  }
}

export function storeLift(t) {
  try {
    if (t) localStorage.setItem(LIFT_KEY, JSON.stringify(t));
    else localStorage.removeItem(LIFT_KEY);
  } catch (e) {
    /* privévenster: dan alleen in het geheugen */
  }
}

/* ---------------- oefeningen wisselen en toevoegen ---------------- */

/* Losse training zonder schema: begint leeg, oefeningen voegt u toe. */
export function emptyLift(title = "Krachttraining", now = Date.now()) {
  return { itemId: null, title, kind: "kracht", start: now, blocks: [], rest: null };
}

const timedMove = (mv) => !!mv && Array.isArray(mv.metrics) && mv.metrics[0] === "time";

function freshSets(mv, sessions, n, like) {
  const timed = timedMove(mv);
  const last = lastFor(sessions, mv.id, mv.name);
  const lastKg = last && last.sets.map((x) => num(x.kg)).find((v) => v != null);
  const t = (like && like.target) || {};
  const target = timed ? { reps: null, repsMax: null, rir: null, sec: t.sec || 30 } : { reps: t.reps || 8, repsMax: t.repsMax || 12, rir: t.rir != null ? t.rir : 2, sec: null };
  return Array.from({ length: n }, () => ({ kg: timed ? null : lastKg != null ? lastKg : null, reps: null, sec: null, rir: null, done: false, target }));
}

export function itemFor(mv, sessions, n, like) {
  const sets = freshSets(mv, sessions, n, like);
  const t = sets[0].target;
  return {
    moveId: mv.id || null,
    name: mv.name,
    reps: null,
    distanceM: null,
    timeSec: null,
    cal: null,
    kg: null,
    heightCm: null,
    perSide: !!mv.uni && !timedMove(mv),
    restSec: (like && like.restSec) || 90,
    repRange: t.sec ? null : `${t.reps}–${t.repsMax}`,
    sets,
  };
}

/* Oefening erbij, als eigen blok aan het eind (3 sets, 8–12 herhalingen). */
export function addExercise(live, mv, sessions) {
  const block = { id: newId(), type: "sets", name: live.itemId ? "Extra" : undefined, items: [itemFor(mv, sessions, 3, null)], result: {} };
  return { ...live, blocks: [...live.blocks, block] };
}

/* Oefening vervangen (toestel bezet, pijn, geen materiaal): zelfde aantal
   sets, herhalingsbereik en rust; kg van de vorige keer met de nieuwe
   oefening. Alleen zolang er nog geen set van is afgevinkt. */
export function swapExercise(live, bi, ii, mv, sessions) {
  const blocks = live.blocks.map((b, k) => {
    if (k !== bi) return b;
    return {
      ...b,
      items: b.items.map((it, n) => {
        if (n !== ii || it.sets.some((s) => s.done)) return it;
        return { ...itemFor(mv, sessions, it.sets.length, { target: (it.sets[0] || {}).target, restSec: it.restSec }), swappedFrom: it.name };
      }),
    };
  });
  return { ...live, blocks };
}

export function removeExercise(live, bi, ii) {
  const blocks = live.blocks.map((b, k) => (k !== bi ? b : { ...b, items: b.items.filter((it, n) => n !== ii || it.sets.some((s) => s.done)) })).filter((b) => b.type !== "sets" || b.items.length);
  return { ...live, blocks };
}

/* Spiergroep in één taal voor beide bibliotheken (Nexa splitst schouders,
   Hybrid noemt buik "core"). */
export const muscleKey = (m) => (!m ? null : m.startsWith("schouder") ? "schouders" : m === "buik" ? "core" : m === "trapezius" ? "rug" : m);

/* ---------------- vooraf aanpassen (PlanLiftEditor) ---------------- */

/* "8–10", "8-10" of "12" naar [laag, hoog]. */
export function parseRange(t) {
  const m = String(t || "").match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  if (!(lo >= 1 && lo <= 100 && hi >= lo && hi <= 100)) return null;
  return [lo, hi];
}

/* Wijzigingen op een oefening (zuiver, ook getest). */
export function setCount(it, n) {
  const k = Math.max(1, Math.min(10, n));
  const sets = it.sets.slice(0, k);
  while (sets.length < k) sets.push({ ...(it.sets[it.sets.length - 1] || {}), done: undefined });
  return { ...it, sets };
}
export function setRange(it, lo, hi) {
  return { ...it, repRange: lo === hi ? `${lo}` : `${lo}–${hi}`, sets: it.sets.map((s) => ({ ...s, reps: lo, target: { ...(s.target || {}), reps: lo, repsMax: hi } })) };
}
export function setKg(it, kg) {
  return { ...it, sets: it.sets.map((s) => (s.kind === "warmup" ? s : { ...s, kg })) };
}

