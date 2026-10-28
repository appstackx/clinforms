/**
 * Packages and usage IN A DEMO CLINIC (release/plan-usage = feat/plan-usage + feat/demo-clinic-2), in a real browser
 * against a local `next start` this script starts itself on a throwaway SQLite database (port 3256 by default), with
 * LIVE drafting (the key is read from the main checkout's .env.local and never printed; at most MAX_LIVE_CALLS).
 * Made-up data only (@example.com, made-up patients, the made-up signing number PH-DEMO-01).
 *
 *   1. The platform administrator creates the clinic on /app/platform, makes it a DEMO clinic ("Demo clinics" panel)
 *      and sets a Custom package – £300 a month, 1 report included, extra reports £0.50 (a deal price; a small
 *      allowance so the approvals go past it). Audited.
 *   2. The owner (Sarah Reid) joins: the demo banner; switches drafting on; her signing details take PH-DEMO-01 (only
 *      a demo clinic accepts it); Plan & usage: "Custom £300 a month", "0 of 1 report", "Extra reports £0.50 each".
 *   3. Report A: drafted LIVE in the Studio, approved as Sarah Reid, PH-DEMO-01 – 1 of 1.
 *   4. Report B: drafted LIVE, approved – 2 of 1: past the allowance.
 *   5. Report C: one live drafting call for a new report that is never approved – it still counts: 3 of 1.
 *   6. Plan & usage (owner): "3 of 1 report", approved 2, counted-not-approved 1, "2 extra reports × £0.50 = £1.00
 *      would be charged", no tokens or costs, the demo banner.
 *   7. /app/platform/usage: the row (Demo clinic pill, Custom, £300, 1, counted 3, approved 2, not approved 1, extra 2,
 *      "£1.00 at £0.50", drafting calls = the live calls, tokens, cost, margin), the note, the CSV (demo_clinic = 1),
 *      and the database agrees; the activity trail (demo switch, packages, PH-DEMO approvals).
 *   8. The package becomes the Blue Heart-style deal – Custom £300, 500 reports, £0.50 extra: the month is
 *      re-measured ("3 of 500 reports", nothing extra) on both pages.
 *   8b. (fix 25/10/2026) The extra price left empty (not agreed yet), 2 reports: "Extra reports: price to be agreed",
 *      "3 of 2 reports", 1 extra report shown without a price; the platform row says "not set".
 *
 *   npm run build
 *   NODE_PATH=<node_modules with playwright> node scripts/e2e/plan-usage-demo.cjs   [PORT=3256] [E2E_OUT=…] [MAX_LIVE_CALLS=12]
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3256);
if (PORT < 3250 || PORT > 3269) throw new Error("Use a port from 3250 to 3269");
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "plan-usage-demo");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const DB_FILE = path.join(OUT, `e2e-${Date.now()}.db`);
const MAX_LIVE_CALLS = Number(process.env.MAX_LIVE_CALLS || 12);

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
const PLATFORM = "zz-demo-usage-platform@example.com";
const OWNER = { email: "zz-demo-usage-owner@example.com", name: "Sarah Reid", hcpc: "PH-DEMO-01", job: "Senior Physiotherapist" };
const CLINIC = { name: "ZZ Demo Usage Clinic (fictional)", slug: `zz-demo-usage-${RUN}` };
const BANNER = "Demo clinic – made-up data only";
const users = {};
const password = () => `e2e ${rnd(12)} password`;
const shared = { admin: null, owner: null };

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
    env: { ...appEnv(), ANTHROPIC_API_KEY: draftingKey() },
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
    `01/10/2026 – Initial assessment – ${OWNER.name} (${OWNER.hcpc})`,
    `S: ${complaint}`,
    "O: Range of movement reduced by about a third, pain at end of range.",
    "A: Soft tissue strain.",
    "P: Home exercises, review in two weeks.",
    "",
    `15/10/2026 – Follow-up – ${OWNER.name} (${OWNER.hcpc})`,
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
    await ta.fill("In my opinion a full recovery is expected within six weeks with the home exercises (made-up demo answer).");
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

/**
 * A question the drafting left without an answer ("Required – no answer yet", formerly "Missing field" – it blocks approval): answered in the clinician's
 * own words (made-up), as a clinic would. Returns the questions answered.
 */
