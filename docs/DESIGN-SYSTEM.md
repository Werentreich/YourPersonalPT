# Nexa design system

Eén bron voor kleur, typografie, ruimte en componenten. Alle tokens en
basisklassen staan in `STYLE` in `src/App.jsx`; de onderdelen in
`src/perf`, `src/hybrid` en `src/ui` gebruiken dezelfde tokens.

## Uitgangspunten

1. **Eén luide kop per scherm.** De paginatitel staat in hoofdletters
   (Barlow Condensed 700, 34 px). Sectietitels zijn rustiger: gewone
   schrijfwijze, Barlow Condensed 600, 22 px, zonder accentbalk.
2. **Vlakke kaarten.** Een kaart is een wit vlak met een rand van 1 px en
   een minimale schaduw. Diepte (zwaardere schaduw) is voorbehouden aan
   wat boven de pagina zweeft: vensters, het opdrachtpalet en meldingen.
3. **Accent is voor actie.** Blauw (`--accent`) staat op de primaire knop,
   de actieve navigatie en links. Een keuze binnen een groep (segmenten)
   krijgt een verhoogd wit vlak, geen accentvulling.
4. **Uitleg op verzoek.** Lange toelichting staat achter "Waarom?";
   secundaire secties zijn ingeklapt met een samenvatting van één regel.
5. **Beweging met mate.** Overgangen duren 120 tot 200 ms; er zijn geen
   decoratieve animaties. `prefers-reduced-motion` schakelt alles uit.

## Kleur

| Token | Licht | Donker | Gebruik |
| --- | --- | --- | --- |
| `--bg` | `#EEF0F4` | `#08090C` | pagina |
| `--surface` | `#FFFFFF` | `#121419` | kaart, venster |
| `--surface-2` | `#F6F7F9` | `#191C22` | invoerveld, segmentbalk |
| `--ink` | `#0B0D11` | `#F1F3F7` | tekst |
| `--muted` | `#5F6673` | `#99A0AD` | secundaire tekst |
| `--line` / `--line-soft` | `#DEE1E7` / `#EBEDF1` | `#252932` / `#1C1F26` | randen, scheidingen |
| `--accent` / `--accent-soft` / `--on-accent` | `#1B3BFF` / `#E7EAFF` / `#FFFFFF` | `#6B85FF` / `#1A2044` / `#07080B` | actie |
| `--success` / `--success-bg` | `#00795A` / `#E3F6EF` | `#35D6A0` / `#10261F` | gelukt, op koers |
| `--warn` / `--warn-bg` | `#8A5A00` / `#FFF3DF` | `#F0B75F` / `#2A2013` | let op |
| `--danger` / `--danger-bg` | `#D8360F` / `#FDE9E3` | `#FF6242` / `#2E1610` | fout, verwijderen |
| `--info` / `--info-bg` | `#1B3BFF` / `#E7EAFF` | `#93A5FF` / `#1A2044` | toelichting |
| `--pro` `--carb` `--fat` (+ `-fill`) | blauw, groen, amber | idem, lichter | macro's: eiwit, koolhydraten, vet |
| `--hover` / `--press` / `--ring` | | | hover, indrukken, focusring |

Tekstkleuren halen op hun ondergrond minstens 4,5:1 (WCAG AA). De
`-fill`-varianten zijn voor vlakken en grafieken, niet voor tekst.

Thema: standaard volgt de app het systeem. In Profiel, Weergave kiest de
gebruiker Systeem, Licht of Donker; de keuze staat in `nexa:theme` en zet
`data-theme` op `<html>`.

## Typografie

- **Barlow** (400, 500, 600) voor lopende tekst en bediening.
- **Barlow Condensed** (500, 600, 700) voor koppen en grote getallen
  (klasse `disp`).
- Beide lettertypen staan op de eigen server (geen externe verzoeken).

| Rol | Klasse | Maat |
| --- | --- | --- |
| Paginatitel | `.page-title` | 34/1 px, 700, hoofdletters |
| Sectietitel | `.sec-title` | 22/1.15 px, 600 |
| Groepslabel | `.group-label` | 12 px, 600, hoofdletters, gespatieerd |
| Bovenschrift | `.eyebrow` | 12 px, 600, hoofdletters |
| Lopende tekst | `text-sm` | 14,5/21 px |
| Kleine tekst | `text-xs` | 13/18 px |
| Getallen | `.tnum` | tabelcijfers |

