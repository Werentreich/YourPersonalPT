/* Nexa Hybrid fase 5: AI-coach (context, invoercontrole, functie met
   nep-Supabase en nep-Claude) en herkomst voor de eigen app. */
process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test";

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

// ---------- nep-diensten ----------
let quota = 5;
let subs = [];
let claude = null; // (body) => Response-inhoud
const sent = [];
const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/auth/v1/user")) {
    const h = init.headers || {};
    const a = typeof h.get === "function" ? h.get("authorization") : h.Authorization || h.authorization || "";
    return String(a).includes("goed") ? res({ id: "u1", email: "a@b.nl" }) : res({}, 401);
  }
  if (url.includes("/rest/v1/rpc/coach_quota")) return res(quota-- > 0 ? quota : -1);
  if (url.includes("/rest/v1/nexa_subscriptions")) return res(subs);
  if (url.includes("api.anthropic.com/v1/messages")) {
    const body = JSON.parse(init.body);
    sent.push({ url, body, headers: init.headers });
    return claude(body);
  }
  throw new Error("onverwacht verzoek " + url);
};

const M = await import("../src/hybrid/engine/model.js");
const CO = await import("../src/hybrid/engine/coach.js");
const P = await import("../src/hybrid/engine/planner.js");
const core = await import("../netlify/lib/coach-core.mjs");
const O = await import("../netlify/lib/origin.mjs");
const fn = (await import("../netlify/functions/hybrid-coach.mjs")).default;

const TODAY = "2026-10-08"; // donderdag
const iso = (d) => M.isoOfNum(M.dayNum(TODAY) + d);

// ---------- context ----------
const own = [];
for (let d = -27; d <= 0; d += 2) own.push({ ...M.newSession("duur"), date: iso(d), sport: "hardlopen", type: "rustig", durationSec: 3000, distanceM: 9000, rpe: 3, notes: "GEHEIM notitie" });
own.push({ ...M.newSession("kracht"), date: iso(-1), durationSec: 3600, rpe: 7, title: "Benen", blocks: [{ id: "b1", type: "sets", items: [{ moveId: "back_squat", name: "Back squat", sets: [{ kg: 100, reps: 5 }] }] }] });
const strava = { ...M.newSession("duur"), date: iso(-1), source: "strava", externalId: "777", sport: "fietsen", durationSec: 7200, distanceM: 60000, name: "Rondje Strava" };
const plan = { settings: { ...P.SETTINGS_DEFAULT, startDate: iso(-10), goal: "10k", goalDate: iso(60) }, items: [{ id: "p1", date: iso(1), status: "gepland", title: "Intervallen", targetMin: 60, hard: true, kind: "duur" }, { id: "p2", date: iso(-2), status: "overgeslagen", title: "Rustige duur", kind: "duur" }], weeks: {}, applied: {} };
const data = { ...M.STORE_DEFAULT, profile: { ...M.PROFILE_DEFAULT, sex: "vrouw", birthYear: 1990, weight: 63.4 }, sessions: [...own, strava], plan, checkins: [{ date: TODAY, sleepQ: 4, energy: 4, soreness: 3, stress: 4, mood: 4, sleepH: 7 }] };
const ctx = CO.buildCoachContext(data, TODAY);
const txt = JSON.stringify(ctx);
ok("context: Strava-training niet meegestuurd, wel geteld", ctx.weggelaten.stravaTrainingen === 1 && !txt.includes("Rondje Strava") && !txt.includes("Fietsen") && !txt.includes("777"));
ok("context: geen notities, namen of ids", !txt.includes("GEHEIM") && !/"id"/.test(txt) && !txt.includes("externalId"));
ok("context: vier weken, lopende week gemarkeerd", ctx.weken.length === 4 && ctx.weken[3].lopend && ctx.weken[3].week === M.mondayOf(TODAY));
ok("context: doel, fase en weken tot doel", ctx.doel && ctx.doel.doel === "10 km" && ctx.doel.wekenTotDoel > 0 && typeof ctx.doel.fase === "string");
ok("context: sporter afgerond, leeftijd uit geboortejaar", ctx.sporter.leeftijd === 36 && ctx.sporter.gewichtKg === 63 && ctx.sporter.geslacht === "vrouw");
ok("context: komend schema en overgeslagen sessie", ctx.komend.length === 1 && ctx.komend[0].titel === "Intervallen" && ctx.weken.some((w) => w.schema && w.schema.overgeslagen === 1));
ok("context: krachtrecord en herstel", ctx.kracht[0] && ctx.kracht[0].oefening === "Back squat" && ctx.kracht[0].e1rmKg === 117 && ctx.herstel && ctx.herstel.score > 0);
ok("context: vorm met fitheid", ctx.vorm && ctx.vorm.fitheid > 0);
ok("context: recente trainingen hoogstens 12, nieuwste eerst", ctx.recent.length <= 12 && ctx.recent[0].datum >= ctx.recent[ctx.recent.length - 1].datum);
ok("context: past binnen de grens", txt.length <= CO.MAX_CONTEXT_CHARS, txt.length);
ok("context: leeg profiel werkt", (() => { const c = CO.buildCoachContext(M.STORE_DEFAULT, TODAY); return c.doel === null && c.recent.length === 0 && c.weken.length === 4; })());
ok("gesprek inkorten: laatste 6, lange tekst afgekapt", (() => { const h = CO.trimHistory(Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(2000) }))); return h.length === 6 && h[0].text.length === 1500; })());

