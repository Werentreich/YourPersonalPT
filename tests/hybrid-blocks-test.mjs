/* Nexa Hybrid: blokken (sets, rondes, AMRAP, EMOM, For Time, intervallen,
   doorlopend) en bewegingen met eigen maten. */
import * as B from "../src/hybrid/engine/blocks.js";
import * as MV from "../src/hybrid/engine/movements.js";
import * as L from "../src/hybrid/engine/load.js";
import * as M from "../src/hybrid/engine/model.js";

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const near = (a, b, t) => a != null && Math.abs(a - b) <= t;
const I = B.newItem;

// ---------- bewegingen ----------
ok("roeien kent meters, tijd en calorieën", JSON.stringify(MV.movementById("row").metrics) === JSON.stringify(["distance", "time", "cal"]));
ok("sled push: meters met gewicht", MV.movementById("sled_push").metrics.includes("kg") && MV.movementById("sled_push").metrics[0] === "distance");
ok("plank in tijd", MV.movementById("plank").metrics[0] === "time");
ok("zoeken op naam", MV.searchMovements("roei")[0].id === "row");
MV.registerNexaExercises([{ id: "bankdrukken", name: "Bankdrukken", pri: ["borst"] }, { id: "squat_x", name: "Hack squat", pri: ["quadriceps"] }]);
ok("Nexa-oefeningen vindbaar, altijd herh. × kg", (() => { const r = MV.searchMovements("bank"); return r[0].id === "nexa:bankdrukken" && r[0].metrics.join() === "reps,kg"; })());
ok("Nexa-beenoefening telt als benen", MV.movementSystems(MV.movementById("nexa:squat_x")).legs > 0.8);

// ---------- EMOM ----------
const emom = B.newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("row", { cal: 15 }), I("kb_swings", { reps: 12, kg: 24 }), I("burpees", { reps: 10 })] });
let v = B.blockVolume(emom);
ok("EMOM 12 wisselend: elk item 4×", JSON.stringify(B.itemCounts(emom)) === "[4,4,4]");
ok("EMOM: 60 cal, 88 herhalingen, tonnage 48 × 24", v.cal === 60 && v.reps === 88 && v.tonnage === 1152, JSON.stringify([v.cal, v.reps, v.tonnage]));
ok("EMOM duurt 12 min", B.blockDuration(emom) === 720);
ok("EMOM-kop", B.blockHeader(emom) === "EMOM 12 min");
const e2 = B.newBlock("emom", { durationSec: 1200, everySec: 120, emomMode: "alles", items: [I("power_clean", { reps: 3, kg: 80 })] });
ok("E2MOM 20 alles: 10 keer", B.itemCounts(e2)[0] === 10 && B.blockHeader(e2) === "E2MOM 20 min");
ok("EMOM-resultaat", B.blockResult({ ...emom, result: { completed: 11 } }) === "11 van 12 gehaald");

// ---------- AMRAP ----------
const cindy = B.TEMPLATES.find((t) => t.id === "cindy").make();
cindy.result = { rounds: 15, reps: 7 };
v = B.blockVolume(cindy);
ok("Cindy 15 + 7: 457 herhalingen", v.reps === 457, v.reps);
ok("AMRAP-resultaat en -kop", B.blockResult(cindy) === "15 + 7 rondes" && B.blockHeader(cindy) === "Cindy: AMRAP 20 min");
ok("AMRAP-score: 15 + 7/30", near(B.blockScore(cindy), 15 + 7 / 30, 1e-9));
ok("AMRAP duurt de cap", B.blockDuration(cindy) === 1200);

// ---------- For Time met reeks ----------
const fran = B.TEMPLATES.find((t) => t.id === "fran").make();
fran.result = { timeSec: 245 };
v = B.blockVolume(fran);
ok("Fran 21-15-9: 90 herhalingen, tonnage 45 × 43", v.reps === 90 && v.tonnage === 45 * 43);
ok("Fran-kop en resultaat", B.blockHeader(fran) === "Fran: For Time 21-15-9" && B.blockResult(fran) === "4:05");
ok("gemeten tijd = duur", B.blockDuration(fran) === 245);
ok("regel zonder herhalingen bij reeks", B.itemLine(fran.items[0], fran) === "Thrusters (43 kg)");

// ---------- rondes met afstanden ----------
const helen = B.TEMPLATES.find((t) => t.id === "helen").make();
v = B.blockVolume(helen);
ok("Helen: 1200 m lopen telt bij hardlopen", v.sport.hardlopen === 1200 && v.distance.run === 1200);
ok("regel met meters en gewicht", B.itemLine(helen.items[1], helen) === "21 kettlebell swings (24 kg)" && B.itemLine(helen.items[0], helen) === "400 m hardlopen");
ok("farmers carry: gewicht per hand telt dubbel", B.blockVolume(B.newBlock("rondes", { rounds: 1, items: [I("farmers", { distanceM: 100, kg: 24 })] })).tonnage === 0 && B.itemLine(I("farmers", { distanceM: 200, kg: 32 })) === "200 m farmers carry (32 kg p.h.)");

// ---------- intervallen ----------
const iv = B.TEMPLATES.find((t) => t.id === "row500").make();
iv.result = { splits: [100, 98, 101, 99, 102, 97] };
ok("6 × 500 m: 3 km roeien", B.blockVolume(iv).sport.roeien === 3000);
ok("intervalduur = splits + rust", B.blockDuration(iv) === 597 + 450);
ok("intervalkop", B.blockHeader(iv) === "6 × 500 m roeien, 1:30 rust", B.blockHeader(iv));
ok("kop zonder naam", B.blockHeader(B.TEMPLATES[0].make(), { withName: false }) === "AMRAP 20 min");
ok("intervalresultaat", B.blockResult(iv) === "gem. 1:40 · snelste 1:37");
ok("intervallen met alleen cardio = duur", B.blockPillar(iv) === "duur");
ok("intervallen met burpees = conditie", B.blockPillar(B.newBlock("interval", { items: [I("row", { distanceM: 250 }), I("burpees", { reps: 10 })] })) === "conditie");

