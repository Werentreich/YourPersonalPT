/* Wekelijkse check-in: afwijkende dagen en eerlijk bijsturen. */
import fs from "node:fs";
import * as CK from "../src/checkin.js";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const grab = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const code = [
  grab("function weightTrend(", "/* Caloriecorrectie op basis van gemeten"),
  grab("const energyOfRate =", "/* ---------------- lichaamssamenstelling"),
  grab("const STEP_KCAL_PER_KG", "const ACTIVITY = ["),
].join("\n");
const L = new Function("deviationBetween", "adjustTrend", "trendWindow", `const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f;};const sum=(a)=>a.reduce((x,y)=>x+y,0);` + code + "return {coachState};")(CK.deviationBetween, CK.adjustTrend, CK.trendWindow);
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  → " + i : "")); };
const iso = (start, k) => new Date(Date.parse(start) + k * 864e5).toISOString().slice(0, 10);

// dagen en samenvatting
ok("check-in gaat over de zeven dagen tot en met gisteren", CK.checkinDays("2026-10-26").join() === "2026-10-19,2026-10-20,2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-25");
const food = { days: { "2026-10-20": "minder", "2026-10-23": "minder", "2026-10-24": "meer" }, less: "veel", more: "klein" };
const fs1 = CK.foodSummary(food);
ok("samenvatting: 3 dagen anders, −1750 kcal", fs1.offDays === 3 && fs1.lessDays === 2 && fs1.moreDays === 1 && fs1.week === -1750, JSON.stringify(fs1));
ok("trouw: 0 dagen goed, 1–3 meestal, 4+ slecht", CK.adherenceOf({ days: {} }) === "goed" && CK.adherenceOf(food) === "meestal" && CK.adherenceOf({ days: { a: "minder", b: "minder", c: "meer", d: "meer" } }) === "slecht");
ok("onbekende grootte telt als flink (500)", CK.dayDeviations({ days: { x: "minder" } }).x === -500);
const cks = [{ date: "2026-10-26", food }];
ok("afwijking per dag over de week", Math.round(CK.deviationBetween(cks, "2026-10-19", "2026-10-25")) === -250);
ok("dagen zonder check-in tellen als schema", Math.round(CK.deviationBetween(cks, "2026-10-12", "2026-10-25")) === -125);
ok("tempo met schema: minder gegeten -> trager afvallen", (() => { const t = CK.adjustTrend({ ok: true, kgPerWeek: -0.6 }, -275); return Math.abs(t.kgPerWeek - -0.35) < 0.01 && t.raw === -0.6; })());
ok("meer gegeten -> sneller aankomen eruit", CK.adjustTrend({ ok: true, kgPerWeek: 0.5 }, 275).kgPerWeek < 0.5);
ok("geen afwijking: trend gelijk", CK.adjustTrend({ ok: true, kgPerWeek: -0.5 }, 0).kgPerWeek === -0.5);

// de situatie van de gebruiker: cut, een paar dagen per week minder gegeten,
// sneller afgevallen -> zonder check-in zou de app de calorieën verhogen
const start = "2026-10-01";
const log = Array.from({ length: 25 }, (_, k) => ({ date: iso(start, k), weight: +(85 - (0.6 / 7) * k).toFixed(2) }));
const weeks = [0, 7, 14, 21].map((k) => ({ date: iso(start, k + 7), food: { days: { [iso(start, k + 1)]: "minder", [iso(start, k + 4)]: "minder" }, less: "veel" }, adherence: "meestal" }));
const base = { log, goal: "cut", targetKgPerWeek: -0.34, coach: {}, today: "2026-10-26", plan: null, steps: 9000, age: 34, weight: 84, avgTarget: 2200, tdeeAvg: 2700 };
const zonder = L.coachState({ ...base, checkins: [] });
const met = L.coachState({ ...base, checkins: weeks });
ok("zonder check-in: bijsturen met méér calorieën", zonder.stage === "bijsturen" && zonder.correction.rounded > 0, `${zonder.stage} ${zonder.correction && zonder.correction.rounded}`);
ok("met check-in: op koers, geen verhoging", met.stage === "koers", `${met.stage} ${met.trend && met.trend.kgPerWeek.toFixed(2)}`);
ok("trend toont gemeten en gecorrigeerd tempo", met.trend.raw < met.trend.kgPerWeek && met.trend.devPerDay < 0);
ok("gemeten onderhoud: met werkelijke inname lager", met.measured && zonder.measured && met.measured.kcal < zonder.measured.kcal && met.measured.dev < 0, `${met.measured && met.measured.kcal} / ${zonder.measured && zonder.measured.kcal}`);
const veel = L.coachState({ ...base, checkins: [{ date: "2026-10-26", food: { days: Object.fromEntries([0, 1, 2, 3].map((k) => [iso("2026-10-19", k), "minder"])) }, adherence: "slecht" }] });
ok("vier of meer afwijkende dagen: eerst schema volgen", veel.stage === "trouw" || veel.stage === "koers", veel.stage);
ok("oude check-in zonder voeding blijft werken", L.coachState({ ...base, checkins: [{ date: "2026-10-25", adherence: "goed", waist: 90 }] }).stage === zonder.stage);

console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd");
