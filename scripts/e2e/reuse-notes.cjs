/**
 * "Complete another form for this patient" (25/10/2026), end to end in a real browser – LOCAL ONLY: a throwaway SQLite
 * database and a local `next start` this script starts itself (port 3270–3279); never a preview or production
 * database. Demo mode (no drafting key, no live calls). Fictional / made-up data only.
 *
 *   setup   test-only secrets generated here (never printed); one DEMO clinic created with the local admin script
 *           (owner Sarah Reid, PH-DEMO-01 may approve there); the invitation link kept in a chmod-600 file.
 *   flow    Sarah: account + two-step; signing details; uploads the bundled Northfield (PDF) and Kingsway (Word) forms
 *           and confirms both maps; uploads Gemma Whitlock's fictional notes (.txt), checks and confirms them; completes
 *           Northfield (report 1, drafting off: blank answers typed in) and APPROVES it; on the approved report clicks
 *           "Complete another form for this patient": the wizard skips the upload, shows the same patient and the same
 *           counts, marks Northfield "Already completed for this patient", nothing preselected; chooses Kingsway →
 *           report 2 (a NEW id, the same patient, episode and notes, no "amends", activity "notes_reused"); the list's
 *           "Another form" on the draft report 2; the activity page; a deleted report and a made-up id say so plainly;
 *           375 px; nothing from the notes in browser storage; a signed-out call is refused.
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/reuse-notes.cjs
 *     [PORT=3271] [E2E_OUT=<folder>] [NOTES=<a fictional notes .txt – default: Gemma Whitlock's in the main checkout's
 *     gitignored demo-assets>] [REPO=<checkout>]
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = process.env.REPO || path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3271);
if (PORT < 3270 || PORT > 3279) throw new Error("ports 3270–3279 only");
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "reuse-notes");
const NOTES =
  process.env.NOTES ||
  "/Users/khuram/Projects/Appstackx/clinforms/demo-assets/outputs/blue-heart/welcome/sample-notes/Fictional-patient-2-Gemma-Whitlock-lower-back-injury-at-work-notes-to-paste.txt";
const N = process.env.RUN_ID || String(Date.now()).slice(-6);
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` in the worktree first");
if (!fs.existsSync(NOTES)) throw new Error("the fictional notes file is missing");

const PRIVATE = path.join(OUT, "private");
fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
const STATE_FILE = path.join(PRIVATE, "state.json");
const state = { run: N, accounts: {} };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

const CLINIC = { slug: `zz-reuse-e2e-${N}`, name: "ZZ Reuse Physio (fictional)" };
const SARAH = { email: `zz-sarah-reuse-${N}@example.com`, name: "Sarah Reid", hcpc: "PH-DEMO-01", jobTitle: "Senior Physiotherapist" };

/* ------------------------------------------------------------------------------------------------
 * Local environment: test-only values, never printed
 * ----------------------------------------------------------------------------------------------*/

const rnd = (n) => crypto.randomBytes(n).toString("base64url");
const ENV = (() => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(MEDREPORT_|ANTHROPIC_|CLINFORMS_|TM3_SIM_|BETTER_AUTH_|NEXT_PUBLIC_POSTHOG|DATABASE_|MAILERSEND_|APP_ORIGIN|VERCEL|CRON_)/.test(k)) delete env[k];
  Object.assign(env, {
    PORT: String(PORT),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: path.join(PRIVATE, `clinforms-reuse-e2e-${N}.db`),
    CLINFORMS_DATA_KEYS: JSON.stringify({ e2e: crypto.randomBytes(32).toString("base64") }),
    CLINFORMS_DATA_KEY_ID: "e2e",
    BETTER_AUTH_SECRET: `test-only-${rnd(32)}`,
    BETTER_AUTH_URL: BASE,
    CLINFORMS_EMAIL_PROVIDER: "none",
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_LAUNCH_SECRET: `test-only-launch-${rnd(16)}`,
    MEDREPORT_SIGNING_SECRET: `test-only-signing-${rnd(16)}`,
    MEDREPORT_PARTNER_KEY: `test-only-partner-${rnd(16)}`,
    TM3_SIM_TOKEN: `test-only-sim-${rnd(16)}`,
  });
  return env;
})();

