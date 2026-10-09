/**
 * A clinic's whole working day, end to end in the browser (wave 2): for the PREVIEW database or a local one –
 * never production. Two clinics are created beforehand with `npm run admin:create-clinic` (their output files hold
 * the owners' invitation links):
 *
 *   setup      owner A: invitation → account → two-step; Settings → Clinic (address, drafting from the notes ON);
 *              invites a clinician (email off: the link is shown); clinician: account + two-step; owner sets the
 *              clinician's HCPC number and "may sign".
 *   flow       clinician in /app/studio: uploads the Northfield fillable PDF (fetched from the app's public sample
 *              endpoint), analysis, confirms the map; uploads the printed-notes PDF (Priya Nair, fictional); drafts
 *              with the clinic's drafting (no passcode, no demo session); answers the required questions, resolves
 *              the gaps; approves (signer = the clinician's profile, read-only); downloads the final PDF; reload and a
 *              second signed-in browser show it from the server; nothing from a report or form map in
 *              localStorage / IndexedDB; the public demo still works in the same signed-in browser; activity pages
 *              (owner: the clinic, clinician: own entries).
 *   isolation  owner B (another clinic): the report is not found (404), cannot be rendered (403 TENANT_MISMATCH),
 *              B's snapshot is empty.
 *
 * Run (app on the preview database, e.g. `npm run admin:with-env -- --env preview --port 3111 -- npx next start -p 3111`
 * with drafting configured on the server):
 *   RUN_ID=<n> INVITE_A_FILE=<create-clinic output for clinic A> INVITE_B_FILE=<… clinic B> BASE=http://localhost:3111 \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/tenant-full-flow.cjs
 * Clinic A: id zz-w2-e2e-<RUN_ID>, owner zz-w2-owner-a-<RUN_ID>@example.com; clinic B: owner zz-w2-owner-b-<RUN_ID>@example.com.
 * PHASE=setup|flow|isolation runs one part (state in E2E_OUT/state.json, chmod 600: the fictional test accounts'
 * passwords and authenticator keys – never printed). Screenshots and results go to E2E_OUT (default
 * .e2e-out/tenant-full-flow/, gitignored). Offboard both clinics afterwards (admin:offboard-clinic).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const BASE = (process.env.BASE || "http://localhost:3111").replace(/\/+$/, "");
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "tenant-full-flow");
const STATE_FILE = path.join(OUT, "state.json");
const N = process.env.RUN_ID;
if (!N) throw new Error("RUN_ID is required");
const PHASE = process.env.PHASE || "all";
if (/clinforms\.co\.uk/.test(BASE)) throw new Error("Run this against a preview or local server, never production");

const INVITES = { a: process.env.INVITE_A_FILE, b: process.env.INVITE_B_FILE };
const linkFrom = (which) => {
  const file = INVITES[which];
  if (!file) throw new Error(`INVITE_${which.toUpperCase()}_FILE is required`);
  const link = (fs.readFileSync(file, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  if (!link) throw new Error(`No invitation link in ${file}`);
  if (/clinforms\.co\.uk/.test(link)) throw new Error("never production");
  return link;
};
fs.mkdirSync(OUT, { recursive: true });
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

const OWNER_A = { email: `zz-w2-owner-a-${N}@example.com`, name: "Zara Owner (fictional)" };
const CLIN = { email: `zz-w2-clin-${N}@example.com`, name: "Zed Clinician (fictional)", hcpc: "ZZ0001", job: "Physiotherapist (fictional)" };
const OWNER_B = { email: `zz-w2-owner-b-${N}@example.com`, name: "Zoe Other Owner (fictional)" };

/** The test inputs: the bundled Northfield sample (from the app) and the fictional printed notes (from the repo). */
async function prepareInputs() {
  const dir = path.join(OUT, "inputs");
  fs.mkdirSync(dir, { recursive: true });
  const northfield = path.join(dir, "northfield-rehab-progress.pdf");
  if (!fs.existsSync(northfield)) {
    const res = await fetch(`${BASE}/api/reports/v1/forms/samples/northfield-rehab-progress/file`);
    if (!res.ok) throw new Error(`sample form: ${res.status}`);
    fs.writeFileSync(northfield, Buffer.from(await res.arrayBuffer()));
  }
  const notes = path.join(dir, "priya-nair-notes.pdf");
  if (!fs.existsSync(notes)) {
    const ts = fs.readFileSync(path.join(REPO, "src/modules/medreport/connectors/file-import/samples/generated/priya-nair-notes.pdf.b64.ts"), "utf8");
    const m = ts.match(/"([A-Za-z0-9+\/=]{1000,})"/) || ts.match(/`([A-Za-z0-9+\/=\s]{1000,})`/);
    fs.writeFileSync(notes, Buffer.from(m[1].replace(/\s+/g, ""), "base64"));
  }
  return { northfield, notes };
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(keyB32, at = Date.now()) {
  const key = base32Decode(keyB32);
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}
const usedCodes = {};
/** A code from a 30-second window not used before by this account (servers may refuse a replayed code). */
async function freshCode(who) {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    const window = Math.floor(Date.now() / 30000);
    if (left > 3000 && usedCodes[who.email] !== window) {
      usedCodes[who.email] = window;
      return totp(state[who.email].key);
    }
    await new Promise((r) => setTimeout(r, left + 300));
  }
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)${detail ? ` – ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 600) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 600)}`);
    throw err;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);

