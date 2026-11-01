/**
 * Journey A2 (01/11/2026): a brand-new ClinForms-ONLY clinic owner, end to end in a real browser, LOCAL only.
 * Requirements checked (Khuram 01/11/2026):
 *   R2  a ClinForms-only customer sees ClinForms branding and host throughout, PLUS a promotion offering the full clinic
 *       system (ClinDesk) with a way to go for it (owners/admins).
 *   R3  every page, email, redirect and return URL shows the right product name and host for its brand.
 *
 * Starts its own `next start` (after `npm run build`) on a throwaway SQLite database with the `log` email provider and
 * BOTH brand hosts served (BETTER_AUTH_URL=http://localhost:PORT, CLINFORMS_AUTH_ORIGINS=http://clinic.localhost:PORT –
 * as production serves clinforms.co.uk + clindesk.co.uk), forwards the payment account's TEST-mode webhooks with the
 * provider's CLI and walks:
 *   public site → Request access (submit) → the platform administrator creates the clinic (owner signs in on ClinForms)
 *   and emails the owner invitation → the owner accepts the emailed link, password, two-step → /app → Plan and billing →
 *   ClinForms Starter via the TEST checkout (4242) → success page → every page (Overview, Studio + its pages, Clinic,
 *   Members, Security, Plan & usage, Plan and billing, API keys, Activity, account menu) → Manage billing (return URL)
 *   → sign out → reset password by email → sign in → 404 pages → (01/11/2026, after the fix) the offer card's "Hide
 *   this" (H1) → "See ClinDesk plans" moves the running plan to ClinDesk Solo + Reports 25 in place (U1) → Plan and
 *   billing links to ClinDesk's sign-in and /app hands off to clinic.localhost (U2).
 * The offer card (data-testid=clinic-system-offer) and the ?product=clindesk page are the INTENDED promotion; the
 * public cookie policy's mention of clindesk.co.uk is a deliberate disclosure.
 * On every page / email / redirect: the host stays localhost:PORT (never clinic.localhost), the title, header mark and
 * tab icon say ClinForms, and any "ClinDesk" is recorded with its context (intended promotion or violation).
 *
 *   npm run build
 *   node scripts/e2e/journey-clinforms-only.cjs     [PORT=3402] [E2E_OUT=…]
 *
 * Needs the TEST key in ~/.config/appstackx/clinforms.secrets.env (STRIPE_CLINDESK_TEST_SECRET_KEY – read, never
 * printed) and the `stripe` CLI. Test-mode objects only; the run's test customer ("TEST – …") is deleted at the end.
 * Fictional data only. Results: E2E_OUT/results.json + findings.json + screenshots.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/Users/khuram/Projects/Appstackx/dutydesk/node_modules/playwright"));
}

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3402);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "journey-clinforms-only");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-ja2-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;

const RUN = Date.now().toString(36);
const PLATFORM = "zz-platform-ja2@example.com";
const OWNER = `zz-owner-${RUN}@example.com`;
const CLINIC = { name: "Larkfield Physio (fictional)", slug: `larkfield-${RUN}` };

function testKey() {
  const line = fs
    .readFileSync(path.join(os.homedir(), ".config/appstackx/clinforms.secrets.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("STRIPE_CLINDESK_TEST_SECRET_KEY="));
  const v = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(v)) throw new Error("No TEST key (STRIPE_CLINDESK_TEST_SECRET_KEY) in the secrets file");
  return v;
}
const KEY = testKey();
const rnd = (n = 24) => crypto.randomBytes(n).toString("base64url");
const SECRETS = {
  BETTER_AUTH_SECRET: `test-only-${rnd(32)}`,
  CLINFORMS_DATA_KEYS: JSON.stringify({ t1: crypto.randomBytes(32).toString("base64") }),
  CLINFORMS_DATA_KEY_ID: "t1",
  MEDREPORT_LAUNCH_SECRET: `test-only-launch-${rnd(16)}`,
  MEDREPORT_SIGNING_SECRET: `test-only-signing-${rnd(16)}`,
  MEDREPORT_PARTNER_KEY: `test-only-partner-${rnd(16)}`,
  TM3_SIM_TOKEN: `test-only-sim-${rnd(16)}`,
  CRON_SECRET: `test-only-cron-${rnd(16)}`,
};
let WEBHOOK_SECRET = "";
const users = {};
const results = [];
/** Brand findings: { id, requirement, severity, where, observed, expected }. */
const findings = [];
/** Every ClinDesk mention seen, for the report: { where, context }. */
const mentions = [];
const pages = [];

function finding(requirement, severity, where, observed, expected) {
  const id = `J2-${String(findings.length + 1).padStart(2, "0")}`;
  findings.push({ id, requirement, severity, where, observed, expected });
  console.log(`FINDING ${id} [${severity}] ${requirement} @ ${where}: ${observed}`);
}
async function check(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    results.push({ id, what, pass: false, error: String(err && err.message ? err.message : err).slice(0, 800) });
    console.log(`FAIL ${id} ${what}: ${String(err && err.message ? err.message : err).slice(0, 800)}`);
    for (const [who, page] of pages) await page.screenshot({ path: path.join(OUT, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}

async function api(method, pathname, form) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "stripe-version": "2026-10-28.endive", ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json();
  if (json.livemode === true) throw new Error("live answer refused");
  return json;
}

function appEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    ...SECRETS,
    NODE_ENV: "production",
    PORT: String(PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: FORMS,
    CLINFORMS_AUTH_ORIGINS: DESK,
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
    CLINFORMS_PLATFORM_ADMINS: PLATFORM,
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    STRIPE_CLINDESK_SECRET_KEY: KEY,
    STRIPE_CLINDESK_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...extra,
  };
}
let server = null;
let serverLog = "";
async function startServer() {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: appEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${FORMS}/api/reports/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not come up");
}
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_intent.succeeded",
];
let listener = null;
let listenerLog = "";
function startListener() {
  listener = spawn("stripe", ["listen", "--forward-to", `${FORMS}/api/billing/stripe-webhook`, "--events", EVENTS.join(",")], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  listener.stdout.on("data", (d) => (listenerLog += d));
  listener.stderr.on("data", (d) => (listenerLog += d));
}
function stopChild(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // gone
  }
}

