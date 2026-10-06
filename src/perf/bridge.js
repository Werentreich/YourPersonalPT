/* Eén krachtsysteem voor de hele app.

   Het hybride schema (src/hybrid/engine/planner.js) bepaalt de week: welke
   dagen kracht zijn, welke duur of conditie, herstel en lichtere weken. De
   krachttraining zelf loopt via het programma van Nexa-bodybuilding: vaste
   dagen met oefeningen die de gebruiker bewerkt, progressievoorstellen,
   warming-ups, technieken en records.

   Deze module zet het een in het ander om (zuiver, zonder React):
   - startprogramma uit de krachtsessies van het hybride schema
   - een programmadag terug naar blokken, voor het weekoverzicht
   - een afgeronde Nexa-training naar een hybride sessie (belasting, schema
     op gedaan, voeding, coach) */

import { blockHeader, itemLine } from "../hybrid/engine/blocks.js";

/* Hybride beweging -> Nexa-oefening. Wat Nexa niet kent, wordt een eigen
   oefening (CUSTOM hieronder). */
export const TO_NEXA = {
  back_squat: "squat",
  front_squat: "front_squat",
  bench_press: "bankdrukken",
  incline_db: "schuin_db",
  db_bench: "db_bankdrukken",
  bb_row: "barbell_row",
  db_row: "db_row",
  lat_pulldown: "lat_pulldown",
  lateral_raise: "lateral_raise",
  leg_curl: "seated_leg_curl",
  calf_raise: "standing_calf",
  rdl: "rdl",
  strict_pull_ups: "optrekken",
  weighted_pull_ups: "optrekken",
  pull_ups: "optrekken",
  bulgarian: "bulgarian_split_squat",
  strict_press: "overhead_press",
  face_pull: "face_pull",
  hip_thrust: "hip_thrust",
  walking_lunges: "walking_lunge",
  hanging_knee_raise: "hanging_leg_raise",
  leg_press: "leg_press",
  kb_goblet: "goblet_squat",
  push_ups: "push_ups",
  smith_incline: "smith_schuin",
  chest_press_machine: "chest_press",
};

const X = (name, equip, kind, pri, sec, lo, hi, bw = 1) => ({ name, equip, kind, pri, sec, lengthened: false, unilateral: false, repMin: lo, repMax: hi, bw, custom: true, hybrid: true });
export const CUSTOM = {
  box_jumps: X("Box jumps", "lichaam", "compound", ["quadriceps"], ["bilspieren"], 3, 5, 0),
  pogo: X("Pogo hops", "lichaam", "isolation", ["kuiten"], [], 10, 20, 0),
  broad_jumps: X("Broad jumps", "lichaam", "compound", ["quadriceps"], ["bilspieren"], 3, 5, 0),
  jump_squats: X("Squat jumps", "lichaam", "compound", ["quadriceps"], ["bilspieren"], 5, 8, 0),
  sl_rdl: X("Eenbenige Roemeense deadlift", "dumbbell", "compound", ["hamstrings"], ["bilspieren"], 8, 12),
  trap_bar_dl: X("Trap bar deadlift", "stang", "compound", ["quadriceps"], ["hamstrings", "bilspieren"], 4, 8),
  landmine_press: X("Landmine press", "stang", "compound", ["schouder_voor"], ["triceps"], 6, 10),
  push_press: X("Push press", "stang", "compound", ["schouder_voor"], ["triceps"], 3, 6),
  dead_bug: X("Dead bug", "lichaam", "isolation", ["buik"], [], 8, 12, 0),
  pallof: X("Pallof press", "kabel", "isolation", ["buik"], [], 10, 12),
  side_plank: X("Zijplank (seconden)", "lichaam", "isolation", ["buik"], [], 20, 45, 0),
  hollow_hold: X("Hollow hold (seconden)", "lichaam", "isolation", ["buik"], [], 20, 40, 0),
  copenhagen: X("Copenhagen plank (seconden)", "lichaam", "isolation", ["buik"], [], 15, 30, 0),
  tib_raise: X("Tibialis raises", "lichaam", "isolation", ["kuiten"], [], 12, 20, 0),
  kb_press: X("Kettlebell press", "dumbbell", "compound", ["schouder_voor"], ["triceps"], 6, 10),
  db_step_ups: X("Dumbbell step-ups", "dumbbell", "compound", ["quadriceps"], ["bilspieren"], 8, 12),
  step_ups: X("Step-ups", "lichaam", "compound", ["quadriceps"], ["bilspieren"], 8, 12),
  renegade_row: X("Renegade rows", "dumbbell", "compound", ["rug"], ["buik"], 8, 12),
  kb_swings: X("Kettlebell swings", "dumbbell", "compound", ["bilspieren"], ["hamstrings"], 12, 20),
  inverted_rows: X("Inverted rows", "lichaam", "compound", ["rug"], ["biceps"], 8, 12, 0.6),
  pike_push_ups: X("Pike push-ups", "lichaam", "compound", ["schouder_voor"], ["triceps"], 6, 12, 0.7),
  nordic: X("Nordic curls", "lichaam", "isolation", ["hamstrings"], [], 4, 8, 0.7),
  hr_push_ups: X("Hand-release push-ups", "lichaam", "compound", ["borst"], ["triceps"], 8, 15, 0.65),
  pistols: X("Pistol squats", "lichaam", "compound", ["quadriceps"], ["bilspieren"], 5, 8),
  cossack: X("Cossack squats", "lichaam", "compound", ["quadriceps"], ["bilspieren"], 6, 10),
  smith_bench: X("Smith machine bankdrukken", "smith", "compound", ["borst"], ["triceps", "schouder_voor"], 6, 10),
  smith_squat: X("Smith machine squat", "smith", "compound", ["quadriceps"], ["bilspieren"], 6, 10),
  smith_press: X("Smith machine schouderdrukken", "smith", "compound", ["schouder_voor"], ["triceps"], 6, 10),
};
export const customId = (moveId) => `hyb_${moveId}`;

