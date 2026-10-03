/* Planner-schermen: intake, weekoverzicht, details per geplande sessie,
   herstel-check-in en voorstellen voor vandaag. */
import React, { useEffect, useMemo, useState } from "react";
import { C, R, Sheet, TBtn } from "../../App.jsx";
import { K } from "../theme.js";
import { SPORTS, localISO, mondayOf, dayNum, isoOfNum, fmtDuration, num } from "../engine/model.js";
import { GOALS, SLOTS, PHASES, EXPERIENCE, EQUIPMENT, DAY_NAMES, SETTINGS_DEFAULT, generateWeek, conflictsFor, lightenItem, draftFromItem, dailySuggestions } from "../engine/planner.js";
import { blockHeader, itemLine, BLOCK_TYPES, ROLES } from "../engine/blocks.js";
import { QUESTIONS, readinessFor, READINESS_TEXT } from "../engine/readiness.js";
import { Card, Contours, Eyebrow, Field, NumInput, Choice, HIcon, PillarDot, dateLabel } from "./kit.jsx";
import { ItemFuel, WeekNutrition } from "./fuel.jsx";

const pillarOfKind = (k) => (k === "kracht" ? "kracht" : k === "duur" ? "duur" : k === "mobiliteit" ? "mobiliteit" : "conditie");
const chip = (on) => ({ borderRadius: 999, border: `1px solid ${on ? C.accent : C.line}`, background: on ? "var(--accent-soft)" : C.panel, color: C.ink, fontWeight: on ? 600 : 500 });

