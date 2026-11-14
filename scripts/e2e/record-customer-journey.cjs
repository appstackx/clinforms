/**
 * RECORDED CUSTOMER JOURNEY (14/11/2026) – one continuous video of a new physio clinic owner on ClinDesk, from the
 * website to a paid plan, LOCAL only. Made for Khuram to watch (not a test: it records, it does not assert much).
 *
 * Its own `next start` (PORT, default 3441) on a throwaway SQLite database with self sign-up on for ClinDesk
 * (CLINFORMS_SELF_SIGNUP=clinic), clinic.localhost:<port> standing for clindesk.co.uk; email to a FAKE Mailpit started
 * here (emails are shown on screen from what the app sent); texts to the test service (CLINIC_SMS_PROVIDER=test). Payments: the ClinDesk payment account's TEST mode – the TEST
 * key from ~/.config/appstackx/clinforms.secrets.env (STRIPE_CLINDESK_TEST_SECRET_KEY, read here, never printed) and the
 * provider's CLI (`stripe listen`) forwarding the webhooks of plan payments and text-credit packs. Test card 4242 only.
 * Fictional data only (clinic, owner, patient, employer). The test subscription and customers are deleted at the end.
 *
 * Drafting from the notes is ON from sign-up for a self-serve clinic (14/11/2026) – the video shows it switched on
 * without a manual step. DRAFTING=live (default) drafts the report for real when a drafting key is available: the
 * ANTHROPIC_API_KEY line of DRAFTING_ENV_FILE (default the main checkout's .env.local) is read here and passed to the
 * server only (never printed); the notes are fictional; one report costs a few pence and uses 1 of the trial's 10 free
 * reports. Without a key, or with DRAFTING=demo, the server runs in demo mode: nothing is drafted for a new patient and
 * the clinician writes the answers (the step list says so).
 *
 * The browser runs with slowMo (SLOWMO, default 250 ms) and records 1440x900 video; a caption banner is put into the
 * page before each step. Steps (captions):
 *    1 the ClinDesk website              2 Start a free trial              3 read the data processing agreement
 *    4 the form + tick box               5 the confirmation email          6 confirm with the password
 *    7 two-step sign-in set-up           8 the free trial (banner, welcome email)
 *    9 the sample clinic                10 settings basics (clinic details, site and hours, service)
 *   11 a practitioner (the owner) + rota 12 a patient                      13 book an appointment
 *   14 move it                          15 arrived, start treatment       16 write and sign the clinical note
 *   17 invoice the visit, take payment  18 send a text (credits)          19 buy a text pack (test card)
 *   20 Reports: a report from the notes, approved                        21 Plan and billing: choose a plan, pay
 *   22 the trial ends – paid, data kept (the end date is moved into the past in the scratch database: a test clock)
 *   23 remove the sample clinic
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/record-customer-journey.cjs
 *     [VIDEO_OUT=<file.mp4>] [STEPS_OUT=<file.md>] [PORT=3441] [SLOWMO=250] [DRAFTING=live|demo] [DRAFTING_ENV_FILE=…]
 *
 * Output: the MP4 (ffmpeg converts the browser's webm; without ffmpeg the webm is kept) and a step list with video
 * timestamps (.md). Working files: E2E_OUT (default .e2e-out/record-customer-journey, gitignored).
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync, spawnSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");
const { payByCard } = require("./hosted-checkout.cjs");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3441);
const MAIL_PORT = PORT + 1;
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const SLOWMO = Number(process.env.SLOWMO || 250);
const DAY = new Date().toISOString().slice(0, 10);
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "record-customer-journey");
const VIDEO_OUT = process.env.VIDEO_OUT || path.join(os.homedir(), "Projects/Appstackx/clinforms-owner-steps/videos", `clindesk-trial-journey-${DAY}.mp4`);
const STEPS_OUT = process.env.STEPS_OUT || VIDEO_OUT.replace(/\.mp4$/, ".md");
fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
fs.mkdirSync(path.dirname(VIDEO_OUT), { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-record-"));
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
const KEY = testKey();
/** The drafting key for live drafting (value never printed), or "" → demo mode. */
function draftingKey() {
  if ((process.env.DRAFTING || "live") !== "live") return "";
  const file = process.env.DRAFTING_ENV_FILE || path.join(os.homedir(), "Projects/Appstackx/clinforms/.env.local");
  try {
    const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}
const DRAFT_KEY = draftingKey();
const LIVE = DRAFT_KEY.length > 20;
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
// A clinic name (and so a clinic id) of its own per run: the payment service keeps a customer per clinic id for a day.
const RUN_WORD = Array.from(crypto.randomBytes(5), (b) => "abcdefghijklmnopqrstuvwxyz"[b % 26]).join("");
const OWNER = {
  email: `dana.lark.${Date.now().toString(36)}@larkfield-physio.example.com`,
  name: "Dana Lark",
  clinic: `Larkfield ${RUN_WORD[0].toUpperCase()}${RUN_WORD.slice(1)} Physio (fictional)`,
  password: `Larkfield ${rnd(9)} trial`,
};
const PATIENT = { first: "Olivia", last: "Bennett", dob: "09/04/1990", mobile: "07700 900123", email: "olivia.bennett@example.com" };

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
async function waitMail(to, re, ms = 20000) {
  for (let i = 0; i < ms / 250; i++) {
    const m = mailsTo(to, re).at(-1);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/* ------------------------------------------------------------------ server + payment webhooks */
let WEBHOOK_SECRET = "";
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
    MEDREPORT_AI_MODE: LIVE ? "live" : "demo",
    ...(LIVE ? { ANTHROPIC_API_KEY: DRAFT_KEY } : {}),
    CLINFORMS_EMAIL_PROVIDER: "mailpit",
    MAILPIT_URL: `http://127.0.0.1:${MAIL_PORT}`,
    MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk",
    MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk",
    CLINFORMS_EMAIL_REPLY_TO: "hello@clinforms.co.uk",
    CLINFORMS_EMAIL_REPLY_TO_CLINIC: "hello@clindesk.co.uk",
    CLINFORMS_PLATFORM_ADMINS: "zz-platform-record@example.com",
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    CLINFORMS_SELF_SIGNUP: "clinic",
    STRIPE_CLINDESK_SECRET_KEY: KEY,
    STRIPE_CLINDESK_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
}
let server = null;
let serverLog = "";
const children = [];
async function startServer() {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: appEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(server);
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
let listenerLog = "";
function startListeners() {
  const routes = [
    ["/api/billing/stripe-webhook", "checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed"],
    ["/api/clinic-messages/credit-payments", "checkout.session.completed,payment_intent.succeeded"],
  ];
  for (const [to, events] of routes) {
    const l = spawn("stripe", ["listen", "--forward-to", `${FORMS}${to}`, "--events", events], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    children.push(l);
    l.stdout.on("data", (d) => (listenerLog += d));
    l.stderr.on("data", (d) => (listenerLog += d));
  }
}
function stopChild(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // gone
  }
}
async function api(method, pathname) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, { method, headers: { authorization: `Bearer ${KEY}` } });
  const json = await res.json();
  if (json.livemode === true) throw new Error("live answer refused");
  return json;
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
    if (30000 - (Date.now() % 30000) > 6000) return totp(key);
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  }
}

