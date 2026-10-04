/* Agenda-abonnement van Nexa Hybrid: ondertekende, intrekbare links.

   Een link bevat geen geheim uit de database, alleen user-id en een
   versienummer, ondertekend met HMAC. Intrekken = het versienummer in de
   gegevens van de gebruiker verhogen; oude links werken dan niet meer.
   Geheim: CALENDAR_SECRET, of (zolang die ontbreekt) afgeleid van de
   service-role-sleutel. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SB_URL } from "./billing-core.mjs";

const env = (k) => (typeof process !== "undefined" && process.env ? process.env[k] : undefined) || "";
export const HYBRID_KEY = "macroverdeling:hybrid:v1";

function secret() {
  const own = env("CALENDAR_SECRET");
  if (own) return own;
  const sr = env("SUPABASE_SERVICE_ROLE_KEY");
  return sr ? createHmac("sha256", sr).update("nexa-calendar").digest("hex") : "";
}
export const calendarEnabled = () => !!secret();

export function signCalToken(userId, v) {
  const payload = Buffer.from(`${userId}.${Number(v) || 1}`).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifyCalToken(t) {
  if (typeof t !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/.test(t)) return null;
  const [payload, sig] = t.split(".");
  const expect = createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, v] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  if (!/^[0-9a-f-]{36}$/i.test(userId || "")) return null;
  return { userId, v: Number(v) || 1 };
}

/* Hybrid-gegevens van een gebruiker (service role). */
export async function hybridData(userId) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const h = { apikey: key };
  if (!key.startsWith("sb_secret_")) h.Authorization = `Bearer ${key}`;
  const r = await fetch(`${SB_URL}/rest/v1/nexa_data?user_id=eq.${encodeURIComponent(userId)}&key=eq.${encodeURIComponent(HYBRID_KEY)}&select=value`, { headers: h });
  if (!r.ok) throw new Error(`Supabase nexa_data: ${r.status}`);
  const rows = await r.json();
  const v = rows && rows[0] ? rows[0].value : null;
  if (v == null) return null;
  return typeof v === "string" ? JSON.parse(v) : v;
}
