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
ok("Nexa-oefeningen vindbaar, altijd herh. × kg", (() => { const r = MV.searchMovements("hack"); return r[0].id === "nexa:squat_x" && r[0].metrics.join() === "reps,kg"; })());
ok("geen dubbelen: eigen Bankdrukken gaat voor Nexa", MV.searchMovements("bankdruk").filter((m) => m.name === "Bankdrukken").length === 1);
ok("Nexa-beenoefening telt als benen", MV.movementSystems(MV.movementById("nexa:squat_x")).legs > 0.8);

// ---------- EMOM ----------
const emom = B.newBlock("emom", { durationSec: 720, everySec: 60, emomMode: "wissel", items: [I("row", { cal: 15 }), I("kb_swings", { reps: 12, kg: 24 }), I("burpees", { reps: 10 })] });
let v = B.blockVolume(emom);
ok("EMOM 12 wisselend: elk item 4×", JSON.stringify(B.itemCounts(emom)) === "[4,4,4]");
ok("EMOM: 60 cal, 88 herhalingen, tonnage 48 × 24", v.cal === 60 && v.reps === 88 && v.tonnage === 1152, JSON.stringify([v.cal, v.reps, v.tonnage]));
ok("EMOM duurt 12 min", B.blockDuration(emom) === 720);
ok("EMOM-kop", B.blockHeader(emom) === "EMOM 12 min");
const e2 = B.newBlock("emom", { durationSec: 1200, everySec: 120, emomMode: "alles", items: [I("power_clean", { reps: 3, kg: 80 })] });
ok("E2MOM 20 alles: 10 keer", B.itemCounts(e2)[0] === 10 && B.blockHeader(e2) === "E2MOM 20 min (10 rondes)");
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

// ---------- nieuwe vormen ----------
const tab = B.TEMPLATES.find((t) => t.id === "tabata_4").make();
ok("Tabata, vier bewegingen op volgorde: 32 intervallen, 16 min", B.tabataSlots(tab) === 32 && B.blockDuration(tab) === 960);
tab.result = { reps: 320, low: 7 };
ok("Tabata-resultaat", B.blockResult(tab) === "320 herh. totaal · laagste ronde 7" && B.blockVolume(tab).reps === 320);
ok("klassieke Tabata-kop", B.blockHeader(B.TEMPLATES.find((t) => t.id === "tabata_squat").make()) === "Tabata: air squats");
const t4020 = B.TEMPLATES.find((t) => t.id === "4020").make();
ok("40/20 om de beurt: 12 intervallen, elk 3×, 12 min", B.tabataSlots(t4020) === 12 && JSON.stringify(B.itemCounts(t4020)) === "[3,3,3,3]" && B.blockDuration(t4020) === 720 && B.blockHeader(t4020).startsWith("12 × 40/20 s"));

const db = B.TEMPLATES.find((t) => t.id === "deathby_burpees").make();
db.result = { rounds: 12, reps: 5 };
ok("Death by: 12 min + 5 = 83 burpees, 13 min", B.blockVolume(db).reps === 83 && B.blockDuration(db) === 780 && B.blockResult(db) === "12 min + 5");

const e4 = B.TEMPLATES.find((t) => t.id === "e4m").make();
ok("Every 4 min × 5: elk item 5×, 2500 m roeien", JSON.stringify(B.itemCounts(e4)) === "[5,5,5]" && B.blockVolume(e4).sport.roeien === 2500 && B.blockHeader(e4) === "E4MOM 20 min (5 rondes)");

const cx = B.TEMPLATES.find((t) => t.id === "complex").make();
cx.sets = [{ kg: 60 }, { kg: 70 }, { kg: 80 }];
ok("complex: 3 sets × 3 herh., tonnage 3 × (60+70+80)", B.blockVolume(cx).reps === 9 && B.blockVolume(cx).tonnage === 630 && B.blockPillar(cx) === "kracht");
ok("complex-kop", B.blockHeader(cx) === "Complex: 1 power clean + 1 front squat + 1 push jerk");

