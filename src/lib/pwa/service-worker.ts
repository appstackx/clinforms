/**
 * The installable staff app's service worker (12/11/2026, tracker xt05): the routing rules as a PURE function, and the
 * worker's source built around that same function (src/app/clindesk-sw.js/route.ts serves it on the clinic brand's
 * hosts only). Tests: src/lib/pwa/pwa.test.ts runs the rules table and the generated workers in a sandbox.
 *
 * The one rule that matters: the worker NEVER stores a page, an API answer or anything else that can carry patient
 * data. It only keeps the app's static files (/_next/static – content-hashed, the same for every clinic – and the app
 * icons), and when a page inside /app cannot be fetched because the device is offline it answers with a small built-in
 * offline page ("You're offline – ClinDesk needs a connection"), never an earlier copy of the page.
 *
 *   static     GET, same origin, /_next/static/… or an app icon → from the worker's cache, else the network (then kept)
 *   navigate   a page load (mode "navigate"), GET, same origin, inside /app → always the network; offline → offline page
 *   passthrough everything else, untouched (the worker does not answer): server actions and form posts (POST), the
 *              app's data requests (RSC, fetch), /api, the analytics proxy /ingest, other origins (the payment pages,
 *              the media host), range requests, and every page outside /app (the public website, the sign-in pages)
 *
 * The worker is registered with scope /app (src/components/pwa/clinic-app.ts), so it never controls the public
 * website or the sign-in pages at all; the rules above hold for any request an /app page makes. Cookies are never
 * read or changed: requests the worker answers from the network are the browser's own request, sent as is.
 */

export type SwDecision = "static" | "navigate" | "passthrough";

export interface SwRequest {
  method: string;
  url: string;
  /** Request.mode ("navigate" for a page load). */
  mode: string;
  /** The worker's own origin (self.location.origin). */
  origin: string;
  /** Whether the request has a Range header (media) – never answered by the worker. */
  range?: boolean;
}

export interface SwConfig {
  /** Page loads inside this path are guarded by the offline page ("/app"). */
  scope: string;
  /** Path prefixes of the static, content-hashed build files ("/_next/static/"). */
  staticPrefixes: readonly string[];
  /** Exact paths of other static files the worker may keep (the app icons). */
  staticFiles: readonly string[];
  /** Path prefixes the worker never answers, whatever else matches (/api, /ingest). */
  neverPrefixes: readonly string[];
}

/**
 * The routing decision for one request. SELF-CONTAINED on purpose (no reference to anything outside its body): the
 * worker's source embeds this very function with Function.prototype.toString, so the tested code is the shipped code.
 */
export function decideFetch(req: SwRequest, cfg: SwConfig): SwDecision {
  if (!req || typeof req.method !== "string" || req.method.toUpperCase() !== "GET") return "passthrough";
  if (req.range) return "passthrough";
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "passthrough";
  }
  if (url.origin !== req.origin) return "passthrough";
  const path = url.pathname;
  for (const prefix of cfg.neverPrefixes) {
    if (path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) return "passthrough";
  }
  if (req.mode === "navigate") {
    return path === cfg.scope || path.startsWith(cfg.scope + "/") ? "navigate" : "passthrough";
  }
  for (const prefix of cfg.staticPrefixes) {
    if (path.startsWith(prefix)) return "static";
  }
  if (cfg.staticFiles.indexOf(path) !== -1 && url.search === "") return "static";
  return "passthrough";
}

/** The worker's file and its cache names. */
export const SERVICE_WORKER_PATH = "/clindesk-sw.js";
export const CACHE_PREFIX = "clindesk-static-";

/** The offline page's heading (the e2e and the tests look for it). */
export function offlineHeading(appName: string): string {
  return `You're offline – ${appName} needs a connection`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** The built-in offline page: no data, no script, no external file – it must work with no connection at all. */
export function offlinePageHtml(app: { name: string; themeColor: string; backgroundColor: string }): string {
  const name = escapeHtml(app.name);
  const heading = escapeHtml(offlineHeading(app.name));
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="${escapeHtml(app.themeColor)}"><meta name="robots" content="noindex, nofollow"><title>Offline · ${name}</title><style>html,body{margin:0;min-height:100%;background:${escapeHtml(app.backgroundColor)};color:#0f172a;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{box-sizing:border-box;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:calc(24px + env(safe-area-inset-top)) calc(24px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left));text-align:center}h1{margin:0;font-size:20px;font-weight:600;max-width:28ch}p{margin:0;color:#475569;max-width:36ch}a{display:inline-block;margin-top:8px;padding:10px 18px;border-radius:8px;background:#0B6B65;color:#fff;font-weight:600;text-decoration:none}a:focus-visible{outline:2px solid #0B6B65;outline-offset:3px}</style></head><body><main><h1>${heading}</h1><p>Nothing is stored on this device. Check your Wi-Fi or mobile data, then try again.</p><a href="">Try again</a></main></body></html>`;
}

/** The worker's configuration for an app (the icons it may keep). */
export function serviceWorkerConfig(icons: readonly string[]): SwConfig {
  return {
    scope: "/app",
    staticPrefixes: ["/_next/static/"],
    staticFiles: [...icons],
    neverPrefixes: ["/api", "/ingest"],
  };
}

/**
 * The worker's JavaScript. `version` names the cache (the deployment's commit, so a new deployment starts a clean cache
 * and the old one is deleted on activation); the icons are kept at install time, the build files as the app loads them.
 */
export function serviceWorkerSource(opts: {
  version: string;
  app: { name: string; themeColor: string; backgroundColor: string };
  icons: readonly string[];
}): string {
  const cfg = serviceWorkerConfig(opts.icons);
  const cacheName = CACHE_PREFIX + opts.version.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  return `/* ${opts.app.name} app – service worker. Keeps only static build files and icons; never pages or data. */
"use strict";
const CACHE = ${JSON.stringify(cacheName)};
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CONFIG = ${JSON.stringify(cfg)};
const PRECACHE = ${JSON.stringify(cfg.staticFiles)};
const OFFLINE_HTML = ${JSON.stringify(offlinePageHtml(opts.app))};
const decideFetch = ${decideFetch.toString()};

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

async function fromCacheOrNetwork(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only a complete, same-origin answer is kept (never an error, a redirect – followed or not – or an opaque answer).
  if (response.ok && response.status === 200 && response.type === "basic" && !response.redirected) {
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return offlineResponse();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { credentials: "omit" })).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const decision = decideFetch(
    { method: request.method, url: request.url, mode: request.mode, origin: self.location.origin, range: request.headers.has("range") },
    CONFIG,
  );
  if (decision === "static") event.respondWith(fromCacheOrNetwork(request));
  else if (decision === "navigate") event.respondWith(networkOrOffline(request));
  // "passthrough": no respondWith – the browser handles the request exactly as without a worker.
});
`;
}

/**
 * The self-removing worker (the kill switch – docs/production-architecture.md §9): served at the worker's URL on a host
 * that once had the app when the app is switched off (CLINFORMS_PWA=off, or the brand's installableApp removed). A
 * browser checks the worker's URL on every visit inside /app (and at least daily), installs this one in place of the
 * app's, and on activation it takes over the open pages, deletes every cache the app's worker made, unregisters itself
 * and reloads those pages from the network. It answers no request (no fetch handler).
 */
export function serviceWorkerKillSource(): string {
  return `/* Removes the installed app's service worker and its caches from this device. */
"use strict";
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim().catch(() => {});
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => {})));
    })(),
  );
});
`;
}
