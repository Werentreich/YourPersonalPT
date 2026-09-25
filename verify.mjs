/* Regressietest voor dist/index.html: laadt het bestand in een
   browserachtige omgeving (jsdom) en controleert dat de app echt opstart.
   Dit is precies de controle die een eerdere versie miste: die versie
   compileerde foutloos maar toonde bij het openen alleen onopgemaakte,
   zwarte tekst doordat een string.replace('</body>', ...) per ongeluk ook
   een tekstfragment middenin de gebundelde JavaScript raakte. Draai dit na
   elke wijziging aan build.mjs met: npm run verify
*/
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, "dist/index.html");
if (!fs.existsSync(file)) {
  console.error("dist/index.html ontbreekt. Draai eerst: npm run build");
  process.exit(1);
}
const html = fs.readFileSync(file, "utf8");

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://nexa-performance.netlify.app/",
  beforeParse(w) {
    w.scrollTo = () => {};
    w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    let n = 0;
    w.requestAnimationFrame = (cb) => (n++ > 300 ? 0 : setTimeout(() => cb(Date.now()), 1));
    w.cancelAnimationFrame = (id) => clearTimeout(id);
    w.fetch = () => Promise.reject(new Error("geen netwerk in deze test"));
    w.addEventListener("error", (e) => errors.push((e.message || String(e.error)).slice(0, 200)));
  },
});
await new Promise((r) => setTimeout(r, 1200));

const doc = dom.window.document;
const rootText = (doc.getElementById("root")?.textContent || "").replace(/\s+/g, " ");

const checks = [
  ["exact één groot en één klein <script>-blok", (html.match(/<script>[\s\S]*?<\/script>/g) || []).length === 2],
  ["React heeft gemount (#root heeft inhoud)", (doc.getElementById("root")?.children.length || 0) > 0],
  ["app-titel zichtbaar", /Nexa/.test(rootText)],
  ["tabbalk zichtbaar", /Vandaag/.test(rootText) && /Profiel/.test(rootText)],
  ["geen crash-melding", !/Er ging iets mis/.test(rootText)],
  ["ontwerpsysteem-CSS geladen (--accent aanwezig)", [...doc.querySelectorAll("style")].some((s) => s.textContent.includes("--accent"))],
  ["geen fouten tijdens uitvoeren", errors.length === 0],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log((pass ? "OK  " : "FOUT") + " " + label);
  if (!pass) ok = false;
}
if (!ok) {
  errors.forEach((e) => console.log("  *", e));
  process.exit(1);
}
console.log("\nAlles gecontroleerd, de build werkt.");
// timers van de inlogbibliotheek (sessieverversing) houden anders het proces open
process.exit(0);
