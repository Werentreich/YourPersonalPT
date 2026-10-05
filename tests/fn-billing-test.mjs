process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_testgeheim";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
const R = new URL("../netlify/", import.meta.url).href;
const core = await import(R + "lib/billing-core.mjs");
const billing = (await import(R + "functions/billing.mjs")).default;
const webhook = (await import(R + "functions/stripe-webhook.mjs")).default;
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i ? "  " + i : "")); };

// nep-Supabase: één tabel in het geheugen
const db = new Map();
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const h = init.headers || {};
  calls.push({ url, method: init.method || "GET", apikey: h.apikey, auth: h.Authorization });
  if (url.includes("/auth/v1/user")) {
    return (h.Authorization || "").includes("goed") ? new Response(JSON.stringify({ id: "u1", email: "a@b.nl" })) : new Response("{}", { status: 401 });
  }
  if (url.includes("/rest/v1/nexa_subscriptions")) {
    if ((init.method || "GET") === "GET") {
      const m = url.match(/(user_id|stripe_customer_id)=eq\.([^&]+)/);
      const rows = [...db.values()].filter((r) => r[m[1]] === decodeURIComponent(m[2]));
      return new Response(JSON.stringify(rows));
    }
    const row = JSON.parse(init.body);
    db.set(row.user_id, { ...(db.get(row.user_id) || {}), ...row });
    return new Response("", { status: 201 });
  }
  throw new Error("onverwacht verzoek " + url);
};

// nep-Stripe: methoden op de gedeelde client vervangen
const s = core.stripe();
const made = [];
s.customers.create = async (p) => (made.push(["customer", p]), { id: "cus_1" });
s.prices.list = async (p) => ({ data: p.lookup_keys[0] === "nexa_coach_jaar" ? [{ id: "price_jaar" }] : [] });
s.products.list = async () => ({ data: [] });
s.products.create = async (p) => (made.push(["product", p]), { id: "prod_1" });
s.prices.create = async (p) => (made.push(["price", p]), { id: "price_maand" });
s.checkout.sessions.create = async (p) => (made.push(["checkout", p]), { url: "https://checkout.stripe.com/x" });
s.billingPortal.sessions.create = async (p) => (made.push(["portal", p]), { url: "https://billing.stripe.com/p" });

