process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_testgeheim";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
const R = new URL("../netlify/", import.meta.url).href;
const core = await import(R + "lib/billing-core.mjs");
const billing = (await import(R + "functions/billing.mjs")).default;
const etiket = (await import(R + "functions/etiket.mjs")).default;
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i ? "  " + i : "")); };
const db = new Map([["u1", { user_id: "u1", status: "active", stripe_customer_id: "cus_1" }]]);
let quota = 2, quotaCalls = 0, sbFail = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const h = init.headers || {};
  if (url.includes("/auth/v1/user")) return (h.Authorization || "").includes("goed") ? new Response(JSON.stringify({ id: "u1", email: "a@b.nl" })) : new Response("{}", { status: 401 });
  if (url.includes("/rpc/label_quota")) { quotaCalls++; if (sbFail) return new Response("x", { status: 500 }); return new Response(JSON.stringify(quota-- > 0 ? quota : -1)); }
  if (url.includes("/rest/v1/nexa_subscriptions")) { const m = url.match(/(user_id|stripe_customer_id)=eq\.([^&]+)/); return new Response(JSON.stringify([...db.values()].filter((r) => r[m[1]] === decodeURIComponent(m[2])))); }
  throw new Error("onverwacht " + url);
};
const s = core.stripe();
const now = Math.floor(Date.now() / 1000);
let subs = [], canceled = [], refunds = [];
s.subscriptions.list = async () => ({ data: subs });
s.subscriptions.cancel = async (id) => (canceled.push(id), { id });
s.invoices.list = async () => ({ data: [{ id: "in_1", amount_paid: 1499 }, { id: "in_0", amount_paid: 0 }] });
s.invoicePayments.list = async () => ({ data: [{ amount_paid: 1499, payment: { type: "payment_intent", payment_intent: "pi_1" } }] });
s.refunds.create = async (p) => (refunds.push(p), { id: "re_1" });
const req = (fn, body, auth = "Bearer goed") => new Request("https://nexa-performance.netlify.app/.netlify/functions/" + fn, { method: "POST", headers: { "content-type": "application/json", origin: "https://nexa-performance.netlify.app", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
const j = async (r) => ({ status: r.status, ...(await r.json()) });

// etiket
const IMG = { image: "iVBORw0KGgoAAAANSUhEUgAA", mediaType: "image/png" };
let r = await j(await etiket(req("etiket", IMG, null)));
ok("etiket zonder login: 401, quotum niet aangesproken", r.status === 401 && quotaCalls === 0, JSON.stringify(r));
r = await j(await etiket(req("etiket", IMG, "Bearer fout")));
ok("etiket met ongeldig token: 401", r.status === 401);
r = await j(await etiket(req("etiket", { image: "" })));
ok("etiket lege foto: 400 zonder quotum", r.status === 400 && quotaCalls === 0);
sbFail = true; r = await j(await etiket(req("etiket", IMG))); sbFail = false;
ok("etiket quotum onbereikbaar: 503 (dicht)", r.status === 503);
quota = 0; r = await j(await etiket(req("etiket", IMG)));
ok("etiket quotum op: 429", r.status === 429 && /30/.test(r.message), r.message);
const nr = await etiket(new Request("https://nexa-performance.netlify.app/.netlify/functions/etiket", { method: "POST", headers: { origin: "https://evil.example", authorization: "Bearer goed" }, body: "{}" }));
ok("etiket andere herkomst: 403", nr.status === 403);

// herroepen
subs = [{ id: "sub_1", status: "active", created: now - 3 * 86400 }];
r = await j(await billing(req("billing", { action: "withdraw" })));
ok("herroepen binnen 14 dagen: terugbetaald en gestopt", r.ok && r.refunded === 14.99 && canceled.includes("sub_1") && refunds[0].payment_intent === "pi_1", JSON.stringify(r));
canceled = []; refunds = [];
subs = [{ id: "sub_2", status: "active", created: now - 20 * 86400 }];
r = await j(await billing(req("billing", { action: "withdraw" })));
ok("herroepen na 14 dagen: geweigerd, niets gestopt", r.status === 409 && !canceled.length && !refunds.length, r.message);
subs = [{ id: "sub_3", status: "trialing", created: now - 86400 }, { id: "sub_4", status: "canceled", created: now }];
r = await j(await billing(req("billing", { action: "cancel_now" })));
ok("account verwijderen: lopend abonnement direct gestopt", r.ok && r.canceled === 1 && canceled.includes("sub_3") && !canceled.includes("sub_4"));
r = await j(await billing(req("billing", { action: "withdraw" }, "Bearer fout")));
ok("herroepen zonder geldige login: 401", r.status === 401);
const g = await (await billing(new Request("https://x/.netlify/functions/billing"))).json();
ok("GET noemt herroepingstermijn", g.withdrawDays === 14);

// webhook na verwijderd account
const realUpsert = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => { if (String(url).includes("nexa_subscriptions") && init.method === "POST") return new Response('{"code":"23503"}', { status: 409 }); if (String(url).includes("nexa_subscriptions")) return new Response("[]"); return realUpsert(url, init); };
const res = await core.syncSubscription({ id: "sub_9", status: "canceled", customer: "cus_9", metadata: { user_id: "weg" }, items: { data: [] } });
ok("webhook voor verwijderd account: geen fout (Stripe stopt met opnieuw proberen)", res === true);
console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd"); process.exit(fails ? 1 : 0);
