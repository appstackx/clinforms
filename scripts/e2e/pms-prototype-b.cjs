/**
 * Prototype B (design round 2h "Online booking lands in the diary") end to end in the browser – LOCAL only, on a
 * fresh demo seed (the portal seed switches online booking on):
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3182 > seed.out   # owner invitation in seed.out
 *   npm run build && PORT=3182 CLINIC_EMAIL_PROVIDER=test CLINIC_SMS_PROVIDER=test npm run start
 *   SEED_LOG=seed.out BASE=http://localhost:3182 E2E_OUT=<dir> SQLITE_PATH=<the server's scratch SQLite> \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-prototype-b.cjs
 *
 * The flow: a new patient on a phone (375 px) books online – clinic → service → "Anyone available" → a time (14:30
 * when it is free, else the first time offered) → details → confirm → "You're booked"; reception (1440 px) sees it
 * straight away in the diary as "Booked online" with the activity line "Booked by the patient online", the
 * confirmation is in the outbox, and Set-up → Online booking lists it as a new patient to check.
 *
 * SQLITE_PATH is only READ (which day and site the booked appointment is on). Fictional data only; nothing secret is
 * printed (random passwords and codes stay in memory).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3182";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-prototype-b");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || process.env.CLINFORMS_SQLITE_PATH || "";
const CLINIC = process.env.CLINIC_SLUG || "riverside-demo";
const RUN = crypto.randomBytes(3).toString("hex");
const AXE = require.resolve("axe-core/axe.min.js");

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
async function freshCode(key) {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(key);
}

const results = [];
const failPages = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 600)}`);
    for (const [who, page] of failPages) await page.screenshot({ path: path.join(OUT, `fail-${results.length}-${who}.png`), fullPage: true }).catch(() => {});
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function onboard(page, invite, name) {
  const password = `e2e ${crypto.randomBytes(12).toString("base64url")} password`;
  await page.goto(invite);
  await page.waitForSelector("text=Create your account");
  await page.fill("#f-name", name);
  await page.fill("#f-password", password);
  await page.fill("#f-confirm", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`);
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = base32Decode(await page.locator("code").first().innerText());
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`);
}

async function invite(owner, email, role) {
  await owner.goto(`${BASE}/app/settings/members`);
  await owner.fill("input[name=email]", email);
  await owner.selectOption("form:has(input[name=email]) select[name=role]", role);
  await owner.click("button[type=submit]:has-text('Invite')");
  const code = owner.locator("code").filter({ hasText: "/accept-invite?token=" }).last();
  await code.waitFor({ timeout: 20000 });
  return (await code.innerText()).trim();
}

const axeReport = [];
async function axe(page, label) {
  await page.waitForTimeout(400); // let colour transitions (a button just enabled) finish
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeReport.push({ label, found });
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
}

/** Read-only look at the scratch database: the online booking with this reference. */
function bookingByReference(reference) {
  if (!SQLITE || !/^\/(private\/)?(tmp|var\/folders)\//.test(SQLITE)) throw new Error("SQLITE_PATH must be a scratch database under /tmp");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(SQLITE, { readOnly: true });
  try {
    return db
      .prepare("SELECT a.id, a.starts_on, a.site_id, a.source, a.status, a.patient_id FROM pms_online_bookings b JOIN pms_appointments a ON a.tenant_id = b.tenant_id AND a.id = b.appointment_id WHERE b.tenant_id = ? AND b.reference = ?")
      .get(CLINIC, reference);
  } finally {
    db.close();
  }
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk(1440, 1000);
  const jess = await mk(1440, 1000);
  const phone = await mk(375, 812);
  failPages.push(["owner", owner], ["reception", jess], ["phone", phone]);
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  const s = { time: null, reference: null, appt: null, name: `Ben Carter-${RUN}` };

  try {
    await step("set-up: owner and reception (Jess) accounts with two-step", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-protob-jess-${RUN}@example.com`, "staff");
      await onboard(jess, r, "Jess Taylor (fictional)");
    });

    await step("1. patient's phone: the clinic's booking page – where, what, who (no app shell, no distance until asked)", async () => {
      await phone.goto(`${BASE}/clinics/${CLINIC}/book`);
      await phone.waitForSelector("h1:has-text('Where would you like to be seen?')");
      assert((await phone.locator("[aria-label='Primary']").count()) === 0, "no app navigation on the public page");
      assert(!/miles/.test(await phone.locator("main").innerText()), "no distance before the patient asks");
      await shot(phone, "375-b1-where");
      await axe(phone, "booking: where (375)");
      await phone.locator("main ul li button").first().click();
      await phone.waitForSelector("h1:has-text('What do you need?')");
      await shot(phone, "375-b2-what");
      await phone.getByRole("button", { name: /Initial assessment/ }).click();
      await phone.waitForSelector("h1:has-text('Who would you like to see?')");
      await shot(phone, "375-b3-who");
      await phone.getByRole("button", { name: /Anyone available/ }).click();
      await phone.waitForSelector("[aria-label='Available times'] button", { timeout: 60000 });
    });

    await step("2. patient: picks a time (14:30 when free, else the first offered), types their details, checks and confirms", async () => {
      const times = phone.locator("[aria-label='Available times'] button");
      const labels = await times.allInnerTexts();
      const i = labels.indexOf("14:30");
      const pick = times.nth(i >= 0 ? i : 0);
      s.time = (await pick.innerText()).trim();
      await pick.click();
      assert((await pick.getAttribute("aria-pressed")) === "true", "time chosen");
      await shot(phone, "375-b4-time");
      await axe(phone, "booking: time (375)");
      await phone.click("footer button:has-text('Continue')");
      await phone.waitForSelector("h1:has-text('Your details')");
      const [first, last] = s.name.split(" ");
      await phone.fill("#bk-firstName", first);
      await phone.fill("#bk-lastName", last);
      await phone.fill("#bk-dateOfBirth", "1993-02-16");
      await phone.fill("#bk-phoneMobile", "07700 900671");
      await phone.fill("#bk-email", `ben.carter.${RUN}@example.com`);
      await shot(phone, "375-b5-details", true);
      await axe(phone, "booking: details (375)");
      await phone.click("footer button:has-text('Continue')");
      await phone.waitForSelector("h1:has-text('Check and confirm')");
      assert(/Cancellation policy/.test(await phone.locator("main").innerText()), "the policy before confirming");
      await shot(phone, "375-b6-confirm", true);
      await phone.click("footer button:has-text('Confirm booking')");
      await phone.waitForSelector("h1:has-text(\"You're booked\")", { timeout: 60000 });
      const text = await phone.locator("main").innerText();
      s.reference = (text.match(/Ref ([2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4})/) || [])[1];
      assert(s.reference, "a booking reference");
      assert(new RegExp(`at ${s.time}`).test(text), `booked at ${s.time}`);
      await shot(phone, "375-b7-booked", true);
      await axe(phone, "booking: booked (375)");
    });

    await step("3. the appointment is a DIARY appointment (source online); reception's diary shows it straight away, marked online", async () => {
      s.appt = bookingByReference(s.reference);
      assert(s.appt && s.appt.source === "online" && s.appt.status === "booked", `diary appointment ${JSON.stringify(s.appt)}`);
      await jess.goto(`${BASE}/app/clinic/diary?date=${s.appt.starts_on}&site=${s.appt.site_id}`);
      await jess.waitForSelector("[data-diary-ready=true]");
      const block = jess.locator(`button[data-status=booked]:has-text("${s.name}")`).first();
      await block.waitFor();
      const describedBy = await block.getAttribute("aria-describedby");
      const said = describedBy ? await jess.locator(`[id="${describedBy}"]`).innerText() : "";
      assert(/booked online/i.test(said), `the block says booked online: ${said}`);
      await block.scrollIntoViewIfNeeded();
      await shot(jess, "1440-b8-reception-diary");
      await block.click();
      await jess.waitForSelector("aside >> text=Booked online");
      const drawer = await jess.locator("aside").innerText();
      assert(/Booked by the patient online/.test(drawer), `activity line: ${drawer.slice(0, 400)}`);
      assert(/confirmation requested/.test(drawer), "confirmation requested");
      await shot(jess, "1440-b9-drawer-booked-online");
    });

    await step("4. the confirmation is in the outbox (comms – one outbox), sent to the patient's address", async () => {
      await owner.goto(`${BASE}/app/clinic/messages`);
      const rows = owner.locator(`table tbody tr:has-text("${s.name}")`);
      await rows.first().waitFor({ timeout: 30000 });
      const all = await rows.allInnerTexts();
      assert(all.some((r) => /Booking confirmation/.test(r)), `confirmation row: ${all.join(" || ")}`);
      await shot(owner, "1440-b10-outbox-confirmation");
    });

    await step("5. Set-up → Online booking lists the booking: new patient, to check; Mark checked", async () => {
      await owner.goto(`${BASE}/app/clinic/online-booking`);
      const row = owner.locator(`table tbody tr:has-text("${s.name}")`);
      await row.waitFor();
      assert(/New patient/.test(await row.innerText()) && new RegExp(s.reference).test(await row.innerText()), "new patient with the reference");
      await shot(owner, "1440-b11-online-bookings", true);
      await axe(owner, "set-up online booking (1440)");
      await row.locator("button:has-text('Mark checked')").click();
      await owner.waitForSelector(`table tbody tr:has-text("${s.name}") >> text=Checked`);
    });
  } finally {
    const failed = results.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, "axe-prototype-b.json"), JSON.stringify(axeReport, null, 2));
    if (problems.length) console.log(`browser problems (${problems.length}):\n  ${problems.slice(0, 10).join("\n  ")}`);
    console.log(`\n${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  }
})();
