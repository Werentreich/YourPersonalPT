/* Geplande kracht- of hybridetraining vooraf aanpassen, zoals in de
   Nexa-bodybuilding: oefening wisselen (eenmalig of voortaan), sets,
   herhalingen, rust, gewicht en notities, oefeningen toevoegen of weghalen.
   Opslaan zet de training op "zelf aangepast", zodat de planner hem laat
   staan als de week opnieuw wordt berekend. */
import React, { useState } from "react";
import { C, R, Sheet, TBtn } from "../App.jsx";
import { num } from "../hybrid/engine/model.js";
import { blockHeader } from "../hybrid/engine/blocks.js";
import { ExercisePicker, muscleOf } from "./LiveLift.jsx";
import { itemFor, isTimed, parseRange, setCount, setRange, setKg } from "./lift.js";

const inputStyle = () => ({ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: R.field, color: C.ink });
const RESTS = [30, 45, 60, 75, 90, 120, 150, 180, 240];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function PlanLiftEditor({ item, sessions, onSave, onSwapAlways, onClose }) {
  const [blocks, setBlocks] = useState(() => JSON.parse(JSON.stringify(item.blocks || [])));
  const [note, setNote] = useState(item.userNote || "");
  const [pick, setPick] = useState(null); // { mode: swap|add, bi, ii, muscle, name, from }
  const [always, setAlways] = useState(false);
  const [open, setOpen] = useState(null);
  const [rangeText, setRangeText] = useState({});

  const upd = (bi, ii, fn) => setBlocks((bs) => bs.map((b, k) => (k !== bi ? b : { ...b, items: b.items.map((it, n) => (n === ii ? fn(it) : it)) })));
  const remove = (bi, ii) => setBlocks((bs) => bs.map((b, k) => (k !== bi ? b : { ...b, items: b.items.filter((_, n) => n !== ii) })).filter((b) => b.type !== "sets" || b.items.length));

  const swap = (mv) => {
    const { bi, ii, from } = pick;
    upd(bi, ii, (it) => ({ ...itemFor(mv, sessions, it.sets.length, { target: (it.sets[0] || {}).target, restSec: it.restSec }), note: it.note, swappedFrom: it.swappedFrom || it.name }));
    if (always && from && mv.id && onSwapAlways) onSwapAlways(from, mv.id);
    setPick(null);
    setAlways(false);
  };
  const add = (mv) => {
    setBlocks((bs) => [...bs, { id: `x${Date.now().toString(36)}`, type: "sets", name: "Extra", items: [itemFor(mv, sessions, 3, null)], result: {} }]);
    setOpen(`${blocks.length}:0`);
    setPick(null);
  };

  return (
    <Sheet title="Training aanpassen" onClose={onClose}>
      <div className="space-y-4 pb-2">
        <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
          {item.title}. Wijzigingen gelden voor deze training; bij wisselen kunt u kiezen voor voortaan.
        </p>

        {blocks.map((b, bi) =>
          b.type !== "sets" ? (
            <div key={b.id || bi} className="px-3 py-2 text-sm" style={{ background: C.surface2, borderRadius: R.field }}>
              <span style={{ color: C.muted }}>{b.role === "warmup" ? "Warming-up" : b.role === "cooldown" ? "Cooling-down" : "Blok"}: </span>
              {blockHeader(b)}
            </div>
          ) : (
            <div key={b.id || bi} className="space-y-1.5">
              <div className="text-xs font-semibold px-1" style={{ color: b.superset ? C.accent : C.ink }}>
                {b.name || "Kracht"}
                {b.superset && b.items.length > 1 ? " · om de beurt" : ""}
              </div>
              {b.items.map((it, ii) => {
                const key = `${bi}:${ii}`;
                const isOpen = open === key;
                const timed = isTimed(it);
                const t = (it.sets[0] && it.sets[0].target) || {};
                const kg = it.sets.find((s) => s.kind !== "warmup" && s.kg != null);
                return (
                  <div key={key} style={{ background: C.panel, border: `1px solid ${isOpen ? C.accent : C.line}`, borderRadius: R.card }}>
                    <button onClick={() => setOpen(isOpen ? null : key)} className="tap w-full text-left px-3 py-2.5 flex items-center gap-2" aria-expanded={isOpen}>
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-semibold block truncate">{it.name}</span>
                        <span className="text-xs block" style={{ color: C.muted }}>
                          {it.sets.length} × {timed ? `${t.sec || "?"} s` : it.repRange || t.reps || "?"}
                          {kg ? ` · ${String(kg.kg).replace(".", ",")} kg` : ""} · rust {mmss(num(it.restSec, 90))}
                          {it.swappedFrom ? ` · in plaats van ${it.swappedFrom}` : ""}
                          {it.note ? " · notitie" : ""}
                        </span>
                      </span>
                      <span className="text-xs shrink-0" style={{ color: C.accent, fontWeight: 600 }}>
                        {isOpen ? "Klaar" : "Wijzig"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-3" style={{ borderTop: `1px solid ${C.lineSoft || C.line}` }}>
                        <div className="grid grid-cols-3 gap-2 pt-3">
                          <label className="block">
                            <span className="text-[11px]" style={{ color: C.muted }}>
                              Sets
                            </span>
                            <div className="flex items-center gap-1 mt-1">
                              <button onClick={() => upd(bi, ii, (x) => setCount(x, x.sets.length - 1))} className="tap w-8 h-9 text-lg" style={inputStyle()} aria-label="Set minder">
                                −
                              </button>
                              <span className="flex-1 text-center text-sm tnum font-semibold">{it.sets.length}</span>
                              <button onClick={() => upd(bi, ii, (x) => setCount(x, x.sets.length + 1))} className="tap w-8 h-9 text-lg" style={inputStyle()} aria-label="Set erbij">
                                +
                              </button>
                            </div>
                          </label>
                          {!timed && (
                            <label className="block">
                              <span className="text-[11px]" style={{ color: C.muted }}>
                                Herhalingen
                              </span>
                              <input
                                value={rangeText[key] ?? it.repRange ?? ""}
                                onChange={(e) => {
                                  setRangeText((r) => ({ ...r, [key]: e.target.value }));
                                  const r = parseRange(e.target.value);
                                  if (r) upd(bi, ii, (x) => setRange(x, r[0], r[1]));
                                }}
                                placeholder="8–10"
                                inputMode="numeric"
                                className="w-full mt-1 px-2 py-2 text-sm text-center tnum"
                                style={inputStyle()}
                                aria-label={`${it.name}: herhalingen`}
                              />
                            </label>
                          )}
                          <label className="block">
                            <span className="text-[11px]" style={{ color: C.muted }}>
                              kg
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              min="0"
                              value={kg ? kg.kg : ""}
                              onChange={(e) => upd(bi, ii, (x) => setKg(x, e.target.value === "" ? null : Number(e.target.value)))}
                              placeholder="vorige"
                              className="w-full mt-1 px-2 py-2 text-sm text-center tnum"
                              style={inputStyle()}
                              aria-label={`${it.name}: gewicht`}
                            />
                          </label>
                        </div>
                        <label className="block">
                          <span className="text-[11px]" style={{ color: C.muted }}>
                            Rust tussen sets
                          </span>
                          <div className="flex gap-1 flex-wrap mt-1">
                            {RESTS.map((r) => {
                              const on = num(it.restSec, 90) === r;
                              return (
                                <button key={r} onClick={() => upd(bi, ii, (x) => ({ ...x, restSec: r }))} className="tap px-2.5 py-1 text-xs tnum" style={{ borderRadius: 999, border: `1px solid ${on ? C.accent : C.line}`, background: on ? C.accent : C.panel, color: on ? C.onAccent : C.ink, fontWeight: 600 }}>
                                  {mmss(r)}
                                </button>
                              );
                            })}
                          </div>
                        </label>
                        <label className="block">
                          <span className="text-[11px]" style={{ color: C.muted }}>
                            Notitie bij deze oefening
                          </span>
                          <input value={it.note || ""} onChange={(e) => upd(bi, ii, (x) => ({ ...x, note: e.target.value.slice(0, 200) || undefined }))} placeholder="bijv. stoel stand 4, smalle grip" className="w-full mt-1 px-3 py-2 text-sm" style={inputStyle()} aria-label={`${it.name}: notitie`} />
                        </label>
                        <div className="flex gap-4 text-sm">
                          <button onClick={() => setPick({ mode: "swap", bi, ii, muscle: muscleOf(it), name: it.name, from: it.moveId })} className="tap" style={{ color: C.accent, fontWeight: 600 }}>
                            Wisselen
                          </button>
                          <button onClick={() => remove(bi, ii)} className="tap" style={{ color: C.muted }}>
                            Weghalen
                          </button>
                        </div>
                        {pick && pick.mode === "swap" && pick.bi === bi && pick.ii === ii && (
                          <div>
                            {pick.from && onSwapAlways && (
                              <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
                                <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                                Voortaan ook in volgende trainingen en weken
                              </label>
                            )}
                            <ExercisePicker title={`${pick.name} vervangen`} muscle={pick.muscle} exclude={[it.moveId]} onClose={() => setPick(null)} onPick={swap} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {pick && pick.mode === "add" ? (
          <ExercisePicker title="Oefening toevoegen" muscle={null} exclude={[]} onClose={() => setPick(null)} onPick={add} />
        ) : (
          <button onClick={() => setPick({ mode: "add" })} className="tap w-full py-2.5 text-sm" style={{ border: `1px dashed ${C.line}`, borderRadius: R.card, color: C.accent, fontWeight: 600, background: "transparent" }}>
            + Oefening toevoegen
          </button>
        )}

        <label className="block">
          <span className="text-xs" style={{ color: C.muted }}>
            Notitie bij deze training
          </span>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="bijv. vandaag in de andere sportschool" className="w-full mt-1 px-3 py-2 text-sm" style={{ ...inputStyle(), resize: "none" }} aria-label="Notitie bij deze training" />
        </label>

        <div className="flex gap-2">
          <TBtn onClick={() => onSave({ ...item, blocks, userNote: note.trim() || undefined })}>Opslaan</TBtn>
          <TBtn kind="ghost" onClick={onClose}>
            Annuleren
          </TBtn>
        </div>
      </div>
    </Sheet>
  );
}
