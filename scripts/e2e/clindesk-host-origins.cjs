/**
 * The clinic system on the clinic brand's host (31/10/2026, fix/clindesk-host-origins) in a real browser, LOCAL only:
 * this script starts its own `next start` on a throwaway SQLite database with BETTER_AUTH_URL=http://localhost:<port>
 * and CLINFORMS_AUTH_ORIGINS=http://clinic.localhost:<port> (clinic.localhost stands for clindesk.co.uk), seeds the
 * demonstration clinic (`pms:seed-demo -- --fresh`, fictional data only) and signs in on clinic.localhost.
 *
 * Before the fix, the clinic area's route handlers compared Origin with the request URL, which `next start` builds
 * from its own localhost:<port> – so every POST from clinic.localhost (patient search, uploads, claim files) was
 * refused 403 CROSS_ORIGIN. Now every origin check accepts exactly the configured app origins.
 *
 *   S  seed: the owner's invitation goes to clinic.localhost; owner + a clinician (Priya Shah, PH-DEMO-03) join there
 *   D  clinic.localhost, signed in: patient search (booking dialog) → book an appointment → a note (autosave, sign
 *      and lock) → invoice attended visits → issue an invoice → "Complete referrer form" → the Studio with the case
 *      loaded → complete, approve and file the form back to the case
 *   X  each route class on clinic.localhost: its own origin accepted, a foreign origin refused – clinic route
 *      handlers (patient search, attachment upload), server actions (a captured note autosave replayed), the Report
 *      API (validate + a store write), the public request form; no Origin on a clinic route = refused
 *   F  localhost (ClinForms, regression): the same owner signs in there; the same checks with localhost's origin
 *      accepted and a foreign origin refused; the Studio opens
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/clindesk-host-origins.cjs
 *     [PORT=3191] [E2E_OUT=…]
 *
 * Throwaway secrets, passwords and TOTP keys are generated here and never printed; screenshots and results go to
 * E2E_OUT (default .e2e-out/clindesk-host-origins, gitignored); the database (in the OS temp folder) is deleted.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3191);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const EVIL = "http://evil.example";
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "clindesk-host-origins");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-host-origins-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE; // scratch-db.cjs
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
};
const RUN = crypto.randomBytes(3).toString("hex");
const OWNER = "owner@riverside-demo.example.com"; // scripts/pms/demo-data.ts
const CLIN = `zz-origins-clin-${RUN}@example.com`;
const MON1 = "2026-11-02";
const users = {};

const results = [];
async function check(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    results.push({ id, what, pass: false, error: String(err && err.message ? err.message : err).slice(0, 600) });
    console.log(`FAIL ${id} ${what}: ${String(err && err.message ? err.message : err).slice(0, 600)}`);
    for (const [who, page] of pages) await page.screenshot({ path: path.join(OUT, `fail-${id}-${who}.png`) }).catch(() => {});
  }
}
const pages = [];

/* ------------------------------------------------------------------ server + environment */
function appEnv() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  Object.assign(env, SECRETS, {
    NODE_ENV: "production",
    PORT: String(PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: FORMS,
    CLINFORMS_AUTH_ORIGINS: DESK,
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
  });
  return env;
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
async function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
  await new Promise((r) => setTimeout(r, 800));
  server = null;
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
const usedWindow = {};
async function freshCode(email) {
  for (;;) {
    const w = Math.floor(Date.now() / 30000);
    if (30000 - (Date.now() % 30000) > 3000 && usedWindow[email] !== w) {
      usedWindow[email] = w;
      return totp(users[email].key);
    }
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  }
}

/* ------------------------------------------------------------------ browser steps */
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
  return new URL(page.url()).pathname;
}

async function signIn(page, origin, email) {
  await page.goto(`${origin}/login`);
  if (new URL(page.url()).pathname.startsWith("/app")) return new URL(page.url()).pathname;
  await page.fill("#f-email", email);
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("#f-code");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.origin === origin && u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
  return new URL(page.url()).pathname;
}

