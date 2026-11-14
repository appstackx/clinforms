/**
 * THE SELF-SERVE 14-DAY FREE TRIAL (13/11/2026, docs/clinic-system/trial.md) – the whole journey in a real browser,
 * LOCAL only. Its own `next start` (PORT, default 3431) on a throwaway SQLite database with CLINFORMS_SELF_SIGNUP=clinic,
 * BETTER_AUTH_URL = http://localhost:<port>, CLINFORMS_AUTH_ORIGINS = http://clinic.localhost:<port>; email to a FAKE
 * Mailpit started here (sender, subject, HTML and text checked). Payments: the ClinDesk payment account's TEST mode
 * (as billing-subscriptions.cjs – the TEST key from ~/.config/appstackx/clinforms.secrets.env, never printed; webhooks
 * forwarded by the provider's CLI). PAY=skip leaves out T9–T10 (no network). Fictional data only.
 *
 *   T1  ClinDesk website with the switch on: "Start free trial" next to "Book a demo" (header, hero, pricing) and
 *       "14-day free trial, no card needed"
 *   T2  sign-up on clinic.localhost → confirmation email (ClinDesk, branded HTML) → link + password → two-step set-up
 *       → the clinic system, NOT Plan and billing
 *   T3  the trial: banner "Free trial – 14 days left · 0 of 10 free reports used" + "Choose a plan"; 14 days from the
 *       first sign-in; the clinic system and Reports on as "trial"; 10 text credits labelled as trial credits
 *   T4  the welcome email: once, branded HTML (tables, ClinDesk's colours, no images), plain text, "Stop these tips"
 *   T5  "Explore with sample data" → a SEPARATE sample clinic with made-up patients and the demo marker → Switch clinic
 *       back: the real clinic holds none of them
 *   T6  10 free reports used → the banner says so (the Report API's refusal itself: src/server/trial tests)
 *   T7  the trial ends: the banner says the data is safe; a new patient is refused with the trial message; records read
 *   T8  the daily cron: "Your ClinDesk free trial has ended – your data is safe" once (a second run sends nothing)
 *   T9  Plan and billing → ClinDesk Small monthly → TEST checkout (4242) → "your plan is active"
 *   T10 converted: plan paid, every record kept (patients, sample clinic, usage, texts), the banner gone, a new patient
 *       saves again, "You're on a paid ClinDesk plan" email once
 *   X1  no page errors
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/trial-journey.cjs [PAY=skip]
 *
 * Results, emails (links scrubbed) and screenshots: E2E_OUT (default .e2e-out/trial-journey, gitignored).
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3431);
const MAIL_PORT = PORT + 1;
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const PAY = process.env.PAY !== "skip";
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "trial-journey");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-trial-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");

function testKey() {
  const line = fs
    .readFileSync(path.join(os.homedir(), ".config/appstackx/clinforms.secrets.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("STRIPE_CLINDESK_TEST_SECRET_KEY="));
  const v = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(v)) throw new Error("No TEST key (STRIPE_CLINDESK_TEST_SECRET_KEY) in the secrets file");
  return v;
}
const KEY = PAY ? testKey() : "";
let WEBHOOK_SECRET = "";
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
const STAMP = Date.now().toString(36);
// A clinic name (and so a clinic id) of its own per run: the payment service keeps a created customer's answer for a day
// under the clinic's id, and this script deletes its test customer at the end.
const RUN_WORD = Array.from(crypto.randomBytes(6), (b) => "abcdefghijklmnopqrstuvwxyz"[b % 26]).join("");
const OWNER = { email: `dana.trial.${STAMP}@larkfield-physio.example.com`, name: "Dana Lark", clinic: `Larkfield ${RUN_WORD[0].toUpperCase()}${RUN_WORD.slice(1)} Physio (fictional)`, password: `e2e ${rnd(12)} password` };

/* ------------------------------------------------------------------ results */
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
    for (const [who, p] of livePages) await p.screenshot({ path: path.join(SHOTS, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ fake Mailpit */
const mails = [];
const mailServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/api/v1/send") {
      try {
        mails.push({ at: new Date().toISOString(), ...JSON.parse(body) });
      } catch {
        // ignore
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ID: `fake-${mails.length}` }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
const mailsTo = (to, re) => mails.filter((m) => (m.To || []).some((t) => t.Email === to) && (!re || re.test(m.Subject)));
async function waitMail(to, re) {
  for (let i = 0; i < 60; i++) {
    const m = mailsTo(to, re).at(-1);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
const linkIn = (m, re) => (((m && m.Text) || "").match(re) || [])[0] || null;

/* ------------------------------------------------------------------ server + payment webhooks */
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
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "mailpit",
    MAILPIT_URL: `http://127.0.0.1:${MAIL_PORT}`,
    MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk",
    MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk",
    CLINFORMS_EMAIL_REPLY_TO: "hello@clinforms.co.uk",
    CLINFORMS_EMAIL_REPLY_TO_CLINIC: "hello@clindesk.co.uk",
    CLINFORMS_PLATFORM_ADMINS: "zz-platform-trial@example.com",
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    CLINFORMS_SELF_SIGNUP: "clinic",
    ...(PAY ? { STRIPE_CLINDESK_SECRET_KEY: KEY, STRIPE_CLINDESK_WEBHOOK_SECRET: WEBHOOK_SECRET } : {}),
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
let listener = null;
let listenerLog = "";
const EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];
function startListener() {
  listener = spawn("stripe", ["listen", "--forward-to", `${FORMS}/api/billing/stripe-webhook`, "--events", EVENTS.join(",")], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  listener.stdout.on("data", (d) => (listenerLog += d));
  listener.stderr.on("data", (d) => (listenerLog += d));
}
async function api(method, pathname) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, { method, headers: { authorization: `Bearer ${KEY}` } });
  const json = await res.json();
  if (json.livemode === true) throw new Error("live answer refused");
  return json;
}
/** The host's own HTTP (clinic.localhost resolved to 127.0.0.1 with the right Host header). */
function get(base, p, init = {}) {
  const u = new URL(p, base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: u.pathname + u.search, method: init.method || "GET", headers: { host: u.host, ...(init.headers || {}) } }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/* ------------------------------------------------------------------ TOTP */
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
const waitFor = async (fn, ms = 60000, what = "condition") => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
};
const banner = async (page) => ((await page.locator("[data-testid=trial-banner]").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ run */
(async () => {
  await new Promise((r) => mailServer.listen(MAIL_PORT, "127.0.0.1", r));
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newPage = async (who, viewport = { width: 1280, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    livePages.push([who, page]);
    return page;
  };
  const made = { subscriptions: [], customers: [] };
  let tenant = "";
  let sampleTenant = "";
  try {
    if (PAY) {
      WEBHOOK_SECRET = execFileSync("stripe", ["listen", "--print-secret"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY }, encoding: "utf8", timeout: 30000 }).trim();
      assert(/^whsec_[A-Za-z0-9]+$/.test(WEBHOOK_SECRET), "no webhook secret from the CLI");
    }
    await startServer();
    if (PAY) startListener();
    const sql = () => openScratchDb();
    const one = (q, ...a) => {
      const db = sql();
      try {
        return db.prepare(q).get(...a);
      } finally {
        db.close();
      }
    };
    const run = (q, ...a) => {
      const db = sql();
      try {
        return db.prepare(q).run(...a);
      } finally {
        db.close();
      }
    };
    const page = await newPage("owner");

    await step("T1", "ClinDesk website: 'Start free trial' next to 'Book a demo' and '14-day free trial, no card needed'", async () => {
      const home = await get(DESK, "/");
      assert.equal(home.status, 200);
      assert.match(home.body, /href="\/start-trial"[^>]*>Start free trial/);
      assert.match(home.body, /Book a demo/);
      const pricing = await get(DESK, "/pricing");
      assert.match(pricing.body, /14-day free trial, no card needed/);
      assert.doesNotMatch(pricing.body, /Free trial available after your demo/);
      await page.goto(`${DESK}/pricing`);
      await page.screenshot({ path: path.join(SHOTS, "t1-pricing.png") });
      return "home + pricing + header";
    });

    await step("T2", "sign-up → branded confirmation email → link + password → two-step → the clinic system (no plan needed)", async () => {
      await page.goto(`${DESK}/start-trial`);
      await page.fill("#f-clinicName", OWNER.clinic);
      await page.fill("#f-ownerName", OWNER.name);
      await page.fill("#f-email", OWNER.email);
      await page.fill("#f-password", OWNER.password);
      await page.fill("#f-confirm", OWNER.password);
      await page.check("#f-accept");
      await page.waitForTimeout(3500);
      await page.click("button:has-text('Start free trial')");
      await page.waitForSelector("[data-testid=signup-sent]");
      const mail = await waitMail(OWNER.email, /Confirm your email/);
      assert(mail, "confirmation email");
      assert.equal(mail.From.Name, "ClinDesk");
      assert.match(mail.HTML || "", /role="presentation"/, "branded table layout");
      assert.match(mail.HTML || "", /#C4432B/i, "ClinDesk's coral");
      const link = linkIn(mail, /https?:\/\/\S+\/start-trial\/confirm\?token=[A-Za-z0-9._%-]+/);
      assert(link && new URL(link).host === new URL(DESK).host);
      await page.goto(link);
      await page.fill("#f-password", OWNER.password);
      await page.click("button:has-text('Confirm and create my clinic')");
      await page.waitForURL((u) => u.pathname === "/two-factor", { timeout: 30000 });
      await page.fill("#f-password", OWNER.password);
      await page.click("button[type=submit]");
      await page.waitForSelector("img[alt^='Authenticator set-up code']");
      OWNER.key = (await page.locator("code").first().innerText()).replace(/\s+/g, "");
      await page.check("input[name=saved]");
      await page.fill("#f-code", await freshCode(OWNER.key));
      await page.click("button[type=submit]");
      await page.waitForURL((u) => u.pathname === "/app/clinic", { timeout: 30000 });
      tenant = one('SELECT o.slug FROM member m JOIN organization o ON o.id = m."organizationId" JOIN "user" u ON u.id = m."userId" WHERE u.email = ?', OWNER.email).slug;
      return `clinic ${tenant}, landed on /app/clinic`;
    });

    await step("T3", "the trial: banner, 14 days from the first sign-in, packages on as trial, 10 trial text credits", async () => {
      const b = await banner(page);
      assert.match(b, /^Free trial – 14 days left · 0 of 10 free reports used\./, b);
      assert.match(b, /Choose a plan/);
      await page.screenshot({ path: path.join(SHOTS, "t3-clinic-with-banner.png"), fullPage: true });
      const plan = one("SELECT status, trial_days, trial_starts_at, trial_ends_at FROM clinic_plan WHERE tenant_id = ?", tenant);
      assert.equal(plan.status, "trial");
      assert.equal(Date.parse(plan.trial_ends_at) - Date.parse(plan.trial_starts_at), 14 * 86_400_000);
      const ents = ["clinic", "reports"].map((p) => one("SELECT status FROM clinic_entitlements WHERE tenant_id = ? AND package = ?", tenant, p).status);
      assert.deepEqual(ents, ["trial", "trial"]);
      assert.equal(one("SELECT balance FROM pms_sms_credit_accounts WHERE tenant_id = ?", tenant).balance, 10);
      await page.goto(`${DESK}/app/clinic/messages/credits`);
      const credits = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      assert.match(credits, /Trial credits – free test texts for your trial/);
      return `ends ${plan.trial_ends_at}`;
    });

    await step("T4", "welcome email: once, branded HTML + plain text, ClinDesk sender, stop-tips link", async () => {
      const m = await waitMail(OWNER.email, /Welcome to ClinDesk/);
      assert(m, "welcome email");
      assert.equal(mailsTo(OWNER.email, /Welcome to ClinDesk/).length, 1);
      assert.equal(m.From.Name, "ClinDesk");
      assert.match(m.Subject, /your 14-day free trial has started/);
      assert.match(m.HTML, /max-width:600px/);
      assert.doesNotMatch(m.HTML, /<img/i);
      assert.match(m.Text, /10 free reports/);
      const stop = linkIn(m, /https?:\/\/\S+\/trial\/stop-tips\?c=[^\s]+/);
      assert(stop, "stop-tips link");
      const r = await get(DESK, new URL(stop).pathname + new URL(stop).search);
      assert.equal(r.status, 200, "the stop-tips page opens (and changes nothing until the button)");
      assert.equal(one("SELECT tips_off_at FROM self_trial WHERE tenant_id = ?", tenant).tips_off_at, null);
      return m.Subject;
    });

    await step("T5", "Explore with sample data → a separate sample clinic (made-up data) → Switch clinic back: nothing mixed", async () => {
      await page.goto(`${DESK}/app/clinic`);
      await page.locator("[data-testid=sample-offer]").waitFor();
      await page.click("[data-testid=sample-create]");
      await page.waitForURL((u) => u.pathname.startsWith("/app/clinic"), { timeout: 60000 });
      await page.waitForLoadState("networkidle");
      sampleTenant = one("SELECT sample_tenant_id FROM self_trial WHERE tenant_id = ?", tenant).sample_tenant_id;
      assert.ok(sampleTenant && sampleTenant !== tenant);
      const main = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      assert.match(main, /sample clinic \(fictional\)/i, "the sample clinic is open");
      await page.screenshot({ path: path.join(SHOTS, "t5-sample-clinic.png"), fullPage: true });
      const samplePatients = one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", sampleTenant).n;
      assert.ok(samplePatients >= 12);
      assert.equal(one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", tenant).n, 0, "the real clinic holds none of them");
      await page.goto(`${DESK}/app/select-clinic`);
      await page
        .locator("form")
        .filter({ has: page.locator("p", { hasText: new RegExp(`^${OWNER.clinic.replace(/[()]/g, "\\$&")}$`) }) })
        .locator("button:has-text('Open')")
        .click();
      await page.waitForURL((u) => u.pathname.startsWith("/app/clinic"), { timeout: 30000 });
      await page.goto(`${DESK}/app/clinic`);
      assert.equal(await page.locator("[data-testid=sample-offer]").count(), 0, "no second offer");
      return `${sampleTenant}: ${samplePatients} made-up patients`;
    });

    await step("T6", "10 free reports used → the banner says so", async () => {
      const at = new Date().toISOString();
      for (let i = 1; i <= 10; i++) {
        run(
          "INSERT INTO usage_report (tenant_id, report_id, episode_fp, root_report_id, started_at, first_drafted_at, first_approved_at, billable_period, billable_at, billable_via, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, NULL, ?, ?, 'drafted', ?, ?)",
          tenant, `rpt_e2e_${i}`, `rpt_e2e_${i}`, at, at, at.slice(0, 7), at, at, at,
        );
      }
      await page.goto(`${DESK}/app/clinic`);
      const b = await banner(page);
      assert.match(b, /10 of 10 free reports used/, b);
      return b;
    });

    await step("T7", "the trial ends: banner 'data is safe'; a new patient is refused with the trial message; records stay readable", async () => {
      run("UPDATE clinic_plan SET trial_ends_at = ? WHERE tenant_id IN (?, ?)", new Date(Date.now() - 60_000).toISOString(), tenant, sampleTenant);
      await page.goto(`${DESK}/app/clinic`);
      assert.match(await banner(page), /Your free trial has ended\. Your data is safe/);
      await page.goto(`${DESK}/app/clinic/patients/new`);
      const form = page.locator("form#new-patient-page");
      await form.locator("input[name=firstName]").fill("Megan");
      await form.locator("input[name=lastName]").fill("Hart");
      await form.locator("input[name=dateOfBirth]").fill("14/03/1988");
      await form.locator("button[type=submit][value=save]").click();
      await page.waitForSelector("text=Your free trial has ended, so nothing new can be added or changed", { timeout: 20000 });
      assert.equal(one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", tenant).n, 0);
      await page.screenshot({ path: path.join(SHOTS, "t7-read-only.png"), fullPage: true });
      const list = await page.goto(`${DESK}/app/clinic/patients`);
      assert.equal(list.status(), 200, "reading still works");
    });

    await step("T8", "the daily cron: the 'trial ended' email once; a second run sends nothing", async () => {
      const call = () => fetch(`${FORMS}/api/cron/retention`, { headers: { authorization: `Bearer ${SECRETS.CRON_SECRET}` } });
      assert.equal((await call()).status, 200);
      const m = await waitMail(OWNER.email, /free trial has ended/);
      assert(m, "ended email");
      assert.match(m.Subject, /Your ClinDesk free trial has ended – your data is safe/);
      assert.match(m.Text, /Nothing has been deleted/);
      assert.equal((await call()).status, 200);
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(mailsTo(OWNER.email, /free trial has ended/).length, 1);
      assert.equal(mailsTo(OWNER.email, /Three things|4 days left|ends tomorrow/).length, 0, "the stale ones were skipped, not sent late");
      assert.ok(one("SELECT count(*) AS n FROM organization WHERE slug = ?", tenant).n === 1, "nothing deleted");
      return m.Subject;
    });

    if (PAY) {
      await step("T9", "Plan and billing → ClinDesk Small monthly → TEST checkout (4242) → 'your plan is active'", async () => {
        await page.goto(`${DESK}/app/settings/billing`);
        await page.locator("input[name=interval][value=month]").check();
        await page.locator("input[name=band][value=small]").check();
        await page.click("button:has-text('Continue to payment')");
        await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
        await page.waitForTimeout(1500);
        const cardButton = page.locator("[data-testid=card-accordion-item-button]");
        if (await cardButton.count()) await cardButton.dispatchEvent("click");
        // The hosted page's payment-method list and card fields may sit in frames (the page's layout changes over
        // time): click the Card row, then fill the card fields wherever they are.
        await page.getByText("Pay and subscribe").first().waitFor({ timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const CARD_SEL = "#cardNumber, input[name=cardnumber], input[name=number], input[autocomplete='cc-number']";
        const cardFrame = async () => {
          for (const f of page.frames()) if (await f.locator(CARD_SEL).first().isVisible().catch(() => false)) return f;
          return null;
        };
        const notes = [];
        for (let attempt = 0; attempt < 3 && !(await cardFrame()); attempt++) {
          for (const frame of page.frames()) {
            const tries = [frame.locator("[data-testid=card-accordion-item-button]"), frame.locator("input[type=radio][value=card]"), frame.getByRole("radio", { name: /Card/ }), frame.getByText("Card", { exact: true })];
            for (const c of tries) {
              const n = await c.count().catch(() => 0);
              notes.push(`${frame.url().slice(0, 60)} ${n}`);
              if (!n) continue;
              await c.first().click({ force: true, timeout: 5000 }).catch(() => {});
              await page.waitForTimeout(1000);
              if (await cardFrame()) break;
            }
            if (await cardFrame()) break;
          }
        }
        fs.writeFileSync(path.join(OUT, "checkout-controls.txt"), notes.join("\n"));
        const cf = await cardFrame();
        assert(cf, "the card fields did not show on the payment page");
        await cf.locator(CARD_SEL).first().fill("4242424242424242");
        await cf.locator("#cardExpiry, input[name=exp-date], input[name=expiry], input[autocomplete='cc-exp']").first().fill("12 / 34");
        await cf.locator("#cardCvc, input[name=cvc], input[autocomplete='cc-csc']").first().fill("123");
        const nameInFrame = cf.locator("#billingName, input[autocomplete='cc-name']");
        if (await nameInFrame.first().isVisible().catch(() => false)) await nameInFrame.first().fill("Dana Lark (fictional)");
        const postcode = cf.locator("input[name=postalCode], input[autocomplete='postal-code']");
        if (await postcode.first().isVisible().catch(() => false)) await postcode.first().fill("MK9 9ZZ");
        // Email, address and the pay button: wherever the page puts them (main page or a frame).
        const firstVisible = async (make) => {
          for (const f of page.frames()) {
            const l = make(f).first();
            if (await l.isVisible().catch(() => false)) return l;
          }
          return null;
        };
        const email = await firstVisible((f) => f.locator("#email, input[type=email], input[autocomplete=email]"));
        if (email && !(await email.inputValue().catch(() => ""))) await email.fill(OWNER.email);
        const country = await firstVisible((f) => f.locator("#billingCountry, select[autocomplete=country]"));
        if (country) await country.selectOption("GB").catch(() => {});
        for (const sel of [["#billingAddressLine1, input[autocomplete='address-line1']", "1 Test Street (fictional)"], ["#billingLocality, input[autocomplete='address-level2']", "Milton Keynes"], ["#billingPostalCode, input[autocomplete='postal-code']", "MK9 9ZZ"]]) {
          const f = await firstVisible((fr) => fr.locator(sel[0]));
          if (f && !(await f.inputValue().catch(() => ""))) await f.fill(sel[1]);
        }
        await page.screenshot({ path: path.join(SHOTS, "t9-checkout-filled.png") });
        const pay = await firstVisible((f) => f.locator("button[data-testid=hosted-payment-submit-button], button.SubmitButton"));
        if (pay) await pay.click();
        else {
          const byName = await firstVisible((f) => f.getByRole("button", { name: /Pay and subscribe|Subscribe/ }));
          assert(byName, "no pay button found");
          await byName.click();
        }
        await page.waitForURL((u) => u.origin === DESK && u.pathname === "/app/settings/billing/done", { timeout: 120000 });
        await page.locator("[data-testid=billing-done]").waitFor();
        assert.equal(await page.locator("[data-testid=billing-done]").getAttribute("data-state"), "active");
        const s = one("SELECT subscription_ref, customer_ref, state FROM clinic_subscription WHERE tenant_id = ?", tenant);
        made.subscriptions.push(s.subscription_ref);
        made.customers.push(s.customer_ref);
        return `subscription ${String(s.subscription_ref).slice(0, 12)}…`;
      });

      await step("T10", "converted: paid, every record kept, banner gone, writing works again, 'paid plan' email once", async () => {
        const plan = one("SELECT status FROM clinic_plan WHERE tenant_id = ?", tenant);
        assert.equal(plan.status, "paid");
        assert.ok(one("SELECT converted_at FROM self_trial WHERE tenant_id = ?", tenant).converted_at);
        assert.equal(one("SELECT status FROM clinic_entitlements WHERE tenant_id = ? AND package = 'clinic'", tenant).status, "active");
        assert.equal(one("SELECT status FROM clinic_entitlements WHERE tenant_id = ? AND package = 'reports'", tenant).status, "paused", "Small without the add-on");
        assert.equal(one("SELECT count(*) AS n FROM clinic_package WHERE tenant_id = ?", tenant).n, 0, "the free Trial package is gone");
        assert.equal(one("SELECT count(*) AS n FROM usage_report WHERE tenant_id = ?", tenant).n, 10, "usage kept");
        assert.equal(one("SELECT balance FROM pms_sms_credit_accounts WHERE tenant_id = ?", tenant).balance, 10, "trial texts kept");
        assert.ok(one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", sampleTenant).n >= 12, "the sample clinic kept");
        await page.goto(`${DESK}/app/clinic`);
        assert.equal(await page.locator("[data-testid=trial-banner]").count(), 0, "no trial banner");
        await page.goto(`${DESK}/app/clinic/patients/new`);
        const form = page.locator("form#new-patient-page");
        await form.locator("input[name=firstName]").fill("Megan");
        await form.locator("input[name=lastName]").fill("Hart");
      await form.locator("input[name=dateOfBirth]").fill("14/03/1988");
        await form.locator("button[type=submit][value=save]").click();
        await waitFor(() => one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", tenant).n === 1, 20000, "the patient saved");
        const m = await waitMail(OWNER.email, /paid ClinDesk plan/);
        assert(m, "paid email");
        await new Promise((r) => setTimeout(r, 3000));
        assert.equal(mailsTo(OWNER.email, /paid ClinDesk plan/).length, 1, "once, whatever webhooks arrive");
        return m.Subject;
      });
    }

    await step("X1", "no page errors in the browser", () => {
      assert.deepEqual(problems, []);
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    await browser.close();
    stopChild(server);
    stopChild(listener);
    if (PAY) {
      for (const id of made.subscriptions) await api("DELETE", `/subscriptions/${id}`).catch(() => {});
      for (const id of made.customers) await api("DELETE", `/customers/${id}`).catch(() => {});
    }
    mailServer.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=[^\s"&]+/g, "token=…").replace(/([?&]t=)[A-Za-z0-9_-]+/g, "$1…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "emails.json"), scrub(JSON.stringify(mails.map((m) => ({ at: m.at, from: m.From, to: m.To, subject: m.Subject, text: m.Text })), null, 2)));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  process.exit(failed.length ? 1 : 0);
})();