const t1 = B.TEMPLATES.find((t) => t.id === "t_row2k").make();
t1.result = { value: 432 };
ok("test 2 km roeien: tijd, duur en score", B.blockResult(t1) === "7:12" && B.blockDuration(t1) === 432 && B.blockScore(t1) === -432 && B.blockPillar(t1) === "duur" && B.blockHeader(t1) === "2 km roeien: Tijdrit 2 km roeien");
const t2 = B.TEMPLATES.find((t) => t.id === "t_1rm").make();
t2.result = { value: 140 };
ok("test 1RM: kracht, kop en resultaat", B.blockPillar(t2) === "kracht" && B.blockHeader(t2) === "1RM back squat" && B.blockResult(t2) === "140 kg");
const t3 = B.TEMPLATES.find((t) => t.id === "t_cal").make();
ok("test max cal in 1 min", B.blockHeader(t3) === "Max calorieën air bike in 1:00" && B.blockDuration(t3) === 60);

const ladder = B.TEMPLATES.find((t) => t.id === "ladder").make();
ok("ladder 10-1: 55 swings + 55 burpees", B.blockVolume(ladder).reps === 110);
const partner = B.TEMPLATES.find((t) => t.id === "partner").make();
ok("partnerworkout: werk gedeeld door 2", B.blockVolume(partner).reps === 100 && B.blockVolume(partner).cal === 50);

const pyr = B.TEMPLATES.find((t) => t.id === "ski_pyramid").make();
ok("piramide: 2250 m SkiErg en kop met reeks", B.blockVolume(pyr).sport.skierg === 2250 && B.blockHeader(pyr) === "250-500-750-500-250 m skierg, 1:30 rust", B.blockHeader(pyr));
const n44 = B.TEMPLATES.find((t) => t.id === "norway4x4").make();
ok("Noorse 4×4: 16 min werk + 9 min rust", B.blockDuration(n44) === 16 * 60 + 9 * 60, B.blockDuration(n44));

const capped = { ...B.TEMPLATES.find((t) => t.id === "karen").make(), capSec: 600, result: { capped: true, repsLeft: 20 } };
ok("cap niet gehaald: resultaat, score slechter dan elke tijd, duur = cap", B.blockResult(capped) === "cap, 20 herh. over" && B.blockScore(capped) < -5000 && B.blockDuration(capped) === 600 && B.blockVolume(capped).reps === 130);
ok("Rx/geschaald in resultaat", B.blockResult({ ...B.TEMPLATES[1].make(), scaling: "scaled", result: { timeSec: 300 } }) === "5:00 (geschaald)");
ok("benchmark-sleutel scheidt Rx en geschaald", B.benchmarkKey({ name: "Fran", scaling: "rx" }) !== B.benchmarkKey({ name: "Fran", scaling: "scaled" }));
ok("per kant telt dubbel", B.blockVolume(B.newBlock("rondes", { rounds: 2, items: [I("bulgarian", { reps: 10, perSide: true, kg: 12 })] })).reps === 40);
ok("regel met per kant, %1RM en tempo", B.itemLine(I("back_squat", { reps: 5, pct: 75, tempo: "3-1-1-0" })) === "5 back squat (75% 1RM, tempo 3-1-1-0)" && B.itemLine(I("step_ups", { reps: 10, perSide: true })) === "10 step-ups (per kant)");
const wu = B.TEMPLATES.find((t) => t.id === "warmup").make();
ok("warming-up telt niet mee in de pijlerverdeling", JSON.stringify(B.pillarShares([wu, B.TEMPLATES[1].make()], "conditie")) === JSON.stringify({ conditie: 1 }));
ok("mobiliteitsblok = pijler mobiliteit", B.blockPillar(B.TEMPLATES.find((t) => t.id === "mob_hips").make()) === "mobiliteit");
const fresh = B.freshBlock({ ...cindy });
ok("opnieuw doen: kopie zonder resultaat, nieuw id", fresh.id !== cindy.id && JSON.stringify(fresh.result) === "{}" && fresh.items.length === 3);
const ivc = B.newBlock("interval", { rounds: 3, items: [I("air_bike", { timeSec: 60 })], result: { metric: "cal", values: [20, 18, 17] } });
ok("intervallen met calorieën als resultaat", B.blockResult(ivc) === "gem. 18 cal · beste 20 cal");
const sup = B.TEMPLATES.find((t) => t.id === "superset").make();
ok("superset: kop en kortere duur dan los", B.blockHeader(sup) === "Superset" && B.blockDuration(sup) < B.blockDuration({ ...sup, superset: false }));
ok("alle templates zijn geldig en hebben een categorie", B.TEMPLATES.every((t) => { const b = t.make(); return B.BLOCK_TYPES[b.type] && B.TEMPLATE_CATS.includes(t.cat) && b.items.every((it) => it.moveId && MV.movementById(it.moveId)); }));
ok("bibliotheek: meer dan 150 bewegingen, alle maten bekend", MV.MOVEMENTS.length > 150 && MV.MOVEMENTS.every((m) => m.metrics.every((x) => MV.METRICS[x]) && MV.CATS[m.cat]));

