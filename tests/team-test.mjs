/* Gezin en coaching: codes, rechten, opdrachten en het overzicht voor de coach. */
const T = await import("../netlify/lib/team-core.mjs");
const A = await import("../src/perf/team.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

const c = T.newCode();
ok("code: 8 tekens zonder verwarrende tekens", T.validCode(c) && !/[01IO]/.test(c), c);
ok("code opschonen: kleine letters en spaties", T.cleanCode(" abcd-2345 ") === "ABCD2345");
ok("naam: ingekort en zonder dubbele spaties", T.cleanName("  Lisa   de  Vries ") === "Lisa de Vries" && T.cleanName("   ") === null && T.cleanName("x".repeat(60)).length === 40);
ok("rechten: alleen bekende sleutels, alleen true telt", JSON.stringify(T.cleanScopes({ schema: true, voeding: "ja", hack: true })) === JSON.stringify({ schema: true, voeding: false, voortgang: false }));

// opdrachten
ok("schema: zonder doel geweigerd", !!T.cleanSchema({ settings: { days: [0, 2] } }).error);
ok("schema: minder dan twee dagen geweigerd", !!T.cleanSchema({ settings: { goal: "5k", days: [1] } }).error);
const sc = T.cleanSchema({ settings: { goal: "hybride", days: [4, 0, 2, 2, 9], exp: { kracht: "beginner", x: 5 }, evil: { a: 1 }, long: "x".repeat(100) }, note: "Succes!" });
ok("schema: dagen gesorteerd en ontdubbeld, rommel eruit", JSON.stringify(sc.payload.settings.days) === "[0,2,4]" && !sc.payload.settings.evil && !sc.payload.settings.long && sc.payload.settings.exp.kracht === "beginner" && sc.payload.settings.exp.x === undefined && sc.payload.note === "Succes!");
ok("voeding: cut met positief tempo geweigerd", !!T.cleanVoeding({ goal: "cut", rate: 0.5 }).error);
ok("voeding: onderhoud krijgt tempo 0", T.cleanVoeding({ goal: "onderhoud", rate: -1 }).payload.rate === 0);
ok("voeding: eiwit buiten bereik geweigerd", T.cleanVoeding({ goal: "bulk", rate: 0.25, proteinPerKg: 9 }).payload.proteinPerKg === null);

// overzicht
const now = Date.parse("2026-10-07T12:00:00Z");
const rows = [
  { key: "macroverdeling:hybrid:v1", value: JSON.stringify({ discipline: "hybride", plan: { settings: { goal: "hybride", days: [0, 2, 4] }, items: [{ date: "2026-10-05", title: "Kracht A", status: "gedaan", kind: "kracht" }, { date: "2026-10-08", title: "Loop-wandel", status: "gepland" }, { date: "2026-08-01", title: "oud" }] }, sessions: [{ date: "2026-10-05", kind: "kracht", notes: "privé!", route: [1, 2], blocks: [{ type: "sets", items: [{ sets: [{}, {}, {}] }] }] }], checkins: [{ date: "2026-10-06", sleepQ: 4, note: "privé" }] }) },
  { key: "macroverdeling:v1", value: JSON.stringify({ f: { goal: "cut", rate: -0.5, weight: 80, proteinOverride: 2 }, log: [{ date: "2026-10-01", weight: 80.4 }], mealPlans: { geheim: true } }) },
];
const full = T.clientSummary(rows, { voortgang: true }, now);
ok("overzicht: schema-instellingen en voedingsdoel", full.basis.plan.settings.goal === "hybride" && full.basis.voeding.goal === "cut" && full.basis.voeding.proteinPerKg === 2);
ok("overzicht: week zonder oude items", full.week.length === 2 && !full.week.some((x) => x.title === "oud"));
ok("overzicht: training zonder notities of route, wel sets", full.sessions[0].sets === 3 && full.sessions[0].notes === undefined && full.sessions[0].route === undefined);
ok("overzicht: check-in zonder notitie, gewicht", full.checkins[0].note === undefined && full.weights[0].weight === 80.4);
ok("overzicht: geen maaltijden of dagboek", !JSON.stringify(full).includes("geheim"));
const min = T.clientSummary(rows, { voortgang: false }, now);
ok("zonder recht voortgang: alleen de basis", !min.week && !min.sessions && !min.weights && min.basis.plan);
ok("kapotte gegevens: geen fout", T.clientSummary([{ key: "macroverdeling:v1", value: "{kapot" }], { voortgang: true }, now).weights.length === 0);

// koppeling zoals de app hem ziet
const l = { id: "x", coach_id: "c", client_id: "s", status: "uitgenodigd", code: "ABCD2345", coach_name: "Wesley", client_name: null, scopes: { schema: true }, expires_at: "2026-10-20" };
ok("code alleen zichtbaar voor de coach", T.linkView(l, "c").code === "ABCD2345" && T.linkView(l, "s").code === undefined && T.linkView(l, "s").role === "sporter");

// toepassen bij de sporter
const pa = A.applyPlan({ kind: "voeding", payload: { goal: "bulk", rate: 0.25, proteinPerKg: 2.2 } }, { f: { goal: "cut", rate: -0.5, proteinOverride: null } });
ok("voeding toepassen: patch en vorige waarden", pa.patch.goal === "bulk" && pa.patch.proteinOverride === 2.2 && pa.before.goal === "cut" && pa.before.proteinOverride === null);
const ps = A.applyPlan({ kind: "schema", payload: { settings: { goal: "5k", days: [1, 3] } } }, { planSettings: { goal: "hybride" }, discipline: "hybride" });
ok("schema toepassen: vorige instellingen bewaard", ps.settings.goal === "5k" && ps.before.goal === "hybride" && ps.beforeDiscipline === "hybride");
ok("onbekende opdracht: niets", A.applyPlan({ kind: "x" }, {}) === null);
ok("meldtekst", A.assignmentText({ kind: "voeding", coachName: "Wesley", payload: { goal: "cut", rate: -0.5 } }) === "Wesley heeft uw voedingsdoel ingesteld: afvallen, 0,5% van uw gewicht per week.");

// code uit de link
const mem = { v: {}, setItem(k, x) { this.v[k] = x; }, getItem(k) { return this.v[k] ?? null; } };
ok("code uit de link bewaard", A.takeInviteFromUrl({ search: "?koppel=abcd2345", pathname: "/app/", hash: "" }, mem) === "ABCD2345" && mem.v[A.INVITE_KEY] === "ABCD2345");
ok("uitnodigingslink", A.inviteUrl("ABCD2345", "https://x.nl") === "https://x.nl/app/?koppel=ABCD2345");

if (fails) process.exit(1);
