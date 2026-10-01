import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const a = src.indexOf("/* =========================================================================\n   TRAINING");
const b = src.indexOf("/* ---------------- geluid, trilling");
const body = src.slice(a, b);
const wma = src.slice(src.indexOf("function weekMapAdjusted"), src.indexOf("/* Aandeel van de gewichtstoename"));
const pre = wma + `
const num = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const DAY_MS = 86400000;
const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00") / DAY_MS);
const useState = () => {}; const useEffect = () => {};
`;
const names = ["blockPosition","progressFor","programFromTemplate","buildExIndex","TEMPLATES","trainDerive","TRAIN_DEFAULT","buildSession","finishSession","plannedSetsFor","fatigueCheck","todayPlan","programCheck","plannedMuscleSets","sessionStats","sessionPRs","wdOfNum","mondayOf","localISO","isoOfNum","TRAIN_PHASE","e1rm","bestE1rm","estMinutes"];
const fn = new Function(pre + body + `return {${names.join(",")}};`);
const L = fn();
let fails = 0;
const eq = (label, got, exp) => { const ok = JSON.stringify(got) === JSON.stringify(exp); if (!ok) fails++; console.log((ok ? "OK  " : "FOUT") + " " + label + (ok ? "" : `  kreeg ${JSON.stringify(got)} verwacht ${JSON.stringify(exp)}`)); };

// weekday
eq("wdOfNum maandag 2026-09-21", L.wdOfNum(Math.round(Date.parse("2026-09-21T00:00:00")/86400000)), 0);
eq("mondayOf do 2026-09-24", L.mondayOf("2026-09-24"), "2026-09-21");
eq("mondayOf zo 2026-09-27", L.mondayOf("2026-09-27"), "2026-09-21");

// block
const blk = { start: "2026-09-07", acc: 4, int: 2, deload: true, number: 1 };
const p = (d) => { const r = L.blockPosition(blk, d, "kuba"); return [r.phase, r.week, r.rir, r.number]; };
eq("blok week1", p("2026-09-07"), ["opbouw",0,2,1]);
eq("blok week3", p("2026-09-21"), ["opbouw",2,1,1]);
eq("blok week5", p("2026-10-05"), ["intensivering",4,1,1]);
eq("blok week6", p("2026-10-12"), ["intensivering",5,0,1]);
eq("blok week7 deload", p("2026-10-19"), ["deload",6,4,1]);
eq("blok 2 week1", p("2026-10-26"), ["opbouw",0,2,2]);
const forced = L.blockPosition({ ...blk, deloadFrom: "2026-09-23" }, "2026-09-25", "kuba");
eq("ingelaste deload", [forced.phase, forced.forced, forced.daysLeft], ["deload", true, 5]);

// progression
const ex = { id: "x", equip: "stang", kind: "compound", repMin: 6, repMax: 10, bw: 1 };
const slot = { id: "s1", exId: "x", repMin: 6, repMax: 10, sets: 2 };
const mk = (w, reps, rir = 1, id = Math.random()) => ({ s: { id }, e: { bwLoad: 0, sets: reps.map((r) => ({ type: "work", done: true, weight: w, reps: r, rir })) } });
const settings = L.TRAIN_DEFAULT().settings;
const pr = (hist, load = true, tr = 1) => { const r = L.progressFor({ slot, ex, hist, targetRir: tr, load, settings }); return [r.change, r.weight, r.reps]; };
eq("in range: +1 rep", pr([mk(80, [8, 7])]), ["reps", 80, [9, 8]]);
eq("eerste top: bevestigen", pr([mk(80, [9, 8]), mk(80, [10, 10])]), ["bevestigen", 80, [10, 10]]);
eq("twee keer top: omhoog", pr([mk(80, [10, 10]), mk(80, [10, 10])])[0], "omhoog");
eq("twee keer top: +2,5", pr([mk(80, [10, 10]), mk(80, [10, 10])])[1], 82.5);
eq("top met RIR 4: direct omhoog", pr([mk(80, [10, 10], 4)])[0], "omhoog");
eq("top met RIR 5: dubbele stap", pr([mk(80, [10, 10], 5)])[1], 85);
eq("miss: vasthouden", pr([mk(80, [5, 4])]), ["vasthouden", 80, [6, 6]]);
eq("twee keer miss: omlaag", pr([mk(80, [5, 4]), mk(80, [5, 5])])[0], "omlaag");
eq("minicut: behoud", pr([mk(80, [8, 7])], false), ["behoud", 80, [8, 7]]); eq("minicut: behoud onder range blijft gelijk", pr([mk(80, [5, 4])], false), ["behoud", 80, [5, 4]]);
eq("nieuw", pr([])[0], "nieuw");

