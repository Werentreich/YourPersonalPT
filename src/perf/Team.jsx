/* Gezin en coaching in Nexa (fase 1).
   - Profiel: koppelingen beheren, iemand uitnodigen, rechten kiezen.
   - Coach: overzicht van een sporter, schema en voedingsdoel instellen.
   - Sporter: uitnodiging accepteren; opdrachten van de coach worden
     toegepast met een melding en "Ongedaan maken". */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, R, Section, Row, Sheet, TBtn } from "../App.jsx";
import { SETTINGS_DEFAULT, GOALS } from "../hybrid/engine/planner.js";
import { PlanSheet } from "../hybrid/ui/plan.jsx";
import { DISCIPLINES, disciplineOfGoal } from "./theme.js";
import { SCOPES, DEFAULT_SCOPES, INVITE_KEY, teamCall, inviteUrl, takeInviteFromUrl, applyPlan, assignmentText, readTeamCache, writeTeamCache } from "./team.js";

const inputStyle = () => ({ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink });
const dayLabel = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const kg = (v) => (v == null ? "–" : `${String(Math.round(v * 10) / 10).replace(".", ",")} kg`);

/* ---------------- gegevens en toepassen ---------------- */

/* Koppelingen ophalen (na inloggen, bij terugkomen in de app en elke 5 min)
   en openstaande opdrachten van een coach toepassen. */
export function useTeam(nx, { perfApi, perfData, f, setF }) {
  const [team, setTeam] = useState(() => readTeamCache());
  const [notice, setNotice] = useState(null); // { text, undo }
  const [error, setError] = useState(null);
  const ctx = useRef({});
  ctx.current = { perfApi, perfData, f, setF };
  const loggedIn = !!(nx && nx.user);

  const apply = useCallback((list) => {
    const { perfApi, perfData, f, setF } = ctx.current;
    const done = [];
    const undos = [];
    const texts = [];
    for (const a of list) {
      const p = applyPlan(a, { planSettings: perfData.plan ? perfData.plan.settings : null, discipline: perfData.discipline, f });
      if (!p) {
        done.push(a.id);
        continue;
      }
      if (p.kind === "schema") {
        perfApi.setPlan({ ...SETTINGS_DEFAULT, ...p.settings });
        perfApi.setDiscipline(disciplineOfGoal(p.settings.goal));
        undos.push(() => {
          if (p.before) perfApi.setPlan(p.before);
          else perfApi.stopPlan();
          if (p.beforeDiscipline) perfApi.setDiscipline(p.beforeDiscipline);
        });
      } else {
        setF((s) => ({ ...s, ...p.patch }));
        undos.push(() => setF((s) => ({ ...s, ...p.before })));
      }
      texts.push(assignmentText(a) + (a.payload && a.payload.note ? ` "${a.payload.note}"` : ""));
      done.push(a.id);
    }
    if (texts.length) setNotice({ text: texts.join(" "), undo: () => undos.reverse().forEach((u) => u()) });
    if (done.length) teamCall("applied", { ids: done }).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!loggedIn) return null;
    try {
      const d = await teamCall("list");
      const t = { links: d.links || [], coveredBy: d.coveredBy || null };
      setTeam(t);
      writeTeamCache(t);
      setError(null);
      if (d.assignments && d.assignments.length) apply(d.assignments);
      return t;
    } catch (e) {
      if (e.code !== "uit") setError(e.message);
      return null;
    }
  }, [loggedIn, apply]);

  useEffect(() => {
    if (!loggedIn) return;
    refresh();
    const id = setInterval(refresh, 5 * 60 * 1000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loggedIn, refresh]);

  const clients = team.links.filter((l) => l.role === "coach" && l.status === "actief");
  return { ...team, clients, notice, setNotice, error, refresh };
}

/* Melding bovenaan na een opdracht van de coach. */
export function TeamNotice({ team }) {
  const n = team.notice;
  if (!n) return null;
  return (
    <div className="mb-4 px-4 py-3 flex items-start gap-3" style={{ background: "var(--accent-soft)", borderRadius: R.card, border: `1px solid ${C.accent}` }} role="status">
      <p className="text-sm flex-1 leading-relaxed" style={{ color: C.ink }}>
        {n.text}
      </p>
      <div className="flex flex-col gap-1 shrink-0 text-xs" style={{ fontWeight: 600 }}>
        {n.undo && (
          <button
            onClick={() => {
              n.undo();
              team.setNotice({ text: "Teruggedraaid. Uw vorige instellingen staan er weer." });
            }}
            className="tap"
            style={{ color: C.accent }}
          >
            Ongedaan maken
          </button>
        )}
        <button onClick={() => team.setNotice(null)} className="tap" style={{ color: C.muted }}>
          Sluiten
        </button>
      </div>
    </div>
  );
}

