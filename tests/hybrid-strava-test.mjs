/* Nexa Hybrid fase 4: koppeling met Strava (functies met nep-Supabase en
   nep-Strava) en het samenvoegen van het postvak in de app. */
import { createHmac } from "node:crypto";
process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
process.env.STRAVA_CLIENT_ID = "123";
process.env.STRAVA_CLIENT_SECRET = "geheim";
process.env.STRAVA_VERIFY_TOKEN = "verifieer";
const R = new URL("../netlify/", import.meta.url).href;
const core = await import(R + "lib/strava-core.mjs");
const auth = (await import(R + "functions/strava-auth.mjs")).default;
const hook = (await import(R + "functions/strava-webhook.mjs")).default;
const proc = (await import(R + "functions/strava-process-background.mjs")).default;
const { mergeInbox } = await import("../src/hybrid/engine/inbox.js");
const M = await import("../src/hybrid/engine/model.js");

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

// ---------- nep-diensten ----------
const db = { subs: new Map(), integ: new Map(), inbox: new Map() };
const calls = [];
let activityStore = {};
let athleteValid = true;
const res = (body, status = 200) => new Response(body == null || status === 204 ? null : JSON.stringify(body), { status });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const method = init.method || "GET";
  calls.push({ url, method, body: init.body });
  if (url.endsWith("/strava-process-background")) return new Response(null, { status: 202 });
  if (url.includes("/auth/v1/user")) return (init.headers.Authorization || "").includes("goed") ? res({ id: "u1", email: "a@b.nl" }) : res({}, 401);
  if (url.includes("/rest/v1/nexa_subscriptions")) return res([...db.subs.values()]);
  if (url.includes("/rest/v1/hybrid_integrations")) {
    if (method === "GET") {
      const ath = url.match(/athlete_id=eq\.(\d+)/);
      const uid = url.match(/user_id=eq\.([^&]+)/);
      return res([...db.integ.values()].filter((r) => (ath ? String(r.athlete_id) === ath[1] : true) && (uid ? r.user_id === decodeURIComponent(uid[1]) : true)));
    }
    if (method === "DELETE") { const uid = decodeURIComponent(url.match(/user_id=eq\.([^&]+)/)[1]); db.integ.delete(uid); return res(null, 204); }
    const row = JSON.parse(init.body); db.integ.set(row.user_id, { ...(db.integ.get(row.user_id) || {}), ...row }); return res(null, 201);
  }
  if (url.includes("/rest/v1/hybrid_inbox")) {
    if (method === "DELETE") { const uid = decodeURIComponent(url.match(/user_id=eq\.([^&]+)/)[1]); for (const [k, v] of db.inbox) if (v.user_id === uid) db.inbox.delete(k); return res(null, 204); }
    const row = JSON.parse(init.body); db.inbox.set(row.external_id, row); return res(null, 201);
  }
  if (url === "https://www.strava.com/oauth/token") {
    const p = new URLSearchParams(init.body);
    if (p.get("grant_type") === "authorization_code") return res({ access_token: "at1", refresh_token: "rt1", expires_at: Math.floor(Date.now() / 1000) + 21600, athlete: { id: 999, firstname: "Sam", lastname: "Test" } });
    return res({ access_token: "at2", refresh_token: "rt2", expires_at: Math.floor(Date.now() / 1000) + 21600 });
  }
  if (url === "https://www.strava.com/oauth/deauthorize") return res({ access_token: "x" });
  if (url.startsWith("https://www.strava.com/api/v3/athlete/activities")) return res(Object.values(activityStore).map((a) => ({ id: a.id })));
  if (url === "https://www.strava.com/api/v3/athlete") return athleteValid ? res({ id: 999 }) : res({}, 401);
  const st = url.match(/api\/v3\/activities\/(\d+)\/streams/);
  if (st) return res({ heartrate: { data: [140, 150, 150, 160] }, time: { data: [0, 10, 20, 30] } });
  const am = url.match(/api\/v3\/activities\/(\d+)$/);
  if (am) return activityStore[am[1]] ? res(activityStore[am[1]]) : res({ message: "Not Found" }, 404);
  throw new Error("onverwacht verzoek " + method + " " + url);
};

