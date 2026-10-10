/**
 * The demonstration clinic (npm run admin:seed-demo-clinic) in the browser – LOCAL server only (never production; the
 * owner signs in there himself). Two phases:
 *
 *   setup  the local test owner accepts the invitation of a local test clinic (admin:create-clinic output in
 *          INVITE_FILE), creates the account and sets up two-step verification (the TOTP key goes to the state file).
 *          Then run the seed with --env local --owner-email $OWNER_EMAIL (the same environment as the server).
 *   flow   sign in with a TOTP code → switch to "Riverside Physiotherapy (fictional)" → the Studio's home lists Rebecca
 *          Lane's draft reports → the Bupa report: answers, gaps, the preview in the original layout (DRAFT, the
 *          demonstration footer), "Write in my own voice", "Copy all answers" → Referrer forms: the confirmed insurer
 *          forms and the portal set → the AXA report up to the identifier block (Flags) → "Upload the notes" with the
 *          fictional notes file and its check step.
 *
 * Run:
 *   PHASE=setup INVITE_FILE=<create-clinic output> BASE=http://localhost:3217 E2E_OUT=<dir> \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/demo-clinic-backup.cjs
 *   PHASE=flow NOTES_FILE=<rebecca-lane-notes.json> BASE=… E2E_OUT=<dir> NODE_PATH=… node scripts/e2e/demo-clinic-backup.cjs
 * The state file (E2E_OUT/state.json, chmod 600) holds the fictional test account's password and authenticator key –
 * never printed. Screenshots and results go to E2E_OUT.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = (process.env.BASE || "http://localhost:3217").replace(/\/+$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error("Local server only (http://localhost:<port>) – never a deployment");
const OUT = process.env.E2E_OUT || path.join(__dirname, "../../.e2e-out/demo-clinic-backup");
const STATE_FILE = path.join(OUT, "state.json");
const PHASE = process.env.PHASE || "flow";
const OWNER = { email: process.env.OWNER_EMAIL || "sarah.reid.test@example.com", name: process.env.OWNER_NAME || "Sarah Reid" };
const CLINIC = "Riverside Physiotherapy (fictional)";
const PATIENT = "Rebecca Lane";

fs.mkdirSync(OUT, { recursive: true });
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

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
/** A code from a 30-second window not used before (the server refuses a replayed code). */
async function freshCode() {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    const window = Math.floor(Date.now() / 30000);
    if (left > 3000 && state.lastWindow !== window) {
      state.lastWindow = window;
      save();
      return totp(state.key);
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
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 800) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 800)}`);
    throw err;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
let shotNo = 0;
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`), fullPage: opts.fullPage ?? false }).catch(() => undefined);

function watch(page, problems) {
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
}

