/* Nexa Hybrid fase 1: model, zones, belasting en import. */
import * as M from "../src/hybrid/engine/model.js";
import * as Z from "../src/hybrid/engine/zones.js";
import * as L from "../src/hybrid/engine/load.js";
import * as I from "../src/hybrid/import/files.js";

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

// ---------- model ----------
ok("tijd: 45 = 45 min", M.parseDuration("45") === 2700);
ok("tijd: 45:30", M.parseDuration("45:30") === 2730);
ok("tijd: 1:02:15", M.parseDuration("1:02:15") === 3735);
ok("tijd: onzin = null", M.parseDuration("abc") === null);
ok("tijd tonen", M.fmtDuration(3735) === "1:02:15" && M.fmtDuration(272) === "4:32");
ok("maandag van zondag 4 okt 2026", M.mondayOf("2026-10-04") === "2026-09-28");
ok("maandag van maandag", M.mondayOf("2026-09-28") === "2026-09-28");
ok("tempo hardlopen", M.fmtPace("hardlopen", 1500, 5000) === "5:00 /km");
ok("tempo roeien per 500 m", M.fmtPace("roeien", 420, 2000) === "1:45 /500 m");
ok("tempo fietsen km/u", M.fmtPace("fietsen", 3600, 30000) === "30,0 km/u");
ok("hyrox totaal uit splits", M.hyroxTotal({ splits: { runs: [300, 310], stations: [240, null] } }) === 850);
const norm = M.normalizeStore({ sessions: [{ id: "a", date: "2026-10-01", kind: "duur" }, { id: "b", kind: "onbekend", date: "x" }, null] });
ok("opslag normaliseren: ongeldige sessies weg, profiel aangevuld", norm.sessions.length === 1 && norm.profile.sex === "man");

// ---------- zones ----------
const now = new Date().getFullYear();
ok("HRmax geschat met Tanaka (40 jaar: 180)", Z.hrAnchors({ birthYear: now - 40 }).hrMax === 180);
ok("gemeten HRmax gaat voor", Z.hrAnchors({ birthYear: now - 40, hrMax: 192 }).hrMax === 192);
const zr = Z.hrZones({ hrMax: 190, hrRest: 50 });
ok("Karvonen: zone 2 begint op 60% reserve (134)", zr.method === "reserve" && zr.zones[1].lo === 134 && zr.zones[4].hi === 190);
const zl = Z.hrZones({ lthr: 170, hrMax: 190 });
ok("LTHR (Friel): drempelzone t/m 170", zl.method === "lthr" && zl.zones[3].hi === 170);
ok("zone van hartslag", Z.hrZoneOf({ hrMax: 190, hrRest: 50 }, 120) === 0 && Z.hrZoneOf({ hrMax: 190, hrRest: 50 }, 185) === 4);
ok("geen gegevens: geen zones", Z.hrZones({}) === null);
const thr = Z.runThresholdPace(20 * 60);
ok("drempeltempo bij 5 km in 20:00 ≈ 4:15/km (Riegel, 60 min)", near(thr, 255.4, 1), thr && thr.toFixed(1));
ok("Riegel: 10 km bij 5 km 20:00 ≈ 41:42", near(Z.riegel(1200, 5000, 10000), 2502, 3));
ok("FTP-zones: drempel 91–105%", JSON.stringify(Z.powerZones(250)[3]) === JSON.stringify({ name: "Drempel", lo: 228, hi: 263 }));
ok("drie zones (Seiler)", Z.seilerOf(0) === 1 && Z.seilerOf(1) === 1 && Z.seilerOf(2) === 2 && Z.seilerOf(4) === 3);

