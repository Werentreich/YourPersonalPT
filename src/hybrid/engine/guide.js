/* Begeleiding tijdens een live opname: de geplande training als reeks
   segmenten (inlopen, hardlopen, wandelen, rust, uitlopen), met de tekst
   die de app uitspreekt bij elke wissel.

   Een segment duurt een vaste tijd (sec) of een afstand (meters). De
   voortgang telt alleen de tijd/afstand terwijl de opname loopt; pauzeren
   pauzeert ook de begeleiding. Puur JavaScript, zonder browser. */

import { num } from "./model.js";
import { movementById } from "./movements.js";

const WALK = new Set(["ruck", "walk"]);

const say = (sec) => {
  if (sec == null) return "";
  if (sec < 60) return `${sec} seconden`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const mm = m === 1 ? "1 minuut" : `${m} minuten`;
  return s ? `${mm} ${s}` : mm;
};
const sayM = (m) => (m >= 1000 ? `${String(Math.round(m / 100) / 10).replace(".", ",")} kilometer` : `${m} meter`);

function label(it, b) {
  if (WALK.has(it.moveId)) return "Wandelen";
  if (b.role === "warmup") return "Inlopen";
  if (b.role === "cooldown") return "Uitlopen";
  const mv = movementById(it.moveId);
  if (it.moveId === "run") return "Hardlopen";
  return mv ? mv.name : it.name || "Werk";
}

/* Blokken van een geplande sessie naar segmenten. */
export function programFromBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === "doorlopend") {
      for (const it of b.items || []) {
        const sec = num(it.timeSec);
        const m = num(it.distanceM);
        if (!sec && !m) continue;
        out.push({ kind: WALK.has(it.moveId) ? "walk" : b.role === "warmup" ? "warmup" : b.role === "cooldown" ? "cooldown" : "work", label: label(it, b), sec: sec || null, meters: sec ? null : m, hint: b.intensity || null });
      }
    } else if (b.type === "interval") {
      const n = Math.max(1, num(b.rounds, 1));
      const it = (b.items || [])[0];
      if (!it) continue;
      const sec = num(it.timeSec);
      const m = num(it.distanceM);
      if (!sec && !m) continue;
      const rest = num(b.restSec, 0);
      for (let i = 0; i < n; i++) {
        out.push({ kind: "work", label: label(it, b), sec: sec || null, meters: sec ? null : m, hint: b.intensity || null, round: i + 1, rounds: n });
        if (rest && i < n - 1) out.push({ kind: b.restLabel === "Wandelen" ? "walk" : "rest", label: b.restLabel || "Rustig", sec: rest, round: i + 1, rounds: n });
      }
    }
  }
  return out;
}

/* Wat er wordt uitgesproken bij het begin van een segment. */
export function cueText(seg, next) {
  if (!seg) return "Training klaar. Goed gedaan!";
  const how = seg.sec ? say(seg.sec) : sayM(seg.meters);
  const round = seg.kind === "work" && seg.rounds > 1 ? `, ronde ${seg.round} van ${seg.rounds}` : "";
  return `${seg.label}, ${how}${round}.`;
}

/* Cursor: { index, startT, startD } = welk segment, en de opnametijd (s,
   zonder pauzes) en afstand (m) waarop het begon. advance() schuift door
   zolang het huidige segment klaar is; een segment op tijd telt de tijd,
   een segment op afstand de meters. */
export const startCursor = () => ({ index: 0, startT: 0, startD: 0 });

export function advance(program, cursor, elapsed, dist) {
  let c = cursor || startCursor();
  while (c.index < (program || []).length) {
    const seg = program[c.index];
    const endT = seg.sec ? c.startT + seg.sec : null;
    const endD = seg.meters ? c.startD + seg.meters : null;
    if (endT != null && elapsed >= endT) c = { index: c.index + 1, startT: endT, startD: dist };
    else if (endD != null && dist >= endD) c = { index: c.index + 1, startT: elapsed, startD: endD };
    else break;
  }
  return c;
}

/* Weergave: huidig segment, wat er nog over is, wat er hierna komt. */
export function guideState(program, cursor, elapsed, dist) {
  if (!program || !program.length) return null;
  const c = cursor || startCursor();
  const seg = program[c.index] || null;
  if (!seg) return { index: program.length, seg: null, next: null, left: 0, leftM: null, done: true, total: program.length };
  return {
    index: c.index,
    seg,
    next: program[c.index + 1] || null,
    left: seg.sec ? Math.max(0, Math.ceil(c.startT + seg.sec - elapsed)) : null,
    leftM: seg.meters ? Math.max(0, Math.ceil(c.startD + seg.meters - dist)) : null,
    done: false,
    total: program.length,
  };
}

/* Totale geplande tijd (alleen tijdsegmenten), voor de weergave. */
export const programSeconds = (program) => (program || []).reduce((a, s) => a + (s.sec || 0), 0);
