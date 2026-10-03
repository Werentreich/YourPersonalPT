/* Nexa Hybrid fase 3: voeding die meebeweegt met de training. */
import * as F from "../src/hybrid/engine/fuel.js";
import * as M from "../src/hybrid/engine/model.js";
import * as B from "../src/hybrid/engine/blocks.js";

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const near = (a, b, t) => a != null && Math.abs(a - b) <= t;

// ---------- basis zoals Nexa ----------
ok("BMR man (80 kg, 180 cm, 35 jr) = 1755", F.calcBMR({ sex: "man", weight: 80, height: 180, age: 35 }) === 1755);
ok("BMR met vetpercentage (Katch-McArdle)", near(F.calcBMR({ weight: 80, bodyFat: 15, useBodyFat: true }), 370 + 21.6 * 68, 0.01));
ok("eiwit: cut 2,2, onderhoud 1,9, bulk 1,8 g/kg", F.proteinPerKg({ goal: "cut" }) === 2.2 && F.proteinPerKg({ goal: "onderhoud" }) === 1.9 && F.proteinPerKg({ goal: "bulk" }) === 1.8);
const base = F.nutritionBase({ sex: "man", age: 35, height: 180, weight: 80, goal: "onderhoud", activityFactor: 1.35 });
ok("rustverbruik = BMR × activiteit", near(base.rest, 1755 * 1.35, 0.01));
const cut = F.nutritionBase({ sex: "man", age: 35, height: 180, weight: 80, goal: "cut", rate: -0.5, activityFactor: 1.35 });
ok("cut 0,5%/wk = 0,4 kg/wk ≈ −440 kcal/dag (7700 kcal/kg)", near(cut.delta, -440, 1));
const bulk = F.nutritionBase({ weight: 80, goal: "bulk", rate: 0.25 });
ok("bulk 0,25%/wk ≈ +157 kcal/dag (5500 kcal/kg)", near(bulk.delta, 157.1, 0.5));
ok("rustverbruik uit Nexa gaat voor", F.nutritionBase({ weight: 80, restKcal: 2500 }).rest === 2500);

// ---------- verbruik ----------
const run = { ...M.newSession("duur"), sport: "hardlopen", type: "rustig", durationSec: 3600 };
ok("rustig lopen 60 min, 80 kg: (8,5−1)×3,5×80/200×60 = 630 kcal", F.sessionKcal(run, 80) === 630);
ok("intervallen verbruiken meer dan rustig", F.sessionKcal({ ...run, type: "interval" }, 80) > 630);
ok("fietsen met vermogen: 200 W × 1 u = 720 kJ ≈ 720 kcal", F.sessionKcal({ ...run, sport: "fietsen", avgPower: 200 }, 80) === 720);
const lift = { ...M.newSession("kracht"), durationSec: 3600, blocks: [{ type: "sets", items: [{ moveId: "back_squat", sets: [{ kg: 100, reps: 5 }] }] }] };
ok("kracht 60 min = MET 5 → 336 kcal", F.sessionKcal(lift, 80) === 336);
const plannedLong = { planned: true, kind: "duur", sport: "hardlopen", type: "lang", targetMin: 100, hard: false };
ok("geplande sessie gebruikt de doeltijd", F.sessionKcal(plannedLong, 80) === Math.round(F.netKcal(8.5, 100, 80)));

// ---------- dagklassen ----------
ok("geen training: rustdag", F.dayClass([]).cls === "rust");
ok("40 min rustig: licht", F.dayClass([{ ...run, durationSec: 2400 }]).cls === "licht");
ok("60 min rustig: gemiddeld", F.dayClass([run]).cls === "gemiddeld");
ok("100 min lang: zwaar", F.dayClass([plannedLong]).cls === "zwaar");
ok("twee sessies: zwaar", F.dayClass([run, lift]).cls === "zwaar");
ok("3 uur: zeer zwaar", F.dayClass([{ ...run, durationSec: 10800 }]).cls === "zeerzwaar");
ok("wedstrijddag: zeer zwaar", F.dayClass([{ planned: true, slot: "RACE", type: "wedstrijd", kind: "duur", targetMin: 40 }]).cls === "zeerzwaar");
const before = F.dayClass([], [plannedLong]);
ok("rustdag vóór lange duur wordt gemiddeld, met reden", before.cls === "gemiddeld" && before.reasons.some((r) => /morgen/.test(r)));
ok("rustdag vóór zware sessie wordt licht", F.dayClass([], [{ planned: true, kind: "duur", type: "interval", targetMin: 55, hard: true }]).cls === "licht");

