/* Nexa Hybrid: volgende week staat klaar, is aan te passen en wordt bij de
   start afgestemd op wat er echt gebeurde. */
const P = await import("../src/hybrid/engine/planner.js");
const M = await import("../src/hybrid/engine/model.js");
const W = await import("../src/hybrid/engine/weeks.js");

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const V = 6;
const MON = "2026-10-05";
const NEXT = "2026-10-12";
const iso = (d) => M.isoOfNum(M.dayNum(MON) + d);
const settings = { ...P.SETTINGS_DEFAULT, goal: "5k", startDate: MON, exp: { kracht: "beginner", duur: "starter" }, runNow: 1, days: [0, 2, 4, 6] };
const base = { ...M.STORE_DEFAULT, plan: { settings, items: [], weeks: {}, applied: {} } };

// maandag: deze en volgende week klaarzetten
let plan = W.ensurePlanWeeks(base, MON, V);
const next = plan.items.filter((x) => x.date >= NEXT && x.date <= "2026-10-18");
ok("deze week en volgende week staan klaar", plan.items.some((x) => x.date === MON) && next.length > 0 && plan.weeks[NEXT].projected);
ok("volgende week rekent alsof deze week volgens plan gaat (niveau 2)", next.some((x) => x.starterLevel === 2), next.map((x) => x.title).join(" | "));
ok("nogmaals openen: niets verandert", W.ensurePlanWeeks({ ...base, plan }, iso(1), V) === plan);
const vooruit = W.previewWeek({ ...base, plan }, MON, "2026-10-19");
ok("week daarna: vooruitblik met niveau 3", vooruit.items.some((x) => x.starterLevel === 3));

// sporter past volgende week aan: looptraining naar dinsdag, kracht lichter
const run = next.find((x) => x.starterLevel);
const kracht = next.find((x) => x.kind === "kracht");
plan = { ...plan, items: plan.items.map((x) => (x.id === run.id ? { ...x, date: "2026-10-13", edited: true } : x.id === kracht.id ? { ...x, title: "Kracht (eigen versie)", edited: true } : x)) };

// scenario 1: deze week gaat zoals gepland
const doneAll = plan.items.filter((x) => x.date <= "2026-10-11" && x.status === "gepland" && !x.optional).map((x) => ({ ...M.newSession(x.kind), date: x.date, sport: x.sport, durationSec: (x.targetMin || 30) * 60, rpe: 5, planItemId: x.id }));
const p1 = W.ensurePlanWeeks({ ...base, plan, sessions: doneAll }, NEXT, V);
const n1 = p1.items.filter((x) => x.date >= NEXT && x.date <= "2026-10-18");
ok("volgens plan: geen wijzigingen bij de start", !p1.weeks[NEXT].changes && !p1.weeks[NEXT].projected, JSON.stringify(p1.weeks[NEXT].changes));
ok("eigen aanpassingen blijven staan", n1.some((x) => x.id === run.id && x.date === "2026-10-13") && n1.some((x) => x.title === "Kracht (eigen versie)"));
ok("geen dubbele sessies naast de eigen aanpassing", n1.filter((x) => x.slot === kracht.slot).length === 1 && n1.filter((x) => x.slot === run.slot).length === next.filter((x) => x.slot === run.slot).length);
ok("en de week daarna staat nu klaar", p1.weeks["2026-10-19"] && p1.weeks["2026-10-19"].projected);

// scenario 2: deze week maar één keer gelopen -> niveau blijft, wijzigingen getoond
const oneRun = doneAll.filter((s) => s.kind !== "duur").concat(doneAll.filter((s) => s.kind === "duur").slice(0, 1));
const p2 = W.ensurePlanWeeks({ ...base, plan, sessions: oneRun }, NEXT, V);
const n2 = p2.items.filter((x) => x.date >= NEXT && x.date <= "2026-10-18");
ok("minder gedaan: niveau blijft op 1", n2.filter((x) => x.starterLevel && !x.edited).every((x) => x.starterLevel === 1));
ok("wijzigingen worden getoond", (p2.weeks[NEXT].changes || []).length > 0, (p2.weeks[NEXT].changes || []).join(" | "));
ok("ook dan blijven eigen aanpassingen staan", n2.some((x) => x.title === "Kracht (eigen versie)"));
ok("zelfde id bij zelfde dag en soort (agenda zonder dubbelingen)", n2.some((x) => next.some((y) => y.id === x.id && !y.edited)));

// instellingen wijzigen: alles na deze week opnieuw
const dropped = W.dropFuture(plan, MON);
ok("instellingen gewijzigd: volgende week vervalt en wordt opnieuw gemaakt", !dropped.items.some((x) => x.date >= NEXT && x.status === "gepland") && !dropped.weeks[NEXT]);
ok("projectie: alleen geplande, niet-optionele sessies", W.projectSessions([{ id: "a", status: "gepland", date: MON, kind: "duur", targetMin: 30 }, { id: "b", status: "gedaan", date: MON }, { id: "c", status: "gepland", optional: true, date: MON }], MON, iso(6)).length === 1);

console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
