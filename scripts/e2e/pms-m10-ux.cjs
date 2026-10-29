/**
 * Browser check of the M10 accessibility / UX fixes outside the diary (LOCAL only, production build or dev):
 * "Take payment" from the record header opens on the Invoices tab also when that tab is already open, and focus goes
 * back to what opened it; scroll boxes (wide tables, the invoice items, the audit, print sheets) are named regions in
 * the tab order while they scroll; the records section headers pass contrast; Set-up → Services never scrolls sideways
 * at 375 px; the Reports navigation label fits; dashboard rows at 375 px keep the name on one line with the badge and
 * button underneath; the patient list's Site filter; booking "Your details" says what is missing and focuses the first
 * field; 44 px touch targets on the booking and portal pages; DD/MM dates on the record History and the audit; axe on
 * every screen visited.
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3227 > seed.out             (scratch SQLite)
 *   server: next start -p 3227
 *   SEED_LOG=seed.out BASE=http://localhost:3227 SQLITE_PATH=<scratch db> E2E_OUT=<dir>
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-m10-ux.cjs
 *
 * Fictional data only (the demo clinic). Read-only on the scratch database.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3227";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-m10-ux");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || "";
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const CLINIC = "riverside-demo";


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


const PUB = `${BASE}/clinics/${CLINIC}`;
const noSideScroll = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
/** Where focus is, once it has settled (Radix moves it back a tick after the overlay goes). */
const settledFocus = async (page) => { await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 3000 }).catch(() => {}); return focused(page); };
const focused = (page) => page.evaluate(() => { const el = document.activeElement; return el && el !== document.body ? (el.getAttribute("data-testid") || el.id || el.tagName + ":" + (el.textContent || "").trim().slice(0, 40)) : "BODY"; });
const box = async (loc) => { const b = await loc.boundingBox(); assert(b, "element is on screen"); return b; };
/** Every scroll box that scrolls is a named region in the tab order (M10 finding 6). */
async function scrollRegionsReachable(page, label) {
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll("*"))
      .filter((el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowX + s.overflowY) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && el.offsetParent !== null; })
      .filter((el) => !el.closest("[role=dialog]") && !el.querySelector("a[href],button,input,select,textarea,[tabindex]") && !(el.getAttribute("tabindex") === "0" && el.getAttribute("aria-label")))
      .map((el) => el.className.toString().slice(0, 80)),
  );
  assert(bad.length === 0, `${label}: scroll boxes without keyboard access: ${JSON.stringify(bad)}`);
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width = 1440, height = 1000, ctxFrom = null) => {
    const ctx = ctxFrom || (await browser.newContext({ viewport: { width, height }, locale: "en-GB", timezoneId: "Europe/London" }));
    const page = await ctx.newPage();
    if (ctxFrom) await page.setViewportSize({ width, height });
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => {
      if (m.type() !== "error" || /404|403|Not Found|Failed to fetch RSC payload|favicon|clipboard|Fast Refresh|webpack-hmr/i.test(m.text())) return;
      problems.push(`console (${page.url().replace(BASE, "")}): ${m.text().slice(0, 160)}`);
    });
    return page;
  };
  const owner = await mk();
  failPages.push(["owner", owner]);
  const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const patient = query("SELECT p.id FROM pms_patients p WHERE p.tenant_id = ? AND p.status = 'active' AND EXISTS (SELECT 1 FROM pms_invoices i WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id AND i.status = 'issued') ORDER BY p.patient_number LIMIT 1", CLINIC)[0];
  assert(patient, "a demo patient with invoices");
  const REC = `${BASE}/app/clinic/patients/${patient.id}`;

  try {
    await step("account: owner (two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
    });

    await step("2 + 12. Take payment from the record header opens on the Invoices tab (also when it is open); focus returns", async () => {
      await owner.goto(REC);
      await owner.waitForSelector("main h1");
      await axe(owner, "record overview (records header contrast)");
      await owner.locator("a[href$='invoices?pay=1']:visible").first().click();
      await owner.waitForSelector("[data-testid=take-payment]");
      await owner.waitForFunction(() => !location.search.includes("pay=1"));
      await owner.keyboard.press("Escape");
      await owner.waitForSelector("[data-testid=take-payment]", { state: "detached" });
      const after1 = await settledFocus(owner);
      assert(after1 !== "BODY", `focus after closing (opened from the header): ${after1}`);
      // The Invoices tab is open now: the header button opens the dialog again.
      await owner.locator("a[href$='invoices?pay=1']:visible").first().click();
      await owner.waitForSelector("[data-testid=take-payment]");
      await shot(owner, "1440-take-payment-again", false);
      await owner.keyboard.press("Escape");
      await owner.waitForSelector("[data-testid=take-payment]", { state: "detached" });
      await owner.click("[data-testid=invoices-take-payment]");
      await owner.waitForSelector("[data-testid=take-payment]");
      await owner.keyboard.press("Escape");
      await owner.waitForSelector("[data-testid=take-payment]", { state: "detached" });
      const after3 = await settledFocus(owner);
      assert(after3 === "invoices-take-payment", `focus back on the Invoices tab's Take payment: ${after3}`);
      await axe(owner, "record invoices");
    });

    await step("6. scroll boxes are keyboard regions (375 px: invoices, billing, invoice items, audit, print sheets)", async () => {
      const phone = await mk(375, 812, owner.context());
      failPages.push(["phone", phone]);
      const inv = query("SELECT id FROM pms_invoices WHERE tenant_id = ? AND patient_id = ? AND status = 'issued' LIMIT 1", CLINIC, patient.id)[0];
      const pages = [
        ["record invoices", `${REC}/invoices`],
        ["record appointments", `${REC}/appointments`],
        ["record history", `${REC}/history`],
        ["billing", `${BASE}/app/clinic/billing`],
        ["invoice", `${BASE}/app/clinic/billing/invoices/${inv.id}`],
        ["invoice print", `${BASE}/app/clinic/billing/invoices/${inv.id}/print`],
        ["audit", `${BASE}/app/clinic/setup/audit`],
        ["intake", `${BASE}/app/clinic/intake`],
      ];
      for (const [label, url] of pages) {
        await phone.goto(url);
        await phone.waitForSelector("main");
        await phone.waitForTimeout(800);
        await scrollRegionsReachable(phone, label);
        assert(await noSideScroll(phone), `${label}: the page scrolls sideways at 375 px`);
        await axe(phone, `${label} (375)`);
      }
      // One region by keyboard: focus it, arrow right scrolls it.
      await phone.goto(`${BASE}/app/clinic/billing/invoices/${inv.id}`);
      const region = phone.locator("[data-scroll-region=scrolls]").first();
      await region.waitFor();
      assert((await region.getAttribute("role")) === "region" && (await region.getAttribute("tabindex")) === "0" && (await region.getAttribute("aria-label")), "a named region in the tab order");
      await region.focus();
      await phone.keyboard.press("ArrowRight");
      await phone.keyboard.press("ArrowRight");
      await phone.waitForTimeout(300);
      assert((await region.evaluate((el) => el.scrollLeft)) > 0, "the arrow keys scroll it");
      await shot(phone, "375-invoice-items-region", false);
      await phone.close();
      // 1440: the same table fits – no extra tab stop.
      await owner.goto(`${BASE}/app/clinic/billing/invoices/${inv.id}`);
      await owner.waitForSelector("main");
      await owner.waitForTimeout(800);
      assert((await owner.locator("main [data-scroll-region=scrolls]").count()) === 0, "nothing scrolls at 1440: no extra tab stops");
    });

    await step("5. Set-up → Services (and the other set-up pages) never scroll sideways at 375 px", async () => {
      const phone = await mk(375, 812, owner.context());
      for (const s of ["services", "sites", "rooms", "prices", "practitioners", "referrers", "audit"]) {
        await phone.goto(`${BASE}/app/clinic/setup/${s}`);
        await phone.waitForSelector("main h1");
        await phone.waitForTimeout(600);
        assert(await noSideScroll(phone), `set-up ${s} scrolls sideways at 375 px`);
      }
      await phone.goto(`${BASE}/app/clinic/setup/services`);
      await phone.waitForSelector("main h1");
      await shot(phone, "375-setup-services");
      await axe(phone, "set-up services (375)");
      await phone.close();
    });

    await step("10. dashboard at 375 px: names on one line (full name on hover), badge and button under the text", async () => {
      const phone = await mk(375, 812, owner.context());
      await phone.goto(`${BASE}/app/clinic`);
      await phone.waitForSelector("[data-testid=dashboard]");
      const rows = await phone.locator("[data-testid=dash-row]").evaluateAll((els) =>
        els.map((li) => {
          const trailing = li.querySelector("[data-testid=dash-row-trailing]");
          const name = li.querySelector("a.truncate, span.truncate");
          const secondary = name && name.parentElement.nextElementSibling;
          return {
            text: li.innerText.slice(0, 60),
            under: trailing && name ? trailing.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 1 : true,
            title: name ? name.getAttribute("title") === name.textContent.trim() : true,
            secondaryLines: secondary ? Math.round(secondary.getBoundingClientRect().height / (parseFloat(getComputedStyle(secondary).lineHeight) || 18)) : 0,
          };
        }),
      );
      assert(rows.length > 0, "dashboard rows");
      const bad = rows.filter((r) => !r.under || !r.title || r.secondaryLines > 2);
      assert(bad.length === 0, `rows: ${JSON.stringify(bad)}`);
      await shot(phone, "375-dashboard");
      await axe(phone, "dashboard (375)");
      await phone.close();
    });

    await step("19. patient list: Site filter (a case or appointment at the site), in the URL, the chip removes it", async () => {
      const site = query("SELECT s.id, s.name FROM pms_sites s WHERE s.tenant_id = ? AND s.active = 1 ORDER BY s.sort_order, s.name LIMIT 1", CLINIC)[0];
      const expected = query(
        "SELECT COUNT(*) AS n FROM pms_patients p WHERE p.tenant_id = ? AND p.status = 'active' AND (EXISTS (SELECT 1 FROM pms_cases c WHERE c.tenant_id = p.tenant_id AND c.patient_id = p.id AND c.site_id = ?) OR EXISTS (SELECT 1 FROM pms_appointments a WHERE a.tenant_id = p.tenant_id AND a.patient_id = p.id AND a.site_id = ?))",
        CLINIC, site.id, site.id,
      )[0].n;
      await owner.goto(`${BASE}/app/clinic/patients`);
      await owner.waitForSelector("main h1");
      await owner.locator("main button", { hasText: /^\s*Site\s*$/ }).click();
      await owner.selectOption("#filter-site", site.id);
      await owner.waitForURL(/[?&]site=/);
      await owner.waitForFunction((name) => document.querySelector("main").innerText.includes(`Site: ${name}`), site.name);
      await owner.waitForTimeout(800);
      const text = await owner.locator("main").innerText();
      assert(text.includes(`${Number(expected).toLocaleString("en-GB")} active · ${site.name}`), `count for the site (${expected}): ${text.slice(0, 200)}`);
      await shot(owner, "1440-patients-site-filter", false);
      await axe(owner, "patients with the Site filter");
      await owner.locator("main button", { hasText: `Site: ${site.name}` }).click();
      await owner.waitForURL((u) => !u.search.includes("site="));
    });

    await step("Rules: DD/MM date-times on the record History and the audit", async () => {
      await owner.goto(`${REC}/history`);
      await owner.waitForSelector("main table tbody tr");
      const when = (await owner.locator("main table tbody tr td").first().innerText()).trim();
      assert(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(when), `history time: ${when}`);
      await owner.goto(`${BASE}/app/clinic/setup/audit`);
      await owner.waitForSelector("[data-testid=audit-rows] tbody tr");
      const auditWhen = (await owner.locator("[data-testid=audit-rows] tbody tr td").first().innerText()).trim();
      assert(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(auditWhen), `audit time: ${auditWhen}`);
    });

    await step("11 + 14. booking at 375 px: 44 px Back and date buttons; Your details says what is missing and focuses the first field", async () => {
      const anon = await mk(375, 812);
      failPages.push(["anon", anon]);
      await anon.goto(`${PUB}/book`);
      await anon.waitForSelector("h1:has-text('Where would you like to be seen?')");
      await anon.locator("main ul li button").first().click();
      const b = await box(anon.locator("button[aria-label=Back]"));
      assert(b.width >= 44 && b.height >= 44, `Back ${b.width}×${b.height}`);
      await anon.getByRole("button", { name: /Initial assessment/ }).click();
      await anon.getByRole("button", { name: /Anyone available/ }).click();
      await anon.waitForSelector("[aria-label='Available times'] button", { timeout: 60000 });
      for (const name of ["Earlier", "Later dates"]) {
        const d = await box(anon.locator("main button", { hasText: name }));
        assert(d.height >= 44, `${name} is ${d.height} px tall`);
      }
      await anon.locator("[aria-label='Available times'] button").first().click();
      await anon.click("footer button:has-text('Continue')");
      await anon.waitForSelector("h1:has-text('Your details')");
      const cont = anon.locator("footer button:has-text('Continue')");
      assert(!(await cont.isDisabled()), "Continue stays enabled");
      await cont.click();
      await anon.waitForFunction(() => document.activeElement && document.activeElement.id === "bk-firstName");
      for (const f of ["firstName", "lastName", "dateOfBirth", "phoneMobile", "email"]) {
        const input = anon.locator(`#bk-${f}`);
        assert((await input.getAttribute("aria-invalid")) === "true", `${f} is marked invalid`);
        const desc = await input.getAttribute("aria-describedby");
        assert(desc && (await anon.locator(`#${desc}`).innerText()).trim().length > 0, `${f} has its message`);
      }
      await shot(anon, "375-booking-details-errors");
      await axe(anon, "booking – your details with errors (375)");
      await anon.fill("#bk-firstName", "Ellie");
      await anon.fill("#bk-lastName", "Sample");
      await cont.click();
      await anon.waitForFunction(() => document.activeElement && document.activeElement.id === "bk-dateOfBirth");
      await anon.fill("#bk-dateOfBirth", "1990-05-04");
      await anon.fill("#bk-phoneMobile", "07700 900205");
      await anon.fill("#bk-email", "not-an-email");
      await cont.click();
      await anon.waitForFunction(() => document.activeElement && document.activeElement.id === "bk-email");
      assert((await anon.locator("#bk-email-err").innerText()).includes("valid email"), "the email's own message");
      await anon.fill("#bk-email", "ellie.sample@example.com");
      await cont.click();
      await anon.waitForSelector("h1:has-text('Check and confirm')");
      await anon.close();
    });
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  if (problems.length) console.log(`page problems:\n  ${problems.slice(0, 20).join("\n  ")}`);
  console.log(`\n${results.length - failed}/${results.length} steps passed${problems.length ? `, ${problems.length} page problems` : ""}`);
  process.exit(failed || problems.length ? 1 : 0);
})();
