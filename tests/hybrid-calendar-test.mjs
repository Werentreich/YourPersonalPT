/* Nexa Hybrid: trainingen in de agenda (iCalendar, Google-link, abonnement). */
process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

const UID = "11111111-2222-3333-4444-555555555555";
let stored = null;
let subs = [{ user_id: UID, status: "active", plan: "hybrid_maand" }];
const res = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/auth/v1/user")) return String((init.headers || {}).Authorization || "").includes("goed") ? res({ id: UID }) : res({}, 401);
  if (url.includes("/rest/v1/nexa_subscriptions")) return res(subs);
  if (url.includes("/rest/v1/nexa_data")) return res(stored ? [{ value: JSON.stringify(stored) }] : []);
  throw new Error("onverwacht " + url);
};

const I = await import("../src/hybrid/engine/ics.js");
const CA = await import("../src/hybrid/engine/calendar.js");
const P = await import("../src/hybrid/engine/planner.js");
const M = await import("../src/hybrid/engine/model.js");
const core = await import("../netlify/lib/calendar-core.mjs");
const fn = (await import("../netlify/functions/hybrid-calendar.mjs")).default;

// ---------- iCalendar ----------
const item = { id: "abc", date: "2026-10-05", title: "Loop-wandel: 8 × 1 min hardlopen", targetMin: 29, status: "gepland", note: "Rustig, praattempo; wandelen mag.", blocks: P.starterSession(0).blocks };
const ics = I.buildICS([item, { ...item, id: "x2", status: "overgeslagen" }, { ...item, id: "x3", optional: true }], { time: "07:30", alarm: 30 });
ok("agenda: VCALENDAR met tijdzone Amsterdam", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.includes("TZID:Europe/Amsterdam") && ics.trim().endsWith("END:VCALENDAR"));
ok("agenda: begin 07:30 en einde na 29 min", ics.includes("DTSTART;TZID=Europe/Amsterdam:20261005T073000") && ics.includes("DTEND;TZID=Europe/Amsterdam:20261005T075900"));
ok("agenda: overgeslagen en optionele sessies weggelaten", (ics.match(/BEGIN:VEVENT/g) || []).length === 1);
ok("agenda: herinnering 30 min vooraf", ics.includes("TRIGGER:-PT30M"));
ok("agenda: puntkomma's en komma's ge-escaped", ics.replace(/\r\n /g, "").includes(String.raw`Rustig\, praattempo\; wandelen mag.`));
ok("agenda: regels hoogstens 75 bytes", ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
ok("agenda: vaste UID (geen dubbele afspraken bij verversen)", ics.includes("UID:abc@nexa-hybrid"));
ok("agenda: omschrijving met de opbouw", /DESCRIPTION:.*wandelen.*hardlopen/i.test(ics.replace(/\r\n /g, "")));
ok("tijd over middernacht", I.localStamp("2026-10-05", "23:30", 45) === "20261006T001500");
const g = new URL(I.googleLink(item, { time: "18:00" }));
ok("Google-link: titel, tijden en tijdzone", g.hostname === "calendar.google.com" && g.searchParams.get("dates") === "20261005T180000/20261005T182900" && g.searchParams.get("ctz") === "Europe/Amsterdam");

// ---------- welke sessies ----------
const settings = { ...P.SETTINGS_DEFAULT, goal: "5k", startDate: "2026-10-05", exp: { kracht: "beginner", duur: "starter" }, runNow: 1 };
const wk = P.generateWeek(settings, { sessions: [], profile: {} }, "2026-10-05");
const data = { ...M.STORE_DEFAULT, plan: { settings, items: wk.items, weeks: { "2026-10-05": { v: 2 } }, applied: {} }, calendar: { enabled: true, v: 1, time: "18:30" } };
const items = CA.calendarItems(data, "2026-10-06", 3);
ok("agenda-inhoud: deze week plus drie voorbeeldweken", items.some((x) => x.date === "2026-10-05") && items.some((x) => x.date >= "2026-10-26") && !items.some((x) => x.date > "2026-11-01"));
ok("voorbeeldweken: stabiele id's", CA.calendarItems(data, "2026-10-06", 3).filter((x) => x.date > "2026-10-11").map((x) => x.id).join() === items.filter((x) => x.date > "2026-10-11").map((x) => x.id).join());
ok("zonder schema: lege agenda", CA.calendarItems(M.STORE_DEFAULT, "2026-10-06").length === 0);

// ---------- links ----------
const t = core.signCalToken(UID, 1);
ok("link: geldig terug te lezen", JSON.stringify(core.verifyCalToken(t)) === JSON.stringify({ userId: UID, v: 1 }));
ok("link: gewijzigd = ongeldig", core.verifyCalToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")) === null && core.verifyCalToken("x.y") === null);

// ---------- functie ----------
const ORIGIN = "https://nexa-performance.netlify.app";
const get = (tok) => fn(new Request(`${ORIGIN}/.netlify/functions/hybrid-calendar?t=${tok}`));
stored = data;
let r = await get(t);
let body = await r.text();
ok("abonnement: 200 met agenda op 18:30", r.status === 200 && r.headers.get("content-type").startsWith("text/calendar") && body.includes("T183000") && body.includes("Loop-wandel"));
stored = { ...data, calendar: { ...data.calendar, v: 2 } };
ok("ingetrokken (nieuwe versie): 404", (await get(t)).status === 404);
stored = { ...data, calendar: { ...data.calendar, enabled: false } };
ok("uitgezet: 404", (await get(t)).status === 404);
stored = data;
subs = [];
ok("geen Hybrid meer: 404", (await get(t)).status === 404);
subs = [{ user_id: UID, status: "active", plan: "hybrid_maand" }];
ok("onzin-link: 404", (await get("abc")).status === 404);
const post = (body, auth = "Bearer goed") => fn(new Request(`${ORIGIN}/.netlify/functions/hybrid-calendar`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, authorization: auth }, body: JSON.stringify(body) }));
r = await post({ action: "link", v: 3 });
const d = await r.json();
ok("link aanvragen: https, webcal en Google", r.status === 200 && d.webcal.startsWith("webcal://") && d.google.includes("cid=webcal") && core.verifyCalToken(new URL(d.url).searchParams.get("t")).v === 3);
ok("link aanvragen zonder inloggen: 401", (await post({ action: "link", v: 1 }, "Bearer fout")).status === 401);

console.log(fails ? `\n${fails} FOUT` : "\nAlles goed");
process.exit(fails ? 1 : 0);
