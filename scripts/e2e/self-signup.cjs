/**
 * SELF-SERVE SIGN-UP (12/11/2026, tracker l01, docs/auth.md §1b) – end to end in a real browser, LOCAL only. Modelled
 * on journey-clindesk-only.cjs: its own `next start` (PORT, default 3421) on a throwaway SQLite database, BETTER_AUTH_URL
 * = http://localhost:<port>, CLINFORMS_AUTH_ORIGINS = http://clinic.localhost:<port>, email to a FAKE Mailpit started
 * here (sender name, subject, text and links checked). No payment service, no real accounts, fictional data only.
 *
 *   OFF  the server WITHOUT CLINFORMS_SELF_SIGNUP: /start-trial, /start-trial/confirm, /data-processing-agreement → 404
 *        on both hosts; the sign-in page keeps "Request access"; POST /api/auth/sign-up/email refused (404)
 *   ON   restarted with CLINFORMS_SELF_SIGNUP=clinic,forms:
 *     S1  ClinDesk host: sign-in → "Start a free trial" → the DPA page (DRAFT banner) → form → "Check your email" →
 *         ClinDesk email, link on clinic.localhost → password → two-step set-up → the clinic system with the free
 *         trial's banner (13/11/2026: the trial – scripts/e2e/trial-journey.cjs covers it end to end); acceptance
 *         row, audit row, the clinic system and Reports on as "trial"
 *     S2  ClinForms host: the same, ClinForms' email and host, the overview with the trial banner
 *     S3  a disposable address is refused with a message; the honeypot / fast-fill answer "Check your email", no email
 *     S4  the ClinDesk owner's address again: the SAME page answer, a "You already have an account" email, no clinic
 *     S5  the 4th sign-up from this network today is refused ("Too many sign-ups from this network today")
 *     S6  the used link is no longer valid; the sign-up HTTP endpoint is still refused with the switch on
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/dutydesk/node_modules node scripts/e2e/self-signup.cjs
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3421);
const MAIL_PORT = PORT + 1;
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "self-signup");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-signup-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");

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
const OWNERS = {
  clinic: { email: `dana.ss.${STAMP}@larkfield-physio.example.com`, name: "Dana Lark", clinic: "Larkfield Physio (fictional)", password: `e2e ${rnd(12)} password` },
  forms: { email: `hal.ss.${STAMP}@harbour-physio.example.com`, name: "Hal Harbour", clinic: "Harbour Physio (fictional)", password: `e2e ${rnd(12)} password` },
};

/* ------------------------------------------------------------------ results */
const results = [];
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
const mailsTo = (to) => mails.filter((m) => (m.To || []).some((t) => t.Email === to));
async function waitMail(to, re, after = 0) {
  for (let i = 0; i < 40; i++) {
    const m = mailsTo(to).filter((x) => re.test(x.Subject)).slice(after).at(-1);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
const linkIn = (m, re) => (((m && m.Text) || "").match(re) || [])[0] || null;

/* ------------------------------------------------------------------ server */
function appEnv(extra = {}) {
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
    CLINFORMS_PLATFORM_ADMINS: "zz-platform-ss@example.com",
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    ...extra,
  };
}
let server = null;
let serverLog = "";
async function startServer(extra) {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: appEnv(extra), stdio: ["ignore", "pipe", "pipe"], detached: true });
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
async function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // gone
  }
  await new Promise((r) => setTimeout(r, 1500));
  server = null;
}
/** fetch with a Host header for the clinic brand (Node's fetch cannot resolve clinic.localhost on every machine). */
function get(base, p, init = {}) {
  const u = new URL(p, base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: u.pathname + u.search, method: init.method || "GET", headers: { host: u.host, ...(init.headers || {}) } },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
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

/* ------------------------------------------------------------------ the journey of one brand */
async function fillSignupForm(page, who, { email = who.email, waitMs = 3500 } = {}) {
  await page.fill("#f-clinicName", who.clinic);
  await page.fill("#f-ownerName", who.name);
  await page.fill("#f-email", email);
  await page.fill("#f-password", who.password);
  await page.fill("#f-confirm", who.password);
  await page.check("#f-accept");
  await page.waitForTimeout(waitMs); // a person takes more than 3 seconds; the form refuses faster ones quietly
  await page.click("button:has-text('Start free trial')");
}

async function signUpJourney(page, base, who, brand) {
  const host = new URL(base).host;
  const productName = brand === "clinic" ? "ClinDesk" : "ClinForms";
  const notes = [];
  await page.goto(`${base}/login`);
  await page.click("a:has-text('Start a free trial')");
  await page.waitForURL(`${base}/start-trial`);
  assert.match(await page.title(), new RegExp(productName));
  const pot = await page.locator("input[name=website]").boundingBox();
  assert.ok(!pot || pot.x + pot.width < 0, `honeypot off screen (${JSON.stringify(pot)})`);
  await page.screenshot({ path: path.join(SHOTS, `${brand}-01-form.png`), fullPage: true });
  // The DPA page (draft, marked) and the terms link from the form.
  const dpaHref = await page.locator("a:has-text('data processing agreement')").getAttribute("href");
  const termsHref = await page.locator("a:has-text('terms of service')").getAttribute("href");
  assert.equal(dpaHref, "/data-processing-agreement");
  assert.equal(termsHref, "/terms");
  const dpa = await page.context().newPage();
  await dpa.goto(`${base}${dpaHref}`);
  const draft = (await dpa.locator("[data-testid=dpa-draft]").innerText()).trim();
  assert.match(draft, /DRAFT – pending legal review/);
  assert.match(await dpa.locator("h1").innerText(), /Data processing agreement/);
  assert.match(await dpa.locator("main").innerText(), new RegExp(productName));
  await dpa.screenshot({ path: path.join(SHOTS, `${brand}-02-dpa.png`), fullPage: true });
  const terms = await dpa.goto(`${base}${termsHref}`);
  assert.equal(terms.status(), 200, "terms page");
  await dpa.close();

  await fillSignupForm(page, who);
  await page.waitForSelector("[data-testid=signup-sent]");
  await page.screenshot({ path: path.join(SHOTS, `${brand}-03-sent.png`), fullPage: true });
  const mail = await waitMail(who.email, /Confirm your email/);
  assert(mail, "confirmation email");
  assert.equal(mail.From && mail.From.Name, productName, `sender name ${mail.From && mail.From.Name}`);
  assert.equal(mail.From && mail.From.Email, brand === "clinic" ? "no-reply@clindesk.co.uk" : "no-reply@clinforms.co.uk");
  assert.match(mail.Subject, new RegExp(productName));
  const other = brand === "clinic" ? /clin\s*forms/i : /clin\s*desk/i;
  assert.doesNotMatch(`${mail.Subject}\n${mail.Text}`, other, "the email names its own brand only");
  const link = linkIn(mail, /https?:\/\/\S+\/start-trial\/confirm\?token=[A-Za-z0-9._%-]+/);
  assert(link, "link in the email");
  assert.equal(new URL(link).host, host, "link on the brand's own host");
  notes.push(`email "${mail.Subject}" from ${mail.From.Name} <${mail.From.Email}>`);

  await page.goto(link);
  await page.waitForSelector("text=Confirm your email and create your clinic");
  assert.match(await page.locator("main").innerText(), new RegExp(who.clinic.replace(/[()]/g, "\\$&")));
  await page.screenshot({ path: path.join(SHOTS, `${brand}-04-confirm.png`), fullPage: true });
  await page.fill("#f-password", "not the password at all");
  await page.click("button:has-text('Confirm and create my clinic')");
  await page.waitForSelector("text=That password does not match");
  await page.fill("#f-password", who.password);
  await page.click("button:has-text('Confirm and create my clinic')");
  await page.waitForURL((u) => u.pathname === "/two-factor", { timeout: 30000 });
  assert.equal(new URL(page.url()).host, host);
  await page.fill("#f-password", who.password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const uri = await page.locator("a[href^='otpauth://']").getAttribute("href");
  assert.equal(new URL(uri).searchParams.get("issuer"), productName);
  who.key = (await page.locator("code").first().innerText()).replace(/\s+/g, "");
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(who.key));
  await page.click("button[type=submit]");
  // /app/start redirects on to the clinic's own start page (13/11/2026: the free trial is running).
  await page.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
  const landed = new URL(page.url());
  assert.equal(landed.host, host, "stays on the brand's host");
  // 13/11/2026: the free trial runs – the clinic's own start page, with the trial banner (no plan to choose first).
  const expected = brand === "clinic" ? "/app/clinic" : "/app";
  assert.equal(landed.pathname, expected, `lands on ${expected} (got ${landed.pathname})`);
  const banner = (await page.locator("[data-testid=trial-banner]").innerText()).replace(/\s+/g, " ");
  assert.match(banner, /Free trial – 14 days left · 0 of 10 free reports used/);
  await page.screenshot({ path: path.join(SHOTS, `${brand}-05-start.png`), fullPage: true });
  notes.push(`landed on ${landed.pathname}`);

  // The database: the clinic, its brand, the owner, the acceptance and the audit rows.
  const db = openScratchDb({ readOnly: true });
  try {
    const user = db.prepare('SELECT id, "emailVerified" AS ev FROM "user" WHERE email = ?').get(who.email);
    assert(user, "owner account");
    const member = db.prepare('SELECT m.role, o.slug, o.metadata FROM member m JOIN organization o ON o.id = m."organizationId" WHERE m."userId" = ?').get(user.id);
    assert.equal(member.role, "owner");
    who.tenant = member.slug;
    if (brand === "clinic") assert.match(String(member.metadata), /signupBrand/);
    else assert.equal(member.metadata, null);
    const ent = db.prepare("SELECT package, status FROM clinic_entitlements WHERE tenant_id = ? ORDER BY package").all(member.slug);
    if (brand === "clinic") assert.deepEqual(ent.map((e) => `${e.package}:${e.status}`), ["clinic:trial", "reports:trial"]);
    else assert.equal(ent.length, 0);
    const acc = db.prepare("SELECT user_id, brand, terms_version, dpa_version, ip_hash, ua_hash, accepted_at, confirmed_at FROM signup_acceptances WHERE tenant_id = ?").all(member.slug);
    assert.equal(acc.length, 1);
    assert.equal(acc[0].user_id, user.id);
    assert.equal(acc[0].brand, brand === "clinic" ? "clinic" : "clinforms");
    assert.match(acc[0].terms_version, brand === "clinic" ? /^clindesk-terms-/ : /^clinforms-terms-/);
    assert.match(acc[0].dpa_version, /^dpa-draft-/);
    assert.ok(acc[0].ip_hash && acc[0].ua_hash && !/127\.0\.0\.1|local/.test(acc[0].ip_hash));
    const actions = db.prepare("SELECT action FROM audit_log WHERE tenant_id = ? ORDER BY at").all(member.slug).map((r) => r.action);
    for (const a of ["clinic.create", "member.join", "clinic.self_signup", "auth.two_factor_enable"]) assert.ok(actions.includes(a), `${a} audited (${actions.join(", ")})`);
    const reqRow = db.prepare("SELECT password_hash, completed_at FROM signup_requests WHERE email = ?").get(who.email);
    assert.equal(reqRow.password_hash, null, "password hash cleared");
    assert.ok(reqRow.completed_at);
    notes.push(`clinic ${member.slug}, acceptance ${acc[0].terms_version} + ${acc[0].dpa_version}, audit ${actions.join(",")}`);
  } finally {
    db.close();
  }
  who.link = link;
  return notes.join("; ");
}

/* ------------------------------------------------------------------ run */
const livePages = [];
(async () => {
  await new Promise((r) => mailServer.listen(MAIL_PORT, "127.0.0.1", r));
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newPage = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    livePages.push([who, page]);
    return page;
  };
  try {
    /* OFF – the default */
    await startServer({});
    await step("OFF", "switch off: sign-up pages 404 on both hosts, sign-in unchanged, sign-up endpoint refused", async () => {
      const seen = [];
      for (const base of [FORMS, DESK]) {
        for (const p of ["/start-trial", "/start-trial/confirm?token=abcdefghijklmnopqrstuvwxyz", "/data-processing-agreement"]) {
          const r = await get(base, p);
          assert.equal(r.status, 404, `${base}${p} → ${r.status}`);
          seen.push(`${new URL(base).host}${p.split("?")[0]} 404`);
        }
        const login = await get(base, "/login");
        assert.equal(login.status, 200);
        assert.ok(!/Start a free trial/.test(login.body), "no trial link on the sign-in page");
        assert.ok(/Request access/.test(login.body), "sign-in page unchanged");
        const api = await get(base, "/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ email: `x.${STAMP}@larkfield-physio.example.com`, password: "a long enough password", name: "X" }),
        });
        assert.ok(api.status === 404 || api.status === 403, `sign-up endpoint ${api.status}`);
        seen.push(`${new URL(base).host} POST /api/auth/sign-up/email ${api.status}`);
      }
      const db = openScratchDb({ readOnly: true });
      try {
        assert.equal(db.prepare('SELECT count(*) AS n FROM "user"').get().n, 0, "no account was created");
      } finally {
        db.close();
      }
      return seen.join(", ");
    });
    await stopServer();

    /* ON */
    await startServer({ CLINFORMS_SELF_SIGNUP: "clinic,forms" });
    const desk = await newPage("desk-owner");
    await step("S1", "ClinDesk: sign-in → trial → DPA (draft) → form → email → link → password → two-step → the clinic system, trial banner", () => signUpJourney(desk, DESK, OWNERS.clinic, "clinic"));
    const forms = await newPage("forms-owner");
    await step("S2", "ClinForms: the same on ClinForms' host", () => signUpJourney(forms, FORMS, OWNERS.forms, "forms"));

    const anon = await newPage("anon");
    await step("S3", "disposable address refused with a message; honeypot and fast fill quietly dropped (no email)", async () => {
      await anon.goto(`${DESK}/start-trial`);
      const who = { ...OWNERS.clinic, clinic: "Throwaway Physio (fictional)" };
      await fillSignupForm(anon, who, { email: `t.${STAMP}@mailinator.com` });
      await anon.waitForSelector("[data-testid=error-email]");
      const msg = await anon.locator("[data-testid=error-email]").innerText();
      assert.match(msg, /work email/);
      // Honeypot filled (as a naive bot would)
      const before = mails.length;
      await anon.goto(`${DESK}/start-trial`);
      await anon.evaluate(() => {
        document.querySelector("input[name=website]").value = "http://spam.example";
      });
      await fillSignupForm(anon, { ...who }, { email: `bot.${STAMP}@larkfield-physio.example.com` });
      await anon.waitForSelector("[data-testid=signup-sent]");
      // Filled too fast
      await anon.goto(`${DESK}/start-trial`);
      await fillSignupForm(anon, { ...who }, { email: `fast.${STAMP}@larkfield-physio.example.com`, waitMs: 0 });
      await anon.waitForSelector("[data-testid=signup-sent]");
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(mails.length, before, "no email for the bot or the fast form");
      return `disposable: "${msg}"; bot and fast fill: "Check your email", 0 emails`;
    });

    await step("S4", "an address with an account: the same answer, a 'you already have an account' email, nothing created", async () => {
      await anon.goto(`${DESK}/start-trial`);
      const sentPage = async () => (await anon.locator("[data-testid=signup-sent]").innerText()).replace(/\s+/g, " ");
      await fillSignupForm(anon, { ...OWNERS.clinic, clinic: "Second Clinic (fictional)" });
      await anon.waitForSelector("[data-testid=signup-sent]");
      const answer = await sentPage();
      const mail = await waitMail(OWNERS.clinic.email, /already have/);
      assert(mail, "existing-account email");
      assert.equal(mail.From.Name, "ClinDesk");
      assert.ok(linkIn(mail, new RegExp(`${DESK.replace(/[.]/g, "\\.")}/login`)), "sign-in link on the ClinDesk host");
      assert.ok(!/start-trial\/confirm/.test(mail.Text), "no sign-up link");
      const db = openScratchDb({ readOnly: true });
      try {
        assert.equal(db.prepare("SELECT count(*) AS n FROM organization WHERE name = ?").get("Second Clinic (fictional)").n, 0);
      } finally {
        db.close();
      }
      // The answer for a NEW address reads exactly the same (S1's page text).
      return `answer "${answer.slice(0, 80)}…", email "${mail.Subject}"`;
    });

    await step("S5", "the 4th sign-up from this network today is refused", async () => {
      await anon.goto(`${FORMS}/start-trial`);
      await fillSignupForm(anon, { ...OWNERS.forms, clinic: "Fourth Physio (fictional)" }, { email: `fourth.${STAMP}@harbour-physio.example.com` });
      await anon.waitForSelector("text=Too many sign-ups from this network today");
      return "refused with the network message";
    });

    await step("S6", "the used link is no longer valid; the sign-up HTTP endpoint is still refused with the switch on", async () => {
      await anon.goto(OWNERS.clinic.link);
      await anon.waitForSelector("text=Link not available");
      const api = await get(FORMS, "/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: FORMS },
        body: JSON.stringify({ email: `y.${STAMP}@harbour-physio.example.com`, password: "a long enough password", name: "Y" }),
      });
      assert.ok(api.status === 404 || api.status === 403, `sign-up endpoint ${api.status}`);
      const db = openScratchDb({ readOnly: true });
      try {
        assert.equal(db.prepare('SELECT count(*) AS n FROM "user" WHERE email = ?').get(`y.${STAMP}@harbour-physio.example.com`).n, 0);
      } finally {
        db.close();
      }
      return `endpoint ${api.status}`;
    });

    await step("X1", "no page errors in the browser", () => {
      assert.deepEqual(problems, []);
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    await browser.close();
    await stopServer();
    mailServer.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=[^\s"&]+/g, "token=…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "emails.json"), scrub(JSON.stringify(mails.map((m) => ({ at: m.at, from: m.From, to: m.To, subject: m.Subject, text: m.Text })), null, 2)));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  process.exit(failed.length ? 1 : 0);
})();