// ---------- belasting ----------
const P = { sex: "man", hrMax: 190, hrRest: 50 };
const run = { id: "r", kind: "duur", sport: "hardlopen", type: "rustig", date: "2026-10-01", durationSec: 3600, rpe: 4 };
let sl = L.sessionLoad(run, P);
ok("sRPE = RPE × minuten (4 × 60 = 240)", sl.srpe === 240 && !sl.rpeEst);
sl = L.sessionLoad({ ...run, rpe: null, avgHr: 134 }, P);
ok("RPE uit hartslag (60% reserve ≈ 3,5)", sl.rpeEst && sl.rpeFrom === "hartslag" && near(sl.rpe, 3.5, 0.05));
ok("RPE uit soort sessie zonder hartslag", L.rpeOf({ ...run, rpe: null, type: "interval" }, {}).rpe === 8);
const trimp = L.trimpOf({ ...run, avgHr: 155 }, P);
const x = (155 - 50) / 140;
ok("TRIMP Banister (man)", trimp === Math.round(60 * x * 0.64 * Math.exp(1.92 * x)), trimp);
ok("TRIMP vrouw met eigen factor", L.trimpOf({ ...run, avgHr: 155 }, { ...P, sex: "vrouw" }) === Math.round(60 * x * 0.86 * Math.exp(1.67 * x)));
const lift = { id: "k", kind: "kracht", date: "2026-10-02", exercises: [{ exId: "squat", name: "Squat", muscle: "quadriceps", sets: [{ kg: 100, reps: 5, rir: 2 }, { kg: 100, reps: 5, rir: 1 }] }, { name: "Bankdrukken", muscle: "borst", sets: [{ kg: 80, reps: 8, rir: 2 }] }] };
sl = L.sessionLoad(lift, P);
ok("kracht: duur geschat uit sets (3 × 2,5 min)", sl.minutes === 7.5);
ok("kracht: RPE uit RIR", sl.rpeFrom === "rir" && near(sl.rpe, 10 - 5 / 3 - 1, 0.01));
ok("kracht: benen zwaarder dan bovenlijf bij 2 van 3 sets squat", sl.systems.legs > sl.systems.upper);
ok("hardlopen belast vooral de benen", L.sessionLoad(run, P).systems.legs > L.sessionLoad({ ...run, sport: "zwemmen" }, P).systems.legs);

// fitheid: constante belasting → CTL nadert die belasting, vorm ~0
const steady = Array.from({ length: 200 }, (_, i) => ({ id: "d" + i, kind: "duur", sport: "fietsen", date: M.isoOfNum(M.dayNum("2026-03-01") + i), durationSec: 3600, rpe: 5 }));
const fs = L.fitnessSeries(steady, P, "2026-09-01", "2026-09-16");
const last = fs[fs.length - 1];
ok("CTL nadert dagelijkse belasting (300)", near(last.ctl, 300, 3), last.ctl.toFixed(1));
ok("vorm ≈ 0 bij gelijkmatige belasting", near(last.tsb, 0, 4), last.tsb.toFixed(2));
ok("vorm: in balans", L.formStatus(last).key === "neutraal");
const spike = [...steady.slice(0, 190), ...Array.from({ length: 5 }, (_, i) => ({ id: "x" + i, kind: "duur", sport: "fietsen", date: M.isoOfNum(M.dayNum("2026-03-01") + 190 + i), durationSec: 3 * 3600, rpe: 6 }))];
const fs2 = L.fitnessSeries(spike, P, "2026-09-01", M.isoOfNum(M.dayNum("2026-03-01") + 195));
ok("na een zware week: vorm negatief, zware belasting", fs2[fs2.length - 1].tsb < -100 && L.formStatus(fs2[fs2.length - 1]).key === "zwaar", fs2[fs2.length - 1].tsb.toFixed(0));
ok("nieuwe gebruiker: nog aan het opbouwen", L.formStatus(L.fitnessSeries([run], P, "2026-10-01", "2026-10-02").pop()).key === "start");
ok("vorm = fitheid − vermoeidheid op hetzelfde moment", (() => { const q = L.fitnessSeries([run], P, "2026-10-01", "2026-10-01")[0]; return Math.abs(q.tsb - (q.ctl - q.atl)) < 1e-9 && q.tsb < 0; })());

const wk = L.weekSummary([run, lift, { ...run, id: "r2", date: "2026-10-04", distanceM: 10000 }, { ...run, id: "r3", date: "2026-10-05" }], P, "2026-09-28");
ok("weekoverzicht: 3 sessies in de week, 2 runs", wk.count === 3 && wk.sports.hardlopen.count === 2 && wk.sports.hardlopen.distanceM === 10000);
ok("weekoverzicht: belasting per pijler", wk.pillars.duur === 480 && wk.pillars.kracht > 0 && wk.total === wk.pillars.duur + wk.pillars.kracht);
ok("weekreeks: 8 weken, laatste is deze week", (() => { const w = L.weeklySeries([run], P, 8, "2026-10-01"); return w.length === 8 && w[7].monday === "2026-09-28" && w[0].monday === "2026-08-10"; })());

