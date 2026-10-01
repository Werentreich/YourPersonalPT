import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const body = cut("const workSets =", "const readinessScore") + cut("/* ---------------- technieken", "function historyFor(");
const pre = `const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f};const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));const roundTo=(v,s)=>s>0?Math.round(v/s)*s:v;const e1rm=()=>0;`;
const L = new Function(pre + body + "return {applyTech,syncSubs,addWorkSet,removeWorkSet,ssGroups,sessionOrder,nextStep,effSets,ssKind,suggestSupersets,techExtraSets,normTech,setBlocks};")();
let fails = 0;
const ok = (label, cond, info = "") => { if (!cond) fails++; console.log((cond ? "OK  " : "FOUT") + " " + label + (info ? "  " + info : "")); };
const W = (w, done = false, reps = null) => ({ type: "work", weight: w, reps, rir: null, done });
const WU = (w) => ({ type: "warmup", weight: w, reps: 8, done: false });
const types = (ss) => ss.map((x) => x.type[0] + (x.k || "")).join(" ");

// dropset op laatste set
const drop = { type: "drop", n: 2, pct: 20 };
let s = L.applyTech([WU(40), W(100), W(100)], drop, 2.5);
ok("drop: subs na laatste werkset", types(s) === "w w w d1 d2", types(s));
ok("drop: gewichten 80 en 64 (afgerond 2,5 -> 65)", s[3].weight === 80 && s[4].weight === 65, s[3].weight + "/" + s[4].weight);
s = L.applyTech([W(100), W(100)], { ...drop, all: true }, 2.5);
ok("drop all: subs na elke werkset", types(s) === "w d1 d2 w d1 d2", types(s));
// sync
let t = L.applyTech([W(100), W(100)], drop, 2.5);
t = t.map((x, k) => (k === 1 ? { ...x, weight: 110 } : x));
t = L.syncSubs(t, drop, 2.5);
ok("sync volgt nieuw werkgewicht", t[2].weight === 87.5, String(t[2].weight));
t[2] = { ...t[2], weight: 90, manual: true };
t = L.syncSubs(t.map((x, k) => (k === 1 ? { ...x, weight: 120 } : x)), drop, 2.5);
ok("sync laat handmatig gewicht staan", t[2].weight === 90 && t[3].weight !== 70.4);
// add/remove
let a = L.applyTech([W(100), W(100)], drop, 2.5);
a = L.addWorkSet(a, drop, 2.5);
ok("set erbij: techniek blijft op laatste", types(a) === "w w w d1 d2", types(a));
a = L.removeWorkSet(a, drop, 2.5);
ok("set eraf: techniek schuift door", types(a) === "w w d1 d2", types(a));
a = L.removeWorkSet(L.removeWorkSet(a, drop, 2.5), drop, 2.5);
ok("laatste werkset gaat met subs weg", a.length === 0 || types(a) === "w d1 d2", types(a));
let b = L.addWorkSet(L.applyTech([W(100)], { ...drop, all: true }, 2.5), { ...drop, all: true }, 2.5);
ok("all: nieuwe set met eigen subs", types(b) === "w d1 d2 w d1 d2", types(b));
// myo n default
ok("myo standaard 4 mini-sets", L.normTech({ type: "myo" }).n === 4);
ok("partial altijd 1", L.normTech({ type: "partial", n: 3 }).n === 1);