/* Nexa-oefening voor een hybride beweging, en de eigen oefeningen die
   daarvoor nodig zijn. `known`: ids die Nexa al kent (EXERCISES + eigen). */
export function nexaExFor(moveId, name, known) {
  if (!moveId) return { id: null };
  if (moveId.startsWith("nexa:")) return { id: moveId.slice(5) };
  if (TO_NEXA[moveId] && known.has(TO_NEXA[moveId])) return { id: TO_NEXA[moveId] };
  const id = customId(moveId);
  if (known.has(id)) return { id };
  const def = CUSTOM[moveId] || X(name || moveId, "machine", "compound", ["borst"], [], 8, 12);
  return { id, create: { ...def, id } };
}

const SLOT_ORDER = ["K_FULL_A", "K_FULL_B", "K_FULL_C", "K_FULL", "K_UPPER", "K_LOWER", "K_PUMP"];
export const dayName = (title) => String(title || "Kracht").split(" + ")[0].replace(/\s*\((ochtend|avond)\)\s*$/i, "").trim();

/* Programmadag uit de blokken van een geplande krachtsessie. */
export function dayFromItem(item, known, uid) {
  const created = [];
  const slots = [];
  for (const b of item.blocks || []) {
    if (b.type !== "sets") continue;
    const items = b.items || [];
    items.forEach((it, k) => {
      const ex = nexaExFor(it.moveId, it.name, known);
      if (!ex.id) return;
      if (ex.create && !created.some((c) => c.id === ex.id)) {
        created.push(ex.create);
        known.add(ex.id);
      }
      const work = (it.sets || []).filter((s) => s.kind !== "warmup");
      const t = (work[0] && work[0].target) || {};
      const lo = t.sec || t.reps || (ex.create && ex.create.repMin) || 8;
      const hi = t.sec || t.repsMax || lo;
      slots.push({
        id: uid(),
        exId: ex.id,
        sets: Math.max(1, work.length || 3),
        warmups: b.name === "Hoofdoefeningen" ? 2 : 0,
        repMin: lo,
        repMax: Math.max(lo, hi),
        rest: it.restSec || 90,
        rir: t.rir != null ? t.rir : null,
        note: it.note || (b.name === "Explosief" ? "Maximaal explosief, volledig herstellen." : ""),
        ...(b.superset && items.length > 1 && k < items.length - 1 ? { ss: true, ssRest: 15 } : {}),
      });
    });
  }
  return { day: { id: uid(), name: dayName(item.title), slot: item.slot, slots }, created };
}

/* Startprogramma voor de krachtsessies in het hybride schema: één dag per
   soort krachtsessie (A, B, C, boven, onder, pomp). */
export function programFromPlan(planItems, known, uid, today) {
  const bySlot = {};
  const items = (planItems || []).filter((x) => x.kind === "kracht" && x.slot && (x.blocks || []).some((b) => b.type === "sets"));
  // voorkeur: de eerstvolgende geplande sessie per soort (actuele dosering)
  for (const x of [...items].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (bySlot[x.slot] && !(bySlot[x.slot].date < today && x.date >= today)) continue;
    bySlot[x.slot] = x;
  }
  const slots = Object.keys(bySlot).sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  const customEx = [];
  const days = slots.map((s) => {
    const r = dayFromItem(bySlot[s], known, uid);
    customEx.push(...r.created);
    return r.day;
  });
  if (!days.length) return null;
  return {
    program: { id: uid(), name: "Kracht bij mijn hybride schema", perf: true, mode: "week", days, weekMap: Array(7).fill(null), rotation: days.map((d) => d.id), created: today },
    customEx,
  };
}

/* Soorten krachtsessies in het schema waarvoor het programma nog geen dag
   heeft (bijvoorbeeld na een wijziging van 2 naar 4 krachtdagen). */