const req = (method, body, headers = {}) =>
  new Request("https://nexa-performance.netlify.app/.netlify/functions/billing", {
    method,
    headers: { "content-type": "application/json", origin: "https://nexa-performance.netlify.app", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

let r = await billing(req("GET"));
let d = await r.json();
ok("GET: aan met alle sleutels", d.enabled === true && d.prices.jaar === 99.99 && d.trialDays === 7);
process.env.NEXA_BILLING = "uit";
ok("GET: uit met NEXA_BILLING=uit", (await (await billing(req("GET"))).json()).enabled === false);
delete process.env.NEXA_BILLING;

r = await billing(req("POST", { action: "checkout", plan: "jaar" }, { origin: "https://evil.example" }));
ok("andere herkomst geweigerd", r.status === 403);
r = await billing(req("POST", { action: "checkout", plan: "jaar" }));
ok("zonder token: 401", r.status === 401);
r = await billing(req("POST", { action: "checkout", plan: "jaar" }, { authorization: "Bearer fout" }));
ok("ongeldig token: 401", r.status === 401);

r = await billing(req("POST", { action: "checkout", plan: "jaar" }, { authorization: "Bearer goed" }));
d = await r.json();
const co = made.find((m) => m[0] === "checkout")[1];
ok("checkout jaar: url terug", d.ok && d.url.includes("checkout.stripe.com"));
ok("klant aangemaakt met user_id", made.some((m) => m[0] === "customer" && m[1].metadata.user_id === "u1") && db.get("u1").stripe_customer_id === "cus_1");
ok("checkout: abonnement, prijs jaar, 7 dagen proef, kaart verplicht", co.mode === "subscription" && co.line_items[0].price === "price_jaar" && co.subscription_data.trial_period_days === 7 && co.payment_method_collection === "always" && co.client_reference_id === "u1");
ok("checkout: terug naar /app/", co.success_url === "https://nexa-performance.netlify.app/app/?abonnement=gelukt" && co.cancel_url.endsWith("/app/?abonnement=geannuleerd"));

made.length = 0;
db.set("u1", { ...db.get("u1"), status: "canceled", stripe_subscription_id: "sub_old", trial_end: "2026-01-01T00:00:00Z" });
r = await billing(req("POST", { action: "checkout", plan: "maand" }, { authorization: "Bearer goed" }));
const co2 = made.find((m) => m[0] === "checkout")[1];
const pr = made.find((m) => m[0] === "price");
ok("maandprijs zelf aangemaakt: €14,99 per maand incl. btw", pr && pr[1].unit_amount === 1499 && pr[1].recurring.interval === "month" && pr[1].currency === "eur" && pr[1].tax_behavior === "inclusive" && pr[1].lookup_key === "nexa_coach_maand");
ok("tweede keer: geen nieuwe proef, zelfde klant", !("trial_period_days" in co2.subscription_data) && co2.customer === "cus_1");

db.set("u1", { ...db.get("u1"), status: "active" });
made.length = 0;
r = await billing(req("POST", { action: "checkout", plan: "jaar" }, { authorization: "Bearer goed" }));
d = await r.json();
ok("al actief: naar beheer, geen dubbel abonnement", d.existing === true && made.every((m) => m[0] !== "checkout"));
r = await billing(req("POST", { action: "portal" }, { authorization: "Bearer goed" }));
d = await r.json();
ok("portaal", d.url.includes("billing.stripe.com") && made.some((m) => m[0] === "portal" && m[1].customer === "cus_1"));
db.set("u1", { ...db.get("u1"), status: "comp" });
r = await billing(req("POST", { action: "checkout", plan: "jaar" }, { authorization: "Bearer goed" }));
ok("gratis toegang: geen checkout", r.status === 409);

// sleutelvorm: nieuwe geheime sleutel alleen als apikey
const last = calls.filter((c) => c.url.includes("/rest/v1/")).pop();
ok("sb_secret_ alleen als apikey, niet als Authorization", last.apikey === "sb_secret_test" && !last.auth);

// webhook
const sub = (over = {}) => ({ id: "sub_new", object: "subscription", customer: "cus_1", status: "trialing", trial_end: 1790000000, cancel_at_period_end: false, metadata: { user_id: "u1" }, items: { data: [{ price: { recurring: { interval: "year" } }, current_period_end: 1790000000 }] }, ...over });
const whReq = (event, secret = process.env.STRIPE_WEBHOOK_SECRET) => {
  const payload = JSON.stringify(event);
  const header = s.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("https://x/.netlify/functions/stripe-webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload });
};
r = await webhook(whReq({ id: "evt1", type: "customer.subscription.created", data: { object: sub() } }, "whsec_verkeerd"));
ok("webhook met verkeerde handtekening geweigerd", r.status === 400);
db.set("u1", { user_id: "u1", status: "none", stripe_customer_id: "cus_1" });
r = await webhook(whReq({ id: "evt2", type: "customer.subscription.created", data: { object: sub() } }));
const row = db.get("u1");
ok("webhook: proef opgeslagen", r.status === 200 && row.status === "trialing" && row.plan === "jaar" && row.trial_end === new Date(1790000000 * 1000).toISOString() && row.stripe_subscription_id === "sub_new", JSON.stringify(row));
r = await webhook(whReq({ id: "evt3", type: "customer.subscription.updated", data: { object: sub({ status: "active", metadata: {}, cancel_at_period_end: true }) } }));
ok("webhook: gebruiker via klant-ID gevonden, actief + opgezegd", db.get("u1").status === "active" && db.get("u1").cancel_at_period_end === true);
r = await webhook(whReq({ id: "evt4", type: "customer.subscription.deleted", data: { object: sub({ id: "sub_oud", status: "canceled" }) } }));
ok("oud abonnement overschrijft lopend abonnement niet", db.get("u1").status === "active" && db.get("u1").stripe_subscription_id === "sub_new");
r = await webhook(whReq({ id: "evt5", type: "customer.subscription.deleted", data: { object: sub({ status: "canceled" }) } }));
ok("eigen abonnement beëindigd", db.get("u1").status === "canceled");
db.set("u1", { ...db.get("u1"), status: "comp" });
await webhook(whReq({ id: "evt6", type: "customer.subscription.updated", data: { object: sub({ status: "active" }) } }));
ok("gratis toegang blijft staan", db.get("u1").status === "comp");

// etiket: afgeschermd
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
const etiket = (await import(R + "functions/etiket.mjs")).default;
const eReq = (auth) => new Request("https://nexa-performance.netlify.app/.netlify/functions/etiket", { method: "POST", headers: { "content-type": "application/json", origin: "https://nexa-performance.netlify.app", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ image: "iVBORw0KGgo=", mediaType: "image/png" }) });
ok("etiket zonder account: 401", (await etiket(eReq())).status === 401);
db.set("u1", { ...db.get("u1"), status: "canceled" });
ok("etiket zonder abonnement: 402", (await etiket(eReq("Bearer goed"))).status === 402);

// ---------- Nexa Hybrid: tweede niveau, upgrade vanaf Coach ----------
const upd = [];
s.subscriptions.retrieve = async (id) => ({ id, status: db.get("u1").status, metadata: { user_id: "u1" }, items: { data: [{ id: "si_1", price: { recurring: { interval: "year" } } }] } });
s.subscriptions.update = async (id, p) => (upd.push(p), sub({ id, status: "active", metadata: p.metadata, items: { data: [{ price: { lookup_key: "nexa_hybrid_jaar", recurring: { interval: "year" } }, current_period_end: 1790000000 }] } }));
d = await (await billing(req("GET"))).json();
ok("GET: Hybrid-prijzen erbij, Coach ongewijzigd", d.prices.hybrid_jaar === 139.99 && d.prices.hybrid_maand === 19.99 && d.prices.jaar === 99.99 && d.prices.maand === 14.99);

db.set("u1", { user_id: "u1", status: "active", plan: "jaar", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_new" });
made.length = 0;
r = await billing(req("POST", { action: "checkout", plan: "hybrid_jaar", from: "hybrid" }, { authorization: "Bearer goed" }));
d = await r.json();
ok("upgrade Coach naar Hybrid: zelfde abonnement, nieuwe prijs, naar rato", d.upgraded === true && upd.length === 1 && upd[0].items[0].id === "si_1" && upd[0].proration_behavior === "always_invoice" && made.every((m) => m[0] !== "checkout"));
ok("upgrade: terug naar /hybrid/", d.url === "https://nexa-performance.netlify.app/hybrid/?abonnement=gelukt");
ok("upgrade: plan in Supabase is hybrid_jaar", db.get("u1").plan === "hybrid_jaar", JSON.stringify(db.get("u1")));
const hp = made.find((m) => m[0] === "product");
const hpr = made.find((m) => m[0] === "price");
ok("Hybrid-product en -prijs zelf aangemaakt", hp && hp[1].name === "Nexa Hybrid" && hp[1].metadata.nexa === "hybrid" && hpr && hpr[1].unit_amount === 13999 && hpr[1].metadata.nexa_tier === "hybrid" && hpr[1].lookup_key === "nexa_hybrid_jaar");

made.length = 0;
r = await billing(req("POST", { action: "checkout", plan: "hybrid_jaar", from: "hybrid" }, { authorization: "Bearer goed" }));
d = await r.json();
const hpo = made.find((m) => m[0] === "portal");
ok("al Hybrid: naar beheer, terug naar /hybrid/", d.existing === true && upd.length === 1 && hpo && hpo[1].return_url.endsWith("/hybrid/?abonnement=terug"));

db.set("u1", { user_id: "u1", status: "trialing", plan: "maand", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_new", trial_end: "2026-10-09T00:00:00Z" });
await billing(req("POST", { action: "checkout", plan: "hybrid_maand", from: "hybrid" }, { authorization: "Bearer goed" }));
ok("upgrade tijdens proef: proef loopt door, geen tussentijdse factuur", upd.length === 2 && upd[1].proration_behavior === "none");

db.set("u1", { user_id: "u1", status: "canceled", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_x", trial_end: "2026-01-01T00:00:00Z" });
made.length = 0;
await billing(req("POST", { action: "checkout", plan: "hybrid_maand", from: "hybrid" }, { authorization: "Bearer goed" }));
const hco = made.find((m) => m[0] === "checkout");
ok("nieuw Hybrid-abonnement via Checkout, terug naar /hybrid/", hco && hco[1].success_url.endsWith("/hybrid/?abonnement=gelukt") && hco[1].metadata.plan === "hybrid_maand");

const rs = (price) => core.rowFromSubscription(sub({ items: { data: [{ price, current_period_end: 1 }] } })).plan;
ok("niveau via lookup key", rs({ lookup_key: "nexa_hybrid_maand", recurring: { interval: "month" } }) === "hybrid_maand");
ok("niveau via metadata", rs({ metadata: { nexa_tier: "hybrid" }, recurring: { interval: "year" } }) === "hybrid_jaar");
process.env.STRIPE_PRICE_HYBRID_MAAND = "price_eigen";
ok("niveau via eigen prijs-ID", rs({ id: "price_eigen", recurring: { interval: "month" } }) === "hybrid_maand");
delete process.env.STRIPE_PRICE_HYBRID_MAAND;
ok("Coach blijft maand/jaar", rs({ lookup_key: "nexa_coach_jaar", recurring: { interval: "year" } }) === "jaar");
ok("geen from: terug naar /app/ (Nexa ongewijzigd)", co.success_url.includes("/app/"));

console.log(fails ? fails + " FOUT" : "Alle tests geslaagd");
