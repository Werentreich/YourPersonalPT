/* Gezin en coaching vanuit de app: praat met de Edge Function team in
   Supabase (supabase/functions/team). */
import { SB_URL, SB_KEY } from "../sync.js";
import { token } from "../hybrid/strava.js";

export const TEAM_URL = `${SB_URL}/functions/v1/team`;

export const SCOPES = {
  schema: { label: "Trainingsschema instellen", hint: "Uw coach kiest doel, dagen en niveau; Nexa maakt er uw schema van." },
  voeding: { label: "Voedingsdoel instellen", hint: "Afvallen, onderhouden of opbouwen, het tempo en eventueel eiwit per kilo." },
  voortgang: { label: "Voortgang bekijken", hint: "Uw schema, trainingen, check-ins en gewicht. Niet uw notities, routes of wat u eet." },
};
export const DEFAULT_SCOPES = { schema: true, voeding: true, voortgang: true };
export const INVITE_KEY = "nexa:team-invite"; // code uit een link, tot de gebruiker is ingelogd
export const TEAM_KEY = "nexa:team"; // laatst bekende koppelingen (ook zonder internet)

export async function teamCall(action, body = {}) {
  const t = await token();
  if (!t) throw Object.assign(new Error("Log eerst in met uw Nexa-account."), { code: "inloggen" });
  let r;
  try {
    r = await fetch(TEAM_URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${t}` }, body: JSON.stringify({ ...body, action }) });
  } catch (e) {
    throw new Error("Geen verbinding. Controleer uw internet en probeer het opnieuw.");
  }
  const d = await r.json().catch(() => null);
  if (!d || d.ok === false) throw Object.assign(new Error((d && d.message) || "Dat lukte even niet."), { code: d && d.code, status: r.status });
  return d;
}

export const inviteUrl = (code, site = typeof location !== "undefined" ? location.origin : "https://nexa-performance.netlify.app") => `${site}/app/?koppel=${code}`;

/* Code uit de adresbalk (?koppel=ABCD2345) halen en bewaren tot na het inloggen. */
export function takeInviteFromUrl(loc = typeof location !== "undefined" ? location : null, store = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!loc) return null;
  const p = new URLSearchParams(loc.search || "");
  const c = (p.get("koppel") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!c) return null;
  try {
    store && store.setItem(INVITE_KEY, c);
    p.delete("koppel");
    const q = p.toString();
    if (typeof history !== "undefined") history.replaceState(null, "", loc.pathname + (q ? `?${q}` : "") + (loc.hash || ""));
  } catch (e) {
    /* geen opslag: alleen nu */
  }
  return c;
}

/* ---------------- opdrachten toepassen (bij de sporter) ---------------- */

/* Wat er verandert als een opdracht wordt toegepast, en hoe het terug kan.
   - schema:  nieuwe planinstellingen (de planner maakt het schema) en de
              sport die erbij hoort
   - voeding: doel, tempo en eventueel eiwit per kilo in het Nexa-profiel */
export function applyPlan(a, cur) {
  if (a.kind === "schema") {
    const s = a.payload && a.payload.settings;
    if (!s || !s.goal) return null;
    return { kind: "schema", settings: s, before: cur.planSettings || null, beforeDiscipline: cur.discipline || null };
  }
  if (a.kind === "voeding") {
    const p = a.payload || {};
    if (!p.goal) return null;
    const patch = { goal: p.goal, rate: p.goal === "onderhoud" ? 0 : p.rate };
    if (p.proteinPerKg != null) patch.proteinOverride = p.proteinPerKg;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, cur.f ? cur.f[k] ?? null : null]));
    return { kind: "voeding", patch, before };
  }
  return null;
}

const GOAL_TEXT = { cut: "afvallen", onderhoud: "gewicht houden", bulk: "spiermassa opbouwen" };
export function assignmentText(a) {
  if (a.kind === "schema") return `${a.coachName} heeft uw trainingsschema ingesteld.`;
  const p = a.payload || {};
  const rate = p.goal === "onderhoud" ? "" : `, ${String(Math.abs(p.rate)).replace(".", ",")}% van uw gewicht per week`;
  return `${a.coachName} heeft uw voedingsdoel ingesteld: ${GOAL_TEXT[p.goal] || p.goal}${rate}.`;
}

export function readTeamCache(store = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const t = JSON.parse((store && store.getItem(TEAM_KEY)) || "null");
    return t && Array.isArray(t.links) ? t : { links: [], coveredBy: null };
  } catch (e) {
    return { links: [], coveredBy: null };
  }
}
export function writeTeamCache(t, store = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    store && store.setItem(TEAM_KEY, JSON.stringify({ links: t.links || [], coveredBy: t.coveredBy || null, at: Date.now() }));
  } catch (e) {
    /* alleen in het geheugen */
  }
}

/* ---------------- fase 2: gezien en nieuw ---------------- */
export const SEEN_KEY = "nexa:team-seen"; // per koppeling: tot wanneer de coach de activiteit heeft gezien

export function readSeen(store = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const v = JSON.parse((store && store.getItem(SEEN_KEY)) || "null");
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    return {};
  }
}
export function writeSeen(v, store = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    store && store.setItem(SEEN_KEY, JSON.stringify(v));
  } catch (e) {
    /* niets */
  }
}

/* Nieuwe activiteit sinds de coach laatst keek. Een koppeling die nog niet
   bekend was, telt vanaf nu (geen stortvloed van oude trainingen). */
export function newActivity(feed, seen, now = Date.now()) {
  const next = { ...seen };
  for (const f of feed || []) if (next[f.linkId] == null) next[f.linkId] = now;
  return { items: (feed || []).filter((f) => f.at > next[f.linkId]), seen: next };
}

export function activityText(items) {
  if (!items.length) return null;
  const first = items[0];
  const more = items.length - 1;
  return `${first.name} heeft "${first.title}" gedaan${more > 0 ? `, en nog ${more} ${more === 1 ? "training" : "trainingen"}` : ""}.`;
}
