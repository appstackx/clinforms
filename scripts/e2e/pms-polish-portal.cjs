/**
 * Portal follow-ups (M9b polish) end to end in the browser – LOCAL only, on a fresh demo seed:
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3174 > seed.out
 *   npm run build && PORT=3174 CLINIC_EMAIL_PROVIDER=test CLINIC_SMS_PROVIDER=test npm run start
 *   SEED_LOG=seed.out BASE=http://localhost:3174 E2E_OUT=<dir> SQLITE_PATH=<the server's scratch SQLite> \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-polish-portal.cjs
 *
 * Steps (staff at 1440 px, the clinic device at 820 px, the patient's phone at 375 px; axe on the new screens):
 *   PORTAL-004 – a clinician attaches a PDF to Megan Hart's record and shares it with her ("Share with the patient",
 *   email with a portal link through the outbox) → reception cannot reach attachments → Megan signs in from that
 *   email and sees the document, downloads the PDF (content-type, %PDF) → the record shows "opened" → withdraw →
 *   the patient's page and the file are gone (404).
 *   FORM-007 (M10 H3) – "Complete in the clinic" on her waiting health questionnaire → the STAFF screen shows a code →
 *   a separate browser that is not signed in opens the device page and enters it (a wrong code is refused; the code
 *   works once) → the device shows ONLY that form (no staff navigation or /app link, not even her name, no staff
 *   session) → she fills it in → the device locks on "hand back" → on the staff screen a wrong password is refused →
 *   the member verifies with their password → the signed copy says "Completed in the clinic, verified by …".
 *   PDF – "Download PDF" of the sealed copy returns a PDF (content-type, %PDF) for the clinician and for reception.
 *   Preview – the builder's "Preview as patient" shows the patient's form (unsaved wording included), nothing sendable.
 *
 * SQLITE_PATH is READ, plus one test-only write per portal sign-in (M10 C1: the link's hash – see signInLinkFor).
 * Otherwise only READ (ids, the hand-off row). Fictional data only; nothing secret is printed.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3174";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-polish-portal");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || process.env.CLINFORMS_SQLITE_PATH || "";
const { openScratchDb } = require("./scratch-db.cjs"); // SQLITE_PATH, or E2E_DATABASE_URL (a local Postgres)
const CLINIC = process.env.CLINIC_SLUG || "riverside-demo";
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

/** Accepts an invitation, sets the password and two-step; answers the password (the device's verify step needs it). */
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
  return password;
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
/** axe on the page, or only on `include` (a CSS selector – the part this script adds to another module's page). */
async function axe(page, label, include = null) {
  await page.waitForTimeout(400);
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async (sel) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(sel ? { include: [[sel]] } : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  }, include);
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeReport.push({ label, found });
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
}