async function inviteMember(page, origin, email, role) {
  await page.goto(`${origin}/app/settings/members`);
  const form = page.locator("form", { has: page.locator("button:has-text('Invite')") }).first();
  await form.locator("#f-email").fill(email);
  await form.locator("select[name=role]").selectOption(role);
  await form.locator("button:has-text('Invite')").click();
  const result = page.locator("[data-testid=invite-result]");
  await result.waitFor({ timeout: 30000 });
  const link = ((await result.innerText()).match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  if (link) return link;
  // the email provider is `log`: the link is in the server's output
  const re = new RegExp(`\\[email:log\\] to=${email.replace(/[.+]/g, "\\$&")}[\\s\\S]*?(https?://\\S+/accept-invite\\?token=\\S+)`, "g");
  const all = Array.from(serverLog.matchAll(re));
  assert(all.length > 0, "no invitation link");
  return all.at(-1)[1];
}

/** Resolve or acknowledge every open gap on the review screen (as scripts/e2e/pms-integration.cjs). */
async function resolveEverything(app) {
  try {
    const keys = await app.$$eval("[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
    for (const key of keys) {
      const card = app.locator(`[id='q-${key}']`);
      for (let guard = 0; guard < 6; guard++) {
        const quick = card.getByRole("button", { name: "Mark resolved" });
        if ((await quick.count()) && !(await card.locator("form").count())) {
          await quick.first().click({ timeout: 8000 });
          await app.waitForTimeout(250);
          continue;
        }
        const res = card.getByRole("button", { name: /^Resolve$/ });
        if (await res.count()) {
          await res.first().click({ timeout: 8000 });
          const ta = card.locator("form textarea").last();
          if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
          await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
          await app.waitForTimeout(250);
          continue;
        }
        const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
        if (await ack.count()) {
          await ack.first().click({ timeout: 8000 });
          await card.locator("form textarea").last().fill("Not recorded in the notes; returned without it after checking with the clinician.");
          await card.locator("form").getByRole("button", { name: /Acknowledge/ }).last().click();
          await app.waitForTimeout(250);
          continue;
        }
        break;
      }
    }
  } catch {
    await app.waitForTimeout(1000);
  }
}
async function answerOpen(app) {
  const keys = await app.$$eval("[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    const text = await card.innerText();
    if (!/no answer yet|Missing|needs your|Not answered|Answer this/i.test(text)) continue;
    await card.scrollIntoViewIfNeeded();
    const radios = card.locator("input[type=radio]");
    if (await radios.count()) {
      const yes = card.getByLabel("Yes", { exact: true });
      if (await yes.count()) await yes.first().check();
      else await radios.first().check();
    } else {
      const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
      if (await add.count()) await add.first().click();
      const box = card.locator("textarea, input[type=text], input:not([type])");
      if (await box.count()) {
        await box.first().fill(/DD\/MM\/YYYY|Date of injury/.test(text) ? "N/A" : /number|sessions/i.test(text) ? "6" : "Treated for rotator cuff related shoulder pain; improving with loading (fictional answer).");
      }
    }
    const h = card.locator("h3").first();
    if (await h.count()) await h.click();
    await app.waitForTimeout(250);
  }
}

/**
 * A request with the signed-in browser context's cookies and an explicit Origin, sent to 127.0.0.1 with the URL's
 * Host (Node cannot resolve *.localhost itself; the browser can – and a browser never lets a page set Origin).
 */
async function post(page, url, origin, opts = {}) {
  const u = new URL(url);
  const cookies = await page.context().cookies(url);
  const headers = { ...(opts.headers || {}), host: u.host };
  if (cookies.length) headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (origin) headers.origin = origin;
  const body = opts.data === undefined ? null : Buffer.isBuffer(opts.data) ? opts.data : Buffer.from(String(opts.data));
  if (body) headers["content-length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method: opts.method || "POST", path: u.pathname + u.search, headers }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const crossOrigin = (r) => r.status === 403 && /CROSS_ORIGIN/.test(r.body);
const reportOriginRefused = (r) => r.status === 403 && /ORIGIN_NOT_ALLOWED/.test(r.body);

/* ------------------------------------------------------------------ run */
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newPage = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    pages.push([who, page]);
    return page;
  };
  const s = {};
  try {
    /* -------------------------------- S: seed + accounts */
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "40"], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    // ClinForms' own demo-clinic switch (made-up PH-DEMO-0N signing numbers; the seed sets the clinic system's flag only).
    execFileSync("npm", ["run", "-s", "admin:set-demo-clinic", "--", "--slug", "riverside-demo", "--on"], { cwd: REPO, env: appEnv(), encoding: "utf8" });
    await startServer();
    const sql = openScratchDb();
    const one = (q, ...a) => sql.prepare(q).get(...a);

    const owner = await newPage("owner");
    const clin = await newPage("clinician");
    await check("S1", "seed: the demo clinic's owner invitation goes to clinic.localhost; owner joins there and lands in the clinic area", async () => {
      assert(ownerLink && new URL(ownerLink).origin === DESK, `owner link origin: ${ownerLink && new URL(ownerLink).origin}`);
      const landed = await acceptInvite(owner, ownerLink, OWNER, "Helen Ward (fictional)");
      assert(landed.startsWith("/app/clinic"), landed);
    });
    await check("S2", "a clinician (Priya Shah, PH-DEMO-03, may sign) joins on clinic.localhost", async () => {
      const link = await inviteMember(owner, DESK, CLIN, "clinician");
      assert.equal(new URL(link).origin, DESK);
      await acceptInvite(clin, link, CLIN, "Priya Shah");
      await owner.goto(`${DESK}/app/settings/members`);
      const row = owner.locator("li", { has: owner.locator(`p:text-is("${CLIN}")`) }).first();
      await row.locator("summary:has-text('Manage')").click();
      await row.locator("input[name=jobTitle]").fill("Physiotherapist");
      await row.locator("input[name=hcpcNumber]").fill("PH-DEMO-03");
      await row.locator("input[name=canSign]").check();
      await row.locator("button:has-text('Save signing details')").click();
      await row.locator("text=Saved.").waitFor({ timeout: 20000 }).catch(async (e) => {
        throw new Error(`${e.message.split("\n")[0]} – row: ${(await row.innerText()).replace(/\s+/g, " ")}`);
      });
      const user = one('select id from "user" where email = ?', CLIN);
      sql.prepare("update pms_practitioners set user_id = ? where tenant_id = 'riverside-demo' and display_name = 'Priya Shah'").run(user.id);
    });

    /* -------------------------------- D: the clinic system on clinic.localhost */
    const DIARY = `${DESK}/app/clinic/diary`;
    const searches = [];
    owner.on("response", (r) => {
      if (r.request().method() === "POST" && r.url().endsWith("/app/clinic/diary/api/patients")) searches.push(r.status());
    });
    await check("D1", "patient search: the booking dialog's search (POST diary/api/patients) answers 200 and lists Megan Hart", async () => {
      await owner.goto(`${DIARY}?date=${MON1}`);
      await owner.waitForSelector("[data-diary-ready=true]");
      await owner.click("main button:visible:has-text('New appointment')");
      await owner.waitForSelector("role=dialog >> text=New appointment");
      await owner.fill("#bk-search", "Megan");
      await owner.locator(`[role=option]:has-text("Megan Hart")`).first().click({ timeout: 20000 });
      await owner.waitForSelector("text=Chosen:");
      assert(searches.length > 0 && searches.every((st) => st === 200), `search statuses ${JSON.stringify(searches)}`);
      return `search statuses ${JSON.stringify(searches)}`;
    });
    await check("D2", "booking: the slot check says available; Book appointment → Appointment booked → the block is in the diary", async () => {
      await owner.waitForSelector("text=Slot available", { timeout: 20000 });
      await owner.click("role=dialog >> button:has-text('Book appointment')");
      await owner.waitForSelector("text=Appointment booked", { timeout: 30000 });
      await owner.click("text=Back to diary");
      await owner.waitForSelector(`[role=group] button:has-text("Megan Hart")`);
      await owner.screenshot({ path: path.join(OUT, "desk-booked.png") });
    });

    const emily = one("select id from pms_patients where tenant_id = 'riverside-demo' and import_ref = 'sim-int-001'");
    const kase = emily && one("select id from pms_cases where tenant_id = 'riverside-demo' and patient_id = ? and title like 'Right shoulder%'", emily.id);
    const actionReqs = [];
    clin.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"] && r.url().includes("/notes/")) actionReqs.push({ url: r.url(), headers: r.headers(), body: r.postDataBuffer() });
    });
    await check("D3", "notes: New note → text autosaves ('Draft saved') → Sign and lock → Signed and locked", async () => {
      assert(emily && kase, "seeded Emily Turner and her case");
      const MEGAN = one("select id from pms_patients where tenant_id = 'riverside-demo' and import_ref = 'sim-pat-001'") || emily;
      s.notePatient = MEGAN.id;
      await clin.goto(`${DESK}/app/clinic/patients/${MEGAN.id}`);
      await clin.click("section[aria-label='Patient summary'] button:has-text('New note')");
      await clin.waitForURL(/\/notes\/note_[0-9A-Z]+$/, { timeout: 30000 });
      await clin.waitForSelector("text=Unsigned draft");
      const first = clin.locator("textarea[id^='section-']").first();
      await first.fill("Follow-up: neck pain easing, sleeping better (fictional).");
      await clin.waitForSelector("text=/Draft saved \\d{2}:\\d{2}/", { timeout: 30000 });
      await clin.click("button:has-text('Sign and lock')");
      await clin.waitForSelector("[role=alertdialog] >> text=Sign this note?");
      await clin.click("[role=alertdialog] button:has-text('Sign and lock')");
      await clin.waitForSelector("text=Signed and locked", { timeout: 30000 });
      await clin.screenshot({ path: path.join(OUT, "desk-note-signed.png") });
    });
    await check("D4", "invoice: Invoice attended visits → Preview drafts → Create drafts → issue one → Invoice issued", async () => {
      await owner.goto(`${DESK}/app/clinic/billing`);
      await owner.click("[data-testid=invoice-visits-button]");
      await owner.waitForURL(/\/billing\/visits$/);
      await owner.waitForSelector("[data-testid=visits-table]");
      const rows = owner.locator("[data-testid=visits-table] tbody tr");
      assert((await rows.count()) > 0, "visits to invoice");
      const all = owner.locator("input[aria-label='Select all visits']");
      if (await all.isChecked()) await all.uncheck();
      await rows.first().locator("input[type=checkbox]").check();
      await owner.click("button:has-text('Preview drafts')");
      await owner.waitForSelector("[data-testid=draft-preview]");
      await owner.click("button:has-text('Create drafts')");
      await owner.waitForSelector("[data-testid=visits-done]");
      const href = await owner.locator("[data-testid=visits-done] a[href*='/invoices/']").first().getAttribute("href");
      await owner.goto(new URL(href, DESK).toString());
      await owner.click("[data-testid=issue-invoice]");
      await owner.click("role=alertdialog >> button:has-text('Issue invoice')");
      await owner.waitForSelector("[role=status] >> text=Invoice issued", { timeout: 30000 });
      await owner.screenshot({ path: path.join(OUT, "desk-invoice-issued.png") });
      return (await owner.locator("h1").innerText()).trim();
    });
    const casePath = emily && kase ? `${DESK}/app/clinic/patients/${emily.id}/cases/${kase.id}` : null;
    await check("D5", "Complete referrer form → Open in ClinForms → the Studio on clinic.localhost with the case loaded → Complete this form", async () => {
      await clin.goto(casePath);
      await clin.waitForSelector("[data-testid=referrer-forms]");
      await clin.click("[data-testid=complete-referrer-form]");
      await clin.getByRole("dialog").waitFor();
      await clin.click("[data-testid=open-in-clinforms]");
      await clin.waitForURL((u) => u.origin === DESK && /\/app\/studio\/new/.test(u.pathname), { timeout: 30000 });
      await clin.getByRole("button", { name: "Choose the referrer form" }).waitFor({ timeout: 60000 });
      assert(/Emily Turner/.test(await clin.locator("main").innerText()), "the patient is loaded");
      await clin.getByRole("button", { name: "Choose the referrer form" }).click();
      const radio = clin.getByRole("radio", { name: /Rehabilitation Progress Report/ }).first();
      await radio.waitFor({ timeout: 20000 });
      if (!(await radio.isChecked())) await radio.click();
      await clin.getByRole("button", { name: "Complete this form" }).click();
      const open = clin.locator("a:has-text('Open for review'), button:has-text('Open for review')").first();
      await Promise.race([open.waitFor({ timeout: 120000 }), clin.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 120000 })]);
      if (await open.count()) await open.click();
      await clin.waitForURL((u) => u.origin === DESK && /\/app\/studio\/rpt_[^/?]+$/.test(u.pathname), { timeout: 120000 });
      await clin.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
      await clin.screenshot({ path: path.join(OUT, "desk-studio-review.png") });
    });
    await check("D6", "the referrer form: approve and sign in the Studio on clinic.localhost → filed back to the case", async () => {
      for (let round = 0; round < 5; round++) {
        await answerOpen(clin);
        await resolveEverything(clin);
      }
      await clin.waitForTimeout(1500);
      await clin.getByRole("button", { name: /^Approve/ }).first().click();
      const dlg = clin.getByRole("dialog");
      await dlg.waitFor();
      const name = await dlg.getByLabel("Full name", { exact: true }).inputValue();
      await dlg.getByLabel(/Typed signature/).fill(name);
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await dlg.getByRole("button", { name: /Approve and sign/ }).click();
      await clin.getByText(/Approved – the completed form is final/).waitFor({ timeout: 90000 });
      await clin.getByText(/Filed .* to the clinic system record/).first().waitFor({ timeout: 90000 });
      await clin.goto(casePath);
      const row = clin.locator("[data-testid=filed-form]").first();
      await row.waitFor();
      assert(/Approved by Priya Shah/.test(await row.innerText()), await row.innerText());
      await clin.screenshot({ path: path.join(OUT, "desk-case-form-filed.png") });
    });

    /* -------------------------------- X: each route class, own origin vs a foreign one (clinic.localhost) */
    const searchUrl = (base) => `${base}/app/clinic/diary/api/patients`;
    const searchOpts = { headers: { "content-type": "application/json" }, data: JSON.stringify({ q: "Megan" }) };
    await check("X1", "clinic route handler (patient search) on clinic.localhost: its own origin 200, foreign 403, no Origin 403", async () => {
      const own = await post(owner, searchUrl(DESK), DESK, searchOpts);
      const evil = await post(owner, searchUrl(DESK), EVIL, searchOpts);
      const none = await post(owner, searchUrl(DESK), null, searchOpts);
      assert.equal(own.status, 200, `own ${own.status} ${own.body.slice(0, 120)}`);
      assert(/Megan Hart/.test(own.body), "results");
      assert(crossOrigin(evil), `foreign ${evil.status}`);
      assert(crossOrigin(none), `none ${none.status}`);
    });
    await check("X2", "clinic route handler (attachment upload) on clinic.localhost: its own origin passes the origin check, foreign 403", async () => {
      const url = `${DESK}/app/clinic/patients/${s.notePatient}/attachments/upload`;
      const own = await post(clin, url, DESK, { headers: { "content-type": "multipart/form-data; boundary=x" }, data: "--x--\r\n" });
      const evil = await post(clin, url, EVIL, { headers: { "content-type": "multipart/form-data; boundary=x" }, data: "--x--\r\n" });
      assert(!crossOrigin(own) && own.status < 500, `own ${own.status} ${own.body.slice(0, 120)}`);
      assert(crossOrigin(evil), `foreign ${evil.status}`);
      return `own ${own.status}`;
    });
    await check("X3", "server action (a captured note autosave) on clinic.localhost: replayed with its own origin 200, with a foreign origin refused", async () => {
      const a = actionReqs.find((r) => r.body && r.body.length > 0);
      assert(a, `a server action was captured (${actionReqs.length})`);
      const base = Object.fromEntries(Object.entries(a.headers).filter(([k]) => !/^(origin|host|content-length|cookie|connection)$/i.test(k)));
      const own = await post(clin, a.url, DESK, { headers: base, data: a.body });
      const evil = await post(clin, a.url, EVIL, { headers: base, data: a.body });
      assert.equal(own.status, 200, `own ${own.status}`);
      assert(evil.status >= 400, `foreign ${evil.status}`);
      return `own ${own.status}, foreign ${evil.status}`;
    });
    const validateOpts = { headers: { "content-type": "application/json" }, data: JSON.stringify({}) };
    await check("X4", "Report API (POST validate, PUT store settings) on clinic.localhost: its own origin passes, foreign 403 ORIGIN_NOT_ALLOWED", async () => {
      const own = await post(clin, `${DESK}/api/reports/v1/validate`, DESK, validateOpts);
      const evil = await post(clin, `${DESK}/api/reports/v1/validate`, EVIL, validateOpts);
      assert(!reportOriginRefused(own), `own ${own.status} ${own.body.slice(0, 160)}`);
      assert(reportOriginRefused(evil), `foreign ${evil.status}`);
      const sOwn = await post(clin, `${DESK}/api/reports/v1/store/settings`, DESK, { method: "PUT", ...validateOpts });
      const sEvil = await post(clin, `${DESK}/api/reports/v1/store/settings`, EVIL, { method: "PUT", ...validateOpts });
      assert(!reportOriginRefused(sOwn), `store own ${sOwn.status} ${sOwn.body.slice(0, 160)}`);
      assert(reportOriginRefused(sEvil), `store foreign ${sEvil.status}`);
      return `validate own ${own.status}, store own ${sOwn.status}`;
    });
    await check("X5", "public request form (POST /api/access-requests) on clinic.localhost: its own origin passes, foreign 403", async () => {
      const opts = { headers: { "content-type": "application/json" }, data: "{}" };
      const own = await post(owner, `${DESK}/api/access-requests`, DESK, opts);
      const evil = await post(owner, `${DESK}/api/access-requests`, EVIL, opts);
      assert(own.status !== 403, `own ${own.status} ${own.body.slice(0, 120)}`);
      assert.equal(evil.status, 403, `foreign ${evil.status}`);
      return `own ${own.status}`;
    });

    /* -------------------------------- F: localhost (ClinForms) unchanged */
    const formsOwner = await newPage("forms-owner");
    await check("F1", "localhost: the owner signs in there too (host-only session) and lands on /app", async () => {
      const landed = await signIn(formsOwner, FORMS, OWNER);
      assert(landed.startsWith("/app"), landed);
    });
    await check("F2", "localhost: patient search route with localhost's origin 200, foreign 403; the Report API and the request form likewise", async () => {
      const own = await post(formsOwner, searchUrl(FORMS), FORMS, searchOpts);
      const evil = await post(formsOwner, searchUrl(FORMS), EVIL, searchOpts);
      assert.equal(own.status, 200, `own ${own.status}`);
      assert(crossOrigin(evil), `foreign ${evil.status}`);
      const vOwn = await post(formsOwner, `${FORMS}/api/reports/v1/validate`, FORMS, validateOpts);
      const vEvil = await post(formsOwner, `${FORMS}/api/reports/v1/validate`, EVIL, validateOpts);
      assert(!reportOriginRefused(vOwn) && reportOriginRefused(vEvil), `validate ${vOwn.status}/${vEvil.status}`);
      const opts = { headers: { "content-type": "application/json" }, data: "{}" };
      const aOwn = await post(formsOwner, `${FORMS}/api/access-requests`, FORMS, opts);
      const aEvil = await post(formsOwner, `${FORMS}/api/access-requests`, EVIL, opts);
      assert(aOwn.status !== 403 && aEvil.status === 403, `access requests ${aOwn.status}/${aEvil.status}`);
    });
    await check("F3", "localhost: the diary's booking dialog search works in the browser; the Studio opens", async () => {
      const n = [];
      formsOwner.on("response", (r) => r.request().method() === "POST" && r.url().endsWith("/diary/api/patients") && n.push(r.status()));
      await formsOwner.goto(`${FORMS}/app/clinic/diary?date=${MON1}`);
      await formsOwner.waitForSelector("[data-diary-ready=true]");
      await formsOwner.click("main button:visible:has-text('New appointment')");
      await formsOwner.fill("#bk-search", "Megan");
      await formsOwner.locator(`[role=option]:has-text("Megan Hart")`).first().waitFor({ timeout: 20000 });
      assert(n.length > 0 && n.every((x) => x === 200), JSON.stringify(n));
      await formsOwner.goto(`${FORMS}/app/studio`);
      await formsOwner.waitForSelector("main");
      assert.equal(new URL(formsOwner.url()).origin, FORMS);
    });
    await check("X6", "no product errors in the browser", () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });
    sql.close();
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    await browser.close();
    await stopServer();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "server.log"), serverLog.replace(/token=\S+/g, "token=…"));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
