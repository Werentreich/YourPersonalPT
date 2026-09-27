/* Gedeelde code voor het abonnement (Nexa Coach): Stripe voor betalen,
   Supabase voor wie welk abonnement heeft. Staat bewust buiten
   netlify/functions, zodat Netlify er geen eigen functie van maakt.

   Omgevingsvariabelen (Netlify, Site configuration > Environment variables,
   alle drie geheim en alleen voor Functions):
   - STRIPE_SECRET_KEY          geheime sleutel van Stripe (sk_live_... of sk_test_...)
   - STRIPE_WEBHOOK_SECRET      ondertekeningsgeheim van de webhook (whsec_...)
   - SUPABASE_SERVICE_ROLE_KEY  geheime sleutel van Supabase (sb_secret_... of service_role)
   Optioneel:
   - STRIPE_PRICE_MAAND / STRIPE_PRICE_JAAR  eigen prijs-ID's; anders maakt de
     functie de prijzen zelf aan (lookup keys hieronder)
   - NEXA_BILLING=uit           betaalmuur tijdelijk uitzetten

   Zolang de drie verplichte variabelen ontbreken, staat de betaalmuur uit en
   werkt de app zoals voorheen. */
import Stripe from "stripe";

export const SB_URL = "https://lrtkedstyhfnwaxylyue.supabase.co";
export const SB_PUBLISHABLE = "sb_publishable_QixrjzoNV-Kd1ng-BkmCyg_oIl11AJ8";
export const TABLE = "nexa_subscriptions";
export const TRIAL_DAYS = 7;
export const PRODUCT_NAME = "Nexa Coach";

export const PLANS = {
  maand: { lookup: "nexa_coach_maand", amount: 1499, interval: "month", label: "Nexa Coach, per maand", env: "STRIPE_PRICE_MAAND" },
  jaar: { lookup: "nexa_coach_jaar", amount: 9999, interval: "year", label: "Nexa Coach, per jaar", env: "STRIPE_PRICE_JAAR" },
};

/* Statussen die toegang geven. past_due: de betaling is mislukt en Stripe
   probeert het nog; de gebruiker houdt toegang tot Stripe opgeeft. */
export const ACTIVE = new Set(["trialing", "active", "past_due", "comp"]);
export const entitled = (row) => !!row && ACTIVE.has(row.status);

const env = (k) => (typeof process !== "undefined" && process.env ? process.env[k] : undefined) || "";

export function billingEnabled() {
  if (env("NEXA_BILLING") === "uit") return false;
  return !!(env("STRIPE_SECRET_KEY") && env("STRIPE_WEBHOOK_SECRET") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

let stripeClient = null;
export function stripe() {
  if (!stripeClient) stripeClient = new Stripe(env("STRIPE_SECRET_KEY"), { maxNetworkRetries: 1, timeout: 20000 });
  return stripeClient;
}

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/* Alleen de eigen site mag betaalsessies starten. */
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/* Wie is dit? De app stuurt het toegangstoken van de Supabase-sessie mee;
   Supabase zelf controleert het. */
export async function userFromRequest(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUBLISHABLE, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email || null } : null;
}

/* Supabase met de geheime sleutel (omzeilt row level security). Een nieuwe
   geheime sleutel (sb_secret_...) gaat alleen mee als apikey; een oude
   service_role-sleutel (JWT) ook als Authorization. */
function adminHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const h = { apikey: key, "Content-Type": "application/json", ...extra };
  if (!key.startsWith("sb_secret_")) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function getSub(userId) {
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: adminHeaders() });
  if (!r.ok) throw new Error(`Supabase lezen: ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function subByCustomer(customerId) {
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`, { headers: adminHeaders() });
  if (!r.ok) throw new Error(`Supabase lezen: ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function upsertSub(row) {
  const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=user_id`, {
    method: "POST",
    headers: adminHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase schrijven: ${r.status} ${await r.text()}`);
}

/* Prijs-ID voor een plan: uit de omgeving, of via de lookup key; bestaat die
   nog niet, dan maakt de functie product en prijs zelf aan (incl. btw). */
export async function priceFor(planId) {
  const p = PLANS[planId];
  if (!p) throw new Error("onbekend plan");
  if (env(p.env)) return env(p.env);
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [p.lookup], active: true, limit: 1 });
  if (found.data.length) return found.data[0].id;
  const products = await s.products.list({ active: true, limit: 100 });
  let product = products.data.find((x) => x.metadata && x.metadata.nexa === "coach");
  if (!product) product = await s.products.create({ name: PRODUCT_NAME, metadata: { nexa: "coach" } });
  const price = await s.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: p.amount,
    recurring: { interval: p.interval },
    tax_behavior: "inclusive",
    lookup_key: p.lookup,
    nickname: p.label,
  });
  return price.id;
}

/* Stripe-abonnement naar een rij in Supabase. In nieuwere API-versies staat
   de periode per abonnementsregel; oudere hebben hem op het abonnement. */
export function rowFromSubscription(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const interval = item && item.price && item.price.recurring ? item.price.recurring.interval : null;
  const periodEnd = (item && item.current_period_end) || sub.current_period_end || null;
  const ts = (x) => (x ? new Date(x * 1000).toISOString() : null);
  return {
    status: sub.status,
    plan: interval === "year" ? "jaar" : interval === "month" ? "maand" : null,
    trial_end: ts(sub.trial_end),
    current_period_end: ts(periodEnd),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id,
    stripe_subscription_id: sub.id,
  };
}

/* Een Stripe-abonnement in Supabase zetten. Gratis toegang (comp) blijft
   staan, en een ouder, beëindigd abonnement overschrijft nooit een nieuwer
   lopend abonnement. */
export async function syncSubscription(sub, hintUserId = null) {
  const row = rowFromSubscription(sub);
  let userId = (sub.metadata && sub.metadata.user_id) || hintUserId;
  if (!userId && row.stripe_customer_id) {
    const found = await subByCustomer(row.stripe_customer_id);
    userId = found && found.user_id;
  }
  if (!userId) {
    console.error("stripe-webhook: geen gebruiker bij abonnement", sub.id);
    return false;
  }
  const cur = await getSub(userId);
  // gratis toegang (comp) blijft staan; alleen de Stripe-gegevens worden bijgewerkt
  if (cur && cur.status === "comp") {
    await upsertSub({ user_id: userId, stripe_customer_id: row.stripe_customer_id, stripe_subscription_id: row.stripe_subscription_id });
    return true;
  }
  // een ouder, al beëindigd abonnement mag een nieuwer lopend abonnement niet overschrijven
  if (cur && cur.stripe_subscription_id && cur.stripe_subscription_id !== sub.id && ["trialing", "active", "past_due"].includes(cur.status) && !["trialing", "active", "past_due"].includes(row.status)) {
    return true;
  }
  await upsertSub({ user_id: userId, ...row });
  return true;
}
