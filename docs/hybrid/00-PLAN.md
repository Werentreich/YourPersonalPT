# Nexa Hybrid: plan

*Status: goedgekeurd op 2026-10-03, met alle voorstellen. Aanvulling: geen standaard Hyrox-look.*

Nexa Hybrid is een tweede build uit deze codebase voor hybride atleten: kracht,
functionele training, conditie en uithoudingsvermogen in één adaptief schema,
met de voedingsmotor van Nexa eronder. Het is een **upgrade** op Nexa Coach,
met een eigen kleur en identiteit binnen de Nexa-familie.

---

## 1. Uitgangspunten (besloten)

| Vraag | Besluit |
|---|---|
| Product | Tweede build uit dezelfde codebase |
| Codestructuur | Modulair; de uitvoer blijft één zelfstandige `index.html` |
| Voeding | Ja, gekoppeld aan de trainingsbelasting |
| Methodiek | Geen enkele school; evidence-based mix (zie §4) |
| Schema | Adaptief: past zich wekelijks en dagelijks aan de persoon aan |
| Disciplines | Alles (zie §4.1) |
| Data v1 | Strava-import; datamodel en architectuur klaar voor GPS |
| Herstel | Alles: vragenlijst, HRV, slaap, rusthartslag |
| Verdienmodel | Upgrade boven Nexa Coach |
| Merk | Eigen kleur en identiteit |

---

## 2. Architectuur

### 2.1 Eén repo, twee builds

```
src/App.jsx               Nexa (ongewijzigd gedrag; blijft Artifact-geschikt)
src/sync.js               gedeeld: account, sync, abonnement
src/hybrid/
  main.jsx                opstart Hybrid (eigen opslagsleutels, thema)
  App.jsx                 schil, tabs, navigatie
  theme.js                merkkleuren Hybrid
  engine/
    load.js               belastingsmodel (sRPE, TRIMP, ATL/CTL/TSB)
    zones.js              hartslag-, tempo-, vermogens-, zwemzones
    planner.js            adaptieve weekplanner
    interference.js       regels kracht ↔ duur
    readiness.js          herstelscore uit vragenlijst + wearables
    progress.js           progressie per discipline
    fuel.js               koolhydraatperiodisering en fueling
    wod.js                AMRAP / EMOM / For Time / Chipper / Hyrox
  import/
    fit.js, gpx.js, tcx.js  bestandsimport
    strava.js             client voor de Strava-functie
  ui/                     schermen en componenten
netlify/functions/
  strava-auth.mjs         OAuth-koppeling
  strava-webhook.mjs      nieuwe activiteiten binnenhalen
tests/hybrid/             engine-tests (Node, zonder netwerk)
```

### 2.2 Hergebruik zonder Nexa te breken

`src/App.jsx` krijgt alleen extra `export`-woorden voor de pure functies die
Hybrid nodig heeft (voedingsberekening, krachtprogressie, oefeningenbibliotheek,
UI-bouwstenen). Esbuild bundelt dat gewoon mee. Nexa zelf verandert niet en
blijft als Claude-Artifact draaien.

Het alternatief, de rekenkern uit `App.jsx` naar losse bestanden halen, is
netter maar kost Nexa de Artifact-geschiktheid. Daarom niet in deze fase.

### 2.3 Bouwen en hosten

- `build.mjs` krijgt een doel: `node build.mjs hybrid` → `dist/hybrid/index.html`.
- Hosting: zelfde Netlify-site onder `/hybrid/`, of een eigen domein
  (bijvoorbeeld `hybrid.nexa…`). **Open beslissing.**
- Eigen `manifest.webmanifest`, iconen en service worker (eigen scope), zodat
  Hybrid als aparte app op het beginscherm staat.
- Opslagsleutels: `nexa-hybrid:v1` en `nexa-hybrid:training:v1`. Het
  voedingsprofiel wordt bij de eerste start uit Nexa overgenomen als dat er is.

### 2.4 Voorbereid op GPS en native

De PWA kan op iOS geen GPS op de achtergrond volgen. Daarom:

