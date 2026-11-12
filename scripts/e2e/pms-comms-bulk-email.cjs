/**
 * BULK EMAIL (tracker xt02, docs/clinic-system/comms.md "Bulk email") – end to end in a real browser, LOCAL only.
 * Its own `next start` (PORT, default 3186) on a throwaway SQLite database with the demo clinic
 * (`pms:seed-demo -- --fresh`, fictional data only), patient email to a FAKE Mailpit started here (nothing is sent to
 * anyone; the fake keeps what it is handed in memory).
 *
 *   OFF  the server WITHOUT CLINFORMS_BULK_EMAIL: /app/clinic/messages/campaigns, /new and /<id> → 404; no "Bulk email"
 *        link on Messages; no marketing-consent panel on a patient's Messages tab
 *   ON   restarted with CLINFORMS_BULK_EMAIL=on (CLINIC_EMAIL_PROVIDER=mailpit):
 *     B1  the page shows the clinic's setting OFF (no "New bulk email"); the owner switches it on
 *     B2  a marketing draft: HTML refused, live count = the database's own count of consented adult patients (one
 *         per address), preview subject, saved
 *     B3  test copy → the fake Mailpit gets "[Test] …" at the owner's own address only
 *     B4  Send now → one email per counted address; each has List-Unsubscribe + List-Unsubscribe-Post (RFC 8058),
 *         the clinic's name and postal address and the unsubscribe link in the footer; never to a patient without
 *         consent; the report shows the sent count
 *     B5  the unsubscribe link: GET shows a button and changes nothing; one-click POST withdraws (consent off, event
 *         with the message id); a second POST answers the same and records nothing new; the report shows 1
 *         unsubscribed; the patient's Messages tab shows "No" and when it was withdrawn
 *     B6  a scheduled draft is cancelled before it goes (nothing sent)
 *     B7  reception (role staff): the bulk email pages are 404
 *     B8  375 px: the editor has no sideways scrolling; axe on the list and the editor
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/pms-comms-bulk-email.cjs
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
const PORT = Number(process.env.PORT || 3186);
const MAIL_PORT = PORT + 1;
// The OFF phase runs on PORT, the ON phase on PORT + 2 (a fresh process – a stopped `next start` can keep serving the
// browser's open keep-alive connections with its old environment). Cookies are not per port, so the session carries.
const ON_PORT = PORT + 2;
let SERVER_PORT = PORT;
let BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "pms-comms-bulk-email");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-bulk-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");
const AXE = require.resolve("axe-core/axe.min.js");
const CLINIC = "riverside-demo";
let CAMPAIGNS = `${BASE}/app/clinic/messages/campaigns`;

const rnd = (n = 24) => crypto.randomBytes(n).toString("base64url");
const SECRETS = {
  BETTER_AUTH_SECRET: `test-only-${rnd(32)}`,
  CLINFORMS_DATA_KEYS: JSON.stringify({
    t1: crypto.randomBytes(32).toString("base64"),
  }),
  CLINFORMS_DATA_KEY_ID: "t1",
  MEDREPORT_LAUNCH_SECRET: `test-only-launch-${rnd(16)}`,
  MEDREPORT_SIGNING_SECRET: `test-only-signing-${rnd(16)}`,
  MEDREPORT_PARTNER_KEY: `test-only-partner-${rnd(16)}`,
  TM3_SIM_TOKEN: `test-only-sim-${rnd(16)}`,
  CRON_SECRET: `test-only-cron-${rnd(16)}`,
};

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
    for (const [who, p] of livePages)
      await p
        .screenshot({
          path: path.join(OUT, `fail-${id}-${who}.png`),
          fullPage: true,
        })
        .catch(() => {});
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
const toOf = (m) => ((m.To || [])[0] || {}).Email || "";

/* ------------------------------------------------------------------ server */
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
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "mailpit",
    MAILPIT_URL: `http://127.0.0.1:${MAIL_PORT}`,
    ...extra,
  };
}
let server = null;
let serverLog = "";
async function startServer(extra) {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(SERVER_PORT)], {
    cwd: REPO,
    env: appEnv(extra),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
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
    for (const pid of execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .split(/\s+/)
      .filter(Boolean))
      process.kill(Number(pid), "SIGKILL");
  } catch {
    // none
  }
}
async function stopServer() {
  if (!server) return;
  const port = SERVER_PORT;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // gone
  }
  // Wait until the old server has really let go of the port: a graceful stop waits for the browser's open
  // keep-alive connections, and a server still answering would serve the next phase with the OLD environment.
  const pid = server.pid;
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

