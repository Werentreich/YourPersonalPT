/* Web of eigen app (Capacitor)?

   In de eigen app draait de webcode vanaf capacitor://localhost (iOS) of
   https://localhost (Android). Relatieve adressen als /.netlify/functions/…
   bestaan daar niet; dan gaat alles naar de echte site. De functies staan
   die herkomsten toe (netlify/lib/origin.mjs). */
export const SITE = "https://nexa-performance.netlify.app";

export function cap() {
  return typeof window !== "undefined" && window.Capacitor ? window.Capacitor : null;
}

export function isNative() {
  const c = cap();
  return !!(c && (typeof c.isNativePlatform === "function" ? c.isNativePlatform() : c.isNative));
}

export function platform() {
  const c = cap();
  return c && typeof c.getPlatform === "function" ? c.getPlatform() : "web";
}

/* Plugin uit de eigen app, of null op het web / als hij ontbreekt. */
export function plugin(name) {
  const c = cap();
  return (isNative() && c && c.Plugins && c.Plugins[name]) || null;
}

/* Adres van een serverfunctie. */
export const fnUrl = (name) => `${isNative() ? SITE : ""}/.netlify/functions/${name}`;

/* Externe pagina openen (Strava-toestemming, Stripe): in de app via de
   systeembrowser, op het web in hetzelfde venster. */
export async function openExternal(url) {
  const b = plugin("Browser");
  if (b && typeof b.open === "function") return b.open({ url });
  location.href = url;
}
