/* AI-coach van Nexa Hybrid (fase 5).

   GET  -> { ok: true } als de coach klaarstaat, anders { ok: false, code }
   POST -> body { mode: "week" | "vraag", context, question?, history? }
           week:  { ok: true, review: { kop, samenvatting, goed, aandacht, advies, volgendeWeek } }
           vraag: { ok: true, answer }
   Vereist: inloggen (Authorization: Bearer), Nexa Hybrid (of gratis
   toegang), en hoogstens 20 aanvragen per gebruiker per dag (coach_quota).

   De app stuurt alleen afgeleide cijfers (src/hybrid/engine/coach.js), geen
   notities, routes of trainingen uit Strava. De API-sleutel staat alleen
   hier (ANTHROPIC_API_KEY). */
import Anthropic from "@anthropic-ai/sdk";
import { bearer, billingEnabled, coachQuota, userFromRequest } from "../lib/billing-core.mjs";
import { hybridAllowed } from "../lib/strava-core.mjs";
import { allowedOrigin, preflight, jsonFor } from "../lib/origin.mjs";
import { MODEL, SYSTEM, REVIEW_SCHEMA, cleanInput, buildMessages } from "../lib/coach-core.mjs";


let client = null;
const anthropic = (key) => client || (client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 25_000 }));

export default async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  const origin = allowedOrigin(req);
  const json = jsonFor(origin);
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === "GET") return key ? json(200, { ok: true }) : json(503, { ok: false, code: "geen_sleutel" });
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  if (!origin) return json(403, { ok: false, code: "herkomst", message: "Alleen de app zelf mag deze functie gebruiken." });
  if (!key) return json(503, { ok: false, code: "geen_sleutel", message: "De coach is nog niet ingeschakeld." });

  const user = await userFromRequest(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log in met uw Nexa-account om de coach te gebruiken." });
  if (!(await hybridAllowed(user.id, billingEnabled()))) return json(402, { ok: false, code: "abonnement", message: "De coach hoort bij Nexa Coach." });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer", message: "Ongeldig verzoek." });
  }
  const input = cleanInput(body);
  if (input.error) return json(400, { ok: false, code: "invoer", message: input.error });

  let left;
  try {
    left = await coachQuota(bearer(req));
  } catch (e) {
    console.error("coach: quotum", e && e.message);
    return json(503, { ok: false, code: "quotum", message: "De coach is even niet beschikbaar. Probeer het later opnieuw." });
  }
  if (!(left >= 0)) return json(429, { ok: false, code: "quotum_op", message: "U heeft vandaag het maximum van 20 vragen aan de coach gesteld. Morgen kan het weer." });

  const week = input.mode === "week";
  /* Netlify breekt gewone functies standaard na 10 s af (te verhogen in de
     instellingen). Daarom standaard effort "low"; met een ruimere limiet kan
     COACH_EFFORT=medium voor een grondiger weekanalyse. */
  const effort = week && ["low", "medium", "high"].includes(process.env.COACH_EFFORT) ? process.env.COACH_EFFORT : "low";
  try {
    const response = await anthropic(key).beta.messages.create({
      model: MODEL,
      max_tokens: week ? 4000 : 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: week ? { effort, format: { type: "json_schema", schema: REVIEW_SCHEMA } } : { effort: "low" },
      system: SYSTEM,
      messages: buildMessages(input),
    });
    if (response.stop_reason === "refusal") return json(422, { ok: false, code: "geweigerd", message: "Daar kan de coach niet op ingaan." });
    if (response.stop_reason === "max_tokens") return json(502, { ok: false, code: "antwoord", message: "Het antwoord was onvolledig. Probeer het opnieuw." });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return json(502, { ok: false, code: "antwoord", message: "De coach gaf geen antwoord." });
    return week ? json(200, { ok: true, left, review: JSON.parse(text) }) : json(200, { ok: true, left, answer: text });
  } catch (e) {
    console.error("coach:", e && e.status, e && e.message);
    if (e instanceof Anthropic.AuthenticationError) return json(502, { ok: false, code: "sleutel_ongeldig", message: "De API-sleutel op de server wordt niet geaccepteerd." });
    if (e instanceof Anthropic.RateLimitError) return json(429, { ok: false, code: "rate_limited", message: "Het is even druk. Probeer het over een minuut opnieuw." });
    if (e instanceof Anthropic.APIConnectionTimeoutError) return json(504, { ok: false, code: "timeout", message: "De coach deed er te lang over. Probeer het opnieuw." });
    if (e instanceof Anthropic.APIError) return json(502, { ok: false, code: "api", message: `De coach gaf een fout (${e.status ?? "onbekend"}).` });
    if (e instanceof SyntaxError) return json(502, { ok: false, code: "antwoord", message: "Het antwoord kon niet worden gelezen." });
    return json(500, { ok: false, code: "onbekend", message: "Onbekende fout bij de coach." });
  }
};
