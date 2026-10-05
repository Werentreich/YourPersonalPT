/* Gezin en coaching vanuit de app: praat met de functie team. */
import { fnUrl } from "../hybrid/native/platform.js";
import { token } from "../hybrid/strava.js";

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
    r = await fetch(fnUrl("team"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ ...body, action }) });
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