const dist = L.intensityDistribution([run, { ...run, id: "i", type: "interval", durationSec: 1800 }, { ...run, id: "t", type: "tempo", durationSec: 1200 }], P, "2026-09-28", "2026-10-04");
ok("intensiteitsverdeling: 60/20/30 min", dist.minutes[1] === 60 && dist.minutes[2] === 20 && dist.minutes[3] === 30);
const hist = { 130: 1800, 175: 600 };
const zm = L.zoneMinutesFromHist(hist, P);
ok("zoneminuten uit histogram", near(zm[0] + zm[1], 30, 0.01) && near(zm[4], 10, 0.01), JSON.stringify(zm));
ok("histogram gaat voor bij verdeling", L.intensityDistribution([{ ...run, type: "interval", hrHist: hist }], P, "2026-09-01", "2026-10-30").minutes[3] === 10);

ok("e1RM Epley 100 × 5 ≈ 116,7", near(L.e1rm(100, 5), 116.67, 0.01));
const rec = L.strengthRecords([lift]);
ok("krachtrecords: squat bovenaan", rec[0].name === "Squat" && rec.length === 2);
const rr = L.runRecords([{ ...run, distanceM: 5000, durationSec: 1320 }, { ...run, id: "q", distanceM: 10200, durationSec: 2900 }]);
ok("looprecords: 5 km snelste tempo", rr[0].label === "5 km" && near(rr[0].est, 1320, 1) && rr.length === 2);

