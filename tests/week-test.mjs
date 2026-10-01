import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const body = cut("function calcBMR", "/* Aandeel van de gewichtstoename");
const pre = `const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f};const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));`;
const L = new Function(pre + body + "return {weekEnergy,adjustWeek,weekMapAdjusted,sum};")();
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i ? "  " + i : "")); };
const S = { type: "kracht", minutes: 75, start: "18:00" };
const week = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ session: [0, 1, 3, 4].includes(i) ? S : null, flex: 0 }));
const input = { sex: "man", age: 36, height: 183, weight: 85, bodyFat: 18, useBodyFat: true, activityFactor: 1.4, goal: "cut", rate: -0.5, cycling: true, kcalAdjust: 0, week };
const r = (a) => a.map((x) => Math.round(x));
const base = L.weekEnergy(input);
const tot = (e) => Math.round(L.sum(e.kcals));
console.log("basis:", r(base.kcals).join(" "), "totaal", tot(base), "sessie", Math.round(base.sess[1]));
// dinsdag (1) overslaan, 's ochtends (at=1)
const A = L.adjustWeek(input, { list: [{ kind: "skip", day: 1, at: 1, mode: "dag" }] });
console.log("skip di:", r(A.energy.kcals).join(" "), "totaal", tot(A.energy));
ok("maandag onveranderd", Math.round(A.energy.kcals[0]) === Math.round(base.kcals[0]));
ok("weektotaal daalt met sessieverbruik", Math.abs(tot(A.energy) - (tot(base) - base.sess[1])) < 2, `${tot(base) - tot(A.energy)} vs ${Math.round(base.sess[1])}`);
ok("dinsdag wordt ongeveer rustdagniveau", Math.abs(A.energy.kcals[1] - A.energy.kcals[2]) < 5, `${Math.round(A.energy.kcals[1])} vs wo ${Math.round(A.energy.kcals[2])}`);
ok("rustdagen krijgen iets terug (cyclingopslag)", A.energy.kcals[2] > base.kcals[2], `${Math.round(base.kcals[2])} -> ${Math.round(A.energy.kcals[2])}`);
ok("dagtype dinsdag = rust", A.week[1].session === null && input.week[1].session);
// verplaatsen di -> wo
const B = L.adjustWeek(input, { list: [{ kind: "move", from: 1, to: 2, at: 1 }] });
console.log("move di->wo:", r(B.energy.kcals).join(" "));
ok("verplaatsen: totaal gelijk", Math.abs(tot(B.energy) - tot(base)) < 2);
ok("verplaatsen: wo nu trainingsdag, di rust", B.week[2].session && !B.week[1].session && Math.round(B.energy.kcals[2]) === Math.round(base.kcals[1]));
// laat: al gegeten
const C = L.adjustWeek(input, { list: [{ kind: "skip", day: 1, at: 1, mode: "spreiden" }] });
console.log("spreiden:", r(C.energy.kcals).join(" "), "totaal", tot(C.energy));
ok("spreiden: dinsdag blijft zoals gegeten", Math.round(C.energy.kcals[1]) === Math.round(base.kcals[1]));
const dif = [2, 3, 4, 5, 6].map((k) => C.energy.kcals[k] - base.kcals[k]);
ok("spreiden: max 150 per dag omlaag", dif.every((d) => d >= -150.5), dif.map(Math.round).join(" "));
ok("spreiden: hoogstens het sessieverbruik eraf, nooit onder de bodem", tot(base) - tot(C.energy) <= base.sess[1] + 1 && C.energy.kcals.every((k) => k >= 1.05 * base.bmr - 0.5), String(tot(base) - tot(C.energy)));
// zondag, spreiden -> niets te spreiden
const W = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ session: i === 6 ? S : null, flex: 0 }));
const D = L.adjustWeek({ ...input, week: W }, { list: [{ kind: "skip", day: 6, at: 6, mode: "spreiden" }] });
ok("zondag spreiden: niets verandert", r(D.energy.kcals).join() === r(L.weekEnergy({ ...input, week: W }).kcals).join());
// laten
const E = L.adjustWeek(input, { list: [{ kind: "skip", day: 1, at: 1, mode: "laten" }] });
ok("laten: calorieën gelijk", r(E.energy.kcals).join() === r(base.kcals).join());
// cycling uit: overslaan
const F = L.adjustWeek({ ...input, cycling: false }, { list: [{ kind: "skip", day: 1, at: 1, mode: "dag" }] });
const bF = L.weekEnergy({ ...input, cycling: false });
ok("cycling uit: totaal daalt met sessie, over resterende dagen", Math.abs(tot(F.energy) - (tot(bF) - bF.sess[1])) < 2 && Math.round(F.energy.kcals[0]) === Math.round(bF.kcals[0]));
// weekMap
ok("weekMap skip+move", JSON.stringify(L.weekMapAdjusted(["a", "b", null, "c", "d", null, null], [{ kind: "move", from: 1, to: 2 }, { kind: "skip", day: 3 }])) === JSON.stringify(["a", null, "b", null, "d", null, null]));
console.log(fails ? fails + " FOUT" : "Alle tests geslaagd");
