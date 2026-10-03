# Nexa

*Your personal performance coach.*

Trainingsgerichte macro- en voedingsschemaplanner, in het Nederlands, als
installeerbare PWA. Berekent calorieën en macro's per dag op basis van
lichaamsgegevens, training en doel; verdeelt die over maaltijden en porties;
en ondersteunt meerwekenplannen voor cutten, bulken en minicuts. Het
tabblad Training bevat trainingsschema's, live loggen met rusttimer,
automatische progressie, periodisering met deload en analyses.

**Live:** https://nexa-performance.netlify.app (landingspagina) en
https://nexa-performance.netlify.app/app/ (de app)

De opslagsleutels (`macroverdeling:v1` en `macroverdeling:training:v1`)
behouden bewust hun oude naam, zodat bestaande gegevens bewaard blijven.

## Structuur

```
src/App.jsx          de volledige app: rekenkern, UI, alles in één bestand
src/boot.jsx         opstart en opslaglaag, gedeeld door Nexa en Nexa Hybrid
src/hybrid/          Nexa Hybrid (tweede build, op /hybrid/), zie docs/hybrid/
src/sync.js          account, synchronisatie en abonnementsstatus (Supabase)
landing/             landingspagina (statische HTML, lettertypen, schermafbeeldingen)
public/              statische bestanden (manifest, service worker, iconen, 404, robots)
netlify/functions/   serverfuncties: etiket, billing, stripe-webhook
netlify/lib/         gedeelde servercode (billing-core.mjs), geen eigen functie
supabase/migrations/ SQL van de tabellen (ter documentatie, al toegepast)
design/              iconen, schermafbeeldingen en deelafbeelding opnieuw maken
build.mjs            bouwt landing/ naar dist/ en src/App.jsx naar dist/app/
build-entry.jsx      opslaglaag (account/apparaat/geheugen) + React-opstart
netlify.toml         Netlify-buildinstellingen (build, publish-map, functies)
public/_redirects    doorverwijzingen (app op /app/, 404) en public/_headers kopteksten
```

`src/App.jsx` is bewust één bestand: de app draait ook als zelfstandig
kunstwerk binnen Claude (als Artifact), waar geen modulebundeling
beschikbaar is. Wie eraan werkt via Claude Code kan gewoon in dat ene
bestand editen; `npm run build` zet het om naar een zelfstandige
`dist/index.html` van ongeveer 460 kB, met alles inline (React, stijlen,
logica) en geen andere netwerkafhankelijkheid dan Google Fonts.

## Nexa Hybrid

Tweede app uit deze codebase voor hybride atleten (kracht en duur), op
`/hybrid/`. Upgrade boven Nexa Coach, zelfde account, eigen merk.
Plan en fasering: `docs/hybrid/00-PLAN.md`; merk: `docs/hybrid/01-MERK.md`.

- `npm run build` bouwt beide apps: `dist/app/index.html` en `dist/hybrid/index.html`.
- Hybrid gebruikt gedeelde onderdelen uit `src/App.jsx` via de exportregel
  onderaan dat bestand (niet via losse `export`-woorden: de tests knippen
  functies uit `App.jsx`).
- Opslag onder `macroverdeling:hybrid:*`, zodat het Nexa-account het
  vanzelf synchroniseert.
- Abonnement: plannen `hybrid_maand` en `hybrid_jaar` (Stripe-lookup keys
  `nexa_hybrid_maand` / `nexa_hybrid_jaar`). Coach naar Hybrid wordt direct
  geüpgraded op hetzelfde Stripe-abonnement, naar rato verrekend.

## Ontwikkelen

`npm test` draait alle logica- en functietests in `tests/` (Node, zonder netwerk; Stripe, Supabase en Anthropic worden nagebootst). Draai daarna `npm run build` en `npm run verify`.

```bash
npm install
npm run build      # schrijft dist/index.html
```

Er is geen dev-server met hot reload; voor snelle iteratie `npm run build`
draaien en `dist/index.html` rechtstreeks in de browser openen (geen server
nodig, het is één zelfstandig bestand). Voor PWA-gedrag (service worker,
manifest) moet het bestand wel vanaf een echte host of `netlify dev`
draaien, want service workers werken niet vanaf `file://`.

## Trainingsmodule

