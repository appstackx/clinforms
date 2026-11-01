/**
 * Prepaid text credits in a real browser on the clinic brand's host (clinic.localhost stands for clindesk.co.uk),
 * LOCAL only. This script starts its own `next start` on a throwaway SQLite database, seeds the demonstration clinic
 * (`pms:seed-demo -- --fresh`, fictional data only – it starts with 1,000 demonstration credits) and:
 *
 *   S  the owner joins on clinic.localhost; a receptionist joins
 *   V  Messages shows the balance; Text credits page (balance, packs and prices, history, non-refundable line) –
 *      axe, 375 px; reception sees the balance only (no Buy, no automatic top-up)
 *   B  buy a 500-credit pack with the card payment service's TEST checkout (test card 4242 4242 4242 4242, "save this
 *      card") → back on the "done" page: 500 credits added; the provider's real webhook (forwarded by its CLI) and
 *      a replayed, signed copy of it change nothing; a bad signature is refused; the cancel page
 *   P  platform page: the support adjustment takes the balance down to 3 (reason, ledger check "consistent")
 *   R  five diary bookings with a confirmation text (confirmations by text only): the message run sends texts until
 *      the credits are gone, then by email instead; the outbox says so; the owner's warning email; never negative
 *   A  automatic top-up with the saved card: the next text tops up first (a real off-session TEST charge), credited once
 *
 * Needs: `npm run build`; the TEST key in ~/.config/appstackx/clinforms.secrets.env (STRIPE_CLINDESK_TEST_SECRET_KEY –
 * read here, never printed) and the provider's CLI on PATH (`stripe`, for the webhook forwarding). Without them, or
 * with CHECKOUT=simulated, B runs against a local stand-in of the provider's API and SIMULATES the webhook with a
 * signed test payload instead.
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/pms-sms-credits.cjs [PORT=3192] [E2E_OUT=…]
 *
 * Throwaway secrets, passwords and TOTP keys are generated here and never printed; screenshots and results go to
 * E2E_OUT (default .e2e-out/pms-sms-credits, gitignored); the database (in the OS temp folder) is deleted.
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3192);
const FORMS = `http://localhost:${PORT}`;
const DESK = `http://clinic.localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "pms-sms-credits");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-sms-credits-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE; // scratch-db.cjs
const { openScratchDb } = require("./scratch-db.cjs");
const AXE = require.resolve("axe-core/axe.min.js");
const CLINIC = "riverside-demo";

/** The TEST key, read from the secrets file (never printed). Refuses anything but a test key. */
function testKey() {
  try {
    const line = fs
      .readFileSync(path.join(os.homedir(), ".config/appstackx/clinforms.secrets.env"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("STRIPE_CLINDESK_TEST_SECRET_KEY="));
    const v = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
    return /^sk_test_[A-Za-z0-9]{10,}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
function hasCli() {
  try {
    execFileSync("stripe", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const KEY = process.env.CHECKOUT === "simulated" ? null : testKey();
const REAL = Boolean(KEY && hasCli());

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
let WEBHOOK_SECRET = `whsec_${rnd(24)}`; // replaced by the provider CLI's when REAL
const RUN = crypto.randomBytes(3).toString("hex");
const OWNER = "owner@riverside-demo.example.com"; // scripts/pms/demo-data.ts
const RECEPTION = `zz-credits-reception-${RUN}@example.com`;
const users = {};

const results = [];
const pages = [];
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

/* ------------------------------------------------------------------ a stand-in for the provider (simulated mode) */
let stub = null;
const stubState = { customers: 0, sessions: new Map(), intents: new Map() };
const PRICES = [
  { id: "price_stub_500", lookup_key: "sms_500", unit_amount: 4000, credits: "500" },
  { id: "price_stub_1000", lookup_key: "sms_1000", unit_amount: 7500, credits: "1000" },
  { id: "price_stub_5000", lookup_key: "sms_5000", unit_amount: 32500, credits: "5000" },
];
function startStub() {
  return new Promise((resolve) => {
    stub = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const f = new URLSearchParams(body);
        const send = (o, status = 200) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ livemode: false, ...o }));
        };
        const u = new URL(req.url, "http://stub");
        if (u.pathname === "/v1/prices") return send({ object: "list", data: PRICES.map((p) => ({ id: p.id, lookup_key: p.lookup_key, unit_amount: p.unit_amount, currency: "gbp", type: "one_time", active: true, metadata: { sms_credits: p.credits } })) });
        if (u.pathname === "/v1/customers") return send({ id: `cus_stub_${++stubState.customers}` });
        if (u.pathname === "/v1/checkout/sessions" && req.method === "POST") {
          const id = `cs_test_stub_${rnd(8)}`;
          const price = PRICES.find((p) => p.id === f.get("line_items[0][price]"));
          const s = {
            id,
            object: "checkout.session",
            mode: f.get("mode"),
            status: "open",
            payment_status: "unpaid",
            client_reference_id: f.get("client_reference_id"),
            customer: f.get("customer"),
            amount_total: price ? price.unit_amount : null,
            currency: "gbp",
            metadata: Object.fromEntries([...f.entries()].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v])),
            success_url: f.get("success_url"),
            payment_intent: null,
            url: `https://checkout.stub.test/pay/${id}`,
          };
          stubState.sessions.set(id, s);
          return send(s);
        }
        const m = /^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(u.pathname);
        if (m) {
          const s = stubState.sessions.get(m[1]);
          if (!s) return send({ error: { code: "resource_missing" } }, 404);
          return send({ ...s, payment_intent: s.payment_intent ? stubState.intents.get(s.payment_intent) : null });
        }
        const pm = /^\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/.exec(u.pathname);
        if (pm) return send(stubState.intents.get(pm[1]) || {});
        return send({ error: { code: "not_stubbed" } }, 404);
      });
    });
    stub.listen(0, "127.0.0.1", () => resolve(stub.address().port));
  });
}
/** Simulated "Pay": the session is paid and a signed checkout.session.completed is posted to the app. */
async function stubPay(id) {
  const s = stubState.sessions.get(id);
  const pi = `pi_stub_${rnd(8)}`;
  stubState.intents.set(pi, { id: pi, object: "payment_intent", status: "succeeded", amount: s.amount_total, currency: "gbp", customer: s.customer, payment_method: null, metadata: { tenant_id: s.metadata.tenant_id, kind: "sms_pack", pack: s.metadata.pack } });
  Object.assign(s, { status: "complete", payment_status: "paid", payment_intent: pi });
  return s;
}

