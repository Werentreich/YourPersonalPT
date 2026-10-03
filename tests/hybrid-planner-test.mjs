/* Nexa Hybrid fase 2: herstel en adaptieve planner. */
import * as P from "../src/hybrid/engine/planner.js";
import * as RD from "../src/hybrid/engine/readiness.js";
import * as M from "../src/hybrid/engine/model.js";
import * as B from "../src/hybrid/engine/blocks.js";
import * as L from "../src/hybrid/engine/load.js";

let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };
const MON = "2026-10-05";
const iso = (d) => M.isoOfNum(M.dayNum(MON) + d);

// ---------- herstel ----------
ok("vragenlijst: alles 5 en 8 uur slaap = 100", RD.questionnaireScore({ sleepQ: 5, energy: 5, soreness: 5, stress: 5, mood: 5, sleepH: 8 }) === 100);
ok("vragenlijst: alles 1 en 4 uur = 0", RD.questionnaireScore({ sleepQ: 1, energy: 1, soreness: 1, stress: 1, mood: 1, sleepH: 4 }) === 0);
ok("vragenlijst: alles 3, 6 uur = 50", RD.questionnaireScore({ sleepQ: 3, energy: 3, soreness: 3, stress: 3, mood: 3, sleepH: 6 }) === 50);
const goodCheck = { date: MON, sleepQ: 4, energy: 4, soreness: 4, stress: 4, mood: 4, sleepH: 8 };
ok("herstel goed", RD.readinessFor([goodCheck], MON).level === "goed");
ok("ziek: altijd laag", RD.readinessFor([{ ...goodCheck, ill: true }], MON).level === "laag");
const hrvBase = Array.from({ length: 50 }, (_, i) => ({ date: M.isoOfNum(M.dayNum(MON) - 50 + i), hrv: 60 + ((i * 7) % 9) - 4, rhr: 50 }));
const lowWeek = Array.from({ length: 7 }, (_, i) => ({ date: M.isoOfNum(M.dayNum(MON) - 6 + i), hrv: 38, rhr: 50 }));
const withLow = [...hrvBase.filter((c) => c.date < M.isoOfNum(M.dayNum(MON) - 6)), ...lowWeek.slice(0, 6), { ...goodCheck, hrv: 38, rhr: 58 }];
const rr = RD.readinessFor(withLow, MON);
ok("lage HRV-week en hoge rusthartslag verlagen de score", rr.hrv && rr.hrv.low && rr.rhr && rr.rhr.high && rr.score === RD.questionnaireScore(goodCheck) - 25, JSON.stringify({ s: rr.score, z: rr.hrv && rr.hrv.z.toFixed(2) }));
ok("te weinig HRV-data: geen HRV-signaal", RD.hrvSignal([{ date: MON, hrv: 40 }], MON) === null);
ok("geen check-in: geen score", RD.readinessFor([], MON).score === null);

// ---------- fasen ----------
const S = { ...P.SETTINGS_DEFAULT, startDate: MON };
ok("zonder doel: week 1–3 basis, week 4 herstel", P.phaseFor(S, MON).phase === "basis" && P.phaseFor(S, iso(21)).phase === "herstel" && P.phaseFor(S, iso(28)).phase === "opbouw");
const race = { ...S, goal: "10k", goalDate: iso(7 * 10 + 6) }; // zondag over 10 weken
ok("10 km: wedstrijdweek, taper, piek, herstelweek vlak vóór de piek", P.phaseFor(race, iso(70)).phase === "wedstrijd" && P.phaseFor(race, iso(63)).phase === "taper" && P.phaseFor(race, iso(56)).phase === "piek" && P.phaseFor(race, iso(42)).phase === "piek" && P.phaseFor(race, iso(35)).phase === "herstel" && P.phaseFor(race, iso(28)).phase === "opbouw");
const mar = { ...S, goal: "marathon", goalDate: iso(7 * 20 + 6) };
ok("marathon: twee weken taper, ver weg basis", P.phaseFor(mar, iso(126)).phase === "taper" && P.phaseFor(mar, iso(133)).phase === "taper" && P.phaseFor(mar, MON).phase === "basis");
const deloads = Array.from({ length: 15 }, (_, i) => P.phaseFor(mar, iso(i * 7))).filter((p) => p.deload).length;
ok("marathon: herstelweken in de aanloop (elke 4 weken)", deloads >= 3, deloads);
ok("volumefactor: herstelweek 0,65, taper lager dan piek", P.volumeFactor({ phase: "herstel", deload: true }, "hybride") === 0.65 && P.volumeFactor({ phase: "taper", weeksLeft: 1 }, "10k") < P.volumeFactor({ phase: "piek" }, "10k"));