Staat in `src/App.jsx` tussen het kopcommentaar `TRAINING` en de
`ErrorBoundary`. Methodiek naar de principes van Kuba Cielen: twee werksets
tot RIR 0-1 na een opbouwende warming-up, voorkeur voor lengthened-bias en
unilaterale oefeningen, ongeveer 40/60 compound/isolatie.

- **Opslag**: eigen sleutel `macroverdeling:training:v1`, los van de
  voedingsdata, zodat het loggen van elke set niet de hele voedingsblob
  herschrijft. Een lopende training overleeft herladen.
- **Schema's**: op vaste weekdagen of als rotatie (gemiste dagen schuiven
  op). Drie sjablonen: Upper/Lower, Push/Pull/Legs, Full body. Ruim 60
  oefeningen met spiergroep, materiaal en lengthened/unilateraal-vlag, plus
  eigen oefeningen.
- **Progressie** (`progressFor`): reps-first. Binnen de range een rep erbij;
  twee sessies op rij de bovenkant: gewicht omhoog met de stap van het
  materiaal; bovenkant met ruim reps over: direct omhoog; twee keer onder de
  onderkant: omlaag. Instelbaar als voorstel (standaard) of automatisch.
- **Periodisering** (`blockPosition`): blokken van opbouw (standaard 4
  weken, RIR 2 naar 1), intensivering (2 weken, RIR 1 naar 0) en een
  deloadweek (halve werksets, RIR 4).
- **Deload-detectie** (`fatigueCheck`): e1RM-daling bij minstens 30 procent
  van de vergelijkingen in twee weken, of drie keer een lage herstelscore
  met dalende prestaties.
- **Koppeling met voeding** (`TRAIN_PHASE`): in een cut telt stilstand
  niet als vermoeidheid. Schema's op weekdagen kunnen de trainingsdagen
  van de voedingsweek gelijktrekken.
- **Faseovergang** (`TRAIN_PHASE_ADVICE`, `PHASE_OPTIONS`, `phaseOptions`,
  `PhaseSheet`): zodra de voedingsfase wisselt (doel of autopilot-rij),
  vraagt de app of de training meebeweegt. Per fase een aanbevolen optie:
  | Fase | Aanbevolen | Alternatief |
  |---|---|---|
  | bulk, reverse | schema gelijk houden (alleen uitleg) | |
  | cut | gelijk houden | iets minder volume (~15%) |
  | slotcut | iets minder volume | gelijk houden |
  | minicut | minicut-schema (⅓ minder sets, gewichten vasthouden) | gelijk houden |
  | onderhoud na cut, bulk of minicut | herstelfase (⅓ minder sets, zware gewichten) | gelijk houden |
  | onderhoud anders | gelijk houden | herstelfase |

  De vraag verschijnt als sheet buiten het trainingstabblad en als kaart
  in het trainingsoverzicht; toont per trainingsdag het aantal werksets
  voor en na. De keuze staat in `T.phaseChoice` (`{phase, option, at}`),
  de laatst geziene fase in `T.phaseSeen` en de fase daarvoor in
  `T.phasePrev`. Het schema zelf verandert niet: `plannedSetsFor` en
  `targetFor` passen alleen toe zolang de fase duurt. "Later beslissen"
  geldt tot de app opnieuw opent; tot een keuze blijft het schema gelijk
  (in de automatische stand geldt de aanbeveling alvast). Bestaande
  gebruikers zonder eerdere keuze krijgen alleen een vraag als de
  aanbeveling afwijkt van "gelijk houden".
- **Herstelblok** (`resensCheck`, `resensState`, `endResens`,
  `RESENS_OPTION`, `ResensCard`, `ResensSheet`): los van de voeding.
  Vanaf het begin van de huidige zware periode (na de laatste pauze van
  twee weken of langer, na een reeks sessies met minder volume van minstens
  tien dagen, of na een vorig herstelblok) telt de app de weken. Voorstel
  na 20 weken, of al na 12 weken als de kracht stilstaat (beste e1RM van de
  laatste zes weken niet hoger dan de zes weken ervoor bij minstens 60% van
  de oefeningen). Voorwaarden: minstens 1,5 training per week in die
  periode, vier in de laatste vier weken, geen deload en geen fase die al
  minder volume geeft. Advies 3 weken, 4 bij stilstand of na 26 weken.
  Tijdens het blok: de helft van de werksets (`vf` 0,5), zware gewichten,
  geen deload-melding; daarna begint automatisch een nieuw blok bij de
  opbouw met een melding "Herstelblok klaar". Opslag: `T.resens`
  (`{start, weeks, reasons, done, stopped, ack}`) en `T.resensSnooze`.