/* ---------------- sporter: uitnodiging accepteren ---------------- */

export function AcceptInvite({ nx, team }) {
  const [code, setCode] = useState(() => {
    takeInviteFromUrl();
    try {
      return localStorage.getItem(INVITE_KEY) || null;
    } catch (e) {
      return null;
    }
  });
  const [coachName, setCoachName] = useState(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(DEFAULT_SCOPES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const loggedIn = !!(nx && nx.user);
  const clear = () => {
    try {
      localStorage.removeItem(INVITE_KEY);
    } catch (e) {
      /* niets */
    }
    setCode(null);
  };
  useEffect(() => {
    if (!code || !loggedIn) return;
    teamCall("peek", { code })
      .then((d) => setCoachName(d.coachName))
      .catch((e) => setErr(e.message));
  }, [code, loggedIn]);
  if (!code) return null;
  if (!loggedIn)
    return (
      <div className="mb-4 px-4 py-3 text-sm" style={{ background: "var(--accent-soft)", borderRadius: R.card }}>
        U bent uitgenodigd om te koppelen met een coach. Log in of maak een account aan bij Profiel; daarna verschijnt de uitnodiging hier.
      </div>
    );
  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      await teamCall("accept", { code, name, scopes });
      clear();
      team.setNotice({ text: `U bent gekoppeld aan ${coachName}. U kunt de rechten altijd aanpassen bij Profiel → Gezin en coaching.` });
      team.refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Uitnodiging" onClose={clear}>
      <div className="space-y-4">
        {err && !coachName ? (
          <p className="text-sm" style={{ color: C.train }} role="alert">
            {err}
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed">
              <strong>{coachName || "…"}</strong> wil uw coach zijn in Nexa. Kies wat {coachName || "uw coach"} mag. U kunt dit altijd aanpassen of de koppeling stoppen.
            </p>
            <label className="block">
              <span className="text-xs" style={{ color: C.muted }}>
                Uw naam (ziet uw coach)
              </span>
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="w-full mt-1 px-3 py-2.5 text-sm" style={inputStyle()} aria-label="Uw naam" />
            </label>
            <ScopeToggles value={scopes} onChange={setScopes} />
            <p className="text-[11px] leading-relaxed" style={{ color: C.muted }}>
              Uw gegevens blijven van u. Uw coach ziet alleen wat u hierboven aanzet; notities, routes en wat u eet blijven privé. Valt u onder het abonnement van uw coach, dan hoeft u zelf niet te betalen.
            </p>
            {err && (
              <p className="text-sm" style={{ color: C.train }} role="alert">
                {err}
              </p>
            )}
            <div className="flex gap-2">
              <TBtn disabled={busy || !name.trim() || !coachName} onClick={accept}>
                {busy ? "Even geduld…" : "Koppelen"}
              </TBtn>
              <TBtn kind="ghost" onClick={clear}>
                Weigeren
              </TBtn>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function ScopeToggles({ value, onChange, disabled }) {
  return (
    <div className="space-y-2">
      {Object.entries(SCOPES).map(([k, s]) => (
        <label key={k} className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={!!value[k]} disabled={disabled} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} className="mt-0.5 shrink-0" style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
          <span className="text-sm leading-snug">
            <strong>{s.label}</strong>
            <span className="block text-xs" style={{ color: C.muted }}>
              {s.hint}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

/* ---------------- Profiel: koppelingen beheren ---------------- */

export function TeamSection({ nx, team, onOpenClient }) {
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(null);
  const loggedIn = !!(nx && nx.user);

  const invite = async () => {
    setBusy(true);
    setErr(null);
    try {
      await teamCall("invite", { name });
      setInviting(false);
      await team.refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async (l) => {
    setBusy(true);
    try {
      await teamCall("stop", { linkId: l.id });
      await team.refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const share = async (l) => {
    const url = inviteUrl(l.code);
    const text = `${l.coachName} nodigt u uit in Nexa. Open deze link en log in: ${url} (code ${l.code})`;
    try {
      if (navigator.share) await navigator.share({ title: "Uitnodiging voor Nexa", text, url });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(l.id);
      }
    } catch (e) {
      /* delen geannuleerd */
    }
  };
  const saveScopes = async (l, scopes) => {
    setBusy(true);
    try {
      await teamCall("scopes", { linkId: l.id, scopes });
      setEditing(null);
      await team.refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const coaches = team.links.filter((l) => l.role === "sporter");
  const mine = team.links.filter((l) => l.role === "coach");
  return (
    <Section title="Gezin en coaching" sub="Coach uw partner, gezin of sporters: stel hun schema en voedingsdoel in en volg hun voortgang. Ieder houdt een eigen account en kiest zelf wat de coach mag.">
      {!loggedIn ? (
        <Row label="Log eerst in" hint="Koppelen kan met een Nexa-account, voor u en voor degene die u coacht." />
      ) : (
        <>
          {team.coveredBy && <Row label={`Onder het abonnement van ${team.coveredBy}`} hint="Zolang u gekoppeld bent, kunt u Nexa volledig gebruiken zonder eigen abonnement." />}
          {coaches.map((l) => (
            <div key={l.id} style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <Row label={`Coach: ${l.coachName}`} hint={Object.entries(SCOPES).filter(([k]) => l.scopes[k]).map(([, s]) => s.label.toLowerCase()).join(", ") || "geen rechten"}>
                <TBtn small kind="ghost" onClick={() => setEditing(editing === l.id ? null : l.id)}>
                  Rechten
                </TBtn>
              </Row>
              {editing === l.id && <ScopeEditor link={l} busy={busy} onSave={(s) => saveScopes(l, s)} onStop={() => stop(l)} />}
            </div>
          ))}
          {mine.map((l) =>
            l.status === "actief" ? (
              <Row key={l.id} label={l.clientName} hint={`U coacht · ${Object.entries(SCOPES).filter(([k]) => l.scopes[k]).map(([, s]) => s.label.toLowerCase()).join(", ") || "geen rechten"}`}>
                <TBtn small onClick={() => onOpenClient(l)}>
                  Openen
                </TBtn>
              </Row>
            ) : (
              <Row key={l.id} label={`Uitnodiging ${l.code}`} hint={`Nog niet geaccepteerd · geldig tot ${new Date(l.expiresAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}${copied === l.id ? " · link gekopieerd" : ""}`}>
                <div className="flex gap-1.5">
                  <TBtn small onClick={() => share(l)}>
                    Delen
                  </TBtn>
                  <TBtn small kind="ghost" onClick={() => stop(l)}>
                    Intrekken
                  </TBtn>
                </div>
              </Row>
            )
          )}
          {inviting ? (
            <div className="px-4 py-3 space-y-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <label className="block">
                <span className="text-xs" style={{ color: C.muted }}>
                  Uw naam (ziet de ander bij de uitnodiging)
                </span>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="bijv. Wesley" className="w-full mt-1 px-3 py-2.5 text-sm" style={inputStyle()} aria-label="Uw naam" />
              </label>
              <div className="flex gap-2">
                <TBtn small disabled={busy || !name.trim()} onClick={invite}>
                  {busy ? "Even geduld…" : "Uitnodiging maken"}
                </TBtn>
                <TBtn small kind="ghost" onClick={() => setInviting(false)}>
                  Annuleren
                </TBtn>
              </div>
            </div>
          ) : (
            <Row label="Iemand coachen" hint="U krijgt een link en code om te delen. De ander logt in, kiest wat u mag en is gekoppeld.">
              <TBtn small onClick={() => setInviting(true)}>
                Uitnodigen
              </TBtn>
            </Row>
          )}
          <InviteCodeRow />
          {(err || team.error) && (
            <p className="px-4 py-2 text-xs" style={{ color: C.train }} role="alert">
              {err || team.error}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function ScopeEditor({ link, busy, onSave, onStop }) {
  const [s, setS] = useState(link.scopes);
  const [sure, setSure] = useState(false);
  return (
    <div className="px-4 pb-3 space-y-3">
      <ScopeToggles value={s} onChange={setS} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        <TBtn small disabled={busy} onClick={() => onSave(s)}>
          Opslaan
        </TBtn>
        {sure ? (
          <TBtn small kind="danger" disabled={busy} onClick={onStop}>
            Ja, ontkoppelen
          </TBtn>
        ) : (
          <TBtn small kind="ghost" onClick={() => setSure(true)}>
            Ontkoppelen
          </TBtn>
        )}
      </div>
    </div>
  );
}

/* Een code ingeven (als de link niet werkt, bijvoorbeeld in de eigen app). */
function InviteCodeRow() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  if (!open)
    return (
      <Row label="Uitgenodigd door een coach?" hint="Open de link die u kreeg, of vul de code in.">
        <TBtn small kind="ghost" onClick={() => setOpen(true)}>
          Code invullen
        </TBtn>
      </Row>
    );
  return (
    <div className="px-4 py-3 flex gap-2" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="8 tekens" className="flex-1 px-3 py-2.5 text-sm tnum" style={inputStyle()} aria-label="Uitnodigingscode" />
      <TBtn
        small
        disabled={code.length !== 8}
        onClick={() => {
          try {
            localStorage.setItem(INVITE_KEY, code);
          } catch (e) {
            /* niets */
          }
          location.reload();
        }}
      >
        Verder
      </TBtn>
    </div>
  );
}

/* ---------------- Training: wisselen tussen mij en wie ik coach ---------------- */

export function TeamSwitcher({ team, onOpenClient }) {
  if (!team.clients.length) return null;
  return (
    <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }} aria-label="Wie">
      <span className="shrink-0 px-3.5 py-1.5 text-sm" style={{ borderRadius: 999, background: C.dark, color: C.darkInk, fontWeight: 600 }}>
        Ik
      </span>
      {team.clients.map((l) => (
        <button key={l.id} onClick={() => onOpenClient(l)} className="tap shrink-0 px-3.5 py-1.5 text-sm" style={{ borderRadius: 999, border: `1px solid ${C.line}`, background: C.panel, color: C.ink, fontWeight: 500 }}>
          {l.clientName}
        </button>
      ))}
    </div>
  );
}

/* ---------------- coach: overzicht van een sporter ---------------- */

const GOAL_LABEL = { cut: "Afvallen", onderhoud: "Gewicht houden", bulk: "Spiermassa opbouwen" };

export function ClientSheet({ link, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [plan, setPlan] = useState(false);
  const [food, setFood] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => {
    teamCall("view", { linkId: link.id })
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [link.id]);
  useEffect(load, [load]);
  const s = d && d.summary;
  const sc = (d && d.link && d.link.scopes) || link.scopes;
  const assign = async (kind, payload) => {
    setMsg(null);
    try {
      await teamCall("assign", { linkId: link.id, kind, payload });
      setMsg(`Verstuurd. ${link.clientName} krijgt het te zien zodra de app opent, met de mogelijkheid het ongedaan te maken.`);
      load();
      return true;
    } catch (e) {
      setMsg(e.message);
      return false;
    }
  };

  if (plan) {
    const cur = s && s.basis.plan ? s.basis.plan.settings : null;
    const disc = s && s.basis.discipline && DISCIPLINES[s.basis.discipline] && DISCIPLINES[s.basis.discipline].goals ? s.basis.discipline : null;
    return (
      <PlanSheet
        initial={{ ...SETTINGS_DEFAULT, ...(cur || {}), ...(cur ? {} : disc ? { goal: DISCIPLINES[disc].goal } : {}) }}
        goals={null}
        onClose={() => setPlan(false)}
        onSave={async (settings) => {
          if (await assign("schema", { settings })) setPlan(false);
        }}
      />
    );
  }

  return (
    <Sheet title={link.clientName} onClose={onClose}>
      <div className="space-y-5">
        {err && (
          <p className="text-sm" style={{ color: C.train }} role="alert">
            {err}
          </p>
        )}
        {!d && !err && <p className="text-sm" style={{ color: C.muted }}>Laden…</p>}
        {msg && (
          <p className="text-sm px-3 py-2" style={{ background: "var(--accent-soft)", borderRadius: R.field }} role="status">
            {msg}
          </p>
        )}
        {s && (
          <>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide" style={{ color: C.muted, fontWeight: 600 }}>
                Instellen
              </div>
              <div className="px-3 py-3 flex items-center gap-3" style={{ background: C.surface2, borderRadius: R.field }}>
                <div className="flex-1 text-sm">
                  <strong>Trainingsschema</strong>
                  <span className="block text-xs" style={{ color: C.muted }}>
                    {s.basis.plan ? `${(GOALS[s.basis.plan.settings.goal] || {}).label || s.basis.plan.settings.goal} · ${(s.basis.plan.settings.days || []).length} dagen per week` : "Nog geen schema"}
                    {(d.pending || []).some((p) => p.kind === "schema") ? " · nieuw schema nog niet geopend" : ""}
                  </span>
                </div>
                <TBtn small disabled={!sc.schema} onClick={() => setPlan(true)}>
                  {s.basis.plan ? "Aanpassen" : "Maken"}
                </TBtn>
              </div>
              <div className="px-3 py-3 flex items-center gap-3" style={{ background: C.surface2, borderRadius: R.field }}>
                <div className="flex-1 text-sm">
                  <strong>Voedingsdoel</strong>
                  <span className="block text-xs" style={{ color: C.muted }}>
                    {s.basis.voeding.goal ? `${GOAL_LABEL[s.basis.voeding.goal] || s.basis.voeding.goal}${s.basis.voeding.goal !== "onderhoud" && s.basis.voeding.rate != null ? `, ${String(Math.abs(s.basis.voeding.rate)).replace(".", ",")}% per week` : ""}` : "Nog niet ingesteld"}
                    {(d.pending || []).some((p) => p.kind === "voeding") ? " · nieuw doel nog niet geopend" : ""}
                  </span>
                </div>
                <TBtn small disabled={!sc.voeding} onClick={() => setFood(!food)}>
                  Instellen
                </TBtn>
              </div>
              {food && <FoodGoalForm initial={s.basis.voeding} onSave={async (p) => (await assign("voeding", p)) && setFood(false)} />}
              {(!sc.schema || !sc.voeding) && (
                <p className="text-[11px]" style={{ color: C.muted }}>
                  {link.clientName} gaf geen toestemming voor {[!sc.schema && "het schema", !sc.voeding && "het voedingsdoel"].filter(Boolean).join(" en ")}.
                </p>
              )}
            </div>

            {sc.voortgang ? (
              <ClientProgress s={s} />
            ) : (
              <p className="text-xs" style={{ color: C.muted }}>
                {link.clientName} deelt de voortgang niet.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function FoodGoalForm({ initial, onSave }) {
  const [goal, setGoal] = useState(initial.goal || "onderhoud");
  const [rate, setRate] = useState(initial.rate != null && initial.rate !== 0 ? Math.abs(initial.rate) : 0.5);
  const [protein, setProtein] = useState(initial.proteinPerKg ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const rates = goal === "cut" ? [0.25, 0.5, 0.75, 1] : [0.1, 0.25, 0.5];
  return (
    <div className="px-3 py-3 space-y-3" style={{ border: `1px solid ${C.line}`, borderRadius: R.field }}>
      <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Voedingsdoel">
        {Object.entries(GOAL_LABEL).map(([k, l]) => (
          <button key={k} role="radio" aria-checked={goal === k} onClick={() => setGoal(k)} className="tap px-3 py-1.5 text-sm" style={{ borderRadius: 999, border: `1px solid ${goal === k ? C.accent : C.line}`, background: goal === k ? C.accent : C.panel, color: goal === k ? C.onAccent : C.ink, fontWeight: 600 }}>
            {l}
          </button>
        ))}
      </div>
      {goal !== "onderhoud" && (
        <div>
          <div className="text-xs mb-1" style={{ color: C.muted }}>
            Tempo, % van het lichaamsgewicht per week
          </div>
          <div className="flex gap-1.5">
            {rates.map((r) => (
              <button key={r} onClick={() => setRate(r)} className="tap flex-1 py-2 text-sm tnum" style={{ borderRadius: R.field, border: `1px solid ${rate === r ? C.accent : C.line}`, background: rate === r ? C.accent : C.panel, color: rate === r ? C.onAccent : C.ink, fontWeight: 600 }}>
                {String(r).replace(".", ",")}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="text-xs" style={{ color: C.muted }}>
          Eiwit per kg (leeg = advies van Nexa)
        </span>
        <input type="number" inputMode="decimal" step="0.1" min="1.2" max="3" value={protein} onChange={(e) => setProtein(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm tnum" style={inputStyle()} aria-label="Eiwit per kilo" />
      </label>
      <label className="block">
        <span className="text-xs" style={{ color: C.muted }}>
          Korte toelichting (optioneel)
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 280))} className="w-full mt-1 px-3 py-2 text-sm" style={inputStyle()} aria-label="Toelichting" />
      </label>
      <TBtn
        small
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const p = protein === "" ? null : Number(protein);
          await onSave({ goal, rate: goal === "onderhoud" ? 0 : goal === "cut" ? -rate : rate, proteinPerKg: Number.isFinite(p) ? p : null, note: note || null });
          setBusy(false);
        }}
      >
        Doel versturen
      </TBtn>
    </div>
  );
}

function ClientProgress({ s }) {
  const today = new Date().toISOString().slice(0, 10);
  const week = (s.week || []).filter((x) => x.date >= today.slice(0, 8) + "01" || true);
  const done = (s.week || []).filter((x) => x.status === "gedaan" && x.date <= today).length;
  const due = (s.week || []).filter((x) => x.date <= today).length;
  const w = s.weights || [];
  const last = w[w.length - 1];
  const first = w.find((x) => x.date >= new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10));
  const ci = (s.checkins || [])[(s.checkins || []).length - 1];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Trainingen" value={`${done}/${due}`} sub="afgelopen week" />
        <Tile label="Gewicht" value={last ? kg(last.weight) : kg(s.profile && s.profile.weight)} sub={last && first && first !== last ? `${last.weight - first.weight >= 0 ? "+" : "−"}${kg(Math.abs(last.weight - first.weight))} in 4 wk` : "laatste meting"} />
        <Tile label="Check-in" value={ci ? `${ci.sleepQ ?? "–"}/5` : "–"} sub={ci ? `slaap · ${dayLabel(ci.date)}` : "geen recente"} />
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: C.muted, fontWeight: 600 }}>
          Schema
        </div>
        {week.length ? (
          <div className="overflow-hidden" style={{ border: `1px solid ${C.line}`, borderRadius: R.field }}>
            {week.map((x, i) => (
              <div key={i} className="px-3 py-2 flex items-center gap-2 text-sm" style={{ borderBottom: i < week.length - 1 ? `1px solid ${C.lineSoft}` : "none", background: x.date === today ? "var(--accent-soft)" : "transparent" }}>
                <span className="w-20 shrink-0 text-xs" style={{ color: C.muted }}>
                  {dayLabel(x.date)}
                </span>
                <span className="flex-1 truncate">{x.title}</span>
                <span className="text-xs shrink-0" style={{ color: x.status === "gedaan" ? C.carb : x.status === "overgeslagen" ? C.train : C.muted, fontWeight: 600 }}>
                  {x.status === "gedaan" ? "✓ gedaan" : x.status === "overgeslagen" ? "overgeslagen" : x.date < today ? "gemist" : "gepland"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: C.muted }}>
            Geen schema voor deze periode.
          </p>
        )}
      </div>
      {(s.sessions || []).length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: C.muted, fontWeight: 600 }}>
            Laatste trainingen
          </div>
          <div className="space-y-1">
            {s.sessions.slice(0, 8).map((x, i) => (
              <div key={i} className="text-xs flex gap-2">
                <span className="w-20 shrink-0" style={{ color: C.muted }}>
                  {dayLabel(x.date)}
                </span>
                <span className="flex-1 truncate">
                  {x.title || x.sport || x.kind}
                  {x.durationSec ? ` · ${Math.round(x.durationSec / 60)} min` : ""}
                  {x.distanceM ? ` · ${(x.distanceM / 1000).toFixed(1).replace(".", ",")} km` : ""}
                  {x.sets ? ` · ${x.sets} sets` : ""}
                </span>
                {x.rpe != null && <span style={{ color: C.muted }}>RPE {x.rpe}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="px-3 py-2.5" style={{ background: C.surface2, borderRadius: R.field }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: C.muted, fontWeight: 600 }}>
        {label}
      </div>
      <div className="disp text-xl font-bold tnum leading-tight">{value}</div>
      <div className="text-[10px]" style={{ color: C.muted }}>
        {sub}
      </div>
    </div>
  );
}
