// sw.js — caches the app shell only. Model weights are large binary
// shards fetched and cached by WebLLM itself (via the browser's Cache API
// / IndexedDB under the hood) — this service worker deliberately does not
// try to intercept or re-cache those.
//
// CACHE_VERSION must be bumped on every deploy that changes any shell
// file, or returning users can get stuck on stale HTML/CSS/JS.
const CACHE_VERSION = "nex-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./calc.js",
  "./tools.js",
  "./voice.js",
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

  // Never cache the WebLLM CDN module or model weight requests — always
  // go to the network so a redeploy of the app can't get pinned to an
  // incompatible cached runtime version.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // App shell: cache-first, falling back to network, so the shell still
  // loads offline after the first successful visit.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
