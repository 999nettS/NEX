// sw.js — caches the app shell, but network-first: always try the
// network for same-origin files first, and only fall back to cache when
// offline. Cache-first was causing real bugs — when several shell files
// change together in an update (e.g. index.html and app.js edited in the
// same deploy), cache-first could serve a stale mix of old-and-new files
// that don't agree with each other (an old app.js referencing a button
// the new index.html removed, for example), silently breaking the whole
// page. Network-first means you always get a consistent, current set of
// files whenever you have a connection; the cache is purely an offline
// fallback now, not a performance-first cache.
//
// Model weights are large binary shards fetched and cached by WebLLM
// itself (via the browser's Cache API / IndexedDB under the hood) — this
// service worker deliberately does not try to intercept or re-cache those.
const CACHE_VERSION = "nex-shell-v6";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./calc.js",
  "./tools.js",
  "./voice.js",
  "./extras.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cross-origin (CDN, APIs): always network, never cached here.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Same-origin app shell: network-first. Try the network so you always
  // get a current, internally-consistent set of files; cache a copy of
  // whatever succeeds; fall back to cache only when the network fails
  // (offline), so the app still opens without a connection.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
