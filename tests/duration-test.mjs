/* Geschatte duur op basis van eerdere, soortgelijke trainingen, en de
   warming-up bij het starten van een krachtsessie uit het hybride schema. */
const D = await import("../src/perf/duration.js");
const B = await import("../src/perf/bridge.js");
const P = await import("../src/hybrid/engine/planner.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

// het voorbeeld van de kaart: geschat 53 min, werkelijk 1:11:57
const itemA = (id, date, status = "gepland") => ({ id, date, status, kind: "kracht", slot: "K_FULL_A", targetMin: 53 });
const done = itemA("a1", "2026-10-06", "gedaan");
const next = itemA("a2", "2026-10-13");
const sess = { id: "s1", date: "2026-10-06", kind: "kracht", planItemId: "a1", durationSec: 71 * 60 + 57, createdAt: 1 };
const v = D.withLearnedDurations({ plan: { items: [done, next] }, sessions: [sess] });
const n2 = v.plan.items.find((x) => x.id === "a2");
ok("na één training: volgende A-sessie ± 72 min in plaats van 53", n2.targetMin === 72 && n2.baseMin === 53 && n2.learned.n === 1, JSON.stringify(n2));
ok("gedane sessie blijft zoals ze was", v.plan.items.find((x) => x.id === "a1").targetMin === 53);
ok("zonder sessies: opslag ongewijzigd (zelfde object)", D.withLearnedDurations({ plan: { items: [next] }, sessions: [] }).plan.items[0] === next);

// meerdere metingen: mediaan van de laatste vijf, uitschieter telt niet
const many = [62, 64, 66, 300, 63].map((m, k) => ({ id: `s${k}`, date: `2026-09-0${k + 1}`, kind: "kracht", slot: "K_FULL_A", plannedMin: 50, durationSec: m * 60 }));
const l = D.learnedMinutes(next, many.map((s) => ({ sec: s.durationSec, planned: s.plannedMin, at: s.date, slot: s.slot, kind: s.kind })));
ok("mediaan, training van 5 uur telt niet mee", l && l.n === 4 && l.min === Math.round(53 * ((63 + 64) / 2 / 50)), JSON.stringify(l));

// soortgelijk: andere krachtsessie telt pas mee vanaf twee metingen
const b1 = { id: "b1", date: "2026-10-01", status: "gedaan", kind: "kracht", slot: "K_FULL_B", targetMin: 60 };
const one = D.withLearnedDurations({ plan: { items: [b1, next] }, sessions: [{ id: "x", date: "2026-10-01", kind: "kracht", planItemId: "b1", durationSec: 80 * 60 }] });
ok("één andere krachtsessie: nog geen aanpassing", !one.plan.items.find((x) => x.id === "a2").learned);
const b2 = { ...b1, id: "b2", date: "2026-10-03" };
const two = D.withLearnedDurations({ plan: { items: [b1, b2, next] }, sessions: [{ id: "x", date: "2026-10-01", kind: "kracht", planItemId: "b1", durationSec: 72 * 60 }, { id: "y", date: "2026-10-03", kind: "kracht", planItemId: "b2", durationSec: 78 * 60 }] });
const t2 = two.plan.items.find((x) => x.id === "a2");
ok("twee andere krachtsessies: wel, als soort", t2.learned && t2.learned.tier === "soort" && t2.targetMin === Math.round(53 * 1.25), JSON.stringify(t2));
const run = { id: "r1", date: "2026-10-14", status: "gepland", kind: "duur", sport: "hardlopen", slot: "D_EASY", targetMin: 40 };
ok("hardlopen leert niet van kracht", !D.withLearnedDurations({ plan: { items: [b1, b2, run] }, sessions: two.sessions || [{ kind: "kracht", planItemId: "b1", durationSec: 4320 }, { kind: "kracht", planItemId: "b2", durationSec: 4680 }] }).plan.items.find((x) => x.id === "r1").learned);

// vastleggen en terugschrijven
const st = D.stampPlanned({ id: "s9", planItemId: "a2" }, n2);
ok("vastleggen: schatting van het schema (niet de geleerde) op de sessie", st.plannedMin === 53 && st.slot === "K_FULL_A");
const back = D.unlearn(n2);
ok("terugschrijven: schatting van het schema terug, geen hulpvelden", back.targetMin === 53 && back.baseMin === undefined && back.learned === undefined);
ok("terugschrijven: zelf aangepaste duur blijft", D.unlearn({ ...n2, targetMin: 90 }).targetMin === 90);

// Nexa-programmadag
const day = { id: "d1", slots: [] };
const nx = [{ dayId: "d1", start: 0, end: 70 * 60000, estMin: 55 }, { dayId: "d1", start: 1e9, end: 1e9 + 66 * 60000, estMin: 55 }];
const ld = D.learnedDayMinutes(day, nx, 55);
ok("Nexa-dag: op 5 minuten, uit eerdere trainingen van die dag", ld && ld.min === 70 && ld.n === 2, JSON.stringify(ld));
ok("Nexa-dag: zonder eerdere trainingen niets", D.learnedDayMinutes(day, [], 55) === null);
ok("tekst", D.learnedNote(1) === "op basis van uw vorige training" && D.learnedNote(3) === "op basis van uw laatste 3 trainingen");

// warming-up uit het schema bij het starten
const S = { ...P.SETTINGS_DEFAULT, goal: "hybride", startDate: "2026-10-05", exp: { kracht: "beginner", duur: "starter" }, runNow: 1, days: [0, 2, 4] };
const wk = P.generateWeek(S, { sessions: [], profile: {} }, "2026-10-05");
const kA = wk.items.find((x) => x.kind === "kracht");
const w = B.warmupOf(kA);
ok("warming-up: algemene warming-up uit de krachtsessie", w.length === 1 && /roeien|touwtje/.test(w[0].text) && /mobiliteit/.test(w[0].how), JSON.stringify(w));
const known = new Set(["squat", "bankdrukken"]);
let n = 0;
const r = B.programFromPlan(wk.items, known, () => `u${++n}`, "2026-10-05");
const dayA = r.program.days.find((d) => d.slot === kA.slot);
const synced = { ...kA, blocks: B.blocksFromDay(dayA, {}, kA) };
ok("warming-up: blijft na synchroniseren met het programma", B.warmupOf(synced).length === 1);
ok("warming-up: rondes met oefeningen uitgeschreven", /2 rondes: .*roeien/.test(B.warmupOf({ blocks: [{ type: "rondes", role: "warmup", rounds: 2, items: [{ moveId: "row", distanceM: 250 }, { moveId: "air_squats", reps: 10 }] }] })[0].text), JSON.stringify(B.warmupOf({ blocks: [{ type: "rondes", role: "warmup", rounds: 2, items: [{ moveId: "row", distanceM: 250 }, { moveId: "air_squats", reps: 10 }] }] })));
ok("warming-up: geen warming-up, lege lijst", B.warmupOf({ blocks: [{ type: "sets", items: [] }] }).length === 0 && B.warmupOf(null).length === 0);

// afsluiter: blijft na synchroniseren met het programma en staat bij de start klaar
const S2 = { ...P.SETTINGS_DEFAULT, goal: "hybride", startDate: "2026-10-05", days: [0, 2, 4] };
const wk2 = P.generateWeek(S2, { sessions: [], profile: {} }, "2026-10-05");
const kF = wk2.items.find((x) => /\+ afsluiter/.test(x.title));
const fo = B.finisherOf(kF);
ok("afsluiter: uit de krachtsessie met uitleg", fo.length === 1 && /EMOM 8 min: .*roeien.*burpees/.test(fo[0].text) && /minuut/.test(fo[0].how), JSON.stringify(fo));
const r2 = B.programFromPlan(wk2.items, new Set(["squat", "bankdrukken"]), () => `v${++n}`, "2026-10-05");
const dayF = r2.program.days.find((d) => d.slot === kF.slot);
const synced2 = B.blocksFromDay(dayF, {}, kF, "gym");
ok("afsluiter: blijft na synchroniseren, achteraan", synced2[synced2.length - 1].role === "afsluiter" && synced2[0].role === "warmup");
const lost = { ...kF, blocks: kF.blocks.filter((b) => b.role !== "afsluiter") };
const back2 = B.blocksFromDay(dayF, {}, lost, "thuis");
ok("afsluiter: weggevallen (oude versie) maar titel noemt hem: komt terug", back2.some((b) => b.role === "afsluiter" && b.type === "amrap"));
ok("afsluiter: zonder titel geen afsluiter erbij", !B.blocksFromDay(dayF, {}, { ...lost, title: "Kracht A" }, "gym").some((b) => b.role === "afsluiter"));
const sync2 = B.itemsToSync([{ ...lost, status: "gepland", date: "2026-10-09" }], r2.program, {}, "2026-10-05", "gym");
ok("afsluiter: synchroniseren herstelt hem in het schema", (sync2[lost.id] || []).some((b) => b.role === "afsluiter"));

if (fails) { console.log(`\n${fails} FOUT`); process.exit(1); }
console.log("\nalles goed");
