/**
 * Browser check of Set-up, Reports and the "Today" dashboard (LOCAL only – M8; designs round 2c "Set-up" and
 * "Reports", round 3 dashboard per role and 375 px): the owner changes a site's opening hours and adds a closure → the
 * diary's free slots and the online booking page follow (one opening-hours source); adds a site, a room, a service, a
 * price list for an insurer, an insurer billed "patient contribution per visit"; links a member to a practitioner
 * (bookable switch); changes billing settings (prefix, bank details) → a new invoice carries them; report targets;
 * every report renders with its chart and table and downloads as CSV; a clinician sees their own caseload only;
 * reception has no Reports or Set-up; an administrator limited to one site sees nothing of the others (reports, CSV,
 * dashboard); the dashboard per role at 1440 and 375 px; axe on each screen.
 *
 *   PMS_TEST_CLOCK=1 PMS_TEST_NOW=<today 10:30 London, ISO> PMS_TEST_NOW_SET_AT=<epoch ms>   (seed, server and this script)
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3185 > seed.out             (scratch SQLite)
 *   server: next dev -p 3185 (the test clock is ignored by a production build)
 *   SEED_LOG=seed.out BASE=http://localhost:3185 SQLITE_PATH=<scratch db> E2E_OUT=<dir>
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-setup-reports.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed. SQLITE_PATH (a scratch database under /tmp) is read
 * to choose rows and written once: an administrator's site limit ("works at" one site – the access module's own rows).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3185";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-setup-reports");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || "";
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const APP = `${BASE}/app/clinic`;
const SETUP = `${APP}/setup`;
const REPORTS = `${APP}/reports`;
const CLINIC = "riverside-demo";
const REPORT_IDS = ["attendance", "utilisation", "patients", "caseload", "revenue", "debtors", "authorisations"];

// The clinic system's TEST clock (src/modules/pms/core/clock.ts – never in a production build).
const CLOCK_OFFSET = process.env.PMS_TEST_CLOCK === "1" && process.env.PMS_TEST_NOW && process.env.PMS_TEST_NOW_SET_AT ? Date.parse(process.env.PMS_TEST_NOW) - Number(process.env.PMS_TEST_NOW_SET_AT) : 0;
const clockNow = () => Date.now() + CLOCK_OFFSET;

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
async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeReport.push({ label, found });
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
}

function scratchDb() {
  if (!SQLITE || !/^\/(private\/)?(tmp|var\/folders)\//.test(SQLITE)) throw new Error("SQLITE_PATH must be a scratch database under /tmp");
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(SQLITE);
}
function query(sql, ...args) {
  const db = scratchDb();
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}
/** The access module's own rows: the member works at one site only (no screen step needed for the check). */
function limitToSite(email, siteId) {
  const db = scratchDb();
  try {
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
    if (!user) throw new Error("no such member");
    const at = new Date().toISOString();
    db.prepare("INSERT INTO pms_member_access (tenant_id, user_id, active, all_sites, rev, updated_by, created_at, updated_at) VALUES (?, ?, 1, 0, 1, NULL, ?, ?) ON CONFLICT (tenant_id, user_id) DO UPDATE SET all_sites = 0, rev = rev + 1, updated_at = excluded.updated_at").run(CLINIC, user.id, at, at);
    db.prepare("INSERT OR REPLACE INTO pms_member_sites (tenant_id, user_id, site_id, works_at, can_see, updated_at) VALUES (?, ?, ?, 1, 0, ?)").run(CLINIC, user.id, siteId, at);
  } finally {
    db.close();
  }
}

