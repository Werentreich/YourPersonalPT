/* Maaltijden per dag: zelf kiezen op welke dagen een wijziging geldt. */
const M = await import("../src/mealScope.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

// rust op ma en wo, training op di, do, vr, za, zo
const types = ["rust", "training", "rust", "training", "training", "training", "training"];
const A = [{ food: "havermout" }], B = [{ food: "rijst" }], C = [{ food: "aardappel" }];
const read = (plans, i) => (d) => (plans[d] && plans[d][i]) || (plans[types[d]] && plans[types[d]][i]) || (plans.def && plans.def[i]) || A;

let p = {};
p = M.writeDays(p, types, 1, [1, 3, 4, 5, 6], B);
ok("alle trainingsdagen: opgeslagen bij het dagtype", p.training && M.sameItems(p.training[1], B) && !p[1]);
ok("rustdagen veranderen niet mee", M.sameItems(read(p, 1)(0), A) && M.sameItems(read(p, 1)(2), A));

// alleen dinsdag en donderdag een andere maaltijd (andere soort trainingsdag)
p = M.writeDays(p, types, 1, [1, 3], C);
ok("eigen keuze di + do: alleen die dagen", M.sameItems(read(p, 1)(1), C) && M.sameItems(read(p, 1)(3), C));
ok("vr, za, zo houden de trainingsdagmaaltijd", [4, 5, 6].every((d) => M.sameItems(read(p, 1)(d), B)));
ok("rustdagen nog steeds onveranderd", M.sameItems(read(p, 1)(0), A));
ok("gedeelde dagen vanaf dinsdag: di en do", M.sharedDays(read(p, 1), 1).join() === "1,3");
ok("gedeelde dagen vanaf vrijdag: vr, za, zo", M.sharedDays(read(p, 1), 4).join() === "4,5,6");

// rustdag-maaltijd op ma en wo, zonder trainingsdagen te raken
p = M.writeDays(p, types, 2, [0, 2], C);
ok("alle rustdagen: dagtype rust, training ongemoeid", p.rust && M.sameItems(p.rust[2], C) && [1, 3, 4, 5, 6].every((d) => M.sameItems(read(p, 2)(d), A)));

// alle dagen: andere lagen voor deze maaltijd weg
p = M.writeDays(p, types, 1, [0, 1, 2, 3, 4, 5, 6], A);
ok("alle dagen: overal gelijk, daglagen en typelaag weg", [0, 1, 2, 3, 4, 5, 6].every((d) => M.sameItems(read(p, 1)(d), A)) && !(p[1] && p[1][1]) && !(p.training && p.training[1]));
ok("andere maaltijd (2) blijft staan", p.rust && M.sameItems(p.rust[2], C));

// trainingsdagen weer samen, terwijl di/do een eigen laag hadden
let q = M.writeDays({}, types, 0, [1, 3], C);
q = M.writeDays(q, types, 0, [1, 3, 4, 5, 6], B);
ok("terug naar alle trainingsdagen: eigen daglagen van di/do opgeruimd", !(q[1] && q[1][0] !== undefined) && [1, 3, 4, 5, 6].every((d) => M.sameItems(read(q, 0)(d), B)));
ok("kopie, geen gedeeld object", (() => { const r = M.writeDays({}, types, 0, [1, 3], C); r[1][0][0].food = "x"; return r[3][0][0].food === "aardappel"; })());
ok("lege selectie: niets", JSON.stringify(M.writeDays({ a: 1 }, types, 0, [], C)) === '{"a":1}');

const S = ["ma", "di", "wo", "do", "vr", "za", "zo"], F = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
ok("labels", M.daysLabel([0, 1, 2, 3, 4, 5, 6], types, 1, S, F) === "Alle dagen" && M.daysLabel([1, 3, 4, 5, 6], types, 1, S, F) === "Alle trainingsdagen" && M.daysLabel([0, 2], types, 0, S, F) === "Alle rustdagen" && M.daysLabel([3], types, 3, S, F) === "Alleen donderdag" && M.daysLabel([1, 3], types, 1, S, F) === "di, do");

if (fails) { console.log(`\n${fails} FOUT`); process.exit(1); }
console.log("\nalles goed");
