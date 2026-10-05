/* Nexa als complete app: sporten en hun doelen. */
const T = await import("../src/perf/theme.js");
const P = await import("../src/hybrid/engine/planner.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
ok("bodybuilding is de bestaande Nexa-training (geen planner-doelen)", T.DISCIPLINES.bodybuilding.goals === null);
ok("elke andere sport heeft bestaande doelen en een standaarddoel", Object.entries(T.DISCIPLINES).filter(([k]) => k !== "bodybuilding").every(([, d]) => d.goals.every((g) => P.GOALS[g]) && d.goals.includes(d.goal)));
ok("elk doel hoort bij precies één sport", Object.keys(P.GOALS).every((g) => Object.values(T.DISCIPLINES).filter((d) => (d.goals || []).includes(g)).length === 1));
ok("sport bij een doel", T.disciplineOfGoal("10k") === "hardlopen" && T.disciplineOfGoal("hyrox") === "conditie" && T.disciplineOfGoal("kracht") === "kracht");
ok("stijl: alleen binnen .perf, Nexa blijft onveranderd", !/:root\s*\{/.test(T.PERF_STYLE) && T.PERF_STYLE.includes(".perf {"));
console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