- Het datamodel voor activiteiten bevat vanaf dag één `streams` (tijd, positie,
  hoogte, hartslag, vermogen, cadans), in dezelfde vorm als FIT, GPX en Strava.
- Native volgt later met **Capacitor**: dezelfde webcode in een iOS- en
  Android-schil, met plug-ins voor achtergrond-GPS, HealthKit en Health Connect.
  Geen herbouw nodig.

---

## 3. Gegevensmodel (kern)

```js
// Sessie: één training, gepland of gedaan
{
  id, date, status: "gepland" | "gedaan" | "overgeslagen",
  kind: "kracht" | "duur" | "conditie" | "hyrox" | "mobiliteit" | "test",
  sport: "hardlopen" | "fietsen" | "roeien" | "skierg" | "zwemmen" | "wandelen" | null,
  plannedBy: "planner" | "gebruiker",
  target: { durationMin, distanceM, zone, intervals: [...], exercises: [...], wod: {...} },
  actual: { durationMin, distanceM, avgHr, maxHr, avgPower, pace, rpe, sets: [...], wodResult },
  streams: { t:[], latlng:[], alt:[], hr:[], watts:[], cad:[] } | null,
  source: "handmatig" | "fit" | "gpx" | "strava" | "gps",
  externalId,           // bijv. Strava-activiteit-id, om dubbelingen te voorkomen
  load: { srpe, trimp, units }   // berekend
}

// Profiel van de atleet
{
  hrMax, hrRest, lthr, runThresholdPace, ftp, css, row2k,
  goal: { type: "algemeen-hybride" | "hyrox" | "10k" | "halve" | "marathon"
               | "triatlon" | "kracht-eerst" | "eigen", date, priority },
  availability: { days: [...], minutesPerDay: {...}, doubleSessions: bool },
  equipment: [...], experience: { kracht, duur }
}

// Dagelijkse herstelscore
{ date, sleepH, sleepQ, soreness, stress, mood, hrv, rhr, score, source }
```

Supabase: dezelfde sleutel-waardetabel als Nexa (`src/sync.js`), plus één nieuwe
servertabel `hybrid_integrations` (Strava-tokens, alleen leesbaar en schrijfbaar
door de service role).

---

## 4. Trainingsmotor

### 4.1 Disciplines

- **Kracht:** de bestaande Nexa-motor (RIR, reps-first-progressie, deload),
  aangevuld met kracht voor duursporters (zwaar, weinig herhalingen,
  plyometrie) en explosief werk.
- **Duur:** hardlopen, fietsen, roeien, ski-erg, zwemmen, wandelen/rucken.
  Sessietypen: rustig (zone 2), tempo, drempel, VO2max-intervallen, lange duur
  en heuvels.
- **Conditie/functioneel:** AMRAP, EMOM, For Time, Chipper en intervallen (Tabata).
- **Hyrox:** 8 × 1 km lopen plus de 8 stations, met stations en compromised
  running apart te trainen.
- **Mobiliteit en prehab.**
- **Tests:** 5 km, 2 km roeien, 20 min FTP, CSS (zwemmen), e1RM en een
  Hyrox-simulatie. Testen werken de zones automatisch bij.

### 4.2 Eén belastingsmaat voor alles

Kracht en duur moeten optelbaar zijn, anders kan de planner niet sturen.

- **sRPE-belasting** = RPE (0-10) × minuten (Foster e.a., 2001). Dit werkt voor
  elke discipline en is de basis.
- **TRIMP** (Banister) bij hartslagdata, ter verfijning van duursessies.
- **Fitheid, vermoeidheid en vorm:** CTL (42 dagen), ATL (7 dagen) en TSB = CTL − ATL
  (impulse-responsmodel, Banister 1975).
- **Verhouding acuut/chronisch** als waarschuwing bij een te snelle opbouw. Dit
  is alleen een signaal en geen harde grens, omdat het wetenschappelijk ter
  discussie staat (Impellizzeri e.a., 2020).
- Daarnaast een **aparte vermoeidheid per systeem**: benen, bovenlichaam en
  centraal. Een zware deadlift en een drempelloop belasten allebei de benen.
  Een bankdrukdag doet dat niet.

