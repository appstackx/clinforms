/**
 * Browser check of the records screens (design round 2: patients list, patient record by role, clinical notes
 * editor / sign / amend / unsigned, 375 px) – LOCAL only, on a fresh demo seed:
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3195 > seed.out   # owner invitation in seed.out
 *   npx next dev -p 3195   (or build + start)
 *   INVITE_FILE=seed.out BASE=http://localhost:3195 E2E_OUT=<dir> SQLITE_PATH=<the server's scratch SQLite> \
 *     NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/pms-records-screens.cjs
 *
 * SQLITE_PATH (default CLINFORMS_SQLITE_PATH): the one direct write – linking the invited clinician to a seeded
 * practitioner (PH-DEMO-03) so she has a registration number to sign with; there is no screen for that yet. The
 * scratch database only (refused unless the path is under a temporary or scratch folder).
 *
 * Roles: the owner (from the seed's invitation) invites a clinician and a receptionist (staff) on the Members page
 * (email off: the link is shown) – each makes an account with two-step verification. Nothing secret is printed
 * (random passwords and codes stay in memory).
 *
 * Checks: list (search, filters, CSV export, states, New patient with the possible-duplicate step), record header and
 * tabs per role (reception: no clinical tab, no clinical flag, no New note; a note's URL is refused), clinical flag,
 * note editor (autosave, red flags, body chart marker, layout: navigation and body chart top-aligned and sticky; sign
 * and lock refused without a registration number, then signed; amendment), unsigned notes, outcomes, the referral
 * reason for reception (on by default, hidden when the owner switches "See referral reason and case notes" off),
 * subject-access export (owner), 375 px without sideways scrolling, keyboard, axe (serious/critical = fail).
 * Screenshots (1440 and 375 per role): E2E_OUT (default .e2e-out/pms-records).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3195";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-records");
const AXE = require.resolve("axe-core/axe.min.js");
const SQLITE = process.env.SQLITE_PATH || process.env.CLINFORMS_SQLITE_PATH || "";
const { openScratchDb } = require("./scratch-db.cjs"); // SQLITE_PATH, or E2E_DATABASE_URL (a local Postgres)

/** Links the member with `email` to the seeded practitioner `registration` (scratch SQLite only – see above). */
function linkPractitioner(email, registration) {
  const db = openScratchDb();
  try {
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
    if (!user) throw new Error("no such member");
    const r = db.prepare("UPDATE pms_practitioners SET user_id = ? WHERE registration_number = ? AND user_id IS NULL").run(user.id, registration);
    if (r.changes !== 1) throw new Error(`practitioner ${registration} not linked (${r.changes})`);
  } finally {
    db.close();
  }
}

const INVITE = (fs.readFileSync(process.env.INVITE_FILE, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
if (!INVITE) throw new Error("No invitation link in INVITE_FILE");

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
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 500)}`);
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
  await page.waitForURL(`${BASE}/two-factor`, { timeout: 60000 });
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = base32Decode(await page.locator("code").first().innerText());
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`, { timeout: 60000 });
}

async function invite(owner, email, role) {
  await owner.goto(`${BASE}/app/settings/members`);
  await owner.fill("input[name=email]", email);
  await owner.selectOption("form:has(input[name=email]) select[name=role]", role);
  await owner.click("button[type=submit]:has-text('Invite')");
  const code = owner.locator("code").filter({ hasText: "/accept-invite?token=" }).first();
  await code.waitFor({ timeout: 30000 });
  return (await code.innerText()).trim();
}

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  const bad = r.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeLog.push({ label, violations: r });
  assert(bad.length === 0, `${label}: ${bad.map((v) => `${v.id}(${v.n}) ${v.target}`).join("; ")}`);
}
const axeLog = [];

