/**
 * Browser check of the M9b report polish (LOCAL only): the seventh report "New and returning patients" renders with
 * the seeded history (stat cards, a new-patients-by-week chart with the earlier weeks filled, weeks / practitioners /
 * sites tables) and downloads as CSV (formula-safe, no patient names); the six-week figures of the other reports show
 * the earlier weeks (attendance per week, revenue per month, utilisation with leave taken off); utilisation never
 * shows more than 100 % – the report, its by-site table and the dashboard tile – also after a site's opening hours
 * are cut so today's bookings sit outside them (the M8 "Bletchley 275 %" case); Set-up → Audit trail finds a
 * patient's entries by name (and says so when nobody matches); reception has no reports; axe on each screen.
 *
 *   PMS_TEST_CLOCK=1 PMS_TEST_NOW=<today 10:30 London, ISO> PMS_TEST_NOW_SET_AT=<epoch ms>   (seed, server and this script)
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3176 > seed.out             (scratch SQLite)
 *   server: next dev -p 3176
 *   SEED_LOG=seed.out BASE=http://localhost:3176 SQLITE_PATH=<scratch db> E2E_OUT=<dir>
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-polish-reports.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed. SQLITE_PATH (a scratch database under /tmp) is read
 * to choose rows and written once (one site's opening hours for today's weekday).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3176";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-polish-reports");
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
/** Writes to the scratch database (one site's opening hours – the M8 "hours changed after booking" case). */
function run(sql, ...args) {
  const db = scratchDb();
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}

