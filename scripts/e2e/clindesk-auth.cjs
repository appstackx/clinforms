/**
 * Sign-in on BOTH brand hosts (31/10/2026, docs/auth.md "Two brand hosts") in a real browser, LOCAL only: this script
 * starts its own `next start` on a throwaway SQLite database with BETTER_AUTH_URL=http://localhost:<port> and
 * CLINFORMS_AUTH_ORIGINS=http://clinic.localhost:<port> (the clinic brand's local host), and the development email
 * provider (`log`: messages are printed to the server's own output, read here – never on a deployment). Fictional data
 * only (@example.com).
 *
 *   S  admin:create-clinic: a ClinForms clinic (its owner = the platform administrator) → a localhost link; a clinic
 *      created with --brand clinic → a clinic.localhost link ("signs in on"); admin:set-entitlement switches its clinic
 *      package on and prints where links now go. Neither command emails.
 *   D  clinic.localhost (the clinic brand): the owner accepts the invitation there, sets up two-step verification (the
 *      page and the authenticator entry say the clinic brand's name, issuer included), lands on /app/clinic; tab titles
 *      name the brand; the session is host-only (localhost/app → /login); invites a clinician (emailed link →
 *      clinic.localhost, subject names the clinic brand); the clinician joins there; "Forgotten your password?" →
 *      emailed clinic.localhost link → new password → signed out → sign in with it + a code; the reset link works once;
 *      /app/platform is the 404 page for this owner on both hosts.
 *   F  localhost (ClinForms, regression): the platform administrator joins from the localhost link, two-step issuer
 *      "ClinForms", lands on /app, opens /app/platform ("Owner signs in on" choice offered); the clinic brand's owner
 *      signs in on localhost too and lands on /app as before; a reset asked for on localhost for the clinic-brand
 *      owner still links to clinic.localhost (the clinic's brand).
 *   X  Origin/CSRF: Better Auth's sign-in refuses a foreign Origin on both hosts and takes each host's own; no link in
 *      the server output outside the log provider's messages.
 *
 *   npm run build
 *   NODE_PATH=<node_modules with playwright> node scripts/e2e/clindesk-auth.cjs     [PORT=3186] [E2E_OUT=…]
 *
 * Throwaway secrets, passwords and TOTP keys are generated here and never printed; the database and screenshots go to
 * E2E_OUT (default .e2e-out/clindesk-auth, gitignored) and the database is deleted at the end.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3186);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "clindesk-auth");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const DB_FILE = path.join(OUT, `e2e-${Date.now()}.db`);

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
const PLATFORM = "zz-platform@example.com";
const DESK_OWNER = "zz-desk-owner@example.com";
const DESK_CLIN = "zz-desk-clinician@example.com";
const FORMS_CLINIC = { name: "ZZ Forms Home (fictional)", slug: "zz-forms-home" };
const DESK_CLINIC = { name: "ZZ Desk Physio (fictional)", slug: "zz-desk-physio" };
const DESK_NAME = "ClinDesk"; // the clinic brand's product name (src/lib/brand.ts CLINIC_SYSTEM_NAME)
const users = {};
const password = () => `e2e ${rnd(12)} password`;

const results = [];
async function check(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    results.push({ id, what, pass: false, error: String(err && err.message ? err.message : err).slice(0, 400) });
    console.log(`FAIL ${id} ${what}: ${String(err && err.message ? err.message : err).slice(0, 400)}`);
  }
}

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
    CLINFORMS_PLATFORM_ADMINS: PLATFORM,
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

/** The `log` provider's printed messages: [{to, subject, text, link}] (each text ends "<brand> · AppstackX Ltd"). */
function outbox() {
  const out = [];
  const re = /\[email:log\] to=(\S+)(?: reply-to=(\S+))? subject="([^"]*)"\n([\s\S]*?(?:ClinForms|ClinDesk) · AppstackX Ltd)\n/g;
  for (const m of serverLog.matchAll(re)) {
    const link = (m[4].match(/https?:\/\/\S+\/(?:accept-invite|reset-password)\?token=\S+/) || [])[0] || null;
    out.push({ to: m[1], subject: m[3], text: m[4], link });
  }
  return out;
}
const lastMail = (to, subjectRe) => outbox().filter((m) => m.to === to && subjectRe.test(m.subject)).at(-1);