De kleinste lopende tekst is 13 px (Tailwind `xs` is daarvoor aangepast
in `tailwind.config.js` en `tailwind.hybrid.config.js`).

## Ruimte, hoeken, schaduw, beweging

- Ruimte: veelvouden van 4 px (Tailwind-schaal). Kaartinhoud 16 px,
  tussen kaarten 12 px, tussen secties 28 px.
- Hoeken: `--r-sm` 8, `--r-md` 10, `--r-lg` 14, `--r-xl` 20 px. Velden en
  knoppen `--r-md`, kaarten `--r-lg`, vensters `--r-xl`.
- Schaduw: `--shadow` (kaart), `--shadow-md` (melding, zwevend),
  `--shadow-lg` (venster, palet).
- Beweging: `--t-fast` 120 ms (hover, kleur), `--t-med` 200 ms (venster,
  melding), curve `--ease`.

## Componenten

| Onderdeel | Waar | Opmerking |
| --- | --- | --- |
| Knop | `TBtn`, klassen `.btn .btn-primary/.btn-secondary/.btn-ghost/.btn-danger`, `.btn-sm` | 40 px hoog (klein 32 px); hover, indrukken, focusring en uitgeschakeld zijn gedefinieerd. `TBtn` is standaard `type="button"`; een verzendknop krijgt `type="submit"`. |
| Icoonknop | `.icon-btn` | 40 × 40 px, altijd met `aria-label` |
| Link | `.link`, `.link-accent` | onderstreept bij hover |
| Invoerveld | `input`, `select`, `textarea` | hover- en focusrand, focusring |
| Segmenten | `Seg`, klasse `.seg` (`.seg-full` voor volle breedte) | keuze uit 2 tot 5; `aria-pressed` of `aria-selected` |
| Chips | pilvormige knoppen | meerdere keuzes tegelijk (dagen, spiergroepen) |
| Kaart | `.card` | rand 1 px, `--shadow` |
| Sectie | `Section` | titel, "Waarom?", optioneel inklapbaar met samenvatting |
| Rij | `Row`, `.row-tap` | label links, bediening rechts |
| Venster | `Sheet` (`.overlay`, `.dialog`) | telefoon: blad van onder; vanaf 640 px gecentreerd. Focus blijft in het venster, Escape sluit, de pagina scrolt niet mee, focus keert terug. |
| Melding | `toast(tekst, { action, onAction })`, `Toaster` | onderaan, verdwijnt vanzelf, optioneel "Ongedaan maken" |
| Opdrachtpalet | `src/ui/CommandPalette.jsx` | Ctrl/⌘+K of `/`; zoekt schermen, secties en acties |
| Laden | `.skel` | grijs vlak met rustige puls |
| Lege staat | korte zin in een kaart, met één actie waar dat kan | |
| Toetsaanduiding | `.kbd` | |

## Indeling en schermgrootten

| Breedte | Indeling |
| --- | --- |
| tot 1024 px (telefoon, tablet) | één kolom, tabbalk onderaan (4 tabs), zoek- en profielknop rechtsboven |
| vanaf 1024 px (laptop) | vaste zijbalk links (navigatie, zoeken, profiel), inhoud gecentreerd, geen tabbalk |
| vanaf 1280 px (desktop) | Vandaag in twee kolommen: training en gewicht links, voeding rechts |

Grafieken volgen de breedte van hun kaart (`useChartW` in `src/App.jsx`,
`useHover` in `src/hybrid/ui/charts.jsx`), zodat tekst en lijnen op een
breed scherm niet meeschalen.

## Toegankelijkheid

- Eén zichtbare focusring voor alle bediening (`:focus-visible`).
- Aanraakdoelen minstens 40 px, primaire acties 44 px of meer.
- Navigatie is een `nav` met `aria-label="Hoofdnavigatie"`; vensters zijn
  `role="dialog"` met `aria-modal`.
- Sneltoetsen: `1` tot `4` wisselen van tab, `/` en Ctrl/⌘+K openen
  zoeken. Ze doen niets terwijl u typt of een venster open staat.
- `prefers-reduced-motion`: overgangen uit.

## Zo breidt u uit

- Nieuwe kleur of maat: voeg een token toe in `STYLE` (licht en beide
  donkere blokken), geen losse hex-waarden in componenten.
- Nieuwe sectie: gebruik `Section`; zet de titel in `SECTIONS`
  (`src/ui/palette.js`) zodat zoeken haar vindt.
- Nieuwe knop: `TBtn` of de `.btn`-klassen, geen eigen stijl.
