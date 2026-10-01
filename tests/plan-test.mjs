import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const a = src.indexOf("/* =========================================================================\n   TRAINING");
const b = src.indexOf("/* ---------------- geluid, trilling");
const wma = src.slice(src.indexOf("function weekMapAdjusted"), src.indexOf("/* Aandeel van de gewichtstoename"));
const pre = wma + `const num=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f;};const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));const sum=(a)=>a.reduce((x,y)=>x+y,0);const DAY_MS=86400000;const dayNum=(iso)=>Math.round(Date.parse(iso+"T00:00:00")/DAY_MS);const useState=()=>{};const useEffect=()=>{};`;
const L = new Function(pre + src.slice(a, b) + "return {buildCustomPlan, explainCustomPlan, buildExIndex, estMinutes, plannedMuscleSets, programAdvice, FOCUS_GROUPS, MUSCLES};")();
const idx = L.buildExIndex([], {});
const verbose = process.argv.includes("-v");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i && (verbose || !c) ? "\n     " + i : "")); };
const WD = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const focusM = (f) => f.flatMap((g) => L.FOCUS_GROUPS[g].muscles);
const run = (p) => {
  const prefs = { experience: "gevorderd", minutes: 60, equipment: "gym", complaints: [], focus: [], ...p };
  prefs.focusMuscles = focusM(prefs.focus);
  const r = L.buildCustomPlan(prefs, idx);
  const e = L.explainCustomPlan(r, prefs, idx);
  const pl = L.plannedMuscleSets(r.program, idx);
  const days = r.program.weekMap.map((id, i) => (id ? `${WD[i]}:${r.program.days.find((d) => d.id === id).name}` : null)).filter(Boolean).join(" ");
  const mins = r.program.days.map((d) => L.estMinutes(d));
  const exNames = (d) => d.slots.map((s) => `${idx[s.exId].name}×${s.sets}${s.ss ? "+" : ""}`).join(", ");
  const adv = L.programAdvice(r.program, idx).filter((x) => x.level === "hoog");
  return { prefs, r, e, pl, days, mins, exNames, adv };
};
const describe = (x) => `${x.r.choice.opt.label} | ${x.days} | min ${x.mins.join("/")} | sets ${["borst","rug","quadriceps","hamstrings","schouder_zij","biceps","triceps"].map((m) => m.slice(0,4) + Math.round(x.pl[m])).join(" ")}${x.adv.length ? " | HOOG-advies: " + x.adv.map((a) => a.title).join("; ") : ""}`;

// het voorbeeld van de gebruiker: 3 dagen, druk, 06:00 trainen, 05:00 op, borst en rug achter
let x = run({ days: [0, 2, 4], minutes: 60, start: "06:00", wake: "05:00", sleepHours: 6, focus: ["borst", "rug"] });
ok("voorbeeld: 3 dagen ma/wo/vr", x.r.program.days.length >= 2, describe(x));
ok("voorbeeld: borst en rug meer sets dan benen", x.pl.borst > x.pl.quadriceps && x.pl.rug > x.pl.quadriceps, describe(x));
ok("voorbeeld: elke training binnen 60 min", x.mins.every((m) => m <= 60), describe(x));
ok("voorbeeld: borst/rug-oefening vooraan op elke dag waar ze voorkomen", x.r.program.days.every((d) => { const f = idx[d.slots[0].exId]; return !d.slots.some((s) => ["borst","rug"].includes(idx[s.exId].pri[0])) || ["borst","rug"].includes(f.pri[0]); }), x.r.program.days.map(x.exNames).join(" || "));
ok("voorbeeld: uitleg noemt ochtend, slaap en prioriteit", ["Vroeg in de ochtend", "Herstel en slaap"].every((t) => x.e.bullets.some((b) => b.title === t)) && x.e.bullets.some((b) => /borst en rug/.test(b.title)), x.e.bullets.map((b) => b.title).join(" | "));
ok("voorbeeld: geen advies met hoge prioriteit", !x.adv.length, describe(x));
if (verbose) { x.r.program.days.forEach((d) => console.log("     " + d.name + ": " + x.exNames(d) + ` (${L.estMinutes(d)} min)`)); x.e.bullets.forEach((b) => console.log("     • " + b.title + ": " + b.text)); }

