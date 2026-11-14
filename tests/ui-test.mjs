/* Design system-logica: opdrachtpalet en snel wegen. */
import * as P from "../src/ui/palette.js";
import * as W from "../src/ui/weigh.js";
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  → " + i : "")); };

const cmds = [
  { id: "a", label: "Vandaag", group: "Ga naar" },
  { id: "b", label: "Voortgang", group: "Ga naar", keywords: "gewicht plan" },
  { id: "c", label: "Gewicht invoeren", group: "Acties", keywords: "wegen weegschaal" },
  { id: "d", label: "Micronutriënten per dag", group: "Secties", keywords: "vitamines" },
  { id: "e", label: "Wekelijkse check-in", group: "Acties" },
];
const ids = (q) => P.filterCommands(cmds, q).map((c) => c.id).join("");
ok("zonder zoekterm: alles in volgorde", ids("") === "abcde");
ok("begin van het label wint", ids("gew") === "cb", ids("gew"));
ok("trefwoord vindt de opdracht", ids("wegen") === "c" && ids("vitamines") === "d");
ok("accenten en hoofdletters tellen niet", ids("MICRONUTRIENTEN") === "d");
ok("elk woord moet voorkomen", ids("check in") === "e" && ids("check gewicht") === "");
ok("begin van een woord telt", ids("in") .startsWith("c") || ids("in").includes("e"), ids("in"));
ok("groepen in volgorde", P.groupCommands(P.filterCommands(cmds, "")).map((g) => g.group).join() === "Ga naar,Acties,Secties");
ok("leestekens in de zoekterm breken niets", P.filterCommands(cmds, "(.*").length === 0);
ok("sectielijst per scherm", P.SECTIONS.plan.includes("Slaap") && P.SECTIONS.profiel.includes("Weergave"));

const log = Array.from({ length: 14 }, (_, k) => ({ date: new Date(Date.parse("2026-11-01") + k * 864e5).toISOString().slice(0, 10), weight: 85 - 0.1 * k }));
let s = W.weighSummary(log, "2026-11-15");
ok("nog niet gewogen vandaag", s.today === null && s.last.date === "2026-11-14" && s.last.daysAgo === 1);
ok("reeks van dagen achter elkaar", s.streak === 14, String(s.streak));
s = W.weighSummary(W.withWeight(log, "2026-11-15", 83.5), "2026-11-15");
ok("gewogen vandaag", s.today === 83.5 && s.streak === 15);
ok("verschil met een week eerder (−0,7 kg)", Math.abs(s.weekDelta - -0.71) < 0.05, s.weekDelta && s.weekDelta.toFixed(2));
ok("weging vervangen, niet dubbel", W.withWeight(W.withWeight(log, "2026-11-15", 83.5), "2026-11-15", 83.2).filter((e) => e.date === "2026-11-15").length === 1);
ok("geldig gewicht 30–300 kg", W.validWeight(83.5) && !W.validWeight(12) && !W.validWeight(NaN) && !W.validWeight(400));
ok("lege log", W.weighSummary([], "2026-11-15").last === null && W.weighSummary(null, "2026-11-15").weekDelta === null);

console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd");
