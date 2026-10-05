/* Schermen van de prestatietraining, gebouwd met de eigen onderdelen van
   Nexa (Section, Row, TBtn): Vandaag, Schema en één logboek voor alle
   sporten. De rekenkern komt uit src/hybrid/engine. */
import React, { useEffect, useMemo, useState } from "react";
import { C, R, Section, Row, TBtn } from "../App.jsx";
import { SPORTS, localISO, dayNum, isoOfNum, mondayOf, pillarOf } from "../hybrid/engine/model.js";
import { GOALS, PHASES, DAY_NAMES, dailySuggestions, draftFromItem, conflictsFor } from "../hybrid/engine/planner.js";
import { readinessFor, READINESS_TEXT } from "../hybrid/engine/readiness.js";
import { previewWeek } from "../hybrid/engine/weeks.js";
import { titleOf } from "../hybrid/engine/blocks.js";
import { K } from "../hybrid/theme.js";
import { ItemSheet, PlanSheet, guidable, startable } from "../hybrid/ui/plan.jsx";
import { ItemFuel } from "../hybrid/ui/fuel.jsx";
import { AddToCalendar } from "../hybrid/ui/calendar.jsx";
import { sessionFacts } from "../hybrid/ui/screens.jsx";

const fill = (kind) => (K[pillarOfKind(kind)] || K.duur).fill;
const pillarOfKind = (kind) => (kind === "kracht" ? "kracht" : kind === "wod" || kind === "hyrox" ? "conditie" : kind === "mobiliteit" ? "mobiliteit" : "duur");
const dayLabel = (iso, opts = { weekday: "long", day: "numeric", month: "short" }) => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", opts);
const meta = (x) => [x.part, x.targetMin ? `± ${x.targetMin} min` : null, x.sport && SPORTS[x.sport] ? SPORTS[x.sport].label.toLowerCase() : null, x.optional ? "optioneel" : null].filter(Boolean).join(" · ");