### 4.3 Adaptieve planner

**Invoer:** doel en datum, beschikbare dagen en tijd per dag, ervaring per
pijler, materiaal, huidige fitheid (CTL, zones, e1RM) en herstel.

**Weekopbouw** (mesocyclus van 3-4 weken plus een herstelweek):

1. Kies de **verdeling over de pijlers** op basis van het doel (bijv. Hyrox:
   3 × duur, 2 × kracht, 1 × Hyrox-specifiek; kracht-eerst: 4 × kracht,
   2 × duur).
2. Duur volgt een **gepolariseerde intensiteitsverdeling** van ongeveer 80/20
   (Seiler, 2010): meest rustig en weinig maar echt zwaar.
3. **Interferentieregels** (Wilson e.a., 2012; Methenitis, 2018):
   - geen zware beenkracht binnen ~24 uur vóór een sleutelsessie duur, en
     omgekeerd;
   - op dezelfde dag eerst wat prioriteit heeft, met minimaal 6 uur ertussen
     als het kan;
   - fietsen interfereert minder met beenkracht dan hardlopen;
   - harde dagen hard, rustige dagen rustig: zware sessies clusteren.
4. **Periodisering naar het doel:** basis → opbouw → piek → taper (1-2 weken)
   → wedstrijd → herstel. Zonder doeldatum volgen doorlopende blokken.

**Wekelijks bijsturen:**

- Uitgevoerd versus gepland (therapietrouw) en RPE tegenover verwachting.
- Prestatietrend per pijler: tempo bij dezelfde hartslag, e1RM en WOD-tijden.
- Volume omhoog (~5-10% per week) bij goed herstel en voortgang. Gelijk
  houden of omlaag bij signalen.

**Dagelijks bijsturen:**

- Lage herstelscore: de geplande intervaltraining wordt een zone 2-sessie of
  wordt verplaatst, met uitleg en één tik om het voorstel te accepteren.
- Een gemiste sessie verschuift slim, zonder twee zware dagen achter elkaar.
- Heeft de gebruiker zelf iets anders gedaan, dan rekent de planner met de
  werkelijke belasting door.

Het principe blijft net als in Nexa **voorstel eerst, automatisch als optie**.
De gebruiker houdt de regie.

### 4.4 Herstel (readiness)

- Dagelijkse vragenlijst van 5 vragen in 10 seconden (bestaat al deels in Nexa).
- HRV en rusthartslag ten opzichte van de persoonlijke baseline van 7 en 60
  dagen (rollende gemiddelden en afwijking), slaapduur.
- Bronnen: handmatig nu; later Strava (beperkt), Garmin, HealthKit en Health
  Connect (de laatste twee alleen native).

---

## 5. Voeding (hybride)

Hergebruik de Nexa-motor, met deze uitbreidingen:

- **Koolhydraten per dag naar geplande belasting:** 3-5 g/kg op lichte dagen,
  5-7 bij gemiddeld, 6-10 bij zware of lange duur (Thomas e.a., ACSM-standpunt
  2016). Eiwit blijft 1,6-2,2 g/kg.
- **Fueling tijdens training:** vanaf ~75 minuten 30-60 g/u, bij lange duur
  tot 90 g/u met glucose plus fructose (Jeukendrup, 2014). Inclusief vocht en
  natrium.
- **Rond de training:** timing van de maaltijden ten opzichte van de
  sessietijd.
- **Wedstrijd:** carb-loading 36-48 uur vooraf bij wedstrijden boven 90 minuten.
- Een cut combineren met een zware duurperiode geeft een waarschuwing over
  energiebeschikbaarheid (RED-S).

---

## 6. Integraties

### 6.1 Strava (v1)

- OAuth via `netlify/functions/strava-auth.mjs`. Tokens staan alleen op de
  server (`hybrid_integrations`) en nooit op het apparaat.
