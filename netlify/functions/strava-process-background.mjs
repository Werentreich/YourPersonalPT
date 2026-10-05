/* Verwerkt een Strava-gebeurtenis op de achtergrond (Netlify Background
   Function: tot 15 minuten, antwoordt direct met 202). Alleen aan te roepen
   door strava-webhook, met een HMAC-handtekening over de inhoud.

   - activiteit aangemaakt of gewijzigd: ophalen en in het postvak zetten
   - activiteit verwijderd: eerst bij Strava controleren dat hij echt weg is
   - toestemming ingetrokken: eerst controleren dat het token echt niet meer
     werkt, dan koppeling en postvak verwijderen */
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleEvent, stravaEnabled } from "../lib/strava-core.mjs";

export default async (req) => {
  if (req.method !== "POST" || !stravaEnabled()) return new Response(null, { status: 202 });
  const raw = await req.text();
  const sig = req.headers.get("x-nexa-signature") || "";
  const expect = createHmac("sha256", process.env.STRAVA_CLIENT_SECRET).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response(null, { status: 403 });
  try {
    const r = await handleEvent(JSON.parse(raw));
    console.log("strava-process:", r);
  } catch (e) {
    console.error("strava-process: mislukt", e && e.message);
  }
  return new Response(null, { status: 202 });
};
