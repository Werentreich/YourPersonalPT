/* Gegevensmodel van Nexa Hybrid: sessies, sporten en profiel.
   Puur JavaScript zonder React, zodat de tests het los kunnen draaien. */

export const DAY_MS = 86400000;

/* Pijler per soort sessie (datacodering, zie theme.js K). */
export const KINDS = {
  kracht: { label: "Kracht", pillar: "kracht" },
  duur: { label: "Duur", pillar: "duur" },
  wod: { label: "WOD", pillar: "conditie" },
  hyrox: { label: "Hyrox", pillar: "conditie" },
  mobiliteit: { label: "Mobiliteit", pillar: "mobiliteit" },
};

/* Duursporten. legs/upper: aandeel van de belasting op benen en bovenlichaam
   (de rest is centraal); pace: hoe tempo wordt getoond. */
export const SPORTS = {
  hardlopen: { label: "Hardlopen", pace: "km", legs: 0.75, upper: 0.05 },
  fietsen: { label: "Fietsen", pace: "kmh", legs: 0.6, upper: 0.05 },
  roeien: { label: "Roeien", pace: "500", legs: 0.4, upper: 0.35 },
  skierg: { label: "SkiErg", pace: "500", legs: 0.2, upper: 0.55 },
  zwemmen: { label: "Zwemmen", pace: "100", legs: 0.15, upper: 0.55 },
  wandelen: { label: "Wandelen / rucken", pace: "km", legs: 0.6, upper: 0.1 },
};

/* Soort duursessie. rpe: standaard-inspanning als de gebruiker niets invult. */
export const ENDURANCE_TYPES = {
  rustig: { label: "Rustig (zone 2)", rpe: 3 },
  lang: { label: "Lange duur", rpe: 4 },
  tempo: { label: "Tempo", rpe: 6 },
  drempel: { label: "Drempel", rpe: 7 },
  interval: { label: "Intervallen", rpe: 8 },
  heuvel: { label: "Heuvels", rpe: 7 },
  wedstrijd: { label: "Wedstrijd of test", rpe: 9 },
};

export const WOD_FORMATS = {
  amrap: { label: "AMRAP", hint: "zoveel mogelijk rondes binnen de tijd" },
  emom: { label: "EMOM", hint: "elke minuut op de minuut" },
  fortime: { label: "For Time", hint: "zo snel mogelijk klaar" },
  chipper: { label: "Chipper", hint: "lange lijst, één keer door" },
  interval: { label: "Intervallen", hint: "werk en rust, bijvoorbeeld Tabata" },
};

/* Hyrox: 8 × 1 km lopen, telkens gevolgd door een station, in deze volgorde. */
export const HYROX_STATIONS = [
  { id: "skierg", label: "SkiErg", amount: "1000 m" },
  { id: "sled_push", label: "Sled push", amount: "50 m" },
  { id: "sled_pull", label: "Sled pull", amount: "50 m" },
  { id: "burpee_bj", label: "Burpee broad jumps", amount: "80 m" },
  { id: "row", label: "Roeien", amount: "1000 m" },
  { id: "farmers", label: "Farmers carry", amount: "200 m" },
  { id: "lunges", label: "Sandbag lunges", amount: "100 m" },
  { id: "wallballs", label: "Wall balls", amount: "100 herhalingen" },
];

export const HYROX_MODES = {
  race: { label: "Wedstrijd" },
  simulatie: { label: "Volledige simulatie" },
  deel: { label: "Deel / stations" },
};

export const PROFILE_DEFAULT = {
  sex: "man",
  birthYear: null,
  weight: null,
  hrMax: null,
  hrRest: null,
  lthr: null,
  run5k: null, // seconden
  ftp: null, // watt
  css100: null, // seconden per 100 m
  row2k: null, // seconden
};

export const STORE_DEFAULT = { v: 1, profile: PROFILE_DEFAULT, sessions: [] };

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const localISO = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY_MS);
export const isoOfNum = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/* Maandag van de week (ISO-week). */
export const mondayOf = (iso) => {
  const n = dayNum(iso);
  const wd = (((n + 3) % 7) + 7) % 7; // 1970-01-01 was een donderdag
  return isoOfNum(n - wd);
};

