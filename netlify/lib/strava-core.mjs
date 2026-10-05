/* Gedeelde code voor de Strava-koppeling van Nexa Hybrid.

   Omgevingsvariabelen (Netlify, alleen voor Functions, geheim):
   - STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET  van de eigen API-app op
     strava.com/settings/api (Authorization Callback Domain = het domein
     van de site)
   - STRAVA_VERIFY_TOKEN                     zelfgekozen geheim voor de webhook
   - SUPABASE_SERVICE_ROLE_KEY               al aanwezig (abonnementen)
   Zolang STRAVA_CLIENT_ID of STRAVA_CLIENT_SECRET ontbreekt, staat de
   koppeling uit en meldt de app dat.

   Strava-voorwaarden (API Agreement, november 2024): gegevens worden alleen
   aan de gebruiker zelf getoond en niet gebruikt om AI-modellen te trainen.
   Routes (GPS) slaan we niet op de server op. */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { SB_URL, getSub, entitled, isHybridPlan } from "./billing-core.mjs";

export const STRAVA_OAUTH = "https://www.strava.com/oauth";
export const STRAVA_API = "https://www.strava.com/api/v3";
export const SCOPE = "read,activity:read_all";
export const INTEGRATIONS = "hybrid_integrations";
export const INBOX = "hybrid_inbox";

const env = (k) => (typeof process !== "undefined" && process.env ? process.env[k] : undefined) || "";
export const stravaEnabled = () => !!(env("STRAVA_CLIENT_ID") && env("STRAVA_CLIENT_SECRET") && env("SUPABASE_SERVICE_ROLE_KEY"));

/* ---------------- state (CSRF) ----------------
   user-id, vervaltijd en een willekeurige waarde, ondertekend met HMAC. */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
export function signState(userId, ttlSec = 600, now = Date.now()) {
  const payload = `${userId}.${Math.floor(now / 1000) + ttlSec}.${b64u(randomBytes(9))}`;
  const sig = createHmac("sha256", env("STRAVA_CLIENT_SECRET")).update(payload).digest("base64url");
  return `${b64u(payload)}.${sig}`;
}
export function verifyState(state, now = Date.now()) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [p64, sig] = state.split(".");
  let payload;
  try {
    payload = Buffer.from(p64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expect = createHmac("sha256", env("STRAVA_CLIENT_SECRET")).update(payload).digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, exp] = payload.split(".");
  if (!userId || !(Number(exp) > Math.floor(now / 1000))) return null;
  return userId;
}

/* ---------------- Supabase (service role) ---------------- */
function adminHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const h = { apikey: key, "Content-Type": "application/json", ...extra };
  if (!key.startsWith("sb_secret_")) h.Authorization = `Bearer ${key}`;
  return h;
}
async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: adminHeaders(init.headers || {}) });
  if (!r.ok) throw new Error(`Supabase ${init.method || "GET"} ${path.split("?")[0]}: ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
export const getIntegration = async (userId) => ((await sb(`${INTEGRATIONS}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.strava&select=*`)) || [])[0] || null;
export const integrationByAthlete = async (athleteId) => ((await sb(`${INTEGRATIONS}?provider=eq.strava&athlete_id=eq.${encodeURIComponent(athleteId)}&select=*`)) || [])[0] || null;
export const saveIntegration = (row) =>
  sb(`${INTEGRATIONS}?on_conflict=user_id,provider`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ ...row, provider: "strava", updated_at: new Date().toISOString() }) });
export const deleteIntegration = (userId) => sb(`${INTEGRATIONS}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.strava`, { method: "DELETE" });
export const clearInbox = (userId) => sb(`${INBOX}?user_id=eq.${encodeURIComponent(userId)}&provider=eq.strava`, { method: "DELETE" });
export const putInbox = (userId, externalId, activity, deleted = false) =>
  sb(`${INBOX}?on_conflict=user_id,provider,external_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, provider: "strava", external_id: String(externalId), deleted, activity: deleted ? null : activity, created_at: new Date().toISOString() }),
  });

/* Coach, Strava en agenda horen bij het betaalde abonnement van Nexa
   (Nexa Coach; ook een lopend Hybrid-abonnement telt). Zonder betaalmuur:
   iedereen. */
export async function hybridAllowed(userId, billingOn) {
  if (!billingOn) return true;
  const row = await getSub(userId).catch(() => null);
  if (!!row && entitled(row)) return true;
  return !!(await coveringCoach(userId).catch(() => null));
}

/* Gezin en coaching: een gekoppelde sporter valt onder het abonnement van
   zijn of haar coach. Geeft de naam van die coach terug, of null. */
export async function coveringCoach(userId) {
  const links = (await sb(`coach_links?client_id=eq.${encodeURIComponent(userId)}&status=eq.actief&select=coach_id,coach_name`)) || [];
  for (const l of links) {
    const row = await getSub(l.coach_id).catch(() => null);
    if (row && entitled(row)) return l.coach_name;
  }
  return null;
}

/* ---------------- tokens ---------------- */
async function tokenCall(params) {
  const r = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("STRAVA_CLIENT_ID"), client_secret: env("STRAVA_CLIENT_SECRET"), ...params }).toString(),
  });
  if (!r.ok) throw new Error(`Strava token: ${r.status}`);
  return r.json();
}
export const exchangeCode = (code) => tokenCall({ code, grant_type: "authorization_code" });

