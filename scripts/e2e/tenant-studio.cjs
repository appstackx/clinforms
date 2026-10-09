/**
 * Browser smoke test of a clinic's own Studio (/app/studio, tenant mode) – for the integrator, against the
 * PREVIEW database (never production):
 *
 *   1. signed out, /app/studio → /login?next=%2Fapp%2Fstudio
 *   2. accept the invitation → create the account → /two-factor; /app/studio stays closed until two-step is on
 *   3. two-step set-up (TOTP computed here from the key the page shows) → /app; the overview links to the Studio
 *   4. Studio home: the clinic's name and the member in the header, legal links in the footer; NO demo tools,
 *      Simulated TM3, "Fictional data only", drafting-mode badge or /reports and /pms-sandbox links
 *   5. Complete a form: the notes upload only (no Simulated TM3 picker, no sandbox launch, no samples to try)
 *   6. Referrer forms: no fictional sample forms; the upload dialog opens
 *   7. Batch explains that it needs a connected clinic system; Security goes to the public /security page
 *   8. an unknown report id shows "This report was not found"
 *   9. no analytics request was made (no consent was given in this browser)
 *  10. sign out from the account menu → /login; /app/studio → /login again
 *  11. the public demo at /reports still has its demo tools and fictional-data footer
 *  FLOW=complete adds (needs the server store and the API actor slices): paste fictional notes → check the
 *  data → built-in report → review opens under /app/studio/<id> and says "Saved".
 *
 * Run (app started against the preview database, e.g.
 *   npm run admin:with-env -- --env preview --port 3111 -- npx next start -p 3111):
 *   npm run admin:create-clinic -- --env preview --app-url http://localhost:3111 \
 *     --name "ZZ Studio Selftest (fictional)" --slug zz-studio-selftest-<n> --owner-email zz-studio-owner-<n>@example.com \
 *     > /tmp/invite.txt
 *   INVITE_LINK_FILE=/tmp/invite.txt CLINIC_NAME="ZZ Studio Selftest (fictional)" BASE=http://localhost:3111 \
 *     NODE_PATH=<a node_modules with playwright> node scripts/e2e/tenant-studio.cjs
 *
 * Nothing secret is printed: the password is random per run, codes and links stay in memory. Screenshots and
 * results go to E2E_OUT (default .e2e-out/tenant-studio/, gitignored). Offboard the clinic afterwards
 * (admin:offboard-clinic) – a used id cannot be created again, so pick a new <n> each run.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/+$/, "");
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/tenant-studio");
const FLOW = process.env.FLOW || "smoke";
const CLINIC_NAME = process.env.CLINIC_NAME || "";
const linkFile = process.env.INVITE_LINK_FILE;
if (!linkFile) throw new Error("INVITE_LINK_FILE is required (the output of npm run admin:create-clinic)");
const inviteLink = (fs.readFileSync(linkFile, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._-]+/) || [])[0];
if (!inviteLink) throw new Error("No invitation link in INVITE_LINK_FILE");
if (/clinforms\.co\.uk/.test(BASE) || /clinforms\.co\.uk/.test(inviteLink)) throw new Error("Run this against a preview or local server, never production");
const PASSWORD = `e2e ${crypto.randomBytes(12).toString("base64url")} password`;
const MEMBER_NAME = "Zed Studio Selftest";

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
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 300) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 300)}`);
    throw err;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Demo-only wording that a clinic's Studio must never show. */
const DEMO_ONLY = /\bdemo tools\b|reset demo|simulated tm3|fictional data only|this demo|demo mode|PH-DEMO|In this demo/i;