- **Minder volume, welke sets eerst** (`plannedSetsFor`): isolatie-
  oefeningen leveren eerst sets in, van achteren naar voren; pas daarna de
  basisoefeningen. Elke oefening houdt minstens één werkset.
- **Lange cut of bulk zonder plan** (`phaseLengthAdvice`,
  `PhaseLengthCard`): de app houdt bij sinds wanneer het doel geldt
  (`f.goalSince`, bij bestaande gebruikers geschat op de eerste weging,
  `est: true`; na een plan telt het einde van het plan). Na
  `phaseCfg.cutBlockWeeks` (standaard 10) weken tekort stelt een kaart op
  Vandaag een dieetpauze van `phaseCfg.maintWeeks` (3) weken voor, na 16
  weken surplus 4 weken onderhoud. Starten zet het doel op onderhoud en
  bewaart de pauze in `f.phaseBreak` (`{from, rate, weeks, start}`); de
  faseovergang vraagt dan om de herstelfase in de training. Na de pauze
  volgt "Terug naar vetverlies/opbouw" in het oude tempo. "Over een week"
  bewaart `f.phaseSnooze`; de startdatum is aan te passen op de kaart,
  en staat als hint bij Richting in het profiel. Met een actief plan
  zwijgt de kaart: het plan plant de pauzes zelf.
- **Analyses**: werksets per spiergroep tegen MEV/MAV/MRV (Renaissance
  Periodization), volume per week, e1RM-verloop, records en therapietrouw.
- **Technieken** (blok `technieken`, vóór `historyFor`):
  - *Supersets*: `slot.ss` koppelt een oefening aan de volgende (twee of
    meer = superset of giant set, labels A1/A2). `sessionOrder` zet eerst
    alle warming-ups, dan per ronde één werkset per oefening; `nextStep`
    geeft de korte wissel (`slot.ssRest`, standaard 15 s) en na de laatste
    oefening de volle rust. `ssKind` herkent tegengestelde spieren,
    overlap en dezelfde spiergroep. "Tijd besparen" (`suggestSupersets`)
    stelt per dag paren van tegengestelde spieren voor, zonder zware
    squats en deadlifts met de stang.
  - *Dropset, rest-pause, myo-reps, halve reps*: `slot.tech`; de extra
    rijen (subsets, types `drop`/`rp`/`myo`/`partial`) hangen na de
    laatste werkset of na elke werkset. Dropgewichten volgen het
    werkgewicht tot de gebruiker ze zelf wijzigt. Myo-reps stoppen zodra
    een mini-set onder de 3 reps blijft.
  - Progressie, e1RM en records gebruiken alleen gewone werksets. Voor het
    volume telt elke subset als een halve set, hoogstens één extra per
    werkset (`effSets`, `techExtraSets`). In een deload en een minicut
    vervallen de technieken automatisch (`techOff`); supersets blijven.
- **Schema-advies** (`programAdvice`, blok `schema-advies`): toetst het
  schema en doet concrete voorstellen die met één tik zijn toe te passen,
  te negeren (`program.adviceDismissed`) of in één keer allemaal door te
  voeren (`applyAllAdvice`); de laatste wijziging is ongedaan te maken.
  Regels, op volgorde van belang:
  - volume per spiergroep: geen eigen oefening (grote spiergroep: eerst een
    basisoefening, zo nodig een tweede op een andere dag), boven het
    maximum (MRV: sets eraf tot binnen de groeizone), duidelijk onder het
    minimum (onder 75% van MEV, omdat sets tot bijna falen meer opleveren:
    sets erbij tot 3 per oefening, daarna hoogstens twee oefeningen erbij);
  - meer dan 10 sets voor één spiergroep in één training, of een grote
    spiergroep maar één keer per week: een oefening verplaatsen, alleen naar
    een dag voor hetzelfde lichaamsdeel;
  - volgorde (geen isolatie vóór een compoundoefening voor dezelfde spier),
    rust (compound 3 min, isolatie 2 min), warming-up voor de eerste zware
    oefening per spiergroep, hoogstens 3 sets per oefening;
  - oefenkeuze: gerekte positie (minder dan 40%), eenzijdig werk,
    verhouding compound/isolatie rond 40/60, rug tegenover borst en
    hamstrings tegenover quadriceps, supersets bij trainingen boven 85 min.
  Een gewisselde oefening krijgt een nieuw slot, en `historyFor` koppelt
  historie per slot alleen aan dezelfde oefening, zodat de progressie na
  een wissel schoon begint. De sjablonen geven zelf geen voorstellen.
