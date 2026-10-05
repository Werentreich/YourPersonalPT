/* Gezin en coaching (fase 1): koppelen, rechten, overzicht en opdrachten.

   POST, met Authorization: Bearer <Supabase-token>, body { action, ... }:
   - list                        -> { links: [...], assignments: [...] }  (eigen koppelingen, openstaande opdrachten voor mij)
   - invite  { name }            -> { link }                               (coach maakt een uitnodigingscode)
   - peek    { code }            -> { coachName }                          (sporter bekijkt een uitnodiging)
   - accept  { code, name, scopes } -> { link }                            (sporter accepteert met gekozen rechten)
   - scopes  { linkId, scopes }  -> { link }                               (alleen de sporter)
   - stop    { linkId }          -> { ok }                                 (coach of sporter ontkoppelt)
   - view    { linkId }          -> { summary }                            (coach, binnen de rechten)
   - assign  { linkId, kind, payload } -> { ok }                           (coach, binnen de rechten)
   - applied { ids }             -> { ok }                                 (sporter: opdrachten toegepast)
   Alles met de service role; de tabellen zijn voor de app zelf dicht. */
import { userFromRequest, billingEnabled } from "../lib/billing-core.mjs";
import { coveringCoach } from "../lib/strava-core.mjs";
import { allowedOrigin, preflight, jsonFor } from "../lib/origin.mjs";
import { newCode, cleanCode, validCode, cleanName, cleanScopes, cleanSchema, cleanVoeding, clientSummary, linkView, MAX_CLIENTS } from "../lib/team-core.mjs";

const SB_URL = "https://lrtkedstyhfnwaxylyue.supabase.co";
const env = (k) => process.env[k] || "";

function adminHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const h = { apikey: key, "Content-Type": "application/json", ...extra };
  if (!key.startsWith("sb_secret_")) h.Authorization = `Bearer ${key}`;
  return h;
}
async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: adminHeaders(init.headers || {}) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const e = new Error(`Supabase ${init.method || "GET"} ${path.split("?")[0]}: ${r.status} ${t.slice(0, 200)}`);
    e.status = r.status;
    e.body = t;
    throw e;
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const enc = encodeURIComponent;
const one = async (path) => ((await sb(path)) || [])[0] || null;
const linkById = (id) => (/^[0-9a-f-]{36}$/i.test(id || "") ? one(`coach_links?id=eq.${enc(id)}&select=*`) : null);

