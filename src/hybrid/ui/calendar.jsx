/* Trainingen in uw agenda (Google, Apple, Outlook).
   - Abonneren: de agenda volgt het schema vanzelf, ook als het zich aanpast.
   - Eenmalig: een .ics-bestand met de komende weken.
   - Per training: "In agenda" in het detailscherm. */
import React, { useState } from "react";
import { C, R, TBtn } from "../../App.jsx";
import { localISO } from "../engine/model.js";
import { buildICS, googleLink, TIMES, DEFAULT_TIME } from "../engine/ics.js";
import { calendarItems } from "../engine/calendar.js";
import { calendarLink, downloadICS } from "../calendar.js";
import { platform } from "../native/platform.js";
import { Card, Eyebrow, Field } from "./kit.jsx";

const SITE_URL = "https://nexa-performance.netlify.app/app/";
const isApple = () => platform() === "ios" || (typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent));

function TimeSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Tijd van de training"
      className="w-full px-3 py-2.5 text-sm tnum"
      style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink }}
    >
      {TIMES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

export function CalendarCard({ data, api, nx }) {
  const cal = data.calendar || {};
  const time = cal.time || DEFAULT_TIME;
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const loggedIn = !!(nx && nx.user);
  const canSync = !!(nx && nx.user && nx.user.consent);

  const subscribe = async () => {
    setBusy(true);
    setErr(null);
    try {
      const v = cal.v || 1;
      api.setCalendar({ enabled: true, v, time, since: cal.since || new Date().toISOString() });
      setLink(await calendarLink(v));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const stop = () => {
    api.setCalendar({ enabled: false, v: (cal.v || 1) + 1 });
    setLink(null);
  };
  const download = () => downloadICS(buildICS(calendarItems(data, localISO()), { time, alarm: cal.alarm || null, url: SITE_URL }));

  return (
    <Card className="px-4 py-4">
      <Eyebrow>In uw agenda</Eyebrow>
      <p className="text-sm leading-relaxed mt-1" style={{ color: C.ink }}>
        Zet uw trainingen in Google Agenda of de agenda van uw iPhone. Met een abonnement bewegen ze vanzelf mee als het schema verandert.
      </p>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Hoe laat traint u meestal?">
          <TimeSelect value={time} onChange={(v) => api.setCalendar({ time: v })} />
        </Field>
        <Field label="Herinnering">
          <select
            value={cal.alarm || 0}
            onChange={(e) => api.setCalendar({ alarm: Number(e.target.value) || null })}
            aria-label="Herinnering"
            className="w-full px-3 py-2.5 text-sm"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink }}
          >
            <option value={0}>Geen</option>
            <option value={15}>15 min vooraf</option>
            <option value={30}>30 min vooraf</option>
            <option value={60}>1 uur vooraf</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 space-y-2.5">
        {cal.enabled && link ? (
          <>
            <a href={link.webcal} className="tap block text-center py-2.5 text-sm" style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600 }}>
              Toevoegen aan Apple Agenda
            </a>
            <a href={link.google} target="_blank" rel="noopener noreferrer" className="tap block text-center py-2.5 text-sm" style={{ border: `1px solid ${C.accent}`, color: C.accent, borderRadius: R.field, fontWeight: 600 }}>
              Toevoegen aan Google Agenda
            </a>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                } catch (e) {
                  setErr("Kopiëren lukte niet. Houd de link hieronder ingedrukt.");
                }
              }}
              className="tap text-xs"
              style={{ color: C.muted }}
            >
              {copied ? "Link gekopieerd" : "Link kopiëren (Outlook en andere agenda's)"}
            </button>
            <p className="text-[11px] leading-relaxed" style={{ color: C.muted }}>
              Apple Agenda ververst meestal binnen een uur, Google Agenda kan tot een dag nodig hebben. Wijzigt u de tijd hierboven, dan past de agenda zich bij de volgende verversing aan.
            </p>
          </>
        ) : cal.enabled ? (
          <TBtn full disabled={busy} onClick={subscribe}>
            {busy ? "Even geduld…" : "Agendalink tonen"}
          </TBtn>
        ) : (
          <TBtn full disabled={busy || !loggedIn || !canSync} onClick={subscribe}>
            {busy ? "Even geduld…" : "Abonneren in mijn agenda"}
          </TBtn>
        )}
        {!loggedIn && <p className="text-xs" style={{ color: C.muted }}>Voor een abonnement logt u in met uw Nexa-account. Downloaden kan ook zonder.</p>}
        {loggedIn && !canSync && <p className="text-xs" style={{ color: C.muted }}>Voor een abonnement moet uw account synchroniseren (toestemming bij Profiel → Account). Downloaden kan ook zonder.</p>}
        <button type="button" onClick={download} className="tap text-sm" style={{ color: C.accent, fontWeight: 600 }}>
          Of eenmalig downloaden (komende 4 weken)
        </button>
        {cal.enabled && (
          <button type="button" onClick={stop} className="tap block text-xs" style={{ color: C.muted }}>
            Abonnement stoppen (de link werkt dan niet meer)
          </button>
        )}
        {err && (
          <p className="text-xs" style={{ color: C.train }} role="alert">
            {err}
          </p>
        )}
      </div>
    </Card>
  );
}

/* Eén training in de agenda zetten (detailscherm van een geplande sessie). */
export function AddToCalendar({ item, data }) {
  const time = ((data && data.calendar) || {}).time || DEFAULT_TIME;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <button type="button" onClick={() => downloadICS(buildICS([item], { time, url: SITE_URL }), "training.ics")} className="tap" style={{ color: C.accent, fontWeight: 600 }}>
        {isApple() ? "In Apple Agenda" : "Agendabestand (.ics)"}
      </button>
      <a href={googleLink(item, { time })} target="_blank" rel="noopener noreferrer" className="tap" style={{ color: C.accent, fontWeight: 600 }}>
        In Google Agenda
      </a>
    </div>
  );
}