- **Rusttimer**: geluid, trillen (Android) en een melding als de app op de
  achtergrond staat. iOS pauzeert webapps op de achtergrond, dus daar komt
  de melding pas bij terugkeer.

## Abonnement (Nexa Coach)

Gratis: de intake en de calorieën en macro's per dag (Vandaag). Nexa Coach
(€14,99 per maand of €99,99 per jaar, incl. btw, 7 dagen gratis met
betaalgegevens vooraf, één proef per account): maaltijden, Eten, Plan,
Training, Gezondheid en etiketten scannen.

- **Betalen via Stripe.** `netlify/functions/billing.mjs` start Stripe
  Checkout (abonnement, proef, iDEAL/kaart volgens de instellingen in
  Stripe) en opent het klantportaal (opzeggen, plan wisselen,
  betaalgegevens). `stripe-webhook.mjs` zet elke wijziging in
  `public.nexa_subscriptions` (Supabase). Product en prijzen maakt de functie
  zelf aan via de lookup keys `nexa_coach_maand` en `nexa_coach_jaar`.
- **Status in de app.** `src/sync.js` leest de eigen rij (row level
  security: alleen lezen, alleen de eigen rij) en bewaart de laatste status
  op het apparaat, zodat een betalende gebruiker offline niet wordt
  buitengesloten. Toegang bij `trialing`, `active`, `past_due` en `comp`.
- **Uit tot het is ingesteld.** Zolang de omgevingsvariabelen ontbreken,
  meldt `GET /.netlify/functions/billing` `enabled: false` en is alles
  open, zoals voorheen. In de Claude-weergave is er nooit een betaalmuur.
- **Etiketten** kosten API-geld; met abonnementen aan controleert
  `etiket.mjs` op de server of de gebruiker Nexa Coach heeft.
- **Gratis toegang geven:** een rij met `status = 'comp'` (zie de SQL in
  `supabase/migrations/`). Het account van de eigenaar heeft die al.

### Inschakelen

1. Stripe-account aanmaken en activeren (bedrijfsgegevens, bankrekening).
2. Stripe, Developers > API keys: de geheime sleutel.
3. Stripe, Developers > Webhooks: endpoint
   `https://nexa-performance.netlify.app/.netlify/functions/stripe-webhook`
   met `checkout.session.completed` en `customer.subscription.created`,
   `.updated`, `.deleted`, `.paused`, `.resumed`; het ondertekeningsgeheim
   (`whsec_...`) noteren.
4. Supabase, Project Settings > API Keys: een geheime sleutel (`sb_secret_...`).
5. Netlify, Site configuration > Environment variables, alle drie als
   geheim en alleen voor Functions: `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. Daarna opnieuw
   deployen.
6. Stripe, Settings > Billing > Subscriptions and emails: herinnering vóór
   het einde van de proef aanzetten, en het klantportaal inschakelen
   (opzeggen, plan wisselen, betaalmethode bijwerken).
7. Eerst testen met test-sleutels (`sk_test_...`) en kaart 4242 4242 4242 4242.

## Landingspagina

`landing/index.html`: statische HTML met eigen CSS, licht en donker volgens
het toestel, lettertype Barlow zelf gehost (geen Google Fonts op de
landingspagina). De afbeeldingen zijn echte schermafbeeldingen uit de app,
gemaakt met `design/maak-schermen.cjs`; de deelafbeelding met
`design/maak-og.cjs`. Een geïnstalleerde app, `?pwa=1` en links uit mails
(`#access_token=...`) gaan direct door naar `/app/`. "Start 7 dagen gratis"
opent `/app/?coach=1`: na de intake verschijnt dan meteen het aanbod.

## Gemiste of verplaatste training

Op Vandaag staat "Vandaag niet trainen?" (op een trainingsdag) of "Vandaag
toch trainen?" (op een rustdag met later deze week nog een training). De
keuze geldt alleen voor deze week; het vaste weekschema blijft ongemoeid.
Opslag: `weekAdj` (`{ weekStart, list }`) in `macroverdeling:v1`; een
lijst van een vorige week wordt genegeerd.

