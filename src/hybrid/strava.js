/* Strava vanuit de app: koppelen, status en het postvak ophalen.
   Tokens staan alleen op de server; de app praat met de eigen functie
   (strava-auth) en leest het eigen postvak in Supabase (row level security). */
import { SB_URL, SB_KEY } from "../sync.js";

const FN = "/.netlify/functions/strava-auth";

async function token() {
  const s = typeof window !== "undefined" ? window.nexaSync : null;
  if (!s || !s.accessToken) return null;
  return s.accessToken().catch(() => null);
}

export async function stravaCall(action) {
  const t = await token();
  if (!t) throw Object.assign(new Error("Log eerst in met uw Nexa-account."), { code: "inloggen" });
  let r;
  try {
    r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action }) });
  } catch (e) {
    throw new Error("Geen verbinding. Controleer uw internet en probeer het opnieuw.");
  }
  const d = await r.json().catch(() => null);
  if (!d || d.ok === false) throw Object.assign(new Error((d && d.message) || "Strava is even niet bereikbaar."), { code: d && d.code, status: r.status });
  return d;
}

export async function stravaEnabled() {
  try {
    const r = await fetch(FN, { cache: "no-store" });
    const d = r.ok ? await r.json() : null;
    return !!(d && d.enabled);
  } catch (e) {
    return false;
  }
}

export async function connectStrava() {
  const d = await stravaCall("start");
  location.href = d.url;
}

/* Postvak lezen en daarna de gelezen rijen verwijderen. */
export async function pullInbox() {
  const t = await token();
  if (!t) return [];
  const h = { apikey: SB_KEY, Authorization: `Bearer ${t}` };
  const r = await fetch(`${SB_URL}/rest/v1/hybrid_inbox?select=id,external_id,deleted,activity,created_at&order=created_at.asc&limit=200`, { headers: h });
  if (!r.ok) return [];
  return r.json();
}

export async function clearInboxRows(ids) {
  if (!ids.length) return;
  const t = await token();
  if (!t) return;
  await fetch(`${SB_URL}/rest/v1/hybrid_inbox?id=in.(${ids.map(Number).join(",")})`, { method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${t}` } }).catch(() => null);
}
