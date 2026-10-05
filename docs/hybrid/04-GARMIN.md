# Garmin (nog niet gebouwd)

Garmin-gebruikers kunnen nu al op twee manieren hun trainingen in Nexa Hybrid
krijgen:

1. **Via Strava.** Garmin Connect synchroniseert met Strava; de Strava-
   koppeling haalt ze binnen (fase 4).
2. **Als bestand.** Een `.fit`-bestand uit Garmin Connect importeren
   (Training vastleggen → Importeren uit bestand).

## Directe koppeling: Garmin Connect Developer Program

Een rechtstreekse koppeling loopt via het **Garmin Connect Developer
Program** (developer.garmin.com/gc-developer-program). Kenmerken:

- Alleen voor bedrijven, na goedkeuring door Garmin. Reken op enkele weken.
- **Activity API**: activiteiten (ook de FIT-bestanden) via push naar een
  eigen webhook, na OAuth-toestemming van de gebruiker.
- **Health API**: dagelijkse samenvattingen, slaap, HRV-status, rusthartslag,
  stress, Body Battery. Interessant voor de check-in (herstel).
- **Training API**: geplande trainingen naar het horloge sturen. Zo komt het
  weekschema van Nexa Hybrid op de pols.
- Garmin-huisstijlregels en een eigen merkovereenkomst.

## Inpassen in de bestaande opzet

De Strava-koppeling is zo gebouwd dat een tweede bron weinig werk is:

- `hybrid_integrations` krijgt `provider in ('strava','garmin')`.
- Een functie `garmin-auth` (OAuth) en `garmin-webhook` (push) op dezelfde
  manier als bij Strava; het postvak `hybrid_inbox` en het samenvoegen in de
  app (`src/hybrid/engine/inbox.js`) blijven gelijk. FIT-bestanden lezen kan
  al (`src/hybrid/import/files.js`).
- Herstelwaarden uit de Health API vullen de check-in vooraf, zoals nu al met
  Apple Gezondheid en Health Connect (`src/hybrid/native/health.js`).
- Let op de voorwaarden: net als bij Strava geen ruwe Garmin-gegevens naar
  AI-diensten zonder toestemming van Garmin; de coach krijgt alleen
  afgeleide cijfers en sluit gekoppelde bronnen uit (`fromStrava` in
  `src/hybrid/engine/coach.js` uitbreiden).

## Actie

Aanvraag indienen bij het Garmin Connect Developer Program met bedrijfs-
gegevens, beschrijving van de app en het privacybeleid.
