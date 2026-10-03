/* =========================================================================
   NEXA HYBRID
   Schil van de app: merk, navigatie, toegang (upgrade boven Nexa Coach) en
   account. De trainingsmotor volgt per fase (docs/hybrid/00-PLAN.md).
   Gedeelde onderdelen (account, sheet, knoppen) komen uit Nexa en nemen via
   CSS-variabelen vanzelf de Hybrid-kleuren over.
   ========================================================================= */
import React, { useEffect, useState } from "react";
import { STYLE, C, R, Section, Row, Sheet, TBtn, Reveal, ConsentSheet, AccountForm, AccountSection, useNexaSync, eur } from "../App.jsx";
import { HYBRID_STYLE, K } from "./theme.js";
import { hybridAccess, upgradeDelta } from "./entitlement.js";

/* Opslagsleutels. Het voorvoegsel "macroverdeling:" zorgt dat het
   Nexa-account ze vanzelf meesynchroniseert (src/sync.js). */
export const HYBRID_KEY = "macroverdeling:hybrid:v1";
const NEXA_KEY = "macroverdeling:v1";

/* ---------------- merkteken ----------------
   Een zware rechte lijn (kracht, gloed) kruist een golvende hoogtelijn
   (duur, getij). */
export function HybridMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: "inline-block", flexShrink: 0 }}>
      <path d="M3 16C5.6 16 6.5 12.2 8.9 12.2S12.4 16 16 16S19.6 19.8 22.1 19.8S26.4 16 29 16" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M9.4 25.4L22.6 6.6" fill="none" stroke="var(--ember-fill)" strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.6" fill="var(--surface)" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <HybridMark size={24} />
      <span className="disp text-[22px] leading-none" style={{ fontWeight: 600, color: C.ink }}>
        nexa <span style={{ color: C.accent }}>hybrid</span>
      </span>
    </span>
  );
}

/* Hoogtelijnen als achtergrondmotief (geen strepen of tape). */
function Contours({ seed = 0 }) {
  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 18 + i * 15 + seed * 3;
    const a = 9 + ((i * 5 + seed) % 7);
    return `M-10 ${y} C 60 ${y - a}, 110 ${y + a}, 170 ${y - a / 2} S 280 ${y + a}, 340 ${y}`;
  });
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 330 130" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--contour)" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

/* ---------------- iconen (eigen set, lijn 1,8) ---------------- */
const ICONS = {
  vandaag: ["M12 3v2", "M12 19v2", "M3 12h2", "M19 12h2", "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8"],
  week: ["M4 6h16", "M4 6v13h16V6", "M8 3v4", "M16 3v4", "M8 12h2", "M14 12h2", "M8 16h2"],
  log: ["M5 4h14v16H5z", "M9 9h6", "M9 13h6", "M9 17h3"],
  voortgang: ["M4 19h16", "M5 15l4-4 3 3 7-7", "M15 7h4v4"],
  profiel: ["M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8", "M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
};
function HIcon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const TABS = [
  { id: "vandaag", label: "Vandaag" },
  { id: "week", label: "Week" },
  { id: "log", label: "Log" },
  { id: "voortgang", label: "Voortgang" },
  { id: "profiel", label: "Profiel" },
];

/* ---------------- kaarten ---------------- */
function Card({ children, className = "", style }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card, boxShadow: C.shadow, ...style }}>
      {children}
    </div>
  );
}

const ROADMAP = [
  { fase: 0, title: "Fundering", body: "Eigen app, merk, account en abonnement.", done: true },
  { fase: 1, title: "Loggen en belasting", body: "Kracht, duur, WOD's en Hyrox loggen. Eén belastingsmaat, zones en uw vorm over de weken.", pillar: "duur" },
  { fase: 2, title: "Adaptieve planner", body: "Een weekschema dat meebeweegt met uw herstel, gemiste sessies en voortgang.", pillar: "kracht" },
  { fase: 3, title: "Hybride voeding", body: "Koolhydraten die meebewegen met de belasting van de dag, en fueling tijdens lange sessies.", pillar: "conditie" },
  { fase: 4, title: "Strava en bestanden", body: "Activiteiten automatisch binnen, of als FIT/GPX-bestand.", pillar: "duur" },
  { fase: 5, title: "Coach en eigen app", body: "AI-coach, iOS- en Android-app met GPS, Apple Health en Health Connect.", pillar: "mobiliteit" },
];

