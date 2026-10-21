/* Doelen in het schema: hoofddoel (piek), tussendoelen, aftellen, voeding. */
import * as P from "../src/hybrid/engine/planner.js";
import * as G from "../src/hybrid/engine/goals.js";
import { raceMinutes } from "../src/hybrid/engine/fuel.js";

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const ctx = { sessions: [], profile: {} };
const base = { goal: "hyrox", goalDate: "2026-11-04", days: [0, 1, 3, 5, 6], startDate: "2026-09-28" };
const wk = (s, m) => P.generateWeek(s, ctx, m);

// hoofddoel
ok("hoofddoel: soort volgt het schemadoel", G.mainGoal(base).kind === "hyrox" && G.mainGoal({ ...base, goal: "10k" }).km === 10 && G.mainGoal({ ...base, goal: "kracht" }).kind === "anders");
ok("hoofddoel: eigen soort en afstand", (() => { const g = G.mainGoal({ ...base, goalKind: "hardlopen", goalKm: 21.1, goalName: " Bosloop " }); return g.kind === "hardlopen" && g.km === 21.1 && g.name === "Bosloop"; })());
ok("geen datum: geen doel", G.mainGoal({ goal: "hyrox" }) === null && G.mainGoal({ goalDate: "4 nov" }) === null);
let w = wk(base, "2026-11-02");
const race = w.items.find((x) => x.slot === "RACE");
ok("Hyrox-wedstrijd is een Hyrox-sessie (geen hardloopwedstrijd)", race && race.kind === "hyrox" && race.date === "2026-11-04" && race.race.main, race && race.kind);
ok("wedstrijdweek: opener twee dagen ervoor", w.items.some((x) => x.opener && x.date === "2026-11-02"), w.items.map((x) => x.date + ":" + x.slot).join(" "));
ok("wedstrijdweek: geen kracht vóór de wedstrijd", !w.items.some((x) => x.kind === "kracht" && x.date < "2026-11-04"));
const run = wk({ ...base, goal: "10k", goalDate: "2026-11-08" }, "2026-11-02").items.find((x) => x.slot === "RACE");
ok("loopdoel: hardloopwedstrijd met afstand", run && run.kind === "duur" && run.sport === "hardlopen" && run.distanceKm === 10);
ok("taper vóór het hoofddoel", wk(base, "2026-10-26").phase === "taper" && wk(base, "2026-10-19").phase === "piek");
ok("opener niet als er al iets vóór de wedstrijd staat", (() => { const x = wk({ ...base, goalDate: "2026-11-07", days: [0, 1, 2, 3] }, "2026-11-02"); return !x.items.some((y) => y.opener) && x.items.some((y) => y.date < "2026-11-07" && y.slot !== "M_MOB"); })());

// tussendoelen
const sub = { ...base, subGoals: [{ id: "a", date: "2026-10-25", name: "Bosloop", kind: "hardlopen", km: 10 }] };
w = wk(sub, "2026-10-19");
const sr = w.items.find((x) => x.slot === "RACE");
ok("tussendoel staat in de week", sr && sr.date === "2026-10-25" && !sr.race.main && /Tussendoel: Bosloop/.test(sr.title));
ok("tussendoel: niets anders op de wedstrijddag", w.items.filter((x) => x.date === "2026-10-25").length === 1);
const before = w.items.find((x) => x.date === "2026-10-24");
ok("dag ervoor: kort en rustig", before && !before.hard && before.targetMin <= 30 && before.changed === "rustig", before && before.title);
ok("twee/drie dagen ervoor: zware sessie korter", w.items.some((x) => x.date === "2026-10-22" && x.changed === "minder"));
ok("periodisering blijft (piek)", w.phase === "piek");
const nxt = wk(sub, "2026-10-26").items.find((x) => x.date === "2026-10-26");
ok("dag erna (volgende week): herstel", nxt && !nxt.hard && nxt.changed === "rustig", nxt && nxt.title);
ok("geen tussendoel: geen aangepaste sessies", !wk(base, "2026-10-19").items.some((x) => x.changed));
ok("tussendoel op de dag van het hoofddoel telt niet", G.subGoals({ ...base, subGoals: [{ date: "2026-11-04" }] }).length === 0);
ok("tussendoelen gesorteerd, ongeldige weg", G.subGoals({ subGoals: [{ date: "2026-12-01" }, { date: "x" }, { date: "2026-11-20", kind: "hyrox" }] }).map((g) => g.date).join() === "2026-11-20,2026-12-01");
ok("waarschuwing: tussendoel vlak voor hoofddoel", /dagen voor uw hoofddoel/.test(G.subWarning({ date: "2026-10-28" }, base) || "") && G.subWarning({ date: "2026-10-10" }, base) === null);
ok("geen dubbele trainingen in een week met tussendoel", !wk({ ...sub, doubles: true, goalDate: null }, "2026-10-19").items.some((x) => x.part));

// aftellen
const c = G.countdown(sub, "2026-10-21");
ok("aftellen: eerst het tussendoel, hoofddoel ook bekend", c.goal.id === "a" && c.days === 4 && c.main.days === 14, JSON.stringify({ d: c.days, m: c.main && c.main.days }));
ok("aftellen: na de wedstrijd niets", G.countdown(base, "2026-11-05") === null);

// voeding
ok("voeding: 6 dagen ervoor onderhoud, nog geen koolhydraten", (() => { const f = G.raceDayFuel(base, "2026-10-29"); return f && f.left === 6 && f.perKg === null; })());
ok("voeding: Hyrox (90 min): dag ervoor 8 g/kg, wedstrijddag geen stapeldag", G.raceDayFuel(base, "2026-11-03").perKg === 8 && G.raceDayFuel(base, "2026-11-02").perKg === null && G.raceDayFuel(base, "2026-11-04").race);
ok("voeding: langer dan 90 min: twee dagen 10 g/kg", G.raceDayFuel(base, "2026-11-02", 120).perKg === 10 && G.raceDayFuel(base, "2026-11-03", 120).perKg === 10);
ok("voeding: 7 dagen ervoor en daarna gewoon", G.raceDayFuel(base, "2026-10-28") === null && G.raceDayFuel(base, "2026-11-05") === null);
ok("aftelkaart: load alleen op stapeldag", G.raceFuel(base, "2026-11-03").load && !G.raceFuel(base, "2026-11-01").load);
const cm = G.carbLoadMacros({ protein: 160, fat: 80, carbs: 300, kcal: 160 * 4 + 80 * 9 + 300 * 4 }, 80, 8);
ok("stapelen: 640 g koolhydraten, vet naar 48 g, kcal omhoog", Math.round(cm.carbs) === 640 && Math.round(cm.fat) === 48 && cm.kcal > 2560 + 720, JSON.stringify({ c: Math.round(cm.carbs), f: Math.round(cm.fat), k: Math.round(cm.kcal) }));
ok("stapelen: genoeg koolhydraten blijft gelijk", G.carbLoadMacros({ protein: 1, fat: 1, carbs: 900, kcal: 1 }, 80, 8).carbs === 900);
ok("wedstrijdduur volgt de wedstrijd zelf", raceMinutes("hyrox", {}, { kind: "hardlopen", km: 10 }) === 60 && raceMinutes("10k", {}, { kind: "hyrox" }) === 90);

console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd");
