/**
 * CLINIC API v1 (tracker xt03, docs/clinic-system/api.md) – short end to end, LOCAL only. Its own `next start`
 * (PORT, default 3190) on a throwaway SQLite database with the demo clinic (`pms:seed-demo -- --fresh`, fictional data
 * only). The owner creates a key in the settings screen; the API is then called with curl and fetch.
 *
 *   OFF  the server WITHOUT CLINFORMS_CLINIC_API: /api/clinic/v1/* and openapi.json → 404; /app/clinic/setup/api → 404
 *   ON   restarted with CLINFORMS_CLINIC_API=on:
 *     A1  Set-up → API keys: the docs with curl examples; the clinic's API is OFF by default; the owner switches it on
 *     A2  the owner creates a key (appointments read + book, patients read) – shown once, only its SHA-256 stored
 *     A3  curl: GET /appointments 200 (JSON, no-store, no cookie); no key 401; invoices 403 (scope); openapi.json 200
 *     A4  fetch: GET /slots, POST /appointments into a free slot (201), the same Idempotency-Key again (200, same id)
 *     A5  GET /patients/{id} 200 and the patient's History tab shows the read, by the key's name
 *     A6  the key list shows last used and calls; revoke in the screen → the key gets 401
 *     A7  reception (role staff) and an admin: the page is 404; 375 px: no sideways scrolling
 *
 *   npm run build
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/e2e/pms-integration-api.cjs
 */
const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 3190);
const ON_PORT = PORT + 2;
let SERVER_PORT = PORT;
let BASE = `http://localhost:${PORT}`;
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "pms-integration-api");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(REPO, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first");
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cf-api-"));
const DB_FILE = path.join(TMP, "e2e.db");
process.env.SQLITE_PATH = DB_FILE;
const { openScratchDb } = require("./scratch-db.cjs");
const CLINIC = "riverside-demo";

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

const results = [];
const livePages = [];
async function step(id, what, fn) {
  try {
    const note = await fn();
    results.push({ id, what, pass: true, ...(note ? { note } : {}) });
    console.log(`PASS ${id} ${what}${note ? ` – ${note}` : ""}`);
  } catch (err) {
    const msg = String(err && err.stack ? err.stack : err).slice(0, 1500);
    results.push({ id, what, pass: false, error: msg });
    console.log(`FAIL ${id} ${what}: ${msg}`);
    for (const [who, p] of livePages) await p.screenshot({ path: path.join(OUT, `fail-${id}-${who}.png`), fullPage: true }).catch(() => {});
  }
}

function appEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    ...SECRETS,
    NODE_ENV: "production",
    PORT: String(SERVER_PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    CLINFORMS_DB: "sqlite",
    CLINFORMS_SQLITE_PATH: DB_FILE,
    BETTER_AUTH_URL: BASE,
    APP_ORIGIN: BASE,
    CLINFORMS_PUBLIC_DEMO: "1",
    MEDREPORT_AI_MODE: "demo",
    CLINFORMS_EMAIL_PROVIDER: "log",
    CLINIC_SMS_PROVIDER: "outbox",
    CLINIC_EMAIL_PROVIDER: "outbox",
    ...extra,
  };
}
let server = null;
let serverLog = "";
async function startServer(extra) {
  server = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["start", "-p", String(SERVER_PORT)], { cwd: REPO, env: appEnv(extra), stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${BASE}/api/reports/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not come up");
}
function killListeners(port) {
  try {
    for (const pid of execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split(/\s+/).filter(Boolean)) process.kill(Number(pid), "SIGKILL");
  } catch {
    // none
  }
}
async function stopServer() {
  if (!server) return;
  const port = SERVER_PORT;
  const pid = server.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // gone
  }
  const end = Date.now() + 30_000;
  let killed = false;
  while (Date.now() < end) {
    try {
      await fetch(`${BASE}/api/reports/v1/health`);
    } catch {
      break;
    }
    if (!killed && Date.now() > end - 25_000) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // gone
      }
      killListeners(port);
      killed = true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  server = null;
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
  const h = crypto.createHmac("sha1", base32Decode(key)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function freshCode(key) {
  for (;;) {
    if (30000 - (Date.now() % 30000) > 3000) return totp(key);
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 300));
  }
}
async function acceptInvite(page, link, name) {
  const password = `e2e ${rnd(12)} password`;
  await page.goto(link);
  await page.waitForSelector("text=Create your account", { timeout: 30000 });
  await page.fill("#f-name", name);
  await page.fill("#f-password", password);
  await page.fill("#f-confirm", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname.startsWith("/app") && u.pathname !== "/app/start", { timeout: 30000 });
}