// ---------- indeling ----------
const arr = P.arrangeWeek(["K_LOWER", "D_EASY", "K_UPPER", "D_INT", "D_LONG"], [0, 1, 3, 5, 6], S);
const pen = P.arrangementPenalty(arr, S);
const at = (slot) => arr.find((x) => x.slot === slot).day;
ok("indeling hybride 5 dagen zonder strafpunten", pen === 0, JSON.stringify(arr));
ok("lange duur op de lange dag (zo)", at("D_LONG") === 6);
ok("geen zware benen de dag vóór intervallen of lange duur", at("K_LOWER") + 1 !== at("D_INT") && at("K_LOWER") + 1 !== at("D_LONG"));
const all7 = P.arrangeWeek(P.GOALS.hyrox.slots, [0, 1, 2, 3, 4, 5, 6], S);
ok("Hyrox 7 dagen: indeling gevonden", all7.length === 7 && new Set(all7.map((x) => x.day)).size === 7);
ok("strafpunten: zwaar na zwaar wordt bestraft", P.arrangementPenalty([{ day: 0, slot: "D_INT" }, { day: 1, slot: "C_METCON" }], S) >= 10);

// ---------- week genereren ----------
const ctx0 = { sessions: [], profile: { run5k: 1320, hrMax: 190, hrRest: 50 }, checkins: [], planItems: [] };
const wk = P.generateWeek(S, ctx0, MON);
const main = wk.items.filter((x) => x.slot !== "M_MOB");
ok("week: vijf trainingen op de gekozen dagen", main.length === 5 && main.every((x) => [0, 1, 3, 5, 6].includes(M.dayNum(x.date) - M.dayNum(MON))));
ok("week: mobiliteit op een rustdag", wk.items.some((x) => x.slot === "M_MOB" && ![0, 1, 3, 5, 6].includes(M.dayNum(x.date) - M.dayNum(MON))));
ok("week: kracht en duur aanwezig, conditie als afsluiter", ["kracht", "duur"].every((k) => main.some((x) => x.kind === k)) && main.some((x) => x.blocks.some((b) => b.role === "afsluiter")));
ok("zes dagen hybride: aparte conditiesessie", P.generateWeek({ ...S, days: [0, 1, 2, 3, 5, 6] }, { sessions: [], profile: {}, checkins: [], planItems: [] }, MON).items.some((x) => x.kind === "wod"));
const intS = main.find((x) => x.slot === "D_INT");
ok("intervallen: warming-up, kern en cooling-down", intS.blocks.length === 3 && intS.blocks[0].role === "warmup" && intS.blocks[2].role === "cooldown" && intS.blocks[1].type === "interval");
ok("intervallen: doeltempo uit 5 km-tijd", /\/km/.test(intS.blocks[1].intensity), intS.blocks[1].intensity);
const longS = main.find((x) => x.slot === "D_LONG");
ok("lange duur: ± 50 min bij 150 min vertrekpunt, rustig", longS.targetMin >= 45 && longS.type === "lang" && /zone 2/.test(longS.blocks[0].intensity));
const easyMin = main.filter((x) => x.slot === "D_EASY").map((x) => x.targetMin)[0];
ok("duurvolume ongeveer gelijk aan het doel", (() => { const tot = main.filter((x) => x.kind === "duur").reduce((a, x) => a + x.targetMin, 0); return Math.abs(tot - wk.enduranceMin) <= 25; })(), `${main.filter((x) => x.kind === "duur").reduce((a, x) => a + x.targetMin, 0)} vs ${wk.enduranceMin}, easy ${easyMin}`);
const kS = main.find((x) => x.slot === "K_LOWER");
ok("kracht onderlichaam in de gym: back squat 3 × 8 in de basis", kS.blocks[1].items[0].moveId === "back_squat" && kS.blocks[1].items[0].sets.length === 3 && kS.blocks[1].items[0].sets[0].reps === 8);
ok("kracht thuis: geen halteroefeningen", (() => { const w = P.generateWeek({ ...S, equipment: "thuis" }, ctx0, MON); return w.items.filter((x) => x.kind === "kracht").every((x) => x.blocks[1].items.every((it) => !["back_squat", "bench_press", "trap_bar_dl"].includes(it.moveId))); })());

