// MW Lab service worker. Its scope is /market-widget/lab/ only, so it never touches the live MW.
// Offline shell, network first so updates always arrive (market data is never cached).
// The live MW's GitHub background checker (Web Push) is retired in the lab (R9): this worker has no push handler.
const CACHE = "mwlab-shell-v1";
const SHELL = ["./", "./index.html", "./app.js", "./engine.js", "./boot.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mwlab-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("/version.json") || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
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
