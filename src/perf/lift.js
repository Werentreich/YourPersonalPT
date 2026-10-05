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
  return { itemId: item.id, title: item.title || "Kracht", kind: item.kind || "kracht", start: now, blocks, rest: null };
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
    notes: "",
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
