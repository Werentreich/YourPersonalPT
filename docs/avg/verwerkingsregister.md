# Register van verwerkingsactiviteiten (AVG art. 30)

Verplicht voor Nexa: de uitzondering voor organisaties met minder dan 250
medewerkers geldt niet bij verwerking van gezondheidsgegevens (art. 30 lid 5).
Houd dit register bij; de Autoriteit Persoonsgegevens kan erom vragen.

**Verwerkingsverantwoordelijke:** [Bedrijfsnaam], [adres], KvK [nummer],
contact [privacy-e-mailadres]. Geen functionaris gegevensbescherming verplicht
(geen grootschalige verwerking als kernactiviteit van een overheid of
monitoring); heroverwegen bij grote groei.

Laatst bijgewerkt: 5 oktober 2026. Nexa Hybrid is opgegaan in Nexa; rij 8 t/m 13 gelden nu voor de prestatietraining in Nexa (kracht, hybride, hardlopen, conditie), bij het abonnement Nexa Coach.

| # | Verwerking | Doel | Categorieën betrokkenen | Persoonsgegevens | Grondslag | Ontvangers / verwerkers | Doorgifte buiten EER | Bewaartermijn | Beveiliging |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Account | Inloggen, account beheren | Gebruikers met account | E-mail, wachtwoord-hash, toestemmingsregistratie (datum, versie) | Overeenkomst (6.1.b) | Supabase (Frankfurt) | Supabase Inc. VS: SCC | Tot verwijdering account | RLS, bcrypt, HTTPS |
| 2 | Synchronisatie gezondheidsgegevens | Schema maken en tussen apparaten bewaren | Gebruikers met account | Gewicht, maten, vetpercentage, trainingen, herstelscore, voeding, profiel | Uitdrukkelijke toestemming (9.2.a) | Supabase (Frankfurt) | Supabase Inc. VS: SCC | Tot verwijdering account; back-ups ≤ 30 dagen | RLS (alleen eigen rijen), opslaglimieten, HTTPS |
| 3 | Abonnement | Nexa Coach leveren, betalen, opzeggen, herroepen | Abonnees | Status, plan, data, Stripe-ID's | Overeenkomst (6.1.b) | Stripe (Ierland), Supabase | Stripe Inc. VS: DPF/SCC | Bij Nexa tot verwijdering account | Alleen server schrijft (service role) |
| 4 | Facturen en betalingen | Boekhouding | Abonnees | Naam, e-mail, factuurgegevens, betaalmiddel (bij Stripe) | Wettelijke plicht (6.1.c) | Stripe | Stripe Inc. VS: DPF/SCC | 7 jaar (art. 52 AWR) | Stripe |
| 5 | Etiketscanner | Voedingswaarden van een foto aflezen | Gebruikers die scannen | Foto van etiket; gebruikers-ID en tijdstip voor quotum | Overeenkomst (6.1.b) | Anthropic (Claude API), Supabase | Anthropic VS: SCC | Foto: niet bij Nexa; quotum 1 dag | Login verplicht, 30 per dag |
| 6 | Serverlogs | Beveiliging, storingen | Bezoekers | IP-adres, tijd, URL, fouten | Gerechtvaardigd belang (6.1.f) | Netlify, Supabase | Netlify Inc. VS: DPF/SCC | Volgens Netlify/Supabase (kort) | Toegang alleen eigenaar |
| 8 | Nexa Hybrid: koppeling met Strava | Trainingen automatisch ophalen | Hybrid-abonnees die koppelen | Strava-sporter-ID, naam, toegangstokens; per activiteit sport, datum, tijd, afstand, hoogtemeters, hartslag (gemiddeld, maximaal, verdeling), vermogen. Geen GPS-route. | Uitdrukkelijke toestemming (9.2.a), apart gevraagd bij koppelen | Strava (bron), Supabase, Netlify | Strava Inc. VS: SCC/DPF; Supabase/Netlify zie boven | Tokens tot ontkoppelen of verwijdering account; postvak tot ophalen door de app, hoogstens 60 dagen | Tokens alleen voor de server (geen RLS-toegang), postvak alleen eigen rijen lezen/verwijderen, webhookberichten gecontroleerd bij Strava |
| 9 | Nexa Hybrid: routes uit bestanden | Route bij een geïmporteerde training tonen | Gebruikers die een bestand importeren | GPS-route (locatie) | Uitdrukkelijke toestemming (9.2.a) | Geen: alleen op het eigen apparaat, niet gesynchroniseerd | – | Tot verwijdering op het apparaat | Valt buiten de server |
| 10 | Nexa Hybrid: AI-coach | Weekanalyse en antwoorden op trainingsvragen | Hybrid-abonnees die de coach inschakelen | Afgeleide trainingscijfers (doel, fase, minuten, belasting, intensiteitsverdeling, naleving, herstelscores, recente trainingen zonder notities, krachtrecords), leeftijd, geslacht, gewicht, de gestelde vraag; gebruikers-ID en tijdstip voor quotum. Geen naam, e-mail, routes of Strava-gegevens. | Uitdrukkelijke toestemming (9.2.a), apart gevraagd in de app | Anthropic (Claude API), Supabase, Netlify | Anthropic VS: SCC | Bij Anthropic volgens de Commercial Terms (geen training, korte bewaartermijn voor misbruikcontrole); antwoorden op het eigen apparaat/account; quotum 1 dag | Login, Hybrid-abonnement, 20 per dag, invoer begrensd |
| 11 | Nexa Hybrid: live GPS-opname | Route, afstand en tempo tijdens een training | Gebruikers die opnemen | GPS-locatie tijdens de opname | Uitdrukkelijke toestemming (9.2.a) via de locatievraag van browser/telefoon | Geen: alleen op het eigen apparaat; de training zelf (zonder route) synchroniseert zoals rij 2 | – | Route tot verwijdering op het apparaat | Valt buiten de server |
| 12 | Nexa Hybrid: Apple Gezondheid / Health Connect | Check-in vooraf invullen | Gebruikers van de eigen app die dit aanzetten | HRV, rusthartslag, slaapuren van afgelopen nacht | Uitdrukkelijke toestemming (9.2.a) via de systeemvraag, per keer op verzoek | Na overnemen als check-in zoals rij 2 | Zie rij 2 | Zie rij 2 | Alleen lezen, alleen drie waarden; niet voor advertenties of in iCloud (Apple 5.1.3) |
| 13 | Nexa Hybrid: agenda-abonnement | Geplande trainingen in de eigen agenda (Google, Apple, Outlook) | Gebruikers die abonneren | Titel, datum, tijd, duur en opbouw van geplande trainingen; geen naam of e-mail in de agenda | Uitdrukkelijke toestemming (9.2.a) door zelf te abonneren; intrekbaar in de app | Netlify (levert de agenda), de gekozen agendadienst (Google, Apple, Microsoft) haalt de link op | Google/Apple/Microsoft VS: DPF/SCC (verwerker van de gebruiker zelf) | Bij Nexa niets extra opgeslagen; in de agenda tot de gebruiker het abonnement verwijdert | Ondertekende, intrekbare link (HMAC + versienummer); alleen met Hybrid-toegang |
| 14 | Gezin en coaching | Een coach (partner, gezinslid, trainer) stelt schema en voedingsdoel in en volgt de voortgang | Gekoppelde coaches en sporters | Namen die zij zelf invullen; per recht van de sporter: planinstellingen, voedingsdoel, geplande en gedane trainingen (zonder notities of routes), check-ins (zonder notities), gewicht van 90 dagen | Uitdrukkelijke toestemming van de sporter (9.2.a) per recht, bij het accepteren; altijd aan te passen of in te trekken (ontkoppelen) | Supabase (coach_links, coach_assignments, Edge Function team) | Geen buiten de EER | Koppeling tot ontkoppelen of verwijderen van een van beide accounts; opdrachten tot ontkoppelen | Alleen via de Edge Function team (service role); tabellen dicht voor de app; uitnodigingscode 8 tekens, 14 dagen geldig, eenmalig |
| 7 | Accountmails | Bevestigen, wachtwoord herstellen | Gebruikers met account | E-mail | Overeenkomst (6.1.b) | [SMTP-dienst] | [invullen] | Volgens SMTP-dienst | – |

