/* Voeding van Nexa laten meebewegen met het prestatieschema.

   Nexa rekent per dag met één training (soort, minuten, starttijd) en telt
   het verbruik daarvan bij de dag op; meer verbruik betekent meer
   koolhydraten. Voor kracht, hybride, hardlopen en conditie komt die dag
   uit het schema: alle sessies van die dag samen, met het verbruik per
   kilo lichaamsgewicht uit de prestatiemotor (MET per sport en soort,
   Ainsworth 2011), zodat een rustige fietstocht minder telt dan intervallen.
   Puur JavaScript. */
import { dayNum, isoOfNum, mondayOf } from "../hybrid/engine/model.js";
import { sessionKcal } from "../hybrid/engine/fuel.js";
import { DEFAULT_TIME } from "../hybrid/engine/ics.js";

const TYPE_OF = { kracht: "kracht", wod: "hiit", hyrox: "hiit", duur: "duur", mobiliteit: "kracht" };

/* Zeven dagen (ma..zo) van de week van todayISO: null of een Nexa-sessie. */
export function perfWeekSessions(data, todayISO) {
  const plan = data && data.plan;
  if (!plan) return null;
  const monday = mondayOf(todayISO);
  const time = (data.calendar && data.calendar.time) || DEFAULT_TIME;
  return Array.from({ length: 7 }, (_, d) => {
    const iso = isoOfNum(dayNum(monday) + d);
    const its = plan.items.filter((x) => x.date === iso && !x.optional && x.status !== "overgeslagen" && x.kind !== "mobiliteit");
    if (!its.length) return null;
    const per = its.map((x) => ({ x, kg: sessionKcal({ ...x, planned: true }, 100) / 100 }));
    const main = per.reduce((a, b) => (b.kg > a.kg ? b : a));
    const morningOnly = its.every((x) => x.part === "ochtend");
    return {
      type: TYPE_OF[main.x.kind] || "kracht",
      minutes: its.reduce((a, x) => a + (x.targetMin || 0), 0) || 45,
      start: morningOnly ? "07:00" : time,
      kcalKg: Math.round(per.reduce((a, p) => a + p.kg, 0) * 100) / 100,
      label: its.map((x) => x.title).join(" + "),
      perf: true,
    };
  });
}

/* Nieuwe week voor Nexa, of null als er niets verandert. */
export function syncPerfWeek(week, data, todayISO) {
  const ps = perfWeekSessions(data, todayISO);
  if (!ps || !Array.isArray(week)) return null;
  const next = week.map((d, i) => ({ ...d, session: ps[i] }));
  const same = next.every((d, i) => JSON.stringify(d.session || null) === JSON.stringify(week[i].session || null));
  return same ? null : next;
}
