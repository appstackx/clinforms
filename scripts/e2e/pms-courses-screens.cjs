/**
 * Browser check of the billing screens for COURSES, GIFT CARDS and PRODUCTS (PK02/PK04/PK05, LOCAL only):
 * Set-up → Courses (add 6 sessions / £300 / 90 days, change, switch off), Set-up → Products (SKU, low-stock level);
 * the patient's Invoices tab (sell a course: draft then issue, "0 of 6 used · expires dd/mm/yyyy"; sell a gift card –
 * code shown once; sell a product from a site); Invoice attended visits with "Use course (N of M left)" ticked by
 * default (the visit leaves the unbilled list, the course reads 1 of 6 used; Reverse puts the visit back); Take
 * payment → Gift card (a wrong code refused, the balance drops, the billing home's "Taken today"); Billing → Gift
 * cards (list, look-up by code – the code is never in a URL or any request URL); Billing → Stock (receive, sale,
 * adjust with a reason, low-stock flag); cancelling a course with a part credit (credit note on its invoice);
 * reception and a clinician (read-only); 375 px for the Invoices tab and Take payment; axe on each new screen;
 * console errors and failed requests on every page are findings.
 *
 *   CLINFORMS_DB=sqlite CLINFORMS_SQLITE_PATH=<scratch db> npm run db:migrate
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3466 > seed.out   (same scratch SQLite)
 *   node scripts/e2e/stripe-test-stub.cjs 3467 &                                  (the provider's TEST stand-in)
 *   next start -p 3466 (same env, CLINIC_PAYMENTS_PROVIDER=stripe_test, CLINIC_STRIPE_TEST_API_BASE=http://127.0.0.1:3467/v1)
 *   SEED_LOG=seed.out BASE=http://localhost:3466 E2E_OUT=<dir> \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-courses-screens.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed: passwords, TOTP keys and gift card codes stay in
 * memory; findings.json never contains a code.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3466";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-courses");
const SEED_LOG = process.env.SEED_LOG;
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const CLINIC = `${BASE}/app/clinic`;
const BILLING = `${CLINIC}/billing`;
const SETUP = `${CLINIC}/setup`;

/* ------------------------------------------------------------------ two-step helpers */
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

/* ------------------------------------------------------------------ results and findings */
const results = [];
const findings = [];
const failPages = [];
const secrets = new Set(); // gift card codes – scrubbed from anything written out
const scrub = (t) => {
  let s = String(t);
  for (const c of secrets) {
    s = s.split(c).join("<code>");
    s = s.split(c.replace(/-/g, "")).join("<code>");
  }
  return s;
};
let current = "";
function finding(screen, steps, expected, actual, screenshot = null, severity = "bug") {
  findings.push({ severity, screen, steps, expected: scrub(expected), actual: scrub(actual), screenshot });
}
class Abort extends Error {}
async function step(name, screen, fn, { required = false } = {}) {
  const t = Date.now();
  current = name;
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    const msg = scrub(String(err && err.message).slice(0, 900));
    const shots = [];
    for (const [who, page] of failPages) {
      const p = path.join(OUT, `fail-${results.length + 1}-${who}.png`);
      if (await page.screenshot({ path: p }).then(() => true, () => false)) shots.push(p);
    }
    results.push({ name, ok: false, error: msg });
    finding(screen, name, "the step passes", msg, shots.join(", ") || null, "step-failed");
    console.log(`FAIL ${name}: ${msg}`);
    if (required) throw new Abort(`stopped: "${name}" is needed by the later steps`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const pounds = (text) => Number(String(text).replace(/[£,\s]/g, "").replace(/^−/, "-"));
/** dd/mm/yyyy for today + n days in London. */
function ukDatePlus(days) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ accounts */
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

/* ------------------------------------------------------------------ axe */
const axeReport = [];
async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, target: v.nodes[0] && v.nodes[0].target.join(" "), html: v.nodes[0] && v.nodes[0].html.slice(0, 160) }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeReport.push({ label, url: page.url(), found });
  if (bad.length) {
    const shotPath = path.join(OUT, `axe-${label.replace(/[^a-z0-9]+/gi, "-")}.png`);
    await page.screenshot({ path: shotPath }).catch(() => {});
    for (const v of bad) finding(label, `axe on ${label}`, "no serious/critical WCAG 2.x AA violations", `${v.impact} ${v.id} (${v.n} node${v.n === 1 ? "" : "s"}): ${v.help} – ${v.target} ${v.html}`, shotPath, "a11y");
  }
  return bad.length;
}

