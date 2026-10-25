/**
 * Demo clinics, end to end in a real browser – LOCAL ONLY (a throwaway SQLite database and a local `next start` that
 * this script starts itself; never a preview or production database). Fictional / made-up data only.
 *
 *   setup  test-only secrets generated here (state file chmod 600, never printed); two clinics created with the
 *          local admin script (`admin:create-clinic`, invitation links kept in chmod-600 files, never printed):
 *          DEMO = "ZZ Demo Physio (fictional)" (owner Sarah Reid), REAL = "ZZ Abbey Physio (fictional)" (owner Olivia
 *          Real, also this run's platform administrator); DEMO made a demo clinic with `admin:set-demo-clinic --on`.
 *   demo   Sarah Reid: invitation → account → two-step; the banner "Demo clinic – made-up data only" on /app and in
 *          the Studio (+ the header pill); her own signing details accept PH-DEMO-01; uploads the bundled Northfield
 *          form, confirms its map, imports the sample printed notes, completes the form (drafting is off for a new
 *          clinic: blank answers typed in), the preview carries the demo notice; approves AS HERSELF – Sarah Reid,
 *          PH-DEMO-01 – like any customer; downloads the final PDF and READS it (Sarah Reid + PH-DEMO-01, the notice
 *          on every page) and the answers .txt (the notice); the activity page says "Demo clinic – approved with
 *          the made-up number PH-DEMO-01" and "Made a demo clinic by ClinForms".
 *   real   Olivia: no banner; PH-DEMO-01 refused in her signing details; on the platform page the DEMO clinic is
 *          listed as a demo clinic, REAL is switched on (banner appears, PH-DEMO-01 then saves), switched off again
 *          (banner gone, "1 member still holds a made-up number", the members page warns). Olivia then prepares the
 *          same form in REAL's Studio: approval is refused up front (the made-up number), and a complete POST /sign
 *          is refused by the server – 403 DEMO_NUMBER_NOT_ALLOWED, nothing approved. Both switches are in the
 *          platform's recent actions.
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/demo-clinic.cjs
 *     [PORT=3253] [E2E_OUT=<folder for screenshots, downloads and results>] [RUN_ID=<n>]
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3253);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "demo-clinic");
const N = process.env.RUN_ID || String(Date.now()).slice(-6);
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error("local only");

const PRIVATE = path.join(OUT, "private");
fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
const STATE_FILE = path.join(PRIVATE, "state.json");
const state = { run: N, accounts: {} };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

const DEMO = { slug: `zz-demo-e2e-${N}`, name: "ZZ Demo Physio (fictional)" };
const REAL = { slug: `zz-real-e2e-${N}`, name: "ZZ Abbey Physio (fictional)" };
const SARAH = { email: `zz-sarah-${N}@example.com`, name: "Sarah Reid", hcpc: "PH-DEMO-01", jobTitle: "Senior Physiotherapist" };
const OLIVIA = { email: `zz-olivia-${N}@example.com`, name: "Olivia Real (fictional)" };
const BANNER = "Demo clinic – made-up data only";
const NOTICE = "DEMONSTRATION – made-up data from a demo clinic. Not for clinical use.";
const NOTICE_TAIL = "made-up data from a demo clinic. Not for clinical use.";

/* ------------------------------------------------------------------------------------------------
 * Local environment: test-only values, never printed
 * ----------------------------------------------------------------------------------------------*/

const rnd = (n) => crypto.randomBytes(n).toString("base64url");
const ENV = (() => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(MEDREPORT_|ANTHROPIC_|CLINFORMS_|TM3_SIM_|BETTER_AUTH_|NEXT_PUBLIC_POSTHOG|DATABASE_|MAILERSEND_|APP_ORIGIN|VERCEL)/.test(k)) delete env[k];
  Object.assign(env, {
    PORT: String(PORT),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: path.join(PRIVATE, `clinforms-e2e-${N}.db`),
    CLINFORMS_DATA_KEYS: JSON.stringify({ e2e: crypto.randomBytes(32).toString("base64") }),
    CLINFORMS_DATA_KEY_ID: "e2e",
    BETTER_AUTH_SECRET: `test-only-${rnd(32)}`,
    BETTER_AUTH_URL: BASE,
    CLINFORMS_EMAIL_PROVIDER: "none",
    CLINFORMS_PUBLIC_DEMO: "1",
    CLINFORMS_PLATFORM_ADMINS: OLIVIA.email,
    MEDREPORT_LAUNCH_SECRET: `test-only-launch-${rnd(16)}`,
    MEDREPORT_SIGNING_SECRET: `test-only-signing-${rnd(16)}`,
    MEDREPORT_PARTNER_KEY: `test-only-partner-${rnd(16)}`,
    TM3_SIM_TOKEN: `test-only-sim-${rnd(16)}`,
  });
  return env;
})();

