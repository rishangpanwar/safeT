/*
 * SafeT Command service worker.
 *  - Pages: network first, falling back to the last cached copy, then to /offline.html.
 *  - Hashed build assets (/_next/static) and icons: cache first (they never change in place).
 *  - Live data (/api, /socket.io) is never cached: a stale vital sign is worse than none.
 * Registered with ?dev=1 under `next dev`, where only the offline fallback is cached, so hot
 * reload keeps working.
 */
const VERSION = "safet-v2"; // PwaContext.tsx writes to `${VERSION}-assets` too
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const DEV = new URL(self.location.href).searchParams.has("dev");
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, CDNs: browser default
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Clone now: once the page starts reading the body, a later clone() throws.
          if (!DEV && res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/offline.html")))
    );
    return;
  }

  if (!DEV && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