function npmScript(name, args, file) {
  const r = spawnSync("npm", ["run", "-s", name, "--", ...args], { cwd: REPO, env: ENV, encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  fs.writeFileSync(file, out, { mode: 0o600 });
  if (r.status !== 0) throw new Error(`${name} failed (exit ${r.status}); see ${file}`);
  return out;
}

let server = null;
let serverLog = "";
async function startServer() {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: ENV, stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 90_000;
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
    // gone
  }
  await new Promise((r) => setTimeout(r, 1500));
  server = null;
}

/* ------------------------------------------------------------------------------------------------
 * Helpers (TOTP, steps, screenshots) – as scripts/e2e/demo-clinic.cjs
 * ----------------------------------------------------------------------------------------------*/

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
function totp(keyB32, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", base32Decode(keyB32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}
const usedCodes = {};
async function freshCode(who) {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    const window = Math.floor(Date.now() / 30000);
    if (left > 3000 && usedCodes[who.email] !== window) {
      usedCodes[who.email] = window;
      return totp(state.accounts[who.email].key);
    }
    await new Promise((r) => setTimeout(r, left + 300));
  }
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)${detail ? ` – ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 800) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 800)}`);
    throw err;
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}
let shotN = 0;
const shot = async (page, name, fullPage = true) => {
  shotN += 1;
  await page.screenshot({ path: path.join(OUT, `${String(shotN).padStart(2, "0")}-${name}.png`), fullPage }).catch(() => undefined);
};
const mainText = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main").cloneNode(true);
    main.querySelectorAll("select, option").forEach((el) => el.remove());
    return (main.textContent || "").replace(/\s+/g, " ");
  });
const storedReport = (page, id) => page.evaluate(async (rid) => (await (await fetch(`/api/reports/v1/store/reports/${rid}`)).json()).report, id);
const summaryOf = (bundle) => {
  const p = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
  return `${p(bundle.notes.length, "note")} · ${p(bundle.appointments.length, "appointment")} · ${p(bundle.outcomeMeasures.reduce((n, s) => n + s.points.length, 0), "score")}`;
};

const PREFETCH_ABORT = /Failed to fetch RSC payload for .* Falling back to browser navigation/;
let prefetchAborts = 0;
function watch(page, problems, label) {
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (PREFETCH_ABORT.test(m.text())) {
      prefetchAborts++;
      return;
    }
    // The deliberate 404s of the "gone" checks are expected.
    if (/status of 404/.test(m.text()) && /\/new\?from=/.test(page.url())) return;
    problems.push(`${label} console on ${page.url().replace(BASE, "")}: ${m.text().slice(0, 200)}`);
  });
}