/** A raw request with an explicit Host (Node cannot resolve *.localhost itself; the browser can). */
function rawRequest(method, host, pathname, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: pathname, headers: { host, ...headers } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
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
/** Account from the link + two-step set-up. Returns what the set-up page showed (heading, issuer, brand mark). */
async function acceptInvite(page, link, email, name) {
  const origin = new URL(link).origin;
  users[email] = { password: password() };
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", name);
  await page.fill("#f-password", users[email].password);
  await page.fill("#f-confirm", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/two-factor`, { timeout: 30000 });
  const subtitle = (await page.locator("main section p").first().innerText()).trim();
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const heading = (await page.locator("h2").first().innerText()).trim();
  const uri = await page.locator("a[href^='otpauth://']").getAttribute("href");
  const mark = (await page.locator("main a[aria-label$=' home']").getAttribute("aria-label")) || "";
  users[email].key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.origin === origin && u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
  return { subtitle, heading, issuer: new URL(uri).searchParams.get("issuer"), mark, landed: new URL(page.url()).pathname };
}

async function signIn(page, origin, email, pass = users[email].password) {
  await page.goto(`${origin}/login`);
  if (new URL(page.url()).pathname.startsWith("/app")) return new URL(page.url()).pathname;
  await page.fill("#f-email", email);
  await page.fill("#f-password", pass);
  await page.click("button[type=submit]");
  await page.waitForSelector("#f-code");
  const hint = await visibleText(page);
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.origin === origin && u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
  users[email].lastHint = hint;
  return new URL(page.url()).pathname;
}

async function inviteMember(page, origin, email) {
  await page.goto(`${origin}/app/settings/members`);
  const form = page.locator("form", { has: page.locator("button:has-text('Invite')") }).first();
  await form.locator("#f-email").fill(email);
  await form.locator("select[name=role]").selectOption("clinician");
  await form.locator("button:has-text('Invite')").click();
  const result = page.locator("[data-testid=invite-result]");
  await result.waitFor({ timeout: 30000 });
  return (await result.innerText()).replace(/\s+/g, " ");
}

const visibleText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const cli = (args) => execFileSync("npm", ["run", "-s", ...args], { cwd: REPO, env: appEnv(), encoding: "utf8" });
const LINK_RE = /https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/;

/* ------------------------------------------------------------------ run */
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    return page;
  };
  try {
    /* S – admin scripts print the brand's host */
    const formsCli = cli(["admin:create-clinic", "--", "--name", FORMS_CLINIC.name, "--slug", FORMS_CLINIC.slug, "--owner-email", PLATFORM, "--retention-days", "30"]);
    const deskCli = cli(["admin:create-clinic", "--", "--name", DESK_CLINIC.name, "--slug", DESK_CLINIC.slug, "--owner-email", DESK_OWNER, "--brand", "clinic"]);
    const entCli = cli(["admin:set-entitlement", "--", "--slug", DESK_CLINIC.slug, "--package", "clinic", "--on", "--confirm"]);
    const formsLink = (formsCli.match(LINK_RE) || [])[0];
    const deskLink = (deskCli.match(LINK_RE) || [])[0];
    await check("S1", "create-clinic: ClinForms clinic → a localhost link, signs in on ClinForms", () => {
      assert.ok(formsLink && formsLink.startsWith(`${FORMS}/accept-invite?token=`), "localhost link");
      assert.match(formsCli, new RegExp(`signs in on: +${FORMS.replace(/[.:/]/g, "\\$&")} \\(ClinForms\\)`));
    });
    await check("S2", "create-clinic --brand clinic → a clinic.localhost link; set-entitlement prints the new host; nothing emailed", () => {
      assert.ok(deskLink && deskLink.startsWith(`${DESK}/accept-invite?token=`), "clinic.localhost link");
      assert.match(deskCli, new RegExp(`signs in on: +${DESK.replace(/[.:/]/g, "\\$&")} \\(${DESK_NAME}\\)`));
      assert.match(entCli, new RegExp(`links now go to: ${DESK.replace(/[.:/]/g, "\\$&")} \\(${DESK_NAME}\\)`));
      assert.doesNotMatch(formsCli + deskCli + entCli, /\[email:log\]/);
    });

    await startServer();

    /* D – the clinic brand's host */
    const deskOwner = await newPage();
    const setup = await acceptInvite(deskOwner, deskLink, DESK_OWNER, "Dana Desk (fictional)");
    await check("D1", "clinic.localhost: invitation → account → two-step; page, brand mark and authenticator issuer say the clinic brand", () => {
      assert.equal(setup.heading, `1. Add ${DESK_NAME} to your authenticator app`);
      assert.equal(setup.issuer, DESK_NAME);
      assert.equal(setup.mark, `${DESK_NAME} home`);
      assert.match(setup.subtitle, new RegExp(`before using ${DESK_NAME}\\.`));
    });
    await check("D2", "clinic.localhost: lands on the clinic area (/app/clinic); tab title names the brand", async () => {
      assert.equal(setup.landed, "/app/clinic");
      await deskOwner.goto(`${DESK}/app/settings/security`);
      assert.match(await deskOwner.title(), new RegExp(` · ${DESK_NAME}$`));
      await deskOwner.goto(`${DESK}/login`);
      assert.equal(new URL(deskOwner.url()).pathname, "/app/clinic", "signed in: /login goes to the brand's start page");
    });
    await check("D3", "the session is host-only: the same browser is signed out on localhost", async () => {
      const cookies = await deskOwner.context().cookies();
      const session = cookies.filter((c) => /session_token/.test(c.name));
      assert.ok(session.length > 0);
      for (const c of session) assert.equal(c.domain, "clinic.localhost", `cookie ${c.name} on ${c.domain}`);
      await deskOwner.goto(`${FORMS}/app`);
      assert.equal(new URL(deskOwner.url()).pathname, "/login");
    });
    const deskTwoFactorMail = lastMail(DESK_OWNER, /Two-step verification is on/);
    await check("D4", "the two-step notice speaks for the clinic brand", () => {
      assert.ok(deskTwoFactorMail);
      assert.match(deskTwoFactorMail.subject, new RegExp(`your ${DESK_NAME} account$`));
    });

    const inviteText = await inviteMember(deskOwner, DESK, DESK_CLIN);
    const clinMail = lastMail(DESK_CLIN, /^Join ZZ Desk Physio/);
    await check("D5", "clinic.localhost: invitation emailed with a clinic.localhost link, subject names the clinic brand, no link on screen", () => {
      assert.match(inviteText, /Invitation emailed to/);
      assert.ok(clinMail && clinMail.link.startsWith(`${DESK}/accept-invite?token=`), clinMail && clinMail.link.slice(0, 40));
      assert.match(clinMail.subject, new RegExp(`on ${DESK_NAME}$`));
      assert.doesNotMatch(clinMail.text, /ClinForms/);
    });
    const clin = await newPage();
    const clinSetup = await acceptInvite(clin, clinMail.link, DESK_CLIN, "Cal Clinician (fictional)");
    await check("D6", "the clinician joins on clinic.localhost and lands in the clinic area", () => {
      assert.equal(clinSetup.issuer, DESK_NAME);
      assert.equal(clinSetup.landed, "/app/clinic");
    });

    await check("D7", "/app/platform is the 404 page for a clinic owner (clinic.localhost)", async () => {
      const res = await deskOwner.goto(`${DESK}/app/platform`);
      assert.equal(res.status(), 404);
    });

    // Forgotten password on the clinic brand's host
    const resetPage = await newPage();
    await resetPage.goto(`${DESK}/login`);
    await resetPage.click("text=Forgotten your password?");
    await resetPage.waitForURL(`${DESK}/reset-password`);
    await resetPage.fill("#f-email", DESK_OWNER);
    await resetPage.click("button[type=submit]");
    await resetPage.waitForSelector("text=If an account exists for that address");
    const resetMail = lastMail(DESK_OWNER, /^Reset your/);
    await check("D8", "reset requested on clinic.localhost: emailed clinic.localhost link, the clinic brand's subject", () => {
      assert.ok(resetMail && resetMail.link.startsWith(`${DESK}/reset-password?token=`));
      assert.equal(resetMail.subject, `Reset your ${DESK_NAME} password`);
    });
    const newPass = password();
    await resetPage.goto(resetMail.link);
    await resetPage.fill("#f-password", newPass);
    await resetPage.fill("#f-confirm", newPass);
    await resetPage.click("button[type=submit]");
    await resetPage.waitForSelector("text=Your password has been changed");
    users[DESK_OWNER].password = newPass;
    await check("D9", "the new password signs in on clinic.localhost (+ a code); the old session was signed out", async () => {
      await deskOwner.goto(`${DESK}/app/clinic`);
      assert.equal(new URL(deskOwner.url()).pathname, "/login", "revoked everywhere");
      const landed = await signIn(deskOwner, DESK, DESK_OWNER);
      assert.equal(landed, "/app/clinic");
      assert.match(users[DESK_OWNER].lastHint, new RegExp(`6-digit code for ${DESK_NAME}\\.`));
    });
    await check("D10", "the reset link works once (also on the other host)", async () => {
      for (const origin of [DESK, FORMS]) {
        const again = await newPage();
        await again.goto(resetMail.link.replace(DESK, origin));
        const p2 = password();
        await again.fill("#f-password", p2);
        await again.fill("#f-confirm", p2);
        await again.click("button[type=submit]");
        await again.waitForSelector("text=This reset link is not valid or has expired.", { timeout: 15000 });
        assert.doesNotMatch(await visibleText(again), /Your password has been changed/);
        await again.context().close();
      }
    });

    /* F – ClinForms' host, unchanged */
    const admin = await newPage();
    const adminSetup = await acceptInvite(admin, formsLink, PLATFORM, "Pat Platform (fictional)");
    await check("F1", "localhost: ClinForms invitation → two-step issuer ClinForms, page says ClinForms, lands on /app", () => {
      assert.equal(adminSetup.issuer, "ClinForms");
      assert.equal(adminSetup.heading, "1. Add ClinForms to your authenticator app");
      assert.equal(adminSetup.mark, "ClinForms home");
      assert.equal(adminSetup.landed, "/app");
    });
    await check("F2", "localhost: tab title '· ClinForms'; /app/platform opens with the 'Owner signs in on' choice", async () => {
      await admin.goto(`${FORMS}/app/settings/security`);
      assert.match(await admin.title(), / · ClinForms$/);
      const res = await admin.goto(`${FORMS}/app/platform`);
      assert.equal(res.status(), 200);
      assert.equal(await admin.locator("select[name=linkBrand]").count(), 1);
    });
    await check("F3", "the clinic-brand owner signs in on localhost too and lands on /app as before (separate session)", async () => {
      const both = await newPage();
      const landed = await signIn(both, FORMS, DESK_OWNER);
      assert.equal(landed, "/app");
      assert.match(users[DESK_OWNER].lastHint, /6-digit code for ClinForms\./);
      const res = await both.goto(`${FORMS}/app/platform`);
      assert.equal(res.status(), 404, "platform 404 on localhost too");
      await both.context().close();
    });
    await check("F4", "a reset asked for on localhost for the clinic-brand owner still links to clinic.localhost", async () => {
      const p = await newPage();
      await p.goto(`${FORMS}/reset-password`);
      await p.fill("#f-email", DESK_OWNER);
      await p.click("button[type=submit]");
      await p.waitForSelector("text=If an account exists for that address");
      const m = lastMail(DESK_OWNER, /^Reset your/);
      assert.notEqual(m.link, resetMail.link);
      assert.ok(m.link.startsWith(`${DESK}/reset-password?token=`));
      await p.context().close();
    });

    /* X – origin / CSRF per host */
    await check("X1", "Better Auth sign-in: each host's own Origin is taken, a foreign Origin refused on both hosts", async () => {
      const body = JSON.stringify({ email: "nobody@example.com", password: "not the password" });
      const statuses = {};
      for (const [host, origin] of [
        [`clinic.localhost:${PORT}`, DESK],
        [`localhost:${PORT}`, FORMS],
        [`clinic.localhost:${PORT}`, "http://evil.example"],
        [`localhost:${PORT}`, "http://evil.example"],
      ]) {
        const res = await rawRequest("POST", host, "/api/auth/sign-in/email", { origin, "content-type": "application/json", cookie: "x=1" }, body);
        statuses[`${origin}@${host}`] = res.status;
      }
      assert.equal(statuses[`${DESK}@clinic.localhost:${PORT}`], 401, JSON.stringify(statuses));
      assert.equal(statuses[`${FORMS}@localhost:${PORT}`], 401, JSON.stringify(statuses));
      assert.equal(statuses[`http://evil.example@clinic.localhost:${PORT}`], 403, JSON.stringify(statuses));
      assert.equal(statuses[`http://evil.example@localhost:${PORT}`], 403, JSON.stringify(statuses));
    });

    await check("X2", "no link in the server output outside the log provider's messages", () => {
      const stripped = serverLog.replace(/\[email:log\][\s\S]*?(?:ClinForms|ClinDesk) · AppstackX Ltd\n/g, "");
      assert.doesNotMatch(stripped, /(accept-invite|reset-password)\?token=/);
    });

    await deskOwner.screenshot({ path: path.join(OUT, "desk-clinic-area.png") });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    await browser.close();
    await stopServer();
    for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true });
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
  }
})();
