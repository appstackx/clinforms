/**
 * Packages and usage (25/10/2026) in a real browser against a local `next start` that this script starts itself on a
 * throwaway SQLite database (port 3250), with LIVE drafting for the clinic (the key is read from the main checkout's
 * .env.local and never printed; at most MAX_LIVE_CALLS drafting calls per run). Fictional data only (@example.com,
 * made-up patients, HCPC-format test numbers ZZ000N).
 *
 *   1. admin:set-package PREVIEW on the database saves nothing; the platform administrator creates the clinic and sets a
 *      Custom package (£300 a month, 1 report, extra £1.50 – a small allowance so two reports go over it) on
 *      /app/platform – audited.
 *   2. The owner joins, fills in the clinic details, switches drafting on, gives themself signing details; Plan & usage
 *      shows "Custom £300 a month" and "0 of 1 report" with the rule sentence.
 *   3. Report A: pasted notes → built-in report drafted LIVE in the Studio, RE-DRAFTED (one more live call for the same
 *      report), approved in the Studio, and approved AGAIN (the same approval replayed: a second receipt) – counts once.
 *   4. Report B: one live drafting call for a new report that is never approved – it still counts (drafting cost money).
 *   5. Plan & usage (owner): "2 of 1 report", the bar, approved 1, counted-but-not-approved 1, "1 extra report × £1.50 =
 *      £1.50 would be charged" + "Charging for extra reports starts once billing is set up", 6 months; no tokens or
 *      costs; no sideways scroll at 375 px. A clinician sees only "This month: 2 of 1 report."
 *   6. /app/platform/usage: the clinic's row (counted 2, approved 1, not approved 1, extra 1, £1.50, drafting calls =
 *      the live calls made, tokens and an estimated cost), totals, the CSV (formula-safe), and the database agrees.
 *
 *   npm run build
 *   NODE_PATH=<node_modules with playwright> node scripts/e2e/plan-usage.cjs     [PORT=3250] [E2E_OUT=…] [MAX_LIVE_CALLS=20]
 *
 * NO_LIVE=1: no drafting at all (no key needed) – steps 1–2, then the platform usage page against counters written
 * straight into the throwaway database (layout and numbers only).
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3250);
if (PORT < 3250 || PORT > 3269) throw new Error("Use a port from 3250 to 3269");
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "plan-usage");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const DB_FILE = path.join(OUT, `e2e-${Date.now()}.db`);
const MAX_LIVE_CALLS = Number(process.env.MAX_LIVE_CALLS || 20);
const NO_LIVE = process.env.NO_LIVE === "1";

/** The drafting key from the main checkout's .env.local (never printed). */
function draftingKey() {
  const candidates = [path.join(REPO, ".env.local"), path.resolve(REPO, "../../clinforms/.env.local")];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const line = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .find((l) => /^ANTHROPIC_API_KEY=/.test(l.trim()));
    const value = line
      ? line
          .trim()
          .slice("ANTHROPIC_API_KEY=".length)
          .replace(/^["']|["']$/g, "")
      : "";
    if (value) return value;
  }
  throw new Error("No drafting key in .env.local (main checkout)");
}

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
const RUN = Date.now().toString(36);
const PLATFORM = "zz-usage-platform@example.com";
const OWNER = { email: "zz-usage-owner@example.com", name: "Olive Usage (fictional)", hcpc: "ZZ0002", job: "Physiotherapist (fictional)" };
const CLIN = { email: "zz-usage-clinician@example.com", name: "Cal Usage (fictional)" };
const CLINIC = { name: "ZZ Usage Clinic (fictional)", slug: `zz-usage-${RUN}` };
const users = {};
const password = () => `e2e ${rnd(12)} password`;
/** The pages and links the steps share. */
const shared = { admin: null, owner: null, clinLink: null };

const results = [];
function check(id, what, fn) {
  try {
    const note = fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${typeof note === "string" ? note : JSON.stringify(note)}` : ""}`);
  } catch (err) {
    results.push({ id, what, pass: false, error: String(err && err.message ? err.message : err).slice(0, 500) });
    console.log(`FAIL ${id} ${what}: ${String(err && err.message ? err.message : err).slice(0, 500)}`);
  }
}

