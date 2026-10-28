/**
 * Browser check of the Messages screens (LOCAL only – M6, designs round 2c "Messages", round 3 "Letter editor" and
 * "Patient-facing messages"): book with "Send confirmation text and email" → the confirmation is planned → move →
 * the reminder is re-planned and a "moved" notice planned → cancel → reminders cancelled, a cancellation text
 * planned → quiet hours hold a text → the message run (cron route with CRON_SECRET) sends what is due through the
 * TEST provider → a simulated reply (the signed test webhook) appears → reception answers it → template edit (owner
 * only) → a clinician writes a GP letter, previews A4, signs and sends it (outbox) → reception cannot open letters →
 * the stop-emails link stops reminder emails → an invoice emailed from billing → Retry of a failed text; 375 px; axe.
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3195 > seed.out     (scratch SQLite)
 *   server: CLINIC_SMS_PROVIDER=test CLINIC_EMAIL_PROVIDER=test CRON_SECRET=<random> CLINIC_SMS_WEBHOOK_SECRET=<random>
 *           APP_ORIGIN=http://localhost:3195 next start -p 3195
 *   SEED_LOG=seed.out BASE=http://localhost:3195 SQLITE_PATH=<scratch db> CRON_SECRET=… CLINIC_SMS_WEBHOOK_SECRET=…
 *     E2E_OUT=<dir> NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-messages-screens.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed. SQLITE_PATH (a scratch database under /tmp) is
 * read to choose patients and written once – linking the clinician's account to a seeded practitioner (no screen
 * does that yet, handover §13.4).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3195";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-messages");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const HOOK_SECRET = process.env.CLINIC_SMS_WEBHOOK_SECRET || "";
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const MESSAGES = `${BASE}/app/clinic/messages`;
const DIARY = `${BASE}/app/clinic/diary`;
const CLINIC = "riverside-demo";

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

// The clinic system's TEST clock (src/modules/pms/core/clock.ts – never in a production build): when the runner
// sets PMS_TEST_CLOCK=1 PMS_TEST_NOW PMS_TEST_NOW_SET_AT for the seed, the dev server and this script, all three
// agree on "now" (e.g. 10:30 today), so the steps that need clinic hours pass at any hour. Two-step codes keep
// the real clock.
const CLOCK_OFFSET = process.env.PMS_TEST_CLOCK === "1" && process.env.PMS_TEST_NOW && process.env.PMS_TEST_NOW_SET_AT ? Date.parse(process.env.PMS_TEST_NOW) - Number(process.env.PMS_TEST_NOW_SET_AT) : 0;
const clockNow = () => Date.now() + CLOCK_OFFSET;

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
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 900)}`);
    for (const [who, page] of failPages) await page.screenshot({ path: path.join(OUT, `fail-${results.length}-${who}.png`) }).catch(() => {});
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

function scratchDb() {
  if (!SQLITE || !/^\/(private\/)?(tmp|var\/folders)\//.test(SQLITE)) throw new Error("SQLITE_PATH must be a scratch database under /tmp");
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(SQLITE);
}
function query(sql, ...args) {
  const db = scratchDb();
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}
/** Links the member with `email` to a seeded practitioner (the one direct write – see the top of this file). */
function linkPractitioner(email, practitionerId, displayName) {
  const db = scratchDb();
  try {
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
    if (!user) throw new Error("no such member");
    const r = db.prepare("UPDATE pms_practitioners SET user_id = ?, display_name = ? WHERE tenant_id = ? AND id = ? AND user_id IS NULL").run(user.id, displayName, CLINIC, practitionerId);
    if (r.changes !== 1) throw new Error(`practitioner not linked (${r.changes})`);
  } finally {
    db.close();
  }
}

