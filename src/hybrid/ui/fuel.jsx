/* Voeding in Nexa Hybrid: doelen per dag, rond de training en voor de
   wedstrijd. Het voedingsprofiel komt uit Nexa (zelfde berekening) of uit
   eigen instellingen. */
import React, { useMemo } from "react";
import { C, R, Section, Row, calcBMR, recommendedProtein, activityFactorOf, stepsOf, ACTIVITY } from "../../App.jsx";
import { localISO, mondayOf, dayNum, isoOfNum, num } from "../engine/model.js";
import { nutritionBase, dayTargets, weekNutrition, sessionsOfDay, fuelingFor, raceNutrition, raceMinutes, hoursToNext, DAY_CLASSES } from "../engine/fuel.js";
import { GOALS } from "../engine/planner.js";
import { Card, Eyebrow, Field, NumInput, Choice, dateLabel } from "./kit.jsx";

const nl = (x) => String(x).replace(".", ",");

/* Voedingsprofiel: Nexa als die er is en gekozen, anders eigen waarden. */
export function useNutritionBase(data, nexa) {
  return useMemo(() => {
    const own = data.nutrition || {};
    const p = data.profile || {};
    const useNexa = own.source !== "eigen" && nexa && num(nexa.weight);
    if (useNexa) {
      const f = nexa;
      const w = num(f.weight, 75);
      const bodyInfo = { sex: f.sex, weight: w, height: Math.max(100, num(f.height, 175)), age: Math.max(12, num(f.age, 30)), bodyFat: num(f.bodyFat, 0), useBodyFat: !!f.useBodyFat };
      let restKcal = null;
      try {
        const bmr = calcBMR(bodyInfo);
        restKcal = bmr * activityFactorOf(bmr, { ...stepsOf(f), weight: w });
      } catch (e) {
        restKcal = null;
      }
      let prot = null;
      try {
        prot = recommendedProtein({ ...bodyInfo, goal: f.goal });
      } catch (e) {
        prot = null;
      }
      return { ...nutritionBase({ ...bodyInfo, goal: f.goal || "onderhoud", rate: num(f.rate, 0), restKcal, proteinPerKg: prot }), source: "nexa" };
    }
    const age = num(own.age) || (num(p.birthYear) ? new Date().getFullYear() - num(p.birthYear) : null);
    if (!num(p.weight) && !num(own.weight)) return null;
    const act = ACTIVITY.find((a) => a.id === (own.activity || "licht")) || ACTIVITY[1];
    return {
      ...nutritionBase({ sex: p.sex, age: age || 30, height: num(own.height, 178), weight: num(own.weight) || num(p.weight), bodyFat: num(own.bodyFat, 0), useBodyFat: !!num(own.bodyFat), goal: own.goal || "onderhoud", rate: num(own.rate, 0), activityFactor: act.factor }),
      source: "eigen",
    };
  }, [data.nutrition, data.profile, nexa]);
}

function Macro({ label, value, unit, sub, color }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
        {color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color }} />}
        {label}
      </div>
      <div className="disp text-2xl tnum leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
        {value}
        <span className="text-sm" style={{ color: C.muted, fontWeight: 500 }}>
          {" "}
          {unit}
        </span>
      </div>
      {sub && <div className="text-xs tnum" style={{ color: C.muted }}>{sub}</div>}
    </div>
  );
}

