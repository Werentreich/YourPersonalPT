/* Bouwt de site naar dist/: de landingspagina op / (uit landing/) en de
   PWA op /app/ (uit src/App.jsx). Voor de app vier stappen:
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
import { createHash } from "node:crypto";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

mkdirSync("dist/app", { recursive: true });

run("npx tailwindcss -i ./build-input.css -o ./dist/tailwind.css --minify");
run(
  'npx esbuild ./build-entry.jsx --bundle --minify --format=iife --target=es2019 ' +
  '--define:process.env.NODE_ENV=\\"production\\" --outfile=./dist/app.js'
);

for (const f of ["manifest.webmanifest", "sw.js", "icon-180.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "favicon-32.png", "robots.txt", "404.html", "_redirects", "_headers"]) {
  copyFileSync(`public/${f}`, `dist/${f}`);
}

// landingspagina: statische HTML met eigen lettertypen en schermafbeeldingen
copyFileSync("landing/index.html", "dist/index.html");
cpSync("landing/fonts", "dist/assets/fonts", { recursive: true });
cpSync("landing/img", "dist/assets/img", { recursive: true });

// privacyverklaring en voorwaarden: gedeelde kop + eigen inhoud
const legalHead = readFileSync("landing/legal-head.html", "utf8");
for (const page of ["privacy", "voorwaarden"]) {
  mkdirSync(`dist/${page}`, { recursive: true });
  writeFileSync(`dist/${page}/index.html`, `<!doctype html>\n<html lang="nl">\n<head>\n${legalHead}${readFileSync(`landing/${page}/body.html`, "utf8")}`);
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
<title>Nexa</title>
<meta name="description" content="Nexa · Your personal performance coach">
<meta name="theme-color" content="#EEF0F4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#08090C" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Nexa">
<link rel="manifest" href="/manifest.webmanifest?v=nexa3">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=nexa1">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=nexa1">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=nexa1">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png?v=nexa1">
<link rel="preload" href="/assets/fonts/barlow-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/barlow-condensed-700.woff2" as="font" type="font/woff2" crossorigin>
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

writeFileSync("dist/app/index.html", html);
console.log(`dist/app/index.html geschreven, ${Math.round(html.length / 1024)} kB`);

/* Content-Security-Policy per pagina. Inline scripts worden toegestaan via
   hun SHA-256-hash, dus alleen precies deze code mag draaien; een
   geïnjecteerd script wordt door de browser geweigerd. Stijlen blijven
   inline toegestaan (React zet style-attributen). Elke build rekent de
   hashes opnieuw uit. */
const hashes = (file) =>
  [...readFileSync(file, "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`
  );
const csp = (scripts, connect) =>
  [
    "default-src 'self'",
    `script-src 'self' ${scripts.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${connect ? " " + connect : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
const SUPABASE = "https://lrtkedstyhfnwaxylyue.supabase.co";
const rules = [
  ["/app/*", csp(hashes("dist/app/index.html"), SUPABASE)],
  ["/", csp(hashes("dist/index.html"))],
  ["/index.html", csp(hashes("dist/index.html"))],
  ...["privacy", "voorwaarden"].filter((p) => existsSync(`dist/${p}/index.html`)).map((p) => [`/${p}/*`, csp(hashes(`dist/${p}/index.html`))]),
];
writeFileSync(
  "dist/_headers",
  readFileSync("dist/_headers", "utf8").trimEnd() +
    "\n\n# Content-Security-Policy, gegenereerd door build.mjs\n" +
    rules.map(([path, v]) => `${path}\n  Content-Security-Policy: ${v}`).join("\n\n") +
    "\n"
);