const ORIGIN = "https://nexa-performance.netlify.app";
const post = (body, headers = {}) => new Request(`${ORIGIN}/.netlify/functions/strava-auth`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, authorization: "Bearer goed", ...headers }, body: JSON.stringify(body) });
const get = (q) => new Request(`${ORIGIN}/.netlify/functions/strava-auth${q}`);

// ---------- state ----------
const st = core.signState("u1");
ok("state: geldig terug te lezen", core.verifyState(st) === "u1");
ok("state: gewijzigd = ongeldig", core.verifyState(st.slice(0, -2) + (st.endsWith("A") ? "BB" : "AA")) === null);
ok("state: verlopen = ongeldig", core.verifyState(core.signState("u1", 600, Date.now() - 3600e3)) === null);
ok("state: onzin = ongeldig", core.verifyState("abc") === null && core.verifyState(null) === null);

// ---------- omzetten ----------
const run = { id: 111, sport_type: "Run", start_date_local: "2026-10-06T07:12:00Z", start_date: "2026-10-06T05:12:00Z", moving_time: 3000, elapsed_time: 3200, distance: 10012.4, average_heartrate: 151.6, max_heartrate: 172, total_elevation_gain: 33.4, has_heartrate: true, name: "Ochtendloop" };
const m1 = core.mapActivity(run);
ok("Run → duur hardlopen met meetwaarden", m1.kind === "duur" && m1.sport === "hardlopen" && m1.date === "2026-10-06" && m1.durationSec === 3000 && m1.distanceM === 10012 && m1.avgHr === 152 && m1.elevGain === 33);
ok("WeightTraining → kracht", core.mapActivity({ id: 1, sport_type: "WeightTraining", start_date_local: "2026-10-06T18:00:00Z", moving_time: 3600 }).kind === "kracht");
ok("Crossfit → WOD, onbekend → multisport", core.mapActivity({ id: 2, sport_type: "Crossfit", start_date_local: "2026-10-06" }).kind === "wod" && core.mapActivity({ id: 3, sport_type: "Snowboard", start_date_local: "2026-10-06" }).sport === "multisport");
ok("vermogen alleen van een vermogensmeter", core.mapActivity({ id: 4, sport_type: "Ride", start_date_local: "2026-10-06", average_watts: 180, device_watts: false }).avgPower === null);
ok("hartslaghistogram uit streams", JSON.stringify(core.hrHistogram([140, 150, 150, 160], [0, 10, 20, 30])) === JSON.stringify({ 150: 20, 160: 10 }));

// ---------- koppelen ----------
let r = await auth(get(""));
ok("GET: aan", (await r.json()).enabled === true);
r = await auth(get("?error=access_denied"));
ok("geweigerd bij Strava: terug met melding", r.headers.get("location").endsWith("/app/?strava=geweigerd"));
r = await auth(get(`?code=c&state=${encodeURIComponent(core.signState("u1"))}&scope=read`));
ok("zonder activiteiten-rechten: terug met uitleg", r.headers.get("location").endsWith("strava=rechten") && db.integ.size === 0);
r = await auth(get(`?code=c&state=vals&scope=read,activity:read_all`));
ok("ongeldige state: niets opgeslagen", r.headers.get("location").endsWith("strava=fout") && db.integ.size === 0);
r = await auth(get(`?code=c&state=${encodeURIComponent(core.signState("u1"))}&scope=read,activity:read_all`));
const integ = db.integ.get("u1");
ok("gekoppeld: tokens alleen op de server, sporter herkend", r.headers.get("location").endsWith("strava=gekoppeld") && integ && integ.athlete_id === 999 && integ.access_token === "at1" && integ.athlete_name === "Sam Test");

