// MW service worker. The same file serves the beta (scope /market-widget/lab/) and, after labdev/promote.mjs,
// the regular MW (scope /market-widget/), which leaves everything under lab/ to the beta's own worker.
// Offline shell, network first so updates always arrive (market data is never cached).
// The old GitHub background checker (Web Push) is retired (R9): this worker has no push handler.
const SCOPE = new URL(self.registration.scope).pathname, BETA = /\/lab\/$/.test(SCOPE);
const PREFIX = BETA ? "mwlab-shell-" : "mw-shell-", CACHE = PREFIX + "4.3.0";
const SHELL = ["./", "./index.html", "./app.js", "./engine.js", "./boot.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("/version.json") || !url.pathname.startsWith(SCOPE)) return;
  if (!BETA && url.pathname.startsWith(SCOPE + "lab/")) return;   // the beta is not this worker's business
  e.respondWith(fetch(e.request).then(r => { if (r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
