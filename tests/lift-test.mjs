/* Krachttraining live afvinken met rusttimer (Training bezig). */
const L = await import("../src/perf/lift.js");
const P = await import("../src/hybrid/engine/planner.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

const S = { ...P.SETTINGS_DEFAULT, goal: "hybride", startDate: "2026-10-05", exp: { kracht: "beginner", duur: "starter" }, runNow: 1, days: [0, 2, 4] };
const wk = P.generateWeek(S, { sessions: [], profile: {} }, "2026-10-05");
const kr = wk.items.find((x) => x.kind === "kracht");
const run = wk.items.find((x) => x.kind === "duur");
ok("krachtsessie uit het schema is live af te vinken", L.liftable(kr));
ok("duursessie niet (die heeft begeleiding)", !L.liftable(run));
ok("gedane sessie niet opnieuw", !L.liftable({ ...kr, status: "gedaan" }));

const prev = [{ date: "2026-09-28", createdAt: 1, kind: "kracht", blocks: [{ type: "sets", items: [{ moveId: kr.blocks.find((b) => b.name === "Hoofdoefeningen").items[0].moveId, sets: [{ kg: 60, reps: 8 }, { kg: 60, reps: 7 }] }] }] }];
let live = L.startLift(kr, prev, 1000);
const mi = live.blocks.findIndex((b) => b.name === "Hoofdoefeningen");
const main = live.blocks[mi].items[0];
ok("start: herhalingen leeg, nog niets gedaan", main.sets.every((s) => s.reps == null && !s.done) && !L.anyDone(live));
ok("kg van de vorige keer als het schema er geen heeft", main.sets[0].kg === 60, main.sets[0].kg);
ok("vorige keer als tekst", L.lastText(L.lastFor(prev, main.moveId), false) === "60 kg × 8, 7");

let r = L.toggleSet(live, mi, 0, 0, 2000);
ok("afvinken zonder herhalingen: melding, niets veranderd", r.error && r.live === live);
live = L.setField(live, mi, 0, 0, "reps", 8);
live = L.setField(live, mi, 0, 0, "kg", 62.5);
ok("nieuw gewicht geldt ook voor de volgende open sets", live.blocks[mi].items[0].sets.every((s) => s.kg === 62.5));
r = L.toggleSet(live, mi, 0, 0, 2000);
live = r.live;
ok("afgevinkt: rust loopt met de rusttijd van de oefening", live.blocks[mi].items[0].sets[0].done && live.rest && live.rest.total === main.restSec && live.rest.endsAt === 2000 + main.restSec * 1000, JSON.stringify(live.rest));
ok("volgende stap: dezelfde oefening, set 2", r.next.ii === 0 && r.next.j === 1 && live.rest.next.endsWith("set 2"));
r = L.toggleSet(live, mi, 0, 0, 3000);
ok("ongedaan maken stopt de rust", !r.live.blocks[mi].items[0].sets[0].done && r.live.rest === null);

// superset: wisselen, dan rust
const si = live.blocks.findIndex((b) => b.superset && b.items.length > 1);
ok("schema heeft een superset", si >= 0);
live = L.setField(live, si, 0, 0, "reps", 10);
r = L.toggleSet(live, si, 0, 0, 5000);
ok("superset: na A1 kort wisselen naar A2", r.live.rest.kind === "wissel" && r.live.rest.total === L.SWITCH_SEC && r.next.ii === 1 && r.next.j === 0);
live = L.setField(r.live, si, 1, 0, "reps", 10);
r = L.toggleSet(live, si, 1, 0, 6000);
ok("superset: na A2 rust, daarna A1 set 2", r.live.rest.kind === "rust" && r.live.rest.total >= 60 && r.next.ii === 0 && r.next.j === 1);
live = r.live;

// warming-up blok in één keer
const wi = live.blocks.findIndex((b) => b.type !== "sets");
live = L.toggleSet(live, wi, null, null).live;
ok("ander blok in één keer afvinken", live.blocks[wi].done);

// set erbij en eraf
const n0 = live.blocks[mi].items[0].sets.length;
live = L.addSet(live, mi, 0);
ok("set erbij", live.blocks[mi].items[0].sets.length === n0 + 1);
live = L.removeSet(live, mi, 0);
ok("set eraf (alleen een open set)", live.blocks[mi].items[0].sets.length === n0);

// afronden: alleen afgevinkte sets, gekoppeld aan het schema
live = L.toggleSet(L.setField(live, mi, 0, 1, "reps", 7), mi, 0, 1, 7000).live;
const s = L.liftToSession(live, 1000 + 40 * 60000);
const sm = s.blocks.find((b) => b.name === "Hoofdoefeningen");
ok("sessie: gekoppeld aan het schema, soort kracht, duur", s.planItemId === kr.id && s.kind === "kracht" && s.durationSec === 2400);
ok("sessie: alleen afgevinkte sets, zonder doneproperty", sm.items.length === 1 && sm.items[0].sets.length === 2 && sm.items[0].sets[1].reps === 7 && sm.items[0].sets[0].done === undefined);
ok("sessie: afgevinkte warming-up telt mee, open blokken niet", s.blocks.some((b) => b.role === "warmup") && !s.blocks.some((b) => b.type !== "sets" && b.role !== "warmup"));
const p = L.progress(live);
ok("voortgang telt werksets", p.done === 4 && p.total > p.done, JSON.stringify(p));

if (fails) process.exit(1);
