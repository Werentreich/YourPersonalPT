/* Gezin en coaching: koppelingen tussen een coach en sporters.

   Rechten (door de sporter gekozen, altijd in te trekken):
   - schema:    de coach stelt het trainingsschema in
   - voeding:   de coach stelt het voedingsdoel in (cut, onderhoud, opbouw, tempo)
   - voortgang: de coach ziet het schema van deze week, de trainingen, de
                check-ins en het gewicht
   De coach schrijft nooit rechtstreeks in de gegevens van de sporter: een
   instelling wordt een opdracht (coach_assignments) die de app van de
   sporter toepast en meldt, met de mogelijkheid het terug te draaien. */

export const SCOPES = { schema: "Trainingsschema instellen", voeding: "Voedingsdoel instellen", voortgang: "Voortgang bekijken" };
export const MAX_CLIENTS = 10;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // zonder 0/O en 1/I
const HYBRID_KEY = "macroverdeling:hybrid:v1";
const NEXA_KEY = "macroverdeling:v1";
const DAY = 86400000;

export function newCode(rand = Math.random) {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

export const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
export const validCode = (c) => /^[A-Z2-9]{8}$/.test(c || "");

export function cleanName(n) {
  const s = String(n || "").replace(/\s+/g, " ").trim().slice(0, 40);
  return s.length ? s : null;
}

export function cleanScopes(s) {
  const o = s && typeof s === "object" ? s : {};
  return Object.fromEntries(Object.keys(SCOPES).map((k) => [k, o[k] === true]));
}

/* ---------------- opdrachten ---------------- */

const GOALS = ["5k", "10k", "halve", "marathon", "hybride", "kracht", "hyrox", "conditie"];
const NUM = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/* Trainingsschema: alleen de instellingen; de app van de sporter maakt er
   zelf het schema van (met haar eigen geschiedenis en herstel). */
export function cleanSchema(p) {
  const s = p && typeof p === "object" ? p.settings : null;
  if (!s || typeof s !== "object" || !GOALS.includes(s.goal)) return { error: "Kies een doel voor het schema." };
  const days = Array.isArray(s.days) ? [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (days.length < 2) return { error: "Kies minstens twee trainingsdagen." };
  const out = { ...s, days };
  // alleen platte waarden doorlaten (geen geneste objecten van onbekende vorm)
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === "object" && !Array.isArray(v) && k !== "exp") delete out[k];
    if (typeof v === "string" && v.length > 60) delete out[k];
  }
  if (out.exp && typeof out.exp === "object") out.exp = Object.fromEntries(Object.entries(out.exp).filter(([k, v]) => typeof k === "string" && typeof v === "string" && v.length <= 20));
  return { payload: { settings: out, note: cleanNote(p.note) } };
}

export function cleanVoeding(p) {
  const o = p && typeof p === "object" ? p : {};
  if (!["cut", "onderhoud", "bulk"].includes(o.goal)) return { error: "Kies een voedingsdoel." };
  const rate = o.goal === "onderhoud" ? 0 : NUM(o.rate, -1.5, 1);
  if (rate == null) return { error: "Kies een tempo." };
  if (o.goal === "cut" && rate >= 0) return { error: "Bij afvallen hoort een negatief tempo." };
  if (o.goal === "bulk" && rate <= 0) return { error: "Bij opbouwen hoort een positief tempo." };
  const protein = o.proteinPerKg == null ? null : NUM(o.proteinPerKg, 1.2, 3);
  return { payload: { goal: o.goal, rate, proteinPerKg: protein, note: cleanNote(o.note) } };
}

const cleanNote = (n) => {
  const s = String(n || "").trim().slice(0, 280);
  return s || null;
};

/* ---------------- overzicht voor de coach ---------------- */

const parse = (v) => {
  if (v == null) return null;
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return null;
  }
};

/* Alleen wat bij "voortgang" hoort, en kort: geen notities, routes of
   eetdagboek. `rows` zijn de nexa_data-rijen van de sporter. */
export function clientSummary(rows, scopes, now = Date.now()) {
  const byKey = Object.fromEntries((rows || []).map((r) => [r.key, parse(r.value)]));
  const h = byKey[HYBRID_KEY] || {};
  const n = byKey[NEXA_KEY] || {};
  const since = (days) => new Date(now - days * DAY).toISOString().slice(0, 10);
  const f = n.f || {};
  const out = {
    // altijd: wat de coach nodig heeft om een schema of doel in te stellen
    basis: {
      discipline: h.discipline || null,
      plan: h.plan && h.plan.settings ? { settings: h.plan.settings } : null,
      voeding: { goal: f.goal || null, rate: typeof f.rate === "number" ? f.rate : null, proteinPerKg: typeof f.proteinOverride === "number" ? f.proteinOverride : null },
    },
  };
  if (!scopes.voortgang) return out;
  const from = since(7);
  const to = since(-14);
  out.week = h.plan && Array.isArray(h.plan.items)
    ? h.plan.items
        .filter((x) => x.date >= from && x.date <= to && !x.optional)
        .map((x) => ({ date: x.date, title: x.title || null, kind: x.kind || null, status: x.status || null, targetMin: x.targetMin || null, part: x.part || null }))
        .slice(0, 40)
    : [];
  out.sessions = (Array.isArray(h.sessions) ? h.sessions : [])
    .filter((s) => s.date >= since(28))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 30)
    .map((s) => ({
      date: s.date,
      kind: s.kind || null,
      title: s.title || null,
      sport: s.sport || null,
      rpe: typeof s.rpe === "number" ? s.rpe : null,
      durationSec: typeof s.durationSec === "number" ? s.durationSec : null,
      distanceM: typeof s.distanceM === "number" ? s.distanceM : null,
      sets: (s.blocks || []).reduce((a, b) => a + (b.type === "sets" ? (b.items || []).reduce((c, it) => c + (it.sets || []).length, 0) : 0), 0),
    }));
  out.checkins = (Array.isArray(h.checkins) ? h.checkins : [])
    .filter((c) => c.date >= since(14))
    .map((c) => ({ date: c.date, sleepQ: c.sleepQ ?? null, energy: c.energy ?? null, soreness: c.soreness ?? null, stress: c.stress ?? null, sleepH: c.sleepH ?? null, ill: !!c.ill }));
  out.weights = (Array.isArray(n.log) ? n.log : [])
    .filter((x) => x && x.date >= since(90) && typeof x.weight === "number")
    .map((x) => ({ date: x.date, weight: x.weight }))
    .slice(-60);
  out.profile = { weight: typeof f.weight === "number" ? f.weight : null, height: typeof f.height === "number" ? f.height : null, sex: f.sex || null };
  return out;
}

/* Koppeling zoals de app hem te zien krijgt (zonder code van anderen). */
export function linkView(l, me) {
  const coach = l.coach_id === me;
  return {
    id: l.id,
    role: coach ? "coach" : "sporter",
    status: l.status,
    coachName: l.coach_name,
    clientName: l.client_name,
    scopes: cleanScopes(l.scopes),
    code: coach && l.status === "uitgenodigd" ? l.code : undefined,
    expiresAt: l.status === "uitgenodigd" ? l.expires_at : undefined,
    acceptedAt: l.accepted_at || null,
  };
}