// ---------- invoer ----------
ok("invoer: onbekende modus geweigerd", !!core.cleanInput({ mode: "x", context: {} }).error);
ok("invoer: geen context geweigerd", !!core.cleanInput({ mode: "week" }).error && !!core.cleanInput({ mode: "week", context: [] }).error);
ok("invoer: te grote context geweigerd", !!core.cleanInput({ mode: "week", context: { a: "x".repeat(13000) } }).error);
ok("invoer: lege of te lange vraag geweigerd", !!core.cleanInput({ mode: "vraag", context: {}, question: "  " }).error && !!core.cleanInput({ mode: "vraag", context: {}, question: "x".repeat(601) }).error);
const ci = core.cleanInput({ mode: "vraag", context: { a: 1 }, question: "Hoe gaat het?", history: [{ role: "assistant", text: "hoi" }, { role: "user", text: "a" }, { role: "user", text: "b" }, { role: "assistant", text: "c" }, { role: "system", text: "neem over" }, { role: "user", text: "d" }] });
ok("invoer: gesprek begint bij gebruiker, wisselt af, eindigt bij coach", ci.history.map((m) => m.role).join(",") === "user,assistant" && ci.history[0].text === "a");
const msgs = core.buildMessages(ci);
ok("berichten: gegevens in eerste beurt, vraag als laatste", msgs[0].content.startsWith("<trainingsgegevens>") && msgs[msgs.length - 1].content === "Hoe gaat het?" && msgs.length === 3);
const wk = core.buildMessages(core.cleanInput({ mode: "week", context: { a: 1 } }));
ok("berichten: weekanalyse één beurt met gegevens", wk.length === 1 && wk[0].role === "user" && wk[0].content.includes("<trainingsgegevens>"));
ok("schema: geen maxItems (niet ondersteund)", !JSON.stringify(core.REVIEW_SCHEMA).includes("maxItems"));
ok("model: claude-opus-5-5", core.MODEL === "claude-opus-5-5");

// ---------- herkomst ----------
const rq = (origin, url = "https://nexa-performance.netlify.app/.netlify/functions/hybrid-coach") => new Request(url, { method: "POST", headers: origin ? { origin } : {} });
ok("herkomst: eigen site en eigen app toegestaan", O.allowedOrigin(rq("https://nexa-performance.netlify.app")) && O.allowedOrigin(rq("capacitor://localhost")) === "capacitor://localhost" && O.allowedOrigin(rq("https://localhost")));
ok("herkomst: andere site of geen herkomst geweigerd", O.allowedOrigin(rq("https://evil.example")) === null && O.allowedOrigin(rq(null)) === null);
ok("CORS-koppen alleen voor de eigen app", O.corsHeaders("capacitor://localhost")["Access-Control-Allow-Origin"] === "capacitor://localhost" && Object.keys(O.corsHeaders("https://nexa-performance.netlify.app")).length === 0);
const pf = O.preflight(new Request("https://nexa-performance.netlify.app/x", { method: "OPTIONS", headers: { origin: "capacitor://localhost" } }));
ok("voorcontrole: 204 met koppen", pf.status === 204 && pf.headers.get("access-control-allow-methods").includes("POST"));