/* ---------------- intake ---------------- */
export function PlanSheet({ initial, onSave, onStop, onClose }) {
  const [s, setS] = useState({ ...SETTINGS_DEFAULT, ...(initial || {}) });
  const set = (p) => setS((x) => ({ ...x, ...p }));
  const toggleDay = (d) => {
    const days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort((a, b) => a - b);
    set({ days, longDay: days.includes(s.longDay) ? s.longDay : days[days.length - 1] });
  };
  const toggleCardio = (k) => set({ cardio: s.cardio.includes(k) ? s.cardio.filter((x) => x !== k) : [...s.cardio, k] });
  const valid = s.days.length >= 2 && s.cardio.length >= 1;
  return (
    <Sheet title={initial ? "Schema aanpassen" : "Uw schema"} onClose={onClose}>
      <div className="space-y-5 pb-2">
        <Field label="Doel">
          <div className="space-y-1.5">
            {Object.entries(GOALS).map(([k, g]) => (
              <button key={k} type="button" onClick={() => set({ goal: k })} className="tap w-full text-left px-3 py-2" style={{ ...chip(s.goal === k), borderRadius: R.field }} aria-pressed={s.goal === k}>
                <span className="block text-sm" style={{ fontWeight: 600 }}>
                  {g.label}
                </span>
                <span className="block text-xs" style={{ color: C.muted, fontWeight: 400 }}>
                  {g.sub}
                </span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Datum van de wedstrijd of het doel (optioneel)" hint="Met een datum bouwt het schema op naar een piek en een taper.">
          <div className="flex gap-2">
            <input
              type="date"
              value={s.goalDate || ""}
              min={localISO()}
              onChange={(e) => set({ goalDate: e.target.value || null })}
              className="flex-1 px-3 py-2.5 text-sm tnum"
              style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink }}
              aria-label="Doeldatum"
            />
            {s.goalDate && (
              <TBtn small kind="ghost" onClick={() => set({ goalDate: null })}>
                Geen datum
              </TBtn>
            )}
          </div>
        </Field>
        <Field label="Op welke dagen traint u?" hint={`${s.days.length} trainingen per week`}>
          <div className="flex gap-1.5">
            {DAY_NAMES.map((n, d) => (
              <button key={d} type="button" onClick={() => toggleDay(d)} className="tap flex-1 py-2 text-sm" style={{ ...chip(s.days.includes(d)), borderRadius: R.field }} aria-pressed={s.days.includes(d)}>
                {n}
              </button>
            ))}
          </div>
        </Field>
        {s.days.length > 0 && (
          <Field label="Dag voor de lange sessie">
            <Choice options={s.days.map((d) => ({ value: d, label: DAY_NAMES[d] }))} value={s.longDay} onChange={(v) => set({ longDay: v })} ariaLabel="Dag voor de lange sessie" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tijd per training">
            <Choice options={[30, 45, 60, 75, 90].map((m) => ({ value: m, label: `${m} min` }))} value={s.minutes} onChange={(v) => set({ minutes: v })} ariaLabel="Tijd per training" />
          </Field>
          <Field label="Lange sessie hoogstens">
            <Choice options={[60, 90, 120, 150, 180].map((m) => ({ value: m, label: m >= 120 ? `${m / 60} u` : `${m} min` }))} value={s.longMinutes} onChange={(v) => set({ longMinutes: v })} ariaLabel="Lange sessie hoogstens" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ervaring kracht">
            <Choice options={Object.entries(EXPERIENCE).map(([value, label]) => ({ value, label }))} value={s.exp.kracht} onChange={(v) => set({ exp: { ...s.exp, kracht: v } })} ariaLabel="Ervaring kracht" />
          </Field>
          <Field label="Ervaring duur">
            <Choice options={Object.entries(EXPERIENCE).map(([value, label]) => ({ value, label }))} value={s.exp.duur} onChange={(v) => set({ exp: { ...s.exp, duur: v } })} ariaLabel="Ervaring duur" />
          </Field>
        </div>
        <Field label="Materiaal">
          <Choice options={Object.entries(EQUIPMENT).map(([value, label]) => ({ value, label }))} value={s.equipment} onChange={(v) => set({ equipment: v })} ariaLabel="Materiaal" />
        </Field>
        <Field label="Duursporten die u wilt doen" hint="Bij een loopdoel is hardlopen de hoofdsport; de rest zorgt voor variatie met minder impact.">
          <div className="flex flex-wrap gap-1.5">
            {["hardlopen", "fietsen", "roeien", "skierg", "zwemmen", "wandelen", "stepper"].map((k) => (
              <button key={k} type="button" onClick={() => toggleCardio(k)} className="tap px-3 py-1.5 text-sm" style={chip(s.cardio.includes(k))} aria-pressed={s.cardio.includes(k)}>
                {SPORTS[k].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Mobiliteit op een rustdag">
          <Choice options={[{ value: true, label: "Ja, 15 min" }, { value: false, label: "Nee" }]} value={!!s.mobility} onChange={(v) => set({ mobility: v })} ariaLabel="Mobiliteit op een rustdag" />
        </Field>
        <Field label="Bijsturen" hint="Bij een voorstel beslist u zelf; automatisch past de app het schema direct aan en laat zien wat er veranderde.">
          <Choice options={[{ value: false, label: "Voorstel eerst" }, { value: true, label: "Automatisch" }]} value={!!s.auto} onChange={(v) => set({ auto: v })} ariaLabel="Bijsturen" />
        </Field>
        <TBtn full disabled={!valid} onClick={() => onSave(s)}>
          {initial ? "Opslaan en week opnieuw plannen" : "Schema maken"}
        </TBtn>
        {initial && onStop && (
          <button type="button" onClick={onStop} className="tap text-sm" style={{ color: C.train }}>
            Schema stoppen
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- details van een geplande sessie ---------------- */
function setLine(it) {
  const sets = it.sets || [];
  if (!sets.length) return null;
  const s0 = sets[0];
  const t = s0.target || {};
  const per = it.perSide ? " per kant" : "";
  const amount = t.sec ? `${t.sec} s` : `${s0.reps || t.reps || "?"}${per}`;
  return `${sets.length} × ${amount}${s0.kg ? ` · ${String(s0.kg).replace(".", ",")} kg` : ""}${t.rir != null ? ` · RIR ${t.rir}` : ""}`;
}

export function BlocksPreview({ blocks }) {
  return (
    <div className="space-y-2.5">
      {(blocks || []).map((b, i) => (
        <div key={b.id || i} className="px-3 py-2.5" style={{ background: C.surface2, borderRadius: R.field }}>
          <div className="eyebrow">
            {b.role ? ROLES[b.role].label : BLOCK_TYPES[b.type].label}
          </div>
          <div className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
            {b.type === "sets" ? "Kracht" : blockHeader(b)}
          </div>
          {b.intensity && <div className="text-xs mt-0.5" style={{ color: C.accent }}>{b.intensity}</div>}
          {b.type === "sets" ? (
            <ul className="mt-1 space-y-0.5">
              {(b.items || []).map((it, k) => (
                <li key={k} className="text-xs flex justify-between gap-2" style={{ color: C.ink }}>
                  <span>{it.name}</span>
                  <span className="tnum" style={{ color: C.muted }}>
                    {setLine(it)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            b.type !== "doorlopend" &&
            b.type !== "interval" && (
              <ul className="mt-1 space-y-0.5">
                {(b.items || []).map((it, k) => (
                  <li key={k} className="text-xs" style={{ color: C.ink }}>
                    {itemLine(it, b)}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      ))}
    </div>
  );
}

export function ItemSheet({ item, weekItems, settings, ctx, onClose, onLog, onReplace, onUpdate, onOpenSession, fuel }) {
  const [moving, setMoving] = useState(false);
  const monday = mondayOf(item.date);
  const preview = (date) => conflictsFor(weekItems.map((x) => (x.id === item.id ? { ...x, date } : x)), monday).filter((c) => c.a === item.id || c.b === item.id);
  const conflicts = preview(item.date);
  const done = item.status === "gedaan";
  return (
    <Sheet title={item.title} onClose={onClose}>
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-2 text-sm" style={{ color: C.muted }}>
          <PillarDot pillar={pillarOfKind(item.kind)} />
          {dateLabel(item.date, { weekday: "long", day: "numeric", month: "long" })}
          {item.targetMin ? ` · ± ${item.targetMin} min` : ""}
          {item.rpeTarget ? ` · inspanning ${item.rpeTarget}/10` : ""}
        </div>
        {item.note && (
          <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
            {item.note}
          </p>
        )}
        {item.changed && (
          <p className="text-xs px-3 py-2" style={{ background: "var(--warn-bg)", color: C.warn, borderRadius: R.field }}>
            Aangepast: {item.changed === "minder" ? "minder volume" : item.changed === "rustig" ? "rustige sessie in plaats van zwaar" : "herstel in plaats van training"}.
          </p>
        )}
        {conflicts.map((c, i) => (
          <p key={i} className="text-xs px-3 py-2" style={{ background: "var(--warn-bg)", color: C.warn, borderRadius: R.field }}>
            {c.text}
          </p>
        ))}
        <BlocksPreview blocks={item.blocks} />
        {fuel}
        {done ? (
          <TBtn full onClick={() => onOpenSession(item.doneId)}>
            Vastgelegde training bekijken
          </TBtn>
        ) : item.status === "overgeslagen" ? (
          <TBtn full kind="ghost" onClick={() => onUpdate({ status: "gepland" })}>
            Toch doen
          </TBtn>
        ) : (
          <div className="space-y-2">
            <TBtn full onClick={() => onLog(draftFromItem(item))}>
              Training vastleggen
            </TBtn>
            {moving ? (
              <div className="p-3 space-y-2" style={{ border: `1px solid ${C.line}`, borderRadius: R.field }}>
                <div className="eyebrow">Naar welke dag?</div>
                <div className="flex gap-1.5">
                  {DAY_NAMES.map((n, d) => {
                    const date = isoOfNum(dayNum(monday) + d);
                    const warn = preview(date).length > 0;
                    const on = date === item.date;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          onUpdate({ date, moved: true });
                          setMoving(false);
                        }}
                        className="tap flex-1 py-2 text-sm"
                        style={{ ...chip(on), borderRadius: R.field, borderColor: warn && !on ? "var(--warn)" : on ? C.accent : C.line }}
                        aria-label={`${n}${warn ? ", geeft een conflict" : ""}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs" style={{ color: C.muted }}>
                  Dagen met een oranje rand geven een conflict met een andere zware sessie.
                </p>
              </div>
            ) : (
              <TBtn full kind="ghost" onClick={() => setMoving(true)}>
                Verplaatsen
              </TBtn>
            )}
            <div className="grid grid-cols-2 gap-2">
              <TBtn kind="ghost" onClick={() => onReplace(lightenItem(item, "minder", ctx, settings))}>
                Iets minder
              </TBtn>
              <TBtn kind="ghost" onClick={() => onReplace(lightenItem(item, item.kind === "kracht" ? "rust" : "rustig", ctx, settings))}>
                {item.kind === "kracht" ? "Herstel ervan maken" : "Rustig ervan maken"}
              </TBtn>
            </div>
            {item.original && (
              <TBtn full kind="ghost" onClick={() => onReplace({ ...item.original, id: item.id, date: item.date, status: item.status })}>
                Oorspronkelijke training terugzetten
              </TBtn>
            )}
            <button type="button" onClick={() => onUpdate({ status: "overgeslagen" })} className="tap text-sm" style={{ color: C.muted }}>
              Overslaan
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- één geplande sessie in een lijst ---------------- */
export function PlanItemRow({ item, onOpen, border = true }) {
  const pillar = pillarOfKind(item.kind);
  const st = item.status;
  return (
    <button onClick={() => onOpen(item)} className="tap w-full text-left flex items-center gap-3 px-4 py-3" style={{ borderTop: border ? `1px solid ${C.lineSoft}` : "none", opacity: st === "overgeslagen" ? 0.55 : 1 }}>
      <span aria-hidden="true" style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: K[pillar].fill, opacity: item.optional ? 0.5 : 1 }} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm truncate" style={{ color: C.ink, fontWeight: 600, textDecoration: st === "overgeslagen" ? "line-through" : "none" }}>
          {item.title}
        </span>
        <span className="block text-xs truncate" style={{ color: C.muted }}>
          {[item.targetMin ? `± ${item.targetMin} min` : null, item.sport && SPORTS[item.sport] ? SPORTS[item.sport].label.toLowerCase() : null, item.optional ? "optioneel" : null, item.changed ? "aangepast" : null, item.moved ? "verplaatst" : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="text-xs shrink-0" style={{ color: st === "gedaan" ? C.accent : C.muted, fontWeight: st === "gedaan" ? 600 : 400 }}>
        {st === "gedaan" ? "✓ gedaan" : st === "overgeslagen" ? "overgeslagen" : ""}
      </span>
    </button>
  );
}

/* ---------------- weekoverzicht ---------------- */
export function WeekView({ data, api, onLog, onOpenSession, nbase }) {
  const today = localISO();
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(null);
  const plan = data.plan;
  const monday = isoOfNum(dayNum(mondayOf(today)) + offset * 7);
  const ctx = { sessions: data.sessions, profile: data.profile, checkins: data.checkins, planItems: plan ? plan.items : [] };

  useEffect(() => {
    if (plan && offset === 0) api.ensureWeek(monday);
  }, [plan && plan.settings, offset, monday]);

  // toekomstige weken: voorbeeld, niet opgeslagen (wordt bij aanvang opnieuw gemaakt met de dan bekende gegevens)
  const preview = useMemo(() => (plan && offset > 0 ? generateWeek(plan.settings, ctx, monday) : null), [plan, offset, monday]);
  if (!plan)
    return (
      <div className="space-y-4">
        <h1 className="disp text-[34px] leading-none" style={{ color: C.ink, fontWeight: 600 }}>
          Week
        </h1>
        <Card className="px-4 py-6">
          <Contours seed={2} />
          <div className="relative">
            <Eyebrow>Adaptief schema</Eyebrow>
            <h2 className="disp text-[24px] leading-tight mt-1" style={{ color: C.ink, fontWeight: 600 }}>
              Een week die met u meebeweegt.
            </h2>
            <p className="text-sm leading-relaxed mt-2" style={{ color: C.muted, maxWidth: "48ch" }}>
              Vertel wat uw doel is en wanneer u kunt trainen. De app verdeelt kracht, duur en conditie zo dat ze elkaar niet in de weg zitten, en past het schema aan op uw herstel.
            </p>
            <div className="mt-4">
              <TBtn onClick={() => setEditing(true)}>Schema maken</TBtn>
            </div>
          </div>
        </Card>
        {editing && <PlanSheet onClose={() => setEditing(false)} onSave={(s) => { api.setPlan(s); setEditing(false); }} />}
      </div>
    );

  const items = preview ? preview.items : plan.items.filter((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6));
  const info = preview ? { phase: preview.phase, phaseInfo: preview.phaseInfo, reasons: preview.reasons, enduranceMin: preview.enduranceMin } : (plan.weeks || {})[monday];
  const goal = GOALS[plan.settings.goal] || GOALS.hybride;
  const ph = info ? PHASES[info.phase] : null;
  const conflicts = conflictsFor(items, monday);
  const extra = data.sessions.filter((s) => s.date >= monday && s.date <= isoOfNum(dayNum(monday) + 6) && !s.planItemId);
  const doneCount = items.filter((x) => x.status === "gedaan" && !x.optional).length;
  const mainCount = items.filter((x) => !x.optional && x.status !== "overgeslagen").length;
  const openItem = open && (preview ? null : plan.items.find((x) => x.id === open));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="disp text-[34px] leading-none" style={{ color: C.ink, fontWeight: 600 }}>
          Week
        </h1>
        <TBtn small kind="ghost" onClick={() => setEditing(true)}>
          Schema aanpassen
        </TBtn>
      </div>
      <div className="flex items-center justify-between">
        <button onClick={() => setOffset(offset - 1)} disabled={offset <= -8} className="tap px-2 py-1 text-sm" style={{ color: C.accent }} aria-label="Vorige week">
          ← vorige
        </button>
        <span className="text-sm tnum" style={{ color: C.ink, fontWeight: 600 }}>
          {offset === 0 ? "Deze week" : `Week van ${dateLabel(monday, { day: "numeric", month: "long" })}`}
        </span>
        <button onClick={() => setOffset(offset + 1)} disabled={offset >= 4} className="tap px-2 py-1 text-sm" style={{ color: C.accent }} aria-label="Volgende week">
          volgende →
        </button>
      </div>

      {ph && (
        <Card className="px-4 py-4">
          <Contours seed={1} />
          <div className="relative">
            <Eyebrow>
              {goal.label}
              {plan.settings.goalDate && info.phaseInfo && info.phaseInfo.weeksLeft != null && info.phaseInfo.weeksLeft > 0 ? ` · nog ${info.phaseInfo.weeksLeft} ${info.phaseInfo.weeksLeft === 1 ? "week" : "weken"}` : ""}
            </Eyebrow>
            <div className="flex items-baseline justify-between gap-3 mt-1">
              <h2 className="disp text-[24px] leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
                {ph.label}
                {info.phaseInfo && !plan.settings.goalDate && info.phase !== "herstel" ? ` · week ${info.phaseInfo.blockWeek + 1} van 4` : ""}
              </h2>
              {offset === 0 && (
                <span className="text-sm tnum" style={{ color: C.muted }}>
                  {doneCount} / {mainCount} gedaan
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed mt-1" style={{ color: C.muted }}>
              {ph.text}
            </p>
            {info.enduranceMin ? <p className="text-xs mt-2 tnum" style={{ color: C.muted }}>Duurvolume deze week: ± {info.enduranceMin} min</p> : null}
            {(info.reasons || []).map((r, i) => (
              <p key={i} className="text-xs mt-2 px-2.5 py-1.5" style={{ background: "var(--accent-soft)", color: C.ink, borderRadius: 8 }}>
                {r}
              </p>
            ))}
            {preview && <p className="text-xs mt-2" style={{ color: C.muted }}>Voorbeeld: deze week wordt definitief gemaakt zodra hij begint, met wat u tot dan heeft gedaan.</p>}
          </div>
        </Card>
      )}

      {conflicts.map((c, i) => (
        <p key={i} className="text-xs px-3 py-2" style={{ background: "var(--warn-bg)", color: C.warn, borderRadius: R.field }}>
          {c.text}
        </p>
      ))}

      <Card>
        {DAY_NAMES.map((n, d) => {
          const date = isoOfNum(dayNum(monday) + d);
          const its = items.filter((x) => x.date === date);
          const ex = extra.filter((s) => s.date === date);
          const isToday = date === today;
          return (
            <div key={d} style={{ borderTop: d ? `1px solid ${C.line}` : "none" }}>
              <div className="px-4 pt-2.5 pb-1 flex items-baseline justify-between">
                <span className="text-xs" style={{ color: isToday ? C.accent : C.muted, fontWeight: isToday ? 600 : 500 }}>
                  {dateLabel(date, { weekday: "long", day: "numeric", month: "short" })}
                  {isToday ? " · vandaag" : ""}
                </span>
              </div>
              {its.length === 0 && ex.length === 0 && (
                <div className="px-4 pb-2.5 text-xs" style={{ color: C.muted }}>
                  {plan.createdOn && date < plan.createdOn ? "Schema nog niet gestart" : "Rust"}
                </div>
              )}
              {its.map((x, k) => (
                <PlanItemRow key={x.id} item={x} border={k > 0} onOpen={(it) => !preview && setOpen(it.id)} />
              ))}
              {ex.map((s) => (
                <button key={s.id} onClick={() => onOpenSession(s.id)} className="tap w-full text-left px-4 py-2 text-xs" style={{ color: C.muted }}>
                  + extra vastgelegd: {s.title || (s.kind === "duur" && SPORTS[s.sport] ? SPORTS[s.sport].label : "training")}
                </button>
              ))}
            </div>
          );
        })}
      </Card>

      {nbase && !preview && <WeekNutrition data={data} base={nbase} monday={monday} />}

      {editing && (
        <PlanSheet
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
          onUpdate={(p) => api.updatePlanItem(openItem.id, p)}
          onReplace={(it) => api.replacePlanItem(it)}
          onOpenSession={(id) => {
            setOpen(null);
            onOpenSession(id);
          }}
          fuel={nbase ? <ItemFuel item={openItem} data={data} base={nbase} /> : null}
        />
      )}
    </div>
  );
}

/* ---------------- herstel-check-in ---------------- */
function Scale({ value, onChange, label, low, high }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1" style={{ color: C.muted }}>
        <span style={{ color: C.ink, fontWeight: 500 }}>{label}</span>
        <span>
          {low} → {high}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className="tap py-1.5 text-sm tnum" style={{ ...chip(value === v), borderRadius: 8, background: value === v ? C.accent : C.panel, color: value === v ? C.onAccent : C.ink }}>
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CheckinCard({ checkins, onSave }) {
  const today = localISO();
  const existing = (checkins || []).find((c) => c.date === today);
  const [editing, setEditing] = useState(!existing);
  const [c, setC] = useState(existing || { date: today, sleepH: 7.5 });
  const [more, setMore] = useState(!!(existing && (existing.hrv || existing.rhr)));
  const r = readinessFor(checkins || [], today);
  if (!editing && existing && r.score != null) {
    const t = READINESS_TEXT[r.level];
    return (
      <Card className="px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow>Herstel vandaag</Eyebrow>
          <button onClick={() => setEditing(true)} className="tap text-xs" style={{ color: C.accent }}>
            Aanpassen
          </button>
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="disp text-[30px] tnum leading-none" style={{ color: C.ink, fontWeight: 600 }}>
            {r.score}
          </span>
          <span className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
            {t.label}
          </span>
        </div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>
          {t.text}
          {r.notes.length ? ` ${r.notes.join(" ")}` : ""}
        </p>
      </Card>
    );
  }
  const filled = QUESTIONS.every((q) => c[q.id]);
  return (
    <Card className="px-4 py-4">
      <Eyebrow>Hoe staat u er vandaag bij?</Eyebrow>
      <p className="text-xs mt-1 mb-3" style={{ color: C.muted }}>
        Tien seconden. De app past uw training erop aan.
      </p>
      <div className="space-y-2.5">
        {QUESTIONS.map((q) => (
          <Scale key={q.id} label={q.label} low={q.low} high={q.high} value={c[q.id]} onChange={(v) => setC({ ...c, [q.id]: v })} />
        ))}
        <Field label="Slaap afgelopen nacht">
          <NumInput value={c.sleepH} onChange={(v) => setC({ ...c, sleepH: v })} unit="uur" step="0.5" ariaLabel="Uren slaap" />
        </Field>
        {more ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="HRV (rMSSD)" hint="van uw horloge of ring">
              <NumInput value={c.hrv} onChange={(v) => setC({ ...c, hrv: v })} unit="ms" step="1" ariaLabel="HRV in milliseconden" />
            </Field>
            <Field label="Rusthartslag">
              <NumInput value={c.rhr} onChange={(v) => setC({ ...c, rhr: v })} unit="bpm" step="1" ariaLabel="Rusthartslag" />
            </Field>
          </div>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="tap text-xs" style={{ color: C.muted }}>
            + HRV en rusthartslag (optioneel)
          </button>
        )}
        <label className="flex items-center gap-2 text-sm" style={{ color: C.ink }}>
          <input type="checkbox" checked={!!c.ill} onChange={(e) => setC({ ...c, ill: e.target.checked || undefined })} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
          Ik voel me ziek
        </label>
        <div className="flex gap-2">
          <TBtn
            disabled={!filled}
            onClick={() => {
              onSave({ ...c, date: today });
              setEditing(false);
            }}
          >
            Opslaan
          </TBtn>
          {existing && (
            <TBtn kind="ghost" onClick={() => setEditing(false)}>
              Annuleren
            </TBtn>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- plan op Vandaag ---------------- */
export function TodayPlan({ data, api, onLog, onOpenSession, nbase }) {
  const plan = data.plan;
  const today = localISO();
  const [open, setOpen] = useState(null);
  const monday = mondayOf(today);
  useEffect(() => {
    if (plan) api.ensureWeek(monday);
  }, [plan && plan.settings, monday]);
  if (!plan) return null;
  const ctx = { sessions: data.sessions, profile: data.profile, checkins: data.checkins, planItems: plan.items };
  const readiness = readinessFor(data.checkins || [], today);
  const week = plan.items.filter((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6));
  const sugs = dailySuggestions(week, today, readiness, plan.settings, ctx).filter((s) => !(plan.applied || {})[s.id]);
  const autoDone = Object.entries(plan.applied || {}).filter(([id, v]) => v === "auto" && week.some((x) => id.endsWith(x.id)));
  const todays = week.filter((x) => x.date === today);
  const openItem = open && plan.items.find((x) => x.id === open);
  return (
    <>
      {sugs.length > 0 && (
        <Card>
          <div className="px-4 pt-3.5 pb-1">
            <Eyebrow>Voorstel</Eyebrow>
          </div>
          {sugs.map((s) => (
            <div key={s.id} className="px-4 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
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
        </Card>
      )}
      {autoDone.length > 0 && plan.settings.auto && (
        <p className="text-xs px-3 py-2" style={{ background: "var(--accent-soft)", color: C.ink, borderRadius: R.field }}>
          Uw schema is deze week automatisch aangepast ({autoDone.length}×). Zie Week voor de details.
        </p>
      )}
      <Card>
        <div className="px-4 pt-3.5 pb-1 flex items-baseline justify-between">
          <Eyebrow>Gepland voor vandaag</Eyebrow>
        </div>
        {todays.length === 0 ? (
          <p className="px-4 pb-3.5 text-sm" style={{ color: C.muted }}>
            Rustdag. Herstel hoort bij de training.
          </p>
        ) : (
          todays.map((x, k) => (
            <div key={x.id}>
              <PlanItemRow item={x} border={k > 0} onOpen={(it) => setOpen(it.id)} />
              {x.status === "gepland" && (
                <div className="px-4 pb-3 flex gap-2">
                  <TBtn small onClick={() => onLog(draftFromItem(x))}>
                    Vastleggen
                  </TBtn>
                  <TBtn small kind="ghost" onClick={() => setOpen(x.id)}>
                    Bekijken
                  </TBtn>
                </div>
              )}
            </div>
          ))
        )}
      </Card>
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
          onUpdate={(p) => api.updatePlanItem(openItem.id, p)}
          onReplace={(it) => api.replacePlanItem(it)}
          onOpenSession={(id) => {
            setOpen(null);
            onOpenSession(id);
          }}
          fuel={nbase ? <ItemFuel item={openItem} data={data} base={nbase} /> : null}
        />
      )}
    </>
  );
}

/* Automatisch bijsturen: voorstellen direct toepassen (eens per voorstel). */
export function useAutoAdjust(data, api, loaded) {
  useEffect(() => {
    if (!loaded || !data.plan || !data.plan.settings.auto) return;
    const today = localISO();
    const monday = mondayOf(today);
    const week = data.plan.items.filter((x) => x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6));
    const ctx = { sessions: data.sessions, profile: data.profile, checkins: data.checkins, planItems: data.plan.items };
    const sugs = dailySuggestions(week, today, readinessFor(data.checkins || [], today), data.plan.settings, ctx).filter((s) => !(data.plan.applied || {})[s.id]);
    // bij twee voorstellen voor dezelfde sessie alleen het eerste
    const seen = new Set();
    const pick = sugs.filter((s) => (seen.has(s.itemId) ? false : (seen.add(s.itemId), true)));
    if (pick.length) api.applySuggestions(pick, ctx, true);
  }, [loaded, data.plan, data.checkins]);
}