// supersets
const ex = (sets, extra = {}) => ({ sets, rest: 120, ...extra });
const E = [ex([WU(20), W(50), W(50)], { ss: true, ssRest: 10 }), ex([WU(20), W(40), W(40)]), ex([W(30)])];
const g = L.ssGroups(E);
ok("groep A1/A2, derde los", g[0].label === "A1" && g[1].label === "A2" && g[2].label === null);
const ord = L.sessionOrder(E).map((o) => `${o.i}.${o.j}`).join(" ");
ok("volgorde: warm-ups, dan afwisselen", ord === "0.0 1.0 0.1 1.1 0.2 1.2 2.0", ord);
let st = L.nextStep(E, 0, 1);
ok("na A1-set: wissel 10 s naar A2", st.kind === "wissel" && st.rest === 10 && st.next.i === 1 && st.next.j === 1, JSON.stringify(st));
st = L.nextStep(E, 1, 1);
ok("na A2-set: volle rust terug naar A1", st.kind === "rust" && st.rest === 120 && st.next.i === 0 && st.next.j === 2, JSON.stringify(st));
st = L.nextStep(E, 0, 0);
ok("na warming-up A1: naar warming-up A2", st.next.i === 1 && st.next.j === 0 && st.rest === 60);
// superset + techniek
const E2 = [ex(L.applyTech([W(50), W(50)], { type: "rp", n: 2, pause: 20 }, 2.5), { ss: true, tech: { type: "rp", n: 2, pause: 20 } }), ex([W(40), W(40)])];
const o2 = L.sessionOrder(E2).map((o) => `${o.i}.${o.j}`).join(" ");
ok("superset met rest-pause op laatste set", o2 === "0.0 1.0 0.1 0.2 0.3 1.1", o2);
st = L.nextStep(E2, 0, 1);
ok("na werkset met rp: pauze 20 s", st.kind === "sub" && st.rest === 20, JSON.stringify(st));
st = L.nextStep(E2, 0, 3);
ok("na laatste mini-set: wissel naar A2", st.kind === "wissel" && st.next.i === 1);
// drop: geen rust
const E3 = [ex(L.applyTech([W(50)], drop, 2.5), { tech: drop })];
ok("na werkset met drop: 0 s", L.nextStep(E3, 0, 0).rest === 0);

// volume
const v = { sets: [W(100, true, 8), { type: "drop", k: 1, done: true, reps: 6 }, { type: "drop", k: 2, done: true, reps: 4 }, { type: "drop", k: 3, done: true, reps: 3 }] };
ok("volume: 1 werkset + 3 drops = 2 (max +1)", L.effSets(v) === 2, String(L.effSets(v)));
ok("volume: 1 werkset + 1 drop = 1,5", L.effSets({ sets: [W(100, true, 8), { type: "drop", k: 1, done: true, reps: 6 }] }) === 1.5);
ok("volume: subs van niet-gedane werkset tellen niet", L.effSets({ sets: [W(100, false, 8), { type: "drop", k: 1, done: true, reps: 6 }] }) === 0);
ok("gepland extra: drop 2 op laatste = 1", L.techExtraSets({ sets: 3, tech: drop }) === 1);
ok("gepland extra: rp 1 op alle 3 = 1,5", L.techExtraSets({ sets: 3, tech: { type: "rp", n: 1, all: true } }) === 1.5);

// soort
const X = (pri, sec = [], equip = "kabel", kind = "isolation") => ({ pri, sec, equip, kind });
ok("borst+rug = tegengesteld", L.ssKind(X(["borst"]), X(["rug"])) === "tegengesteld");
ok("biceps+biceps = zelfde", L.ssKind(X(["biceps"]), X(["biceps"])) === "zelfde");
ok("bankdrukken+triceps = overlap", L.ssKind(X(["borst"], ["triceps"]), X(["triceps"])) === "overlap");
ok("biceps+kuiten = boven-onder", L.ssKind(X(["biceps"]), X(["kuiten"])) === "boven-onder");

// voorstel
const idx = { a: { ...X(["borst"], ["triceps"], "dumbbell", "compound"), id: "a" }, b: { ...X(["quadriceps"]), id: "b" }, c: { ...X(["rug"], ["biceps"], "kabel", "compound"), id: "c" }, d: { ...X(["triceps"]), id: "d" }, e: { ...X(["biceps"]), id: "e" }, sq: { ...X(["quadriceps"], ["bilspieren"], "stang", "compound"), id: "sq" }, h: { ...X(["hamstrings"]), id: "h" } };
const day = { slots: ["a", "b", "c", "d", "e"].map((id) => ({ id: "s" + id, exId: id, sets: 2, rest: 120 })) };
const sg = L.suggestSupersets(day, idx);
ok("voorstel: borst+rug en triceps+biceps", sg && sg.pairs.length === 2 && sg.slots.map((x) => x.exId).join("") === "acbde", sg && sg.slots.map((x) => x.exId + (x.ss ? "+" : "")).join(" "));
const day2 = { slots: ["sq", "h"].map((id) => ({ id, exId: id, sets: 2 })) };
ok("voorstel: squat met stang niet in superset", L.suggestSupersets(day2, idx) === null);

console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd");