// templates + session
const idx = L.buildExIndex([], {});
const prog = L.programFromTemplate(L.TEMPLATES[0], { mode: "week", sets: 2, exIndex: idx });
eq("UL 4 dagen", prog.days.length, 4);
eq("UL weekMap dagen", prog.weekMap.map((x) => !!x), [true, true, false, true, true, false, false]);
eq("eerste slot 2 warm-ups", prog.days[0].slots[0].warmups, 2);
const T = { ...L.TRAIN_DEFAULT(), programs: [prog], activeProgramId: prog.id };
const D = L.trainDerive(T, { phase: "minicut" }, "2026-09-21");
eq("minicut uit zonder akkoord (voorstelmodus)", D.phaseOn, false);
const D2 = L.trainDerive({ ...T, phaseAccept: "minicut" }, { phase: "minicut" }, "2026-09-21");
const counts = L.plannedSetsFor(prog.days[0], D2);
eq("minicut: -1/3 volume (15 -> 10)", L.sum ? 0 : counts.reduce((a, b) => a + b, 0), 10);
eq("minicut: compounds houden 2 sets", counts.slice(0, 2), [2, 2]);
eq("vandaag maandag = Upper A", D.plan.day.name, "Upper A");
const sess = L.buildSession({ program: prog, day: D.plan.day, D, T, bw: 85 });
eq("sessie oefeningen", sess.exercises.length, 7);
eq("eerste oefening sets (2 warm + 2 werk)", sess.exercises[0].sets.map((s) => s.type), ["warmup", "warmup", "work", "work"]);
// log it
sess.exercises.forEach((e) => e.sets.forEach((s) => { s.done = true; s.weight = 50; s.reps = s.type === "work" ? 10 : 5; s.rir = 1; }));
const fin = { ...L.finishSession(sess), date: "2026-09-21" };
eq("afgerond heeft end", !!fin.end, true);
const st = L.sessionStats(fin);
eq("stats sets", st.sets, 15);
const T2 = { ...T, sessions: [fin] };
const D3 = L.trainDerive(T2, { phase: "bulk" }, fin.date);
eq("na training vandaag gedaan", D3.plan.doneToday, true);
const next = L.buildSession({ program: prog, day: prog.days[0], D: D3, T: T2, bw: 85 });
eq("voorstelmodus: vorige gewicht", next.exercises[0].sets.find((s) => s.type === "work").weight, 50);
eq("voorstelmodus: geen voorstel als doel gelijk is", next.exercises[0].proposal, null); eq("voorstel bij +1 rep", (() => { const f2 = JSON.parse(JSON.stringify(fin)); f2.exercises[0].sets.forEach((s) => { if (s.type === "work") s.reps = 8; }); const Tq = { ...T, sessions: [f2] }; const Dq = L.trainDerive(Tq, { phase: "bulk" }, "2026-09-21"); return L.buildSession({ program: prog, day: prog.days[0], D: Dq, T: Tq, bw: 85 }).exercises[0].proposal.reps; })(), [9, 9]);
const T3 = { ...T2, settings: { ...T2.settings, autoProgress: true } };
const D4 = L.trainDerive(T3, { phase: "bulk" }, "2026-09-21");
const next2 = L.buildSession({ program: prog, day: prog.days[0], D: D4, T: T3, bw: 85 });
eq("automodus: doel bevestigen = 10 reps", next2.exercises[0].sets.find((s) => s.type === "work").reps, 10);

// rotation
const progR = L.programFromTemplate(L.TEMPLATES[1], { mode: "rotation", sets: 2, exIndex: idx });
const Tr = { ...L.TRAIN_DEFAULT(), programs: [progR], activeProgramId: progR.id };
let Dr = L.trainDerive(Tr, { phase: "bulk" }, "2026-09-21");
eq("rotatie start met Push", Dr.plan.day.name, "Push");
const mkS = (date, rotPos) => ({ id: date, date, start: Date.parse(date), end: Date.parse(date) + 3600e3, programId: progR.id, rotPos, exercises: [] });
Dr = L.trainDerive({ ...Tr, sessions: [mkS("2026-09-21", 0)] }, { phase: "bulk" }, "2026-09-23");
eq("rotatie na Push (dag gemist) = Pull", Dr.plan.day.name, "Pull");
Dr = L.trainDerive({ ...Tr, sessions: [mkS("2026-09-21", 0), mkS("2026-09-22", 1), mkS("2026-09-23", 2)] }, { phase: "bulk" }, "2026-09-24");
eq("rotatie na Legs: rustdag", [Dr.plan.rest, Dr.plan.next.name], [true, "Push"]);
Dr = L.trainDerive({ ...Tr, sessions: [mkS("2026-09-21", 0), mkS("2026-09-22", 1), mkS("2026-09-23", 2)] }, { phase: "bulk" }, "2026-09-25");
eq("rotatie na rustdag: Push", Dr.plan.day.name, "Push");

// fatigue
const mkF = (date, w, reps) => ({ id: date, date, start: Date.parse(date + "T18:00:00"), end: Date.parse(date + "T19:00:00"), exercises: ["a","b","c"].map((x) => ({ exId: x, bwLoad: 0, sets: [{ type: "work", done: true, weight: w, reps, rir: 1 }] })) });
const blk2 = { start: "2026-09-07", acc: 4, int: 2, deload: true, number: 1 };
const pos = L.blockPosition(blk2, "2026-09-25", "kuba");
const fat = L.fatigueCheck({ sessions: [mkF("2026-09-10", 100, 10), mkF("2026-09-15", 100, 10), mkF("2026-09-18", 100, 8), mkF("2026-09-22", 100, 7)], pos, today: "2026-09-25", tp: L.TRAIN_PHASE.bulk, block: blk2 });
eq("vermoeidheid gedetecteerd", !!fat, true);
const fat2 = L.fatigueCheck({ sessions: [mkF("2026-09-10", 100, 10), mkF("2026-09-15", 100, 10), mkF("2026-09-18", 100, 11), mkF("2026-09-22", 100, 11)], pos, today: "2026-09-25", tp: L.TRAIN_PHASE.bulk, block: blk2 });
eq("geen vermoeidheid bij vooruitgang", fat2, null);

// check
const chk = L.programCheck(prog, idx);
console.log(chk.map((c) => `${c.label}: ${c.value} (${c.state})`).join("\n"));
console.log("minuten Upper A:", L.estMinutes(prog.days[0]));
console.log(fails ? `\n${fails} FOUT(EN)` : "\nAlle logica-tests geslaagd");
process.exit(fails ? 1 : 0);