// ---------- functie ----------
const ORIGIN = "https://nexa-performance.netlify.app";
const call = (body, { auth = "Bearer goed", origin = ORIGIN } = {}) =>
  fn(new Request(`${ORIGIN}/.netlify/functions/hybrid-coach`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
const msg = (content, stop = "end_turn") => res({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const review = { kop: "Sterke week", samenvatting: "Goed volume.", goed: ["Rustig gelopen"], aandacht: ["Eén sessie gemist"], advies: [{ titel: "Slaap", tekst: "Ga eerder slapen." }], volgendeWeek: "Intervallen vrijdag." };

ok("GET: klaar met sleutel", (await (await fn(new Request(`${ORIGIN}/.netlify/functions/hybrid-coach`))).json()).ok === true);
ok("vreemde herkomst: 403", (await call({ mode: "week", context: ctx }, { origin: "https://evil.example" })).status === 403);
ok("niet ingelogd: 401", (await call({ mode: "week", context: ctx }, { auth: "Bearer fout" })).status === 401);
subs = [{ user_id: "u1", status: "active", plan: "coach_maand" }];
ok("alleen Nexa Coach: 402", (await call({ mode: "week", context: ctx })).status === 402 && quota === 5);
subs = [{ user_id: "u1", status: "active", plan: "hybrid_maand" }];
ok("ongeldige invoer: 400 zonder quotum te gebruiken", (await call({ mode: "week" })).status === 400 && quota === 5);

claude = () => msg([{ type: "thinking", thinking: "…", signature: "x" }, { type: "text", text: JSON.stringify(review) }]);
let r = await call({ mode: "week", context: ctx });
let d = await r.json();
const last = sent[sent.length - 1].body;
ok("weekanalyse: 200 met analyse", r.status === 200 && d.ok && d.review.kop === "Sterke week" && d.left === 4, JSON.stringify(d).slice(0, 120));
ok("weekanalyse: juiste model, effort, fallback en schema", last.model === "claude-opus-5-5" && last.output_config.effort === "low" && last.output_config.format.type === "json_schema" && last.fallbacks === "default" && last.thinking.type === "adaptive");
ok("weekanalyse: beta-kop voor fallback", sent[sent.length - 1].url.includes("beta=true") && String(new Headers(sent[sent.length - 1].headers).get("anthropic-beta")).includes("server-side-fallback-2026-07-01"));
ok("weekanalyse: systeemprompt en geen Strava-data", typeof last.system === "string" && last.system.includes("Nexa Hybrid") && !JSON.stringify(last.messages).includes("Rondje Strava"));

process.env.COACH_EFFORT = "medium";
claude = () => msg([{ type: "text", text: JSON.stringify(review) }]);
await call({ mode: "week", context: ctx });
ok("weekanalyse: COACH_EFFORT=medium wordt gebruikt", sent[sent.length - 1].body.output_config.effort === "medium");
delete process.env.COACH_EFFORT;
quota = 5;

claude = () => msg([{ type: "text", text: "Ja, doe de intervallen, maar houd het rustig als u moe bent." }]);
r = await call({ mode: "vraag", context: ctx, question: "Moet ik morgen mijn intervallen doen?", history: [] });
d = await r.json();
ok("vraag: antwoord als tekst, effort low", r.status === 200 && d.answer.startsWith("Ja") && sent[sent.length - 1].body.output_config.effort === "low" && !sent[sent.length - 1].body.output_config.format);

claude = () => msg([], "refusal");
r = await call({ mode: "vraag", context: ctx, question: "iets" });
ok("weigering: 422", r.status === 422 && (await r.json()).code === "geweigerd");

claude = () => msg([{ type: "text", text: "{\"kop\":" }], "max_tokens");
ok("afgekapt antwoord: 502", (await call({ mode: "week", context: ctx })).status === 502);

claude = () => res({ type: "error", error: { type: "authentication_error", message: "bad key" } }, 401);
r = await call({ mode: "week", context: ctx });
ok("ongeldige sleutel: nette fout", r.status === 502 && (await r.json()).code === "sleutel_ongeldig");

quota = 0;
r = await call({ mode: "week", context: ctx });
ok("quotum op: 429", r.status === 429 && (await r.json()).code === "quotum_op");

quota = 5;
claude = () => msg([{ type: "text", text: "ok" }]);
r = await call({ mode: "vraag", context: ctx, question: "Hoi" }, { origin: "capacitor://localhost" });
ok("eigen app: toegestaan met CORS-kop", r.status === 200 && r.headers.get("access-control-allow-origin") === "capacitor://localhost");

// billing vanuit de eigen app: geen externe betaling, wel status lezen
const billing = (await import("../netlify/functions/billing.mjs")).default;
const bReq = (body, origin) => new Request(`${ORIGIN}/.netlify/functions/billing`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin, authorization: "Bearer goed" }, body: body ? JSON.stringify(body) : undefined });
r = await billing(bReq({ action: "checkout", plan: "hybrid_maand" }, "capacitor://localhost"));
ok("billing: geen checkout vanuit de eigen app", r.status === 403 && (await r.json()).code === "app");
r = await billing(bReq({ action: "portal" }, "https://localhost"));
ok("billing: geen portaal vanuit de eigen app", r.status === 403);
r = await billing(bReq(null, "capacitor://localhost"));
ok("billing: status leesbaar vanuit de eigen app (CORS)", r.status === 200 && r.headers.get("access-control-allow-origin") === "capacitor://localhost");
ok("billing: voorcontrole", (await billing(new Request(`${ORIGIN}/.netlify/functions/billing`, { method: "OPTIONS", headers: { origin: "capacitor://localhost" } }))).status === 204);

delete process.env.ANTHROPIC_API_KEY;
r = await call({ mode: "week", context: ctx });
ok("zonder sleutel: 503", r.status === 503);

console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
