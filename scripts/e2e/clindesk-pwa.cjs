/**
 * The installable staff app (12/11/2026, tracker xt05) in a real browser, LOCAL only: own `next start` (PORT, default
 * 3417) on a throwaway SQLite database, the seeded demonstration clinic (fictional data), the owner signed in on the
 * clinic brand's host clinic.localhost. Sign-in as scripts/e2e/journey-clindesk-only.cjs / clinic-shell-billing-nav.cjs.
 *
 *   M  ClinDesk host: the clinic area links the manifest, iOS home-screen tags, viewport-fit=cover; the manifest's
 *      installability fields (Lighthouse's installable-manifest criteria) and every icon answers as a PNG
 *   W  ClinDesk host: the service worker registers with scope /app and controls the clinic area
 *   F  ClinForms host (localhost): no manifest, no worker file, no link, no registration; ClinDesk's public site and
 *      sign-in page link no manifest either
 *   O  offline: a page inside /app shows the offline page; a VISITED patient record is never served from a cache –
 *      offline it is the offline page, not the record; static build files are the only things cached
 *   I  "Install the app" in the account menu when the browser offers to install (simulated beforeinstallprompt);
 *      "Don't show this again" is remembered; iOS Safari gets the Share → Add to Home Screen steps
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/clindesk-pwa.cjs
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3417);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "clindesk-pwa");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-pwa-"));
const DB_FILE = path.join(TMP, "e2e.db");
const OWNER = "owner@riverside-demo.example.com";
const OFFLINE = "You're offline – ClinDesk needs a connection";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const rnd = (n = 24) => crypto.randomBytes(n).toString("base64url");
const SECRETS = {
  BETTER_AUTH_SECRET: `test-only-${rnd(32)}`,
  CLINFORMS_DATA_KEYS: JSON.stringify({ t1: crypto.randomBytes(32).toString("base64") }),
  CLINFORMS_DATA_KEY_ID: "t1",
  MEDREPORT_LAUNCH_SECRET: `test-only-launch-${rnd(16)}`,
  MEDREPORT_SIGNING_SECRET: `test-only-signing-${rnd(16)}`,
  MEDREPORT_PARTNER_KEY: `test-only-partner-${rnd(16)}`,
  TM3_SIM_TOKEN: `test-only-sim-${rnd(16)}`,
  CRON_SECRET: `test-only-cron-${rnd(16)}`,
};
const users = {};
const results = [];
const pages = [];
async function check(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    results.push({ id, what, pass: false, error: String(err && err.message ? err.message : err).slice(0, 800) });
    console.log(`FAIL ${id} ${what}: ${String(err && err.message ? err.message : err).slice(0, 800)}`);
    for (const [who, page] of pages) await page.screenshot({ path: path.join(OUT, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}

function appEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    ...SECRETS,
    NODE_ENV: "production",
    PORT: String(PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: FORMS,
    CLINFORMS_AUTH_ORIGINS: DESK,
    APP_ORIGIN: DESK,
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
    CLINFORMS_PLATFORM_ADMINS: OWNER,
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
  };
}
let server = null;
let serverLog = "";
async function startServer() {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: appEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${FORMS}/api/reports/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not come up");
}
function stopChild(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // gone
  }
}
/**
 * A GET without cookies, with the Host header of the URL (Node does not resolve *.localhost, so it connects to 127.0.0.1).
 * Returns { status, headers, text }.
 */
function get(url) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: u.port, path: u.pathname + u.search, method: "GET", headers: { host: u.host } }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}
/**
 * Offline for real: the browser's offline switch (context.setOffline) does not reliably reach a service worker's own
 * fetches in Chromium, so the server is stopped too – every request the worker makes then fails, as with no connection.
 */
