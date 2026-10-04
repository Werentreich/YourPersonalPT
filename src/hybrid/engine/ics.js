/* Geplande trainingen als agenda (iCalendar, RFC 5545): voor een eenmalige
   download, een "toevoegen aan Google Agenda"-link en het agenda-abonnement
   dat vanzelf meebeweegt (netlify/functions/hybrid-calendar.mjs).

   Tijden staan in Europe/Amsterdam (met VTIMEZONE), zodat zomer- en
   wintertijd kloppen in Google, Apple en Outlook. Puur JavaScript. */

import { itemLine, blockHeader, blocksOf } from "./blocks.js";

export const TZID = "Europe/Amsterdam";
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export const TIMES = Array.from({ length: 33 }, (_, i) => {
  const m = 5 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
export const DEFAULT_TIME = "18:00";

/* Tekst volgens RFC 5545: \ ; , en regeleinden escapen. */
export const esc = (t) => String(t == null ? "" : t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/* Regels langer dan 75 bytes vouwen (vervolgregel begint met een spatie). */
export function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (len + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const pad = (n) => String(n).padStart(2, "0");
/* "2026-10-05" + "18:00" + minuten erbij -> "20261005T180000" (lokale tijd). */
export function localStamp(dateISO, time, addMin = 0) {
  const [h, m] = String(time || DEFAULT_TIME).split(":").map(Number);
  const d = new Date(Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10), h, m + addMin));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}
const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/* Omschrijving van een geplande sessie: opbouw per blok en de toelichting. */
export function describe(item) {
  const lines = [];
  for (const b of blocksOf(item)) {
    const head = blockHeader(b, { withName: true });
    const its = (b.items || []).map((it) => itemLine(it, b)).filter(Boolean);
    const hint = b.intensity ? ` (${b.intensity})` : "";
    if (b.type === "interval" || b.type === "rondes" || b.type === "emom" || b.type === "amrap" || b.type === "sets") lines.push(`• ${head}${hint}${its.length && b.type === "sets" ? ": " + its.join(", ") : ""}`);
    else lines.push(`• ${its.join(", ") || head}${hint}`);
  }
  if (item.note) lines.push("", item.note);
  return lines.join("\n");
}

const minutesOf = (item) => Math.max(15, Math.round(item.targetMin || 45));

/* Eén VEVENT. opts: { time, url, alarm (min vooraf), now } */
export function eventLines(item, opts = {}) {
  const time = (opts.times && opts.times[item.date]) || opts.time || DEFAULT_TIME;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${item.id}@nexa-hybrid`,
    `DTSTAMP:${utcStamp(opts.now || Date.now())}`,
    `DTSTART;TZID=${TZID}:${localStamp(item.date, time)}`,
    `DTEND;TZID=${TZID}:${localStamp(item.date, time, minutesOf(item))}`,
    `SUMMARY:${esc(`${item.title || "Training"}${item.targetMin ? ` · ${item.targetMin} min` : ""}`)}`,
    `DESCRIPTION:${esc(describe(item) + (opts.url ? `\n\nOpenen in Nexa Hybrid: ${opts.url}` : ""))}`,
    "CATEGORIES:Training",
    "TRANSP:OPAQUE",
  ];
  if (opts.url) lines.push(`URL:${opts.url}`);
  if (item.status === "gedaan") lines.push("STATUS:CONFIRMED");
  if (opts.alarm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(item.title || "Training")}`, `TRIGGER:-PT${opts.alarm}M`, "END:VALARM");
  lines.push("END:VEVENT");
  return lines;
}

/* Volledige agenda. Overgeslagen sessies en optionele mobiliteit vallen weg. */
export function buildICS(items, opts = {}) {
  const list = (items || []).filter((x) => x && x.date && x.status !== "overgeslagen" && !x.optional);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nexa//Nexa Hybrid//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.name || "Nexa Hybrid")}`,
    `X-WR-TIMEZONE:${TZID}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...VTIMEZONE,
  ];
  for (const it of list) lines.push(...eventLines(it, opts));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/* Link "toevoegen aan Google Agenda" voor één sessie. */
export function googleLink(item, opts = {}) {
  const time = opts.time || DEFAULT_TIME;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${item.title || "Training"}${item.targetMin ? ` · ${item.targetMin} min` : ""}`,
    dates: `${localStamp(item.date, time)}/${localStamp(item.date, time, minutesOf(item))}`,
    ctz: TZID,
    details: describe(item),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