/** curl (the docs' own examples): status, headers and body. The key goes in a header file, never on the command line. */
function curl(url, key, extra = []) {
  const headerFile = path.join(TMP, `h-${rnd(6)}`);
  const args = ["-s", "-D", "-", "-o", "-", ...extra];
  if (key) {
    fs.writeFileSync(headerFile, `Authorization: Bearer ${key}\n`, { mode: 0o600 });
    args.push("-H", `@${headerFile}`);
  }
  args.push(url);
  const out = execFileSync("curl", args, { encoding: "utf8" });
  fs.rmSync(headerFile, { force: true });
  const split = out.indexOf("\r\n\r\n");
  const head = out.slice(0, split);
  const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head)[1]);
  const headers = Object.fromEntries(
    head
      .split("\r\n")
      .slice(1)
      .map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  const text = out.slice(split + 4);
  return { status, headers, json: text ? JSON.parse(text) : null };
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const problems = [];
  const one = (q, ...a) => {
    const db = openScratchDb();
    try {
      return db.prepare(q).get(...a);
    } finally {
      db.close();
    }
  };
  const run = (q, ...a) => {
    const db = openScratchDb();
    try {
      return db.prepare(q).run(...a);
    } finally {
      db.close();
    }
  };
  let ctx = null;
  try {
    const seed = execFileSync("npm", ["run", "-s", "pms:seed-demo", "--", "--fresh", "--patients", "40", "--app-url", BASE], { cwd: REPO, env: appEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ownerLink = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
    assert(ownerLink, "owner invitation in the seed output");

    await startServer({});
    ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-GB", timezoneId: "Europe/London" });
    const owner = await ctx.newPage();
    owner.setDefaultTimeout(45000);
    owner.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    livePages.push(["owner", owner]);
    await acceptInvite(owner, ownerLink, "Helen Ward (fictional)");
    const ownerEmail = one('SELECT u.email FROM "user" u JOIN member m ON m.userId = u.id WHERE m.role = ?', "owner").email;

    await step("OFF", "switch off: the API and openapi.json are 404, the settings page is 404 and not in Set-up", async () => {
      for (const p of ["/api/clinic/v1/openapi.json", "/api/clinic/v1/appointments?from=2026-11-16&to=2026-11-16", "/api/clinic/v1/nothing"]) {
        const r = curl(`${BASE}${p}`, "cdk_x");
        assert.equal(r.status, 404, p);
        assert.equal(r.json.error.code, "NOT_FOUND");
      }
      assert.equal((await owner.goto(`${BASE}/app/clinic/setup/api`)).status(), 404);
      await owner.goto(`${BASE}/app/clinic/setup/sites`);
      assert.equal(await owner.locator("a[href='/app/clinic/setup/api']").count(), 0);
    });

    await stopServer();
    SERVER_PORT = ON_PORT;
    BASE = `http://localhost:${ON_PORT}`;
    await startServer({ CLINFORMS_CLINIC_API: "on" });
    // The session cookie is per host, not per port: sign the same browser in on the new port.
    const API = `${BASE}/api/clinic/v1`;
    let key = null;

    await step("A1", "Set-up → API keys: in the Set-up list, docs with curl examples, API off by default, owner switches it on", async () => {
      await owner.goto(`${BASE}/app/clinic/setup/sites`);
      await owner.locator("a[href='/app/clinic/setup/api']").first().waitFor();
      const res = await owner.goto(`${BASE}/app/clinic/setup/api`);
      assert.equal(res.status(), 200);
      await owner.locator("[data-testid=api-docs]").waitFor();
      const docs = await owner.locator("[data-testid=api-docs]").innerText();
      assert.match(docs, /curl -H "Authorization: Bearer \$CLINIC_API_KEY"/);
      assert.match(docs, new RegExp(`${API.replace(/[/.]/g, "\\$&")}/appointments`));
      assert.ok(!/\bAI\b|Claude|Anthropic|Vercel|Cloudflare|Supabase/.test(await owner.locator("main").innerText()), "no vendor names");
      const sw = owner.locator("#api-enabled");
      assert.equal(await sw.getAttribute("aria-checked"), "false");
      await sw.click();
      await owner.waitForFunction(() => document.querySelector("#api-enabled")?.getAttribute("aria-checked") === "true");
      const row = one("SELECT enabled FROM pms_api_settings WHERE tenant_id = ?", CLINIC);
      assert.equal(Number(row.enabled), 1);
      await owner.screenshot({ path: path.join(OUT, "1-settings.png"), fullPage: true });
    });

    await step("A2", "the owner creates a key – shown once, only a fingerprint stored", async () => {
      await owner.fill("[data-testid=api-key-name]", "Website booking (fictional)");
      await owner.check("[data-testid=api-scope-appointments-write]");
      await owner.check("[data-testid=api-scope-patients-read]");
      await owner.click("[data-testid=api-key-create]");
      const box = owner.locator("[data-testid=api-new-key] code");
      await box.waitFor();
      key = (await box.innerText()).trim();
      assert.match(key, new RegExp(`^cdk_${CLINIC}_[a-z0-9]{16}_[A-Za-z0-9_-]{43}$`));
      const stored = one("SELECT key_hash, scopes_json, lookup FROM pms_api_keys WHERE tenant_id = ? AND name = ?", CLINIC, "Website booking (fictional)");
      assert.equal(stored.key_hash, crypto.createHash("sha256").update(key).digest("hex"));
      assert.deepEqual(JSON.parse(stored.scopes_json), ["appointments:read", "appointments:write", "patients:read"]);
      assert.ok(!JSON.stringify(stored).includes(key.slice(-43)));
      await owner.reload();
      assert.equal(await owner.locator("[data-testid=api-new-key]").count(), 0, "not shown again");
      assert.ok((await owner.locator("[data-testid=api-key-list]").innerText()).includes(`cdk_${CLINIC}_${stored.lookup}…`));
      await owner.screenshot({ path: path.join(OUT, "2-key-created.png"), fullPage: true });
    });

    await step("A3", "curl: appointments 200, no key 401, invoices 403 (scope), openapi.json 200", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      const ok = curl(`${API}/appointments?from=${today}&to=${later}&limit=5`, key);
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.ok(Array.isArray(ok.json.data));
      assert.equal(ok.headers["cache-control"], "no-store");
      assert.equal(ok.headers["set-cookie"], undefined);
      assert.ok(!/_enc|notes/.test(JSON.stringify(ok.json)));
      const none = curl(`${API}/appointments?from=${today}&to=${later}`, null);
      assert.equal(none.status, 401);
      assert.equal(none.json.error.code, "UNAUTHENTICATED");
      const scope = curl(`${API}/invoices`, key);
      assert.equal(scope.status, 403);
      assert.equal(scope.json.error.code, "INSUFFICIENT_SCOPE");
      const doc = curl(`${API}/openapi.json`, null);
      assert.equal(doc.status, 200);
      assert.equal(doc.json.openapi, "3.1.0");
      return `${ok.json.data.length} appointments on page 1, nextCursor ${ok.json.nextCursor ? "set" : "null"}`;
    });

    let booked = null;
    let patientId = null;
    await step("A4", "fetch: free slots, book one (201), the same Idempotency-Key again (200, same appointment)", async () => {
      const site = one("SELECT id FROM pms_sites WHERE tenant_id = ? AND active = 1 ORDER BY id LIMIT 1", CLINIC);
      const services = [one("SELECT id FROM pms_services WHERE tenant_id = ? AND online_bookable = 1 AND active = 1 ORDER BY duration_minutes LIMIT 1", CLINIC)];
      const sites = [site.id, ...[one("SELECT id FROM pms_sites WHERE tenant_id = ? AND active = 1 ORDER BY id DESC LIMIT 1", CLINIC).id]];
      const from = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const headers = { authorization: `Bearer ${key}` };
      let slots = [];
      for (const s of sites) {
        const r = await fetch(`${API}/slots?siteId=${s}&serviceId=${services[0].id}&from=${from}&days=14&limit=20`, { headers });
        assert.equal(r.status, 200);
        slots = (await r.json()).data;
        if (slots.length) break;
      }
      assert.ok(slots.length > 0, "the demo clinic has free online-bookable times");
      const patients = await (await fetch(`${API}/patients?limit=10`, { headers })).json();
      for (const p of patients.data) {
        for (const slot of slots.slice(0, 5)) {
          const body = { patientId: p.id, serviceId: slot.serviceId, practitionerId: slot.practitionerId, siteId: slot.siteId, date: slot.date, startTime: slot.startTime, note: "Booked from the website (fictional)" };
          const idem = `e2e-${rnd(8)}`;
          const r = await fetch(`${API}/appointments`, { method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": idem }, body: JSON.stringify(body) });
          if (r.status !== 201) continue;
          booked = (await r.json()).data;
          patientId = p.id;
          const again = await fetch(`${API}/appointments`, { method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": idem }, body: JSON.stringify(body) });
          assert.equal(again.status, 200);
          assert.equal(again.headers.get("idempotent-replayed"), "true");
          assert.equal((await again.json()).data.id, booked.id);
          const n = one("SELECT count(*) AS n FROM pms_appointments WHERE tenant_id = ? AND patient_id = ? AND starts_at = ?", CLINIC, p.id, booked.startsAt);
          assert.equal(Number(n.n), 1, "booked once");
          const missing = await fetch(`${API}/appointments`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
          assert.equal(missing.status, 422);
          return `${booked.date} ${slot.startTime}, source ${booked.source}`;
        }
      }
      throw new Error("no slot could be booked");
    });

    await step("A5", "GET /patients/{id}: 200, and the patient's History shows the read by the key's name", async () => {
      const r = curl(`${API}/patients/${patientId}`, key);
      assert.equal(r.status, 200);
      assert.equal(r.json.data.id, patientId);
      assert.ok(!/_enc|alerts|gp/i.test(JSON.stringify(r.json)));
      await owner.goto(`${BASE}/app/clinic/patients/${patientId}/history`);
      await owner.locator("text=Patient record read through the API").first().waitFor();
      const text = await owner.locator("main").innerText();
      assert.ok(text.includes("API key “Website booking (fictional)”"), "the key is named");
      await owner.screenshot({ path: path.join(OUT, "5-history.png"), fullPage: true });
    });

    await step("A6", "the key list shows use; revoke in the screen → 401", async () => {
      await owner.goto(`${BASE}/app/clinic/setup/api`);
      const usage = await owner.locator("[data-testid=api-key-usage]").first().innerText();
      assert.match(usage, /Last used/);
      assert.match(usage, /[1-9]\d* calls today/);
      await owner.click("[data-testid=api-key-revoke]");
      await owner.getByRole("button", { name: "Revoke key" }).click();
      await owner.locator("text=Revoked").first().waitFor();
      const r = curl(`${API}/appointments?from=2026-11-16&to=2026-11-16`, key);
      assert.equal(r.status, 401);
      const audit = one("SELECT count(*) AS n FROM audit_log WHERE tenant_id = ? AND action IN ('pms.api_key.create', 'pms.api_key.revoke', 'pms.api_settings.update')", CLINIC);
      assert.equal(Number(audit.n), 3);
      await owner.screenshot({ path: path.join(OUT, "6-revoked.png"), fullPage: true });
    });

    await step("A7", "375 px without sideways scroll; an admin and reception get 404", async () => {
      await owner.setViewportSize({ width: 375, height: 800 });
      await owner.goto(`${BASE}/app/clinic/setup/api`);
      await owner.locator("[data-testid=api-docs]").waitFor();
      const wide = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(wide <= 1, `sideways scroll ${wide}px`);
      await owner.screenshot({ path: path.join(OUT, "7-375.png"), fullPage: true });
      await owner.setViewportSize({ width: 1440, height: 1000 });
      for (const role of ["admin", "staff"]) {
        run("UPDATE member SET role = ? WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)", role, ownerEmail);
        try {
          assert.equal((await owner.goto(`${BASE}/app/clinic/setup/api`)).status(), 404, role);
        } finally {
          run("UPDATE member SET role = 'owner' WHERE userId = (SELECT id FROM \"user\" WHERE email = ?)", ownerEmail);
        }
      }
    });

    if (problems.length) console.log(`page problems: ${problems.join(" | ")}`);
  } catch (err) {
    console.log(`FATAL ${String(err && err.stack ? err.stack : err).slice(0, 2000)}`);
    results.push({ id: "FATAL", pass: false });
  } finally {
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopServer();
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUT, "server.log"), serverLog.replace(/token=[A-Za-z0-9._%-]+/g, "token=[hidden]").replace(/cdk_[A-Za-z0-9_-]+/g, "cdk_[hidden]"));
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