**Niet verwerkt:** geen analytics, geen advertenties, geen tracking, geen
verkoop van gegevens, geen profilering met rechtsgevolgen (art. 22).

## Verwerkersovereenkomsten

| Partij | Hoe geregeld | Actie |
|---|---|---|
| Supabase | DPA via het Supabase-dashboard (Organization → Legal Documents) | Ondertekenen en opslaan |
| Netlify | DPA onderdeel van de voorwaarden (netlify.com/legal) | Downloaden en opslaan |
| Stripe | DPA onderdeel van de Stripe Services Agreement | Downloaden en opslaan |
| Anthropic | DPA onderdeel van de Commercial Terms | Downloaden en opslaan |
| Strava | Strava is bron, geen verwerker; de API Agreement regelt gebruik (alleen tonen aan de gebruiker, geen AI-training) | API Agreement accepteren bij het maken van de API-app; rate limits in de gaten houden |
| SMTP-dienst | Afhankelijk van de keuze | Regelen bij inrichten |

## DPIA

Een DPIA is verplicht bij grootschalige verwerking van gezondheidsgegevens.
Bij de start (kleine schaal) is die niet verplicht, maar wel verstandig;
voer er een uit zodra Nexa enkele duizenden gebruikers heeft, of eerder bij
nieuwe functies zoals koppelingen met Apple Health of cyclusregistratie.