async function fillMissing(app) {
  // release/bh-trial-2: the review's one item per question (0125dda, 4c52d65) – the same headings as tenant-full-flow.cjs.
  const keys = await app.$$eval("[id^='q-']", (els) =>
    els.filter((e) => /Missing field|Required – no answer yet|Required – needs your opinion|Optional, but must be filled in/.test(e.textContent || "")).map((e) => e.id.slice(2)),
  );
  const done = [];
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    await card.scrollIntoViewIfNeeded();
    let boxes = card.locator("textarea");
    if (!(await boxes.count())) {
      const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
      if (await add.count()) {
        await add.first().click();
        await app.waitForTimeout(300);
      }
      boxes = card.locator("textarea");
    }
    if (!(await boxes.count())) continue;
    const box = boxes.first();
    if ((await box.inputValue()).trim()) continue;
    await box.fill("The patient reported the injury at the first appointment; details as recorded in the notes (made-up demo answer).");
    await card
      .locator("h3")
      .first()
      .click()
      .catch(() => undefined);
    await app.waitForTimeout(800);
    done.push(key);
  }
  return done;
}

/** Approve the open report in the Studio as the signed-in member (her own signing details); returns the sign response. */
async function approveInStudio(page, label) {
  await resolveEverything(page);
  await page.waitForTimeout(800);
  const cleared = await clearBlocks(page);
  await resolveEverything(page);
  await page.waitForTimeout(800);
  const filled = await fillMissing(page);
  if (filled.length) {
    cleared.push(`missing: ${filled.join(" ")}`);
    await resolveEverything(page);
  }
  await page.waitForTimeout(1500);
  console.log(`   ${label}: cleared before approval: ${cleared.join(", ") || "nothing"}`);
  const blocked = await page
    .locator("#approve-blocked")
    .innerText()
    .catch(() => "");
  if (/to resolve|blocks|made up/.test(blocked)) {
    await shot(page, `xx-${label}-blocked`);
    throw new Error(`${label} still blocked: ${blocked}`);
  }
  await page
    .getByRole("button", { name: /^(Sign|Approve)…$/ })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  await page.waitForTimeout(400);
  const name = await dlg.getByLabel("Full name", { exact: true }).inputValue();
  const hcpc = await dlg.getByLabel("HCPC registration number").inputValue();
  await dlg.getByLabel(/Typed signature/).fill(name);
  const boxes = dlg.locator("input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  const signed = page.waitForResponse((r) => r.url().endsWith("/api/reports/v1/sign") && r.request().method() === "POST", { timeout: 60000 });
  await dlg.getByRole("button", { name: /Sign report|Approve and sign/ }).click();
  const res = await signed;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  await page.waitForTimeout(1500);
  return { status: res.status(), name, hcpc, signer: body && body.receipt ? body.receipt.signer : null };
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
      ["run", "-s", "admin:create-clinic", "--", "--name", "ZZ Demo Usage Platform Home (fictional)", "--slug", `zz-demo-usage-home-${RUN}`, "--owner-email", PLATFORM, "--retention-days", "30"],
      { cwd: REPO, env: appEnv(), encoding: "utf8" },
    );
    const platformLink = (cli.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert.ok(platformLink, "platform administrator's link");
    await startServer();
    const admin = await newPage();
    shared.admin = admin;
    await acceptInvite(admin, platformLink, PLATFORM, "Pat Platform (fictional)");

    /* 1 – clinic, demo switch, package */
    await admin.goto(`${BASE}/app/platform`);
    await admin.fill("#f-name", CLINIC.name);
    await admin.fill("#f-slug", CLINIC.slug);
    await admin.fill("#f-ownerEmail", OWNER.email);
    await admin.fill("#f-retentionDays", "30");
    await admin.click("button:has-text('Create clinic and invite the owner')");
    await admin.waitForSelector("text=is set up");
    const ownerLink = (await admin.locator("code").filter({ hasText: "/accept-invite?token=" }).first().innerText()).trim();

    await admin.goto(`${BASE}/app/platform`);
    const demoForm = admin.locator("form[aria-label='Demo clinic']");
    await demoForm.locator("select[name=tenantId]").selectOption(CLINIC.slug);
    await demoForm.locator("button:has-text('Make demo clinic')").click();
    await admin.waitForSelector(`text=${CLINIC.slug} is now a demo clinic`, { timeout: 30000 });

    const pkgForm = admin.locator("form[aria-label='Clinic package']");
    await pkgForm.locator("select[name=tenantId]").selectOption(CLINIC.slug);
    await pkgForm.locator("select[name=package]").selectOption("custom");
    await pkgForm.locator("input[name=monthlyPrice]").fill("300");
    await pkgForm.locator("input[name=reportsIncluded]").fill("1");
    await pkgForm.locator("input[name=extraReportPrice]").fill("0.50");
    await pkgForm.locator("button:has-text('Save package')").click();
    await admin.waitForSelector(`text=${CLINIC.slug}: Custom – £300 a month, 1 report, extra £0.50 each`, { timeout: 30000 });
    await admin.reload();
    const platformText = await visibleText(admin);
    await shot(admin, "01-platform-demo-and-package");
    const db = new DatabaseSync(DB_FILE, { readOnly: true });
    check("1", "platform: the clinic is a demo clinic with a Custom package £300 / 1 report / extra £0.50 – listed and audited", () => {
      assert.equal(db.prepare("SELECT demo_clinic FROM clinic_plan WHERE tenant_id = ?").get(CLINIC.slug).demo_clinic, 1);
      const pkg = db.prepare("SELECT package, monthly_price_pence, reports_included, extra_report_pence FROM clinic_package WHERE tenant_id = ?").get(CLINIC.slug);
      assert.deepEqual({ ...pkg }, { package: "custom", monthly_price_pence: 30000, reports_included: 1, extra_report_pence: 50 });
      assert.match(platformText, /Custom · £300 · 1 report · extra £0\.50/);
      assert.match(platformText, new RegExp(`Demo clinics now: ${CLINIC.name.replace(/[()]/g, "\\$&")} \\(${CLINIC.slug}\\)`));
      const audits = db.prepare("SELECT action FROM audit_log WHERE tenant_id = ? ORDER BY id").all(CLINIC.slug).map((r) => r.action);
      assert.ok(audits.includes("clinic.demo_on") && audits.includes("clinic.package_set"), audits.join(","));
    });

    /* 2 – the owner */
    const owner = await newPage();
    shared.owner = owner;
    await watchDrafts(owner);
    await acceptInvite(owner, ownerLink, OWNER.email, OWNER.name);
    const home = await visibleText(owner);
    await owner.goto(`${BASE}/app/settings/clinic`);
    await owner.fill("#f-address", "1 Made-up Street\nTestville");
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
    await owner.goto(`${BASE}/app/settings/members`);
    const memberText = await visibleText(owner);
    await owner.goto(`${BASE}/app/settings/plan`);
    const plan0 = await visibleText(owner);
    await shot(owner, "02-plan-empty");
    check("2", "owner (demo clinic): banner; PH-DEMO-01 saved; Plan & usage shows Custom £300, 0 of 1 report, extra £0.50", () => {
      assert.ok(home.includes(BANNER), "banner on /app");
      assert.ok(memberText.includes(`${OWNER.job} · HCPC ${OWNER.hcpc} · May sign`), "PH-DEMO-01 stored");
      assert.ok(plan0.includes(BANNER), "banner on Plan & usage");
      assert.match(plan0, /Custom £300 a month/);
      assert.match(plan0, /Up to 1 report a month/);
      assert.match(plan0, /Extra reports £0\.50 each/);
      assert.match(plan0, /This month \([A-Z][a-z]+ 20\d\d\) 0 of 1 report/);
      assert.doesNotMatch(plan0, /would be charged/);
    });
  } catch (err) {
    console.log(`FAIL setup: ${String(err && err.stack ? err.stack : err).slice(0, 800)}`);
    results.push({ id: "setup", pass: false, error: String(err).slice(0, 400) });
  }
  if (shared.owner && shared.admin)
    await runFlow().catch((err) => {
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

async function runFlow() {
  const { owner, admin } = shared;

  /* 3 – report A: drafted live, approved as Sarah Reid, PH-DEMO-01 */
  const reportA = await draftBuiltInReport(owner, notes("Robin Demoone", "04/05/1988", "Right shoulder pain after a fall at home."));
  const liveAfterA = liveDrafts.live;
  const studioA = await visibleText(owner);
  const signA = await approveInStudio(owner, "report-a");
  await shot(owner, "03-report-a-approved");
  check("3", "report A drafted LIVE in the demo clinic's Studio and approved as Sarah Reid, PH-DEMO-01 (1 of 1)", () => {
    assert.ok(liveAfterA >= 1, `live calls ${liveAfterA}`);
    assert.ok(studioA.includes(BANNER), "banner in the Studio");
    assert.equal(signA.status, 200);
    assert.deepEqual([signA.name, signA.hcpc], [OWNER.name, OWNER.hcpc]);
    assert.equal(signA.signer && signA.signer.hcpc, OWNER.hcpc);
    return `${liveAfterA} live calls`;
  });

  /* 4 – report B: drafted live, approved – past the allowance */
  const reportB = await draftBuiltInReport(owner, notes("Jo Demotwo", "12/11/1975", "Lower back pain after lifting boxes at work."));
  const signB = await approveInStudio(owner, "report-b");
  await shot(owner, "04-report-b-approved");
  check("4", "report B drafted LIVE and approved – past the allowance (2 of 1)", () => {
    assert.notEqual(reportA, reportB);
    assert.equal(signB.status, 200);
    assert.equal(signB.signer && signB.signer.hcpc, OWNER.hcpc);
  });

  /* 5 – report C: one live call for a new report that is never approved */
  const storedA = await api(owner, "GET", `/api/reports/v1/store/reports/${reportA}`);
  const report = storedA.json && storedA.json.report;
  const key = report && report.generation && report.generation[0] && report.generation[0].sectionKeys[0];
  const reportC = `rpt_e2e_demo_c_${RUN}`;
  const draftC = await api(owner, "POST", "/api/reports/v1/drafts", {
    templateId: report.templateId,
    bundle: report.bundleSnapshot,
    instructingParty: report.instructingParty,
    sectionKeys: [key],
    reportId: reportC,
    prefer: "auto",
  });
  await owner.waitForTimeout(800);
  const liveCalls = liveDrafts.live;
  check("5", `report C: a live drafting call for a new report, never approved; live calls within the budget (≤ ${MAX_LIVE_CALLS})`, () => {
    assert.equal(draftC.status, 200, JSON.stringify(draftC.json).slice(0, 300));
    assert.equal(draftC.json.generation.mode, "live");
    assert.ok(liveCalls <= MAX_LIVE_CALLS, String(liveCalls));
    return `${liveCalls} live calls`;
  });

  /* 6 – the clinic's page */
  await owner.goto(`${BASE}/app/settings/plan`);
  const plan = await visibleText(owner);
  const bar = await owner.locator("[role=progressbar]").getAttribute("aria-valuetext");
  await shot(owner, "05-plan-over-allowance");
  check("6", "owner: 3 of 1 report, approved 2, counted-not-approved 1, 2 extra × £0.50 = £1.00 would be charged; no tokens or costs", () => {
    assert.ok(plan.includes(BANNER), "banner");
    assert.match(plan, /3 of 1 report/);
    assert.equal(bar, "3 of 1 report, 2 over the allowance");
    assert.match(plan, /Approved 2/);
    assert.match(plan, /Counted but not approved yet 1/);
    assert.match(plan, /2 extra reports × £0\.50 = £1\.00 would be charged\./);
    assert.match(plan, /Charging for extra reports starts once billing is set up\./);
    assert.doesNotMatch(plan, /token|\$|cost|margin/i, "no tokens or costs for a clinic");
  });

  /* 7 – platform usage, CSV, database, activity */
  await admin.goto(`${BASE}/app/platform/usage`);
  const m = await usageRow(admin, CLINIC.slug);
  const usageText = await visibleText(admin);
  await shot(admin, "06-platform-usage");
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const u = db.prepare("SELECT * FROM clinic_usage WHERE tenant_id = ?").get(CLINIC.slug);
  check("7a", "platform usage row: Demo clinic, Custom £300, allowance 1, counted 3, approved 2, not approved 1, extra 2 = £1.00 at £0.50, calls, tokens, cost, margin", () => {
    assert.match(m.clinic, /Demo clinic/);
    assert.deepEqual(
      [m.package, m.price, m.allowance, m.counted, m.approved, m["counted, not approved"], m.extra, m["extra × rate"]],
      ["Custom", "£300", "1", "3", "2", "1", "2", "£1.00 at £0.50"],
    );
    assert.equal(Number(m["drafting calls"].split(" ")[0]), liveCalls, `drafting calls cell ${m["drafting calls"]}`);
    assert.ok(Number(m.tokens.split(" ")[0].replace(/,/g, "")) > 0, `tokens ${m.tokens}`);
    assert.match(m["est. drafting cost"], /^£\d+\.\d\d \$\d+\.\d\d$/);
    assert.match(m["est. margin"], /^£30\d\.\d\d$/);
    assert.match(usageText, /Demo clinics \(made-up data only\) are counted like any clinic\. Their drafting costs are real and are in the cost total/);
    return m;
  });
  // Fix 25/10/2026: the demo clinic's made-up price and extra reports stay out of the money totals; its cost stays in.
  const totals = await admin.evaluate(() => {
    const cells = (tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.innerText.replace(/\s+/g, " ").trim());
    const rows = Array.from(document.querySelectorAll("[data-usage-row]")).map((tr) => ({ demo: Boolean(tr.querySelector("[data-usage-demo]")), cells: cells(tr) }));
    const total = cells(document.querySelector("[data-usage-totals]"));
    return { rows, total };
  });
  const pounds = (t) => (t === "–" || !t ? 0 : Number(String(t).split(" ")[0].replace(/[£,]/g, "")));
  check("7a2", "totals: price and extra charge leave the demo clinic out; the cost total includes it", () => {
    const real = totals.rows.filter((r) => !r.demo);
    // td columns: package, price, allowance, counted, approved, not approved, extra, extra × rate, cost, margin, …
    assert.equal(pounds(totals.total[1]), real.reduce((n, r) => n + pounds(r.cells[1]), 0), `price total ${totals.total[1]}`);
    assert.equal(pounds(totals.total[7]), real.reduce((n, r) => n + pounds(r.cells[7]), 0), `extra charge total ${totals.total[7]}`);
    const allCost = totals.rows.reduce((n, r) => n + pounds(r.cells[8]), 0);
    assert.ok(Math.abs(pounds(totals.total[8]) - allCost) < 0.015, `cost total ${totals.total[8]} vs ${allCost}`);
    return { total: totals.total.slice(0, 10) };
  });
  check("7b", "the database agrees: A and B counted when drafted, C counted though never approved; every call's tokens", () => {
    assert.equal(u.billable_reports, 3);
    assert.equal(u.reports_approved, 2);
    assert.equal(u.drafting_calls, liveCalls);
    assert.equal(u.plan_extra_report_pence, 50);
    assert.ok(u.input_tokens > 0 && u.output_tokens > 0 && u.cost_micro_usd > 0);
    const via = (id) => db.prepare("SELECT billable_via, first_approved_at FROM usage_report WHERE tenant_id = ? AND report_id = ?").get(CLINIC.slug, id);
    assert.equal(via(reportA).billable_via, "drafted");
    assert.equal(via(reportB).billable_via, "drafted");
    assert.equal(via(reportC).billable_via, "drafted");
    assert.equal(via(reportC).first_approved_at, null);
    return { billable: u.billable_reports, approved: u.reports_approved, calls: u.drafting_calls, tokensIn: u.input_tokens, tokensOut: u.output_tokens, costMicroUsd: u.cost_micro_usd };
  });
  const csv = await admin.evaluate(async () => (await fetch("/app/platform/usage/export")).text());
  const lines = csv.trim().split("\r\n");
  check("7c", "CSV: the demo clinic's row with its numbers and demo_clinic = 1; no formula cells", () => {
    assert.match(lines[0], /^period,clinic_id,clinic_name,package,price_gbp,reports_included,reports_counted,approved,amendments_approved,counted_not_approved,extra_reports/);
    assert.ok(lines[0].endsWith(",usd_gbp_rate,demo_clinic"));
    const line = lines.find((l) => l.includes(CLINIC.slug)) || "";
    assert.match(line, new RegExp(`,${CLINIC.slug},ZZ Demo Usage Clinic \\(fictional\\),Custom,300\\.00,1,3,2,0,1,2,0\\.50,1\\.00,`));
    assert.ok(line.endsWith(",0.8,1"), line.slice(-20));
    assert.ok(!lines.some((l) => /(^|,)[=+@]/.test(l)));
  });
  const signs = db.prepare("SELECT detail_json FROM audit_log WHERE tenant_id = ? AND action = 'report.sign'").all(CLINIC.slug).map((r) => JSON.parse(r.detail_json));
  await owner.goto(`${BASE}/app/settings/activity?action=report.sign`);
  const activity = await visibleText(owner);
  await owner.goto(`${BASE}/app/settings/activity?action=clinic.package_set`);
  const activityPkg = await visibleText(owner);
  check("7d", "activity: both approvals as a demo clinic with PH-DEMO-01; the package set by ClinForms", () => {
    assert.equal(signs.length, 2);
    assert.ok(signs.every((d) => d.demoClinic === true && d.demoNumber === OWNER.hcpc), JSON.stringify(signs));
    assert.ok(activity.includes("Demo clinic – approved with the made-up number PH-DEMO-01"), activity.slice(0, 400));
    assert.match(activityPkg, /Package set by ClinForms/);
  });

  /* 8 – the Blue Heart-style deal: £300, 500 reports, £0.50 extra – the month is re-measured */
  await admin.goto(`${BASE}/app/platform`);
  const pkgForm = admin.locator("form[aria-label='Clinic package']");
  await pkgForm.locator("select[name=tenantId]").selectOption(CLINIC.slug);
  await pkgForm.locator("select[name=package]").selectOption("custom");
  await pkgForm.locator("input[name=monthlyPrice]").fill("300");
  await pkgForm.locator("input[name=reportsIncluded]").fill("500");
  await pkgForm.locator("input[name=extraReportPrice]").fill("0.50");
  await pkgForm.locator("button:has-text('Save package')").click();
  await admin.waitForSelector(`text=${CLINIC.slug}: Custom – £300 a month, 500 reports, extra £0.50 each`, { timeout: 30000 });
  await owner.goto(`${BASE}/app/settings/plan`);
  const plan500 = await visibleText(owner);
  await shot(owner, "07-plan-500");
  await admin.goto(`${BASE}/app/platform/usage`);
  const m500 = await usageRow(admin, CLINIC.slug);
  await shot(admin, "08-platform-usage-500");
  check("8", "Custom £300 / 500 reports / £0.50: 3 of 500 reports, nothing extra on both pages", () => {
    assert.match(plan500, /Up to 500 reports a month/);
    assert.match(plan500, /3 of 500 reports/);
    assert.doesNotMatch(plan500, /would be charged/);
    assert.deepEqual([m500.allowance, m500.counted, m500.extra, m500["extra × rate"]], ["500", "3", "0", "£0.00 at £0.50"]);
  });

  /* 8b – (fix 25/10/2026) the extra price not agreed yet: the field left empty – counted, shown without a price */
  await admin.goto(`${BASE}/app/platform`);
  const pkgForm2 = admin.locator("form[aria-label='Clinic package']");
  await pkgForm2.locator("select[name=tenantId]").selectOption(CLINIC.slug);
  await pkgForm2.locator("select[name=package]").selectOption("custom");
  await pkgForm2.locator("input[name=monthlyPrice]").fill("300");
  await pkgForm2.locator("input[name=reportsIncluded]").fill("2");
  await pkgForm2.locator("input[name=extraReportPrice]").fill("");
  await pkgForm2.locator("button:has-text('Save package')").click();
  await admin.waitForSelector(`text=${CLINIC.slug}: Custom – £300 a month, 2 reports, extra not set yet`, { timeout: 30000 });
  await owner.goto(`${BASE}/app/settings/plan`);
  const planUnset = await visibleText(owner);
  await shot(owner, "09-plan-extra-not-set");
  await admin.goto(`${BASE}/app/platform/usage`);
  const mUnset = await usageRow(admin, CLINIC.slug);
  await shot(admin, "10-platform-usage-extra-not-set");
  check("8b", "extra price left empty: 'price to be agreed', 1 extra report counted with no price, nothing charged; the platform says 'not set'", () => {
    assert.match(planUnset, /Extra reports: price to be agreed/);
    assert.match(planUnset, /3 of 2 reports/);
    assert.match(planUnset, /1 extra report this month\. The price of extra reports is still to be agreed – nothing is charged until it is\./);
    assert.doesNotMatch(planUnset, /would be charged/);
    assert.deepEqual([mUnset.allowance, mUnset.counted, mUnset.extra, mUnset["extra × rate"]], ["2", "3", "1", "not set"]);
  });
}