// ---------- intensiteit met intervallen ----------
const rowIv = { ...M.newSession("duur"), sport: "roeien", type: "rustig", date: "2026-09-29", durationSec: 2100, blocks: [iv] };
const idist = L.intensityDistribution([rowIv], {}, "2026-09-28", "2026-10-04");
ok("intervallen in een 'rustige' sessie: werk telt als zwaar", Math.abs(idist.minutes[3] - 597 / 60) < 0.01 && Math.abs(idist.minutes[1] - (35 - 597 / 60)) < 0.01, JSON.stringify(idist.minutes));

// ---------- sessies ----------
const sq = { type: "sets", items: [{ moveId: "back_squat", name: "Back squat", sets: [{ kg: 120, reps: 5, rir: 2 }, { kg: 120, reps: 5, rir: 2 }, { kg: 120, reps: 5, rir: 1 }, { kg: 120, reps: 5, rir: 1 }] }] };
const amrap10 = B.newBlock("amrap", { capSec: 600, items: [I("wall_balls", { reps: 15, kg: 9 }), I("burpees", { reps: 10 })], result: { rounds: 6 } });
const mixed = { ...M.newSession("kracht"), date: "2026-10-01", rpe: 8, blocks: [sq, amrap10] };
ok("duur uit blokken: 4 sets (10 min) + AMRAP 10 = 20 min", L.durationOf(mixed) === 1200);
const sl = L.sessionLoad(mixed, {});
ok("kracht + afsluiter: belasting half kracht, half conditie", sl.pillars.kracht === 80 && sl.pillars.conditie === 80, JSON.stringify(sl.pillars));
ok("titel: kracht + conditie", B.titleOf(mixed) === "Kracht + conditie");
const sled = { ...M.newSession("wod"), rpe: 8, durationSec: 1200, blocks: [B.newBlock("rondes", { rounds: 5, items: [I("sled_push", { distanceM: 25, kg: 150 })] })] };
ok("sled push belast vooral de benen", L.systemSplit(sled).legs > 0.5);
const wodRow = { ...M.newSession("wod"), date: "2026-09-29", rpe: 7, blocks: [B.newBlock("rondes", { rounds: 4, items: [I("row", { distanceM: 500 }), I("burpees", { reps: 15 })], result: { timeSec: 900 } })] };
const wk = L.weekSummary([wodRow, { ...M.newSession("duur"), date: "2026-09-30", sport: "roeien", durationSec: 1200, distanceM: 5000, rpe: 4 }], {}, "2026-09-28");
ok("roeimeters uit de WOD tellen mee in de week", wk.sports.roeien.distanceM === 7000 && wk.sports.roeien.inBlocks === 2000 && wk.sports.roeien.count === 1);
ok("WOD-titel met type", B.titleOf(wodRow) === "WOD · Rondes");

// ---------- records ----------
const s1 = { ...M.newSession("wod"), date: "2026-09-01", blocks: [{ ...B.TEMPLATES[1].make(), result: { timeSec: 300 } }] };
const s2 = { ...M.newSession("wod"), date: "2026-09-20", blocks: [{ ...B.TEMPLATES[1].make(), result: { timeSec: 265 } }] };
const bm = L.benchmarkRecords([s1, s2]);
ok("benchmark: beste Fran-tijd, twee keer gedaan", bm.length === 1 && bm[0].result === "4:25" && bm[0].count === 2 && bm[0].date === "2026-09-20");
const pr = L.pieceRecords([{ ...M.newSession("duur"), blocks: [iv], date: "2026-09-10" }, { ...M.newSession("duur"), sport: "roeien", distanceM: 2000, durationSec: 430, date: "2026-09-12" }]);
ok("stukken: snelste 500 m-split en 2 km roeien", pr.length === 2 && pr.find((p) => p.distanceM === 500).sec === 97 && pr.find((p) => p.distanceM === 2000).sec === 430);
ok("krachtrecords uit sets-blokken", L.strengthRecords([mixed])[0].name === "Back squat" && near(L.strengthRecords([mixed])[0].e1rm, 140, 0.01));

// ---------- oude sessies ----------
const oldWod = { id: "w", kind: "wod", date: "2026-09-01", format: "amrap", capSec: 900, movements: "10 thrusters", score: "7+3" };
const ob = B.blocksOf(oldWod);
ok("oude WOD wordt een blok met tekst en score", ob.length === 1 && ob[0].type === "amrap" && ob[0].text === "10 thrusters" && B.blockResult(ob[0]) === "7+3");
ok("oude WOD: duur blijft de cap", L.durationOf(oldWod) === 900);
const oldLift = { id: "k", kind: "kracht", date: "2026-09-01", exercises: [{ exId: "bankdrukken", name: "Bankdrukken", sets: [{ kg: 80, reps: 8 }] }] };
ok("oude kracht wordt een sets-blok", B.blocksOf(oldLift)[0].type === "sets" && B.blocksOf(oldLift)[0].items[0].moveId === "nexa:bankdrukken");

// ---------- nieuwe sessies ----------
ok("nieuwe kracht- en WOD-sessie hebben blokken", Array.isArray(M.newSession("kracht").blocks) && Array.isArray(M.newSession("wod").blocks));

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