/* Eén geplande sessie als rij: kleurstreep, titel, gegevens, knoppen. */
function ItemRow({ x, onOpen, actions }) {
  const done = x.status === "gedaan";
  const skipped = x.status === "overgeslagen";
  return (
    <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}`, opacity: skipped ? 0.55 : 1 }}>
      <span aria-hidden="true" className="self-stretch shrink-0" style={{ width: 4, borderRadius: 2, background: fill(x.kind), opacity: x.optional ? 0.5 : 1 }} />
      <button onClick={() => onOpen(x)} className="tap min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold truncate" style={{ color: C.ink, textDecoration: skipped ? "line-through" : "none" }}>
          {x.title}
        </span>
        <span className="block text-xs truncate tnum" style={{ color: C.muted }}>
          {meta(x)}
        </span>
      </button>
      <span className="shrink-0 flex items-center gap-2">
        {done ? (
          <span className="text-xs font-semibold" style={{ color: C.accent }}>
            ✓ gedaan
          </span>
        ) : skipped ? (
          <span className="text-xs" style={{ color: C.muted }}>
            overgeslagen
          </span>
        ) : (
          actions
        )}
      </span>
    </div>
  );
}

/* ---------------- Vandaag ---------------- */
export function PerfOverview({ data, api, discipline, onLog, onGuide, onOpenSession, onAdd, onOpen, onQuick, onLive, onPlan, goTo, checkin, nutrition }) {
  const plan = data.plan;
  const today = localISO();
  const monday = mondayOf(today);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (plan) api.ensureWeek();
  }, [plan && plan.settings, monday]);
  const week = plan ? plan.items.filter((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6)) : [];
  const todays = week.filter((x) => x.date === today);
  const ctx = { sessions: data.sessions, profile: data.profile, checkins: data.checkins, planItems: plan ? plan.items : [] };
  const readiness = readinessFor(data.checkins || [], today);
  const sugs = plan ? dailySuggestions(week, today, readiness, plan.settings, ctx).filter((s) => !(plan.applied || {})[s.id]) : [];
  const info = plan ? (plan.weeks || {})[monday] : null;
  const ph = info ? PHASES[info.phase] : null;
  const recent = [...data.sessions].filter((s) => s.date <= today).sort((a, b) => (a.date + (a.createdAt || 0) < b.date + (b.createdAt || 0) ? 1 : -1)).slice(0, 4);
  const openItem = open && plan && plan.items.find((x) => x.id === open);
  const main = week.filter((x) => !x.optional && x.status !== "overgeslagen");
  const done = main.filter((x) => x.status === "gedaan").length;

  const actions = (x) =>
    startable(x) ? (
      <TBtn small onClick={() => onGuide(x)}>
        Start
      </TBtn>
    ) : (
      <TBtn small onClick={() => onLog(draftFromItem(x))}>
        Vastleggen
      </TBtn>
    );

  return (
    <>
      {plan ? (
        <Section title="Vandaag" sub={ph ? `${(GOALS[plan.settings.goal] || {}).label} · ${ph.label.toLowerCase()} · ${done} van ${main.length} trainingen deze week gedaan` : null}>
          {todays.length ? (
            todays.map((x) => <ItemRow key={x.id} x={x} onOpen={(it) => setOpen(it.id)} actions={actions(x)} />)
          ) : (
            <Row label="Rustdag" hint="Herstel hoort bij de training. Iets anders gedaan? Leg het vast.">
              <TBtn small kind="ghost" onClick={onAdd}>
                Vastleggen
              </TBtn>
            </Row>
          )}
          {todays.some((x) => x.status === "gepland") && (
            <div className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <button onClick={onAdd} className="tap" style={{ color: C.muted }}>
                Iets anders gedaan? Vastleggen
              </button>
              {todays.some((x) => startable(x)) && (
                <span style={{ color: C.muted }}>
                  {todays.some((x) => guidable(x)) && todays.some((x) => startable(x) && !guidable(x))
                    ? "Start = begeleiding met stem, of sets afvinken met rusttimer"
                    : todays.some((x) => guidable(x))
                    ? "Start = begeleiding met stem en GPS"
                    : "Start = sets afvinken, de rust loopt vanzelf"}
                </span>
              )}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Vandaag" sub="Nog geen schema. Kies wat u gaat doen, of laat Nexa een schema maken.">
          {[
            ["kracht", "Kracht"],
            ["hardlopen", "Hardlopen"],
            ["fietsen", "Fietsen"],
            ["wod", "WOD"],
          ].map(([id, label]) => (
            <Row key={id} label={label}>
              <TBtn small kind="ghost" onClick={() => onQuick(id)}>
                Vastleggen
              </TBtn>
            </Row>
          ))}
          <Row label="Live opnemen met GPS" hint="Tijd, afstand en tempo, route alleen op dit apparaat.">
            <TBtn small kind="ghost" onClick={onLive}>
              Start
            </TBtn>
          </Row>
          <Row label="Schema maken" hint="Een week die zich aanpast aan wat u doet en hoe u herstelt.">
            <TBtn small onClick={onPlan}>
              Maken
            </TBtn>
          </Row>
        </Section>
      )}

      {sugs.length > 0 && (
        <Section title="Voorstel" accent={C.warn} sub="Op basis van uw herstel en wat er deze week gebeurde.">
          {sugs.map((s) => (
            <div key={s.id} className="px-4 py-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
                {s.text}
              </p>
              <div className="flex gap-2 mt-2">
                <TBtn small onClick={() => api.applySuggestions([s], ctx)}>
                  Toepassen
                </TBtn>
                <TBtn small kind="ghost" onClick={() => api.dismissSuggestion(s.id)}>
                  Nee, zo laten
                </TBtn>
              </div>
            </div>
          ))}
        </Section>
      )}

      {checkin}

      {plan && (
        <Section title="Deze week" sub={info && info.enduranceMin ? `Duurvolume ± ${info.enduranceMin} min` : null}>
          {DAY_NAMES.map((n, d) => {
            const iso = isoOfNum(dayNum(monday) + d);
            const its = week.filter((x) => x.date === iso && !x.optional);
            const isToday = iso === today;
            return (
              <button key={d} onClick={() => goTo("week")} className="tap w-full text-left px-4 py-2 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}`, background: isToday ? "var(--accent-soft)" : "transparent" }}>
                <span className="text-xs w-8 shrink-0 uppercase" style={{ color: isToday ? C.accent : C.muted, fontWeight: 600 }}>
                  {n}
                </span>
                <span className="flex-1 min-w-0 text-sm truncate" style={{ color: its.length ? C.ink : C.muted }}>
                  {its.length ? its.map((x) => x.title).join(" + ") : "rust"}
                </span>
                <span className="text-xs shrink-0" style={{ color: its.length && its.every((x) => x.status === "gedaan") ? C.accent : C.muted }}>
                  {its.length && its.every((x) => x.status === "gedaan") ? "✓" : its.length ? `${its.reduce((a, x) => a + (x.targetMin || 0), 0)} min` : ""}
                </span>
              </button>
            );
          })}
        </Section>
      )}

      {nutrition}

      {recent.length > 0 && (
        <Section title="Laatst gedaan">
          {recent.map((s) => (
            <button key={s.id} onClick={() => onOpen(s)} className="tap w-full text-left px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <span aria-hidden="true" className="self-stretch shrink-0" style={{ width: 4, borderRadius: 2, background: (K[pillarOf(s)] || K.duur).fill }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{titleOf(s)}</span>
                <span className="block text-xs truncate tnum" style={{ color: C.muted }}>
                  {dayLabel(s.date, { weekday: "short", day: "numeric", month: "short" })} · {sessionFacts(s)}
                </span>
              </span>
            </button>
          ))}
        </Section>
      )}

      {openItem && (
        <ItemSheet
          item={openItem}
          weekItems={week}
          settings={plan.settings}
          ctx={ctx}
          onClose={() => setOpen(null)}
          onLog={(draft) => {
            setOpen(null);
            onLog(draft);
          }}
          onGuide={(it) => {
            setOpen(null);
            onGuide(it);
          }}
          onUpdate={(p) => api.updatePlanItem(openItem.id, p)}
          onReplace={(it) => api.replacePlanItem(it)}
          onOpenSession={(id) => {
            setOpen(null);
            onOpenSession(id);
          }}
          extra={openItem.status === "gepland" ? <AddToCalendar item={openItem} data={data} /> : null}
        />
      )}
    </>
  );
}

