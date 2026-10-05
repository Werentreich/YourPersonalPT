/* Nexa Hybrid fase 5: live GPS-opname (filteren, afstand, pauzes, splits),
   herstel uit Apple Gezondheid / Health Connect en platformdetectie. */
const G = await import("../src/hybrid/engine/gps.js");
const HL = await import("../src/hybrid/native/health.js");
const PF = await import("../src/hybrid/native/platform.js");

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

// rechte lijn naar het noorden: 1 graad breedte ≈ 111 195 m
const M_PER_DEG = 111195;
const T0 = Date.parse("2026-10-08T07:00:00Z");
const fix = (meters, sec, acc = 5) => ({ lat: 52 + meters / M_PER_DEG, lon: 5, acc, t: T0 + sec * 1000 });

// 3 m/s (5:33 /km) gedurende 20 minuten, elke seconde een fix
let t = G.newTrack("hardlopen", T0);
for (let s = 0; s <= 1200; s++) t = G.addFix(t, fix(s * 3, s));
let st = G.trackStats(t, T0 + 1200 * 1000);
ok("afstand klopt binnen 1%", Math.abs(st.distanceM - 3600) / 3600 < 0.01, st.distanceM);
ok("bewegingstijd = verstreken tijd", Math.abs(st.moving - 1200) <= 2 && st.elapsed === 1200, `${st.moving}/${st.elapsed}`);
ok("drie splits van ~5:33", st.splits.length === 3 && st.splits.every((x) => Math.abs(x - 333) <= 3), st.splits.join(","));
ok("gemiddeld tempo ~333 s/km", Math.abs(st.avgPace - 333) < 4, Math.round(st.avgPace));
ok("huidig tempo ~333 s/km", Math.abs(st.pace - 333) < 6, Math.round(st.pace));

// onnauwkeurig en uitschieters
let u = G.newTrack("hardlopen", T0);
u = G.addFix(u, fix(0, 0));
u = G.addFix(u, fix(3, 1, 80));
ok("onnauwkeurige fix (80 m) telt niet", u.distance === 0 && u.rejected === 1);
u = G.addFix(u, fix(500, 2));
ok("sprong van 500 m in 2 s telt niet", u.distance === 0 && u.rejected === 2);
u = G.addFix(u, fix(6, 2));
ok("daarna gewone fix wel", Math.round(u.distance) === 6);

// stilstaan met ruis: geen afstand, automatische pauze
let s0 = G.newTrack("hardlopen", T0);
for (let s = 0; s <= 120; s++) s0 = G.addFix(s0, { lat: 52 + ((s * 37) % 5) / M_PER_DEG, lon: 5, acc: 8, t: T0 + s * 1000 });
st = G.trackStats(s0, T0 + 120 * 1000);
ok("stilstand met ruis: geen afstand", st.distanceM === 0, st.distanceM);
ok("stilstand: automatische pauze na ~12 s", st.moving <= G.AUTO_PAUSE_SEC + 1, st.moving);

// langzaam wandelen met matige ontvangst: afstand en tijd blijven
let w = G.newTrack("wandelen", T0);
for (let s = 0; s <= 600; s++) w = G.addFix(w, fix(s * 1.2, s, 15));
st = G.trackStats(w, T0 + 600 * 1000);
ok("wandelen 1,2 m/s bij 15 m onnauwkeurigheid: afstand en tijd kloppen", Math.abs(st.distanceM - 720) < 25 && st.moving >= 580 && w.rejected === 0, `${st.distanceM} m ${st.moving} s`);

// handmatige pauze telt niet, geen rechte lijn over de pauze
let p = G.newTrack("hardlopen", T0);
for (let s = 0; s <= 100; s++) p = G.addFix(p, fix(s * 3, s));
p = G.pauseTrack(p, T0 + 100 * 1000);
p = G.addFix(p, fix(1000, 200)); // tijdens pauze: genegeerd
p = G.resumeTrack(p, T0 + 400 * 1000);
for (let s = 400; s <= 500; s++) p = G.addFix(p, fix(2000 + (s - 400) * 3, s));
st = G.trackStats(p, T0 + 500 * 1000);
ok("pauze: 300 s niet in de verstreken tijd", st.elapsed === 200, st.elapsed);
ok("pauze: afstand alleen van de twee stukken", Math.abs(st.distanceM - 600) < 10, st.distanceM);

