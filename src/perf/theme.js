/* Prestatietraining in Nexa: de onderdelen van Hybrid in de stijl van Nexa.
   Hybrid-onderdelen gebruiken een paar eigen kleurnamen (pijlers, reeksen);
   hier krijgen die kleuren uit het Nexa-palet. Alles staat onder .perf, zodat
   de rest van Nexa onveranderd blijft. Pijlerkleuren staan altijd met een
   label of legenda erbij, nooit alleen als kleur. */
const LIGHT = `
  --ember:#B23A16; --ember-fill:#E8552E; --ember-soft:#FDE6DE;
  --tide-fill:#2B4BFF; --ochre:#8A6100; --ochre-fill:#E8A400; --iris:#00795A; --iris-fill:#00A87A;
  --contour:transparent;
  --seq-1:#9DADFF; --seq-2:#4F68FF; --seq-3:#1B2FA8;
`;
const DARK = `
  --ember:#FF9473; --ember-fill:#FF6A40; --ember-soft:#3A1E15;
  --tide-fill:#6B85FF; --ochre:#F7C45C; --ochre-fill:#F0B03A; --iris:#35D6A0; --iris-fill:#1FC98E;
  --contour:transparent;
  --seq-1:#2A3570; --seq-2:#4F68FF; --seq-3:#A9B7FF;
`;

export const PERF_STYLE = `
.perf {${LIGHT}}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .perf {${DARK}} }
:root[data-theme="dark"] .perf {${DARK}}
.perf .contours { display: none; }
.perf h1 { display: none; }
.perf .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
`;

/* Sporten in Nexa. "bodybuilding" is de bestaande Nexa-training. */
export const DISCIPLINES = {
  bodybuilding: { label: "Bodybuilding", sub: "spieropbouw, methode Kuba Cielen", goals: null },
  kracht: { label: "Kracht", sub: "sterker worden, conditie onderhouden", goals: ["kracht"], goal: "kracht" },
  hybride: { label: "Hybride", sub: "kracht en duur in balans", goals: ["hybride"], goal: "hybride" },
  hardlopen: { label: "Hardlopen", sub: "van eerste stappen tot marathon", goals: ["5k", "10k", "halve", "marathon"], goal: "5k" },
  conditie: { label: "Conditie / Hyrox", sub: "WOD's, stations en motor", goals: ["conditie", "hyrox"], goal: "conditie" },
};
export const disciplineOfGoal = (goal) => Object.keys(DISCIPLINES).find((k) => (DISCIPLINES[k].goals || []).includes(goal)) || "hybride";
