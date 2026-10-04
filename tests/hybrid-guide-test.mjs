/* Nexa Hybrid: startersprogramma (loop-wandelen) en live begeleiding. */
const P = await import("../src/hybrid/engine/planner.js");
const M = await import("../src/hybrid/engine/model.js");
const G = await import("../src/hybrid/engine/guide.js");

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const MON = "2026-10-05";
const iso = (d) => M.isoOfNum(M.dayNum(MON) + d);
const S = { ...P.SETTINGS_DEFAULT, goal: "5k", startDate: MON, exp: { kracht: "beginner", duur: "starter" }, runNow: 1, days: [0, 2, 4, 5, 6] };

// ---------- startersprogramma ----------
const w1 = P.generateWeek(S, { sessions: [], profile: {} }, MON);
const runs1 = w1.items.filter((x) => x.starterLevel);
ok("starter week 1: drie loop-wandeltrainingen van 8 × 1 min", runs1.length === 3 && runs1.every((x) => x.starterLevel === 1 && /8 × 1 min/.test(x.title)), runs1.map((x) => x.title).join(" | "));
ok("starter: nooit twee looptrainingen op opeenvolgende dagen", runs1.every((x, i) => i === 0 || M.dayNum(x.date) - M.dayNum(runs1[i - 1].date) >= 2));
ok("starter: overige duursessie zonder hardlopen", w1.items.filter((x) => x.kind === "duur" && !x.starterLevel).every((x) => x.sport !== "hardlopen"));
ok("starter: geen intervallen of drempelwerk", !w1.items.some((x) => x.type === "drempel" || x.type === "interval"));
ok("starter: geplande minuten = inhoud (5 + 18,5 + 5)", runs1[0].targetMin === 29, runs1[0].targetMin);
const done = (lvlWeek, rpe = 5, n = 3) => Array.from({ length: n }, (_, k) => ({ ...M.newSession("duur"), date: iso(lvlWeek * 7 + k * 2), sport: "hardlopen", durationSec: 1800, rpe }));
ok("niveau omhoog na een week met minstens twee looptrainingen", P.starterLevel(S, done(0), iso(7)) === 1);
ok("niveau blijft bij maar één looptraining", P.starterLevel(S, done(0, 5, 1), iso(7)) === 0);
ok("niveau blijft als het te zwaar was (inspanning 8+)", P.starterLevel(S, done(0, 8), iso(7)) === 0);
ok("startniveau uit 'kan nu 5–10 min hardlopen'", P.starterLevel({ ...S, runNow: 8 }, [], MON) === 5 && /3 × 8 min/.test(P.starterSession(5).title));
const all = [...done(0), ...done(1), ...done(2), ...done(3), ...done(4), ...done(5), ...done(6), ...done(7), ...done(8), ...done(9)];
const grad = P.generateWeek(S, { sessions: all, profile: {} }, iso(70));
ok("na het programma (30 min aan één stuk) verder als beginner", !grad.items.some((x) => x.starterLevel) && grad.items.some((x) => x.kind === "duur" && x.sport === "hardlopen"));
ok("laatste niveaus: aan één stuk, zonder wandelen", P.starterSession(9).blocks[1].type === "doorlopend" && /30 minuten/.test(P.starterSession(9).title));

// ---------- programma ----------
const prog = G.programFromBlocks(runs1[0].blocks);
ok("programma: inwandelen, 8× hardlopen, 7× wandelen, uitwandelen", prog.length === 17 && prog[0].label === "Wandelen" && prog[1].label === "Hardlopen" && prog[2].label === "Wandelen" && prog[16].kind === "walk", prog.map((x) => x.label[0]).join(""));
ok("programma: totale tijd 28,5 min", G.programSeconds(prog) === 1710);
ok("aanwijzing: tekst met duur en ronde", G.cueText(prog[1]) === "Hardlopen, 1 minuut, ronde 1 van 8." && G.cueText(prog[2]) === "Wandelen, 1 minuut 30." && G.cueText(null).startsWith("Training klaar"));

// ---------- voortgang ----------
let c = G.startCursor();
c = G.advance(prog, c, 299, 300);
ok("na 4:59 nog in de warming-up", c.index === 0 && G.guideState(prog, c, 299, 300).left === 1);
c = G.advance(prog, c, 300, 310);
ok("op 5:00 begint hardlopen", c.index === 1 && G.guideState(prog, c, 300, 310).left === 60 && G.guideState(prog, c, 300, 310).next.label === "Wandelen");
c = G.advance(prog, c, 455, 600);
ok("meerdere segmenten tegelijk doorschuiven (na pauze in de app)", c.index === 3 && c.startT === 450);
c = G.advance(prog, c, 5000, 4000);
ok("na het einde: klaar", G.guideState(prog, c, 5000, 4000).done);
const iv = G.programFromBlocks([{ type: "interval", rounds: 3, restSec: 90, items: [{ moveId: "run", distanceM: 400 }] }]);
let d = G.advance(iv, G.startCursor(), 100, 399);
ok("afstandssegment: loopt tot de afstand bereikt is", d.index === 0 && G.guideState(iv, d, 100, 399).leftM === 1);
d = G.advance(iv, d, 101, 402);
ok("afstand bereikt: rust op tijd vanaf dat moment", d.index === 1 && G.guideState(iv, d, 131, 450).left === 60);

console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
