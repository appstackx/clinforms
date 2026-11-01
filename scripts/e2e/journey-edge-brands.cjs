/**
 * Edge journeys across the two brand hosts (Khuram 01/11/2026, R1–R3), LOCAL only, in a real browser, against the
 * payment account's TEST mode. Starts its own `next start` on a throwaway SQLite database (BETTER_AUTH_URL =
 * http://localhost:<port>, CLINFORMS_AUTH_ORIGINS = http://clinic.localhost:<port>, APP_ORIGIN deliberately UNSET – as
 * on production), the `log` email provider (messages read from the server's own output). Fictional data only.
 * This script RECORDS what it sees: every check is an observation of the product rules R1–R3; it fixes nothing.
 *
 *   SETUP  a ClinDesk-only clinic ("clinic" on, "reports" off, --brand clinic) and a ClinForms-only clinic (default)
 *   R1     the ClinDesk-only owner's pages on clinic.localhost: no "ClinForms" anywhere (text, titles, labels, links)
 *   R2     the ClinForms-only owner's pages on localhost: ClinForms brand, plus an offer of ClinDesk (promo)
 *   D      invite of a staff member (reception) from the ClinDesk-only clinic – from clinic.localhost AND from a
 *          localhost session: email brand + link host; what the member sees
 *   B      wrong host: ClinForms-only owner signs in on clinic.localhost; ClinDesk-only owner signs in on localhost
 *   C      one person in two clinics with different packages: invitation, join, /app/select-clinic, landing per host
 *   E      Plan and billing: checkout cancel + success return hosts (both brands), the billing portal's return link,
 *          the hosted pages' business name; billing notice emails (brand + link host)
 *   A      the ClinDesk clinic ADDS the Reports add-on: Studio, its title/mark, navigation between ClinDesk and the
 *          Studio, links that leave the host
 *   X      the outbox: every email to a ClinDesk-only member speaks for ClinDesk and links to clinic.localhost
 *
 *   npm run build
 *   node scripts/e2e/journey-edge-brands.cjs       [PORT=3403] [E2E_OUT=…] [PLAYWRIGHT=<path to playwright>]
 *
 * Needs the TEST key in ~/.config/appstackx/clinforms.secrets.env (STRIPE_CLINDESK_TEST_SECRET_KEY – read here,
 * never printed). Test customers are named "TEST – <clinic>" by the app; this script deletes them (and their
 * subscriptions) at the end. No webhook forwarding: the done page and the plan change apply the subscription at once.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PLAYWRIGHT || "/Users/khuram/Projects/Appstackx/dutydesk/node_modules/playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3403);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "journey-edge-brands");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-ja4-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");

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
const RUN = Date.now().toString(36).slice(-6);
const SECRETS = {
  BETTER_AUTH_SECRET: `test-only-${rnd(32)}`,
  CLINFORMS_DATA_KEYS: JSON.stringify({ t1: crypto.randomBytes(32).toString("base64") }),
  CLINFORMS_DATA_KEY_ID: "t1",
  MEDREPORT_LAUNCH_SECRET: `test-only-launch-${rnd(16)}`,
  MEDREPORT_SIGNING_SECRET: `test-only-signing-${rnd(16)}`,
  MEDREPORT_PARTNER_KEY: `test-only-partner-${rnd(16)}`,
  TM3_SIM_TOKEN: `test-only-sim-${rnd(16)}`,
  CRON_SECRET: `test-only-cron-${rnd(16)}`,
  STRIPE_CLINDESK_WEBHOOK_SECRET: `whsec_testonly${rnd(16).replace(/[^A-Za-z0-9]/g, "")}`,
};
const PLATFORM = `ja4-platform-${RUN}@example.com`;
const DESK_OWNER = `ja4-desk-owner-${RUN}@example.com`;
const FORMS_OWNER = `ja4-forms-owner-${RUN}@example.com`;
const RECEPTION = `ja4-reception-${RUN}@example.com`;
const RECEPTION2 = `ja4-reception2-${RUN}@example.com`;
const DESK_CLINIC = { name: "JA4 Desk Only Physio (fictional)", slug: `ja4-desk-${RUN}` };
const FORMS_CLINIC = { name: "JA4 Forms Only Clinic (fictional)", slug: `ja4-forms-${RUN}` };
const users = {};
const results = [];
const notes = []; // free-form observations (what each page showed), written to observations.json
const pages = [];
const problems = [];

async function check(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).slice(0, 900);
    results.push({ id, what, pass: false, error: msg });
    console.log(`FAIL ${id} ${what}: ${msg}`);
    for (const [who, page] of pages) if (!page.isClosed()) await page.screenshot({ path: path.join(OUT, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}
const observe = (id, data) => {
  notes.push({ id, ...data });
  console.log(`NOTE ${id} ${JSON.stringify(data).slice(0, 600)}`);
};

/* ------------------------------------------------------------------ payment service (TEST mode only) */
async function api(method, pathname, form) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json();
  if (json.livemode === true) throw new Error("live answer refused");
  return json;
}

/* ------------------------------------------------------------------ server */
function appEnv() {
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
    // APP_ORIGIN deliberately unset (production has none): links in billing notices etc. then follow the code's own rule.
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
    CLINFORMS_PLATFORM_ADMINS: PLATFORM,
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    STRIPE_CLINDESK_SECRET_KEY: KEY,
  };
}
let server = null;
let serverLog = "";
async function startServer() {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], { cwd: REPO, env: appEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 90_000;
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
function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // gone
  }
}
const cli = (args) => execFileSync("npm", ["run", "-s", ...args], { cwd: REPO, env: appEnv(), encoding: "utf8" });
const LINK_RE = /https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/;

/** The `log` provider's messages: [{to, subject, text, links}]. */
function outbox() {
  const out = [];
  const re = /\[email:log\] to=(\S+)(?: reply-to=(\S+))? subject="([^"]*)"\n([\s\S]*?(?:ClinForms|ClinDesk) · Appstack X Ltd)\n/g;
  for (const m of serverLog.matchAll(re)) {
    out.push({ to: m[1], subject: m[3], text: m[4], links: m[4].match(/https?:\/\/[^\s)>\]]+/g) || [] });
  }
  return out;
}
const mailsTo = (to) => outbox().filter((m) => m.to === to);
const lastMail = (to, re) => mailsTo(to).filter((m) => re.test(m.subject)).at(-1);
const scrubLink = (u) => u.replace(/token(=|%3D)[^&\s]+/g, "token=…").replace(/session_id=[^&\s]+/g, "session_id=…");

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