function Roadmap() {
  return (
    <Card>
      <div className="px-4 pt-4 pb-1 eyebrow">Wat eraan komt</div>
      <ol className="px-4 pb-3">
        {ROADMAP.map((r, i) => (
          <li key={r.fase} className="flex gap-3 py-2.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span
              className="shrink-0 flex items-center justify-center tnum disp text-sm"
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                background: r.done ? C.accent : "transparent",
                color: r.done ? C.onAccent : r.pillar ? K[r.pillar].ink : C.muted,
                border: r.done ? "none" : `1.5px solid ${r.pillar ? K[r.pillar].fill : C.line}`,
                fontWeight: 600,
              }}
            >
              {r.done ? <HIcon name="check" size={15} /> : r.fase}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold" style={{ color: C.ink }}>
                {r.title}
              </span>
              <span className="block text-xs leading-relaxed mt-0.5" style={{ color: C.muted }}>
                {r.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PillarLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {Object.entries(K).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: v.fill }} />
          {v.label}
        </span>
      ))}
    </div>
  );
}

function NexaLink({ found }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="eyebrow mb-1">Gekoppeld aan Nexa</div>
      <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
        {found
          ? "Uw voedingsprofiel uit Nexa staat al op dit apparaat. Hybrid gebruikt het straks om uw koolhydraten af te stemmen op uw trainingsweek."
          : "Hybrid gebruikt dezelfde voedingsmotor als Nexa. Uw profiel stelt u straks één keer in, voor beide apps."}
      </p>
    </Card>
  );
}

/* ---------------- toegang: upgrade of abonneren ---------------- */
const HYBRID_FEATURES = [
  ["Eén schema voor kracht en duur", "zonder dat het ene het andere in de weg zit"],
  ["Past zich aan u aan", "aan uw herstel, gemiste sessies en voortgang"],
  ["Alles wat u traint", "hardlopen, fietsen, roeien, zwemmen, WOD's en Hyrox"],
  ["Voeding die meebeweegt", "meer koolhydraten op zware dagen, fueling bij lange sessies"],
  ["Inclusief Nexa Coach", "alles van Nexa Coach zit erbij"],
];

