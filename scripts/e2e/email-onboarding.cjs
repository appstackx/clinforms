/**
 * Onboarding with email ON (Blue Heart release, 24/10/2026) in a real browser against a local `next start` that this
 * script starts itself on a throwaway SQLite database, with the development email provider (`log`: messages are
 * printed to the server's own output, read here – never on a deployment). Fictional data only (@example.com).
 *
 *   A. Email on (CLINFORMS_EMAIL_PROVIDER=log, CLINFORMS_EMAIL_REPLY_TO set):
 *      1. admin:create-clinic bootstraps the platform administrator – the script NEVER emails (even with `log` set):
 *         the link is printed once, nothing reaches the outbox.
 *      2. The administrator accepts, sets up two-step verification, opens /app/platform: "Email the invitation to the
 *         owner" is OFF by default (security fix 24/10, D4); ticked, the TRIAL clinic is created: "Invitation emailed
 *         to <owner>" + the copyable link with the do-not-forward warning; the emailed link (from the log, with the
 *         reply-to) is the one shown. A 3-day trial is set (starts at the owner's first visit).
 *      3. The owner opens the EMAILED link, creates the account, sets up two-step verification.
 *      4. The trial banner: "Trial – 3 days left. Use made-up notes only until your data processing agreement is signed."
 *      5. Clinic page: the drafting switch's trial text, the retention text (no "coming soon"); the overview checklist.
 *      6. Members → invite a clinician: "Invitation emailed to <address>" and NO link on screen (security fix 24/10, D2:
 *         the inviter could otherwise create the invitee's account); the clinician signs up from the EMAILED link.
 *      7. Forgotten password (owner): /login → "Forgotten your password?" → email (log) → the link → new password →
 *         sign in with it + a code.
 *   B. Email failing (mailersend without a key – a configuration mistake): inviting says the email could not be sent
 *      and shows the link (nothing breaks).
 *   C. Email off (none): inviting says email is not set up and shows the link; /reset-password tells a sole owner to
 *      contact ClinForms; the platform makes a one-time owner reset link (shown once, never emailed) that works once;
 *      the clinic's activity shows it as created by ClinForms support.
 *   Throughout: the server output holds links only inside the `log` provider's printed messages.
 *
 *   npm run build
 *   NODE_PATH=<node_modules with playwright> node scripts/e2e/email-onboarding.cjs     [PORT=3221] [E2E_OUT=…]
 *
 * Throwaway secrets, passwords and TOTP keys are generated here and never printed; the database and outputs go to
 * E2E_OUT (default .e2e-out/email-onboarding, gitignored) and the database is deleted at the end.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3221);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "email-onboarding");
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
const OWNER = "zz-owner@example.com";
const CLIN = "zz-clinician@example.com";
const CLIN_B = "zz-clinician-b@example.com";
const CLIN_C = "zz-clinician-c@example.com";
const REPLY_TO = "zz-support@example.com";
const CLINIC = { name: "ZZ Blue Trial Clinic (fictional)", slug: "zz-blue-trial" };
const users = {};
const password = () => `e2e ${rnd(12)} password`;

const results = [];
function check(id, what, fn) {
  try {
    const note = fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    results.push({ id, what, pass: false, error: String(err && err.message ? err.message : err).slice(0, 400) });
    console.log(`FAIL ${id} ${what}: ${String(err && err.message ? err.message : err).slice(0, 400)}`);
  }
}

/* ------------------------------------------------------------------ server + environment */
function appEnv(email) {
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
    MEDREPORT_AI_MODE: "demo",
    ...email,
  });
  return env;
}
const EMAIL_LOG = { CLINFORMS_EMAIL_PROVIDER: "log", CLINFORMS_EMAIL_REPLY_TO: REPLY_TO };
const EMAIL_FAILING = { CLINFORMS_EMAIL_PROVIDER: "mailersend", MAILERSEND_FROM_EMAIL: "hello@example.com" }; // no key
const EMAIL_OFF = { CLINFORMS_EMAIL_PROVIDER: "none" };

