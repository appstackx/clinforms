/**
 * The installable staff app (12/11/2026, tracker xt05): the manifest per brand host, the installability criteria, the
 * service worker's routing rules (the pure function AND the generated worker, run in a sandbox) and the install hint.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { BRANDS, brandForHost } from "../brand";
import { APP_ICONS, APP_SCOPE, APP_START_URL, MANIFEST_PATH, installabilityProblems, webAppManifest } from "./manifest";
import {
  CACHE_PREFIX,
  SERVICE_WORKER_PATH,
  decideFetch,
  offlineHeading,
  offlinePageHtml,
  serviceWorkerConfig,
  serviceWorkerSource,
  type SwConfig,
  type SwDecision,
} from "./service-worker";
import { INSTALL_HINT_DISMISSED, INSTALL_HINT_KEY, installHintFor, isIosSafari, readDismissed, writeDismissed } from "./install-hint";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("web app manifest per brand host", () => {
  it("ClinDesk's hosts: name, start page, scope, standalone, the brand's colours and the mark's icons", () => {
    for (const host of ["clindesk.co.uk", "www.clindesk.co.uk", "clinic.localhost:3000"]) {
      const m = webAppManifest(brandForHost(host));
      assert.ok(m, host);
      assert.equal(m.name, "ClinDesk");
      assert.equal(m.short_name, "ClinDesk");
      assert.equal(m.start_url, "/app/clinic");
      assert.equal(m.id, "/app/clinic");
      assert.equal(m.scope, "/app");
      assert.equal(m.display, "standalone");
      assert.equal(m.theme_color, BRANDS.clinic.themeColor);
      assert.equal(m.theme_color, "#C4432B");
      assert.equal(m.background_color, "#FBF4E8");
      assert.equal(m.lang, "en-GB");
      assert.deepEqual(
        m.icons.map((i) => `${i.src} ${i.sizes} ${i.purpose}`),
        ["/clindesk/app/icon-192.png 192x192 any", "/clindesk/app/icon-512.png 512x512 any", "/clindesk/app/icon-maskable-512.png 512x512 maskable"],
      );
      assert.ok(!/clin\s*forms/i.test(JSON.stringify(m)), "never names ClinForms");
    }
  });
  it("ClinForms' hosts (and unknown hosts) advertise no app", () => {
    for (const host of ["clinforms.co.uk", "www.clinforms.co.uk", "localhost:3000", "127.0.0.1", "clinforms-abc.vercel.app", "", null]) {
      assert.equal(webAppManifest(brandForHost(host)), null, String(host));
    }
    assert.equal(BRANDS.clinforms.installableApp, null);
  });
  it("installable as far as the manifest goes (Lighthouse's installable-manifest criteria)", () => {
    assert.deepEqual(installabilityProblems(webAppManifest(BRANDS.clinic)), []);
    assert.ok(APP_START_URL.startsWith(APP_SCOPE));
    // The checker itself catches what it should.
    const m = webAppManifest(BRANDS.clinic)!;
    assert.deepEqual(installabilityProblems({ ...m, icons: m.icons.filter((i) => i.purpose !== "maskable") }), ["maskable 512x512 PNG icon"]);
    assert.deepEqual(installabilityProblems({ ...m, start_url: "/login" }), ["start_url outside scope"]);
    assert.deepEqual(installabilityProblems({ ...m, display: "browser" as never }), ["display"]);
    assert.deepEqual(installabilityProblems(null), ["no manifest"]);
  });
  it("the icon files exist as PNGs of the stated size (rendered from the ClinDesk mark)", () => {
    const files = [...APP_ICONS.map((i) => ({ src: i.src, size: Number(i.sizes.split("x")[0]) })), { src: BRANDS.clinic.icons!.apple, size: 180 }];
    for (const { src, size } of files) {
      const buf = readFileSync(join(ROOT, "public", src));
      assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", src);
      assert.equal(buf.readUInt32BE(16), size, `${src} width`);
      assert.equal(buf.readUInt32BE(20), size, `${src} height`);
    }
  });
  it("wired only through the brand: the clinic layout links the manifest when the brand has an app; CSP allows it", () => {
    const layout = read("src/app/app/clinic/layout.tsx");
    assert.match(layout, /currentBrand\(\)\.installableApp/);
    assert.match(layout, /manifest: MANIFEST_PATH/);
    assert.match(layout, /viewportFit: "cover"/);
    assert.match(layout, /installableApp=\{brand\.installableApp !== null\}/);
    assert.equal(MANIFEST_PATH, "/clindesk.webmanifest");
    assert.match(read("src/app/clindesk.webmanifest/route.ts"), /webAppManifest\(currentBrand\(\)\)/);
    assert.match(read("src/app/clindesk-sw.js/route.ts"), /if \(!brand\.installableApp\) return new Response\("Not found", \{ status: 404/);
    const config = read("next.config.mjs");
    assert.match(config, /"manifest-src": \["'self'"\]/);
    assert.match(config, /"worker-src": \["'self'", "blob:"\]/);
    // Neither file sits behind the /app sign-in redirect (browsers fetch a manifest without cookies).
    const mw = read("src/middleware.ts");
    assert.ok(!mw.includes(MANIFEST_PATH) && !mw.includes(SERVICE_WORKER_PATH));
    assert.ok(!MANIFEST_PATH.startsWith("/app/") && !SERVICE_WORKER_PATH.startsWith("/app/"));
  });
});

const ORIGIN = "https://clindesk.co.uk";
const CFG: SwConfig = serviceWorkerConfig(APP_ICONS.map((i) => i.src));

/** [method, url, mode, expected] – the rules table. */
const TABLE: [string, string, string, SwDecision, boolean?][] = [
  // Static build files and the icons: kept.
  ["GET", `${ORIGIN}/_next/static/chunks/app/app/clinic/page-abc123.js`, "no-cors", "static"],
  ["GET", `${ORIGIN}/_next/static/css/1234.css`, "no-cors", "static"],
  ["GET", `${ORIGIN}/_next/static/media/inter.woff2`, "cors", "static"],
  ["GET", `${ORIGIN}/clindesk/app/icon-192.png`, "no-cors", "static"],
  ["GET", `${ORIGIN}/clindesk/app/icon-maskable-512.png`, "no-cors", "static"],
  // Pages inside /app: network, offline page when offline – never a stored copy.
  ["GET", `${ORIGIN}/app/clinic`, "navigate", "navigate"],
  ["GET", `${ORIGIN}/app/clinic/patients/p_123`, "navigate", "navigate"],
  ["GET", `${ORIGIN}/app`, "navigate", "navigate"],
  ["GET", `${ORIGIN}/app/settings/billing?done=1`, "navigate", "navigate"],
  // Never touched.
  ["POST", `${ORIGIN}/app/clinic/patients/p_123`, "navigate", "passthrough"], // form post / server action without JS
  ["POST", `${ORIGIN}/app/clinic/diary`, "cors", "passthrough"], // server action
  ["GET", `${ORIGIN}/app/clinic/patients/p_123?_rsc=1x`, "cors", "passthrough"], // the app's data request (RSC)
  ["GET", `${ORIGIN}/app/clinic/letters/l_1/file`, "cors", "passthrough"],
  ["GET", `${ORIGIN}/api/reports/v1/health`, "cors", "passthrough"],
  ["GET", `${ORIGIN}/api/auth/get-session`, "cors", "passthrough"],
  ["GET", `${ORIGIN}/api/anything`, "navigate", "passthrough"],
  ["POST", `${ORIGIN}/ingest/e/`, "cors", "passthrough"], // analytics proxy
  ["GET", `${ORIGIN}/ingest/static/array.js`, "no-cors", "passthrough"],
  ["GET", `${ORIGIN}/ingest/decide`, "cors", "passthrough"],
  ["GET", `${ORIGIN}/`, "navigate", "passthrough"], // the public website
  ["GET", `${ORIGIN}/pricing`, "navigate", "passthrough"],
  ["GET", `${ORIGIN}/login?next=%2Fapp%2Fclinic`, "navigate", "passthrough"],
  ["GET", `${ORIGIN}/two-factor`, "navigate", "passthrough"],
  ["GET", `${ORIGIN}/apple-touch-icon.png`, "navigate", "passthrough"], // prefix /app but not inside /app
  ["GET", `${ORIGIN}/application`, "navigate", "passthrough"],
  ["GET", `${ORIGIN}/clinics/riverside/book`, "navigate", "passthrough"], // patient-facing pages
  ["GET", `https://checkout.stripe.com/c/pay/cs_test_1`, "navigate", "passthrough"], // payment pages
  ["GET", `https://media.clinforms.co.uk/demo/x.mp4`, "no-cors", "passthrough"],
  ["GET", `https://evil.example/_next/static/x.js`, "no-cors", "passthrough"],
  ["GET", `${ORIGIN}/_next/image?url=%2Fx.png&w=64&q=75`, "no-cors", "passthrough"],
  ["GET", `${ORIGIN}/clindesk/app/icon-192.png?v=2`, "no-cors", "passthrough"],
  ["GET", `${ORIGIN}/clindesk.webmanifest`, "cors", "passthrough"],
  ["GET", `${ORIGIN}/clindesk-sw.js`, "no-cors", "passthrough"],
  ["GET", `${ORIGIN}/app/clinic/patients/p_1/export.csv`, "same-origin", "passthrough"],
  ["HEAD", `${ORIGIN}/_next/static/x.js`, "no-cors", "passthrough"],
  ["GET", `${ORIGIN}/_next/static/media/clip.mp4`, "no-cors", "passthrough", true], // range request
  ["GET", "not a url", "navigate", "passthrough"],
];

