/* Prestatietraining binnen Nexa: kracht, hybride, hardlopen en conditie.
   Gebruikt de rekenkern en onderdelen van Hybrid (src/hybrid), in de stijl
   en navigatie van Nexa. Bodybuilding blijft de bestaande Nexa-training. */
import React, { useState } from "react";
import { C, R, Section, TBtn } from "../App.jsx";
import { newSession, localISO } from "../hybrid/engine/model.js";
import { newBlock } from "../hybrid/engine/blocks.js";
import { draftFromItem, SETTINGS_DEFAULT, GOALS } from "../hybrid/engine/planner.js";
import { programFromBlocks } from "../hybrid/engine/guide.js";
import { SessionSheet, ensureNexaExercises } from "../hybrid/ui/session.jsx";
import { TodayView, QuickStart, LogView, ProgressView, AthleteSection } from "../hybrid/ui/screens.jsx";
import { WeekView, TodayPlan, CheckinCard, PlanSheet, PlanItemRow, useAutoAdjust } from "../hybrid/ui/plan.jsx";
import { useNutritionBase, NutritionToday } from "../hybrid/ui/fuel.jsx";
import { StravaSection, useStravaInbox, NeedsRpeCard } from "../hybrid/ui/integrations.jsx";
import { CoachCard } from "../hybrid/ui/coach.jsx";
import { CalendarCard } from "../hybrid/ui/calendar.jsx";
import { LiveRecorder, savedLive } from "../hybrid/ui/live.jsx";
import { DISCIPLINES } from "./theme.js";
import { PerfOverview, PerfSchema, UnifiedLog } from "./screens.jsx";

const VIEWS = [
  { id: "vandaag", label: "Vandaag" },
  { id: "week", label: "Schema" },
  { id: "log", label: "Logboek" },
  { id: "voortgang", label: "Inzichten" },
  { id: "meer", label: "Meer" },
];