function watch(page, problems, label) {
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${label} console: ${m.text().slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) problems.push(`${label} ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
}

async function acceptInvite(page, link, who) {
  await page.goto(link);
  await page.waitForSelector("text=Create your account");
  await page.fill("#f-name", who.name);
  await page.fill("#f-password", state[who.email].password);
  await page.fill("#f-confirm", state[who.email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
  await page.waitForSelector("button:has-text('Set up two-step verification')");
  await page.fill("#f-password", state[who.email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  state[who.email].key = (await page.locator("code").first().innerText()).trim();
  save();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(who));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`, { timeout: 30000 });
}

async function signIn(page, who, next) {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill("#f-email", who.email);
  await page.fill("#f-password", state[who.email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=6-digit code");
  await page.fill("#f-code", await freshCode(who));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}${next}`, { timeout: 30000 });
}

/** Resolve or acknowledge every open gap on the review screen (as the demo scripts do). */
async function resolveEverything(app) {
  const keys = await app.$$eval("[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
  let actions = 0;
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    for (let guard = 0; guard < 6; guard++) {
      const quick = card.getByRole("button", { name: "Mark resolved" });
      if ((await quick.count()) && !(await card.locator("form").count())) {
        await quick.first().click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      const res = card.getByRole("button", { name: /^Resolve$/ });
      if (await res.count()) {
        await res.first().click();
        const ta = card.locator("form textarea").last();
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
        await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await ack.first().click();
        await card.locator("form textarea").last().fill("Not recorded in the notes; returned without it after checking with the clinician.");
        await card.locator("form").getByRole("button", { name: /Acknowledge/ }).last().click();
        await app.waitForTimeout(300);
        actions++;
        continue;
      }
      break;
    }
  }
  return actions;
}

/** The clinician answers every required question the notes did not answer (Flags: "Missing field"). */
async function answerMissing(app) {
  await app.getByRole("tab", { name: /Flags/ }).click();
  await app.waitForTimeout(500);
  const flags = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
  const keys = Array.from(new Set(Array.from(flags.matchAll(/Missing field\s+\(blocks approval\)\s*F\W?(\d+)/g)).map((m) => `F-${m[1]}`)));
  console.log(`   missing fields: ${keys.join(", ") || "(none found)"}`);
  const answered = [];
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    await card.scrollIntoViewIfNeeded();
    const text = await card.innerText();
    const radios = card.locator("input[type=radio]");
    if (await radios.count()) {
      const yes = card.getByLabel("Yes", { exact: true });
      if (await yes.count()) await yes.first().check();
      else await radios.first().check();
      answered.push(`${key}:choice`);
    } else if (await card.locator("textarea").count()) {
      await card.locator("textarea").first().fill(/Number/.test(text) ? "1" : "ZZ-REF-0001 (fictional test reference)");
      answered.push(`${key}:text`);
    } else if (await card.locator("input[type=text], input:not([type])").count()) {
      await card.locator("input[type=text], input:not([type])").first().fill(/Number/.test(text) ? "1" : "ZZ-REF-0001 (fictional)");
      answered.push(`${key}:input`);
    }
    await card.locator("h3").first().click();
    await app.waitForTimeout(500);
  }
  return answered;
}

/**
 * A drafted answer that still blocks approval (e.g. opinion wording the cited note does not contain): the clinician
 * removes the drafted paragraphs and answers in their own words, as a clinician would.
 */
async function rewriteBlocked(app) {
  await app.getByRole("tab", { name: /Flags/ }).click();
  await app.waitForTimeout(500);
  const flags = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
  const blocking = flags.split(/Resolved and acknowledged/)[0];
  const keys = Array.from(new Set(Array.from(blocking.matchAll(/Go to\s*F\W?(\d+)/g)).map((m) => `F-${m[1]}`)));
  const rewritten = [];
  for (const key of keys) {
    const card = app.locator(`[id='q-${key}']`);
    await card.scrollIntoViewIfNeeded();
    const remove = card.locator("button[aria-label^='Remove paragraph']");
    for (let guard = 0; guard < 8 && (await remove.count()); guard++) {
      await remove.first().click();
      await app.waitForTimeout(300);
    }
    // With every drafted paragraph removed the card shows an empty answer box; otherwise add one.
    const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
    if (await add.count()) {
      await add.first().click();
      await app.waitForTimeout(200);
    }
    if (await card.locator("textarea").count()) {
      await card.locator("textarea").last().fill("In my opinion the claimant has made a full recovery; no further treatment is expected (fictional test answer).");
      await card.locator("h3").first().click();
      await app.waitForTimeout(500);
      rewritten.push(key);
    }
  }
  return rewritten;
}

async function storageReport(page) {
  return page.evaluate(async () => {
    const local = Object.keys(localStorage);
    const session = Object.keys(sessionStorage);
    let dbs = [];
    try {
      dbs = (await indexedDB.databases()).map((d) => d.name);
    } catch {
      dbs = ["(databases() unavailable)"];
    }
    return { local, session, dbs };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const ownerState = path.join(OUT, "owner-a.storage.json");
  const clinState = path.join(OUT, "clinician.storage.json");
  const inputs = await prepareInputs();
  try {
    /* ------------------------------------------------------------------ setup */
    if (PHASE === "all" || PHASE === "setup") {
      for (const who of [OWNER_A, CLIN, OWNER_B]) state[who.email] = state[who.email] || { password: `e2e ${crypto.randomBytes(12).toString("base64url")} pw` };
      save();
      const ctxO = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      const owner = await ctxO.newPage();
      watch(owner, problems, "ownerA");
      await step("owner A: accept invitation, account, two-step → /app", async () => {
        await acceptInvite(owner, linkFrom("a"), OWNER_A);
        await shot(owner, "01-owner-overview");
        assert((await owner.locator("header nav a[href='/app/settings/activity']").count()) === 1, "Activity in the clinic navigation");
      });
      await step("owner A: clinic details + drafting from the notes switched on", async () => {
        await owner.goto(`${BASE}/app/settings/clinic`);
        await owner.fill("#f-address", "1 Fictional Street\nTestville");
        await owner.fill("input[name=postcode]", "MK9 2FZ");
        await owner.fill("input[name=phone]", "01234 567890");
        await owner.fill("input[name=email]", "referrals@example.com");
        assert(!(await owner.isChecked("#f-drafting")), "drafting is off for a new clinic");
        await owner.check("#f-drafting");
        await owner.click("button[type=submit]:has-text('Save clinic details')");
        await owner.waitForSelector("text=Saved.");
        await owner.reload();
        assert(await owner.isChecked("#f-drafting"), "drafting stays on after reload");
        await shot(owner, "02-clinic-settings-drafting-on");
      });
      await step("owner A: invite a clinician (link shown: email is off)", async () => {
        await owner.goto(`${BASE}/app/settings/members`);
        await owner.fill("input[name=email]", CLIN.email);
        await owner.selectOption("form:has(input[name=email]) select[name=role]", "clinician");
        await owner.click("button[type=submit]:has-text('Invite')");
        const code = owner.locator("code").filter({ hasText: "/accept-invite?token=" }).first();
        await code.waitFor({ timeout: 20000 });
        state.clinLink = (await code.innerText()).trim();
        save();
      });
      await owner.context().storageState({ path: ownerState });

      const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      const clin = await ctxC.newPage();
      watch(clin, problems, "clinician");
      await step("clinician: accept invitation, account, two-step → /app", async () => {
        await acceptInvite(clin, state.clinLink, CLIN);
      });
      await step("owner A: clinician's HCPC number and 'may sign'", async () => {
        await owner.goto(`${BASE}/app/settings/members`);
        const row = owner.locator("li", { has: owner.locator(`p:text-is("${CLIN.email}")`) }).first();
        await row.locator("summary:has-text('Manage')").click();
        await row.locator("input[name=jobTitle]").fill(CLIN.job);
        await row.locator("input[name=hcpcNumber]").fill(CLIN.hcpc);
        await row.locator("input[name=canSign]").check();
        await row.locator("button:has-text('Save signing details')").click();
        await row.locator("text=Saved.").waitFor({ timeout: 20000 });
        await owner.reload();
        const text = await owner.locator("li", { has: owner.locator(`p:text-is("${CLIN.email}")`) }).first().innerText();
        assert(/HCPC ZZ0001/.test(text) && /May sign/.test(text), `member row: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
        await shot(owner, "03-members-signing");
      });
      await ctxC.storageState({ path: clinState });
      await ctxO.close();
      await ctxC.close();
    }

    /* ------------------------------------------------------------------ flow */
    if (PHASE === "all" || PHASE === "flow") {
      const ctxC = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, storageState: clinState });
      const app = await ctxC.newPage();
      watch(app, problems, "clinician");
      const apiCalls = [];
      app.on("request", (r) => {
        const u = r.url();
        if (u.startsWith(`${BASE}/api/reports/v1/`)) apiCalls.push(`${r.method()} ${u.replace(BASE, "").replace(/\?.*$/, "")} auth=${r.headers()["authorization"] ? "bearer" : "none"}`);
      });

      const resume = process.env.RESUME === "1" && state.reportId;
      if (resume) {
        await app.goto(state.reportUrl);
        await app.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
        await app.waitForTimeout(2000);
      }
      if (!resume) await step("clinician: Studio home shows the clinic and the member", async () => {
        await app.goto(`${BASE}/app/studio`);
        await app.waitForSelector("text=Completed and in-progress forms", { timeout: 30000 });
        const head = await app.locator("header").first().innerText();
        assert(/ZZ W2 E2E Clinic A/.test(head), "clinic name in header");
        await shot(app, "04-studio-home");
      });

      if (!resume) await step("clinician: upload the Northfield fillable PDF, analyse, confirm the map", async () => {
        await app.goto(`${BASE}/app/studio/forms`);
        await app.waitForSelector("text=Upload a referrer form");
        await app.locator("button:has-text('Upload a referrer form')").first().click();
        await app.waitForSelector("text=Drop the form here, or choose a file");
        await app.locator("[role=dialog] input[type=file]").setInputFiles(inputs.northfield);
        await app.getByRole("button", { name: /Analyse form|Analyse again/ }).waitFor();
        await app.fill("#upload-referrer", "Northfield Assurance (fictional)");
        await app.selectOption("#upload-referrer-type", "insurer");
        const t = Date.now();
        await app.getByRole("button", { name: /Analyse form|Analyse again/ }).click();
        await app.getByRole("button", { name: "Review the mapping" }).waitFor({ timeout: 300000 });
        const analysed = await app.locator("[role=dialog]").innerText();
        await shot(app, "05-form-analysed");
        await app.getByRole("button", { name: "Review the mapping" }).click();
        await app.waitForURL(/\/app\/studio\/forms\/[^/]+$/, { timeout: 30000 });
        state.formUrl = app.url();
        save();
        await app.getByRole("button", { name: "Confirm mapping" }).first().click();
        const dlg = app.getByRole("dialog");
        await dlg.waitFor();
        const by = await dlg.locator("#confirm-by").inputValue().catch(() => "");
        const problemsText = await dlg.innerText();
        assert(!/Fix these first/.test(problemsText), `mapping problems: ${problemsText.slice(0, 400)}`);
        await dlg.locator("input[type=checkbox]").check();
        await dlg.getByRole("button", { name: "Confirm mapping" }).click();
        await dlg.waitFor({ state: "detached", timeout: 30000 });
        await app.waitForTimeout(1500);
        await shot(app, "06-form-confirmed");
        const page = await app.locator("main").innerText();
        assert(/Confirmed/i.test(page), "confirmed state shown");
        return { analyseSeconds: Math.round((Date.now() - t) / 1000), confirmedBy: by, analysedSummary: analysed.replace(/\s+/g, " ").slice(0, 300) };
      });

      if (!resume) await step("clinician: notes upload (printed notes PDF) → check what was imported", async () => {
        await app.goto(`${BASE}/app/studio/new`);
        await app.waitForSelector("text=Drop the patient's notes here");
        await app.locator("input[type=file]").first().setInputFiles(inputs.notes);
        await app.waitForSelector("text=Check what was imported", { timeout: 60000 });
        await shot(app, "07-notes-imported");
      });

      if (!resume) await step("clinician: choose the Northfield form → draft LIVE (no passcode) → review", async () => {
        await app.getByRole("button", { name: "Choose the referrer form" }).click();
        const radio = app.getByRole("radio", { name: /Rehabilitation Progress Report|Northfield/ }).first();
        await radio.waitFor({ timeout: 20000 });
        await radio.click();
        await shot(app, "08-choose-form");
        const t = Date.now();
        await app.getByRole("button", { name: "Complete this form" }).click();
        await app.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 600000 });
        state.reportUrl = app.url();
        state.reportId = state.reportUrl.split("/").pop();
        save();
        await app.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
        await app.waitForTimeout(2500);
        const header = await app.locator("main").innerText();
        await shot(app, "09-review-draft");
        const passcodeSent = apiCalls.some((c) => /drafts/.test(c)) ? "drafts called" : "no drafts call";
        return { draftSeconds: Math.round((Date.now() - t) / 1000), liveBadge: /drafted|Drafted/.test(header), passcodeSent };
      });

      await step("review: drafting was live (generation meta) and there is no passcode or demo session", async () => {
        const report = await app.evaluate(async (id) => {
          const r = await fetch(`/api/reports/v1/store/reports/${id}`);
          return { status: r.status, body: await r.json() };
        }, state.reportId);
        assert(report.status === 200, `store GET ${report.status}`);
        const gens = report.body.report.generation || [];
        const modes = Array.from(new Set(gens.map((g) => g.mode)));
        const gen = { mode: modes.join("+"), model: Array.from(new Set(gens.map((g) => g.model))).join("+"), groups: gens.length };
        state.reportJson = report.body.report;
        save();
        assert(modes.length === 1 && modes[0] === "live", `generation modes ${gen.mode}`);
        assert(report.body.report.tenantId === `zz-w2-e2e-${N}`, `report tenant ${report.body.report.tenantId}`);
        const bearer = apiCalls.filter((c) => /auth=bearer/.test(c));
        assert(bearer.length === 0, `requests with a bearer: ${bearer.slice(0, 5).join(", ")}`);
        assert(!apiCalls.some((c) => /sessions\/demo/.test(c)), "no demo session minted");
        return { mode: gen.mode, groups: gen.groups, model: gen.model, tenant: report.body.report.tenantId, rev: report.body.rev };
      });

      await step("review: resolve every gap, approve as the clinician (signer from the profile)", async () => {
        const acted = await resolveEverything(app);
        await app.waitForTimeout(800);
        const answered = await answerMissing(app);
        await app.waitForTimeout(800);
        const acted2 = await resolveEverything(app);
        await app.waitForTimeout(800);
        const rewritten = await rewriteBlocked(app);
        const acted3 = rewritten.length ? await resolveEverything(app) : 0;
        await app.waitForTimeout(1500);
        const blocked = await app.locator("#approve-blocked").innerText().catch(() => "");
        assert(!/to resolve/.test(blocked), `still blocked: ${blocked}`);
        await shot(app, "10-review-resolved");
        await app.getByRole("button", { name: /^Approve/ }).first().click();
        const dlg = app.getByRole("dialog");
        await dlg.waitFor();
        await app.waitForTimeout(400);
        const name = dlg.getByLabel("Full name", { exact: true });
        const hcpc = dlg.getByLabel("HCPC registration number");
        const nameVal = await name.inputValue();
        const hcpcVal = await hcpc.inputValue();
        assert(nameVal === CLIN.name, `prefilled name ${nameVal}`);
        assert(hcpcVal === CLIN.hcpc, `prefilled HCPC ${hcpcVal}`);
        const readOnly = (await name.getAttribute("readonly")) !== null || (await name.isDisabled());
        await dlg.getByLabel(/Typed signature/).fill(nameVal);
        const boxes = dlg.locator("input[type=checkbox]");
        for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
        await shot(app, "11-approve-dialog");
        await dlg.getByRole("button", { name: /Approve and sign/ }).click();
        await app.getByText("Approved – the completed form is final").waitFor({ timeout: 60000 });
        await app.waitForTimeout(1500);
        await shot(app, "12-approved");
        const banner = await app.getByText(/Approved by/).first().innerText();
        assert(banner.includes(CLIN.name) && banner.includes(CLIN.hcpc), `banner ${banner}`);
        return { gapActions: acted + acted2 + acted3, answeredByClinician: answered, rewrittenByClinician: rewritten, signerReadOnly: readOnly, banner: banner.replace(/\s+/g, " ").slice(0, 160) };
      });

      await step("download the final completed form (PDF)", async () => {
        const [d] = await Promise.all([app.waitForEvent("download", { timeout: 120000 }), app.getByRole("button", { name: "Completed form (PDF)" }).click()]);
        const file = path.join(OUT, `final-${d.suggestedFilename()}`);
        await d.saveAs(file);
        const head = fs.readFileSync(file).subarray(0, 5).toString();
        assert(head === "%PDF-", "a PDF");
        return { file: path.basename(file), bytes: fs.statSync(file).size };
      });

      await step("reload: the approved report comes back from the server; no patient data in browser storage", async () => {
        await app.reload();
        await app.getByText("Approved – the completed form is final").waitFor({ timeout: 60000 });
        const st = await storageReport(app);
        const patientKeys = st.local.filter((k) => /^medreport\.(report\.|forms)/.test(k));
        assert(patientKeys.length === 0, `localStorage: ${patientKeys.join(", ")}`);
        assert(st.dbs.indexOf("medreport-forms") < 0, `IndexedDB: ${st.dbs.join(", ")}`);
        await shot(app, "13-after-reload");
        return st;
      });

      await step("a second browser context (fresh sign-in) opens the same approved report", async () => {
        const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const p2 = await ctx2.newPage();
        watch(p2, problems, "clinician-2nd");
        await signIn(p2, CLIN, `/app/studio/${state.reportId}`);
        await p2.getByText("Approved – the completed form is final").waitFor({ timeout: 60000 });
        await p2.waitForTimeout(1000);
        await shot(p2, "14-second-context");
        const st = await storageReport(p2);
        assert(st.local.filter((k) => /^medreport\.(report\.|forms)/.test(k)).length === 0, "no patient data in localStorage (2nd context)");
        await ctx2.close();
        return { localKeys: st.local, dbs: st.dbs };
      });

      await step("public demo in the same signed-in browser still works (Megan Hart → Harrow & Pike)", async () => {
        const sb = await ctxC.newPage();
        watch(sb, problems, "clinician-demo");
        await sb.goto(`${BASE}/pms-sandbox/patients/sim-pat-001`);
        await sb.waitForLoadState("networkidle");
        const [popup] = await Promise.all([ctxC.waitForEvent("page"), sb.getByRole("button", { name: /Complete referrer's report form/ }).click()]);
        watch(popup, problems, "clinician-demo-popup");
        await popup.getByText(/Imported from Simulated TM3/).waitFor({ timeout: 60000 });
        await popup.getByRole("button", { name: "Choose the referrer form" }).click();
        await popup.getByRole("radio", { name: /Harrow & Pike/ }).click();
        await popup.getByRole("button", { name: "Complete this form" }).click();
        await popup.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 180000 });
        await popup.locator("#q-F-07").waitFor({ timeout: 60000 });
        await shot(popup, "15-demo-while-signed-in");
        const st = await storageReport(popup);
        await popup.close();
        await sb.close();
        return { demoReport: popup.url().replace(BASE, ""), demoLocalKeys: st.local.filter((k) => k.startsWith("medreport.report.")).length };
      });

      await step("owner A: activity page shows the clinic's actions", async () => {
        const ctxO = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: ownerState });
        const owner = await ctxO.newPage();
        watch(owner, problems, "ownerA");
        await owner.goto(`${BASE}/app/settings/activity`);
        await owner.waitForSelector("h1:has-text('Activity')");
        await shot(owner, "16-activity-owner");
        const want = {
          "file.upload": "Form file uploaded",
          "form.confirm": "Form mapping confirmed",
          "report.create": "Report started",
          "report.draft_live": "Answers drafted from the notes",
          "report.sign": "Report approved",
          "report.render_final": "Final document produced",
          "member.invite": "Member invited",
          "member.profile_update": "Signing details updated",
          "clinic.update": "Clinic details updated",
        };
        const missing = [];
        const seen = {};
        for (const [code, label] of Object.entries(want)) {
          await owner.goto(`${BASE}/app/settings/activity?action=${encodeURIComponent(code)}`);
          await owner.waitForSelector("h1:has-text('Activity')");
          const entries = await owner.evaluate(() => {
            const main = document.querySelector("main").cloneNode(true);
            main.querySelectorAll("select, option").forEach((el) => el.remove());
            return main.textContent || "";
          });
          const n = entries.split(label).length - 1;
          seen[code] = n;
          if (n === 0) missing.push(code);
          if (code === "report.draft_live") {
            await shot(owner, "16b-activity-owner-drafting");
            seen.draftTargetsReport = /Report …/.test(entries) || /Report \u2026/.test(entries);
          }
        }
        // The owner can read the clinic's report too (same clinic).
        const own = await owner.evaluate(async (id) => (await fetch(`/api/reports/v1/store/reports/${id}`)).status, state.reportId);
        await ctxO.close();
        assert(missing.length === 0, `missing on the activity page: ${missing.join(", ")}`);
        assert(own === 200, `owner GET report ${own}`);
        return seen;
      });

      await step("clinician: activity page shows only their own entries", async () => {
        await app.goto(`${BASE}/app/settings/activity`);
        await app.waitForSelector("h1:has-text('Activity')");
        // Entries only (the action filter's <select> lists every label).
        const text = await app.evaluate(() => {
          const main = document.querySelector("main").cloneNode(true);
          main.querySelectorAll("select, option").forEach((el) => el.remove());
          return main.textContent || "";
        });
        await shot(app, "17-activity-clinician");
        assert(/Report approved/.test(text), "own approval listed");
        assert(!/Member invited/.test(text), "owner's actions not listed for a clinician");
      });

      fs.writeFileSync(path.join(OUT, "api-calls.txt"), apiCalls.join("\n"));
      await ctxC.close();
    }

    /* ------------------------------------------------------------------ isolation */
    if (PHASE === "all" || PHASE === "isolation") {
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const b = await ctxB.newPage();
      watch(b, problems, "ownerB");
      await step("clinic B owner: accept invitation, two-step", async () => {
        await acceptInvite(b, linkFrom("b"), OWNER_B);
      });
      await step("clinic B cannot see or use clinic A's report (API 404/403)", async () => {
        const report = state.reportJson;
        const sha = report.form && report.form.fileSha256;
        const r = await b.evaluate(
          async ({ id, report, sha }) => {
            const get = await fetch(`/api/reports/v1/store/reports/${id}`);
            const snap = await (await fetch(`/api/reports/v1/store/snapshot`)).json();
            const file = sha ? (await fetch(`/api/reports/v1/store/files/${sha}`)).status : null;
            const render = await fetch(`/api/reports/v1/render?format=pdf`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ report }),
            });
            const put = await fetch(`/api/reports/v1/store/reports/${id}`, {
              method: "PUT",
              headers: { "content-type": "application/json", "if-match": '"1"' },
              body: JSON.stringify({ report }),
            });
            return {
              get: get.status,
              snapshotTenant: snap.tenantId,
              snapshotReports: (snap.reports || []).length,
              file,
              render: render.status,
              renderCode: (await render.json().catch(() => ({}))).code,
              putIntoB: put.status,
            };
          },
          { id: state.reportId, report, sha },
        );
        await b.goto(`${BASE}/app/studio/${state.reportId}`);
        await b.waitForSelector("text=This report was not found", { timeout: 30000 });
        await shot(b, "18-clinic-b-not-found");
        assert(r.get === 404, `GET ${r.get}`);
        assert(r.snapshotReports === 0, `B snapshot has ${r.snapshotReports} reports`);
        assert(r.render === 403 && r.renderCode === "TENANT_MISMATCH", `render ${r.render} ${r.renderCode}`);
        return r;
      });
      await ctxB.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, `results-${PHASE}.json`), JSON.stringify({ results, problems }, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} steps passed; ${problems.length} problems`);
    for (const p of problems.slice(0, 30)) console.log(`  ${p}`);
    await browser.close();
  }
})().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
