/**
 * Browser check of the clinic system's design-system page (/app/clinic/design-system, LOCAL only – M10 finding 15):
 * every Part A component of the round 2 brief is shown (date and time pickers, patient combobox, dropdown menu, the
 * context-menu placeholder, tooltip, popover, step indicator, file upload, chart styles, breadcrumb, segmented
 * control, unsaved-changes and locked banners); each interactive piece works by keyboard; axe finds no serious or
 * critical WCAG 2.1 A/AA problem at 1440 and 375 px; nothing scrolls sideways at 375 px (also with the calendar and
 * the menu open); Part A's controls are at least 44 px tall at 375 px.
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3223 > seed.out     (scratch SQLite)
 *   server: next start -p 3223 (a production build)
 *   SEED_LOG=seed.out BASE=http://localhost:3223 E2E_OUT=<dir>
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-design-system.cjs
 *
 * Fictional data only (the demo clinic; the page itself holds fixed fictional examples). Nothing secret is printed.
 * The colour-token swatches marked data-contrast-demo fail contrast on purpose (they show why the strong steps exist)
 * and are left out of axe.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3223";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-design-system");
const SEED_LOG = process.env.SEED_LOG;
const AXE = require.resolve("axe-core/axe.min.js");
const PAGE = `${BASE}/app/clinic/design-system`;

const PART_A = [
  ["s-date", "Date and time pickers"],
  ["s-combobox", "Patient search"],
  ["s-menu", "Dropdown menu"],
  ["s-context-menu", "Context menu"],
  ["s-tooltip", "Tooltip and popover"],
  ["s-steps", "Step indicator"],
  ["s-upload", "File upload"],
  ["s-charts", "Chart styles"],
  ["s-breadcrumb", "Breadcrumb and back link"],
  ["s-segmented", "Segmented control"],
  ["s-banners", "Unsaved changes and locked banners"],
];

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
let current = null;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 900)}`);
    if (current) await current.screenshot({ path: path.join(OUT, `fail-${results.length}.png`) }).catch(() => {});
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

const axeReport = [];
async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run({ exclude: [["[data-contrast-demo]"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  axeReport.push({ label, found });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
}

async function noSideScroll(page, label) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(m.sw <= m.cw, `${label}: page scrolls sideways (${m.sw} > ${m.cw})`);
}

const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName, id: el.id, text: (el.textContent || "").trim().slice(0, 60), iso: el.getAttribute("data-iso"), role: el.getAttribute("role"), label: el.getAttribute("aria-label") } : null;
});
const ukOf = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const isoPlus = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  current = page;
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|favicon|Failed to fetch RSC payload/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });

  try {
    await step("owner signs in", async () => {
      await onboard(page, ownerInvite, "Helen Ward (fictional)");
    });

    await step("every Part A section is on the page (1440 px)", async () => {
      await page.goto(PAGE);
      await page.waitForSelector("h1:has-text('Foundations and components')");
      for (const [id, title] of PART_A) {
        const h = page.locator(`h2#${id}`);
        assert((await h.count()) === 1, `missing section ${id}`);
        assert((await h.innerText()).startsWith(title), `${id} heading: ${await h.innerText()}`);
      }
      assert((await page.locator("[data-testid=context-menu-demo] button").count()) >= 1, "the context menu example's diary block");
      assert((await page.locator("[data-testid=s-charts] svg[role=img]").count()) === 3, "three charts");
      await page.screenshot({ path: path.join(OUT, "1440-full.png"), fullPage: true });
    });

    await step("axe – 1440 px", async () => axe(page, "1440"));

    await step("context menu: Shift+F10 on the block opens it, arrows skip the disabled item, Enter chooses, focus returns", async () => {
      const block = page.locator("[data-testid=context-menu-demo] button").first();
      await block.focus();
      await page.keyboard.press("Shift+F10");
      const menu = page.locator("[role=menu][aria-label='Actions for Fatima Begum (fictional)']");
      await menu.waitFor();
      await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("role") === "menuitem");
      await page.keyboard.press("End");
      assert((await page.evaluate(() => document.activeElement.textContent)).includes("Cancel"), "End → the last item");
      await page.keyboard.press("ArrowUp");
      assert((await page.evaluate(() => document.activeElement.textContent)).includes("Take payment"), "the disabled item is skipped");
      await axe(page, "context menu open");
      await page.screenshot({ path: path.join(OUT, "1440-context-menu-open.png") });
      await page.keyboard.press("Enter");
      await menu.waitFor({ state: "detached" });
      await page.waitForSelector("[data-testid=context-menu-demo] >> text=Chosen: Take payment");
      assert(await block.evaluate((el) => el === document.activeElement), "focus back on the block");
      await block.click({ button: "right" });
      await menu.waitFor();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    });

    await step("date picker by keyboard: open, move a day, pick, Esc returns focus", async () => {
      const input = page.locator("#ds-pick-date");
      const before = await input.inputValue();
      await page.focus("#ds-pick-date-button");
      await page.keyboard.press("Enter");
      const dlg = page.locator("[role=dialog][aria-label='Choose a date']");
      await dlg.waitFor();
      let f = await focused(page);
      assert(f && f.iso && ukOf(f.iso) === before, `focus on the selected day (${JSON.stringify(f)}, value ${before})`);
      await page.keyboard.press("ArrowRight");
      f = await focused(page);
      const want = isoPlus(f.iso, 0);
      assert(want === isoPlus(`${before.slice(6)}-${before.slice(3, 5)}-${before.slice(0, 2)}`, 1), `moved one day: ${f.iso}`);
      await page.screenshot({ path: path.join(OUT, "1440-date-picker-open.png") });
      await page.keyboard.press("Enter");
      await dlg.waitFor({ state: "detached" });
      assert((await input.inputValue()) === ukOf(want), `picked ${await input.inputValue()}`);
      assert((await focused(page)).id === "ds-pick-date-button", "focus back on the calendar button");
      await page.keyboard.press("Enter");
      await dlg.waitFor();
      await page.keyboard.press("PageDown");
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached" });
      assert((await focused(page)).id === "ds-pick-date-button", "Esc returns focus");
      assert((await input.inputValue()) === ukOf(want), "Esc keeps the value");
      // Typing works too; a date before min is refused.
      await input.fill("01/01/2020");
      await page.keyboard.press("Tab");
      assert((await input.inputValue()) === ukOf(want), "a date before min is refused");
      const times = await page.locator("#ds-pick-time option").allInnerTexts();
      assert(times[0] === "08:00" && times[1] === "08:15" && times.at(-1) === "20:00", `15-minute 24-hour times: ${times.slice(0, 3)}`);
      const fives = await page.locator("#ds-pick-time5 option").allInnerTexts();
      assert(fives[1] === "08:05", "5-minute steps");
    });

    await step("patient combobox by keyboard: type, ↓, Enter picks; Create new patient last", async () => {
      await page.focus("#ds-patient");
      await page.keyboard.type("ell");
      const list = page.locator("#ds-patient-list");
      await list.waitFor({ state: "visible" });
      const opts = await list.locator("[role=option]").allInnerTexts();
      assert(opts.length === 5 && /Create new patient/.test(opts.at(-1)), `options: ${opts.map((o) => o.split("\n")[0])}`);
      assert(/Alert: Latex allergy/.test(opts[0]) && /DOB 14\/03\/1958/.test(opts[0]) && /07700 900412/.test(opts[0]) && /Next Tue 03\/11 09:00/.test(opts[0]), `first option details: ${opts[0]}`);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      const ad = await page.getAttribute("#ds-patient", "aria-activedescendant");
      assert(ad && (await page.locator(`[id="${ad}"]`).innerText()).includes("Margaret Elliot"), `active option ${ad}`);
      await page.screenshot({ path: path.join(OUT, "1440-combobox-open.png") });
      await page.keyboard.press("Enter");
      await list.waitFor({ state: "hidden" });
      assert(/Margaret Elliot/.test(await page.locator("[data-testid=ds-patient-chosen]").innerText()), "chosen");
      await page.fill("#ds-patient", "zz");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await page.waitForSelector("[role=alert]:has-text('These patients look similar')");
      await page.keyboard.press("Escape");
    });

    await step("dropdown menu by keyboard: Enter opens on the first item, ↓, type-ahead, Esc returns", async () => {
      const trigger = page.locator("[data-testid=s-menu] button[aria-haspopup=menu]");
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.locator("[role=menu][aria-label='Appointment actions']");
      await menu.waitFor();
      assert((await focused(page)).text.startsWith("Mark as arrived"), `first item focused: ${(await focused(page)).text}`);
      await page.keyboard.press("ArrowDown");
      assert((await focused(page)).text.startsWith("Start treatment"), "↓ moves");
      await page.keyboard.press("c");
      assert((await focused(page)).text.startsWith("Cancel appointment"), "type-ahead");
      await page.keyboard.press("ArrowDown");
      assert((await focused(page)).text.startsWith("Mark as arrived"), "wraps and skips the disabled item");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      assert((await focused(page)).text.startsWith("Did not attend"), "↑ skips the separator");
      await page.screenshot({ path: path.join(OUT, "1440-dropdown-open.png") });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      assert((await trigger.getAttribute("aria-expanded")) === "false" && (await focused(page)).text.startsWith("Appointment actions"), "Esc returns focus");
      await page.keyboard.press("ArrowDown");
      await menu.waitFor();
      await page.keyboard.press("Enter");
      await page.waitForSelector("[role=status]:has-text('Marked as arrived (example')");
    });

    await step("tooltip opens on focus, Esc closes; popover by keyboard", async () => {
      await page.focus("button[aria-label='Print day sheet']");
      const tip = page.locator("[role=tooltip]");
      await tip.first().waitFor({ timeout: 5000 });
      assert(/Print day sheet/.test(await tip.first().innerText()), "tooltip text");
      await page.keyboard.press("Escape");
      await tip.first().waitFor({ state: "detached", timeout: 5000 });
      const trig = page.locator("button[aria-haspopup=dialog]:has-text('Authorisation details')");
      await trig.focus();
      await page.keyboard.press("Enter");
      const pop = page.locator("[role=dialog][aria-label='Authorisation BW-55021']");
      await pop.waitFor();
      assert(await pop.evaluate((el) => el.contains(document.activeElement)), "focus moved into the popover");
      await page.screenshot({ path: path.join(OUT, "1440-popover-open.png") });
      await page.keyboard.press("Escape");
      await pop.waitFor({ state: "detached" });
      assert((await focused(page)).text.includes("Authorisation details"), "focus back on the popover's button");
    });

    await step("step indicator follows Next; segmented control and the chart's table by arrow keys", async () => {
      const cur = () => page.locator("[data-testid=s-steps] nav[aria-label='Booking steps'] [aria-current=step]").innerText();
      assert(/Service/.test(await cur()), `current ${await cur()}`);
      await page.locator("[data-testid=s-steps] button:has-text('Next step')").focus();
      await page.keyboard.press("Enter");
      assert(/Practitioner/.test(await cur()), `after Next: ${await cur()}`);
      const day = page.locator("[role=radiogroup][aria-label='Diary view'] [role=radio]:has-text('Day')");
      await day.focus();
      await page.keyboard.press("ArrowRight");
      assert((await page.locator("[role=radiogroup][aria-label='Diary view'] [aria-checked=true]").innerText()) === "Week", "→ chose Week");
      assert((await focused(page)).text === "Week", "focus moved with the choice");
      assert(/Showing: Week/.test(await page.locator("[data-testid=ds-segmented-value]").innerText()), "view changed");
      const chartSwitch = page.locator("[role=radiogroup][aria-label='Show New patients by month as'] [role=radio]:has-text('Chart')");
      await chartSwitch.focus();
      await page.keyboard.press("ArrowRight");
      const table = page.locator("figure:has(figcaption:has-text('New patients by month')) table");
      await table.waitFor();
      assert(/Oct\s+47/.test(await table.innerText()), "the chart's table alternative");
    });

    await step("file upload: a refused type says why, an accepted file shows progress then Uploaded", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-upload-"));
      const ok = path.join(dir, "discharge-letter.pdf");
      const bad = path.join(dir, "notes.exe");
      fs.writeFileSync(ok, "%PDF-1.4 fictional\n");
      fs.writeFileSync(bad, "MZ");
      assert(await page.locator("[data-testid=s-upload] button:has-text('Choose files')").isEnabled(), "Choose files is a real button");
      await page.setInputFiles("#ds-upload", [ok, bad]);
      await page.waitForSelector("[data-testid=s-upload] li:has-text('notes.exe') >> text=/isn’t a file type we accept/");
      await page.waitForSelector("[data-testid=s-upload] li:has-text('discharge-letter.pdf') >> text=Uploaded", { timeout: 10000 });
      assert((await page.locator("[data-testid=s-upload] [role=progressbar][aria-label='Uploading mri-report.pdf']").getAttribute("aria-valuenow")) === "64", "progress bar value");
      fs.rmSync(dir, { recursive: true, force: true });
    });

    await step("banners: Discard by keyboard clears the unsaved banner; locked banners say why", async () => {
      await page.locator("[data-testid=s-banners] button:has-text('Discard')").focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-testid=s-banners] button:has-text('Show the unsaved-changes banner again')");
      assert((await page.locator("[data-testid=s-banners] [role=note]").count()) === 2, "two locked banners");
      const crumb = page.locator("[data-testid=s-breadcrumb] nav[aria-label=Breadcrumb] [aria-current=page]");
      assert((await crumb.innerText()) === "Clinical note 27/10/2026", "breadcrumb current page");
    });

    await step("no console errors", async () => {
      assert(problems.length === 0, problems.join("\n"));
    });

    // ---- 375 px ----
    await page.setViewportSize({ width: 375, height: 800 });
    await step("375 px: sections, no sideways scroll (also with the calendar and the menu open), 44 px targets", async () => {
      await page.goto(PAGE);
      await page.waitForSelector("h2#s-banners");
      await noSideScroll(page, "375 closed");
      const small = await page.evaluate(() => {
        const out = [];
        for (const sec of document.querySelectorAll("section[data-testid^='s-']")) {
          for (const el of sec.querySelectorAll("button, a[href], input:not([type=file]), select, [role=radio]")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const box = el.tagName === "INPUT" ? el.closest("[class*='max-sm:h-11']") || el : el;
            const h = Math.max(r.height, box.getBoundingClientRect().height);
            if (h < 44) out.push(`${sec.dataset.testid}: ${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(h)}px`);
          }
        }
        return out;
      });
      assert(small.length === 0, `under 44 px at 375: ${small.join("; ")}`);
      const back = page.locator("[data-testid=s-breadcrumb] nav[aria-label=Breadcrumb] a:has-text('Back to Margaret Ellis')");
      assert(await back.isVisible(), "the phone's back link");
      await page.screenshot({ path: path.join(OUT, "375-full.png"), fullPage: true });
      await page.focus("#ds-pick-date-button");
      await page.keyboard.press("Enter");
      await page.locator("[role=dialog][aria-label='Choose a date']").waitFor();
      await noSideScroll(page, "375 calendar open");
      const dayH = await page.locator("[role=dialog][aria-label='Choose a date'] button[data-iso]").first().evaluate((el) => el.getBoundingClientRect().height);
      assert(dayH >= 44, `calendar day ${dayH}px`);
      await page.locator("[role=dialog][aria-label='Choose a date']").screenshot({ path: path.join(OUT, "375-date-picker-open.png") });
      await page.keyboard.press("Escape");
      await page.locator("[data-testid=s-menu] button[aria-haspopup=menu]").click();
      await page.locator("[role=menu]").waitFor();
      await noSideScroll(page, "375 menu open");
      await page.keyboard.press("Escape");
    });

    await step("axe – 375 px", async () => axe(page, "375"));
  } finally {
    fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` – FAILED: ${failed.map((f) => f.name).join(" | ")}` : ""}`);
  console.log(`axe findings (all impacts): ${axeReport.map((a) => `${a.label}: ${a.found.length ? a.found.map((v) => `${v.id}(${v.impact})`).join(", ") : "none"}`).join(" · ")}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