/* ------------------------------------------------------------------ browser helpers */
const visibleText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

/** Everything a person can see or a screen reader can hear on the page, plus where its links go. */
async function brandScan(page) {
  return page.evaluate(() => {
    const attrs = [];
    for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder]")) {
      for (const a of ["aria-label", "alt", "title", "placeholder"]) if (el.getAttribute(a)) attrs.push(el.getAttribute(a));
    }
    // The clinic-system offer card's "See what is included" (clindesk.co.uk/features) is the intended promotion (R2).
    const links = [...document.querySelectorAll("a[href]")]
      .filter((a) => !a.closest("[data-testid=clinic-system-offer]"))
      .map((a) => ({ href: new URL(a.getAttribute("href"), location.href).href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 60) }));
    const forms = [...document.querySelectorAll("form[action]")].map((f) => new URL(f.getAttribute("action"), location.href).href);
    const icon = document.querySelector("link[rel~='icon']");
    return {
      url: location.href,
      title: document.title,
      text: document.body.innerText.replace(/\s+/g, " "),
      attrs: attrs.join(" | "),
      links,
      forms,
      icon: icon ? new URL(icon.getAttribute("href"), location.href).pathname : null,
      brandAttr: [...document.querySelectorAll("[data-brand]")].map((e) => e.getAttribute("data-brand")),
      marks: [...document.querySelectorAll("[data-mark]")].map((e) => e.getAttribute("data-mark")),
    };
  });
}
/** Hits of a word in a scan (text, title, attributes, link texts), with a little context. */
function hits(scan, re) {
  const found = [];
  const ctx = (s, m) => s.slice(Math.max(0, m.index - 50), m.index + 60);
  for (const [where, s] of [["title", scan.title], ["text", scan.text], ["attrs", scan.attrs]]) {
    for (const m of s.matchAll(new RegExp(re.source, "gi"))) found.push(`${where}: …${ctx(s, m)}…`);
  }
  return found;
}
/** Links that leave `origin` for the other brand's host (or the public sites). */
function foreignLinks(scan, origin) {
  const other = origin === DESK ? [FORMS, "https://clinforms.co.uk", "https://www.clinforms.co.uk"] : [DESK, "https://clindesk.co.uk", "https://www.clindesk.co.uk"];
  return [...scan.links.map((l) => `${l.href} (${l.text})`), ...scan.forms].filter((h) => other.some((o) => h.startsWith(o)));
}

async function acceptInvite(page, link, email, name) {
  const origin = new URL(link).origin;
  users[email] = { password: `e2e ${rnd(12)} password` };
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  const inviteTitle = await page.title();
  await page.fill("#f-name", name);
  await page.fill("#f-password", users[email].password);
  await page.fill("#f-confirm", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const heading = (await page.locator("h2").first().innerText()).trim();
  const uri = await page.locator("a[href^='otpauth://']").getAttribute("href");
  users[email].key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
  return { inviteTitle, heading, issuer: new URL(uri).searchParams.get("issuer"), landed: page.url() };
}

/** Sign in at `url` (a /login page, maybe with ?next=); returns the URL landed on. */
async function signInAt(page, url, email) {
  await page.goto(url);
  const loginTitle = await page.title();
  await page.fill("#f-email", email);
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("#f-code");
  const hint = await visibleText(page);
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  // 01/11/2026: a clinic of the other brand is handed off to its own host's /login (?moved=1) – that is a landing too.
  const start = new URL(url).origin;
  await page.waitForURL((u) => u.origin !== start || !["/login", "/two-factor", "/app/start"].includes(u.pathname), { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return { landed: page.url(), loginTitle, codeHint: (hint.match(/6-digit code for \w+/) || [""])[0] };
}

async function invite(page, origin, email, role) {
  await page.goto(`${origin}/app/settings/members`);
  const form = page.locator("form", { has: page.locator("button:has-text('Invite')") }).first();
  await form.locator("#f-email").fill(email);
  await form.locator("select[name=role]").selectOption(role);
  await form.locator("button:has-text('Invite')").click();
  const result = page.locator("[data-testid=invite-result]");
  await result.waitFor({ timeout: 30000 });
  return (await result.innerText()).replace(/\s+/g, " ");
}

/* hosted payment page */
async function chooseMethod(page, method) {
  const button = page.locator(`[data-testid=${method}-accordion-item-button]`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  if (await button.count()) await button.dispatchEvent("click");
}
async function fillCard(page, email, name) {
  await chooseMethod(page, "card");
  await page.locator("#cardNumber").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  const em = page.locator("#email");
  if ((await em.count()) && (await em.isVisible().catch(() => false)) && !(await em.inputValue().catch(() => ""))) await em.fill(email);
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
/** What the hosted page says about the seller (business name in its header) and where its own back link goes. */
async function hostedPageFacts(page, ownOrigin) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2500);
  return page.evaluate((own) => {
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80) }));
    const header = document.querySelector("header, [class*=Header], [data-testid=business-link]");
    return {
      url: location.origin + location.pathname.slice(0, 20),
      headerText: (header ? header.innerText : document.body.innerText.slice(0, 200)).replace(/\s+/g, " ").slice(0, 200),
      bodyStart: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
      ownLinks: links.filter((l) => l.href.startsWith("http://localhost") || l.href.startsWith("http://clinic.localhost")).map((l) => ({ href: l.href.replace(/session_id=[^&]+/, "session_id=…"), text: l.text })),
      mentions: { clinforms: /clinforms/i.test(document.body.innerText), clindesk: /clindesk/i.test(document.body.innerText) },
    };
  }, ownOrigin);
}