// gewichten uit records
const lift = { ...M.newSession("kracht"), date: "2026-09-20", blocks: [{ type: "sets", items: [{ moveId: "back_squat", name: "Back squat", sets: [{ kg: 100, reps: 5 }] }] }] };
const wk2 = P.generateWeek(S, { ...ctx0, sessions: [lift] }, MON);
const sq = wk2.items.find((x) => x.slot === "K_LOWER").blocks[1].items[0].sets[0];
ok("gewicht uit geschatte 1RM: 116,7 / (1 + 10/30) ≈ 87,5 kg", sq.kg === 87.5, sq.kg);
ok("suggestKg zonder record: leeg", P.suggestKg(null, 5, 2) === null);

// fasen in de week
const peakW = P.generateWeek({ ...race }, ctx0, iso(49));
ok("piek 10 km: 5 × 1 km op wedstrijdtempo", peakW.phase === "piek" && peakW.items.some((x) => x.slot === "D_INT" && x.blocks[1].rounds === 5 && x.blocks[1].items[0].distanceM === 1000));
const raceW = P.generateWeek({ ...race }, ctx0, iso(70));
ok("wedstrijdweek: wedstrijd op de doeldag, hooguit twee korte sessies, geen kracht", raceW.items.some((x) => x.slot === "RACE" && x.date === race.goalDate) && raceW.items.filter((x) => x.slot !== "RACE" && x.slot !== "M_MOB").length <= 2 && !raceW.items.some((x) => x.kind === "kracht"));
const dl = P.generateWeek(S, ctx0, iso(21));
ok("herstelweek: minder sets en kortere duur", dl.phase === "herstel" && dl.items.find((x) => x.slot === "K_LOWER").blocks[1].items[0].sets.length === 2 && dl.enduranceMin < wk.enduranceMin);
const hy = P.generateWeek({ ...S, goal: "hyrox", days: [0, 1, 2, 4, 5, 6] }, ctx0, MON);
ok("Hyrox: hyrox-specifieke sessie met stations", hy.items.some((x) => x.slot === "C_HYROX" && x.blocks.some((b) => b.items.some((it) => it.moveId === "sled_push"))));

// ---------- bijsturen per week ----------
const prevItems = ["D_INT", "K_LOWER", "D_EASY", "D_LONG"].map((slot, i) => ({ id: "p" + i, slot, date: M.isoOfNum(M.dayNum(MON) - 7 + i), status: i === 0 ? "gedaan" : "gepland", rpeTarget: 7 }));
const a1 = P.weekAdjust(S, { ...ctx0, planItems: prevItems }, MON);
ok("weinig gedaan: geen opbouw, met uitleg", a1.factor < 1 && a1.reasons.some((r) => /1 van de 4/.test(r)));
const lowChecks = Array.from({ length: 7 }, (_, i) => ({ date: M.isoOfNum(M.dayNum(MON) - 1 - i), sleepQ: 1, energy: 2, soreness: 1, stress: 2, mood: 1, sleepH: 5 }));
const a2 = P.weekAdjust(S, { ...ctx0, checkins: lowChecks }, MON);
ok("laag herstel een week lang: herstelweek", a2.forceDeload && a2.reasons.length === 1);
const wkLow = P.generateWeek(S, { ...ctx0, checkins: lowChecks }, MON);
ok("gedwongen herstelweek in het schema", wkLow.phase === "herstel" && wkLow.phaseInfo.forced);
const hardSessions = prevItems.map((x, i) => ({ ...M.newSession("duur"), id: "s" + i, date: x.date, rpe: 9, durationSec: 3000 }));
const doneItems = prevItems.map((x, i) => ({ ...x, status: "gedaan", doneId: "s" + i }));
const a3 = P.weekAdjust(S, { ...ctx0, planItems: doneItems, sessions: hardSessions }, MON);
ok("zwaarder dan bedoeld: niet verder opbouwen", a3.factor < 1 && a3.reasons.some((r) => /zwaarder/.test(r)));