/** The `log` provider's printed messages: [{to, subject, text, links}]. */
function outbox() {
  const out = [];
  const re = /\[email:log\] to=(\S+)(?: reply-to=(\S+))? subject="([^"]*)"\n([\s\S]*?)(?=\n\[email:log\]|\n\{"|$)/g;
  for (const m of serverLog.matchAll(re)) {
    const links = m[4].match(/https?:\/\/[^\s)>"]+/g) || [];
    out.push({ to: m[1], replyTo: m[2] || null, subject: m[3], text: m[4], links });
  }
  return out;
}
const lastMail = (to, subjectRe) => outbox().filter((m) => m.to === to && subjectRe.test(m.subject)).at(-1);

/* ------------------------------------------------------------------ TOTP */
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
  const h = crypto.createHmac("sha1", base32Decode(key)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const usedWindow = {};
async function freshCode(email) {
  for (;;) {
    const w = Math.floor(Date.now() / 30000);
    if (30000 - (Date.now() % 30000) > 3000 && usedWindow[email] !== w) {
      usedWindow[email] = w;
      return totp(users[email].key);
    }
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  }
}

/* ------------------------------------------------------------------ brand audit */
const PROMO_RE = /full clinic|whole clinic|clinic system|clinic management|upgrade|diary|run your/i;
/**
 * Records where the page is and what brand it shows. `expectHost` defaults to localhost:PORT. A ClinDesk mention is
 * classified as promotion when its sentence reads like one (PROMO_RE) – recorded either way for the report.
 */
async function audit(page, label, { expectHost = `localhost:${PORT}`, shot = true, allowNoTitleBrand = false, promoPage = false, deliberateText = false } = {}) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(400);
  const url = new URL(page.url());
  const info = await page.evaluate(() => {
    const icons = [...document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='shortcut icon']")].map((l) => l.getAttribute("href"));
    const marks = [...document.querySelectorAll("[aria-label$=' home'], header a[href='/'], header a[href='/app']")].map((a) => (a.getAttribute("aria-label") || a.textContent || "").trim()).filter(Boolean);
    const hrefs = [...document.querySelectorAll("a[href], form[action]")].map((a) => a.getAttribute("href") || a.getAttribute("action"));
    const imgs = [...document.querySelectorAll("img, svg title")].map((i) => `${i.getAttribute && i.getAttribute("src") ? i.getAttribute("src") : ""} ${i.getAttribute && i.getAttribute("alt") ? i.getAttribute("alt") : i.textContent || ""}`.trim());
    // The offer card (data-testid=clinic-system-offer) IS the intended promotion: its text is read on its own.
    const card = document.querySelector("[data-testid=clinic-system-offer]");
    const promoText = card ? card.innerText : "";
    let text = document.body ? document.body.innerText : "";
    if (promoText) text = text.replace(promoText, " ");
    return { title: document.title, icons, marks, hrefs, imgs, text, promoText, html: document.documentElement.outerHTML };
  });
  const where = `${label} (${url.host}${url.pathname})`;
  if (url.host !== expectHost) finding("R3", "serious", where, `host is ${url.host}`, `host stays ${expectHost}`);
  if (/clindesk/i.test(info.title)) finding("R3", "serious", where, `title "${info.title}"`, "title names ClinForms, never ClinDesk");
  else if (!allowNoTitleBrand && !/clinforms/i.test(info.title)) finding("R3", "minor", where, `title "${info.title}" does not name ClinForms`, "title names the brand (… – ClinForms)");
  const badIcons = info.icons.filter((h) => /clindesk/i.test(h || ""));
  if (badIcons.length) finding("R3", "serious", where, `tab icon(s) ${badIcons.join(", ")}`, "ClinForms' tab icon");
  const badMarks = info.marks.filter((m) => /clindesk/i.test(m));
  if (badMarks.length) finding("R3", "serious", where, `header mark "${badMarks.join(" | ")}"`, "ClinForms mark");
  const badHrefs = info.hrefs.filter((h) => h && /clinic\.localhost|clindesk\.co\.uk/i.test(h));
  // text mentions
  const text = info.text.replace(/\s+/g, " ");
  const ctxs = [];
  for (const m of text.matchAll(/clindesk/gi)) ctxs.push(text.slice(Math.max(0, m.index - 90), m.index + 90));
  for (const c of ctxs) mentions.push({ where, context: c });
  if (info.promoText) mentions.push({ where, context: `offer card: ${info.promoText.replace(/\s+/g, " ").slice(0, 200)}` });
  // promoPage: the ClinDesk plans page a ClinForms owner opens from the offer (?product=clindesk) – ClinDesk on purpose.
  // deliberateText: a public page whose ClinDesk mention is a deliberate disclosure (the shared cookie policy).
  const nonPromo = promoPage || deliberateText ? [] : ctxs.filter((c) => !PROMO_RE.test(c));
  if (nonPromo.length) finding("R2/R3", "serious", where, `"ClinDesk" in page text outside a promotion: …${nonPromo[0]}…${nonPromo.length > 1 ? ` (+${nonPromo.length - 1} more)` : ""}`, "ClinForms only, except an intended upgrade promotion");
  if (badHrefs.length) mentions.push({ where, context: `links to the ClinDesk host: ${badHrefs.join(", ")}` });
  if (badHrefs.length && !info.promoText && !ctxs.some((c) => PROMO_RE.test(c))) finding("R3", "serious", where, `link(s) to the ClinDesk host: ${badHrefs.join(", ")}`, "links stay on localhost (ClinForms)");
  const imgBad = info.imgs.filter((i) => /clindesk/i.test(i));
  if (imgBad.length) finding("R3", "serious", where, `image/logo names ClinDesk: ${imgBad.join(" | ")}`, "ClinForms logo");
  const hiddenHtml = (info.html.replace(/<script[\s\S]*?<\/script>/gi, "").match(/clindesk/gi) || []).length;
  if (shot) await page.screenshot({ path: path.join(OUT, `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`), fullPage: true }).catch(() => {});
  return { url, title: info.title, icons: info.icons, marks: info.marks, text, ctxs, hiddenHtml, hrefs: info.hrefs, promoText: info.promoText.replace(/\s+/g, " ").trim() };
}