/* ---------------- Schema ---------------- */
const WEEK_OPTS = [
  { value: 0, label: "Deze week" },
  { value: 1, label: "Volgende" },
  { value: 2, label: "+2" },
  { value: 3, label: "+3" },
];

export function PerfSchema({ data, api, goals, nbase, onLog, onGuide, onOpenSession, extraBelow }) {
  const plan = data.plan;
  const today = localISO();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (plan) api.ensureWeek();
  }, [plan && plan.settings, today]);
  const monday = isoOfNum(dayNum(mondayOf(today)) + offset * 7);
  const preview = useMemo(() => (plan && offset > 1 ? previewWeek(data, today, monday) : null), [plan, offset, monday, data.sessions]);
  if (!plan) return null;
  const items = preview ? preview.items : plan.items.filter((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6));
  const info = preview ? { phase: preview.phase, phaseInfo: preview.phaseInfo, reasons: preview.reasons, enduranceMin: preview.enduranceMin } : (plan.weeks || {})[monday];
  const ph = info ? PHASES[info.phase] : null;
  const goal = GOALS[plan.settings.goal] || GOALS.hybride;
  const conflicts = conflictsFor(items, monday);
  const ctx = { sessions: data.sessions, profile: data.profile, checkins: data.checkins, planItems: plan.items };
  const extra = data.sessions.filter((s) => s.date >= monday && s.date <= isoOfNum(dayNum(monday) + 6) && !s.planItemId);
  const openItem = open && !preview && plan.items.find((x) => x.id === open);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex p-0.5 rounded-full" style={{ background: C.surface2, border: `1px solid ${C.line}` }}>
          {WEEK_OPTS.map((o) => {
            const on = o.value === offset;
            return (
              <button key={o.value} onClick={() => setOffset(o.value)} className="tap px-3 py-1 text-sm rounded-full" style={{ background: on ? C.accent : "transparent", color: on ? C.onAccent : C.muted, fontWeight: on ? 600 : 500 }}>
                {o.label}
              </button>
            );
          })}
        </div>
        <TBtn small kind="ghost" onClick={() => setEditing(true)}>
          Aanpassen
        </TBtn>
      </div>

      {offset === 0 && info && info.changes && info.changes.length > 0 && (
        <Section title="Aangepast" accent={C.warn} sub="Deze week is afgestemd op wat u vorige week werkelijk deed.">
          {info.changes.map((c, i) => (
            <div key={i} className="px-4 py-2 text-sm" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              {c}
            </div>
          ))}
          <div className="px-4 py-2.5">
            <button onClick={() => api.dismissChanges(monday)} className="tap text-xs font-semibold" style={{ color: C.accent }}>
              Begrepen
            </button>
          </div>
        </Section>
      )}

      <Section
        title={offset === 0 ? "Deze week" : offset === 1 ? "Volgende week" : `Week van ${dayLabel(monday, { day: "numeric", month: "long" })}`}
        sub={[goal.label, ph ? ph.label : null, info && info.phaseInfo && plan.settings.goalDate && info.phaseInfo.weeksLeft > 0 ? `nog ${info.phaseInfo.weeksLeft} weken` : null, info && info.enduranceMin ? `duur ± ${info.enduranceMin} min` : null].filter(Boolean).join(" · ")}
      >
        {ph && (
          <p className="px-4 py-2.5 text-xs leading-relaxed" style={{ color: C.muted, borderBottom: `1px solid ${C.lineSoft}` }}>
            {ph.text}
            {offset === 1 ? " Volgende week staat klaar en is aan te passen; uw eigen aanpassingen blijven staan als de app hem bij de start afstemt op deze week." : ""}
            {preview ? " Vooruitblik: deze week wordt vastgezet zodra hij volgende week is." : ""}
          </p>
        )}
        {(info && info.reasons ? info.reasons : []).map((r, i) => (
          <p key={i} className="px-4 py-2 text-xs" style={{ color: C.ink, background: "var(--accent-soft)", borderBottom: `1px solid ${C.lineSoft}` }}>
            {r}
          </p>
        ))}
        {conflicts.map((c, i) => (
          <p key={`c${i}`} className="px-4 py-2 text-xs" style={{ color: C.warn, background: C.warnBg, borderBottom: `1px solid ${C.lineSoft}` }}>
            {c.text}
          </p>
        ))}
        {DAY_NAMES.map((n, d) => {
          const iso = isoOfNum(dayNum(monday) + d);
          const its = items.filter((x) => x.date === iso);
          const ex = extra.filter((s) => s.date === iso);
          const isToday = iso === today;
          return (
            <div key={d}>
              <div className="px-4 pt-2.5 pb-1 text-xs uppercase tracking-wide" style={{ color: isToday ? C.accent : C.muted, fontWeight: 600, background: C.surface2, borderBottom: `1px solid ${C.lineSoft}` }}>
                {dayLabel(iso)}
                {isToday ? " · vandaag" : ""}
              </div>
              {its.length === 0 && ex.length === 0 && (
                <div className="px-4 py-2 text-xs" style={{ color: C.muted, borderBottom: `1px solid ${C.lineSoft}` }}>
                  {plan.createdOn && iso < plan.createdOn ? "Schema nog niet gestart" : "Rust"}
                </div>
              )}
              {its.map((x) => (
                <ItemRow key={x.id} x={x} onOpen={(it) => !preview && setOpen(it.id)} actions={!preview && x.date === today && x.status === "gepland" ? (startable(x) ? <TBtn small onClick={() => onGuide(x)}>Start</TBtn> : null) : null} />
              ))}
              {ex.map((s) => (
                <button key={s.id} onClick={() => onOpenSession(s.id)} className="tap w-full text-left px-4 py-2 text-xs" style={{ color: C.muted, borderBottom: `1px solid ${C.lineSoft}` }}>
                  + extra vastgelegd: {titleOf(s)}
                </button>
              ))}
            </div>
          );
        })}
      </Section>

      {extraBelow}

      {editing && (
        <PlanSheet
          goals={goals}
          initial={plan.settings}
          onClose={() => setEditing(false)}
          onSave={(s) => {
            api.setPlan(s);
            setEditing(false);
          }}
          onStop={() => {
            api.stopPlan();
            setEditing(false);
          }}
        />
      )}
      {openItem && (
        <ItemSheet
          item={openItem}
          weekItems={items}
          settings={plan.settings}
          ctx={ctx}
          onClose={() => setOpen(null)}
          onLog={(draft) => {
            setOpen(null);
            onLog(draft);
          }}
          onGuide={(it) => {
            setOpen(null);
            onGuide(it);
          }}
          onUpdate={(p) => api.updatePlanItem(openItem.id, p)}
          onReplace={(it) => api.replacePlanItem(it)}
          onOpenSession={(id) => {
            setOpen(null);
            onOpenSession(id);
          }}
          fuel={nbase ? <ItemFuel item={openItem} data={data} base={nbase} /> : null}
          extra={openItem.status === "gepland" ? <AddToCalendar item={openItem} data={data} /> : null}
        />
      )}
    </>
  );
}

