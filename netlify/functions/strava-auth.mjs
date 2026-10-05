/* Koppeling met Strava (Nexa Hybrid).

   GET                         -> { enabled }
   GET ?code=…&state=…         terugkeer van Strava na toestemming: tokens
                               opslaan en terug naar /app/ (Nexa)
   POST { action: "start" }    -> { url } naar de toestemmingspagina van Strava
   POST { action: "status" }   -> { connected, athlete }
   POST { action: "sync" }     -> activiteiten van de laatste 14 dagen ophalen
   POST { action: "disconnect" } koppeling verbreken en postvak legen
   POST vereist het toegangstoken van de Supabase-sessie (Authorization: Bearer)
   en een Nexa Hybrid-abonnement (of gratis toegang). */
import { billingEnabled, userFromRequest } from "../lib/billing-core.mjs";
import { allowedOrigin, preflight, jsonFor } from "../lib/origin.mjs";
import {
  STRAVA_OAUTH,
  SCOPE,
  stravaEnabled,
  signState,
  verifyState,
  exchangeCode,
  saveIntegration,
  getIntegration,
  deleteIntegration,
  clearInbox,
  freshToken,
  stravaGet,
  deauthorize,
  importActivity,
  hybridAllowed,
  json as plainJson,
  redirect,
} from "../lib/strava-core.mjs";

const SYNC_DAYS = 14;

export default async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  const url = new URL(req.url);
  const origin0 = allowedOrigin(req);
  const json = req.method === "POST" ? jsonFor(origin0) : plainJson;
  const origin = url.origin;
  const back = (q) => redirect(`${origin}/app/?strava=${q}`);
  const callback = `${origin}/.netlify/functions/strava-auth`;

  if (req.method === "GET") {
    if (url.searchParams.has("error")) return back("geweigerd");
    const code = url.searchParams.get("code");
    if (!code) return json(200, { enabled: stravaEnabled() });
    if (!stravaEnabled()) return back("uit");
    const userId = verifyState(url.searchParams.get("state"));
    if (!userId) return back("fout");
    const scope = url.searchParams.get("scope") || "";
    if (!/activity:read/.test(scope)) return back("rechten");
    try {
      const t = await exchangeCode(code);
      const ath = t.athlete || {};
      await saveIntegration({
        user_id: userId,
        athlete_id: ath.id,
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: new Date(t.expires_at * 1000).toISOString(),
        scope,
        athlete_name: [ath.firstname, ath.lastname].filter(Boolean).join(" ") || null,
      });
      return back("gekoppeld");
    } catch (e) {
      console.error("strava-auth: koppelen mislukt", e && e.message);
      return back("fout");
    }
  }

  if (req.method !== "POST") return json(405, { ok: false });
  if (!origin0) return json(403, { ok: false, code: "herkomst", message: "Alleen de app zelf mag deze functie gebruiken." });
  if (!stravaEnabled()) return json(503, { ok: false, code: "uit", message: "De koppeling met Strava is nog niet ingeschakeld." });
  const user = await userFromRequest(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log eerst in met uw Nexa-account." });
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer" });
  }
  if (!(await hybridAllowed(user.id, billingEnabled()))) return json(402, { ok: false, code: "hybrid", message: "De koppeling met Strava hoort bij Nexa Coach." });

  try {
    if (body.action === "start") {
      const q = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, redirect_uri: callback, response_type: "code", approval_prompt: "auto", scope: SCOPE, state: signState(user.id) });
      return json(200, { ok: true, url: `${STRAVA_OAUTH}/authorize?${q}` });
    }
    const integ = await getIntegration(user.id);
    if (body.action === "status") return json(200, { ok: true, connected: !!integ, athlete: integ ? integ.athlete_name : null, since: integ ? integ.connected_at : null });
    if (!integ) return json(404, { ok: false, code: "niet_gekoppeld", message: "Strava is niet gekoppeld." });
    if (body.action === "disconnect") {
      await deauthorize(await freshToken(integ).catch(() => integ.access_token));
      await deleteIntegration(user.id);
      await clearInbox(user.id);
      return json(200, { ok: true });
    }
    if (body.action === "sync") {
      const token = await freshToken(integ);
      const after = Math.floor(Date.now() / 1000) - SYNC_DAYS * 86400;
      const list = await stravaGet(token, `/athlete/activities?after=${after}&per_page=30`);
      let n = 0;
      for (const a of list || []) {
        await importActivity({ ...integ, access_token: token, expires_at: new Date(Date.now() + 3600e3).toISOString() }, a.id);
        n++;
      }
      return json(200, { ok: true, count: n });
    }
    return json(400, { ok: false, code: "actie", message: "Onbekende actie." });
  } catch (e) {
    console.error("strava-auth:", body && body.action, e && e.message);
    if (e && e.code === "limiet") return json(429, { ok: false, code: "limiet", message: "Strava is even druk. Probeer het over een kwartier opnieuw." });
    return json(502, { ok: false, code: "strava", message: "Strava is even niet bereikbaar. Probeer het later opnieuw." });
  }
};
