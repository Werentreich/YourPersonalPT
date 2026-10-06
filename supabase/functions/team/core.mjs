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
const TRAIN_KEY = "macroverdeling:training:v1";
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

const GOALS = ["5k", "10k", "halve", "marathon", "hybride", "kracht", "hyrox", "conditie", "bodybuilding"];
const NUM = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/* Trainingsschema: alleen de instellingen; de app van de sporter maakt er
   zelf het schema van (met haar eigen geschiedenis en herstel). */
export function cleanSchema(p) {
  const s = p && typeof p === "object" ? p.settings : null;
  if (s && s.goal === "bodybuilding") {
    const days = Array.isArray(s.days) ? [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    if (days.length < 1 || days.length > 6) return { error: "Kies 1 tot 6 trainingsdagen." };
    return {
      payload: {
        settings: {
          goal: "bodybuilding",
          days,
          minutes: [45, 60, 75, 90].includes(s.minutes) ? s.minutes : 60,
          experience: ["beginner", "gevorderd", "ervaren"].includes(s.experience) ? s.experience : "gevorderd",
          equipment: ["gym", "basis", "thuis"].includes(s.equipment) ? s.equipment : "gym",
        },
        note: cleanNote(p.note),
      },
    };
  }
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
  const out = { goal: o.goal, rate, proteinPerKg: protein, note: cleanNote(o.note) };
  // optioneel, alleen meegestuurd als de coach het instelt
  if (o.fatPercent != null) out.fatPercent = NUM(o.fatPercent, 15, 40);
  if (o.meals != null) out.meals = Number.isInteger(o.meals) && o.meals >= 2 && o.meals <= 7 ? o.meals : null;
  if (o.activity != null) out.activity = ["zittend", "licht", "actief", "zwaar"].includes(o.activity) ? o.activity : null;
  if (o.cycling != null) out.cycling = o.cycling === true;
  for (const k of Object.keys(out)) if (out[k] === null && !["proteinPerKg", "note"].includes(k)) delete out[k];
  return { payload: out };
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
      voeding: { goal: f.goal || null, rate: typeof f.rate === "number" ? f.rate : null, proteinPerKg: typeof f.proteinOverride === "number" ? f.proteinOverride : null, fatPercent: typeof f.fatPercent === "number" ? f.fatPercent : null, meals: typeof f.meals === "number" ? f.meals : null, activity: typeof f.activity === "string" ? f.activity.slice(0, 20) : null, cycling: typeof f.cycling === "boolean" ? f.cycling : null },
    },
  };
  if (scopes.schema) out.program = programSummary(byKey[TRAIN_KEY]);
  if (!scopes.voortgang) return out;
  const from = since(7);
  const to = since(-14);
  out.week = h.plan && Array.isArray(h.plan.items)
    ? h.plan.items
        .filter((x) => x.date >= from && x.date <= to && !x.optional)
        .map((x) => ({ id: typeof x.id === "string" ? x.id.slice(0, 40) : null, date: x.date, title: x.title || null, kind: x.kind || null, status: x.status || null, targetMin: x.targetMin || null, part: x.part || null }))
        .slice(0, 40)
    : [];
  out.sessions = (Array.isArray(h.sessions) ? h.sessions : [])
    .filter((s) => s.date >= since(28))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 30)
    .map((s) => ({
      id: typeof s.id === "string" ? s.id.slice(0, 40) : null,
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

/* ---------------- fase 2: activiteit en berichten ---------------- */

export function cleanMessage(t) {
  const s = String(t || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1000);
  return s || null;
}

/* Gedane trainingen van de afgelopen 7 dagen van de sporters die hun
   voortgang delen. `rows`: nexa_data-rijen (user_id, value) met de
   Hybrid-gegevens; `links`: actieve koppelingen van deze coach. */
export function activityFeed(rows, links, now = Date.now()) {
  const byUser = Object.fromEntries((rows || []).map((r) => [r.user_id, parse(r.value)]));
  const since = new Date(now - 7 * DAY).toISOString().slice(0, 10);
  const out = [];
  for (const l of links || []) {
    if (!cleanScopes(l.scopes).voortgang) continue;
    const h = byUser[l.client_id] || {};
    for (const s of Array.isArray(h.sessions) ? h.sessions : []) {
      if (!s || typeof s.date !== "string" || s.date < since) continue;
      out.push({
        linkId: l.id,
        name: l.client_name,
        date: s.date,
        at: typeof s.createdAt === "number" ? s.createdAt : Date.parse(s.date + "T12:00:00Z"),
        title: s.title || (s.kind === "duur" ? s.sport || "duurtraining" : s.kind || "training"),
        kind: s.kind || null,
        rpe: typeof s.rpe === "number" ? s.rpe : null,
        durationSec: typeof s.durationSec === "number" ? s.durationSec : null,
      });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 30);
}

/* Training waar een bericht bij hoort (fase 3). */
export function cleanRef(r) {
  if (!r || typeof r !== "object") return null;
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const title = String(r.title || "").trim().slice(0, 80);
  const sessionId = typeof r.sessionId === "string" ? r.sessionId.slice(0, 40) : null;
  if (!date || !title) return null;
  return { sessionId, title, date };
}

/* ---------------- fase 4: verplaatsen en krachtprogramma ---------------- */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* Geplande training verplaatsen of overslaan. */
export function cleanMove(p) {
  const o = p && typeof p === "object" ? p : {};
  const itemId = typeof o.itemId === "string" && o.itemId.length <= 40 ? o.itemId : null;
  if (!itemId) return { error: "Kies een training." };
  if (o.skip === true) return { payload: { itemId, skip: true, title: String(o.title || "").slice(0, 80) || null } };
  if (typeof o.toDate !== "string" || !ISO.test(o.toDate)) return { error: "Kies een dag." };
  return { payload: { itemId, toDate: o.toDate, title: String(o.title || "").slice(0, 80) || null } };
}

/* Krachtprogramma van de sporter: per dag de oefeningen met sets, bereik,
   rust en notitie. Oefening-ids uit de Nexa-bibliotheek of eigen (hyb_...). */
export function cleanProgram(p) {
  const days = p && Array.isArray(p.days) ? p.days.slice(0, 7) : null;
  if (!days || !days.length) return { error: "Het programma is leeg." };
  const out = [];
  for (const d of days) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || d.id.length > 40) return { error: "Onbekende trainingsdag." };
    const slots = (Array.isArray(d.slots) ? d.slots : []).slice(0, 15).map((x) => {
      const exId = typeof x.exId === "string" && /^[a-z0-9_]{1,40}$/.test(x.exId) ? x.exId : null;
      const lo = Number.isInteger(x.repMin) && x.repMin >= 1 && x.repMin <= 60 ? x.repMin : 8;
      const hi = Number.isInteger(x.repMax) && x.repMax >= lo && x.repMax <= 60 ? x.repMax : lo;
      return exId && {
        exId,
        sets: Number.isInteger(x.sets) && x.sets >= 1 && x.sets <= 10 ? x.sets : 3,
        repMin: lo,
        repMax: hi,
        rest: Number.isInteger(x.rest) && x.rest >= 15 && x.rest <= 600 ? x.rest : 120,
        note: String(x.note || "").slice(0, 200),
        ss: x.ss === true,
      };
    }).filter(Boolean);
    if (!slots.length) return { error: "Een trainingsdag heeft minstens één oefening nodig." };
    out.push({ id: d.id, slots });
  }
  const programId = typeof p.programId === "string" && p.programId.length <= 40 ? p.programId : null;
  return { payload: { programId, days: out, note: cleanNote(p.note) } };
}

/* Het krachtprogramma zoals de coach het ziet (uit macroverdeling:training:v1):
   het prestatieprogramma, of anders het actieve bodybuildingschema. */
export function programSummary(T) {
  if (!T || !Array.isArray(T.programs)) return null;
  const prog = T.programs.find((p) => p.perf && p.id === T.activeProgramId) || T.programs.find((p) => p.id === T.activeProgramId) || T.programs.find((p) => p.perf) || null;
  if (!prog) return null;
  const custom = Object.fromEntries((T.customEx || []).map((e) => [e.id, e.name]));
  return {
    id: prog.id,
    name: prog.name,
    perf: !!prog.perf,
    days: (prog.days || []).slice(0, 7).map((d) => ({
      id: d.id,
      name: d.name,
      slots: (d.slots || []).slice(0, 15).map((x) => ({ exId: x.exId, name: custom[x.exId] || null, sets: x.sets, repMin: x.repMin, repMax: x.repMax, rest: x.rest, note: x.note || "", ss: !!x.ss })),
    })),
  };
}