function readDb(sql, ...args) {
  const db = openScratchDb({ readOnly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
}

/** TEST-ONLY write to the scratch database (M10 C1: gives a sign-in link a secret the test knows – its hash only). */
function writeDb(sql, ...args) {
  const db = openScratchDb();
  try {
    const r = db.prepare(sql).run(...args);
    if (r.changes !== 1) throw new Error(`expected one row changed, got ${r.changes}`);
  } finally {
    db.close();
  }
}

/** A small PDF made by hand (one page, "Home exercise plan (fictional)"). */
function samplePdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 72 760 Td (Home exercise plan \\(fictional\\)) Tj ET";
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const watch = (page) => {
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const mk = async (width, height, extra = {}) => watch(await (await browser.newContext({ viewport: { width, height }, ...extra })).newPage());
  const owner = await mk(1440, 1000);
  const jess = await mk(1440, 1000);
  const phone = await mk(375, 812);
  failPages.push(["owner", owner], ["reception", jess], ["phone", phone]);
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  const s = { ownerPassword: null, megan: null, shareTitle: `Your exercise plan ${RUN}`, docUrl: null, fileUrl: null, tablet: null, handoffUrl: null, copyUrl: null };
  const OWNER_NAME = "Helen Ward (fictional)";

  /**
   * The newest "Portal sign-in" email to a patient. M10 C1: staff never see the link – the outbox's View shows it
   * hidden (checked here). The provider's copy is not readable from the browser, so the test gives the newest link a
   * secret it knows: it writes only that secret's SHA-256 to the scratch database (as the app stores it), then opens
   * the link like the patient would. `next` is the page the email opens (it is not stored either).
   */
  async function signInLinkFor(name, next = null) {
    await owner.goto(`${BASE}/app/clinic/messages`);
    const row = owner.locator(`table tbody tr:has-text("${name}"):has-text("Portal sign-in")`).first();
    await row.waitFor({ timeout: 30000 });
    await row.locator("button:has-text('View')").click();
    await owner.waitForSelector("[data-testid=message-view]");
    const text = await owner.locator("[data-testid=message-view]").innerText();
    await owner.keyboard.press("Escape");
    assert(!/\/portal\/link\/[A-Za-z0-9_-]{43}/.test(text) && !/[A-Za-z0-9_-]{43}/.test(text), "staff never see the sign-in secret");
    assert(/Sign-in link – only in the email sent to the patient/.test(text), "the link is shown hidden");
    assert(!text.includes(s.shareTitle), "the email does not name the document");
    const token = crypto.randomBytes(32).toString("base64url");
    writeDb(
      "UPDATE pms_portal_links SET token_hash = ? WHERE tenant_id = ? AND id = (SELECT l.id FROM pms_portal_links l JOIN pms_portal_accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id JOIN pms_patients p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id WHERE l.tenant_id = ? AND l.used_at IS NULL AND (p.first_name || ' ' || p.last_name) = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 1)",
      crypto.createHash("sha256").update(token, "utf8").digest("hex"),
      CLINIC,
      CLINIC,
      name,
    );
    return `${PUB}/portal/link/${token}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  }
  const attachmentsUrl = () => `${BASE}/app/clinic/patients/${s.megan}/attachments`;
  const formsUrl = () => `${BASE}/app/clinic/patients/${s.megan}/forms`;

  try {
    await step("set-up: owner and reception (Jess) accounts with two-step; Megan Hart's record", async () => {
      s.ownerPassword = await onboard(owner, ownerInvite, OWNER_NAME);
      await onboard(jess, await invite(owner, `zz-polish-jess-${RUN}@example.com`, "staff"), "Jess Taylor (fictional)");
      s.megan = readDb("SELECT id FROM pms_patients WHERE tenant_id = ? AND import_ref = 'sim-pat-001'", CLINIC).id;
      assert(/^pat_/.test(s.megan), "Megan Hart's record");
    });

    await step("1. PORTAL-004: a clinician attaches a PDF and shares it with the patient (title, message, email with a portal link)", async () => {
      await owner.goto(attachmentsUrl());
      await owner.waitForSelector("#attachment-file");
      await owner.locator("#attachment-file").setInputFiles({ name: `Home exercise plan ${RUN}.pdf`, mimeType: "application/pdf", buffer: samplePdf() });
      await owner.fill("#attachment-description", "Home exercise plan (fictional)");
      await owner.click("button:has-text('Attach file')");
      const item = owner.locator(`li:has-text("Home exercise plan ${RUN}.pdf")`).first();
      await item.waitFor({ timeout: 30000 });
      await item.locator("summary:has-text('Share with the patient')").click();
      await item.locator("input[maxlength='120']").fill(s.shareTitle);
      await item.locator("textarea").fill("Three sets of ten, twice a day (fictional).");
      assert(await item.locator("label:has-text('Email the patient a link') input").isChecked(), "email ticked by default");
      await shot(owner, "1440-01-share-with-patient-form");
      // Only the sharing panel this module adds (the records module's page is checked by its own script).
      await axe(owner, "attachments – share with the patient (1440)", "main ul li");
      await item.locator("button[type=submit]:has-text('Share with the patient')").click();
      await owner.waitForSelector("text=/Shared\\. The patient gets an email/", { timeout: 30000 });
      await owner.waitForSelector(`text=/shared with the patient .* by ${OWNER_NAME.replace(/[()]/g, ".")}/`);
      const text = await item.innerText();
      assert(/not opened yet/.test(text), "not opened yet");
      await shot(owner, "1440-02-shared-who-when");
      const r = await jess.request.get(attachmentsUrl(), { maxRedirects: 0 });
      assert(r.status() === 404 || r.status() >= 300, `reception cannot open attachments: ${r.status()}`);
    });

    await step("2. the patient signs in from that email and sees the document; Download returns the PDF", async () => {
      const share = readDb("SELECT id FROM pms_portal_shares WHERE tenant_id = ? AND patient_id = ? ORDER BY shared_at DESC LIMIT 1", CLINIC, s.megan);
      const link = await signInLinkFor("Megan Hart", `/clinics/${CLINIC}/portal/documents/${share.id}`);
      assert(/next=/.test(link), "the link opens the document");
      await phone.goto(link);
      await phone.waitForSelector("h1:has-text('Sign in to your patient portal')");
      await phone.click("button:has-text('Sign in')");
      await phone.waitForSelector(`h1:has-text("${s.shareTitle}")`, { timeout: 30000 });
      s.docUrl = phone.url();
      const text = await phone.locator("main").innerText();
      assert(/Three sets of ten/.test(text) && /PDF document/.test(text), "message and the file's kind");
      await shot(phone, "375-03-shared-document");
      await axe(phone, "portal – shared document (375)");
      const href = await phone.locator("a:has-text('Download')").getAttribute("href");
      s.fileUrl = new URL(href, BASE).toString();
      const res = await phone.request.get(s.fileUrl);
      const body = await res.body();
      assert(res.status() === 200 && res.headers()["content-type"] === "application/pdf" && /attachment/.test(res.headers()["content-disposition"] || ""), `download ${res.status()} ${res.headers()["content-type"]}`);
      assert(body.slice(0, 5).toString() === "%PDF-", "a PDF");
      await phone.goto(`${PUB}/portal`);
      await phone.waitForSelector("text=Shared with you");
      assert((await phone.locator("main").innerText()).includes(s.shareTitle), "listed under Shared with you");
      await shot(phone, "375-04-portal-shared-with-you");
      const anon = await mk(375, 812);
      const denied = await anon.request.get(s.fileUrl);
      assert(denied.status() === 404, `not signed in: ${denied.status()}`);
      await anon.context().close();
    });

    await step("3. the record shows the patient opened it; Withdraw → the page and the file are gone for the patient", async () => {
      await owner.goto(attachmentsUrl());
      const row = owner.locator(`li:has-text("${s.shareTitle}")`).last();
      await row.waitFor();
      assert(/· opened [A-Z][a-z]{2} \d{2}\//.test(await row.innerText()), `opened: ${await row.innerText()}`);
      await row.locator("button:has-text('Withdraw')").click();
      await owner.waitForSelector("text=Withdrawn. The patient no longer sees it.");
      await owner.waitForSelector("text=/· withdrawn [A-Z][a-z]{2} \\d{2}\\//");
      await shot(owner, "1440-05-share-withdrawn");
      const page = await phone.request.get(s.docUrl);
      const file = await phone.request.get(s.fileUrl);
      assert(page.status() === 404 && file.status() === 404, `after withdrawal: page ${page.status()}, file ${file.status()}`);
      await phone.goto(`${PUB}/portal`);
      assert(!(await phone.locator("main").innerText()).includes(s.shareTitle), "no longer listed");
    });

    await step("4. FORM-007 + M10 H3: 'Complete in the clinic' → the staff screen shows a code → a separate, signed-out device enters it and shows ONLY that form", async () => {
      await owner.goto(formsUrl());
      await owner.waitForSelector("h2:has-text('Forms')");
      const button = owner.getByRole("button", { name: /Complete in the clinic – Health questionnaire/ }).first();
      await button.waitFor();
      await shot(owner, "1440-06-forms-tab-complete-in-clinic");
      await button.click();
      await owner.waitForURL(/\/app\/clinic\/intake\/device\/ihd_/, { timeout: 30000 });
      s.handoffUrl = owner.url();
      assert(!(await owner.context().cookies(`${PUB}/device`)).some((c) => c.name === "pms_device"), "nothing for the device in the staff browser");
      await owner.click("button:has-text('Show a code for the device')");
      const code = (await owner.locator("[data-testid=pairing-code]").innerText()).trim();
      assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `a pairing code: ${code}`);
      await shot(owner, "1440-06b-staff-pairing-code");
      await axe(owner, "hand-off – pairing code (1440)");
      // The clinic device: its own browser context, never signed in.
      const tabletCtx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
      s.tablet = watch(await tabletCtx.newPage());
      failPages.push(["tablet", s.tablet]);
      await s.tablet.goto(`${PUB}/device`);
      await s.tablet.waitForSelector("#dv-code");
      assert((await s.tablet.locator("a[href^='/app']").count()) === 0, "no staff links on the device");
      await shot(s.tablet, "820-06c-device-enter-code");
      await axe(s.tablet, "clinic device – enter code (820)");
      await s.tablet.fill("#dv-code", "ZZZZ-ZZZZ");
      await s.tablet.click("button:has-text('Show the form')");
      await s.tablet.waitForSelector("text=/That code is not right/");
      await s.tablet.fill("#dv-code", code.toLowerCase());
      await s.tablet.click("button:has-text('Show the form')");
      await s.tablet.waitForSelector("text=/Part 1 of/", { timeout: 30000 });
      const text = await s.tablet.locator("body").innerText();
      assert(!/Megan|Hart/.test(text), "no patient name on the device");
      assert((await s.tablet.locator("a[href^='/app']").count()) === 0, "no staff links on the device");
      assert(!/Clinic navigation|Patients|Diary/.test(await s.tablet.locator("body").innerText()), "no staff navigation");
      const staffCookies = (await tabletCtx.cookies(BASE)).filter((c) => /session|auth/i.test(c.name));
      assert(staffCookies.length === 0, `no staff session on the device: ${staffCookies.map((c) => c.name)}`);
      const into = await s.tablet.request.get(`${BASE}/app/clinic`, { maxRedirects: 0 });
      assert(into.status() >= 300 && into.status() < 400, `the device cannot open the staff app: ${into.status()}`);
      await shot(s.tablet, "820-07-device-form");
      await axe(s.tablet, "clinic device – form (820)");
      // The code worked once: another browser cannot use it.
      const other = await browser.newContext({ viewport: { width: 820, height: 1180 } });
      const op = await other.newPage();
      await op.goto(`${PUB}/device`);
      await op.fill("#dv-code", code);
      await op.click("button:has-text('Show the form')");
      await op.waitForSelector("text=/That code is not right/");
      await other.close();
    });

    await step("5. the patient fills it in on the device → the device locks on 'hand back to staff' (no link into the staff app)", async () => {
      const t = s.tablet;
      await t.fill("#q-problem", "Stiff right shoulder reaching overhead (fictional).");
      await t.locator("fieldset:has-text('When did it start?') label:has-text('2 to 6 weeks ago') input").check();
      await t.click("button:has-text('Continue')");
      await t.click("button:has-text('Send')");
      await t.waitForSelector("h1:has-text('Thank you – your form has been sent')", { timeout: 30000 });
      assert(/hand the device back to a member of staff/.test(await t.locator("main").innerText()), "hand back");
      assert((await t.locator("a[href^='/app']").count()) === 0, "no link into the staff app");
      await shot(t, "820-08-device-hand-back");
      await axe(t, "clinic device – hand back (820)");
      await t.goBack().catch(() => {});
      await t.goto(`${PUB}/device`);
      assert(!(await t.locator("#q-problem").count()), "the form is not shown again");
    });

    await step("6. staff verify on THEIR screen: a wrong password is refused; their password → 'Completed in the clinic, verified by …'", async () => {
      await owner.goto(s.handoffUrl);
      await owner.waitForSelector("text=Check it was the right patient", { timeout: 30000 });
      assert(/Megan Hart/.test(await owner.locator("main").innerText()), "the staff page names the patient");
      await owner.fill("#ho-pw", "not-the-password");
      await owner.click("button:has-text('Verify and finish')");
      await owner.waitForSelector("text=That password is not right.");
      await shot(owner, "1440-09-verify-wrong-password");
      await axe(owner, "hand-off verify (1440)");
      await owner.fill("#ho-pw", s.ownerPassword);
      await owner.click("button:has-text('Verify and finish')");
      await owner.waitForSelector(`text=/Completed in the clinic, verified by ${OWNER_NAME.replace(/[()]/g, ".")}/`, { timeout: 30000 });
      s.copyUrl = owner.url();
      await owner.waitForSelector("text=Completed and sealed.");
      const text = await owner.locator("main").innerText();
      assert(new RegExp(`Completed in the clinic, verified by ${OWNER_NAME.replace(/[()]/g, ".")}`).test(text) && /Stiff right shoulder/.test(text), "verified line and the answers");
      await shot(owner, "1440-10-signed-copy-verified-in-clinic");
      await axe(owner, "signed copy – verified in the clinic (1440)");
      const h = readDb("SELECT status, verified_by, completed_at, verified_at FROM pms_intake_handoffs WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC LIMIT 1", CLINIC, s.megan);
      assert(h && h.status === "verified" && h.verified_by && h.completed_at && h.verified_at, `hand-off row ${JSON.stringify(h)}`);
      const a = readDb("SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND action = 'pms.intake_response.verify'", CLINIC);
      assert(a.n === 1, `one verify audit row: ${a.n}`);
      await s.tablet.goto(`${PUB}/device`);
      await s.tablet.waitForSelector("h1:has-text('All done')");
      await jess.goto(formsUrl());
      await jess.waitForSelector("text=Completed in the clinic, verified");
    });

    await step("7. Download PDF of the sealed copy: application/pdf with a %PDF header (clinician and reception)", async () => {
      const href = await owner.locator("a:has-text('Download PDF')").getAttribute("href");
      for (const [who, page] of [
        ["owner", owner],
        ["reception", jess],
      ]) {
        const res = await page.request.get(new URL(href, BASE).toString());
        const body = await res.body();
        assert(res.status() === 200 && res.headers()["content-type"] === "application/pdf" && /attachment; filename=".+\.pdf"/.test(res.headers()["content-disposition"] || ""), `${who}: ${res.status()} ${res.headers()["content-type"]}`);
        assert(body.slice(0, 5).toString() === "%PDF-" && body.length > 1500, `${who}: a PDF`);
        fs.writeFileSync(path.join(OUT, `signed-copy-${who}.pdf`), body);
      }
      const other = await phone.request.get(new URL(href, BASE).toString(), { maxRedirects: 0 });
      assert(other.status() !== 200, `the patient's browser cannot fetch the staff PDF: ${other.status()}`);
      await jess.goto(s.copyUrl);
      await jess.waitForSelector("text=/health answers? (is|are) only shown to clinicians/");
      await shot(jess, "1440-11-signed-copy-reception");
    });

    await step("8. Preview as patient in the builder: the patient's form (unsaved wording included), nothing can be sent", async () => {
      await owner.goto(`${BASE}/app/clinic/intake`);
      await owner.locator("a:has-text('Health questionnaire')").first().click();
      await owner.waitForSelector("button[aria-pressed=true]:has-text('Clinical')");
      const label = owner.locator("#q-label-1");
      const original = await label.inputValue();
      await label.fill(`${original} (preview ${RUN})`);
      await owner.click("button:has-text('Preview as patient')");
      const dialog = owner.locator("[role=dialog]");
      await dialog.waitFor();
      const preview = dialog.locator("[data-testid=patient-preview]");
      await preview.waitFor();
      const text = await preview.innerText();
      assert(/Preview – this is what the patient sees/.test(text) && /Part 1 of/.test(text), "preview banner and parts");
      assert(text.includes(`(preview ${RUN})`), "unsaved wording shown");
      assert(/Only your physiotherapist sees these answers/.test(text), "the clinical note the patient sees");
      await shot(owner, "1440-12-preview-as-patient", false);
      await axe(owner, "preview as patient (1440)");
      for (let i = 0; i < 6; i++) {
        const next = preview.locator("button:has-text('Continue')");
        if (!(await next.count())) break;
        await next.click();
      }
      const send = preview.locator("button[type=submit]");
      assert(await send.isDisabled(), "the last button cannot send");
      await shot(owner, "1440-13-preview-last-part", false);
      await owner.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      const r = await jess.request.get(`${BASE}/app/clinic/intake`, { maxRedirects: 0 });
      assert(r.status() === 404 || r.status() >= 300, `reception cannot open the builder: ${r.status()}`);
    });
  } finally {
    const failed = results.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, "axe-polish-portal.json"), JSON.stringify(axeReport, null, 2));
    if (problems.length) console.log(`browser problems (${problems.length}):\n  ${problems.slice(0, 10).join("\n  ")}`);
    console.log(`\n${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
  }
})();