- `adjustWeek` speelt de aanpassingen op volgorde af. Voorbije dagen
  blijven gelijk; de resterende dagen krijgen de rest van het weektotaal in
  de verhouding die de nieuwe indeling (met cycling) zou geven, nooit onder
  1,05 × rustmetabolisme.
- Verplaatsen ruilt twee dagen: weektotaal gelijk. Overslaan haalt alleen
  het verbruik van de training van het weektotaal af; de cyclingopslag gaat
  terug naar de rest van de week. Is er al gegeten: spreiden over de
  resterende dagen (hoogstens 150 kcal per dag) of zo laten; de bijsturing
  op de gewichtstrend vangt de rest op.
- Bij een trainingsschema op vaste weekdagen gaat de training mee
  (`weekMapAdjusted`); een rotatie schuift vanzelf op. Vanaf twee gemiste
  trainingen per week stelt de app een schema met een dag minder voor.

## Lichaamssamenstelling

De weegschaal ziet het verschil tussen vet en spier niet. Daarom meet de
gebruiker wekelijks taille en nek (vrouwen ook heupen) met een meetlint,
eventueel aangevuld met een andere vetmeting (weegschaal, huidplooimeter,
DEXA, Bod Pod). Code tussen het kopcommentaar `lichaamssamenstelling` en
`recommendedProtein`, UI in `CheckinSheet` en `CompositionSection`.

- **Schatting** (`estimateComposition`): een klein Kalmanfilter met twee
  grootheden, het werkelijke vetpercentage en de afwijking van de
  meetlintformule (US Navy). Tussen metingen voorspelt het gewichtsverloop
  hoeveel vet en vetvrije massa er bij- of afging; elke meting stelt bij,
  gewogen naar haar betrouwbaarheid. Het meetlint volgt veranderingen
  scherp maar ijkt het niveau niet; een DEXA-scan wel.
- **Bijsturen** (`compositionAdvice`): daalt het gewicht in een cut trager
  dan gepland terwijl de taille minstens 0,2 cm per week daalt en de kracht
  (mediane e1RM-verandering, `strengthTrend`) op peil blijft, dan stelt de
  app geen verlaging voor. Valt de gebruiker te snel af met dalende kracht,
  of groeit de taille in een bulk, dan krijgt het voorstel een waarschuwing.
  Alles blijft een voorstel; de gebruiker kan altijd toch bijsturen.
- **Opslag**: `checkins` en `compAnchor` in `macroverdeling:v1`.

## Nexa-account en synchronisatie

In de losse app (Netlify) kan de gebruiker een account maken; de gegevens
staan dan op het apparaat én online in Supabase (project `nexa`, tabel
`public.nexa_data`: een rij per opslagsleutel, beveiligd met row level
security zodat iedere gebruiker alleen zijn eigen rijen ziet). Code in
`src/sync.js`, aangesloten in `build-entry.jsx`; `src/App.jsx` toont de
schermen alleen als `window.nexaSync` bestaat, dus de Claude-weergave
blijft ongewijzigd.

- **Werking**: het apparaat is de eerste opslag (werkt offline). Na elke
  wijziging gaat de sleutel binnen 1,5 s naar Supabase, en direct als de
  app naar de achtergrond gaat. Bij opstarten en bij terugkeren naar de app
  worden nieuwere gegevens opgehaald; per sleutel wint de laatste wijziging.
- **Inloggen** zet de gegevens uit het account op het apparaat (een verse
  installatie heeft alleen standaardwaarden). Een nieuw account neemt de
  gegevens van het apparaat over.
- **E-mail en wachtwoord**, geen inloglink: een link uit de mail opent op
  de iPhone in Safari en niet in de app op het beginscherm, die eigen
  opslag heeft. Bevestigings- en herstellinks worden daarom apart
  afgehandeld en synchroniseren nooit.
- **Supabase-instellingen** (Authentication, URL Configuration): Site URL
  `https://nexa-performance.netlify.app` en dezelfde URL met `/**` als
  toegestane redirect, anders wijzen de links in de mails naar localhost.
  Nieuwe mails verwijzen naar `/app/`; oude links naar `/` stuurt de
  landingspagina door.
- **E-mail**: de ingebouwde maildienst van Supabase mailt alleen naar leden
  van het Supabase-team en maar enkele berichten per uur. Voor andere
  gebruikers is een eigen SMTP-dienst nodig.
- **Gratis abonnement**: Supabase pauzeert een project na een week zonder
  gebruik. De app blijft dan lokaal werken; synchronisatie hervat na
  herstarten van het project in het dashboard.