/** Runs an npm script with the local env; output to a chmod-600 file (it may hold an invitation link). */
function npmScript(name, args, file) {
  const r = spawnSync("npm", ["run", "-s", name, "--", ...args], { cwd: REPO, env: ENV, encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  fs.writeFileSync(file, out, { mode: 0o600 });
  if (r.status !== 0) throw new Error(`${name} failed (exit ${r.status}); see ${path.relative(REPO, file)}`);
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
 * Helpers (TOTP, steps, screenshots)
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
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage }).catch(() => undefined);
const mainText = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main").cloneNode(true);
    main.querySelectorAll("select, option").forEach((el) => el.remove());
    return (main.textContent || "").replace(/\s+/g, " ");
  });

/** Next's link prefetches cut off by this script's own page.goto() – not an application problem (counted apart). */
const PREFETCH_ABORT = /Failed to fetch RSC payload for .* Falling back to browser navigation/;
let prefetchAborts = 0;
function watch(page, problems, label) {
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || /status of 403/.test(m.text())) return;
    if (PREFETCH_ABORT.test(m.text())) {
      prefetchAborts++;
      return;
    }
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

/** The member's own row on Settings → Members, with "Manage" open. */
async function ownMemberRow(page, who) {
  await page.goto(`${BASE}/app/settings/members`);
  const row = page.locator("li", { has: page.locator(`p:text-is("${who.email}")`) }).first();
  await row.waitFor({ timeout: 30000 });
  await row.locator("summary:has-text('Manage')").click();
  return row;
}

/** Saves the member's own signing details; returns the form's message ("Saved." or the error). */
async function saveSigning(page, who, { jobTitle = "", hcpc, canSign }) {
  const row = await ownMemberRow(page, who);
  await row.locator("input[name=jobTitle]").fill(jobTitle);
  await row.locator("input[name=hcpcNumber]").fill(hcpc);
  const box = row.locator("input[name=canSign]");
  if (canSign) await box.check();
  else await box.uncheck();
  await row.locator("button:has-text('Save signing details')").click();
  const msg = row.locator("span.text-teal-700, span.text-red-700").first();
  await msg.waitFor({ timeout: 20000 });
  return { row, message: (await msg.innerText()).trim() };
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

/** Answer every required question the notes did not answer (Flags: "Missing field") as the clinician would. */
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

/** A drafted answer that still blocks approval: removed and answered in the clinician's own words. */
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

/** Forms library: upload the Northfield sample, analyse, confirm the map (the clinic's own copy). */
async function uploadAndConfirmNorthfield(app, file) {
  await app.goto(`${BASE}/app/studio/forms`);
  await app.waitForSelector("text=Upload a referrer form");
  await app.locator("button:has-text('Upload a referrer form')").first().click();
  await app.locator("[role=dialog] input[type=file]").setInputFiles(file);
  await app.getByRole("button", { name: /Analyse form|Analyse again/ }).waitFor();
  await app.fill("#upload-referrer", "Northfield Assurance (fictional)");
  await app.selectOption("#upload-referrer-type", "insurer");
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

/** New report from the sample printed notes on the Northfield form; returns the stored report. */
async function completeFromNotes(app, notesFile, shotPrefix) {
  await app.goto(`${BASE}/app/studio/new`);
  await app.waitForSelector("text=Drop the patient's notes here");
  await app.locator("input[type=file]").first().setInputFiles(notesFile);
  await app.waitForSelector("text=Check what was imported", { timeout: 60000 });
  await app.getByRole("button", { name: "Choose the referrer form" }).click();
  const radio = app.getByRole("radio", { name: /Rehabilitation Progress Report|Northfield/ }).first();
  await radio.waitFor({ timeout: 20000 });
  await radio.click();
  await shot(app, `${shotPrefix}-choose-form`, false);
  await app.getByRole("button", { name: "Complete this form" }).click();
  // Drafting from the notes is off for a new clinic: the wizard offers "Open for review" instead of opening it.
  const open = app.getByRole("link", { name: "Open for review" });
  await Promise.race([app.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 180000 }), open.waitFor({ timeout: 180000 })]);
  if (!/\/app\/studio\/rpt_/.test(app.url())) {
    await open.click();
    await app.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 60000 });
  }
  const reportId = app.url().split("/").pop();
  await app.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
  await app.waitForTimeout(2500);
  return app.evaluate(async (id) => (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).report, reportId);
}

