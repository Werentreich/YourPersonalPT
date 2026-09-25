# Macroverdeling

Trainingsgerichte macro- en voedingsschemaplanner, in het Nederlands, als
installeerbare PWA. Berekent calorieën en macro's per dag op basis van
lichaamsgegevens, training en doel; verdeelt die over maaltijden en porties;
en ondersteunt meerwekenplannen voor cutten, bulken en minicuts.

**Live:** https://macroverdeling.netlify.app

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
`dist/index.html` van ongeveer 350 kB, met alles inline (React, stijlen,
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
