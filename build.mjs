/* Bouwt de PWA vanuit src/App.jsx naar dist/. Vier stappen:
   1. Tailwind-utility-klassen compileren op basis van wat App.jsx gebruikt
   2. React + App.jsx bundelen en minifiëren tot één script
   3. Iconen en service worker naar dist/ kopiëren
   4. Alles samenvoegen tot één zelfstandig dist/index.html, met
      PWA-koppelingen (manifest, iconen) en de service worker-registratie

   Let op bij punt 4: gebruik nooit een kale string.replace('</body>', ...)
   op het samengestelde bestand. De afdrukfunctie in de app bouwt zelf een
   stukje HTML-tekst op die toevallig ook "</body>" bevat; een blinde
   vervanging raakt dan ook die tekst midden in de gebundelde code en
   breekt de hele pagina. Voeg nieuwe code daarom altijd toe via het
   laatste voorkomen (rfind), zoals hieronder.
*/
import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

mkdirSync("dist", { recursive: true });

run("npx tailwindcss -i ./build-input.css -o ./dist/tailwind.css --minify");
run(
  'npx esbuild ./build-entry.jsx --bundle --minify --format=iife --target=es2019 ' +
  '--define:process.env.NODE_ENV=\\"production\\" --outfile=./dist/app.js'
);

for (const f of ["manifest.webmanifest", "sw.js", "icon-180.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png"]) {
  copyFileSync(`public/${f}`, `dist/${f}`);
}

const css = readFileSync("dist/tailwind.css", "utf8");
const js = readFileSync("dist/app.js", "utf8");

const swReg = `
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
</script>
`;

let html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Macroverdeling</title>
<meta name="description" content="Voedingsschema, macro's en porties, afgestemd op uw training.">
<meta name="theme-color" content="#EEF0F4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#08090C" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Macro's">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>${css}
html,body{margin:0;min-height:100%;background:#EEF0F4}
@media (prefers-color-scheme: dark){html:not([data-theme="light"]),html:not([data-theme="light"]) body{background:#08090C}}
:root[data-theme="dark"],:root[data-theme="dark"] body{background:#08090C}
:root{box-sizing:border-box}
body{-webkit-tap-highlight-color:transparent;overscroll-behavior-y:none}
</style>
</head>
<body>
<div id="root"></div>
<noscript>Deze app heeft JavaScript nodig.</noscript>
<script>${js}</script>
</body>
</html>
`;

// service worker-registratie invoegen bij het LAATSTE </body>, nooit een
// blinde vervang-alles: zie de toelichting bovenaan dit bestand
const last = html.lastIndexOf("</body>");
html = html.slice(0, last) + swReg + html.slice(last);

writeFileSync("dist/index.html", html);
console.log(`dist/index.html geschreven, ${Math.round(html.length / 1024)} kB`);