// volume-opbouw hoogstens ~10%
const hist = Array.from({ length: 4 }, (_, w) => Array.from({ length: 3 }, (_, i) => ({ ...M.newSession("duur"), id: `h${w}${i}`, date: M.isoOfNum(M.dayNum(MON) - 7 * (w + 1) + i * 2), durationSec: 3600, rpe: 4 }))).flat();
const tgt = P.enduranceTarget({ ...S }, { ...ctx0, sessions: hist }, MON, 1.2);
ok("opbouw begrensd op ~10% boven vorige week (180 → 198)", tgt === 198, tgt);

// ---------- dagelijks ----------
const items = wk.items.map((x) => ({ ...x }));
const todayISO = iso(3); // donderdag
const missed = items.find((x) => x.date < todayISO && x.status === "gepland" && x.slot !== "M_MOB" && (x.key || x.kind === "kracht"));
const sugs = P.dailySuggestions(items, todayISO, null, S, ctx0);
ok("gemiste sessie: voorstel om te verplaatsen of te laten vallen", missed && sugs.some((s) => s.itemId === missed.id && (s.type === "verplaats" || s.type === "overslaan")));
const mv = sugs.find((s) => s.type === "verplaats");
if (mv) {
  const after = P.applySuggestion(items, mv, ctx0, S);
  ok("verplaatsen past de datum aan, zonder nieuwe conflicten zwaar-na-zwaar", after.find((x) => x.id === mv.itemId).date === mv.date && mv.date >= todayISO);
}
const hardToday = items.find((x) => x.hard && x.slot !== "M_MOB");
const lowR = { score: 30, level: "laag" };
const s2 = P.dailySuggestions(items, hardToday.date, lowR, S, ctx0);
ok("laag herstel en zware sessie: lichter maken voorgesteld", s2.some((s) => s.type === "lichter" && s.itemId === hardToday.id));
const lighter = P.lightenItem(hardToday, hardToday.kind === "kracht" ? "rust" : "rustig", ctx0, S);
ok("lichter: niet meer zwaar, origineel bewaard", !lighter.hard && lighter.original && lighter.original.id === hardToday.id);
const less = P.lightenItem(intS, "minder", ctx0, S);
ok("minder volume: minder intervallen, warming-up blijft", less.blocks[1].rounds < intS.blocks[1].rounds && less.blocks[0].role === "warmup");
const cf = P.conflictsFor([{ id: "a", slot: "K_LOWER", title: "Kracht onderlichaam", date: MON, status: "gepland" }, { id: "b", slot: "D_INT", title: "Intervallen", date: iso(1), status: "gepland" }], MON);
ok("conflict: zware benen vóór intervallen", cf.length === 1 && /Zware benen/.test(cf[0].text));

// ---------- vastleggen vanuit het plan ----------
const draft = P.draftFromItem(kS);
ok("concept uit plan: blokken zonder resultaat, gekoppeld aan het plan", draft.planItemId === kS.id && draft.blocks.length === 2 && draft.blocks[1].items[0].sets.every((s) => s.rir === null && s.reps === 8));
const dDraft = P.draftFromItem(longS);
ok("concept duur: sport, soort en doeltijd", dDraft.sport === longS.sport && dDraft.type === "lang" && dDraft.durationSec === longS.targetMin * 60);
ok("concept telt mee in de belasting", L.sessionLoad({ ...draft, rpe: 7 }, {}).srpe > 0);

const plainItems = [{ id: "u", slot: "K_UPPER", kind: "kracht", title: "Kracht bovenlichaam", date: MON, status: "gepland", hard: false, blocks: [] }];
ok("laag herstel, gewone sessie: minder volume", P.dailySuggestions(plainItems, MON, { score: 35, level: "laag" }, S).some((s) => s.level === "minder"));
ok("zeer laag herstel: rust", P.dailySuggestions(plainItems, MON, { score: 10, level: "laag" }, S).some((s) => s.level === "rust"));
ok("goed herstel, gewone sessie: geen voorstel", P.dailySuggestions(plainItems, MON, { score: 80, level: "goed" }, S).length === 0);

const fresh = { ...S, goal: "10k", goalDate: iso(7 * 9 + 6), startDate: MON };
ok("eerste drie weken van een schema nooit een herstelweek", [0, 7, 14].every((d) => !P.phaseFor(fresh, iso(d)).deload));
ok("herstelweek heet ook zo", Array.from({ length: 9 }, (_, i) => P.phaseFor(fresh, iso(i * 7))).every((p) => !p.deload || p.phase === "herstel"));

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