- Webhook voor nieuwe activiteiten, met dubbelingcontrole op `externalId`.
- **Belangrijk: Strava API-voorwaarden (sinds november 2024).** Het is verboden
  Strava-data te gebruiken voor het trainen van AI-modellen. Verder mag
  de data alleen aan de gebruiker zelf getoond worden. Of het **naar een AI-model
  sturen voor coachadvies** is toegestaan, is een grijs gebied. Voorstel: de
  AI-coach krijgt standaard alleen *afgeleide* waarden (belasting, zones,
  trend) en geen ruwe Strava-data. Vóór lancering juridisch laten toetsen.
- Strava is ook rate-limited (standaard 200 verzoeken per 15 min, 2.000 per dag
  per app). Vanaf enkele honderden actieve gebruikers is een verhoging nodig.

### 6.2 Bestandsimport (v1, geen afhankelijkheid)

FIT, GPX en TCX importeren. Dit werkt met elk horloge en valt niet onder de
Strava-voorwaarden.

### 6.3 Later

- **Garmin Connect Developer Program:** goedkeuring nodig, alleen voor
  bedrijven. Aanvraag tijdig starten.
- **HealthKit / Health Connect:** alleen via de native app (Capacitor).
- **Live GPS:** native app.

---

## 7. Abonnement (upgrade)

| | Gratis | Nexa Coach | **Nexa Hybrid** |
|---|---|---|---|
| Calorieën en macro's per dag | ✓ | ✓ | ✓ |
| Maaltijden, Plan, Krachttraining | | ✓ | ✓ |
| Hybride planner, duur, WOD's, Hyrox | | | ✓ |
| Strava en bestandsimport | | | ✓ |
| Fueling en koolhydraatperiodisering | | | ✓ |

- Prijsvoorstel: **€19,99 per maand of €139,99 per jaar** (Coach is
  €14,99/€99,99). Te vergelijken met TrainingPeaks Premium en Runna (~€20/mnd).
  **Open beslissing.**
- Technisch: `nexa_subscriptions.plan` krijgt de waarde `hybrid_maand` /
  `hybrid_jaar`. Nieuwe Stripe-lookup keys `nexa_hybrid_maand` en
  `nexa_hybrid_jaar`. Een Hybrid-abonnement geeft ook Coach-toegang in Nexa.
  Upgraden en downgraden via het Stripe-klantportaal, met pro rata verrekening.

---

## 8. Merk

- Naam: **Nexa Hybrid**. Zelfde lettertypen (Barlow / Barlow Condensed) en
  layout, eigen accentkleur.
- Geen Hyrox-look (geen neon op zwart, geen vette hoofdletters, geen strepen).
  Twee merkkleuren: **getij** (petrol-teal, duur, primair accent) en **gloed**
  (terracotta, kracht), op een warme steen- of houtskoolondergrond. Volledige
  uitwerking in [`01-MERK.md`](./01-MERK.md).
- Eigen icoon: een zware rechte lijn (kracht) die een golvende hoogtelijn
  (duur) kruist.

---

## 9. AVG

- Hartslag, HRV en slaap zijn gezondheidsgegevens (AVG art. 9). De bestaande
  uitdrukkelijke toestemming (`CONSENT_VERSION` in `src/sync.js`) krijgt een
  nieuwe versie die ook wearables en Strava noemt.
- Locatiegegevens (GPS-routes) zijn extra gevoelig: standaard alleen op het
  apparaat en pas na aparte toestemming naar de server. Begin- en eindpunt
  rond het huisadres bij voorkeur afschermen.
- `docs/avg/verwerkingsregister.md` aanvullen met Strava als bron en de
  nieuwe tabel.

---

## 10. Fasering

