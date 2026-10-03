/* Merk van Nexa Hybrid (zie docs/hybrid/01-MERK.md).
   Twee systemen, één motor: getij (duur, primair accent) en gloed (kracht)
   op een warme steen- of houtskoolondergrond. Bewust geen Hyrox-look: geen
   neon op zwart, geen vette hoofdletters, geen strepen.

   Deze tokens komen ná de STYLE van Nexa en overschrijven die met dezelfde
   selectors, zodat gedeelde Nexa-onderdelen vanzelf de Hybrid-kleuren
   krijgen. Contrast (WCAG) gemeten op de eigen ondergrond:
   licht  accent 6,2 · gloed 5,8 · oker 5,6 · iris 6,6 · gedempt 5,1
   donker accent 8,6 · gloed 7,4 · oker 9,1 · iris 8,0 · gedempt 7,2

   Vulkleuren van de pijlers (--*-fill) zijn gecontroleerd met de
   dataviz-validator, voor alle paren (niet alleen buren): lichtheidsband,
   verzadiging, kleurenblindheid (ΔE ≥ 12) en normaal zicht (ΔE ≥ 15), licht
   en donker. Eén waarschuwing: geel (conditie) haalt op licht maar 2,2:1
   tegen de kaart; daarom staan pijlers in grafieken altijd met een label of
   legenda erbij, nooit alleen als kleur. */

const LIGHT = `
  --bg:#F1EDE6; --surface:#FFFDF9; --surface-2:#F7F3ED;
  --ink:#17140F; --muted:#6A6258; --line:#E2DCD3; --line-soft:#ECE7DF;
  --accent:#0A6B6B; --accent-soft:#DCEEEC; --on-accent:#FFFFFF;
  --ember:#A9442A; --ember-fill:#D9653F; --ember-soft:#F6E2DA;
  --tide-fill:#0E9E94; --ochre:#80621A; --ochre-fill:#D9A800; --iris:#64528A; --iris-fill:#5B47B8;
  --warn:#80561A; --warn-bg:#F8ECD8;
  --dark:#1B1916; --dark-ink:#F3EFE8; --dark-muted:#A69E93; --dark-line:#2E2A25;
  --shadow:0 1px 2px rgba(23,20,15,.04), 0 10px 28px -18px rgba(23,20,15,.25);
  --contour:rgba(10,107,107,.10);
  --seq-1:#6FC2B9; --seq-2:#22958C; --seq-3:#0A5656;
`;

const DARK = `
  --bg:#11100E; --surface:#1B1916; --surface-2:#221F1B;
  --ink:#F3EFE8; --muted:#A69E93; --line:#2E2A25; --line-soft:#24211D;
  --accent:#5CC6BD; --accent-soft:#143230; --on-accent:#062220;
  --ember:#F0906A; --ember-fill:#B8532F; --ember-soft:#3A221A;
  --tide-fill:#16A096; --ochre:#DDB65E; --ochre-fill:#B58E00; --iris:#B9A6DA; --iris-fill:#8A78E8;
  --warn:#E5B567; --warn-bg:#2B2216;
  --dark:#1B1916; --dark-ink:#F3EFE8; --dark-muted:#A69E93; --dark-line:#2E2A25;
  --shadow:0 1px 2px rgba(0,0,0,.45), 0 12px 32px -18px rgba(0,0,0,.85);
  --contour:rgba(92,198,189,.09);
  --seq-1:#2B6B66; --seq-2:#2FA79D; --seq-3:#86DCD3;
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

/* --seq-1..3: één tint (getij), oplopend van rustig naar zwaar, voor de
   intensiteitsverdeling. Op donker loopt de reeks van gedempt naar helder.
   Lichtste stap ≥ 2:1 tegen de kaart. */

/* Datacodering per pijler. Nooit als decoratie gebruiken. */
export const K = {
  kracht: { ink: "var(--ember)", fill: "var(--ember-fill)", label: "Kracht" },
  duur: { ink: "var(--accent)", fill: "var(--tide-fill)", label: "Duur" },
  conditie: { ink: "var(--ochre)", fill: "var(--ochre-fill)", label: "Conditie" },
  mobiliteit: { ink: "var(--iris)", fill: "var(--iris-fill)", label: "Mobiliteit" },
};

/* Vaste kleuren voor buiten de app (manifest, statusbalk, icoon). */
export const BRAND = { bgLight: "#F1EDE6", bgDark: "#11100E", tide: "#5CC6BD", ember: "#F0906A" };