export default async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  const origin = allowedOrigin(req);
  const json = jsonFor(origin);
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  if (!origin) return json(403, { ok: false, code: "herkomst", message: "Alleen de app zelf mag deze functie gebruiken." });
  if (!env("SUPABASE_SERVICE_ROLE_KEY")) return json(503, { ok: false, code: "uit", message: "Gezin en coaching is nog niet ingeschakeld." });

  const user = await userFromRequest(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log in met uw Nexa-account." });
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer", message: "Ongeldig verzoek." });
  }
  const me = user.id;
  const bad = (message, status = 400, code = "invoer") => json(status, { ok: false, code, message });

  try {
    switch (body && body.action) {
      case "list": {
        const now = new Date().toISOString();
        const links = (await sb(`coach_links?or=(coach_id.eq.${me},client_id.eq.${me})&select=*&order=created_at.asc`)) || [];
        const live = links.filter((l) => l.status === "actief" || (l.coach_id === me && l.expires_at > now));
        const assignments = (await sb(`coach_assignments?client_id=eq.${me}&applied_at=is.null&select=id,link_id,kind,payload,created_at&order=created_at.asc`)) || [];
        const names = Object.fromEntries(links.map((l) => [l.id, l.coach_name]));
        const coveredBy = billingEnabled() ? await coveringCoach(me).catch(() => null) : null;
        return json(200, { ok: true, coveredBy, links: live.map((l) => linkView(l, me)), assignments: assignments.filter((a) => names[a.link_id]).map((a) => ({ id: a.id, linkId: a.link_id, kind: a.kind, payload: a.payload, coachName: names[a.link_id], createdAt: a.created_at })) });
      }
      case "invite": {
        const name = cleanName(body.name);
        if (!name) return bad("Vul uw naam in; die ziet de ander bij de uitnodiging.");
        const mine = (await sb(`coach_links?coach_id=eq.${me}&select=id,status,expires_at`)) || [];
        const now = new Date().toISOString();
        if (mine.filter((l) => l.status === "actief" || l.expires_at > now).length >= MAX_CLIENTS) return bad(`U kunt hoogstens ${MAX_CLIENTS} mensen koppelen.`);
        // verlopen uitnodigingen opruimen
        await sb(`coach_links?coach_id=eq.${me}&status=eq.uitgenodigd&expires_at=lt.${enc(now)}`, { method: "DELETE" });
        for (let i = 0; i < 4; i++) {
          try {
            const rows = await sb(`coach_links`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ coach_id: me, coach_name: name, code: newCode() }) });
            return json(200, { ok: true, link: linkView(rows[0], me) });
          } catch (e) {
            if (e.status !== 409) throw e; // code bestond al: nog eens
          }
        }
        return bad("Uitnodigen lukte even niet. Probeer het opnieuw.", 503, "fout");
      }
      case "peek": {
        const code = cleanCode(body.code);
        if (!validCode(code)) return bad("Deze code klopt niet. Een code heeft 8 tekens.");
        const l = await one(`coach_links?code=eq.${code}&status=eq.uitgenodigd&select=*`);
        if (!l || l.expires_at < new Date().toISOString()) return bad("Deze uitnodiging bestaat niet (meer). Vraag om een nieuwe.", 404, "onbekend");
        if (l.coach_id === me) return bad("Dit is uw eigen uitnodiging. Stuur hem naar degene die u wilt coachen.", 400, "eigen");
        return json(200, { ok: true, coachName: l.coach_name });
      }
      case "accept": {
        const code = cleanCode(body.code);
        const name = cleanName(body.name);
        if (!validCode(code)) return bad("Deze code klopt niet.");
        if (!name) return bad("Vul uw naam in; die ziet uw coach.");
        const l = await one(`coach_links?code=eq.${code}&status=eq.uitgenodigd&select=*`);
        if (!l || l.expires_at < new Date().toISOString()) return bad("Deze uitnodiging bestaat niet (meer). Vraag om een nieuwe.", 404, "onbekend");
        if (l.coach_id === me) return bad("U kunt uzelf niet coachen.");
        const existing = await one(`coach_links?coach_id=eq.${l.coach_id}&client_id=eq.${me}&select=id`);
        if (existing) {
          await sb(`coach_links?id=eq.${l.id}`, { method: "DELETE" });
          return bad("U bent al gekoppeld aan deze coach.", 409, "al_gekoppeld");
        }
        const rows = await sb(`coach_links?id=eq.${l.id}&status=eq.uitgenodigd`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ client_id: me, client_name: name, status: "actief", code: null, scopes: cleanScopes(body.scopes), accepted_at: new Date().toISOString() }),
        });
        if (!rows || !rows[0]) return bad("Deze uitnodiging is net door iemand anders gebruikt.", 409, "bezet");
        return json(200, { ok: true, link: linkView(rows[0], me) });
      }
      case "scopes": {
        const l = await linkById(body.linkId);
        if (!l || l.client_id !== me) return bad("Koppeling niet gevonden.", 404, "onbekend");
        const rows = await sb(`coach_links?id=eq.${l.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ scopes: cleanScopes(body.scopes) }) });
        return json(200, { ok: true, link: linkView(rows[0], me) });
      }
      case "stop": {
        const l = await linkById(body.linkId);
        if (!l || (l.client_id !== me && l.coach_id !== me)) return bad("Koppeling niet gevonden.", 404, "onbekend");
        await sb(`coach_links?id=eq.${l.id}`, { method: "DELETE" }); // opdrachten gaan mee (cascade)
        return json(200, { ok: true });
      }
      case "view": {
        const l = await linkById(body.linkId);
        if (!l || l.coach_id !== me || l.status !== "actief") return bad("Koppeling niet gevonden.", 404, "onbekend");
        const scopes = cleanScopes(l.scopes);
        const rows = (await sb(`nexa_data?user_id=eq.${l.client_id}&key=in.(${enc('"macroverdeling:hybrid:v1"')},${enc('"macroverdeling:v1"')})&select=key,value`)) || [];
        const pending = (await sb(`coach_assignments?link_id=eq.${l.id}&applied_at=is.null&select=kind,created_at`)) || [];
        return json(200, { ok: true, link: linkView(l, me), summary: clientSummary(rows, scopes), pending });
      }
      case "assign": {
        const l = await linkById(body.linkId);
        if (!l || l.coach_id !== me || l.status !== "actief") return bad("Koppeling niet gevonden.", 404, "onbekend");
        const scopes = cleanScopes(l.scopes);
        const kind = body.kind;
        if (kind !== "schema" && kind !== "voeding") return bad("Onbekende opdracht.");
        if (!scopes[kind]) return bad(`${l.client_name || "De sporter"} heeft u daar (nog) geen toestemming voor gegeven.`, 403, "geen_recht");
        const c = kind === "schema" ? cleanSchema(body.payload) : cleanVoeding(body.payload);
        if (c.error) return bad(c.error);
        // een nieuwere opdracht van dezelfde soort vervangt een nog niet toegepaste
        await sb(`coach_assignments?link_id=eq.${l.id}&kind=eq.${kind}&applied_at=is.null`, { method: "DELETE" });
        await sb(`coach_assignments`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ link_id: l.id, client_id: l.client_id, kind, payload: c.payload }) });
        return json(200, { ok: true });
      }
      case "applied": {
        const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x) => Number.isInteger(x)).slice(0, 20);
        if (!ids.length) return json(200, { ok: true });
        await sb(`coach_assignments?client_id=eq.${me}&id=in.(${ids.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ applied_at: new Date().toISOString() }) });
        return json(200, { ok: true });
      }
      default:
        return bad("Onbekende actie.");
    }
  } catch (e) {
    console.error("team:", e && e.message);
    return json(503, { ok: false, code: "fout", message: "Dat lukte even niet. Probeer het zo opnieuw." });
  }
};
