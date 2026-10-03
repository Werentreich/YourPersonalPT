/* Koppelingen: Strava. Eerst uitdrukkelijke toestemming (wat er gebeurt met
   de gegevens), dan de toestemmingspagina van Strava. */
import React, { useEffect, useRef, useState } from "react";
import { C, R, Section, Row, Sheet, TBtn } from "../../App.jsx";
import { stravaCall, stravaEnabled, connectStrava, pullInbox, clearInboxRows } from "../strava.js";
import { titleOf } from "../engine/blocks.js";
import { Card, Eyebrow, dateLabel } from "./kit.jsx";
import { sessionFacts } from "./screens.jsx";

const STRAVA_ORANGE = "#FC4C02";

function ConsentSheet({ onClose, onOk }) {
  const [ok, setOk] = useState(false);
  return (
    <Sheet title="Strava koppelen" onClose={onClose}>
      <div className="space-y-3 text-sm leading-relaxed pb-2" style={{ color: C.ink }}>
        <p>Na het koppelen komen uw activiteiten uit Strava vanzelf in Nexa Hybrid: sport, datum, tijd, afstand, hoogtemeters, hartslag en vermogen.</p>
        <ul className="space-y-1.5 text-xs" style={{ color: C.muted }}>
          <li>· Een nieuwe activiteit staat kort in een postvak op onze server en wordt verwijderd zodra de app hem heeft opgehaald (uiterlijk na 60 dagen).</li>
          <li>· Routes (GPS) slaan we niet op.</li>
          <li>· De toegangssleutels van Strava staan alleen op onze server, nooit in de app.</li>
          <li>· Uw Strava-gegevens worden alleen aan u getoond en niet gebruikt om AI-modellen te trainen.</li>
          <li>· Ontkoppelen kan altijd, hier of in Strava; dan verwijderen we de koppeling en het postvak.</li>
        </ul>
        <label className="flex gap-2.5 items-start text-xs cursor-pointer" style={{ color: C.muted }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5 shrink-0" style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
          <span>
            Ik geef <strong style={{ color: C.ink }}>uitdrukkelijk toestemming</strong> dat Nexa mijn trainingsgegevens uit Strava, waaronder hartslag, verwerkt zoals hierboven beschreven.
          </span>
        </label>
        <button type="button" disabled={!ok} onClick={onOk} className="tap w-full py-3 text-sm" style={{ background: STRAVA_ORANGE, color: "#FFFFFF", borderRadius: R.field, fontWeight: 600, opacity: ok ? 1 : 0.45 }}>
          Verder naar Strava
        </button>
      </div>
    </Sheet>
  );
}

export function StravaSection({ data, api, nx, acc, refreshKey }) {
  const [enabled, setEnabled] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [consent, setConsent] = useState(false);
  const loggedIn = !!(nx && nx.user);

  const load = async () => {
    const on = await stravaEnabled();
    setEnabled(on);
    if (on && loggedIn && !acc.locked) {
      try {
        setStatus(await stravaCall("status"));
      } catch (e) {
        setStatus(null);
      }
    }
  };
  useEffect(() => {
    load();
    // terug in de app na de toestemmingspagina (systeembrowser in de eigen app)
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loggedIn, acc.locked, refreshKey]);

  const act = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "fout", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (enabled === false) body = <p className="text-sm" style={{ color: C.muted }}>De koppeling met Strava is nog niet ingeschakeld. Tot die tijd kunt u activiteiten importeren als FIT-, GPX- of TCX-bestand via Training vastleggen.</p>;
  else if (!loggedIn) body = <p className="text-sm" style={{ color: C.muted }}>Log in met uw Nexa-account om Strava te koppelen.</p>;
  else if (acc.locked) body = <p className="text-sm" style={{ color: C.muted }}>De koppeling met Strava hoort bij Nexa Hybrid.</p>;
  else if (status && status.connected)
    body = (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: C.ink }}>
          Gekoppeld{status.athlete ? ` als ${status.athlete}` : ""}. Nieuwe activiteiten komen vanzelf binnen.
        </p>
        <div className="flex flex-wrap gap-2">
          <TBtn
            small
            disabled={busy}
            onClick={() =>
              act(async () => {
                const d = await stravaCall("sync");
                const rows = await pullInbox();
                if (rows.length) api.applyInbox(rows);
                await clearInboxRows(rows.map((x) => x.id));
                setMsg({ tone: "ok", text: d.count ? `${d.count} activiteiten van de laatste 14 dagen opgehaald.` : "Geen nieuwe activiteiten in de laatste 14 dagen." });
              })
            }
          >
            Laatste 14 dagen ophalen
          </TBtn>
          <TBtn
            small
            kind="ghost"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await stravaCall("disconnect");
                api.setIntegration("strava", { disconnectedAt: new Date().toISOString() });
                setStatus({ connected: false });
                setMsg({ tone: "ok", text: "Strava is ontkoppeld. Eerder opgehaalde trainingen blijven in de app staan." });
              })
            }
          >
            Ontkoppelen
          </TBtn>
        </div>
      </div>
    );
  else
    body = (
      <div className="space-y-2">
        <p className="text-sm" style={{ color: C.muted }}>
          Koppel Strava en uw activiteiten komen vanzelf binnen, ook van uw horloge (Garmin, Coros, Polar, Suunto, Wahoo) als dat met Strava synchroniseert.
        </p>
        <button type="button" disabled={busy || enabled == null} onClick={() => setConsent(true)} className="tap px-4 py-2.5 text-sm" style={{ background: STRAVA_ORANGE, color: "#FFFFFF", borderRadius: R.field, fontWeight: 600 }}>
          Koppelen met Strava
        </button>
      </div>
    );

  return (
    <Section title="Koppelingen" accent="var(--tide-fill)">
      <div className="px-4 py-4 space-y-2">
        <div className="eyebrow">Strava</div>
        {body}
        {msg && (
          <p className="text-xs" style={{ color: msg.tone === "fout" ? C.train : C.accent }} role="status">
            {msg.text}
          </p>
        )}
        <p className="text-[11px]" style={{ color: C.muted }}>
          Powered by Strava
        </p>
      </div>
      {consent && (
        <ConsentSheet
          onClose={() => setConsent(false)}
          onOk={() =>
            act(async () => {
              api.setIntegration("strava", { consentAt: new Date().toISOString() });
              await connectStrava();
            })
          }
        />
      )}
    </Section>
  );
}