// fietsen: splits per 5 km, snelheid
let b = G.newTrack("fietsen", T0);
for (let s = 0; s <= 1800; s += 2) b = G.addFix(b, fix(s * 8, s));
st = G.trackStats(b, T0 + 1800 * 1000);
ok("fietsen: 8 m/s ≈ 28,8 km/u, splits per 5 km", Math.abs(st.avgSpeed - 28.8) < 0.5 && st.splits.length === 2 && Math.abs(st.splits[0] - 625) <= 3, `${st.avgSpeed.toFixed(1)} ${st.splits}`);
ok("fietsen: 20 m/s is geen uitschieter, hardlopen wel", G.addFix(G.addFix(G.newTrack("fietsen", T0), fix(0, 0)), fix(20, 1)).distance > 0 && G.addFix(G.addFix(G.newTrack("hardlopen", T0), fix(0, 0)), fix(20, 1)).distance === 0);

// naar conceptsessie
const done = G.stopTrack(t, T0 + 1205 * 1000);
const { draft, route } = G.trackToDraft(done);
ok("concept: duur hardlopen met tijd, afstand en bron gps", draft.kind === "duur" && draft.sport === "hardlopen" && draft.source === "gps" && Math.abs(draft.durationSec - 1200) <= 2 && Math.abs(draft.distanceM - 3600) < 40);
ok("concept: splits apart (niet de Hyrox-splits)", draft.kmSplits && draft.kmSplits.unit === 1000 && draft.kmSplits.sec.length === 3 && draft.splits === undefined);
ok("route: hoogstens 600 punten, afgerond", route.length <= 600 && String(route[5][0]).split(".")[1].length <= 5);
ok("gestopte track neemt geen fixes meer aan", G.addFix(done, fix(9999, 1300)) === done);

// ---------- gezondheid ----------
ok("slaap: som van slaapsegmenten zonder wakker", HL.sleepHours([
  { startDate: "2026-10-07T23:00:00Z", endDate: "2026-10-08T03:00:00Z", sleepState: "deep" },
  { startDate: "2026-10-08T03:00:00Z", endDate: "2026-10-08T03:30:00Z", sleepState: "awake" },
  { startDate: "2026-10-08T03:30:00Z", endDate: "2026-10-08T06:30:00Z", sleepState: "rem" },
]) === 7);
ok("slaap: geen gegevens = null", HL.sleepHours([]) === null);

// nep-Capacitor
globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { Health: {
  isAvailable: async () => ({ available: true }),
  requestAuthorization: async () => ({}),
  readSamples: async ({ dataType }) => ({ samples: dataType === HL.TYPES.hrv ? [{ value: 52 }, { value: 58 }] : dataType === HL.TYPES.rhr ? [{ value: 51 }, { value: 48 }] : [{ startDate: "2026-10-07T22:30:00Z", endDate: "2026-10-08T06:00:00Z", sleepState: "asleep" }] }),
} } } };
ok("platform: eigen app herkend", PF.isNative() && PF.platform() === "ios");
ok("platform: functies naar de echte site", PF.fnUrl("hybrid-coach") === "https://nexa-performance.netlify.app/.netlify/functions/hybrid-coach");
ok("gezondheid beschikbaar in de eigen app", await HL.healthAvailable());
const rec = await HL.readRecovery(new Date("2026-10-08T08:00:00Z"));
ok("herstel: HRV gemiddeld, laagste rusthartslag, slaap afgerond", rec.hrv === 55 && rec.rhr === 48 && rec.sleepH === 7.5, JSON.stringify(rec));
globalThis.window = {};
ok("web: geen plugin, relatieve adressen", !PF.isNative() && PF.fnUrl("x") === "/.netlify/functions/x" && !(await HL.healthAvailable()));

console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
