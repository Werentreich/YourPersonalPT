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
// ---------- voeding volgt het prestatieschema ----------
{
  const N = await import("../src/perf/nutrition.js");
  const M = await import("../src/hybrid/engine/model.js");
  const S = { ...P.SETTINGS_DEFAULT, goal: "hybride", startDate: "2026-10-05", exp: { kracht: "beginner", duur: "starter" }, runNow: 1, days: [0, 1, 3, 5, 6], doubles: true };
  const wk = P.generateWeek(S, { sessions: [], profile: {} }, "2026-10-05");
  const data = { ...M.STORE_DEFAULT, plan: { settings: S, items: wk.items, weeks: {}, applied: {} }, calendar: { time: "18:30" } };
  const ps = N.perfWeekSessions(data, "2026-10-07");
  ok("zeven dagen, rustdagen leeg", ps.length === 7 && ps.filter(Boolean).length === new Set(wk.items.filter((x) => !x.optional && x.kind !== "mobiliteit").map((x) => x.date)).size);
  const mon = ps[0];
  ok("dubbele dag: minuten en verbruik samen, beide titels", mon.label.includes("+") && mon.minutes === wk.items.filter((x) => x.date === "2026-10-05" && !x.optional).reduce((a, x) => a + x.targetMin, 0) && mon.kcalKg > 0);
  ok("starttijd uit de agenda-instelling", mon.start === "18:30");
  const kr = ps.find((d) => d && d.label.startsWith("Kracht volledig lichaam B"));
  const loop = ps.find((d) => d && d.label.startsWith("Loop-wandel"));
  ok("verbruik per kilo: krachttraining meer dan loop-wandelen 29 min", kr && loop && kr.kcalKg > loop.kcalKg, `${kr && kr.kcalKg} / ${loop && loop.kcalKg}`);
  const week = Array.from({ length: 7 }, () => ({ session: null }));
  const next = N.syncPerfWeek(week, data, "2026-10-07");
  ok("sync: nieuwe week, daarna niets meer te doen", next && N.syncPerfWeek(next, data, "2026-10-07") === null);
  ok("zonder schema: niets aanpassen", N.syncPerfWeek(week, M.STORE_DEFAULT, "2026-10-07") === null);
}

console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
