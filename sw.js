const CACHE_NAME = "facility-pro-v23";

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
  // [BUG FIX] Was missing from this list, which left a hole in offline
  // coverage: Login.js calls into it during boot, so a cold first load
  // with no connection had no data layer at all. It only seemed to work
  // because the same-origin handler below runtime-caches whatever it
  // successfully fetches — so anyone who had loaded the app online once
  // was covered by accident rather than by design.
  "./drive-sync.js",
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

// [CLEANUP] An API_ENDPOINTS list and a network-first-with-cache branch
// for script.google.com used to live here. Its own audit note said the
// branch could never run, because back then every API call was a POST
// and the handler bails out on non-GET above — but that note went stale
// the moment mobile started reading its snapshot over a plain GET
// through the Apps Script proxy. The branch quietly became live code.
//
// It's removed rather than fixed, for two reasons. First, caching that
// response here would duplicate the offline copy drive-sync.js already
// keeps in localStorage, giving two caches that can disagree about
// which snapshot is current. Second, the Cache API refuses to store a
// response that arrived via a redirect in some browsers (Safari in
// particular, which matters — this is a phone app), and every Apps
// Script /exec response is a redirect to script.googleusercontent.com.
// So the branch would have failed on exactly the devices it mattered
// most for, while looking fine in testing on Chrome.
//
// Requests to the proxy now pass straight through to the network,
// untouched. drive-sync.js owns the offline story for that data.
const SNAPSHOT_PROXY_HOST = "script.google.com";

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

  // Snapshot proxy: not ours to handle. Letting it fall through means
  // drive-sync.js sees the real network outcome — a genuine failure it
  // can answer from its own localStorage copy, rather than a synthetic
  // 503 from here that it would have to interpret.
  if (url.hostname.includes(SNAPSHOT_PROXY_HOST)) {
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
