/**
 * Subscription billing in a real browser against the payment account's REAL TEST MODE (31/10/2026), LOCAL only. Starts
 * its own `next start` on a throwaway SQLite database, seeds the demonstration clinic (fictional data only), forwards
 * the account's webhooks with the provider's CLI to the ONE webhook (/api/billing/stripe-webhook) and:
 *
 *   S  the owner joins on clinic.localhost (the ClinDesk host)
 *   P  Plan and billing: no plan yet, ClinDesk bands with prices, the Reports add-on, monthly/yearly; axe; 375 px; the
 *      payment service is never named on screen; no VAT wording; the add-on follows the plan's interval (yearly £1,590)
 *   C  card: Practice YEARLY + Reports 100 yearly → TEST checkout with 4242 → the done page "your plan is active"; the
 *      subscription, the clinic system and Reports on, the allowance 100; the forwarded webhooks arrive (200) and
 *      change nothing more
 *   M  "Manage billing" opens the hosted billing page; plan change to Small without the add-on → Reports paused
 *   K  the subscription is cancelled at the service → the webhook cancels the packages
 *   D  Direct Debit: ClinForms Starter with Bacs test details (sort code 10-88-00, account 00012345) → the done page
 *      "being set up"; NOT active until the payment clears; then (webhook invoice.paid / subscription updated) active
 *      with the allowance 25
 *   F  the platform page lists the subscription
 *
 * Needs: `npm run build`, the TEST key in ~/.config/appstackx/clinforms.secrets.env (STRIPE_CLINDESK_TEST_SECRET_KEY –
 * read here, never printed) and the `stripe` CLI on PATH.
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/billing-subscriptions.cjs [PORT=3194] [SKIP_BACS=1]
 *
 * Results and screenshots: E2E_OUT (default .e2e-out/billing-subscriptions, gitignored). Test-mode objects only.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3194);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "billing-subscriptions");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-billing-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");
const AXE = require.resolve("axe-core/axe.min.js");
const CLINIC = "riverside-demo";
const OWNER = "owner@riverside-demo.example.com";

function testKey() {
  const line = fs
    .readFileSync(path.join(os.homedir(), ".config/appstackx/clinforms.secrets.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("STRIPE_CLINDESK_TEST_SECRET_KEY="));
  const v = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(v)) throw new Error("No TEST key (STRIPE_CLINDESK_TEST_SECRET_KEY) in the secrets file");
  return v;
}
const KEY = testKey();
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
let WEBHOOK_SECRET = "";
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

/** The payment service's API with the TEST key (test-mode objects only; the key is never printed). */
async function api(method, pathname, form) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "stripe-version": "2026-10-28.endive", ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json();
  if (json.livemode === true) throw new Error("live answer refused");
  return json;
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
    STRIPE_CLINDESK_SECRET_KEY: KEY,
    STRIPE_CLINDESK_WEBHOOK_SECRET: WEBHOOK_SECRET,
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
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_intent.succeeded",
];
let listener = null;
let listenerLog = "";
function startListener() {
  listener = spawn("stripe", ["listen", "--forward-to", `${FORMS}/api/billing/stripe-webhook`, "--events", EVENTS.join(",")], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  listener.stdout.on("data", (d) => (listenerLog += d));
  listener.stderr.on("data", (d) => (listenerLog += d));
}
function stopChild(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // gone
  }
}

/* ------------------------------------------------------------------ TOTP + accounts (as pms-sms-credits.cjs) */
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
async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
  return found.length ? `${found.length} minor` : null;
}
const waitFor = async (fn, ms = 60000, what = "condition") => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
};