// ---------- doelen ----------
const rest = F.dayTargets(base, []);
const heavy = F.dayTargets(base, [plannedLong]);
ok("rustdag onderhoud: 3–4 g/kg koolhydraten (binnen het energiebudget), eiwit 1,9 g/kg", rest.carbsPerKg >= 3 && rest.carbsPerKg <= 4 && rest.protein === 152, rest.carbsPerKg);
ok("zware dag: meer kcal en 6,5–7,5 g/kg koolhydraten", heavy.kcal > rest.kcal && heavy.carbsPerKg >= 6.5 && heavy.carbsPerKg <= 7.5, `${heavy.kcal} ${heavy.carbsPerKg}`);
ok("energie = rustverbruik + training (onderhoud)", Math.abs(heavy.kcal - (base.rest + heavy.exercise)) <= 6);
ok("kcal sluit: eiwit×4 + kh×4 + vet×9", heavy.kcal === heavy.protein * 4 + heavy.carbs * 4 + heavy.fat * 9);
ok("vet minstens 0,8 g/kg", rest.fat >= 64 && heavy.fat >= 64);
const bigCut = F.nutritionBase({ sex: "vrouw", age: 30, height: 165, weight: 60, goal: "cut", rate: -1, activityFactor: 1.2 });
const hard = F.dayTargets(bigCut, [{ ...run, durationSec: 7200, type: "lang" }]);
ok("groot tekort op zware dag: kcal omhoog met uitleg", hard.raised && hard.notes.some((n) => /te groot/.test(n)), JSON.stringify(hard));
ok("energiebeschikbaarheid berekend en gewaarschuwd onder 30", hard.ea != null && (hard.ea >= 30 || hard.notes.some((n) => /energiebeschikbaarheid/.test(n))));
const cutRest = F.dayTargets(cut, []);
ok("cut rustdag: 3 g/kg koolhydraten", cutRest.carbs === 240);

// ---------- rond de training ----------
const fLong = F.fuelingFor(plannedLong, 80);
ok("lange duur: maaltijd vooraf, 30–60 g/u tijdens, vocht", /80–160 g/.test(fLong.before) && /30–60 g/.test(fLong.during) && /0,4–0,8 liter/.test(fLong.fluids));
const fUltra = F.fuelingFor({ planned: true, kind: "duur", sport: "fietsen", type: "lang", targetMin: 180 }, 80);
ok("3 uur: 60–90 g/u met glucose en fructose, natrium", /60–90 g/.test(fUltra.during) && /fructose/.test(fUltra.during) && /natrium/.test(fUltra.fluids));
ok("kort rustig: water volstaat", F.fuelingFor({ ...run, durationSec: 1800 }, 80).during === "Water volstaat.");
ok("tweede sessie dezelfde dag: snel herstel", /binnen 6 uur/.test(F.fuelingFor(run, 80, { nextWithinHours: 6 }).after));
ok("kracht: eiwit na afloop (25 g bij 80 kg)", /25 g eiwit/.test(F.fuelingFor(lift, 80).after));

// ---------- wedstrijd ----------
ok("marathon-duur uit 5 km (Riegel)", near(F.raceMinutes("marathon", { run5k: 1260 }), (1260 * Math.pow(42.2 / 5, 1.06)) / 60, 0.01));
const rn = F.raceNutrition("marathon", 70, 200);
ok("marathon: carb-loading 10–12 g/kg (700–840 g)", /700–840 g/.test(rn.loading) && /60–90 g/.test(rn.during));
const r5 = F.raceNutrition("5k", 70, 22);
ok("5 km: geen carb-loading, water", /niet nodig/.test(r5.loading) && /Water/.test(r5.during));
ok("cafeïne 3–6 mg/kg (210–420 mg bij 70 kg)", /210–420 mg/.test(rn.caffeine));

// ---------- week ----------
const MON = "2026-10-05";
const items = [{ id: "a", planned: true, status: "gepland", date: "2026-10-06", kind: "duur", sport: "hardlopen", type: "interval", targetMin: 55, hard: true }, { id: "b", planned: true, status: "gepland", date: "2026-10-11", kind: "duur", sport: "hardlopen", type: "lang", targetMin: 100 }, { id: "c", planned: true, status: "overgeslagen", date: "2026-10-08", kind: "kracht", targetMin: 60, hard: true }];
const logged = { ...run, id: "s1", date: "2026-10-06", planItemId: "a", type: "interval", durationSec: 3000 };
const wk = F.weekNutrition(base, MON, [logged], items);
ok("week: zeven dagen", wk.length === 7);
ok("vastgelegd gaat voor gepland (geen dubbeltelling)", F.sessionsOfDay("2026-10-06", [logged], items).length === 1);
ok("overgeslagen sessie telt niet", wk[3].cls === "rust");
ok("zaterdag (vóór de lange duur) gemiddeld, zondag zwaar", wk[5].cls === "gemiddeld" && wk[6].cls === "zwaar");

const cutM = F.nutritionBase({ sex: "man", age: 34, height: 182, weight: 80, bodyFat: 16, useBodyFat: true, goal: "cut", rate: -0.5, restKcal: 2550 });
const modDay = F.dayTargets(cutM, [{ planned: true, kind: "duur", sport: "hardlopen", type: "drempel", targetMin: 41, hard: true }]);
ok("gewone cut op een gemiddelde dag: geen waarschuwing, kh naar ≥ 4 g/kg", !modDay.raised && modDay.carbsPerKg >= 4 && modDay.notes.length === 0, JSON.stringify(modDay));

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
