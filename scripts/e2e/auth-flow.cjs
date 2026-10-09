/**
 * Browser check of the identity flows (docs/auth.md §Testing): accept an invitation → create the account →
 * set up two-step verification (TOTP computed here from the key the page shows, like an authenticator app) →
 * clinic area and every settings page → sign out → sign in with password + code (a wrong code first) → sign in
 * with a backup code.
 *
 *   INVITE_LINK_FILE=<file holding the link printed by admin:create-clinic> BASE=http://localhost:3111 \
 *     NODE_PATH=<a node_modules with playwright> node scripts/e2e/auth-flow.cjs
 *
 * Nothing secret is printed: the password is random per run, codes and links stay in memory. Screenshots go
 * to E2E_OUT (default .e2e-out/, gitignored).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/auth");
const linkFile = process.env.INVITE_LINK_FILE;
if (!linkFile) throw new Error("INVITE_LINK_FILE is required");
const inviteLink = (fs.readFileSync(linkFile, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9_-]+/) || [])[0];
if (!inviteLink) throw new Error("No invitation link in INVITE_LINK_FILE");
const PASSWORD = `e2e ${crypto.randomBytes(12).toString("base64url")} password`;

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
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}

/** A fresh code: wait if the current one expires within 3 s. */
async function freshCode(key) {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(key);
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 300) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 300)}`);
    throw err;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  let key;
  let backupCodes = [];

  try {
    await step("signed-out /app redirects to /login", async () => {
      await page.goto(`${BASE}/app/settings/members`);
      assert(page.url().startsWith(`${BASE}/login?next=`), `at ${page.url()}`);
    });

    await step("invitation page shows the clinic, role and the invited address", async () => {
      await page.goto(inviteLink);
      await page.waitForSelector("text=Create your account");
      const text = await page.locator("main").innerText();
      assert(/ZZ Selftest Clinic/.test(text) && /Owner/.test(text), "clinic and role shown");
      assert((await page.inputValue("#f-email")) === "zz-selftest-owner@example.com", "invited email prefilled, read-only");
      await shot("01-accept-invite");
    });

    await step("a short password is refused", async () => {
      await page.fill("#f-name", "Zed Selftest");
      await page.fill("#f-password", "short");
      await page.fill("#f-confirm", "short");
      await page.$eval("form", (f) => f.setAttribute("novalidate", ""));
      await page.click("button[type=submit]");
      await page.waitForSelector("text=at least 12 characters");
    });

    await step("create the account → forced two-step setup", async () => {
      await page.fill("#f-password", PASSWORD);
      await page.fill("#f-confirm", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForURL(`${BASE}/two-factor`);
      await page.waitForSelector("button:has-text('Set up two-step verification')");
      await shot("02-two-factor-start");
    });

    await step("the clinic area is closed until two-step verification is on", async () => {
      const other = await ctx.newPage();
      await other.goto(`${BASE}/app`);
      assert(other.url() === `${BASE}/two-factor`, `at ${other.url()}`);
      await other.close();
    });

    await step("confirm the password → QR code, key and backup codes shown", async () => {
      await page.fill("#f-password", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForSelector("img[alt^='Authenticator set-up code']");
      const keyText = await page.locator("code").first().innerText();
      key = base32Decode(keyText);
      assert(key.length >= 16, "key shown for manual entry");
      backupCodes = await page.locator("ul[aria-label='Backup codes'] li").allInnerTexts();
      assert(backupCodes.length === 10, `${backupCodes.length} backup codes`);
      await shot("03-two-factor-scan");
    });

    await step("the code cannot be sent before confirming the backup codes are saved; a wrong code is refused", async () => {
      const good = totp(key);
      await page.fill("#f-code", good === "123456" ? "654321" : "123456");
      await page.click("button[type=submit]");
      assert((await page.locator("text=That code is not right").count()) === 0, "blocked by the required checkbox");
      await page.check("input[name=saved]");
      await page.click("button[type=submit]");
      await page.waitForSelector("text=That code is not right");
    });

    await step("the right code turns it on → /app", async () => {
      await page.fill("#f-code", await freshCode(key));
      await page.click("button[type=submit]");
      await page.waitForURL(`${BASE}/app`);
    });

    await step("visiting /two-factor again says it is on", async () => {
      await page.goto(`${BASE}/two-factor`);
      await page.waitForSelector("text=Two-step verification is on for");
      await shot("04-two-factor-on");
      await page.click("text=Continue");
      await page.waitForURL(`${BASE}/app`);
    });

    await step("overview: clinic, role, members, demo studio link", async () => {
      const text = await page.locator("body").innerText();
      assert(/ZZ Selftest Clinic \(fictional\)/.test(text), "clinic name");
      assert(/Owner/.test(text), "role");
      assert((await page.locator("a[href='/reports']").count()) === 1, "demo studio link");
      await shot("05-app-overview");
    });

    await step("settings → clinic: save details (and a bad postcode is refused)", async () => {
      await page.click("nav >> text=Clinic");
      await page.waitForURL(`${BASE}/app/settings/clinic`);
      await page.fill("#f-postcode", "NOT A POSTCODE");
      await page.click("main button:has-text('Save clinic details')");
      await page.waitForSelector("text=Enter a UK postcode");
      await page.fill("#f-postcode", "MK9 2FZ");
      await page.fill("#f-address", "Unit 1, Selftest Court (fictional)\nMilton Keynes");
      await page.fill("#f-retentionDays", "400");
      await page.click("main button:has-text('Save clinic details')");
      await page.waitForSelector("text=Saved.");
      await shot("06-settings-clinic");
    });

    await step("settings → members: invite a clinician, link shown because email is off; signing details", async () => {
      await page.click("nav >> text=Members");
      await page.waitForURL(`${BASE}/app/settings/members`);
      await page.fill("#f-email", "zz-selftest-clinician@example.com");
      await page.selectOption("select[name=role]", "clinician");
      await page.click("button:has-text('Invite')");
      await page.waitForSelector("text=Invitation link for zz-selftest-clinician@example.com");
      await page.waitForSelector("text=Open invitations");
      await page.click("summary:has-text('Manage')");
      await page.fill("#f-jobTitle", "Clinic Director");
      await page.fill("#f-hcpcNumber", "PH-DEMO-01");
      await page.click("button:has-text('Save signing details')");
      await page.waitForSelector("text=Enter the registration number as shown on the HCPC register");
      await page.fill("#f-hcpcNumber", "");
      await page.click("button:has-text('Save signing details')");
      await page.waitForSelector("details >> text=Saved.");
      await shot("07-settings-members");
    });

    await step("settings → security: this device listed, new backup codes (wrong password refused); API keys: create (shown once), revoke", async () => {
      await page.click("nav >> text=Security");
      await page.waitForURL(`${BASE}/app/settings/security`);
      await page.waitForSelector("text=(this device)");
      await page.fill("#f-password", "not the password at all");
      await page.click("button:has-text('Make new backup codes')");
      await page.waitForSelector("text=That password is not right");
      await page.fill("#f-password", PASSWORD);
      await page.click("button:has-text('Make new backup codes')");
      await page.waitForSelector("text=New backup codes made");
      const fresh = await page.locator("ul[aria-label='Backup codes'] li").allInnerTexts();
      assert(fresh.length === 10 && fresh[0] !== backupCodes[0], "new codes shown once");
      backupCodes = fresh;
      await shot("08-settings-security");
      await page.click("nav >> text=API keys");
      await page.waitForURL(`${BASE}/app/settings/api-keys`);
      await page.fill("#f-name", "Selftest key");
      await page.click("button:has-text('Create key')");
      await page.waitForSelector("text=New key: Selftest key");
      const keyValue = await page.locator("code").first().innerText();
      assert(/^cfk_zz-selftest-clinic_[A-Za-z0-9_-]{43}$/.test(keyValue), "key format");
      page.once("dialog", (d) => d.accept());
      await page.click("button:has-text('Revoke')");
      await page.waitForSelector("text=Revoked");
      await shot("09-settings-api-keys");
    });

    await step("sign out → /login", async () => {
      await page.click("header >> button:has-text('Sign out')");
      await page.waitForURL(`${BASE}/login`);
    });

    await step("sign in: password, a wrong code refused, then the right code → /app", async () => {
      await page.goto(`${BASE}/login?next=%2Fapp%2Fsettings%2Fsecurity`);
      await page.fill("#f-email", "zz-selftest-owner@example.com");
      await page.fill("#f-password", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForSelector("text=6-digit code");
      await shot("10-login-code");
      const good = totp(key);
      await page.fill("#f-code", good === "000000" ? "111111" : "000000");
      await page.click("button[type=submit]");
      await page.waitForSelector("text=That code is not right");
      await page.fill("#f-code", await freshCode(key));
      await page.click("button[type=submit]");
      await page.waitForURL(`${BASE}/app/settings/security`);
    });

    await step("sign out, then sign in with a backup code", async () => {
      await page.click("header >> button:has-text('Sign out')");
      await page.waitForURL(`${BASE}/login`);
      await page.fill("#f-email", "zz-selftest-owner@example.com");
      await page.fill("#f-password", PASSWORD);
      await page.click("button[type=submit]");
      await page.click("text=I can't use my authenticator app");
      await page.fill("#f-code", backupCodes[0]);
      await page.click("button[type=submit]");
      await page.waitForURL(`${BASE}/app`);
    });

    await step("the public demo still opens", async () => {
      await page.goto(`${BASE}/reports`);
      await page.waitForLoadState("networkidle");
      assert(page.url() === `${BASE}/reports`, `at ${page.url()}`);
    });
  } finally {
    await shot("99-final").catch(() => undefined);
    console.log(`final page: ${page.url().replace(/token=[A-Za-z0-9_-]+/, "token=…")}`);
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, problems }, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} steps passed; ${problems.length} page problems`);
    for (const p of problems.slice(0, 10)) console.log(`  ${p}`);
    await browser.close();
  }
})().catch(() => process.exit(1));
