/* Activiteiten uit Strava (postvak) samenvoegen met de eigen sessies.

   - Nieuw: wordt een sessie met bron "strava"; inspanning nog invullen.
   - Al bekend (zelfde Strava-id): meetwaarden bijwerken, eigen invoer
     (inspanning, notitie, soort, blokken, koppeling met het plan) blijft.
   - Dezelfde training al handmatig of uit een bestand vastgelegd (zelfde
     dag, sport en ongeveer dezelfde duur): niet dubbel, alleen het
     Strava-id erbij.
   - Past bij een geplande sessie op die dag: daaraan gekoppeld en als
     gedaan gemarkeerd; een duursessie neemt het soort over (bijv.
     intervallen).
   - Verwijderd in Strava: ook hier weg, en de geplande sessie weer open. */

import { newSession, SPORTS, KINDS } from "./model.js";

const METRIC_FIELDS = ["durationSec", "distanceM", "avgHr", "maxHr", "avgPower", "elevGain", "hrHist", "startTime", "name", "trainer", "stravaType"];

const sameKind = (a, s) => (a.kind === "duur" ? s.kind === "duur" && (!a.sport || !s.sport || a.sport === s.sport) : a.kind === "wod" ? s.kind === "wod" || s.kind === "hyrox" : a.kind === s.kind);

function planMatch(a, items, takenIds) {
  if (!items) return null;
  return (
    items.find((x) => x.date === a.date && x.status === "gepland" && !takenIds.has(x.id) && !x.optional && x.slot !== "M_MOB" && sameKind(a, x)) ||
    (a.kind === "mobiliteit" ? items.find((x) => x.date === a.date && x.status === "gepland" && x.slot === "M_MOB" && !takenIds.has(x.id)) : null)
  );
}

export function mergeInbox(sessions, planItems, rows) {
  let ss = [...sessions];
  let items = planItems ? planItems.map((x) => ({ ...x })) : null;
  const summary = { added: 0, updated: 0, removed: 0, linked: 0, duplicates: 0 };
  const taken = new Set();
  const ordered = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  for (const row of ordered) {
    const ext = String(row.external_id);
    const idx = ss.findIndex((s) => s.externalId === ext);
    if (row.deleted) {
      if (idx >= 0) {
        const gone = ss[idx];
        ss = ss.filter((_, i) => i !== idx);
        if (items && gone.planItemId) items = items.map((x) => (x.id === gone.planItemId ? { ...x, status: "gepland", doneId: undefined } : x));
        summary.removed++;
      }
      continue;
    }
    const a = row.activity;
    if (!a || !a.date || !KINDS[a.kind]) continue;
    const metrics = Object.fromEntries(METRIC_FIELDS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
    if (idx >= 0) {
      ss = ss.map((s, i) => (i === idx ? { ...s, ...metrics, date: a.date, ...(s.kind === "duur" && a.sport ? { sport: s.sportEdited ? s.sport : a.sport } : {}) } : s));
      summary.updated++;
      continue;
    }
    // dezelfde training al vastgelegd?
    const dup = ss.find((s) => !s.externalId && s.date === a.date && sameKind(a, s) && s.durationSec && a.durationSec && Math.abs(s.durationSec - a.durationSec) / a.durationSec < 0.1);
    if (dup) {
      ss = ss.map((s) => (s === dup ? { ...s, externalId: ext } : s));
      summary.duplicates++;
      continue;
    }
    const match = planMatch(a, items, taken);
    const extra = { ...metrics, date: a.date, source: "strava", externalId: ext, needsRpe: true };
    if (a.kind === "duur") extra.sport = SPORTS[a.sport] ? a.sport : "multisport";
    if (match) {
      extra.planItemId = match.id;
      if (a.kind === "duur" && match.type) extra.type = match.type;
      if (match.kind !== "duur" && match.title) extra.title = match.title;
    }
    const s = newSession(a.kind, extra);
    ss.push(s);
    summary.added++;
    if (match) {
      taken.add(match.id);
      items = items.map((x) => (x.id === match.id ? { ...x, status: "gedaan", doneId: s.id } : x));
      summary.linked++;
    }
  }
  return { sessions: ss, planItems: items, summary };
}
