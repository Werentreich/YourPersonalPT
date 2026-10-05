/* Agenda-abonnement van Nexa Hybrid (Google Agenda, Apple Agenda, Outlook).

   POST { action: "link", v }  (ingelogd, Hybrid)  -> { url, webcal, google }
   GET  ?t=<link>                                 -> text/calendar met het schema

   De agenda-app haalt de link zelf periodiek op (Apple elk uur tot dagelijks,
   Google ongeveer elke 12–24 uur). Intrekken: in de app uitzetten; dan klopt
   het versienummer niet meer en geeft de link 404. */
import { billingEnabled, userFromRequest } from "../lib/billing-core.mjs";
import { hybridAllowed } from "../lib/strava-core.mjs";
import { allowedOrigin, preflight, jsonFor } from "../lib/origin.mjs";
import { calendarEnabled, signCalToken, verifyCalToken, hybridData } from "../lib/calendar-core.mjs";
import { buildICS, DEFAULT_TIME } from "../../src/hybrid/engine/ics.js";
import { calendarItems } from "../../src/hybrid/engine/calendar.js";

const SITE = "https://nexa-performance.netlify.app";
const todayAmsterdam = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date());

export default async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  const url = new URL(req.url);

  if (req.method === "GET") {
    const tok = verifyCalToken(url.searchParams.get("t"));
    if (!calendarEnabled() || !tok) return new Response("Niet gevonden", { status: 404 });
    try {
      if (!(await hybridAllowed(tok.userId, billingEnabled()))) return new Response("Niet gevonden", { status: 404 });
      const data = await hybridData(tok.userId);
      const cal = (data && data.calendar) || {};
      if (!cal.enabled || Number(cal.v || 1) !== tok.v) return new Response("Niet gevonden", { status: 404 });
      const ics = buildICS(calendarItems(data, todayAmsterdam()), { time: cal.time || DEFAULT_TIME, alarm: cal.alarm || null, url: `${SITE}/app/`, name: "Nexa training" });
      return new Response(ics, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "Content-Disposition": 'inline; filename="nexa-hybrid.ics"' } });
    } catch (e) {
      console.error("calendar:", e && e.message);
      return new Response("Even niet beschikbaar", { status: 503 });
    }
  }

  const origin = allowedOrigin(req);
  const json = jsonFor(origin);
  if (req.method !== "POST") return json(405, { ok: false });
  if (!origin) return json(403, { ok: false, code: "herkomst" });
  if (!calendarEnabled()) return json(503, { ok: false, code: "uit", message: "De agenda-koppeling is nog niet ingeschakeld." });
  const user = await userFromRequest(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log in met uw Nexa-account om uw agenda te koppelen." });
  if (!(await hybridAllowed(user.id, billingEnabled()))) return json(402, { ok: false, code: "abonnement", message: "De agenda-koppeling hoort bij Nexa Coach." });
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer" });
  }
  if (body.action !== "link") return json(400, { ok: false, code: "actie" });
  const t = signCalToken(user.id, body.v);
  const https = `${url.origin}/.netlify/functions/hybrid-calendar?t=${t}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return json(200, { ok: true, url: https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` });
};