/** On the hosted payment page: choose a method in the accordion (when several are offered). */
async function chooseMethod(page, method) {
  const button = page.locator(`[data-testid=${method}-accordion-item-button]`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  if (await button.count()) await button.dispatchEvent("click");
}
async function fillCommon(page, name) {
  const email = page.locator("#email");
  if ((await email.count()) && !(await email.inputValue().catch(() => ""))) await email.fill(OWNER);
  const billingName = page.locator("#billingName");
  if (await billingName.isVisible().catch(() => false)) await billingName.fill(name);
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("GB");
  for (const [sel, v] of [
    ["#billingAddressLine1", "1 Test Street (fictional)"],
    ["#billingLocality", "Milton Keynes"],
    ["#billingPostalCode", "MK9 9ZZ"],
  ]) {
    const f = page.locator(sel);
    if (await f.isVisible().catch(() => false)) await f.fill(v);
  }
}
async function submit(page) {
  await page.locator("button[data-testid=hosted-payment-submit-button], button.SubmitButton").first().click();
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newPage = async (who, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    pages.push([who, page]);
    return page;
  };
  const made = { subscriptions: [] };
  try {
    WEBHOOK_SECRET = execFileSync("stripe", ["listen", "--print-secret"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY }, encoding: "utf8", timeout: 30000 }).trim();
    assert(/^whsec_[A-Za-z0-9]+$/.test(WEBHOOK_SECRET), "no webhook secret from the CLI");
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "10"], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    await startServer();
    startListener();
    await new Promise((r) => setTimeout(r, 4000));
    const sql = openScratchDb();
    const one = (q, ...a) => sql.prepare(q).get(...a);
    const sub = () => one("SELECT * FROM clinic_subscription WHERE tenant_id = ?", CLINIC);
    const ent = (p) => one("SELECT status, plan_code, ends_at FROM clinic_entitlements WHERE tenant_id = ? AND package = ?", CLINIC, p);
    const pkg = () => one("SELECT package, reports_included FROM clinic_package WHERE tenant_id = ?", CLINIC);
    const owner = await newPage("owner");
    const billing = `${DESK}/app/settings/billing`;

    await check("S1", "the owner joins on the ClinDesk host", async () => {
      assert(ownerLink && new URL(ownerLink).origin === DESK, "owner link");
      await acceptInvite(owner, ownerLink, OWNER, "Helen Ward (fictional)");
    });

    await check("P1", "Plan and billing: no plan yet; ClinDesk bands and prices, the Reports add-on; axe clean; no vendor name", async () => {
      await owner.goto(billing);
      assert.equal((await owner.locator("[data-testid=billing-plan]").innerText()).trim(), "No plan yet");
      const form = await owner.locator("[data-testid=plan-form]").innerText();
      for (const s of ["Solo · £39 a month", "Small · £89 a month", "Practice · £169 a month", "Group · £299 a month", "Multi-site · £499 a month", "6–10 practitioners"]) assert(form.includes(s), `plan form: ${s}`);
      const body = await owner.locator("main").innerText();
      assert(!/stripe/i.test(body), "the payment service is never named on screen");
      assert(!/ex VAT|plus VAT|exclude VAT/i.test(body), "no VAT is charged – no ex-VAT wording");
      assert.match(body, /No VAT is charged/);
      await owner.locator("input[name=interval][value=year]").check();
      assert.match(await owner.locator("[data-testid=plan-form]").innerText(), /Practice · £1,690 a year/);
      assert.equal(await owner.locator("#plan-reports").isDisabled(), false, "yearly plans take the add-on too");
      assert.match(await owner.locator("#plan-reports").innerText(), /Up to 100 reports a month · £1,590 a year/);
      await owner.locator("input[name=interval][value=month]").check();
      await owner.screenshot({ path: path.join(OUT, "1440-plan-billing.png"), fullPage: true });
      return axe(owner, "plan and billing");
    });

    await check("P2", "375 px: the page fits without sideways scrolling", async () => {
      const small = await newPage("owner-375", { width: 375, height: 800 });
      await small.context().addCookies(await owner.context().cookies());
      await small.goto(billing);
      await small.locator("[data-testid=plan-form]").waitFor();
      const wide = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await small.screenshot({ path: path.join(OUT, "375-plan-billing.png"), fullPage: true });
      assert(wide <= 1, `scrolls sideways by ${wide}px`);
      await small.close();
    });

    await check("C1", "card: Practice yearly + Reports 100 yearly → TEST checkout 4242 → 'your plan is active'", async () => {
      await owner.goto(billing);
      await owner.locator("input[name=interval][value=year]").check();
      await owner.locator("input[name=band][value=practice]").check();
      await owner.selectOption("#plan-reports", "100");
      await owner.click("button:has-text('Continue to payment')");
      await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await chooseMethod(owner, "card");
      await owner.locator("#cardNumber").waitFor({ state: "visible", timeout: 30000 });
      await owner.locator("#cardNumber").fill("4242424242424242");
      await owner.locator("#cardExpiry").fill("12 / 34");
      await owner.locator("#cardCvc").fill("123");
      await fillCommon(owner, "Helen Ward (fictional)");
      await owner.screenshot({ path: path.join(OUT, "checkout-card.png") });
      await submit(owner);
      await owner.waitForURL((u) => u.origin === DESK && u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      await owner.locator("[data-testid=billing-done]").waitFor();
      const state = await owner.locator("[data-testid=billing-done]").getAttribute("data-state");
      assert.equal(state, "active", await owner.locator("[data-testid=billing-done]").innerText());
      await owner.screenshot({ path: path.join(OUT, "1440-billing-done.png"), fullPage: true });
      const s = sub();
      made.subscriptions.push(s.subscription_ref);
      assert.deepEqual([s.state, s.product, s.plan_key, s.billing_interval, s.reports_key, Number(s.reports_included), Number(s.amount_pence), s.mode], ["active", "clindesk", "practice", "year", "100", 100, 328000, "test"]);
      assert.deepEqual([ent("clinic").status, ent("clinic").plan_code, ent("reports").status], ["active", "clindesk-practice", "active"]);
      assert.deepEqual([pkg().package, Number(pkg().reports_included)], ["practice", 100]);
      return `subscription ${s.subscription_ref.slice(0, 12)}…`;
    });

    await check("C2", "the forwarded webhooks arrive at the one endpoint (200) and change nothing more", async () => {
      await waitFor(() => /customer\.subscription\.created[\s\S]*?\[200\]|\[200\][\s\S]*?customer\.subscription\.created/.test(listenerLog) || /"type":"customer\.subscription\.created"/.test(serverLog), 90000, "subscription.created forwarded");
      await waitFor(() => /"type":"invoice\.paid"/.test(serverLog), 90000, "invoice.paid");
      const before = one("SELECT count(*) AS n FROM audit_log WHERE tenant_id = ? AND action LIKE 'clinic.subscription_%'", CLINIC).n;
      await new Promise((r) => setTimeout(r, 5000));
      const s = sub();
      assert.equal(s.state, "active");
      assert(!/"outcome":"bad_signature"/.test(serverLog), "no bad signatures");
      assert(!/"outcome":"error"/.test(serverLog), "no handler errors");
      return `${before} subscription audit row(s); events ${(serverLog.match(/"event":"billing\.webhook"/g) || []).length}`;
    });

    await check("C3", "the page shows the plan, status and next payment (DD/MM/YYYY); the nav has Plan and billing", async () => {
      await owner.goto(billing);
      assert.match(await owner.locator("[data-testid=billing-plan]").innerText(), /ClinDesk Practice with Reports \(100 a month\)/);
      assert.match(await owner.locator("main").innerText(), /£3,280 a year/);
      assert.equal((await owner.locator("[data-testid=billing-status]").innerText()).trim(), "Active");
      assert.match(await owner.locator("[data-testid=billing-next]").innerText(), /^\d{2}\/\d{2}\/\d{4}$/);
      await owner.locator("nav >> text=Plan and billing").first().waitFor();
    });

    await check("M1", "Manage billing opens the hosted billing page", async () => {
      await owner.goto(billing);
      await owner.click("button:has-text('Manage billing')");
      await owner.waitForURL(/billing\.stripe\.com/, { timeout: 60000 });
      await owner.screenshot({ path: path.join(OUT, "billing-portal.png") });
      await owner.goto(billing);
    });

    await check("M2", "change the plan to Small monthly without the add-on → Reports paused, plan code small", async () => {
      await owner.goto(billing);
      await owner.locator("input[name=interval][value=month]").check();
      await owner.locator("input[name=band][value=small]").check();
      await owner.selectOption("#plan-reports", "none");
      await owner.click("button:has-text('Change plan')");
      await owner.locator("[data-testid=plan-result]").waitFor({ timeout: 60000 });
      assert.match(await owner.locator("[data-testid=plan-result]").innerText(), /now ClinDesk Small/);
      assert.deepEqual([sub().plan_key, ent("clinic").plan_code, ent("reports").status], ["small", "clindesk-small", "paused"]);
    });

    await check("K1", "cancelled at the payment service → the webhook cancels the packages (data kept)", async () => {
      await api("DELETE", `/subscriptions/${sub().subscription_ref}`);
      await waitFor(() => sub().state === "canceled", 90000, "the cancellation webhook");
      assert.equal(ent("clinic").status, "cancelled");
    });

    if (process.env.SKIP_BACS !== "1") {
      await check("D1", "Direct Debit: ClinForms Starter with Bacs test details → 'being set up', not active yet", async () => {
        await owner.goto(`${billing}?product=clinforms`);
        await owner.locator("input[name=tier][value=starter]").check();
        await owner.click("button:has-text('Continue to payment')");
        await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
        await chooseMethod(owner, "bacs_debit");
        const sort = owner.locator("#sortCode");
        await sort.waitFor({ state: "visible", timeout: 30000 });
        await sort.fill("108800");
        await owner.locator("#accountNumber").fill("00012345");
        await fillCommon(owner, "Helen Ward (fictional)");
        await owner.locator("#confirm").check({ force: true });
        await owner.screenshot({ path: path.join(OUT, "checkout-bacs.png") });
        await submit(owner);
        // Bacs: the page shows the Direct Debit details to review, then "Pay and subscribe".
        const pay = owner.locator("button[data-testid=hosted-payment-submit-button]:has-text('Pay and subscribe')");
        await pay.waitFor({ timeout: 60000 });
        await owner.screenshot({ path: path.join(OUT, "checkout-bacs-review.png") });
        await pay.click();
        await owner.waitForURL((u) => u.origin === DESK && u.pathname === "/app/settings/billing/done", { timeout: 120000 });
        const state = await owner.locator("[data-testid=billing-done]").getAttribute("data-state");
        await owner.screenshot({ path: path.join(OUT, "1440-billing-done-bacs.png"), fullPage: true });
        const s = sub();
        made.subscriptions.push(s.subscription_ref);
        if (state === "active") return "the test payment cleared at once";
        assert.equal(state, "pending_payment");
        assert.equal(s.state, "pending_payment");
        assert.notEqual(ent("reports").status, "active", "Reports not switched on before the payment clears");
        return "pending until the Direct Debit clears";
      });

      await check("D2", "the Direct Debit clears (test mode, a few minutes) → active, Reports on with 25 reports", async () => {
        await waitFor(() => sub().state === "active", 8 * 60_000, "the Direct Debit to clear");
        assert.deepEqual([sub().product, sub().plan_key, ent("reports").status, Number(pkg().reports_included)], ["clinforms", "starter", "active", 25]);
        assert(/"type":"invoice\.paid"/.test(serverLog));
      });
    }

    await check("F1", "the platform page lists the clinic's subscription", async () => {
      await owner.goto(`${DESK}/app/platform/billing`);
      const row = owner.locator(`tr[data-tenant=${CLINIC}]`);
      await row.waitFor();
      assert.match(await row.innerText(), /ClinForms Starter|ClinDesk/);
      await owner.screenshot({ path: path.join(OUT, "1440-platform-billing.png"), fullPage: true });
    });

    await check("X1", "no page errors in the browser", () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });
    sql.close();
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    // Test-mode clean-up: end the subscriptions this run made (test objects only).
    for (const id of made.subscriptions) await api("DELETE", `/subscriptions/${id}`).catch(() => {});
    await browser.close();
    stopChild(listener);
    stopChild(server);
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=\S+/g, "token=…").replace(/whsec_[A-Za-z0-9]+/g, "whsec_…").replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  fs.writeFileSync(path.join(OUT, "webhook-forwarding.log"), scrub(listenerLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
