/**
 * JOURNEY A1 (01/11/2026) – a brand-new ClinDesk-ONLY customer, end to end in a real browser, LOCAL only.
 * Khuram's requirements R1 (a ClinDesk-only clinic never sees "ClinForms" and never leaves the ClinDesk host) and R3
 * (every page, email and redirect shows the right product name and host).
 *
 * Starts its own `next start` (PORT, default 3401) on a throwaway SQLite database (E2E_OUT), BETTER_AUTH_URL =
 * http://localhost:<port> and CLINFORMS_AUTH_ORIGINS = http://clinic.localhost:<port>. Email goes to a FAKE Mailpit
 * started by this script (CLINFORMS_EMAIL_PROVIDER=mailpit, MAILPIT_URL=http://127.0.0.1:<port+1>) so the sender name,
 * subject, text and HTML of every message can be checked; the clinic brand's sender is set as on production
 * (MAILERSEND_FROM_EMAIL_CLINIC=no-reply@clindesk.co.uk). Payments: the ClinDesk Stripe account's TEST mode (key from
 * ~/.config/appstackx/clinforms.secrets.env STRIPE_CLINDESK_TEST_SECRET_KEY, never printed), webhooks forwarded by
 * the `stripe` CLI. Fictional data only; the test customer ("TEST – …") is deleted at the end.
 *
 *   J1  public site on clinic.localhost → "Book a demo" → submitted → thanks page
 *   J2  platform administrator (ClinForms staff, on localhost) creates the clinic with "Owner signs in on: ClinDesk",
 *       invitation emailed
 *   J3  the owner opens the emailed link → account → two-step set-up (TOTP from the page) → lands
 *   J4  Plan and billing → ClinDesk Solo monthly → TEST checkout (4242) → done page → "Open ClinDesk"
 *   J5  every page reachable from the clinic system's navigation and the account menu (crawl), plus every known
 *       route by direct URL
 *   J5m (14/11/2026) Messages → Send a message: the patient picked through the search stays chosen (regression), sent
 *   J5d (01/11/2026) the activity CSV download: brand-neutral file name, the support team's neutral id (V1/V2); the
 *       ClinDesk theme colour (<meta name="theme-color">) on the app, sign-in and 404 pages (V3)
 *   J6  Manage billing → the hosted portal's return link → back on clinic.localhost
 *   J7  sign out → "Forgotten your password?" → emailed link → new password → sign in again (+ code)
 *   J8  404 pages
 *   EM  every email to the owner: sender name, subject, body, links
 *
 * Every page: host must be clinic.localhost:<port>, no "ClinForms" in title / visible text / attributes, no link to
 * ClinForms' host, the ClinDesk tab icon (fetched: the coral tape) and the ClinDesk mark. Violations are FINDINGS
 * (written to E2E_OUT/findings.json) – this script reports, it does not fail fast.
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/dutydesk/node_modules node scripts/e2e/journey-clindesk-only.cjs
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { payByCard } = require("./hosted-checkout.cjs");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3401);
const MAIL_PORT = PORT + 1;
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const DESK_HOST = `clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "journey-clindesk-only");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-ja1-"));
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
const STAMP = Date.now().toString(36);
const PLATFORM = "zz-platform-ja1@example.com";
const OWNER = `dana.ja1.${STAMP}@larkfield-physio.example.com`;
const CLINIC = { name: "Larkfield Physio (fictional)", slug: `larkfield-ja1-${STAMP}` };
const PLATFORM_CLINIC = { name: "ZZ Platform Home (fictional)", slug: `zz-platform-ja1-${STAMP}` };
const CLINIC_MARK = "#C4432B"; // public/clindesk/favicon.svg's coral tape
const CLINFORMS_MARK = "#0D9488"; // src/app/icon.svg's teal
const BAD = /clin\s*forms/i;
let WEBHOOK_SECRET = "";
const users = {};

/* ------------------------------------------------------------------ findings + results */
const results = [];
const findings = [];
const navLog = []; // every main-frame navigation / redirect of the owner's browser
const pageAudits = [];
const deliberate = []; // public-site mentions of ClinForms kept on purpose (the public-site decision)
function finding(req, severity, where, observed, expected, extra = {}) {
  const id = `F${String(findings.length + 1).padStart(2, "0")}`;
  findings.push({ id, requirement: req, severity, where, observed, expected, ...extra });
  console.log(`FINDING ${id} [${req}/${severity}] ${where}: ${observed}`);
}
async function step(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    const msg = String(err && err.stack ? err.stack : err).slice(0, 1200);
    results.push({ id, what, pass: false, error: msg });
    console.log(`FAIL ${id} ${what}: ${msg}`);
    for (const [who, p] of livePages) await p.screenshot({ path: path.join(SHOTS, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ fake Mailpit (captures every message) */
const mails = [];
const mailServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/api/v1/send") {
      try {
        const m = JSON.parse(body);
        mails.push({ at: new Date().toISOString(), ...m });
      } catch {
        // ignore
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ID: `fake-${mails.length}` }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
const mailsTo = (to) => mails.filter((m) => (m.To || []).some((t) => t.Email === to));
const lastMailTo = (to, re) => mailsTo(to).filter((m) => re.test(m.Subject)).at(-1);
const linkIn = (m, re) => (((m && m.Text) || "").match(re) || [])[0] || null;

/* ------------------------------------------------------------------ server, webhook forwarding */
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
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "mailpit",
    MAILPIT_URL: `http://127.0.0.1:${MAIL_PORT}`,
    MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk",
    MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk",
    CLINFORMS_EMAIL_REPLY_TO: "hello@clinforms.co.uk",
    CLINFORMS_EMAIL_REPLY_TO_CLINIC: "hello@clindesk.co.uk",
    CLINFORMS_PLATFORM_ADMINS: PLATFORM,
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    STRIPE_CLINDESK_SECRET_KEY: KEY,
    STRIPE_CLINDESK_WEBHOOK_SECRET: WEBHOOK_SECRET,
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

/* ------------------------------------------------------------------ the brand audit of one page */
/** Everything on the page that names ClinForms or points at ClinForms' host. */
async function pageFacts(page) {
  return page.evaluate(
    async ({ port }) => {
      const bad = /clin\s*forms/i;
      const out = { title: document.title, textHits: [], attrHits: [], linkHits: [], icon: null, apple: null, iconBody: null, mark: null, h1: null };
      const text = document.body ? document.body.innerText : "";
      for (const m of text.matchAll(/.{0,60}clin\s*forms.{0,60}/gi)) out.textHits.push(m[0].replace(/\s+/g, " ").trim());
      for (const el of document.querySelectorAll("[alt],[aria-label],[title],[placeholder],meta[content],input[value]")) {
        for (const a of ["alt", "aria-label", "title", "placeholder", "content", "value"]) {
          const v = el.getAttribute(a);
          if (v && bad.test(v)) out.attrHits.push(`<${el.tagName.toLowerCase()} ${a}="${v.slice(0, 120)}">`);
        }
      }
      for (const a of document.querySelectorAll("a[href],form[action],link[href]")) {
        const raw = a.getAttribute("href") || a.getAttribute("action") || "";
        let u;
        try {
          u = new URL(raw, location.href);
        } catch {
          continue;
        }
        const offHost = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && String(u.port) === String(port);
        if (offHost || /clinforms\.co\.uk/i.test(u.hostname) || bad.test(u.href)) out.linkHits.push(`${a.tagName.toLowerCase()} ${u.href}${a.textContent ? ` "${a.textContent.trim().slice(0, 60)}"` : ""}`);
      }
      const href = (sel) => {
        const el = document.querySelector(sel);
        return el ? new URL(el.getAttribute("href"), location.href).pathname : null;
      };
      out.icon = href("link[rel~='icon']");
      out.apple = href("link[rel='apple-touch-icon']");
      try {
        const res = await fetch(new URL(document.querySelector("link[rel~='icon']")?.getAttribute("href") || "/favicon.ico", location.href));
        out.iconBody = (await res.text()).slice(0, 4000);
      } catch {
        out.iconBody = null;
      }
      const mark = document.querySelector("a[aria-label$=' home']");
      out.mark = mark ? mark.getAttribute("aria-label") : null;
      const h1 = document.querySelector("h1");
      out.h1 = h1 ? h1.innerText.trim().slice(0, 120) : null;
      return out;
    },
    { port: PORT },
  );
}
/**
 * Audits the page the owner is on. `ctx.linked` = reached by clicking/following the app's own links (serious when
 * wrong) vs typed by URL (minor). Returns the facts.
 */
async function audit(page, label, ctx = {}) {
  const { linked = true, expectMark = true, shot = true, publicSite = false } = ctx;
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(250);
  const url = page.url();
  const u = new URL(url);
  const f = await pageFacts(page).catch((e) => ({ error: String(e) }));
  const rec = { label, url, linked, ...f, iconBody: undefined, iconIsClinDesk: f.iconBody ? f.iconBody.includes(CLINIC_MARK) : null, iconIsClinForms: f.iconBody ? f.iconBody.includes(CLINFORMS_MARK) : null };
  pageAudits.push(rec);
  const sev = linked ? "serious" : "minor";
  const where = `${label} – ${url}`;
  if (u.host !== DESK_HOST) finding("R1", "serious", where, `left the ClinDesk host: on ${u.host}`, `stay on ${DESK_HOST}`);
  if (f.error) return rec;
  if (BAD.test(f.title)) finding("R1", sev, where, `document.title = "${f.title}"`, "title names ClinDesk, never ClinForms");
  // Decision (01/11/2026): ClinDesk's PUBLIC website may link to clinforms.co.uk ("works on its own") – no "powered by" since 01/11 –
  // recorded as "deliberate", not a finding against the app.
  if (publicSite && (f.textHits.length || f.attrHits.length || f.linkHits.length)) {
    deliberate.push({ where, text: f.textHits, attrs: f.attrHits, links: f.linkHits });
    f.textHits = [];
    f.attrHits = [];
    f.linkHits = [];
  }
  if (f.textHits.length) finding("R1", sev, where, `visible text names ClinForms: ${[...new Set(f.textHits)].slice(0, 4).map((t) => `"${t}"`).join(" | ")}`, "no ClinForms wording for a ClinDesk-only clinic");
  if (f.attrHits.length) finding("R1", sev, where, `attributes name ClinForms: ${[...new Set(f.attrHits)].slice(0, 4).join(" | ")}`, "no ClinForms in alt/aria/title attributes");
  if (f.linkHits.length) finding("R1", sev, where, `links to ClinForms' host/name: ${[...new Set(f.linkHits)].slice(0, 4).join(" | ")}`, `links stay on ${DESK_HOST}`);
  if (rec.iconIsClinDesk === false) finding("R3", sev, where, `tab icon ${f.icon || "(none named)"} is not the ClinDesk mark${rec.iconIsClinForms ? " (it is ClinForms' teal icon)" : ""}`, "ClinDesk tab icon (/clindesk/favicon.svg)");
  if (expectMark && f.mark && f.mark !== "ClinDesk home") finding("R3", sev, where, `header mark is "${f.mark}"`, `"ClinDesk home"`);
  if (shot) await page.screenshot({ path: path.join(SHOTS, `${String(pageAudits.length).padStart(3, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`) }).catch(() => {});
  return rec;
}
/** Records every main-frame navigation and redirect of a page into navLog, and flags any off the ClinDesk host. */
function watchNav(page, who) {
  page.on("framenavigated", (fr) => {
    if (fr !== page.mainFrame()) return;
    navLog.push({ who, kind: "nav", url: fr.url() });
  });
  page.on("response", (res) => {
    const req = res.request();
    if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
    const s = res.status();
    if (s >= 300 && s < 400) navLog.push({ who, kind: `redirect ${s}`, url: res.url(), location: res.headers()["location"] || "" });
  });
}

/* ------------------------------------------------------------------ run */
const livePages = [];
(async () => {
  await new Promise((r) => mailServer.listen(MAIL_PORT, "127.0.0.1", r));
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newPage = async (who, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    livePages.push([who, page]);
    return page;
  };
  let customerRef = null;
  try {
    WEBHOOK_SECRET = execFileSync("stripe", ["listen", "--print-secret"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY }, encoding: "utf8", timeout: 30000 }).trim();
    assert(/^whsec_[A-Za-z0-9]+$/.test(WEBHOOK_SECRET), "no webhook secret from the CLI");
    // Platform administrator's own (ClinForms) clinic, so staff can sign in to /app/platform – staff, not the customer.
    const adminCli = execFileSync("npm", ["run", "-s", "admin:create-clinic", "--", "--name", PLATFORM_CLINIC.name, "--slug", PLATFORM_CLINIC.slug, "--owner-email", PLATFORM], { cwd: REPO, env: appEnv(), encoding: "utf8" });
    const adminLink = (adminCli.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    await startServer();
    startListener();
    await new Promise((r) => setTimeout(r, 4000));

    /* J1 – public site and Book a demo, as the prospective customer */
    const owner = await newPage("owner");
    watchNav(owner, "owner");
    await step("J1", "public site on clinic.localhost → Book a demo → submitted → thanks", async () => {
      await owner.goto(`${DESK}/`);
      await audit(owner, "public home", { publicSite: true });
      for (const p of ["/features", "/pricing", "/reports", "/switching", "/security", "/tour"]) {
        await owner.goto(`${DESK}${p}`);
        await audit(owner, `public ${p}`, { linked: true, publicSite: true });
      }
      await owner.goto(`${DESK}/`);
      await owner.locator("a[href='/demo']").first().click();
      await owner.waitForURL(`${DESK}/demo`);
      await audit(owner, "public /demo");
      await owner.fill("#f-name", "Dana Lark (fictional)");
      await owner.fill("#f-clinic", CLINIC.name);
      await owner.fill("#f-email", OWNER);
      await owner.fill("#f-phone", "01908 000222");
      await owner.selectOption("#f-sites", { index: 1 });
      await owner.selectOption("#f-practitioners", { index: 1 });
      await owner.fill("#f-system", "Paper diary");
      await owner.check("input[name=see][value=diary]");
      await owner.click("button.d-submit");
      await owner.waitForURL(`${DESK}/demo/thanks`);
      await audit(owner, "public /demo/thanks");
      // The other public paths' links on the home page (header/footer) – every one must stay on the ClinDesk host.
      await owner.goto(`${DESK}/`);
      const hrefs = await owner.$$eval("a[href]", (as) => [...new Set(as.map((a) => a.href))]);
      const off = hrefs.filter((h) => { try { const u = new URL(h); return u.protocol.startsWith("http") && u.host !== location.host && /localhost|clinforms/i.test(u.host); } catch { return false; } });
      if (off.length) finding("R1", "serious", `public home links – ${DESK}/`, `links off the ClinDesk host: ${off.join(", ")}`, "all links on clinic.localhost");
      return `${hrefs.length} links on the home page`;
    });

    /* J2 – the platform administrator creates the clinic (ClinDesk brand) and emails the invitation */
    const staff = await newPage("staff");
    let inviteMail = null;
    await step("J2", "platform: create the clinic with 'Owner signs in on: ClinDesk', invitation emailed", async () => {
      assert(adminLink, "platform admin link");
      users[PLATFORM] = { password: `e2e ${rnd(12)} password` };
      await staff.goto(adminLink);
      await staff.waitForSelector("text=Create your account");
      await staff.fill("#f-name", "Pat Platform (fictional)");
      await staff.fill("#f-password", users[PLATFORM].password);
      await staff.fill("#f-confirm", users[PLATFORM].password);
      await staff.click("button[type=submit]");
      await staff.waitForURL(`${FORMS}/two-factor`);
      await staff.fill("#f-password", users[PLATFORM].password);
      await staff.click("button[type=submit]");
      await staff.waitForSelector("img[alt^='Authenticator set-up code']");
      users[PLATFORM].key = (await staff.locator("code").first().innerText()).trim();
      await staff.check("input[name=saved]");
      await staff.fill("#f-code", await freshCode(PLATFORM));
      await staff.click("button[type=submit]");
      await staff.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start");
      await staff.goto(`${FORMS}/app/platform`);
      // The demo request is listed with the ClinDesk label
      const req = staff.locator("li", { hasText: CLINIC.name }).first();
      const reqText = (await req.count()) ? (await req.innerText()).replace(/\s+/g, " ") : "(not listed)";
      const form = staff.locator("form", { has: staff.locator("button:has-text('Create clinic and invite the owner')") });
      await form.locator("input[name=name]").fill(CLINIC.name);
      await form.locator("input[name=slug]").fill(CLINIC.slug);
      await form.locator("input[name=ownerEmail]").fill(OWNER);
      await form.locator("select[name=linkBrand]").selectOption("clinic");
      const box = form.locator("input[name=sendEmail]");
      if (await box.count()) await box.check();
      await form.locator("button:has-text('Create clinic and invite the owner')").click();
      await staff.waitForSelector(`text=${CLINIC.slug}`, { timeout: 30000 });
      await staff.screenshot({ path: path.join(SHOTS, "staff-platform-created.png"), fullPage: true });
      inviteMail = await (async () => {
        for (let i = 0; i < 30; i++) {
          const m = lastMailTo(OWNER, /./);
          if (m) return m;
          await new Promise((r) => setTimeout(r, 500));
        }
        return null;
      })();
      assert(inviteMail, "no invitation email captured");
      return `demo request on the platform page: ${reqText.slice(0, 140)}; invitation subject "${inviteMail.Subject}"`;
    });

    /* J3 – the owner accepts from the emailed link and sets up two-step verification */
    let landed = null;
    await step("J3", "owner: emailed link → account → two-step set-up → lands", async () => {
      const link = linkIn(inviteMail, /https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/);
      assert(link, "invitation link in the email");
      if (new URL(link).host !== DESK_HOST) finding("R1", "serious", "owner invitation email link", `link goes to ${new URL(link).origin}`, DESK);
      users[OWNER] = { password: `e2e ${rnd(12)} password` };
      await owner.goto(link);
      await owner.waitForSelector("text=Create your account");
      await audit(owner, "accept-invite", { expectMark: true });
      await owner.fill("#f-name", "Dana Lark (fictional)");
      await owner.fill("#f-password", users[OWNER].password);
      await owner.fill("#f-confirm", users[OWNER].password);
      await owner.click("button[type=submit]");
      await owner.waitForURL((u) => u.pathname === "/two-factor");
      await audit(owner, "two-factor (password step)");
      await owner.fill("#f-password", users[OWNER].password);
      await owner.click("button[type=submit]");
      await owner.waitForSelector("img[alt^='Authenticator set-up code']");
      await audit(owner, "two-factor set-up (QR)");
      const uri = await owner.locator("a[href^='otpauth://']").getAttribute("href");
      const issuer = new URL(uri).searchParams.get("issuer");
      const labelPart = decodeURIComponent(new URL(uri).pathname);
      if (issuer !== "ClinDesk" || BAD.test(labelPart)) finding("R1", "serious", "two-factor set-up – authenticator entry", `issuer="${issuer}" label="${labelPart}"`, 'issuer "ClinDesk"');
      users[OWNER].key = (await owner.locator("code").first().innerText()).trim();
      await owner.check("input[name=saved]");
      await owner.fill("#f-code", await freshCode(OWNER));
      await owner.click("button[type=submit]");
      await owner.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
      landed = new URL(owner.url()).pathname;
      await audit(owner, `landing after two-step (${landed})`);
      // 01/11/2026: before a plan there is no clinic system yet – an owner lands on Plan and billing (ClinDesk plans).
      if (!landed.startsWith("/app/clinic") && !landed.startsWith("/app/settings/billing")) finding("R1", "serious", `landing after two-step – ${owner.url()}`, `a brand-new ClinDesk-brand clinic (no plan yet) lands on ${landed}, not the clinic system`, "/app/clinic, or a ClinDesk-branded 'choose your plan' start page");
      return `landed on ${landed}; issuer ${issuer}`;
    });

    // Before buying: the pages the owner can reach from where they landed (a new customer explores first).
    await step("J3b", "before a plan: Plan and billing and the pages linked from the landing page", async () => {
      await owner.goto(`${DESK}${landed || "/app"}`);
      const links = await owner.$$eval("a[href^='/app']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
      for (const l of links.slice(0, 25)) {
        await owner.goto(`${DESK}${l}`);
        await audit(owner, `pre-plan ${l}`);
      }
      await owner.goto(`${DESK}/app/settings/billing`);
      await audit(owner, "pre-plan Plan and billing");
      await owner.screenshot({ path: path.join(SHOTS, "plan-billing-before.png"), fullPage: true });
      const main = await owner.locator("main").innerText();
      fs.writeFileSync(path.join(OUT, "plan-billing-before.txt"), main);
      const addOn = (main.match(/.{0,80}Reports.{0,80}/g) || []).slice(0, 6);
      return `${links.length} links; Reports wording: ${addOn.map((s) => s.replace(/\s+/g, " ")).join(" | ").slice(0, 400)}`;
    });

    /* J4 – buy ClinDesk Solo monthly */
    await step("J4", "Plan and billing → ClinDesk Solo monthly → TEST checkout 4242 → done → Open ClinDesk", async () => {
      await owner.goto(`${DESK}/app/settings/billing`);
      await owner.locator("input[name=interval][value=month]").check();
      await owner.locator("input[name=band][value=solo]").check();
      if (await owner.locator("#plan-reports").count()) await owner.selectOption("#plan-reports", "none").catch(() => {});
      await owner.click("button:has-text('Continue to payment')");
      await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
      await owner.waitForTimeout(2500);
      const co = await owner.locator("body").innerText();
      fs.writeFileSync(path.join(OUT, "checkout.txt"), co);
      await owner.screenshot({ path: path.join(SHOTS, "checkout.png"), fullPage: true });
      if (BAD.test(co)) finding("R1", "serious", "Stripe checkout page (checkout.stripe.com)", `checkout names ClinForms: ${(co.match(/.{0,60}clin\s*forms.{0,60}/i) || [""])[0].replace(/\s+/g, " ")}`, "ClinDesk account branding only");
      const coTitle = await owner.title();
      if (BAD.test(coTitle)) finding("R1", "serious", "Stripe checkout tab title", coTitle, "no ClinForms");
      await payByCard(owner, { email: OWNER, name: "TEST – Dana Lark (fictional)", notesFile: path.join(OUT, "checkout-controls.txt") });
      await owner.waitForURL((u) => u.pathname === "/app/settings/billing/done", { timeout: 120000 });
      await owner.locator("[data-testid=billing-done]").waitFor();
      const state = await owner.locator("[data-testid=billing-done]").getAttribute("data-state");
      await audit(owner, "billing done page");
      await owner.screenshot({ path: path.join(SHOTS, "billing-done.png"), fullPage: true });
      const sql = openScratchDb({ readOnly: true });
      const s = sql.prepare("SELECT * FROM clinic_subscription WHERE tenant_id = ?").get(CLINIC.slug);
      const ents = sql.prepare("SELECT package, status, plan_code FROM clinic_entitlements WHERE tenant_id = ?").all(CLINIC.slug);
      sql.close();
      customerRef = s && s.customer_ref;
      const open = owner.locator("a:has-text('Open ClinDesk')");
      assert(await open.count(), "Open ClinDesk link on the done page");
      await open.first().click();
      await owner.waitForURL((u) => u.pathname.startsWith("/app/clinic"));
      await audit(owner, "Open ClinDesk → clinic home");
      return `done state ${state}; subscription ${s && s.state} ${s && s.product} ${s && s.plan_key}; packages ${JSON.stringify(ents)}`;
    });

    /* J5 – every page from the navigation (crawl) */
    await step("J5a", "create a fictional patient so the record pages exist", async () => {
      await owner.goto(`${DESK}/app/clinic/patients/new`);
      await audit(owner, "patients/new");
      await owner.fill("input[name=firstName]", "Pip");
      await owner.fill("input[name=lastName]", "Testpatient");
      await owner.fill("input[name=dateOfBirth]", "01/02/1980");
      await owner.fill("input[name=email]", "pip.testpatient@example.com");
      await owner.locator("button[name=intent][value=save]").first().click();
      await owner.waitForURL((u) => /\/app\/clinic\/patients\/[^/]+/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 30000 });
      return new URL(owner.url()).pathname;
    });

    // 14/11/2026 fix: choosing the patient in the search used to reset the form to empty (the server action renews
    // the session cookie, so the page refreshes). Picked through the search as a user would, then sent.
    await step("J5m", "Messages → Send a message: the patient picked through the search stays chosen → sent", async () => {
      await owner.goto(`${DESK}/app/clinic/messages?tab=send`);
      await audit(owner, "messages?tab=send");
      await owner.locator("#sm-to").pressSequentially("Testpat", { delay: 50 });
      await owner.locator("main button:has-text('Pip Testpatient')").first().click();
      await owner.waitForSelector("[data-testid=send-form]", { timeout: 20000 });
      await owner.waitForTimeout(3000); // the refresh after the server actions must not empty the form
      assert.equal(await owner.locator("[data-testid=send-form]").count(), 1, "the form is still open for the patient");
      assert.match(await owner.locator("#sm-to").inputValue(), /^Pip Testpatient/);
      await owner.check("input[name=sm-channel][value=email]");
      await owner.fill("#sm-b", "Hello {{patient.first_name}}, the car park is closed on Friday (fictional e2e).");
      await owner.click("[data-testid=send-now]");
      await owner.waitForSelector("[role=status] >> text=/Sent/", { timeout: 20000 });
      return "picked through the search, sent by email (test service)";
    });

    const visited = new Set();
    const linkedFrom = {};
    await step("J5b", "walk every navigation item, the account menu and the pages they link to", async () => {
      await owner.goto(`${DESK}/app/clinic`);
      // open the account menu so its items are in the DOM
      const menuBtn = owner.locator("button[aria-haspopup=menu]").last();
      const menuItems = [];
      if (await menuBtn.count()) {
        await menuBtn.click();
        await owner.waitForTimeout(400);
        for (const it of await owner.locator("[role=menuitem]").all()) {
          const href = await it.getAttribute("href");
          menuItems.push({ text: (await it.innerText()).trim(), href });
        }
        const menuText = await owner.locator("[role=menu]").first().innerText().catch(() => "");
        if (BAD.test(menuText)) finding("R1", "serious", "clinic shell – account menu", `menu names ClinForms: ${menuText.replace(/\s+/g, " ")}`, "no ClinForms");
        await owner.screenshot({ path: path.join(SHOTS, "account-menu.png") });
        await owner.keyboard.press("Escape");
      }
      fs.writeFileSync(path.join(OUT, "account-menu.json"), JSON.stringify(menuItems, null, 2));
      const queue = [];
      const push = (href, from) => {
        if (!href) return;
        let u;
        try {
          u = new URL(href, DESK);
        } catch {
          return;
        }
        if (u.host !== DESK_HOST) return;
        if (!u.pathname.startsWith("/app")) return;
        if (/\/print$|\/export|download|\.csv|\.pdf/.test(u.pathname)) return;
        const key = u.pathname + u.search;
        if (visited.has(key) || queue.includes(key)) return;
        linkedFrom[key] = from;
        queue.push(key);
      };
      const harvest = async (from) => {
        const hrefs = await owner.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
        for (const h of hrefs) push(h, from);
      };
      await harvest("/app/clinic");
      for (const m of menuItems) push(m.href, "account menu");
      const MAX = Number(process.env.MAX_PAGES || 160);
      while (queue.length && visited.size < MAX) {
        const key = queue.shift();
        visited.add(key);
        const res = await owner.goto(`${DESK}${key}`).catch(() => null);
        const status = res ? res.status() : 0;
        const rec = await audit(owner, `nav ${key} (from ${linkedFrom[key]})`, { shot: true });
        rec.status = status;
        if (status >= 400) finding("R3", "minor", `${DESK}${key}`, `linked page answers ${status} (linked from ${linkedFrom[key]})`, "linked pages work");
        await harvest(key);
      }
      return `${visited.size} pages walked, ${queue.length} left in the queue`;
    });

    await step("J5c", "every known route by direct URL (not linked) – what a ClinDesk-only clinic sees", async () => {
      const routes = [
        "/app", "/app/start", "/app/select-clinic", "/app/studio", "/app/studio/new", "/app/studio/forms", "/app/studio/templates", "/app/studio/batch", "/app/studio/security",
        "/app/settings/plan", "/app/settings/billing", "/app/settings/billing/cancelled", "/app/settings/clinic", "/app/settings/members", "/app/settings/security", "/app/settings/api-keys", "/app/settings/activity",
        "/app/clinic/account", "/app/clinic/access", "/app/clinic/access/roles", "/app/clinic/billing", "/app/clinic/billing/claims", "/app/clinic/billing/payers", "/app/clinic/billing/visits",
        "/app/clinic/diary", "/app/clinic/diary/day-sheet", "/app/clinic/diary/rotas", "/app/clinic/diary/waiting-list", "/app/clinic/intake", "/app/clinic/letters", "/app/clinic/letters/new",
        "/app/clinic/messages", "/app/clinic/messages/credits", "/app/clinic/messages/settings", "/app/clinic/messages/patient-view", "/app/clinic/online-booking", "/app/clinic/patients", "/app/clinic/patients/note-templates", "/app/clinic/patients/unsigned-notes",
        "/app/clinic/reports", "/app/clinic/setup", "/app/clinic/setup/audit", "/app/clinic/setup/billing", "/app/clinic/setup/import", "/app/clinic/setup/practitioners", "/app/clinic/setup/prices", "/app/clinic/setup/records",
        "/app/clinic/setup/referrers", "/app/clinic/setup/rooms", "/app/clinic/setup/services", "/app/clinic/setup/sites", "/app/clinic/setup/targets",
      ];
      let n = 0;
      for (const r of routes) {
        if (visited.has(r)) continue;
        const res = await owner.goto(`${DESK}${r}`).catch(() => null);
        n++;
        const rec = await audit(owner, `direct ${r}`, { linked: false });
        rec.status = res ? res.status() : 0;
      }
      return `${n} routes opened directly`;
    });

    /* J5d – activity CSV (V1/V2) and theme colour (V3) */
    await step("J5d", "activity CSV: file name activity-<clinic>-<date>.csv, no 'clinforms' inside; theme-color is ClinDesk's", async () => {
      await owner.goto(`${DESK}/app`);
      await owner.screenshot({ path: path.join(SHOTS, "final-clindesk-overview.png"), fullPage: true });
      await owner.goto(`${DESK}/app/settings/activity`);
      // Fetched from the page (the browser resolves clinic.localhost; Node's request context does not).
      const res = await owner.evaluate(async () => {
        const r = await fetch("/app/settings/activity/export");
        return { status: r.status, disposition: r.headers.get("content-disposition") || "", text: await r.text() };
      });
      assert.equal(res.status, 200, `export answered ${res.status}`);
      const disposition = res.disposition;
      const csv = res.text;
      fs.writeFileSync(path.join(OUT, "activity.csv"), csv);
      const name = (disposition.match(/filename="([^"]+)"/) || [])[1] || "";
      assert.match(name, new RegExp(`^activity-${CLINIC.slug}-\\d{4}-\\d{2}-\\d{2}\\.csv$`), `file name "${name}"`);
      assert.doesNotMatch(name, /clinforms/i);
      assert.doesNotMatch(csv, /clinforms/i, "the CSV names ClinForms (platform user id?)");
      const supportRows = csv.split("\r\n").filter((l) => l.split(",")[3] === "support-team").length;
      assert.ok(supportRows > 0, "the support team's entries carry the neutral id");
      const colours = {};
      for (const p of ["/app", "/app/clinic", "/app/settings/activity"]) {
        await owner.goto(`${DESK}${p}`);
        colours[p] = await owner.locator("meta[name=theme-color]").getAttribute("content");
      }
      const anon = await newPage("anon-theme");
      for (const p of ["/login", "/no-such-page-j5d", "/"]) {
        await anon.goto(`${DESK}${p}`);
        colours[`anon ${p}`] = await anon.locator("meta[name=theme-color]").getAttribute("content");
      }
      await anon.goto(`${FORMS}/login`);
      const formsColour = await anon.locator("meta[name=theme-color]").getAttribute("content");
      await anon.context().close();
      for (const [p, c] of Object.entries(colours)) assert.equal(String(c).toUpperCase(), "#C4432B", `theme-color on ${p}: ${c}`);
      assert.equal(String(formsColour).toUpperCase(), "#0D9488", "ClinForms' host keeps its teal");
      return `file ${name}; ${supportRows} support-team rows; theme colours ${JSON.stringify(colours)}`;
    });

    /* J6 – Manage billing → hosted portal → its return link */
    await step("J6", "Manage billing → hosted portal → return link back to clinic.localhost", async () => {
      await owner.goto(`${DESK}/app/settings/billing`);
      await audit(owner, "Plan and billing (with plan)");
      fs.writeFileSync(path.join(OUT, "plan-billing-after.txt"), await owner.locator("main").innerText());
      await owner.screenshot({ path: path.join(SHOTS, "plan-billing-after.png"), fullPage: true });
      await owner.click("button:has-text('Manage billing')");
      await owner.waitForURL(/billing\.stripe\.com/, { timeout: 60000 });
      await owner.waitForTimeout(3000);
      const pt = await owner.locator("body").innerText();
      fs.writeFileSync(path.join(OUT, "portal.txt"), pt);
      await owner.screenshot({ path: path.join(SHOTS, "portal.png"), fullPage: true });
      if (BAD.test(pt)) finding("R1", "serious", "Stripe billing portal (billing.stripe.com)", `portal names ClinForms: ${(pt.match(/.{0,60}clin\s*forms.{0,60}/i) || [""])[0].replace(/\s+/g, " ")}`, "ClinDesk branding");
      const back = await owner.$$eval("a[href]", (as) => as.map((a) => ({ href: a.href, text: a.innerText.trim() })).filter((a) => !/stripe\.com/.test(a.href) && /^https?:/.test(a.href)));
      const ret = back.find((a) => /localhost/.test(a.href));
      assert(ret, `no return link on the portal: ${JSON.stringify(back).slice(0, 300)}`);
      if (new URL(ret.href).host !== DESK_HOST) finding("R3", "serious", "billing portal return link", `return URL ${ret.href}`, `${DESK}/app/settings/billing`);
      await owner.goto(ret.href);
      await audit(owner, "back from the billing portal");
      return `return link "${ret.text}" → ${ret.href}`;
    });

    /* J7 – sign out, forgotten password, sign in again */
    await step("J7", "sign out → Forgotten your password? → emailed link → new password → sign in (+ code)", async () => {
      await owner.goto(`${DESK}/app/clinic`);
      await owner.locator("button[aria-haspopup=menu]").last().click();
      await owner.locator("[role=menuitem]:has-text('Sign out')").click();
      await owner.waitForURL((u) => !u.pathname.startsWith("/app"), { timeout: 30000 });
      await owner.waitForLoadState("networkidle").catch(() => {});
      await audit(owner, `after sign-out (${new URL(owner.url()).pathname})`);
      const afterOut = owner.url();
      await owner.goto(`${DESK}/login`);
      await audit(owner, "login");
      await owner.click("text=Forgotten your password?");
      await owner.waitForURL((u) => u.pathname === "/reset-password");
      await audit(owner, "reset-password (ask)");
      await owner.fill("#f-email", OWNER);
      await owner.click("button[type=submit]");
      await owner.waitForSelector("text=If an account exists for that address");
      await audit(owner, "reset-password (sent)");
      let mail = null;
      for (let i = 0; i < 30 && !mail; i++) {
        mail = lastMailTo(OWNER, /reset/i);
        if (!mail) await new Promise((r) => setTimeout(r, 500));
      }
      assert(mail, "reset email captured");
      const link = linkIn(mail, /https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9._%-]+/);
      assert(link, "reset link");
      if (new URL(link).host !== DESK_HOST) finding("R3", "serious", "password reset email link", link.replace(/token=\S+/, "token=…"), DESK);
      await owner.goto(link);
      await audit(owner, "reset-password (new password)");
      const np = `e2e ${rnd(12)} password`;
      await owner.fill("#f-password", np);
      await owner.fill("#f-confirm", np);
      await owner.click("button[type=submit]");
      await owner.waitForSelector("text=Your password has been changed");
      await audit(owner, "reset-password (changed)");
      users[OWNER].password = np;
      const signInLink = owner.locator("a[href*='/login']").first();
      if (await signInLink.count()) await signInLink.click();
      else await owner.goto(`${DESK}/login`);
      await owner.waitForURL((u) => u.pathname === "/login");
      await owner.fill("#f-email", OWNER);
      await owner.fill("#f-password", np);
      await owner.click("button[type=submit]");
      await owner.waitForSelector("#f-code");
      await audit(owner, "sign-in code step");
      await owner.fill("#f-code", await freshCode(OWNER));
      await owner.click("button[type=submit]");
      await owner.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
      await audit(owner, `after sign-in (${new URL(owner.url()).pathname})`);
      // sign-in with ?next= from a deep link
      return `signed out to ${afterOut}; signed in to ${owner.url()}`;
    });

    /* J8 – 404 pages */
    await step("J8", "404 pages on clinic.localhost (public and signed in)", async () => {
      for (const p of ["/no-such-page", "/app/no-such-page", "/app/clinic/no-such-page", "/app/clinic/patients/nope-0000", "/app/platform"]) {
        const res = await owner.goto(`${DESK}${p}`);
        const rec = await audit(owner, `404 ${p}`, { linked: true, expectMark: false });
        rec.status = res.status();
      }
      const anon = await newPage("anon");
      watchNav(anon, "anon");
      for (const p of ["/no-such-page", "/app/clinic/no-such-page"]) {
        const res = await anon.goto(`${DESK}${p}`);
        const rec = await audit(anon, `anon 404 ${p}`, { linked: true, expectMark: false });
        rec.status = res.status();
      }
    });

    /* EM – every email the owner received */
    await step("EM", "every email to the owner: sender, subject, body, links", async () => {
      const list = mailsTo(OWNER);
      for (const m of list) {
        const where = `email "${m.Subject}" (${m.at})`;
        const from = m.From || {};
        if (BAD.test(from.Name || "") || /clinforms/i.test(from.Email || "")) finding("R1", "serious", where, `sender ${from.Name} <${from.Email}>`, "ClinDesk <no-reply@clindesk.co.uk>");
        if (BAD.test(m.Subject)) finding("R1", "serious", where, `subject "${m.Subject}"`, "no ClinForms");
        const hits = [...`${m.Text}\n${m.HTML || ""}`.matchAll(/.{0,50}clin\s*forms.{0,50}/gi)].map((x) => x[0].replace(/\s+/g, " "));
        if (hits.length) finding("R1", "serious", where, `body names ClinForms: ${[...new Set(hits)].slice(0, 3).join(" | ")}`, "no ClinForms");
        const links = [...`${m.Text}\n${m.HTML || ""}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]);
        const off = links.filter((l) => { try { const u = new URL(l); return u.host !== DESK_HOST && /localhost|clinforms/i.test(u.host); } catch { return false; } });
        if (off.length) finding("R1", "serious", where, `links off the ClinDesk host: ${[...new Set(off)].map((l) => l.replace(/token=[^&\s]+/, "token=…")).join(", ")}`, DESK);
        for (const r of m.ReplyTo || []) if (/clinforms/i.test(r.Email)) finding("R1", "serious", where, `reply-to ${r.Email}`, "hello@clindesk.co.uk");
      }
      fs.writeFileSync(
        path.join(OUT, "emails.json"),
        JSON.stringify(mails.map((m) => ({ at: m.at, from: m.From, to: m.To, replyTo: m.ReplyTo, subject: m.Subject, text: (m.Text || "").replace(/token=[A-Za-z0-9._%-]+/g, "token=…") })), null, 2),
      );
      return `${list.length} emails to the owner: ${list.map((m) => `"${m.Subject}" from ${m.From && m.From.Name}`).join("; ")}`;
    });

    await step("NAV", "every navigation of the owner's browser stayed on clinic.localhost (or the payment pages)", async () => {
      const off = navLog.filter((n) => {
        const urls = [n.url, n.location].filter(Boolean);
        return urls.some((x) => {
          try {
            const u = new URL(x, DESK);
            return u.host !== DESK_HOST && !/stripe\.com$/.test(u.hostname) && u.protocol.startsWith("http");
          } catch {
            return false;
          }
        });
      });
      for (const n of off) finding("R1", "serious", `navigation (${n.who})`, `${n.kind} ${n.url}${n.location ? ` → ${n.location}` : ""}`, `stay on ${DESK_HOST}`);
      return `${navLog.length} navigations recorded, ${off.length} off-host`;
    });

    await step("X1", "no page errors in the browser", () => {
      if (problems.length) finding("R3", "minor", "browser console", problems.slice(0, 5).join(" | "), "no page errors");
    });
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    // Test-mode clean-up: delete the TEST customer (cancels its subscription too).
    if (customerRef) {
      const d = await api("DELETE", `/customers/${customerRef}`).catch((e) => ({ error: String(e) }));
      results.push({ id: "cleanup", what: "TEST customer deleted", pass: !!(d && d.deleted), note: d && d.deleted ? "deleted" : JSON.stringify(d).slice(0, 200) });
    }
    await browser.close();
    stopChild(listener);
    stopChild(server);
    mailServer.close();
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=[^\s"&]+/g, "token=…").replace(/whsec_[A-Za-z0-9]+/g, "whsec_…").replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  fs.writeFileSync(path.join(OUT, "public-site-deliberate.json"), JSON.stringify(deliberate, null, 2));
  fs.writeFileSync(path.join(OUT, "pages.json"), scrub(JSON.stringify(pageAudits, null, 2)));
  fs.writeFileSync(path.join(OUT, "navigations.json"), scrub(JSON.stringify(navLog, null, 2)));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  fs.writeFileSync(path.join(OUT, "webhook-forwarding.log"), scrub(listenerLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed; ${findings.length} findings`);
  process.exit(0);
})();