/* ------------------------------------------------------------------ server */
function appEnv() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  Object.assign(env, SECRETS, {
    NODE_ENV: "production",
    PORT: String(PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: BASE,
    CLINFORMS_PUBLIC_DEMO: "1",
    CLINFORMS_PLATFORM_ADMINS: PLATFORM,
    CLINFORMS_EMAIL_PROVIDER: "none",
    CLINFORMS_USD_GBP_RATE: "0.8",
    MEDREPORT_AI_MODE: "auto",
  });
  return env;
}

let server = null;
let serverLog = "";
async function startServer() {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], {
    cwd: REPO,
    env: NO_LIVE ? appEnv() : { ...appEnv(), ANTHROPIC_API_KEY: draftingKey() },
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

async function acceptInvite(page, link, email, name) {
  users[email] = { password: password() };
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", name);
  await page.fill("#f-password", users[email].password);
  await page.fill("#f-confirm", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  users[email].key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`, { timeout: 30000 });
}

const visibleText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

/** The platform usage table's row of a clinic, by column heading (lower case). */
async function usageRow(page, slug) {
  const norm = (t) => t.replace(/\s+/g, " ").trim();
  const headers = (await page.locator("[data-usage-table] thead th").allInnerTexts()).map((t) => norm(t).toLowerCase());
  const row = page.locator(`[data-usage-row='${slug}']`);
  await row.waitFor({ timeout: 20000 });
  const cells = [await row.locator("th").innerText(), ...(await row.locator("td").allInnerTexts())].map(norm);
  return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);

/* ------------------------------------------------------------------ live-call budget */
const liveDrafts = { requests: 0, live: 0, demo: 0, failed: 0 };
function watchDrafts(page) {
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/reports/v1/drafts")) liveDrafts.requests += 1;
  });
  page.on("response", async (r) => {
    if (r.request().method() !== "POST" || !r.url().endsWith("/api/reports/v1/drafts")) return;
    try {
      if (r.status() !== 200) {
        liveDrafts.failed += 1;
        return;
      }
      const body = await r.json();
      if (body && body.generation && body.generation.mode === "live") liveDrafts.live += 1;
      else liveDrafts.demo += 1;
    } catch {
      // body gone
    }
  });
  // Never more than the budget: further drafting requests are refused in the browser.
  return page.route("**/api/reports/v1/drafts", (route) => (liveDrafts.requests > MAX_LIVE_CALLS ? route.abort() : route.continue()));
}

/** Pasted fictional notes for one made-up patient. */
function notes(name, dob, complaint) {
  return [
    `Patient: ${name}`,
    `Date of birth: ${dob}`,
    "Instructing party: Northfield Assurance (fictional)",
    "Instructing party type: insurer",
    "",
    `01/10/2026 – Initial assessment – Olive Usage (${OWNER.hcpc})`,
    `S: ${complaint}`,
    "O: Range of movement reduced by about a third, pain at end of range.",
    "A: Soft tissue strain.",
    "P: Home exercises, review in two weeks.",
    "",
    `15/10/2026 – Follow-up – Olive Usage (${OWNER.hcpc})`,
    "S: Pain easing, back to normal daily activities.",
    "O: Range of movement nearly full.",
  ].join("\n");
}

/** The Studio wizard: pasted notes → built-in report → drafted (live for this clinic) → review. Returns the report id. */
async function draftBuiltInReport(page, text) {
  await page.goto(`${BASE}/app/studio/new`);
  await page.fill("#paste-notes", text);
  await page.click("button:has-text('Use pasted notes')");
  try {
    await page.waitForSelector("text=Check what was imported", { timeout: 30000 });
  } catch (err) {
    await shot(page, "xx-notes-not-read");
    throw new Error(`notes not read: ${(await visibleText(page)).slice(0, 1500)}`);
  }
  await page.click("button:has-text('Choose the referrer form')");
  await page.waitForSelector("text=Which referrer form?");
  await page.click("button:has-text('No form from the referrer? Use a built-in report')");
  await page.locator("button[role=radio]:has-text('Written for')").first().click();
  await page.click("button:has-text('Draft the built-in report')");
  const opened = page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 300000 }).then(() => "review");
  const offered = page.waitForSelector("a:has-text('Open for review')", { timeout: 300000 }).then(() => "offer");
  if ((await Promise.race([opened, offered])) === "offer" && !/\/app\/studio\/rpt_/.test(page.url())) {
    await page.click("a:has-text('Open for review')");
    await page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 30000 });
  }
  await Promise.allSettled([opened, offered]);
  await page.waitForSelector("text=Saved", { timeout: 60000 });
  return page
    .url()
    .split("/")
    .pop()
    .replace(/[?#].*$/, "");
}

/** Resolve or acknowledge every open gap on the review screen (as the other e2e scripts do). */
async function resolveEverything(app) {
  const keys = await app.$$eval("[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
  let actions = 0;
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    for (let guard = 0; guard < 6; guard++) {
      const quick = card.getByRole("button", { name: "Mark resolved" });
      if ((await quick.count()) && !(await card.locator("form").count())) {
        await quick.first().click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      const res = card.getByRole("button", { name: /^Resolve$/ });
      if (await res.count()) {
        await res.first().click();
        const ta = card.locator("form textarea").last();
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
        await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await ack.first().click();
        await card.locator("form textarea").last().fill("Not recorded in the notes; returned without it after checking with the clinician.");
        await card
          .locator("form")
          .getByRole("button", { name: /Acknowledge/ })
          .last()
          .click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      break;
    }
  }
  return actions;
}

/**
 * What still blocks approval after the gaps: a question only the clinician can answer (their opinion – written here in
 * their own words, fictional) and the patient's consent to share the records (recorded with today's date).
 */
async function clearBlocks(app) {
  const done = [];
  const opinions = app.locator("textarea[placeholder^='Write your clinical opinion']");
  for (let guard = 0; guard < 5 && (await opinions.count()); guard++) {
    const ta = opinions.first();
    const card = ta.locator("xpath=ancestor::article[1]");
    await ta.scrollIntoViewIfNeeded();
    if ((await ta.inputValue()).trim()) break;
    await ta.fill("In my opinion a full recovery is expected within six weeks with the home exercises (fictional test answer).");
    // The empty box becomes the clinician's own paragraph: leave it by clicking the question's heading.
    await card
      .locator("h3")
      .first()
      .click()
      .catch(() => undefined);
    await app.waitForTimeout(800);
    done.push("opinion");
  }
  const flags = app.getByRole("tab", { name: /Flags/ });
  if (await flags.count()) {
    await flags.first().click();
    await app.waitForTimeout(400);
  }
  const consent = app.getByRole("button", { name: "Record consent" });
  if (await consent.count()) {
    await consent.first().click();
    await app.waitForTimeout(800);
    done.push("consent");
  }
  return done;
}

/** A same-origin JSON call from the signed-in page (the Studio's own requests). */
async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { status: r.status, json };
    },
    { method, url, body },
  );
}

/* ------------------------------------------------------------------ run */
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const newPage = async (viewport = { width: 1360, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    return page;
  };
  try {
    /* 0 – the platform administrator's home clinic (script), the server */
    const cli = execFileSync(
      "npm",
      [
        "run",
        "-s",
        "admin:create-clinic",
        "--",
        "--name",
        "ZZ Usage Platform Home (fictional)",
        "--slug",
        `zz-usage-home-${RUN}`,
        "--owner-email",
        PLATFORM,
        "--retention-days",
        "30",
      ],
      { cwd: REPO, env: appEnv(), encoding: "utf8" },
    );
    const platformLink = (cli.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert.ok(platformLink, "platform administrator's link");
    await startServer();
    const admin = await newPage();
    shared.admin = admin;
    await acceptInvite(admin, platformLink, PLATFORM, "Pat Platform (fictional)");

    /* 1 – clinic + package */
    await admin.goto(`${BASE}/app/platform`);
    await admin.fill("#f-name", CLINIC.name);
    await admin.fill("#f-slug", CLINIC.slug);
    await admin.fill("#f-ownerEmail", OWNER.email);
    await admin.fill("#f-retentionDays", "30");
    await admin.click("button:has-text('Create clinic and invite the owner')");
    await admin.waitForSelector("text=is set up");
    const ownerLink = (await admin.locator("code").filter({ hasText: "/accept-invite?token=" }).first().innerText()).trim();

    const preview = execFileSync(
      "npm",
      ["run", "-s", "admin:set-package", "--", "--slug", CLINIC.slug, "--package", "custom", "--price", "300", "--reports", "1", "--extra", "1.50"],
      { cwd: REPO, env: appEnv(), encoding: "utf8" },
    );
    const db = new DatabaseSync(DB_FILE, { readOnly: true });
    check("1a", "admin:set-package without --confirm is a preview: nothing saved", () => {
      assert.match(preview, /PREVIEW – nothing saved/);
      assert.match(preview, /price: +£300 a month \(ex VAT\)/);
      assert.equal(db.prepare("SELECT count(*) AS n FROM clinic_package WHERE tenant_id = ?").get(CLINIC.slug).n, 0);
    });

    const pkgForm = admin.locator("form[aria-label='Clinic package']");
    await pkgForm.locator("select[name=tenantId]").selectOption(CLINIC.slug);
    await pkgForm.locator("select[name=package]").selectOption("group");
    const groupPrice = await pkgForm.locator("input[name=monthlyPrice]").inputValue();
    const groupExtra = await pkgForm.locator("input[name=extraReportPrice]").inputValue();
    await pkgForm.locator("select[name=package]").selectOption("custom");
    await pkgForm.locator("input[name=monthlyPrice]").fill("300");
    await pkgForm.locator("input[name=reportsIncluded]").fill("1");
    await pkgForm.locator("input[name=extraReportPrice]").fill("1.50");
    await pkgForm.locator("textarea[name=notes]").fill("E2E: internal note (fictional)");
    await pkgForm.locator("button:has-text('Save package')").click();
    await admin.waitForSelector(`text=${CLINIC.slug}: Custom – £300 a month, 1 report, extra £1.50 each`, { timeout: 30000 });
    await shot(admin, "01-platform-package");
    const platformText = await visibleText(admin);
    check("1b", "platform: a preset fills in the price list; the Custom package is saved, listed and audited (no notes in the audit)", () => {
      assert.equal(groupPrice, "349");
      assert.equal(groupExtra, "1.25");
      assert.match(platformText, /Custom · £300 · 1 report · extra £1\.50/);
      assert.match(platformText, /Package set · Clinic id zz-usage-[a-z0-9]+ · Custom, £300 a month, 1 report, extra £1\.50 each · by you/);
      const audit = db.prepare("SELECT detail_json FROM audit_log WHERE action = 'clinic.package_set' AND tenant_id = ?").all(CLINIC.slug);
      assert.equal(audit.length, 1);
      assert.doesNotMatch(audit[0].detail_json, /internal note/);
    });

    /* 2 – owner */
    const owner = await newPage();
    shared.owner = owner;
    await watchDrafts(owner);
    await acceptInvite(owner, ownerLink, OWNER.email, OWNER.name);
    await owner.goto(`${BASE}/app/settings/clinic`);
    await owner.fill("#f-address", "1 Fictional Street\nTestville");
    await owner.fill("input[name=postcode]", "MK9 2FZ");
    await owner.fill("input[name=phone]", "01234 567890");
    await owner.fill("input[name=email]", "referrals@example.com");
    await owner.check("#f-drafting");
    await owner.click("button[type=submit]:has-text('Save clinic details')");
    await owner.waitForSelector("text=Saved.");
    await owner.goto(`${BASE}/app/settings/members`);
    const me = owner.locator("li", { has: owner.locator(`p:text-is("${OWNER.email}")`) }).first();
    await me.locator("summary:has-text('Manage')").click();
    await me.locator("input[name=jobTitle]").fill(OWNER.job);
    await me.locator("input[name=hcpcNumber]").fill(OWNER.hcpc);
    await me.locator("input[name=canSign]").check();
    await me.locator("button:has-text('Save signing details')").click();
    await me.locator("text=Saved.").waitFor({ timeout: 20000 });
    // A clinician (read-only view later).
    await owner.goto(`${BASE}/app/settings/members`);
    const inviteForm = owner.locator("form", { has: owner.locator("button:has-text('Invite')") }).first();
    await inviteForm.locator("input[name=email]").fill(CLIN.email);
    await inviteForm.locator("select[name=role]").selectOption("clinician");
    await inviteForm.locator("button:has-text('Invite')").click();
    shared.clinLink = (await owner.locator("code").filter({ hasText: "/accept-invite?token=" }).first().innerText({ timeout: 20000 })).trim();

    await owner.goto(`${BASE}/app/settings/plan`);
    const plan0 = await visibleText(owner);
    const navLinks = await owner.locator("header nav a[href='/app/settings/plan']").count();
    await shot(owner, "02-plan-empty");
    check("2", "owner: Settings → Plan & usage shows the package and 0 of 1 report with the rule", () => {
      assert.equal(navLinks, 1);
      assert.match(plan0, /Custom £300 a month/);
      assert.match(plan0, /Up to 1 report a month/);
      assert.match(plan0, /Extra reports £1\.50 each/);
      assert.match(plan0, /This month \([A-Z][a-z]+ 20\d\d\) 0 of 1 report/);
      assert.match(plan0, /A report counts when its answers are first drafted, or when it is approved if nothing needed drafting\./);
      assert.doesNotMatch(plan0, /would be charged/);
    });
  } catch (err) {
    console.log(`FAIL setup: ${String(err && err.stack ? err.stack : err).slice(0, 800)}`);
    results.push({ id: "setup", pass: false, error: String(err).slice(0, 400) });
  }
  if (NO_LIVE && shared.admin) {
    await seededUsage().catch((err) => {
      console.log(`FAIL seeded: ${String(err && err.stack ? err.stack : err).slice(0, 800)}`);
      results.push({ id: "seeded", pass: false, error: String(err).slice(0, 400) });
    });
  } else if (shared.owner && shared.admin)
    await runFlow(newPage).catch((err) => {
      console.log(`FAIL flow: ${String(err && err.stack ? err.stack : err).slice(0, 800)}`);
      results.push({ id: "flow", pass: false, error: String(err).slice(0, 400) });
    });
  await browser.close().catch(() => undefined);
  await stopServer();
  const leaked = /sk-ant-/.test(serverLog);
  check("9", "the server output holds no drafting key and no failed usage write", () => {
    assert.equal(leaked, false);
    assert.doesNotMatch(serverLog, /usage_record_failed/);
  });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, liveDrafts }, null, 2));
  fs.writeFileSync(path.join(OUT, "server.log"), serverLog.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…"));
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true });
  const failed = results.filter((r) => !r.pass);
  console.log(
    `${results.length - failed.length}/${results.length} checks passed; live drafting calls ${liveDrafts.live} (requests ${liveDrafts.requests}, demo ${liveDrafts.demo}, failed ${liveDrafts.failed})`,
  );
  process.exit(failed.length ? 1 : 0);
})();

/* ------------------------------------------------------------------ the reports, the pages */
async function runFlow(newPage) {
  const { owner, admin } = shared;

  /* 3 – report A: drafted live, approved, approved again */
  const reportA = await draftBuiltInReport(owner, notes("Robin Usageone", "04/05/1988", "Right shoulder pain after a fall at home."));
  const liveAfterA = liveDrafts.live;
  await shot(owner, "03-report-a-review");
  check("3a", "report A drafted LIVE in the Studio", () => {
    assert.ok(liveAfterA >= 1, `live calls ${liveAfterA}`);
    return `${liveAfterA} live calls`;
  });
  // Re-drafted: one more live call for the same report (as "Draft from the notes" again would send).
  const storedA = await api(owner, "GET", `/api/reports/v1/store/reports/${reportA}`);
  const report = storedA.json && storedA.json.report;
  const key = report && report.generation && report.generation[0] && report.generation[0].sectionKeys[0];
  const draftBody = (reportId) => ({
    templateId: report.templateId,
    bundle: report.bundleSnapshot,
    instructingParty: report.instructingParty,
    sectionKeys: [key],
    reportId,
    prefer: "auto",
  });
  const redraft = await api(owner, "POST", "/api/reports/v1/drafts", draftBody(reportA));
  check("3b", "report A re-drafted (one more live call for the same report)", () => {
    assert.equal(storedA.status, 200);
    assert.equal(redraft.status, 200, JSON.stringify(redraft.json).slice(0, 300));
    assert.equal(redraft.json.generation.mode, "live");
  });
  let signBody = null;
  owner.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/reports/v1/sign")) signBody = r.postData();
  });
  await resolveEverything(owner);
  await owner.waitForTimeout(800);
  const cleared = await clearBlocks(owner);
  await resolveEverything(owner);
  await owner.waitForTimeout(1500);
  console.log(`   cleared before approval: ${cleared.join(", ") || "nothing"}`);
  const blocked = await owner
    .locator("#approve-blocked")
    .innerText()
    .catch(() => "");
  if (/to resolve|blocks/.test(blocked)) {
    await shot(owner, "03b-still-blocked");
    throw new Error(`report A still blocked: ${blocked}`);
  }
  await owner
    .getByRole("button", { name: /^(Sign|Approve)…$/ })
    .first()
    .click();
  const dlg = owner.getByRole("dialog");
  await dlg.waitFor();
  await owner.waitForTimeout(400);
  const signer = await dlg.getByLabel("Full name", { exact: true }).inputValue();
  await dlg.getByLabel(/Typed signature/).fill(signer);
  const boxes = dlg.locator("input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  const signed = owner.waitForResponse((r) => r.url().endsWith("/api/reports/v1/sign") && r.request().method() === "POST", { timeout: 60000 });
  await dlg.getByRole("button", { name: /Sign report|Approve and sign/ }).click();
  const signRes = await signed;
  await owner.waitForTimeout(1500);
  await shot(owner, "04-report-a-signed");
  check("3c", "report A approved in the Studio (server receipt)", () => assert.equal(signRes.status(), 200));
  const again = signBody ? await api(owner, "POST", "/api/reports/v1/sign", JSON.parse(signBody)) : { status: 0 };
  check("3d", "report A approved AGAIN (the same approval replayed) – a second receipt", () => assert.equal(again.status, 200));

  /* 4 – report B: one live call for a report that is never approved */
  const reportB = `rpt_e2e_b_${RUN}`;
  const draftB = await api(owner, "POST", "/api/reports/v1/drafts", draftBody(reportB));
  check("4", "report B: a live drafting call for a new report that is never approved", () => assert.equal(draftB.status, 200));
  await owner.waitForTimeout(800); // the response listener has read every drafting answer (the page's own fetches included)
  const liveCalls = liveDrafts.live;
  check("4b", `live drafting calls within the budget (≤ ${MAX_LIVE_CALLS})`, () => {
    assert.ok(liveCalls <= MAX_LIVE_CALLS, String(liveCalls));
    return `${liveCalls} live calls`;
  });

  /* 5 – the clinic's page */
  await owner.goto(`${BASE}/app/settings/plan`);
  const plan = await visibleText(owner);
  await shot(owner, "05-plan-over-allowance");
  const bar = await owner.locator("[role=progressbar]").getAttribute("aria-valuetext");
  check("5a", "owner: 2 of 1 report, bar, approved 1, counted-not-approved 1, 1 extra × £1.50 = £1.50 would be charged, charging later", () => {
    assert.match(plan, /2 of 1 report/);
    assert.equal(bar, "2 of 1 report, 1 over the allowance");
    assert.match(plan, /Approved 1/);
    assert.match(plan, /Counted but not approved yet 1/);
    assert.match(plan, /1 extra report × £1\.50 = £1\.50 would be charged\./);
    assert.match(plan, /Charging for extra reports starts once billing is set up\./);
    assert.match(plan, /Last 6 months/);
    assert.doesNotMatch(plan, /token|\$|cost|margin/i, "no tokens or costs for a clinic");
  });
  await owner.setViewportSize({ width: 375, height: 812 });
  await owner.reload();
  const width = await owner.evaluate(() => document.documentElement.scrollWidth);
  await shot(owner, "06-plan-375");
  check("5b", "Plan & usage at 375 px: no sideways scroll", () => assert.ok(width <= 375, `scrollWidth ${width}`));
  await owner.setViewportSize({ width: 1360, height: 900 });

  const clin = await newPage();
  await acceptInvite(clin, shared.clinLink, CLIN.email, CLIN.name);
  await clin.goto(`${BASE}/app/settings/plan`);
  const clinText = await visibleText(clin);
  await shot(clin, "07-plan-clinician");
  check("5c", "clinician: only 'This month: 2 of 1 report.' – no prices", () => {
    assert.match(clinText, /This month: 2 of 1 report\./);
    assert.doesNotMatch(clinText, /£|would be charged|Custom/);
  });

  /* 6 – platform usage */
  await admin.goto(`${BASE}/app/platform/usage`);
  const m = await usageRow(admin, CLINIC.slug);
  await shot(admin, "08-platform-usage");
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const u = db.prepare("SELECT * FROM clinic_usage WHERE tenant_id = ?").get(CLINIC.slug);
  check("6a", "platform usage row: package, price, allowance, counted 2, approved 1, not approved 1, extra 1 at £1.50, drafting calls, tokens, cost", () => {
    assert.deepEqual(
      [m.package, m.price, m.allowance, m.counted, m.approved, m["counted, not approved"], m.extra, m["extra × rate"]],
      ["Custom", "£300", "1", "2", "1", "1", "1", "£1.50 at £1.50"],
    );
    assert.equal(Number(m["drafting calls"].split(" ")[0]), liveCalls, `drafting calls cell ${m["drafting calls"]}`);
    assert.ok(Number(m.tokens.split(" ")[0].replace(/,/g, "")) > 0, `tokens ${m.tokens}`);
    assert.match(m["est. drafting cost"], /^£\d+\.\d\d \$\d+\.\d\d$/);
    assert.match(m["est. margin"], /^£30\d\.\d\d$/);
    return m;
  });
  check("6b", "the database agrees: one count per report, every call's tokens", () => {
    assert.equal(u.billable_reports, 2);
    assert.equal(u.reports_approved, 1);
    assert.equal(u.drafting_calls, liveCalls);
    assert.ok(u.input_tokens > 0 && u.output_tokens > 0 && u.cost_micro_usd > 0);
    assert.equal(db.prepare("SELECT billable_via FROM usage_report WHERE tenant_id = ? AND report_id = ?").get(CLINIC.slug, reportA).billable_via, "drafted");
    assert.equal(
      db.prepare("SELECT drafting_calls FROM usage_report WHERE tenant_id = ? AND report_id = ?").get(CLINIC.slug, reportA).drafting_calls,
      liveCalls - 1,
      "every live call but B's was for report A",
    );
    assert.equal(
      db.prepare("SELECT first_approved_at FROM usage_report WHERE tenant_id = ? AND report_id = ?").get(CLINIC.slug, reportB).first_approved_at,
      null,
    );
    return { billable: u.billable_reports, calls: u.drafting_calls, tokensIn: u.input_tokens, tokensOut: u.output_tokens, costMicroUsd: u.cost_micro_usd };
  });
  const csv = await admin.evaluate(async () => (await fetch("/app/platform/usage/export")).text());
  const lines = csv.trim().split("\r\n");
  check("6c", "CSV: the clinic's row with its numbers; no cell starts with a formula character", () => {
    assert.match(
      lines[0],
      /^period,clinic_id,clinic_name,package,price_gbp,reports_included,reports_counted,approved,amendments_approved,counted_not_approved,extra_reports/,
    );
    const line = lines.find((l) => l.includes(CLINIC.slug));
    assert.ok(line, "row");
    assert.match(line, new RegExp(`,${CLINIC.slug},ZZ Usage Clinic \\(fictional\\),Custom,300\\.00,1,2,1,0,1,1,1\\.50,1\\.50,`));
    assert.ok(!lines.some((l) => /(^|,)[=+@]/.test(l)));
  });
  const anon = (await fetch(`${BASE}/app/platform/usage/export`, { redirect: "manual" })).status;
  const ownerTry = await owner.evaluate(async () => (await fetch("/app/platform/usage")).status);
  check("6d", "the usage page and CSV are for platform administrators only (404 otherwise)", () => {
    assert.ok(anon === 404 || anon === 307 || anon === 302, String(anon));
    assert.equal(ownerTry, 404);
  });
}

/** NO_LIVE: counters written straight into the database, then the platform usage page (layout and arithmetic). */
async function seededUsage() {
  const { admin } = shared;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" })
    .formatToParts(new Date())
    .reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const month = `${parts.year}-${parts.month}`;
  const at = new Date().toISOString();
  const db = new DatabaseSync(DB_FILE);
  db.prepare(
    "INSERT INTO clinic_usage (tenant_id, period, package, plan_price_pence, plan_reports_included, plan_extra_report_pence, reports_started, reports_drafted, reports_approved, amendments_approved, billable_reports, billable_on_approval, forms_read, question_sets, drafting_calls, failed_calls, reading_calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at, updated_at) VALUES (?, ?, 'custom', 30000, 1, 150, 2, 2, 1, 1, 2, 0, 3, 1, 5, 1, 4, 1200, 3000, 25000, 15000, 70000, ?, ?)",
  ).run(CLINIC.slug, month, at, at);
  for (const [id, approved] of [
    ["rpt_seed_a", at],
    ["rpt_seed_b", null],
  ]) {
    db.prepare(
      "INSERT INTO usage_report (tenant_id, report_id, root_report_id, first_drafted_at, first_approved_at, drafting_calls, billable_period, billable_at, billable_via, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 2, ?, ?, 'drafted', ?, ?)",
    ).run(CLINIC.slug, id, id, at, approved, month, at, at, at);
  }
  db.close();
  for (const width of [1440, 1280]) {
    await admin.setViewportSize({ width, height: 900 });
    await admin.goto(`${BASE}/app/platform/usage`);
    const m = await usageRow(admin, CLINIC.slug);
    const marginRight = await admin
      .locator("[data-usage-table] thead th")
      .filter({ hasText: /margin/i })
      .evaluate((el) => el.getBoundingClientRect().right);
    await shot(admin, `s-platform-usage-${width}`);
    check(`S-${width}`, `seeded platform usage at ${width} px: the numbers, cost at 0.8, margin; cost and margin in view`, () => {
      assert.deepEqual(
        [m.counted, m.approved, m["counted, not approved"], m.extra, m["extra × rate"], m["est. drafting cost"], m["est. margin"]],
        ["2", "1 +1 amended", "1", "1", "£1.50 at £1.50", "£0.06 $0.07", "£301.44"],
      );
      assert.match(m["drafting calls"], /^5 \+1 failed$/);
      assert.match(m["form readings"], /^3 4 live calls$/);
      assert.equal(m.tokens, "44,200 in 1,200 · out 3,000 cache 25,000 read · 15,000 write");
      assert.ok(marginRight <= width, `margin column ends at ${Math.round(marginRight)} px`);
      return `margin column ends at ${Math.round(marginRight)} px`;
    });
  }
}