describe("service worker routing rules", () => {
  it("the rules table (pure function)", () => {
    for (const [method, url, mode, expected, range] of TABLE) {
      assert.equal(decideFetch({ method, url, mode, origin: ORIGIN, range }, CFG), expected, `${method} ${url} (${mode})`);
    }
  });
  it("the function the worker embeds is self-contained and decides the same", () => {
    const embedded = new Function(`"use strict"; return (${decideFetch.toString()});`)() as typeof decideFetch;
    for (const [method, url, mode, expected, range] of TABLE) {
      assert.equal(embedded({ method, url, mode, origin: ORIGIN, range }, CFG), expected, `${method} ${url}`);
    }
  });
  it("only /_next/static and the icons are ever eligible for the cache", () => {
    assert.deepEqual(CFG.staticPrefixes, ["/_next/static/"]);
    assert.deepEqual(CFG.staticFiles, APP_ICONS.map((i) => i.src));
    assert.deepEqual(CFG.neverPrefixes, ["/api", "/ingest"]);
    assert.equal(CFG.scope, "/app");
  });
  it("the offline page: the heading, no script, no external file, no data", () => {
    const html = offlinePageHtml({ name: "ClinDesk", themeColor: "#C4432B", backgroundColor: "#FBF4E8" });
    assert.equal(offlineHeading("ClinDesk"), "You're offline – ClinDesk needs a connection");
    assert.ok(html.includes("You&#39;re offline – ClinDesk needs a connection"));
    assert.ok(!/<script|src=|https?:\/\//i.test(html));
    assert.ok(!/clin\s*forms/i.test(html));
    assert.ok(offlinePageHtml({ name: "<x>", themeColor: "#000", backgroundColor: "#fff" }).includes("&lt;x&gt;"));
  });
});

/* ------------------------------------------------------------------ the generated worker, run in a sandbox */
type Listener = (event: unknown) => void;
interface FakeRequest {
  method: string;
  url: string;
  mode: string;
  headers: Headers;
}
function sandbox() {
  const listeners: Record<string, Listener[]> = {};
  const stores = new Map<string, Map<string, Response>>();
  let online = true;
  const network: string[] = [];
  const key = (r: FakeRequest | Request | string) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: FakeRequest) => m.get(key(r))?.clone(),
      put: async (r: FakeRequest, res: Response) => void m.set(key(r), res),
      add: async (r: Request) => {
        const res = await fakeFetch(r as unknown as FakeRequest);
        m.set(key(r), res);
      },
    };
  };
  async function fakeFetch(r: FakeRequest | Request): Promise<Response> {
    network.push(r.url);
    if (!online) throw new TypeError("Failed to fetch");
    const path = new URL(r.url).pathname;
    if (path.startsWith("/app")) return new Response("<h1>Megan Hart (fictional) – patient record</h1>", { headers: { "content-type": "text/html", "cache-control": "private, no-store" } });
    const res = new Response(`body of ${path}`, { status: 200 });
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => Array.from(stores.keys()),
    delete: async (name: string) => stores.delete(name),
  };
  // A worker resolves relative URLs against its own location; Node's Request does not, so the sandbox's does.
  const SwRequest = class extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, ORIGIN), init);
    }
  };
  const context = vm.createContext({ self, caches, fetch: fakeFetch, Response, Request: SwRequest, URL, Headers, Promise, console });
  const source = serviceWorkerSource({ version: "abc123", app: { name: "ClinDesk", themeColor: "#C4432B", backgroundColor: "#FBF4E8" }, icons: CFG.staticFiles });
  vm.runInContext(source, context);
  const dispatch = async (type: string) => {
    const waits: Promise<unknown>[] = [];
    for (const fn of listeners[type] ?? []) fn({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const request = async (method: string, path: string, mode: string, headers: Record<string, string> = {}) => {
    let answered = null as Promise<Response> | null;
    const req: FakeRequest = { method, url: new URL(path, ORIGIN).href, mode, headers: new Headers(headers) };
    for (const fn of listeners.fetch ?? []) fn({ request: req, respondWith: (p: Promise<Response>) => (answered = p) });
    return answered ? await answered : null; // null = passthrough (the browser fetches it itself)
  };
  return { source, stores, network, dispatch, request, setOnline: (v: boolean) => (online = v) };
}

describe("the generated service worker (sandboxed)", () => {
  it("install keeps the icons only; activate deletes older ClinDesk caches and nothing else", async () => {
    const sw = sandbox();
    sw.stores.set(`${CACHE_PREFIX}old`, new Map());
    sw.stores.set("someone-else", new Map());
    await sw.dispatch("install");
    await sw.dispatch("activate");
    assert.deepEqual(Array.from(sw.stores.keys()).sort(), [`${CACHE_PREFIX}abc123`, "someone-else"]);
    assert.deepEqual(Array.from(sw.stores.get(`${CACHE_PREFIX}abc123`)!.keys()).map((u) => new URL(u).pathname), CFG.staticFiles);
  });
  it("a visited patient page is never stored; offline it is the offline page, not the page", async () => {
    const sw = sandbox();
    await sw.dispatch("install");
    const online = await sw.request("GET", "/app/clinic/patients/sim-pat-001", "navigate");
    assert.ok(online && (await online.text()).includes("Megan Hart"));
    await sw.request("GET", "/_next/static/chunks/main-1.js", "no-cors");
    const stored = Array.from(sw.stores.values()).flatMap((m) => Array.from(m.keys())).map((u) => new URL(u).pathname);
    assert.ok(stored.every((p) => p.startsWith("/_next/static/") || CFG.staticFiles.includes(p)), stored.join(", "));
    assert.ok(stored.includes("/_next/static/chunks/main-1.js"));
    sw.setOnline(false);
    const offline = await sw.request("GET", "/app/clinic/patients/sim-pat-001", "navigate");
    assert.ok(offline);
    assert.equal(offline.status, 503);
    assert.equal(offline.headers.get("cache-control"), "no-store");
    const body = await offline.text();
    assert.ok(body.includes("You&#39;re offline – ClinDesk needs a connection"));
    assert.ok(!body.includes("Megan Hart"));
    // The build file still comes from the cache offline.
    const chunk = await sw.request("GET", "/_next/static/chunks/main-1.js", "no-cors");
    assert.equal(await chunk!.text(), "body of /_next/static/chunks/main-1.js");
  });
  it("leaves server actions, data requests, /api, /ingest, other origins and the public website alone", async () => {
    const sw = sandbox();
    const untouched: [string, string, string, Record<string, string>?][] = [
      ["POST", "/app/clinic/diary", "cors", { "next-action": "abc" }],
      ["GET", "/app/clinic?_rsc=1", "cors", { rsc: "1" }],
      ["POST", "/ingest/e/", "cors"],
      ["GET", "/api/auth/get-session", "cors"],
      ["GET", "/", "navigate"],
      ["GET", "/login", "navigate"],
      ["GET", "https://checkout.stripe.com/c/pay/x", "navigate"],
      ["GET", "/_next/static/media/v.mp4", "no-cors", { range: "bytes=0-" }],
    ];
    for (const [method, path, mode, headers] of untouched) assert.equal(await sw.request(method, path, mode, headers), null, `${method} ${path}`);
    assert.deepEqual(sw.network, []);
    assert.ok(!sw.source.includes("cookie"), "the worker never reads or writes cookies");
  });
});

describe("install hint", () => {
  const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
  const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
  const IPHONE_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS]";
  const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  it("iOS Safari only (iPadOS's Mac user agent with touch counts; Chrome for iOS and web views do not)", () => {
    assert.equal(isIosSafari(IPHONE_SAFARI), true);
    assert.equal(isIosSafari(IPAD_DESKTOP, 5), true);
    assert.equal(isIosSafari(IPAD_DESKTOP, 0), false); // a real Mac
    assert.equal(isIosSafari(IPHONE_CHROME), false);
    assert.equal(isIosSafari(IPHONE_WEBVIEW), false);
    assert.equal(isIosSafari(ANDROID_CHROME), false);
  });
  it("which hint", () => {
    const base = { userAgent: ANDROID_CHROME, maxTouchPoints: 5, standalone: false, canPrompt: false, dismissed: false };
    assert.equal(installHintFor(base), null);
    assert.equal(installHintFor({ ...base, canPrompt: true }), "browser");
    assert.equal(installHintFor({ ...base, userAgent: IPHONE_SAFARI }), "ios");
    assert.equal(installHintFor({ ...base, canPrompt: true, standalone: true }), null);
    assert.equal(installHintFor({ ...base, userAgent: IPHONE_SAFARI, dismissed: true }), null);
  });
  it("dismissal is remembered; storage errors never throw", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    assert.equal(readDismissed(storage), false);
    assert.equal(writeDismissed(storage), true);
    assert.equal(mem.get(INSTALL_HINT_KEY), INSTALL_HINT_DISMISSED);
    assert.equal(readDismissed(() => storage), true);
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    assert.equal(readDismissed(broken), false);
    assert.equal(writeDismissed(broken), false);
    assert.equal(
      readDismissed(() => {
        throw new Error("blocked");
      }),
      false,
    );
    assert.equal(writeDismissed(null), false);
  });
});
