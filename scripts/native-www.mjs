/* Webmap voor de eigen app (Capacitor) van Nexa Hybrid.

   Gebruik: npm run build && npm run native:www
   Daarna:  npx cap sync   (zie docs/hybrid/03-NATIVE.md)

   Neemt dist/hybrid/index.html (alles al ingebakken) en de iconen en
   lettertypen, en maakt de adressen relatief: de app laadt vanaf
   capacitor://localhost (iOS) of https://localhost (Android), niet vanaf de
   site. Geen service worker en geen manifest: de winkel-app werkt het bij. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from "node:fs";

const OUT = "native/www";
if (!existsSync("dist/hybrid/index.html")) {
  console.error("Eerst npm run build.");
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets/fonts`, { recursive: true });

let html = readFileSync("dist/hybrid/index.html", "utf8");
html = html
  .replace(/<link rel="manifest"[^>]*>\n?/, "")
  .replace(/navigator\.serviceWorker\.register\('\/sw\.js'\)/, "Promise.resolve()")
  .replace(/(href|src)="\/(?!\/)/g, '$1="./')
  .replace(/url\(\/assets\//g, "url(./assets/");
if (/(href|src)="\/[a-z]/i.test(html)) console.warn("Let op: nog absolute adressen in index.html");
writeFileSync(`${OUT}/index.html`, html);

for (const f of readdirSync("dist/assets/fonts")) copyFileSync(`dist/assets/fonts/${f}`, `${OUT}/assets/fonts/${f}`);
for (const f of readdirSync("public").filter((f) => f.startsWith("hybrid-") && f.endsWith(".png"))) copyFileSync(`public/${f}`, `${OUT}/${f}`);
console.log(`${OUT} klaar (${Math.round(html.length / 1024)} kB)`);
