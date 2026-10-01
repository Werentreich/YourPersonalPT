import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const a = src.indexOf("/* =========================================================================\n   TRAINING");
const b = src.indexOf("/* ---------------- geluid, trilling");
const cut = (x, y) => src.slice(src.indexOf(x), src.indexOf(y, src.indexOf(x)));
const extra = cut("function weekMapAdjusted", "/* Aandeel van de gewichtstoename") + cut("function unlinkAt", "function SlotEditor");
const pre = extra + `
const num = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const DAY_MS = 86400000;
const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00") / DAY_MS);
const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
const useState = () => {}; const useEffect = () => {};
`;
const L = new Function(pre + src.slice(a, b) + "return {programAdvice, applyAllAdvice, buildExIndex, programFromTemplate, TEMPLATES, plannedMuscleSets, MUSCLES, makeSlot, uid, historyFor};")();
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i ? "  " + i : "")); };
const idx = L.buildExIndex([], {});
const S = (exId, o = {}) => ({ ...L.makeSlot(idx[exId], { sets: 2, warmups: 1 }), ...o });
const prog = (days, mode = "week") => ({ id: "p", name: "t", mode, days: days.map(([name, slots], i) => ({ id: "d" + i, name, slots })), weekMap: days.map((_, i) => "d" + i).concat(Array(7).fill(null)).slice(0, 7), rotation: [] });
const show = (adv) => adv.map((x) => `[${x.level}] ${x.title}: ${x.changes.join(" | ")}`).join("\n     ");

// 1. sjablonen: weinig of geen belangrijke adviezen
for (const t of L.TEMPLATES) {
  const p = L.programFromTemplate(t, { mode: "week", sets: 2, exIndex: idx });
  const adv = L.programAdvice(p, idx);
  ok(`sjabloon ${t.name}: geen 'belangrijk'`, !adv.some((x) => x.level === "hoog"), "\n     " + show(adv));
}

// 2. slecht schema: alleen borst en biceps, korte rust, geïsoleerd voor compound
const bad = prog([
  ["Push", [S("cable_fly"), S("bankdrukken", { rest: 60 }), S("barbell_curl", { sets: 5 }), S("db_curl", { sets: 4 }), S("preacher_curl", { sets: 4 })]],
  ["Push 2", [S("chest_press"), S("pec_deck", { sets: 4 }), S("pushdown")]],
  ["Benen", [S("leg_press"), S("leg_extension")]],
]);
const adv = L.programAdvice(bad, idx);
console.log("  adviezen slecht schema:\n     " + show(adv));
ok("ontbrekende rug = belangrijk", adv.some((x) => x.id === "ontbreekt:rug" && x.level === "hoog"));
ok("ontbrekende hamstrings", adv.some((x) => x.id === "ontbreekt:hamstrings"));
ok("volgorde Push: compound eerst", adv.some((x) => x.id === "volgorde:d0" && x.changes[0].startsWith("Nieuwe volgorde: Bankdrukken")));
ok("korte rust bankdrukken", adv.some((x) => x.id.startsWith("rust:") && x.changes.some((c) => c.includes("Bankdrukken") && c.includes("3:00"))));
ok("gerekte positie: wissels", adv.some((x) => x.id.startsWith("gerekt:")));
ok("gesorteerd op belang", adv.every((x, i) => i === 0 || ["hoog", "middel", "laag"].indexOf(adv[i - 1].level) <= ["hoog", "middel", "laag"].indexOf(x.level)));

// 3. toepassen: ontbrekende rug
const a1 = adv.find((x) => x.id === "ontbreekt:rug");
const p1 = a1.apply(bad);
ok("rug toegevoegd", L.plannedMuscleSets(p1, idx).rug > 0 && !L.programAdvice(p1, idx).some((x) => x.id === "ontbreekt:rug"));
ok("origineel onveranderd", L.plannedMuscleSets(bad, idx).rug === 0);

// 4. volgorde toepassen
const p2 = adv.find((x) => x.id === "volgorde:d0").apply(bad);
ok("volgorde toegepast", p2.days[0].slots[0].exId === "bankdrukken" && p2.days[0].slots.length === 5);

// 5. wissel geeft nieuw slot-id (schone progressie)
const g = adv.find((x) => x.id.startsWith("gerekt:"));
const p3 = g.apply(bad);
const before = new Set(bad.days.flatMap((d) => d.slots.map((s) => s.id)));
const changed = p3.days.flatMap((d) => d.slots).filter((s) => !before.has(s.id));
ok("wissel: nieuwe slot-id's", changed.length === g.changes.length && changed.every((s) => idx[s.exId].lengthened), g.changes.join("; "));

// 6. te veel volume
const heavy = prog([
  ["A", [S("bankdrukken", { sets: 4 }), S("schuin_db", { sets: 4 }), S("cable_fly", { sets: 4 }), S("pec_deck", { sets: 4 }), S("dips", { sets: 3 })]],
  ["B", [S("chest_press", { sets: 4 }), S("db_flyes", { sets: 4 }), S("lat_pulldown", { sets: 3 })]],
]);
const advH = L.programAdvice(heavy, idx);
ok("boven MRV borst", advH.some((x) => x.id === "boven:borst" && x.level === "hoog"), "\n     " + show(advH));
const pH = advH.find((x) => x.id === "boven:borst").apply(heavy);
ok("na toepassen binnen MRV", L.plannedMuscleSets(pH, idx).borst <= L.MUSCLES.borst.mrv, String(L.plannedMuscleSets(pH, idx).borst));

// 7. alles toepassen: eindigt, en daarna geen 'belangrijk'
const all = L.applyAllAdvice(bad, idx);
const rest = L.programAdvice(all.program, idx);
ok("alles toepassen: geen belangrijke adviezen meer", !rest.some((x) => x.level === "hoog"), `toegepast: ${all.applied.length}; rest:\n     ${show(rest)}`);

// 8. negeren
const dis = { ...bad, adviceDismissed: ["ontbreekt:rug"] };
ok("genegeerd advies gemarkeerd", L.programAdvice(dis, idx).find((x) => x.id === "ontbreekt:rug").dismissed === true);

// 9. historie per slot volgt de oefening
const sess = [{ end: 1, deload: false, exercises: [{ slotId: "s9", exId: "lying_leg_curl", sets: [{ type: "work", done: true, reps: 10, weight: 40 }] }] }];
ok("historie van oude oefening niet op nieuw slot", L.historyFor(sess, { id: "s9", exId: "seated_leg_curl" }).length === 0);
ok("historie per oefening blijft", L.historyFor(sess, { id: "zz", exId: "lying_leg_curl" }).length === 1);

console.log(fails ? fails + " FOUT" : "Alle tests geslaagd");