/* ------------------------------------------------------------------ checkout helpers */
async function chooseMethod(page, method) {
  const button = page.locator(`[data-testid=${method}-accordion-item-button]`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  if (await button.count()) await button.dispatchEvent("click");
}
async function fillCommon(page, name) {
  const email = page.locator("#email");
  if ((await email.count()) && (await email.isEditable().catch(() => false)) && !(await email.inputValue().catch(() => ""))) await email.fill(OWNER);
  const billingName = page.locator("#billingName");
  if (await billingName.isVisible().catch(() => false)) await billingName.fill(name);
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("GB");
  for (const [sel, v] of [
    ["#billingAddressLine1", "1 Test Street (fictional)"],
    ["#billingLocality", "Milton Keynes"],
    ["#billingPostalCode", "MK9 9ZZ"],
  ]) {
    const f = page.locator(sel);
    if (await f.isVisible().catch(() => false)) await f.fill(v);
  }
}

/* ------------------------------------------------------------------ browser steps */
async function acceptInvite(page, link, email, name, label) {
  users[email] = { password: `e2e ${rnd(12)} password` };
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  if (label) await audit(page, `${label} accept-invite`);
  await page.fill("#f-name", name);
  await page.fill("#f-password", users[email].password);
  await page.fill("#f-confirm", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/two-factor", { timeout: 30000 });
  if (label) await audit(page, `${label} two-factor password`);
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  if (label) {
    const a = await audit(page, `${label} two-factor set-up`);
    const otp = await page.locator("a[href^='otpauth://']").getAttribute("href").catch(() => null);
    if (otp && !/issuer=ClinForms/i.test(otp)) finding("R3", "serious", `${label} two-factor set-up`, `authenticator link ${otp.replace(/secret=[^&]+/, "secret=…")}`, "issuer ClinForms");
    void a;
  }
  users[email].key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const redirects = [];
  const newPage = async (who, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    // Every navigation of the main frame: catch a hop to the ClinDesk host even when it bounces back.
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) {
        const u = f.url();
        redirects.push(`${who} ${u.replace(/token=[^&]+/, "token=…").replace(/session_id=[^&]+/, "session_id=…")}`);
        if (!movedToClinDesk && /clinic\.localhost|clindesk\.co\.uk/i.test(u)) finding("R3", "serious", `${who} navigation`, `browser went to ${u.replace(/token=[^&]+/, "token=…")}`, "stays on localhost");
      }
    });
    pages.push([who, page]);
    return page;
  };
  let customerRef = null;
  const subs = [];
  // Set once the clinic has moved to ClinDesk (M1): from then on it belongs on the ClinDesk host.
  let movedToClinDesk = false;
  let sql = null;
  try {
    WEBHOOK_SECRET = execFileSync("stripe", ["listen", "--print-secret"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY }, encoding: "utf8", timeout: 30000 }).trim();
    assert(/^whsec_[A-Za-z0-9]+$/.test(WEBHOOK_SECRET), "no webhook secret from the CLI");
    // Platform administrator's own home clinic (the script never emails; brand ClinForms by default).
    const cli = execFileSync("npm", ["run", "-s", "admin:create-clinic", "--", "--name", "ZZ Platform Home (fictional)", "--slug", `zz-platform-${RUN}`, "--owner-email", PLATFORM, "--retention-days", "30"], {
      cwd: REPO,
      env: appEnv(),
      encoding: "utf8",
    });
    const platformLink = (cli.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert(platformLink, "platform admin link printed");
    await startServer();
    startListener();
    await new Promise((r) => setTimeout(r, 4000));
    const { openScratchDb } = require("./scratch-db.cjs");
    sql = openScratchDb();
    const one = (q, ...a) => sql.prepare(q).get(...a);

    /* ---------------- P: public site → Request access */
    const visitor = await newPage("visitor");
    await check("P1", "public home on localhost: ClinForms brand, host, title, icon", async () => {
      await visitor.goto(`${FORMS}/`);
      const a = await audit(visitor, "public home");
      assert.match(a.title, /ClinForms/);
      return `title "${a.title}"; icons ${a.icons.join(", ") || "(default)"}; ClinDesk mentions ${a.ctxs.length}`;
    });
    await check("P2", "Request access: the form submits and thanks the visitor (ClinForms page)", async () => {
      const link = visitor.locator("a[href='/request-access']").first();
      await link.click();
      await visitor.waitForURL(`${FORMS}/request-access`);
      await audit(visitor, "public request-access");
      await visitor.fill("[name=clinicName]", CLINIC.name);
      await visitor.fill("[name=contactName]", "Rowan Lark (fictional)");
      await visitor.fill("[name=email]", OWNER);
      await visitor.fill("[name=phone]", "01632 960123");
      const opt = await visitor.locator("select[name=sites] option:not([disabled])").first().getAttribute("value");
      await visitor.selectOption("select[name=sites]", opt);
      await visitor.fill("[name=message]", "Fictional test request – journey A2.");
      await visitor.click("button[type=submit]");
      await visitor.waitForSelector("text=Thank you – we have your request", { timeout: 30000 });
      const a = await audit(visitor, "public request-access thanks");
      return a.url.href;
    });
    await check("P3", "public pages on localhost: demo, security, privacy, terms – ClinForms only", async () => {
      const notes = [];
      for (const p of ["/demo", "/reports", "/security", "/privacy", "/terms", "/cookies"]) {
        const r = await visitor.goto(`${FORMS}${p}`);
        // /cookies names both websites on purpose (shared advertising measurement disclosure – Khuram to confirm).
        const a = await audit(visitor, `public ${p}`, { shot: p === "/demo", deliberateText: p === "/cookies" });
        notes.push(`${p} ${r && r.status()} "${a.title}"`);
      }
      return notes.join("; ");
    });

    /* ---------------- A: platform administrator creates the clinic */
    const admin = await newPage("admin");
    await acceptInvite(admin, platformLink, PLATFORM, "Pat Platform (fictional)");
    await check("A1", "platform page lists the access request", async () => {
      await admin.goto(`${FORMS}/app/platform`);
      const t = await admin.locator("body").innerText();
      assert(t.includes(CLINIC.name), "access request listed");
    });
    let ownerMail = null;
    await check("A2", "platform creates the clinic, owner signs in on ClinForms, invitation emailed", async () => {
      await admin.goto(`${FORMS}/app/platform`);
      await admin.fill("#f-name", CLINIC.name);
      await admin.fill("#f-slug", CLINIC.slug);
      await admin.fill("#f-ownerEmail", OWNER);
      await admin.fill("#f-retentionDays", "30");
      const brandSel = admin.locator("#create-link-brand");
      let opts = "";
      if (await brandSel.count()) {
        opts = (await brandSel.locator("option").allInnerTexts()).join(" | ");
        await brandSel.selectOption("clinforms");
      }
      await admin.check("input[name=sendEmail]");
      await admin.click("button:has-text('Create clinic and invite the owner')");
      await admin.waitForSelector("text=Invitation emailed to", { timeout: 30000 });
      const shown = (await admin.locator("code").first().innerText()).trim();
      ownerMail = lastMail(OWNER, /./);
      assert(ownerMail, "owner email in the outbox");
      const link = ownerMail.links.find((l) => /accept-invite\?token=/.test(l));
      assert(link, "invitation link in the email");
      assert.equal(new URL(link).origin, FORMS, `invitation link origin ${new URL(link).origin}`);
      assert.equal(new URL(shown).origin, FORMS, "shown link origin");
      ownerMail.link = link;
      return `"Owner signs in on" options: ${opts || "(none)"}`;
    });
    await check("E1", "owner invitation email: subject/body name ClinForms, never ClinDesk; links on localhost", async () => {
      assert(ownerMail, "no mail");
      const where = `email to owner "${ownerMail.subject}"`;
      if (/clindesk/i.test(ownerMail.subject + ownerMail.text)) finding("R3", "serious", where, `mentions ClinDesk: ${(ownerMail.subject + " " + ownerMail.text).match(/.{0,60}clindesk.{0,60}/i)[0]}`, "ClinForms only");
      if (!/clinforms/i.test(ownerMail.subject + ownerMail.text)) finding("R3", "minor", where, "does not name ClinForms", "names ClinForms");
      const off = ownerMail.links.filter((l) => !l.startsWith(FORMS) && !/clinforms\.co\.uk/.test(l));
      if (off.length) finding("R3", "serious", where, `links off the ClinForms host: ${off.map((l) => l.replace(/token=[^&]+/, "token=…")).join(", ")}`, "localhost / clinforms.co.uk links");
      return `subject "${ownerMail.subject}"; links ${ownerMail.links.map((l) => l.replace(/token=[^&]+/, "token=…")).join(", ")}`;
    });

    /* ---------------- O: owner joins */
    const owner = await newPage("owner");
    await check("O1", "owner accepts the emailed link, password, two-step → /app on localhost", async () => {
      await acceptInvite(owner, ownerMail.link, OWNER, "Rowan Lark (fictional)", "owner");
      assert.equal(new URL(owner.url()).origin, FORMS);
      return owner.url();
    });
    const clinicRow = () => one("SELECT package, status FROM clinic_entitlements WHERE tenant_id = ?", CLINIC.slug);
    await check("O2", "the new clinic is ClinForms only (reports package, no clinic package)", async () => {
      const rows = sql.prepare("SELECT package, status FROM clinic_entitlements WHERE tenant_id = ?").all(CLINIC.slug);
      const clinicOn = rows.some((r) => r.package === "clinic" && r.status === "active");
      assert(!clinicOn, `clinic package on: ${JSON.stringify(rows)}`);
      return JSON.stringify(rows);
    });
    void clinicRow;

    let promoOverview = null;
    let promoBilling = null;
    await check("O3", "Overview: ClinForms brand; is there a ClinDesk promotion?", async () => {
      await owner.goto(`${FORMS}/app`);
      const a = await audit(owner, "app overview");
      const promo = [...(a.promoText ? [a.promoText] : []), ...a.ctxs.filter((c) => PROMO_RE.test(c))];
      promoOverview = promo.length ? promo : null;
      const generic = /full clinic|whole clinic|clinic management|diary/i.test(a.text);
      // 01/11/2026 (R2): the offer card for owners/admins, with the buy action and the info link.
      const card = owner.locator("[data-testid=clinic-system-offer]");
      assert.equal(await card.count(), 1, "the ClinDesk offer card is on the Overview");
      await owner.screenshot({ path: path.join(OUT, "final-clinforms-overview-offer.png"), fullPage: true });
      assert.equal(await card.locator("a[data-testid=clinic-system-offer-buy]").getAttribute("href"), "/app/settings/billing?product=clindesk");
      const info = card.locator("a[target=_blank]");
      assert.match(await info.getAttribute("href"), /^https:\/\/clindesk\.co\.uk\/features$/);
      return `title "${a.title}"; mark ${a.marks.join(" | ")}; ClinDesk promo: ${promo.length ? promo[0] : "NONE"}; generic clinic-system wording: ${generic}`;
    });

    /* ---------------- B: Plan and billing → ClinForms Starter */
    await check("B1", "Plan and billing defaults to ClinForms plans; record any ClinDesk offer", async () => {
      await owner.goto(`${FORMS}/app/settings/billing`);
      const a = await audit(owner, "plan and billing (no plan)");
      assert(await owner.locator("input[name=tier][value=starter]").count(), "ClinForms tiers offered by default");
      promoBilling = a.promoText || a.ctxs.length ? [...(a.promoText ? [a.promoText] : []), ...a.ctxs] : null;
      assert.equal(await owner.locator("[data-testid=clinic-system-offer]").count(), 1, "the offer card is on Plan and billing");
      const included = await owner.locator("[data-testid=billing-included]").innerText();
      assert.doesNotMatch(included, /clindesk/i, "What is included talks about ClinForms plans only");
      const offerLink = await owner.locator("a[href*='product=clindesk']").count();
      return `ClinDesk mentions: ${a.ctxs.map((c) => `…${c.trim()}…`).join(" || ") || "none"}; link to ClinDesk plans: ${offerLink}`;
    });
    await check("B1b", "?product=clindesk (the in-app offer): what a ClinForms-only owner sees", async () => {
      await owner.goto(`${FORMS}/app/settings/billing?product=clindesk`);
      const a = await audit(owner, "plan and billing clindesk plans", { promoPage: true });
      // V-01 (01/11/2026): no plan yet, Reports on – the smallest Reports add-on is preselected; "none" warns.
      const select = owner.locator("#plan-reports");
      assert.equal(await select.inputValue(), "25", "the smallest Reports add-on is preselected for a ClinForms clinic");
      assert.equal(await owner.locator("[data-testid=plan-reports-warning]").count(), 0, "no warning while an add-on is chosen");
      await select.scrollIntoViewIfNeeded();
      await owner.screenshot({ path: path.join(OUT, "final-clindesk-plans-reports-preselected.png"), fullPage: true });
      await select.selectOption("none");
      const warning = owner.locator("[data-testid=plan-reports-warning]");
      await warning.waitFor({ timeout: 5000 });
      const warnText = (await warning.innerText()).trim();
      assert.match(warnText, /reports stop/i, warnText);
      await select.selectOption("25");
      return `title "${a.title}"; bands offered: ${await owner.locator("input[name=band]").count()}; mentions ${a.ctxs.length}; warning on none: "${warnText}"`;
    });
    let checkoutText = "";
    await check("B2", "ClinForms Starter → TEST checkout (4242) → success page on localhost, plan active", async () => {
      await owner.goto(`${FORMS}/app/settings/billing?product=clinforms`);
      await owner.locator("input[name=tier][value=starter]").check();
      await owner.click("button:has-text('Continue to payment')");
      await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await chooseMethod(owner, "card");
      await owner.locator("#cardNumber").waitFor({ state: "visible", timeout: 30000 });
      checkoutText = (await owner.locator("body").innerText()).replace(/\s+/g, " ");
      await owner.screenshot({ path: path.join(OUT, "checkout-page.png"), fullPage: true });
      await owner.locator("#cardNumber").fill("4242424242424242");
      await owner.locator("#cardExpiry").fill("12 / 34");
      await owner.locator("#cardCvc").fill("123");
      await fillCommon(owner, "Rowan Lark (fictional)");
      await owner.locator("button[data-testid=hosted-payment-submit-button], button.SubmitButton").first().click();
      await owner.waitForURL((u) => u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      const doneUrl = new URL(owner.url());
      assert.equal(doneUrl.origin, FORMS, `success return URL origin ${doneUrl.origin}`);
      await owner.locator("[data-testid=billing-done]").waitFor();
      const state = await owner.locator("[data-testid=billing-done]").getAttribute("data-state");
      const a = await audit(owner, "billing done");
      const s = one("SELECT * FROM clinic_subscription WHERE tenant_id = ?", CLINIC.slug);
      if (s) {
        subs.push(s.subscription_ref);
        customerRef = s.customer_ref || customerRef;
      }
      assert.equal(state, "active", await owner.locator("[data-testid=billing-done]").innerText());
      return `done text: ${a.text.slice(0, 300)}`;
    });
    await check("B3", "the hosted checkout page: what product/business name it shows (shared ClinDesk account)", async () => {
      const m = checkoutText.match(/.{0,80}clindesk.{0,80}/gi) || [];
      if (m.length) finding("R2/R3", "minor", "hosted checkout page (checkout.stripe.com) for ClinForms Starter", `shows ClinDesk: …${m[0].trim()}…`, "a ClinForms customer sees ClinForms as the product (business name is the shared ClinDesk account – deliberate exception; consider product name/descriptor CLINDESK REPORTS wording)");
      return `checkout header: ${checkoutText.slice(0, 220)}`;
    });
    await check("B4", "webhooks arrive and change nothing; the subscription is ClinForms starter; still no clinic package", async () => {
      const end = Date.now() + 90000;
      while (!/"type":"invoice\.paid"/.test(serverLog) && Date.now() < end) await new Promise((r) => setTimeout(r, 1000));
      const s = one("SELECT * FROM clinic_subscription WHERE tenant_id = ?", CLINIC.slug);
      assert.deepEqual([s.state, s.product, s.plan_key], ["active", "clinforms", "starter"]);
      const rows = sql.prepare("SELECT package, status FROM clinic_entitlements WHERE tenant_id = ?").all(CLINIC.slug);
      assert(!rows.some((r) => r.package === "clinic" && r.status === "active"), "clinic package switched on");
      customerRef = s.customer_ref || customerRef;
      return JSON.stringify(rows);
    });
    await check("B5", "cancelled return page stays on localhost, ClinForms", async () => {
      await owner.goto(`${FORMS}/app/settings/billing/cancelled`);
      await audit(owner, "billing cancelled");
    });

    /* ---------------- W: walk every page */
    const walked = [];
    await check("W1", "every nav page: host, title, mark, icon, no ClinDesk", async () => {
      await owner.goto(`${FORMS}/app`);
      const nav = await owner.locator("header nav a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), label: a.textContent.trim() })));
      for (const n of nav) {
        await owner.goto(new URL(n.href, FORMS).href);
        const a = await audit(owner, `nav ${n.label}`);
        walked.push(`${n.label} → ${a.url.host}${a.url.pathname} "${a.title}"`);
      }
      return walked.join("; ");
    });
    await check("W2", "Plan and billing with the plan running: ClinDesk offer / Reports wording", async () => {
      await owner.goto(`${FORMS}/app/settings/billing`);
      const a = await audit(owner, "plan and billing (active)");
      assert.equal(await owner.locator("[data-testid=clinic-system-offer]").count(), 1, "the offer stays while a ClinForms plan runs");
      return `plan "${(await owner.locator("[data-testid=billing-plan]").innerText()).trim()}"; ClinDesk mentions: ${a.ctxs.map((c) => `…${c.trim()}…`).join(" || ") || "none"}`;
    });
    await check("W3", "Studio pages and the account menu", async () => {
      await owner.goto(`${FORMS}/app/studio`);
      await audit(owner, "studio home");
      const links = await owner.locator("a[href^='/app/studio']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
      const seen = [];
      for (const h of links.slice(0, 12)) {
        await owner.goto(new URL(h, FORMS).href);
        const a = await audit(owner, `studio ${h}`);
        seen.push(`${h} "${a.title}"`);
      }
      await owner.goto(`${FORMS}/app/studio`);
      const menuBtn = owner.locator("button[aria-haspopup], button[aria-expanded]").first();
      let menu = "(no account menu button)";
      if (await menuBtn.count()) {
        await menuBtn.click();
        await owner.waitForTimeout(400);
        menu = (await owner.locator("[role=menu], [data-testid=account-menu]").first().innerText().catch(() => "")).replace(/\s+/g, " ") || "(menu opened, no role=menu)";
        await audit(owner, "studio account menu");
        const menuLinks = await owner.locator("[role=menu] a, [role=menuitem]").evaluateAll((as) => as.map((a) => a.getAttribute("href") || a.textContent.trim()));
        for (const h of menuLinks) if (/clinic\.localhost|clindesk/i.test(h)) finding("R3", "serious", "studio account menu", `menu item ${h}`, "ClinForms only");
        menu += ` | items: ${menuLinks.join(", ")}`;
        await owner.keyboard.press("Escape");
      }
      return `studio links: ${seen.join("; ")} | menu: ${menu}`;
    });
    await check("W4", "/app/clinic and /app/start for a ClinForms-only clinic: stay on localhost", async () => {
      const notes = [];
      for (const p of ["/app/clinic", "/app/start", "/app/select-clinic"]) {
        const r = await owner.goto(`${FORMS}${p}`);
        const a = await audit(owner, `direct ${p}`, { allowNoTitleBrand: true });
        notes.push(`${p} → ${r && r.status()} ${a.url.host}${a.url.pathname} "${a.title}"`);
      }
      return notes.join("; ");
    });
    await check("W5", "/icon.svg on localhost is ClinForms' icon (not ClinDesk's)", async () => {
      const r = await fetch(`${FORMS}/icon.svg`);
      const body = await r.text();
      const desk = await (await fetch(`${FORMS}/clindesk/favicon.svg`)).text().catch(() => "");
      if (desk && body === desk) finding("R3", "serious", "/icon.svg on localhost", "serves ClinDesk's favicon", "ClinForms' icon");
      return `${r.status} ${body.length} bytes`;
    });

    /* ---------------- M: Manage billing (portal + return URL) */
    await check("M1", "Manage billing opens the hosted billing page; its return link goes back to localhost Plan and billing", async () => {
      await owner.goto(`${FORMS}/app/settings/billing`);
      await owner.click("button:has-text('Manage billing')");
      await owner.waitForURL(/billing\.stripe\.com/, { timeout: 60000 });
      await owner.waitForTimeout(2500);
      const t = (await owner.locator("body").innerText()).replace(/\s+/g, " ");
      await owner.screenshot({ path: path.join(OUT, "billing-portal.png"), fullPage: true });
      const m = t.match(/.{0,80}clindesk.{0,80}/gi) || [];
      if (m.length) finding("R2/R3", "minor", "hosted billing portal (billing.stripe.com)", `shows ClinDesk: …${m[0].trim()}…`, "a ClinForms customer sees ClinForms (shared ClinDesk account – deliberate exception)");
      const ret = owner.locator("a[data-testid='return-to-business-link'], a:has-text('Return to'), a[href*='localhost']").first();
      const href = await ret.getAttribute("href").catch(() => null);
      assert(href, "return link on the portal");
      const u = new URL(href);
      assert.equal(u.origin, FORMS, `portal return origin ${u.origin}`);
      assert.equal(u.pathname, "/app/settings/billing");
      await ret.click();
      await owner.waitForURL((x) => x.pathname === "/app/settings/billing", { timeout: 60000 });
      await audit(owner, "back from billing portal");
      return `return ${u.href}; portal header: ${t.slice(0, 160)}`;
    });

    /* ---------------- S: sign out → reset password → sign in */
    await check("S1", "sign out → /login on localhost, ClinForms", async () => {
      await owner.goto(`${FORMS}/app`);
      await owner.click("button:has-text('Sign out')");
      await owner.waitForURL(/\/login/, { timeout: 30000 });
      const a = await audit(owner, "login after sign out");
      return `${a.url.href} "${a.title}"`;
    });
    let resetMail = null;
    await check("S2", "Forgotten password → email names ClinForms, link on localhost", async () => {
      await owner.click("text=Forgotten your password?");
      await owner.waitForURL(`${FORMS}/reset-password`);
      await audit(owner, "reset-password request");
      await owner.fill("#f-email", OWNER);
      await owner.click("button:has-text('Email me a reset link')");
      await owner.waitForSelector("text=If an account exists for that address");
      await audit(owner, "reset-password sent");
      const end = Date.now() + 20000;
      while (!(resetMail = lastMail(OWNER, /reset/i)) && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
      assert(resetMail, "reset email");
      const link = resetMail.links.find((l) => /reset-password\?token=/.test(l));
      assert(link, "reset link");
      resetMail.link = link;
      const where = `reset email "${resetMail.subject}"`;
      if (/clindesk/i.test(resetMail.subject + resetMail.text)) finding("R3", "serious", where, "mentions ClinDesk", "ClinForms only");
      if (new URL(link).origin !== FORMS) finding("R3", "serious", where, `link origin ${new URL(link).origin}`, FORMS);
      return `subject "${resetMail.subject}"; link origin ${new URL(link).origin}`;
    });
    await check("S3", "reset link → new password → sign in with a code → /app on localhost", async () => {
      await owner.goto(resetMail.link);
      await audit(owner, "reset-password set new");
      const pass = `e2e ${rnd(12)} password`;
      await owner.fill("#f-password", pass);
      await owner.fill("#f-confirm", pass);
      await owner.click("button:has-text('Change password')");
      await owner.waitForSelector("text=Your password has been changed");
      await audit(owner, "reset-password changed");
      users[OWNER].password = pass;
      await owner.goto(`${FORMS}/login`);
      await owner.fill("#f-email", OWNER);
      await owner.fill("#f-password", pass);
      await owner.click("button[type=submit]");
      await owner.waitForSelector("#f-code");
      await audit(owner, "login two-step code");
      await owner.fill("#f-code", await freshCode(OWNER));
      await owner.click("button[type=submit]");
      await owner.waitForURL(/\/app(\/|$|\?)/, { timeout: 30000 });
      const a = await audit(owner, "app after sign in");
      assert.equal(a.url.origin, FORMS);
      return a.url.href;
    });
    await check("S4", "after sign-in with ?next / callback: still localhost", async () => {
      await owner.context().clearCookies();
      await owner.goto(`${FORMS}/app/settings/billing`);
      await owner.waitForURL(/\/login/, { timeout: 30000 });
      const a = await audit(owner, "login redirect from billing");
      return a.url.href.replace(/token=[^&]+/, "");
    });

    /* ---------------- N: 404 */
    await check("N1", "404 pages on localhost: ClinForms title and icon", async () => {
      const notes = [];
      for (const p of ["/no-such-page", "/app/no-such-page"]) {
        const r = await visitor.goto(`${FORMS}${p}`);
        const a = await audit(visitor, `404 ${p}`, { allowNoTitleBrand: false });
        notes.push(`${p} → ${r && r.status()} "${a.title}" icons ${a.icons.join(",") || "(none linked)"}`);
      }
      return notes.join("; ");
    });

    /* ---------------- E: all emails the owner received */
    await check("E2", "every email to the owner: no ClinDesk, no ClinDesk host", async () => {
      const mine = outbox().filter((m) => m.to === OWNER);
      for (const m of mine) {
        if (/clindesk|clinic\.localhost/i.test(m.subject + m.text)) finding("R3", "serious", `email "${m.subject}"`, "mentions ClinDesk or its host", "ClinForms only");
      }
      return mine.map((m) => `"${m.subject}"`).join(", ");
    });

    /* ---------------- H/M: hide the offer, then move the running ClinForms plan to ClinDesk (R2's action) */
    // The steps above end signed out: sign in again on localhost when needed.
    const ensureSignedIn = async () => {
      await owner.goto(`${FORMS}/app`);
      if (new URL(owner.url()).pathname !== "/login") return;
      await owner.fill("#f-email", OWNER);
      await owner.fill("#f-password", users[OWNER].password);
      await owner.click("button[type=submit]");
      await owner.waitForSelector("#f-code");
      await owner.fill("#f-code", await freshCode(OWNER));
      await owner.click("button[type=submit]");
      await owner.waitForURL(/\/app(\/|$|\?)/, { timeout: 30000 });
    };
    await check("H1", "Overview: \"Hide this\" hides the offer for this browser", async () => {
      await ensureSignedIn();
      await owner.goto(`${FORMS}/app`);
      await owner.locator("[data-testid=clinic-system-offer] button:has-text('Hide this')").click();
      await owner.waitForFunction(() => !document.querySelector("[data-testid=clinic-system-offer]"), null, { timeout: 15000 });
      await owner.reload();
      assert.equal(await owner.locator("[data-testid=clinic-system-offer]").count(), 0);
      await owner.goto(`${FORMS}/app/settings/billing`);
      assert.equal(await owner.locator("[data-testid=clinic-system-offer]").count(), 1, "still offered on Plan and billing");
    });
    await check("U1", "See ClinDesk plans → the running ClinForms plan becomes ClinDesk Solo + Reports 25, charged at once", async () => {
      await ensureSignedIn();
      await owner.goto(`${FORMS}/app/settings/billing`);
      await owner.locator("a[data-testid=clinic-system-offer-buy]").click();
      await owner.waitForURL((u) => u.search.includes("product=clindesk"));
      await owner.locator("[data-testid=billing-move-to-clinic]").waitFor();
      assert.equal(await owner.locator("#plan-reports").inputValue(), "25", "the matching Reports add-on is preselected");
      await owner.locator("input[name=band][value=solo]").check();
      await owner.click("button:has-text('Change plan')");
      movedToClinDesk = true;
      await owner.locator("[data-testid=plan-result]").waitFor({ timeout: 90000 });
      const msg = await owner.locator("[data-testid=plan-result]").innerText();
      assert.match(msg, /ClinDesk Solo with Reports/, msg);
      const s = one("SELECT * FROM clinic_subscription WHERE tenant_id = ?", CLINIC.slug);
      assert.deepEqual([s.state, s.product, s.plan_key, s.reports_key], ["active", "clindesk", "solo", "25"]);
      const rows = sql.prepare("SELECT package, status FROM clinic_entitlements WHERE tenant_id = ? ORDER BY package").all(CLINIC.slug);
      assert.deepEqual(rows.map((r) => `${r.package}:${r.status}`), ["clinic:active", "reports:active"]);
      return msg;
    });
    await check("U2", "after the move: Plan and billing points to ClinDesk's sign-in; /app hands off to clinic.localhost", async () => {
      await owner.goto(`${FORMS}/app/settings/billing`);
      const href = await owner.locator("[data-testid=billing-clinic-sign-in] a").getAttribute("href");
      assert.equal(href, `${DESK}/login?next=%2Fapp%2Fstart`);
      assert.equal(await owner.locator("[data-testid=clinic-system-offer]").count(), 0, "no offer once ClinDesk is on");
      await owner.goto(`${FORMS}/app`);
      await owner.waitForURL((u) => u.host === `clinic.localhost:${PORT}` && u.pathname === "/login");
      assert.equal(new URL(owner.url()).searchParams.get("moved"), "1");
      await owner.locator("[data-testid=login-moved]").waitFor();
      assert.match(await owner.title(), /ClinDesk/);
      return owner.url();
    });

    await check("X1", "no page errors in the browser", () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });

    // R2 verdict
    await check("R2", "R2: a promotion of the full clinic system (ClinDesk) for the ClinForms-only owner", async () => {
      const where = [];
      if (promoOverview) where.push(`overview: ${promoOverview[0]}`);
      if (promoBilling) where.push(`plan and billing: ${promoBilling.map((c) => c.trim()).join(" || ")}`);
      if (!promoOverview)
        finding(
          "R2",
          "serious",
          "/app (Overview) – ClinForms-only clinic, owner",
          "no banner/card offering the full clinic system (ClinDesk); the overview shows nothing about ClinDesk",
          "owners/admins of a ClinForms-only clinic see a promotional card (e.g. \"Run your whole clinic with ClinDesk – diary, notes, billing\") with a button to Plan and billing ?product=clindesk (or clindesk.co.uk info); also prominent on Plan and billing",
        );
      if (!promoBilling) finding("R2", "serious", "/app/settings/billing", "no ClinDesk offer at all", "an upgrade card");
      else if (promoBilling && !promoOverview)
        finding(
          "R2",
          "minor",
          "/app/settings/billing – ClinForms-only clinic, owner",
          `the only offer is one inline sentence: "${(promoBilling.find((c) => /full clinic/i.test(c)) || promoBilling[0]).trim()}" (plain underlined link, above the plan form; disappears once a plan is running? see W2)`,
          "a visible promotional card/banner describing ClinDesk (diary, notes, billing) with a clear button",
        );
      return where.join(" | ") || "none";
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err && err.stack ? err.stack : err).slice(0, 1200) });
  } finally {
    // Test-mode clean-up: the run's subscription and its "TEST – …" customer.
    try {
      if (sql) {
        const s = sql.prepare("SELECT subscription_ref, customer_ref FROM clinic_subscription WHERE tenant_id = ?").get(CLINIC.slug);
        if (s) {
          if (s.subscription_ref) subs.push(s.subscription_ref);
          customerRef = s.customer_ref || customerRef;
        }
        const c = sql.prepare("SELECT customer_ref FROM pms_sms_credit_accounts WHERE tenant_id = ?").get(CLINIC.slug);
        if (c && c.customer_ref) customerRef = customerRef || c.customer_ref;
      }
    } catch (e) {
      console.log(`cleanup lookup: ${e.message}`);
    }
    for (const id of [...new Set(subs)]) await api("DELETE", `/subscriptions/${id}`).catch(() => {});
    if (customerRef) {
      const cust = await api("GET", `/customers/${customerRef}`).catch(() => null);
      if (cust && /^TEST – /.test(cust.name || "")) {
        const d = await api("DELETE", `/customers/${customerRef}`).catch(() => null);
        console.log(`cleanup: test customer ${d && d.deleted ? "deleted" : "NOT deleted"} (name "${cust.name}")`);
        results.push({ id: "CLEAN", what: "test customer deleted", pass: !!(d && d.deleted), note: cust.name });
      } else console.log(`cleanup: customer not deleted – name "${cust && cust.name}"`);
    } else console.log("cleanup: no customer made");
    if (sql) sql.close();
    await browser.close();
    stopChild(listener);
    stopChild(server);
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) =>
    s
      .replace(/token=[^\s&"]+/g, "token=…")
      .replace(/whsec_[A-Za-z0-9]+/g, "whsec_…")
      .replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  fs.writeFileSync(path.join(OUT, "clindesk-mentions.json"), JSON.stringify(mentions, null, 2));
  fs.writeFileSync(path.join(OUT, "navigations.txt"), scrub(redirects.join("\n")));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed; ${findings.length} finding(s)`);
  process.exit(failed.length ? 1 : 0);
})();
