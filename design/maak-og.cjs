/* Deelafbeelding (Open Graph, 1200x630) voor de landingspagina.
   Vereist een draaiende server op dist/ (zie maak-schermen.cjs):
     NODE_PATH=$(npm root -g) node design/maak-og.cjs
   Schrijft landing/img/og.jpg. */
const { chromium } = require("playwright");
const path = require("path");
const B = "http://localhost:8765";
const html = `<!doctype html><html><head><style>
@font-face{font-family:"Barlow";src:url(${B}/assets/fonts/barlow-500.woff2) format("woff2");font-weight:500}
@font-face{font-family:"Barlow Condensed";src:url(${B}/assets/fonts/barlow-condensed-700.woff2) format("woff2");font-weight:700}
*{box-sizing:border-box}html,body{margin:0}
body{width:1200px;height:630px;background:#08090C;color:#F1F3F7;font-family:"Barlow",sans-serif;position:relative;overflow:hidden}
.glow{position:absolute;right:-120px;top:-160px;width:720px;height:720px;border-radius:50%;background:radial-gradient(circle,rgba(43,75,255,.35),rgba(43,75,255,0) 65%)}
.txt{position:absolute;left:72px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:500;margin-bottom:34px}
h1{font-family:"Barlow Condensed",sans-serif;font-weight:700;text-transform:uppercase;font-size:104px;line-height:.92;margin:0}
p{font-size:30px;color:#9AA1AE;margin:30px 0 0}
.phone{position:absolute;right:88px;top:64px;width:330px;height:714px;border-radius:48px;padding:10px;background:#0B0D11;box-shadow:inset 0 0 0 2px #2B303B,0 40px 80px -20px rgba(0,0,0,.8)}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:38px;display:block}
</style></head><body><div class="glow"></div>
<div class="txt"><div class="brand"><svg width="44" height="31" viewBox="0 0 20 14"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4D86FF"/><stop offset="1" stop-color="#1E48F5"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46F2BC"/><stop offset="1" stop-color="#0FBF86"/></linearGradient><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD24D"/><stop offset="1" stop-color="#FFA114"/></linearGradient></defs><rect x="0" y="4" width="6" height="10" rx="1.6" fill="url(#a)"/><rect x="7" y="0" width="6" height="14" rx="1.6" fill="url(#b)"/><rect x="14" y="5.5" width="6" height="8.5" rx="1.6" fill="url(#c)"/></svg>Nexa</div>
<h1>Uw schema.<br>Elke week<br>bijgestuurd.</h1><p>Voeding en training in één app. 7 dagen gratis.</p></div>
<div class="phone"><img src="${B}/assets/img/vandaag-donker.jpg"></div></body></html>`;
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
  // eerst naar de eigen server, zodat lettertypen van dezelfde herkomst komen
  await page.goto(B + "/robots.txt");
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, "..", "landing", "img", "og.jpg"), type: "jpeg", quality: 86 });
  await b.close();
  console.log("og.jpg klaar");
})();
