/* Nexa Hybrid: toegang (upgrade boven Coach) en kleurcontrast van het merk. */
import { hybridAccess, upgradeDelta } from "../src/hybrid/entitlement.js";
import { HYBRID_STYLE } from "../src/hybrid/theme.js";
let fails = 0;
const ok = (l, c, i = "") => { if (!c) fails++; console.log((c ? "OK  " : "FOUT") + " " + l + (i ? "  " + i : "")); };

const nx = (sub, enabled = true, user = "u1") => ({ user: user ? { id: user } : null, billing: { enabled, sub, subUser: "u1", prices: null } });

ok("zonder accountlaag (Claude): open", hybridAccess(null).state === "open");
ok("betaalmuur uit: open", hybridAccess(nx(null, false)).state === "open");
ok("geen abonnement: abonneren", hybridAccess(nx(null)).state === "subscribe");
ok("Coach actief: upgrade", hybridAccess(nx({ status: "active", plan: "jaar" })).state === "upgrade");
ok("Coach in proef: upgrade, proef herkend", (() => { const a = hybridAccess(nx({ status: "trialing", plan: "maand", trial_end: "x" })); return a.state === "upgrade" && a.trialing && a.coachPlan === "maand"; })());
ok("Hybrid actief: open", hybridAccess(nx({ status: "active", plan: "hybrid_jaar" })).state === "open");
ok("Hybrid achterstallig (past_due): nog open", hybridAccess(nx({ status: "past_due", plan: "hybrid_maand" })).state === "open");
ok("Hybrid opgezegd en verlopen: abonneren, proef al gehad", (() => { const a = hybridAccess(nx({ status: "canceled", plan: "hybrid_jaar", stripe_subscription_id: "s" })); return a.state === "subscribe" && a.hadTrial; })());
ok("gratis toegang (comp): open", hybridAccess(nx({ status: "comp", plan: "comp" })).state === "open");
ok("abonnement van een ander account telt niet", hybridAccess({ user: { id: "u2" }, billing: { enabled: true, sub: { status: "active", plan: "hybrid_jaar" }, subUser: "u1" } }).state === "subscribe");
ok("uitgelogd: abonneren", hybridAccess(nx({ status: "active", plan: "hybrid_jaar" }, true, null)).state === "subscribe");
ok("prijzen van de server gaan voor", hybridAccess({ user: { id: "u1" }, billing: { enabled: true, sub: null, subUser: "u1", prices: { hybrid_jaar: 129 } } }).prices.hybrid_jaar === 129);
const P = { maand: 14.99, jaar: 99.99, hybrid_maand: 19.99, hybrid_jaar: 139.99 };
ok("meerprijs maand naar maand: 5,00", Math.abs(upgradeDelta(P, "maand", "hybrid_maand") - 5) < 0.001);
ok("meerprijs jaar naar jaar: 3,33 per maand", Math.abs(upgradeDelta(P, "jaar", "hybrid_jaar") - 40 / 12) < 0.001);

// contrast: elke tekstkleur ≥ 4,5:1 op de eigen ondergrond (WCAG AA)
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const blocks = [...HYBRID_STYLE.matchAll(/\{([^{}]*--bg:[^{}]*)\}/g)].map((m) => Object.fromEntries([...m[1].matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2]])));
ok("drie tokenblokken (licht, donker systeem, donker gekozen)", blocks.length === 3);
for (const [i, t] of blocks.slice(0, 2).entries()) {
  const mode = i ? "donker" : "licht";
  for (const k of ["ink", "muted", "accent", "ember", "ochre", "iris"]) {
    for (const bg of ["bg", "surface"]) {
      const r = ratio(t[k], t[bg]);
      ok(`${mode}: ${k} op ${bg} ≥ 4,5`, r >= 4.5, r.toFixed(2));
    }
  }
  ok(`${mode}: tekst op accentknop ≥ 4,5`, ratio(t["on-accent"], t.accent) >= 4.5);
  ok(`${mode}: waarschuwing leesbaar`, ratio(t.warn, t["warn-bg"]) >= 4.5, ratio(t.warn, t["warn-bg"]).toFixed(2));
}
ok("donker systeem en donker gekozen zijn gelijk", JSON.stringify(blocks[1]) === JSON.stringify(blocks[2]));

console.log(fails ? `${fails} FOUT(EN)` : "Alle tests geslaagd");
process.exit(fails ? 1 : 0);