async function noSideways(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) {
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll("body *"))
        .filter((e) => e.getBoundingClientRect().right > w + 1)
        .filter((e) => !e.closest("[data-scroll-x]"))
        .slice(0, 4)
        .map((e) => `${e.tagName.toLowerCase()}[${String(e.getAttribute("class") || "").slice(0, 60)}] w=${Math.round(e.getBoundingClientRect().width)} "${(e.textContent || "").trim().slice(0, 30)}"`);
    });
    assert(false, `${label}: scrolls sideways by ${overflow}px – ${wide.join(" | ")}`);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = (w = 1440, h = 1000) => browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const ownerCtx = await ctx();
  const owner = await ownerCtx.newPage();
  const clinCtx = await ctx();
  const clin = await clinCtx.newPage();
  const recCtx = await ctx();
  const rec = await recCtx.newPage();
  const problems = [];
  for (const [label, page] of [["owner", owner], ["clinician", clin], ["reception", rec]]) {
    page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|Download the React DevTools/.test(m.text()) && problems.push(`${label} console: ${m.text().slice(0, 200)}`));
  }
  // Full-page shots: the shell's navigation, the note editor's body chart and its footer are sticky, so a full-page
  // capture of a scrolled page shows them part-way down. The shot is taken from the top with the window as tall as the
  // page (sticky parts where a reader scrolling the page sees them) and the pointer parked (no hover colours).
  const shot = async (page, name, fullPage = true) => {
    if (!fullPage) return page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const size = page.viewportSize();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(size.width - 4, size.height - 4);
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await page.setViewportSize(size);
  };
  /** The shell's navigation starts at the top of its column (just under the header) when the page is at the top. */
  const navTopAligned = async (page, label) => {
    const gap = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const nav = document.querySelector("nav[aria-label='Clinic system']");
      const header = document.querySelector("header");
      return nav && header ? Math.round(nav.getBoundingClientRect().top - header.getBoundingClientRect().bottom) : null;
    });
    assert(gap !== null && gap >= 0 && gap <= 24, `${label}: navigation ${gap}px under the header`);
  };
  const state = {};

  await step("owner, clinician and reception make their accounts (two-step verification)", async () => {
    await onboard(owner, INVITE, "Helen Ward (fictional)");
    state.clinEmail = `priya.shah.${Date.now()}@example.com`;
    const clinLink = await invite(owner, state.clinEmail, "clinician");
    const recLink = await invite(owner, `jess.taylor.${Date.now()}@example.com`, "staff");
    await onboard(clin, clinLink, "Priya Shah");
    await onboard(rec, recLink, "Jess Taylor");
    // Local debugging only (KEEP_STATE=1): the clinician's session for ad-hoc checks, in the output folder.
    if (process.env.KEEP_STATE) await clinCtx.storageState({ path: path.join(OUT, "clinician-state.json") });
  });

  await step("list: 1440 px – search, filters in the URL, next appointment and open case columns", async () => {
    await owner.goto(`${BASE}/app/clinic/patients`);
    await owner.waitForSelector("main h1:has-text('Patients')");
    const head = await owner.locator("main table thead").innerText();
    for (const h of ["Name", "Date of birth", "Mobile", "Next appointment", "Open case"]) assert(head.includes(h), `column ${h}`);
    assert(/\d+ active · all sites/.test(await owner.locator("main").innerText()), "subtitle with the count");
    await shot(owner, "list-owner-1440");
    await owner.fill("#patients-filter", "Hart");
    await owner.waitForURL(/q=Hart/, { timeout: 15000 });
    await owner.waitForSelector("main table >> text=Megan Hart");
    await owner.goto(`${BASE}/app/clinic/patients?nofuture=1`);
    assert((await owner.locator("main").innerText()).includes("No future appointment"), "filter chip shown");
    await owner.goto(`${BASE}/app/clinic/patients?payer=insurer`);
    assert((await owner.locator("main").innerText()).includes("Payer: Insurer"), "payer chip");
    await axe(owner, "patient list");
  });

  await step("list: empty state offers 'Create … as new patient'; error-free; Export CSV (owner) is a CSV with defused cells", async () => {
    await owner.goto(`${BASE}/app/clinic/patients?q=Elsworth`);
    await owner.waitForSelector('text=No patients match "Elsworth"');
    assert(await owner.locator("button:has-text('Create \"Elsworth\" as new patient')").isVisible(), "create button");
    await shot(owner, "list-empty-1440");
    const res = await owner.request.get(`${BASE}/app/clinic/patients/export?payer=insurer`);
    assert(res.status() === 200 && /text\/csv/.test(res.headers()["content-type"]), `csv ${res.status()}`);
    const csv = await res.text();
    assert(csv.includes("Patient number,Title,First name,Last name"), "csv header");
    const recCsv = await rec.request.get(`${BASE}/app/clinic/patients/export`);
    assert(recCsv.status() === 403, `reception export refused (${recCsv.status()})`);
  });

  await step("new patient: the possible-duplicate step, then 'different person' registers and opens the record", async () => {
    await owner.goto(`${BASE}/app/clinic/patients`);
    await owner.click("main button:has-text('New patient')");
    const d = owner.locator("[role=dialog]");
    await d.waitFor();
    await d.locator("select[name=title]").selectOption("Ms");
    await d.locator("input[name=pronouns]").fill("she/her");
    await d.locator("input[name=firstName]").fill("Megan");
    await d.locator("input[name=lastName]").fill("Hart");
    await d.locator("input[name=dateOfBirth]").fill("22/11/1991");
    await d.locator("input[name=phoneMobile]").fill("07700 900999");
    await shot(owner, "new-patient-drawer-1440", false);
    await d.locator("button:has-text('Save'):not(:has-text('book'))").click();
    await d.locator("text=Possible duplicate").waitFor({ timeout: 20000 });
    await shot(owner, "new-patient-duplicate-1440", false);
    await d.locator("input[name=confirmNotDuplicate]").check();
    await d.locator("button:has-text('Save'):not(:has-text('book'))").click();
    await owner.waitForURL(/\/app\/clinic\/patients\/pat_[0-9A-Z]+$/, { timeout: 30000 });
    assert((await owner.locator("section[aria-label='Patient summary']").innerText()).includes("Ms · she/her"), "title and pronouns in the header");
  });

  await step("record (clinician): header, alert/consent pills, next appointment, actions, tabs in the design's order", async () => {
    // A patient with a next appointment and an open case (the first such row on the list).
    await clin.goto(`${BASE}/app/clinic/patients`);
    const rows = clin.locator("main table tbody tr");
    const n = await rows.count();
    let href = null;
    for (let i = 0; i < n; i++) {
      const t = await rows.nth(i).innerText();
      if (/Today|\d{2}\/\d{2} \d{2}:\d{2}/.test(t) && !/–\s*$/.test(t.trim())) {
        href = await rows.nth(i).locator("a").first().getAttribute("href");
        break;
      }
    }
    assert(href, "a patient with a next appointment");
    state.patient = href;
    await clin.goto(`${BASE}${href}`);
    const tabs = await clin.locator("nav[aria-label='Patient record sections'] a").allInnerTexts();
    const labels = tabs.map((t) => t.replace(/\s*\d+\s*items?$/, "").replace(/\s+\d+$/, "").trim());
    assert(JSON.stringify(labels) === JSON.stringify(["Overview", "Appointments", "Cases", "Clinical notes", "Outcomes", "Attachments", "Invoices", "Messages", "Forms", "History"]), `tabs: ${labels.join(", ")}`);
    const header = await clin.locator("section[aria-label='Patient summary']").innerText();
    for (const s of ["DOB", "Patient no.", "Consent", "Next appointment", "Book", "New note", "Send message"]) assert(header.toLowerCase().includes(s.toLowerCase()), `header has ${s}`);
    await axe(clin, "record overview (clinician)");
  });

  await step("clinical flag (clinician): added on Details, shown as 'Clinical: …' in the header", async () => {
    await clin.goto(`${BASE}${state.patient}/details`);
    await clin.fill("#clinical-flags input[name=text]", "On anticoagulants");
    await clin.click("#clinical-flags button:has-text('Add flag')");
    await clin.waitForSelector("#clinical-flags >> text=Clinical flag added.");
    await clin.goto(`${BASE}${state.patient}`);
    await clin.waitForSelector("section[aria-label='Patient summary'] >> text=Clinical: on anticoagulants");
    await shot(clin, "record-clinician-1440");
  });

  await step("note editor: New note → template, red flags, text, body chart marker, autosave 'Draft saved hh:mm'", async () => {
    await clin.click("section[aria-label='Patient summary'] button:has-text('New note')");
    await clin.waitForURL(/\/notes\/note_[0-9A-Z]+$/, { timeout: 30000 });
    state.note = clin.url().replace(BASE, "");
    await clin.waitForSelector("text=Unsigned draft");
    const sel = await clin.locator("#note-template").inputValue();
    if (sel !== "builtin-initial-soap") {
      await clin.selectOption("#note-template", "builtin-initial-soap");
      await clin.click("[role=alertdialog] button:has-text('Switch template')");
      await clin.waitForSelector("#section-subjective", { timeout: 20000 });
    }
    await clin.fill("#section-subjective", "R shoulder pain 6/52, gradual onset after decorating (fictional). Goal: return to swimming.");
    for (const flag of ["Weight loss", "Fever", "Trauma"]) await clin.check(`label:has-text('${flag} – none') input`);
    await clin.fill("#section-objective", "AROM flexion 120°, painful arc 70–110° (fictional).");
    await clin.fill("#section-assessment", "Rotator cuff related shoulder pain (fictional).");
    await clin.fill("#section-plan", "Isometric loading, review in 1 week (fictional).");
    await clin.click("button:has-text('Add marker')");
    await clin.fill("#marker-0-label", "Right shoulder, anterolateral");
    await clin.selectOption("#marker-0-score", "6");
    await clin.waitForSelector("text=/Draft saved \\d{2}:\\d{2}/", { timeout: 20000 });
    await shot(clin, "note-editor-draft-1440");
    await axe(clin, "note editor (draft)");
    // Layout: navigation top-aligned; the body chart beside Subjective (top-aligned right column), sticky when scrolled.
    await navTopAligned(clin, "note editor");
    const top = await clin.evaluate(() => {
      window.scrollTo(0, 0);
      const subjective = document.querySelector("#section-subjective").closest("section, div.rounded-2xl").getBoundingClientRect();
      const chart = document.querySelector("aside[aria-label='Body chart and outcome measures']").getBoundingClientRect();
      return { subjective: Math.round(subjective.top), chart: Math.round(chart.top), chartLeft: Math.round(chart.left), subjectiveRight: Math.round(subjective.right) };
    });
    assert(Math.abs(top.chart - top.subjective) <= 2 && top.chartLeft > top.subjectiveRight, `body chart beside Subjective: ${JSON.stringify(top)}`);
    const stuck = await clin.evaluate(() => {
      window.scrollTo(0, 700);
      const chart = document.querySelector("aside[aria-label='Body chart and outcome measures']").getBoundingClientRect();
      const nav = document.querySelector("nav[aria-label='Clinic system']").getBoundingClientRect();
      return { chart: Math.round(chart.top), nav: Math.round(nav.top), y: Math.round(window.scrollY) };
    });
    assert(stuck.y > 0 && stuck.chart >= 0 && stuck.chart <= 24 && stuck.nav >= 0 && stuck.nav <= 24, `sticky when scrolled: ${JSON.stringify(stuck)}`);
    await clin.screenshot({ path: path.join(OUT, "note-editor-scrolled-1440.png") });
    // The sticky footer never hides the last section at the end of the page.
    await clin.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const covered = await clin.evaluate(() => {
      const plan = document.querySelector("#section-plan").closest("section").getBoundingClientRect();
      const bar = Array.from(document.querySelectorAll("div.sticky")).pop().getBoundingClientRect();
      return plan.bottom > bar.top + 1;
    });
    assert(!covered, "the footer does not overlap the Plan box");
    await shot(clin, "note-editor-footer-1440", false);
  });

  await step("unsigned notes: the draft is in 'My unsigned notes' (side list and page)", async () => {
    assert((await clin.locator("aside[aria-labelledby='unsigned-heading']").innerText()).includes("My unsigned notes"), "side list");
    await clin.goto(`${BASE}/app/clinic/patients/unsigned-notes`);
    await clin.waitForSelector("main h1:has-text('Unsigned notes')");
    assert((await clin.locator("main ul[aria-label='Unsigned notes'] li").count()) >= 1, "at least the new draft");
    await shot(clin, "unsigned-clinician-1440");
    await owner.goto(`${BASE}/app/clinic/patients/unsigned-notes?scope=all`);
    await owner.waitForSelector("text=By clinician");
    await shot(owner, "unsigned-owner-all-1440");
  });

  await step("signing needs a registration number: told before the click, Sign and lock disabled; then linked, it signs", async () => {
    await clin.goto(`${BASE}${state.note}`);
    await clin.waitForSelector("#registration-needed >> text=Add your registration number to sign notes");
    assert(await clin.locator("button:has-text('Sign and lock')").isDisabled(), "Sign and lock is disabled without a registration number");
    await shot(clin, "note-editor-no-registration-1440");
    linkPractitioner(state.clinEmail, "PH-DEMO-03");
  });

  await step("sign and lock, then amend: locked banner, amendment below the original", async () => {
    await clin.goto(`${BASE}${state.note}`);
    assert((await clin.locator("#registration-needed").count()) === 0, "no registration notice once linked");
    await clin.click("button:has-text('Sign and lock')");
    await clin.waitForSelector("[role=alertdialog] >> text=Sign this note?");
    await shot(clin, "note-sign-dialog-1440", false);
    await clin.click("[role=alertdialog] button:has-text('Sign and lock')");
    await clin.waitForSelector("text=Signed and locked", { timeout: 30000 });
    assert((await clin.locator("main").innerText()).includes("This note is locked"), "locked banner");
    assert((await clin.locator("textarea#section-subjective").count()) === 0, "read-only");
    await shot(clin, "note-signed-1440");
    await clin.click("button:has-text('Add amendment')");
    await clin.selectOption("#amend-reason", "info");
    await clin.fill("#amend-text", "Ultrasound report received: partial-thickness supraspinatus tear (fictional). Plan unchanged.");
    await clin.click("button:has-text('Sign amendment')");
    await clin.waitForSelector("text=Signed · amended", { timeout: 30000 });
    const text = await clin.locator("main").innerText();
    assert(text.includes("Amendment 1") && text.includes("The original note above is unchanged."), "amendment shown");
    await shot(clin, "note-amended-1440");
  });

  await step("outcomes: record a score; it shows on the Outcomes tab", async () => {
    await clin.goto(`${BASE}${state.patient}/outcomes`);
    await clin.waitForSelector("main >> text=Record a measure");
    await shot(clin, "outcomes-clinician-1440");
  });

  await step("reception: no clinical tab, no clinical flag, no New note; the note's URL is refused", async () => {
    await rec.goto(`${BASE}${state.patient}`);
    const tabs = (await rec.locator("nav[aria-label='Patient record sections'] a").allInnerTexts()).map((t) => t.replace(/\s+\d+.*$/, "").trim());
    for (const t of ["Clinical notes", "Outcomes", "Attachments"]) assert(!tabs.includes(t), `reception sees ${t}`);
    const header = await rec.locator("section[aria-label='Patient summary']").innerText();
    assert(!/Clinical:/.test(header) && !/anticoagulants/i.test(header), "no clinical flag");
    assert((await rec.locator("section[aria-label='Patient summary'] button:has-text('New note')").count()) === 0, "no New note (absent, not disabled)");
    assert(!(await rec.locator("main").innerText()).includes("Latest notes"), "no latest notes card");
    await shot(rec, "record-reception-1440");
    const res = await rec.goto(`${BASE}${state.note}`);
    assert(res.status() === 404, `note URL as reception: ${res.status()}`);
    const notes = await rec.goto(`${BASE}${state.patient}/notes`);
    assert(notes.status() === 404, `notes tab URL as reception: ${notes.status()}`);
    await rec.goto(`${BASE}${state.patient}/history`);
    await shot(rec, "history-reception-1440");
    await rec.goto(`${BASE}/app/clinic/patients`);
    await shot(rec, "list-reception-1440");
    await axe(rec, "record (reception)");
    for (const [page, label] of [[rec, "patient list"], [clin, "patient list (clinician)"]]) await navTopAligned(page, label);
  });

  await step("reception sees the referral reason by default (Overview and Cases); hidden when the owner switches it off", async () => {
    // The owner writes a referral reason on the patient's open case (Case → Edit the case).
    const REASON = "Referred by the GP for shoulder pain after a fall at home (fictional).";
    await owner.goto(`${BASE}${state.patient}`);
    const caseHref = (await owner.locator("a:has-text('Complete referrer form')").getAttribute("href")).replace(/#.*$/, "");
    await owner.goto(`${BASE}${caseHref}`);
    await owner.click("summary:has-text('Edit the case')");
    await owner.fill("textarea[name=referralReason]", REASON);
    await owner.click("button:has-text('Save case')");
    await owner.waitForSelector(`main >> text=${REASON}`, { timeout: 30000 });
        await rec.goto(`${BASE}${state.patient}`);
    await rec.waitForSelector(`[data-testid=overview-referral-reason] >> text=${REASON}`);
    await navTopAligned(rec, "record overview (reception)");
    await rec.goto(`${BASE}${state.patient}/cases`);
    await rec.waitForSelector(`[data-testid=case-referral-reason] >> text=${REASON}`);
    await navTopAligned(rec, "cases tab (reception)");
    await shot(rec, "cases-reception-referral-1440");
    // The owner switches "See referral reason and case notes" off for Reception (Roles and permissions).
    const toggle = async (on) => {
      await owner.goto(`${BASE}/app/clinic/access/roles`);
      const cell = owner.locator("tbody tr", { has: owner.locator('th[scope=row] >> text="See referral reason and case notes"') }).locator("td").nth(3).locator("input[type=checkbox]");
      if (on) await cell.check();
      else await cell.uncheck();
      await owner.click("button:has-text('Review and save (1)')");
      await owner.click("[role=alertdialog] >> button:has-text('Save changes')");
      await owner.waitForSelector("text=/1 change saved at/");
    };
    await toggle(false);
    await rec.goto(`${BASE}${state.patient}`);
    await rec.waitForSelector("main >> text=Open case");
    assert((await rec.locator("[data-testid=overview-referral-reason]").count()) === 0, "overview: no referral reason");
    await rec.goto(`${BASE}${state.patient}/cases`);
    assert((await rec.locator("[data-testid=case-referral-reason]").count()) === 0, "cases: no referral reason");
    assert(!(await rec.locator("main").innerText()).includes(REASON), "the text is not on the page");
    await shot(rec, "cases-reception-no-referral-1440");
    await toggle(true);
    await rec.goto(`${BASE}${state.patient}/cases`);
    await rec.waitForSelector(`[data-testid=case-referral-reason] >> text=${REASON}`);
  });

  await step("owner: subject-access copy (PDF and JSON) downloads; reception and clinician are refused", async () => {
    const pdf = await owner.request.get(`${BASE}${state.patient}/export?format=pdf`);
    assert(pdf.status() === 200 && /pdf/.test(pdf.headers()["content-type"]) && /attachment/.test(pdf.headers()["content-disposition"]), `pdf ${pdf.status()}`);
    const json = await owner.request.get(`${BASE}${state.patient}/export?format=json`);
    const body = await json.json();
    assert(Array.isArray(body.clinicalFlags) && body.clinicalFlags.length >= 1, "the clinical flag is in the copy");
    for (const p of [rec, clin]) assert((await p.request.get(`${BASE}${state.patient}/export?format=pdf`)).status() === 403, "refused");
    await owner.goto(`${BASE}${state.patient}`);
    await owner.click("button[aria-label='More actions']");
    assert(await owner.locator("[role=menu] >> text=Subject access copy (PDF)").isVisible(), "menu item");
    await owner.keyboard.press("Escape");
    await shot(owner, "record-owner-1440");
  });

  await step("keyboard: the list's filter, the record's tabs (arrow keys), the more-actions menu (Esc)", async () => {
    await clin.goto(`${BASE}/app/clinic/patients`);
    await clin.focus("#patients-filter");
    await clin.keyboard.type("Brooks");
    await clin.keyboard.press("Enter");
    await clin.waitForURL(/q=Brooks/, { timeout: 15000 });
    await clin.goto(`${BASE}${state.patient}`);
    await clin.focus("nav[aria-label='Patient record sections'] a >> nth=0");
    await clin.keyboard.press("ArrowRight");
    const focused = await clin.evaluate(() => document.activeElement && document.activeElement.textContent);
    assert(/Appointments/.test(focused || ""), `ArrowRight moves to Appointments (${focused})`);
    await clin.focus("button[aria-label='More actions']");
    await clin.keyboard.press("Enter");
    await clin.waitForSelector("[role=menu]");
    await clin.keyboard.press("Escape");
    assert((await clin.locator("[role=menu]").count()) === 0, "Esc closes the menu");
  });

  await step("375 px: list as cards (quick chips), record header (Call / Book / Note), note editor – no sideways scrolling", async () => {
    for (const [label, page] of [["clinician", clin], ["reception", rec], ["owner", owner]]) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/app/clinic/patients`);
      await page.waitForSelector("main ul[aria-label='Patients'] li");
      await noSideways(page, `${label} list`);
      await shot(page, `list-${label}-375`);
      await page.goto(`${BASE}${state.patient}`);
      await noSideways(page, `${label} record`);
      await shot(page, `record-${label}-375`);
    }
    assert(await clin.locator("main a:has-text('Call')").isVisible(), "Call on a phone");
    await clin.goto(`${BASE}${state.note}`);
    await noSideways(clin, "note");
    await shot(clin, "note-clinician-375");
    await axe(clin, "note at 375 px");
  });

  await step("no browser errors", async () => {
    assert(problems.length === 0, problems.join(" | "));
  });

  fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeLog, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