/* ---------------- één logboek voor alle sporten ----------------
   Prestatietrainingen en de bodybuildingtrainingen van Nexa samen, op
   datum. bbLog: [{ id, date, name, facts }] (uit App.jsx). */
const KIND_FILTERS = [
  { value: "alles", label: "Alles" },
  { value: "kracht", label: "Kracht" },
  { value: "duur", label: "Duur" },
  { value: "conditie", label: "Conditie" },
];

export function UnifiedLog({ data, bbLog = [], onAdd, onOpen, onOpenBodybuilding }) {
  const [filter, setFilter] = useState("alles");
  const [limit, setLimit] = useState(25);
  const rows = useMemo(() => {
    const perf = data.sessions.map((s) => ({ key: s.id, date: s.date, title: titleOf(s), facts: sessionFacts(s), pillar: pillarOf(s), src: "perf", s, at: s.createdAt || 0 }));
    const bb = bbLog.map((b) => ({ key: `bb-${b.id}`, date: b.date, title: b.name, facts: b.facts, pillar: "kracht", src: "bb", at: 0 }));
    return [...perf, ...bb].filter((r) => filter === "alles" || r.pillar === filter).sort((a, b) => (a.date === b.date ? b.at - a.at : a.date < b.date ? 1 : -1));
  }, [data.sessions, bbLog, filter]);
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex p-0.5 rounded-full" style={{ background: C.surface2, border: `1px solid ${C.line}` }}>
          {KIND_FILTERS.map((o) => {
            const on = o.value === filter;
            return (
              <button key={o.value} onClick={() => setFilter(o.value)} className="tap px-3 py-1 text-sm rounded-full" style={{ background: on ? C.accent : "transparent", color: on ? C.onAccent : C.muted, fontWeight: on ? 600 : 500 }}>
                {o.label}
              </button>
            );
          })}
        </div>
        <TBtn small onClick={onAdd}>
          + Training
        </TBtn>
      </div>
      <Section title="Logboek" sub={`${rows.length} ${rows.length === 1 ? "training" : "trainingen"}, alle sporten samen.`}>
        {!rows.length && (
          <p className="px-4 py-3 text-sm" style={{ color: C.muted }}>
            Nog geen trainingen.
          </p>
        )}
        {rows.slice(0, limit).map((r) => (
          <button key={r.key} onClick={() => (r.src === "perf" ? onOpen(r.s) : onOpenBodybuilding && onOpenBodybuilding())} className="tap w-full text-left px-4 py-2.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <span aria-hidden="true" className="self-stretch shrink-0" style={{ width: 4, borderRadius: 2, background: (K[r.pillar] || K.duur).fill }} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold truncate">
                {r.title}
                {r.src === "bb" && (
                  <span className="text-xs font-normal" style={{ color: C.muted }}>
                    {" "}
                    · bodybuilding
                  </span>
                )}
              </span>
              <span className="block text-xs truncate tnum" style={{ color: C.muted }}>
                {dayLabel(r.date, { weekday: "short", day: "numeric", month: "short" })}
                {r.facts ? ` · ${r.facts}` : ""}
              </span>
            </span>
          </button>
        ))}
        {rows.length > limit && (
          <div className="px-4 py-2.5">
            <button onClick={() => setLimit(limit + 25)} className="tap text-sm font-semibold" style={{ color: C.accent }}>
              Meer tonen
            </button>
          </div>
        )}
      </Section>
    </>
  );
}

