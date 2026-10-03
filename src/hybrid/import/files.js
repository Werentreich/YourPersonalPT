/* Activiteiten importeren uit FIT, GPX en TCX. Werkt in de browser en in
   Node (geen DOMParser nodig), zonder externe bibliotheken.

   FIT volgens de openbare FIT Protocol-specificatie van Garmin
   (developer.garmin.com/fit/protocol): we lezen alleen wat nodig is,
   namelijk record (20) voor de meetpunten en session (18) voor de totalen.

   Uitkomst: een conceptsessie (soort "duur") plus een route die alleen op
   het apparaat wordt bewaard (locatie is extra gevoelig, zie plan §9). */

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in Unix-seconden

/* ---------------- FIT ---------------- */
const BASE = {
  0x00: [1, "u8", 0xff],
  0x01: [1, "s8", 0x7f],
  0x02: [1, "u8", 0xff],
  0x83: [2, "s16", 0x7fff],
  0x84: [2, "u16", 0xffff],
  0x85: [4, "s32", 0x7fffffff],
  0x86: [4, "u32", 0xffffffff],
  0x07: [1, "str", null],
  0x88: [4, "f32", null],
  0x89: [8, "f64", null],
  0x0a: [1, "u8", 0],
  0x8b: [2, "u16", 0],
  0x8c: [4, "u32", 0],
  0x0d: [1, "u8", 0xff],
  0x8e: [8, "s64", null],
  0x8f: [8, "u64", null],
  0x90: [8, "u64", null],
};

function readVal(dv, off, type, size, little) {
  const t = BASE[type];
  if (!t || t[0] !== size) return null; // reeksen en onbekende typen overslaan
  let v;
  switch (t[1]) {
    case "u8": v = dv.getUint8(off); break;
    case "s8": v = dv.getInt8(off); break;
    case "u16": v = dv.getUint16(off, little); break;
    case "s16": v = dv.getInt16(off, little); break;
    case "u32": v = dv.getUint32(off, little); break;
    case "s32": v = dv.getInt32(off, little); break;
    case "f32": v = dv.getFloat32(off, little); break;
    case "f64": v = dv.getFloat64(off, little); break;
    default: return null;
  }
  return t[2] != null && v === t[2] ? null : v;
}

/* FIT-sport naar onze sport. sub_sport 14 = indoor rowing. */
function fitSport(sport, sub) {
  if (sub === 14) return "roeien";
  return { 1: "hardlopen", 2: "fietsen", 5: "zwemmen", 11: "wandelen", 15: "roeien", 17: "wandelen", 12: "skierg" }[sport] || null;
}

export function parseFit(buffer) {
  const dv = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  if (dv.byteLength < 14) throw new Error("Dit FIT-bestand is te kort.");
  const hsize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== ".FIT") throw new Error("Dit is geen geldig FIT-bestand.");
  const end = Math.min(dv.byteLength, hsize + dv.getUint32(4, true));
  const defs = {};
  const points = [];
  let session = null;
  let lastTs = 0;
  let off = hsize;
  while (off < end) {
    const h = dv.getUint8(off++);
    if (h & 0x80) {
      // gecomprimeerde tijdstempel
      const local = (h >> 5) & 0x03;
      const offset = h & 0x1f;
      lastTs = lastTs + ((offset - (lastTs & 0x1f)) & 0x1f);
      off = readData(local, off, lastTs);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      const little = dv.getUint8(off + 1) === 0;
      const global = dv.getUint16(off + 2, little);
      const n = dv.getUint8(off + 4);
      off += 5;
      const fields = [];
      for (let i = 0; i < n; i++, off += 3) fields.push([dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2)]);
      let devSize = 0;
      if (h & 0x20) {
        const nd = dv.getUint8(off++);
        for (let i = 0; i < nd; i++, off += 3) devSize += dv.getUint8(off + 1);
      }
      defs[local] = { little, global, fields, devSize };
    } else {
      off = readData(local, off, null);
    }
  }

  function readData(local, at, compressedTs) {
    const d = defs[local];
    if (!d) throw new Error("Beschadigd FIT-bestand (onbekend bericht).");
    const v = {};
    for (const [num, size, type] of d.fields) {
      if (at + size > dv.byteLength) throw new Error("Beschadigd FIT-bestand (afgekapt).");
      v[num] = readVal(dv, at, type, size, d.little);
      at += size;
    }
    at += d.devSize;
    if (v[253] != null) lastTs = v[253];
    const ts = v[253] != null ? v[253] : compressedTs;
    if (d.global === 20) {
      const p = { t: ts != null ? ts + FIT_EPOCH : null };
      if (v[0] != null && v[1] != null) {
        p.lat = (v[0] * 180) / 2 ** 31;
        p.lon = (v[1] * 180) / 2 ** 31;
      }
      const alt = v[78] != null ? v[78] / 5 - 500 : v[2] != null ? v[2] / 5 - 500 : null;
      if (alt != null) p.ele = alt;
      if (v[3] != null) p.hr = v[3];
      if (v[5] != null) p.dist = v[5] / 100;
      if (v[7] != null) p.watts = v[7];
      points.push(p);
    } else if (d.global === 18) {
      session = {
        sport: fitSport(v[5], v[6]),
        start: v[2] != null ? v[2] + FIT_EPOCH : null,
        elapsed: v[7] != null ? v[7] / 1000 : null,
        timer: v[8] != null ? v[8] / 1000 : null,
        distance: v[9] != null ? v[9] / 100 : null,
        avgHr: v[16],
        maxHr: v[17],
        avgPower: v[20],
        ascent: v[22],
      };
    }
    return at;
  }

  return summarize(points, session ? { sport: session.sport, start: session.start, durationSec: session.timer || session.elapsed, distanceM: session.distance, avgHr: session.avgHr, maxHr: session.maxHr, avgPower: session.avgPower, elevGain: session.ascent } : {});
}