/* Keuze van de sport, boven in Training. */
export function SportPicker({ value, onChange }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: C.muted, fontWeight: 600 }}>
        Sport
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Sport" style={{ scrollbarWidth: "none" }}>
        {Object.entries(DISCIPLINES).map(([id, d]) => {
          const on = value === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(id)}
              className="tap shrink-0 px-3.5 py-1.5 text-sm"
              style={{ borderRadius: 999, border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.panel, color: on ? C.onAccent : C.ink, fontWeight: on ? 600 : 500 }}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Op Vandaag in Nexa: de training(en) van vandaag, voor elke sport. */
export function PerfTodayCard({ store, onOpen }) {
  const [data] = store;
  const today = localISO();
  const items = data.plan ? data.plan.items.filter((x) => x.date === today && !x.optional) : [];
  const d = DISCIPLINES[data.discipline] || DISCIPLINES.hybride;
  const label = !data.plan ? "Nog geen schema" : !items.length ? "Rustdag" : items.every((x) => x.status === "gedaan") ? "Training gedaan" : items.map((x) => x.title).join(" + ");
  return (
    <button onClick={onOpen} className="tap w-full text-left mb-3 px-3 py-2 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.field }}>
      <span className="shrink-0 rounded-full" style={{ width: 10, height: 10, background: items.length ? C.accent : C.muted }} />
      <span className="text-xs flex-1 leading-snug" style={{ color: C.muted }}>
        <strong style={{ color: C.ink }}>{label}</strong>
        {" · "}
        {d.label.toLowerCase()}
        {items.length ? ` · ± ${items.reduce((a, x) => a + (x.targetMin || 0), 0)} min` : ""}
      </span>
      <span className="text-xs shrink-0" style={{ color: C.accent, fontWeight: 600 }}>
        {items.some((x) => x.status === "gepland") ? "Start" : "Training"}
      </span>
    </button>
  );
}

/* Nog geen schema voor deze sport: kort uitleggen en het schema laten maken. */
function StartPlan({ discipline, onMake }) {
  const d = DISCIPLINES[discipline];
  return (
    <Section title={`${d.label}: uw schema`}>
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
          Vertel wat uw doel is en op welke dagen u kunt trainen. Nexa maakt een week die zich aanpast aan wat u doet en hoe u herstelt, en u kunt altijd een week vooruit kijken.
        </p>
        <TBtn onClick={onMake}>Schema maken</TBtn>
      </div>
    </Section>
  );
}

export function PerformanceTraining({ store, nx, discipline, bbLog = [], onBodybuilding }) {
  ensureNexaExercises();
  const [data, api, loaded, nexa] = store;
  const acc = { locked: false, loggedIn: !!(nx && nx.user), on: false };
  const nbase = useNutritionBase(data, nexa);
  const [view, setView] = useState("vandaag");
  const [sheet, setSheet] = useState(null);
  const [live, setLive] = useState(() => (savedLive() ? true : false));
  const [planOpen, setPlanOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  useAutoAdjust(data, api, loaded);
  useStravaInbox(api, nx, acc, loaded, setNotice);

  const d = DISCIPLINES[discipline] || DISCIPLINES.hybride;
  const planFits = data.plan && (d.goals || []).includes(data.plan.settings.goal);
  const go = (v) => {
    setView(v);
    try {
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      /* oudere browsers */
    }
  };
  const add = () => setSheet({});
  const quick = (id) => {
    const s = id === "kracht" ? newSession("kracht", { blocks: [newBlock("sets")] }) : id === "wod" ? newSession("wod") : newSession("duur", { sport: id });
    setSheet({ session: s, fresh: true });
  };
  const open = (s) => setSheet({ session: s });
  const logDraft = (draft) => setSheet({ session: draft, fresh: true });
  const openSession = (id) => {
    const s = data.sessions.find((x) => x.id === id);
    if (s) setSheet({ session: s });
  };
  const guide = (item) => setLive({ item });

  let page;
  if (!loaded) page = null;
  else if (!planFits && view !== "log" && view !== "voortgang" && view !== "meer") page = <StartPlan discipline={discipline} onMake={() => setPlanOpen(true)} />;
  else if (view === "vandaag")
    page = (
      <PerfOverview
        data={data}
        api={api}
        discipline={discipline}
        onLog={logDraft}
        onGuide={guide}
        onOpenSession={openSession}
        onAdd={add}
        onOpen={open}
        onQuick={quick}
        onLive={() => setLive(true)}
        onPlan={() => setPlanOpen(true)}
        goTo={go}
        checkin={
          <div className="mb-8">
            <NeedsRpeCard sessions={data.sessions} onOpen={open} />
            <div className="mt-3">
              <CheckinCard checkins={data.checkins} onSave={api.saveCheckin} />
            </div>
          </div>
        }
        nutrition={nbase ? <div className="mb-8"><NutritionToday data={data} base={nbase} /></div> : null}
      />
    );
  else if (view === "week")
    page = <PerfSchema data={data} api={api} goals={d.goals} nbase={nbase} onLog={logDraft} onGuide={guide} onOpenSession={openSession} extraBelow={<CalendarCard data={data} api={api} nx={nx} />} />;
  else if (view === "log") page = <UnifiedLog data={data} bbLog={bbLog} onAdd={add} onOpen={open} onOpenBodybuilding={onBodybuilding} />;
  else if (view === "voortgang") page = <div className="perf-cards"><ProgressView data={data} /></div>;
  else
    page = (
      <div className="perf-cards">
        <CoachCard data={data} api={api} nx={nx} acc={acc} />
        <AthleteSection profile={data.profile} setProfile={api.setProfile} />
        <StravaSection data={data} api={api} nx={nx} acc={acc} />
      </div>
    );

  return (
    <div className="perf">
      <div className="flex gap-1 p-1 mb-5" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999 }} role="tablist">
        {VIEWS.map((v) => {
          const on = view === v.id;
          return (
            <button key={v.id} role="tab" aria-selected={on} onClick={() => go(v.id)} className="tap flex-1 py-1.5 text-sm rounded-full" style={{ background: on ? C.accent : "transparent", color: on ? C.onAccent : C.muted, fontWeight: on ? 600 : 500 }}>
              {v.label}
            </button>
          );
        })}
      </div>
      {notice && (
        <p className="text-sm px-3 py-2 mb-4" style={{ background: C.accentSoft || "var(--accent-soft)", color: C.ink, borderRadius: R.field }} role="status">
          {notice}
        </p>
      )}
      {page}

      {sheet && (
        <SessionSheet
          key={(sheet.session && sheet.session.id) || "nieuw"}
          initial={sheet.session || null}
          initialRoute={sheet.route || null}
          onLive={() => {
            setSheet(null);
            setLive(true);
          }}
          profile={data.profile}
          templates={data.templates}
          onSaveTemplate={api.saveTemplate}
          onDeleteTemplate={api.deleteTemplate}
          onRepeat={(copy) => setSheet({ session: copy, fresh: true })}
          onClose={() => setSheet(null)}
          onSave={(s, route) => {
            api.saveSession(s);
            if (route) api.saveRoute(s.id, route);
            setSheet(null);
          }}
          onDelete={
            sheet.session && !sheet.fresh
              ? (id) => {
                  api.deleteSession(id);
                  setSheet(null);
                }
              : null
          }
        />
      )}
      {live && (
        <LiveRecorder
          guide={live.item ? { itemId: live.item.id, title: live.item.title, sport: live.item.sport || "hardlopen", program: programFromBlocks(live.item.blocks) } : null}
          onClose={() => setLive(false)}
          onFinish={({ draft, route, guide: g }) => {
            setLive(false);
            const item = g && data.plan ? data.plan.items.find((x) => x.id === g.itemId) : null;
            const base = item ? draftFromItem(item) : newSession("duur");
            const { kmSplits, ...gps } = draft;
            setSheet({ session: { ...base, ...gps, ...(kmSplits ? { kmSplits } : {}), type: item ? item.type || base.type : draft.type }, route, fresh: true });
          }}
        />
      )}
      {planOpen && (
        <PlanSheet
          initial={{ ...SETTINGS_DEFAULT, ...(data.plan ? data.plan.settings : {}), ...(planFits ? {} : { goal: d.goal }) }}
          goals={d.goals}
          onClose={() => setPlanOpen(false)}
          onSave={(s) => {
            api.setPlan(s);
            setPlanOpen(false);
            go("week");
          }}
        />
      )}
    </div>
  );
}
