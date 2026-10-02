import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const grab = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const code = [
  grab("function weightTrend(", "/* Caloriecorrectie op basis van gemeten"),
  grab("const energyOfRate =", "/* ---------------- lichaamssamenstelling"),
  grab("function calcBMR(", "const sessionKcal"),
  grab("const STEP_KCAL_PER_KG", "const ACTIVITY = ["),
].join("\n");
const L = new Function(`const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f;};const sum=(a)=>a.reduce((x,y)=>x+y,0);` + code + "return {weightTrend, calorieCorrection, coachState, intakeBetween, activityFactorOf, stepsOf, stepKcal, calcBMR, stepFloor};")();
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i ? "  → " + i : "")); };
const days = (start, ws) => ws.map((w, k) => ({ date: new Date(Date.parse(start) + k * 864e5).toISOString().slice(0, 10), weight: w }));
// het echte verloop van de gebruiker (opbouwfase, week 2 van het plan)
const mine = days("2026-09-23", [79.2, 79.2, 78.7, 78.7, 78.6, 78.3, 78.2, 78.2, 78.1, 78.0]);
const base = { goal: "bulk", targetKgPerWeek: 0.237, coach: {}, plan: { active: true, inPhase: 2, phase: "bulk" }, steps: 5000, age: 34, weight: 79, checkins: [], avgTarget: 2572, tdeeAvg: 2386 };
let r = L.coachState({ ...base, log: mine, today: "2026-10-02" });
ok("dag 9: vroeg signaal (gaat de verkeerde kant op)", r.stage === "vroeg" && r.small === 150, `${r.stage} ${r.trend && r.trend.kgPerWeek.toFixed(2)} kleine correctie ${r.small}`);
const mine2 = [...mine, { date: "2026-10-03", weight: 78.0 }];
r = L.coachState({ ...base, log: mine2, today: "2026-10-03" });
ok("dag 10: geen pauze (dalen in een bulk is geen vocht), bijsturen in stap van 300", r.stage === "bijsturen" && r.correction.rounded === 300 && r.correction.full > 1000, `${r.stage} volledig ${r.correction && r.correction.full} stap ${r.correction && r.correction.rounded} (${r.correction && r.correction.stepsLeft} stappen)`);
ok("bulk: nooit 'minder lopen' als oplossing", !r.stepsFirst);
r = L.coachState({ ...base, log: mine2, today: "2026-10-05", coach: { corr: { at: "2026-10-03", amount: 300 } } });
ok("na bijsturen: een week wachten", r.stage === "wacht" && r.until === "2026-10-10", `${r.stage} tot ${r.until}`);
const after = [...mine2, ...days("2026-10-04", [78.1, 78.0, 78.1, 78.2, 78.1, 78.2, 78.3])];
r = L.coachState({ ...base, log: after, today: "2026-10-10", coach: { corr: { at: "2026-10-03", amount: 300 } } });
ok("na een week: alleen metingen sinds de bijsturing tellen", r.trend && r.trend.n === 8 && r.trend.kgPerWeek > 0, `${r.stage} ${r.trend && r.trend.kgPerWeek.toFixed(2)} kg/wk over ${r.trend && r.trend.n} metingen`);
// pauze alleen in de richting van vocht
const fastGain = days("2026-09-21", [79, 79.3, 79.5, 79.6, 79.8, 80.0, 80.1, 80.2, 80.4, 80.5, 80.6]);
r = L.coachState({ ...base, log: fastGain, today: "2026-10-01" });
ok("begin bulk, sneller aankomen dan gepland: pauze (glycogeen en vocht)", r.stage === "pauze", r.stage);
// cut, te traag, weinig stappen: eerst meer lopen
const slowCut = days("2026-09-10", [85, 85, 84.9, 85, 84.9, 84.9, 84.8, 84.9, 84.8, 84.8, 84.7, 84.8, 84.7, 84.7]);
r = L.coachState({ ...base, goal: "cut", targetKgPerWeek: -0.5, plan: null, log: slowCut, today: "2026-09-23", steps: 5000, weight: 85 });
ok("cut te traag, 5.000 stappen: eerst naar 8.000 stappen", r.stage === "bijsturen" && r.stepsFirst && r.stepsFirst.to === 8000 && r.stepsFirst.kcal === 130 && r.stepsFirst.rest === -170, JSON.stringify(r.stepsFirst));
r = L.coachState({ ...base, goal: "cut", targetKgPerWeek: -0.5, plan: null, log: slowCut, today: "2026-09-23", steps: 9000, weight: 85 });
ok("cut te traag, 9.000 stappen: gewoon minder eten", r.stage === "bijsturen" && !r.stepsFirst && r.correction.rounded === -300);
r = L.coachState({ ...base, goal: "cut", targetKgPerWeek: -0.5, plan: null, log: slowCut, today: "2026-09-23", steps: 6000, age: 64, weight: 85 });
ok("60+: minimum 7.000", r.stepsFirst && r.stepsFirst.to === 7000);
// schematrouw
r = L.coachState({ ...base, goal: "cut", targetKgPerWeek: -0.5, plan: null, log: slowCut, today: "2026-09-23", steps: 9000, weight: 85, checkins: [{ date: "2026-09-20", adherence: "slecht" }] });
ok("schema vaak niet gevolgd: eerst daaraan werken", r.stage === "trouw");
r = L.coachState({ ...base, goal: "cut", targetKgPerWeek: -0.5, plan: null, log: slowCut, today: "2026-09-23", steps: 9000, weight: 85, checkins: [{ date: "2026-09-20", adherence: "slecht" }], coach: { adherenceOverride: true } });
ok("toch bijsturen kan", r.stage === "bijsturen");
// koers
const onTrack = days("2026-09-10", [80, 80.05, 80.1, 80.05, 80.1, 80.15, 80.1, 80.2, 80.2, 80.25, 80.2, 80.3]);
r = L.coachState({ ...base, goal: "bulk", targetKgPerWeek: 0.2, plan: null, log: onTrack, today: "2026-09-21" });
ok("op koers: niets doen", r.stage === "koers", `${r.stage} ${r.trend.kgPerWeek.toFixed(2)}`);
// gemeten onderhoud na drie weken
const threeW = days("2026-09-01", Array.from({ length: 22 }, (_, k) => +(80 - k * 0.1).toFixed(2)));
r = L.coachState({ ...base, goal: "bulk", targetKgPerWeek: 0.2, plan: null, log: threeW, today: "2026-09-22", coach: { kcalHist: [{ date: "2026-09-01", avg: 2500 }] } });
ok("gemeten onderhoud: 2500 gegeten en -0,7 kg/week → ± 3270", r.measured && Math.abs(r.measured.kcal - 3270) <= 20, JSON.stringify(r.measured));
ok("intake gewogen over de tijd", Math.round(L.intakeBetween([{ date: "2026-09-01", avg: 2000 }, { date: "2026-09-11", avg: 3000 }], "2026-09-01", "2026-09-20", 0)) === 2500);
// energie: stappen
const bmr = L.calcBMR({ sex: "man", weight: 79, height: 172, age: 34, bodyFat: 16, useBodyFat: true });
const f8 = L.activityFactorOf(bmr, { steps: 8000, work: "zittend", weight: 79 });
ok("8.000 stappen bij 79 kg: ± 316 kcal lopen, factor ± 1,33", Math.round(L.stepKcal(8000, 79)) === 316 && Math.abs(f8 - 1.325) < 0.01, f8.toFixed(3));
ok("oude keuze 'zittend' wordt 5.000 stappen (schatting)", L.stepsOf({ activity: "zittend" }).steps === 5000 && L.stepsOf({ activity: "zittend" }).est);
ok("ingevulde stappen gaan voor", L.stepsOf({ activity: "zittend", steps: 9500, work: "staand" }).steps === 9500 && !L.stepsOf({ steps: 9500 }).est);
console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd"); process.exit(fails ? 1 : 0);