## Fotoanalyse van etiketten

Binnen de Claude-weergave leest de app etiketten via de `sample`-capability.
Als losse app (Netlify) loopt het via de serverfunctie
`netlify/functions/etiket.mjs`: de app verkleint de foto tot maximaal
1600 px en stuurt hem naar `/.netlify/functions/etiket`; de functie vraagt
Claude de tabel te lezen en geeft gestructureerde JSON terug.

- **API-sleutel**: zet `ANTHROPIC_API_KEY` als omgevingsvariabele in Netlify
  (Site configuration, Environment variables; markeer hem als geheim, scope
  Functions). De sleutel komt nooit in de app zelf.
- **Alleen de eigen site** mag de functie aanroepen (controle op `Origin`).
- **Deployen**: functies worden alleen meegenomen bij een deploy via Git of
  de Netlify-CLI, niet bij het slepen van de map `dist/`. `netlify.toml`
  bevat daarvoor het buildcommando, de publish-map en de functiemap.
- **Controle**: `GET /.netlify/functions/etiket` geeft `{"ok":true}` als de
  sleutel is ingesteld. Fouten verschijnen in het functielogboek van Netlify.

## Verbruik, stappen en de coach

- **Stappen in plaats van activiteitsniveau** (`StepsPicker`, `stepsOf`,
  `activityFactorOf`): rustmetabolisme × 1,15 + stappen × 0,0005 kcal per kg +
  werk (`WORK`: zittend 0, staand 100, zwaar 350 kcal per dag), als factor op het
  rustmetabolisme zodat alle planners er hetzelfde mee rekenen. Opgeslagen in
  `f.steps` en `f.work`; zonder ingevulde stappen zet `ACTIVITY_TO_STEPS` de oude
  keuze om (zittend 5.000, licht 9.000, actief 12.000 + staand, zwaar 12.000 +
  zwaar werk) en vraagt Vandaag om het echte aantal.
- **Gezondheidsminimum** (`stepFloor`): 8.000 stappen, vanaf 60 jaar 7.000
  (Paluch 2022, Ding 2025). Moet er minder gegeten worden en zit de gebruiker
  eronder, dan stelt de coach eerst meer stappen voor (het extra verbruik plus
  hoogstens de rest als minder eten); minder lopen om aan te komen stelt de app
  nooit voor. Onder het minimum een wekelijkse tip op Vandaag.
- **Coach** (`coachState`, `CoachPanel`, opgeslagen als `coach` in
  `macroverdeling:v1`): `vroeg` (na 6+ dagen en 5 metingen meer dan 0,4 kg per week
  de verkeerde kant op, met een kleine correctie van 150 kcal), `wacht` (7 dagen na
  een bijsturing; daarna telt alleen wat sindsdien gemeten is), `pauze` (begin
  van een fase, alleen als de afwijking past bij vocht en glycogeen: sneller
  aankomen in een bulk, sneller afvallen in een cut), `trouw` (laatste meting
  "vaak niet gevolgd": eerst daaraan werken), `bijsturen` (stappen van hoogstens
  300 kcal, `CORR_STEP`) en `koers`. Energie per kg: 7.700 kcal voor het deel
  onder nul, 5.500 erboven (`energyOfRate`).
- **Gemeten onderhoud**: na 21 dagen en 10 metingen: gemiddelde voorgeschreven
  inname (`coach.kcalHist`, `intakeBetween`) min de energie van de gewichtstrend.
  Met "Rekenen met gemeten onderhoud" wordt `kcalAdjust` zo gezet dat het schema
  op het gemeten verbruik rekent.
- **Wekelijkse meting** vraagt ook de gemiddelde stappen (werkt `f.steps` bij) en
  hoe goed het schema gevolgd is (`ADHERENCE`).
- **Aanpassingen deze week**: overgeslagen of verplaatste trainingen van eerdere
  dagen staan op Vandaag, elk met "Ongedaan maken" (`undoAdjAt`).

## Schema op maat

Training → (geen schema) of Schema → nieuw: `PlanBuilder` vraagt dagen, tijd per
training, tijdstip, ervaring, prioriteiten (max. 3, `FOCUS_GROUPS`), materiaal
(`PLAN_EQUIP`) en klachten (`PLAN_COMPLAINTS`); slaap, leeftijd, ervaring en
fase komen uit het profiel (`ProfileCtx`). `buildCustomPlan` maakt het schema,
`explainCustomPlan` de uitleg "Waarom dit schema" (opgeslagen in
`program.custom.why`, terug te lezen onder Schema). Antwoorden in `T.planPrefs`.