const toastText = (page, re, timeout = 20000) => page.waitForSelector(`[role=status] >> text=${re}`, { timeout });

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const requestUrls = []; // every request URL (checked for gift card codes)
  const navUrls = [];
  const expected404 = new Set(); // URLs a step expects to fail (role checks)
  const mk = async (who, width = 1440, height = 1000) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => finding(page.url().replace(BASE, ""), current, "no uncaught page errors", `pageerror (${who}): ${String(e).slice(0, 300)}`, null, "console"));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/Failed to fetch RSC payload .* Falling back to browser navigation/.test(t)) return;
      if (/Failed to load resource: the server responded with a status of 404/.test(t) && [...expected404].some((u) => page.url().startsWith(u))) return;
      finding(page.url().replace(BASE, ""), current, "no console errors", `console.error (${who}): ${t.slice(0, 300)}`, null, "console");
    });
    page.on("request", (r) => requestUrls.push(r.url()));
    page.on("framenavigated", (f) => f === page.mainFrame() && navUrls.push(f.url()));
    page.on("requestfailed", (r) => {
      const err = (r.failure() && r.failure().errorText) || "";
      // A navigation cancels in-flight prefetches (net::ERR_ABORTED) – not a finding.
      if (/ERR_ABORTED/.test(err)) return;
      finding(page.url().replace(BASE, ""), current, "no failed network requests", `${r.method()} ${r.url().replace(BASE, "")} failed: ${err} (${who})`, null, "network");
    });
    page.on("response", (r) => {
      const st = r.status();
      if (st < 400) return;
      const u = r.url();
      if ([...expected404].some((x) => u.startsWith(x))) return;
      if (/favicon/.test(u)) return;
      finding(page.url().replace(BASE, ""), current, "no failed network requests", `${r.request().method()} ${u.replace(BASE, "")} → ${st} (${who})`, null, "network");
    });
    const settle = () => page.waitForFunction(() => !document.querySelector("[data-testid=section-loading]"), null, { timeout: 30000 }).catch(() => {});
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...a) => { const r = await goto(...a); await settle(); return r; };
    page.reload = async (...a) => { const r = await reload(...a); await settle(); return r; };
    return page;
  };
  const owner = await mk("owner");
  const reception = await mk("reception");
  const clinician = await mk("clinician");
  failPages.push(["owner", owner], ["reception", reception], ["clinician", clinician]);
  const shot = async (page, name, fullPage = false) => {
    const p = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: p, fullPage });
    return p;
  };
  const COURSE = `6 follow-ups (e2e ${RUN})`;
  const COURSE_EDITED = `6 follow-ups block (e2e ${RUN})`;
  const COURSE_OFF = `3 massages (e2e ${RUN})`;
  const PRODUCT = `Kinesiology tape (e2e ${RUN})`;
  const SKU = `KT-${RUN.toUpperCase()}`;
  const s = { patientId: null, patientName: null, appt: null, courseId: null, saleInvoiceId: null, code: null, siteId: null, siteName: null, takenBefore: null };
  const patientInvoices = () => `${CLINIC}/patients/${s.patientId}/invoices`;
  const courseCard = (page) => page.locator("[data-testid=course-card]", { hasText: COURSE_EDITED }).first();

  try {
    await step("owner, reception (staff) and clinician accounts (two-step on)", "accounts", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-course-reception-${RUN}@example.com`, "staff");
      const c = await invite(owner, `zz-course-clinician-${RUN}@example.com`, "clinician");
      await onboard(reception, r, "Jess Taylor (fictional)");
      await onboard(clinician, c, "Priya Shah (fictional)");
    }, { required: true });

    /* ---------------------------------------------------------------- Set-up → Courses */
    await step("Set-up → Courses: add a course (6 sessions, £300, valid 90 days, all services)", "Set-up → Courses", async () => {
      await owner.goto(`${SETUP}/courses`);
      await owner.waitForSelector("h1:has-text('Courses')");
      const nav = await owner.locator("nav a").allInnerTexts();
      if (!nav.some((t) => /^Courses$/.test(t.trim()))) finding("Set-up → Courses", "owner opens the clinic area", "Courses in the Set-up/manage navigation", `nav links: ${nav.map((t) => t.trim()).filter(Boolean).join(", ").slice(0, 300)}`, null, "observation");
      await shot(owner, "1440-setup-courses-empty");
      await axe(owner, "Set-up Courses (empty)");
      await owner.click("[data-testid=add-course]");
      await owner.waitForSelector("[data-testid=course-type-form]");
      await owner.fill("#course-name", COURSE);
      await owner.fill("#course-sessions", "6");
      await owner.fill("#course-price", "300.00");
      await owner.fill("#course-valid", "90");
      const boxes = owner.locator("[data-testid=course-form] input[type=checkbox], [data-testid=course-type-form] input[type=checkbox]");
      const n = await boxes.count();
      assert(n > 0, "services to tick");
      for (let i = 0; i < n; i++) await boxes.nth(i).check();
      await shot(owner, "1440-setup-course-form");
      await axe(owner, "Set-up Courses (form)");
      await owner.click("[data-testid=course-save]");
      await owner.waitForSelector(`[data-testid=course-type-row]:has-text("${COURSE}")`, { timeout: 20000 });
      const row = await owner.locator(`[data-testid=course-type-row]:has-text("${COURSE}")`).innerText();
      assert(/6 sessions/.test(row) && /valid 90 days/.test(row) && /£300\.00/.test(row), `row: ${row}`);
    });

    await step("Set-up → Courses: change the course's name; add a second one and switch it off", "Set-up → Courses", async () => {
      await owner.locator(`[data-testid=course-type-row]:has-text("${COURSE}") a:has-text('Change')`).click();
      await owner.waitForSelector("[data-testid=course-type-form]");
      assert((await owner.inputValue("#course-price")) === "300.00", "price prefilled");
      await owner.fill("#course-name", COURSE_EDITED);
      await owner.click("[data-testid=course-save]");
      await owner.waitForSelector(`[data-testid=course-type-row]:has-text("${COURSE_EDITED}")`, { timeout: 20000 });
      // Second course → switch off.
      await owner.click("[data-testid=add-course]");
      await owner.waitForSelector("[data-testid=course-type-form]");
      await owner.fill("#course-name", COURSE_OFF);
      await owner.fill("#course-sessions", "3");
      await owner.fill("#course-price", "150.00");
      await owner.fill("#course-valid", "");
      await owner.locator("[data-testid=course-type-form] input[type=checkbox]").first().check();
      await owner.click("[data-testid=course-save]");
      await owner.waitForSelector(`[data-testid=course-type-row]:has-text("${COURSE_OFF}")`, { timeout: 20000 });
      assert(/no expiry/.test(await owner.locator(`[data-testid=course-type-row]:has-text("${COURSE_OFF}")`).innerText()), "no expiry");
      await owner.locator(`[data-testid=course-type-row]:has-text("${COURSE_OFF}") a:has-text('Change')`).click();
      await owner.waitForSelector("#course-active");
      await owner.click("#course-active");
      assert((await owner.getAttribute("#course-active", "aria-checked")) === "false", "switched off");
      await owner.click("[data-testid=course-save]");
      await owner.waitForSelector(`[data-testid=course-type-row]:has-text("${COURSE_OFF} (switched off)")`, { timeout: 20000 });
      await shot(owner, "1440-setup-courses");
      await axe(owner, "Set-up Courses (list)");
    });

    /* ---------------------------------------------------------------- Set-up → Products */
    await step("Set-up → Products: add a product with SKU, price £12.50 and low-stock level 3", "Set-up → Products", async () => {
      await owner.goto(`${SETUP}/products`);
      await owner.waitForSelector("h1:has-text('Products')");
      await owner.click("[data-testid=add-product]");
      await owner.waitForSelector("[data-testid=product-form]");
      await owner.fill("#product-name", PRODUCT);
      await owner.fill("#product-sku", SKU);
      await owner.fill("#product-price", "12.50");
      await owner.fill("#product-low", "3");
      await axe(owner, "Set-up Products (form)");
      await owner.click("[data-testid=product-save]");
      await owner.waitForSelector(`[data-testid=product-row]:has-text("${PRODUCT}")`, { timeout: 20000 });
      const row = await owner.locator(`[data-testid=product-row]:has-text("${PRODUCT}")`).innerText();
      assert(row.includes(SKU) && /£12\.50/.test(row) && /\b3\b/.test(row), `row: ${row}`);
      await shot(owner, "1440-setup-products");
      await axe(owner, "Set-up Products (list)");
    });

    /* ---------------------------------------------------------------- pick a patient with an unbilled self-pay visit */
    await step("pick a patient with a completed self-pay visit to invoice", "Billing → Invoice attended visits", async () => {
      await reception.goto(`${BILLING}/visits`);
      await reception.waitForSelector("[data-testid=visits-table]");
      const rows = await reception.locator("[data-testid=visits-table] tbody tr[data-bill-to=patient]").evaluateAll((trs) =>
        trs.filter((tr) => /Completed/.test(tr.innerText)).map((tr) => ({ appt: tr.getAttribute("data-appointment"), patientId: tr.getAttribute("data-patient"), hasCourse: !!tr.querySelector("[data-testid=use-course]") })),
      );
      const free = rows.filter((r) => !r.hasCourse);
      assert(free.length > 0, `self-pay completed visits: ${rows.length}`);
      // The patient with the fewest such visits (one is enough), so the course offer is easy to read.
      const counts = new Map();
      for (const r of free) counts.set(r.patientId, (counts.get(r.patientId) || 0) + 1);
      const pick = free.slice().sort((a, b) => counts.get(a.patientId) - counts.get(b.patientId))[0];
      s.patientId = pick.patientId;
      s.appt = pick.appt;
    }, { required: true });

    /* ---------------------------------------------------------------- sell a course */
    await step("patient Invoices tab: Sell a course as a draft (pending notice), then issue the invoice → '0 of 6 used · expires dd/mm/yyyy'", "Patient → Invoices (courses)", async () => {
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=patient-courses]");
      s.patientName = (await reception.locator("h1").first().innerText()).trim();
      await reception.click("[data-testid=sell-course]");
      await reception.waitForSelector("[data-testid=sell-course-form]");
      const options = await reception.locator("[data-testid=sell-course-type] option").allInnerTexts();
      assert(options.some((o) => o.includes(COURSE_EDITED)), `on sale: ${options.join(" | ")}`);
      if (options.some((o) => o.includes(COURSE_OFF))) finding("Patient → Invoices (Sell a course)", "Set-up: switch a course off; open Sell a course", "a switched-off course is not offered", `offered: ${options.join(" | ")}`);
      await reception.selectOption("[data-testid=sell-course-type]", { label: options.find((o) => o.includes(COURSE_EDITED)) });
      const siteSel = reception.locator("#sell-course-site");
      if (await siteSel.count()) {
        const v = await siteSel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
        if (v.length) await siteSel.selectOption(v[0]);
      }
      await shot(reception, "1440-sell-course-form");
      await axe(reception, "Sell a course form");
      await reception.click("[data-testid=sell-course-draft]");
      await reception.waitForURL(/\/billing\/invoices\//, { timeout: 20000 });
      s.saleInvoiceId = (reception.url().match(/\/invoices\/([^/?#]+)/) || [])[1];
      await reception.waitForSelector("[data-testid=issue-invoice]", { timeout: 30000 });
      const body = await reception.locator("main").innerText();
      assert(body.includes(COURSE_EDITED) && /300\.00/.test(body), "the draft carries the course line");
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=course-pending]");
      assert((await reception.locator("[data-testid=course-pending]").innerText()).includes(COURSE_EDITED), "pending notice");
      // Issue the draft.
      await reception.goto(`${BILLING}/invoices/${s.saleInvoiceId}`);
      await reception.click("[data-testid=issue-invoice]");
      await reception.click("role=alertdialog >> button:has-text('Issue invoice')");
      await toastText(reception, "Invoice issued");
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=course-card]");
      const progress = (await courseCard(reception).locator("[data-testid=course-progress]").innerText()).trim();
      // "valid 90 days" counts the sale day (docs: expiry = sale date + N − 1).
      const want = `0 of 6 used · expires ${ukDatePlus(89)}`;
      assert(progress === want, `progress "${progress}" (expected "${want}")`);
      s.courseId = await courseCard(reception).getAttribute("data-course");
      const intro = await reception.locator("#courses-heading + p").innerText();
      if (/active courses? Visits/.test(intro)) finding("Patient → Invoices (Courses)", "sell and issue a course; read the Courses intro line", "two sentences: '1 active course. Visits a course covers …'", `"${intro}" (no full stop after the count)`, await shot(reception, "finding-courses-intro"), "copy");
      await shot(reception, "1440-patient-invoices-course", true);
      await axe(reception, "Patient Invoices tab (course)");
    }, { required: true });

    /* ---------------------------------------------------------------- use the course from Invoice attended visits */
    await step("Invoice attended visits: 'Use course (6 of 6 left)' ticked by default; after saving the visit leaves the list and the course reads 1 of 6 used", "Billing → Invoice attended visits", async () => {
      await reception.goto(`${BILLING}/visits`);
      await reception.waitForSelector("[data-testid=visits-table]");
      const row = reception.locator(`[data-appointment="${s.appt}"]`);
      assert((await row.count()) === 1, "the visit is still unbilled");
      const box = row.locator("[data-testid=use-course]");
      assert((await box.count()) === 1, "a Use course box on the patient's visit");
      assert(await box.isChecked(), "ticked by default");
      const label = (await row.locator("label:has([data-testid=use-course])").innerText()).trim();
      const m = label.match(/^Use course \((\d+) of (\d+) left\)$/);
      assert(m && m[2] === "6", `label "${label}"`);
      assert(/line-through/.test((await row.locator(".line-through").first().getAttribute("class").catch(() => "")) || ""), "the price is struck through");
      await reception.uncheck("input[aria-label='Select all visits']");
      await reception.check(`[data-appointment="${s.appt}"] input[type=checkbox]:not([data-testid=use-course])`);
      const summary = await reception.locator("[data-testid=visits-summary]").innerText();
      assert(/^1 visit selected → 0 invoices · 1 from courses/.test(summary), `summary: ${summary}`);
      await shot(reception, "1440-visits-use-course");
      await axe(reception, "Invoice attended visits (course offer)");
      await reception.click("button:has-text('Preview drafts')");
      await reception.waitForSelector("[data-testid=course-preview]");
      await shot(reception, "1440-visits-use-course-preview");
      await reception.click("button:has-text('Create drafts')");
      await reception.waitForSelector("[data-testid=visits-done]", { timeout: 20000 });
      const done = await reception.locator("[data-testid=visits-done]").innerText();
      assert(/1 visit used from courses/.test(done), `done: ${done}`);
      await reception.goto(`${BILLING}/visits`);
      await reception.waitForSelector("[data-testid=visits-table], text=Nothing to invoice", { timeout: 20000 }).catch(() => {});
      assert((await reception.locator(`[data-appointment="${s.appt}"]`).count()) === 0, "the visit left the unbilled list");
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=course-card]");
      const progress = await courseCard(reception).locator("[data-testid=course-progress]").innerText();
      assert(/^1 of 6 used/.test(progress.trim()), `progress: ${progress}`);
    });

    await step("Reverse the course use → the visit is back in the unbilled list, the course 0 of 6 used", "Patient → Invoices (courses)", async () => {
      const card = courseCard(reception);
      await card.locator("button:has-text('Reverse')").first().click();
      await toastText(reception, "Visit put back");
      await reception.waitForFunction((name) => {
        const c = [...document.querySelectorAll("[data-testid=course-card]")].find((e) => e.textContent.includes(name));
        return c && /^0 of 6 used/.test(c.querySelector("[data-testid=course-progress]").textContent.trim());
      }, COURSE_EDITED, { timeout: 20000 });
      assert(/put back/.test(await card.innerText()), "the use reads put back");
      await reception.goto(`${BILLING}/visits`);
      await reception.waitForSelector("[data-testid=visits-table]");
      assert((await reception.locator(`[data-appointment="${s.appt}"]`).count()) === 1, "the visit is back");
      const label = await reception.locator(`[data-appointment="${s.appt}"] label:has([data-testid=use-course])`).innerText().catch(() => "");
      assert(/Use course \(6 of 6 left\)/.test(label), `offer again: ${label}`);
      // Use it again (and issue) – the course then reads 1 of 6 for the cancel step.
      await reception.uncheck("input[aria-label='Select all visits']");
      await reception.check(`[data-appointment="${s.appt}"] input[type=checkbox]:not([data-testid=use-course])`);
      await reception.click("button:has-text('Preview drafts')");
      await reception.click("button:has-text('Create and issue')");
      await reception.waitForSelector("[data-testid=visits-done]", { timeout: 20000 });
    });

    /* ---------------------------------------------------------------- gift card */
    await step("Sell a gift card (£50, issued): the code is shown once; reload → not shown again", "Patient → Invoices (gift cards)", async () => {
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=patient-gift-cards]");
      await reception.click("[data-testid=sell-gift-card]");
      await reception.waitForSelector("[data-testid=sell-gift-card-form]");
      await reception.fill("[data-testid=gift-amount]", "50.00");
      await reception.fill("#gift-recipient", "Sam Lee (fictional)");
      const siteSel = reception.locator("#gift-site");
      if (await siteSel.count()) {
        const v = await siteSel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
        if (v.length) await siteSel.selectOption(v[0]);
      }
      await axe(reception, "Sell a gift card form");
      await reception.click("[data-testid=sell-gift-card-issue]");
      await reception.waitForSelector("[data-testid=gift-card-code-once]", { timeout: 20000 });
      const code = (await reception.locator("[data-testid=gift-card-code-once]").innerText()).trim();
      assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), "code format XXXX-XXXX-XXXX");
      secrets.add(code);
      s.code = code;
      // Screenshot with the code blurred out (no code on disk).
      await reception.addStyleTag({ content: "[data-testid=gift-card-code-once]{filter:blur(8px)}" });
      await shot(reception, "1440-gift-card-sold-code-blurred");
      await reception.reload();
      await reception.waitForSelector("[data-testid=patient-gift-cards]");
      assert((await reception.locator("[data-testid=gift-card-code-once]").count()) === 0, "not shown again after reload");
      const body = await reception.locator("main").innerText();
      assert(!body.includes(code), "the full code appears nowhere on the page after reload");
      const row = await reception.locator("[data-testid=patient-gift-cards] [data-testid=gift-cards-table] tbody tr").first().innerText();
      assert(/£50\.00/.test(row), `card row: ${row}`);
    });

    /* ---------------------------------------------------------------- product sale + stock */
    await step("Billing → Stock: receive 5 of the product at a site", "Billing → Stock", async () => {
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=sell-product-section]");
      await reception.click("[data-testid=sell-product]");
      const opts = await reception.locator("#sell-product-site option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })).filter((o) => o.v));
      assert(opts.length > 0, "a site to sell from");
      s.siteId = opts[0].v;
      s.siteName = opts[0].t.trim();
      await reception.click("[data-testid=sell-product-form] button:has-text('Cancel')");
      await owner.goto(`${BILLING}/stock?site=${s.siteId}`);
      await owner.waitForSelector("[data-testid=stock-table]");
      const row = owner.locator("[data-testid=stock-row]", { hasText: PRODUCT });
      assert((await row.count()) === 1, "product listed");
      assert(/^0\b/.test((await row.locator("td").nth(1).innerText()).trim()), "0 on hand at first");
      await owner.selectOption("#stock-product", { label: PRODUCT });
      await owner.selectOption("#stock-kind", "received");
      await owner.fill("[data-testid=stock-qty]", "5");
      await owner.click("[data-testid=stock-save]");
      await toastText(owner, "5 received");
      await owner.waitForFunction((p) => {
        const r = [...document.querySelectorAll("[data-testid=stock-row]")].find((e) => e.textContent.includes(p));
        return r && r.querySelectorAll("td")[1].textContent.trim().startsWith("5");
      }, PRODUCT, { timeout: 20000 });
      await shot(owner, "1440-stock-received");
      await axe(owner, "Billing Stock");
    });

    await step("patient Invoices tab: sell 1 of the product from the site (issued) → stock 4", "Patient → Invoices (products)", async () => {
      await reception.goto(patientInvoices());
      await reception.click("[data-testid=sell-product]");
      await reception.waitForSelector("[data-testid=sell-product-form]");
      const label = (await reception.locator("[data-testid=sell-product-id] option").allInnerTexts()).find((o) => o.includes(PRODUCT));
      assert(label, "product offered");
      await reception.selectOption("[data-testid=sell-product-id]", { label });
      await reception.fill("#sell-product-qty", "1");
      await reception.selectOption("#sell-product-site", s.siteId);
      await axe(reception, "Sell a product form");
      await reception.click("[data-testid=sell-product-issue]");
      await toastText(reception, "stock taken off");
      await owner.goto(`${BILLING}/stock?site=${s.siteId}`);
      const onHand = (await owner.locator("[data-testid=stock-row]", { hasText: PRODUCT }).locator("td").nth(1).innerText()).trim();
      assert(/^4\b/.test(onHand), `on hand after the sale: ${onHand}`);
      assert(!/low/.test(onHand), "not low at 4");
    });

    await step("Billing → Stock: adjust −1 needs a reason; with one → 3 on hand, flagged (low)", "Billing → Stock", async () => {
      await owner.selectOption("#stock-product", { label: PRODUCT });
      await owner.selectOption("#stock-kind", "adjusted");
      await owner.fill("[data-testid=stock-qty]", "-1");
      await owner.fill("#stock-reason", "");
      await owner.click("[data-testid=stock-save]");
      const refused = await owner.waitForSelector("[data-testid=stock-change-form] [role=alert]", { timeout: 10000 }).then(() => true, () => false);
      if (!refused) finding("Billing → Stock", "Adjust −1 with no reason → Save", "refused with a message asking for a reason", "no error shown", await shot(owner, "finding-stock-no-reason"));
      await owner.fill("#stock-reason", "Damaged roll (fictional)");
      await owner.click("[data-testid=stock-save]");
      await toastText(owner, "Stock adjusted by -1");
      await owner.waitForFunction((p) => {
        const r = [...document.querySelectorAll("[data-testid=stock-row]")].find((e) => e.textContent.includes(p));
        return r && /^3\s*\(low\)/.test(r.querySelectorAll("td")[1].textContent.trim());
      }, PRODUCT, { timeout: 20000 });
      const moves = await owner.locator("#moves-heading + ul").innerText();
      assert(/\+5/.test(moves) && /-1/.test(moves), `moves: ${moves}`);
      await shot(owner, "1440-stock-low", true);
    });

    /* ---------------------------------------------------------------- take payment with a gift card */
    await step("Take payment → Gift card: a wrong code is refused; the right code pays £20; card balance £30; 'Taken today' unchanged (the card's money was taken when it was sold)", "Take payment (gift card)", async () => {
      await owner.goto(BILLING);
      await owner.waitForSelector("[data-testid=billing-figures]");
      const fig = async () => pounds((await owner.locator("[data-testid=billing-figures] > *", { hasText: "Taken today" }).innerText()).match(/£[\d,]+\.\d\d/)[0]);
      s.takenBefore = await fig();
      await reception.goto(`${patientInvoices()}?pay=1`);
      await reception.waitForSelector("[data-testid=take-payment] >> text=Method");
      await reception.waitForSelector("[data-testid=take-payment-submit]:not([disabled])");
      await reception.click("[data-testid=take-payment] label:has-text('Part payment')");
      await reception.fill("[data-testid=part-amount]", "20.00");
      await reception.click("[data-testid=take-payment] label:has-text('Gift card')");
      await reception.waitForSelector("[data-testid=gift-card-code]");
      await axe(reception, "Take payment (gift card)");
      await shot(reception, "1440-take-payment-gift-card");
      // A wrong code (same shape) is refused.
      const wrong = s.code.slice(0, -1) + (s.code.endsWith("A") ? "B" : "A");
      await reception.fill("[data-testid=gift-card-code]", wrong);
      await reception.click("[data-testid=take-payment-submit]");
      const err = await reception.waitForSelector("[data-testid=take-payment] [role=alert]", { timeout: 15000 }).then((e) => e.innerText(), () => null);
      assert(err, "a wrong code shows an error");
      assert((await reception.locator("[data-testid=take-payment-done]").count()) === 0, "nothing recorded with the wrong code");
      await reception.fill("[data-testid=gift-card-code]", s.code);
      await reception.click("[data-testid=take-payment-submit]");
      await reception.waitForSelector("[data-testid=take-payment-done]", { timeout: 20000 });
      await reception.click("[data-testid=take-payment] button:has-text('Done')");
      // Gift cards: look-up by code.
      await reception.goto(`${BILLING}/gift-cards`);
      await reception.waitForSelector("[data-testid=gift-lookup]");
      await reception.fill("[data-testid=gift-lookup]", s.code);
      await reception.click("button:has-text('Look up')");
      await reception.waitForSelector("[data-testid=gift-card-detail]", { timeout: 20000 });
      assert(/\?card=/.test(reception.url()), "the card's id in the URL");
      const detail = await reception.locator("[data-testid=gift-card-detail]").innerText();
      assert(/£30\.00/.test(detail), `balance after £20: ${detail.slice(0, 300)}`);
      assert(/−£20\.00/.test(detail), "the spend in the history");
      await owner.goto(BILLING);
      await owner.waitForSelector("[data-testid=billing-figures]");
      const after = await fig();
      // Review fix 5: a gift-card spend is not money taken (it was counted when the card was sold).
      assert(Math.abs(after - s.takenBefore) < 0.001, `Taken today ${s.takenBefore} → ${after} (a gift-card spend must not count)`);
    });

    await step("Billing → Gift cards: list, wrong code refused, lookup shows history; the code is never in a URL or request URL", "Billing → Gift cards", async () => {
      await reception.goto(`${BILLING}/gift-cards`);
      await reception.waitForSelector("[data-testid=gift-cards-table]");
      const rows = await reception.locator("[data-testid=gift-cards-table] tbody tr").allInnerTexts();
      assert(rows.some((r) => /£30\.00/.test(r)), `listed: ${rows.length}`);
      assert(!rows.join("\n").includes(s.code), "list shows masked codes only");
      await shot(reception, "1440-gift-cards");
      await axe(reception, "Billing Gift cards (list)");
      await reception.fill("[data-testid=gift-lookup]", "ZZZZ-ZZZZ-ZZZZ");
      await reception.click("button:has-text('Look up')");
      await reception.waitForSelector("#gift-lookup-error, form [role=alert]", { timeout: 15000 });
      await reception.fill("[data-testid=gift-lookup]", s.code);
      await reception.click("button:has-text('Look up')");
      await reception.waitForSelector("[data-testid=gift-card-detail]");
      await shot(reception, "1440-gift-card-detail");
      await axe(reception, "Billing Gift cards (detail)");
      // Also the clinician (read-only) can look one up? Record what happens.
      const bare = s.code.replace(/-/g, "");
      const badNav = navUrls.filter((u) => u.includes(s.code) || u.includes(bare));
      const badReq = requestUrls.filter((u) => u.includes(s.code) || u.includes(bare) || decodeURIComponent(u).includes(s.code));
      assert(badNav.length === 0, `${badNav.length} page URL(s) contained the code`);
      assert(badReq.length === 0, `${badReq.length} request URL(s) contained the code`);
      assert(!reception.url().includes(s.code), "page.url() has no code");
    });

    /* ---------------------------------------------------------------- cancel the course */
    await step("Cancel the course (1 of 6 used) with a part credit of £200 → Cancelled; the credit note is on its invoice", "Patient → Invoices (courses)", async () => {
      await owner.goto(patientInvoices());
      await owner.waitForSelector("[data-testid=course-card]");
      const card = courseCard(owner);
      assert(/^1 of 6 used/.test((await card.locator("[data-testid=course-progress]").innerText()).trim()), "1 of 6 used before cancelling");
      await card.locator("[data-testid=cancel-course]").click();
      await owner.waitForSelector("[data-testid=cancel-course-form]");
      const def = await owner.inputValue("[data-testid=cancel-course-credit]");
      assert(def === "250.00", `default credit for 5 of 6 unused: ${def}`);
      await axe(owner, "Cancel course form");
      await owner.fill("[data-testid=cancel-course-credit]", "200.00");
      await owner.click("[data-testid=cancel-course-confirm]");
      const noReason = await owner.waitForSelector("[data-testid=course-card] [role=alert]", { timeout: 8000 }).then(() => true, () => false);
      if (!noReason) finding("Patient → Invoices (Cancel course)", "Cancel course with an empty reason", "refused – the reason is required", "accepted or nothing shown", await shot(owner, "finding-cancel-no-reason"));
      if ((await owner.locator("[data-testid=cancel-course-form]").count()) === 1) {
        await owner.fill("[data-testid=cancel-course-reason]", "Patient moved away (fictional)");
        await owner.click("[data-testid=cancel-course-confirm]");
      }
      await toastText(owner, "Course cancelled");
      const toast = await owner.locator("[role=status]", { hasText: "Course cancelled" }).first().innerText();
      assert(/credit note .+ for £200\.00/.test(toast), `toast: ${toast}`);
      await owner.waitForFunction((name) => {
        const c = [...document.querySelectorAll("[data-testid=course-card]")].find((e) => e.textContent.includes(name));
        return c && /Cancelled/.test(c.textContent);
      }, COURSE_EDITED, { timeout: 20000 });
      await owner.goto(`${BILLING}/invoices/${s.saleInvoiceId}`);
      const body = await owner.locator("main").innerText();
      assert(/Credit note/i.test(body) && /200\.00/.test(body), "credit note on the sale invoice");
      await shot(owner, "1440-course-invoice-credited", true);
    });

    /* ---------------------------------------------------------------- roles */
    await step("clinician (read-only): Invoices tab without sell/cancel/reverse; no stock change form; Set-up courses/products closed", "roles", async () => {
      await clinician.goto(patientInvoices());
      await clinician.waitForSelector("[data-testid=patient-courses]");
      for (const t of ["sell-course", "sell-gift-card", "sell-product", "cancel-course"]) assert((await clinician.locator(`[data-testid=${t}]`).count()) === 0, `clinician has no ${t}`);
      assert((await clinician.locator("[data-testid=course-card] button:has-text('Reverse')").count()) === 0, "no Reverse");
      await shot(clinician, "1440-clinician-patient-invoices", true);
      await clinician.goto(`${BILLING}/stock?site=${s.siteId}`);
      await clinician.waitForSelector("h1:has-text('Stock')");
      assert((await clinician.locator("[data-testid=stock-change-form]").count()) === 0, "no stock change form");
      for (const p of ["courses", "products"]) {
        expected404.add(`${SETUP}/${p}`);
        const res = await clinician.goto(`${SETUP}/${p}`);
        const txt = await clinician.locator("body").innerText();
        assert(res.status() === 404 || res.status() === 403 || !/Add (course|product)/.test(txt), `clinician /setup/${p}: ${res.status()}`);
        if (/data-testid=.add-/.test(await clinician.content())) throw new Error(`clinician sees the Add button on /setup/${p}`);
      }
    });

    await step("reception: may sell but not cancel a course or change Set-up", "roles", async () => {
      await reception.goto(patientInvoices());
      await reception.waitForSelector("[data-testid=patient-courses]");
      assert((await reception.locator("[data-testid=sell-course]").count()) === 1, "reception may sell a course");
      const note = [];
      if ((await reception.locator("button:has-text('Change expiry')").count()) > 0) note.push("Change expiry");
      for (const p of ["courses", "products"]) {
        expected404.add(`${SETUP}/${p}`);
        const res = await reception.goto(`${SETUP}/${p}`);
        const html = await reception.content();
        if (/data-testid="add-(course|product)"/.test(html)) note.push(`Add on /setup/${p} (${res.status()})`);
      }
      assert(note.length === 0, `reception sees: ${note.join(", ")}`);
    });

    /* ---------------------------------------------------------------- 375 px */
    await step("375 px: patient Invoices tab (courses, gift cards, products) has no sideways scroll; Take payment is a full-screen sheet", "375 px", async () => {
      const phone = reception;
      await phone.setViewportSize({ width: 375, height: 812 });
      await phone.goto(patientInvoices());
      await phone.waitForSelector("[data-testid=patient-courses]");
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const p1 = await shot(phone, "375-patient-invoices", true);
      if (overflow > 0) finding("375 px – patient Invoices tab", "open the tab at 375 px", "no sideways scrolling", `scrolls sideways by ${overflow}px`, p1);
      await phone.click("[data-testid=sell-course]");
      await phone.waitForSelector("[data-testid=sell-course-form]");
      const o2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o2 > 0) finding("375 px – Sell a course", "open Sell a course at 375 px", "no sideways scrolling", `scrolls sideways by ${o2}px`, await shot(phone, "375-sell-course"));
      await axe(phone, "Patient Invoices tab 375");
      await phone.goto(`${patientInvoices()}?pay=1`);
      await phone.waitForSelector("[data-testid=take-payment] >> text=Method");
      await phone.click("[data-testid=take-payment] label:has-text('Gift card')");
      await phone.waitForSelector("[data-testid=gift-card-code]");
      await phone.waitForTimeout(400);
      const box = await phone.locator("[data-testid=take-payment]").boundingBox();
      const btn = await phone.locator("[data-testid=take-payment-submit]").boundingBox();
      const o3 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const p3 = await shot(phone, "375-take-payment-gift-card");
      await axe(phone, "Take payment 375 (gift card)");
      assert(box && box.width >= 370 && box.x <= 1, `sheet ${JSON.stringify(box)}`);
      assert(btn && btn.y > 700, `button at the bottom ${JSON.stringify(btn)}`);
      if (o3 > 0) finding("375 px – Take payment", "Take payment → Gift card at 375 px", "no sideways scrolling", `scrolls sideways by ${o3}px`, p3);
      await phone.keyboard.press("Escape");
      for (const [url, name] of [[`${BILLING}/gift-cards`, "gift-cards"], [`${BILLING}/stock?site=${s.siteId}`, "stock"]]) {
        await phone.goto(url);
        await phone.waitForSelector("h1");
        const o = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const p = await shot(phone, `375-${name}`, true);
        if (o > 0) finding(`375 px – ${name}`, `open ${name} at 375 px`, "no sideways scrolling", `scrolls sideways by ${o}px`, p);
      }
      await phone.setViewportSize({ width: 1440, height: 1000 });
    });

    await step("Reports: course liability, gift card liability, products and stock open with figures; CSV downloads; clinician refused", "Reports (PK06)", async () => {
      for (const id of ["course-liability", "gift-card-liability", "products"]) {
        await owner.goto(`${CLINIC}/reports/${id}`);
        await owner.waitForSelector("h1");
        const body = await owner.locator("main").innerText();
        assert(!/something went wrong|error/i.test(await owner.locator("h1").innerText()), `${id}: error page`);
        assert(/£\d/.test(body), `${id}: no money figures shown`);
        await shot(owner, `report-${id}`);
        const csv = await owner.request.get(`${CLINIC}/reports/export/${id}`);
        assert(csv.status() === 200, `${id}: CSV ${csv.status()}`);
        const text = await csv.text();
        assert(text.split("\n").length > 1 && !/^[=+@-]/m.test(text.split("\n").slice(1).join("\n").replace(/^"?-?\d/gm, "")), `${id}: CSV empty or formula cells`);
      }
      const course = await owner.goto(`${CLINIC}/reports/course-liability`).then(() => owner.locator("main").innerText());
      assert(/6/.test(course), "course liability lists the sold course");
      const gift = await owner.goto(`${CLINIC}/reports/gift-card-liability`).then(() => owner.locator("main").innerText());
      assert(/£30\.00/.test(gift), "gift card liability shows the £30 left on the card");
      const res = await clinician.goto(`${CLINIC}/reports/course-liability`);
      const clin = await clinician.locator("body").innerText();
      assert(res.status() === 404 || /not allowed|permission|404|not found/i.test(clin) || !/£\d/.test(clin), "clinician sees no liability figures");
    });

    await step("no banned names on the new screens", "all", async () => {
      for (const u of [`${SETUP}/courses`, `${SETUP}/products`, `${BILLING}/gift-cards`, `${BILLING}/stock`, patientInvoices()]) {
        await owner.goto(u);
        const body = await owner.locator("body").innerText();
        assert(!/\bTM3\b|CareConnect|\bAI\b|Stripe/.test(body), `banned name on ${u.replace(BASE, "")}`);
      }
    });
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    console.log(e.message);
  } finally {
    // Final sweep: no gift card code in any URL seen during the whole run.
    if (s.code) {
      const bare = s.code.replace(/-/g, "");
      const n = requestUrls.filter((u) => u.includes(s.code) || u.includes(bare)).length + navUrls.filter((u) => u.includes(s.code) || u.includes(bare)).length;
      if (n) finding("Billing → Gift cards", "whole run", "the code never in a URL", `${n} URL(s) carried the code`, null, "security");
    }
    // Collapse repeated findings (same screen + actual).
    const seen = new Map();
    for (const f of findings) {
      const k = `${f.severity}|${f.screen}|${f.actual}`;
      if (seen.has(k)) seen.get(k).count++;
      else seen.set(k, { ...f, count: 1 });
    }
    const out = { run: RUN, base: BASE, at: new Date().toISOString(), passed: results.filter((r) => r.ok).map((r) => r.name), failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error })), findings: [...seen.values()] };
    fs.writeFileSync(path.join(OUT, "findings.json"), scrub(JSON.stringify(out, null, 2)));
    fs.writeFileSync(path.join(OUT, "axe-report.json"), scrub(JSON.stringify(axeReport, null, 2)));
    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed; ${seen.size} distinct findings → ${path.join(OUT, "findings.json")}`);
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => {
  console.error(scrub(String(e && e.stack)));
  process.exit(1);
});