// ---------- import: GPX ----------
const t0 = Date.parse("2026-10-01T07:00:00Z") / 1000;
const pts = Array.from({ length: 61 }, (_, i) => ({ lat: 52 + (i * 0.009) / 60, lon: 5, t: t0 + i * 10, ele: 10 + (i < 30 ? i : 60 - i) * 0.5, hr: 140 + (i % 5) }));
const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns:gpxtpx="x"><trk><name>Ochtendloop</name><type>running</type><trkseg>${pts
  .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${new Date(p.t * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`)
  .join("")}</trkseg></trk></gpx>`;
let im = I.importActivity("loop.gpx", new TextEncoder().encode(gpx).buffer);
ok("GPX: sport, datum en naam herkend", im.format === "gpx" && im.draft.sport === "hardlopen" && im.draft.date === "2026-10-01" && im.draft.name === "Ochtendloop");
ok("GPX: afstand ≈ 1 km (0,009° breedte)", near(im.draft.distanceM, 1001, 5), im.draft.distanceM);
ok("GPX: tijd 10 min, hartslag gemiddeld 142", im.draft.durationSec === 600 && im.draft.avgHr === 142 && im.draft.maxHr === 144);
ok("GPX: hoogtemeters ≈ 15", near(im.draft.elevGain, 15, 2), im.draft.elevGain);
ok("GPX: hartslaghistogram en route", im.draft.hrHist && Object.values(im.draft.hrHist).reduce((a, b) => a + b, 0) === 600 && im.route.length === 61);

// ---------- import: TCX ----------
const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap StartTime="x"><TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>15000</DistanceMeters><Track>${[0, 1, 2]
  .map((i) => `<Trackpoint><Time>${new Date((t0 + i * 900) * 1000).toISOString()}</Time><DistanceMeters>${i * 7500}</DistanceMeters><HeartRateBpm><Value>${130 + i * 10}</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:Watts>${200 + i * 10}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`)
  .join("")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
im = I.importActivity("rit.tcx", new TextEncoder().encode(tcx).buffer);
ok("TCX: fietsen, 30 min, 15 km uit de ronde", im.format === "tcx" && im.draft.sport === "fietsen" && im.draft.durationSec === 1800 && im.draft.distanceM === 15000);
ok("TCX: hartslag en vermogen", im.draft.avgHr === 140 && im.draft.avgPower === 210);

// ---------- import: FIT (zelf gecodeerd) ----------
function fitFile(messages) {
  const chunks = [];
  const defs = {};
  for (const m of messages) {
    if (!defs[m.local]) {
      const d = [0x40 | m.local, 0, 0, m.global & 0xff, m.global >> 8, m.fields.length];
      for (const f of m.fields) d.push(f[0], f[1], f[2]);
      chunks.push(Uint8Array.from(d));
      defs[m.local] = true;
    }
    const size = m.fields.reduce((a, f) => a + f[1], 0);
    const b = new DataView(new ArrayBuffer(1 + size));
    b.setUint8(0, m.local);
    let o = 1;
    m.fields.forEach((f, i) => {
      const v = m.values[i];
      if (f[1] === 1) b.setUint8(o, v);
      else if (f[1] === 2) b.setUint16(o, v, true);
      else if (f[2] === 0x85) b.setInt32(o, v, true);
      else b.setUint32(o, v, true);
      o += f[1];
    });
    chunks.push(new Uint8Array(b.buffer));
  }
  const data = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(14 + data + 2);
  const h = new DataView(out.buffer);
  h.setUint8(0, 14); h.setUint8(1, 0x20); h.setUint16(2, 2100, true); h.setUint32(4, data, true);
  out.set([46, 70, 73, 84], 8);
  let o = 14;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
const fitT0 = t0 - 631065600;
const REC = [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [3, 1, 0x02], [5, 4, 0x86], [78, 4, 0x86]];
const semi = (deg) => Math.round((deg / 180) * 2 ** 31);
const recs = Array.from({ length: 31 }, (_, i) => ({ local: 0, global: 20, fields: REC, values: [fitT0 + i * 10, semi(52 + i * 0.0001), semi(5), 150 + (i % 3), i * 3000, (20 + 500) * 5] }));
const SES = [[253, 4, 0x86], [2, 4, 0x86], [5, 1, 0x00], [6, 1, 0x00], [7, 4, 0x86], [8, 4, 0x86], [9, 4, 0x86], [16, 1, 0x02], [17, 1, 0x02], [22, 2, 0x84]];
const ses = { local: 1, global: 18, fields: SES, values: [fitT0 + 300, fitT0, 1, 0, 305000, 300000, 90000, 151, 160, 12] };
im = I.importActivity("activiteit.fit", fitFile([...recs, ses]));
ok("FIT: hardlopen, datum en starttijd", im.format === "fit" && im.draft.sport === "hardlopen" && im.draft.date === "2026-10-01" && im.draft.startTime === "2026-10-01T07:00:00.000Z");
ok("FIT: totalen uit het sessiebericht (300 s, 900 m)", im.draft.durationSec === 300 && im.draft.distanceM === 900 && im.draft.avgHr === 151 && im.draft.maxHr === 160 && im.draft.elevGain === 12);
ok("FIT: route uit semicirkels", im.route.length === 31 && near(im.route[30][0], 52.003, 0.00002));
ok("FIT: hartslaghistogram", im.draft.hrHist && Object.values(im.draft.hrHist).reduce((a, b) => a + b, 0) === 300);
const rowSes = { ...ses, values: [fitT0 + 300, fitT0, 4, 14, 305000, 300000, 100000, 151, 160, 0] };
ok("FIT: indoor roeien via sub_sport", I.importActivity("r.fit", fitFile([recs[0], rowSes])).draft.sport === "roeien");
// gecomprimeerde tijdstempel: kop 0x80 | (local 2 << 5) | offset
const cdef = Uint8Array.from([0x42, 0, 0, 20, 0, 1, 3, 1, 0x02]);
const base = new Uint8Array(fitFile([recs[0]]));
const body = base.slice(14, base.length - 2);
const comp = Uint8Array.from([0x80 | (2 << 5) | ((fitT0 + 5) & 0x1f), 155]);
const all = new Uint8Array(14 + body.length + cdef.length + comp.length + 2);
all.set(base.slice(0, 14));
new DataView(all.buffer).setUint32(4, body.length + cdef.length + comp.length, true);
all.set(body, 14); all.set(cdef, 14 + body.length); all.set(comp, 14 + body.length + cdef.length);
im = I.importActivity("c.fit", all.buffer);
ok("FIT: gecomprimeerde tijdstempel gelezen", im.points === 2 && im.draft.durationSec === 5 && im.draft.maxHr === 155);
let threw = null;
try { I.importActivity("x.fit", new Uint8Array(20).buffer); } catch (e) { threw = e.message; }
ok("FIT: ongeldig bestand geeft duidelijke melding", /geen geldig FIT/.test(threw || ""), threw);
threw = null;
try { I.importActivity("x.txt", new TextEncoder().encode("hallo").buffer); } catch (e) { threw = e.message; }
ok("onbekend bestandstype geeft duidelijke melding", /niet herkend/.test(threw || ""));

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
