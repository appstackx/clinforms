/**
 * CARD PAYMENTS through the clinic's own payment account (docs/clinic-system/card-payments.md) – screens end to end,
 * LOCAL only, against the payment provider's REAL TEST API. Its own `next start` (PORT, default 3290) on a throwaway
 * SQLite database with the demo clinic (`pms:seed-demo -- --fresh`, fictional data only).
 *
 *   OFF  without CLINFORMS_CARD_PAYMENTS: Set-up → Card payments and Billing → payouts are 404 and not in the
 *        navigation; the connected-accounts webhook answers 404
 *   ON   restarted with CLINFORMS_CARD_PAYMENTS=on and the TEST key:
 *     C1  owner: Set-up → Card payments (test-mode banner, "Not connected") → Connect → the provider's own onboarding
 *         page (connect.stripe.com) → back: "Set-up not finished"; then the clinic's switch on
 *     C2  owner adds the simulated card reader at the main site
 *     C3  an issued invoice: Send to card reader → Tap a test card → "Paid by card", the invoice paid, ONE payment row
 *     C4  Refund to card (partial, with a reason) → a refund row, the panel shows it refunded
 *     C5  the patient's Invoices tab: Save a card → the consent words; "Open the card form" only after the tick → the
 *         provider's hosted card form (checkout.stripe.com); the consent is recorded (words, desk, member, time)
 *     C6  Billing → Card payouts and fees (owner) lists the payment against its invoice number
 *     C7  roles: an admin and reception get 404 on Set-up → Card payments; reception gets 404 on payouts; 375 px of
 *         the invoice page without sideways scrolling
 *   The test connected account made by C1 is CLOSED at the end.
 *
 *   npm run build
 *   STRIPE_CLINDESK_TEST_SECRET_KEY=… NODE_PATH=/Users/khuram/Projects/Appstackx/dutydesk/node_modules node scripts/e2e/pms-billing-cards.cjs
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3290);
const ON_PORT = PORT + 2;
let SERVER_PORT = PORT;
let BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "pms-billing-cards");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-cards-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");
// A clinic (and so a clinic id) of its own per run: the payment account is created with an idempotency key built from
// the clinic id, and the provider replays a key's first answer for a day – a second run on the fixed id got the
// previous run's account back (closed at that run's end), so "Connect" failed with ?error=connect.
const RUN_WORD = Array.from(crypto.randomBytes(6), (b) => "abcdefghijklmnopqrstuvwxyz"[b % 26]).join("");
const CLINIC = `riverside-demo-${RUN_WORD}`;
const CLINIC_NAME = `Riverside ${RUN_WORD[0].toUpperCase()}${RUN_WORD.slice(1)} Physiotherapy (fictional)`;

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

const results = [];
const livePages = [];
async function step(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    const msg = String(err && err.stack ? err.stack : err).slice(0, 1500);
    results.push({ id, what, pass: false, error: msg });
    console.log(`FAIL ${id} ${what}: ${msg}`);
    for (const [who, p] of livePages) await p.screenshot({ path: path.join(OUT, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}

function appEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    ...SECRETS,
    NODE_ENV: "production",
    PORT: String(SERVER_PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: BASE,
    APP_ORIGIN: BASE,
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
    CLINIC_SMS_PROVIDER: "outbox",
    CLINIC_EMAIL_PROVIDER: "outbox",
    ...extra,
  };
}
let server = null;
let serverLog = "";
async function startServer(extra) {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(SERVER_PORT)], { cwd: REPO, env: appEnv(extra), stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${BASE}/api/reports/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not come up");
}
function killListeners(port) {
  try {
    for (const pid of execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split(/\s+/).filter(Boolean)) process.kill(Number(pid), "SIGKILL");
  } catch {
    // none
  }
}
async function stopServer() {
  if (!server) return;
  const port = SERVER_PORT;
  const pid = server.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // gone
  }
  const end = Date.now() + 30_000;
  let killed = false;
  while (Date.now() < end) {
    try {
      await fetch(`${BASE}/api/reports/v1/health`);
    } catch {
      break;
    }
    if (!killed && Date.now() > end - 25_000) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // gone
      }
      killListeners(port);
      killed = true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  server = null;
}

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
async function freshCode(key) {
  for (;;) {
    if (30000 - (Date.now() % 30000) > 3000) return totp(key);
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  }
}
async function acceptInvite(page, link, name) {
  const password = `e2e ${rnd(12)} password`;
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", name);
  await page.fill("#f-password", password);
  await page.fill("#f-confirm", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
}


const TEST_KEY = (process.env.STRIPE_CLINDESK_TEST_SECRET_KEY || "").trim();
if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(TEST_KEY)) throw new Error("STRIPE_CLINDESK_TEST_SECRET_KEY must be a TEST key");
const HOOK = `whsec_local_${rnd(16)}`;

async function stripe(method, p, account, form) {
  const headers = { authorization: `Bearer ${TEST_KEY}`, "stripe-version": "2026-10-28.endive" };
  if (account) headers["stripe-account"] = account;
  let body;
  if (form) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(form);
  }
  const res = await fetch(`https://api.stripe.com${p}`, { method, headers, body });
  return res.json();
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const one = (q, ...a) => {
    const db = openScratchDb();
    try {
      return db.prepare(q).get(...a);
    } finally {
      db.close();
    }
  };
  const all = (q, ...a) => {
    const db = openScratchDb();
    try {
      return db.prepare(q).all(...a);
    } finally {
      db.close();
    }
  };
  const run = (q, ...a) => {
    const db = openScratchDb();
    try {
      return db.prepare(q).run(...a);
    } finally {
      db.close();
    }
  };
  let ctx = null;
  let account = null;
  try {
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--slug", CLINIC, "--name", CLINIC_NAME, "--patients", "40", "--app-url", BASE], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert(ownerLink, "owner invitation in the seed output");

    await startServer({});
    ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-GB", timezoneId: "Europe/London" });
    const owner = await ctx.newPage();
    owner.setDefaultTimeout(45000);
    owner.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    livePages.push(["owner", owner]);
    await acceptInvite(owner, ownerLink, "Helen Ward (fictional)");
    const ownerEmail = one('SELECT u.email FROM "user" u JOIN member m ON m.userId = u.id WHERE m.role = ?', "owner").email;

    await step("OFF", "switch off: the pages are 404 and not in the navigation; the webhook is 404", async () => {
      assert.equal((await owner.goto(`${BASE}/app/clinic/setup/card-payments`)).status(), 404);
      assert.equal((await owner.goto(`${BASE}/app/clinic/billing/payouts`)).status(), 404);
      await owner.goto(`${BASE}/app/clinic/setup/sites`);
      assert.equal(await owner.locator("a[href='/app/clinic/setup/card-payments']").count(), 0);
      const r = await fetch(`${BASE}/api/billing/connect-webhook`, { method: "POST", body: "{}" });
      assert.equal(r.status, 404);
    });

    await stopServer();
    SERVER_PORT = ON_PORT;
    BASE = `http://localhost:${ON_PORT}`;
    await startServer({ CLINFORMS_CARD_PAYMENTS: "on", STRIPE_CLINDESK_SECRET_KEY: TEST_KEY, STRIPE_CLINDESK_CONNECT_WEBHOOK_SECRET: HOOK });
    // The session cookie is per host, not per port: the same browser stays signed in on the new port.

    await step("C1", "owner connects the clinic's payment account at the provider and switches card payments on", async () => {
      await owner.goto(`${BASE}/app/clinic/setup/card-payments`);
      await owner.getByText("Test mode – no real card is charged").first().waitFor();
      await owner.getByText("Not connected").first().waitFor();
      assert.equal(await owner.locator("a[href='/app/clinic/setup/card-payments']").count() > 0, true, "in the navigation");
      await owner.screenshot({ path: path.join(OUT, "1-setup.png"), fullPage: true });
      await Promise.all([owner.waitForURL((u) => u.hostname === "connect.stripe.com", { timeout: 45000 }), owner.click("[data-testid=card-connect]")]);
      const acc = one("SELECT account_ref, account_status FROM pms_card_settings WHERE tenant_id = ?", CLINIC);
      account = acc.account_ref;
      assert.match(account, /^acct_/);
      await owner.goto(`${BASE}/app/clinic/setup/card-payments?returned=1`);
      await owner.getByText("Set-up not finished").first().waitFor();
      await owner.click("#card-enabled");
      await owner.getByText("On – staff can take card payments").first().waitFor();
      return `${account} (${acc.account_status})`;
    });

    await step("C2", "owner adds the simulated card reader at the main site", async () => {
      await owner.fill("[data-testid=reader-label]", "Front desk (test)");
      await owner.fill("[data-testid=reader-line1]", "1 Test Street");
      await owner.fill("[data-testid=reader-city]", "London");
      await owner.fill("[data-testid=reader-postcode]", "SW1A 1AA");
      await owner.click("[data-testid=reader-add]");
      await owner.locator("[data-testid=card-readers] li").first().waitFor();
      assert.match(await owner.locator("[data-testid=card-readers]").innerText(), /Front desk \(test\)/);
      await owner.screenshot({ path: path.join(OUT, "2-reader.png"), fullPage: true });
    });

    let invoiceId = null;
    let patientId = null;
    await step("C3", "invoice: send to the reader, tap a test card → paid, one payment row", async () => {
      const inv = one("SELECT id, patient_id, total_pence - paid_pence - credited_pence AS bal FROM pms_invoices WHERE tenant_id = ? AND status = 'issued' AND bill_to = 'patient' AND total_pence - paid_pence - credited_pence >= 1000 ORDER BY issued_on DESC LIMIT 1", CLINIC);
      assert(inv, "an issued patient invoice with a balance");
      invoiceId = inv.id;
      patientId = inv.patient_id;
      await owner.goto(`${BASE}/app/clinic/billing/invoices/${invoiceId}`);
      await owner.locator("[data-testid=invoice-card-panel]").waitFor();
      await owner.click("[data-testid=card-send-reader]");
      await owner.locator("[data-testid=card-pending]").waitFor();
      await owner.screenshot({ path: path.join(OUT, "3a-waiting.png"), fullPage: true });
      await owner.click("[data-testid=card-test-tap]");
      await owner.locator("[data-testid=card-payment-row]").first().waitFor({ timeout: 45000 });
      const after = one("SELECT total_pence - paid_pence - credited_pence AS bal FROM pms_invoices WHERE tenant_id = ? AND id = ?", CLINIC, invoiceId);
      assert.equal(Number(after.bal), 0);
      const pays = all("SELECT p.id, p.provider_ref FROM pms_payments p JOIN pms_payment_allocations a ON a.tenant_id = p.tenant_id AND a.payment_id = p.id WHERE p.tenant_id = ? AND a.invoice_id = ? AND p.provider = 'stripe_connect'", CLINIC, invoiceId);
      assert.equal(pays.length, 1);
      await owner.screenshot({ path: path.join(OUT, "3b-paid.png"), fullPage: true });
      return `${(Number(inv.bal) / 100).toFixed(2)} paid by ${pays[0].provider_ref}`;
    });

    await step("C4", "refund £5.00 to the card with a reason", async () => {
      await owner.click("[data-testid=card-refund-open]");
      await owner.fill("[data-testid=card-refund-amount]", "5.00");
      await owner.fill("[data-testid=card-refund-reason]", "E2E partial refund (fictional)");
      await owner.click("[data-testid=card-refund-submit]");
      await owner.getByText("refunded").first().waitFor({ timeout: 45000 });
      const r = one("SELECT count(*) AS n, sum(amount_pence) AS s FROM pms_payments WHERE tenant_id = ? AND provider = 'stripe_connect' AND kind = 'refund'", CLINIC);
      assert.equal(Number(r.n), 1);
      assert.equal(Number(r.s), 500);
    });

    await step("C5", "save a card: consent words, tick, then the provider's hosted card form; consent recorded", async () => {
      await owner.goto(`${BASE}/app/clinic/patients/${patientId}/invoices`);
      await owner.click("[data-testid=save-card-start]");
      const words = await owner.locator("[data-testid=consent-wording]").innerText();
      assert.match(words, /Stripe/);
      assert.equal(await owner.locator("[data-testid=consent-continue]").isDisabled(), true, "not before the tick");
      await owner.check("[data-testid=consent-agreed] input, input[data-testid=consent-agreed]").catch(async () => owner.getByLabel("The patient has read or heard these words and agreed").check());
      await owner.screenshot({ path: path.join(OUT, "5-consent.png"), fullPage: true });
      await Promise.all([owner.waitForURL((u) => u.hostname === "checkout.stripe.com", { timeout: 45000 }), owner.click("[data-testid=consent-continue]")]);
      const m = one("SELECT status, consent_channel, consent_recorded_by, consent_wording FROM pms_card_mandates WHERE tenant_id = ? AND patient_id = ?", CLINIC, patientId);
      assert.equal(m.status, "pending");
      assert.equal(m.consent_channel, "desk");
      assert(m.consent_recorded_by, "who recorded it");
      assert.equal(m.consent_wording, words.trim());
    });

    await step("C6", "Billing → Card payouts and fees lists the payment against its invoice", async () => {
      await owner.goto(`${BASE}/app/clinic/billing`);
      await owner.click("[data-testid=billing-payouts-link]");
      await owner.locator("[data-testid=card-payouts]").waitFor();
      const text = await owner.locator("[data-testid=card-payouts]").innerText();
      assert.match(text, /Card payment/);
      await owner.screenshot({ path: path.join(OUT, "6-payouts.png"), fullPage: true });
    });

    await step("C7", "roles and 375 px", async () => {
      await owner.setViewportSize({ width: 375, height: 800 });
      await owner.goto(`${BASE}/app/clinic/billing/invoices/${invoiceId}`);
      await owner.locator("[data-testid=invoice-card-panel]").waitFor();
      const wide = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(wide <= 1, `sideways scroll ${wide}px`);
      await owner.screenshot({ path: path.join(OUT, "7-375.png"), fullPage: true });
      await owner.setViewportSize({ width: 1440, height: 1000 });
      for (const role of ["admin", "staff"]) {
        run('UPDATE member SET role = ? WHERE userId = (SELECT id FROM "user" WHERE email = ?)', role, ownerEmail);
        try {
          assert.equal((await owner.goto(`${BASE}/app/clinic/setup/card-payments`)).status(), 404, role);
          if (role === "staff") assert.equal((await owner.goto(`${BASE}/app/clinic/billing/payouts`)).status(), 404, "reception payouts");
        } finally {
          run('UPDATE member SET role = \'owner\' WHERE userId = (SELECT id FROM "user" WHERE email = ?)', ownerEmail);
        }
      }
    });

    if (problems.length) console.log(`page problems: ${problems.join(" | ")}`);
  } catch (err) {
    console.log(`FATAL ${String(err && err.stack ? err.stack : err).slice(0, 2000)}`);
    results.push({ id: "FATAL", pass: false });
  } finally {
    if (account) {
      const closed = await stripe("POST", `/v2/core/accounts/${account}/close`, null, { applied_configurations: ["merchant"] }).catch(() => ({}));
      console.log(`closed test account ${account}: ${closed && closed.closed === true ? "yes" : "CHECK in the Dashboard (test mode)"}`);
    }
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopServer();
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUT, "server.log"), serverLog.replace(/token=[A-Za-z0-9._%-]+/g, "token=[hidden]").replace(/(sk|rk)_test_[A-Za-z0-9]+/g, "[key]").replace(/whsec_[A-Za-z0-9_]+/g, "[secret]"));
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
