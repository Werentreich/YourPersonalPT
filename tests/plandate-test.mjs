/* Meerwekenplan met einddatum en koppeling aan de wedstrijd. */
import * as PD from "../src/planDate.js";
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  → " + i : "")); };

ok("weken tot en met de einddag", PD.weeksUntil("2026-10-26", "2026-11-01") === 1 && PD.weeksUntil("2026-10-26", "2026-11-02") === 2 && PD.weeksUntil("2026-10-26", "2027-03-07") === 19);
let h = PD.planHorizon({ weeks: 26, raceDate: "2027-03-07", start: "2026-10-26" });
ok("zonder keuze: volgt de wedstrijd", h.mode === "wedstrijd" && h.weeks === 19 && h.end === "2027-03-07", JSON.stringify(h));
h = PD.planHorizon({ weeks: 26, raceDate: null, start: "2026-10-26" });
ok("zonder wedstrijd: weken", h.mode === "weken" && h.weeks === 26 && h.end === null);
h = PD.planHorizon({ mode: "weken", weeks: 12, raceDate: "2027-03-07", start: "2026-10-26" });
ok("eigen keuze weken gaat voor", h.mode === "weken" && h.weeks === 12);
h = PD.planHorizon({ mode: "datum", endDate: "2026-12-20", start: "2026-10-26" });
ok("eigen datum: 8 weken", h.weeks === 8 && h.end === "2026-12-20");
h = PD.planHorizon({ mode: "datum", endDate: "2026-11-05", start: "2026-10-26" });
ok("te kort: minimaal 4 weken, met melding", h.weeks === 4 && h.tooShort && h.raw === 2);
h = PD.planHorizon({ mode: "datum", endDate: "2028-12-01", start: "2026-10-26" });
ok("te lang: hoogstens 78 weken", h.weeks === 78 && h.tooLong);
h = PD.planHorizon({ mode: "wedstrijd", raceDate: null, weeks: 10, start: "2026-10-26" });
ok("wedstrijd weg: terug naar weken", h.end === null && h.weeks === 10);
ok("wedstrijd in het verleden niet automatisch", PD.planHorizon({ raceDate: "2026-10-01", start: "2026-10-26", weeks: 20 }).mode === "weken");

const rows = [{ phase: "cut", kcal: 2000, tdee: 2600 }, { phase: "cut", kcal: 2000, tdee: 2600 }];
const r = PD.withRaceWeek(rows, "Hyrox Amsterdam");
ok("laatste week cut -> onderhoud", r[1].phase === "onderhoud" && r[1].kcal === 2600 && r[1].raceWeek && /Hyrox Amsterdam/.test(r[1].note) && r[0].phase === "cut");
ok("laatste week opbouw blijft, met notitie", PD.withRaceWeek([{ phase: "bulk", kcal: 3000, tdee: 2700 }], "")[0].phase === "bulk");

const pad = PD.padToWeeks([{ week: 1, phase: "cut", weight: 80, bodyFat: 14, kcal: 2100, tdee: 2600 }], 4);
ok("doel eerder bereikt: aangevuld met onderhoud tot de wedstrijd", pad.length === 4 && pad.slice(1).every((r) => r.phase === "onderhoud" && r.kcal === 2600) && /Doel bereikt/.test(pad[1].note) && pad[3].week === 4);
ok("niets aanvullen als het plan al lang genoeg is", PD.padToWeeks(rows, 2) === rows);
ok("actief plan eindigt in de wedstrijdweek", PD.planMatchesRace("2026-10-26", 19, "2027-03-07"));
ok("actief plan eindigt te vroeg", !PD.planMatchesRace("2026-10-26", 12, "2027-03-07"));
ok("actief plan loopt te lang door", !PD.planMatchesRace("2026-10-26", 26, "2027-03-07"));

console.log(fails ? `${fails} FOUT` : "Alle tests geslaagd");