let server = null;
let serverLog = "";
async function startServer(email) {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: appEnv(email), stdio: ["ignore", "pipe", "pipe"], detached: true });
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

/** The `log` provider's printed messages: [{to, replyTo, subject, text, link}]. */
function outbox() {
  const out = [];
  // Every message's text ends with the "ClinForms · AppstackX Ltd" line (src/server/email/templates.ts).
  const re = /\[email:log\] to=(\S+)(?: reply-to=(\S+))? subject="([^"]*)"\n([\s\S]*?ClinForms · AppstackX Ltd)\n/g;
  for (const m of serverLog.matchAll(re)) {
    const link = (m[4].match(/https?:\/\/\S+\/(?:accept-invite|reset-password)\?token=\S+/) || [])[0] || null;
    out.push({ to: m[1], replyTo: m[2] || null, subject: m[3], text: m[4], link });
  }
  return out;
}
const lastMail = (to, subjectRe) => outbox().filter((m) => m.to === to && subjectRe.test(m.subject)).at(-1);

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

/** Signs in, or keeps the session that survived a server restart (sessions live in the database). */
async function signIn(page, email, pass = users[email].password) {
  await page.goto(`${BASE}/login`);
  if (new URL(page.url()).pathname.startsWith("/app")) return;
  await page.fill("#f-email", email);
  await page.fill("#f-password", pass);
  await page.click("button[type=submit]");
  await page.waitForSelector("#f-code");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 30000 });
}

async function signOut(page) {
  await page.click("button:has-text('Sign out')");
  await page.waitForURL(/\/login/, { timeout: 30000 });
}

async function inviteMember(page, email) {
  await page.goto(`${BASE}/app/settings/members`);
  const form = page.locator("form", { has: page.locator("button:has-text('Invite')") }).first();
  await form.locator("#f-email").fill(email);
  await form.locator("select[name=role]").selectOption("clinician");
  await form.locator("button:has-text('Invite')").click();
  const result = page.locator("[data-testid=invite-result]");
  await result.waitFor({ timeout: 30000 });
  const codes = await result.locator("code").count();
  return { text: (await result.innerText()).replace(/\s+/g, " "), link: codes ? (await result.locator("code").innerText()).trim() : null };
}