async function assertTenantPage(page, where) {
  const text = await page.locator("body").innerText();
  const hit = text.match(DEMO_ONLY);
  assert(!hit, `${where}: demo wording "${hit && hit[0]}"`);
  const bad = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter((h) => h && (h.startsWith("/reports") || h.startsWith("/pms-sandbox"))));
  assert(bad.length === 0, `${where}: links into the demo: ${bad.join(", ")}`);
  for (const href of ["/privacy", "/cookies", "/terms", "/security"]) {
    assert((await page.locator(`footer a[href='${href}']`).count()) >= 1, `${where}: footer link ${href}`);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  const analyticsRequests = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
  page.on("request", (r) => {
    const u = r.url();
    if (/\/ingest\/|posthog\.com/.test(u)) analyticsRequests.push(u.replace(/\?.*$/, ""));
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  let key;

  try {
    await step("signed out: /app/studio → /login?next=%2Fapp%2Fstudio", async () => {
      await page.goto(`${BASE}/app/studio`);
      assert(page.url() === `${BASE}/login?next=%2Fapp%2Fstudio`, `at ${page.url()}`);
    });

    await step("accept the invitation → account → /two-factor", async () => {
      await page.goto(inviteLink);
      await page.waitForSelector("text=Create your account");
      await page.fill("#f-name", MEMBER_NAME);
      await page.fill("#f-password", PASSWORD);
      await page.fill("#f-confirm", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForURL(`${BASE}/two-factor`);
    });

    await step("the Studio is closed until two-step verification is on", async () => {
      const other = await ctx.newPage();
      await other.goto(`${BASE}/app/studio/new`);
      assert(other.url() === `${BASE}/two-factor`, `at ${other.url()}`);
      await other.close();
    });

    await step("two-step set-up → /app", async () => {
      await page.waitForSelector("button:has-text('Set up two-step verification')");
      await page.fill("#f-password", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForSelector("img[alt^='Authenticator set-up code']");
      key = base32Decode(await page.locator("code").first().innerText());
      await page.check("input[name=saved]");
      await page.fill("#f-code", await freshCode(key));
      await page.click("button[type=submit]");
      await page.waitForURL(`${BASE}/app`);
    });

    await step("overview links to the Studio (and the nav has it)", async () => {
      assert((await page.locator("main a[href='/app/studio']").count()) === 1, "Open the Studio link");
      assert((await page.locator("header nav a[href='/app/studio']").count()) === 1, "Studio in the clinic navigation");
      await shot("01-overview");
      await page.click("main a[href='/app/studio']");
      await page.waitForURL(`${BASE}/app/studio`);
    });

    await step("Studio home: clinic and member in the header, legal footer, no demo chrome", async () => {
      await page.waitForSelector("text=Completed and in-progress forms");
      if (CLINIC_NAME) assert((await page.locator("[data-studio-clinic]").innerText()).includes(CLINIC_NAME), "clinic name in the header");
      assert((await page.locator("[data-studio-account] summary").innerText()).includes(MEMBER_NAME), "member in the header");
      assert((await page.locator("[data-demo-tools]").count()) === 0, "no demo tools");
      assert((await page.locator("button[aria-label^='Drafting mode']").count()) === 0, "no drafting-mode badge");
      await assertTenantPage(page, "home");
      await shot("02-studio-home");
    });

    await step("Complete a form: the notes upload only", async () => {
      await page.click("header nav[aria-label='Studio'] >> text=Complete a form");
      await page.waitForURL(`${BASE}/app/studio/new`);
      await page.waitForSelector("text=Drop the patient's notes here");
      assert((await page.locator("text=Find a patient in Simulated TM3").count()) === 0, "no Simulated TM3 picker");
      assert((await page.locator("text=Launch from the patient record").count()) === 0, "no sandbox launch");
      assert((await page.locator("text=Try the sample export").count()) === 0, "no samples to try");
      await assertTenantPage(page, "new");
      await shot("03-new");
    });

    await step("Referrer forms: no fictional samples; the upload dialog opens", async () => {
      await page.goto(`${BASE}/app/studio/forms`);
      await page.waitForSelector("text=Upload a referrer form");
      await page.waitForLoadState("networkidle");
      assert((await page.locator("text=Try a new form").count()) === 0, "no fictional samples to try");
      await assertTenantPage(page, "forms");
      await page.locator("button:has-text('Upload a referrer form')").first().click();
      await page.waitForSelector("text=Drop the form here, or choose a file");
      await page.keyboard.press("Escape");
      await shot("04-forms");
    });

    await step("Batch explains it needs a connected system; Security is the public page", async () => {
      await page.goto(`${BASE}/app/studio/batch`);
      await page.waitForSelector("text=Batch needs a connected clinic system");
      await assertTenantPage(page, "batch");
      await page.goto(`${BASE}/app/studio/security`);
      await page.waitForURL(`${BASE}/security`);
    });

    await step("an unknown report id: 'This report was not found'", async () => {
      await page.goto(`${BASE}/app/studio/rpt_does_not_exist`);
      await page.waitForSelector("text=This report was not found", { timeout: 20000 });
      await assertTenantPage(page, "missing report");
    });

    if (FLOW === "complete") {
      await step("complete: paste fictional notes → check the data → built-in report → review under /app/studio", async () => {
        await page.goto(`${BASE}/app/studio/new`);
        await page.fill(
          "#paste-notes",
          [
            "Patient: Robin Selftest",
            "Date of birth: 04/05/1988",
            "Instructing party: Northfield Assurance (fictional)",
            "Instructing party type: insurer",
            "",
            "01/09/2026 – Initial assessment – Zed Studio Selftest (PH-DEMO-02)",
            "S: Right shoulder pain after a fall at home two weeks ago.",
            "O: Flexion 120 degrees, pain at end of range.",
            "A: Rotator cuff strain.",
            "P: Exercises, review in two weeks.",
            "",
            "15/09/2026 – Follow-up – Zed Studio Selftest (PH-DEMO-02)",
            "S: Pain easing, sleeping better.",
            "O: Flexion 150 degrees.",
          ].join("\n"),
        );
        await page.click("button:has-text('Use pasted notes')");
        await page.waitForSelector("text=Check what was imported", { timeout: 30000 });
        await page.click("button:has-text('Choose the referrer form')");
        await page.waitForSelector("text=Which referrer form?");
        await page.click("button:has-text('No form from the referrer? Use a built-in report')");
        await page.locator("button[role=radio]:has-text('Written for')").first().click();
        await page.click("button:has-text('Draft the built-in report')");
        await page.waitForURL(/\/app\/studio\/rpt_/, { timeout: 90000 });
        await page.waitForSelector("text=Saved", { timeout: 30000 });
        await assertTenantPage(page, "review");
        await shot("05-review");
      });
    }

    await step("no analytics request without consent", async () => {
      assert(analyticsRequests.length === 0, `analytics requests: ${analyticsRequests.join(", ")}`);
    });

    await step("sign out from the account menu → /login; the Studio is closed again", async () => {
      await page.goto(`${BASE}/app/studio`);
      await page.click("[data-studio-account] summary");
      await page.click("[data-studio-account] button:has-text('Sign out')");
      await page.waitForURL(/\/login/);
      await page.goto(`${BASE}/app/studio/forms`);
      assert(page.url() === `${BASE}/login?next=%2Fapp%2Fstudio%2Fforms`, `at ${page.url()}`);
    });

    await step("the public demo still has its demo tools and fictional-data footer", async () => {
      await page.goto(`${BASE}/reports`);
      await page.waitForSelector("text=Demo tools");
      await page.waitForSelector("footer >> text=Fictional data only");
      assert((await page.locator("footer a[href='/privacy']").count()) >= 1, "legal links in the demo footer");
      await shot("06-demo");
    });
  } finally {
    await shot("99-final").catch(() => undefined);
    console.log(`final page: ${page.url().replace(/token=[A-Za-z0-9._-]+/, "token=…")}`);
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, problems }, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} steps passed; ${problems.length} page problems`);
    for (const p of problems.slice(0, 10)) console.log(`  ${p}`);
    await browser.close();
  }
})().catch(() => process.exit(1));
