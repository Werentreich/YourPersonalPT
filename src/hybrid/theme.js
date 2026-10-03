/* Merk van Nexa Hybrid (zie docs/hybrid/01-MERK.md).
   Twee systemen, één motor: getij (duur, primair accent) en gloed (kracht)
   op een warme steen- of houtskoolondergrond. Bewust geen Hyrox-look: geen
   neon op zwart, geen vette hoofdletters, geen strepen.

   Deze tokens komen ná de STYLE van Nexa en overschrijven die met dezelfde
   selectors, zodat gedeelde Nexa-onderdelen vanzelf de Hybrid-kleuren
   krijgen. Contrast (WCAG) gemeten op de eigen ondergrond:
   licht  accent 6,2 · gloed 5,8 · oker 5,6 · iris 6,6 · gedempt 5,1
   donker accent 8,6 · gloed 7,4 · oker 9,1 · iris 8,0 · gedempt 7,2 */

const LIGHT = `
  --bg:#F1EDE6; --surface:#FFFDF9; --surface-2:#F7F3ED;
  --ink:#17140F; --muted:#6A6258; --line:#E2DCD3; --line-soft:#ECE7DF;
  --accent:#0A6B6B; --accent-soft:#DCEEEC; --on-accent:#FFFFFF;
  --ember:#A9442A; --ember-fill:#D9653F; --ember-soft:#F6E2DA;
  --tide-fill:#2A9C95; --ochre:#80621A; --ochre-fill:#D3A63F; --iris:#64528A; --iris-fill:#9C88C4;
  --warn:#80561A; --warn-bg:#F8ECD8;
  --dark:#1B1916; --dark-ink:#F3EFE8; --dark-muted:#A69E93; --dark-line:#2E2A25;
  --shadow:0 1px 2px rgba(23,20,15,.04), 0 10px 28px -18px rgba(23,20,15,.25);
  --contour:rgba(10,107,107,.10);
`;

const DARK = `
  --bg:#11100E; --surface:#1B1916; --surface-2:#221F1B;
  --ink:#F3EFE8; --muted:#A69E93; --line:#2E2A25; --line-soft:#24211D;
  --accent:#5CC6BD; --accent-soft:#143230; --on-accent:#062220;
  --ember:#F0906A; --ember-fill:#E07650; --ember-soft:#3A221A;
  --tide-fill:#3FB3AA; --ochre:#DDB65E; --ochre-fill:#C99C3A; --iris:#B9A6DA; --iris-fill:#8E7AB8;
  --warn:#E5B567; --warn-bg:#2B2216;
  --dark:#1B1916; --dark-ink:#F3EFE8; --dark-muted:#A69E93; --dark-line:#2E2A25;
  --shadow:0 1px 2px rgba(0,0,0,.45), 0 12px 32px -18px rgba(0,0,0,.85);
  --contour:rgba(92,198,189,.09);
`;

export const HYBRID_STYLE = `
:root {${LIGHT}}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK}} }
:root[data-theme="dark"] {${DARK}}

/* Stem van Hybrid: zinsopbouw in plaats van hoofdletters, iets lichter
   gewicht in de condensed koppen. Geldt ook voor gedeelde Nexa-onderdelen. */
.hybrid .uppercase { text-transform: none; }
.hybrid .disp.font-bold, .hybrid h1.font-bold, .hybrid h2.font-bold { font-weight: 600; }
.hybrid .disp { letter-spacing: -0.005em; }
.hybrid .eyebrow { font-size: 11px; font-weight: 500; letter-spacing: .02em; color: var(--muted); }
`;

/* Datacodering per pijler. Nooit als decoratie gebruiken. */
export const K = {
  kracht: { ink: "var(--ember)", fill: "var(--ember-fill)", label: "Kracht" },
  duur: { ink: "var(--accent)", fill: "var(--tide-fill)", label: "Duur" },
  conditie: { ink: "var(--ochre)", fill: "var(--ochre-fill)", label: "Conditie" },
  mobiliteit: { ink: "var(--iris)", fill: "var(--iris-fill)", label: "Mobiliteit" },
};

/* Vaste kleuren voor buiten de app (manifest, statusbalk, icoon). */
export const BRAND = { bgLight: "#F1EDE6", bgDark: "#11100E", tide: "#5CC6BD", ember: "#F0906A" };
