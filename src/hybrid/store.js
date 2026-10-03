/* Opslag van Nexa Hybrid.
   - macroverdeling:hybrid:v1   profiel en sessies; het voorvoegsel zorgt dat
     het Nexa-account dit synchroniseert (src/sync.js).
   - nexa:hybrid-route:<id>     routes (GPS) alleen op dit apparaat: locatie
     is extra gevoelig (plan §9). Het voorvoegsel "nexa:" valt buiten de sync
     en wordt gewist bij uitloggen met wissen. */
import { useEffect, useRef, useState } from "react";
import { STORE_DEFAULT, normalizeStore, newId, localISO, mondayOf, dayNum, isoOfNum } from "./engine/model.js";
import { generateWeek, applySuggestion } from "./engine/planner.js";
import { mergeInbox } from "./engine/inbox.js";
import { blockHeader, freshBlock, itemLine } from "./engine/blocks.js";

export const HYBRID_KEY = "macroverdeling:hybrid:v1";
export const NEXA_KEY = "macroverdeling:v1";
export const ROUTE_PREFIX = "nexa:hybrid-route:";
const SAVE_DELAY = 600;

export function useHybridStore() {
  const [data, setData] = useState(STORE_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [nexa, setNexa] = useState(null); // voedingsprofiel uit Nexa (f), alleen in het geheugen
  const skipSave = useRef(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      let d = null;
      try {
        const r = window.storage ? await window.storage.get(HYBRID_KEY) : null;
        d = r && r.value ? JSON.parse(r.value) : null;
      } catch (e) {
        d = null; // nog niets bewaard
      }
      let next = normalizeStore(d);
      let nexaF = null;
      try {
        const r = await window.storage.get(NEXA_KEY);
        nexaF = r && r.value ? (JSON.parse(r.value) || {}).f || null : null;
      } catch (e) {
        nexaF = null; // geen Nexa-profiel op dit apparaat
      }
      if (alive) setNexa(nexaF);
      // eerste keer: geslacht, leeftijd en gewicht uit Nexa overnemen
      if (!d) {
        try {
          const r = await window.storage.get(NEXA_KEY);
          const f = r && r.value ? (JSON.parse(r.value) || {}).f : null;
          if (f) {
            next = {
              ...next,
              profile: {
                ...next.profile,
                sex: f.sex === "vrouw" ? "vrouw" : "man",
                birthYear: f.age ? new Date().getFullYear() - Number(f.age) : null,
                weight: f.weight ? Number(f.weight) : null,
                fromNexa: true,
              },
            };
          }
        } catch (e) {
          /* geen Nexa-profiel */
        }
      }
      if (alive) {
        setData(next);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      try {
        window.storage && window.storage.set(HYBRID_KEY, JSON.stringify(data));
      } catch (e) {
        /* opslag niet beschikbaar: alleen voor deze sessie */
      }
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [data, loaded]);

  const api = {
    saveSession(s) {
      setData((d) => {
        const exists = d.sessions.some((x) => x.id === s.id);
        const sessions = exists ? d.sessions.map((x) => (x.id === s.id ? s : x)) : [...d.sessions, s];
        // vastgelegd vanuit het plan: die geplande sessie is gedaan
        const plan = s.planItemId && d.plan ? { ...d.plan, items: d.plan.items.map((x) => (x.id === s.planItemId ? { ...x, status: "gedaan", doneId: s.id } : x)) } : d.plan;
        return { ...d, sessions, plan };
      });
    },
    deleteSession(id) {
      setData((d) => ({
        ...d,
        sessions: d.sessions.filter((x) => x.id !== id),
        plan: d.plan ? { ...d.plan, items: d.plan.items.map((x) => (x.doneId === id ? { ...x, status: "gepland", doneId: undefined } : x)) } : d.plan,
      }));
      try {
        window.storage && window.storage.delete(ROUTE_PREFIX + id);
      } catch (e) {
        /* geen route */
      }
    },
    /* Activiteiten uit het Strava-postvak samenvoegen. */
    applyInbox(rows, onSummary) {
      setData((d) => {
        const m = mergeInbox(d.sessions, d.plan ? d.plan.items : null, rows);
        if (onSummary) setTimeout(() => onSummary(m.summary), 0);
        return { ...d, sessions: m.sessions, plan: d.plan ? { ...d.plan, items: m.planItems } : d.plan };
      });
    },
    setIntegration(name, patch) {
      setData((d) => ({ ...d, integrations: { ...(d.integrations || {}), [name]: { ...((d.integrations || {})[name] || {}), ...patch } } }));
    },
    setNutrition(patch) {
      setData((d) => ({ ...d, nutrition: { ...(d.nutrition || {}), ...patch } }));
    },
    setProfile(patch) {
      setData((d) => ({ ...d, profile: { ...d.profile, ...patch } }));
    },
    /* Eigen template: een blok zonder resultaat, om later te hergebruiken. */
    saveTemplate(b) {
      const block = freshBlock(b);
      const t = { id: newId(), label: b.name || blockHeader(b), sub: b.name ? blockHeader(b, { withName: false }) : (b.items || []).map((it) => itemLine(it, b)).join(", "), block };
      setData((d) => ({ ...d, templates: [t, ...(d.templates || [])].slice(0, 100) }));
    },
    deleteTemplate(id) {
      setData((d) => ({ ...d, templates: (d.templates || []).filter((t) => t.id !== id) }));
    },
    /* ---- herstel ---- */
    saveCheckin(c) {
      setData((d) => ({ ...d, checkins: [...(d.checkins || []).filter((x) => x.date !== c.date), c].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-400) }));
    },

    /* ---- plan ----
       Instellen of wijzigen: de lopende week wordt opnieuw gemaakt vanaf
       vandaag; wat al gedaan of overgeslagen is blijft staan. */
    setPlan(settings) {
      setData((d) => {
        const today = localISO();
        const monday = mondayOf(today);
        const prev = d.plan;
        const s = { ...settings, startDate: (prev && prev.settings.startDate) || monday };
        const keep = prev ? prev.items.filter((x) => x.date < today || x.status !== "gepland") : [];
        const ctx = { sessions: d.sessions, profile: d.profile, checkins: d.checkins, planItems: keep };
        const wk = generateWeek(s, ctx, monday);
        const busy = new Set(keep.filter((x) => x.date >= monday && x.status === "gedaan").map((x) => x.date));
        const fresh = wk.items.filter((x) => x.date >= today && !busy.has(x.date));
        const items = [...keep.filter((x) => !(x.date >= today && x.status === "gepland")), ...fresh];
        const weeks = { ...((prev && prev.weeks) || {}), [monday]: { phase: wk.phase, phaseInfo: wk.phaseInfo, reasons: wk.reasons, factor: wk.factor, enduranceMin: wk.enduranceMin } };
        return { ...d, plan: { settings: s, items, weeks, applied: (prev && prev.applied) || {}, createdOn: (prev && prev.createdOn) || today } };
      });
    },
    stopPlan() {
      setData((d) => ({ ...d, plan: null }));
    },
    /* De week maken als die er nog niet is (eens per week, bij openen). */
    ensureWeek(monday) {
      setData((d) => {
        if (!d.plan || (d.plan.weeks || {})[monday]) return d;
        if (monday < mondayOf(d.plan.settings.startDate || monday)) return d;
        const ctx = { sessions: d.sessions, profile: d.profile, checkins: d.checkins, planItems: d.plan.items };
        const wk = generateWeek(d.plan.settings, ctx, monday);
        const others = d.plan.items.filter((x) => !(x.date >= monday && x.date <= isoOfNum(dayNum(monday) + 6) && x.status === "gepland"));
        return {
          ...d,
          plan: {
            ...d.plan,
            items: [...others, ...wk.items],
            weeks: { ...d.plan.weeks, [monday]: { phase: wk.phase, phaseInfo: wk.phaseInfo, reasons: wk.reasons, factor: wk.factor, enduranceMin: wk.enduranceMin } },
          },
        };
      });
    },
    updatePlanItem(id, patch) {
      setData((d) => (d.plan ? { ...d, plan: { ...d.plan, items: d.plan.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) } } : d));
    },
    replacePlanItem(item) {
      setData((d) => (d.plan ? { ...d, plan: { ...d.plan, items: d.plan.items.map((x) => (x.id === item.id ? item : x)) } } : d));
    },
    applySuggestions(sugs, ctx, auto = false) {
      setData((d) => {
        if (!d.plan) return d;
        let items = d.plan.items;
        for (const sg of sugs) items = applySuggestion(items, sg, ctx, d.plan.settings);
        const applied = { ...(d.plan.applied || {}) };
        for (const sg of sugs) applied[sg.id] = auto ? "auto" : "ja";
        return { ...d, plan: { ...d.plan, items, applied } };
      });
    },
    dismissSuggestion(id) {
      setData((d) => (d.plan ? { ...d, plan: { ...d.plan, applied: { ...(d.plan.applied || {}), [id]: "nee" } } } : d));
    },
    saveRoute(id, route) {
      if (!route || !window.storage) return;
      try {
        window.storage.set(ROUTE_PREFIX + id, JSON.stringify(route));
      } catch (e) {
        /* te groot of geen opslag: route vervalt, sessie blijft */
      }
    },
  };
  return [data, api, loaded, nexa];
}