/* ------------------------------------------------------------------ scratch database (the test clock, ids) */
function one(q, ...a) {
  const db = openScratchDb();
  try {
    return db.prepare(q).get(...a);
  } finally {
    db.close();
  }
}
function run(q, ...a) {
  const db = openScratchDb();
  try {
    return db.prepare(q).run(...a);
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ captions + step log */
let page = null;
let t0 = 0;
let current = "";
const log = [];
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
async function inject(text) {
  if (!page || !text) return;
  await page
    .evaluate((t) => {
      let el = document.getElementById("__journey_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__journey_caption";
        el.setAttribute("aria-hidden", "true");
        el.style.cssText =
          "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;" +
          "background:rgba(15,23,42,0.9);color:#fff;font:600 24px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;" +
          "padding:12px 26px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);max-width:1180px;text-align:center;";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = t;
    }, text)
    .catch(() => {});
}
async function caption(text) {
  current = text;
  await inject(text);
}
const hold = (ms = 1500) => page.waitForTimeout(ms);
/** Shows an email the app sent, as the owner would see it (its own HTML), with the caption on top. */
async function showEmail(mail) {
  const head = `<div style="font:14px system-ui;background:#F1F5F9;border-bottom:1px solid #CBD5E1;padding:14px 24px;color:#334155">
    <div><b>From:</b> ${mail.From?.Name || ""} &lt;${mail.From?.Email || ""}&gt;</div><div><b>To:</b> ${(mail.To || []).map((t) => t.Email).join(", ")}</div>
    <div><b>Subject:</b> ${String(mail.Subject).replace(/</g, "&lt;")}</div></div>`;
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${head}<div style="padding:12px 0">${mail.HTML || `<pre>${mail.Text}</pre>`}</div></body></html>`);
  await inject(current);
}

const steps = [];
let stopped = null;
async function step(n, title, fn) {
  if (stopped) {
    steps.push({ n, title, at: null, status: "not reached", note: `stopped after step ${stopped}` });
    return;
  }
  const at = Date.now() - t0;
  await caption(`${n}. ${title}`);
  try {
    const note = await fn();
    steps.push({ n, title, at, status: "shown", note: note || "" });
    console.log(`OK   ${mmss(at)} ${n}. ${title}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).split("\n")[0].slice(0, 300);
    steps.push({ n, title, at, status: "FAILED", note: msg });
    console.log(`FAIL ${mmss(at)} ${n}. ${title}: ${msg}`);
    await page.screenshot({ path: path.join(OUT, `fail-step-${n}.png`), fullPage: true }).catch(() => {});
    stopped = n;
  }
}

/* ------------------------------------------------------------------ run */
(async () => {
  await new Promise((r) => mailServer.listen(MAIL_PORT, "127.0.0.1", r));
  WEBHOOK_SECRET = execFileSync("stripe", ["listen", "--print-secret"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY }, encoding: "utf8", timeout: 30000 }).trim();
  if (!/^whsec_[A-Za-z0-9]+$/.test(WEBHOOK_SECRET)) throw new Error("no webhook secret from the CLI");
  await startServer();
  startListeners();
  await new Promise((r) => setTimeout(r, 3000)); // the listeners connect

  const browser = await chromium.launch({ slowMo: SLOWMO, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(OUT, "raw"), size: { width: 1440, height: 900 } },
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  page = await ctx.newPage();
  t0 = Date.now();
  page.setDefaultTimeout(45000);
  page.on("domcontentloaded", () => void inject(current));
  let tenant = "";
  let sampleTenant = "";
  let patientId = "";
  let slot = "";

  try {
    await step(1, "The ClinDesk website", async () => {
      await page.goto(`${DESK}/`);
      await inject(current);
      await hold(2500);
      await page.mouse.wheel(0, 700);
      await hold(1500);
      await page.mouse.wheel(0, -700);
      await hold(800);
    });

    await step(2, "Start a free trial – 14 days, no card needed", async () => {
      await page.locator("a[href='/start-trial']:visible").first().click();
      await page.waitForURL((u) => u.pathname === "/start-trial");
      await page.waitForSelector("#f-clinicName");
      await hold(2000);
    });

    await step(3, "Read the data processing agreement (section 10: what happens to trial data)", async () => {
      await page.goto(`${DESK}/data-processing-agreement`);
      await hold(1500);
      // Section 10 at the top of the screen, clear of the caption: the free trial's 90-day rule.
      await page.locator("h2:has-text('10. Return and deletion')").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -90));
      await hold(4000);
      await page.goto(`${DESK}/start-trial`);
      await page.waitForSelector("#f-clinicName");
    });

    await step(4, "Fill in the form and tick the agreement box", async () => {
      await page.locator("#f-clinicName").pressSequentially(OWNER.clinic, { delay: 25 });
      await page.locator("#f-ownerName").pressSequentially(OWNER.name, { delay: 40 });
      await page.fill("#f-email", OWNER.email);
      await page.fill("#f-password", OWNER.password);
      await page.fill("#f-confirm", OWNER.password);
      await page.check("#f-accept");
      await hold(2500);
      await page.click("button:has-text('Start free trial')");
      await page.waitForSelector("[data-testid=signup-sent]");
      await hold(2500);
    });

    await step(5, "The confirmation email – open the link", async () => {
      const mail = await waitMail(OWNER.email, /Confirm your email/);
      if (!mail) throw new Error("no confirmation email");
      const link = ((mail.Text || "").match(/https?:\/\/\S+\/start-trial\/confirm\?token=[A-Za-z0-9._%-]+/) || [])[0];
      if (!link) throw new Error("no link in the email");
      await showEmail(mail);
      await hold(3500);
      await page.goto(link);
      await page.waitForSelector("#f-password");
      await hold(1000);
    });

    await step(6, "Confirm with your password – the clinic is created", async () => {
      await page.fill("#f-password", OWNER.password);
      await page.click("button:has-text('Confirm and create my clinic')");
      await page.waitForURL((u) => u.pathname === "/two-factor", { timeout: 30000 });
      await hold(1500);
    });

    await step(7, "Set up two-step sign-in (authenticator app)", async () => {
      await page.fill("#f-password", OWNER.password);
      await page.click("button[type=submit]");
      await page.waitForSelector("img[alt^='Authenticator set-up code']");
      await hold(2500);
      OWNER.key = (await page.locator("code").first().innerText()).replace(/\s+/g, "");
      await page.check("input[name=saved]");
      await page.locator("#f-code").pressSequentially(await freshCode(OWNER.key), { delay: 60 });
      await page.click("button[type=submit]");
      await page.waitForURL((u) => u.pathname === "/app/clinic", { timeout: 30000 });
      tenant = one('SELECT o.slug FROM member m JOIN organization o ON o.id = m."organizationId" JOIN "user" u ON u.id = m."userId" WHERE u.email = ?', OWNER.email).slug;
    });

    await step(8, "Your free trial: the banner shows the days and free reports left", async () => {
      await hold(3500);
      const welcome = await waitMail(OWNER.email, /Welcome to ClinDesk/, 15000);
      if (welcome) {
        await caption("8. Your free trial: the welcome email");
        await showEmail(welcome);
        await hold(3500);
        await page.goto(`${DESK}/app/clinic`);
        await hold(1000);
      }
      return welcome ? `banner + "${welcome.Subject}"` : "banner (no welcome email arrived)";
    });

    await step(9, "Explore with sample data – a separate sample clinic", async () => {
      await page.locator("[data-testid=sample-offer]").waitFor();
      await hold(1500);
      await page.click("[data-testid=sample-create]");
      // The sample clinic is made, then the page moves into it (one or two navigations): wait until it is open.
      await page.waitForFunction(() => /sample clinic \(fictional\)/i.test(document.body.innerText), undefined, { timeout: 120000 });
      await page.waitForLoadState("networkidle");
      sampleTenant = one("SELECT sample_tenant_id FROM self_trial WHERE tenant_id = ?", tenant).sample_tenant_id;
      await hold(2500);
      await page.goto(`${DESK}/app/clinic/diary`);
      await hold(3000);
      await caption("9. Switch back to your own clinic");
      await page.goto(`${DESK}/app/select-clinic`);
      await hold(1500);
      await page
        .locator("form")
        .filter({ has: page.locator("p", { hasText: new RegExp(`^${OWNER.clinic.replace(/[()]/g, "\\$&")}$`) }) })
        .locator("button:has-text('Open')")
        .click();
      await page.waitForURL((u) => u.pathname.startsWith("/app/clinic"), { timeout: 30000 });
      await hold(1500);
      const n = one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", sampleTenant).n;
      return `sample clinic with ${n} made-up patients`;
    });

    await step(10, "Settings basics: clinic details, a site and its opening hours, a service", async () => {
      await page.goto(`${DESK}/app/settings/clinic`);
      await page.fill("#f-address", "1 High Street\nLarkfield");
      await page.fill("#f-postcode", "MK9 9ZZ");
      await page.fill("#f-phone", "01632 960123");
      await page.fill("#f-email", "reception@larkfield-physio.example.com");
      // Drafting from the notes: already on – switched on at sign-up (the DPA was accepted online); no step needed.
      await page.locator("#f-drafting").scrollIntoViewIfNeeded();
      if (!(await page.locator("#f-drafting").isChecked())) throw new Error("drafting from the notes is not on after sign-up");
      await caption("10. Drafting from the notes is already on – switched on when you signed up");
      await hold(3500);
      await caption("10. Settings basics: clinic details, a site and its opening hours, a service");
      await page.click("button:has-text('Save clinic details')");
      await page.waitForSelector("[role=status] >> text=Saved.", { timeout: 20000 }).catch(() => {});
      await hold(1200);
      await page.goto(`${DESK}/app/clinic/setup/sites`);
      await page.fill("#new-site-name", "Larkfield High Street (fictional)");
      await page.fill("#new-site-phone", "01632 960123");
      await page.fill("#new-site-address", "1 High Street, Larkfield");
      await page.fill("#new-site-postcode", "MK9 9ZZ");
      await page.click("[data-testid=new-site-save]");
      await page.waitForSelector("[data-testid=hours-1-from]", { timeout: 20000 });
      await hold(1200);
      // Open every day 07:00–21:00, so the recording works at any time of day.
      for (let d = 1; d <= 7; d++) {
        const closed = page.locator(`[data-testid=hours-${d}-closed]`);
        if (await closed.isChecked()) await closed.uncheck();
        await page.fill(`[data-testid=hours-${d}-from]`, "07:00");
        await page.fill(`[data-testid=hours-${d}-to]`, "21:00");
      }
      await page.click("[data-testid=site-save]");
      await page.waitForSelector("text=Opening hours saved.", { timeout: 20000 }).catch(() => {});
      await hold(1200);
      await page.goto(`${DESK}/app/clinic/setup/services?service=new`);
      await page.fill("#service-name", "Physiotherapy – initial assessment");
      await page.selectOption("#service-category", { label: "Initial appointment" }).catch(() => {});
      await page.fill("#service-duration", "45");
      await page.fill("#service-price", "65");
      await page.click("[data-testid=service-save]");
      await page.waitForSelector("main >> text=£65.00", { timeout: 20000 });
      await hold(1500);
    });

    await step(11, "Add a practitioner (you) and set the working pattern", async () => {
      await page.goto(`${DESK}/app/clinic/setup/practitioners?practitioner=new`);
      await page.fill("#pr-name", OWNER.name);
      await page.fill("#pr-reg", "PH-DEMO-01");
      await page.selectOption("#pr-member", { index: 1 });
      await page.selectOption("#pr-site", { index: 1 });
      await hold(800);
      await page.click("[data-testid=practitioner-save]");
      await page.waitForSelector("[data-testid=practitioner-rota]", { timeout: 20000 });
      await hold(1200);
      await page.click("[data-testid=practitioner-rota]");
      await page.waitForSelector("text=Weekly working pattern");
      for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
        await page.getByRole("switch", { name: d }).click();
        await page.fill(`input[aria-label="${d} start"]`, "07:00");
        await page.fill(`input[aria-label="${d} end"]`, "20:00");
      }
      await hold(800);
      await page.click("button:has-text('Save rota')");
      await page.waitForSelector("text=/Rota saved/", { timeout: 20000 });
      await hold(1500);
    });

    await step(12, "Add a patient (made up)", async () => {
      await page.goto(`${DESK}/app/clinic/patients/new`);
      const f = page.locator("form#new-patient-page");
      await f.locator("select[name=title]").selectOption("Ms");
      await f.locator("input[name=firstName]").pressSequentially(PATIENT.first, { delay: 50 });
      await f.locator("input[name=lastName]").pressSequentially(PATIENT.last, { delay: 50 });
      await f.locator("input[name=dateOfBirth]").fill(PATIENT.dob);
      await f.locator("input[name=phoneMobile]").fill(PATIENT.mobile);
      await f.locator("input[name=email]").fill(PATIENT.email);
      await f.locator("input[name=reminderSms]").check();
      await f.locator("input[name=reminderEmail]").check();
      await f.locator("input[name=consentTreatment]").check();
      await hold(1200);
      await f.locator("button[name=intent]:has-text('Save and book')").click();
      await page.waitForURL((u) => u.pathname === "/app/clinic/diary", { timeout: 30000 });
      patientId = new URL(page.url()).searchParams.get("patient") || "";
    });

    await step(13, "Book an appointment in the diary", async () => {
      await page.waitForSelector("#bk-search");
      await page.waitForSelector("text=Chosen:");
      await page.waitForFunction(() => document.querySelectorAll("#bk-tm option").length > 10);
      // A whole hour today between 08:00 and 17:00 (past times can be booked too).
      const h = Math.min(17, Math.max(8, Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" }).format(new Date()))));
      slot = `${String(h).padStart(2, "0")}:00`;
      await page.selectOption("#bk-tm", slot);
      await page.waitForSelector(`#bk-slot >> text=/free ${slot}/`, { timeout: 15000 }).catch(() => {});
      await hold(2000);
      await page.click("role=dialog >> button:has-text('Book appointment')");
      await page.waitForSelector("text=Appointment booked");
      await hold(1800);
      await page.click("text=Back to diary");
      await page.waitForSelector("[data-diary-ready=true]");
      await hold(1500);
      return `today ${slot}`;
    });

    await step(14, "Move the appointment an hour later", async () => {
      const block = page.locator(`button[data-status=booked]:has-text("${PATIENT.first} ${PATIENT.last}")`).first();
      await block.click();
      await hold(1200);
      await page.click("button:has-text('Move')");
      for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
      await hold(1200);
      await page.keyboard.press("Enter");
      await page.waitForSelector("[role=status] >> text=/moved to/", { timeout: 15000 }).catch(() => {});
      await hold(2000);
    });

    await step(15, "The patient arrives – mark Arrived, then Start treatment", async () => {
      await page.locator(`button[data-status]:has-text("${PATIENT.first} ${PATIENT.last}")`).first().click();
      await hold(1000);
      await page.click("button:has-text('Arrived')");
      await hold(2000);
      await page.click("button:has-text('Start treatment')");
      await page.waitForSelector("#section-subjective", { timeout: 30000 });
      await hold(1500);
    });

    await step(16, "Write and sign the clinical note", async () => {
      await page.locator("#section-subjective").pressSequentially("Right shoulder pain for 6 weeks after decorating. Worse reaching overhead. Goal: back to swimming.", { delay: 12 });
      for (const flag of ["Weight loss", "Night pain unrelated to position", "Fever", "Trauma", "Neurological signs"]) await page.check(`label:has-text('${flag} – none') input`);
      await page.fill("#section-objective", "Active flexion 120°, painful arc 70–110°. Strength 4/5 external rotation.");
      await page.fill("#section-assessment", "Rotator cuff related shoulder pain.");
      await page.fill("#section-plan", "Isometric loading, home exercises, review in 1 week. Avoid overhead lifting for 2 weeks.");
      await page.fill("#section-consent", "Verbal consent given");
      await page.waitForSelector("text=/Draft saved/", { timeout: 20000 }).catch(() => {});
      await hold(2000);
      await page.getByRole("button", { name: "Sign and lock" }).first().click();
      await page.waitForSelector("text=Sign this note?");
      await hold(1800);
      // The confirm dialog's own button, not the page's footer button of the same name.
      await page.getByRole("alertdialog").getByRole("button", { name: "Sign and lock" }).click();
      await page.waitForSelector("text=Signed and locked", { timeout: 20000 });
      await hold(2500);
    });

    await step(17, "Invoice the visit and take payment", async () => {
      await page.goto(`${DESK}/app/clinic/billing`);
      await hold(1200);
      await page.click("[data-testid=invoice-visits-button]");
      await page.waitForSelector("button:has-text('Preview drafts')");
      await hold(1200);
      await page.click("button:has-text('Preview drafts')");
      await page.waitForSelector("[data-testid=draft-preview]");
      await hold(1500);
      await page.click("button:has-text('Create drafts')");
      await page.waitForSelector("[data-testid=visits-done]");
      await page.locator("[data-testid=visits-done] a[href*='/invoices/']").first().click();
      await page.waitForSelector("[data-testid=issue-invoice]");
      await hold(1200);
      await page.click("[data-testid=issue-invoice]");
      await page.click("role=alertdialog >> button:has-text('Issue invoice')");
      await page.waitForSelector("[role=status] >> text=Invoice issued");
      await hold(1500);
      await page.click("[data-testid=record-payment]");
      await page.waitForSelector("[data-testid=take-payment-submit]:not([disabled])");
      await hold(1800);
      await page.click("[data-testid=take-payment-submit]");
      await page.waitForSelector("[data-testid=take-payment-done]");
      await hold(1500);
      await page.click("[data-testid=take-payment] button:has-text('Done')");
      await hold(2000);
      return "£65.00, card reader";
    });

    let toast = "";
    await step(18, "Send the patient a text – it uses a text credit", async () => {
      await page.goto(`${DESK}/app/clinic/messages`);
      await hold(1500);
      await page.goto(`${DESK}/app/clinic/messages?tab=send&patient=${patientId}`);
      await page.waitForSelector("[data-testid=send-form]");
      await page.check("input[name=sm-channel][value=sms]");
      await page.locator("#sm-b").pressSequentially("Hello {{patient.first_name}}, your home exercises are ready. See you next week – Larkfield Physio", { delay: 15 });
      await hold(1500);
      await page.click("[data-testid=send-now]");
      await page.waitForSelector("[role=status] >> text=/Sent|held|quiet/i", { timeout: 15000 }).catch(() => {});
      toast = ((await page.locator("[role=status]").allInnerTexts().catch(() => [])).filter((t) => !/Free trial/.test(t)).join(" ") || "").trim();
      await hold(1500);
      await page.goto(`${DESK}/app/clinic/messages/credits`);
      await hold(3000);
      return `${toast || "sent"}; balance ${one("SELECT balance FROM pms_sms_credit_accounts WHERE tenant_id = ?", tenant).balance}`;
    });

    await step(19, "Buy a text pack – 500 credits (test card 4242)", async () => {
      await page.click("[data-testid=buy-sms_500]");
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await hold(2500);
      await payByCard(page, { email: OWNER.email, name: "Dana Lark (fictional)" });
      await page.waitForURL((u) => u.pathname === "/app/clinic/messages/credits/done", { timeout: 120000 });
      await hold(3000);
      return `balance ${one("SELECT balance FROM pms_sms_credit_accounts WHERE tenant_id = ?", tenant).balance}`;
    });

    await step(20, "Reports: signing details, then a report from the patient's notes", async () => {
      await page.goto(`${DESK}/app/settings/members`);
      const me = page.locator("li", { has: page.locator("summary:has-text('Manage')") }).first();
      await me.locator("summary:has-text('Manage')").click();
      await me.locator("input[name=jobTitle]").fill("Physiotherapist");
      // A test number in the register's format (letters, then digits) – not a real registration.
      await me.locator("input[name=hcpcNumber]").fill("ZZ0001");
      await me.locator("input[name=canSign]").check();
      await me.locator("button:has-text('Save signing details')").click();
      await me.locator("text=Saved.").waitFor({ timeout: 20000 });
      await hold(1200);
      await page.goto(`${DESK}/app/clinic`);
      await page.click("text=Go to Reports");
      await page.waitForURL((u) => u.pathname === "/app/studio", { timeout: 30000 });
      await hold(1800);
      await page.goto(`${DESK}/app/studio/new`);
      await page.fill(
        "#paste-notes",
        [
          `Patient: ${PATIENT.first} ${PATIENT.last}`,
          `Date of birth: ${PATIENT.dob}`,
          "Instructing party: Brightwater Logistics (fictional)",
          "Instructing party type: employer",
          "",
          `${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" }).format(new Date())} – Initial assessment – Dana Lark (ZZ0001)`,
          "S: Right shoulder pain for 6 weeks after decorating. Works as a warehouse supervisor; lifting above shoulder height is painful. Goal: back to swimming.",
          "O: Active flexion 120 degrees, painful arc 70-110 degrees. Strength 4/5 external rotation.",
          "A: Rotator cuff related shoulder pain.",
          "P: Isometric loading, home exercises, review in 1 week. Avoid overhead lifting for 2 weeks.",
        ].join("\n"),
      );
      await hold(1500);
      await page.click("button:has-text('Use pasted notes')");
      await page.waitForSelector("text=Check what was imported", { timeout: 30000 });
      await hold(3000);
      await page.click("button:has-text('Choose the referrer form')");
      await page.waitForSelector("text=Which referrer form?");
      await page.click("button:has-text('No form from the referrer? Use a built-in report')");
      await page.click("button:has-text('Fitness for work report (employer)')");
      const approver = page.locator("#approver-picker");
      if ((await approver.count()) && !(await approver.inputValue())) await approver.selectOption({ index: 1 });
      await hold(1500);
      await page.click("button:has-text('Draft the built-in report'):not([disabled])", { timeout: 20000 });
      const opened = page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 120000 }).then(() => "review");
      const offered = page.waitForSelector("a:has-text('Open for review')", { timeout: 120000 }).then(() => "offer");
      const how = await Promise.race([opened, offered]);
      Promise.allSettled([opened, offered]);
      // Whether anything was drafted: the wizard says which groups were left blank (demo mode, or the drafting service
      // refused this deployment's key) – the captions and the step list say what really happened.
      const blank = await page.locator("text=/Left blank for the clinician|could not be drafted/").count();
      const draftedLive = LIVE && blank === 0;
      if (how === "offer" && !/\/app\/studio\/rpt_/.test(page.url())) {
        await caption(
          draftedLive
            ? "20. The answers are drafted from the notes"
            : LIVE
              ? "20. The drafting service could not be reached from this local recording – the clinician writes the answers"
              : "20. Local recording in demo mode: nothing is drafted, so the clinician writes the answers",
        );
        await hold(4000);
        await page.click("a:has-text('Open for review')");
        await page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 30000 });
      }
      await page.waitForSelector("text=Saved", { timeout: 30000 });
      if (draftedLive) {
        await caption("20. Review: every drafted answer cites the note it came from");
        await hold(4500);
      }
      // Whatever was not drafted (nothing recorded for it, or a clinician-only answer) is written by the clinician.
      const answers = {
        "Reason for referral": "Referred by the employer for right shoulder pain of 6 weeks, which she reported began after decorating at home.",
        "Current functional status": "The treating physiotherapist recorded active flexion of 120 degrees with a painful arc and reduced strength in external rotation. She reported pain lifting above shoulder height.",
        "Treatment and attendance": "Initial assessment attended. Treatment: isometric loading and home exercises.",
        "Fitness for work (treating clinician's opinion)": "Fit for work with adjustments for 2 weeks.",
        "Recommended adjustments": "Avoid lifting above shoulder height for 2 weeks; ground-level and waist-height tasks only.",
        "Review date": "In 1 week, after the follow-up appointment.",
      };
      let written = 0;
      for (const [q, a] of Object.entries(answers)) {
        const box = page.locator(`textarea[aria-label="Answer to “${q}”"]`);
        if (!(await box.count()) || !(await box.first().isVisible().catch(() => false)) || (await box.first().inputValue()).trim()) continue;
        if (written === 0) await caption("20. The clinician writes what the notes do not say");
        await box.first().scrollIntoViewIfNeeded();
        if (written === 0) await box.first().pressSequentially(a, { delay: 10 });
        else await box.first().fill(a);
        written += 1;
      }
      await hold(1500);
      await page.click("button:has-text('Record consent')");
      await hold(1500);
      await caption("20. Approve: the clinician checks and signs the report");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click("button:has-text('Sign…')");
      const dlg = page.locator("[role=dialog]").filter({ hasText: "Sign the report" });
      await dlg.waitFor();
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await dlg.locator("input[id$='-typed']").pressSequentially(OWNER.name, { delay: 60 });
      await hold(1500);
      await dlg.locator("button:has-text('Sign report')").click();
      await page.waitForSelector("text=Signed – the report is final", { timeout: 60000 });
      await hold(3500);
      const used = one("SELECT reports_reserved AS n FROM self_trial WHERE tenant_id = ?", tenant)?.n;
      return draftedLive
        ? `drafted from the notes (live drafting); ${written} answer(s) written by the clinician; consent recorded; signed; trial reports reserved: ${used ?? "?"} of 10`
        : LIVE
          ? `NOT drafted: the drafting service refused this local recording's key (nothing drafted, nothing counted); ${written} answers written by the clinician; consent recorded; signed`
          : `demo mode: nothing drafted (no drafting service in this local recording); ${written} answers written by the clinician; consent recorded; signed`;
    });

    await step(21, "Plan and billing: choose a plan and pay (test card 4242)", async () => {
      await page.goto(`${DESK}/app/settings/billing`);
      await hold(1500);
      await page.locator("input[name=interval][value=month]").check();
      await page.locator("input[name=band][value=solo]").check();
      await page.selectOption("#plan-reports", { index: 1 });
      await hold(2000);
      await page.click("button:has-text('Continue to payment')");
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await hold(2500);
      await payByCard(page, { email: OWNER.email, name: "Dana Lark (fictional)" });
      await page.waitForURL((u) => u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      await page.locator("[data-testid=billing-done]").waitFor();
      await page.waitForSelector("[data-testid=billing-done][data-state=active]", { timeout: 60000 }).catch(() => {});
      await hold(3500);
      return "ClinDesk Solo + Reports (25 a month), monthly";
    });

    await step(22, "The trial ends – the clinic has paid, so everything is kept", async () => {
      // Test clock: the trial's end date moved into the past in the scratch database, then the daily job runs.
      const past = new Date(Date.now() - 3_600_000).toISOString();
      run("UPDATE clinic_plan SET trial_ends_at = ? WHERE tenant_id IN (?, ?)", past, tenant, sampleTenant);
      const cron = await fetch(`${FORMS}/api/cron/retention`, { headers: { authorization: `Bearer ${SECRETS.CRON_SECRET}` } });
      await caption("22. Test clock: the 14 days are over – the clinic is on its paid plan");
      await page.goto(`${DESK}/app/clinic`);
      await hold(3000);
      await caption("22. Every record is still there: patients, notes, invoices, reports");
      await page.goto(`${DESK}/app/clinic/patients`);
      await hold(2500);
      await page.goto(`${DESK}/app/clinic/billing`);
      await hold(2000);
      await page.goto(`${DESK}/app/studio`);
      await hold(2500);
      const paid = await waitMail(OWNER.email, /paid ClinDesk plan/, 10000);
      if (paid) {
        await caption("22. The email: you're on a paid plan");
        await showEmail(paid);
        await hold(3500);
      }
      const plan = one("SELECT status FROM clinic_plan WHERE tenant_id = ?", tenant).status;
      const patients = one("SELECT count(*) AS n FROM pms_patients WHERE tenant_id = ?", tenant).n;
      return `plan ${plan}, ${patients} patient kept, daily job ${cron.status}${paid ? ", paid-plan email" : ""}`;
    });

    await step(23, "Remove the sample clinic – only the made-up data goes", async () => {
      await page.goto(`${DESK}/app/clinic`);
      await page.click("[data-testid=remove-sample-start]");
      await page.waitForSelector("[data-testid=remove-sample-confirm]");
      await hold(2500);
      await page.click("[data-testid=remove-sample-yes]");
      await page.waitForURL(/\?sample=removed/, { timeout: 30000 });
      await page.waitForSelector("[data-testid=sample-removed]", { timeout: 30000 });
      await hold(3000);
      await caption("Done – a paid ClinDesk clinic, set up and in use");
      await hold(3000);
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
  } finally {
    const video = page.video();
    await ctx.close();
    await browser.close();
    for (const c of children) stopChild(c);
    // The payment service's test objects made by this run.
    const refs = [];
    try {
      const s = one("SELECT subscription_ref, customer_ref FROM clinic_subscription WHERE tenant_id = ?", tenant);
      if (s) refs.push(["subscriptions", s.subscription_ref], ["customers", s.customer_ref]);
      const c = one("SELECT customer_ref FROM pms_sms_credit_accounts WHERE tenant_id = ?", tenant);
      if (c && c.customer_ref) refs.push(["customers", c.customer_ref]);
    } catch {
      // database gone or tables missing
    }
    for (const [kind, id] of refs) if (id) await api("DELETE", `/${kind}/${id}`).catch(() => {});
    mailServer.close();
    const webm = video ? await video.path() : null;
    let finalPath = null;
    let seconds = null;
    if (webm && fs.existsSync(webm)) {
      const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", VIDEO_OUT]);
      if (ff.status === 0) finalPath = VIDEO_OUT;
      else {
        finalPath = VIDEO_OUT.replace(/\.mp4$/, ".webm");
        fs.copyFileSync(webm, finalPath);
      }
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", finalPath], { encoding: "utf8" });
      seconds = probe.status === 0 ? Math.round(Number(probe.stdout.trim())) : null;
    }
    const lines = [
      `# ClinDesk – a new clinic's journey, from the website to a paid plan (recorded ${DAY})`,
      "",
      `Video: \`${finalPath ? path.basename(finalPath) : "(not made)"}\`${seconds ? ` – ${mmss(seconds * 1000)} long` : ""}, 1440x900.`,
      "Recorded on a local production build (`next start`, clinic.localhost standing for clindesk.co.uk) by",
      "`scripts/e2e/record-customer-journey.cjs`. Payments in TEST mode (test card 4242), texts to the test service, emails",
      `caught locally and shown on screen, drafting ${LIVE ? "live (fictional notes)" : "in demo mode"}. Fictional data only: the clinic, owner (Dana Lark),`,
      "patient (Olivia Bennett) and employer are made up.",
      "",
      "| Time | Step | Shown | Notes |",
      "|---|---|---|---|",
      ...steps.map((s) => `| ${s.at === null ? "–" : mmss(s.at)} | ${s.n}. ${s.title} | ${s.status} | ${String(s.note || "").replace(/\|/g, "/")} |`),
      "",
      "Notes:",
      "- Step 13: past times today can be booked, so the slot is a whole hour between 08:00 and 17:00 whatever the time of the recording.",
      "- Steps 10 and 20: drafting from the notes is ON from sign-up for a clinic that signs up online (14/11/2026) – no",
      "  switch-on step.",
      LIVE
        ? "- Step 20: live drafting was attempted with fictional notes – see the step's note for whether it drafted."
        : "- Step 20: this recording ran in demo mode (DRAFTING=demo or no drafting key): nothing is drafted for a new patient, so the clinician wrote the answers. With a valid drafting key (DRAFTING_ENV_FILE) the same script shows the answers drafted.",
      "- Step 22: the 14 days cannot pass during a recording. The trial's end date is moved into the past in the scratch",
      "  database (a test clock) and the daily job is run, as the trial's own end-to-end test does.",
    ];
    fs.writeFileSync(STEPS_OUT, `${lines.join("\n")}\n`);
    const scrub = (s) => s.replace(/token=[^\s"&]+/g, "token=…");
    fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
    fs.writeFileSync(path.join(OUT, "listener.log"), listenerLog.replace(/whsec_[A-Za-z0-9]+/g, "whsec_…"));
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\nvideo: ${finalPath} (${seconds ?? "?"} s)\nsteps: ${STEPS_OUT}`);
    const failed = steps.filter((s) => s.status !== "shown");
    console.log(`${steps.length - failed.length}/${steps.length} steps shown`);
    process.exit(failed.length ? 1 : 0);
  }
})();