- **Indeling** (`chooseSplit`, `scoreSplit`): per aantal dagen de kandidaten uit
  `PLAN_SPLITS` (full body, upper/lower/full, PPL, upper/lower, ULPPL), in alle
  volgordes op de gekozen weekdagen. Score: frequentie per spier (2× per week
  of meer, Schoenfeld 2016), minus te korte hersteltijd: 48 uur bovenlichaam,
  72 uur benen na een zware beendag (2+ oefeningen voor die spier), 48 uur bij
  full body; dezelfde spier op opeenvolgende dagen weegt zwaar. Beginners
  krijgen voorkeur voor full body, ervaren sporters voor splits.
- **Oefeningen** (`PLAN_DAYS`): per dagtype rollen met oefeningen in volgorde
  van voorkeur, gefilterd op materiaal en klachten; anders een passende uit de
  bibliotheek.
- **Volume** (`planTargets`): sets per spier per week naar ervaring (8/10/12,
  prioriteit 12/15/18), −15% bij minder dan 7 uur slaap, −10% vanaf 50 jaar,
  binnen MEV-MRV. Hoogstens 3 sets per oefening en 9 per spier per training
  (afnemende meeropbrengst, Pelland 2024); daarboven een extra oefening.
- **Volgorde**: zware basisoefeningen eerst, prioriteit voorop, dan isolatie
  (Simão 2012).
- **Tijd**: past de training niet, dan kortere rust, supersets van
  tegenovergestelde spieren, derde sets eraf bij spieren die het verst boven
  hun doel zitten, dan isolatie die elders genoeg krijgt (elke grote spier
  houdt minstens 4 sets per week). De uitleg noemt eerlijk welke spieren dan
  onder het ideale volume blijven.
- Toepassen zet de voedingsweek op dezelfde dagen, tijd en duur.
- Nieuw in de bibliotheek voor thuis: `db_rdl`, `goblet_squat`, `db_calf`.

## Live training: timer, bezet, staande weergave

- **Rusttimer** (`primeAudio`, `tones`, `beep`, `pip`, `restAlert`): luider
  eindsignaal via een compressor, aftellen bij 3, 2, 1 s (`settings.countdown`),
  de AudioContext wordt na een onderbreking hervat. Een iPhone speelt webaudio
  standaard als "ambient" en is dan stil in de stille stand (trillen kan daar
  niet); `settings.soundSilent` zet `navigator.audioSession.type = "playback"`
  (Safari 16.4+) zodat de timer toch klinkt; muziek van een andere app pauzeert
  dan. Instellingen → "Geluid testen".
- **Bezet?** (`busyAlternatives`, `movePattern`): per oefening de drie beste
  vervangers voor alleen deze training: zelfde hoofdspier en soort, zelfde
  bewegingspatroon (verticaal/horizontaal trekken, schuin drukken, knie- of
  heupbuiging), liefst ander materiaal, eerder gedane oefeningen met hun vorige
  prestatie voorop; lichaamsgewicht-compounds lager. "Later doen" zet de
  oefening achteraan. Het schema verandert niet (`swappedFrom` in de sessie).
- **Alleen staand**: het manifest vraagt `portrait-primary` en de app probeert
  `screen.orientation.lock`; een iPhone negeert beide, daarom bedekt
  `#rotate-lock` (in `build.mjs`) de app liggend op telefoons
  (`max-height: 520px`, `pointer: coarse`). Tablets mogen liggend.

## Beveiliging en privacy (AVG)

Security-audit van 1 oktober 2026; migratie `supabase/migrations/20261001_beveiliging_avg.sql`,
register en datalekprocedure in `docs/avg/`.

- **Toestemming** (AVG art. 9): gezondheidsgegevens gaan alleen naar de server
  met uitdrukkelijke toestemming, vastgelegd in `user_metadata.consent`
  (`{health, terms, age16, version}`, `CONSENT_VERSION` in `src/sync.js`).
  Zonder geldige toestemming synchroniseert de app niet (`canSync`) en vraagt
  `ConsentSheet` erom. Een nieuwe `CONSENT_VERSION` vraagt iedereen opnieuw.
  Aanmelden vereist 16+ en akkoord met voorwaarden en privacyverklaring.