/* Voor het bodybuilding-logboek van Nexa: de trainingen van de andere sporten. */
export function perfLogRows(sessions) {
  return (sessions || [])
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((s) => ({ id: s.id, date: s.date, title: titleOf(s), facts: sessionFacts(s), pillar: pillarOf(s) }));
}

/* Op Vandaag in Training: herstel in één regel; invullen in Gezondheid. */
export function RecoveryLine({ data, onOpen, onRpe }) {
  const today = localISO();
  const r = readinessFor(data.checkins || [], today);
  const needs = data.sessions.filter((s) => s.needsRpe && s.rpe == null);
  return (
    <Section title="Herstel">
      <Row label={r.score != null && r.checkedIn ? `${r.score} · ${READINESS_TEXT[r.level].label}` : "Nog niet ingevuld vandaag"} hint={r.score != null && r.checkedIn ? READINESS_TEXT[r.level].text : "Tien seconden in Gezondheid; uw schema past zich erop aan."}>
        <TBtn small kind={r.checkedIn ? "ghost" : "primary"} onClick={onOpen}>
          {r.checkedIn ? "Bekijken" : "Invullen"}
        </TBtn>
      </Row>
      {needs.slice(0, 2).map((s) => (
        <Row key={s.id} label={`Inspanning invullen: ${titleOf(s)}`} hint="Uit Strava binnengekomen.">
          <TBtn small kind="ghost" onClick={() => onRpe(s)}>
            Invullen
          </TBtn>
        </Row>
      ))}
    </Section>
  );
}
