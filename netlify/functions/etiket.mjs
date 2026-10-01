/* Leest een foto van een voedingswaardetabel met Claude en geeft de waarden
   als JSON terug. De API-sleutel staat alleen hier op de server (Netlify:
   omgevingsvariabele ANTHROPIC_API_KEY) en komt nooit in de app zelf.

   GET  -> { ok: true } als de functie klaarstaat, anders { ok: false, code }
   POST -> body { image: <base64 zonder data:-voorvoegsel>, mediaType }
           antwoord { ok: true, result } of { ok: false, code, message } */
import Anthropic from "@anthropic-ai/sdk";
import { bearer, billingEnabled, entitled, getSub, labelQuota, userFromRequest } from "../lib/billing-core.mjs";

const MODEL = "claude-opus-5";
const MAX_BASE64 = 5_000_000; // ruim onder de 6 MB-grens van Netlify Functions
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const PROMPT = `Je krijgt een foto van de voedingswaardetabel op een verpakking. Lees de tabel en vul het schema.

Regels:
- Alle waarden in gram, behalve kcal.
- naam: merk en productnaam zoals op de verpakking, kort. Niet verzinnen; bij twijfel null.
- Vul per100 alleen met wat de tabel in de kolom per 100 g of per 100 ml geeft, anders null.
- Staat er alleen een portiekolom, vul dan perPortie en zet portieGram op het vermelde portiegewicht in gram, anders null.
- Vezels staan op etiketten als vezels, voedingsvezel of fibre. Ontbreken ze volledig, zet 0 en meld dat in opmerking.
- Neem nooit "waarvan suikers" of "waarvan verzadigde vetzuren" als hoofdwaarde voor koolhydraten of vet.
- Is de tabel deels onleesbaar, zet zekerheid op laag en beschrijf in opmerking wat ontbreekt.
- Staat er geen voedingswaardetabel op de foto, zet per100 en perPortie op null en leg dat uit in opmerking.`;

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const num = { type: "number" };

const values = nullable({
  type: "object",
  properties: {
    kcal: nullable(num),
    eiwit: num,
    koolhydraten: num,
    vet: num,
    vezels: nullable(num),
  },
  required: ["kcal", "eiwit", "koolhydraten", "vet", "vezels"],
  additionalProperties: false,
});

const SCHEMA = {
  type: "object",
  properties: {
    naam: nullable({ type: "string" }),
    basis: { type: "string", enum: ["100g", "portie", "beide", "onbekend"] },
    portieGram: nullable(num),
    per100: values,
    perPortie: values,
    zekerheid: { type: "string", enum: ["hoog", "gemiddeld", "laag"] },
    opmerking: nullable({ type: "string" }),
  },
  required: ["naam", "basis", "portieGram", "per100", "perPortie", "zekerheid", "opmerking"],
  additionalProperties: false,
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/* Eerste drempel: een browser stuurt bij een POST altijd een Origin mee, en
   die moet overeenkomen met het adres van de functie. Buiten een browser is
   die kop na te maken; de echte beveiliging is daarom de inlogcontrole en
   het dagquotum hieronder. */
function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export default async (req) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === "GET") {
    return key ? json(200, { ok: true }) : json(503, { ok: false, code: "geen_sleutel" });
  }
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  if (!sameOrigin(req)) return json(403, { ok: false, code: "herkomst", message: "Alleen de app zelf mag deze functie gebruiken." });
  if (!key) return json(503, { ok: false, code: "geen_sleutel", message: "Er is geen API-sleutel ingesteld op de server." });

  /* Elke analyse kost geld: altijd inloggen, met abonnementen aan alleen
     voor Nexa Coach, en hoogstens 30 scans per gebruiker per dag. */
  const user = await userFromRequest(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log in met uw Nexa-account om etiketten te scannen." });
  if (billingEnabled()) {
    const row = await getSub(user.id).catch(() => null);
    if (!entitled(row)) return json(402, { ok: false, code: "abonnement", message: "Etiketten scannen hoort bij Nexa Coach." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer", message: "Ongeldig verzoek." });
  }
  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = TYPES.has(body.mediaType) ? body.mediaType : "image/jpeg";
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return json(400, { ok: false, code: "invoer", message: "Geen foto ontvangen." });
  if (image.length > MAX_BASE64) return json(413, { ok: false, code: "te_groot", message: "De foto is te groot." });

  let left;
  try {
    left = await labelQuota(bearer(req));
  } catch (e) {
    console.error("etiket: quotum", e && e.message);
    return json(503, { ok: false, code: "quotum", message: "Scannen is even niet beschikbaar. Probeer het later opnieuw." });
  }
  if (!(left >= 0)) return json(429, { ok: false, code: "quotum_op", message: "U heeft vandaag het maximum van 30 etiketten gescand. Morgen kan het weer; tot die tijd kunt u de waarden zelf invullen." });

  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 45_000 });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return json(422, { ok: false, code: "geweigerd", message: "Deze foto kon niet worden verwerkt." });
    }
    if (response.stop_reason === "max_tokens") {
      return json(502, { ok: false, code: "antwoord", message: "Het antwoord was onvolledig." });
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return json(200, { ok: true, result: JSON.parse(text) });
  } catch (e) {
    console.error("etiket:", e && e.status, e && e.message);
    if (e instanceof Anthropic.AuthenticationError) {
      return json(502, { ok: false, code: "sleutel_ongeldig", message: "De API-sleutel op de server wordt niet geaccepteerd." });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return json(429, { ok: false, code: "rate_limited", message: "Te veel aanvragen achter elkaar." });
    }
    if (e instanceof Anthropic.APIError) {
      return json(502, { ok: false, code: "api", message: `Claude gaf een fout (${e.status ?? "onbekend"}).` });
    }
    if (e instanceof SyntaxError) {
      return json(502, { ok: false, code: "antwoord", message: "Het antwoord kon niet worden gelezen." });
    }
    return json(500, { ok: false, code: "onbekend", message: "Onbekende fout bij het lezen van het etiket." });
  }
};