/* Geldig toegangstoken; vernieuwt als het binnen 5 minuten verloopt. */
export async function freshToken(integ, now = Date.now()) {
  if (new Date(integ.expires_at).getTime() - now > 5 * 60 * 1000) return integ.access_token;
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: integ.refresh_token });
  await saveIntegration({ user_id: integ.user_id, athlete_id: integ.athlete_id, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(t.expires_at * 1000).toISOString(), scope: integ.scope, athlete_name: integ.athlete_name });
  return t.access_token;
}

export async function stravaGet(token, path) {
  const r = await fetch(`${STRAVA_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) throw Object.assign(new Error("Strava: limiet bereikt"), { code: "limiet" });
  if (!r.ok) throw Object.assign(new Error(`Strava ${path.split("?")[0]}: ${r.status}`), { status: r.status });
  return r.json();
}

export async function deauthorize(token) {
  await fetch(`${STRAVA_OAUTH}/deauthorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: token }).toString() }).catch(() => null);
}

/* ---------------- activiteit omzetten ---------------- */
const SPORT = {
  Run: ["duur", "hardlopen"],
  TrailRun: ["duur", "hardlopen"],
  VirtualRun: ["duur", "hardlopen"],
  Ride: ["duur", "fietsen"],
  VirtualRide: ["duur", "fietsen"],
  GravelRide: ["duur", "fietsen"],
  MountainBikeRide: ["duur", "fietsen"],
  EBikeRide: ["duur", "fietsen"],
  Rowing: ["duur", "roeien"],
  VirtualRow: ["duur", "roeien"],
  Swim: ["duur", "zwemmen"],
  Walk: ["duur", "wandelen"],
  Hike: ["duur", "wandelen"],
  StairStepper: ["duur", "stepper"],
  NordicSki: ["duur", "skierg"],
  WeightTraining: ["kracht", null],
  Crossfit: ["wod", null],
  HighIntensityIntervalTraining: ["wod", null],
  Workout: ["wod", null],
  Yoga: ["mobiliteit", null],
  Pilates: ["mobiliteit", null],
};

/* Seconden per hartslagbak van 5 slagen (zoals bij bestandsimport). */
export function hrHistogram(hr, time) {
  if (!Array.isArray(hr) || !Array.isArray(time) || hr.length !== time.length) return null;
  const hist = {};
  for (let i = 1; i < hr.length; i++) {
    const dt = time[i] - time[i - 1];
    if (!hr[i] || dt <= 0 || dt > 60) continue;
    const b = Math.floor(hr[i] / 5) * 5;
    hist[b] = (hist[b] || 0) + dt;
  }
  return Object.keys(hist).length ? hist : null;
}

export function mapActivity(a, streams = null) {
  const [kind, sport] = SPORT[a.sport_type] || SPORT[a.type] || ["duur", "multisport"];
  const date = String(a.start_date_local || a.start_date || "").slice(0, 10);
  const out = {
    externalId: String(a.id),
    source: "strava",
    kind,
    date,
    startTime: a.start_date || null,
    name: a.name || null,
    durationSec: Math.round(a.moving_time || a.elapsed_time || 0) || null,
    stravaType: a.sport_type || a.type || null,
    trainer: !!a.trainer,
  };
  if (kind === "duur") {
    Object.assign(out, {
      sport,
      distanceM: Math.round(a.distance || 0) || null,
      avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
      avgPower: a.device_watts && a.average_watts ? Math.round(a.average_watts) : null,
      elevGain: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
    });
  } else if (a.average_heartrate) {
    out.avgHr = Math.round(a.average_heartrate);
  }
  const hist = streams ? hrHistogram(streams.heartrate && streams.heartrate.data, streams.time && streams.time.data) : null;
  if (hist) out.hrHist = hist;
  return out;
}

/* Eén activiteit ophalen en in het postvak zetten. */
export async function importActivity(integ, activityId) {
  const token = await freshToken(integ);
  const a = await stravaGet(token, `/activities/${encodeURIComponent(activityId)}`);
  let streams = null;
  if (a.has_heartrate) streams = await stravaGet(token, `/activities/${encodeURIComponent(activityId)}/streams?keys=heartrate,time&key_by_type=true`).catch(() => null);
  await putInbox(integ.user_id, a.id, mapActivity(a, streams));
  return a;
}

/* Gebeurtenis van de webhook verwerken (zie strava-process-background). */
export async function handleEvent(ev) {
  const integ = await integrationByAthlete(ev.owner_id);
  if (!integ) return "onbekend";
  if (ev.object_type === "athlete") {
    if (!ev.updates || String(ev.updates.authorized) !== "false") return "genegeerd";
    try {
      const token = await freshToken(integ);
      await stravaGet(token, "/athlete");
      return "nog-geldig"; // token werkt nog: vals bericht
    } catch (e) {
      await deleteIntegration(integ.user_id);
      await clearInbox(integ.user_id);
      return "ontkoppeld";
    }
  }
  if (ev.object_type !== "activity") return "genegeerd";
  if (ev.aspect_type === "delete") {
    try {
      const token = await freshToken(integ);
      await stravaGet(token, `/activities/${encodeURIComponent(ev.object_id)}`);
      return "bestaat-nog";
    } catch (e) {
      if (e.status !== 404) throw e;
      await putInbox(integ.user_id, ev.object_id, null, true);
      return "verwijderd";
    }
  }
  await importActivity(integ, ev.object_id);
  return "opgehaald";
}

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export const redirect = (url) => new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
