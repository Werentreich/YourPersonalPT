/* Regressietest voor dist/app/index.html (de app): laadt het bestand in een
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
const file = path.join(dir, "dist/app/index.html");
if (!fs.existsSync(file)) {
  console.error("dist/app/index.html ontbreekt. Draai eerst: npm run build");
  process.exit(1);
}
/* Laadt één app-pagina in jsdom en geeft de tekst, het document en de
   fouten terug. */
async function boot(file, url) {
  const html = fs.readFileSync(file, "utf8");
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url,
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
  return { html, doc, rootText, errors };
}

const { html, doc, rootText, errors } = await boot(file, "https://nexa-performance.netlify.app/app/");

const checks = [
  ["exact één groot en één klein <script>-blok", (html.match(/<script>[\s\S]*?<\/script>/g) || []).length === 2],
  ["React heeft gemount (#root heeft inhoud)", (doc.getElementById("root")?.children.length || 0) > 0],
  ["app-titel zichtbaar", /Nexa/.test(rootText)],
  ["tabbalk zichtbaar", /Vandaag/.test(rootText) && /Profiel/.test(rootText)],
  ["geen crash-melding", !/Er ging iets mis/.test(rootText)],
  ["ontwerpsysteem-CSS geladen (--accent aanwezig)", [...doc.querySelectorAll("style")].some((s) => s.textContent.includes("--accent"))],
  ["geen fouten tijdens uitvoeren", errors.length === 0],
];

/* Nexa Hybrid (dist/hybrid/index.html): zelfde controles, eigen merk. */
const hybridFile = path.join(dir, "dist/hybrid/index.html");
if (!fs.existsSync(hybridFile)) {
  checks.push(["Hybrid: dist/hybrid/index.html aanwezig", false]);
} else {
  const h = await boot(hybridFile, "https://nexa-performance.netlify.app/hybrid/");
  checks.push(
    ["Hybrid: exact één groot en één klein <script>-blok", (h.html.match(/<script>[\s\S]*?<\/script>/g) || []).length === 2],
    ["Hybrid: React heeft gemount", (h.doc.getElementById("root")?.children.length || 0) > 0],
    ["Hybrid: woordmerk zichtbaar", /nexa hybrid/.test(h.rootText)],
    ["Hybrid: tabbalk zichtbaar", ["Vandaag", "Week", "Log", "Voortgang", "Profiel"].every((t) => h.rootText.includes(t))],
    ["Hybrid: geen crash-melding", !/Er ging iets mis/.test(h.rootText)],
    ["Hybrid: eigen merkkleuren geladen (--ember)", [...h.doc.querySelectorAll("style")].some((s) => s.textContent.includes("--ember"))],
    ["Hybrid: eigen titel en manifest", /<title>Nexa Hybrid<\/title>/.test(h.html) && h.html.includes("/hybrid.webmanifest")],
    [`Hybrid: geen fouten tijdens uitvoeren${h.errors.length ? " (" + h.errors.join(" | ") + ")" : ""}`, h.errors.length === 0]
  );
}

/* Landingspagina (dist/index.html): statisch, dus alleen controleren of hij
   er is, naar de app verwijst en of alle bestanden waarnaar hij verwijst
   bestaan. */
const landingFile = path.join(dir, "dist/index.html");
const landing = fs.existsSync(landingFile) ? fs.readFileSync(landingFile, "utf8") : "";
const assetRefs = [...landing.matchAll(/\/assets\/[^"'?#\s,)]+/g)].map((m) => m[0]);
const missing = [...new Set(assetRefs)].filter((r) => !fs.existsSync(path.join(dir, "dist", r)));
checks.push(
  ["landingspagina aanwezig met kop", /<h1[\s>]/.test(landing)],
  ["landingspagina verwijst naar de app", landing.includes('href="/app/')],
  [`alle bestanden van de landingspagina bestaan${missing.length ? ` (ontbreekt: ${missing.join(", ")})` : ""}`, assetRefs.length > 0 && missing.length === 0]
);

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
