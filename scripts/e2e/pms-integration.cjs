/**
 * Browser check of M9 integration (LOCAL only – designs round 3 ReferrerForm and letter editor, round 2c Import):
 *
 *   referrer form   a clinician on Emily Turner's case (seeded, fictional) → "Complete referrer form" → the picker
 *                   lists the clinic's ClinForms library with the case's insurer's form first → "Open in ClinForms" →
 *                   the Studio with the hand-over banner and the case loaded (signed note, not the draft) → the
 *                   clinician answers what is missing and approves → the form is filed back by itself → back on the
 *                   case: "Approved by …" with the time, View PDF; the record's Forms tab lists it; reception can start
 *                   a form (no clinical prefill) but cannot open the filed file; another clinic sees nothing;
 *   product switch  "ClinForms" in the clinic system's header opens the Studio; the Studio shows the switch back;
 *   import          owner → Set-up → Import data → a fictional patients CSV (some rows with problems) → match columns
 *                   → check (ready / warnings / errors, issues list) → import → done → the same file again finds
 *                   every row already in the clinic → undo removes the first import;
 *   letters         a letter downloads as PDF and Word for the clinician, never for reception; a signed discharge
 *                   note → "Write discharge letter" → the letter editor;
 *   claims          Billing → Insurer claims (owner).
 *
 *   run-e2e-m9.sh pms-integration.cjs <port> <outdir>   (fresh `pms:seed-demo -- --fresh` scratch SQLite + the
 *   reports-only clinic B, `next start`, MEDREPORT_AI_MODE=demo; SEED_LOG, BASE, SQLITE_PATH, E2E_OUT, NODE_PATH)
 *
 * SQLITE_PATH: read-only lookups of seeded ids (a signed discharge note) and one direct write – linking the
 * clinician's account to the seeded practitioner Priya Shah (no screen links them yet; as pms-prototype-a does).
 * Fictional data only; nothing secret is printed.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3190";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-integration");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || "";
const { openScratchDb } = require("./scratch-db.cjs"); // SQLITE_PATH, or E2E_DATABASE_URL (a local Postgres)
const RUN = crypto.randomBytes(3).toString("hex");
const CLINIC = `${BASE}/app/clinic`;
let AXE = null;
try {
  AXE = require.resolve("axe-core/axe.min.js");
} catch {
  AXE = null;
}

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
/** axe on the page, or only inside `include` (a CSS selector: the part this milestone built). */
async function axe(page, label, include) {
  if (!AXE) return;
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async (inc) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(inc ? { include: [inc] } : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  }, include || null);
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeReport.push({ label, found });
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
}

/** Resolve or acknowledge every open gap on the review screen (from tenant-full-flow.cjs); a card that is still
 *  moving (an answer just saved) is tried again on the next round instead of failing the step. */
async function resolveEverything(app) {
  try {
    return await resolveOnce(app);
  } catch (err) {
    console.log(`   (resolve round retried: ${String(err && err.message).split("\n")[0].slice(0, 120)})`);
    await app.waitForTimeout(1000);
    return 0;
  }
}
async function resolveOnce(app) {
  const keys = await app.$$eval("[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
  let actions = 0;
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    for (let guard = 0; guard < 6; guard++) {
      const quick = card.getByRole("button", { name: "Mark resolved" });
      if ((await quick.count()) && !(await card.locator("form").count())) {
        await quick.first().click({ timeout: 8000 });
        await app.waitForTimeout(250);
        actions++;
        continue;
      }
      const res = card.getByRole("button", { name: /^Resolve$/ });
      if (await res.count()) {
        await res.first().click({ timeout: 8000 });
        const ta = card.locator("form textarea").last();
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
        await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
        await app.waitForTimeout(250);
        actions++;
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await ack.first().click({ timeout: 8000 });
        await card.locator("form textarea").last().fill("Not recorded in the notes; returned without it after checking with the clinician.");
        await card.locator("form").getByRole("button", { name: /Acknowledge/ }).last().click();
        await app.waitForTimeout(250);
        actions++;
        continue;
      }
      break;
    }
  }
  return actions;
}

