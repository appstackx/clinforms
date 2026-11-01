/**
 * The way between the clinic system and the clinic account, and the plan pages (01/11/2026, Khuram's report: a new
 * owner who opened ClinDesk had no way back to the account / Plan and billing). In a real browser on clinic.localhost,
 * against the payment account's REAL TEST MODE, LOCAL only (own `next start`, throwaway SQLite, fictional clinic):
 *
 *   S  the owner joins on clinic.localhost (seeded demonstration clinic, clinic system on)
 *   N  the clinic shell's user menu: "Plan and billing" and "Clinic administration" (keyboard ↓ reaches them, axe);
 *      Set-up's "Clinic account" group: "Plan and billing", "Members and security"; the account area's "Open ClinDesk"
 *   C  card: ClinDesk Solo monthly (no add-on) → the done page: plan bought, "Open ClinDesk", "Back to Plan and billing"
 *   R  Plan and billing offers "Add the Reports add-on" → 25 a month → the running subscription changed in place (the
 *      plan item kept, the add-on added), Reports on
 *   D  Direct Debit (Bacs test details) on a fresh plan → the done page "being set up", no "Open ClinDesk"
 *   X  reception (role staff): no billing links in the user menu
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/dutydesk/node_modules node scripts/e2e/clinic-shell-billing-nav.cjs [PORT=3196] [SKIP_BACS=1]
 *
 * Screenshots: E2E_OUT (default .e2e-out/clinic-shell-billing-nav, gitignored). Test-mode objects only; the TEST key
 * (STRIPE_CLINDESK_TEST_SECRET_KEY in ~/.config/appstackx/clinforms.secrets.env) is read here, never printed.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3196);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "clinic-shell-billing-nav");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-shellnav-"));
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
// No webhooks reach this local server: the done page and the plan change sync by themselves (both idempotent).
const WEBHOOK_SECRET = `whsec_${crypto.randomBytes(24).toString("hex")}`;
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
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "10"], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    await startServer();
    const sql = openScratchDb();
    const one = (q, ...a) => sql.prepare(q).get(...a);
    const sub = () => one("SELECT * FROM clinic_subscription WHERE tenant_id = ?", CLINIC);
    const ent = (p) => one("SELECT status, plan_code FROM clinic_entitlements WHERE tenant_id = ? AND package = ?", CLINIC, p);
    const owner = await newPage("owner");
    const billing = `${DESK}/app/settings/billing`;
    const openMenu = async (page) => {
      await page.goto(`${DESK}/app/clinic`);
      const button = page.locator("button[aria-haspopup=menu]");
      await button.focus();
      await page.keyboard.press("ArrowDown");
      await page.locator("[role=menu][aria-label=Account]").waitFor();
      return page.locator("[role=menu][aria-label=Account]");
    };

    await check("S1", "the owner joins on the ClinDesk host", async () => {
      assert(ownerLink && new URL(ownerLink).origin === DESK, "owner link");
      await acceptInvite(owner, ownerLink, OWNER, "Helen Ward (fictional)");
    });

    await check("N1", "user menu (owner): Plan and billing and Clinic administration, reachable with the keyboard; axe clean", async () => {
      const menu = await openMenu(owner);
      const labels = (await menu.locator("[role=menuitem]").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
      assert.deepEqual(labels.slice(0, 3), ["My account and security", "Plan and billing", "Clinic administration"], labels.join(" | "));
      assert.equal(await menu.locator("[data-testid=menu-account\\.billing]").getAttribute("href"), "/app/settings/billing");
      assert.equal(await menu.locator("[data-testid=menu-account\\.admin]").getAttribute("href"), "/app");
      // ↓ from the first item reaches Plan and billing.
      await owner.keyboard.press("ArrowDown");
      assert.equal(await owner.evaluate(() => document.activeElement && document.activeElement.textContent.trim()), "Plan and billing");
      await owner.screenshot({ path: path.join(OUT, "1-user-menu-owner.png") });
      const note = await axe(owner, "clinic shell with the menu open");
      await owner.keyboard.press("Enter");
      await owner.waitForURL(`${DESK}/app/settings/billing`);
      await owner.locator("[data-testid=billing-plan]").waitFor();
      return note;
    });

    await check("N2", "Set-up: a Clinic account group with Plan and billing and Members and security", async () => {
      await owner.goto(`${DESK}/app/clinic/setup`);
      await owner.waitForURL((u) => u.pathname.startsWith("/app/clinic/") && u.pathname !== "/app/clinic/setup");
      await owner.waitForLoadState("networkidle");
      const nav = owner.locator("nav[aria-label=Set-up]");
      await nav.waitFor();
      assert.match(await nav.innerText(), /Clinic account/i);
      assert.equal(await nav.locator("a:has-text('Plan and billing')").getAttribute("href"), "/app/settings/billing");
      assert.equal(await nav.locator("a:has-text('Members and security')").getAttribute("href"), "/app/settings/members");
      await nav.locator("a:has-text('Plan and billing')").scrollIntoViewIfNeeded();
      await owner.screenshot({ path: path.join(OUT, "2-setup-clinic-account-links.png"), fullPage: true });
      await nav.locator("a:has-text('Members and security')").click();
      await owner.waitForURL(`${DESK}/app/settings/members`);
    });

    await check("N3", "the account area: an 'Open ClinDesk' tab and button lead into the clinic system", async () => {
      await owner.goto(`${DESK}/app`);
      const tab = owner.locator("nav[aria-label=Clinic] a:has-text('Open ClinDesk')");
      assert.equal(await tab.getAttribute("href"), "/app/clinic");
      const button = owner.locator("[data-testid=open-clinic-system] a:has-text('Open ClinDesk')");
      assert.equal(await button.getAttribute("href"), "/app/clinic");
      await owner.screenshot({ path: path.join(OUT, "3-account-overview-open-clindesk.png"), fullPage: true });
      await button.click();
      await owner.waitForURL(`${DESK}/app/clinic`);
      return axe(owner, "clinic dashboard");
    });

    // The clinic's payment customer, made here with this run's key: the app's per-clinic customer request is idempotent
    // per clinic id for 24 hours, and the fixed demonstration clinic id may have been used by another key in that time.
    await check("C0", "the clinic's test-mode payment customer", async () => {
      const c = await api("POST", "/customers", { name: "TEST – Riverside Physiotherapy (fictional)", "metadata[tenant_id]": CLINIC, "metadata[kind]": "clinic", "metadata[mode]": "test" });
      assert(/^cus_/.test(c.id || ""), "customer");
      const row = one("SELECT tenant_id FROM pms_sms_credit_accounts WHERE tenant_id = ?", CLINIC);
      if (row) sql.prepare("UPDATE pms_sms_credit_accounts SET customer_ref = ?, customer_mode = 'test' WHERE tenant_id = ?").run(c.id, CLINIC);
      else sql.prepare("INSERT INTO pms_sms_credit_accounts (tenant_id, customer_ref, customer_mode) VALUES (?, ?, 'test')").run(CLINIC, c.id);
      made.customer = c.id;
    });

    await check("C1", "card: ClinDesk Solo monthly → done page with the plan, Open ClinDesk and Back to Plan and billing", async () => {
      await owner.goto(billing);
      await owner.locator("input[name=interval][value=month]").check();
      await owner.locator("input[name=band][value=solo]").check();
      await owner.selectOption("#plan-reports", "none");
      await owner.click("button:has-text('Continue to payment')");
      await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await chooseMethod(owner, "card");
      await owner.locator("#cardNumber").waitFor({ state: "visible", timeout: 30000 });
      await owner.locator("#cardNumber").fill("4242424242424242");
      await owner.locator("#cardExpiry").fill("12 / 34");
      await owner.locator("#cardCvc").fill("123");
      await fillCommon(owner, "Helen Ward (fictional)");
      await submit(owner);
      await owner.waitForURL((u) => u.origin === DESK && u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      const done = owner.locator("[data-testid=billing-done]");
      await done.waitFor();
      assert.equal(await done.getAttribute("data-state"), "active", await done.innerText());
      assert.match(await owner.locator("[data-testid=billing-done-plan]").innerText(), /ClinDesk Solo$/);
      const open = owner.locator("a[data-testid=open-clinic-system]");
      assert.equal((await open.innerText()).trim(), "Open ClinDesk");
      assert.equal(await open.getAttribute("href"), "/app/clinic");
      assert.equal((await owner.locator("[data-testid=back-to-billing]").innerText()).trim(), "Back to Plan and billing");
      assert(!/stripe/i.test(await owner.locator("main").innerText()), "no vendor name");
      await owner.screenshot({ path: path.join(OUT, "4-done-active-open-clindesk.png"), fullPage: true });
      made.subscriptions.push(sub().subscription_ref);
      assert.deepEqual([sub().state, ent("clinic").status, ent("reports") && ent("reports").status], ["active", "active", "paused"]);
      const note = await axe(owner, "done page");
      await open.click();
      await owner.waitForURL(`${DESK}/app/clinic`);
      return note;
    });

    await check("R1", "Plan and billing: 'Add the Reports add-on' → 25 a month → changed in place, Reports on", async () => {
      await owner.goto(billing);
      const form = owner.locator("[data-testid=add-reports-form]");
      await form.waitFor();
      assert.match(await form.innerText(), /Up to 25 reports a month · £79 a month/);
      await form.locator("input[name=reports][value='25']").check();
      await owner.screenshot({ path: path.join(OUT, "5-add-reports-panel.png"), fullPage: true });
      const before = await api("GET", `/subscriptions/${sub().subscription_ref}`);
      const planItem = before.items.data[0].id;
      await form.locator("button:has-text('Add the Reports add-on')").click();
      const done = owner.locator("[data-testid=add-reports-done]");
      await done.waitFor({ timeout: 60000 });
      assert.match(await done.innerText(), /now ClinDesk Solo with Reports \(25 a month\)/);
      assert.match(await owner.locator("[data-testid=billing-plan]").innerText(), /with Reports \(25 a month\)/, "the page shows the new plan at once");
      await owner.screenshot({ path: path.join(OUT, "6-add-reports-done.png"), fullPage: true });
      const after = await api("GET", `/subscriptions/${sub().subscription_ref}`);
      const keys = after.items.data.map((i) => i.price.lookup_key).sort();
      assert.deepEqual(keys, ["clindesk_reports_25_monthly", "clindesk_solo_monthly"]);
      assert(after.items.data.some((i) => i.id === planItem), "the plan's own item is kept (not removed and re-added)");
      assert.deepEqual([sub().reports_key, ent("reports").status], ["25", "active"]);
      await owner.goto(billing);
      assert.equal(await owner.locator("[data-testid=add-reports-form]").count(), 0, "no longer offered once the plan has Reports");
      assert.match(await owner.locator("[data-testid=billing-plan]").innerText(), /with Reports \(25 a month\)/);
    });

    if (process.env.SKIP_BACS !== "1") {
      await check("D1", "Direct Debit: ClinDesk Solo with Bacs → done page 'being set up', no Open ClinDesk", async () => {
        // End the card plan (test mode) so a fresh plan can be bought; the page reads it back.
        await api("DELETE", `/subscriptions/${sub().subscription_ref}`);
        sql.prepare("UPDATE clinic_subscription SET state = 'canceled' WHERE tenant_id = ?").run(CLINIC);
        await owner.goto(billing);
        await owner.locator("input[name=interval][value=month]").check();
        await owner.locator("input[name=band][value=solo]").check();
        await owner.selectOption("#plan-reports", "none");
        await owner.click("button:has-text('Continue to payment')");
        await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
        await chooseMethod(owner, "bacs_debit");
        const sort = owner.locator("#sortCode");
        await sort.waitFor({ state: "visible", timeout: 30000 });
        await sort.fill("108800");
        await owner.locator("#accountNumber").fill("00012345");
        await fillCommon(owner, "Helen Ward (fictional)");
        await owner.locator("#confirm").check({ force: true });
        await submit(owner);
        const pay = owner.locator("button[data-testid=hosted-payment-submit-button]:has-text('Pay and subscribe')");
        await pay.waitFor({ timeout: 60000 });
        await pay.click();
        await owner.waitForURL((u) => u.origin === DESK && u.pathname === "/app/settings/billing/done", { timeout: 120000 });
        const done = owner.locator("[data-testid=billing-done]");
        await done.waitFor();
        const state = await done.getAttribute("data-state");
        made.subscriptions.push(sub().subscription_ref);
        await owner.screenshot({ path: path.join(OUT, "7-done-direct-debit-pending.png"), fullPage: true });
        if (state === "active") return "the test Direct Debit cleared at once – pending state covered by the unit tests";
        assert.equal(state, "pending_payment");
        assert.match(await done.innerText(), /Direct Debit is being set up/);
        assert.equal(await owner.locator("a[data-testid=open-clinic-system]").count(), 0, "no Open ClinDesk before the payment clears");
        assert.equal((await owner.locator("[data-testid=back-to-billing]").innerText()).trim(), "Back to Plan and billing");
        return "pending until the Direct Debit clears";
      });
    }

    await check("X1", "reception (role staff): no billing or administration links in the user menu", async () => {
      sql.prepare("UPDATE member SET role = 'staff' WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)").run(OWNER);
      try {
        const menu = await openMenu(owner);
        const labels = (await menu.locator("[role=menuitem]").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
        assert(!labels.includes("Plan and billing") && !labels.includes("Clinic administration"), labels.join(" | "));
        await owner.screenshot({ path: path.join(OUT, "8-user-menu-reception.png") });
        await owner.keyboard.press("Escape");
        await owner.goto(`${DESK}/app`);
        assert.equal(await owner.locator("nav[aria-label=Clinic] a:has-text('Plan and billing')").count(), 0, "no billing tab for reception");
        return labels.join(" | ");
      } finally {
        sql.prepare("UPDATE member SET role = 'owner' WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)").run(OWNER);
      }
    });

    await check("X2", "no page errors in the browser", () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });
    sql.close();
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    for (const id of made.subscriptions) await api("DELETE", `/subscriptions/${id}`).catch(() => {});
    if (made.customer) await api("DELETE", `/customers/${made.customer}`).catch(() => {});
    await browser.close();
    stopChild(server);
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=\S+/g, "token=…").replace(/whsec_[A-Za-z0-9]+/g, "whsec_…").replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
