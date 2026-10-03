/* AI-coach in de app: weekanalyse en vragen stellen.
   Eerst uitdrukkelijke toestemming (gezondheidsgegevens, AVG art. 9), met
   inzage in precies wat er wordt verstuurd. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, R, Sheet, TBtn } from "../../App.jsx";
import { localISO } from "../engine/model.js";
import { buildCoachContext, trimHistory, reviewWeekOf, MAX_QUESTION } from "../engine/coach.js";
import { coachEnabled, askCoach } from "../coach.js";
import { Card, Eyebrow, dateLabel } from "./kit.jsx";

const IDEAS = ["Ben ik klaar voor een zware sessie vandaag?", "Hoe combineer ik deze week kracht en lopen het best?", "Wat eet ik vóór en tijdens mijn lange duurtraining?"];

function CoachConsent({ preview, onClose, onOk }) {
  const [ok, setOk] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <Sheet title="Coach gebruiken" onClose={onClose}>
      <div className="space-y-3 text-sm leading-relaxed pb-2" style={{ color: C.ink }}>
        <p>De coach is een AI-model (Claude, van Anthropic). Voor een analyse of antwoord stuurt de app een samenvatting van uw training mee.</p>
        <ul className="space-y-1.5 text-xs" style={{ color: C.muted }}>
          <li>· Wat er meegaat: doel en fase van uw schema, minuten en belasting per week, intensiteitsverdeling, herstelscores, recente trainingen (soort, duur, inspanning) en krachtrecords. Plus uw leeftijd, geslacht en gewicht.</li>
          <li>· Wat niet meegaat: uw naam, e-mailadres, notities, routes en trainingen uit Strava.</li>
          <li>· Anthropic gebruikt de gegevens niet om modellen te trainen en bewaart ze alleen kort voor misbruikcontrole.</li>
          <li>· De coach geeft algemeen trainingsadvies en is geen arts. Bij pijn, ziekte of twijfel: raadpleeg een (sport)arts.</li>
          <li>· Hoogstens 20 vragen per dag. Toestemming intrekken kan altijd hier.</li>
        </ul>
        <button type="button" onClick={() => setShow(!show)} className="tap text-xs" style={{ color: C.accent, fontWeight: 600 }}>
          {show ? "Verberg" : "Bekijk"} precies wat er wordt verstuurd
        </button>
        {show && (
          <pre className="text-[10.5px] leading-snug overflow-auto p-2.5" style={{ maxHeight: 220, background: "var(--accent-soft)", borderRadius: R.field, color: C.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(preview, null, 1)}
          </pre>
        )}
        <label className="flex gap-2.5 items-start text-xs cursor-pointer" style={{ color: C.muted }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5 shrink-0" style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
          <span>
            Ik geef <strong style={{ color: C.ink }}>uitdrukkelijk toestemming</strong> dat Nexa deze trainings- en herstelgegevens naar de AI-coach stuurt.
          </span>
        </label>
        <TBtn full disabled={!ok} onClick={onOk}>
          Coach inschakelen
        </TBtn>
      </div>
    </Sheet>
  );
}

function Review({ r }) {
  const list = (title, xs, color) =>
    xs && xs.length ? (
      <div>
        <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color, fontWeight: 600 }}>
          {title}
        </div>
        <ul className="space-y-1">
          {xs.slice(0, 3).map((x, i) => (
            <li key={i} className="text-sm leading-snug flex gap-2" style={{ color: C.ink }}>
              <span className="shrink-0 mt-[7px]" style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="space-y-3">
      <h3 className="disp text-[21px] leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
        {r.kop}
      </h3>
      <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
        {r.samenvatting}
      </p>
      {list("Ging goed", r.goed, "var(--tide-fill)")}
      {list("Let op", r.aandacht, "var(--ember-fill)")}
      {r.advies && r.advies.length > 0 && (
        <div className="space-y-2">
          {r.advies.slice(0, 3).map((a, i) => (
            <div key={i} className="px-3 py-2.5" style={{ borderRadius: R.field, background: "var(--accent-soft)" }}>
              <div className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
                {a.titel}
              </div>
              <div className="text-xs leading-relaxed mt-0.5" style={{ color: C.ink }}>
                {a.tekst}
              </div>
            </div>
          ))}
        </div>
      )}
      {r.volgendeWeek && (
        <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
          {r.volgendeWeek}
        </p>
      )}
    </div>
  );
}

function Bubble({ m }) {
  const me = m.role === "user";
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <div
        className="px-3 py-2 text-sm leading-relaxed"
        style={{ maxWidth: "88%", whiteSpace: "pre-wrap", borderRadius: 14, background: me ? C.accent : "var(--accent-soft)", color: me ? C.onAccent : C.ink, borderBottomRightRadius: me ? 4 : 14, borderBottomLeftRadius: me ? 14 : 4 }}
      >
        {m.text}
      </div>
    </div>
  );
}

export function CoachCard({ data, api, nx, acc }) {
  const [enabled, setEnabled] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(null); // "week" | "vraag"
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [left, setLeft] = useState(null);
  const endRef = useRef(null);
  const coach = data.coach || {};
  const today = localISO();
  const week = reviewWeekOf(today);
  const loggedIn = !!(nx && nx.user);
  const ctx = useMemo(() => buildCoachContext(data, today), [data.sessions, data.plan, data.checkins, data.profile, data.nutrition, today]);

  useEffect(() => {
    let alive = true;
    coachEnabled().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (endRef.current && busy == null && coach.chat && coach.chat.length) endRef.current.scrollIntoView({ block: "nearest" });
  }, [coach.chat && coach.chat.length]);

  const run = async (mode, question) => {
    setBusy(mode);
    setErr(null);
    try {
      if (mode === "week") {
        const d = await askCoach({ mode, context: ctx });
        setLeft(d.left);
        api.setCoach({ review: { week, at: new Date().toISOString(), result: d.review } });
      } else {
        const history = trimHistory(coach.chat);
        const chat = [...(coach.chat || []), { role: "user", text: question, at: Date.now() }];
        api.setCoach({ chat });
        setQ("");
        try {
          const d = await askCoach({ mode, context: ctx, question, history });
          setLeft(d.left);
          api.setCoach({ chat: [...chat, { role: "assistant", text: d.answer, at: Date.now() }] });
        } catch (e) {
          api.setCoach({ chat: coach.chat || [] });
          setQ(question);
          throw e;
        }
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  let body;
  if (enabled === false) body = <p className="text-sm" style={{ color: C.muted }}>De coach is nog niet ingeschakeld.</p>;
  else if (!loggedIn) body = <p className="text-sm" style={{ color: C.muted }}>Log in met uw Nexa-account om de coach te gebruiken.</p>;
  else if (acc.locked) body = <p className="text-sm" style={{ color: C.muted }}>De coach hoort bij Nexa Hybrid.</p>;
  else if (!coach.consentAt)
    body = (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
          Laat uw week analyseren of stel een vraag over training, herstel of voeding. De coach kijkt naar uw eigen cijfers.
        </p>
        <TBtn disabled={enabled == null} onClick={() => setConsent(true)}>
          Coach inschakelen
        </TBtn>
      </div>
    );
  else {
    const rv = coach.review && coach.review.result ? coach.review : null;
    const fresh = rv && rv.week === week;
    body = (
      <div className="space-y-4">
        {rv ? (
          <div>
            <Review r={rv.result} />
            <div className="flex items-center justify-between gap-3 mt-3">
              <span className="text-[11px]" style={{ color: C.muted }}>
                {fresh ? "Deze week" : "Vorige analyse"} · {dateLabel(rv.at.slice(0, 10))}
              </span>
              <TBtn small kind="ghost" disabled={!!busy} onClick={() => run("week")}>
                {busy === "week" ? "Bezig…" : fresh ? "Opnieuw" : "Analyseer deze week"}
              </TBtn>
            </div>
          </div>
        ) : (
          <TBtn full disabled={!!busy} onClick={() => run("week")}>
            {busy === "week" ? "De coach kijkt naar uw week…" : "Analyseer mijn week"}
          </TBtn>
        )}

        <div className="space-y-2.5 pt-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
          <div className="eyebrow">Vraag het de coach</div>
          {(coach.chat || []).map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {busy === "vraag" && <p className="text-xs" style={{ color: C.muted }}>De coach denkt na…</p>}
          <div ref={endRef} />
          {!(coach.chat || []).length && (
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((t) => (
                <button key={t} type="button" onClick={() => setQ(t)} className="tap text-xs px-2.5 py-1.5" style={{ borderRadius: 999, border: `1px solid ${C.line}`, color: C.ink }}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const t = q.trim();
              if (t && !busy) run("vraag", t);
            }}
          >
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value.slice(0, MAX_QUESTION))}
              rows={2}
              placeholder="Bijv. moet ik morgen mijn intervallen doen?"
              aria-label="Vraag aan de coach"
              className="flex-1 px-3 py-2 text-sm"
              style={{ borderRadius: R.field, border: `1px solid ${C.line}`, background: C.panel, color: C.ink, resize: "none" }}
            />
            <TBtn disabled={!q.trim() || !!busy}>Stuur</TBtn>
          </form>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px]" style={{ color: C.muted }}>
              {left != null ? `Nog ${left} ${left === 1 ? "vraag" : "vragen"} vandaag.` : "Geen medisch advies."}
            </span>
            <span className="flex gap-3">
              {(coach.chat || []).length > 0 && (
                <button type="button" onClick={() => api.setCoach({ chat: [] })} className="tap text-[11px]" style={{ color: C.muted }}>
                  Gesprek wissen
                </button>
              )}
              <button type="button" onClick={() => api.setCoach({ consentAt: null, review: null, chat: [] })} className="tap text-[11px]" style={{ color: C.muted }}>
                Toestemming intrekken
              </button>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="px-4 py-4">
      <div className="relative space-y-3">
        <Eyebrow>Coach</Eyebrow>
        {body}
        {err && (
          <p className="text-xs" style={{ color: C.train }} role="alert">
            {err}
          </p>
        )}
        {ctx.weggelaten.stravaTrainingen > 0 && coach.consentAt && (
          <p className="text-[11px]" style={{ color: C.muted }}>
            {ctx.weggelaten.stravaTrainingen} {ctx.weggelaten.stravaTrainingen === 1 ? "training" : "trainingen"} uit Strava gaan niet mee naar de coach (voorwaarden van Strava).
          </p>
        )}
      </div>
      {consent && (
        <CoachConsent
          preview={ctx}
          onClose={() => setConsent(false)}
          onOk={() => {
            api.setCoach({ consentAt: new Date().toISOString() });
            setConsent(false);
          }}
        />
      )}
    </Card>
  );
}