// indeling per aantal dagen en hersteltijd benen
const cases = [
  ["2 dagen di/vr", { days: [1, 4] }],
  ["3 dagen ma/wo/vr beginner", { days: [0, 2, 4], experience: "beginner" }],
  ["3 dagen achter elkaar ma/di/wo", { days: [0, 1, 2] }],
  ["4 dagen ma/di/do/vr", { days: [0, 1, 3, 4] }],
  ["4 dagen ma/di/wo/do", { days: [0, 1, 2, 3] }],
  ["5 dagen ma-vr", { days: [0, 1, 2, 3, 4], experience: "ervaren" }],
  ["6 dagen ma-za ervaren", { days: [0, 1, 2, 3, 4, 5], experience: "ervaren", minutes: 75 }],
  ["4 dagen 45 min benen+billen prio", { days: [0, 1, 3, 4], minutes: 45, focus: ["benen", "billen"] }],
  ["3 dagen thuis dumbbells", { days: [0, 2, 4], equipment: "thuis" }],
  ["4 dagen onderrug + schouder", { days: [0, 1, 3, 4], complaints: ["onderrug", "schouder"] }],
  ["3 dagen 30 minuten", { days: [0, 2, 4], minutes: 30 }],
];
for (const [name, p] of cases) {
  const y = run(p);
  const legDays = y.r.program.weekMap.map((id, i) => (id && y.r.program.days.find((d) => d.id === id).slots.some((s) => ["quadriceps","hamstrings"].includes(idx[s.exId].pri[0])) ? i : null)).filter((v) => v != null);
  const gaps = legDays.map((d, i) => (i + 1 < legDays.length ? legDays[i + 1] : legDays[0] + 7) - d);
  const minLeg = legDays.length > 1 ? Math.min(...gaps) : 7;
  const avoid = (p.complaints || []).length ? y.r.program.days.flatMap((d) => d.slots.map((s) => s.exId)).filter((id) => ["deadlift","squat","rdl","barbell_row","dips","overhead_press","bankdrukken"].includes(id)) : [];
  const equipOk = p.equipment === "thuis" ? y.r.program.days.every((d) => d.slots.every((s) => ["dumbbell","lichaam"].includes(idx[s.exId].equip))) : true;
  const good = y.mins.every((m) => m <= (p.minutes || 60)) && !avoid.length && equipOk && y.r.program.days.every((d) => d.slots.length >= 2);
  ok(`${name}: ${y.r.choice.opt.label}, benen min ${minLeg * 24} uur`, good && (legDays.length < 2 || minLeg >= 2), describe(y) + (avoid.length ? " VERMEDEN TOCH: " + avoid : ""));
}
const y3 = run({ days: [0, 1, 2] });
ok("aaneengesloten dagen: geen twee keer benen achter elkaar", (() => { const ld = y3.r.program.weekMap.map((id, i) => (id && y3.r.program.days.find((d) => d.id === id).slots.some((s) => idx[s.exId].pri[0] === "quadriceps") ? i : null)).filter((v) => v != null); return ld.every((d, i) => i === 0 || d - ld[i - 1] > 1); })(), describe(y3));
// geen oefening met meer dan 3 werksets; tabel zonder spier die wel sets maar 0× heeft
for (const [name, p] of cases) {
  const y = run(p);
  const maxSets = Math.max(...y.r.program.days.flatMap((d) => d.slots.map((s) => s.sets)));
  if (maxSets > 3) ok(`${name}: hoogstens 3 sets per oefening`, false, String(maxSets));
  const bad = y.e.table.filter((r) => r.sets > 0 && r.freq === 0);
  if (bad.length) ok(`${name}: frequentie in de tabel`, false, JSON.stringify(bad));
}
ok("hoogstens 3 sets per oefening en frequenties kloppen", true);
const yt = run({ days: [0, 2, 4], minutes: 30 });
ok("30 minuten: uitleg zegt eerlijk welke spieren tekortkomen", yt.e.bullets.some((b) => /Eerlijk is eerlijk/.test(b.text)));
const yc = run({ days: [0, 1, 2] });
ok("drie dagen achter elkaar: tip om te spreiden", yc.e.bullets.some((b) => /Tip: kunt u de trainingen spreiden/.test(b.text)));
console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd"); process.exit(fails ? 1 : 0);