// ---------- records voor testen ----------
const tS = (b, date) => ({ ...M.newSession("wod"), date, blocks: [b] });
const r1 = { ...B.TEMPLATES.find((t) => t.id === "t_1rm").make(), result: { value: 150 } };
ok("1RM-test telt bij krachtrecords", (() => { const r = L.strengthRecords([tS(r1, "2026-09-01")]); return r[0].e1rm === 150 && r[0].test; })());
const rowT = { ...B.TEMPLATES.find((t) => t.id === "t_row2k").make(), name: undefined, result: { value: 440 } };
ok("tijdrit telt bij stukken", L.pieceRecords([tS(rowT, "2026-09-02")]).some((p) => p.distanceM === 2000 && p.sec === 440));
const calA = { ...B.TEMPLATES.find((t) => t.id === "t_cal").make(), result: { value: 18 } };
const calB = { ...B.TEMPLATES.find((t) => t.id === "t_cal").make(), result: { value: 22 } };
const tr = L.testRecords([tS(calA, "2026-09-01"), tS(calB, "2026-09-08")]);
ok("max-cal-test: beste waarde", tr.length === 1 && tr[0].value === 22 && tr[0].date === "2026-09-08");
const franRx = { ...B.TEMPLATES[1].make(), scaling: "rx", result: { timeSec: 280 } };
const franSc = { ...B.TEMPLATES[1].make(), scaling: "scaled", result: { timeSec: 200 } };
const bms = L.benchmarkRecords([tS(franRx, "2026-09-01"), tS(franSc, "2026-09-02")]);
ok("benchmarks: Rx en geschaald apart", bms.length === 2 && bms.some((b) => b.name === "Fran (geschaald)" && b.result === "3:20"));
ok("warming-up met naam telt niet als benchmark", L.benchmarkRecords([tS({ ...wu, name: "Opwarmen", result: { timeSec: 300 } }, "2026-09-01")]).length === 0);
ok("opslag: ongeldige templates weg", M.normalizeStore({ templates: [{ id: "a", block: { type: "amrap" } }, { id: "b" }, null] }).templates.length === 1);
ok("mobiliteitssessie kan blokken hebben", Array.isArray(M.newSession("mobiliteit").blocks));
const ms = { ...M.newSession("duur"), sport: "multisport", date: "2026-09-29", durationSec: 3600, rpe: 6, blocks: [B.TEMPLATES.find((t) => t.id === "brick").make()] };
const mw = L.weekSummary([ms], {}, "2026-09-28");
ok("multisport: afstand per sport uit de onderdelen", mw.sports.hardlopen && mw.sports.hardlopen.distanceM === 5000 && !mw.sports.multisport);

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
