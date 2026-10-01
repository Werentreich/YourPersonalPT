import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const a = src.indexOf("/* =========================================================================\n   TRAINING");
const b = src.indexOf("/* ---------------- geluid, trilling");
const wma = src.slice(src.indexOf("function weekMapAdjusted"), src.indexOf("/* Aandeel van de gewichtstoename"));
const pre = wma + `const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f;};const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));const sum=(a)=>a.reduce((x,y)=>x+y,0);const DAY_MS=86400000;const dayNum=(iso)=>Math.round(Date.parse(iso+"T00:00:00")/DAY_MS);const useState=()=>{};const useEffect=()=>{};`;
const L = new Function(pre + src.slice(a, b) + `return {resensCheck,resensState,endResens,trainDerive,TRAIN_DEFAULT,programFromTemplate,TEMPLATES,buildExIndex,plannedSetsFor,isoOfNum,mondayOf};`)();
let fails = 0;
const eq = (l, g, e) => { const ok = JSON.stringify(g) === JSON.stringify(e); if (!ok) fails++; console.log((ok ? "OK  " : "FOUT") + " " + l + (ok ? "" : `  kreeg ${JSON.stringify(g)} verwacht ${JSON.stringify(e)}`)); };
const DAY = 86400000, dn = (iso) => Math.round(Date.parse(iso + "T00:00:00") / DAY);
const today = "2026-09-28", T0 = dn(today);
// sessies: 3 per week, weeks weken terug; gain(w) = kg erbij per week
const mk = ({ weeks, gain = 0.5, stallFrom = 999, gap = null, low = null }) => {
  const out = [];
  for (let w = weeks; w >= 1; w--) for (const off of [0, 2, 4]) {
    const d = T0 - w * 7 + off; if (d > T0) continue;
    const k = weeks - w;
    if (gap && k >= gap[0] && k < gap[1]) continue;
    const kg = 60 + Math.min(k, stallFrom) * gain;
    out.push({ date: L.isoOfNum(d), start: d * DAY, end: d * DAY + 3600e3, deload: false, volumeCut: !!(low && k >= low[0] && k < low[1]),
      exercises: ["bankdrukken", "squat", "db_row", "ohp"].map((id) => ({ exId: id, sets: [{ type: "work", weight: kg, reps: 8, rir: 2, done: true }] })) });
  }
  return out;
};
const pos = { phase: "opbouw", number: 3 };
const chk = (o) => { const r = L.resensCheck({ sessions: mk(o), today, pos, resens: o.resens, snooze: o.snooze, exIndex: {}, lowNow: false }); return r ? [r.weeks, r.stall, r.blockWeeks] : null; };
eq("22 wk, vooruitgang: voorstel 3 wk", chk({ weeks: 22 }), [22, false, 3]);
eq("14 wk, vooruitgang: nog niet", chk({ weeks: 14 }), null);
eq("14 wk, stilstand: voorstel 4 wk", chk({ weeks: 14, stallFrom: 4 }), [14, true, 4]);
eq("10 wk, stilstand: te vroeg", chk({ weeks: 10, stallFrom: 2 }), null);
eq("vakantie van 3 wk telt als rust", chk({ weeks: 24, gap: [10, 13] }), null);
eq("periode met minder volume telt als rust", chk({ weeks: 24, low: [8, 11] }), null);
eq("28 wk: 4 wk advies", chk({ weeks: 28 })[2], 4);
eq("uitgesteld", chk({ weeks: 22, snooze: "2026-10-10" }), null);
eq("uitstel voorbij", !!chk({ weeks: 22, snooze: "2026-09-28" }), true);
eq("herstelblok 5 wk geleden klaar", chk({ weeks: 30, resens: { start: "2026-07-27", weeks: 4, done: true } }), null);
const s = mk({ weeks: 22 }).filter((x) => dn(x.date) < T0 - 21);
eq("traint al 3 weken niet", L.resensCheck({ sessions: s, today, pos, exIndex: {} }), null);
eq("in deload: niet", L.resensCheck({ sessions: mk({ weeks: 22 }), today, pos: { phase: "deload" }, exIndex: {} }), null);
eq("fase met minder volume nu: niet", L.resensCheck({ sessions: mk({ weeks: 22 }), today, pos, exIndex: {}, lowNow: true }), null);
// state
eq("state week 2", (({ active, week, weeks }) => [active, week, weeks])(L.resensState({ start: "2026-09-18", weeks: 3 }, today)), [true, 2, 3]);
eq("state afgelopen", L.resensState({ start: "2026-09-01", weeks: 3 }, today), { active: false, ended: true });
// trainDerive met herstelblok
const idx = L.buildExIndex([], {});
const prog = L.programFromTemplate(L.TEMPLATES[0], { mode: "week", sets: 3, exIndex: idx });
const T = { ...L.TRAIN_DEFAULT(), programs: [prog], activeProgramId: prog.id, phaseSeen: "cut", resens: { start: "2026-09-21", weeks: 3 } };
const D = L.trainDerive(T, { phase: "cut", adjList: [] }, today);
const day = prog.days[0];
const full = L.plannedSetsFor(day, { ...D, phaseOn: false, pos: { phase: "opbouw" } });
const half = L.plannedSetsFor(day, { ...D, pos: { phase: "opbouw" } });
eq("herstelblok: actief, vf 0,5, gewichten omhoog toegestaan", [D.resens.active, D.phaseOn, D.tp.vf, D.tp.load, D.tp.phaseOption.id], [true, true, 0.5, true, "gelijk"]);
console.log("   sets", full.join(","), "->", half.join(","), `(${full.reduce((a, b) => a + b)} -> ${half.reduce((a, b) => a + b)})`);
const Tm = { ...T, phaseChoice: { phase: "minicut", option: "minicut" }, phaseSeen: "minicut" };
const Dm = L.trainDerive(Tm, { phase: "minicut", adjList: [] }, today);
eq("herstelblok in minicut: gewichten blijven vast", [Dm.tp.vf, Dm.tp.load], [0.5, false]);
const E = L.endResens(T, today, 3, true);
eq("stoppen: nieuw blok", [E.resens.done, E.resens.stopped, E.block.start, E.block.number], [true, today, "2026-09-28", 4]);
eq("na stoppen geen actief blok", L.trainDerive(E, { phase: "cut", adjList: [] }, today).resens.active, false);
console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd"); process.exit(fails ? 1 : 0);
