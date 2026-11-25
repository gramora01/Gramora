const CACHE_NAME = "gramora-shell-v222-performance";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=182",
  "./script.js?v=8",
  "./auth.js?v=284",
  "./auth.css?v=63",
  "./story-creator.css?v=31",
  "./story-creator.js?v=22",
  "./gramora-icons.css?v=2",
  "./post-action-spacing.css?v=1",
  "./public-profile-layout.css?v=3",
  "./gramora-3d-ui.css?v=2",
  "./gramora-onboarding.css?v=1",
  "./gramora-icons.js?v=10",
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
    const isNavigation = request.mode === "navigate";
    const isStaticAsset = ["script", "style", "image", "font"].includes(request.destination);
    const cached = await caches.match(request);

    // Versioned scripts/styles/images are cache-first for instant repeat opens.
    // A background refresh keeps the shell current without blocking rendering.
    if (!isNavigation && isStaticAsset && cached) {
      fetch(request).then(fresh => {
        if (fresh && fresh.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, fresh));
      }).catch(() => {});
      return cached;
    }

    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (error) {
      if (cached) return cached;
      if (isNavigation) return (await caches.match("./index.html")) || Response.error();
      return Response.error();
    }
  })());
});