const londonParts = (ms) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minute: Number(g("hour")) * 60 + Number(g("minute")), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday")) + 1 };
};
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const isoWeekday = (date) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const toast = (page, re) => page.waitForSelector(`[role=status] >> text=${re}`, { timeout: 30000 });
/** Waits (up to 15 s) until the scratch database says so – a toast of an earlier save may still be on screen. */
async function eventually(check, what) {
  const until = Date.now() + 15000;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > until) throw new Error(`not saved: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width = 1440, height = 1000) => {
    const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", async (m) => {
      if (m.type() !== "error" || /404|403|Not Found|Failed to fetch RSC payload|favicon|clipboard|Fast Refresh|webpack-hmr/i.test(m.text())) return;
      // React's warnings are "%s" templates: keep the arguments (e.g. the duplicate key) and the page.
      const args = await Promise.all(m.args().slice(1, 3).map((a) => a.jsonValue().catch(() => ""))).catch(() => []);
      problems.push(`console (${page.url().replace(BASE, "")}): ${m.text().slice(0, 120)} ${args.map((a) => String(a).slice(0, 80)).join(" | ")}`);
    });
    return page;
  };
  const owner = await mk();
  const reception = await mk();
  const clinician = await mk();
  const admin = await mk();
  failPages.push(["owner", owner], ["reception", reception], ["clinician", clinician], ["admin", admin]);
  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const now = londonParts(clockNow());
  const s = { sites: [], site: null, other: null, prac: null, cEmail: null, aEmail: null, day1: null, day2: null, service: null };

  try {
    await step("accounts: owner, reception, a clinician and an administrator (two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      await onboard(reception, await invite(owner, `zz-m8-reception-${RUN}@example.com`, "staff"), "Jess Taylor (fictional)");
      s.prac = query("SELECT id, display_name FROM pms_practitioners WHERE tenant_id = ? AND user_id IS NULL AND registration_number IS NOT NULL AND bookable = 1 ORDER BY id LIMIT 1", CLINIC)[0];
      assert(s.prac, "a seeded practitioner without a sign-in");
      s.cEmail = `zz-m8-clinician-${RUN}@example.com`;
      await onboard(clinician, await invite(owner, s.cEmail, "clinician"), s.prac.display_name);
      s.aEmail = `zz-m8-admin-${RUN}@example.com`;
      await onboard(admin, await invite(owner, s.aEmail, "admin"), "Omar Hale (fictional)");
      s.sites = query("SELECT id, name FROM pms_sites WHERE tenant_id = ? AND active = 1 ORDER BY sort_order, name", CLINIC);
      assert(s.sites.length >= 2, "two demo sites");
      s.site = s.sites[0];
      s.other = s.sites[1];
      s.service = query("SELECT id, name, duration_minutes FROM pms_services WHERE tenant_id = ? AND active = 1 AND online_bookable = 1 ORDER BY duration_minutes LIMIT 1", CLINIC)[0];
      assert(s.service, "an online-bookable service");
    });

    await step("navigation: owner has Reports and Set-up (the Set-up section list); reception has neither and gets the 404 page", async () => {
      await owner.goto(APP);
      const main = (await owner.locator("nav[aria-label='Clinic system'] a").allInnerTexts()).map((l) => l.split("\n")[0].trim());
      assert(main.includes("Reports") && main.includes("Set-up"), `owner nav: ${main.join(", ")}`);
      await owner.click("nav[aria-label='Clinic system'] >> text=Set-up");
      await owner.waitForURL(/\/setup\/sites/);
      await owner.waitForSelector("nav[aria-label='Set-up']");
      await reception.goto(APP);
      const r = (await reception.locator("nav[aria-label='Clinic system'] a").allInnerTexts()).map((l) => l.split("\n")[0].trim());
      assert(!r.includes("Reports") && !r.includes("Set-up"), `reception nav: ${r.join(", ")}`);
      for (const url of [SETUP, `${SETUP}/sites`, `${SETUP}/billing`, REPORTS, `${REPORTS}/attendance`, `${REPORTS}/export/attendance`]) {
        const res = await reception.goto(url);
        assert(res.status() === 404 || res.status() === 403, `${url} → ${res.status()} for reception`);
      }
    });

    await step("Sites and hours (design round 2c): the site's week 12:00–14:00 and a closure → the diary's free slots and the booking page follow", async () => {
      // Two coming weekdays (not today): day1 keeps the new hours, day2 is closed.
      let d = addDays(now.date, 1);
      while (isoWeekday(d) > 5) d = addDays(d, 1);
      s.day1 = d;
      d = addDays(d, 1);
      while (isoWeekday(d) > 5) d = addDays(d, 1);
      s.day2 = d;
      await owner.goto(`${SETUP}/sites?site=${s.site.id}`);
      await owner.waitForSelector("[data-testid=opening-hours]");
      await shot(owner, "1440-setup-sites-before");
      for (let wd = 1; wd <= 6; wd++) {
        const closed = owner.locator(`[data-testid=hours-${wd}-closed]`);
        if (await closed.isChecked()) await closed.uncheck();
        await owner.fill(`[data-testid=hours-${wd}-from]`, "12:00");
        await owner.fill(`[data-testid=hours-${wd}-to]`, "14:00");
      }
      await owner.click("[data-testid=site-save] >> text=Save");
      await toast(owner, "Opening hours saved.");
      await owner.click("[data-testid=add-closure]");
      await owner.fill("[data-testid=closure-from]", s.day2);
      await owner.fill("[data-testid=closure-to]", s.day2);
      await owner.fill("[data-testid=closure-reason]", "Staff training (fictional)");
      await owner.click("[data-testid=closure-save]");
      await toast(owner, "/Closure added/");
      await owner.waitForSelector("[data-testid=closures] >> text=Staff training (fictional)");
      await shot(owner, "1440-setup-sites", true);
      await axe(owner, "set-up sites and hours");
      const slots = async (date) => {
        const res = await owner.request.get(`${APP}/diary/api/slots?service=${s.service.id}&site=${s.site.id}&from=${date}&days=1`);
        assert(res.ok(), `slots ${res.status()}`);
        return (await res.json()).data;
      };
      const one = await slots(s.day1);
      assert(one.length > 0, `free slots on ${s.day1}`);
      for (const x of one) assert(x.time >= "12:00" && x.time < "14:00", `slot ${x.date} ${x.time} outside 12:00–14:00`);
      assert((await slots(s.day2)).length === 0, `the closure day ${s.day2} has free slots`);
      // The diary's day view: the working windows of the site's columns sit inside 12:00–14:00.
      const view = (await (await owner.request.get(`${APP}/diary/api/view?date=${s.day1}&site=${s.site.id}`)).json()).data;
      for (const c of view.columns) for (const w of c.windows || []) assert(w.startMinute >= 720 && w.endMinute <= 840, `diary window ${w.startMinute}–${w.endMinute}`);
      // Online booking (portal, 375 px): this site's times are inside the new hours.
      const phone = await mk(375, 812);
      await phone.goto(`${BASE}/clinics/${CLINIC}/book`);
      await phone.waitForSelector("h1:has-text('Where would you like to be seen?')");
      await phone.locator(`main ul li button:has-text("${s.site.name}")`).first().click();
      await phone.waitForSelector("h1:has-text('What do you need?')");
      await phone.getByRole("button", { name: new RegExp(s.service.name) }).first().click();
      await phone.waitForSelector("h1:has-text('Who would you like to see?')");
      await phone.getByRole("button", { name: /Anyone available/ }).click();
      await phone.waitForSelector("[aria-label='Available times'] button", { timeout: 60000 });
      const times = (await phone.locator("[aria-label='Available times'] button").allInnerTexts()).map((t) => (t.match(/\d{2}:\d{2}/) || [""])[0]).filter(Boolean);
      assert(times.length > 0, "online booking offers times");
      for (const t of times) assert(t >= "12:00" && t < "14:00", `online booking time ${t} outside the site's hours`);
      await shot(phone, "375-booking-times-follow-hours");
      // A typed postcode in any GB district gives distances (bundled ONS centres) – the attribution is shown.
      await phone.goto(`${BASE}/clinics/${CLINIC}/book`);
      await phone.fill("#bk-place", "SW1A 1AA");
      await phone.keyboard.press("Enter");
      await phone.waitForSelector("text=/\\d+(\\.\\d)? miles/");
      assert(/Open Government Licence/.test(await phone.locator("[data-testid=ons-attribution]").innerText()), "ONS attribution");
      await phone.context().close();
    });

    await step("Add site (default hours), a room, a service (bookable online), a price list for a new insurer billed per visit", async () => {
      await owner.goto(`${SETUP}/sites`);
      await owner.click("[data-testid=add-site]");
      await owner.fill("[data-testid=new-site-name]", `Westfield ${RUN} (fictional)`);
      await owner.fill("[data-testid=new-site-postcode]", "MK9 9ZZ");
      await owner.click("[data-testid=new-site-save]");
      await owner.waitForSelector(`[data-testid=site-row] >> text=Westfield ${RUN} (fictional)`);
      await owner.click(`[data-testid=site-row] >> text=Westfield ${RUN} (fictional)`);
      await owner.waitForSelector("[data-testid=hours-1-from]");
      assert((await owner.inputValue("[data-testid=hours-1-from]")) === "08:00" && (await owner.inputValue("[data-testid=hours-1-to]")) === "20:00", "default Monday hours");
      assert(await owner.locator("[data-testid=hours-7-closed]").isChecked(), "Sunday closed by default");

      await owner.goto(`${SETUP}/rooms?site=${s.site.id}`);
      await owner.click("[data-testid=add-room]");
      await owner.waitForURL(/=new/);
      await owner.waitForLoadState("networkidle");
      await owner.fill("[data-testid=room-name]", `Room ${RUN}`);
      await owner.click("[data-testid=room-save]");
      await owner.waitForSelector(`[data-testid=room-row] >> text=Room ${RUN}`);
      await shot(owner, "1440-setup-rooms");
      await axe(owner, "set-up rooms");

      await owner.goto(`${SETUP}/services`);
      await owner.click("[data-testid=add-service]");
      await owner.waitForURL(/=new/);
      await owner.waitForLoadState("networkidle");
      await owner.fill("[data-testid=service-name]", `Sports massage ${RUN}`);
      await owner.fill("[data-testid=service-duration]", "30");
      await owner.fill("[data-testid=service-price]", "40.00");
      const online = owner.locator("role=switch[name=/online/i]").first();
      if ((await online.count()) && (await online.getAttribute("aria-checked")) !== "true") await online.click();
      await owner.click("[data-testid=service-save]");
      await owner.waitForSelector(`[data-testid=service-row] >> text=Sports massage ${RUN}`);
      await shot(owner, "1440-setup-services");
      await axe(owner, "set-up services");

      await owner.goto(`${SETUP}/referrers`);
      await owner.click("[data-testid=add-referrer]");
      await owner.waitForURL(/=new/);
      await owner.waitForLoadState("networkidle");
      await owner.selectOption("[data-testid=referrer-kind]", "insurer");
      await owner.fill("[data-testid=referrer-name]", `Northway Health ${RUN} (fictional)`);
      await owner.click("[data-testid=referrer-save]");
      await owner.waitForSelector(`[data-testid=referrer-row] >> text=Northway Health ${RUN} (fictional)`);
      await owner.click(`[data-testid=referrer-row] >> text=Northway Health ${RUN} (fictional)`);
      await owner.check("[data-testid=payer-mode-per_visit]");
      await owner.click("[data-testid=payer-mode-save]");
      await toast(owner, "/patient contribution per visit/i");
      const insurer = query("SELECT id FROM pms_referrers WHERE tenant_id = ? AND name = ?", CLINIC, `Northway Health ${RUN} (fictional)`)[0];
      assert(insurer, "insurer stored");
      await eventually(() => (query("SELECT contribution_mode FROM pms_payer_billing_terms WHERE tenant_id = ? AND referrer_id = ?", CLINIC, insurer.id)[0] || {}).contribution_mode === "per_visit", "billing terms per visit");
      await shot(owner, "1440-setup-referrers", true);
      await axe(owner, "set-up referrers and insurers");

      await owner.goto(`${SETUP}/prices`);
      await owner.click("[data-testid=add-price-list]");
      await owner.waitForURL(/=new/);
      await owner.waitForLoadState("networkidle");
      await owner.fill("[data-testid=price-list-name]", `Northway ${RUN} list`);
      await owner.selectOption("[data-testid=price-list-insurer]", insurer.id);
      await owner.click("[data-testid=price-list-save]");
      await owner.waitForSelector(`[data-testid=price-list-row] >> text=Northway ${RUN} list`);
      await owner.click(`[data-testid=price-list-row] >> text=Northway ${RUN} list`);
      await owner.waitForURL(/list=prl_|list=[a-z]+_/);
      const lists = query("SELECT name, is_default FROM pms_price_lists WHERE tenant_id = ? ORDER BY name", CLINIC);
      assert(lists.filter((l) => l.is_default === 1).length === 1 && !lists.find((l) => l.name === `Northway ${RUN} list`).is_default, `default list unchanged: ${JSON.stringify(lists)}`);
      const item = owner.locator(`[data-testid=price-item][data-service="${s.service.id}"]`);
      await owner.waitForLoadState("networkidle");
      await item.fill("57.50");
      await owner.locator(`[data-testid=price-item][data-service="${s.service.id}"] + [data-testid=price-item-save]`).click();
      await toast(owner, "Price saved.");
      const price = query("SELECT i.price_pence FROM pms_price_list_items i JOIN pms_price_lists l ON l.tenant_id = i.tenant_id AND l.id = i.price_list_id WHERE l.tenant_id = ? AND l.name = ? AND i.service_id = ?", CLINIC, `Northway ${RUN} list`, s.service.id)[0];
      assert(price && price.price_pence === 5750, `price ${JSON.stringify(price)}`);
      await shot(owner, "1440-setup-prices");
      await axe(owner, "set-up price lists");
    });

    await step("Practitioners: link the clinician's sign-in to their practitioner; bookable off takes them out of the diary, on brings them back", async () => {
      await owner.goto(`${SETUP}/practitioners?practitioner=${s.prac.id}`);
      await owner.waitForSelector("[data-testid=practitioner-member]");
      const value = await owner.locator("[data-testid=practitioner-member] option", { hasText: s.prac.display_name }).first().getAttribute("value");
      assert(value, "the clinician is offered as a sign-in to link");
      await owner.selectOption("[data-testid=practitioner-member]", value);
      await owner.click("[data-testid=practitioner-save]");
      await toast(owner, "Practitioner saved.");
      const linked = query('SELECT p.user_id FROM pms_practitioners p JOIN "user" u ON u.id = p.user_id WHERE p.tenant_id = ? AND p.id = ? AND u.email = ?', CLINIC, s.prac.id, s.cEmail);
      assert(linked.length === 1, "linked in the database");
      await shot(owner, "1440-setup-practitioners");
      await axe(owner, "set-up practitioners");
      const inDiary = async () => {
        const view = (await (await owner.request.get(`${APP}/diary/api/view?date=${s.day1}&site=${s.other.id}`)).json()).data;
        const view2 = (await (await owner.request.get(`${APP}/diary/api/view?date=${s.day1}&site=${s.site.id}`)).json()).data;
        return [...view.columns, ...view2.columns].some((c) => c.practitionerId === s.prac.id);
      };
      const before = await inDiary();
      const bookable = () => query("SELECT bookable FROM pms_practitioners WHERE tenant_id = ? AND id = ?", CLINIC, s.prac.id)[0].bookable;
      await owner.click("#pr-bookable");
      await owner.click("[data-testid=practitioner-save]");
      await eventually(() => bookable() === 0, "bookable switched off");
      const hidden = !(await inDiary());
      await owner.reload();
      await owner.waitForSelector("#pr-bookable");
      await owner.click("#pr-bookable");
      await owner.click("[data-testid=practitioner-save]");
      await eventually(() => bookable() === 1, "bookable again");
      assert(!before || hidden, "a practitioner who is not bookable leaves the diary");
      // The clinician is now "their" practitioner: Today shows their own appointments.
      await clinician.goto(APP);
      await clinician.waitForSelector("[data-testid=dashboard][data-role=clinician]");
      await clinician.waitForSelector("[data-testid=kpi-mine]");
    });

    await step("Billing settings (VAT, prefix, terms, bank details) → a new invoice uses the prefix and prints the bank details", async () => {
      await owner.goto(`${SETUP}/billing`);
      await owner.fill("[data-testid=billing-prefix]", "NWX");
      await owner.fill("[data-testid=billing-bank-name]", "Riverside Physiotherapy (fictional)");
      await owner.fill("[data-testid=billing-bank-sort]", "00-00-00");
      await owner.fill("[data-testid=billing-bank-account]", "00001234");
      await owner.click("[data-testid=billing-save] >> text=Save");
      await toast(owner, "/Billing settings saved/");
      await shot(owner, "1440-setup-billing", true);
      await axe(owner, "set-up billing settings");
      // Reception invoices one completed self-pay visit and issues it.
      await reception.goto(`${APP}/billing/visits`);
      await reception.waitForSelector("[data-testid=visits-table]");
      const rows = reception.locator("[data-testid=visits-table] tbody tr");
      const texts = await rows.allInnerTexts();
      const i = texts.findIndex((t) => /Completed/.test(t) && /Self-pay/.test(t));
      assert(i >= 0, "a completed self-pay visit to invoice");
      const appt = await rows.nth(i).getAttribute("data-appointment");
      await reception.uncheck("input[aria-label='Select all visits']");
      await reception.check(`[data-appointment="${appt}"] input[type=checkbox]`);
      await reception.click("button:has-text('Preview drafts')");
      await reception.waitForSelector("[data-testid=draft-preview]");
      await reception.click("button:has-text('Create drafts')");
      await reception.waitForSelector("[data-testid=visits-done]");
      const href = await reception.locator("[data-testid=visits-done] a[href*='/invoices/']").first().getAttribute("href");
      await reception.goto(`${BASE}${href}`);
      await reception.click("[data-testid=issue-invoice]");
      await reception.click("role=alertdialog >> button:has-text('Issue invoice')");
      await toast(reception, "Invoice issued");
      await reception.waitForFunction(() => /Invoice NWX\d{5,6}/.test(document.querySelector("h1").textContent));
      await reception.goto(`${BASE}${href.replace(/\/?$/, "")}/print`);
      const print = await reception.locator("body").innerText();
      assert(/00-00-00/.test(print) && /00001234/.test(print), "bank details on the printed invoice");
      await shot(reception, "1440-invoice-print-bank-details", true);
    });

    await step("Report targets: utilisation 75 %, DNA 5 %", async () => {
      await owner.goto(`${SETUP}/targets`);
      await owner.fill("[data-testid=target-utilisation]", "75");
      await owner.fill("[data-testid=target-dna]", "5");
      await owner.click("[data-testid=targets-save] >> text=Save");
      await toast(owner, "Targets saved.");
      const t = query("SELECT utilisation_target_percent u, dna_target_tenths d FROM pms_reporting_settings WHERE tenant_id = ?", CLINIC)[0];
      assert(t && t.u === 75 && t.d === 50, JSON.stringify(t));
      await axe(owner, "set-up report targets");
      for (const p of ["records", "audit", "import"]) {
        await owner.goto(`${SETUP}/${p}`);
        await owner.waitForSelector("main h1");
        await shot(owner, `1440-setup-${p}`);
        await axe(owner, `set-up ${p}`);
      }
    });

    await step("Reports (design round 2c): each report – stat cards, chart, table – and its CSV (formula-safe); figures equal the diary", async () => {
      await owner.goto(REPORTS);
      await owner.waitForURL(/\/reports\/attendance/);
      const nav = (await owner.locator("nav[aria-label='Reports'] a").allInnerTexts()).map((l) => l.trim());
      assert(JSON.stringify(nav) === JSON.stringify(["Attendance and DNA", "Utilisation", "New and returning patients", "Caseload", "Revenue", "Debtors", "Authorisations"]), `reports nav: ${nav.join(", ")}`);
      for (const id of REPORT_IDS) {
        await owner.goto(`${REPORTS}/${id}?site=all`);
        await owner.waitForSelector(`[data-testid=report-${id}]`);
        assert((await owner.locator("[data-testid^=report-stat-]").count()) >= 3, `${id}: stat cards`);
        assert((await owner.locator("[data-testid^=report-table]").count()) >= 1, `${id}: table`);
        await shot(owner, `1440-report-${id}`, true);
        await axe(owner, `report ${id}`);
        const csvHref = await owner.locator("[data-testid=report-export-csv]").getAttribute("href");
        const res = await owner.request.get(`${BASE}${csvHref}`);
        assert(res.ok(), `${id} CSV ${res.status()}`);
        assert(/text\/csv/.test(res.headers()["content-type"] || ""), `${id} CSV type`);
        const csv = await res.text();
        assert(csv.split("\n").length >= 2, `${id} CSV rows`);
        for (const line of csv.split("\n")) for (const cell of line.split(",")) assert(!/^"?[=+@]/.test(cell.trim()), `${id} CSV formula cell: ${cell}`);
      }
      // Attendance figures for this week equal the diary (scratch database), whole clinic.
      await owner.goto(`${REPORTS}/attendance?site=all&preset=this_week`);
      await owner.waitForSelector("[data-testid=report-stat-dna]");
      const value = async (id) => Number((await owner.locator(`[data-testid=report-stat-${id}] [data-testid=report-stat-value]`).innerText()).replace(/[^\d]/g, ""));
      const range = await owner.locator("[data-testid=report-range]").innerText();
      const [from, to] = (range.match(/\d{2}\/\d{2}\/\d{4}/g) || []).map((d) => d.split("/").reverse().join("-"));
      assert(from && to, `range ${range}`);
      const db = query("SELECT status, count(*) n FROM pms_appointments WHERE tenant_id = ? AND kind = 'appointment' AND starts_on >= ? AND starts_on <= ? GROUP BY status", CLINIC, from, to);
      const n = (st) => db.filter((r) => st.includes(r.status)).reduce((t, r) => t + r.n, 0);
      assert((await value("dna")) === n(["dna"]), `DNA ${await value("dna")} vs ${n(["dna"])}`);
      assert((await value("attended")) === n(["attended", "arrived"]), `attended ${await value("attended")} vs ${n(["attended", "arrived"])}`);
      assert((await value("late")) === n(["late_cancelled"]), `late ${await value("late")} vs ${n(["late_cancelled"])}`);
    });

    await step("Clinician: own caseload only (Attendance, Utilisation, Caseload for their practitioner); Finance reports are the 404 page", async () => {
      await clinician.goto(REPORTS);
      await clinician.waitForURL(/\/reports\/attendance/);
      const nav = (await clinician.locator("nav[aria-label='Reports'] a").allInnerTexts()).map((l) => l.trim());
      assert(JSON.stringify(nav) === JSON.stringify(["Attendance and DNA", "Utilisation", "New and returning patients", "Caseload"]), `clinician reports: ${nav.join(", ")}`);
      await clinician.goto(`${REPORTS}/caseload?site=all`);
      await clinician.waitForSelector("[data-testid=report-caseload]");
      const text = await clinician.locator("[data-testid=report-caseload]").innerText();
      const others = query("SELECT display_name FROM pms_practitioners WHERE tenant_id = ? AND id != ?", CLINIC, s.prac.id).map((r) => r.display_name);
      for (const o of others) assert(!text.includes(o), `another practitioner (${o}) in the clinician's caseload`);
      await shot(clinician, "1440-report-caseload-clinician", true);
      for (const id of ["revenue", "debtors", "authorisations"]) {
        const res = await clinician.goto(`${REPORTS}/${id}`);
        assert(res.status() === 404, `${id} → ${res.status()} for a clinician`);
      }
      const csv = await clinician.request.get(`${REPORTS}/export/attendance`);
      assert(csv.status() === 403 || csv.status() === 404, `clinician CSV ${csv.status()}`);
    });

    await step("An administrator limited to one site sees nothing of the other sites (reports, CSV of every report, dashboard)", async () => {
      limitToSite(s.aEmail, s.other.id);
      const elsewhere = s.sites.filter((x) => x.id !== s.other.id).map((x) => x.name);
      for (const id of REPORT_IDS) {
        await admin.goto(`${REPORTS}/${id}?site=all`);
        await admin.waitForSelector(`[data-testid=report-${id}]`);
        const text = await admin.locator("main").innerText();
        for (const name of elsewhere) assert(!text.includes(name), `${id}: ${name} shown to a member limited to ${s.other.name}`);
        const opts = await admin.locator("[data-testid=report-site-select] option").allInnerTexts().catch(() => []);
        for (const o of opts) for (const name of elsewhere) assert(!o.includes(name), `${id}: site choice ${o}`);
        // Admins cannot export by default (Roles and permissions) – the owner's CSV is checked above.
        const res = await admin.request.get(`${REPORTS}/export/${id}?site=all`);
        if (res.ok()) {
          const csv = await res.text();
          for (const name of elsewhere) assert(!csv.includes(name), `${id} CSV: ${name}`);
        }
      }
      await admin.goto(APP);
      await admin.waitForSelector("[data-testid=dashboard][data-role=manager]");
      const today = await admin.locator("main").innerText();
      for (const name of elsewhere) assert(!new RegExp(`\\b${name.replace(/[()]/g, "\\$&")}\\b`).test(today.split("Failed messages")[0]), `dashboard bars show ${name}`);
      await shot(admin, "1440-dashboard-admin-one-site", true);
    });

    await step("Today per role at 1440 px: owner (figures, by site vs target, failed messages → Retry), clinician, reception (no Reports/Set-up tiles)", async () => {
      await owner.goto(APP);
      await owner.waitForSelector("[data-testid=dashboard][data-role=manager]");
      for (const k of ["appointments", "utilisation", "taken", "overdue"]) await owner.waitForSelector(`[data-testid=kpi-${k}]`);
      for (const c of ["by-site", "failed", "authorisations", "overdue"]) await owner.waitForSelector(`[data-testid=card-${c}]`);
      await shot(owner, "1440-dashboard-owner", true);
      await axe(owner, "dashboard owner");
      const retry = owner.locator("[data-testid=card-failed] [data-testid=dash-action-retry]").first();
      if (await retry.count()) {
        await retry.click();
        await toast(owner, "Sent again.");
      }
      await clinician.goto(APP);
      await clinician.waitForSelector("[data-testid=dashboard][data-role=clinician]");
      for (const c of ["next", "unsigned"]) await clinician.waitForSelector(`[data-testid=card-${c}]`);
      await shot(clinician, "1440-dashboard-clinician", true);
      await axe(clinician, "dashboard clinician");
      await reception.goto(APP);
      await reception.waitForSelector("[data-testid=dashboard][data-role=reception]");
      for (const c of ["arrivals", "waiting", "to-invoice", "replies"]) await reception.waitForSelector(`[data-testid=card-${c}]`);
      assert((await reception.locator("[data-testid=kpi-utilisation], [data-testid=card-by-site]").count()) === 0, "no utilisation for reception");
      const arrived = reception.locator("[data-testid=dash-action-arrived]").first();
      if (await arrived.count()) {
        await arrived.click();
        await toast(reception, "/has arrived/");
      }
      await shot(reception, "1440-dashboard-reception", true);
      await axe(reception, "dashboard reception");
    });

    await step("375 px: Today for each role (cards stacked, bottom tabs) and a report and a set-up page – no sideways scrolling", async () => {
      for (const [page, who] of [
        [owner, "owner"],
        [clinician, "clinician"],
        [reception, "reception"],
      ]) {
        const phone = await mk(375, 812);
        await phone.context().addCookies(await page.context().cookies());
        const urls = [[APP, `375-dashboard-${who}`]];
        if (who === "owner") urls.push([`${REPORTS}/attendance`, "375-report-attendance"], [`${SETUP}/sites?site=${s.site.id}`, "375-setup-sites"]);
        for (const [url, name] of urls) {
          await phone.goto(url);
          await phone.waitForLoadState("networkidle");
          const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
          assert(wide <= 376, `${name}: page is ${wide} px wide`);
          await shot(phone, name, true);
          await axe(phone, name);
        }
        await phone.context().close();
      }
    });

    await step("no product errors in the browser; no banned names on screen", async () => {
      for (const page of [owner, reception, clinician, admin]) assert(!/\bTM3\b|CareConnect|\bAI\b/.test(await page.locator("body").innerText()), "banned names");
      assert(problems.length === 0, problems.slice(0, 10).join(" | "));
    });
  } finally {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    if (problems.length) console.log(`Browser problems:\n${problems.slice(0, 20).join("\n")}`);
    fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));
    await browser.close();
    process.exitCode = passed === results.length ? 0 : 1;
  }
})();