/* ------------------------------------------------------------------ TOTP + the owner's account */
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
async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length,
      target: v.nodes[0] && v.nodes[0].target.join(" "),
    }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
  return found.length ? `${found.length} minor` : null;
}

/* ------------------------------------------------------------------ the journey */
(async () => {
  await new Promise((r) => mailServer.listen(MAIL_PORT, "127.0.0.1", r));
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const sql = () => openScratchDb();
  const one = (q, ...a) => {
    const db = sql();
    try {
      return db.prepare(q).get(...a);
    } finally {
      db.close();
    }
  };
  const all = (q, ...a) => {
    const db = sql();
    try {
      return db.prepare(q).all(...a);
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
  let ctx = null;
  try {
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "40", "--app-url", BASE], {
      cwd: REPO,
      env: appEnv(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert(ownerLink, "owner invitation in the seed output");
    // A fixed, known shape for the checks: two consented adults share one address; one consented patient is under 18.
    const consented = all("SELECT id FROM pms_patients WHERE tenant_id = ? AND marketing_email = 1 AND status = 'active' AND email IS NOT NULL ORDER BY id", CLINIC);
    assert(consented.length >= 3, `the demo has consented patients (${consented.length})`);
    run("UPDATE pms_patients SET email = 'shared.family@example.com', date_of_birth = '1980-01-01' WHERE tenant_id = ? AND id IN (?, ?)", CLINIC, consented[0].id, consented[1].id);
    run("UPDATE pms_patients SET date_of_birth = '2013-06-01' WHERE tenant_id = ? AND id = ?", CLINIC, consented[2].id);

    await startServer({});
    ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-GB",
      timezoneId: "Europe/London",
    });
    const owner = await ctx.newPage();
    owner.setDefaultTimeout(45000);
    owner.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    livePages.push(["owner", owner]);
    await acceptInvite(owner, ownerLink, "Helen Ward (fictional)");
    const ownerEmail = one('SELECT u.email FROM "user" u JOIN member m ON m.userId = u.id WHERE m.role = ?', "owner").email;
    const patient = one("SELECT id FROM pms_patients WHERE tenant_id = ? ORDER BY id LIMIT 1", CLINIC).id;

    await step("OFF", "switch off: the bulk email pages are 404, no link, no consent panel", async () => {
      for (const p of ["", "/new", "/ecmp_01JZZZZZZZZZZZZZZZZZZZZZZZ"]) {
        const r = await owner.goto(`${CAMPAIGNS}${p}`);
        assert.equal(r.status(), 404, `${p || "/"} → ${r.status()}`);
      }
      await owner.goto(`${BASE}/app/clinic/messages`);
      await owner.locator("[data-testid=send-message-button]").waitFor();
      assert.equal(await owner.locator("[data-testid=bulk-email-link]").count(), 0);
      await owner.goto(`${BASE}/app/clinic/patients/${patient}/messages`);
      await owner.locator("[data-testid=patient-messages]").waitFor();
      assert.equal(await owner.locator("[data-testid=marketing-consent]").count(), 0);
    });

    await stopServer();
    SERVER_PORT = ON_PORT;
    BASE = `http://localhost:${ON_PORT}`;
    CAMPAIGNS = `${BASE}/app/clinic/messages/campaigns`;
    await startServer({ CLINFORMS_BULK_EMAIL: "on" });

    await step("B1", "switch on: the clinic's setting starts OFF; the owner switches it on", async () => {
      await owner.goto(`${BASE}/app/clinic/messages`);
      await owner.locator("[data-testid=send-message-button]").waitFor();
      await owner.locator("[data-testid=bulk-email-link]").click();
      await owner.waitForURL(CAMPAIGNS);
      await owner.locator("[data-testid=campaigns-home]").waitFor();
      assert.match(await owner.locator("main").innerText(), /Bulk email is switched off for this clinic/);
      assert.equal(await owner.locator("[data-testid=new-campaign]").count(), 0);
      await owner.goto(`${CAMPAIGNS}/new`);
      await owner.locator("[data-testid=bulk-email-off]").waitFor();
      assert.equal(await owner.locator("[data-testid=campaign-editor]").count(), 0, "no drafting while the clinic's setting is off");
      await owner.goto(CAMPAIGNS);
      await owner.locator("[data-testid=bulk-enabled]").check();
      await owner.locator("[data-testid=bulk-settings-save]").click();
      await owner.locator("[data-testid=new-campaign]").waitFor();
      assert.equal(one("SELECT enabled FROM pms_bulk_email_settings WHERE tenant_id = ?", CLINIC).enabled, 1);
      await owner.screenshot({
        path: path.join(OUT, "1-campaigns-on.png"),
        fullPage: true,
      });
      return axe(owner, "bulk email list");
    });

    const expected = () => {
      const adult = new Date(Date.now() - 0)
        .toISOString()
        .slice(0, 10)
        .replace(/^(\d{4})/, (y) => String(Number(y) - 18));
      return one(
        `SELECT count(*) AS patients, count(DISTINCT lower(email)) AS addresses FROM pms_patients p WHERE tenant_id = ? AND status = 'active' AND merged_into_id IS NULL
         AND email LIKE '%_@_%' AND marketing_email = 1 AND (date_of_birth IS NULL OR date_of_birth <= ?)
         AND NOT EXISTS (SELECT 1 FROM pms_patient_anonymisations a WHERE a.tenant_id = p.tenant_id AND a.patient_id = p.id)`,
        CLINIC,
        adult,
      );
    };
    let campaignUrl = null;
    let want = null;
    await step("B2", "a marketing draft: HTML refused, live count matches the database, preview, saved", async () => {
      await owner.locator("[data-testid=new-campaign]").click();
      await owner.waitForURL(`${CAMPAIGNS}/new`);
      await owner.fill("#cmp-name", "Winter Pilates (e2e)");
      await owner.fill("#cmp-subject", "New Pilates classes at {clinic_name}");
      await owner.fill("#cmp-body", "Hello {first_name},\n\n<b>bold</b>");
      await owner.locator("[data-testid=campaign-save]").click();
      await owner.locator("#cmp-body-error").waitFor();
      assert.match(await owner.locator("#cmp-body-error").innerText(), /HTML is not allowed/);
      await owner.fill("#cmp-body", "Hello {first_name},\n\nOur new classes start in January:\n\n- Mondays 18:00\n- Thursdays 09:30\n\nBook at the front desk.");
      want = expected();
      await owner.waitForFunction((n) => (document.querySelector("[data-testid=audience-count]") || {}).textContent?.includes(`${n} email`), want.addresses, { timeout: 15000 });
      const text = await owner.locator("[data-testid=audience-count]").innerText();
      assert.match(text, new RegExp(`${want.addresses} emails? would go now`), text);
      assert(want.patients > want.addresses, "the shared address counts once");
      assert.match(await owner.locator("[data-testid=preview-subject]").innerText(), /New Pilates classes at Riverside Physiotherapy/);
      await owner.locator("[data-testid=campaign-save]").click();
      await owner.waitForURL(/\/campaigns\/ecmp_/);
      campaignUrl = owner.url();
      await owner.locator("[data-testid=campaign-test]").waitFor();
      await owner.screenshot({
        path: path.join(OUT, "2-editor-draft.png"),
        fullPage: true,
      });
      return `${want.addresses} addresses (${want.patients} patients)`;
    });

    await step("B3", "test copy goes to the member's own address only", async () => {
      const before = mails.length;
      await owner.locator("[data-testid=campaign-test]").click();
      await owner.waitForSelector("text=/Test copy sent to/");
      const got = mails.slice(before);
      assert.equal(got.length, 1, `one test copy (${got.length})`);
      assert.equal(toOf(got[0]), ownerEmail);
      assert.match(got[0].Subject, /^\[Test\] New Pilates classes at /);
      assert.match(got[0].Text, /Test copy: each patient's email has its own one-click unsubscribe link/);
    });

    let patientMails = [];
    await step("B4", "Send now: one email per address, RFC 8058 headers, postal address and unsubscribe link in the footer", async () => {
      const before = mails.length;
      await owner.locator("[data-testid=campaign-send-now]").click();
      await owner.locator("[role=alertdialog] button:has-text('Send now')").click();
      await owner.waitForSelector("text=/Sending started/");
      const end = Date.now() + 20000;
      while (mails.length - before < want.addresses && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
      patientMails = mails.slice(before);
      assert.equal(patientMails.length, want.addresses, `${patientMails.length} emails for ${want.addresses} addresses`);
      const to = patientMails.map(toOf).map((x) => x.toLowerCase());
      assert.equal(new Set(to).size, to.length, "never twice to one address");
      assert.equal(to.filter((x) => x === "shared.family@example.com").length, 1);
      const consentedEmails = new Set(all("SELECT lower(email) AS e FROM pms_patients WHERE tenant_id = ? AND marketing_email = 1", CLINIC).map((r) => r.e));
      assert(
        to.every((x) => consentedEmails.has(x)),
        "only patients with marketing consent",
      );
      const teen = one("SELECT lower(email) AS e FROM pms_patients WHERE tenant_id = ? AND id = ?", CLINIC, consented[2].id).e;
      assert(!to.includes(teen), "never to a patient under 18");
      for (const m of patientMails) {
        assert.match(m.Headers["List-Unsubscribe"] || "", /^<http:\/\/localhost:\d+\/api\/clinic-messages\/unsubscribe\?t=[^>]+>$/);
        assert.equal(m.Headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
        assert.match(m.Text, /\n--\nRiverside Physiotherapy \(fictional\)\n2 Station Parade \(fictional\), Bletchley, Milton Keynes, MK2 9ZZ\n/, "name and postal address");
        assert.match(m.Text, /Unsubscribe from news and offers: http/);
        assert.equal(m.From.Name, "Riverside Physiotherapy (fictional)");
        assert.doesNotMatch(`${m.Subject}${m.Text}${m.HTML}`, /ClinDesk|ClinForms|\bAI\b/);
      }
      await owner.reload();
      await owner.locator("[data-testid=campaign-report]").waitFor();
      assert.equal(await owner.locator("[data-testid=campaign-status]").innerText(), "Sent");
      assert.equal((await owner.locator("[data-testid=report-sent]").innerText()).trim(), String(want.addresses));
      await owner.screenshot({
        path: path.join(OUT, "3-sent-report.png"),
        fullPage: true,
      });
      return `${patientMails.length} emails`;
    });

    await step("B5", "unsubscribe link: GET changes nothing, one-click POST withdraws, idempotent, counted", async () => {
      const m = patientMails.find((x) => toOf(x).toLowerCase() !== "shared.family@example.com");
      const url = /^<(.+)>$/.exec(m.Headers["List-Unsubscribe"])[1];
      const who = one("SELECT id FROM pms_patients WHERE tenant_id = ? AND lower(email) = ?", CLINIC, toOf(m).toLowerCase()).id;
      const anon = await browser.newContext();
      const page = await anon.newPage();
      await page.goto(url);
      assert.match(await page.locator("h1").innerText(), /Stop news and offers by email from Riverside Physiotherapy/);
      assert.equal(one("SELECT marketing_email FROM pms_patients WHERE tenant_id = ? AND id = ?", CLINIC, who).marketing_email, 1, "GET changes nothing");
      const post = () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        });
      const p1 = await post();
      assert.equal(p1.status, 200);
      assert.equal(one("SELECT marketing_email FROM pms_patients WHERE tenant_id = ? AND id = ?", CLINIC, who).marketing_email, 0);
      const p2 = await post();
      assert.equal(p2.status, 200, "a second click answers the same");
      const events = all(
        "SELECT message_id, source FROM pms_consent_events WHERE tenant_id = ? AND patient_id = ? AND purpose = 'marketing' AND channel = 'email' AND action = 'opt_out'",
        CLINIC,
        who,
      );
      assert.equal(events.length, 1, "recorded once");
      assert.equal(events[0].source, "email_link");
      assert(events[0].message_id, "with the message it came in");
      // The button on the page works too (another patient), without signing in.
      const m2 = patientMails.find((x) => x !== m && toOf(x).toLowerCase() !== "shared.family@example.com");
      if (m2) {
        await page.goto(/^<(.+)>$/.exec(m2.Headers["List-Unsubscribe"])[1]);
        await page.click("button:has-text('Stop these emails')");
        await page.waitForSelector("text=Done");
      }
      await anon.close();
      await owner.goto(campaignUrl);
      await owner.locator("[data-testid=campaign-report]").waitFor();
      assert.equal((await owner.locator("[data-testid=report-unsubscribed]").innerText()).trim(), m2 ? "2" : "1");
      await owner.goto(`${BASE}/app/clinic/patients/${who}/messages`);
      await owner.locator("[data-testid=marketing-consent]").waitFor();
      assert.equal((await owner.locator("[data-testid=marketing-consent-state]").innerText()).trim(), "No");
      assert.match(await owner.locator("[data-testid=marketing-consent-withdrawn]").innerText(), /Patient used the stop-emails link/);
      await owner.screenshot({
        path: path.join(OUT, "4-record-consent.png"),
        fullPage: true,
      });
      // Staff record it again (with how) – audited.
      await owner.locator("[data-testid=marketing-consent-record]").click();
      await owner.waitForFunction(() => document.querySelector("[data-testid=marketing-consent-state]")?.textContent?.trim() === "Yes");
    });

    await step("B6", "a scheduled email is cancelled before it goes – nothing sent", async () => {
      await owner.goto(`${CAMPAIGNS}/new`);
      await owner.locator("[data-testid=purpose-service]").check();
      await owner.fill("#cmp-name", "Christmas opening (e2e)");
      await owner.fill("#cmp-subject", "Christmas opening hours");
      await owner.fill("#cmp-body", "Hello {first_name},\n\nWe close from 24/12 to 2/1.");
      await owner.locator("[data-testid=campaign-save]").click();
      await owner.locator("#cmp-reason-error").waitFor();
      await owner.fill("#cmp-reason", "Tells patients the clinic is closed over Christmas");
      await owner.locator("[data-testid=campaign-save]").click();
      await owner.waitForURL(/\/campaigns\/ecmp_/);
      const tomorrow = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
      await owner.fill("#cmp-date", tomorrow);
      await owner.locator("[data-testid=campaign-schedule]").click();
      await owner.waitForFunction(() => /Scheduled/.test(document.querySelector("[data-testid=campaign-status]")?.textContent || ""));
      const before = mails.length;
      await owner.locator("[data-testid=campaign-cancel]").click();
      await owner.locator("[role=alertdialog] button:has-text('Cancel the email')").click();
      await owner.waitForFunction(() => /Cancelled/.test(document.querySelector("[data-testid=campaign-status]")?.textContent || ""));
      const id = owner.url().split("/").pop();
      assert.equal(one("SELECT status FROM pms_email_campaigns WHERE tenant_id = ? AND id = ?", CLINIC, id).status, "cancelled");
      assert.equal(one("SELECT count(*) AS n FROM pms_email_campaign_recipients WHERE tenant_id = ? AND campaign_id = ?", CLINIC, id).n, 0);
      assert.equal(mails.length, before);
    });

    await step("B8", "375 px: no sideways scrolling on the editor; axe on the editor", async () => {
      await owner.setViewportSize({ width: 375, height: 800 });
      await owner.goto(campaignUrl);
      await owner.locator("[data-testid=campaign-editor]").waitFor();
      const wide = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(wide <= 1, `sideways scroll ${wide}px`);
      await owner.screenshot({
        path: path.join(OUT, "5-editor-375.png"),
        fullPage: true,
      });
      await owner.setViewportSize({ width: 1440, height: 1000 });
      await owner.goto(`${CAMPAIGNS}/new`);
      await owner.locator("[data-testid=campaign-editor]").waitFor();
      return axe(owner, "bulk email editor");
    });

    await step("B7", "reception (role staff): the bulk email pages are 404 and Messages has no link", async () => {
      run("UPDATE member SET role = 'staff' WHERE role = 'owner' AND userId = (SELECT id FROM \"user\" WHERE email = ?)", ownerEmail);
      try {
        for (const p of ["", "/new", `/${campaignUrl.split("/").pop()}`]) assert.equal((await owner.goto(`${CAMPAIGNS}${p}`)).status(), 404, p);
        await owner.goto(`${BASE}/app/clinic/messages`);
        await owner.locator("[data-testid=send-message-button]").waitFor();
        assert.equal(await owner.locator("[data-testid=bulk-email-link]").count(), 0);
      } finally {
        run("UPDATE member SET role = 'owner' WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)", ownerEmail);
      }
    });

    if (problems.length) console.log(`page problems: ${problems.join(" | ")}`);
  } catch (err) {
    console.log(`FATAL ${String(err && err.stack ? err.stack : err).slice(0, 2000)}`);
    results.push({ id: "FATAL", pass: false });
  } finally {
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopServer();
    mailServer.close();
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUT, "server.log"), serverLog.replace(/token=[A-Za-z0-9._%-]+/g, "token=[hidden]"));
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
