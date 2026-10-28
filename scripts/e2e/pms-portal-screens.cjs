/**
 * Online booking, the patient portal, intake forms and the patient's outcome questionnaire (M7) end to end in the
 * browser – LOCAL only, on a fresh demo seed with a second, reports-only clinic (harbour-clinic):
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3183 > seed.out
 *   npm run admin:create-clinic -- --name "Harbour Physio (fictional)" --slug harbour-clinic --owner-email … > clinic-b.out
 *   npm run build && PORT=3183 CLINIC_EMAIL_PROVIDER=test CLINIC_SMS_PROVIDER=test npm run start
 *   SEED_LOG=seed.out BASE=http://localhost:3183 E2E_OUT=<dir> SQLITE_PATH=<the server's scratch SQLite> \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-portal-screens.cjs
 *
 * Steps (patient at 375 px, staff at 1440 px; axe on both):
 *   distance only after "Use my location" or a postcode → a new patient books → reception's booking of the same slot
 *   is refused (the diary's clash check) → magic-link sign-in with the link from the outbox → no existence leak for an
 *   unknown address → the sign-in rate limit → the patient cancels inside the notice → late cancellation with the fee
 *   flagged → the patient books again and moves it → intake forms completed and signed → the sealed copy on the
 *   record's Forms tab → reception cannot see health answers → an outcome questionnaire answered in the portal lands
 *   in the record's Outcomes → a reports-only clinic has no public pages (404) → staff screens (set-up, builder).
 *
 * SQLITE_PATH is only READ (appointment status / fee flag). Fictional data only; nothing secret is printed.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3183";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-portal-screens");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || process.env.CLINFORMS_SQLITE_PATH || "";
const CLINIC = process.env.CLINIC_SLUG || "riverside-demo";
const OTHER = process.env.REPORTS_ONLY_SLUG || "harbour-clinic";
const RUN = crypto.randomBytes(3).toString("hex");
const AXE = require.resolve("axe-core/axe.min.js");
const PUB = `${BASE}/clinics/${CLINIC}`;

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
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 700)}`);
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
  await page.waitForTimeout(400);
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

function readDb(sql, ...args) {
  if (!SQLITE || !/^\/(private\/)?(tmp|var\/folders)\//.test(SQLITE)) throw new Error("SQLITE_PATH must be a scratch database under /tmp");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(SQLITE, { readOnly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
}
const appointmentOf = (reference) =>
  readDb(
    "SELECT a.id, a.starts_on, a.starts_at, a.site_id, a.practitioner_id, a.service_id, a.status, a.fee_due, a.source, a.patient_id FROM pms_online_bookings b JOIN pms_appointments a ON a.tenant_id = b.tenant_id AND a.id = b.appointment_id WHERE b.tenant_id = ? AND b.reference = ?",
    CLINIC,
    reference,
  );
const appointmentById = (id) => readDb("SELECT id, status, fee_due, starts_at FROM pms_appointments WHERE tenant_id = ? AND id = ?", CLINIC, id);
const hhmmLondon = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** Through the booking page: site → Initial assessment → anyone → a time (`dayIndex` = which day chip; `last` time). */
async function bookOnline(page, { dayIndex = 0, details = null, lastTime = false, shotPrefix = null, shot }) {
  await page.waitForSelector("h1:has-text('Where would you like to be seen?')");
  await page.locator("main ul li button").first().click();
  await page.getByRole("button", { name: /Initial assessment/ }).click();
  await page.getByRole("button", { name: /Anyone available/ }).click();
  await page.waitForSelector("[aria-label='Available times'] button", { timeout: 60000 });
  const days = page.locator("[aria-label='Days'] button");
  const n = await days.count();
  assert(n > 0, "days with free times");
  await days.nth(Math.min(dayIndex, n - 1)).click();
  const times = page.locator("[aria-label='Available times'] button");
  await times.first().waitFor();
  await times.nth(lastTime ? (await times.count()) - 1 : 0).click();
  if (shotPrefix) await shot(page, `${shotPrefix}-time`);
  await page.click("footer button:has-text('Continue')");
  if (details) {
    await page.waitForSelector("h1:has-text('Your details')");
    await page.fill("#bk-firstName", details.first);
    await page.fill("#bk-lastName", details.last);
    await page.fill("#bk-dateOfBirth", details.dob);
    await page.fill("#bk-phoneMobile", details.mobile);
    await page.fill("#bk-email", details.email);
    await page.click("footer button:has-text('Continue')");
  }
  await page.waitForSelector("h1:has-text('Check and confirm')");
  await page.click("footer button:has-text('Confirm booking')");
  await page.waitForSelector("h1:has-text(\"You're booked\")", { timeout: 60000 });
  const text = await page.locator("main").innerText();
  const reference = (text.match(/Ref ([2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4})/) || [])[1];
  assert(reference, `a reference: ${text.slice(0, 300)}`);
  return { reference, text };
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width, height, extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, ...extra });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk(1440, 1000);
  const jess = await mk(1440, 1000);
  const phone = await mk(375, 812);
  failPages.push(["owner", owner], ["reception", jess], ["phone", phone]);
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  const chloe = { first: "Chloe", last: `Turner-${RUN}`, dob: "1988-07-14", mobile: "07700 900318", email: `chloe.turner.${RUN}@example.com` };
  const s = { reference: null, appt: null, link: null, rebook: null };

  /** The newest "Portal sign-in" email to a patient, read on the outbox (View). */
  async function signInLinkFor(name) {
    await owner.goto(`${BASE}/app/clinic/messages`);
    const row = owner.locator(`table tbody tr:has-text("${name}"):has-text("Portal sign-in")`).first();
    await row.waitFor({ timeout: 30000 });
    await row.locator("button:has-text('View')").click();
    await owner.waitForSelector("[data-testid=message-view]");
    const text = await owner.locator("[data-testid=message-view]").innerText();
    await owner.keyboard.press("Escape");
    const link = (text.match(/https?:\/\/\S+\/portal\/link\/[A-Za-z0-9_-]{43}(\?next=\S+)?/) || [])[0];
    assert(link, "a sign-in link in the email");
    return link;
  }
  async function portalSignInCount() {
    await owner.goto(`${BASE}/app/clinic/messages`);
    await owner.waitForSelector("main table");
    return owner.locator("table tbody tr:has-text('Portal sign-in')").count();
  }
  async function setNotice(hours) {
    await owner.goto(`${BASE}/app/clinic/online-booking`);
    await owner.fill("#ob-cancel", String(hours));
    await owner.click("button:has-text('Save settings')");
    await owner.waitForSelector("text=Online booking settings saved.");
  }

  try {
    await step("set-up: owner and reception (Jess) accounts with two-step", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-portal-jess-${RUN}@example.com`, "staff");
      await onboard(jess, r, "Jess Taylor (fictional)");
    });

    await step("1. distance only after the patient asks: none at first; a postcode places them; 'Use my location' too (worked out in the browser)", async () => {
      await phone.goto(`${PUB}/book`);
      await phone.waitForSelector("main ul li button");
      assert(!/miles/.test(await phone.locator("main").innerText()), "no distance at first");
      await phone.fill("#bk-place", "MK2 4AB");
      await phone.press("#bk-place", "Enter");
      await phone.waitForSelector("main >> text=/\\d+(\\.\\d)? miles/");
      await shot(phone, "375-p01-distance-postcode");
      const geo = await mk(375, 812, { geolocation: { latitude: 52.0406, longitude: -0.7594 }, permissions: ["geolocation"] });
      await geo.context().grantPermissions(["geolocation"], { origin: BASE });
      await geo.goto(`${PUB}/book`);
      await geo.waitForSelector("main ul li button");
      assert(!/miles/.test(await geo.locator("main").innerText()), "no distance before the tap");
      await geo.getByRole("button", { name: "Use my location" }).click();
      await geo.waitForSelector("main >> text=/\\d+(\\.\\d)? miles/");
      assert(/not sent or stored/.test(await geo.locator("main").innerText()), "says it stays on the device");
      await shot(geo, "375-p02-distance-location");
      await axe(geo, "booking with distance (375)");
      await geo.context().close();
    });

    await step("2. a new patient books on the phone (375 px): reference, forms to fill in, a diary appointment marked online", async () => {
      await phone.goto(`${PUB}/book`);
      const r = await bookOnline(phone, { details: chloe, shotPrefix: "375-p03", shot });
      s.reference = r.reference;
      assert(/Before your visit/.test(r.text), "forms to fill in before the visit");
      await shot(phone, "375-p04-booked");
      s.appt = appointmentOf(s.reference);
      assert(s.appt && s.appt.source === "online" && s.appt.status === "booked", `diary appointment: ${JSON.stringify(s.appt)}`);
    });

    await step("3. reception cannot book the same slot: the diary's clash check refuses it (one appointment store)", async () => {
      const q = new URLSearchParams({ serviceId: s.appt.service_id, practitionerId: s.appt.practitioner_id, siteId: s.appt.site_id, date: s.appt.starts_on, startTime: hhmmLondon(s.appt.starts_at) });
      const res = await jess.request.get(`${BASE}/app/clinic/diary/api/booking-check?${q}`);
      assert(res.ok(), `booking-check ${res.status()}`);
      const data = (await res.json()).data;
      assert(data.clashText && new RegExp(chloe.last).test(data.clashText), `clash with the online booking: ${JSON.stringify(data).slice(0, 300)}`);
      await jess.goto(`${BASE}/app/clinic/diary?date=${s.appt.starts_on}&site=${s.appt.site_id}`);
      await jess.waitForSelector("[data-diary-ready=true]");
      const block = jess.locator(`button[data-status=booked]:has-text("${chloe.last}")`).first();
      await block.waitFor();
      await block.scrollIntoViewIfNeeded();
      await shot(jess, "1440-p05-reception-diary-online-booking", false);
    });

    await step("4. magic-link sign-in: the link comes from the outbox (comms), works once, signs the patient in", async () => {
      const before = await portalSignInCount();
      await phone.goto(`${PUB}/portal`);
      await phone.waitForSelector("h1:has-text('Your appointments and forms')");
      await shot(phone, "375-p06-portal-sign-in");
      await axe(phone, "portal sign-in (375)");
      await phone.fill("#pt-email", chloe.email);
      await phone.click("button:has-text('Email me a sign-in link')");
      await phone.waitForSelector("h1:has-text('Check your email')");
      await shot(phone, "375-p07-check-email");
      s.link = await signInLinkFor(`${chloe.first} ${chloe.last}`);
      assert((await portalSignInCount()) === before + 1, "one sign-in email");
      await phone.goto(s.link);
      await phone.waitForSelector("h1:has-text('Sign in to your patient portal')");
      await phone.click("button:has-text('Sign in')");
      await phone.waitForSelector(`h1:has-text('Hello, ${chloe.first}')`, { timeout: 30000 });
      await shot(phone, "375-p08-portal-home");
      await axe(phone, "portal home (375)");
      const again = await mk(375, 812);
      await again.goto(s.link);
      await again.click("button:has-text('Sign in')");
      await again.waitForSelector("text=/expired or has already been used/");
      await again.context().close();
    });

    await step("5. no existence leak: an unknown address gets the same answer and no email is written", async () => {
      const before = await portalSignInCount();
      const anon = await mk(375, 812);
      await anon.goto(`${PUB}/portal`);
      await anon.fill("#pt-email", `nobody.${RUN}@example.com`);
      await anon.click("button:has-text('Email me a sign-in link')");
      await anon.waitForSelector("h1:has-text('Check your email')");
      assert(/If .* is the address we hold for you/.test(await anon.locator("main").innerText()), "the same words");
      await anon.context().close();
      assert((await portalSignInCount()) === before, "no sign-in email for an unknown address");
    });

    await step("6. rate limit on sign-in requests: the sixth request for one address in an hour is refused", async () => {
      const anon = await mk(375, 812);
      await anon.goto(`${PUB}/portal`);
      await anon.fill("#pt-email", `rate.${RUN}@example.com`);
      await anon.click("button:has-text('Email me a sign-in link')");
      await anon.waitForSelector("h1:has-text('Check your email')");
      for (let i = 0; i < 5; i++) {
        await anon.click("button:has-text('Send it again')");
        await anon.waitForSelector("button:has-text('Send it again'):not([disabled])");
      }
      await anon.waitForSelector("[role=alert] >> text=/Too many attempts/");
      await shot(anon, "375-p09-rate-limited");
      await anon.context().close();
    });

    await step("7. the patient cancels inside the notice period → warned of the fee → recorded as a LATE cancellation with the fee flagged", async () => {
      await setNotice(336);
      await phone.goto(`${PUB}/portal`);
      await phone.locator(`a[href*="/portal/appointments/${s.appt.id}"]`).click();
      await phone.waitForSelector("[role=note] >> text=late cancellation");
      await shot(phone, "375-p10-appointment-late-warning");
      await axe(phone, "portal appointment (375)");
      await phone.click("button:has-text('Cancel appointment')");
      await phone.waitForSelector("[role=alertdialog]");
      await shot(phone, "375-p11-cancel-confirm");
      await phone.click("button:has-text('Cancel and accept the fee')");
      await phone.waitForSelector("text=The clinic will contact you about the late cancellation fee.", { timeout: 30000 });
      const after = appointmentById(s.appt.id);
      assert(after.status === "late_cancelled" && Number(after.fee_due) === 1, `late cancellation with fee: ${JSON.stringify(after)}`);
      await shot(phone, "375-p12-cancelled-late");
      await jess.goto(`${BASE}/app/clinic/diary?date=${s.appt.starts_on}&site=${s.appt.site_id}`);
      await jess.waitForSelector("[data-diary-ready=true]");
      await setNotice(24);
    });

    await step("8. the patient books again in the portal (no details asked) and moves it to another time", async () => {
      await phone.goto(`${PUB}/portal`);
      await phone.click("a:has-text('Book an appointment')");
      const r = await bookOnline(phone, { dayIndex: 3, shotPrefix: "375-p13-rebook", shot });
      s.rebook = appointmentOf(r.reference);
      assert(s.rebook && s.rebook.status === "booked", "booked again");
      await phone.goto(`${PUB}/portal`);
      await phone.locator(`a[href*="/portal/appointments/${s.rebook.id}"]`).click();
      await phone.click("a:has-text('Move to another time')");
      await phone.waitForSelector("h1:has-text('Who would you like to see?')");
      await phone.getByRole("button", { name: /Anyone available/ }).click();
      const times = phone.locator("[aria-label='Available times'] button");
      await times.first().waitFor({ timeout: 60000 });
      const days = phone.locator("[aria-label='Days'] button");
      await days.nth(Math.min(3, (await days.count()) - 1)).click();
      await times.nth((await times.count()) - 1).click();
      await phone.click("footer button:has-text('Continue')");
      await phone.click("footer button:has-text('Move my appointment')");
      await phone.waitForSelector("h1:has-text('Your appointment has moved')", { timeout: 60000 });
      await shot(phone, "375-p14-moved");
      const moved = appointmentById(s.rebook.id);
      assert(moved.status === "booked" && moved.starts_at !== s.rebook.starts_at, `the same appointment moved: ${JSON.stringify(moved)}`);
    });

    await step("9. intake forms on the phone: consent signed with a typed name (sealed); the health questionnaire sent", async () => {
      await phone.goto(`${PUB}/portal`);
      await phone.locator("a:has-text('Consent to assessment and treatment')").first().click();
      await phone.waitForSelector("text=/Part 1 of/");
      await shot(phone, "375-p15-consent-part1");
      for (const label of ["I agree to be assessed", "I understand that the clinic keeps", "I have read the clinic's cancellation policy"]) await phone.locator(`label:has-text("${label}") input`).check();
      await phone.locator("fieldset:has-text('May the clinic write to your GP') label:has-text('Yes') input").check();
      await phone.click("button:has-text('Continue')");
      await phone.fill("#sig", `${chloe.first} ${chloe.last}`);
      await phone.locator("label:has-text('typing my name counts as my signature') input").check();
      await shot(phone, "375-p16-consent-sign");
      await axe(phone, "intake form – sign (375)");
      await phone.click("button:has-text('Sign and send')");
      await phone.waitForSelector("h1:has-text('Signed and sent')", { timeout: 30000 });
      await shot(phone, "375-p17-signed-and-sent");
      await phone.goto(`${PUB}/portal`);
      await phone.locator("a:has-text('Health questionnaire')").first().click();
      await phone.waitForSelector("text=Only your physiotherapist sees these answers");
      await phone.fill("#q-problem", "Sore left knee after running, worse on stairs (fictional).");
      await phone.locator("fieldset:has-text('When did it start?') label:has-text('2 to 6 weeks ago') input").check();
      await shot(phone, "375-p18-health-questions");
      await axe(phone, "intake form – health (375)");
      await phone.click("button:has-text('Continue')");
      await phone.click("button:has-text('Send')");
      await phone.waitForSelector("h1:has-text('Sent')", { timeout: 30000 });
    });

    await step("10. the sealed signed copy on the record's Forms tab (owner): Signed and sealed, the signature panel, fingerprint", async () => {
      await owner.goto(`${BASE}/app/clinic/patients/${s.appt.patient_id}/forms`);
      await owner.waitForSelector("h2:has-text('Forms')");
      await shot(owner, "1440-p19-record-forms-tab");
      await axe(owner, "record forms tab (1440)");
      await owner.locator("a:has-text('Consent to assessment and treatment')").click();
      await owner.waitForSelector("text=Signed and sealed.");
      const text = await owner.locator("main").innerText();
      assert(new RegExp(`${chloe.first} ${chloe.last}`).test(text) && /Fingerprint/.test(text) && /Patient portal, signed in by email link/.test(text), "signature panel");
      await shot(owner, "1440-p20-signed-copy");
      await axe(owner, "signed copy (1440)");
      await owner.goto(`${BASE}/app/clinic/patients/${s.appt.patient_id}/forms`);
      await owner.locator("a:has-text('Health questionnaire')").click();
      await owner.waitForSelector("text=Sore left knee");
      s.healthUrl = owner.url();
      await shot(owner, "1440-p21-health-answers-clinician");
      await owner.goto(`${BASE}/app/clinic/patients/${s.appt.patient_id}`);
      await owner.waitForSelector("section[aria-label=Forms] >> text=Consent to assessment and treatment");
    });

    await step("11. reception cannot see health answers: the questions without the answers, '… only shown to clinicians'", async () => {
      await jess.goto(s.healthUrl);
      await jess.waitForSelector("text=/health answers? (is|are) only shown to clinicians/");
      assert(!/Sore left knee/.test(await jess.locator("body").innerText()), "no health answer for reception");
      await shot(jess, "1440-p22-health-answers-reception");
      await axe(jess, "signed copy as reception (1440)");
    });

    await step("12. outcome questionnaire: sent from the record → answered on the phone → the score in the record's Outcomes", async () => {
      await owner.goto(`${BASE}/app/clinic/patients/${s.appt.patient_id}/forms`);
      await owner.selectOption("#pf-measure", "nprs");
      await owner.click("button:has-text('Send questionnaire')");
      await owner.waitForSelector("text=NPRS sent to the patient's portal.");
      await phone.goto(`${PUB}/portal`);
      await phone.locator("a:has-text('Questionnaire to complete')").first().click();
      await phone.waitForSelector("text=/Question 1 of 1/");
      await phone.locator("label:has-text('7') input").first().check();
      await shot(phone, "375-p23-outcome-question");
      await axe(phone, "outcome questionnaire (375)");
      await phone.click("button:has-text('Send to my physio')");
      await phone.waitForSelector("text=Your score:", { timeout: 30000 });
      assert(/7\/10/.test(await phone.locator("main").innerText()), "score 7/10");
      await shot(phone, "375-p24-outcome-thanks");
      await owner.goto(`${BASE}/app/clinic/patients/${s.appt.patient_id}/outcomes`);
      await owner.waitForSelector("text=NPRS");
      const t = await owner.locator("main").innerText();
      assert(/7\/10/.test(t) && /from the patient's portal/.test(t), "NPRS 7/10 from the portal in Outcomes");
      await shot(owner, "1440-p25-record-outcomes");
    });

    await step("13. a reports-only clinic (no clinic package) has NO public booking or portal page – 404", async () => {
      for (const p of ["", "/book", "/portal", "/portal/link/" + "a".repeat(43)]) {
        const res = await phone.request.get(`${BASE}/clinics/${OTHER}${p}`);
        assert(res.status() === 404, `${OTHER}${p}: ${res.status()}`);
      }
      const unknown = await phone.request.get(`${BASE}/clinics/no-such-clinic-${RUN}/book`);
      assert(unknown.status() === 404, "unknown clinic 404");
    });

    await step("14. staff screens: Set-up → Online booking, intake forms list and builder (Mark clinical)", async () => {
      await owner.goto(`${BASE}/app/clinic/online-booking`);
      await owner.waitForSelector("h1:has-text('Online booking')");
      await shot(owner, "1440-p26-setup-online-booking");
      await owner.goto(`${BASE}/app/clinic/intake`);
      await owner.waitForSelector("h1:has-text('Intake forms')");
      await shot(owner, "1440-p27-intake-forms");
      await axe(owner, "intake forms list (1440)");
      await owner.locator("a:has-text('Health questionnaire')").click();
      await owner.waitForSelector("button[aria-pressed=true]:has-text('Clinical')");
      await shot(owner, "1440-p28-intake-builder");
      await axe(owner, "intake builder (1440)");
      const r = await jess.request.get(`${BASE}/app/clinic/intake`, { maxRedirects: 0 });
      assert(r.status() === 404 || r.status() >= 300, `reception cannot open the builder: ${r.status()}`);
    });
  } finally {
    const failed = results.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, "axe-portal.json"), JSON.stringify(axeReport, null, 2));
    if (problems.length) console.log(`browser problems (${problems.length}):\n  ${problems.slice(0, 10).join("\n  ")}`);
    console.log(`\n${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  }
})();
