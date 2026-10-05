# Eén complete Nexa-app voor elke sport

Besloten op 5 oktober 2026: Nexa Hybrid gaat op in de originele Nexa-app.

## Besluiten

- **Eén app** in de stijl van Nexa. In Training kiest de gebruiker de sport:
  Bodybuilding (de bestaande Nexa-methode, ongewijzigd), Kracht, Hybride,
  Hardlopen of Conditie/Hyrox.
- **Eén betaald abonnement** (Nexa Coach) met alles erin.
- **De losse Hybrid-app** blijft werken tot fase 4 klaar is; daarna stuurt
  /hybrid door naar /app en gaan de gegevens vanzelf mee (zelfde opslag:
  `macroverdeling:hybrid:v1`).

## Fasering

| Fase | Inhoud | Stand |
|---|---|---|
| 1 | Sportkeuze in Training; de Hybrid-planner, het loggen, live GPS en begeleiding, agenda en coach binnen Nexa; Vandaag toont de training van elke sport | klaar (5 okt) |
| 2 | Schermen herbouwen met de eigen onderdelen van Nexa (Section, Row), één logboek voor alle sporten | klaar (5 okt): Vandaag, Schema en Logboek in Nexa-onderdelen (`src/perf/screens.jsx`); Inzichten en Meer met Nexa-koppen; bodybuilding-logboek toont ook de andere sporten |
| 3 | Eten: koolhydraten naar belasting in het Nexa-voedingsschema; Gezondheid: herstel, HRV, slaap; Plan: belasting, vorm en records | klaar (5 okt): trainingsdagen voor de voeding komen uit het schema met echt verbruik per kg (`src/perf/nutrition.js`, `session.kcalKg`); Eten: voeding rond de training; Gezondheid: check-in, HRV, rusthartslag, slaap; Plan: vorm, belasting en records (`src/perf/tabs.jsx`) |
| 4 | Coach, Strava en agenda in Profiel; /hybrid doorsturen; één abonnement in Stripe en de app | klaar (5 okt): sporterprofiel, Strava en agenda in Profiel, coach als tab in Training; coach, Strava en agenda bij elk lopend abonnement (`hybridAllowed`); Strava keert terug naar /app; /hybrid stuurt door (301); eigen app (Capacitor) is nu Nexa (`nl.nexa.app`), zonder aankoop in de app |
| 5 | Meer sporten (fietsen, triathlon, teamsport) | |

## Techniek (fase 1)

- `src/perf/` koppelt de Hybrid-onderdelen aan Nexa: `PerformanceTraining`
  (Training-tab), `SportPicker`, `PerfTodayCard` (Vandaag) en `theme.js`
  (kleuren uit het Nexa-palet, alleen binnen `.perf`).
- `src/App.jsx` gebruikt `useHybridStore()` één keer op het hoogste niveau en
  geeft de opslag door; zo is er nooit een tweede, concurrerende kopie.
- App.jsx en de Hybrid-onderdelen importeren elkaar (kringverwijzing). Daarom
  gebruiken de Hybrid-onderdelen Nexa-waarden (`C`, `R`, `EXERCISES`) pas
  tijdens het tekenen, niet bij het laden (`ensureNexaExercises`,
  `inputStyleOf`). `npm run verify` start beide apps en vangt fouten op.

## Nog te doen door de beheerder (fase 4)

- **Stripe:** de Hybrid-prijzen (`nexa_hybrid_maand`, `nexa_hybrid_jaar`) niet
  meer aanbieden: in het dashboard archiveren. Lopende Hybrid-abonnementen
  blijven werken en geven toegang tot alles. Overweeg ze bij verlenging om te
  zetten naar Nexa Coach (klantportaal → abonnement wijzigen).
- **Prijs van Nexa Coach:** er zit nu meer in (alle sporten, coach, Strava,
  agenda). Een prijsverhoging voor nieuwe klanten is te verdedigen; bestaande
  klanten behouden hun prijs.
- **Teksten:** landingspagina en winkelteksten noemen nu "Nexa", met alle
  sporten.
- **De build van /hybrid** blijft voorlopig bestaan (tests); de doorverwijzing
  zorgt dat niemand er nog komt. Kan later weg.
