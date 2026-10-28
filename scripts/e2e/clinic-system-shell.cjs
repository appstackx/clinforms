/**
 * Browser check of the clinic-system foundation (LOCAL only): packages, the /app/clinic shell, the platform page's
 * package switches and the brand by host name.
 *
 *   A = a clinic WITH the "clinic" package (the demo seed: npm run pms:seed-demo), B = a clinic without it.
 *   Clinic A's owner must be in CLINFORMS_PLATFORM_ADMINS (the platform page step).
 *
 *   INVITE_A_FILE=… INVITE_B_FILE=… BASE=http://localhost:3180 \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/clinic-system-shell.cjs
 *
 * Checks: B's clinic area is exactly ClinForms' (navigation unchanged, /app/clinic is the 404 page, no clinic-system
 * filter on the activity page); A's navigation has the clinic system, /app/clinic shows the demo clinic's figures,
 * the shell (design v1: product switch, left navigation by role, site switcher, "/" patient search, user menu, "?"
 * shortcuts) works, works by keyboard (skip link) and at 375 px without sideways scrolling (navigation behind "Menu"); the platform page switches B's package on
 * (B then sees it) and off again; on an app-only brand host the public pages go to sign-in. Nothing secret is
 * printed (random passwords, codes in memory). Screenshots: E2E_OUT (default .e2e-out/clinic-system).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3180";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/clinic-system");
const link = (file) => {
  const found = (fs.readFileSync(file, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._-]+/) || [])[0];
  if (!found) throw new Error(`No invitation link in ${file}`);
  return found;
};
const INVITE_A = link(process.env.INVITE_A_FILE);
const INVITE_B = link(process.env.INVITE_B_FILE);
const CLINFORMS_NAV = ["Overview", "Studio", "Clinic", "Members", "Security", "Plan & usage", "API keys", "Activity"];

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
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}
async function freshCode(key) {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(key);
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 400)}`);
    throw err;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Account from the invitation + two-step set-up → /app. */
async function onboard(page, invite, name) {
  const password = `e2e ${crypto.randomBytes(12).toString("base64url")} password`;
  await page.goto(invite);
  await page.waitForSelector("text=Create your account");
  await page.fill("#f-name", name);
  await page.fill("#f-password", password);
  await page.fill("#f-confirm", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`);
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = base32Decode(await page.locator("code").first().innerText());
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`);
}

