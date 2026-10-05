/* Wie mag de functies van Nexa Hybrid aanroepen?
   - de site zelf (zelfde host als de functie)
   - de eigen app (Capacitor): iOS laadt de app vanaf capacitor://localhost,
     Android vanaf https://localhost. Die verzoeken komen van een andere
     herkomst en hebben daarom CORS-koppen nodig.
   Dit is een eerste drempel; de echte beveiliging is de inlogcontrole, het
   abonnement en het quotum in de functies zelf. */
export const NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "ionic://localhost"]);

export function allowedOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (NATIVE_ORIGINS.has(origin)) return origin;
  try {
    return new URL(origin).host === new URL(req.url).host ? origin : null;
  } catch {
    return null;
  }
}

export function corsHeaders(origin) {
  if (!origin || !NATIVE_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/* Antwoord op een CORS-voorcontrole (OPTIONS). */
export function preflight(req) {
  const origin = allowedOrigin(req);
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
}

export const jsonFor = (origin) => (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) } });