const londonParts = (ms) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minute: Number(g("hour")) * 60 + Number(g("minute")), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday")) + 1 };
};
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
    page.on("console", (m) => {
      if (m.type() !== "error" || /404|403|Not Found|Failed to fetch RSC payload|favicon|clipboard|Fast Refresh|webpack-hmr/i.test(m.text())) return;
      problems.push(`console (${page.url().replace(BASE, "")}): ${m.text().slice(0, 160)}`);
    });
    return page;
  };
  const owner = await mk();
  const reception = await mk();
  failPages.push(["owner", owner], ["reception", reception]);
  const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const now = londonParts(clockNow());
  const statValue = async (page, id) => Number((await page.locator(`[data-testid=report-stat-${id}] [data-testid=report-stat-value]`).innerText()).replace(/[^\d.]/g, ""));
  /** A report table's rows as cells ("" = the first table, else its id). */
  const tableRows = async (page, id = "") => (await page.locator(`[data-testid=${id ? `report-table-${id}` : "report-table"}] tbody tr`).allInnerTexts()).map((r) => r.split("\t").map((c) => c.trim()));
  const percents = (rows, col) => rows.map((r) => Number(String(r[col]).replace("%", ""))).filter((v) => Number.isFinite(v));

  try {
    await step("accounts: owner and reception (two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      await onboard(reception, await invite(owner, `zz-rep-reception-${RUN}@example.com`, "staff"), "Jess Taylor (fictional)");
    });

    await step("New and returning patients (seventh report): in the Reports navigation, figures, chart with the earlier weeks, tables, axe", async () => {
      await owner.goto(`${REPORTS}/attendance?site=all`);
      await owner.waitForSelector("[data-testid=report-attendance]");
      const nav = (await owner.locator("nav[aria-label='Reports'] a").allInnerTexts()).map((l) => l.trim());
      assert(nav.length === 7 && nav[2] === "New and returning", `reports nav: ${nav.join(", ")}`);
      // M10: the shorter navigation label fits the rail; the full name is on hover.
      const navLink = owner.locator("nav[aria-label='Reports'] a").nth(2);
      assert((await navLink.getAttribute("title")) === "New and returning patients", "the full report name on hover");
      assert(await navLink.locator("span.truncate").evaluate((el) => el.scrollWidth <= el.clientWidth), "the label is not cut off");
      await owner.goto(`${REPORTS}/patients?site=all`);
      await owner.waitForSelector("[data-testid=report-patients]");
      const [seen, fresh, returning] = [await statValue(owner, "seen"), await statValue(owner, "new"), await statValue(owner, "returning")];
      assert(seen > 50 && fresh >= 10 && returning > 30 && fresh + returning === seen, `seen ${seen}, new ${fresh}, returning ${returning}`);
      const chart = await owner.locator("[data-testid=report-chart] svg").getAttribute("aria-label");
      const values = (chart.split(":")[1] || "").split(",").map((x) => Number(x.trim().split(" ").pop()));
      assert(values.length === 6 && values.slice(0, 5).every((v) => v >= 1), `new patients by week: ${chart}`);
      const weeks = await tableRows(owner);
      assert(weeks.length === 6 && weeks.slice(0, 5).every((r) => Number(r[1].replace(/,/g, "")) > 50), `weeks: ${JSON.stringify(weeks)}`);
      assert((await tableRows(owner, "practitioners")).length >= 3, "by practitioner");
      assert((await tableRows(owner, "sites")).length >= 2, "by site");
      await shot(owner, "1440-report-patients");
      await axe(owner, "report patients");
    });

    await step("New and returning patients: CSV (the screen's figures, formula-safe, no patient names); reception has no reports", async () => {
      const href = await owner.locator("[data-testid=report-export-csv]").getAttribute("href");
      const res = await owner.request.get(`${BASE}${href}`);
      assert(res.ok() && /text\/csv/.test(res.headers()["content-type"] || ""), `CSV ${res.status()}`);
      const csv = (await res.text()).replace(/^﻿/, "");
      const lines = csv.trim().split("\n").map((l) => l.trim());
      assert(lines[0] === "group,name,patients_seen,attended,new_patients,returning_visits,new_share_percent", lines[0]);
      const total = lines.find((l) => l.startsWith("total,"));
      assert(total && Number(total.split(",")[2]) === (await statValue(owner, "seen")) && Number(total.split(",")[4]) === (await statValue(owner, "new")), `total ${total}`);
      assert(lines.filter((l) => l.startsWith("week,")).length === 6, "six week rows");
      for (const line of lines) for (const cell of line.split(",")) assert(!/^"?[=+@]/.test(cell.trim()), `formula cell ${cell}`);
      const megan = query("SELECT first_name, last_name FROM pms_patients WHERE tenant_id = ? AND import_ref = 'sim-pat-001'", CLINIC)[0];
      assert(!csv.includes(megan.last_name), "no patient names in the CSV");
      const r = await reception.goto(`${REPORTS}/patients`);
      assert(r.status() === 404, `reception: ${r.status()}`);
    });

    await step("Six-week charts show the earlier weeks: attendance per week, revenue per month, utilisation per practitioner", async () => {
      await owner.goto(`${REPORTS}/attendance?site=all`);
      await owner.waitForSelector("[data-testid=report-attendance]");
      const weeks = await tableRows(owner);
      assert(weeks.length === 6 && weeks.every((r) => Number(r[1].replace(/,/g, "")) > 50), `attendance weeks: ${JSON.stringify(weeks.map((r) => r.slice(0, 3)))}`);
      await shot(owner, "1440-report-attendance-six-weeks");
      await owner.goto(`${REPORTS}/revenue?site=all`);
      await owner.waitForSelector("[data-testid=report-revenue]");
      const months = await tableRows(owner);
      const filled = months.filter((r) => Number((r[4] || "").replace(/[£,]/g, "")) > 0);
      assert(filled.length >= 2, `revenue months: ${JSON.stringify(months)}`);
      await shot(owner, "1440-report-revenue-six-weeks");
      await owner.goto(`${REPORTS}/utilisation?site=all`);
      await owner.waitForSelector("[data-testid=report-utilisation]");
      const pr = await tableRows(owner);
      const util = percents(pr, 3);
      assert(util.length >= 3 && util.every((v) => v > 0 && v <= 100), `utilisation: ${JSON.stringify(pr)}`);
      assert(/leave and blocked time taken off/.test(await owner.locator("[data-testid=report-stat-rota-hours]").innerText()), "leave is taken off the available hours");
      await shot(owner, "1440-report-utilisation-six-weeks");
    });

    await step("Utilisation never over 100 %: cut a site's hours today so its bookings sit outside them – report, by-site table, dashboard tile", async () => {
      const site = query("SELECT s.id, s.name FROM pms_sites s WHERE s.tenant_id = ? AND s.active = 1 AND EXISTS (SELECT 1 FROM pms_appointments a WHERE a.tenant_id = s.tenant_id AND a.site_id = s.id AND a.starts_on = ? AND a.kind = 'appointment' AND a.status <> 'cancelled') ORDER BY s.name LIMIT 1", CLINIC, now.date)[0];
      assert(site, "a site with appointments today");
      const booked = query("SELECT count(*) n FROM pms_appointments WHERE tenant_id = ? AND site_id = ? AND starts_on = ? AND kind = 'appointment' AND status <> 'cancelled' AND starts_at >= ?", CLINIC, site.id, now.date, `${now.date}T10:00`)[0].n;
      assert(booked > 3, `bookings after 10:00 today at ${site.name}: ${booked}`);
      // As if someone changed the hours after the diary was booked: open 08:00–10:00 only today.
      run("DELETE FROM pms_site_hours WHERE tenant_id = ? AND site_id = ? AND weekday = ?", CLINIC, site.id, now.weekday);
      run("INSERT INTO pms_site_hours (tenant_id, id, site_id, weekday, opens_at, closes_at, created_by, created_at) VALUES (?, ?, ?, ?, '08:00', '10:00', NULL, ?)", CLINIC, `hrs_e2e_${RUN}`, site.id, now.weekday, new Date().toISOString());
      await owner.goto(`${REPORTS}/utilisation?site=all&period=this_week`);
      await owner.waitForSelector("[data-testid=report-utilisation]");
      const pr = await tableRows(owner);
      const st = await tableRows(owner, "sites");
      for (const v of [...percents(pr, 3), ...percents(st, 3), await statValue(owner, "utilisation")]) assert(v <= 100, `over 100 %: ${JSON.stringify({ pr, st })}`);
      const row = st.find((r) => r[0] === site.name);
      assert(row && Number(row[3].replace("%", "")) > 0, `${site.name} by site: ${JSON.stringify(st)}`);
      await shot(owner, "1440-report-utilisation-hours-cut");
      await owner.goto(APP);
      await owner.waitForSelector("[data-testid=card-by-site]");
      const tile = Number((await owner.locator("[data-testid=kpi-utilisation]").innerText()).replace(/[^\d]/g, ""));
      const bars = await owner.locator("[data-testid=card-by-site] li").allInnerTexts();
      const barValues = bars.map((b) => Number((b.match(/(\d+)%\s*$/) || [])[1]));
      assert(tile <= 100 && barValues.length >= 1 && barValues.every((v) => v <= 100), `dashboard: tile ${tile}, bars ${JSON.stringify(bars)}`);
      assert(bars.some((b) => b.includes(site.name)), `${site.name} on the dashboard: ${JSON.stringify(bars)}`);
      await shot(owner, "1440-dashboard-hours-cut");
    });

    await step("Audit trail by patient name: the patient's entries (no names in the rows), CSV; nobody matching says so; axe", async () => {
      const megan = query("SELECT id, first_name, last_name FROM pms_patients WHERE tenant_id = ? AND import_ref = 'sim-pat-001'", CLINIC)[0];
      await owner.goto(`${SETUP}/audit`);
      await owner.fill("[data-testid=audit-patient]", `${megan.first_name} ${megan.last_name}`);
      await owner.click("[data-testid=audit-search]");
      await owner.waitForURL(/patient=/);
      const matches = await owner.locator("[data-testid=audit-patient-matches]").innerText();
      assert(matches.includes(`${megan.first_name} ${megan.last_name}`), `matches: ${matches}`);
      const rows = await owner.locator("[data-testid=audit-rows] tbody tr").allInnerTexts();
      assert(rows.length >= 3 && !/Nothing matches/.test(rows[0]), `audit rows: ${rows.length}`);
      assert(rows.some((r) => r.includes(megan.id)), "the patient's own record entry");
      const stored = query("SELECT count(*) n FROM audit_log WHERE tenant_id = ? AND detail_json LIKE ?", CLINIC, `%${megan.last_name}%`)[0].n;
      assert(stored === 0, `names in the audit trail: ${stored}`);
      await shot(owner, "1440-audit-by-patient");
      await axe(owner, "audit by patient");
      const csvHref = await owner.locator("[data-testid=audit-export]").getAttribute("href");
      assert(/patient=/.test(csvHref), `CSV link keeps the patient: ${csvHref}`);
      const res = await owner.request.get(`${BASE}${csvHref}`);
      assert(res.ok(), `audit CSV ${res.status()}`);
      const csv = await res.text();
      assert(csv.includes(megan.id) && csv.trim().split("\n").length - 1 >= rows.length, "CSV holds the patient's entries");
      await owner.goto(`${SETUP}/audit?patient=${encodeURIComponent("Zzqx Nobody")}`);
      assert(/No patient matches/.test(await owner.locator("[data-testid=audit-patient-matches]").innerText()), "nobody matches");
      assert(/Nothing matches/.test(await owner.locator("[data-testid=audit-rows] tbody").innerText()), "no rows");
    });

    await step("375 px: the new report without sideways scrolling", async () => {
      const phone = await mk(375, 812);
      await phone.context().addCookies(await owner.context().cookies());
      await phone.goto(`${REPORTS}/patients?site=all`);
      await phone.waitForSelector("[data-testid=report-patients]");
      const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
      assert(wide <= 376, `page is ${wide} px wide`);
      await shot(phone, "375-report-patients");
      await axe(phone, "375 report patients");
      await phone.context().close();
    });

    await step("no product errors in the browser; no banned names on screen", async () => {
      for (const page of [owner, reception]) assert(!/\bTM3\b|CareConnect|\bAI\b/.test(await page.locator("body").innerText()), "banned names");
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
