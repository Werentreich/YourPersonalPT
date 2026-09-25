# Nexa

*Your personal performance coach.*

Trainingsgerichte macro- en voedingsschemaplanner, in het Nederlands, als
installeerbare PWA. Berekent calorieën en macro's per dag op basis van
lichaamsgegevens, training en doel; verdeelt die over maaltijden en porties;
en ondersteunt meerwekenplannen voor cutten, bulken en minicuts. Het
tabblad Training bevat trainingsschema's, live loggen met rusttimer,
automatische progressie, periodisering met deload en analyses.

**Live:** https://macroverdeling.netlify.app

De opslagsleutels (`macroverdeling:v1` en `macroverdeling:training:v1`)
behouden bewust hun oude naam, zodat bestaande gegevens bewaard blijven.

## Structuur

```
src/App.jsx       de volledige app: rekenkern, UI, alles in één bestand
public/           statische PWA-bestanden (manifest, service worker, iconen)
build.mjs         bouwt src/App.jsx naar dist/index.html
build-entry.jsx    opslaglaag (account/apparaat/geheugen) + React-opstart
build-input.css    Tailwind-invoer
netlify.toml       Netlify-configuratie (headers, SPA-redirect)
```

`src/App.jsx` is bewust één bestand: de app draait ook als zelfstandig
kunstwerk binnen Claude (als Artifact), waar geen modulebundeling
beschikbaar is. Wie eraan werkt via Claude Code kan gewoon in dat ene
bestand editen; `npm run build` zet het om naar een zelfstandige
`dist/index.html` van ongeveer 460 kB, met alles inline (React, stijlen,
logica) en geen andere netwerkafhankelijkheid dan Google Fonts.

## Ontwikkelen

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
- **Koppeling met voeding** (`TRAIN_PHASE`): in een minicut gaat het volume
  ongeveer een derde omlaag en blijven de gewichten gelijk; in een cut
  telt stilstand niet als vermoeidheid. Schema's op weekdagen kunnen de
  trainingsdagen van de voedingsweek gelijktrekken.
- **Analyses**: werksets per spiergroep tegen MEV/MAV/MRV (Renaissance
  Periodization), volume per week, e1RM-verloop, records en therapietrouw.
- **Rusttimer**: geluid, trillen (Android) en een melding als de app op de
  achtergrond staat. iOS pauzeert webapps op de achtergrond, dus daar komt
  de melding pas bij terugkeer.

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
  `https://macroverdeling.netlify.app` en dezelfde URL met `/**` als
  toegestane redirect, anders wijzen de links in de mails naar localhost.
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
- **Als PWA op Netlify**: `npm run build`, daarna de map `dist/` (plus de
  bestanden uit `public/` en `netlify.toml`) naar Netlify. Bij een site die
  aan deze git-repo is gekoppeld kan Netlify dat automatisch doen met
  `npm run build` als buildcommando en `dist` als publish-map.

## Afhankelijkheden

React en ReactDOM (MIT-licentie), Tailwind CSS en esbuild als
buildgereedschap. Het lettertype Barlow (Google Fonts, SIL Open Font
License) wordt via een `@import` geladen; de app heeft een systeemfont als
terugval als dat niet lukt.