function Paywall({ acc, onStart, busy }) {
  const [plan, setPlan] = useState("hybrid_jaar");
  const upgrade = acc.state === "upgrade";
  const p = acc.prices;
  const trial = !upgrade && !acc.hadTrial;
  const saving = Math.round((1 - p.hybrid_jaar / (p.hybrid_maand * 12)) * 100);
  const opt = (id, title, price, sub) => {
    const on = plan === id;
    return (
      <button
        key={id}
        onClick={() => setPlan(id)}
        aria-pressed={on}
        className="tap w-full text-left px-3.5 py-3"
        style={{ borderRadius: R.field, border: `1.5px solid ${on ? C.accent : C.line}`, background: on ? "var(--accent-soft)" : C.panel }}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold" style={{ color: C.ink }}>
            {title}
          </span>
          <span className="disp text-xl tnum" style={{ color: C.ink, fontWeight: 600 }}>
            {price}
          </span>
        </span>
        <span className="text-xs block mt-0.5" style={{ color: C.muted }}>
          {sub}
        </span>
      </button>
    );
  };
  const delta = upgradeDelta(p, acc.coachPlan, plan);
  return (
    <Card className="px-4 pt-5 pb-5">
      <Contours seed={2} />
      <div className="relative">
        <div className="eyebrow">{upgrade ? "Upgrade vanaf Nexa Coach" : "Nexa Hybrid"}</div>
        <h2 className="disp text-[28px] leading-tight mt-1" style={{ color: C.ink, fontWeight: 600 }}>
          Train kracht en duur als één systeem.
        </h2>
        <ul className="mt-4 space-y-2">
          {HYBRID_FEATURES.map(([t, d], i) => (
            <li key={t} className="flex gap-2.5 text-sm leading-snug">
              <span className="shrink-0 mt-[3px]" style={{ width: 10, height: 10, borderRadius: 5, background: i % 2 ? "var(--ember-fill)" : "var(--tide-fill)" }} />
              <span style={{ color: C.ink }}>
                {t} <span style={{ color: C.muted }}>· {d}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 space-y-2.5">
          {opt("hybrid_jaar", "Per jaar", eur(p.hybrid_jaar), `${eur(p.hybrid_jaar / 12)} per maand · ${saving}% voordeliger`)}
          {opt("hybrid_maand", "Per maand", eur(p.hybrid_maand), "maandelijks opzegbaar")}
        </div>
        <button
          onClick={() => onStart(plan)}
          disabled={busy}
          className="tap w-full mt-4 py-3.5 disp text-xl"
          style={{ background: C.accent, color: C.onAccent, borderRadius: R.field, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Even geduld…" : upgrade ? "Upgraden naar Hybrid" : trial ? `Start ${acc.trialDays} dagen gratis` : "Abonneren"}
        </button>
        <p className="text-xs mt-2.5 leading-relaxed text-center" style={{ color: C.muted }}>
          {upgrade
            ? acc.trialing
              ? `Uw proefperiode loopt gewoon door. Daarna ${eur(p[plan])} per ${plan.endsWith("jaar") ? "jaar" : "maand"}, incl. btw.`
              : `Ongeveer ${eur(delta)} per maand extra. U betaalt alleen het verschil voor de rest van uw huidige periode.`
            : trial
            ? `Daarna ${eur(p[plan])} per ${plan.endsWith("jaar") ? "jaar" : "maand"}, incl. btw. Opzeggen kan altijd, gewoon in de app.`
            : `${eur(p[plan])} per ${plan.endsWith("jaar") ? "jaar" : "maand"}, incl. btw. Opzeggen kan altijd, gewoon in de app.`}
          {!acc.loggedIn ? " U logt eerst in of maakt een gratis Nexa-account." : ""}
        </p>
        {acc.error && (
          <p className="text-xs mt-2 text-center" style={{ color: C.train }} role="alert">
            {acc.error}
          </p>
        )}
      </div>
    </Card>
  );
}

/* ---------------- tabs ---------------- */
const dayLine = () => new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });

function Today({ acc, onStart, nexaFound, notice }) {
  return (
    <div className="space-y-4">
      <Reveal>
        <div>
          <div className="eyebrow">{dayLine()}</div>
          <h1 className="disp text-[34px] leading-none mt-1" style={{ color: C.ink, fontWeight: 600 }}>
            Vandaag
          </h1>
        </div>
      </Reveal>
      {notice && (
        <Card className="px-4 py-3" style={{ borderColor: C.accent }}>
          <p className="text-sm" style={{ color: C.ink }} role="status">
            {notice}
          </p>
        </Card>
      )}
      {acc.locked ? (
        <Paywall acc={acc} onStart={onStart} busy={acc.busy} />
      ) : (
        <Card className="px-4 pt-5 pb-4">
          <Contours />
          <div className="relative">
            <div className="eyebrow">Fase 0 · fundering</div>
            <h2 className="disp text-[26px] leading-tight mt-1" style={{ color: C.ink, fontWeight: 600 }}>
              Twee systemen, één motor.
            </h2>
            <p className="text-sm leading-relaxed mt-2" style={{ color: C.muted, maxWidth: "52ch" }}>
              Hier verschijnt straks uw training van vandaag: een sessie kracht, duur of conditie, afgestemd op hoe u er vandaag bij staat.
            </p>
            <div className="mt-4">
              <PillarLegend />
            </div>
          </div>
        </Card>
      )}
      <NexaLink found={nexaFound} />
      <Roadmap />
    </div>
  );
}

function Empty({ title, body, fase, pillar = "duur" }) {
  return (
    <div className="space-y-4">
      <h1 className="disp text-[34px] leading-none" style={{ color: C.ink, fontWeight: 600 }}>
        {title}
      </h1>
      <Card className="px-4 py-8 text-center">
        <Contours seed={fase} />
        <div className="relative">
          <div className="mx-auto mb-3" style={{ width: 44, height: 4, borderRadius: 2, background: K[pillar].fill }} />
          <p className="text-sm leading-relaxed mx-auto" style={{ color: C.ink, maxWidth: "40ch" }}>
            {body}
          </p>
          <p className="eyebrow mt-3">Komt in fase {fase}</p>
        </div>
      </Card>
    </div>
  );
}

function Profile({ nx, acc, onConsent }) {
  const manage = () => window.nexaSync && window.nexaSync.portal({ from: "hybrid" }).catch(() => {});
  return (
    <div>
      <h1 className="disp text-[34px] leading-none mb-5" style={{ color: C.ink, fontWeight: 600 }}>
        Profiel
      </h1>
      <AccountSection s={nx} onConsent={onConsent} />
      {acc.on && acc.sub && (
        <Section title="Abonnement" accent="var(--ember-fill)">
          <Row label={acc.state === "open" ? "Nexa Hybrid" : "Nexa Coach"} hint={acc.state === "open" ? "Inclusief alles van Nexa Coach." : "Upgrade naar Hybrid op Vandaag."}>
            <TBtn small kind="ghost" onClick={manage}>
              Beheren
            </TBtn>
          </Row>
        </Section>
      )}
      <Section title="Nexa" accent="var(--tide-fill)">
        <Row label="Naar Nexa" hint="Voeding en krachttraining, met hetzelfde account.">
          <a href="/app/" className="tap text-sm font-semibold" style={{ color: C.accent }}>
            Openen
          </a>
        </Row>
      </Section>
    </div>
  );
}

/* ---------------- foutopvang ----------------
   Eigen versie: die van Nexa wist bij herstellen de Nexa-gegevens. Deze
   wist alleen de Hybrid-gegevens. */
class HybridBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  async reset() {
    try {
      await window.storage.delete(HYBRID_KEY);
    } catch (e) {
      /* opslag was er mogelijk niet */
    }
    location.reload();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="macroapp hybrid mx-auto max-w-2xl px-5 py-10" style={{ color: C.ink }}>
        <h1 className="disp text-3xl mb-2" style={{ fontWeight: 600 }}>
          Er ging iets mis
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: C.muted }}>
          De app kon deze weergave niet opbouwen. Uw Nexa-gegevens blijven altijd staan; herstellen wist alleen de instellingen van Hybrid.
        </p>
        <TBtn onClick={() => this.reset()}>Hybrid herstellen</TBtn>
      </div>
    );
  }
}