/* ------------------------------------------------------------------ run */
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const newPage = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    // Every top-level navigation, to catch a bounce to the other host.
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) (page.__hops ||= []).push(f.url());
    });
    pages.push([who, page]);
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
  const made = { customers: new Set(), subscriptions: new Set() };
  let sql = null;
  try {
    /* ---------------------------------------------------------------- SETUP */
    const deskCli = cli(["admin:create-clinic", "--", "--name", DESK_CLINIC.name, "--slug", DESK_CLINIC.slug, "--owner-email", DESK_OWNER, "--brand", "clinic"]);
    cli(["admin:set-entitlement", "--", "--slug", DESK_CLINIC.slug, "--package", "clinic", "--on", "--status", "active", "--confirm"]);
    cli(["admin:set-entitlement", "--", "--slug", DESK_CLINIC.slug, "--package", "reports", "--off", "--confirm"]);
    const formsCli = cli(["admin:create-clinic", "--", "--name", FORMS_CLINIC.name, "--slug", FORMS_CLINIC.slug, "--owner-email", FORMS_OWNER]);
    const deskLink = (deskCli.match(LINK_RE) || [])[0];
    const formsLink = (formsCli.match(LINK_RE) || [])[0];
    assert.ok(deskLink && deskLink.startsWith(`${DESK}/accept-invite`), "desk link on clinic.localhost");
    assert.ok(formsLink && formsLink.startsWith(`${FORMS}/accept-invite`), "forms link on localhost");
    await startServer();
    sql = openScratchDb({ readOnly: true });
    const tenantOf = (slug) => slug; // the tenant id is the clinic slug
    const ents = (slug) => sql.prepare("SELECT package, status FROM clinic_entitlements WHERE tenant_id = ?").all(tenantOf(slug)).map((r) => `${r.package}:${r.status}`).sort().join(",");
    const customerOf = (slug) => sql.prepare("SELECT customer_ref FROM pms_sms_credit_accounts WHERE tenant_id = ?").get(tenantOf(slug))?.customer_ref ?? null;
    const subOf = (slug) => sql.prepare("SELECT * FROM clinic_subscription WHERE tenant_id = ?").get(tenantOf(slug)) ?? null;

    const desk = await newPage("desk-owner");
    const forms = await newPage("forms-owner");
    let deskSetup;
    let formsSetup;
    await check("S1", "ClinDesk-only owner joins on clinic.localhost (ClinDesk issuer, lands in the clinic area)", async () => {
      deskSetup = await acceptInvite(desk, deskLink, DESK_OWNER, "Dana Desk (fictional)");
      assert.equal(deskSetup.issuer, "ClinDesk");
      assert.equal(new URL(deskSetup.landed).origin, DESK);
      assert.equal(new URL(deskSetup.landed).pathname, "/app/clinic");
      return `packages ${ents(DESK_CLINIC.slug)}`;
    });
    await check("S2", "ClinForms-only owner joins on localhost (ClinForms issuer, lands on /app)", async () => {
      formsSetup = await acceptInvite(forms, formsLink, FORMS_OWNER, "Fran Forms (fictional)");
      assert.equal(formsSetup.issuer, "ClinForms");
      assert.equal(formsSetup.landed, `${FORMS}/app`);
      return `packages ${ents(FORMS_CLINIC.slug) || "(no rows: reports on by default)"}`;
    });

    /* ---------------------------------------------------------------- R1 baseline – ClinDesk-only on its own host */
    const deskPaths = ["/app/clinic", "/app", "/app/settings/clinic", "/app/settings/members", "/app/settings/security", "/app/settings/plan", "/app/settings/billing", "/app/settings/activity", "/app/settings/api-keys", "/app/clinic/account", "/app/clinic/billing"];
    for (const p of deskPaths) {
      await check(`R1${p}`, `ClinDesk-only owner on clinic.localhost${p}: no "ClinForms", no link to localhost`, async () => {
        const res = await desk.goto(`${DESK}${p}`);
        const scan = await brandScan(desk);
        const h = hits(scan, /clinforms/);
        const foreign = foreignLinks(scan, DESK);
        observe(`R1${p}`, { status: res && res.status(), url: scan.url, title: scan.title, icon: scan.icon, brand: scan.brandAttr, hits: h.slice(0, 6), foreign });
        assert.equal(new URL(desk.url()).origin, DESK, `left the host: ${desk.url()}`);
        assert.equal(h.length, 0, h.join(" || "));
        assert.equal(foreign.length, 0, foreign.join(" || "));
      });
    }
    await shot(desk, "r1-desk-only-plan-billing");
    await desk.goto(`${DESK}/app`);
    await shot(desk, "r1-desk-only-overview");
    await check("R1-studio", "ClinDesk-only: /app/studio is the 404 page on clinic.localhost", async () => {
      const res = await desk.goto(`${DESK}/app/studio`);
      const scan = await brandScan(desk);
      observe("R1-studio", { status: res.status(), title: scan.title, hits: hits(scan, /clinforms/).slice(0, 3) });
      assert.equal(res.status(), 404);
      assert.equal(hits(scan, /clinforms/).length, 0);
    });

    /* ---------------------------------------------------------------- R2 – ClinForms-only owner: brand + promo */
    for (const p of ["/app", "/app/settings/plan", "/app/settings/billing", "/app/studio"]) {
      await check(`R2${p}`, `ClinForms-only owner on localhost${p}: ClinForms brand; a ClinDesk offer somewhere`, async () => {
        const res = await forms.goto(`${FORMS}${p}`);
        await forms.waitForLoadState("networkidle").catch(() => {});
        const scan = await brandScan(forms);
        const desk = hits(scan, /clindesk|clinic management|whole clinic/);
        observe(`R2${p}`, { status: res.status(), url: scan.url, title: scan.title, icon: scan.icon, brand: scan.brandAttr, clindeskMentions: desk.slice(0, 6), foreign: foreignLinks(scan, FORMS) });
        assert.equal(new URL(forms.url()).origin, FORMS);
        assert.match(scan.title, /ClinForms/);
        assert.equal(foreignLinks(scan, FORMS).length, 0, foreignLinks(scan, FORMS).join(" || "));
      });
    }
    await check("R2-promo", "ClinForms-only owner: a promotional banner/card offers the full clinic system (ClinDesk) on /app", async () => {
      await forms.goto(`${FORMS}/app`);
      const scan = await brandScan(forms);
      await shot(forms, "r2-forms-only-overview");
      assert.ok(/clindesk/i.test(scan.text), "no mention of ClinDesk on the overview");
    });

    /* ---------------------------------------------------------------- D – invite reception from the ClinDesk-only clinic */
    let recMail;
    await check("D1", "invite staff from clinic.localhost: email speaks for ClinDesk, link on clinic.localhost, no 'ClinForms'", async () => {
      const shown = await invite(desk, DESK, RECEPTION, "staff");
      recMail = lastMail(RECEPTION, /./);
      assert.ok(recMail, "no email");
      observe("D1", { shown: shown.slice(0, 160), subject: recMail.subject, links: recMail.links.map(scrubLink), clinformsInBody: /clinforms/i.test(recMail.text) });
      assert.ok(recMail.links.some((l) => l.startsWith(`${DESK}/accept-invite`)), "link host");
      assert.match(recMail.subject, /ClinDesk/);
      assert.doesNotMatch(recMail.subject + recMail.text, /clinforms/i);
    });
    const rec = await newPage("reception");
    await check("D2", "reception joins on clinic.localhost: issuer ClinDesk, lands in the clinic area; their pages never say ClinForms", async () => {
      const link = recMail.links.find((l) => l.includes("/accept-invite"));
      const s = await acceptInvite(rec, link, RECEPTION, "Rhea Reception (fictional)");
      const seen = [];
      for (const p of ["/app/clinic", "/app", "/app/settings/plan", "/app/settings/security", "/app/settings/members", "/app/settings/activity"]) {
        const res = await rec.goto(`${DESK}${p}`);
        const scan = await brandScan(rec);
        const h = hits(scan, /clinforms|referrer form|prepares forms/);
        seen.push({ p, status: res.status(), title: scan.title, hits: h.slice(0, 4), foreign: foreignLinks(scan, DESK) });
      }
      await rec.goto(`${DESK}/app`);
      await shot(rec, "d2-reception-overview");
      observe("D2", { issuer: s.issuer, inviteTitle: s.inviteTitle, landed: s.landed, seen });
      assert.equal(s.issuer, "ClinDesk");
      assert.equal(new URL(s.landed).origin, DESK);
      const bad = seen.filter((x) => x.hits.some((t) => /clinforms/i.test(t)) || x.foreign.length);
      assert.equal(bad.length, 0, JSON.stringify(bad));
    });

    /* ---------------------------------------------------------------- B – wrong host sign-ins */
    const deskOnForms = await newPage("desk-owner-on-localhost");
    await check("B1", "ClinDesk-only owner signs in on localhost: what brand/host do they get? (R1: never ClinForms, stay/return to ClinDesk)", async () => {
      const r = await signInAt(deskOnForms, `${FORMS}/login`, DESK_OWNER);
      const scan = await brandScan(deskOnForms);
      await shot(deskOnForms, "b1-desk-only-owner-signed-in-on-localhost");
      const h = hits(scan, /clinforms/);
      observe("B1", { loginTitle: r.loginTitle, codeHint: r.codeHint, landed: r.landed, title: scan.title, brand: scan.brandAttr, icon: scan.icon, hits: h.slice(0, 5) });
      let openDesk = null;
      const openLink = deskOnForms.locator("a:has-text('Open ClinDesk')").first();
      if (await openLink.count()) {
        await openLink.click();
        await deskOnForms.waitForLoadState("networkidle").catch(() => {});
        openDesk = { url: deskOnForms.url(), title: await deskOnForms.title() };
        await shot(deskOnForms, "b1-desk-only-owner-clinic-area-on-localhost");
      }
      observe("B1-open", { openDesk });
      assert.equal(new URL(r.landed).origin, DESK, `stayed on ${new URL(r.landed).origin} (ClinForms host) – landed ${new URL(r.landed).pathname}`);
      assert.equal(h.length, 0, h.join(" || "));
    });
    await check("D3", "a LOCALHOST session of the ClinDesk-only clinic cannot use the account area there (handed off); invite from clinic.localhost: ClinDesk email + link", async () => {
      // 01/11/2026: the ClinDesk clinic's pages on localhost hand off to clinic.localhost's sign-in (brand-handoff.ts).
      await deskOnForms.goto(`${FORMS}/app/settings/members`);
      assert.equal(new URL(deskOnForms.url()).origin, DESK, `members page on localhost stayed on ${deskOnForms.url()}`);
      assert.equal(new URL(deskOnForms.url()).pathname, "/login");
      const shown = await invite(desk, DESK, RECEPTION2, "staff");
      const m = lastMail(RECEPTION2, /./);
      const pending = await brandScan(desk);
      const copy = await desk.locator("button:has-text('Copy link')").count();
      observe("D3", { shown: shown.slice(0, 160), subject: m && m.subject, links: m ? m.links.map(scrubLink) : null, pageHits: hits(pending, /clinforms/).slice(0, 4), copyButtons: copy });
      assert.ok(m && m.links.some((l) => l.startsWith(`${DESK}/accept-invite`)), "link host");
      assert.doesNotMatch(m.subject + m.text, /clinforms/i);
    });
    const formsOnDesk = await newPage("forms-owner-on-clinic-host");
    await check("B2", "ClinForms-only owner signs in on clinic.localhost: what brand/host do they get? (R2: ClinForms throughout)", async () => {
      const r = await signInAt(formsOnDesk, `${DESK}/login`, FORMS_OWNER);
      const scan = await brandScan(formsOnDesk);
      await shot(formsOnDesk, "b2-forms-only-owner-signed-in-on-clinic-host");
      observe("B2", { loginTitle: r.loginTitle, codeHint: r.codeHint, landed: r.landed, title: scan.title, brand: scan.brandAttr, marks: scan.marks, icon: scan.icon, clinformsHits: hits(scan, /clinforms/).length, clindeskHits: hits(scan, /clindesk/).slice(0, 4) });
      await formsOnDesk.goto(`${DESK}/app/studio`);
      const st = await brandScan(formsOnDesk);
      observe("B2-studio", { url: st.url, title: st.title, icon: st.icon, marks: st.marks });
      await shot(formsOnDesk, "b2-forms-only-studio-on-clinic-host");
      const res = await formsOnDesk.goto(`${DESK}/app/clinic`);
      observe("B2-clinic", { status: res.status(), title: await formsOnDesk.title() });
      assert.equal(new URL(r.landed).origin, FORMS, `stayed on clinic.localhost – landed ${new URL(r.landed).pathname} titled "${scan.title}"`);
    });

    /* ---------------------------------------------------------------- C – one person, two clinics */
    let joinMail;
    await check("C1", "the ClinDesk-only owner invites the ClinForms-only owner as admin: ClinDesk email, clinic.localhost link", async () => {
      await invite(desk, DESK, FORMS_OWNER, "admin");
      joinMail = lastMail(FORMS_OWNER, /^Join /);
      observe("C1", { subject: joinMail && joinMail.subject, links: joinMail ? joinMail.links.map(scrubLink) : null });
      assert.ok(joinMail && joinMail.links.some((l) => l.startsWith(`${DESK}/accept-invite`)));
      assert.doesNotMatch(joinMail.subject + joinMail.text, /clinforms/i);
    });
    const both = await newPage("two-clinics");
    await check("C2", "existing account opens the link on clinic.localhost → sign in to accept → join → lands in the ClinDesk clinic", async () => {
      const link = joinMail.links.find((l) => l.includes("/accept-invite"));
      await both.goto(link);
      const t1 = await visibleText(both);
      const signInLink = both.locator("a:has-text('Sign in to accept')");
      assert.equal(await signInLink.count(), 1, `no "Sign in to accept": ${t1.slice(0, 200)}`);
      const href = new URL(await signInLink.getAttribute("href"), both.url()).href;
      const r = await signInAt(both, href, FORMS_OWNER);
      const afterSignIn = both.url();
      if (await both.locator("button:has-text('Join')").count()) {
        await both.locator("button:has-text('Join')").click();
        await both.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
      }
      await both.waitForLoadState("networkidle").catch(() => {});
      const scan = await brandScan(both);
      await shot(both, "c2-joined-second-clinic");
      observe("C2", { afterSignIn: scrubLink(afterSignIn), landed: both.url(), title: scan.title, header: scan.text.slice(0, 160), hops: (both.__hops || []).map(scrubLink).slice(-6) });
      assert.equal(new URL(both.url()).origin, DESK);
      assert.equal(new URL(both.url()).pathname, "/app/clinic");
      return r.codeHint;
    });
    await check("C3", "a visible clinic switcher exists in the signed-in header/nav (member of two clinics)", async () => {
      await both.goto(`${DESK}/app`);
      const scan = await brandScan(both);
      const sw = scan.links.filter((l) => /select-clinic/.test(l.href) || /switch|change clinic|choose a clinic/i.test(l.text));
      await both.goto(`${DESK}/app/clinic`);
      const scan2 = await brandScan(both);
      const sw2 = scan2.links.filter((l) => /select-clinic/.test(l.href) || /switch|change clinic|choose a clinic/i.test(l.text));
      observe("C3", { onApp: sw, onClinicArea: sw2 });
      assert.ok(sw.length + sw2.length > 0, "no link to /app/select-clinic anywhere – only by typing the URL");
    });
    await check("C4", "on clinic.localhost switch to the ClinForms-only clinic via /app/select-clinic: where does it land, which brand?", async () => {
      await both.goto(`${DESK}/app/select-clinic`);
      const list = await visibleText(both);
      await shot(both, "c4-select-clinic-on-clinic-host");
      const row = both.locator("form", { hasText: FORMS_CLINIC.name });
      await row.locator("button:has-text('Open')").click();
      await both.waitForURL((u) => u.pathname !== "/app/select-clinic", { timeout: 30000 });
      await both.waitForLoadState("networkidle").catch(() => {});
      const scan = await brandScan(both);
      await shot(both, "c4-forms-clinic-on-clinic-host");
      observe("C4", { list: list.slice(0, 200), landed: both.url(), title: scan.title, brand: scan.brandAttr, marks: scan.marks, clinformsHits: hits(scan, /clinforms/).length, clindeskHits: hits(scan, /clindesk/).slice(0, 3) });
      assert.equal(new URL(both.url()).origin, FORMS, `the ClinForms-only clinic opened under the ClinDesk host/brand (${scan.title})`);
    });
    await check("C5", "on localhost (session from S2, active = ClinForms clinic): switch to the ClinDesk-only clinic → which host/brand?", async () => {
      await forms.goto(`${FORMS}/app/select-clinic`);
      const row = forms.locator("form", { hasText: DESK_CLINIC.name });
      assert.equal(await row.count(), 1, "the ClinDesk clinic is listed");
      await row.locator("button:has-text('Open')").click();
      await forms.waitForURL((u) => u.pathname !== "/app/select-clinic", { timeout: 30000 });
      await forms.waitForLoadState("networkidle").catch(() => {});
      const scan = await brandScan(forms);
      await shot(forms, "c5-desk-clinic-on-localhost");
      observe("C5", { landed: forms.url(), title: scan.title, brand: scan.brandAttr, clinformsHits: hits(scan, /clinforms/).slice(0, 4) });
      // back to the ClinForms clinic for the billing steps below
      await forms.goto(`${FORMS}/app/select-clinic`);
      await forms.locator("form", { hasText: FORMS_CLINIC.name }).locator("button:has-text('Open')").click();
      await forms.waitForURL((u) => u.pathname !== "/app/select-clinic", { timeout: 30000 });
      assert.equal(new URL(scan.url).origin, DESK, `the ClinDesk-only clinic opened on localhost under "${scan.title}"`);
    });
    await check("C6", "a new sign-in on localhost opens the most recent clinic (the ClinDesk one): brand/host?", async () => {
      const p = await newPage("two-clinics-localhost");
      const r = await signInAt(p, `${FORMS}/login`, FORMS_OWNER);
      const scan = await brandScan(p);
      observe("C6", { landed: r.landed, title: scan.title, header: scan.text.slice(0, 140) });
      await shot(p, "c6-fresh-signin-localhost-two-clinics");
      await p.context().close();
      assert.ok(!scan.text.includes(DESK_CLINIC.name) || new URL(r.landed).origin === DESK, `ClinForms owner signing in on localhost lands in ${DESK_CLINIC.name} under "${scan.title}"`);
    });

    /* ---------------------------------------------------------------- E – checkout return hosts (ClinDesk) */
    const deskBilling = `${DESK}/app/settings/billing`;
    await check("E1", "ClinDesk: start checkout (Solo monthly) → hosted page → its back link → /cancelled on clinic.localhost, no ClinForms", async () => {
      await desk.goto(deskBilling);
      await desk.locator("input[name=interval][value=month]").check();
      await desk.locator("input[name=band][value=solo]").check();
      if (await desk.locator("#plan-reports").count()) await desk.selectOption("#plan-reports", "none");
      await desk.click("button:has-text('Continue to payment')");
      await desk.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      const facts = await hostedPageFacts(desk, DESK);
      await shot(desk, "e1-desk-hosted-checkout");
      observe("E1-hosted", facts);
      const back = facts.ownLinks.find((l) => /\/cancelled/.test(l.href));
      assert.ok(back, `no back link to our page: ${JSON.stringify(facts.ownLinks)}`);
      await desk.locator(`a[href^="${DESK}"]`).first().click();
      await desk.waitForURL((u) => u.pathname.endsWith("/cancelled"), { timeout: 60000 });
      const scan = await brandScan(desk);
      await shot(desk, "e1-desk-cancelled");
      observe("E1", { url: scan.url, title: scan.title, text: scan.text.slice(0, 300), hits: hits(scan, /clinforms/) });
      assert.equal(new URL(scan.url).origin, DESK);
      assert.equal(hits(scan, /clinforms/).length, 0);
      const c = customerOf(DESK_CLINIC.slug);
      if (c) made.customers.add(c);
    });
    await check("E2", "ClinDesk: checkout with the test card → /done on clinic.localhost ('active'), no ClinForms", async () => {
      await desk.goto(deskBilling);
      await desk.locator("input[name=interval][value=month]").check();
      await desk.locator("input[name=band][value=solo]").check();
      if (await desk.locator("#plan-reports").count()) await desk.selectOption("#plan-reports", "none");
      await desk.click("button:has-text('Continue to payment')");
      await desk.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await fillCard(desk, DESK_OWNER, "Dana Desk (fictional)");
      await desk.locator("button[data-testid=hosted-payment-submit-button], button.SubmitButton").first().click();
      await desk.waitForURL((u) => u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      await desk.locator("[data-testid=billing-done]").waitFor();
      const scan = await brandScan(desk);
      await shot(desk, "e2-desk-done");
      const s = subOf(DESK_CLINIC.slug);
      if (s) made.subscriptions.add(s.subscription_ref);
      const c = customerOf(DESK_CLINIC.slug);
      if (c) made.customers.add(c);
      observe("E2", { url: scrubLink(scan.url), title: scan.title, state: await desk.locator("[data-testid=billing-done]").getAttribute("data-state"), text: scan.text.slice(0, 400), hits: hits(scan, /clinforms/), packages: ents(DESK_CLINIC.slug) });
      assert.equal(new URL(scan.url).origin, DESK);
      assert.equal(hits(scan, /clinforms/).length, 0, hits(scan, /clinforms/).join(" || "));
    });
    await check("E3", "ClinDesk: Plan and billing after paying (Add the Reports add-on offer) says no 'ClinForms'", async () => {
      await desk.goto(deskBilling);
      const scan = await brandScan(desk);
      await shot(desk, "e3-desk-billing-after-paying");
      const h = hits(scan, /clinforms/);
      observe("E3", { hits: h.slice(0, 6), addOn: await desk.locator("[data-testid=add-reports-form]").count() });
      assert.equal(h.length, 0, h.join(" || "));
    });
    await check("E4", "ClinDesk: Manage billing → hosted billing page; its return link goes back to clinic.localhost", async () => {
      await desk.goto(deskBilling);
      await desk.click("button:has-text('Manage billing')");
      await desk.waitForURL(/billing\.stripe\.com/, { timeout: 60000 });
      const facts = await hostedPageFacts(desk, DESK);
      await shot(desk, "e4-desk-billing-portal");
      observe("E4", facts);
      assert.ok(facts.ownLinks.length > 0, "no return link");
      for (const l of facts.ownLinks) assert.ok(l.href.startsWith(DESK), l.href);
    });

    /* ---------------------------------------------------------------- A – ClinDesk adds the Reports add-on */
    await check("A1", "ClinDesk adds the Reports add-on (25) on Plan and billing: wording on the way; packages after", async () => {
      await desk.goto(deskBilling);
      const form = desk.locator("[data-testid=add-reports-form]");
      await form.waitFor({ timeout: 20000 });
      const offerText = (await form.innerText()).replace(/\s+/g, " ");
      await form.locator("input[name=reports][value='25']").check();
      await form.locator("button:has-text('Add the Reports add-on')").click();
      await desk.locator("[data-testid=add-reports-done], [data-testid=plan-result]").first().waitFor({ timeout: 90000 });
      const done = (await desk.locator("[data-testid=add-reports-done], [data-testid=plan-result]").first().innerText()).replace(/\s+/g, " ");
      await shot(desk, "a1-desk-added-reports");
      observe("A1", { offer: offerText.slice(0, 300), done, packages: ents(DESK_CLINIC.slug), url: desk.url() });
      assert.match(ents(DESK_CLINIC.slug), /reports:active/);
      assert.equal(new URL(desk.url()).origin, DESK);
    });
    await check("A2", "ClinDesk + Reports: the clinic area's product switch → Studio stays on clinic.localhost; what brand does the Studio show?", async () => {
      await desk.goto(`${DESK}/app/clinic`);
      const area = await brandScan(desk);
      const toStudio = area.links.filter((l) => /\/app\/studio/.test(l.href));
      observe("A2-area", { studioLinks: toStudio, hits: hits(area, /clinforms/).slice(0, 4) });
      await shot(desk, "a2-desk-clinic-area-with-reports");
      assert.ok(toStudio.length > 0, "no way from the clinic area to the Studio");
      desk.__hops = [];
      await desk.locator(`a[href$="/app/studio"]`).first().click();
      await desk.waitForURL((u) => u.pathname.startsWith("/app/studio"), { timeout: 30000 });
      await desk.waitForLoadState("networkidle").catch(() => {});
      const st = await brandScan(desk);
      await shot(desk, "a2-desk-studio");
      observe("A2-studio", { url: st.url, title: st.title, icon: st.icon, marks: st.marks, brand: st.brandAttr, clinformsHits: hits(st, /clinforms/).slice(0, 6), foreign: foreignLinks(st, DESK), hops: desk.__hops });
      assert.equal(new URL(st.url).origin, DESK);
      assert.equal(foreignLinks(st, DESK).length, 0, foreignLinks(st, DESK).join(" || "));
    });
    await check("A3", "ClinDesk + Reports: every Studio page keeps clinic.localhost; links back to ClinDesk; no link to localhost", async () => {
      const seen = [];
      for (const p of ["/app/studio", "/app/studio/new", "/app/studio/forms", "/app/studio/templates", "/app/studio/batch", "/app/studio/security"]) {
        const res = await desk.goto(`${DESK}${p}`);
        await desk.waitForLoadState("networkidle").catch(() => {});
        const st = await brandScan(desk);
        seen.push({ p, status: res.status(), at: new URL(desk.url()).origin === DESK ? "desk" : desk.url(), title: st.title, foreign: foreignLinks(st, DESK), demo: st.links.filter((l) => /\/reports(\?|$)|pms-sandbox/.test(l.href)).map((l) => `${l.href} (${l.text})`), backToDesk: st.links.some((l) => /\/app\/clinic$/.test(l.href)) });
      }
      observe("A3", { seen });
      const bad = seen.filter((s) => s.at !== "desk" || s.foreign.length);
      assert.equal(bad.length, 0, JSON.stringify(bad));
    });
    await check("A4", "ClinDesk + Reports: back from the Studio via the product switch → /app/clinic on clinic.localhost", async () => {
      await desk.goto(`${DESK}/app/studio`);
      const back = desk.locator("a[href$='/app/clinic']").first();
      assert.equal(await back.count(), 1, "no link back");
      await back.click();
      await desk.waitForURL((u) => u.pathname === "/app/clinic", { timeout: 30000 });
      assert.equal(new URL(desk.url()).origin, DESK);
    });
    await check("A5", "ClinDesk + Reports: /app overview and Plan & usage – brand words used for the add-on", async () => {
      const seen = {};
      for (const p of ["/app", "/app/settings/plan", "/app/settings/billing"]) {
        await desk.goto(`${DESK}${p}`);
        seen[p] = hits(await brandScan(desk), /clinforms/).slice(0, 4);
      }
      observe("A5", seen);
    });
    await check("A6", "ClinDesk + Reports: the /reports demo link from the overview on clinic.localhost goes where?", async () => {
      await desk.goto(`${DESK}/app`);
      const demo = desk.locator("a[href='/reports']");
      if (!(await demo.count())) return "no demo link";
      await demo.first().click();
      await desk.waitForLoadState("networkidle").catch(() => {});
      const scan = await brandScan(desk);
      await shot(desk, "a6-desk-demo-link");
      observe("A6", { url: scan.url, title: scan.title, text: scan.text.slice(0, 200) });
      assert.doesNotMatch(scan.title, /Referrer reports/i, `"Try the demo with fictional patients" opens ClinDesk's marketing page "${scan.title}" instead of the demo`);
    });

    /* ---------------------------------------------------------------- E – checkout return hosts (ClinForms) */
    const formsBilling = `${FORMS}/app/settings/billing`;
    await check("E5", "ClinForms: start checkout (Starter) → hosted page (whose name?) → back link → /cancelled on localhost, ClinForms brand", async () => {
      await forms.goto(formsBilling);
      const defaultForm = await forms.locator("[data-testid=plan-form]").getAttribute("aria-label");
      if (!(await forms.locator("input[name=tier][value=starter]").count())) await forms.goto(`${formsBilling}?product=clinforms`);
      await forms.locator("input[name=tier][value=starter]").check();
      await forms.click("button:has-text('Continue to payment')");
      await forms.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      const facts = await hostedPageFacts(forms, FORMS);
      await shot(forms, "e5-forms-hosted-checkout");
      observe("E5-hosted", { defaultForm, ...facts });
      await forms.locator(`a[href^="${FORMS}"]`).first().click();
      await forms.waitForURL((u) => u.pathname.endsWith("/cancelled"), { timeout: 60000 });
      const scan = await brandScan(forms);
      await shot(forms, "e5-forms-cancelled");
      observe("E5", { url: scan.url, title: scan.title, text: scan.text.slice(0, 300), clindesk: hits(scan, /clindesk/).slice(0, 3) });
      const c = customerOf(FORMS_CLINIC.slug);
      if (c) made.customers.add(c);
      assert.equal(new URL(scan.url).origin, FORMS);
      assert.match(scan.title, /ClinForms/);
      // The shared payment account's public name (CLAUDE.md's deliberate exception) – recorded, Khuram to decide.
      if (facts.mentions.clindesk) observe("E5-shared-account-name", { decisionPending: true, headerText: facts.headerText });
    });
    await check("E6", "ClinForms: checkout with the test card → /done on localhost, ClinForms brand", async () => {
      await forms.goto(formsBilling);
      if (!(await forms.locator("input[name=tier][value=starter]").count())) await forms.goto(`${formsBilling}?product=clinforms`);
      await forms.locator("input[name=tier][value=starter]").check();
      await forms.click("button:has-text('Continue to payment')");
      await forms.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await fillCard(forms, FORMS_OWNER, "Fran Forms (fictional)");
      await forms.locator("button[data-testid=hosted-payment-submit-button], button.SubmitButton").first().click();
      await forms.waitForURL((u) => u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      await forms.locator("[data-testid=billing-done]").waitFor();
      const scan = await brandScan(forms);
      await shot(forms, "e6-forms-done");
      const s = subOf(FORMS_CLINIC.slug);
      if (s) made.subscriptions.add(s.subscription_ref);
      const c = customerOf(FORMS_CLINIC.slug);
      if (c) made.customers.add(c);
      observe("E6", { url: scrubLink(scan.url), title: scan.title, state: await forms.locator("[data-testid=billing-done]").getAttribute("data-state"), text: scan.text.slice(0, 400), clindesk: hits(scan, /clindesk/).slice(0, 3), foreign: foreignLinks(scan, FORMS) });
      assert.equal(new URL(scan.url).origin, FORMS);
      assert.match(scan.title, /ClinForms/);
      assert.equal(foreignLinks(scan, FORMS).length, 0);
    });
    await check("E7", "ClinForms: Manage billing → hosted billing page returns to localhost", async () => {
      await forms.goto(formsBilling);
      await forms.click("button:has-text('Manage billing')");
      await forms.waitForURL(/billing\.stripe\.com/, { timeout: 60000 });
      const facts = await hostedPageFacts(forms, FORMS);
      await shot(forms, "e7-forms-billing-portal");
      observe("E7", facts);
      for (const l of facts.ownLinks) assert.ok(l.href.startsWith(FORMS), l.href);
      // The shared payment account's public name (CLAUDE.md's deliberate exception) – recorded, Khuram to decide.
      if (facts.mentions.clindesk) observe("E7-shared-account-name", { decisionPending: true, headerText: facts.headerText });
    });
    await check("E8", "ClinForms Plan and billing after paying: still offers ClinDesk (upgrade path) to the owner", async () => {
      await forms.goto(formsBilling);
      const scan = await brandScan(forms);
      await shot(forms, "e8-forms-billing-after-paying");
      observe("E8", { clindesk: hits(scan, /clindesk/).slice(0, 5) });
      assert.ok(/clindesk/i.test(scan.text), "no ClinDesk upgrade offer on Plan and billing");
    });

    /* ---------------------------------------------------------------- X – the outbox */
    await new Promise((r) => setTimeout(r, 3000));
    const all = outbox();
    fs.writeFileSync(path.join(OUT, "outbox.json"), JSON.stringify(all.map((m) => ({ to: m.to, subject: m.subject, links: m.links.map(scrubLink), text: m.text.replace(/token=[^&\s]+/g, "token=…").slice(0, 1200) })), null, 2));
    await check("X1", "every email to a ClinDesk-only member (owner before the add-on, reception x2) speaks for ClinDesk and links to clinic.localhost", async () => {
      const bad = [];
      for (const to of [RECEPTION, RECEPTION2]) {
        for (const m of mailsTo(to)) {
          if (/clinforms/i.test(m.subject + m.text) || m.links.some((l) => l.startsWith(FORMS))) bad.push(`${to}: ${m.subject} ${m.links.map(scrubLink).join(" ")}`);
        }
      }
      for (const m of mailsTo(DESK_OWNER)) {
        if (/clinforms/i.test(m.subject + m.text) || m.links.some((l) => l.startsWith(FORMS))) bad.push(`${DESK_OWNER}: ${m.subject} ${m.links.map(scrubLink).join(" ")}`);
      }
      observe("X1", { deskOwnerMails: mailsTo(DESK_OWNER).map((m) => ({ subject: m.subject, links: m.links.map(scrubLink) })) });
      assert.equal(bad.length, 0, bad.join(" || "));
    });
    await check("X2", "every email to the ClinForms-only owner about ITS clinic speaks for ClinForms and links to localhost (billing notices included)", async () => {
      const mine = mailsTo(FORMS_OWNER).filter((m) => !/^Join /.test(m.subject));
      observe("X2", { formsOwnerMails: mine.map((m) => ({ subject: m.subject, links: m.links.map(scrubLink), clindesk: /clindesk/i.test(m.text) })) });
      const bad = mine.filter((m) => /clindesk/i.test(m.subject + m.text) || m.links.some((l) => l.startsWith(DESK)));
      assert.equal(bad.length, 0, bad.map((m) => `${m.subject}: ${m.links.map(scrubLink).join(" ")}`).join(" || "));
    });
    await check("X3", "no page errors in the browser", () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1500)}`);
    results.push({ id: "run", pass: false, error: String(err).slice(0, 900) });
  } finally {
    // TEST-mode clean-up: subscriptions, then the customers ("TEST – …") this run made.
    try {
      if (sql) {
        for (const r of sql.prepare("SELECT subscription_ref, customer_ref FROM clinic_subscription").all()) {
          if (r.subscription_ref) made.subscriptions.add(r.subscription_ref);
          if (r.customer_ref) made.customers.add(r.customer_ref);
        }
        for (const r of sql.prepare("SELECT customer_ref FROM pms_sms_credit_accounts WHERE customer_ref IS NOT NULL").all()) made.customers.add(r.customer_ref);
      }
    } catch {
      // tables missing
    }
    const cleanup = [];
    for (const id of made.subscriptions) cleanup.push(`sub ${String(id).slice(0, 8)}… ${(await api("DELETE", `/subscriptions/${id}`).catch((e) => ({ error: String(e) }))).status || "?"}`);
    for (const id of made.customers) {
      const c = await api("GET", `/customers/${id}`).catch(() => null);
      if (c && c.name && !/^TEST – /.test(c.name)) {
        cleanup.push(`customer ${id.slice(0, 8)}… NOT deleted (name not TEST –)`);
        continue;
      }
      const d = await api("DELETE", `/customers/${id}`).catch((e) => ({ error: String(e) }));
      cleanup.push(`customer ${String(id).slice(0, 8)}… (${c && c.name}) deleted=${d.deleted === true}`);
    }
    console.log(`cleanup: ${cleanup.join("; ")}`);
    await browser.close().catch(() => {});
    stopServer();
    await new Promise((r) => setTimeout(r, 800));
    if (sql) sql.close();
    fs.rmSync(TMP, { recursive: true, force: true });
    const scrub = (s) => s.replace(/token=\S+/g, "token=…").replace(/whsec_[A-Za-z0-9]+/g, "whsec_…").replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_…");
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUT, "observations.json"), JSON.stringify(notes, null, 2));
    fs.writeFileSync(path.join(OUT, "cleanup.txt"), cleanup.join("\n"));
    fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
