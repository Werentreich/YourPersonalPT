/* Nexa Hybrid: timerprogramma per bloktype (zonder React). */
import { readFileSync } from "node:fs";
import * as B from "../src/hybrid/engine/blocks.js";
const src = readFileSync(new URL("../src/hybrid/ui/timer.jsx", import.meta.url), "utf8");
// timerProgram is puur; los uitvoeren met de echte blok-functies
const body = src.slice(src.indexOf("const PREP"), src.indexOf("export const canTime"));
const fn = new Function("itemLine", "tabataSlots", "intervalUnit", "num", "fmtDuration", body.replace("export function timerProgram", "function timerProgram") + "\nreturn timerProgram;");
const num = (v, f = null) => (v === "" || v == null ? f : Number.isFinite(Number(v)) ? Number(v) : f);
const timerProgram = fn(B.itemLine, B.tabataSlots, B.intervalUnit, num, () => "");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const T = (id) => B.TEMPLATES.find((t) => t.id === id).make();

const e = timerProgram(T("emom_engine"));
ok("EMOM 12: 12 fasen van 60 s, om de beurt", e.phases.length === 12 && e.phases.every((p) => p.sec === 60) && /roeien/.test(e.phases[0].what) && /burpees/.test(e.phases[2].what));
const e4 = timerProgram(T("e4m"));
ok("every 4 min × 5: 5 fasen van 240 s met alles", e4.phases.length === 5 && e4.phases[0].sec === 240 && /wall balls/.test(e4.phases[0].what));
const t = timerProgram(T("tabata_squat"));
ok("Tabata: 8 × werk + 7 × rust = 4 min − laatste rust", t.phases.length === 15 && t.phases.reduce((a, p) => a + p.sec, 0) === 230);
const t4 = timerProgram(T("tabata_4"));
ok("Tabata vier bewegingen op volgorde: beweging wisselt na 8 rondes", /air squats/i.test(t4.phases[16].what) && /roeien/i.test(t4.phases[14].what));
const iv = timerProgram(T("row500"));
ok("6 × 500 m: open werkfasen (stopwatch) met 1:30 rust", iv.mode === "interval" && !iv.byTime && iv.phases.filter((p) => p.kind === "work").every((p) => p.open) && iv.phases.filter((p) => p.kind === "rest").length === 5);
const n44 = timerProgram(T("norway4x4"));
ok("Noorse 4×4: vaste werktijd 240 s", n44.byTime && n44.phases[0].sec === 240 && n44.phases[1].sec === 180);
const pyr = timerProgram(T("ski_pyramid"));
ok("piramide: afstand per herhaling in de tekst", /^750 m/.test(pyr.phases.find((p) => p.rep === 2).what), pyr.phases.find((p) => p.rep === 2).what);
const am = timerProgram(T("cindy"));
ok("AMRAP: één fase van 20 min", am.mode === "amrap" && am.phases[0].sec === 1200);
const ft = timerProgram({ ...T("karen"), capSec: 600 });
ok("For Time: stopwatch met cap", ft.mode === "stopwatch" && ft.phases[0].open && ft.phases[0].cap === 600);
const db = timerProgram(T("deathby_burpees"));
ok("Death by: minuut 5 = 5 burpees", db.mode === "deathby" && /^5 × burpees/.test(db.phases[4].what));
console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
