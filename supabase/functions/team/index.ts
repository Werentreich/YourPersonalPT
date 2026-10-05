/* Gezin en coaching (fase 1): koppelen, rechten, overzicht en opdrachten.
   Supabase Edge Function: de geheime sleutel (service role) zet Supabase
   zelf klaar, dus er hoeft niets in Netlify te worden ingesteld.

   POST /functions/v1/team, met Authorization: Bearer <toegangstoken> en
   body { action, ... }:
   - list                           -> { links, assignments, coveredBy }
   - invite  { name }               -> { link }       (coach maakt een uitnodigingscode)
   - peek    { code }               -> { coachName }  (sporter bekijkt een uitnodiging)
   - accept  { code, name, scopes } -> { link }       (sporter accepteert met gekozen rechten)
   - scopes  { linkId, scopes }     -> { link }       (alleen de sporter)
   - stop    { linkId }             -> { ok }         (coach of sporter ontkoppelt)
   - view    { linkId }             -> { summary }    (coach, binnen de rechten)
   - assign  { linkId, kind, payload } -> { ok }      (coach, binnen de rechten)
   - applied { ids }                -> { ok }         (sporter: opdrachten toegepast)
   - messages { linkId }            -> { messages }   (berichten van een koppeling; markeert gelezen)
   - send    { linkId, text, ref? } -> { message }    (coach of sporter; ref: de training waar het bij hoort)
   list geeft ook: unread { linkId: aantal } en feed (gedane trainingen van
   sporters die hun voortgang delen, afgelopen 7 dagen).
   De tabellen coach_links en coach_assignments zijn dicht voor de app. */
import { newCode, cleanCode, validCode, cleanName, cleanScopes, cleanSchema, cleanVoeding, clientSummary, linkView, cleanMessage, activityFeed, cleanRef, MAX_CLIENTS } from "./core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ACTIVE = new Set(["trialing", "active", "past_due", "comp"]);
const NATIVE = new Set(["capacitor://localhost", "https://localhost", "ionic://localhost"]);
const SITE = /^https:\/\/([a-z0-9-]+--)?nexa-performance\.netlify\.app$/;

function cors(origin: string | null): Record<string, string> {
  if (!origin || !(NATIVE.has(origin) || SITE.test(origin))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function adminHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: SERVICE, "Content-Type": "application/json", ...extra };
  if (!SERVICE.startsWith("sb_secret_")) h.Authorization = `Bearer ${SERVICE}`;
  return h;
}

class SbError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

async function sb(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: adminHeaders(init.headers || {}) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new SbError(`Supabase ${init.method || "GET"} ${path.split("?")[0]}: ${r.status} ${t.slice(0, 200)}`, r.status);
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const enc = encodeURIComponent;
const one = async (path: string) => ((await sb(path)) || [])[0] || null;
const linkById = (id: unknown) => (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? one(`coach_links?id=eq.${enc(id)}&select=*`) : null);

async function userOf(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: h } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id as string } : null;
}