const navLabels = (page) => page.locator("header nav[aria-label='Clinic'] a").allInnerTexts();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const problems = [];
  for (const [label, page] of [["A", a], ["B", b]]) {
    page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
    // Not product errors: the 404 page asked for on purpose, and Next's link prefetches cut off by the next goto().
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload/.test(m.text()) && problems.push(`${label} console: ${m.text().slice(0, 200)}`));
  }
  const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });

  try {
    await step("both owners create their accounts with two-step verification", async () => {
      await onboard(a, INVITE_A, "Rita Owner (fictional)");
      await onboard(b, INVITE_B, "Hal Owner (fictional)");
    });

    await step("B (no clinic package): the clinic area's navigation is exactly ClinForms'", async () => {
      assert(JSON.stringify(await navLabels(b)) === JSON.stringify(CLINFORMS_NAV), `nav: ${(await navLabels(b)).join(", ")}`);
      await shot(b, "b-01-app");
    });

    await step("B: /app/clinic is the 404 page; the activity filter has no clinic-system group", async () => {
      const res = await b.goto(`${BASE}/app/clinic`);
      assert(res.status() === 404, `status ${res.status()}`);
      await b.waitForSelector("text=Page not found");
      await b.goto(`${BASE}/app/settings/activity`);
      const groups = await b.locator("#activity-action optgroup").evaluateAll((els) => els.map((e) => e.getAttribute("label")));
      assert(!groups.includes("Clinic system"), `groups: ${groups.join(", ")}`);
    });

    await step("A (demo clinic): the navigation adds the clinic system after Overview", async () => {
      const labels = await navLabels(a);
      assert(labels[0] === "Overview" && labels[1] === "Clinic system", `nav: ${labels.join(", ")}`);
      await shot(a, "a-01-app");
    });

    await step("A: /app/clinic shows the demo clinic (figures, sites, practitioners, demo notice)", async () => {
      await a.click("header nav[aria-label='Clinic'] >> text=Clinic system");
      await a.waitForURL(`${BASE}/app/clinic`);
      // innerText applies CSS text-transform (the figures' labels are upper case on screen): compare in lower case.
      const text = (await a.locator("main").innerText()).toLowerCase();
      for (const s of ["Clinic system", "Riverside Physiotherapy (fictional)", "Demonstration clinic", "Patients", "200", "Bletchley (fictional)", "Sarah Reid", "Grace Bennett"]) {
        assert(text.includes(s.toLowerCase()), `missing "${s}"`);
      }
      // 27/10/2026 (design v1): the clinic system's navigation moved from the header to the left-hand side.
      assert((await a.locator("nav[aria-label='Clinic system'] a[aria-current='page']").innerText()) === "Overview", "Overview is the current page");
      assert(!/\bTM3\b|CareConnect|\bAI\b/.test(await a.locator("body").innerText()), "no banned names on screen");
      await shot(a, "a-02-clinic-overview");
    });

    await step("A: the shell (design v1) – product switch, navigation by role, patient search on \"/\", user menu", async () => {
      await a.goto(`${BASE}/app/clinic`);
      const products = await a.locator("nav[aria-label='Product areas'] a").allInnerTexts();
      assert(products[0] === "Clinic system" && /^ClinForms/.test(products[1] || ""), `products: ${products.join(", ")}`);
      const labels = await a.locator("nav[aria-label='Clinic system'] a").allInnerTexts();
      assert(JSON.stringify(labels) === JSON.stringify(["Overview", "Patients", "Unsigned notes", "Staff access", "Roles and permissions", "Note templates"]), `clinic nav: ${labels.join(", ")}`);
      assert((await a.locator("button[aria-haspopup='listbox']").first().innerText()).includes("Bletchley (fictional)"), "site switcher shows the first site");
      await a.locator("main h1").first().click();
      await a.keyboard.press("/");
      assert(await a.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label") === "Search patients"), "\"/\" focuses the patient search");
      await a.keyboard.type("Hart");
      await a.keyboard.press("Enter");
      await a.waitForURL(/\/app\/clinic\/patients\?q=Hart/);
      assert((await a.locator("main").innerText()).includes("Megan Hart"), "the search finds Megan Hart (the records list shows first name first)");
      await a.click("button[aria-haspopup='menu']");
      const menu = await a.locator("[role='menu'][aria-label='Account']").innerText();
      assert(/Role: Owner/.test(menu) && /Sign out/.test(menu) && /Switch to ClinForms/.test(menu), `menu: ${menu.replace(/\s+/g, " ")}`);
      await a.keyboard.press("Escape");
      assert((await a.locator("[role='menu']").count()) === 0, "Esc closes the menu");
      await a.keyboard.press("?");
      await a.waitForSelector("[role='dialog'] >> text=Keyboard shortcuts");
      await a.keyboard.press("Escape");
      await shot(a, "a-02b-clinic-shell");
    });

    await step("A: keyboard – the first Tab reaches the skip link and it moves focus to the content", async () => {
      await a.goto(`${BASE}/app/clinic`);
      await a.keyboard.press("Tab");
      const focused = await a.evaluate(() => document.activeElement && document.activeElement.textContent);
      assert(/Skip to content/.test(focused || ""), `focused: ${focused}`);
      await a.keyboard.press("Enter");
      assert(a.url().endsWith("#clinic-main"), a.url());
    });

    await step("A: 375 px – no sideways scrolling, the header and figures fit", async () => {
      await a.setViewportSize({ width: 375, height: 812 });
      await a.goto(`${BASE}/app/clinic`);
      const overflow = await a.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `scrolls sideways by ${overflow}px`);
      // The navigation folds behind "Menu" on a phone.
      assert(!(await a.locator("nav[aria-label='Clinic system']").isVisible()), "navigation folded on a phone");
      await a.click("button[aria-controls='clinic-nav']");
      assert(await a.locator("nav[aria-label='Clinic system']").isVisible(), "Menu opens the navigation");
      await shot(a, "a-03b-clinic-375-menu");
      await a.click("button[aria-controls='clinic-nav']");
      await shot(a, "a-03-clinic-375");
      await a.setViewportSize({ width: 1280, height: 900 });
    });

    await step("platform page: Packages lists both clinics; switching B's clinic system on and off", async () => {
      await a.goto(`${BASE}/app/platform`);
      await a.waitForSelector("text=Packages");
      const row = a.locator("tr", { hasText: "harbour-clinic" }).last();
      await shot(a, "a-04-platform-packages");
      // Switching ON asks nothing; switching OFF asks for confirmation (below).
      await row.locator("form", { has: a.locator("input[name=package][value=clinic]") }).locator("button").click();
      await a.waitForFunction(() => /harbour-clinic[\s\S]*On[\s\S]*On/.test(document.querySelector("main").innerText));
      await b.goto(`${BASE}/app`);
      const labels = await navLabels(b);
      assert(labels.includes("Clinic system"), `B nav after switching on: ${labels.join(", ")}`);
      const res = await b.goto(`${BASE}/app/clinic`);
      assert(res.status() === 200, `B /app/clinic ${res.status()}`);
      await b.waitForSelector("text=No sites yet.");
      await shot(b, "b-02-clinic-empty");
      a.once("dialog", (d) => d.accept());
      await a.goto(`${BASE}/app/platform`);
      await a.locator("tr", { hasText: "harbour-clinic" }).last().locator("form", { has: a.locator("input[name=package][value=clinic]") }).locator("button").click();
      await a.waitForTimeout(800);
      await b.goto(`${BASE}/app`);
      assert(JSON.stringify(await navLabels(b)) === JSON.stringify(CLINFORMS_NAV), "B back to ClinForms' navigation");
      assert((await b.goto(`${BASE}/app/clinic`)).status() === 404, "B /app/clinic is 404 again");
    });

    await step("brand by host: an app-only brand's public pages go to sign-in; ClinForms' stay public", async () => {
      const host = BASE.replace("localhost", "clinic.localhost");
      const p = await browser.newPage();
      await p.goto(`${host}/`);
      assert(p.url().startsWith(`${host}/login`), `at ${p.url()}`);
      await p.goto(`${BASE}/`);
      assert(p.url() === `${BASE}/`, `at ${p.url()}`);
      await p.close();
    });

    assert(problems.length === 0, `browser errors:\n${problems.join("\n")}`);
  } finally {
    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} steps passed. Screenshots: ${OUT}`);
    if (failed) process.exitCode = 1;
  }
})().catch((err) => {
  console.error(String(err && err.message));
  process.exitCode = 1;
});
