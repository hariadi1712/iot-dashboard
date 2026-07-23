/* P² LABS PWA service worker — v10
   Strategi diperbaiki supaya update mulus (tidak perlu clear cache manual):
   - index.html & app.js  : NETWORK-FIRST. Selalu coba server dulu; cache
     hanya dipakai saat offline. Ini yang bikin versi baru langsung kepasang.
   - Aset statis (logo, ikon, manifest): cache-first (jarang berubah).
   - /api/* : SELALU network-only, TIDAK pernah di-cache. Data kontrol/
     telemetry harus real-time; cache di sini berbahaya (status pompa/tangki
     basi). Ini disengaja. */
const CACHE = "p2labs-shell-v10";

const STATIC = [
  "/assets/logo.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // API: network-only
  if (url.pathname.startsWith("/api/")) return;

  const isAppShell =
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.startsWith("/assets/app.js");

  if (isAppShell) {
    // NETWORK-FIRST
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp.ok && url.origin === location.origin) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html")))
    );
    return;
  }

  // Aset statis: cache-first
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request).then((resp) => {
        if (resp.ok && url.origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
    )
  );
});