/** Fill every question the notes did not answer, in the clinician's own words (fictional answers). */
async function answerOpen(app) {
  const keys = await app.$$eval("[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
  let answered = 0;
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    const text = await card.innerText();
    if (!/no answer yet|Missing|needs your|Not answered|Answer this/i.test(text)) continue;
    await card.scrollIntoViewIfNeeded();
    const radios = card.locator("input[type=radio]");
    if (await radios.count()) {
      const yes = card.getByLabel("Yes", { exact: true });
      if (await yes.count()) await yes.first().check();
      else await radios.first().check();
      answered++;
    } else {
      const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
      if (await add.count()) await add.first().click();
      const box = card.locator("textarea, input[type=text], input:not([type])");
      if (await box.count()) {
        await box.first().fill(/DD\/MM\/YYYY|Date of injury/.test(text) ? "N/A" : /number|sessions/i.test(text) ? "6" : "Treated for rotator cuff related shoulder pain; improving with loading (fictional answer).");
        answered++;
      }
    }
    const h = card.locator("h3").first();
    if (await h.count()) await h.click();
    await app.waitForTimeout(250);
  }
  return answered;
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const seedText = fs.readFileSync(SEED_LOG, "utf8");
  const ownerInvite = (seedText.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const sql = openScratchDb();
  const one = (q, ...a) => sql.prepare(q).get(...a);

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width = 1440, height = 1000) => {
    const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon|clipboard|403|Forbidden/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk();
  const reception = await mk();
  const clinician = await mk();
  failPages.push(["owner", owner], ["reception", reception], ["clinician", clinician]);
  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });

  const emily = one("select id from pms_patients where tenant_id = 'riverside-demo' and import_ref = 'sim-int-001'");
  assert(emily, "seeded Emily Turner (sim-int-001)");
  const kase = one("select id from pms_cases where tenant_id = 'riverside-demo' and patient_id = ? and title like 'Right shoulder%'", emily.id);
  const casePath = `${CLINIC}/patients/${emily.id}/cases/${kase.id}`;
  const s = { filedId: null, importId: null };

  try {
    await step("owner, clinician (ClinForms signing details: PH-DEMO-03, may sign) and reception accounts", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const c = await invite(owner, `zz-int-clin-${RUN}@example.com`, "clinician");
      const r = await invite(owner, `zz-int-rec-${RUN}@example.com`, "staff");
      await onboard(clinician, c, "Priya Shah");
      await onboard(reception, r, "Jess Taylor (fictional)");
      await owner.goto(`${BASE}/app/settings/members`);
      const row = owner.locator("li", { has: owner.locator(`p:text-is("zz-int-clin-${RUN}@example.com")`) }).first();
      await row.locator("summary:has-text('Manage')").click();
      await row.locator("input[name=jobTitle]").fill("Physiotherapist");
      await row.locator("input[name=hcpcNumber]").fill("PH-DEMO-03");
      await row.locator("input[name=canSign]").check();
      await row.locator("button:has-text('Save signing details')").click();
      await row.locator("text=Saved.").waitFor({ timeout: 20000 });
      // Link the clinician's account to the seeded practitioner Priya Shah (no screen for it yet).
      const user = one('select id from "user" where email = ?', `zz-int-clin-${RUN}@example.com`);
      sql.prepare("update pms_practitioners set user_id = ? where tenant_id = 'riverside-demo' and display_name = 'Priya Shah'").run(user.id);
    });

    await step("product switch: the clinic system's header → ClinForms (the Studio) → the switch back", async () => {
      await clinician.goto(CLINIC);
      const sw = clinician.locator("nav[aria-label='Product areas']");
      await sw.waitFor();
      assert((await sw.innerText()).includes("ClinForms"), "ClinForms in the switch");
      await sw.locator("a:has-text('ClinForms')").click();
      await clinician.waitForURL(/\/app\/studio/);
      await clinician.waitForSelector("[data-testid=product-switch]");
      await shot(clinician, "1440-studio-product-switch");
      await clinician.locator("[data-testid=product-switch] a").first().click();
      await clinician.waitForURL(/\/app\/clinic/);
    });

    await step("case: 'Referrer and insurer forms' – no forms yet; the picker lists the library, the insurer's form first", async () => {
      await clinician.goto(casePath);
      await clinician.waitForSelector("[data-testid=referrer-forms]");
      const panel = await clinician.locator("[data-testid=referrer-forms]").innerText();
      assert(/No forms on this case yet/.test(panel) && /Northfield Assurance/.test(panel) && /NA-55021/.test(panel), `panel: ${panel}`);
      await shot(clinician, "1440-case-referrer-forms");
      await axe(clinician, "case referrer forms", "[data-testid=referrer-forms]");
      await clinician.click("[data-testid=complete-referrer-form]");
      const dlg = clinician.getByRole("dialog");
      await dlg.waitFor();
      const radios = await dlg.locator("label").allInnerTexts();
      assert(/Rehabilitation Progress Report/.test(radios[0]) && /for this case/.test(radios[0]), `first: ${radios[0]}`);
      assert(radios.some((r) => /Treating Physiotherapist Report/.test(r) && /other referrer/.test(r)), "the other library form too");
      assert(/signed notes and outcome scores/.test(await dlg.innerText()), "clinical prefill said");
      await shot(clinician, "1440-choose-form");
      await axe(clinician, "choose a form", "[role=dialog]");
    });

    await step("Open in ClinForms → the Studio with the case loaded (hand-over, signed note only) → Complete this form", async () => {
      await clinician.click("[data-testid=open-in-clinforms]");
      await clinician.waitForURL(/\/app\/studio\/new/, { timeout: 30000 });
      await clinician.getByRole("button", { name: "Choose the referrer form" }).waitFor({ timeout: 60000 });
      const main = await clinician.locator("main").innerText();
      assert(/Emily Turner/.test(main), "the patient is loaded");
      await shot(clinician, "1440-studio-case-loaded");
      await clinician.getByRole("button", { name: "Choose the referrer form" }).click();
      const radio = clinician.getByRole("radio", { name: /Rehabilitation Progress Report/ }).first();
      await radio.waitFor({ timeout: 20000 });
      if (!(await radio.isChecked())) await radio.click();
      await clinician.getByRole("button", { name: "Complete this form" }).click();
      // Drafting from the notes is off for the demo clinic: the questions are left for the clinician → Open for review.
      const open = clinician.locator("a:has-text('Open for review'), button:has-text('Open for review')").first();
      await Promise.race([open.waitFor({ timeout: 120000 }), clinician.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 120000 })]);
      await shot(clinician, "1440-studio-completing");
      if (await open.count()) await open.click();
      await clinician.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 120000 });
      await clinician.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
      await clinician.waitForTimeout(2000);
      const banner = await clinician.locator("[aria-label='Hand-over']").innerText();
      assert(/Opened from/.test(banner) && /Emily Turner/.test(banner) && /Back to the record without filing/.test(banner), `hand-over: ${banner}`);
      const report = await clinician.evaluate(async (id) => (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).report, clinician.url().split("/").pop());
      const notes = report.bundleSnapshot.notes;
      assert(notes.length === 1 && /Rotator cuff/.test(notes[0].assessment), `notes ${notes.length}`);
      assert(report.bundleSnapshot.referral.authorisationNumber === "NA-55021", "authorisation");
      assert(report.bundleSnapshot.outcomeMeasures.length === 1, "the NPRS score");
      await shot(clinician, "1440-studio-review-handover");
    });

    await step("approve in ClinForms → filed back to the case by itself", async () => {
      const app = clinician;
      for (let round = 0; round < 5; round++) {
        await answerOpen(app);
        await resolveEverything(app);
      }
      await app.waitForTimeout(1500);
      const blocked = await app.locator("#approve-blocked").innerText().catch(() => "");
      await shot(app, "1440-studio-ready-to-approve");
      assert(!/to resolve/.test(blocked), `still blocked: ${blocked}`);
      await app.getByRole("button", { name: /^Approve/ }).first().click();
      const dlg = app.getByRole("dialog");
      await dlg.waitFor();
      const name = await dlg.getByLabel("Full name", { exact: true }).inputValue();
      await dlg.getByLabel(/Typed signature/).fill(name);
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await dlg.getByRole("button", { name: /Approve and sign/ }).click();
      await app.getByText(/Approved – the completed form is final/).waitFor({ timeout: 90000 });
      await app.getByText(/Filed .* to the clinic system record/).first().waitFor({ timeout: 90000 });
      await shot(app, "1440-studio-approved-filed");
    });

    await step("back on the case: approved form listed with who approved it and when; View PDF works; Forms tab lists it", async () => {
      await clinician.goto(casePath);
      const row = clinician.locator("[data-testid=filed-form]").first();
      await row.waitFor();
      const text = await row.innerText();
      assert(/Rehabilitation Progress Report/.test(text) && /Approved by Priya Shah \(PH-DEMO-03\) on \d\d\/\d\d\/\d{4} at \d\d:\d\d/.test(text) && /PDF/.test(text), `filed: ${text}`);
      await shot(clinician, "1440-case-form-filed");
      const href = await row.locator("a").first().getAttribute("href");
      s.filedPath = href;
      const res = await clinician.request.get(`${BASE}${href}`);
      assert(res.ok() && (await res.body()).subarray(0, 5).toString() === "%PDF-", `file ${res.status()}`);
      await clinician.goto(`${CLINIC}/patients/${emily.id}/forms`);
      const tab = await clinician.locator("[data-testid=filed-forms]").innerText();
      assert(/Rehabilitation Progress Report/.test(tab) && /ClinForms · case: Right shoulder/.test(tab) && /Approved/.test(tab), `forms tab: ${tab}`);
      await shot(clinician, "1440-forms-tab-filed");
      await axe(clinician, "forms tab", "[data-testid=filed-forms]");
    });

    await step("reception: may start a form without clinical prefill; cannot open the filed file", async () => {
      await reception.goto(casePath);
      await reception.waitForSelector("[data-testid=referrer-forms]");
      assert((await reception.locator("[data-testid=filed-form] a").count()) === 0, "no View link");
      await reception.click("[data-testid=complete-referrer-form]");
      const dlg = await reception.getByRole("dialog").innerText();
      assert(/Clinical notes are not shared from your account/.test(dlg), dlg);
      await shot(reception, "1440-reception-choose-form");
      const res = await reception.request.get(`${BASE}${s.filedPath}`);
      assert(res.status() === 403 || res.status() === 404, `reception file: ${res.status()}`);
    });

    await step("import: Set-up → Import data → patients CSV → match columns → check (issues) → import → done", async () => {
      const headers = ["LegacyID", "PatientFirstName", "PatientSurname", "DOB", "MobileTel", "EmailAddr", "Addr1", "PCode", "Colour"];
      const rows = [];
      for (let i = 1; i <= 24; i++) rows.push([`L-${100480 + i}`, ["Margaret", "Owen", "Ruth", "Sam"][i % 4], `Fictional${i}`, `${String((i % 27) + 1).padStart(2, "0")}/03/19${60 + i}`, `07700 900${String(300 + i)}`, `import${i}@example.com`, `${i} Mill Lane (fictional)`, "MK3 9ZZ", "Blue"]);
      rows.push(["L-200001", "", "", "01/01/1980", "", "", "", "", ""]); // no name → error
      rows.push(["L-200002", "Ida", "Future", "31/02/1975", "", "", "", "", ""]); // not a real date → warning, left blank
      const csv = [headers, ...rows].map((r) => r.join(",")).join("\r\n") + "\r\n";
      const file = path.join(OUT, "patients-fictional.csv");
      fs.writeFileSync(file, csv);
      await owner.goto(`${CLINIC}/setup`);
      await owner.locator("a:has-text('Import data')").first().click();
      await owner.waitForURL(/\/setup\/import$/);
      await owner.waitForSelector("[data-testid=import-upload]");
      await shot(owner, "1440-import-upload");
      await axe(owner, "import upload");
      await owner.setInputFiles("#im-file", file);
      await owner.waitForSelector("[data-testid=import-file-summary]");
      await owner.click("[data-testid=import-continue]");
      await owner.waitForURL(/\/setup\/import\/imp/, { timeout: 30000 });
      s.importId = owner.url().split("/").pop();
      await owner.waitForSelector("[data-testid=import-mapping]");
      const mapText = await owner.locator("main").innerText();
      assert(/We matched \d+ of 9 columns/.test(mapText), mapText.slice(0, 300));
      assert((await owner.locator("select[aria-label='Import PatientFirstName as']").inputValue()) === "firstName", "camel-case column matched");
      await shot(owner, "1440-import-map");
      await axe(owner, "import map");
      await owner.click("[data-testid=import-check]");
      await owner.waitForSelector("[data-testid=import-counts]", { timeout: 60000 });
      await owner.waitForSelector("[data-testid=import-issues] li", { timeout: 30000 });
      const counts = await owner.locator("[data-testid=import-counts]").innerText();
      const issues = await owner.locator("[data-testid=import-issues]").innerText();
      assert(/Row 25/.test(issues) && /Error/.test(issues) && /Row 26/.test(issues), `issues: ${issues}`);
      await shot(owner, "1440-import-check");
      await axe(owner, "import check");
      await owner.check("[data-testid=import-confirm]");
      await owner.click("[data-testid=import-run]");
      await owner.waitForSelector("[data-testid=import-done]", { timeout: 120000 });
      const done = await owner.locator("[data-testid=import-done]").innerText();
      assert(/25 patients imported/.test(done) && /1 rows? skipped/.test(done), `done: ${done} (counts ${counts})`);
      await shot(owner, "1440-import-done");
    });

    await step("import again: the same file finds every row already in the clinic; then undo removes the first import", async () => {
      await owner.goto(`${CLINIC}/setup/import`);
      await owner.setInputFiles("#im-file", path.join(OUT, "patients-fictional.csv"));
      await owner.waitForSelector("[data-testid=import-file-summary]");
      await owner.click("[data-testid=import-continue]");
      await owner.waitForURL(/\/setup\/import\/imp/, { timeout: 30000 });
      await owner.waitForSelector("[data-testid=import-mapping]");
      await owner.click("[data-testid=import-check]");
      await owner.waitForSelector("[data-testid=import-counts]", { timeout: 60000 });
      const counts = await owner.locator("[data-testid=import-counts]").innerText();
      assert(/Ready\s*0/.test(counts) && /25 already in the clinic/.test(counts), `re-run counts: ${counts}`);
      await shot(owner, "1440-import-rerun-duplicates");
      await owner.goto(`${CLINIC}/setup/import/${s.importId}`);
      await owner.click("[data-testid=import-undo-ask]");
      await owner.click("[data-testid=import-undo-confirm]");
      await owner.waitForSelector("[data-testid=import-undone]", { timeout: 120000 });
      const undone = await owner.locator("[data-testid=import-undone]").innerText();
      assert(/Import undone/.test(undone) && /25 patients/.test(undone), undone);
      await shot(owner, "1440-import-undone");
      const left = one("select count(*) as n from pms_patients where tenant_id = 'riverside-demo' and status = 'active' and last_name like 'Fictional%'");
      assert(Number(left.n) === 0, `active imported patients left: ${left.n}`);
    });

    await step("reception has no Import data (Set-up) and the import pages are 404", async () => {
      const res = await reception.goto(`${CLINIC}/setup/import`);
      assert(res.status() === 404, `reception import: ${res.status()}`);
    });

    await step("letters: a clinician's letter downloads as PDF and Word; reception gets neither", async () => {
      await clinician.goto(`${CLINIC}/patients/${emily.id}/messages`);
      await clinician.click("[data-testid=write-letter]");
      await clinician.waitForSelector("[data-testid=letter-templates]");
      await clinician.locator("[data-testid=letter-templates] label").first().locator("input").check();
      await clinician.click("[data-testid=start-letter]");
      await clinician.waitForURL(/\/app\/clinic\/letters\/ltr_/);
      const id = clinician.url().split("/").pop();
      await clinician.waitForSelector("[data-testid=download-letter-pdf]");
      await shot(clinician, "1440-letter-editor");
      const pdf = await clinician.request.get(`${CLINIC}/letters/${id}/file?format=pdf`);
      assert(pdf.ok() && (await pdf.body()).subarray(0, 5).toString() === "%PDF-", `pdf ${pdf.status()}`);
      const docx = await clinician.request.get(`${CLINIC}/letters/${id}/file?format=docx`);
      const b = await docx.body();
      assert(docx.ok() && b[0] === 0x50 && b[1] === 0x4b, `docx ${docx.status()}`);
      fs.writeFileSync(path.join(OUT, "letter.pdf"), await pdf.body());
      fs.writeFileSync(path.join(OUT, "letter.docx"), b);
      const denied = await reception.request.get(`${CLINIC}/letters/${id}/file?format=pdf`);
      assert(denied.status() === 403 || denied.status() === 404, `reception letter file: ${denied.status()}`);
    });

    await step("discharge letter from a signed discharge note", async () => {
      const note = one("select id, patient_id from pms_clinical_notes where tenant_id = 'riverside-demo' and note_type = 'discharge' and status = 'signed' limit 1");
      assert(note, "a signed discharge note in the seed");
      await clinician.goto(`${CLINIC}/patients/${note.patient_id}/notes/${note.id}`);
      await clinician.click("[data-testid=discharge-letter]");
      await clinician.waitForURL(/\/app\/clinic\/letters\/ltr_/, { timeout: 30000 });
      await clinician.waitForSelector("[data-testid=download-letter-pdf]");
      await shot(clinician, "1440-discharge-letter");
    });

    await step("billing → insurer claims (owner)", async () => {
      await owner.goto(`${CLINIC}/billing/claims`);
      await owner.waitForSelector("[data-testid=claims-filter]");
      await shot(owner, "1440-insurer-claims");
      await axe(owner, "insurer claims");
    });

    await step("no page errors", async () => {
      assert(problems.length === 0, problems.slice(0, 8).join(" | "));
    });
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exitCode = passed === results.length ? 0 : 1;
  }
})();