// ---------- acties ----------
r = await auth(post({ action: "start" }, { origin: "https://evil.example" }));
ok("andere herkomst geweigerd", r.status === 403);
r = await auth(post({ action: "start" }, { authorization: "Bearer fout" }));
ok("zonder geldige sessie: 401", r.status === 401);
db.subs.set("u1", { user_id: "u1", status: "canceled", plan: "jaar" });
r = await auth(post({ action: "start" }));
ok("geen lopend abonnement: 402", r.status === 402);
db.subs.set("u1", { user_id: "u1", status: "active", plan: "jaar" });
r = await auth(post({ action: "start" }));
ok("Nexa Coach (één abonnement): toegestaan", r.status === 200);
db.subs.set("u1", { user_id: "u1", status: "active", plan: "hybrid_jaar" });
r = await auth(post({ action: "start" }));
let d = await r.json();
const au = new URL(d.url);
ok("start: toestemmingspagina met scope, terugkeer-URL en state", au.origin + au.pathname === "https://www.strava.com/oauth/authorize" && au.searchParams.get("scope") === "read,activity:read_all" && au.searchParams.get("redirect_uri") === `${ORIGIN}/.netlify/functions/strava-auth` && core.verifyState(au.searchParams.get("state")) === "u1");
d = await (await auth(post({ action: "status" }))).json();
ok("status: gekoppeld als Sam Test", d.connected && d.athlete === "Sam Test");
activityStore = { 111: run, 112: { ...run, id: 112, sport_type: "Ride", has_heartrate: false } };
d = await (await auth(post({ action: "sync" }))).json();
ok("sync: activiteiten van de laatste 14 dagen naar het postvak", d.count === 2 && db.inbox.get("111").activity.hrHist && db.inbox.get("112").activity.sport === "fietsen");
ok("postvak bevat geen route", !JSON.stringify(db.inbox.get("111").activity).includes("latlng") && !("map" in db.inbox.get("111").activity));

// ---------- webhook ----------
r = await hook(new Request(`${ORIGIN}/.netlify/functions/strava-webhook?hub.mode=subscribe&hub.verify_token=verifieer&hub.challenge=xyz`));
ok("webhook-aanmelding: challenge terug", (await r.json())["hub.challenge"] === "xyz");
r = await hook(new Request(`${ORIGIN}/.netlify/functions/strava-webhook?hub.mode=subscribe&hub.verify_token=fout&hub.challenge=xyz`));
ok("verkeerd verify-token: 403", r.status === 403);
calls.length = 0;
const ev = { object_type: "activity", aspect_type: "create", object_id: 113, owner_id: 999, subscription_id: 1 };
r = await hook(new Request(`${ORIGIN}/.netlify/functions/strava-webhook`, { method: "POST", body: JSON.stringify(ev) }));
const fwd = calls.find((c) => c.url.endsWith("strava-process-background"));
ok("webhook: direct 200 en doorgegeven aan de achtergrond", r.status === 200 && fwd);
r = await proc(new Request(`${ORIGIN}/.netlify/functions/strava-process-background`, { method: "POST", headers: { "x-nexa-signature": "vals" }, body: JSON.stringify(ev) }));
ok("achtergrond: zonder geldige handtekening geweigerd", r.status === 403);
activityStore[113] = { ...run, id: 113 };
const sign = (b) => createHmac("sha256", "geheim").update(b).digest("hex");
const body = JSON.stringify(ev);
r = await proc(new Request(`${ORIGIN}/.netlify/functions/strava-process-background`, { method: "POST", headers: { "x-nexa-signature": sign(body) }, body }));
ok("aangemaakt: opgehaald naar het postvak", r.status === 202 && db.inbox.get("113") && db.inbox.get("113").activity.distanceM === 10012);
ok("vals 'verwijderd' terwijl de activiteit nog bestaat: niets gewist", (await core.handleEvent({ ...ev, aspect_type: "delete" })) === "bestaat-nog" && !db.inbox.get("113").deleted);
delete activityStore[113];
ok("echt verwijderd: als verwijderd in het postvak", (await core.handleEvent({ ...ev, aspect_type: "delete" })) === "verwijderd" && db.inbox.get("113").deleted === true);
ok("vals 'toestemming ingetrokken': koppeling blijft", (await core.handleEvent({ object_type: "athlete", owner_id: 999, updates: { authorized: "false" } })) === "nog-geldig" && db.integ.has("u1"));
ok("onbekende sporter: genegeerd", (await core.handleEvent({ ...ev, owner_id: 1 })) === "onbekend");

