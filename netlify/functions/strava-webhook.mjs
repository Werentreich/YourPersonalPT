/* Webhook van Strava (Nexa Hybrid). Eenmalig aanmelden door de beheerder:

   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
     -F callback_url=https://<site>/.netlify/functions/strava-webhook \
     -F verify_token=$STRAVA_VERIFY_TOKEN

   GET  bevestiging van de aanmelding (hub.challenge terugsturen)
   POST gebeurtenis: binnen 2 seconden 200 terug (eis van Strava); het echte
        werk doet strava-process-background. Strava ondertekent deze
        berichten niet; de verwerking controleert daarom alles bij Strava
        zelf voordat er iets wordt verwijderd. */
import { createHmac } from "node:crypto";
import { stravaEnabled, json } from "../lib/strava-core.mjs";

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && process.env.STRAVA_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === process.env.STRAVA_VERIFY_TOKEN;
    return ok ? json(200, { "hub.challenge": url.searchParams.get("hub.challenge") }) : json(403, { ok: false });
  }
  if (req.method !== "POST") return json(405, { ok: false });
  if (!stravaEnabled()) return json(200, { ok: true, skipped: true });
  const raw = await req.text();
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return json(400, { ok: false });
  }
  if (!ev || !ev.object_type || !ev.owner_id) return json(400, { ok: false });
  if (process.env.STRAVA_SUBSCRIPTION_ID && String(ev.subscription_id) !== String(process.env.STRAVA_SUBSCRIPTION_ID)) return json(200, { ok: true, skipped: true });
  const sig = createHmac("sha256", process.env.STRAVA_CLIENT_SECRET).update(raw).digest("hex");
  try {
    await fetch(`${url.origin}/.netlify/functions/strava-process-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-nexa-signature": sig }, body: raw });
  } catch (e) {
    console.error("strava-webhook: doorgeven mislukt", e && e.message);
  }
  return json(200, { ok: true });
};
