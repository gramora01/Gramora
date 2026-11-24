const CACHE_NAME = "gramora-shell-v147-story-editors";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=164",
  "./script.js?v=74",
  "./auth.js?v=253",
  "./auth.css?v=62",
  "./story-creator.css?v=6",
  "./story-creator.js?v=5",
  "./gramora-icons.css?v=2",
  "./post-action-spacing.css?v=1",
  "./public-profile-layout.css?v=2",
  "./gramora-icons.js?v=8",
  "./gramora-layout-fix.css?v=1",
  "./icons/gramora.svg",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept Firebase, Google, or other cross-origin requests.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return (await caches.match("./index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});