export function missingSlots(program, planItems) {
  const have = new Set((program.days || []).map((d) => d.slot).filter(Boolean));
  return [...new Set((planItems || []).filter((x) => x.kind === "kracht" && x.slot && x.status === "gepland").map((x) => x.slot))].filter((s) => !have.has(s));
}

export const dayForItem = (program, item) => (program && item ? (program.days || []).find((d) => d.slot === item.slot) || null : null);

/* Algemene warming-up van een geplande sessie, voor bovenaan de
   Nexa-training: [{ text, how }]. De opbouwsets per oefening staan los
   daarvan in het programma (warmups). */
export function warmupOf(item) {
  return ((item && item.blocks) || [])
    .filter((b) => b.type !== "sets" && b.role === "warmup")
    .map((b) => {
      const head = blockHeader(b, { withName: false });
      const lines = (b.items || []).map((it) => itemLine(it, b));
      return { text: !lines.length || head === lines.join(" + ") ? head : `${head}: ${lines.join(", ")}`, how: b.intensity || "" };
    });
}

/* Programmadag als blokken (voor het weekoverzicht, de agenda en de coach).
   De warming-up van het hybride schema blijft staan. */
export function blocksFromDay(day, exIndex, item) {
  const warm = (item.blocks || []).filter((b) => b.type !== "sets" && b.role === "warmup");
  const groups = [];
  let cur = null;
  for (const s of day.slots || []) {
    if (!cur) cur = [];
    cur.push(s);
    if (!s.ss) {
      groups.push(cur);
      cur = null;
    }
  }
  if (cur) groups.push(cur);
  const blocks = groups.map((g, i) => ({
    id: `${item.id}-n${i}`,
    type: "sets",
    name: g.length > 1 ? `Superset ${String.fromCharCode(65 + groups.slice(0, i).filter((x) => x.length > 1).length)}` : undefined,
    superset: g.length > 1,
    items: g.map((s) => {
      const ex = exIndex[s.exId] || {};
      return {
        moveId: `nexa:${s.exId}`,
        name: ex.name || s.exId,
        restSec: s.rest,
        repRange: s.repMin === s.repMax ? `${s.repMin}` : `${s.repMin}–${s.repMax}`,
        note: s.note || undefined,
        sets: Array.from({ length: Math.max(1, s.sets || 1) }, () => ({ kg: null, reps: s.repMin, rir: null, target: { reps: s.repMin, repsMax: s.repMax, rir: s.rir } })),
      };
    }),
    result: {},
  }));
  return [...warm, ...blocks];
}

const strip = (blocks) => JSON.stringify((blocks || []).map((b) => (b.type === "sets" ? (b.items || []).map((i) => [i.moveId, i.sets.length, i.repRange, i.restSec, i.note || ""]) : b.role)));

/* Geplande krachtsessies die moeten meebewegen met het programma. */
export function itemsToSync(planItems, program, exIndex, today) {
  const out = {};
  for (const x of planItems || []) {
    if (x.kind !== "kracht" || x.status !== "gepland" || x.date < today) continue;
    const day = dayForItem(program, x);
    if (!day) continue;
    const blocks = blocksFromDay(day, exIndex, x);
    if (strip(blocks) !== strip(x.blocks)) out[x.id] = blocks;
  }
  return out;
}

/* Afgeronde Nexa-training -> hybride sessie (gekoppeld aan het schema). */
export function perfSessionFromNexa(s, exIndex) {
  const items = (s.exercises || []).map((e) => {
    const ex = exIndex[e.exId] || {};
    return {
      moveId: `nexa:${e.exId}`,
      name: ex.name || e.exId,
      sets: (e.sets || []).map((x) => ({ kg: x.weight ?? null, reps: x.reps ?? null, rir: x.rir ?? null, ...(x.type === "warmup" ? { kind: "warmup" } : {}) })),
    };
  });
  return {
    id: `nx_${s.id}`,
    nexaId: s.id,
    date: s.date,
    kind: "kracht",
    title: s.name,
    rpe: null,
    notes: s.note || "",
    source: "nexa",
    createdAt: s.end || s.start || Date.now(),
    planItemId: s.perfItemId || undefined,
    durationSec: s.end && s.start ? Math.max(60, Math.round((s.end - s.start) / 1000)) : null,
    blocks: items.length ? [{ id: `nx_${s.id}-b`, type: "sets", items, result: {} }] : [],
  };
}

/* Lichtere sessie in het hybride schema (herstel- of taperweek, of door de
   planner lichter gemaakt): minder werksets in de Nexa-training. */
export const isLight = (item) => !!item && (item.changed === "minder" || (item.rpeTarget != null && item.rpeTarget <= 5));
export function lighten(exercises) {
  return exercises.map((e) => {
    const work = e.sets.filter((s) => s.type === "work");
    const keep = Math.max(1, Math.ceil(work.length * 0.6));
    let n = 0;
    return { ...e, sets: e.sets.filter((s) => s.type !== "work" || ++n <= keep) };
  });
}