export function FuelTips({ f }) {
  const rows = [
    ["Vooraf", f.before],
    ["Tijdens", f.during],
    ["Vocht", f.fluids],
    ["Na afloop", f.after],
  ].filter(([, t]) => t);
  return (
    <div className="space-y-1.5">
      {rows.map(([k, t]) => (
        <div key={k} className="grid gap-2 text-xs leading-relaxed" style={{ gridTemplateColumns: "64px 1fr" }}>
          <span style={{ color: C.muted, fontWeight: 500 }}>{k}</span>
          <span style={{ color: C.ink }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Vandaag ---------------- */
export function NutritionToday({ data, base }) {
  const today = localISO();
  const tomorrow = isoOfNum(dayNum(today) + 1);
  const items = data.plan ? data.plan.items : [];
  const todays = sessionsOfDay(today, data.sessions, items);
  const t = dayTargets(base, todays, sessionsOfDay(tomorrow, data.sessions, items));
  const main = todays.filter((s) => s.kind !== "mobiliteit");
  return (
    <Card className="px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>Voeding vandaag</Eyebrow>
        <span className="text-xs" style={{ color: C.muted }}>
          {base.source === "nexa" ? "profiel uit Nexa" : "eigen profiel"}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <h2 className="disp text-[22px] leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
          {t.label}
        </h2>
        {t.reasons.length > 0 && <span className="text-xs" style={{ color: C.muted }}>· {t.reasons.join(", ")}</span>}
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        <Macro label="Energie" value={t.kcal} unit="kcal" />
        <Macro label="Kh" value={t.carbs} unit="g" sub={`${nl(t.carbsPerKg)} g/kg`} color="var(--carb-fill)" />
        <Macro label="Eiwit" value={t.protein} unit="g" color="var(--pro-fill)" />
        <Macro label="Vet" value={t.fat} unit="g" color="var(--fat-fill)" />
      </div>
      {t.exercise > 0 && (
        <p className="text-xs mt-2 tnum" style={{ color: C.muted }}>
          Waarvan ± {t.exercise} kcal voor de training.
        </p>
      )}
      {t.notes.map((n, i) => (
        <p key={i} className="text-xs mt-2 px-2.5 py-1.5 leading-relaxed" style={{ background: "var(--warn-bg)", color: C.warn, borderRadius: 8 }}>
          {n}
        </p>
      ))}
      {main.slice(0, 2).map((s) => (
        <div key={s.id} className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
          <div className="text-xs mb-1.5" style={{ color: C.ink, fontWeight: 600 }}>
            Rond {s.title ? s.title.toLowerCase() : "de training"}
          </div>
          <FuelTips f={fuelingFor(s, base.weight, { nextWithinHours: hoursToNext(s, data.sessions, items) === 6 ? 6 : null })} />
        </div>
      ))}
      <a href="/app/" className="tap inline-block text-xs mt-3" style={{ color: C.accent, fontWeight: 600 }}>
        Maaltijden plannen in Nexa →
      </a>
    </Card>
  );
}

/* ---------------- week ---------------- */
export function WeekNutrition({ data, base, monday }) {
  const days = weekNutrition(base, monday, data.sessions, data.plan ? data.plan.items : []);
  const max = Math.max(...days.map((d) => d.carbs), 1);
  return (
    <Card className="px-4 py-4">
      <Eyebrow className="mb-2">Koolhydraten deze week</Eyebrow>
      <div className="space-y-1.5">
        {days.map((d) => (
          <div key={d.date} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: "34px 1fr 74px" }}>
            <span style={{ color: d.date === localISO() ? C.accent : C.muted, fontWeight: d.date === localISO() ? 600 : 500 }}>{dateLabel(d.date, { weekday: "short" })}</span>
            <span className="block" style={{ height: 10, background: C.surface2, borderRadius: 4 }} title={`${DAY_CLASSES[d.cls].label}: ${d.carbs} g`}>
              <span className="block" style={{ width: `${(d.carbs / max) * 100}%`, height: 10, background: "var(--carb-fill)", borderRadius: 4 }} />
            </span>
            <span className="tnum text-right" style={{ color: C.ink }}>
              {d.carbs} g · {nl(d.carbsPerKg)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs mt-2.5 leading-relaxed" style={{ color: C.muted }}>
        Meer koolhydraten op zware dagen en de dag ervoor, minder op rustdagen. In grammen per dag en per kilo lichaamsgewicht.
      </p>
    </Card>
  );
}

/* ---------------- bij een geplande sessie ---------------- */
export function ItemFuel({ item, data, base }) {
  if (!base) return null;
  if (item.slot === "RACE" && data.plan) {
    const goal = data.plan.settings.goal;
    const r = raceNutrition(goal, base.weight, raceMinutes(goal, data.profile));
    return (
      <div className="px-3 py-3 space-y-1.5" style={{ background: C.surface2, borderRadius: R.field }}>
        <div className="eyebrow">Wedstrijdvoeding · verwachte duur ± {Math.round(r.estMinutes)} min</div>
        <FuelTips f={{ before: r.loading, during: r.during, after: r.after }} />
        <div className="grid gap-2 text-xs leading-relaxed" style={{ gridTemplateColumns: "64px 1fr" }}>
          <span style={{ color: C.muted, fontWeight: 500 }}>Ochtend</span>
          <span style={{ color: C.ink }}>{r.breakfast}</span>
          <span style={{ color: C.muted, fontWeight: 500 }}>Cafeïne</span>
          <span style={{ color: C.ink }}>{r.caffeine}</span>
        </div>
      </div>
    );
  }
  if (item.kind === "mobiliteit") return null;
  return (
    <div className="px-3 py-3" style={{ background: C.surface2, borderRadius: R.field }}>
      <div className="eyebrow mb-1.5">Voeding rond deze training</div>
      <FuelTips f={fuelingFor(item, base.weight, { nextWithinHours: hoursToNext(item, data.sessions, data.plan ? data.plan.items : []) === 6 ? 6 : null })} />
    </div>
  );
}

/* ---------------- profiel ---------------- */
export function NutritionSection({ data, api, nexa, base }) {
  const own = data.nutrition || {};
  const hasNexa = !!(nexa && num(nexa.weight));
  const source = own.source === "eigen" || !hasNexa ? "eigen" : "nexa";
  return (
    <Section title="Voeding" accent="var(--carb-fill)" sub="Uw dagelijkse energie en koolhydraten bewegen mee met de training. Eiwit en het tempo van afvallen of aankomen komen uit uw doel.">
      <div className="px-4 py-4 space-y-4">
        {hasNexa && (
          <Field label="Profiel">
            <Choice options={[{ value: "nexa", label: "Uit Nexa" }, { value: "eigen", label: "Eigen instellingen" }]} value={source} onChange={(v) => api.setNutrition({ source: v })} ariaLabel="Bron van het voedingsprofiel" />
          </Field>
        )}
        {source === "nexa" ? (
          <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
            Doel <strong>{nexa.goal === "cut" ? "vetverlies" : nexa.goal === "bulk" ? "opbouwen" : "onderhoud"}</strong>
            {nexa.goal !== "onderhoud" && num(nexa.rate) ? ` (${nl(Math.abs(num(nexa.rate)))}% per week)` : ""}, {nl(num(nexa.weight))} kg. Wijzig dit in Nexa; Hybrid rekent met hetzelfde rustverbruik en eiwit.
          </p>
        ) : (
          <>
            <Field label="Doel">
              <Choice options={[{ value: "cut", label: "Vetverlies" }, { value: "onderhoud", label: "Onderhoud" }, { value: "bulk", label: "Opbouwen" }]} value={own.goal || "onderhoud"} onChange={(v) => api.setNutrition({ goal: v, rate: v === "cut" ? -0.5 : v === "bulk" ? 0.25 : 0 })} ariaLabel="Voedingsdoel" />
            </Field>
            {own.goal && own.goal !== "onderhoud" && (
              <Field label="Tempo per week (% lichaamsgewicht)">
                <Choice
                  options={(own.goal === "cut" ? [-0.25, -0.5, -0.75] : [0.125, 0.25, 0.5]).map((v) => ({ value: v, label: `${nl(Math.abs(v))}%` }))}
                  value={num(own.rate)}
                  onChange={(v) => api.setNutrition({ rate: v })}
                  ariaLabel="Tempo per week"
                />
              </Field>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Gewicht">
                <NumInput value={own.weight ?? data.profile.weight} onChange={(v) => api.setNutrition({ weight: v })} unit="kg" ariaLabel="Gewicht" />
              </Field>
              <Field label="Lengte">
                <NumInput value={own.height} onChange={(v) => api.setNutrition({ height: v })} unit="cm" step="1" ariaLabel="Lengte" />
              </Field>
              <Field label="Vet % (opt.)">
                <NumInput value={own.bodyFat} onChange={(v) => api.setNutrition({ bodyFat: v })} unit="%" ariaLabel="Vetpercentage" />
              </Field>
            </div>
            <Field label="Dagelijkse beweging buiten de training">
              <Choice options={ACTIVITY.map((a) => ({ value: a.id, label: a.label }))} value={own.activity || "licht"} onChange={(v) => api.setNutrition({ activity: v })} ariaLabel="Dagelijkse beweging" />
            </Field>
          </>
        )}
        {base && (
          <p className="text-xs tnum" style={{ color: C.muted }}>
            Rustverbruik ± {Math.round(base.rest)} kcal · eiwit {nl(Math.round(base.protein * 10) / 10)} g/kg
            {base.delta ? ` · ${base.delta < 0 ? "tekort" : "overschot"} ± ${Math.abs(Math.round(base.delta))} kcal per dag` : ""}
          </p>
        )}
      </div>
    </Section>
  );
}
