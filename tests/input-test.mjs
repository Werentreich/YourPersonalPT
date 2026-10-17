/* Invoer met komma of punt en hardlooptempo bij loop-wandelen. */
const M = await import("../src/hybrid/engine/model.js");
const P = await import("../src/hybrid/engine/planner.js");
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i !== "" ? "  " + i : "")); };

ok("5 km-tijd met dubbele punt", M.parseDuration("36:54") === 2214);
ok("5 km-tijd met komma (cijfertoetsenbord)", M.parseDuration("36,54") === 2214);
ok("5 km-tijd met punt", M.parseDuration("36.54") === 2214);
ok("uren met punten", M.parseDuration("1.02.15") === 3735);
ok("alleen minuten", M.parseDuration("45") === 2700);
ok("ongeldige seconden geweigerd", M.parseDuration("36:75") === null && M.parseDuration("abc") === null && M.parseDuration("36:") === null);
ok("getal met komma", M.num("79,5") === 79.5 && M.num("72.4") === 72.4);

const s0 = P.starterSession(6);
ok("loop-wandel zonder 5 km-tijd: praattempo", s0.blocks[1].intensity === "rustig hardlopen, praattempo");
const s1 = P.starterSession(6, { run5k: 2214 });
ok("loop-wandel met 5 km-tijd 36:54: zone 2-tempo erbij", /8:39–9:47 \/km/.test(s1.blocks[1].intensity) && /richtlijn/.test(s1.note), s1.blocks[1].intensity);
ok("niveau 7 = 3 × 10 min hardlopen, 1:30 wandelen", s1.blocks[1].rounds === 3 && s1.blocks[1].restSec === 90 && s1.blocks[1].items[0].timeSec === 600);

if (fails) { console.log(`\n${fails} FOUT`); process.exit(1); }
console.log("\nalles goed");
