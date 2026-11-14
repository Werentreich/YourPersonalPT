/* Opdrachtpalet (Ctrl/⌘ + K): overal naartoe en elke actie vanaf het
   toetsenbord of met één zoekveld. Stijl via de klassen in STYLE. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, groupCommands } from "./palette.js";

export function CommandPalette({ commands, onClose }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const list = useMemo(() => filterCommands(commands, q), [commands, q]);
  const groups = useMemo(() => groupCommands(list), [list]);
  useEffect(() => {
    const prev = document.activeElement;
    document.body.style.overflow = "hidden";
    if (inputRef.current) inputRef.current.focus();
    return () => {
      document.body.style.overflow = "";
      if (prev && typeof prev.focus === "function" && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [sel, q]);
  const run = (c) => {
    onClose();
    if (c && c.run) c.run();
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(list.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list[sel]) run(list[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus blijft in het zoekveld; pijltjes kiezen
    }
  };
  let idx = -1;
  return (
    <div className="overlay palette-overlay no-print" onClick={onClose}>
      <div className="macroapp palette" role="dialog" aria-modal="true" aria-label="Zoeken en opdrachten" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-input">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek een scherm, sectie of actie"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={list[sel] ? `cmd-${list[sel].id}` : undefined}
            aria-label="Zoeken"
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" className="palette-list" aria-label="Resultaten">
          {list.length === 0 && <p className="palette-empty">Niets gevonden voor “{q}”. Probeer een ander woord, bijvoorbeeld “gewicht” of “slaap”.</p>}
          {groups.map((g) => (
            <div key={g.group} role="group" aria-label={g.group}>
              <div className="palette-group">{g.group}</div>
              {g.items.map((c) => {
                idx++;
                const i = idx;
                return (
                  <div key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === sel} className="palette-item" onMouseMove={() => i !== sel && setSel(i)} onClick={() => run(c)}>
                    <span className="palette-label">{c.label}</span>
                    {c.hint && <span className="palette-hint">{c.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> kiezen
          </span>
          <span>
            <kbd className="kbd">↵</kbd> openen
          </span>
        </div>
      </div>
    </div>
  );
}
