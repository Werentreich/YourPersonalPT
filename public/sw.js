/* Twee pagina's om te cachen: de landingspagina (/) en de app (/app/).
   De app is één zelfstandig HTML-bestand (React, stijlen en logica inline).
   Elke navigatie gaat eerst naar het netwerk en valt zonder verbinding terug
   op de laatst opgeslagen versie van die pagina. Lettertypen en afbeeldingen
   van de landingspagina komen uit de gewone cache. */
const CACHE = "nexa-shell-v10";
const SHELL = ["/", "/app/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-512-maskable.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // externe bronnen met rust laten
  if (url.pathname.startsWith("/.netlify/")) return; // serverfuncties nooit uit de cache

  if (req.mode === "navigate") {
    const key = url.pathname === "/app" || url.pathname.startsWith("/app/") ? "/app/" : "/";
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => caches.match(key))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
