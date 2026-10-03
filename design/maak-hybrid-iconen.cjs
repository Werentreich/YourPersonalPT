/* Maakt de app-iconen van Nexa Hybrid uit één vectorontwerp (hybrid-icon.svg).
   Draaien: NODE_PATH=$(npm root -g) node design/maak-hybrid-iconen.cjs
   Vereist Playwright met Chromium (geen projectafhankelijkheid).

   Ontwerp (docs/hybrid/01-MERK.md): warm houtskool, een zware rechte lijn in
   gloed (kracht) die een golvende hoogtelijn in getij (duur) kruist, met een
   lichtpunt op het kruispunt. Subtiele hoogtelijnen op de achtergrond. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");

function svg({ full = false, scale = 1 } = {}) {
  const tile = full ? { x: 0, y: 0, w: 1024, h: 1024, r: 0 } : { x: 64, y: 64, w: 896, h: 896, r: 210 };
  const contours = Array.from({ length: 9 }, (_, i) => {
    const y = 150 + i * 92;
    const a = 26 + ((i * 7) % 5) * 9;
    return `<path d="M0 ${y} C 220 ${y - a}, 380 ${y + a}, 560 ${y - a / 2} S 860 ${y + a}, 1024 ${y}" fill="none" stroke="#5CC6BD" stroke-opacity=".07" stroke-width="5"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#22201C"/><stop offset="1" stop-color="#0E0D0B"/>
    </linearGradient>
    <radialGradient id="warm" cx="0.15" cy="1" r="0.8">
      <stop offset="0" stop-color="#E07650" stop-opacity=".14"/><stop offset="1" stop-color="#E07650" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cool" cx="0.95" cy="0" r="0.8">
      <stop offset="0" stop-color="#5CC6BD" stop-opacity=".12"/><stop offset="1" stop-color="#5CC6BD" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ember" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#C95A36"/><stop offset="1" stop-color="#F29872"/>
    </linearGradient>
    <linearGradient id="tide" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3FB3AA"/><stop offset="1" stop-color="#7FD9D0"/>
    </linearGradient>
    <radialGradient id="spark"><stop offset="0" stop-color="#FFF6EC"/><stop offset=".45" stop-color="#FFF6EC" stop-opacity=".55"/><stop offset="1" stop-color="#FFF6EC" stop-opacity="0"/></radialGradient>
    <clipPath id="clip"><rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" rx="${tile.r}"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="url(#bg)"/>
    <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="url(#warm)"/>
    <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="url(#cool)"/>
    ${contours}
    <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
      <path d="M170 512 C 255 512, 285 392, 362 392 S 462 512, 512 512 S 585 632, 662 632 S 769 512, 854 512" fill="none" stroke="url(#tide)" stroke-width="62" stroke-linecap="round"/>
      <path d="M300 812 L 724 212" fill="none" stroke="url(#ember)" stroke-width="104" stroke-linecap="round"/>
      <circle cx="512" cy="512" r="64" fill="url(#spark)"/>
    </g>
  </g>
</svg>`;
}

(async () => {
  fs.writeFileSync(path.join(__dirname, "hybrid-icon.svg"), svg());
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const out = [
    { file: "public/hybrid-icon-192.png", size: 192, opts: {}, transparent: true },
    { file: "public/hybrid-icon-512.png", size: 512, opts: {}, transparent: true },
    { file: "public/hybrid-icon-180.png", size: 180, opts: { full: true, scale: 1.06 }, transparent: false },
    { file: "public/hybrid-icon-512-maskable.png", size: 512, opts: { full: true, scale: 0.84 }, transparent: false },
    { file: "public/hybrid-favicon-32.png", size: 32, opts: {}, transparent: true },
  ];
  for (const o of out) {
    await page.setViewportSize({ width: o.size, height: o.size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(o.opts).replace('width="1024" height="1024"', `width="${o.size}" height="${o.size}"`)}</body></html>`
    );
    await page.screenshot({ path: path.join(ROOT, o.file), omitBackground: o.transparent, clip: { x: 0, y: 0, width: o.size, height: o.size } });
    console.log("geschreven:", o.file);
  }
  await browser.close();
})();
