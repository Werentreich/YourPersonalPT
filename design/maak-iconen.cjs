/* Maakt de app-iconen van NEXA uit één vectorontwerp (nexa-icon.svg).
   Draaien: NODE_PATH=$(npm root -g) node design/maak-iconen.cjs
   Vereist Playwright met Chromium; dat is geen projectafhankelijkheid,
   omdat iconen zelden veranderen. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");

/* full: tegel vult het hele vlak (iOS en Android maskeren zelf de hoeken).
   scale: grootte van de staven ten opzichte van het ontwerp. */
function svg({ full = false, scale = 1, border = true } = {}) {
  const tile = full ? { x: 0, y: 0, w: 1024, h: 1024, r: 0 } : { x: 64, y: 64, w: 896, h: 896, r: 210 };
  const bw = 212, gap = 43, base = 770;
  const x0 = 512 - (3 * bw + 2 * gap) / 2;
  const bars = [
    { x: x0, h: 350, g: "b" },
    { x: x0 + bw + gap, h: 515, g: "g" },
    { x: x0 + 2 * (bw + gap), h: 300, g: "o" },
  ];
  const k = scale;
  const rect = (b, extra = "") =>
    `<rect x="${b.x}" y="${base - b.h}" width="${bw}" height="${b.h}" rx="44" fill="url(#${b.g})" ${extra}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#121725"/><stop offset="1" stop-color="#05070B"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.3" cy="0.05" r="0.9">
      <stop offset="0" stop-color="#2B4BFF" stop-opacity=".13"/><stop offset="1" stop-color="#2B4BFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warm" cx="0.95" cy="1" r="0.7">
      <stop offset="0" stop-color="#FFB020" stop-opacity=".16"/><stop offset="1" stop-color="#FFB020" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5B8CFF"/><stop offset=".5" stop-color="#2EE6A6"/><stop offset="1" stop-color="#FFB020"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4D86FF"/><stop offset="1" stop-color="#1E48F5"/></linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46F2BC"/><stop offset="1" stop-color="#0FBF86"/></linearGradient>
    <linearGradient id="o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD24D"/><stop offset="1" stop-color="#FFA114"/></linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>
    <clipPath id="clip"><rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" rx="${tile.r}"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="url(#bg)"/>
    <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="url(#shine)"/>
    <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="url(#warm)"/>
    <g transform="translate(512 512) scale(${k}) translate(-512 -512)">
      <g filter="url(#glow)" opacity=".45">${bars.map((b) => rect(b)).join("")}</g>
      ${bars.map((b) => rect(b)).join("")}
      ${bars.map((b) => `<rect x="${b.x + 18}" y="${base - b.h + 14}" width="${bw - 36}" height="6" rx="3" fill="#fff" opacity=".28"/>`).join("")}
    </g>
  </g>
  ${border && !full ? `<rect x="${tile.x + 3}" y="${tile.y + 3}" width="${tile.w - 6}" height="${tile.h - 6}" rx="${tile.r - 3}" fill="none" stroke="url(#edge)" stroke-width="6" opacity=".85"/>` : ""}
</svg>`;
}

(async () => {
  fs.writeFileSync(path.join(__dirname, "nexa-icon.svg"), svg());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = [
    // Android en browsers: afgeronde tegel met transparante hoeken
    { file: "public/icon-192.png", size: 192, opts: {}, transparent: true },
    { file: "public/icon-512.png", size: 512, opts: {}, transparent: true },
    // iOS rondt zelf af; transparantie wordt daar zwart, dus vol vlak
    { file: "public/icon-180.png", size: 180, opts: { full: true, scale: 1.08 }, transparent: false },
    // Android-maskeerbaar: alles binnen de veilige cirkel van 80 procent
    { file: "public/icon-512-maskable.png", size: 512, opts: { full: true, scale: 0.86 }, transparent: false },
    { file: "public/favicon-32.png", size: 32, opts: {}, transparent: true },
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
