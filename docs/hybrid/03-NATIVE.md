# Nexa als eigen app (iOS en Android)

> Sinds oktober 2026 is Nexa Hybrid opgegaan in Nexa. De eigen app is daarom
> Nexa (`nl.nexa.app`, webmap uit `dist/app`); alles hieronder geldt voor Nexa.

De webapp is voorbereid op een eigen app met **Capacitor**: dezelfde code in
een native schil, met toegang tot GPS op de achtergrond, Apple Gezondheid
(HealthKit) en Health Connect. Dit document beschrijft wat er klaarstaat en
welke stappen nog nodig zijn. De native projecten (`ios/`, `android/`) staan
nog niet in de repo: die maakt u eenmalig op een Mac (iOS) en met Android
Studio.

## Wat er al klaarstaat

| Onderdeel | Bestand | Wat het doet |
|---|---|---|
| Configuratie | `capacitor.config.json` | App-ID `nl.nexa.hybrid`, webmap `native/www`, Android-schema `https` |
| Webmap | `scripts/native-www.mjs` (`npm run native:www`) | Kopieert de Hybrid-build met relatieve adressen, zonder service worker en manifest |
| Platform | `src/hybrid/native/platform.js` | Herkent de eigen app; serverfuncties gaan dan naar `https://nexa-performance.netlify.app` |
| GPS | `src/hybrid/native/geo.js` | In de app via BackgroundGeolocation (scherm uit), op het web via `watchPosition` + Wake Lock |
| Gezondheid | `src/hybrid/native/health.js` | Leest HRV, rusthartslag en slaap van afgelopen nacht voor de check-in |
| Server | `netlify/lib/origin.mjs` | Staat `capacitor://localhost` en `https://localhost` toe (CORS) voor coach, Strava en billing |
| Betaling | `src/hybrid/App.jsx`, `netlify/functions/billing.mjs` | In de app geen aankoopknop of betaallink; de server weigert checkout/portaal vanuit de app |

## Eenmalig opzetten

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npm install @capacitor/browser @capacitor-community/background-geolocation @capgo/capacitor-health
npm run build && npm run native:www
npx cap add ios
npx cap add android
npx cap sync
```

Bij elke nieuwe versie: `npm run build && npm run native:www && npx cap sync`,
daarna bouwen in Xcode / Android Studio.

> De pluginnamen hierboven zijn de aanbevolen keuzes (oktober 2026). Controleer
> bij installatie de actuele versie en de namen van de gegevenssoorten in
> `TYPES` in `src/hybrid/native/health.js` tegen de documentatie van de
> plugin.

## iOS (Xcode)

`ios/App/App/Info.plist`, teksten in het Nederlands:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Om uw route, afstand en tempo op te nemen tijdens een training.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Om uw training op te blijven nemen als het scherm uit staat.</string>
<key>NSHealthShareUsageDescription</key>
<string>Om HRV, rusthartslag en slaap over te nemen in uw dagelijkse check-in.</string>
<key>UIBackgroundModes</key>
<array><string>location</string></array>
```

- Capability **HealthKit** aanzetten (Signing & Capabilities). Alleen lezen.
- Capability **Background Modes → Location updates**.

## Android (Android Studio)

`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.health.READ_HEART_RATE_VARIABILITY" />
<uses-permission android:name="android.permission.health.READ_RESTING_HEART_RATE" />
<uses-permission android:name="android.permission.health.READ_SLEEP" />
```

- De plugin voor achtergrondlocatie gebruikt een **voorgrondservice** met een
  melding in beeld; dat is verplicht en zichtbaar voor de gebruiker.
- Health Connect vraagt een **privacybeleid-activiteit** (zie de
  documentatie van de plugin) en een verklaring in de Play Console
  (Health apps declaration).
- In de Play Console: verklaring voor locatie op de achtergrond, met een
  korte video van de opnamefunctie.

## Wat er anders is in de eigen app

- **Abonnement.** Apple (App Review Guideline 3.1.1) en Google Play
  (Payments policy) eisen hun eigen betaalsysteem voor digitale
  abonnementen die in de app worden verkocht. De app verkoopt daarom niets
  en linkt niet naar de betaalpagina; wie Nexa Hybrid op de website heeft
  genomen, logt in en kan alles gebruiken (toegestaan als
  "multiplatform service", guideline 3.1.3(b)). Wilt u later in de app
  verkopen, dan is In-App Purchase / Play Billing nodig (Apple en Google
  houden 15–30% in) en moet de server die aankopen ook als abonnement
  herkennen. Uitzonderingen voor externe links (VS, EU onder de DMA) zijn in
  beweging; laat dat juridisch toetsen voordat u ze gebruikt.
- **Account verwijderen** kan in de app (Apple guideline 5.1.1(v)); de
  server staat daarvoor `cancel_now` vanuit de app toe.
- **Strava koppelen** opent de toestemmingspagina in de systeembrowser.
  Na toestemming komt de gebruiker op de website; terug in de app ververst
  het scherm Koppelingen vanzelf. Later te verbeteren met een eigen
  URL-schema (deep link) als terugkeeradres.
- **Inloggen met e-mail** werkt zoals op het web. Wachtwoordherstel-links
  openen de website; wilt u ze in de app laten openen, stel dan Universal
  Links / App Links in.

## App Store en Play Store

- Privacylabels (Apple) en Data safety (Google): locatie (alleen op het
  apparaat), gezondheid en fitness (gesynchroniseerd met het account),
  e-mail (account). Geen tracking, geen advertenties.
- Gezondheidsgegevens uit HealthKit mogen niet voor advertenties of
  datamakelaars gebruikt worden en niet in iCloud worden opgeslagen
  (guideline 5.1.3). Nexa neemt alleen drie getallen over in de check-in,
  op verzoek van de gebruiker.
- Leeftijdsclassificatie 4+ / Iedereen; categorie Gezondheid en fitness.
