const CACHE_NAME = "facility-pro-v16";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./Core.js",
  "./Login.js",
  "./Init.js",
  "./Records.js",
  "./Modals-core.js",
  "./Modals-forms.js",
  "./pdf.js",
  "./Reports.js",
  "./manifest.json",
  "./logo.png",
  // [BUG FIX] The desktop shell (used by the Electron wrapper) was never
  // precached, so it silently fell out of offline coverage — the service
  // worker's same-origin handler still falls back to it correctly on
  // repeat visits (whatever the browser/Electron happened to cache on
  // its own), but a first-run offline load of desktop.html would have
  // 503'd instead of serving the app shell like index.html does.
  "./desktop.html",
  "./desktop.css",
  "./desktop.js",
];

// Cross-origin endpoints that need network-first strategy
// [AUDIT NOTE] This branch (and API_ENDPOINTS below) never actually
// runs: the fetch handler bails out for any non-GET request before
// reaching this check, and every API call this app makes uses POST
// (see Core.js's callApi / pdf.js's generatePDF fetch) — including
// reads like getApartments, which are POST actions with a JSON body,
// not GET requests. Left in place rather than removed because the
// real offline-fallback-for-reads logic already lives in Core.js's
// callApi() (localStorage, keyed per action name) — extending this
// Service Worker to cache POST bodies correctly would need a custom
// cache key derived from the request body's `action` field, since the
// Cache API keys by URL by default and every action hits the same
// GAS_URL — not worth the added complexity/risk when an equivalent,
// simpler fallback already exists and works.
const API_ENDPOINTS = ["script.google.com"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("SW: Opened cache and caching local App Shell");
      return cache.addAll(STATIC_ASSETS);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("SW: Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  // Skip non-HTTP(S) requests
  if (!url.protocol.startsWith("http")) {
    return;
  }

  // Check if this is an API call (cross-origin)
  const isApiCall = API_ENDPOINTS.some((endpoint) =>
    url.hostname.includes(endpoint),
  );

  if (isApiCall) {
    // Network-first strategy for API calls with offline fallback
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Cache successful API responses for offline reading
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          console.log(
            "SW: API network failed, serving from cache:",
            event.request.url,
          );
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline JSON response for API calls
            return new Response(
              JSON.stringify({
                status: "error",
                message: "Offline - No cached data available",
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          });
        }),
    );
    return;
  }

  // Same-origin requests: Network-first, falling back to cache when offline.
  // (Online users always get the current file; the cache only matters when
  // navigator.onLine is false or the request fails.)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === "basic" || networkResponse.type === "cors")
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            const contentLength = networkResponse.headers.get("content-length");
            if (!contentLength || parseInt(contentLength) < 5 * 1024 * 1024) {
              cache.put(event.request, responseToCache);
            }
          });
        }
        return networkResponse;
      })
      .catch(() => {
        console.log(
          "SW: Network failed, serving from cache for",
          event.request.url,
        );
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === "navigate") {
            // [BUG FIX] This used to always fall back to index.html (the
            // mobile shell), even when the failed navigation was for
            // desktop.html — so an offline first-load of the desktop
            // shell would silently serve the wrong app. Fall back to
            // whichever shell was actually being navigated to.
            const isDesktopNav = new URL(event.request.url).pathname.endsWith(
              "desktop.html",
            );
            return caches.match(isDesktopNav ? "./desktop.html" : "./index.html");
          }
          return new Response("Offline - Resource not available", {
            status: 503,
            statusText: "Service Unavailable",
          });
        });
      }),
  );
});