async function acceptInvite(page, link, who) {
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", who.name);
  await page.fill("#f-password", state.accounts[who.email].password);
  await page.fill("#f-confirm", state.accounts[who.email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", state.accounts[who.email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  state.accounts[who.email].key = (await page.locator("code").first().innerText()).trim();
  save();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(who));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`, { timeout: 30000 });
}

async function saveSigning(page, who, { jobTitle = "", hcpc, canSign }) {
  await page.goto(`${BASE}/app/settings/members`);
  const row = page.locator("li", { has: page.locator(`p:text-is("${who.email}")`) }).first();
  await row.waitFor({ timeout: 30000 });
  await row.locator("summary:has-text('Manage')").click();
  await row.locator("input[name=jobTitle]").fill(jobTitle);
  await row.locator("input[name=hcpcNumber]").fill(hcpc);
  const box = row.locator("input[name=canSign]");
  if (canSign) await box.check();
  else await box.uncheck();
  await row.locator("button:has-text('Save signing details')").click();
  const msg = row.locator("span.text-teal-700, span.text-red-700").first();
  await msg.waitFor({ timeout: 20000 });
  return (await msg.innerText()).trim();
}

/** Forms library: upload a bundled sample form, analyse, confirm the map (the clinic's own copy). */
async function uploadAndConfirm(app, file, referrer, type) {
  await app.goto(`${BASE}/app/studio/forms`);
  await app.waitForSelector("text=Upload a referrer form");
  await app.locator("button:has-text('Upload a referrer form')").first().click();
  await app.locator("[role=dialog] input[type=file]").setInputFiles(file);
  await app.getByRole("button", { name: /Analyse form|Analyse again/ }).waitFor();
  await app.fill("#upload-referrer", referrer);
  await app.selectOption("#upload-referrer-type", type);
  await app.getByRole("button", { name: /Analyse form|Analyse again/ }).click();
  await app.getByRole("button", { name: "Review the mapping" }).waitFor({ timeout: 300000 });
  await app.getByRole("button", { name: "Review the mapping" }).click();
  await app.waitForURL(/\/app\/studio\/forms\/[^/]+$/, { timeout: 30000 });
  await app.getByRole("button", { name: "Confirm mapping" }).first().click();
  const dlg = app.getByRole("dialog");
  await dlg.waitFor();
  const problemsText = await dlg.innerText();
  assert(!/Fix these first/.test(problemsText), `mapping problems: ${problemsText.slice(0, 400)}`);
  await dlg.locator("input[type=checkbox]").check();
  await dlg.getByRole("button", { name: "Confirm mapping" }).click();
  await dlg.waitFor({ state: "detached", timeout: 30000 });
  await app.waitForTimeout(1500);
  assert(/Confirmed/i.test(await app.locator("main").innerText()), "confirmed");
}

/** Resolve or acknowledge every open gap on the review screen. */
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
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here (made-up demo data).");
        await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await ack.first().click();
        await card.locator("form textarea").last().fill("Not recorded in the notes; returned without it after checking (made-up demo data).");
        await card.locator("form").getByRole("button", { name: /Acknowledge/ }).last().click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      break;
    }
  }
  return actions;
}

/** Answer every required question the notes did not answer (Flags: "Missing field"). */
async function answerMissing(app) {
  await app.getByRole("tab", { name: /Flags/ }).click();
  await app.waitForTimeout(500);
  const flags = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
  const keys = Array.from(new Set(Array.from(flags.matchAll(/Missing field\s+\(blocks approval\)\s*F\W?(\d+)/g)).map((m) => `F-${m[1]}`)));
  const answered = [];
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    await card.scrollIntoViewIfNeeded();
    const text = await card.innerText();
    const radios = card.locator("input[type=radio]");
    if (await radios.count()) {
      const yes = card.getByLabel("Yes", { exact: true });
      if (await yes.count()) await yes.first().check();
      else await radios.first().check();
      answered.push(`${key}:choice`);
    } else {
      const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
      if ((await add.count()) && !(await card.locator("textarea").count())) {
        await add.first().click();
        await app.waitForTimeout(200);
      }
      if (await card.locator("textarea").count()) {
        await card.locator("textarea").first().fill(/Number|number|sessions/.test(text) ? "6" : "Progressing well with home exercises; reviewed in clinic (made-up demo answer).");
        answered.push(`${key}:text`);
      } else if (await card.locator("input[type=text], input:not([type])").count()) {
        await card.locator("input[type=text], input:not([type])").first().fill(/Number|number/.test(text) ? "6" : "Made-up demo answer");
        answered.push(`${key}:input`);
      }
    }
    await card.locator("h3").first().click();
    await app.waitForTimeout(500);
  }
  return answered;
}

async function rewriteBlocked(app) {
  await app.getByRole("tab", { name: /Flags/ }).click();
  await app.waitForTimeout(500);
  const flags = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
  const blocking = flags.split(/Resolved and acknowledged/)[0];
  const keys = Array.from(new Set(Array.from(blocking.matchAll(/Go to\s*F\W?(\d+)/g)).map((m) => `F-${m[1]}`)));
  const rewritten = [];
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    await card.scrollIntoViewIfNeeded();
    const remove = card.locator("button[aria-label^='Remove paragraph']");
    for (let guard = 0; guard < 8 && (await remove.count()); guard++) {
      await remove.first().click();
      await app.waitForTimeout(300);
    }
    const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
    if (await add.count()) {
      await add.first().click();
      await app.waitForTimeout(200);
    }
    if (await card.locator("textarea").count()) {
      await card.locator("textarea").last().fill("Progressing well; no further treatment expected (made-up demo answer).");
      await card.locator("h3").first().click();
      await app.waitForTimeout(500);
      rewritten.push(key);
    }
  }
  return rewritten;
}

async function prepareForApproval(app) {
  const acted = await resolveEverything(app);
  const answered = await answerMissing(app);
  const acted2 = await resolveEverything(app);
  const rewritten = await rewriteBlocked(app);
  const acted3 = rewritten.length ? await resolveEverything(app) : 0;
  await app.waitForTimeout(1500);
  return { gapActions: acted + acted2 + acted3, answered, rewritten };
}

/** Choose a form card in step 3 and complete it; returns the new report's id (drafting is off for a new clinic). */
async function completeChosen(app, titleRe) {
  const radio = app.getByRole("radio", { name: titleRe }).first();
  await radio.waitFor({ timeout: 20000 });
  await radio.click();
  await app.getByRole("button", { name: "Complete this form" }).click();
  const open = app.getByRole("link", { name: "Open for review" });
  await Promise.race([app.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 180000 }), open.waitFor({ timeout: 180000 })]);
  if (!/\/app\/studio\/rpt_/.test(app.url())) {
    await open.click();
    await app.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 60000 });
  }
  await app.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
  await app.waitForTimeout(2500);
  return app.url().split("/").pop();
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * ----------------------------------------------------------------------------------------------*/

(async () => {
  const problems = [];
  let browser = null;
  try {
    state.accounts[SARAH.email] = { password: `e2e ${rnd(12)} pw` };
    save();
    await step("setup: local SQLite database migrated; a demo clinic created with the admin script (link kept private)", async () => {
      npmScript("db:migrate", [], path.join(PRIVATE, "db-migrate.txt"));
      const out = npmScript("admin:create-clinic", ["--name", CLINIC.name, "--slug", CLINIC.slug, "--owner-email", SARAH.email, "--app-url", BASE, "--retention-days", "30"], path.join(PRIVATE, "invite.txt"));
      const link = (out.match(/http:\/\/localhost:\d+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
      assert(link, "no invitation link");
      state.link = link;
      npmScript("admin:set-demo-clinic", ["--slug", CLINIC.slug, "--on"], path.join(PRIVATE, "set-demo-clinic.txt"));
      save();
      return CLINIC.slug;
    });

    await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    const app = await ctx.newPage();
    watch(app, problems, "sarah");

    await step("Sarah Reid: invitation → account → two-step; signing details PH-DEMO-01 (demo clinic)", async () => {
      await acceptInvite(app, state.link, SARAH);
      const msg = await saveSigning(app, SARAH, { jobTitle: SARAH.jobTitle, hcpc: SARAH.hcpc, canSign: true });
      assert(msg === "Saved.", `signing details: ${msg}`);
    });

    const northfield = path.join(OUT, "northfield.pdf");
    const kingsway = path.join(OUT, "kingsway.docx");
    await step("forms: the bundled Northfield (PDF) and Kingsway (Word) forms uploaded and their maps confirmed", async () => {
      for (const [id, file] of [
        ["northfield-rehab-progress", northfield],
        ["kingsway-rtw-assessment", kingsway],
      ]) {
        const res = await fetch(`${BASE}/api/reports/v1/forms/samples/${id}/file`);
        assert(res.ok, `sample form ${id} ${res.status}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      await uploadAndConfirm(app, northfield, "Northfield Assurance (fictional)", "insurer");
      await uploadAndConfirm(app, kingsway, "Kingsway Case Management (fictional)", "case_manager");
      await app.goto(`${BASE}/app/studio/forms`);
      await app.waitForTimeout(1500);
      await shot(app, "forms-confirmed", false);
    });

    // Report 1 – a fresh upload of Gemma Whitlock's fictional notes.
    let importedLine = "";
    await step("report 1: upload Gemma Whitlock's notes (.txt) → check → confirm; the imported counts", async () => {
      await app.goto(`${BASE}/app/studio/new`);
      await app.waitForSelector("text=Drop the patient's notes here", { timeout: 30000 });
      await shot(app, "wizard-step1-upload-hint", false);
      assert(/Already uploaded this patient's notes for another form\?/.test(await mainText(app)), "the upload step points to the new action");
      await app.locator("input[type=file]").first().setInputFiles(NOTES);
      await Promise.race([app.waitForSelector("[data-testid=notes-review]", { timeout: 60000 }), app.waitForSelector("h2:has-text('Check what was imported')", { timeout: 60000 })]);
      if (await app.locator("[data-testid=notes-review]").count()) {
        await shot(app, "notes-review");
        const blockers = async () => ((await app.locator("[data-testid=notes-review-blockers]").count()) ? (await app.locator("[data-testid=notes-review-blockers]").innerText()).trim() : "");
        let b = await blockers();
        if (/who the form is for/.test(b)) await app.fill("#notes-reg-instructingPartyName", "Harbourside Case Management (fictional)");
        b = await blockers();
        if (/kind of organisation/.test(b)) await app.selectOption("#notes-reg-instructingPartyType", "case_manager");
        b = await blockers();
        if (/without a clinician/.test(b)) {
          const selects = app.locator("select[id$='-clinician']");
          for (let i = 0; i < (await selects.count()); i++) {
            if (!(await selects.nth(i).inputValue())) await selects.nth(i).selectOption({ index: 1 });
          }
        }
        assert(!(await app.locator("[data-testid=notes-review-confirm]").isDisabled()), `confirm blocked: ${await blockers()}`);
        await app.locator("[data-testid=notes-review-confirm]").click();
      }
      await app.waitForSelector("h2:has-text('Check what was imported')", { timeout: 60000 });
      importedLine = (await app.locator("p:has-text('Imported from')").first().innerText()).replace(/\s+/g, " ").trim();
      await shot(app, "report1-check-the-data");
      return importedLine;
    });

    await step("report 1: Northfield chosen and completed (drafting off: questions left for the clinician)", async () => {
      await app.getByRole("button", { name: "Choose the referrer form" }).click();
      await app.getByRole("radio").first().waitFor({ timeout: 20000 });
      await shot(app, "report1-choose-form", false);
      state.report1 = await completeChosen(app, /Rehabilitation Progress Report/);
      save();
      await shot(app, "report1-review-draft", false);
      const r1 = await storedReport(app, state.report1);
      assert(r1 && /Whitlock/.test(r1.patientLabel), `report 1 stored: ${r1 && r1.patientLabel}`);
      state.patient = r1.patientLabel;
      state.counts = summaryOf(r1.bundleSnapshot);
      save();
      assert(importedLine.includes(state.counts), `imported "${importedLine}" vs stored ${state.counts}`);
      return { id: state.report1, patient: state.patient, counts: state.counts };
    });

    await step("report 1: the draft's header already offers 'Complete another form for this patient'", async () => {
      const link = app.locator("header [data-reuse-notes]");
      assert((await link.count()) === 1, "action in the header");
      assert((await link.getAttribute("href")) === `/app/studio/new?from=${state.report1}`, `href ${await link.getAttribute("href")}`);
      assert((await link.innerText()).trim() === "Complete another form for this patient", "label");
      await link.scrollIntoViewIfNeeded();
      await shot(app, "report1-header-action-draft", false);
    });

    await step("report 1: gaps resolved, blank answers typed in, approved as Sarah Reid (PH-DEMO-01)", async () => {
      const done = await prepareForApproval(app);
      const blocked = await app.locator("#approve-blocked").innerText().catch(() => "");
      assert(/Ready for your approval/.test(blocked), `not ready: ${blocked} ${JSON.stringify(done)}`);
      await app.getByRole("button", { name: /^Approve/ }).first().click();
      const dlg = app.getByRole("dialog");
      await dlg.waitFor();
      await app.waitForTimeout(400);
      await dlg.getByLabel(/Typed signature/).fill(SARAH.name);
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await dlg.getByRole("button", { name: /Approve and sign/ }).click();
      await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 60000 });
      await app.waitForTimeout(1500);
      const r1 = await storedReport(app, state.report1);
      assert(r1.status === "signed" && r1.receipt, "report 1 approved and stored");
      await shot(app, "report1-approved-with-action", false);
      return `approved by ${r1.receipt.signer.name} (${r1.receipt.signer.hcpc})`;
    });

    await step("APPROVED report 1 → 'Complete another form for this patient': no upload, the same patient and counts, '(approved)'", async () => {
      await app.locator("header [data-reuse-notes]").click();
      await app.waitForURL(`${BASE}/app/studio/new?from=${state.report1}`, { timeout: 30000 });
      await app.waitForSelector("[data-reused-notes]", { timeout: 30000 });
      await app.waitForSelector("h2:has-text('Check what was imported')", { timeout: 30000 });
      const banner = (await app.locator("[data-reused-notes]").innerText()).replace(/\s+/g, " ").trim();
      assert(banner.includes(`Using the notes already checked for ${state.patient}`), `banner: ${banner}`);
      assert(banner.includes("the report on “Rehabilitation Progress Report” (approved)"), `banner names the earlier report: ${banner}`);
      assert(banner.includes(state.counts), `same counts: ${banner} vs ${state.counts}`);
      assert(banner.includes("Nothing was uploaded again."), "says no upload");
      assert(!/Consent recorded on that report is not carried over/.test(banner), "the notes recorded consent themselves: nothing to reset");
      assert((await app.locator("input[type=file]").count()) === 0, "no upload on this page");
      const text = await mainText(app);
      assert(text.includes(state.patient), "the data step shows the patient");
      const notesCount = (await app.locator("section[aria-label='Record counts'] div", { hasText: "Clinical notes" }).first().innerText()).replace(/\s+/g, " ");
      assert(notesCount.includes(state.counts.split(" ")[0]), `notes count ${notesCount}`);
      assert(await app.getByRole("button", { name: "Upload other notes instead" }).isVisible(), "back = upload other notes");
      await shot(app, "reuse-step2-check-the-data");
      return banner;
    });

    await step("reuse: choosing the form – Northfield marked 'Already completed for this patient', nothing preselected; Kingsway chosen → report 2", async () => {
      await app.getByRole("button", { name: "Choose the referrer form" }).click();
      await app.getByRole("radio").first().waitFor({ timeout: 20000 });
      const marked = app.locator("[role=radio]", { has: app.locator("[data-completed-form]") });
      assert((await marked.count()) === 1, "one form marked");
      assert(/Rehabilitation Progress Report/.test(await marked.innerText()), "Northfield is the one marked");
      assert((await app.locator("[role=radio][aria-checked=true]").count()) === 0, "nothing preselected");
      assert(await app.getByRole("button", { name: "Complete this form" }).isDisabled(), "a form must be chosen");
      assert(/Choose the other form to complete for this patient\./.test(await mainText(app)), "asks for the other form");
      await shot(app, "reuse-step3-choose-other-form");
      state.report2 = await completeChosen(app, /Return to Work Assessment/);
      save();
      await shot(app, "report2-review", false);
      return state.report2;
    });

    await step("report 2 is a NEW report: new id, the same patient, episode and notes, no 'amends', activity 'notes_reused'", async () => {
      const [r1, r2] = [await storedReport(app, state.report1), await storedReport(app, state.report2)];
      assert(r2 && r2.id !== r1.id, "a new id");
      assert(r2.patientLabel === r1.patientLabel, "same patient");
      assert(JSON.stringify(r2.episodeRef) === JSON.stringify(r1.episodeRef), "same episode");
      assert(r2.bundleSnapshot.notes.length === r1.bundleSnapshot.notes.length, "same notes count");
      assert(JSON.stringify(r2.bundleSnapshot.notes.map((n) => n.id)) === JSON.stringify(r1.bundleSnapshot.notes.map((n) => n.id)), "the same notes");
      assert(r2.amends === undefined && (r2.version === undefined || r2.version === 1), "not an amendment");
      assert(r2.status === "draft" && !r2.receipt, "a draft of its own");
      assert(r2.form && /Return to Work Assessment/.test(r2.form.title), "on the other form");
      const reusedEntry = r2.activity.find((a) => a.action === "notes_reused");
      assert(reusedEntry && /already checked for the report on “Rehabilitation Progress Report” \(approved\)/.test(reusedEntry.detail), `activity ${JSON.stringify(r2.activity.map((a) => a.action))}`);
      assert(r1.status === "signed", "report 1 unchanged (still approved)");
      await app.getByRole("tab", { name: /Activity/ }).first().click().catch(() => undefined);
      await app.waitForTimeout(600);
      assert(/Notes reused from an earlier report/.test(await mainText(app)), "the Activity tab names it");
      await shot(app, "report2-activity-tab", false);
      return { report1: r1.id, report2: r2.id, notes: r2.bundleSnapshot.notes.length };
    });

    await step("Reports list: both of the patient's forms; 'Another form' on the draft report 2 opens the wizard with its notes ('draft')", async () => {
      await app.goto(`${BASE}/app/studio`);
      await app.getByRole("button", { name: /^All/ }).click();
      await app.waitForTimeout(800);
      const rows = app.locator("tbody tr", { hasText: state.patient });
      assert((await rows.count()) === 2, `rows ${await rows.count()}`);
      await shot(app, "reports-list-another-form", false);
      const row2 = app.locator(`tbody tr:has(a[href='/app/studio/${state.report2}'])`);
      await row2.locator("[data-reuse-notes]").click();
      await app.waitForURL(`${BASE}/app/studio/new?from=${state.report2}`, { timeout: 30000 });
      await app.waitForSelector("[data-reused-notes]", { timeout: 30000 });
      const banner = (await app.locator("[data-reused-notes]").innerText()).replace(/\s+/g, " ");
      assert(/the report on “Return to Work Assessment” \(draft\)/.test(banner), banner);
      await shot(app, "reuse-from-list-draft", false);
      // Back to the upload: the from= parameter is dropped.
      await app.getByRole("button", { name: "Upload other notes instead" }).click();
      await app.waitForSelector("text=Drop the patient's notes here", { timeout: 20000 });
      assert(!/from=/.test(app.url()), `url ${app.url()}`);
      return banner.trim();
    });

    await step("the clinic's activity: 'Patient notes reused for another form' rows linking to the earlier reports (counts only)", async () => {
      await app.goto(`${BASE}/app/settings/activity`);
      await app.waitForSelector("text=Activity");
      const body = await mainText(app);
      const n = (body.match(/Patient notes reused for another form/g) || []).length;
      assert(n === 2, `rows ${n}`);
      assert(/from an approved report/.test(body) && /from a draft report/.test(body), "says which kind of report");
      assert((await app.locator(`a[href='/app/studio/${state.report1}']`).count()) >= 1, "links to report 1");
      await shot(app, "activity-notes-reused");
      return `${n} rows`;
    });

    await step("gone: report 2 deleted → its notes cannot be reused (plain words, upload offered); a made-up id says the same", async () => {
      const del = await app.evaluate(async (id) => (await fetch(`/api/reports/v1/store/reports/${id}`, { method: "DELETE", headers: { "content-type": "application/json" } })).status, state.report2);
      assert(del === 200, `delete ${del}`);
      for (const id of [state.report2, "rpt_not_in_this_clinic"]) {
        await app.goto(`${BASE}/app/studio/new?from=${id}`);
        await app.waitForSelector("text=The patient's notes are no longer here", { timeout: 30000 });
        const text = await mainText(app);
        assert(/it may have been deleted, or removed at the end of your clinic's retention period/.test(text), text.slice(0, 300));
        assert((await app.locator("input[type=file]").count()) >= 1, "the upload is offered");
      }
      await shot(app, "reuse-gone-plain-words");
    });

    await step("375 px: the wizard with the reused notes and the report header's action fit (no sideways scroll from them)", async () => {
      // Elements wider than the screen, innermost first (to tell this change's elements from anything else on the page).
      const offenders = () =>
        app.evaluate(() => {
          const w = window.innerWidth;
          const out = [];
          for (const el of Array.from(document.querySelectorAll("body *"))) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > w + 1 && !Array.from(el.children).some((c) => c.getBoundingClientRect().right > w + 1)) {
              out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), right: Math.round(r.right), text: (el.textContent || "").trim().slice(0, 60) });
            }
          }
          return out.slice(0, 5);
        });
      const ownFits = (sel) => app.evaluate((s) => Array.from(document.querySelectorAll(s)).every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1), sel);
      await app.setViewportSize({ width: 375, height: 812 });
      await app.goto(`${BASE}/app/studio/new?from=${state.report1}`);
      await app.waitForSelector("[data-reused-notes]", { timeout: 30000 });
      const wizardOverflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const bannerFits = await ownFits("[data-reused-notes], [data-reused-notes] *");
      await shot(app, "reuse-375");
      await app.goto(`${BASE}/app/studio/${state.report1}`);
      await app.waitForSelector("header [data-reuse-notes]", { timeout: 30000 });
      const reviewOverflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const actionFits = await ownFits("[data-reuse-notes], [data-reuse-notes] *, #reuse-notes-hint");
      const reviewOffenders = reviewOverflow > 1 ? await offenders() : [];
      await shot(app, "report-header-375", false);
      await app.goto(`${BASE}/app/studio`);
      await app.getByRole("button", { name: /^All/ }).click();
      await app.locator("[data-reuse-notes]:visible").first().waitFor({ timeout: 30000 });
      const listOverflow = await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const rowFits = await ownFits("[data-reuse-notes], [data-reuse-notes] *");
      await shot(app, "reports-list-375", false);
      await app.setViewportSize({ width: 1360, height: 900 });
      assert(wizardOverflow <= 1, `wizard overflow ${wizardOverflow}px`);
      assert(listOverflow <= 1, `list overflow ${listOverflow}px`);
      assert(bannerFits && actionFits && rowFits, `own elements fit: banner ${bannerFits}, header action ${actionFits}, row ${rowFits}`);
      // Anything else wider than the screen on the review page is not part of this change: reported, not failed on.
      return { wizardOverflow, listOverflow, reviewOverflow, reviewOffenders };
    });

    await step("nothing from the notes in browser storage; a signed-out request is refused (401) and writes nothing", async () => {
      const stored = await app.evaluate(() => {
        const out = [];
        for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i)}=${s.getItem(s.key(i))}`);
        return out.join("\n");
      });
      assert(!/Whitlock|Millstream|SAMPLE-0002|Willowmere|HCM-2026-0417/.test(stored), "notes content in storage");
      const res = await fetch(`${BASE}/api/reports/v1/store/reports/${state.report1}/reuse`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: "{}" });
      assert(res.status === 401, `signed out: ${res.status}`);
      return `${stored.split("\n").filter(Boolean).length} storage entries, none with notes content; signed out → ${res.status}`;
    });
    await ctx.close();
  } finally {
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ run: N, results, problems, prefetchAborts }, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} steps passed; ${problems.length} browser problems (${prefetchAborts} link prefetches cut off by navigation, not counted)`);
    for (const p of problems.slice(0, 30)) console.log(`  ${p}`);
    if (browser) await browser.close();
    await stopServer();
    const secrets = [ENV.BETTER_AUTH_SECRET, ENV.MEDREPORT_SIGNING_SECRET, ...Object.values(state.accounts).map((a) => a.password)];
    if (secrets.some((s) => s && serverLog.includes(s))) console.log("WARNING: a test secret appeared in the server log");
    fs.writeFileSync(path.join(PRIVATE, "server.log"), serverLog, { mode: 0o600 });
    fs.rmSync(ENV.CLINFORMS_SQLITE_PATH, { force: true });
  }
})().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