/** Every gap resolved, blank answers typed in, consent recorded: what stands between the report and approval. */
async function prepareForApproval(app) {
  const acted = await resolveEverything(app);
  const answered = await answerMissing(app);
  const acted2 = await resolveEverything(app);
  const rewritten = await rewriteBlocked(app);
  const acted3 = rewritten.length ? await resolveEverything(app) : 0;
  // Consent for uploaded notes, when the notes do not show it (recorded on the report by the approver).
  const consent = app.getByRole("button", { name: /Record consent/ });
  if (await consent.count()) {
    await consent.first().click();
    await app.waitForTimeout(500);
    const dlg = app.getByRole("dialog");
    if (await dlg.count()) {
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await dlg.getByRole("button", { name: /Record|Save|Confirm/ }).last().click();
      await app.waitForTimeout(800);
    }
  }
  await app.waitForTimeout(1500);
  return { gapActions: acted + acted2 + acted3, answered, rewritten };
}

/** Every page's text of a PDF (the repo's own pdf.js, legacy build for Node). */
async function pdfPages(file) {
  const pdfjs = await import(pathToFileURL(path.join(REPO, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
  const task = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
    standardFontDataUrl: `${pathToFileURL(path.join(REPO, "node_modules/pdfjs-dist/standard_fonts")).href}/`,
  });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str || "").join(" ").replace(/\s+/g, " "));
  }
  await task.destroy();
  return pages;
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * ----------------------------------------------------------------------------------------------*/

