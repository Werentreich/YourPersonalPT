/* Bouwstenen van Nexa Hybrid: kaarten, invoer en kleine weergaven. */
import React, { useState } from "react";
import { C, R } from "../../App.jsx";
import { K } from "../theme.js";
import { fmtDuration, parseDuration } from "../engine/model.js";

export function Card({ children, className = "", style, onClick, label }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      aria-label={label}
      className={`relative overflow-hidden block w-full text-left ${onClick ? "tap" : ""} ${className}`}
      style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: R.card, boxShadow: C.shadow, ...style }}
    >
      {children}
    </Tag>
  );
}

/* Hoogtelijnen als achtergrondmotief (geen strepen of tape). */
export function Contours({ seed = 0 }) {
  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 18 + i * 15 + seed * 3;
    const a = 9 + ((i * 5 + seed) % 7);
    return `M-10 ${y} C 60 ${y - a}, 110 ${y + a}, 170 ${y - a / 2} S 280 ${y + a}, 340 ${y}`;
  });
  return (
    <svg className="contours absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 330 130" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--contour)" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

const ICONS = {
  vandaag: ["M12 3v2", "M12 19v2", "M3 12h2", "M19 12h2", "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8"],
  week: ["M4 6h16", "M4 6v13h16V6", "M8 3v4", "M16 3v4", "M8 12h2", "M14 12h2", "M8 16h2"],
  log: ["M5 4h14v16H5z", "M9 9h6", "M9 13h6", "M9 17h3"],
  voortgang: ["M4 19h16", "M5 15l4-4 3 3 7-7", "M15 7h4v4"],
  profiel: ["M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8", "M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  plus: ["M12 5v14", "M5 12h14"],
  upload: ["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M5 15v4h14v-4"],
  trash: ["M5 7h14", "M10 7V4h4v3", "M7 7l1 13h8l1-13"],
  chevron: ["M9 6l6 6-6 6"],
  gps: ["M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z", "M12 8.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5"],
};
export function HIcon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export const Eyebrow = ({ children, className = "" }) => <div className={`eyebrow ${className}`}>{children}</div>;

export function PillarDot({ pillar, size = 8 }) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size, borderRadius: size / 2, background: K[pillar].fill, flexShrink: 0 }} />;
}

/* Label met veld eronder. */
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: C.muted, fontWeight: 500 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs mt-1 leading-snug" style={{ color: C.muted }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/* lui opgebouwd: C en R komen uit App.jsx, dat in de gezamenlijke build later laadt */
const inputStyleOf = () => ({ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink });

export function TextInput({ value, onChange, placeholder, inputMode, multiline, rows = 3, ariaLabel }) {
  const common = {
    value: value ?? "",
    onChange: (e) => onChange(e.target.value),
    placeholder,
    "aria-label": ariaLabel,
    className: "w-full px-3 py-2.5 text-sm tnum",
    style: inputStyleOf(),
  };
  return multiline ? <textarea rows={rows} {...common} /> : <input type="text" inputMode={inputMode} {...common} />;
}

/* Getal met eenheid; leeg = null. */
export function NumInput({ value, onChange, unit, placeholder, step = "any", ariaLabel }) {
  return (
    <div className="flex items-center" style={{ ...inputStyleOf(), paddingRight: unit ? 10 : 0 }}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value ?? ""}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full px-3 py-2.5 text-sm tnum bg-transparent"
        style={{ color: C.ink, outline: "none" }}
      />
      {unit && (
        <span className="text-xs shrink-0" style={{ color: C.muted }}>
          {unit}
        </span>
      )}
    </div>
  );
}

/* Tijd als tekst ("45", "45:30", "1:02:15"); bewaard in seconden. */
export function DurationInput({ value, onChange, placeholder = "u:mm:ss", ariaLabel }) {
  const [text, setText] = useState(value ? fmtDuration(value) : "");
  const [bad, setBad] = useState(false);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      onChange={(e) => {
        setText(e.target.value);
        const sec = parseDuration(e.target.value);
        setBad(e.target.value !== "" && sec == null);
        onChange(e.target.value === "" ? null : sec);
      }}
      onBlur={() => value && setText(fmtDuration(value))}
      className="w-full px-3 py-2.5 text-sm tnum"
      style={{ ...inputStyleOf(), borderColor: bad ? C.train : C.line }}
    />
  );
}

/* Keuze als rij van knoppen die mag doorlopen op meerdere regels. */
export function Choice({ options, value, onChange, ariaLabel }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className="tap px-3 py-1.5 text-sm flex items-center gap-1.5"
            style={{ borderRadius: 999, border: `1px solid ${on ? C.accent : C.line}`, background: on ? "var(--accent-soft)" : C.panel, color: C.ink, fontWeight: on ? 600 : 500 }}
          >
            {o.dot && <PillarDot pillar={o.dot} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Inspanning (sessie-RPE, Borg CR10) met korte uitleg per stap. */
const RPE_TEXT = ["Rust", "Heel licht", "Licht", "Rustig", "Iets zwaar", "Zwaar", "Zwaar", "Erg zwaar", "Erg zwaar", "Bijna maximaal", "Maximaal"];
export function RpeInput({ value, onChange, estimate }) {
  const v = value ?? null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs" style={{ color: C.muted, fontWeight: 500 }}>
          Inspanning van de hele sessie
        </span>
        <span className="text-sm tnum" style={{ color: C.ink, fontWeight: 600 }}>
          {v != null ? `${v} · ${RPE_TEXT[v]}` : estimate != null ? `schatting ${String(estimate).replace(".", ",")}` : "niet ingevuld"}
        </span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(11, minmax(0, 1fr))" }} role="radiogroup" aria-label="Inspanning 0 tot 10">
        {RPE_TEXT.map((t, i) => {
          const on = v === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${i}, ${t}`}
              onClick={() => onChange(on ? null : i)}
              className="tap py-2 text-xs tnum"
              style={{ borderRadius: 8, border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.panel, color: on ? C.onAccent : C.ink, fontWeight: 600 }}
            >
              {i}
            </button>
          );
        })}
      </div>
      <p className="text-xs mt-1.5 leading-snug" style={{ color: C.muted }}>
        Hoe zwaar was de training als geheel, een halfuur na afloop? Leeg laten mag; dan schat de app het.
      </p>
    </div>
  );
}

/* Getal met label, voor kaarten. */
export function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-xs" style={{ color: C.muted }}>
        {label}
      </div>
      <div className="disp text-2xl tnum leading-tight" style={{ color: C.ink, fontWeight: 600 }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: C.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export const dateLabel = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", opts);