/* ---------------- GPX en TCX (tekst) ---------------- */
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i"));
  return m ? m[1].trim() : null;
};
const attr = (s, name) => {
  const m = s.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
};
const nOrNull = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

const TEXT_SPORT = [
  [/run|hardlo|lopen/i, "hardlopen"],
  [/bik|cycl|ride|fiets/i, "fietsen"],
  [/swim|zwem/i, "zwemmen"],
  [/row|roei/i, "roeien"],
  [/walk|hik|wandel/i, "wandelen"],
  [/ski/i, "skierg"],
];
const sportFromText = (t) => (t ? (TEXT_SPORT.find(([re]) => re.test(t)) || [])[1] || null : null);

export function parseGpx(text) {
  if (!/<gpx\b/i.test(text)) throw new Error("Dit is geen geldig GPX-bestand.");
  const points = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/gi;
  let m;
  while ((m = re.exec(text))) {
    const a = m[1] || m[3] || "";
    const body = m[2] || "";
    const t = tag(body, "time");
    points.push({
      lat: nOrNull(attr(a, "lat")),
      lon: nOrNull(attr(a, "lon")),
      ele: nOrNull(tag(body, "ele")),
      t: t ? Date.parse(t) / 1000 : null,
      hr: nOrNull(tag(body, "hr")),
      watts: nOrNull(tag(body, "power")) ?? nOrNull(tag(body, "watts")),
    });
  }
  const trk = tag(text, "trk") || "";
  return summarize(points, { sport: sportFromText(tag(trk, "type")), name: tag(trk, "name") });
}

export function parseTcx(text) {
  if (!/<TrainingCenterDatabase\b/i.test(text)) throw new Error("Dit is geen geldig TCX-bestand.");
  const points = [];
  const re = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const t = tag(b, "Time");
    const hrBlock = tag(b, "HeartRateBpm");
    points.push({
      t: t ? Date.parse(t) / 1000 : null,
      lat: nOrNull(tag(b, "LatitudeDegrees")),
      lon: nOrNull(tag(b, "LongitudeDegrees")),
      ele: nOrNull(tag(b, "AltitudeMeters")),
      dist: nOrNull(tag(b, "DistanceMeters")),
      hr: hrBlock ? nOrNull(tag(hrBlock, "Value")) : null,
      watts: nOrNull(tag(b, "Watts")),
    });
  }
  const laps = [...text.matchAll(/<Lap\b[^>]*>([\s\S]*?)<\/Lap>/gi)].map((x) => x[1]);
  const sumLap = (name) => {
    const vals = laps.map((l) => {
      // alleen de eigen waarde van de ronde, niet die van de meetpunten erin
      const head = l.split(/<Track>/i)[0];
      return nOrNull(tag(head, name));
    }).filter((x) => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const act = text.match(/<Activity\b[^>]*Sport="([^"]*)"/i);
  return summarize(points, { sport: sportFromText(act && act[1]), durationSec: sumLap("TotalTimeSeconds"), distanceM: sumLap("DistanceMeters") });
}

