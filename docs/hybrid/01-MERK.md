# Nexa Hybrid: merk en uitstraling

## Uitgangspunt: geen Hyrox-look

De gangbare "hybrid/Hyrox"-stijl is herkenbaar en daardoor inwisselbaar:
zwart met neon-geel of limoen, vette condensed hoofdletters, schuine strepen,
waarschuwingstape, stencil- en grungetexturen, en foto's van bezwete
sledpushes met harde flits. Nexa Hybrid doet daar bewust niets van.

**Positionering:** de rustige, intelligente coach voor iemand die twee
systemen traint, kracht en uithoudingsvermogen. Het voelt als een precisie-instrument
en een trainingslogboek, niet als een energiedrankje.

### Wel en niet

| Wel | Niet |
|---|---|
| Warme, natuurlijke ondergrond (steen, houtskool) | Puur zwart met neonkleuren |
| Twee kleuren die samen het verhaal vertellen | Eén schreeuwend signaalaccent |
| Kleine letters, zinsopbouw, rustige koppen | ALLES IN VETTE CONDENSED HOOFDLETTERS |
| Hoogtelijnen (topografie) als motief | Diagonale strepen, chevrons, tape |
| Cijfers groot en precies (tabulair) | Badges, vlammen, "BEAST MODE" |
| Ademruimte, één boodschap per kaart | Volle dashboards met tien meters |

## Kleur: twee systemen, één motor

- **Getij** (duur): petrol-teal. Primaire accentkleur van de app (knoppen,
  focus, actieve tab) en de kleur voor duurtraining.
- **Gloed** (kracht): terracotta of koper. De kleur voor krachttraining en
  de tweede merkkleur.
- **Oker** (conditie/WOD) en **iris** (mobiliteit) alleen als datacodering.

| Token | Licht | Donker | Gebruik |
|---|---|---|---|
| `--bg` | `#F1EDE6` | `#11100E` | ondergrond (warm steen / houtskool) |
| `--surface` | `#FFFDF9` | `#1B1916` | kaarten |
| `--ink` | `#17140F` | `#F3EFE8` | tekst |
| `--muted` | `#6A6258` | `#A69E93` | secundaire tekst |
| `--accent` (getij) | `#0A6B6B` | `#5CC6BD` | primair accent, duur |
| `--ember` (gloed) | `#A9442A` | `#F0906A` | kracht |
| `--ochre` | `#80621A` | `#DDB65E` | conditie |
| `--iris` | `#64528A` | `#B9A6DA` | mobiliteit |

Alle tekstkleuren halen WCAG AA (≥ 4,5:1) op hun ondergrond. De gemeten
waarden staan in `src/hybrid/theme.js`.

Het merkverloop (`gloed → getij`) verschijnt spaarzaam, alleen in het icoon
en op het moment dat een week "rond" is. Nooit als achtergrond.

## Typografie

Zelfde families als Nexa (Barlow en Barlow Condensed, zelf gehost), maar met
een andere stem:

- Koppen in **Barlow Condensed 600, zinsopbouw** (geen hoofdletters).
- Grote cijfers in Barlow Condensed 500, tabulair.
- Labels in Barlow 500, klein, met normale spatiëring. Geen gespatieerde
  hoofdletters, behalve hoogstens één woord als bovenschrift.

## Icoon

Een afgeronde tegel in warm houtskool met twee lijnen die elkaar kruisen: een
rechte, zware lijn in gloed (kracht) en een golvende hoogtelijn in getij
(duur). Waar ze kruisen ontstaat een klein lichtpunt. Bron:
`design/hybrid-icon.svg`, PNG's via `design/maak-hybrid-iconen.cjs`.

## Toon

Net als Nexa: u-vorm, kort en precies. Uitleg zonder hype. "Vandaag rustig,
uw benen hebben gisteren veel gedaan" in plaats van "PUSH YOUR LIMITS".