// ---------- ontkoppelen ----------
calls.length = 0;
d = await (await auth(post({ action: "disconnect" }))).json();
ok("ontkoppelen: bij Strava ingetrokken, koppeling en postvak weg", d.ok && calls.some((c) => c.url.endsWith("/oauth/deauthorize")) && !db.integ.has("u1") && [...db.inbox.values()].every((x) => x.user_id !== "u1"));
athleteValid = false;

// ---------- samenvoegen in de app ----------
const A = (id, extra = {}) => ({ external_id: String(id), deleted: false, created_at: "2026-10-06T08:00:00Z", activity: { ...core.mapActivity({ ...run, id }), ...extra } });
const plan = [{ id: "p1", date: "2026-10-06", kind: "duur", sport: "hardlopen", type: "interval", status: "gepland", slot: "D_INT" }, { id: "p2", date: "2026-10-07", kind: "kracht", status: "gepland", slot: "K_LOWER", title: "Kracht onderlichaam" }];
let mg = mergeInbox([], plan, [A(111)]);
const s111 = mg.sessions[0];
ok("nieuw: sessie uit Strava, inspanning nog invullen", mg.summary.added === 1 && s111.source === "strava" && s111.externalId === "111" && s111.needsRpe && s111.distanceM === 10012);
ok("gekoppeld aan de geplande intervaltraining, soort overgenomen", s111.planItemId === "p1" && s111.type === "interval" && mg.planItems.find((x) => x.id === "p1").status === "gedaan");
const edited = { ...s111, rpe: 8, notes: "zwaar", needsRpe: false };
mg = mergeInbox([edited], mg.planItems, [A(111, { durationSec: 3100 })]);
ok("bijgewerkt: meetwaarden nieuw, eigen inspanning en notitie blijven", mg.summary.updated === 1 && mg.sessions[0].durationSec === 3100 && mg.sessions[0].rpe === 8 && mg.sessions[0].notes === "zwaar");
const manual = { ...M.newSession("duur"), date: "2026-10-06", sport: "hardlopen", durationSec: 2950, rpe: 7 };
mg = mergeInbox([manual], null, [A(111)]);
ok("al handmatig vastgelegd: niet dubbel, Strava-id erbij", mg.sessions.length === 1 && mg.sessions[0].externalId === "111" && mg.summary.duplicates === 1);
const lift = { external_id: "200", created_at: "x", activity: core.mapActivity({ id: 200, sport_type: "WeightTraining", start_date_local: "2026-10-07T18:00:00Z", moving_time: 3600 }) };
mg = mergeInbox([], plan, [lift]);
ok("krachttraining uit Strava gekoppeld aan geplande kracht, met titel", mg.sessions[0].planItemId === "p2" && mg.sessions[0].title === "Kracht onderlichaam");
const linked = mergeInbox([], plan, [A(111)]);
mg = mergeInbox(linked.sessions, linked.planItems, [{ external_id: "111", deleted: true, created_at: "y" }]);
ok("verwijderd in Strava: sessie weg en geplande sessie weer open", mg.sessions.length === 0 && mg.planItems.find((x) => x.id === "p1").status === "gepland" && mg.summary.removed === 1);
ok("onbekende rij zonder activiteit: genegeerd", mergeInbox([], null, [{ external_id: "9", created_at: "z", activity: null }]).sessions.length === 0);

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
