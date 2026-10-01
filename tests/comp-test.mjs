import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const body = cut("function fatFractionGain", "const BF_WINDOW") + cut("/* ---------------- lichaamssamenstelling", "function recommendedProtein");
const pre = `const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f};const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));const sum=a=>a.reduce((x,y)=>x+y,0);const DAY_MS=86400000;const dayNum=iso=>Math.round(Date.parse(iso+"T00:00:00")/DAY_MS);const bestE1rm=(e)=>e.v;`;
const L = new Function(pre + body + "return {navyBodyFat,estimateComposition,measureTrend,strengthTrend,compositionAdvice};")();
let fails = 0;
const ok = (label, cond, info = "") => { if (!cond) fails++; console.log((cond ? "OK  " : "FOUT") + " " + label + (info ? "  " + info : "")); };
const iso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const d0 = Math.round(Date.parse("2026-08-03T00:00:00") / 86400000);

// Navy: man 183 cm, taille 86, nek 39 -> ~15-17%
const nv = L.navyBodyFat({ sex: "man", height: 183, waist: 86, neck: 39 });
ok("Navy man plausibel", nv > 12 && nv < 20, nv.toFixed(1) + "%");
ok("Navy vrouw zonder heup = null", L.navyBodyFat({ sex: "vrouw", height: 170, waist: 75, neck: 33 }) === null);
ok("Navy vrouw plausibel", (() => { const x = L.navyBodyFat({ sex: "vrouw", height: 170, waist: 75, neck: 33, hip: 98 }); return x > 20 && x < 32; })());

const win = [10, 17];
// Scenario A: cut, 85 kg 16%, -0,5 kg/week, taille -0,5 cm/week, 6 weken
const logA = [], ckA = [];
for (let d = 0; d <= 42; d++) logA.push({ date: iso(d0 + d), weight: 85 - (0.5 / 7) * d });
for (let w = 0; w <= 6; w++) ckA.push({ date: iso(d0 + w * 7), waist: 88 - 0.5 * w, neck: 39 });
const A = L.estimateComposition({ sex: "man", height: 183, log: logA, checkins: ckA, anchor: { date: iso(d0), bf: 16, sd: 3, weight: 85 }, win, today: iso(d0 + 42) });
ok("A: vet% daalt", A.bf < 16 && A.bf > 12, A.bf.toFixed(2) + "% ±" + A.sd.toFixed(2));
ok("A: niveau blijft even onzeker als de start (alleen meetlint)", Math.abs(A.sd - 3) < 0.3, A.sd.toFixed(2)); ok("A: verandering nauwkeurig bekend", A.changeSd < 1, "±" + A.changeSd.toFixed(2));
ok("A: vetverlies groter dan spierverlies", (A.start.fat - A.fat) > (A.start.lean - A.lean), `vet ${(A.fat - A.start.fat).toFixed(2)} kg, vetvrij ${(A.lean - A.start.lean).toFixed(2)} kg`);

// Scenario B: recomp: gewicht vlak, taille -0,4 cm/week
const logB = [], ckB = [];
for (let d = 0; d <= 28; d++) logB.push({ date: iso(d0 + d), weight: 85 + (d % 3 === 0 ? 0.3 : -0.1) });
for (let w = 0; w <= 4; w++) ckB.push({ date: iso(d0 + w * 7), waist: 88 - 0.4 * w, neck: 39 });
const B = L.estimateComposition({ sex: "man", height: 183, log: logB, checkins: ckB, anchor: { date: iso(d0), bf: 16, sd: 3, weight: 85 }, win, today: iso(d0 + 28) });
ok("B: vet% daalt bij vlak gewicht (taille omlaag)", B.bf < 15.8, B.bf.toFixed(2) + "%");
ok("B: vetvrije massa stijgt", B.lean > B.start.lean, (B.lean - B.start.lean).toFixed(2) + " kg");
const wB = L.measureTrend(ckB, "waist", iso(d0 + 28));
ok("B: tailletrend -0,4 cm/wk", wB.ok && Math.abs(wB.perWeek + 0.4) < 0.01, wB.perWeek && wB.perWeek.toFixed(2));
const advB = L.compositionAdvice({ goal: "cut", correction: { meaningful: true, rounded: -300 }, waist: wB, strength: { ok: true, pct: 1.5 } });
ok("B: advies recomp, niet bijsturen", advB && advB.kind === "recomp" && advB.suppress);

// Scenario C: echte stilstand: gewicht en taille vlak
const ckC = ckB.map((c) => ({ ...c, waist: 88 }));
const advC = L.compositionAdvice({ goal: "cut", correction: { meaningful: true, rounded: -300 }, waist: L.measureTrend(ckC, "waist", iso(d0 + 28)), strength: { ok: true, pct: 0 } });
ok("C: stilstand -> geen afwijkend advies (gewone bijsturing)", advC === null);

// Scenario D: te snel + kracht omlaag
const advD = L.compositionAdvice({ goal: "cut", correction: { meaningful: true, rounded: 250 }, waist: { ok: false }, strength: { ok: true, pct: -5 } });
ok("D: spierverlies-waarschuwing", advD && advD.kind === "spier" && !advD.suppress);

// Scenario E: DEXA-meting trekt schatting bij
const ckE = [{ date: iso(d0), waist: 88, neck: 39 }, { date: iso(d0 + 14), waist: 87, neck: 39, bf: 12, method: "dexa" }];
const E = L.estimateComposition({ sex: "man", height: 183, log: logA, checkins: ckE, anchor: { date: iso(d0), bf: 16, sd: 3, weight: 85 }, win, today: iso(d0 + 14) });
ok("E: DEXA 12% trekt schatting sterk omlaag", E.bf < 13.5, E.bf.toFixed(2) + "% ±" + E.sd.toFixed(2));
const E2 = L.estimateComposition({ sex: "man", height: 183, log: logA, checkins: [ckE[0], { ...ckE[1], method: "weegschaal" }], anchor: { date: iso(d0), bf: 16, sd: 3, weight: 85 }, win, today: iso(d0 + 14) });
ok("E: weegschaal 12% weegt minder zwaar dan DEXA", E2.bf > E.bf + 1, E2.bf.toFixed(2) + "%");

// Kracht
const ses = [];
["a", "b", "c"].forEach((x, i) => { [0, 10, 20].forEach((d, k) => ses.push({ end: 1, date: iso(d0 + d), start: (d0 + d) * 1e5, exercises: [{ exId: x, v: 100 + k * 2 }] })); });
const st = L.strengthTrend(ses, iso(d0 + 21));
ok("kracht +4%", st.ok && Math.abs(st.pct - 4) < 0.01, st.pct && st.pct.toFixed(1));
console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