async function viewData(page, q) {
  const res = await page.request.get(`${DIARY}/api/view?${q}`);
  assert(res.ok(), `view ${res.status()}`);
  return (await res.json()).data;
}
const ready = (page) => page.waitForSelector("[data-diary-ready=true]");
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const londonNow = () => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(clockNow()));
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minute: Number(g("hour")) * 60 + Number(g("minute")) };
};
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** The signed test webhook (CLINIC_SMS_PROVIDER=test): a patient's text reply. */
async function simulateReply(page, from, text) {
  const raw = JSON.stringify({ type: "reply", clinic: CLINIC, from, text, id: `test_in_${crypto.randomBytes(6).toString("hex")}`, receivedAt: new Date(clockNow()).toISOString() });
  const ts = String(Math.floor(clockNow() / 1000));
  const sig = `v1=${crypto.createHmac("sha256", HOOK_SECRET).update(`${ts}.${raw}`).digest("hex")}`;
  return page.request.post(`${BASE}/api/clinic-messages/sms`, { data: raw, headers: { "content-type": "application/json", "x-clinic-timestamp": ts, "x-clinic-signature": sig } });
}

const e164 = (mobile) => `+44${mobile.replace(/\s+/g, "").slice(1)}`;

/** The patient's Messages tab rows (text of each row). */
async function recordRows(page, patientId) {
  await page.goto(`${BASE}/app/clinic/patients/${patientId}/messages`);
  await page.waitForSelector("[data-testid=patient-messages]");
  return page.locator("[data-testid=patient-messages] table tbody tr").allInnerTexts();
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  assert(CRON_SECRET && HOOK_SECRET, "CRON_SECRET and CLINIC_SMS_WEBHOOK_SECRET are required (the server's)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width = 1440, height = 1000) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon|clipboard/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk();
  const reception = await mk();
  const clinician = await mk();
  failPages.push(["owner", owner], ["reception", reception], ["clinician", clinician]);
  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const s = { x: null, y: null, z: null, site: null, date: null, minute: null, practitionerId: null, apptId: null, letterId: null, prac: null };

  /** Owner: quiet hours from `from` to `until` (HH:MM) on Message settings. */
  async function setQuietHours(from, until) {
    await owner.goto(`${MESSAGES}/settings`);
    await owner.fill("#quiet-start", from);
    await owner.fill("#quiet-end", until);
    await owner.click("[data-testid=save-settings]");
    await owner.waitForSelector("[role=status] >> text=Message settings saved");
  }

  /** Reception books `who` at the chosen slot with "Send confirmation text and email" ticked. */
  async function book(who, date, minute, practitionerId) {
    await reception.goto(`${DIARY}?date=${date}&site=${s.site}`);
    await ready(reception);
    await reception.click("main button:visible:has-text('New appointment')");
    await reception.fill("#bk-search", who.last_name);
    await reception.locator(`[role=option]:has-text("${who.first_name} ${who.last_name}")`).first().click();
    await reception.waitForSelector("text=Chosen:");
    await reception.selectOption("#bk-pr", practitionerId);
    await reception.fill("#bk-dt", date);
    await reception.selectOption("#bk-tm", hhmm(minute));
    const confirm = reception.locator("role=dialog >> label:has-text('Send confirmation text and email') input");
    assert(await confirm.isChecked(), "confirmation ticked by default");
    await reception.waitForSelector("text=Slot available");
    await reception.click("role=dialog >> button:has-text('Book appointment')");
    await reception.waitForSelector("text=Appointment booked");
    await reception.click("text=Back to diary");
    const data = await viewData(reception, `date=${date}&site=${s.site}`);
    const card = data.cards.find((c) => c.patientId === who.id && c.status === "booked" && c.practitionerId === practitionerId);
    assert(card, "the booking in the diary");
    return card.id;
  }

  try {
    await step("accounts: owner, reception and a clinician (linked to a seeded practitioner, two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-msg-reception-${RUN}@example.com`, "staff");
      await onboard(reception, r, "Jess Taylor (fictional)");
      const prac = query("SELECT id, display_name, registration_number FROM pms_practitioners WHERE tenant_id = ? AND user_id IS NULL AND registration_number IS NOT NULL ORDER BY id LIMIT 1", CLINIC)[0];
      assert(prac, "a seeded practitioner with a registration number");
      s.prac = prac;
      const cEmail = `zz-msg-clinician-${RUN}@example.com`;
      const c = await invite(owner, cEmail, "clinician");
      await onboard(clinician, c, prac.display_name);
      linkPractitioner(cEmail, prac.id, prac.display_name);
      // Quiet hours away from now for the first steps (texts go at once).
      const now = londonNow();
      await setQuietHours(hhmm((now.minute + 180) % 1440), hhmm((now.minute + 240) % 1440));
      // An email reminder the day before at 10:00 (Message settings → Reminders), so new bookings get one.
      await owner.selectOption("#rule-ch", "email");
      await owner.selectOption("#rule-t", "days_before");
      await owner.fill("#rule-n", "1");
      await owner.fill("#rule-at", "10:00");
      await owner.click("button:has-text('Add reminder')");
      await owner.waitForSelector("[data-testid=rules] >> text=Email · 1 day before at 10:00");
    });

    await step("navigation: Messages for every role; the badge counts replies waiting (the seed's two)", async () => {
      for (const page of [owner, reception, clinician]) {
        await page.goto(`${BASE}/app/clinic`);
        const labels = await page.locator("nav[aria-label='Clinic system'] a").allInnerTexts();
        assert(labels.some((l) => /^Messages/.test(l.trim())), `Messages in nav: ${labels.join(", ")}`);
      }
      const badge = (await reception.locator("[data-testid='nav-badge-comms.messages']").first().innerText()).trim();
      assert(/^2/.test(badge), `badge ${badge}`);
      await reception.goto(MESSAGES);
      await reception.waitForSelector("[data-testid=outbox-today]");
      const today = await reception.locator("[data-testid=outbox-today]").innerText();
      assert(/planned/.test(today) && /failed/.test(today) && /held for quiet hours/.test(today), today);
      assert((await reception.locator("table tbody tr").count()) > 5, "seeded messages listed");
      await shot(reception, "1440-outbox");
      await axe(reception, "outbox");
    });

    await step("choose patients and a free slot two working days ahead (diary view)", async () => {
      const pats = query(
        `SELECT id, first_name, last_name, phone_mobile, email FROM pms_patients WHERE tenant_id = ? AND status = 'active' AND phone_mobile LIKE '07700 900%' AND email IS NOT NULL
           AND reminder_sms = 1 AND reminder_email = 1 AND id NOT IN (SELECT patient_id FROM pms_appointments WHERE tenant_id = ? AND patient_id IS NOT NULL AND starts_at > datetime('now'))
           ORDER BY import_ref DESC LIMIT 2`,
        CLINIC,
        CLINIC,
      );
      assert(pats.length === 2, "two patients with a mobile and email, no future appointment");
      [s.x, s.y] = pats;
      const now = londonNow();
      const first = await viewData(reception, "");
      const sites = first.sites.map((x) => x.id);
      for (const offset of [2, 1, 3]) {
        const date = addDays(now.date, offset);
        for (const site of sites) {
          const data = await viewData(reception, `date=${date}&site=${site}`);
          for (const c of data.columns) {
            if (!c.practitionerId) continue;
            const starts = new Set(c.freeSlots.map((x) => x.startMinute));
            const stepMin = c.freeSlots[0] ? c.freeSlots[0].endMinute - c.freeSlots[0].startMinute : 30;
            const slot = c.freeSlots.find((x) => x.startMinute >= 9 * 60 && x.startMinute <= 15 * 60 && x.startMinute % 15 === 0 && [0, 1, 2, 3].every((k) => starts.has(x.startMinute + k * stepMin)) && starts.has(x.startMinute + 60));
            if (slot) {
              Object.assign(s, { site, date, minute: slot.startMinute, practitionerId: c.practitionerId });
              break;
            }
          }
          if (s.site) break;
        }
        if (s.site) break;
      }
      assert(s.site, "a free slot with an hour free after it");
    });

    await step("1. reception books with 'Send confirmation text and email' → the confirmation (text + email) and the reminder are planned", async () => {
      s.apptId = await book(s.x, s.date, s.minute, s.practitionerId);
      const rows = await recordRows(reception, s.x.id);
      assert(rows.filter((r) => /Booking confirmation/.test(r) && /Planned/.test(r)).length === 2, `confirmations: ${rows.join(" || ")}`);
      assert(rows.some((r) => /Appointment reminder/.test(r) && new RegExp(`at ${hhmm(s.minute)}`).test(r) && /Planned/.test(r)), "reminder planned for the time");
      await shot(reception, "1440-record-messages-booked");
      await reception.goto(`${MESSAGES}?filter=planned`);
      const outbox = await reception.locator("table tbody tr").allInnerTexts();
      assert(outbox.some((r) => r.includes(`${s.x.first_name} ${s.x.last_name}`) && /Booking confirmation/.test(r)), "confirmation in the outbox");
    });

    await step("2. move by keyboard (1 hour later) → the reminder and the (not yet sent) confirmation are re-planned for the new time", async () => {
      await reception.goto(`${DIARY}?date=${s.date}&site=${s.site}`);
      await ready(reception);
      const block = reception.locator(`button[data-status=booked]:has-text("${s.x.first_name} ${s.x.last_name}")`).first();
      await block.focus();
      await reception.keyboard.press("m");
      await reception.waitForSelector(`text=/Moving ${s.x.first_name}/`);
      for (let i = 0; i < 4; i++) await reception.keyboard.press("ArrowDown");
      await reception.keyboard.press("Enter");
      await reception.waitForSelector(`[role=status] >> text=/moved to/`);
      const rows = await recordRows(reception, s.x.id);
      const later = hhmm(s.minute + 60);
      assert(rows.some((r) => /Appointment reminder/.test(r) && r.includes(`at ${later}`) && /Planned/.test(r)), `re-planned at ${later}: ${rows.join(" || ")}`);
      assert(rows.some((r) => /Appointment reminder/.test(r) && r.includes(`at ${hhmm(s.minute)}`) && /Cancelled/.test(r)), "the old reminder cancelled");
      assert(rows.filter((r) => /Booking confirmation/.test(r) && r.includes(`at ${later}`) && /Planned/.test(r)).length === 2, "confirmation re-planned for the new time (not sent yet: no 'moved' notice)");
      assert(!rows.some((r) => /Appointment moved/.test(r)), "no moved notice before the confirmation went");
      await shot(reception, "1440-record-messages-moved");
    });

    await step("3. cancel (with notice) → the reminder is cancelled and a cancellation text planned", async () => {
      await reception.goto(`${DIARY}?date=${s.date}&site=${s.site}&focus=${s.apptId}`);
      await ready(reception);
      await reception.waitForSelector("aside >> text=Quick actions");
      await reception.click("aside button:has-text('Cancel…')");
      await reception.click("aside button:has-text('Cancel appointment')");
      await reception.waitForSelector("[role=status] >> text=/cancel/i");
      const rows = await recordRows(reception, s.x.id);
      assert(!rows.some((r) => /Appointment reminder/.test(r) && /Planned/.test(r)), `no reminder planned: ${rows.join(" || ")}`);
      assert(rows.some((r) => /Appointment reminder/.test(r) && /Cancelled/.test(r) && /appointment was cancelled|No longer needed/.test(r)), "reminder cancelled");
      assert(rows.some((r) => /Cancelled with notice/.test(r) && /Text/.test(r) && /Planned/.test(r)), "cancellation text planned");
      await shot(reception, "1440-record-messages-cancelled");
      await axe(reception, "record messages tab");
    });

    await step("4. quiet hours hold: with quiet hours over now, a booking's confirmation TEXT is held (email planned at once)", async () => {
      const now = londonNow();
      await setQuietHours(hhmm((now.minute + 1440 - 60) % 1440), hhmm((now.minute + 90) % 1440));
      await shot(owner, "1440-message-settings");
      await axe(owner, "message settings");
      await book(s.y, s.date, s.minute, s.practitionerId);
      const rows = await recordRows(reception, s.y.id);
      const text = rows.find((r) => /Booking confirmation/.test(r) && /Text/.test(r));
      assert(text && /Held – quiet hours/.test(text) && /will send/.test(text), `held: ${text}`);
      assert(rows.some((r) => /Booking confirmation/.test(r) && /Email/.test(r) && /Planned/.test(r)), "the email is not held");
      await reception.goto(`${MESSAGES}?filter=planned`);
      await reception.waitForSelector("text=Held – quiet hours");
      await shot(reception, "1440-outbox-held");
      await setQuietHours(hhmm((now.minute + 180) % 1440), hhmm((now.minute + 240) % 1440));
    });

    await step("5. the message run: refused without CRON_SECRET; with it, what is due is sent through the TEST provider", async () => {
      const no = await owner.request.get(`${BASE}/api/clinic-messages/cron`);
      assert(no.status() === 401, `no secret: ${no.status()}`);
      const wrong = await owner.request.get(`${BASE}/api/clinic-messages/cron`, { headers: { authorization: "Bearer not-the-secret" } });
      assert(wrong.status() === 401, `wrong secret: ${wrong.status()}`);
      const res = await owner.request.get(`${BASE}/api/clinic-messages/cron`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      assert(res.ok(), `cron ${res.status()}`);
      const body = await res.json();
      assert(body.ok && body.sent >= 2 && body.outbox === 0, `run: sent ${body.sent}, outbox ${body.outbox}, skipped ${body.skipped}`);
      const rows = await recordRows(reception, s.x.id);
      assert(rows.some((r) => /Cancelled with notice/.test(r) && /Sent/.test(r)), `cancellation text sent: ${rows.join(" || ")}`);
      const y = await recordRows(reception, s.y.id);
      assert(y.some((r) => /Booking confirmation/.test(r) && /Email/.test(r) && /Sent/.test(r)), "Y's email confirmation sent");
      assert(y.some((r) => /Booking confirmation/.test(r) && /Text/.test(r) && /Held/.test(r)), "Y's text still held");
      await reception.goto(`${MESSAGES}?filter=sent`);
      await shot(reception, "1440-outbox-sent");
    });

    await step("6. a simulated reply (signed test webhook) appears in Replies; the badge counts it", async () => {
      const bad = await reception.request.post(`${BASE}/api/clinic-messages/sms`, { data: "{}", headers: { "content-type": "application/json" } });
      assert(bad.status() === 401, `unsigned webhook: ${bad.status()}`);
      const res = await simulateReply(reception, e164(s.x.phone_mobile), "Can I book again for next week please?");
      assert(res.ok(), `webhook ${res.status()}`);
      await reception.goto(`${MESSAGES}?tab=replies`);
      await reception.waitForSelector("[data-testid=replies-list]");
      const first = await reception.locator("[data-testid=replies-list] li").first().innerText();
      assert(first.includes(`${s.x.first_name} ${s.x.last_name}`) && /To answer/.test(first), `reply listed: ${first}`);
      const badge = (await reception.locator("[data-testid='nav-badge-comms.messages']").first().innerText()).trim();
      assert(/^3/.test(badge), `badge ${badge}`);
    });

    await step("7. reception answers the reply by text → sent (test), the reply is dealt with", async () => {
      await reception.click(`[data-testid=replies-list] a:has-text("${s.x.first_name} ${s.x.last_name}")`);
      await reception.waitForSelector("[data-testid=reply-thread] >> text=Can I book again for next week please?");
      await reception.waitForSelector("[data-testid=reply-thread] >> text=/Cancelled with notice/");
      await shot(reception, "1440-replies-thread");
      await axe(reception, "replies");
      await reception.fill("#rp", "Of course - we have Tuesday at 10:00 free. Shall we book it?");
      await reception.click("[data-testid=reply-send]");
      await reception.waitForSelector("[role=status] >> text=Sent.");
      await reception.waitForSelector("[data-testid=reply-thread] >> text=Of course - we have Tuesday at 10:00 free");
      await reception.reload();
      const first = await reception.locator(`[data-testid=replies-list] li:has-text("${s.x.first_name} ${s.x.last_name}")`).first().innerText();
      assert(!/To answer/.test(first), "dealt with");
      await shot(reception, "1440-replies-answered");
    });

    await step("8. templates: reception reads only; the owner edits the reminder text (count and preview update) and saves", async () => {
      await reception.goto(`${MESSAGES}?tab=templates`);
      await reception.waitForSelector("[data-testid=template-editor]");
      assert((await reception.locator("[data-testid=save-template]").count()) === 0, "no Save for reception");
      assert(await reception.locator("[data-testid=template-editor] >> text=Read only").isVisible(), "read only notice");
      await owner.goto(`${MESSAGES}?tab=templates`);
      await owner.click("[data-testid=templates-list] button:has-text('Appointment reminder (text)')");
      const body = owner.locator("#tb");
      const before = await body.inputValue();
      await body.fill(before.replace("{{reply.instructions}}", "Please bring shorts. {{reply.instructions}}"));
      await owner.waitForSelector("[data-testid=template-preview] >> text=/Please bring shorts\\./");
      await shot(owner, "1440-templates");
      await axe(owner, "templates");
      await owner.click("[data-testid=save-template]");
      await owner.waitForSelector("[role=status] >> text=Template saved");
      await owner.reload();
      await owner.click("[data-testid=templates-list] button:has-text('Appointment reminder (text)')");
      assert((await owner.locator("#tb").inputValue()).includes("Please bring shorts."), "saved");
    });

    await step("9. clinician writes a GP letter: template → editor → fills the gaps → A4 preview → signs and sends by email (outbox)", async () => {
      await clinician.goto(`${BASE}/app/clinic/patients/${s.x.id}/messages`);
      await clinician.click("[data-testid=write-letter]");
      await clinician.waitForSelector("[data-testid=letter-templates]");
      await clinician.check("label:has-text('Discharge letter to the GP') input");
      await clinician.click("[data-testid=start-letter]");
      await clinician.waitForURL(/\/app\/clinic\/letters\/ltr_/);
      s.letterId = clinician.url().split("/").pop();
      await clinician.waitForSelector("#l-body");
      const body = await clinician.inputValue("#l-body");
      assert(/\[\[/.test(body), "gaps to write");
      await clinician.fill(
        "#l-body",
        body
          .replace(/\[\[Summarise progress and the outcome measures\]\]/, "- Pain improved from 7/10 to 2/10 (NPRS).\n- Back to full work.")
          .replace(/\[\[[^\]]*\]\]/g, "A home exercise programme to continue.")
          .replace(/\[not recorded: [^\]]*\]/g, "low back pain"),
      );
      await clinician.fill("#lr-email", "gp.reception@example.com");
      const sig = await clinician.locator("[data-testid=signature-will-be]").innerText();
      assert(sig.includes(s.prac.display_name) && sig.includes(s.prac.registration_number), `signature line: ${sig}`);
      await clinician.click("[data-testid=save-draft]");
      await clinician.waitForSelector("[role=status] >> text=Draft saved");
      await shot(clinician, "1440-letter-editor");
      await axe(clinician, "letter editor");
      await clinician.click("[data-testid=letter-preview]");
      await clinician.waitForSelector("[data-testid=letter-a4] [data-testid=letter-sheet]");
      await shot(clinician, "1440-letter-a4-preview");
      await clinician.click("[data-testid=sign-send]");
      await clinician.waitForSelector("[role=status] >> text=/Signed\\. Sent\\./");
      await clinician.waitForSelector("[data-testid=letter-status] >> text=/Signed · sent by email/");
      assert((await clinician.locator("[data-testid=letter-signature]").innerText()).includes(s.prac.registration_number), "signature on the letter");
      await clinician.goto(`${BASE}/app/clinic/letters/${s.letterId}/print`);
      await clinician.waitForSelector("[data-testid=letter-sheet]");
      await clinician.emulateMedia({ media: "print" });
      await shot(clinician, "a4-letter-print");
      await clinician.emulateMedia({ media: "screen" });
      await clinician.goto(`${MESSAGES}?filter=sent`);
      const rows = await clinician.locator("table tbody tr").allInnerTexts();
      assert(rows.some((r) => /Letter/.test(r) && /gp\.reception@example\.com/.test(r) && /Sent/.test(r)), "the letter's email in the outbox");
    });

    await step("10. reception cannot open letters: titles only on the record; the letter, New letter and print pages are 404", async () => {
      await reception.goto(`${BASE}/app/clinic/patients/${s.x.id}/messages`);
      await reception.waitForSelector("[data-testid=letters-list]");
      const list = await reception.locator("[data-testid=letters-list]").innerText();
      assert(/Discharge letter to the GP/.test(list) && /Reception sees letter titles, not content/.test(list), "title shown, note");
      assert((await reception.locator(`[data-testid=letters-list] a[href*='/letters/']`).count()) === 0, "no link to open it");
      assert((await reception.locator("[data-testid=write-letter]").count()) === 0, "no Write a letter");
      await shot(reception, "1440-reception-letters-titles");
      const page = await reception.goto(`${BASE}/app/clinic/letters/${s.letterId}`);
      assert(page.status() === 404, `letter page: ${page.status()}`);
      const np = await reception.goto(`${BASE}/app/clinic/letters/new?patient=${s.x.id}`);
      assert(np.status() === 404, `new letter: ${np.status()}`);
      const pr = await reception.goto(`${BASE}/app/clinic/letters/${s.letterId}/print`);
      assert(pr.status() === 404, `print: ${pr.status()}`);
    });

    await step("11. the stop-emails link stops reminder emails (and records how); texts stay planned", async () => {
      s.z = s.y;
      // Send Z an email (general): it carries the stop-emails link.
      await owner.goto(`${MESSAGES}?tab=send&patient=${s.z.id}`);
      await owner.waitForSelector("[data-testid=send-form]");
      await owner.check("input[name=sm-channel][value=email]");
      await owner.fill("#sm-b", "Hello {{patient.first_name}}, the car park is closed on Friday (fictional).");
      await owner.click("[data-testid=send-now]");
      await owner.waitForSelector("[role=status] >> text=Sent.");
      await owner.goto(`${BASE}/app/clinic/patients/${s.z.id}/messages`);
      const before = await owner.locator("[data-testid=patient-messages] table tbody tr").allInnerTexts();
      assert(before.some((r) => /Appointment reminder/.test(r) && /Email/.test(r) && /Planned/.test(r)), "email reminder planned before");
      await owner.goto(`${MESSAGES}?filter=sent`);
      await owner.locator(`table tbody tr:has-text("${s.z.first_name} ${s.z.last_name}"):has-text("Message") button:has-text('View')`).first().click();
      await owner.waitForSelector("[data-testid=message-view]");
      const text = await owner.locator("[data-testid=message-view]").innerText();
      const link = (text.match(/https?:\/\/\S+\/api\/clinic-messages\/unsubscribe\?t=\S+/) || [])[0];
      assert(link, "stop link in the email");
      await owner.keyboard.press("Escape");
      const anon = await mk(375, 800);
      await anon.goto(link);
      await anon.waitForSelector("text=/Stop appointment emails from/");
      await shot(anon, "375-unsubscribe-page");
      await anon.click("button:has-text('Stop these emails')");
      await anon.waitForSelector("text=Done");
      await anon.context().close();
      await owner.goto(`${BASE}/app/clinic/patients/${s.z.id}/messages`);
      const after = await owner.locator("[data-testid=patient-messages] table tbody tr").allInnerTexts();
      assert(!after.some((r) => /Appointment reminder/.test(r) && /Email/.test(r) && /Planned/.test(r)), `no email reminder planned: ${after.join(" || ")}`);
      assert(after.some((r) => /Appointment reminder/.test(r) && /Text/.test(r) && /Planned|Held/.test(r)), "the text reminder stays");
      assert(after.some((r) => /Appointment reminder/.test(r) && /Email/.test(r) && /Opted out/.test(r)), "cancelled as opted out");
      const consent = await owner.locator("[data-testid=patient-messages]").innerText();
      assert(/Stopped appointment emails – Patient used the stop-emails link/.test(consent), "how it changed is recorded");
      await shot(owner, "1440-record-after-unsubscribe");
    });

    await step("12. billing: an issued patient invoice emailed through Messages (test service)", async () => {
      const inv = query(
        `SELECT i.id FROM pms_invoices i JOIN pms_patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
           WHERE i.tenant_id = ? AND i.status = 'issued' AND i.bill_to = 'patient' AND p.email IS NOT NULL AND p.phone_mobile LIKE '07700 900%' AND p.reminder_sms = 1 ORDER BY i.issued_on DESC LIMIT 1`,
        CLINIC,
      )[0];
      assert(inv, "an issued patient invoice");
      await owner.goto(`${BASE}/app/clinic/billing/invoices/${inv.id}`);
      await owner.click("[data-testid=email-invoice]");
      await owner.waitForSelector("[role=status] >> text=/Invoice emailed\\. Sent\\./");
      await shot(owner, "1440-invoice-emailed");
      await owner.goto(`${MESSAGES}?filter=sent`);
      const rows = await owner.locator("table tbody tr").allInnerTexts();
      assert(rows.some((r) => /Invoice/.test(r) && /Email/.test(r) && /Sent/.test(r)), "invoice email in the outbox");
    });

    await step("13. Retry: the seeded failed text is sent again through the test service", async () => {
      await reception.goto(`${MESSAGES}?filter=failed`);
      const retry = reception.locator("[data-testid=retry-button]").first();
      await retry.waitFor();
      await shot(reception, "1440-outbox-failed");
      await retry.click();
      await reception.waitForSelector("[role=status] >> text=Sent again.");
    });

    await step("14. patient-facing messages: texts ≤ 160 characters, under the clinic's name, opt-out wording", async () => {
      await reception.goto(`${MESSAGES}/patient-view`);
      await reception.waitForSelector("[data-testid=patient-facing]");
      const texts = await reception.locator("[data-testid=patient-text]").allInnerTexts();
      assert(texts.length >= 5, `texts: ${texts.length}`);
      for (const t of texts) {
        assert(t.length <= 160, `≤ 160: ${t.length} – ${t}`);
        assert(/^Riverside: /.test(t), `clinic's name: ${t}`);
        assert(/STOP to opt out$/.test(t), `opt-out: ${t}`);
        assert(!/Clinic system/i.test(t), "never the product name");
      }
      await shot(reception, "1440-patient-facing", true);
      await axe(reception, "patient-facing messages");
    });

    await step("375 px: outbox as cards, replies, send form, record tab – no sideways scrolling", async () => {
      const phone = await mk(375, 812);
      await phone.context().addCookies(await reception.context().cookies());
      for (const [url, name] of [
        [MESSAGES, "375-outbox"],
        [`${MESSAGES}?tab=replies`, "375-replies"],
        [`${MESSAGES}?tab=send&patient=${s.x.id}`, "375-send"],
        [`${BASE}/app/clinic/patients/${s.x.id}/messages`, "375-record-messages"],
      ]) {
        await phone.goto(url);
        await phone.waitForLoadState("networkidle");
        const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
        assert(wide <= 376, `${name}: page is ${wide} px wide`);
        await shot(phone, name);
      }
      await axe(phone, "outbox 375");
      await phone.context().close();
    });
  } finally {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    if (problems.length) console.log(`Browser problems:\n${problems.slice(0, 20).join("\n")}`);
    fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));
    await browser.close();
    process.exitCode = passed === results.length ? 0 : 1;
  }
})();