(async () => {
  const problems = [];
  let browser = null;
  try {
    /* ---------------------------------------------------------------- setup (admin scripts) */
    for (const who of [SARAH, OLIVIA]) state.accounts[who.email] = { password: `e2e ${rnd(12)} pw` };
    save();
    await step("setup: local database migrated (0008 included); two clinics created with the admin script (links kept private)", async () => {
      npmScript("db:migrate", [], path.join(PRIVATE, "db-migrate.txt"));
      for (const [clinic, owner, file] of [
        [DEMO, SARAH, "invite-demo.txt"],
        [REAL, OLIVIA, "invite-real.txt"],
      ]) {
        const out = npmScript("admin:create-clinic", ["--name", clinic.name, "--slug", clinic.slug, "--owner-email", owner.email, "--app-url", BASE, "--retention-days", "30"], path.join(PRIVATE, file));
        const link = (out.match(/http:\/\/localhost:\d+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
        assert(link, `no invitation link in ${file}`);
        state[`link:${clinic.slug}`] = link;
      }
      save();
      return { demo: DEMO.slug, real: REAL.slug };
    });
    await step("setup: admin:set-demo-clinic – --show (real), --on (demo clinic, audited), a missing switch refused", async () => {
      const before = npmScript("admin:set-demo-clinic", ["--slug", DEMO.slug, "--show"], path.join(OUT, "set-demo-clinic-show-before.txt"));
      assert(/a real clinic \(not a demo clinic\)/.test(before), before);
      const done = npmScript("admin:set-demo-clinic", ["--slug", DEMO.slug, "--on"], path.join(OUT, "set-demo-clinic-on.txt"));
      assert(/^Done: .* is a DEMO clinic \(made-up data only\)\./m.test(done), done);
      const again = npmScript("admin:set-demo-clinic", ["--slug", DEMO.slug, "--on"], path.join(OUT, "set-demo-clinic-on-again.txt"));
      assert(/^Nothing to change/m.test(again), again);
      let refused = "";
      try {
        npmScript("admin:set-demo-clinic", ["--slug", DEMO.slug], path.join(OUT, "set-demo-clinic-no-switch.txt"));
      } catch (e) {
        refused = String(e.message);
      }
      assert(/failed/.test(refused), "without --on / --off / --show the script refuses");
      return { show: before.trim(), on: done.split("\n")[0], again: again.split("\n")[0] };
    });

    await startServer();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

    /* ---------------------------------------------------------------- the demo clinic */
    const ctxD = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    const app = await ctxD.newPage();
    watch(app, problems, "demo-sarah");

    await step("DEMO (Sarah Reid): invitation → account → two-step; /app carries the banner 'Demo clinic – made-up data only'", async () => {
      await acceptInvite(app, state[`link:${DEMO.slug}`], SARAH);
      await app.waitForSelector("[data-demo-clinic-banner]");
      const banner = (await app.locator("[data-demo-clinic-banner]").innerText()).trim();
      assert(banner === BANNER, `banner: ${banner}`);
      await shot(app, "01-demo-app-overview-banner", false);
      return banner;
    });

    await step("DEMO members page: Sarah's own signing details accept the made-up PH-DEMO-01 (with the demo hint)", async () => {
      const { row, message } = await saveSigning(app, SARAH, { jobTitle: SARAH.jobTitle, hcpc: "ph-demo-01", canSign: true });
      assert(message === "Saved.", `save: ${message}`);
      assert(/a made-up number such as PH-DEMO-01 is accepted here/.test(await row.innerText()), "the demo hint");
      await app.reload();
      const text = await mainText(app);
      assert(text.includes(`${SARAH.jobTitle} · HCPC PH-DEMO-01 · May sign`), `stored as PH-DEMO-01: ${text.slice(0, 400)}`);
      await shot(app, "02-demo-members-ph-demo-accepted");
    });

    await step("DEMO Studio: the banner above every page and the 'Demo clinic' pill in the sticky header", async () => {
      await app.goto(`${BASE}/app/studio`);
      await app.waitForSelector("[data-demo-clinic-pill]", { timeout: 30000 });
      assert((await app.locator("[data-demo-clinic-banner]").innerText()).trim() === BANNER, "Studio banner");
      assert((await app.locator("[data-demo-clinic-pill]").innerText()).trim() === "Demo clinic", "pill");
      await shot(app, "03-demo-studio-home", false);
    });

    const inputs = path.join(OUT, "inputs");
    fs.mkdirSync(inputs, { recursive: true });
    const northfield = path.join(inputs, "northfield-rehab-progress.pdf");
    const notes = path.join(inputs, "priya-nair-notes.pdf");

    await step("DEMO: upload the bundled Northfield sample form, analyse, confirm the map", async () => {
      const res = await fetch(`${BASE}/api/reports/v1/forms/samples/northfield-rehab-progress/file`);
      assert(res.ok, `sample form ${res.status}`);
      fs.writeFileSync(northfield, Buffer.from(await res.arrayBuffer()));
      const ts = fs.readFileSync(path.join(REPO, "src/modules/medreport/connectors/file-import/samples/generated/priya-nair-notes.pdf.b64.ts"), "utf8");
      const m = ts.match(/"([A-Za-z0-9+/=]{1000,})"/) || ts.match(/`([A-Za-z0-9+/=\s]{1000,})`/);
      fs.writeFileSync(notes, Buffer.from(m[1].replace(/\s+/g, ""), "base64"));

      await uploadAndConfirmNorthfield(app, northfield);
      await shot(app, "04-demo-form-confirmed", false);
    });

    await step("DEMO: import the sample printed notes, choose Northfield, complete the form (written as Sarah Reid)", async () => {
      const stored = await completeFromNotes(app, notes, "05-demo");
      state.reportId = stored.id;
      save();
      await shot(app, "06-demo-review-draft", false);
      return { reportId: state.reportId, author: stored.author ? `${stored.author.name} (${stored.author.hcpc})` : "none" };
    });

    await step("DEMO review: the preview carries the demo notice; gaps resolved and blank answers typed in", async () => {
      await app.getByRole("tab", { name: /Preview/ }).first().click().catch(() => undefined);
      await app.waitForTimeout(2000);
      const previewNote = app.locator("[role=note][aria-label='Demo clinic']");
      assert((await previewNote.count()) >= 1, "the preview's demo notice bar");
      const noteText = (await previewNote.first().innerText()).replace(/\s+/g, " ");
      assert(noteText.includes(NOTICE), `notice bar: ${noteText}`);
      await shot(app, "07-demo-preview-notice", false);
      const done = await prepareForApproval(app);
      const blocked = await app.locator("#approve-blocked").innerText().catch(() => "");
      assert(/Ready for your approval/.test(blocked), `not ready: ${blocked}`);
      await shot(app, "08-demo-review-ready");
      return done;
    });

    await step("DEMO approve: as herself – Sarah Reid, PH-DEMO-01 from her profile – like any customer", async () => {
      await app.getByRole("button", { name: /^Approve/ }).first().click();
      const dlg = app.getByRole("dialog");
      await dlg.waitFor();
      await app.waitForTimeout(400);
      const name = await dlg.getByLabel("Full name", { exact: true }).inputValue();
      const hcpc = await dlg.getByLabel("HCPC registration number").inputValue();
      assert(name === SARAH.name && hcpc === SARAH.hcpc, `signer ${name} ${hcpc}`);
      await dlg.getByLabel(/Typed signature/).fill(SARAH.name);
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await shot(app, "09-demo-approve-dialog", false);
      await dlg.getByRole("button", { name: /Approve and sign/ }).click();
      await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 60000 });
      await app.waitForTimeout(1500);
      await shot(app, "10-demo-approved", false);
      const stored = await app.evaluate(async (id) => (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).report, state.reportId);
      state.attestations = stored.receipt.attestations;
      save();
      assert(stored.receipt.signer.name === SARAH.name && stored.receipt.signer.hcpc === SARAH.hcpc, `receipt signer ${JSON.stringify(stored.receipt.signer)}`);
      assert(stored.receipt.approvedVia.kind === "user" && stored.receipt.approvedVia.userId, `approvedVia ${JSON.stringify(stored.receipt.approvedVia)}`);
      return `${stored.receipt.signer.name} (${stored.receipt.signer.hcpc})`;
    });

    await step("DEMO: download the final PDF and READ it – Sarah Reid + PH-DEMO-01 in the declaration, the notice on every page", async () => {
      const [d] = await Promise.all([app.waitForEvent("download", { timeout: 120000 }), app.getByRole("button", { name: "Completed form (PDF)" }).click()]);
      const file = path.join(OUT, `final-${d.suggestedFilename()}`);
      await d.saveAs(file);
      assert(fs.readFileSync(file).subarray(0, 5).toString() === "%PDF-", "a PDF");
      const pages = await pdfPages(file);
      const missing = pages.map((t, i) => (t.includes("DEMONSTRATION") && t.includes(NOTICE_TAIL) ? null : i + 1)).filter(Boolean);
      assert(missing.length === 0, `pages without the notice: ${missing.join(", ")}`);
      const all = pages.join(" ");
      assert(all.includes("Sarah Reid") && all.includes("PH-DEMO-01"), "the declaration names Sarah Reid, PH-DEMO-01");
      fs.writeFileSync(path.join(OUT, "final-pdf-text.txt"), pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join("\n\n"));
      return { file: path.basename(file), pages: pages.length };
    });

    await step("DEMO: the copied answers (.txt) carry the demo notice", async () => {
      const btn = app.getByRole("button", { name: /Download answers \(\.txt\)/ });
      if (!(await btn.count())) {
        await app.getByRole("tab", { name: /Copy answers|Answers/ }).first().click().catch(() => undefined);
        await app.waitForTimeout(500);
      }
      const [d] = await Promise.all([app.waitForEvent("download", { timeout: 60000 }), app.getByRole("button", { name: /Download answers \(\.txt\)/ }).first().click()]);
      const file = path.join(OUT, `answers-${d.suggestedFilename()}`);
      await d.saveAs(file);
      const txt = fs.readFileSync(file, "utf8");
      assert(txt.includes(NOTICE), "notice in the .txt");
      return { file: path.basename(file), firstLines: txt.split(/\r?\n/).slice(0, 4).join(" | ") };
    });

    await step("DEMO activity page: the approval, the final document and the switch say what happened", async () => {
      await app.goto(`${BASE}/app/settings/activity?action=report.sign`);
      await app.waitForSelector("h1:has-text('Activity')");
      const text = await mainText(app);
      assert(text.includes("Demo clinic – approved with the made-up number PH-DEMO-01"), `activity: ${text.slice(0, 600)}`);
      assert(text.includes("Sarah Reid"), "who acted");
      await shot(app, "11-demo-activity-approval");
      await app.goto(`${BASE}/app/settings/activity?action=report.render_final`);
      assert((await mainText(app)).includes("Demo clinic – marked as a demonstration"), "the final document's entry");
      await app.goto(`${BASE}/app/settings/activity?action=clinic.demo_on`);
      const onText = await mainText(app);
      assert(/Made a demo clinic by ClinForms/.test(onText) && /ClinForms support/.test(onText), `the switch is in the clinic's own trail: ${onText.slice(0, 400)}`);
      await shot(app, "12-demo-activity-switch");
    });
    await ctxD.close();

    /* ---------------------------------------------------------------- a real clinic */
    const ctxR = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const o = await ctxR.newPage();
    watch(o, problems, "real-olivia");
    o.on("dialog", (d) => d.accept());

    await step("REAL (Olivia): no banner on /app or in the Studio, no pill", async () => {
      await acceptInvite(o, state[`link:${REAL.slug}`], OLIVIA);
      assert((await o.locator("[data-demo-clinic-banner]").count()) === 0, "/app banner");
      await o.goto(`${BASE}/app/studio`);
      await o.waitForSelector("text=Completed and in-progress forms", { timeout: 30000 });
      assert((await o.locator("[data-demo-clinic-banner], [data-demo-clinic-pill]").count()) === 0, "Studio banner / pill");
      assert(!/Demo clinic/.test(await o.locator("body").innerText()), "no demo clinic wording");
      await shot(o, "13-real-studio-no-banner", false);
    });

    await step("REAL members page: PH-DEMO-01 refused in the signing details (strict HCPC check, as before)", async () => {
      const { row, message } = await saveSigning(o, OLIVIA, { jobTitle: "Physiotherapist", hcpc: "PH-DEMO-01", canSign: true });
      assert(/Enter the registration number as shown on the HCPC register/.test(message), `refusal: ${message}`);
      assert(!/PH-DEMO-01 is accepted here/.test(await row.innerText()), "no demo hint");
      await shot(o, "14-real-ph-demo-refused");
      return message;
    });

    await step("platform page: the demo clinic listed; REAL switched on (banner, PH-DEMO-01 saves) and off again (banner gone, warning)", async () => {
      await o.goto(`${BASE}/app/platform`);
      await o.waitForSelector("text=Platform administration");
      const panel = o.locator("form[aria-label='Demo clinic']");
      assert(new RegExp(`Demo clinics now: ${DEMO.name.replace(/[()]/g, "\\$&")} \\(${DEMO.slug}\\)`).test(await panel.innerText()), "DEMO listed");
      assert((await o.locator(`[data-demo-clinic-status='${DEMO.slug}']`).count()) === 1, "DEMO's status pill");
      assert((await o.locator(`[data-demo-clinic-status='${REAL.slug}']`).count()) === 0, "REAL has none");
      await shot(o, "15-platform-demo-panel");
      await panel.locator("select[name=tenantId]").selectOption(REAL.slug);
      await panel.getByRole("button", { name: "Make demo clinic" }).click();
      await panel.locator("text=is now a demo clinic").waitFor({ timeout: 20000 });
      await o.goto(`${BASE}/app`);
      await o.waitForSelector("[data-demo-clinic-banner]", { timeout: 30000 });
      const saved = await saveSigning(o, OLIVIA, { jobTitle: "Physiotherapist", hcpc: "PH-DEMO-01", canSign: true });
      assert(saved.message === "Saved.", `demo clinic: ${saved.message}`);

      await o.goto(`${BASE}/app/platform`);
      const panel2 = o.locator("form[aria-label='Demo clinic']");
      await panel2.locator("select[name=tenantId]").selectOption(REAL.slug);
      await panel2.getByRole("button", { name: "Switch off" }).click();
      const result = panel2.locator("text=is a real clinic again");
      await result.waitFor({ timeout: 20000 });
      const resultText = (await panel2.innerText()).replace(/\s+/g, " ");
      assert(/1 member still holds a made-up number and cannot approve/.test(resultText), resultText);
      const recent = await mainText(o);
      assert(/Demo clinic switched on/.test(recent) && /Demo clinic switched off/.test(recent), "both directions in the platform's recent actions");
      await shot(o, "16-platform-after-switch");
      await o.goto(`${BASE}/app/settings/members`);
      assert((await o.locator("[data-demo-clinic-banner]").count()) === 0, "banner gone again");
      assert((await o.locator("[data-demo-number-warning]").count()) === 1, "the members page warns about the made-up number");
      await shot(o, "17-real-members-warning");
      return resultText.slice(resultText.indexOf(REAL.slug), resultText.indexOf(REAL.slug) + 200);
    });

    await step("REAL Studio: Olivia (made-up PH-DEMO-01 left from the demo period) prepares the same form; approval is refused up front", async () => {
      await uploadAndConfirmNorthfield(o, northfield);
      const stored = await completeFromNotes(o, notes, "18-real");
      state.realReportId = stored.id;
      save();
      await prepareForApproval(o);
      const blocked = (await o.locator("#approve-blocked").innerText()).replace(/\s+/g, " ");
      assert(/PH-DEMO numbers are made up and work in a demo clinic only/.test(blocked), `the Studio says why: ${blocked}`);
      assert(await o.getByRole("button", { name: /^Approve/ }).first().isDisabled(), "Approve is not offered");
      await shot(o, "19-real-review-refused", false);
      return blocked;
    });

    await step("REAL: the server refuses it too – POST /sign with a complete approval → 403 DEMO_NUMBER_NOT_ALLOWED, nothing approved", async () => {
      const r = await o.evaluate(
        async ({ id, signer, attestations }) => {
          const report = (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).report;
          const form = (await (await fetch(`/api/reports/v1/store/forms/${report.form.formId}`)).json()).form;
          const res = await fetch("/api/reports/v1/sign", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ report, form, signer, typedSignature: signer.name, statementAccepted: true, attestations }),
          });
          const after = (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).report;
          return { status: res.status, body: await res.json().catch(() => ({})), receipt: Boolean(after.receipt) };
        },
        { id: state.realReportId, signer: { name: OLIVIA.name, hcpc: "PH-DEMO-01" }, attestations: state.attestations },
      );
      assert(r.status === 403 && r.body.code === "DEMO_NUMBER_NOT_ALLOWED", `${r.status} ${r.body.code} ${r.body.detail || ""}`);
      assert(!r.receipt, "no receipt stored");
      await o.goto(`${BASE}/app/settings/activity?action=report.sign`);
      await o.waitForSelector("h1:has-text('Activity')");
      assert(!/Report approved/.test(await mainText(o)), "no approval in the real clinic's activity");
      return `${r.status} ${r.body.code} – ${r.body.title}`;
    });
    await ctxR.close();
  } finally {
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ run: N, results, problems, prefetchAborts }, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} steps passed; ${problems.length} browser problems (${prefetchAborts} link prefetches cut off by navigation, not counted)`);
    for (const p of problems.slice(0, 30)) console.log(`  ${p}`);
    if (browser) await browser.close();
    await stopServer();
    // The server log never holds a test secret.
    const secrets = [ENV.BETTER_AUTH_SECRET, ENV.MEDREPORT_SIGNING_SECRET, ...Object.values(state.accounts).map((a) => a.password)];
    if (secrets.some((s) => s && serverLog.includes(s))) console.log("WARNING: a test secret appeared in the server log");
    fs.writeFileSync(path.join(PRIVATE, "server.log"), serverLog, { mode: 0o600 });
    fs.rmSync(ENV.CLINFORMS_SQLITE_PATH, { force: true });
  }
})().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