/* ---------------- samenvatten ---------------- */
const R_EARTH = 6371008.8;
export function haversine(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/* Hoogtemeters met een licht gladgestreken hoogteprofiel, zodat ruis van
   GPS-hoogte niet als klimmen telt. */
export function elevationGain(eles) {
  const e = eles.filter((x) => x != null);
  if (e.length < 3) return null;
  const k = 2;
  const smooth = e.map((_, i) => {
    const s = e.slice(Math.max(0, i - k), i + k + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  let gain = 0;
  for (let i = 1; i < smooth.length; i++) if (smooth[i] > smooth[i - 1]) gain += smooth[i] - smooth[i - 1];
  return Math.round(gain);
}

const PAUSE_SEC = 60; // gaten langer dan dit tellen als pauze

/* Seconden per hartslagbak van 5 slagen: zones blijven zo later opnieuw te
   berekenen als het profiel verandert. */
function hrHistogram(points) {
  const hist = {};
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const dt = p.t != null && points[i - 1].t != null ? p.t - points[i - 1].t : null;
    if (!p.hr || !dt || dt <= 0 || dt > PAUSE_SEC) continue;
    const b = Math.floor(p.hr / 5) * 5;
    hist[b] = (hist[b] || 0) + dt;
  }
  return Object.keys(hist).length ? hist : null;
}

function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
}

export function summarize(points, meta = {}) {
  const pts = points.filter((p) => p);
  let dist = 0;
  let moving = 0;
  const geo = pts.filter((p) => p.lat != null && p.lon != null);
  for (let i = 1; i < geo.length; i++) dist += haversine(geo[i - 1], geo[i]);
  const withDist = pts.filter((p) => p.dist != null);
  if (withDist.length > 1) dist = withDist[withDist.length - 1].dist - withDist[0].dist;
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t != null && pts[i - 1].t != null ? pts[i].t - pts[i - 1].t : 0;
    if (dt > 0 && dt <= PAUSE_SEC) moving += dt;
  }
  const hrs = pts.map((p) => p.hr).filter((x) => x > 0);
  const watts = pts.map((p) => p.watts).filter((x) => x != null);
  const firstT = pts.find((p) => p.t != null);
  const start = meta.start || (firstT ? firstT.t : null);
  const draft = {
    kind: "duur",
    sport: meta.sport || "hardlopen",
    sportDetected: !!meta.sport,
    date: start ? new Date(start * 1000).toISOString().slice(0, 10) : null,
    startTime: start ? new Date(start * 1000).toISOString() : null,
    durationSec: Math.round(meta.durationSec || moving) || null,
    distanceM: Math.round(meta.distanceM || dist) || null,
    avgHr: meta.avgHr || (hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null),
    maxHr: meta.maxHr || (hrs.length ? Math.max(...hrs) : null),
    avgPower: meta.avgPower || (watts.length ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : null),
    elevGain: meta.elevGain != null ? meta.elevGain : elevationGain(pts.map((p) => p.ele)),
    hrHist: hrHistogram(pts),
    name: meta.name || null,
  };
  const route = geo.length > 1 ? downsample(geo, 600).map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]) : null;
  return { draft, route, points: pts.length };
}

/* Bestand naar concept, op extensie of inhoud. */
export function importActivity(name, buffer) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const bytes = new Uint8Array(buffer);
  const isFit = ext === "fit" || (bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === ".FIT");
  if (isFit) return { ...parseFit(buffer), format: "fit" };
  const text = new TextDecoder("utf-8").decode(bytes);
  if (ext === "gpx" || /<gpx\b/i.test(text)) return { ...parseGpx(text), format: "gpx" };
  if (ext === "tcx" || /<TrainingCenterDatabase\b/i.test(text)) return { ...parseTcx(text), format: "tcx" };
  throw new Error("Dit bestandstype wordt niet herkend. Gebruik een FIT-, GPX- of TCX-bestand.");
}