/* ---------------- app ---------------- */
function HybridApp() {
  const nx = useNexaSync();
  const acc = hybridAccess(nx);
  const [tab, setTab] = useState("vandaag");
  const [accountOpen, setAccountOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [nexaFound, setNexaFound] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!window.storage) return;
    window.storage
      .get(NEXA_KEY)
      .then((r) => setNexaFound(!!(r && r.value)))
      .catch(() => setNexaFound(false));
  }, []);

  /* Terug van Stripe: status verversen en de vraag uit de adresbalk halen. */
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("abonnement");
    if (!q) return;
    history.replaceState(null, "", location.pathname);
    if (q === "gelukt") {
      setNotice("Welkom bij Nexa Hybrid. Uw abonnement is actief.");
      if (window.nexaSync) window.nexaSync.refreshBilling().catch(() => {});
    } else if (q === "geannuleerd") setNotice("Afrekenen is geannuleerd. Er is niets in rekening gebracht.");
  }, []);

  const start = (plan) => {
    if (!window.nexaSync) return;
    if (!acc.loggedIn) return setAccountOpen(true);
    window.nexaSync.checkout(plan, { from: "hybrid" }).catch(() => {});
  };

  const page =
    tab === "vandaag" ? (
      <Today acc={acc} onStart={start} nexaFound={nexaFound} notice={notice} />
    ) : tab === "week" ? (
      <Empty title="Week" fase={2} pillar="kracht" body="Uw weekschema met kracht, duur en conditie, slim verdeeld zodat zware sessies elkaar niet in de weg zitten." />
    ) : tab === "log" ? (
      <Empty title="Log" fase={1} pillar="duur" body="Elke training vastleggen: sets en gewichten, afstand en tempo, of uw WOD-tijd. Alles telt mee in één belastingsmaat." />
    ) : tab === "voortgang" ? (
      <Empty title="Voortgang" fase={1} pillar="conditie" body="Uw fitheid, vermoeidheid en vorm over de weken, plus records per discipline." />
    ) : (
      <Profile nx={nx} acc={acc} onConsent={() => setConsentOpen(true)} />
    );

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, color: C.ink }}>
      <style>{STYLE + HYBRID_STYLE}</style>
      <div className="macroapp hybrid mx-auto max-w-2xl px-4" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}>
        <header className="flex items-center justify-between mb-6">
          <Wordmark />
          {nx && !nx.user && (
            <button onClick={() => setAccountOpen(true)} className="tap text-sm font-semibold" style={{ color: C.accent }}>
              Inloggen
            </button>
          )}
        </header>
        <HybridBoundary key={tab}>{page}</HybridBoundary>
      </div>

      <nav
        className="fixed bottom-0 inset-x-0"
        style={{ background: C.panel, borderTop: `1px solid ${C.line}`, paddingBottom: "env(safe-area-inset-bottom, 0px)", zIndex: 30 }}
        aria-label="Hoofdmenu"
      >
        <div className="macroapp mx-auto max-w-2xl grid grid-cols-5">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={on ? "page" : undefined}
                className="tap flex flex-col items-center gap-1 py-2.5 text-[11px]"
                style={{ color: on ? C.accent : C.muted, fontWeight: on ? 600 : 500 }}
              >
                <HIcon name={t.id} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {accountOpen && (
        <Sheet title="Nexa-account" onClose={() => setAccountOpen(false)}>
          <p className="text-sm leading-relaxed mb-4" style={{ color: C.muted }}>
            Nexa en Nexa Hybrid delen één account. Heeft u al een Nexa-account, log dan gewoon in.
          </p>
          <AccountForm initial="login" onDone={() => setAccountOpen(false)} />
        </Sheet>
      )}
      {consentOpen && <ConsentSheet onClose={() => setConsentOpen(false)} />}
    </div>
  );
}

export default function HybridRoot() {
  return (
    <HybridBoundary>
      <HybridApp />
    </HybridBoundary>
  );
}
