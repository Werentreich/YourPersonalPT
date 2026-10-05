/* Eén krachtsysteem: hybride schema <-> Nexa-programma. */
const B = await import("../src/perf/bridge.js");
const P = await import("../src/hybrid/engine/planner.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
let n = 0;
const uid = () => `u${++n}`;
const NEXA = new Set(["squat", "front_squat", "bankdrukken", "schuin_db", "db_bankdrukken", "barbell_row", "db_row", "lat_pulldown", "lateral_raise", "seated_leg_curl", "standing_calf", "rdl", "optrekken", "bulgarian_split_squat", "overhead_press", "face_pull", "hip_thrust", "walking_lunge", "hanging_leg_raise", "leg_press", "goblet_squat", "push_ups", "smith_schuin", "chest_press"]);

const S = { ...P.SETTINGS_DEFAULT, goal: "hybride", startDate: "2026-10-05", exp: { kracht: "beginner", duur: "starter" }, runNow: 1, days: [0, 2, 4] };
const wk = P.generateWeek(S, { sessions: [], profile: {} }, "2026-10-05");
const known = new Set(NEXA);
const r = B.programFromPlan(wk.items, known, uid, "2026-10-05");
const kr = wk.items.filter((x) => x.kind === "kracht");
ok("programma: één dag per soort krachtsessie", r && r.program.days.length === new Set(kr.map((x) => x.slot)).size, r && r.program.days.map((d) => d.name).join(", "));
ok("programma: herkenbaar als prestatieprogramma, weekmodus", r.program.perf === true && r.program.mode === "week");
const dayA = r.program.days.find((d) => d.slot === "K_FULL_A");
ok("dag A: squat en bankdrukken uit de Nexa-bibliotheek", dayA && dayA.slots.some((s) => s.exId === "squat") && dayA.slots.some((s) => s.exId === "bankdrukken"));
const sq = dayA.slots.find((s) => s.exId === "squat");
ok("hoofdoefening: werksets, bereik, rust en RIR uit het schema, met warming-up", sq.sets >= 2 && sq.repMin >= 4 && sq.repMax >= sq.repMin && sq.rest === 150 && sq.warmups === 2 && sq.rir != null, JSON.stringify(sq));
ok("box jumps: eigen oefening aangemaakt", r.customEx.some((c) => c.id === "hyb_box_jumps" && c.custom) && dayA.slots.some((s) => s.exId === "hyb_box_jumps"));
ok("superset: eerste oefening gekoppeld aan de volgende", dayA.slots.some((s) => s.ss === true));
ok("eigen oefening niet dubbel", new Set(r.customEx.map((c) => c.id)).size === r.customEx.length);
const r2 = B.programFromPlan(wk.items, known, uid, "2026-10-05");
ok("tweede keer: eigen oefeningen bestaan al, niet opnieuw", r2.customEx.length === 0);

// blokken terug voor het weekoverzicht
const exIndex = Object.fromEntries([...NEXA].map((id) => [id, { id, name: id }]).concat(r.customEx.map((c) => [c.id, c])));
const itemA = kr.find((x) => x.slot === "K_FULL_A");
const blocks = B.blocksFromDay(dayA, exIndex, itemA);
ok("blokken: warming-up blijft, oefeningen uit het programma", blocks[0].role === "warmup" && blocks.some((b) => b.type === "sets" && b.items.some((i) => i.moveId === "nexa:squat")));
ok("blokken: superset terug als superset", blocks.some((b) => b.superset && b.items.length === 2));
// programma wijzigen -> sessie volgt
const changed = { ...r.program, days: r.program.days.map((d) => (d.id === dayA.id ? { ...d, slots: d.slots.map((s) => (s.exId === "bankdrukken" ? { ...s, exId: "smith_schuin", sets: 4 } : s)) } : d)) };
const sync = B.itemsToSync(wk.items, changed, exIndex, "2026-10-05");
ok("synchroniseren: alle geplande A-sessies volgen de wijziging", kr.filter((x) => x.slot === "K_FULL_A").every((x) => sync[x.id] && sync[x.id].some((b) => (b.items || []).some((i) => i.moveId === "nexa:smith_schuin" && i.sets.length === 4))));
const again = B.itemsToSync(wk.items.map((x) => (sync[x.id] ? { ...x, blocks: sync[x.id] } : x)), changed, exIndex, "2026-10-05");
ok("synchroniseren: daarna niets meer te doen (geen lus)", Object.keys(again).length === 0);
ok("gedane sessie niet aanpassen", Object.keys(B.itemsToSync([{ ...itemA, status: "gedaan" }], changed, exIndex, "2026-10-05")).length === 0);

// nieuwe soort krachtsessie
ok("ontbrekende soort herkend", JSON.stringify(B.missingSlots({ days: [{ slot: "K_FULL_A" }] }, [{ kind: "kracht", slot: "K_UPPER", status: "gepland" }, { kind: "kracht", slot: "K_FULL_A", status: "gepland" }])) === '["K_UPPER"]');

// afgeronde Nexa-training -> hybride sessie
const nexaS = { id: "abc", date: "2026-10-05", name: "Kracht volledig lichaam A", start: 1000, end: 1000 + 55 * 60000, perfItemId: itemA.id, note: "goed", exercises: [{ exId: "squat", sets: [{ type: "warmup", weight: 40, reps: 8 }, { type: "work", weight: 80, reps: 8, rir: 2 }] }] };
const ps = B.perfSessionFromNexa(nexaS, exIndex);
ok("sessie: gekoppeld aan het schema, kracht, duur", ps.planItemId === itemA.id && ps.kind === "kracht" && ps.durationSec === 3300 && ps.source === "nexa" && ps.nexaId === "abc");
ok("sessie: sets met gewicht, warming-up gemarkeerd", ps.blocks[0].items[0].sets[0].kind === "warmup" && ps.blocks[0].items[0].sets[1].kg === 80 && ps.blocks[0].items[0].moveId === "nexa:squat");

// lichter
ok("lichte sessie herkend", B.isLight({ rpeTarget: 5 }) && B.isLight({ changed: "minder" }) && !B.isLight({ rpeTarget: 7 }));
const light = B.lighten([{ sets: [{ type: "warmup" }, { type: "work" }, { type: "work" }, { type: "work" }] }]);
ok("lichter: 60% van de werksets, warming-up blijft", light[0].sets.length === 3 && light[0].sets[0].type === "warmup");
ok("dagnaam zonder toevoegingen", B.dayName("Kracht volledig lichaam B + afsluiter") === "Kracht volledig lichaam B" && B.dayName("Kracht bovenlichaam (spiervolume) (avond)") === "Kracht bovenlichaam (spiervolume)");

if (fails) process.exit(1);