/* ------------------------------------------------------------------ server + environment */
let stubPort = 0;
function appEnv() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  Object.assign(env, SECRETS, {
    NODE_ENV: "production",
    PORT: String(PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: FORMS,
    CLINFORMS_AUTH_ORIGINS: DESK,
    APP_ORIGIN: DESK,
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
    CLINFORMS_PLATFORM_ADMINS: OWNER,
    CLINIC_SMS_PROVIDER: "test",
    CLINIC_EMAIL_PROVIDER: "test",
    STRIPE_CLINDESK_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  if (REAL) env.STRIPE_CLINDESK_SECRET_KEY = KEY;
  else Object.assign(env, { STRIPE_CLINDESK_SECRET_KEY: `sk_test_stub${rnd(12).replace(/[^A-Za-z0-9]/g, "a")}`, STRIPE_CLINDESK_API_BASE: `http://127.0.0.1:${stubPort}/v1` });
  return env;
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
let listener = null;
let listenerLog = "";
function startListener() {
  listener = spawn("stripe", ["listen", "--forward-to", `${FORMS}/api/clinic-messages/credit-payments`, "--events", "checkout.session.completed,payment_intent.succeeded"], {
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
    // already gone
  }
}

/* ------------------------------------------------------------------ TOTP + accounts */
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
async function acceptInvite(page, link, email, name) {
  const origin = new URL(link).origin;
  users[email] = { password: `e2e ${rnd(12)} password` };
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", name);
  await page.fill("#f-password", users[email].password);
  await page.fill("#f-confirm", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${origin}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", users[email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  users[email].key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(email));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.origin === origin && u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
  return new URL(page.url()).pathname;
}
async function inviteMember(page, origin, email, role) {
  await page.goto(`${origin}/app/settings/members`);
  const form = page.locator("form", { has: page.locator("button:has-text('Invite')") }).first();
  await form.locator("#f-email").fill(email);
  await form.locator("select[name=role]").selectOption(role);
  await form.locator("button:has-text('Invite')").click();
  const result = page.locator("[data-testid=invite-result]");
  await result.waitFor({ timeout: 30000 });
  const link = ((await result.innerText()).match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  if (link) return link;
  const re = new RegExp(`\\[email:log\\] to=${email.replace(/[.+]/g, "\\$&")}[\\s\\S]*?(https?://\\S+/accept-invite\\?token=\\S+)`, "g");
  const all = Array.from(serverLog.matchAll(re));
  assert(all.length > 0, "no invitation link");
  return all.at(-1)[1];
}

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
  return found.length ? `${found.length} minor` : null;
}

/** A POST to the app with an explicit body and headers (the provider's webhook). */
function postRaw(pathname, body, headers) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = http.request({ host: "127.0.0.1", port: PORT, method: "POST", path: pathname, headers: { ...headers, "content-length": String(data.length) } }, (res) => {
      let out = "";
      res.on("data", (d) => (out += d));
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
const sign = (payload, secret) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex")}`;
};
const waitFor = async (fn, ms = 60000, what = "condition") => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

/* ------------------------------------------------------------------ run */
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const newPage = async (who, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`${who} pageerror: ${String(e).slice(0, 200)}`));
    pages.push([who, page]);
    return page;
  };
  console.log(`mode: ${REAL ? "real TEST checkout + provider CLI webhook forwarding" : "simulated (local provider stand-in + signed test webhooks)"}`);
  try {
    if (REAL) {
      // The CLI's own webhook signing secret for forwarded events (never printed).
      WEBHOOK_SECRET = execFileSync("stripe", ["listen", "--print-secret"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, STRIPE_API_KEY: KEY }, encoding: "utf8", timeout: 30000 }).trim();
      assert(/^whsec_[A-Za-z0-9]+$/.test(WEBHOOK_SECRET), "no webhook secret from the provider CLI");
    } else {
      stubPort = await startStub();
    }
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "40"], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    await startServer();
    if (REAL) startListener();
    const sql = openScratchDb();
    const one = (q, ...a) => sql.prepare(q).get(...a);
    const all = (q, ...a) => sql.prepare(q).all(...a);
    const balance = () => Number((one("SELECT balance FROM pms_sms_credit_accounts WHERE tenant_id = ?", CLINIC) || { balance: 0 }).balance);
    const entries = (kind) => all("SELECT * FROM pms_sms_credit_entries WHERE tenant_id = ? AND kind = ? ORDER BY id", CLINIC, kind);

    const owner = await newPage("owner");
    const reception = await newPage("reception");

    await check("S1", "the owner joins on clinic.localhost; a receptionist joins", async () => {
      assert(ownerLink && new URL(ownerLink).origin === DESK, "owner link on clinic.localhost");
      await acceptInvite(owner, ownerLink, OWNER, "Helen Ward (fictional)");
      const link = await inviteMember(owner, DESK, RECEPTION, "staff");
      await acceptInvite(reception, link, RECEPTION, "Rita Desk (fictional)");
    });

    await check("V1", "Messages shows the text credit balance (the demonstration clinic's 1,000)", async () => {
      await owner.goto(`${DESK}/app/clinic/messages`);
      const link = owner.locator("[data-testid=text-credits-link]");
      await link.waitFor();
      assert.match(await link.innerText(), /Text credits: 1,000/);
      await link.click();
      await owner.waitForURL(`${DESK}/app/clinic/messages/credits`);
    });

    await check("V2", "Text credits page: balance, the three packs and prices, history, non-refundable line; axe clean", async () => {
      await owner.locator("[data-testid=credit-balance]").waitFor();
      assert.equal((await owner.locator("[data-testid=credit-balance]").innerText()).trim(), "1,000");
      const packs = await owner.locator("[data-testid=credit-packs]").innerText();
      for (const s of ["500 credits", "£40.00", "1,000 credits", "£75.00", "5,000 credits", "£325.00"]) assert(packs.includes(s), `packs: ${s}`);
      assert.match(await owner.locator("[data-testid=credits-non-refundable]").innerText(), /not refundable/);
      assert.match(await owner.locator("[data-testid=credit-history]").innerText(), /Adjustment by support[\s\S]*\+1,000/);
      const body = await owner.locator("main").innerText();
      assert(!/stripe/i.test(body), "the provider's name is never on screen");
      await owner.screenshot({ path: path.join(OUT, "1440-text-credits.png"), fullPage: true });
      return axe(owner, "text credits");
    });

    await check("V3", "375 px: the page fits without sideways scrolling", async () => {
      const small = await newPage("owner-375", { width: 375, height: 800 });
      await small.context().addCookies(await owner.context().cookies());
      await small.goto(`${DESK}/app/clinic/messages/credits`);
      await small.locator("[data-testid=credit-balance]").waitFor();
      const wide = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await small.screenshot({ path: path.join(OUT, "375-text-credits.png"), fullPage: true });
      assert(wide <= 1, `scrolls sideways by ${wide}px`);
      await small.close();
    });

    await check("V4", "reception sees the balance only – no Buy, no automatic top-up", async () => {
      await reception.goto(`${DESK}/app/clinic/messages`);
      assert.match(await reception.locator("[data-testid=text-credits-link]").innerText(), /Text credits: 1,000/);
      await reception.goto(`${DESK}/app/clinic/messages/credits`);
      await reception.locator("[data-testid=credit-balance]").waitFor();
      assert.match(await reception.locator("[data-testid=credits-manage-only]").innerText(), /owner and admins/);
      assert.equal(await reception.locator("[data-testid^=buy-]").count(), 0);
      assert.equal(await reception.locator("[data-testid=save-auto-topup]").count(), 0);
      return axe(reception, "text credits (reception)");
    });

    let sessionId = null;
    await check("B1", `buy 500 credits by card payment (${REAL ? "TEST checkout, card 4242" : "simulated checkout"}) – back on the done page with 500 added`, async () => {
      await owner.goto(`${DESK}/app/clinic/messages/credits`);
      await owner.locator("[data-testid=save-card-with-purchase]").check();
      if (!REAL) {
        await owner.route("https://checkout.stub.test/**", async (route) => {
          const id = route.request().url().split("/").pop();
          const s = await stubPay(id);
          await route.fulfill({ status: 302, headers: { location: s.success_url.replace("{CHECKOUT_SESSION_ID}", id) } });
        });
      }
      await owner.click("[data-testid=buy-sms_500]");
      if (REAL) {
        await owner.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
        // Payment methods follow the account's settings: choose "Card" when several are offered.
        await owner.locator("#cardNumber, [data-testid=card-accordion-item-button]").first().waitFor({ state: "attached", timeout: 60000 });
        if (!(await owner.locator("#cardNumber").isVisible().catch(() => false))) await owner.locator("[data-testid=card-accordion-item-button]").dispatchEvent("click");
        await owner.locator("#cardNumber").waitFor({ state: "visible", timeout: 30000 });
        await owner.locator("#cardNumber").fill("4242424242424242");
        await owner.locator("#cardExpiry").fill("12 / 34");
        await owner.locator("#cardCvc").fill("123");
        await owner.locator("#billingName").fill("Helen Ward (fictional)");
        const email = owner.locator("#email");
        if ((await email.count()) && !(await email.inputValue().catch(() => ""))) await email.fill(OWNER);
        const country = owner.locator("#billingCountry");
        if (await country.isVisible().catch(() => false)) await country.selectOption("GB");
        const postcode = owner.locator("#billingPostalCode");
        if (await postcode.isVisible().catch(() => false)) await postcode.fill("MK9 9ZZ");
        await owner.screenshot({ path: path.join(OUT, "checkout-filled.png") });
        await owner.locator("button[data-testid=hosted-payment-submit-button], button.SubmitButton").first().click();
      }
      await owner.waitForURL((u) => u.origin === DESK && u.pathname === "/app/clinic/messages/credits/done", { timeout: 90000 });
      sessionId = new URL(owner.url()).searchParams.get("session_id");
      const notice = await owner.locator("[role=status]").first().innerText();
      assert.match(notice, /Payment received/);
      assert.match(await owner.locator("[data-testid=credits-done-detail]").innerText(), /1,500 credits/);
      await owner.screenshot({ path: path.join(OUT, "1440-credits-done.png"), fullPage: true });
      assert.equal(balance(), 1500);
      assert.equal(entries("purchase").length, 1);
      const p = entries("purchase")[0];
      assert.deepEqual([Number(p.credits), p.pack, Number(p.amount_pence)], [500, "sms_500", 4000]);
      return `session ${sessionId ? sessionId.slice(0, 12) : "?"}…`;
    });

    await check("B2", REAL ? "the provider's own webhooks (forwarded) arrive and change nothing – credited once" : "a signed checkout.session.completed changes nothing – credited once", async () => {
      if (REAL) {
        // Both the checkout and the payment event are delivered (forwarded) and handled: one credits (or finds the
        // success page's credit), the other changes nothing.
        await waitFor(() => /"type":"checkout\.session\.completed"/.test(serverLog) && /"type":"payment_intent\.succeeded"/.test(serverLog), 90000, "both webhook events");
        assert(!/"event":"sms_credits\.webhook","outcome":"(refused|error|bad_signature)/.test(serverLog), "no webhook refused");
      } else {
        const payload = JSON.stringify({ id: `evt_sim_${rnd(8)}`, type: "checkout.session.completed", livemode: false, data: { object: { id: sessionId, object: "checkout.session" } } });
        const r = await postRaw("/api/clinic-messages/credit-payments", payload, { "content-type": "application/json", "stripe-signature": sign(payload, WEBHOOK_SECRET) });
        assert.equal(r.status, 200, r.body);
        assert.match(r.body, /"already"/);
      }
      assert.equal(balance(), 1500);
      assert.equal(entries("purchase").length, 1);
      return REAL ? (serverLog.match(/"outcome":"(credited|already)","type":"[a-z_.]+"/g) || []).join(", ") : null;
    });

    await check("B3", "a replayed event (same id, signed) changes nothing; a bad signature is refused (400)", async () => {
      const id = `evt_replay_${rnd(8)}`;
      const payload = JSON.stringify({ id, type: "checkout.session.completed", livemode: false, data: { object: { id: sessionId, object: "checkout.session" } } });
      for (let i = 0; i < 2; i++) {
        const replay = await postRaw("/api/clinic-messages/credit-payments", payload, { "content-type": "application/json", "stripe-signature": sign(payload, WEBHOOK_SECRET) });
        assert.equal(replay.status, 200, replay.body);
        assert.match(replay.body, /"already"/);
      }
      const bad = await postRaw("/api/clinic-messages/credit-payments", payload, { "content-type": "application/json", "stripe-signature": sign(payload, `whsec_${rnd(20)}`) });
      assert.equal(bad.status, 400);
      const none = await postRaw("/api/clinic-messages/credit-payments", payload, { "content-type": "application/json" });
      assert.equal(none.status, 400);
      assert.equal(balance(), 1500);
    });

    await check("B4", "the card is saved for automatic top-up (brand and last four only); the cancel page", async () => {
      await owner.goto(`${DESK}/app/clinic/messages/credits`);
      if (REAL) {
        await waitFor(async () => {
          await owner.reload();
          return (await owner.locator("[data-testid=saved-card]").count()) > 0;
        }, 30000, "the saved card");
        assert.match(await owner.locator("[data-testid=saved-card]").innerText(), /ending 4242/);
      }
      const acct = one("SELECT card_last4, card_method_ref, customer_ref FROM pms_sms_credit_accounts WHERE tenant_id = ?", CLINIC);
      assert(acct.customer_ref, "the clinic's customer at the provider");
      if (REAL) assert.equal(acct.card_last4, "4242");
      await owner.goto(`${DESK}/app/clinic/messages/credits/cancelled`);
      await owner.locator("[role=status]", { hasText: "Nothing was charged" }).first().waitFor();
      return REAL ? null : "simulated mode saves no card";
    });

    // Anything the seed planned that is due by now goes first (with plenty of credit), so the next steps are exact.
    const runDue = async () => {
      await owner.goto(`${DESK}/app/clinic/messages`);
      await owner.click("[data-testid=run-due-now]");
      await owner.waitForTimeout(1500);
      await waitFor(() => !one("SELECT id FROM pms_message_schedule WHERE tenant_id = ? AND status IN ('pending','processing') AND due_at <= ?", CLINIC, new Date().toISOString()), 30000, "the run");
    };
    await runDue();
    const beforeRun = balance();

    await check("P1", "platform page: the support adjustment takes the balance down to 3 (audited, ledger consistent)", async () => {
      await owner.goto(`${DESK}/app/platform/text-credits?clinic=${CLINIC}`);
      await owner.locator("[data-testid=ledger-check]").waitFor();
      assert.match(await owner.locator("[data-testid=ledger-check]").innerText(), /consistent/);
      await owner.fill("#adjust-credits", String(3 - beforeRun));
      await owner.fill("#adjust-reason", "End-to-end check (fictional)");
      await owner.click("button:has-text('Adjust credits')");
      await owner.locator("[data-testid=adjust-result]").waitFor();
      assert.match(await owner.locator("[data-testid=adjust-result]").innerText(), /now has 3 text credits/);
      assert.equal(balance(), 3);
      assert(one("SELECT id FROM audit_log WHERE tenant_id = ? AND action = 'pms.sms_credit.adjust' ORDER BY id DESC LIMIT 1", CLINIC), "clinic trail");
      assert(one("SELECT id FROM audit_log WHERE tenant_id = 'platform' AND action = 'platform.sms_credit_adjust' LIMIT 1"), "platform trail");
      await owner.reload();
      assert.match(await owner.locator("[data-testid=ledger-check]").innerText(), /consistent/);
      await owner.screenshot({ path: path.join(OUT, "1440-platform-text-credits.png"), fullPage: true });
    });

    // The next Monday (the demonstration rotas repeat weekly) for bookings.
    const MON = (() => {
      const d = new Date();
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() + ((8 - day) % 7 || 7));
      return d.toISOString().slice(0, 10);
    })();
    const patientsWithEmail = all(
      `SELECT id, first_name, last_name FROM pms_patients WHERE tenant_id = ? AND status = 'active' AND email IS NOT NULL AND phone_mobile LIKE '07%' AND reminder_sms = 1 AND reminder_email = 1 ORDER BY patient_number LIMIT 8`,
      CLINIC,
    );
    /** Books an appointment in the diary (booking dialog, "Send confirmation text and email" on) – its confirmation text is planned now. */
    const book = async (p) => {
      await owner.goto(`${DESK}/app/clinic/diary?date=${MON}`);
      await owner.waitForSelector("[data-diary-ready=true]");
      await owner.click("main button:visible:has-text('New appointment')");
      await owner.waitForSelector("role=dialog >> text=New appointment");
      await owner.fill("#bk-search", `${p.first_name} ${p.last_name}`);
      await owner.locator(`[role=option]:has-text("${p.last_name}")`).first().click({ timeout: 20000 });
      await owner.waitForSelector("text=Slot available", { timeout: 20000 });
      await owner.click("role=dialog >> button:has-text('Book appointment')");
      await owner.waitForSelector("text=Appointment booked", { timeout: 30000 });
    };
    const confirmationsSince = (mark) => all("SELECT id, status, skip_reason, message_id, appointment_id FROM pms_message_schedule WHERE tenant_id = ? AND kind = 'confirmation' AND channel = 'sms' AND created_at > ? ORDER BY id", CLINIC, mark);

    await check("R0", "message settings: booking confirmations by text only; quiet hours out of the way (03:00–03:05)", async () => {
      await owner.goto(`${DESK}/app/clinic/messages/settings`);
      await owner.fill("#quiet-start", "03:00");
      await owner.fill("#quiet-end", "03:05");
      const email = owner.getByLabel("Booking confirmation by email (when the booking asks for one)");
      if (await email.isChecked()) await email.uncheck();
      const text = owner.getByLabel("Booking confirmation by text (when the booking asks for one)");
      if (!(await text.isChecked())) await text.check();
      await owner.click("[data-testid=save-settings]");
      await owner.locator("text=Message settings saved.").first().waitFor({ timeout: 20000 });
    });

    await check("R1", "five bookings with a confirmation text and 3 credits: texts until the credits are gone, then by email instead – never negative", async () => {
      assert(patientsWithEmail.length >= 6, "patients with a mobile and an email address");
      const mark = new Date(Date.now() - 1000).toISOString();
      for (const p of patientsWithEmail.slice(0, 5)) await book(p);
      const planned = confirmationsSince(mark);
      assert.equal(planned.length, 5, `five confirmation texts planned (${planned.length})`);
      const sentBefore = entries("debit").length;
      await runDue();
      const after = confirmationsSince(mark);
      const texts = after.filter((r) => r.status === "sent" && !r.skip_reason).length;
      const byEmail = after.filter((r) => r.status === "sent" && r.skip_reason === "no_sms_credit").length;
      assert(texts >= 1 && byEmail >= 1 && texts + byEmail === 5, JSON.stringify(after.map((r) => [r.status, r.skip_reason])));
      const debits = entries("debit").slice(sentBefore);
      const used = debits.reduce((a, e) => a - Number(e.credits), 0);
      assert.equal(balance(), 3 - used);
      assert(balance() >= 0);
      for (const r of after.filter((x) => x.skip_reason === "no_sms_credit")) {
        assert.equal(one("SELECT channel FROM pms_messages WHERE tenant_id = ? AND id = ?", CLINIC, r.message_id).channel, "email");
      }
      const ledger = one("SELECT coalesce(sum(credits), 0) AS s FROM pms_sms_credit_entries WHERE tenant_id = ?", CLINIC);
      assert.equal(Number(ledger.s), balance(), "ledger = balance");
      return `${texts} by text (${used} credits), ${byEmail} by email`;
    });

    await check("R2", "the outbox says 'by email instead'; the credits page shows the texts; the owner's warning email", async () => {
      await owner.goto(`${DESK}/app/clinic/messages?tab=outbox`);
      await owner.locator("text=By email instead of a text – not enough text credit").first().waitFor({ timeout: 20000 });
      await owner.screenshot({ path: path.join(OUT, "1440-outbox-email-instead.png"), fullPage: true });
      await owner.goto(`${DESK}/app/clinic/messages/credits`);
      assert.match(await owner.locator("[data-testid=credit-history]").innerText(), /Text sent/);
      if (balance() === 0) await owner.locator("text=No text credits left.").waitFor();
      await waitFor(() => /\[email:log\] to=owner@riverside-demo\.example\.com[\s\S]{0,400}(Text credits used up|Text credits running low)/.test(serverLog), 20000, "the warning email");
      return /Text credits used up/.test(serverLog) ? "zero warning sent" : "low warning sent";
    });

    await check("A1", REAL ? "automatic top-up: the next text charges the saved card first (TEST, off-session) – credited once" : "automatic top-up needs a saved card (real mode only)", async () => {
      if (!REAL) return "skipped in simulated mode";
      await owner.goto(`${DESK}/app/clinic/messages/credits`);
      await owner.locator("[data-testid=auto-topup-on]").check();
      await owner.fill("[data-testid=auto-topup-threshold]", "100");
      await owner.selectOption("[data-testid=auto-topup-pack]", "sms_500");
      await owner.click("[data-testid=save-auto-topup]");
      await owner.locator("text=Automatic top-up is on").first().waitFor({ timeout: 20000 });
      const start = balance();
      const mark = new Date(Date.now() - 1000).toISOString();
      await book(patientsWithEmail[5]);
      const picked = confirmationsSince(mark);
      assert.equal(picked.length, 1);
      await runDue();
      const tops = entries("auto_topup");
      assert.equal(tops.length, 1, "one automatic top-up");
      assert.equal(Number(tops[0].credits), 500);
      assert(/^pi_/.test(tops[0].payment_ref), "a real TEST payment");
      const row = one("SELECT status, skip_reason FROM pms_message_schedule WHERE tenant_id = ? AND id = ?", CLINIC, picked[0].id);
      assert.deepEqual([row.status, row.skip_reason], ["sent", null], "sent by text after the top-up");
      const last = entries("debit").at(-1);
      assert.equal(balance(), start + 500 + Number(last.credits));
      // The provider's payment_intent.succeeded for the top-up arrives and changes nothing.
      await waitFor(() => (serverLog.match(/"type":"payment_intent\.succeeded"/g) || []).length >= 2, 90000, "the top-up's webhook");
      assert.equal(entries("auto_topup").length, 1);
      return `balance ${balance()}`;
    });

    await check("X1", "no page errors in the browser", () => {
      assert.equal(problems.length, 0, problems.join("\n"));
    });
    sql.close();
  } catch (err) {
    console.log(`FAIL run ${String(err && err.stack ? err.stack : err).slice(0, 1200)}`);
    results.push({ id: "run", pass: false, error: String(err) });
  } finally {
    await browser.close();
    stopChild(listener);
    stopChild(server);
    if (stub) stub.close();
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const scrub = (s) => s.replace(/token=\S+/g, "token=…").replace(/whsec_[A-Za-z0-9]+/g, "whsec_…").replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_…");
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "server.log"), scrub(serverLog));
  if (listenerLog) fs.writeFileSync(path.join(OUT, "webhook-forwarding.log"), scrub(listenerLog));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
