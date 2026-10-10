/**
 * The public demo's live drafting passcode is checked by the server before the Studio stores it
 * (POST /api/reports/v1/passcode/check), in a real browser against a local `next start` that this script starts
 * itself – in auto mode, with a dummy key that is never valid (and ANTHROPIC_BASE_URL pointed at a closed local
 * port) and test-only passcodes generated here, never printed. Nothing reaches the drafting service.
 *
 *   1. /reports: the badge offers the passcode ("Demo mode · passcode for live").
 *   2. A wrong passcode: spinner and disabled button while the server checks, then "Passcode not recognised";
 *      nothing stored; the badge stays in demo mode.
 *   3. The right passcode: stored, the dialog closes, the badge shows "Live drafting".
 *   4. Reload: the stored passcode is re-checked once (one request) and the badge returns to live.
 *   5. The server restarts with a CHANGED passcode; reload: the re-check refuses the stored one, it is removed
 *      from the tab, the badge shows demo mode and a one-line notice says why.
 *   6. Too many wrong passcodes: "Too many attempts – try again in N minutes"; even the right one is not stored.
 *   Throughout: no /drafts or /forms/analyse request, and the server log never contains a passcode.
 *
 *   npm run build
 *   NODE_PATH=<node_modules with playwright> node scripts/e2e/passcode-check.cjs     [PORT=3141]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert/strict");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3141);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "passcode-check");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");

const testPasscode = () => `test-only-${crypto.randomBytes(12).toString("hex")}`;
const PASS_A = testPasscode();
const PASS_B = testPasscode();
const WRONG = "test-only-wrong-guess";
const SECRETS = {
  MEDREPORT_LAUNCH_SECRET: `test-only-launch-${crypto.randomBytes(16).toString("hex")}`,
  MEDREPORT_SIGNING_SECRET: `test-only-signing-${crypto.randomBytes(16).toString("hex")}`,
  MEDREPORT_PARTNER_KEY: `test-only-partner-${crypto.randomBytes(16).toString("hex")}`,
  TM3_SIM_TOKEN: `test-only-sim-${crypto.randomBytes(16).toString("hex")}`,
};

let serverLog = "";
let server = null;

async function startServer(passcode) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(MEDREPORT_|ANTHROPIC_|CLINFORMS_|TM3_SIM_|BETTER_AUTH_|NEXT_PUBLIC_POSTHOG)/.test(k)) delete env[k];
  Object.assign(env, SECRETS, {
    PORT: String(PORT),
    NODE_ENV: "production",
    MEDREPORT_AI_MODE: "auto",
    ANTHROPIC_API_KEY: "test-dummy-key-never-valid",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    MEDREPORT_LIVE_PASSCODE: passcode,
  });
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${BASE}/api/reports/v1/health`);
      if (res.ok) return (await res.json()).liveAiAvailable;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not come up");
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  try {
    process.kill(-s.pid, "SIGTERM");
  } catch {
    // gone
  }
  await new Promise((r) => {
    s.once("exit", r);
    setTimeout(r, 5000);
  });
  // Wait until the port is free.
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    try {
      await fetch(`${BASE}/api/reports/v1/health`);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return;
    }
  }
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n     ${String(e && e.message ? e.message : e).slice(0, 1200)}`);
  }
}

(async () => {
  const live = await startServer(PASS_A);
  assert.equal(live, true, "health: live drafting available (auto mode, key and passcode set)");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e)));

  const badge = () => page.locator("button[data-drafting-mode]");
  const storedPasscode = () => page.evaluate(() => sessionStorage.getItem("medreport.passcode"));
  const checks = () => requests.filter((r) => r === "POST /api/reports/v1/passcode/check").length;
  const waitBadge = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("button[data-drafting-mode]")?.textContent || ""), re.source, { timeout: 15_000 });
  const openDialog = async () => {
    await badge().click();
    await page.locator("#medreport-passcode").waitFor();
  };
  const dialog = () => page.getByRole("dialog");
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  // Hold every check back a little, so the "checking" state is visible.
  await page.route("**/api/reports/v1/passcode/check", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });

  await step("1 /reports: the badge offers the passcode (demo mode)", async () => {
    await page.goto(`${BASE}/reports`);
    await waitBadge(/Demo mode · passcode for live/);
    assert.equal(await badge().getAttribute("data-drafting-mode"), "demo");
    assert.equal(checks(), 0, "nothing stored, nothing to re-check");
    await shot("1-demo");
  });

  await step("2 wrong passcode: spinner while checking, then 'Passcode not recognised'; nothing stored; still demo", async () => {
    await openDialog();
    await page.locator("#medreport-passcode").fill(WRONG);
    await dialog().getByRole("button", { name: "Use live drafting" }).click();
    const busy = dialog().locator("form button[type=submit]");
    await page.waitForFunction(() => /Checking…/.test(document.querySelector("[role=dialog] form button[type=submit]")?.textContent || ""), null, { timeout: 2000 });
    assert.equal(await busy.isDisabled(), true, "button disabled while checking");
    await shot("2a-checking");
    const msg = dialog().locator("[data-passcode-message]");
    await msg.waitFor({ timeout: 10_000 });
    assert.equal((await msg.innerText()).trim(), "Passcode not recognised");
    assert.equal(await storedPasscode(), null, "a refused passcode is never stored");
    assert.equal(await badge().getAttribute("data-drafting-mode"), "demo");
    assert.match(await badge().innerText(), /Demo mode/);
    assert.equal(await dialog().isVisible(), true, "the dialog stays open to try again");
    assert.equal(await busy.isDisabled(), false, "the button is usable again");
    assert.equal(await page.locator("#medreport-passcode").inputValue(), WRONG, "the typed text stays to correct it");
    await shot("2b-not-recognised");
  });

  await step("3 right passcode: stored, dialog closes, badge shows Live drafting", async () => {
    await page.locator("#medreport-passcode").fill(PASS_A);
    await page.locator("#medreport-passcode").press("Enter");
    await dialog().waitFor({ state: "hidden", timeout: 10_000 });
    await waitBadge(/Live drafting/);
    assert.equal(await badge().getAttribute("data-drafting-mode"), "live");
    assert.equal(await storedPasscode(), PASS_A);
    await shot("3-live");
  });

  await step("4 reload: the stored passcode is re-checked once and the badge returns to live", async () => {
    const before = checks();
    await page.reload();
    await waitBadge(/Live drafting/);
    assert.equal(checks() - before, 1, "one re-check per page load");
    assert.equal(await page.locator("[data-passcode-notice]").count(), 0);
  });

  await step("5 server passcode changed + reload: the stored one is cleared, demo mode, one-line notice", async () => {
    await stopServer();
    assert.equal(await startServer(PASS_B), true);
    const before = checks();
    await page.reload();
    const notice = page.locator("[data-passcode-notice]");
    await notice.waitFor({ timeout: 15_000 });
    assert.equal(await notice.getAttribute("data-passcode-notice"), "rejected");
    assert.match(await notice.innerText(), /no longer accepted.*demo mode/);
    await waitBadge(/Demo mode · passcode for live/);
    assert.equal(await badge().getAttribute("data-drafting-mode"), "demo");
    assert.equal(await storedPasscode(), null, "removed from the tab");
    assert.equal(checks() - before, 1);
    await shot("5-rotated");
    await notice.getByRole("button", { name: "Dismiss" }).click();
    assert.equal(await notice.count(), 0);
  });

  await step("6 too many wrong passcodes: 'Too many attempts – try again in N minutes'; the right one is not stored either", async () => {
    // The re-check in step 5 counted one wrong guess for this client; four more lock it out.
    await openDialog();
    for (let i = 0; i < 4; i++) {
      await page.locator("#medreport-passcode").fill(`${WRONG}-${i}`);
      await dialog().getByRole("button", { name: "Use live drafting" }).click();
      await page.waitForFunction(() => /Passcode not recognised/.test(document.querySelector("[data-passcode-message]")?.textContent || ""), null, { timeout: 10_000 });
    }
    await page.locator("#medreport-passcode").fill(PASS_B);
    await dialog().getByRole("button", { name: "Use live drafting" }).click();
    await page.waitForFunction(() => /Too many attempts/.test(document.querySelector("[data-passcode-message]")?.textContent || ""), null, { timeout: 10_000 });
    assert.match(await dialog().locator("[data-passcode-message]").innerText(), /^Too many attempts – try again in \d+ minutes?$/);
    assert.equal(await dialog().locator("form button[type=submit]").isDisabled(), false);
    await page.waitForTimeout(300); // let the button's transition settle for the screenshot
    assert.equal(await storedPasscode(), null);
    assert.equal(await badge().getAttribute("data-drafting-mode"), "demo");
    await shot("6-locked");
  });

  await step("throughout: no drafting request, no page error, no passcode in the server log", async () => {
    assert.deepEqual(requests.filter((r) => /\/(drafts|forms\/analyse)$/.test(r)), []);
    assert.deepEqual(problems, []);
    for (const secret of [PASS_A, PASS_B, WRONG]) assert.ok(!serverLog.includes(secret), "a passcode reached the server log");
    assert.match(serverLog, /"event":"passcode_check","result":"ok"/);
    assert.match(serverLog, /"event":"passcode_check","result":"invalid"/);
    assert.match(serverLog, /"event":"passcode_check","result":"locked"/);
  });

  await browser.close();
  await stopServer();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed; screenshots in ${path.relative(REPO, OUT)}`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await stopServer();
  process.exit(1);
});