- **Rechten**: Profiel → Privacy en gegevens: downloaden als JSON
  (`exportData`), apparaat wissen, account verwijderen (`deleteAccount`:
  eerst `billing` `cancel_now`, dan `rpc delete_own_account`, cascade).
  Uitloggen kan met "ook van dit apparaat wissen".
- **Herroepingsknop** (art. 11a richtlijn 2011/83/EU, sinds 19 juni 2026):
  binnen 14 dagen na `started_at` toont het profiel "Overeenkomst hier
  herroepen"; `billing` `withdraw` stopt het abonnement en betaalt alles terug.
- **Etiketscanner**: altijd ingelogd, plus `label_quota()` (30 per dag) en
  met abonnementen aan alleen voor Nexa Coach. De Origin-controle alleen is
  na te maken en geen beveiliging.
- **Database**: RLS op alle tabellen; geen TRUNCATE/TRIGGER/REFERENCES voor
  anon/authenticated; `nexa_data` alleen sleutels `macroverdeling:*`, hoogstens
  20 per gebruiker. `label_quota` en `delete_own_account` zijn SECURITY
  DEFINER met vaste `search_path` en werken alleen op `auth.uid()` (de
  Supabase-waarschuwing daarover is bedoeld).
- **Headers**: CSP per pagina met SHA-256-hashes van de inline scripts,
  door `build.mjs` bij elke build berekend en achter `dist/_headers` gezet;
  daarnaast `X-Frame-Options: DENY`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`. Nieuwe externe bron nodig? Voeg hem toe in
  `csp()` in `build.mjs`.
- **Lettertypen**: alleen zelf gehost (`landing/fonts`), geen Google Fonts.
- **Juridische pagina's**: `landing/privacy/body.html` en
  `landing/voorwaarden/body.html` (+ `landing/legal-head.html`), gebouwd naar
  `/privacy/` en `/voorwaarden/`. Gemarkeerde `[...]`-velden invullen.

## Logo en iconen

`design/nexa-logo-ontwerpen.png` is het huisstijlontwerp. Het app-icoon is
daaruit nagetekend als vector (`design/nexa-icon.svg`); alle formaten in
`public/` (180 voor iOS, 192 en 512 voor Android en browsers, 512 maskeerbaar,
32 als favicon) worden gemaakt met:

```bash
NODE_PATH=$(npm root -g) node design/maak-iconen.cjs
```

Netlify bewaart iconen een jaar in de cache. Verhoog na een nieuw icoon
daarom het versienummer `?v=nexa1` in `build.mjs` en
`public/manifest.webmanifest`, anders houden telefoons het oude icoon.

## Belangrijke valkuil bij het bouwen

Voeg nooit tekst toe aan `dist/index.html` via een kale
`string.replace('</body>', ...)`. De afdrukfunctie in de app bouwt zelf een
HTML-tekststring op die toevallig ook `</body>` bevat; een vervang-alles
raakt dan ook die tekst middenin de gebundelde JavaScript en breekt de hele
pagina (leidt tot een onopgemaakte, zwarte pagina zonder React-inhoud).
`build.mjs` gebruikt daarom `lastIndexOf` om alleen het echte, laatste
voorkomen te raken. Bewaar dat patroon bij wijzigingen aan het build-script.

## Deployen

Twee routes:

- **Vanuit Claude**, als Artifact: de app draait ook rechtstreeks als
  gepubliceerde Artifact-pagina binnen Claude, met opslag in het
  Claude-account van de gebruiker (via de `db`- en `user`-capabilities) en
  etiketherkenning via foto (via de `sample`-capability). Dat pad gebruikt
  niet dit build-script maar een los samengestelde versie met die
  capabilities erbij.
- **Productie**: de Netlify-site `nexa-performance` is gekoppeld aan GitHub en bouwt
  automatisch bij elke push naar de branch `feature/uitbreiding`.
- **Als PWA op Netlify**: `npm run build`, daarna de map `dist/` (plus de
  bestanden uit `public/` en `netlify.toml`) naar Netlify. Bij een site die
  aan deze git-repo is gekoppeld kan Netlify dat automatisch doen met
  `npm run build` als buildcommando en `dist` als publish-map.

## Afhankelijkheden

React en ReactDOM (MIT-licentie), Tailwind CSS en esbuild als
buildgereedschap. Het lettertype Barlow (Google Fonts, SIL Open Font
License) wordt via een `@import` geladen; de app heeft een systeemfont als
terugval als dat niet lukt.
