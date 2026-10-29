/**
 * The bot check (Cloudflare Turnstile, M10 M6) on the public booking page and the portal sign-in – LOCAL only, on a
 * fresh demo seed, with Cloudflare's published TEST keys (always pass; they need network access to
 * challenges.cloudflare.com and are not secrets):
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3246 > seed.out
 *   npm run build && NEXT_PUBLIC_CLINIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
 *     CLINIC_TURNSTILE_SECRET=1x0000000000000000000000000000000AA CLINIC_EMAIL_PROVIDER=test CLINIC_SMS_PROVIDER=test \
 *     npx next start -p 3246
 *   BASE=http://localhost:3246 E2E_OUT=<dir> SQLITE_PATH=<the server's scratch SQLite> \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/pms-human-check.cjs
 *
 * Before the final check (29/10/2026) neither form rendered the widget and neither action sent its token, so with the
 * two keys set every public booking and every sign-in link was refused ("…not a robot…"). This script books online
 * and asks for a sign-in link twice (a token works once) with the widget in the page. Fictional data only.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3246";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-human-check");
const SQLITE = process.env.SQLITE_PATH || process.env.CLINFORMS_SQLITE_PATH || "";
const CLINIC = process.env.CLINIC_SLUG || "riverside-demo";
const RUN = crypto.randomBytes(3).toString("hex");

const results = [];
let failPage = null;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 600)}`);
    if (failPage) await failPage.screenshot({ path: path.join(OUT, `fail-${results.length}.png`), fullPage: true }).catch(() => {});
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Read-only look at the scratch database. */
function bookingByReference(reference) {
  if (!SQLITE || !/^\/(private\/)?(tmp|var\/folders)\//.test(SQLITE)) throw new Error("SQLITE_PATH must be a scratch database under /tmp");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(SQLITE, { readOnly: true });
  try {
    return db.prepare("SELECT a.id, a.source FROM pms_online_bookings b JOIN pms_appointments a ON a.tenant_id = b.tenant_id AND a.id = b.appointment_id WHERE b.tenant_id = ? AND b.reference = ?").get(CLINIC, reference);
  } finally {
    db.close();
  }
}

/** Requests to Cloudflare's challenge origin (the widget's script and its frame). */
const cloudflareHits = [];

async function widgetIn(page) {
  // Turnstile draws its iframe inside a shadow root, so check the container got content and Cloudflare was asked.
  await page.waitForFunction(() => {
    const box = document.querySelector("[data-testid='human-check']");
    return !!box && box.childNodes.length > 0 && box.getBoundingClientRect().height > 0;
  }, null, { timeout: 30000 });
  assert(cloudflareHits.some((u) => /\/turnstile\/v0\/api\.js/.test(u)), "the Turnstile script was loaded from challenges.cloudflare.com");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phone = await ctx.newPage();
  failPage = phone;
  const problems = [];
  phone.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  phone.on("request", (r) => /^https:\/\/challenges\.cloudflare\.com\//.test(r.url()) && cloudflareHits.push(r.url()));
  const shot = (name) => phone.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  try {
    await step("1. public booking: the widget is on Check and confirm; Confirm waits for it, then books", async () => {
      await phone.goto(`${BASE}/clinics/${CLINIC}/book`);
      await phone.waitForSelector("h1:has-text('Where would you like to be seen?')");
      assert((await phone.locator("[data-testid='human-check']").count()) === 0, "no widget before the confirm step");
      await phone.locator("main ul li button").first().click();
      await phone.waitForSelector("h1:has-text('What do you need?')");
      await phone.getByRole("button", { name: /Initial assessment/ }).click();
      await phone.waitForSelector("h1:has-text('Who would you like to see?')");
      await phone.getByRole("button", { name: /Anyone available/ }).click();
      await phone.waitForSelector("[aria-label='Available times'] button", { timeout: 60000 });
      await phone.locator("[aria-label='Available times'] button").first().click();
      await phone.click("footer button:has-text('Continue')");
      await phone.waitForSelector("h1:has-text('Your details')");
      await phone.fill("#bk-firstName", "Tara");
      await phone.fill("#bk-lastName", `Check-${RUN}`);
      await phone.fill("#bk-dateOfBirth", "1991-04-12");
      await phone.fill("#bk-phoneMobile", "07700 900672");
      await phone.fill("#bk-email", `tara.check.${RUN}@example.com`);
      await phone.click("footer button:has-text('Continue')");
      await phone.waitForSelector("h1:has-text('Check and confirm')");
      await widgetIn(phone);
      const confirm = phone.locator("footer button:has-text('Confirm booking')");
      await phone.waitForFunction(() => {
        const b = [...document.querySelectorAll("footer button")].find((x) => /Confirm booking/.test(x.textContent || ""));
        return b && !b.disabled;
      }, null, { timeout: 30000 });
      await shot("375-confirm-with-check");
      await confirm.click();
      await phone.waitForSelector("h1:has-text(\"You're booked\")", { timeout: 30000 });
      const ref = ((await phone.locator("main").innerText()).match(/Ref ([A-Z0-9-]+)/) || [])[1];
      assert(ref, "a booking reference");
      if (SQLITE) assert(bookingByReference(ref), "the booking is in the diary");
      await shot("375-booked");
    });

    await step("2. portal sign-in: the widget is shown; the link is sent; 'Send it again' gets a fresh token", async () => {
      await phone.goto(`${BASE}/clinics/${CLINIC}/portal`);
      await phone.waitForSelector("h1:has-text('Your appointments and forms')");
      await widgetIn(phone);
      await phone.fill("#pt-email", `tara.check.${RUN}@example.com`);
      await phone.waitForFunction(() => {
        const b = [...document.querySelectorAll("form button[type=submit]")].find((x) => /sign-in link/.test(x.textContent || ""));
        return b && !b.disabled;
      }, null, { timeout: 30000 });
      await phone.click("form button[type=submit]");
      await phone.waitForSelector("h1:has-text('Check your email')", { timeout: 30000 });
      const first = (await phone.locator("main [role=alert]").allInnerTexts()).filter((t) => t.trim());
      assert(first.length === 0, `no error after the first link (${first.join(" | ")})`);
      await widgetIn(phone);
      await phone.waitForFunction(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Send it again/.test(x.textContent || ""));
        return b && !b.disabled;
      }, null, { timeout: 30000 });
      await phone.getByRole("button", { name: "Send it again" }).click();
      await phone.waitForTimeout(4000);
      const alerts = (await phone.locator("main [role=alert]").allInnerTexts()).filter((t) => t.trim());
      assert(!alerts.some((t) => /robot/i.test(t)), `the second request passed the check (${alerts.join(" | ")})`);
      await shot("375-sign-in-sent");
    });

    await step("3. no page errors", async () => {
      assert(problems.length === 0, problems.join("\n"));
    });
  } finally {
    await browser.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