export const num = (v, f = null) => {
  if (v === "" || v == null) return f;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : f;
};

/* Tijd invoeren als "45", "45:30" of "1:02:15". Minuten bij één getal. */
export function parseDuration(text) {
  if (text == null || text === "") return null;
  if (typeof text === "number") return text;
  const parts = String(text).trim().split(":").map((x) => num(x));
  if (parts.some((x) => x == null || x < 0)) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function fmtDuration(sec, { long = false } = {}) {
  if (sec == null || !Number.isFinite(sec)) return "–";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (long) return h ? `${h} u ${m} min` : `${m} min`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/* Tempo volgens de sport: min/km, km/u, per 500 m of per 100 m. */
export function fmtPace(sport, sec, meters) {
  if (!sec || !meters) return null;
  const kind = (SPORTS[sport] || {}).pace || "km";
  if (kind === "kmh") return `${((meters / sec) * 3.6).toFixed(1).replace(".", ",")} km/u`;
  const per = kind === "500" ? 500 : kind === "100" ? 100 : 1000;
  const p = (sec / meters) * per;
  return `${fmtDuration(p)} /${kind === "km" ? "km" : kind === "500" ? "500 m" : "100 m"}`;
}

export const fmtKm = (m) => (m == null ? "–" : m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2).replace(".", ",")} km` : `${Math.round(m)} m`);

/* Een nieuwe sessie met verstandige standaardwaarden. */
export function newSession(kind, extra = {}) {
  const base = { id: newId(), date: localISO(), kind, rpe: null, durationSec: null, notes: "", source: "handmatig", createdAt: Date.now() };
  if (kind === "duur") return { ...base, sport: "hardlopen", type: "rustig", distanceM: null, avgHr: null, maxHr: null, avgPower: null, elevGain: null, ...extra };
  if (kind === "kracht") return { ...base, exercises: [], ...extra };
  if (kind === "wod") return { ...base, format: "amrap", capSec: null, score: "", movements: "", ...extra };
  if (kind === "hyrox") return { ...base, mode: "simulatie", splits: { runs: Array(8).fill(null), stations: Array(8).fill(null) }, ...extra };
  return { ...base, ...extra };
}

/* Titel van een sessie voor lijsten. */
export function sessionTitle(s) {
  if (s.kind === "duur") {
    const sp = SPORTS[s.sport] ? SPORTS[s.sport].label : "Duur";
    const t = ENDURANCE_TYPES[s.type];
    return t && s.type !== "rustig" ? `${sp} · ${t.label.toLowerCase()}` : sp;
  }
  if (s.kind === "wod") return `WOD · ${(WOD_FORMATS[s.format] || {}).label || ""}`.trim();
  if (s.kind === "hyrox") return `Hyrox · ${((HYROX_MODES[s.mode] || {}).label || "").toLowerCase()}`;
  if (s.kind === "kracht") return s.title || "Kracht";
  return (KINDS[s.kind] || {}).label || "Training";
}

export const pillarOf = (s) => (KINDS[s.kind] || KINDS.duur).pillar;

/* Hyrox: totaal uit de splits als er geen totaal is ingevuld. */
export function hyroxTotal(s) {
  if (s.durationSec) return s.durationSec;
  const all = [...(s.splits?.runs || []), ...(s.splits?.stations || [])].filter((x) => x > 0);
  return all.length ? all.reduce((a, b) => a + b, 0) : null;
}

/* Gezond verstand op invoer: sessies uit de opslag altijd in vorm. */
export function normalizeStore(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const sessions = Array.isArray(d.sessions) ? d.sessions.filter((s) => s && s.id && s.date && KINDS[s.kind]) : [];
  return { ...STORE_DEFAULT, ...d, profile: { ...PROFILE_DEFAULT, ...(d.profile || {}) }, sessions };
}