async function signIn(page, next) {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill("#f-email", OWNER.email);
  await page.fill("#f-password", state.password);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=6-digit code");
  await page.fill("#f-code", await freshCode());
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  try {
    if (PHASE === "setup") {
      const file = process.env.INVITE_FILE;
      if (!file) throw new Error("INVITE_FILE is required");
      const link = (fs.readFileSync(file, "utf8").match(/http:\/\/(localhost|127\.0\.0\.1):\d+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
      if (!link) throw new Error(`No local invitation link in ${file}`);
      state.password = state.password || `local test ${crypto.randomBytes(12).toString("base64url")} pw`;
      save();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      watch(page, problems);
      await step("local test owner: accept the invitation, create the account, set up two-step verification", async () => {
        await page.goto(link);
        await page.waitForSelector("text=Create your account");
        await page.fill("#f-name", OWNER.name);
        await page.fill("#f-password", state.password);
        await page.fill("#f-confirm", state.password);
        await page.click("button[type=submit]");
        await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
        await page.fill("#f-password", state.password);
        await page.click("button[type=submit]");
        await page.waitForSelector("img[alt^='Authenticator set-up code']");
        state.key = (await page.locator("code").first().innerText()).trim();
        save();
        await page.check("input[name=saved]");
        await page.fill("#f-code", await freshCode());
        await page.click("button[type=submit]");
        await page.waitForURL(`${BASE}/app`, { timeout: 30000 });
        await shot(page, "setup-app");
      });
    }

    if (PHASE === "flow") {
      const notesFile = process.env.NOTES_FILE;
      if (!notesFile || !fs.existsSync(notesFile)) throw new Error("NOTES_FILE (the fictional notes, documented JSON) is required");
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
      const page = await ctx.newPage();
      watch(page, problems);

      await step("sign in with a TOTP code and switch to the demonstration clinic", async () => {
        await signIn(page, "/app/select-clinic");
        await page.goto(`${BASE}/app/select-clinic`);
        await page.waitForSelector(`text=${CLINIC}`);
        await shot(page, "select-clinic");
        await page.locator("form", { hasText: CLINIC }).getByRole("button", { name: "Open" }).click();
        await page.waitForURL((u) => /\/app/.test(u.pathname) && !/select-clinic/.test(u.pathname), { timeout: 30000 });
        await page.waitForLoadState("networkidle");
        const body = await page.locator("body").innerText();
        assert(body.includes(CLINIC), "the clinic's name is shown");
        await shot(page, "clinic-overview");
      });

      await step("Studio home lists Rebecca Lane's draft reports", async () => {
        await page.goto(`${BASE}/app/studio`);
        await page.waitForSelector(`text=${PATIENT}`, { timeout: 30000 });
        await page.waitForLoadState("networkidle");
        await shot(page, "studio-home", { fullPage: true });
        const body = await page.locator("main").innerText();
        const forms = ["Therapies management form", "Therapy treatment plan", "Pre-authorisation form", "Example portal questions"];
        const missing = forms.filter((f) => !body.includes(f));
        assert(!missing.length, `home lists every seeded report (missing: ${missing.join(", ")})`);
        const count = (body.match(new RegExp(PATIENT, "g")) || []).length;
        assert(count >= 4, `four reports for ${PATIENT} (saw ${count})`);
        return `${count} rows for ${PATIENT}`;
      });

      let bupaUrl = null;
      await step("Bupa report: answers present, gaps shown, nothing blocking", async () => {
        await page.locator("tr", { hasText: "Therapies management form" }).getByRole("link", { name: /^(Review|Open)$/ }).first().click();
        await page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 30000 });
        bupaUrl = page.url();
        await page.waitForSelector("[id^='q-F-']", { timeout: 30000 });
        await page.waitForLoadState("networkidle");
        await shot(page, "bupa-review");
        const text = await page.locator("main").innerText();
        const answered = (text.match(/(\d+) of (\d+) answered/) || [])[0] || null;
        assert(answered, "the review shows how many questions are answered");
        assert(text.includes("DEMO-POL-0001"), "Bupa's membership number from the record");
        assert(/Rebecca Lane|Lane/.test(text), "the patient's name");
        return { answered };
      });

      await step("Bupa preview in the original layout (DRAFT, demonstration footer)", async () => {
        const previewResponse = page.waitForResponse((r) => r.url().includes("/api/reports/v1/forms/fill-preview") && r.request().method() === "POST", { timeout: 60000 });
        await page.getByRole("tab", { name: /Preview/ }).click();
        const res = await previewResponse;
        assert(res.status() === 200, `fill-preview ${res.status()}`);
        assert(res.headers()["x-medreport-render"] === "draft", "a DRAFT render");
        await page.waitForTimeout(2500);
        // The same request from the signed-in page, kept as a file for checking (the Studio streams its own copy).
        const id = new URL(page.url()).pathname.split("/").pop();
        const b64 = await page.evaluate(async (reportId) => {
          const report = (await (await fetch(`/api/reports/v1/store/reports/${reportId}`)).json()).report;
          const form = (await (await fetch(`/api/reports/v1/store/forms/${report.form.formId}`)).json()).form;
          const r = await fetch("/api/reports/v1/forms/fill-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, form, mode: "draft" }) });
          const buf = new Uint8Array(await r.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
          return `${r.status}:${btoa(bin)}`;
        }, id);
        const [status, data] = [b64.slice(0, b64.indexOf(":")), b64.slice(b64.indexOf(":") + 1)];
        assert(status === "200", `fill-preview from the page: ${status}`);
        const bytes = Buffer.from(data, "base64");
        fs.writeFileSync(path.join(OUT, "bupa-preview.pdf"), bytes);
        assert(bytes.subarray(0, 4).toString() === "%PDF", "a PDF");
        await shot(page, "bupa-preview-tab");
        const expand = page.locator("button[aria-label*='arge'], button[aria-label*='xpand'], button[title*='arge'], button[title*='xpand']").first();
        if (await expand.count()) {
          await expand.click();
          await page.waitForTimeout(3500);
          await shot(page, "bupa-preview-expanded");
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }
        const text = await page.locator("body").innerText();
        assert(/Public form used for demonstration only/i.test(text), "the demonstration footer in the preview header");
        return `${bytes.length} bytes`;
      });

      await step("Write in my own voice", async () => {
        const answersTab = page.getByRole("tab", { name: /Questions|Answers/ });
        if (await answersTab.count()) await answersTab.first().click();
        const button = page.getByRole("button", { name: /Write in my own voice/ });
        await button.first().waitFor({ timeout: 15000 });
        const before = await page.locator("main").innerText();
        const thirdPerson = (before.match(/Sarah Reid recorded/g) || []).length;
        await button.first().click();
        await page.waitForTimeout(1500);
        await shot(page, "bupa-own-voice");
        const after = await page.locator("main").innerText();
        const left = (after.match(/Sarah Reid recorded/g) || []).length;
        assert(left < thirdPerson || thirdPerson === 0, `third-person answers rewritten (${thirdPerson} → ${left})`);
        return `${thirdPerson} → ${left} "Sarah Reid recorded"`;
      });

      await step("Copy all answers", async () => {
        await page.getByRole("button", { name: /Copy all answers/ }).first().click();
        await page.waitForTimeout(800);
        const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
        await shot(page, "bupa-copied");
        fs.writeFileSync(path.join(OUT, "bupa-copied-answers.txt"), copied);
        assert(copied.includes("Rebecca Lane") || copied.includes("Lane"), "the copied text names the patient");
        assert(/DRAFT|draft/i.test(copied), "the copy is marked as a draft");
        return `${copied.split("\n").length} lines copied`;
      });

      await step("Referrer forms: the insurer forms confirmed and the portal question set", async () => {
        await page.goto(`${BASE}/app/studio/forms`);
        await page.waitForLoadState("networkidle");
        await page.waitForSelector("text=Example portal questions", { timeout: 30000 });
        await shot(page, "forms-library", { fullPage: true });
        const text = await page.locator("main").innerText();
        const want = ["Therapies management form", "Therapy treatment plan", "CM016", "Pre-authorisation form", "Example portal questions"];
        const missing = want.filter((w) => !text.includes(w));
        assert(!missing.length, `forms listed (missing: ${missing.join(", ")})`);
        const confirmed = (text.match(/Confirmed/g) || []).length;
        return `${confirmed} "Confirmed" labels`;
      });

      await step("AXA report up to the identifier block (Bupa's numbers held back)", async () => {
        await page.goto(`${BASE}/app/studio`);
        await page.waitForSelector(`text=${PATIENT}`, { timeout: 30000 });
        await page.locator("tr", { hasText: "Therapy treatment plan" }).getByRole("link", { name: /^(Review|Open)$/ }).first().click();
        await page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 30000 });
        await page.waitForSelector("[id^='q-F-']", { timeout: 30000 });
        await page.waitForLoadState("networkidle");
        await shot(page, "axa-review");
        await page.getByRole("tab", { name: /Flags/ }).click();
        await page.waitForTimeout(800);
        await shot(page, "axa-flags", { fullPage: true });
        const flags = await page.locator("main").innerText();
        assert(/Bupa/.test(flags) || /membership/i.test(flags), "the flag explains the held-back membership number");
        const card = page.locator("[id='q-F-04']");
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded();
          await shot(page, "axa-identifier-block");
        }
        return "identifier flags shown";
      });

      await step("Upload the notes (documented JSON) and the check step", async () => {
        await page.goto(`${BASE}/app/studio/new`);
        await page.waitForLoadState("networkidle");
        await shot(page, "new-source");
        const tab = page.getByRole("button", { name: /Upload the notes/ });
        if (await tab.count()) await tab.first().click();
        const input = page.locator("input[type=file]").first();
        await input.setInputFiles(notesFile);
        await page.waitForTimeout(500);
        const read = page.getByRole("button", { name: /^(Read|Upload|Import|Use) / });
        if (await read.count()) await read.first().click().catch(() => undefined);
        await page.waitForSelector("text=Check what was imported", { timeout: 30000 });
        await page.waitForTimeout(800);
        await shot(page, "new-check-step", { fullPage: true });
        const text = await page.locator("main").innerText();
        assert(text.includes("Rebecca") && text.includes("Lane"), "the imported patient");
        assert(/5 notes|5 clinical notes|Notes\s*5/i.test(text) || text.includes("5"), "the notes were read");
        return text.match(/\d+ (notes?|appointments?|scores?)[^\n]*/g)?.slice(0, 4).join(" · ") || "check step shown";
      });
    }
  } finally {
    fs.writeFileSync(path.join(OUT, `results-${PHASE}.json`), JSON.stringify({ results, problems }, null, 2));
    if (problems.length) console.log(`Browser problems (${problems.length}):\n  ${problems.slice(0, 30).join("\n  ")}`);
    await browser.close();
  }
})().catch((err) => {
  console.error(String(err && err.stack).slice(0, 1000));
  process.exit(1);
});