| Fase | Inhoud | Klaar als |
|---|---|---|
| **0. Fundering** ✓ | Buildtarget, merk, thema, opslag, exports uit `App.jsx`, lege schil met tabs, abonnementsniveau | `node build.mjs hybrid` levert een werkende, installeerbare lege app; Nexa-tests blijven groen |
| **1. Loggen en belasting** ✓ | Alle sessietypen loggen (kracht, duur, WOD, Hyrox), zones, sRPE/TRIMP, CTL/ATL/TSB, FIT/GPX-import | Een week trainen loggen en een correcte belastingsgrafiek zien |
| **2. Adaptieve planner** | Intake, weekgenerator, interferentieregels, periodisering, tests, herstel en dagelijks bijsturen | De planner maakt voor 5 testprofielen een verantwoord schema (unit-tests) en stuurt bij op gemiste sessies en slecht herstel |
| **3. Hybride voeding** | Koolhydraten naar belasting, fueling, wedstrijdvoeding | De macro's per dag bewegen mee met het weekplan |
| **4. Strava** | OAuth, webhook, import en ontdubbelen | Een Strava-activiteit verschijnt binnen een minuut in de app |
| **5. Coach en native** | AI-coach voor hybride, Capacitor-app, GPS, HealthKit/Health Connect, Garmin | Apart te plannen na fase 4 |

Elke fase eindigt met tests (`npm test`), een build, `npm run verify` en een
review van u voordat de volgende fase start.

---

## 11. Open beslissingen

1. Hosting: `/hybrid/` op de huidige site of een eigen domein?
2. Prijs van de upgrade.
3. ~~Accentkleur~~: besloten, zie `01-MERK.md`.
4. Strava en AI: akkoord met alleen afgeleide waarden naar de coach?
5. Repo `YourPersonalPT` op privé zetten (sterk aanbevolen: het is nu publiek).

---

## Bronnen

- Foster C. e.a. (2001). *A new approach to monitoring exercise training.* J Strength Cond Res 15(1).
- Banister E.W. e.a. (1975). *A systems model of training for athletic performance.* Aust J Sports Med 7.
- Seiler S. (2010). *What is best practice for training intensity and duration distribution in endurance athletes?* IJSPP 5(3).
- Wilson J.M. e.a. (2012). *Concurrent training: a meta-analysis examining interference of aerobic and resistance exercises.* J Strength Cond Res 26(8).
- Methenitis S. (2018). *A brief review on concurrent training: from laboratory to the field.* Sports 6(4).
- Impellizzeri F.M. e.a. (2020). *Acute:chronic workload ratio: conceptual issues and fundamental pitfalls.* IJSPP 15(6).
- Thomas D.T., Erdman K.A., Burke L.M. (2016). *ACSM/AND/DC joint position: Nutrition and athletic performance.* Med Sci Sports Exerc 48(3).
- Jeukendrup A. (2014). *A step towards personalized sports nutrition: carbohydrate intake during exercise.* Sports Med 44(S1).
- Strava API Agreement (bijgewerkt november 2024): https://www.strava.com/legal/api
- Strava rate limits: https://developers.strava.com/docs/rate-limits/

---

## Stand van zaken

- **Fase 0** (2026-10-03): klaar. Tweede build, merk, upgrade-abonnement.
- **Fase 1** (2026-10-03): klaar.
  - Loggen van kracht (oefeningen uit de Nexa-bibliotheek of eigen, sets met
    kg/herhalingen/RIR), duur (zes sporten, zeven soorten sessies), WOD
    (AMRAP, EMOM, For Time, Chipper, intervallen), Hyrox (wedstrijd, simulatie
    of stations, met splits) en mobiliteit.
  - Import van FIT, GPX en TCX zonder externe bibliotheek; route alleen op
    het apparaat, hartslag als histogram zodat zones later kloppen.
  - Belasting: sRPE met geschatte RPE uit hartslag, RIR of soort sessie;
    TRIMP; fitheid/vermoeidheid/vorm; belasting per systeem (benen,
    bovenlichaam, centraal) als basis voor de interferentieregels in fase 2.
  - Zones: hartslag (LTHR, reserve of % max), hardlopen (Riegel), fietsen
    (FTP), roeien (2 km), zwemmen (CSS).
  - Voortgang: grafieken met tooltip en tabelweergave, intensiteitsverdeling
    en records. Kleuren gevalideerd op kleurenblindheid.
  - Afwijking van het plan: de vorm is fitheid − vermoeidheid aan het eind
    van de dag (niet de stand van gisteren), zodat de getallen op elk scherm
    optellen.