async function goOffline(ctx) {
  await ctx.setOffline(true);
  stopChild(server);
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      await get(`${FORMS}/api/reports/v1/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not stop");
}
async function goOnline(ctx) {
  await ctx.setOffline(false);
  await startServer();
}

/* ------------------------------------------------------------------ TOTP + sign-in (as clinic-shell-billing-nav.cjs) */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(key, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", base32Decode(key)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function freshCode(email) {
  for (;;) {
    if (30000 - (Date.now() % 30000) > 3000) return totp(users[email].key);
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  }
}
async function acceptInvite(page, link, email, name) {
  const origin = new URL(link).origin;
  users[email] = { password: `e2e ${rnd(12)} password` };
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", name);
  await page.fill("#f-password", users[email].password);
  await page.fill("#f-confirm", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  users[email].key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.origin === origin && u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
}

/** The page's PWA tags. */
const headFacts = (page) =>
  page.evaluate(() => ({
    manifest: document.querySelector("link[rel=manifest]")?.getAttribute("href") ?? null,
    capable: document.querySelector("meta[name=apple-mobile-web-app-capable]")?.getAttribute("content") ?? null,
    statusBar: document.querySelector("meta[name=apple-mobile-web-app-status-bar-style]")?.getAttribute("content") ?? null,
    appleTitle: document.querySelector("meta[name=apple-mobile-web-app-title]")?.getAttribute("content") ?? null,
    appleIcon: document.querySelector("link[rel=apple-touch-icon]")?.getAttribute("href") ?? null,
    viewport: document.querySelector("meta[name=viewport]")?.getAttribute("content") ?? null,
    theme: document.querySelector("meta[name=theme-color]")?.getAttribute("content") ?? null,
  }));
const registrations = (page) =>
  page.evaluate(async () => ("serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) : ["(no serviceWorker API)"]));

/** Lighthouse's installable-manifest criteria, checked on the served manifest (the same list as src/lib/pwa/manifest.ts). */
function installabilityProblems(m) {
  const problems = [];
  if (!m.name && !m.short_name) problems.push("name");
  if (!m.start_url) problems.push("start_url");
  if (!["standalone", "fullscreen", "minimal-ui"].includes(m.display)) problems.push("display");
  if (!String(m.start_url).startsWith(m.scope || "/")) problems.push("start_url outside scope");
  const png = (size, purpose) => (m.icons || []).some((i) => i.type === "image/png" && i.sizes.split(" ").includes(size) && (i.purpose || "any").split(" ").includes(purpose));
  if (!png("192x192", "any")) problems.push("192 icon");
  if (!png("512x512", "any")) problems.push("512 icon");
  if (!png("512x512", "maskable")) problems.push("maskable icon");
  if (!m.theme_color || !m.background_color) problems.push("colours");
  return problems;
}

/** A beforeinstallprompt like Chrome's (headless Chromium never fires its own). */
const fakeInstallPrompt = (page) =>
  page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    window.__promptShown = 0;
    e.prompt = async () => {
      window.__promptShown += 1;
    };
    e.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(e);
  });
async function openMenu(page) {
  const button = page.locator("button[aria-haspopup=menu]");
  await button.click();
  const menu = page.locator("[role=menu][aria-label=Account]");
  await menu.waitFor();
  return menu;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newContext = async (who, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB", timezoneId: "Europe/London", ...opts });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    pages.push([who, page]);
    return { ctx, page };
  };
  try {
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "10"], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    await startServer();
    const { ctx, page: owner } = await newContext("owner");

    await check("S1", "the owner joins on the ClinDesk host (seeded demonstration clinic, fictional)", async () => {
      assert(ownerLink && new URL(ownerLink).origin === DESK, "owner link on the ClinDesk host");
      await acceptInvite(owner, ownerLink, OWNER, "Helen Ward (fictional)");
    });

    await check("M1", "ClinDesk host: the clinic area links the manifest; iOS home-screen tags; viewport-fit=cover", async () => {
      await owner.goto(`${DESK}/app/clinic`);
      const f = await headFacts(owner);
      assert.equal(f.manifest, "/clindesk.webmanifest", JSON.stringify(f));
      assert.equal(f.capable, "yes");
      assert.equal(f.statusBar, "default");
      assert.equal(f.appleTitle, "ClinDesk");
      assert.equal(f.appleIcon, "/clindesk/apple-touch-icon.png");
      assert.match(f.viewport || "", /viewport-fit=cover/);
      assert.equal(f.theme, "#C4432B");
      return JSON.stringify(f);
    });

    await check("M2", "the manifest: ClinDesk, /app/clinic in scope /app, standalone, installable fields; icons are PNGs", async () => {
      const res = await get(`${DESK}/clindesk.webmanifest`); // no cookies, as a browser fetches it
      assert.equal(res.status, 200);
      assert.match(res.headers["content-type"] || "", /^application\/manifest\+json/);
      const m = JSON.parse(res.text);
      assert.equal(m.name, "ClinDesk");
      assert.equal(m.short_name, "ClinDesk");
      assert.equal(m.start_url, "/app/clinic");
      assert.equal(m.scope, "/app");
      assert.equal(m.display, "standalone");
      assert.equal(m.theme_color, "#C4432B");
      assert.deepEqual(installabilityProblems(m), []);
      assert.ok(!/clin\s*forms/i.test(JSON.stringify(m)));
      for (const icon of [...m.icons.map((i) => i.src), "/clindesk/apple-touch-icon.png"]) {
        const r = await get(`${DESK}${icon}`);
        assert.equal(r.status, 200, icon);
        assert.equal(r.headers["content-type"], "image/png", icon);
      }
      // Chrome's own view of the manifest (the DevTools "Application → Manifest" data).
      const cdp = await ctx.newCDPSession(owner);
      const app = await cdp.send("Page.getAppManifest");
      assert.equal((app.errors || []).length, 0, JSON.stringify(app.errors));
      const installable = await cdp.send("Page.getInstallabilityErrors").catch(() => null);
      await cdp.detach();
      const errs = installable ? installable.installabilityErrors.map((e) => e.errorId) : [];
      return `Chrome manifest errors: 0; installability errors: ${errs.length ? errs.join(", ") : "none"}`;
    });

    await check("W1", "the service worker registers with scope /app and controls the clinic area", async () => {
      await owner.goto(`${DESK}/app/clinic`);
      const reg = await owner.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return { scope: r.scope, script: r.active && r.active.scriptURL };
      });
      assert.equal(reg.scope, `${DESK}/app`);
      assert.equal(reg.script, `${DESK}/clindesk-sw.js`);
      await owner.reload();
      await owner.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const sw = await get(`${DESK}/clindesk-sw.js`);
      assert.equal(sw.status, 200);
      assert.match(sw.headers["content-type"] || "", /javascript/);
      assert.ok(sw.text.includes("const decideFetch = "), "the worker embeds the tested rules");
      return JSON.stringify(reg);
    });

    await check("F1", "ClinForms host: no manifest, no worker file, nothing linked or registered", async () => {
      assert.equal((await get(`${FORMS}/clindesk.webmanifest`)).status, 404);
      assert.equal((await get(`${FORMS}/clindesk-sw.js`)).status, 404);
      assert.equal((await get(`http://127.0.0.1:${PORT}/clindesk.webmanifest`)).status, 404);
      const { page } = await newContext("clinforms");
      for (const p of ["/", "/login", "/reports", "/demo"]) {
        await page.goto(`${FORMS}${p}`);
        const f = await headFacts(page);
        assert.equal(f.manifest, null, `${p}: ${JSON.stringify(f)}`);
        assert.equal(f.capable, null, p);
      }
      await page.waitForTimeout(800);
      assert.deepEqual(await registrations(page), []);
      await page.context().close();
    });

    await check("F2", "ClinDesk's public website and sign-in page link no manifest (the app is the clinic area)", async () => {
      const { page } = await newContext("clindesk-public");
      for (const p of ["/", "/pricing", "/login"]) {
        await page.goto(`${DESK}${p}`);
        assert.equal((await headFacts(page)).manifest, null, p);
      }
      await page.waitForTimeout(800);
      assert.deepEqual(await registrations(page), []);
      await page.context().close();
    });

    let patientUrl = null;
    let patientName = null;
    await check("O1", "offline: a VISITED patient record is never served from a cache – the offline page instead", async () => {
      await owner.goto(`${DESK}/app/clinic/patients`);
      const link = owner.locator("main a[href^='/app/clinic/patients/']").filter({ hasNotText: /new|export|template|unsigned/i }).first();
      await link.waitFor();
      patientName = (await link.innerText()).split("\n")[0].trim();
      await link.click();
      await owner.waitForURL((u) => /^\/app\/clinic\/patients\/[^/]+$/.test(u.pathname));
      await owner.waitForLoadState("networkidle");
      patientUrl = owner.url();
      assert.ok(patientName && (await owner.locator("main").innerText()).includes(patientName.split(" ")[0]), `record shows ${patientName}`);
      assert.ok(await owner.evaluate(() => Boolean(navigator.serviceWorker.controller)), "page controlled by the worker");
      await owner.screenshot({ path: path.join(OUT, "1-patient-online.png") });
      await goOffline(ctx);
      await owner.reload().catch(() => {});
      await owner.waitForSelector(`h1:has-text("ClinDesk needs a connection")`, { timeout: 15000 });
      const text = await owner.locator("body").innerText();
      assert.ok(text.includes(OFFLINE), text.slice(0, 200));
      assert.ok(!text.includes(patientName), "the patient's name is not on the offline page");
      await owner.screenshot({ path: path.join(OUT, "2-patient-offline.png") });
      // Opening the record again, offline: still the offline page, never the stored record.
      const again = await owner.goto(patientUrl).catch(() => null);
      if (again) assert.equal(again.status(), 503, "the worker's offline answer");
      await owner.waitForSelector(`h1:has-text("ClinDesk needs a connection")`, { timeout: 15000 });
      return `record "${patientName}" → offline page`;
    });

    await check("O2", "offline: another page inside /app shows the offline page; nothing but build files and icons is cached", async () => {
      await owner.goto(`${DESK}/app/clinic/diary`).catch(() => {});
      await owner.waitForSelector(`h1:has-text("ClinDesk needs a connection")`, { timeout: 15000 });
      await goOnline(ctx);
      const cached = await owner.evaluate(async () => {
        const out = [];
        for (const name of await caches.keys()) {
          const c = await caches.open(name);
          for (const r of await c.keys()) out.push(`${name} ${new URL(r.url).pathname}`);
        }
        return out;
      });
      const bad = cached.filter((e) => !/^clindesk-static-\S+ (\/_next\/static\/|\/clindesk\/app\/icon-[\w-]+\.png$)/.test(e));
      assert.deepEqual(bad, []);
      assert.ok(cached.some((e) => e.includes("/_next/static/")), "build files are cached");
      assert.ok(!cached.some((e) => / \/app(\/|$)/.test(e) || e.includes("/api/") || e.includes("/ingest")));
      return `${cached.length} cached entries, all static`;
    });

    await check("O3", "back online: the record loads from the network again", async () => {
      await owner.goto(patientUrl);
      await owner.waitForLoadState("networkidle");
      const text = await owner.locator("main").innerText();
      assert.ok(!text.includes(OFFLINE));
      assert.ok(text.includes(patientName.split(" ")[0]));
    });

    await check("I1", "'Install the app' appears when the browser offers to install; Install shows the browser's dialog", async () => {
      await owner.goto(`${DESK}/app/clinic`);
      await owner.waitForLoadState("networkidle");
      let menu = await openMenu(owner);
      assert.equal(await menu.locator("[data-testid=menu-install-app]").count(), 0, "no item without an install offer");
      await owner.keyboard.press("Escape");
      await fakeInstallPrompt(owner);
      menu = await openMenu(owner);
      await menu.locator("[data-testid=menu-install-app]").click();
      const dialog = owner.locator("[data-testid=install-app-dialog]");
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Install the ClinDesk app/);
      await owner.screenshot({ path: path.join(OUT, "3-install-dialog.png") });
      await dialog.locator("button:has-text('Install')").click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await owner.evaluate(() => window.__promptShown), 1);
    });

    await check("I2", "'Don't show this again' is remembered on the device (localStorage)", async () => {
      await fakeInstallPrompt(owner);
      let menu = await openMenu(owner);
      await menu.locator("[data-testid=menu-install-app]").click();
      const dialog = owner.locator("[data-testid=install-app-dialog]");
      await dialog.locator("button:has-text(\"Don't show this again\")").click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await owner.evaluate(() => localStorage.getItem("clindesk.installHint")), "dismissed");
      await owner.reload();
      await owner.waitForLoadState("networkidle");
      await fakeInstallPrompt(owner);
      menu = await openMenu(owner);
      assert.equal(await menu.locator("[data-testid=menu-install-app]").count(), 0);
      await owner.keyboard.press("Escape");
    });

    await check("I3", "iOS Safari: Share → Add to Home Screen steps (same session, phone viewport)", async () => {
      const state = await ctx.storageState();
      const { page: phone } = await newContext("iphone", {
        userAgent: IPHONE_SAFARI,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        storageState: { cookies: state.cookies, origins: [] },
      });
      await phone.goto(`${DESK}/app/clinic`);
      await phone.waitForLoadState("networkidle");
      const menu = await openMenu(phone);
      await menu.locator("[data-testid=menu-install-app]").click();
      const steps = phone.locator("[data-testid=install-ios-steps]");
      await steps.waitFor();
      const text = (await steps.innerText()).replace(/\s+/g, " ");
      assert.match(text, /Share/);
      assert.match(text, /Add to Home Screen/);
      await phone.screenshot({ path: path.join(OUT, "4-ios-steps.png") });
      // The shell keeps clear of the notch: the header's top padding includes the safe area (0 in a browser tab).
      const pad = await phone.evaluate(() => getComputedStyle(document.querySelector("header")).paddingTop);
      assert.equal(pad, "10px");
      await phone.context().close();
    });

    await check("C1", "the compiled CSS carries the safe-area padding of the clinic shell", async () => {
      const dir = path.join(REPO, ".next", "static", "css");
      const css = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
      for (const needle of ["env(safe-area-inset-top)", "env(safe-area-inset-left)", "env(safe-area-inset-bottom)"]) assert.ok(css.includes(needle), needle);
      assert.ok(/calc\(\.625rem \+ env\(safe-area-inset-top\)\)/.test(css), "header padding calc");
    });

    await check("Z", "no page errors", async () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    await browser.close();
    stopChild(server);
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=\S+/g, "token=…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
