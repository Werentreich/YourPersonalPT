/* Opslag van Nexa Hybrid.
   - macroverdeling:hybrid:v1   profiel en sessies; het voorvoegsel zorgt dat
     het Nexa-account dit synchroniseert (src/sync.js).
   - nexa:hybrid-route:<id>     routes (GPS) alleen op dit apparaat: locatie
     is extra gevoelig (plan §9). Het voorvoegsel "nexa:" valt buiten de sync
     en wordt gewist bij uitloggen met wissen. */
import { useEffect, useRef, useState } from "react";
import { STORE_DEFAULT, normalizeStore, newId } from "./engine/model.js";
import { blockHeader, freshBlock, itemLine } from "./engine/blocks.js";

export const HYBRID_KEY = "macroverdeling:hybrid:v1";
export const NEXA_KEY = "macroverdeling:v1";
export const ROUTE_PREFIX = "nexa:hybrid-route:";
const SAVE_DELAY = 600;

export function useHybridStore() {
  const [data, setData] = useState(STORE_DEFAULT);
  const [loaded, setLoaded] = useState(false);
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
        return { ...d, sessions };
      });
    },
    deleteSession(id) {
      setData((d) => ({ ...d, sessions: d.sessions.filter((x) => x.id !== id) }));
      try {
        window.storage && window.storage.delete(ROUTE_PREFIX + id);
      } catch (e) {
        /* geen route */
      }
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
    saveRoute(id, route) {
      if (!route || !window.storage) return;
      try {
        window.storage.set(ROUTE_PREFIX + id, JSON.stringify(route));
      } catch (e) {
        /* te groot of geen opslag: route vervalt, sessie blijft */
      }
    },
  };
  return [data, api, loaded];
}
