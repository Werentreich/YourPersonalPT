# Datalekprocedure

Een datalek is elke inbreuk waarbij persoonsgegevens verloren gaan, of in
handen komen van iemand die ze niet mag zien. Bij Nexa gaat het vaak om
gezondheidsgegevens; die wegen zwaar.

## Binnen 1 uur: indammen

1. Wat is er gebeurd, sinds wanneer, welke gegevens, hoeveel gebruikers?
2. Lek dichten: sleutels roteren (Supabase: API keys en JWT secret;
   Stripe: secret key en webhook secret; Anthropic: API key), in Netlify
   bijwerken en opnieuw deployen. Zo nodig de site tijdelijk offline halen.
3. Bewijs bewaren: Supabase-logs (Logs Explorer), Netlify-functielogs,
   Stripe-dashboard.

## Binnen 72 uur: melden aan de Autoriteit Persoonsgegevens

Verplicht, tenzij het lek waarschijnlijk geen risico oplevert. Bij
gezondheidsgegevens is er vrijwel altijd risico.
Melden via het meldloket op autoriteitpersoonsgegevens.nl. Kunt u nog niet
alles vertellen, meld dan wat u weet en vul later aan.

## Zonder onnodige vertraging: gebruikers informeren

Verplicht bij een hoog risico (bijvoorbeeld uitgelekte gezondheidsgegevens
of wachtwoorden). In duidelijke taal: wat er gebeurde, welke gegevens, wat
Nexa doet en wat de gebruiker zelf kan doen (wachtwoord wijzigen).

## Altijd: registreren

Elk datalek, ook als het niet gemeld hoeft te worden, in het logboek
hieronder (AVG art. 33 lid 5).

| Datum | Wat | Gegevens en aantal | Gemeld aan AP? | Gebruikers geïnformeerd? | Maatregelen |
|---|---|---|---|---|---|
| | | | | | |
