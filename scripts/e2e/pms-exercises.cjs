/**
 * HOME EXERCISE PROGRAMMES (tracker ex03–ex06, docs/clinic-system/exercise-programmes.md) – screens end to end, LOCAL
 * only. Its own `next start` (PORT, default 3240) on a throwaway SQLite database with the demo clinic
 * (`pms:seed-demo -- --fresh`, fictional data only).
 *
 *   OFF  the server WITHOUT CLINFORMS_EXERCISE: Set-up → Exercises and the record's Exercises pages are 404, no tab
 *   ON   restarted with CLINFORMS_EXERCISE=on:
 *     E1  Set-up → Exercises: in the Set-up list; the clinic's switch is OFF (no tab yet); the owner switches it on,
 *         adds an exercise (https video link) and the demo exercises
 *     E2  Megan Hart's record → Exercises: start a programme, add from the library + write your own, dose, save,
 *         share with the patient (email with a portal link)
 *     E3  the patient opens the link (portal), sees the programme, checks in (done, pain 3, a comment), downloads the PDF
 *     E4  the clinician sees the check-in and the PDF; History shows who opened and printed it
 *     E5  reception (role staff): no Exercises tab and the page is 404; the portal page at 375 px has no sideways scroll
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/dutydesk/node_modules node scripts/e2e/pms-exercises.cjs
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3240);
const ON_PORT = PORT + 2;
let SERVER_PORT = PORT;
let BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "pms-exercises");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-hep-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");
const CLINIC = "riverside-demo";

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
  const run = (q, ...a) => {
    const db = openScratchDb();
    try {
      return db.prepare(q).run(...a);
    } finally {
      db.close();
    }
  };
  let ctx = null;
  try {
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "40", "--app-url", BASE], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert(ownerLink, "owner invitation in the seed output");
    const megan = one("SELECT id, first_name, last_name FROM pms_patients WHERE tenant_id = ? AND import_ref = ?", CLINIC, "sim-pat-001");
    assert(megan, "Megan Hart (fictional) in the demo clinic");
    const record = (p = "") => `/app/clinic/patients/${megan.id}${p}`;

    await startServer({});
    ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-GB", timezoneId: "Europe/London", acceptDownloads: true });
    const owner = await ctx.newPage();
    owner.setDefaultTimeout(45000);
    owner.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    livePages.push(["owner", owner]);
    await acceptInvite(owner, ownerLink, "Helen Ward (fictional)");
    const ownerEmail = one('SELECT u.email FROM "user" u JOIN member m ON m.userId = u.id WHERE m.role = ?', "owner").email;

    await step("OFF", "switch off: Set-up → Exercises and the record's Exercises pages are 404; no tab, no Set-up entry", async () => {
      assert.equal((await owner.goto(`${BASE}/app/clinic/setup/exercises`)).status(), 404);
      assert.equal((await owner.goto(`${BASE}${record("/exercises")}`)).status(), 404);
      await owner.goto(`${BASE}${record()}`);
      assert.equal(await owner.locator(`a[href='${record("/exercises")}']`).count(), 0);
      await owner.goto(`${BASE}/app/clinic/setup/sites`);
      assert.equal(await owner.locator("a[href='/app/clinic/setup/exercises']").count(), 0);
    });

    await stopServer();
    SERVER_PORT = ON_PORT;
    BASE = `http://localhost:${ON_PORT}`;
    await startServer({ CLINFORMS_EXERCISE: "on" });
    let programmeId = null;

    await step("E1", "Set-up → Exercises: listed; the clinic is off by default; the owner switches it on and builds the library", async () => {
      await owner.goto(`${BASE}/app/clinic/setup/sites`);
      await owner.locator("a[href='/app/clinic/setup/exercises']").first().waitFor();
      assert.equal((await owner.goto(`${BASE}${record("/exercises")}`)).status(), 404, "clinic setting still off");
      assert.equal((await owner.goto(`${BASE}/app/clinic/setup/exercises`)).status(), 200);
      await owner.click("button:has-text('Switch on')");
      await owner.waitForSelector("text=Exercise programmes are on for this clinic.");
      await owner.fill("input[name=name]", "Wall press-up (fictional)");
      await owner.selectOption("select[name=bodyArea]", "Shoulder");
      await owner.fill("textarea[name=instructions]", "Stand an arm's length from a wall and lean in slowly.");
      await owner.fill("input[name=videoUrl]", "http://videos.example.org/v/1");
      await owner.click("button:has-text('Add to the library')");
      await owner.waitForSelector("[role=alert]:has-text('Check the fields')");
      await owner.fill("input[name=videoUrl]", "https://videos.example.org/v/1");
      await owner.click("button:has-text('Add to the library')");
      await owner.waitForSelector("text=Added to the library.");
      const demo = owner.locator("button:has-text('Add demo exercises')");
      if (await demo.count()) {
        await demo.click();
        await owner.waitForSelector("text=demo exercises added");
      }
      const n = Number(one("SELECT count(*) AS n FROM pms_exercises WHERE tenant_id = ?", CLINIC).n);
      assert.ok(n >= 1, `library has ${n}`);
      assert.ok(!/\bAI\b|Claude|Anthropic|Physitrack/.test(await owner.locator("main").innerText()), "no vendor or competitor names");
      await owner.screenshot({ path: path.join(OUT, "1-setup.png"), fullPage: true });
      return `${n} exercises in the library`;
    });

    await step("E2", "record → Exercises: start, add from the library + write your own, save, share with an email link", async () => {
      await owner.goto(`${BASE}${record()}`);
      await owner.locator(`a[href='${record("/exercises")}']`).first().click();
      await owner.waitForSelector("h2:has-text('Exercise programmes')");
      await owner.fill("input[name=title]", "Shoulder – weeks 1 to 2 (fictional)");
      await owner.click("button:has-text('Start the programme')");
      await owner.waitForURL(/\/exercises\/exprog_/);
      programmeId = /exercises\/(exprog_[0-9A-Z]{26})/.exec(owner.url())[1];
      const libId = one("SELECT id FROM pms_exercises WHERE tenant_id = ? AND name = ?", CLINIC, "Wall press-up (fictional)").id;
      await owner.selectOption("#ex-pick", libId);
      await owner.click("button:has-text('Add')");
      await owner.fill("#ex-0-sets", "3");
      await owner.fill("#ex-0-reps", "10");
      await owner.fill("#ex-0-daysPerWeek", "5");
      await owner.click("button:has-text('Write your own')");
      await owner.fill("#ex-1-name", "Shoulder rolls (fictional)");
      await owner.fill("#ex-1-reps", "8");
      await owner.fill("#ex-1-notes", "Slowly, both directions.");
      await owner.click("button:has-text('Save draft')");
      await owner.waitForSelector("text=Draft saved.");
      const row = one("SELECT item_count, status, items_enc FROM pms_exercise_programmes WHERE tenant_id = ? AND id = ?", CLINIC, programmeId);
      assert.deepEqual([Number(row.item_count), row.status], [2, "draft"]);
      assert.ok(!String(row.items_enc).includes("Shoulder rolls"), "encrypted at rest");
      await owner.screenshot({ path: path.join(OUT, "2-builder.png"), fullPage: true });
      owner.once("dialog", (d) => d.accept());
      await owner.check("input[name=notify]");
      await owner.click("button:has-text('Share with the patient')");
      await owner.waitForSelector("text=/Shared\\./");
      assert.equal(one("SELECT status FROM pms_exercise_programmes WHERE tenant_id = ? AND id = ?", CLINIC, programmeId).status, "shared");
    });

    const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "en-GB", timezoneId: "Europe/London", acceptDownloads: true });
    const phone = await phoneCtx.newPage();
    phone.setDefaultTimeout(45000);
    livePages.push(["phone", phone]);

    await step("E3", "the patient opens the emailed link, sees the programme, checks in and downloads the PDF", async () => {
      // The email's secret is never readable by staff: give the newest link a secret the test knows (its SHA-256 only).
      const token = crypto.randomBytes(32).toString("base64url");
      const changed = run(
        "UPDATE pms_portal_links SET token_hash = ? WHERE tenant_id = ? AND id = (SELECT l.id FROM pms_portal_links l JOIN pms_portal_accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id WHERE l.tenant_id = ? AND a.patient_id = ? AND l.used_at IS NULL ORDER BY l.created_at DESC, l.id DESC LIMIT 1)",
        crypto.createHash("sha256").update(token, "utf8").digest("hex"),
        CLINIC,
        CLINIC,
        megan.id,
      );
      assert.equal(Number(changed.changes), 1, "a sign-in email was written");
      const next = `/clinics/${CLINIC}/portal/exercises/${programmeId}`;
      await phone.goto(`${BASE}/clinics/${CLINIC}/portal/link/${token}?next=${encodeURIComponent(next)}`);
      await phone.click("button:has-text('Sign in')");
      await phone.waitForURL((u) => u.pathname === next, { timeout: 30000 });
      await phone.waitForSelector("h1:has-text('Shoulder – weeks 1 to 2 (fictional)')");
      const text = await phone.locator("main").innerText();
      assert.match(text, /3 sets × 10 reps · 5 days a week/);
      assert.match(text, /Slowly, both directions\./);
      const video = phone.locator("a:has-text('Watch the video')");
      assert.equal(await video.getAttribute("rel"), "noopener noreferrer");
      assert.equal(await phone.locator("main iframe, main video, main img").count(), 0, "nothing embedded");
      await phone.click("label:has-text('Yes')");
      await phone.selectOption("#ck-pain", "3");
      await phone.fill("#ck-comment", "Easier than last week (fictional).");
      await phone.click("button:has-text('Send check-in')");
      await phone.waitForSelector("text=your clinic can see today's check-in");
      const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at 375 px (${sideways})`);
      await phone.screenshot({ path: path.join(OUT, "3-portal-375.png"), fullPage: true });
      const [download] = await Promise.all([phone.waitForEvent("download"), phone.click("a:has-text('Download as PDF')")]);
      const file = await download.path();
      assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), "%PDF-");
      assert.match(download.suggestedFilename(), /^home-exercises-\d{4}-\d{2}-\d{2}\.pdf$/);
      await phone.goto(`${BASE}/clinics/${CLINIC}/portal`);
      await phone.waitForSelector("h2:has-text('Your exercises')");
    });

    await step("E4", "the clinician sees the check-in and prints the PDF; History shows who opened and printed it", async () => {
      await owner.goto(`${BASE}${record(`/exercises/${programmeId}`)}`);
      await owner.waitForSelector("text=Easier than last week (fictional).");
      assert.match(await owner.locator("main").innerText(), /Did the exercises on 1 of the last 14 days/);
      const res = await owner.request.get(`${BASE}${record(`/exercises/${programmeId}/pdf`)}`);
      assert.equal(res.status(), 200);
      assert.equal(res.headers()["content-type"], "application/pdf");
      await owner.goto(`${BASE}${record("/history")}`);
      const h = await owner.locator("main").innerText();
      for (const label of ["Exercise programme opened", "Exercise programme printed (PDF)", "Patient checked in on their exercises", "Exercise programme shared with the patient"]) assert.ok(h.includes(label), label);
      await owner.screenshot({ path: path.join(OUT, "4-clinician.png"), fullPage: true });
    });

    await step("E5", "reception: no Exercises tab and the pages are 404", async () => {
      run("UPDATE member SET role = 'staff' WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)", ownerEmail);
      try {
        await owner.goto(`${BASE}${record()}`);
        assert.equal(await owner.locator(`a[href='${record("/exercises")}']`).count(), 0);
        assert.equal((await owner.goto(`${BASE}${record(`/exercises/${programmeId}`)}`)).status(), 404);
        assert.equal((await owner.request.get(`${BASE}${record(`/exercises/${programmeId}/pdf`)}`)).status(), 403);
      } finally {
        run("UPDATE member SET role = 'owner' WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)", ownerEmail);
      }
    });

    await phoneCtx.close().catch(() => {});
    if (problems.length) console.log(`page problems: ${problems.join(" | ")}`);
  } catch (err) {
    console.log(`FATAL ${String(err && err.stack ? err.stack : err).slice(0, 2000)}`);
    results.push({ id: "FATAL", pass: false });
  } finally {
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopServer();
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUT, "server.log"), serverLog.replace(/token=[A-Za-z0-9._%-]+/g, "token=[hidden]"));
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