/* Postvak ophalen bij openen en bij terugkeren naar de app. */
export function useStravaInbox(api, nx, acc, loaded, onNotice) {
  const busy = useRef(false);
  useEffect(() => {
    if (!loaded || !nx || !nx.user || acc.locked) return;
    const pull = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const rows = await pullInbox();
        if (rows.length) {
          api.applyInbox(rows, (s) => {
            const parts = [];
            if (s.added) parts.push(`${s.added} ${s.added === 1 ? "nieuwe training" : "nieuwe trainingen"}`);
            if (s.linked) parts.push(`${s.linked} gekoppeld aan uw schema`);
            if (s.removed) parts.push(`${s.removed} verwijderd`);
            if (parts.length) onNotice(`Uit Strava: ${parts.join(", ")}.`);
          });
          await clearInboxRows(rows.map((x) => x.id));
        }
      } catch (e) {
        /* geen verbinding of geen koppeling: later opnieuw */
      } finally {
        busy.current = false;
      }
    };
    pull();
    const onVis = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loaded, nx && nx.user && nx.user.id, acc.locked]);
}

/* Op Vandaag: trainingen uit Strava waarvan de inspanning nog ontbreekt. */
export function NeedsRpeCard({ sessions, onOpen }) {
  const list = sessions.filter((s) => s.needsRpe && s.rpe == null).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  if (!list.length) return null;
  return (
    <Card>
      <div className="px-4 pt-3.5 pb-1">
        <Eyebrow>Inspanning invullen</Eyebrow>
        <p className="text-xs mt-0.5" style={{ color: C.muted }}>
          Uit Strava binnengekomen. Met uw inspanning (0–10) wordt de belasting preciezer.
        </p>
      </div>
      {list.map((s) => (
        <button key={s.id} onClick={() => onOpen(s)} className="tap w-full text-left px-4 py-2.5 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
          <span className="min-w-0">
            <span className="block text-sm truncate" style={{ color: C.ink, fontWeight: 600 }}>
              {s.name || titleOf(s)}
            </span>
            <span className="block text-xs truncate" style={{ color: C.muted }}>
              {dateLabel(s.date)} · {sessionFacts(s)}
            </span>
          </span>
          <span className="text-xs shrink-0" style={{ color: C.accent, fontWeight: 600 }}>
            Invullen
          </span>
        </button>
      ))}
    </Card>
  );
}
