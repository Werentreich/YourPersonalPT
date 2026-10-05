/* Prestatietraining in de andere tabbladen van Nexa:
   - Gezondheid: herstel (check-in, HRV, rusthartslag, slaap)
   - Eten: voeding rond de training van vandaag
   - Plan: belasting, vorm en records van alle sporten */
import React, { useMemo } from "react";
import { C, R, Section, Row } from "../App.jsx";
import { localISO, mondayOf, dayNum, isoOfNum } from "../hybrid/engine/model.js";
import { readinessFor, readinessAverage, READINESS_TEXT } from "../hybrid/engine/readiness.js";
import { fitnessSeries, formStatus, weekSummary, strengthRecords, runRecords } from "../hybrid/engine/load.js";
import { fuelingFor, hoursToNext } from "../hybrid/engine/fuel.js";
import { CheckinCard } from "../hybrid/ui/plan.jsx";
import { FuelTips } from "../hybrid/ui/fuel.jsx";
import { PillarMini, FitnessChart } from "../hybrid/ui/charts.jsx";
import { AthleteSection } from "../hybrid/ui/screens.jsx";
import { StravaSection } from "../hybrid/ui/integrations.jsx";
import { CalendarCard } from "../hybrid/ui/calendar.jsx";
import { fmtDuration } from "../hybrid/engine/model.js";

/* Kop in de stijl van een Nexa-sectie, zonder kaart eromheen. */
function Head({ title, sub, accent }) {
  return (
    <>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="inline-block w-1.5 h-5 rounded-sm" style={{ background: accent || C.accent }} />
        <h2 className="disp text-2xl font-bold uppercase leading-none" style={{ color: C.ink }}>
          {title}
        </h2>
      </div>
      {sub && (
        <p className="text-sm mb-3 leading-relaxed" style={{ color: C.muted, maxWidth: "62ch" }}>
          {sub}
        </p>
      )}
    </>
  );
}

/* ---------------- Gezondheid ---------------- */
export function PerfRecovery({ store }) {
  const [data, api] = store;
  const today = localISO();
  const r = readinessFor(data.checkins || [], today);
  const avg = readinessAverage(data.checkins || [], today, 7);
  const last = (data.checkins || []).filter((c) => c.date <= today).slice(-14).reverse();
  const withHrv = last.filter((c) => c.hrv || c.rhr || c.sleepH);
  return (
    <div className="perf mb-8">
      <Head title="Herstel" sub="Tien seconden per dag. Uw schema past zich aan op hoe u hersteld bent; HRV en rusthartslag maken het nauwkeuriger." />
      <CheckinCard checkins={data.checkins} onSave={api.saveCheckin} />
      {(avg != null || withHrv.length > 0) && (
        <div className="mt-4 overflow-hidden" style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: R.card, boxShadow: C.shadow }}>
          {avg != null && (
            <Row label="Gemiddeld herstel, 7 dagen" hint={r.level ? READINESS_TEXT[r.level].text : null}>
              <span className="disp text-2xl font-bold tnum">{avg}</span>
            </Row>
          )}
          {withHrv.slice(0, 7).map((c) => (
            <div key={c.date} className="px-4 py-2 flex items-center justify-between text-xs tnum" style={{ borderBottom: `1px solid ${C.lineSoft}`, color: C.muted }}>
              <span style={{ color: C.ink }}>{new Date(c.date + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</span>
              <span>
                {[c.sleepH ? `${String(c.sleepH).replace(".", ",")} u slaap` : null, c.hrv ? `HRV ${c.hrv} ms` : null, c.rhr ? `rust ${c.rhr} bpm` : null].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Eten ---------------- */
export function PerfFueling({ store, weight }) {
  const [data] = store;
  const today = localISO();
  const items = data.plan ? data.plan.items.filter((x) => x.date === today && !x.optional && x.status === "gepland" && x.kind !== "mobiliteit") : [];
  if (!items.length || !weight) return null;
  return (
    <div className="perf">
      <Section title="Rond de training" sub="Wat u eet vóór, tijdens en na de training van vandaag. Uw dagtotaal hieronder rekent het extra verbruik al mee.">
        {items.map((x) => (
          <div key={x.id} className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <div className="text-sm font-semibold mb-1.5">
              {x.title}
              {x.part ? <span className="font-normal" style={{ color: C.muted }}> · {x.part}</span> : null}
            </div>
            <FuelTips f={fuelingFor({ ...x, planned: true }, weight, { nextWithinHours: hoursToNext(x, data.sessions, data.plan.items) === 6 ? 6 : null })} />
          </div>
        ))}
      </Section>
    </div>
  );
}

/* ---------------- Plan ---------------- */
export function PerfProgress({ store, onOpen }) {
  const [data] = store;
  const today = localISO();
  const series = useMemo(() => fitnessSeries(data.sessions, data.profile, isoOfNum(dayNum(today) - 41), today), [data.sessions, data.profile, today]);
  const point = series[series.length - 1];
  const status = formStatus(point);
  const week = useMemo(() => weekSummary(data.sessions, data.profile, mondayOf(today)), [data.sessions, data.profile, today]);
  const records = useMemo(() => [...runRecords(data.sessions).slice(0, 2).map((r) => ({ name: r.label, value: fmtDuration(Math.round(r.est)) })), ...strengthRecords(data.sessions).slice(0, 3).map((r) => ({ name: r.name, value: `${Math.round(r.e1rm)} kg e1RM` }))], [data.sessions]);
  if (!data.sessions.length) return null;
  return (
    <div className="perf">
      <Section title="Training" sub="Kracht, duur en conditie samen: hoe uw belasting en vorm zich ontwikkelen.">
        <Row label="Vorm" hint={status.text}>
          <span className="text-sm font-semibold" style={{ color: C.ink }}>
            {status.label}
          </span>
        </Row>
        {point && point.ctl >= 1 && status.key !== "start" && (
          <div className="px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <FitnessChart series={series} />
          </div>
        )}
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
          <div className="text-xs mb-2" style={{ color: C.muted }}>
            Deze week: {week.count} {week.count === 1 ? "training" : "trainingen"} · {fmtDuration(week.minutes * 60, { long: true })}
          </div>
          <PillarMini week={week} />
        </div>
        {records.map((r) => (
          <Row key={r.name} label={r.name}>
            <span className="text-sm font-semibold tnum">{r.value}</span>
          </Row>
        ))}
        {onOpen && (
          <div className="px-4 py-2.5">
            <button onClick={onOpen} className="tap text-sm font-semibold" style={{ color: C.accent }}>
              Meer inzichten in Training
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------------- Profiel ----------------
   Sporterprofiel (hartslag, tempo, vermogen), Strava en agenda. */
export function PerfProfile({ store, nx, stravaKey, notice }) {
  const [data, api] = store;
  const acc = { locked: false, loggedIn: !!(nx && nx.user), on: false };
  return (
    <div className="perf perf-cards mb-8">
      {notice && (
        <p className="text-sm px-3 py-2" style={{ background: "var(--accent-soft)", color: C.ink, borderRadius: R.field }} role="status">
          {notice}
        </p>
      )}
      <AthleteSection profile={data.profile} setProfile={api.setProfile} />
      <StravaSection data={data} api={api} nx={nx} acc={acc} refreshKey={stravaKey} />
      {data.plan && <CalendarCard data={data} api={api} nx={nx} />}
    </div>
  );
}