/* Valt deze sporter onder het abonnement van een gekoppelde coach? */
async function coveringCoach(userId: string) {
  const links = (await sb(`coach_links?client_id=eq.${userId}&status=eq.actief&select=coach_id,coach_name`)) || [];
  for (const l of links) {
    const sub = await one(`nexa_subscriptions?user_id=eq.${l.coach_id}&select=status`).catch(() => null);
    if (sub && ACTIVE.has(sub.status)) return l.coach_name as string;
  }
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: Object.keys(cors(origin)).length ? 204 : 403, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  if (!Object.keys(cors(origin)).length) return json(403, { ok: false, code: "herkomst", message: "Alleen de app zelf mag deze functie gebruiken." });

  const user = await userOf(req).catch(() => null);
  if (!user) return json(401, { ok: false, code: "inloggen", message: "Log in met uw Nexa-account." });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "invoer", message: "Ongeldig verzoek." });
  }
  const me = user.id;
  const bad = (message: string, status = 400, code = "invoer") => json(status, { ok: false, code, message });

  try {
    switch (body && body.action) {
      case "list": {
        const now = new Date().toISOString();
        const links = (await sb(`coach_links?or=(coach_id.eq.${me},client_id.eq.${me})&select=*&order=created_at.asc`)) || [];
        const live = links.filter((l: any) => l.status === "actief" || (l.coach_id === me && l.expires_at > now));
        const assignments = (await sb(`coach_assignments?client_id=eq.${me}&applied_at=is.null&select=id,link_id,kind,payload,created_at&order=created_at.asc`)) || [];
        const names = Object.fromEntries(links.map((l: any) => [l.id, l.coach_name]));
        const coveredBy = await coveringCoach(me).catch(() => null);
        const active = links.filter((l: any) => l.status === "actief");
        let unread: Record<string, number> = {};
        if (active.length) {
          const msgs = (await sb(`coach_messages?link_id=in.(${active.map((l: any) => l.id).join(",")})&read_at=is.null&select=link_id,author`)) || [];
          for (const m of msgs) {
            const l = active.find((x: any) => x.id === m.link_id);
            const mine = (l.coach_id === me && m.author === "coach") || (l.client_id === me && m.author === "sporter");
            if (!mine) unread[m.link_id] = (unread[m.link_id] || 0) + 1;
          }
        }
        const coached = active.filter((l: any) => l.coach_id === me && cleanScopes(l.scopes).voortgang);
        const feed = coached.length
          ? activityFeed((await sb(`nexa_data?user_id=in.(${coached.map((l: any) => l.client_id).join(",")})&key=eq.${enc('macroverdeling:hybrid:v1')}&select=user_id,value`)) || [], coached)
          : [];
        return json(200, {
          ok: true,
          coveredBy,
          unread,
          feed,
          links: live.map((l: any) => linkView(l, me)),
          assignments: assignments.filter((a: any) => names[a.link_id]).map((a: any) => ({ id: a.id, linkId: a.link_id, kind: a.kind, payload: a.payload, coachName: names[a.link_id], createdAt: a.created_at })),
        });
      }
      case "invite": {
        // alleen een coach nodigt uit: wie zelf gecoacht wordt, kan niemand uitnodigen
        const asClient = await one(`coach_links?client_id=eq.${me}&status=eq.actief&select=id`);
        if (asClient) return bad("Uitnodigen kan alleen een coach. U bent gekoppeld als sporter.", 403, "geen_coach");
        const name = cleanName(body.name);
        if (!name) return bad("Vul uw naam in; die ziet de ander bij de uitnodiging.");
        const now = new Date().toISOString();
        await sb(`coach_links?coach_id=eq.${me}&status=eq.uitgenodigd&expires_at=lt.${enc(now)}`, { method: "DELETE" }); // verlopen uitnodigingen weg
        const mine = (await sb(`coach_links?coach_id=eq.${me}&select=id`)) || [];
        if (mine.length >= MAX_CLIENTS) return bad(`U kunt hoogstens ${MAX_CLIENTS} mensen koppelen.`);
        for (let i = 0; i < 4; i++) {
          try {
            const rows = await sb(`coach_links`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ coach_id: me, coach_name: name, code: newCode() }) });
            return json(200, { ok: true, link: linkView(rows[0], me) });
          } catch (e) {
            if (!(e instanceof SbError) || e.status !== 409) throw e; // code bestond al: nog eens
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
        // een coach wordt niet zelf gecoacht (anders zou de sporter weer kunnen uitnodigen)
        const asCoach = await one(`coach_links?coach_id=eq.${me}&status=eq.actief&select=id`);
        if (asCoach) return bad("U bent zelf coach in Nexa en kunt daarom niet gekoppeld worden als sporter.", 403, "is_coach");
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
        const rows = (await sb(`nexa_data?user_id=eq.${l.client_id}&key=in.(${enc('"macroverdeling:hybrid:v1"')},${enc('"macroverdeling:v1"')})&select=key,value`)) || [];
        const pending = (await sb(`coach_assignments?link_id=eq.${l.id}&applied_at=is.null&select=kind,created_at`)) || [];
        return json(200, { ok: true, link: linkView(l, me), summary: clientSummary(rows, cleanScopes(l.scopes)), pending });
      }
      case "assign": {
        const l = await linkById(body.linkId);
        if (!l || l.coach_id !== me || l.status !== "actief") return bad("Koppeling niet gevonden.", 404, "onbekend");
        const scopes = cleanScopes(l.scopes) as Record<string, boolean>;
        const kind = body.kind;
        if (kind !== "schema" && kind !== "voeding") return bad("Onbekende opdracht.");
        if (!scopes[kind]) return bad(`${l.client_name || "De sporter"} heeft u daar (nog) geen toestemming voor gegeven.`, 403, "geen_recht");
        const c: any = kind === "schema" ? cleanSchema(body.payload) : cleanVoeding(body.payload);
        if (c.error) return bad(c.error);
        // een nieuwere opdracht van dezelfde soort vervangt een nog niet toegepaste
        await sb(`coach_assignments?link_id=eq.${l.id}&kind=eq.${kind}&applied_at=is.null`, { method: "DELETE" });
        await sb(`coach_assignments`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ link_id: l.id, client_id: l.client_id, kind, payload: c.payload }) });
        return json(200, { ok: true });
      }
      case "applied": {
        const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x: unknown) => Number.isInteger(x)).slice(0, 20);
        if (!ids.length) return json(200, { ok: true });
        await sb(`coach_assignments?client_id=eq.${me}&id=in.(${ids.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ applied_at: new Date().toISOString() }) });
        return json(200, { ok: true });
      }
      case "messages": {
        const l = await linkById(body.linkId);
        if (!l || l.status !== "actief" || (l.client_id !== me && l.coach_id !== me)) return bad("Koppeling niet gevonden.", 404, "onbekend");
        const other = l.coach_id === me ? "sporter" : "coach";
        const msgs = (await sb(`coach_messages?link_id=eq.${l.id}&select=id,author,body,ref,created_at,read_at&order=created_at.desc&limit=100`)) || [];
        await sb(`coach_messages?link_id=eq.${l.id}&author=eq.${other}&read_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
        return json(200, { ok: true, me: other === "sporter" ? "coach" : "sporter", messages: msgs.reverse() });
      }
      case "send": {
        const l = await linkById(body.linkId);
        if (!l || l.status !== "actief" || (l.client_id !== me && l.coach_id !== me)) return bad("Koppeling niet gevonden.", 404, "onbekend");
        const text = cleanMessage(body.text);
        if (!text) return bad("Schrijf eerst een bericht.");
        const recent = (await sb(`coach_messages?link_id=eq.${l.id}&created_at=gt.${enc(new Date(Date.now() - 3600_000).toISOString())}&select=id`)) || [];
        if (recent.length >= 60) return bad("Even rustig aan: te veel berichten in het afgelopen uur.", 429, "te_veel");
        const rows = await sb(`coach_messages`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ link_id: l.id, author: l.coach_id === me ? "coach" : "sporter", body: text, ref: cleanRef(body.ref) }) });
        return json(200, { ok: true, message: rows[0] });
      }
      default:
        return bad("Onbekende actie.");
    }
  } catch (e) {
    console.error("team:", e instanceof Error ? e.message : e);
    return json(503, { ok: false, code: "fout", message: "Dat lukte even niet. Probeer het zo opnieuw." });
  }
});