const visibleText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

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
    /* A1 – the script never emails, even with the log provider configured */
    const cli = execFileSync(
      "npm",
      ["run", "-s", "admin:create-clinic", "--", "--name", "ZZ Platform Home (fictional)", "--slug", "zz-platform-home", "--owner-email", PLATFORM, "--retention-days", "30"],
      { cwd: REPO, env: appEnv(EMAIL_LOG), encoding: "utf8" },
    );
    const platformLink = (cli.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    check("A1", "admin:create-clinic prints the link once and never emails (log provider configured)", () => {
      assert.ok(platformLink, "link printed");
      assert.match(cli, /email: +not sent \(this command never sends email\)/);
      assert.doesNotMatch(cli, /\[email:log\]/, "nothing printed by the email provider");
      assert.equal((cli.match(/accept-invite\?token=/g) || []).length, 1);
    });

    await startServer(EMAIL_LOG);
    const admin = await newPage();
    await acceptInvite(admin, platformLink, PLATFORM, "Pat Platform (fictional)");
    check("A1b", "no email for the platform administrator's script-made invitation", () => assert.equal(outbox().filter((m) => m.to === PLATFORM && /Join/.test(m.subject)).length, 0));

    /* A2 – platform creates the trial clinic; invitation emailed + link shown with the warning */
    await admin.goto(`${BASE}/app/platform`);
    await admin.fill("#f-name", CLINIC.name);
    await admin.fill("#f-slug", CLINIC.slug);
    await admin.fill("#f-ownerEmail", OWNER);
    await admin.fill("#f-retentionDays", "30");
    const emailChecked = await admin.locator("input[name=sendEmail]").isChecked();
    const boxHint = await visibleText(admin);
    check("A2a", "platform page offers 'Email the invitation to the owner', OFF by default, own-mailbox hint (security fix D4)", () => {
      assert.equal(emailChecked, false);
      assert.match(boxHint, /Only for the owner's own mailbox – never a shared inbox: whoever opens the invitation first becomes the owner\./);
    });
    await admin.check("input[name=sendEmail]");
    await admin.click("button:has-text('Create clinic and invite the owner')");
    await admin.waitForSelector("text=Invitation emailed to");
    const created = await visibleText(admin);
    const shownOwnerLink = (await admin.locator("code").first().innerText()).trim();
    const ownerMail = lastMail(OWNER, /^Join ZZ Blue Trial Clinic/);
    check("A2b", "platform: 'Invitation emailed to <owner>' + link copy with the do-not-forward warning", () => {
      assert.match(created, new RegExp(`is set up\\. Invitation emailed to ${OWNER.replace(/\./g, "\\.")}\\.`));
      assert.match(created, /A copy of the invitation link \(owner\)/);
      assert.match(created, /Shown only this once\. Keep this copy only in case the email does not arrive\. Do not forward it to anyone else/);
      assert.match(shownOwnerLink, /\/accept-invite\?token=/);
    });
    check("A2c", "the owner's invitation was emailed (log) with the reply-to, carrying the same link", () => {
      assert.ok(ownerMail, "message in the outbox");
      assert.equal(ownerMail.replyTo, REPLY_TO);
      assert.equal(ownerMail.link, shownOwnerLink);
    });
    // 3-day trial, starting at the owner's first visit
    const trialForm = admin.locator("form[aria-label='Set up a trial']");
    await trialForm.locator("select[name=tenantId]").selectOption(CLINIC.slug);
    await trialForm.locator("input[name=days]").fill("3");
    await trialForm.locator("button:has-text('Set trial')").click();
    await admin.waitForSelector(`text=${CLINIC.slug}: a 3-day trial starts when the owner first signs in.`);
    check("A2d", "platform: 3-day trial set, starting at the owner's first sign-in", () => undefined);

    /* A3 – the owner accepts the EMAILED link */
    const owner = await newPage();
    await acceptInvite(owner, ownerMail.link, OWNER, "Olivia Owner (fictional)");
    check("A3", "owner: account from the emailed link + two-step verification", () => assert.equal(new URL(owner.url()).pathname, "/app"));

    /* A4 – banner */
    await owner.goto(`${BASE}/app`);
    const banner = (await owner.locator("[data-testid=trial-banner]").innerText()).trim();
    check("A4", "trial banner wording", () => assert.equal(banner, "Trial – 3 days left. Use made-up notes only until your data processing agreement is signed."));
    const overview = await visibleText(owner);
    check("A5a", "overview checklist: the drafting step's trial wording", () =>
      assert.match(overview, /During your trial, switch it on in Clinic details to try drafting with made-up notes only; until then your clinicians write the answers\./),
    );

    /* A5 – Clinic page texts */
    await owner.goto(`${BASE}/app/settings/clinic`);
    const clinicText = await visibleText(owner);
    const draftingWhen = (await owner.locator("[data-testid=drafting-when]").innerText()).trim();
    check("A5b", "Clinic page: drafting help for a trial clinic", () => {
      assert.equal(draftingWhen, "During your trial, switch this on to try drafting with made-up notes only.");
      assert.doesNotMatch(clinicText, /Switch it on only once your clinic has signed the data processing agreement/);
    });
    check("A5c", "Clinic page: retention text matches the nightly job; no 'coming soon'", () => {
      assert.match(clinicText, /30–3650 days\. Every night, reports that have not been changed for this many days are deleted automatically – drafts and approved reports, with the notes they were made from\./);
      assert.match(clinicText, /Your forms library, clinic details, members and activity log are kept, and so are copies you have downloaded\./);
      assert.doesNotMatch(clinicText, /coming soon/i);
      assert.doesNotMatch(clinicText, /anonymised/i);
    });
    await owner.screenshot({ path: path.join(OUT, "a5-clinic-page.png"), fullPage: true });

    /* A6 – invite a clinician with email on */
    const inv = await inviteMember(owner, CLIN);
    const clinMail = lastMail(CLIN, /^Join ZZ Blue Trial Clinic/);
    const inviteHtml = await owner.content();
    check("A6", "Members: 'Invitation emailed to <address>', NO link on screen or in the page (security fix D2); emailed with the reply-to", () => {
      assert.match(inv.text, new RegExp(`Invitation emailed to ${CLIN.replace(/\./g, "\\.")}\\.`));
      assert.equal(inv.link, null, "no link box");
      assert.doesNotMatch(inv.text, /A copy of the invitation link/);
      assert.match(inv.text, /invite them again: the earlier link then stops working\./);
      assert.ok(clinMail && clinMail.link, "emailed");
      assert.ok(!inviteHtml.includes(new URL(clinMail.link).searchParams.get("token")), "the token is nowhere in the page");
      assert.equal(clinMail.replyTo, REPLY_TO);
    });
    await owner.screenshot({ path: path.join(OUT, "a6-members-invite.png"), fullPage: true });
    const clinician = await newPage();
    await acceptInvite(clinician, clinMail.link, CLIN, "Cara Clinician (fictional)");
    check("A6b", "the clinician signs up from the EMAILED link (the only copy)", () => assert.equal(new URL(clinician.url()).pathname, "/app"));
    await clinician.context().close();

    /* A7 – forgotten password (owner), email on */
    await signOut(owner);
    await owner.click("text=Forgotten your password?");
    await owner.waitForURL(`${BASE}/reset-password`);
    await owner.fill("#f-email", OWNER);
    await owner.click("button:has-text('Email me a reset link')");
    await owner.waitForSelector("text=If an account exists for that address");
    const sentText = await visibleText(owner);
    const resetMail = lastMail(OWNER, /^Reset your ClinForms password/);
    check("A7a", "forgot password: neutral 'sent' answer + what to do if nothing arrives; reset email (log) with the reply-to", () => {
      assert.match(sentText, /If you are your clinic's only owner, contact us at /);
      assert.ok(resetMail && resetMail.link, "reset email");
      assert.equal(resetMail.replyTo, REPLY_TO);
    });
    const newPass = password();
    await owner.goto(resetMail.link);
    await owner.fill("#f-password", newPass);
    await owner.fill("#f-confirm", newPass);
    await owner.click("button:has-text('Change password')");
    await owner.waitForSelector("text=Your password has been changed");
    users[OWNER].password = newPass;
    await signIn(owner, OWNER);
    check("A7b", "owner signs in with the new password + a code", () => assert.match(new URL(owner.url()).pathname, /^\/app/));

    /* B – email failing (a configuration mistake) */
    await stopServer();
    await startServer(EMAIL_FAILING);
    await signIn(owner, OWNER);
    const failed = await inviteMember(owner, CLIN_B);
    check("B1", "Members: email could not be sent → says so, shows the link (no error page)", () => {
      assert.match(failed.text, /The invitation email to zz-clinician-b@example\.com could not be sent\. Pass the link below to them yourself\./);
      assert.match(failed.text, /Invitation link for zz-clinician-b@example\.com/);
      assert.match(failed.link, /\/accept-invite\?token=/);
    });

    /* C – email off */
    await stopServer();
    await startServer(EMAIL_OFF);
    await signIn(owner, OWNER);
    const off = await inviteMember(owner, CLIN_C);
    check("C1", "Members: email off → says so, shows the link", () => {
      assert.match(off.text, /Email is not set up, so nothing was sent\. Pass the link below to zz-clinician-c@example\.com yourself\./);
      assert.match(off.link, /\/accept-invite\?token=/);
    });
    await signOut(owner);
    await owner.goto(`${BASE}/reset-password`);
    const resetOff = await visibleText(owner);
    check("C2", "/reset-password with email off: a sole owner is pointed to ClinForms", () => assert.match(resetOff, /If you are your clinic's only owner, contact us at /));

    // the platform's one-time owner reset link
    await signIn(admin, PLATFORM);
    await admin.goto(`${BASE}/app/platform`);
    const resetForm = admin.locator("form[aria-label='Owner password reset link']");
    await resetForm.locator("select[name=tenantId]").selectOption(CLINIC.slug);
    await resetForm.locator("input[name=resetOwnerEmail]").fill(OWNER);
    await resetForm.locator("button:has-text('Create a reset link')").click();
    await admin.waitForSelector("text=Password reset link for zz-owner@example.com");
    const platformText = await visibleText(admin);
    const platformResetLink = (await admin.locator("code", { hasText: "/reset-password?token=" }).first().innerText()).trim();
    check("C3a", "platform: owner reset link shown once with the identity warning; not emailed", () => {
      assert.match(platformResetLink, /\/reset-password\?token=/);
      assert.match(platformText, /Shown only this once\. It works once and expires in 2 hours\. Confirm who you are speaking to/);
      assert.equal(outbox().filter((m) => m.link === platformResetLink).length, 0);
    });
    await admin.screenshot({ path: path.join(OUT, "c3-platform-owner-reset.png"), fullPage: true });
    await admin.reload();
    const shownAgain = await admin.locator("code", { hasText: "/reset-password?token=" }).count();
    check("C3b", "the link is not shown again after a reload", () => assert.equal(shownAgain, 0));
    const pass3 = password();
    await owner.goto(platformResetLink);
    await owner.fill("#f-password", pass3);
    await owner.fill("#f-confirm", pass3);
    await owner.click("button:has-text('Change password')");
    await owner.waitForSelector("text=Your password has been changed");
    users[OWNER].password = pass3;
    await owner.goto(platformResetLink);
    const again = password();
    await owner.fill("#f-password", again);
    await owner.fill("#f-confirm", again);
    await owner.click("button:has-text('Change password')");
    const reused = await owner.waitForSelector("text=This reset link is not valid or has expired").then(() => true, () => false);
    check("C3c", "the platform reset link works once (a second use is refused)", () => assert.equal(reused, true));
    await signIn(owner, OWNER);
    await owner.goto(`${BASE}/app/settings/activity`);
    const activity = await visibleText(owner);
    check("C4", "clinic activity: 'Password reset link created · Created by ClinForms support for the owner'", () => {
      assert.match(activity, /Password reset link created/);
      assert.match(activity, /Created by ClinForms support for the owner/);
    });

    /* Throughout: links appear in the server output only inside the log provider's printed messages */
    const outside = serverLog.replace(/\[email:log\][\s\S]*?ClinForms · AppstackX Ltd\n/g, "");
    check("Z1", "no invitation or reset link in the server output outside the development email provider's messages", () => {
      assert.doesNotMatch(outside, /accept-invite\?token=|reset-password\?token=/);
    });
    check("Z2", "server output has no error stack", () => assert.doesNotMatch(serverLog, /Error: |TypeError|Unhandled/));
  } catch (err) {
    results.push({ id: "CRASH", pass: false, error: String(err && err.stack ? err.stack : err).slice(0, 1200) });
    console.log(`CRASH ${err && err.stack ? err.stack : err}`);
  } finally {
    await browser.close().catch(() => undefined);
    await stopServer();
    // The server output holds the development email provider's messages (links): keep it out of the results.
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true });
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length && results.length > 0 ? 0 : 1);
  }
})();
