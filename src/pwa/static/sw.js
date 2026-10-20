/* eslint-disable no-undef */

/**
 * Offline shell cache.
 *
 * Examination data never passes through here — it lives in IndexedDB. This
 * only makes the app itself start without a network, which is the difference
 * between usable and useless in a clinic with bad wifi.
 */

// Replaced at build time with the build id. A fresh value on every build is
// what makes the browser see a byte-changed worker, re-install it, and drop
// the previous cache — without it a redeploy would never reach installed apps.
const BUILD = self.__BUILD_ID__ || "dev";
// Every app on jakob-sajovic.github.io shares one CacheStorage, so this app
// names its caches with its own prefix and only ever deletes those.
const CACHE_PREFIX = "dentalexam-platform-pwa-";
const CACHE = CACHE_PREFIX + BUILD;

// Filled in at build time with the emitted asset names.
const SHELL = self.__SHELL_FILES__ || ["./"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a redeploy is picked up, cache as the fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // Everything else: cache first, filling the cache as we go.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
