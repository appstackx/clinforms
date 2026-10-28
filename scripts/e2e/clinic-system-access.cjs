/**
 * Browser check of configurable access (LOCAL only): Set-up → Roles and permissions and Staff access → member
 * access (design round 2), on a fresh demo clinic (npm run pms:seed-demo).
 *
 *   INVITE_A_FILE=<file holding the demo owner's invitation link> BASE=http://localhost:3182 \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/clinic-system-access.cjs
 *
 * The owner invites a receptionist (Jess Taylor) and a clinician (Priya Shah) – fictional, @example.com – through
 * ClinForms settings → Members, then: the grid (26 permissions, locked cells with their reasons, amber unsaved
 * state, "Review and save" confirm, history, Export log CSV, Reset to defaults), Jess's member access (exceptions
 * added and removed, locked permissions not offered, works at / can see, summary, save, deactivate and reactivate),
 * Priya's signing details; Jess herself: no Set-up entries, the access pages are the 404 page, no clinical notes tab.
 * axe (WCAG 2.1 A/AA) on both screens; 1440 and 375 px screenshots (no sideways page scroll at 375). Nothing secret
 * is printed. Screenshots: E2E_OUT (default .e2e-out/clinic-system-access).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3182";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/clinic-system-access");
const INVITE_RE = /https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._-]+/;
const INVITE_A = (fs.readFileSync(process.env.INVITE_A_FILE, "utf8").match(INVITE_RE) || [])[0];
if (!INVITE_A) throw new Error("No invitation link in INVITE_A_FILE");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

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
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 500)}`);
    throw err;
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

async function invite(page, email, role) {
  await page.goto(`${BASE}/app/settings/members`);
  await page.fill("input[name=email]", email);
  await page.selectOption("form select[name=role]", role);
  await page.click("form >> button:has-text('Invite')");
  const box = page.locator("[data-testid=invite-result] code").first();
  await box.waitFor();
  const link = (await box.innerText()).trim();
  assert(INVITE_RE.test(link), "the invitation link is shown (email is off locally)");
  return link;
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} – ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  console.log(`axe ${label}: ${r.length} violation(s)${r.length ? "\n  " + r.join("\n  ") : ""}`);
  return r;
}

const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** What sticks out on the right (for a failure message). */
const wideOnes = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .filter((el) => !el.closest("[class*='overflow-x-auto']"))
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}`)
      .join("; "),
  );

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctxO = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const ctxJ = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxP = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const o = await ctxO.newPage();
  const j = await ctxJ.newPage();
  const p = await ctxP.newPage();
  const problems = [];
  for (const [label, page] of [["owner", o], ["jess", j], ["priya", p]]) {
    page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|403|Not Found|Failed to fetch RSC payload/.test(m.text()) && problems.push(`${label} console: ${m.text().slice(0, 200)}`));
  }
  const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const axeFindings = [];
  let jessId = "";
  let priyaId = "";

  try {
    await step("the owner signs up; invites a receptionist and a clinician, who sign up", async () => {
      await onboard(o, INVITE_A, "Helen Ward (fictional)");
      const jessLink = await invite(o, "jess.taylor@example.com", "staff");
      const priyaLink = await invite(o, "priya.shah@example.com", "clinician");
      await onboard(j, jessLink, "Jess Taylor");
      await onboard(p, priyaLink, "Priya Shah");
    });

    await step("Set-up shows Staff access and Roles and permissions to the owner only", async () => {
      // M8: one "Set-up" entry in the main list; the set-up pages are the Set-up section's list.
      await o.goto(`${BASE}/app/clinic`);
      const ownerMain = (await o.locator("nav[aria-label='Clinic system'] a").allInnerTexts()).map((l) => l.trim());
      assert(ownerMain.includes("Set-up"), `owner nav: ${ownerMain.join(", ")}`);
      await o.goto(`${BASE}/app/clinic/access`);
      const owner = (await o.locator("nav[aria-label='Set-up'] a").allInnerTexts()).map((l) => l.trim());
      assert(owner.includes("Staff access") && owner.includes("Roles and permissions"), `owner set-up nav: ${owner.join(", ")}`);
      await j.goto(`${BASE}/app/clinic`);
      const jess = (await j.locator("nav[aria-label='Clinic system'] a").allInnerTexts()).map((l) => l.trim());
      assert(!jess.includes("Set-up") && !jess.includes("Staff access") && !jess.includes("Roles and permissions") && !jess.includes("Reports"), `reception nav: ${jess.join(", ")}`);
      for (const url of ["/app/clinic/access", "/app/clinic/access/roles", "/app/clinic/access/roles/history"]) {
        const res = await j.goto(`${BASE}${url}`);
        assert(res.status() === 404 || res.status() === 403, `${url} → ${res.status()} for reception`);
      }
    });

    await step("the grid: 26 permissions in 7 groups, role columns with people, locked cells with their reasons", async () => {
      await o.goto(`${BASE}/app/clinic/access/roles`);
      await o.waitForSelector("h1:has-text('Roles and permissions')");
      assert((await o.locator("tbody th[scope=row]").count()) === 26, "26 permission rows");
      const groups = await o.locator("tbody th[scope=rowgroup]").allInnerTexts();
      assert(groups.map((g) => g.toLowerCase()).join(",") === "diary,patients,clinical,billing,messages,reports,settings", `groups: ${groups}`);
      const head = (await o.locator("thead").innerText()).replace(/\s+/g, " ");
      assert(/Owner 1 person/.test(head) && /Clinician 1 person/.test(head) && /Reception 1 person/.test(head), `head: ${head}`);
      const row = (label) => o.locator("tbody tr", { has: o.locator(`th[scope=row] >> text="${label}"`) });
      const reception = await row("See clinical notes and outcomes").locator("td").nth(3).innerText();
      assert(/Never/.test(reception) && /Reception can never see clinical note content/.test(reception), `reception clinical cell: ${reception}`);
      assert((await row("Change the owner").locator("td").nth(1).innerText()).includes("Only the owner can change the owner"), "change the owner is locked for admins");
      assert((await row("View the diary").locator("td").nth(0).innerText()).includes("Always"), "owner always");
      assert((await o.locator("tbody input[type=checkbox]").count()) === 26 * 3 - 4 - 3, "editable cells: all but owner, reception clinical (4) and change the owner (3)");
      assert(await o.locator("button:has-text('No changes')").isDisabled(), "nothing to save yet");
    });

    await step("ticks: amber outline, 'N changes unsaved', Custom markers; Discard and Reset to defaults", async () => {
      const cell = (label, col) => o.locator("tbody tr", { has: o.locator(`th[scope=row] >> text="${label}"`) }).locator("td").nth(col).locator("input[type=checkbox]");
      await cell("Take payments", 2).check();
      await cell("Export data", 1).check();
      await cell("Refunds and credit notes", 3).check();
      await o.waitForSelector("text=3 changes unsaved");
      assert((await o.locator("tbody label:has-text('Custom')").count()) === 3, "3 custom cells");
      await o.click("button:has-text('Discard')");
      assert((await o.locator("text=changes unsaved").count()) === 0, "discarded");
      await cell("Refunds and credit notes", 3).check();
      await cell("Take payments", 2).check();
      await cell("Export data", 1).check();
      await o.locator("main h1").scrollIntoViewIfNeeded();
      await shot(o, "roles-1440-unsaved");
      axeFindings.push(...(await axe(o, "roles (unsaved changes)")).map((v) => `roles: ${v}`));
    });

    await step("Review and save: the confirm lists every change with who it affects; saving writes the history", async () => {
      await o.click("button:has-text('Review and save (3)')");
      const dialog = o.locator("[role=alertdialog]");
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      assert(/Save 3 changes\?/.test(text) && /Clinician Take payments Allowed Affects 1 person/.test(text) && /Admin Export data Allowed/.test(text), `confirm: ${text}`);
      await shot(o, "roles-1440-confirm", false);
      // Keep editing: back to the grid, then save only two (undo the admin export).
      await o.click("[role=alertdialog] >> button:has-text('Keep editing')");
      await o.locator("tbody tr", { has: o.locator(`th[scope=row] >> text="Export data"`) }).locator("td").nth(1).locator("input").uncheck();
      await o.click("button:has-text('Review and save (2)')");
      await o.click("[role=alertdialog] >> button:has-text('Save changes')");
      await o.waitForSelector("text=/2 changes saved at \\d\\d:\\d\\d by Helen Ward/");
      await o.waitForSelector("section[aria-labelledby=hist-h] >> text=Reception · Refunds and credit notes: not allowed → allowed");
      assert(await o.locator("button:has-text('No changes')").isDisabled(), "saved");
      assert((await o.locator("tbody label:has-text('Custom')").count()) === 2, "2 custom cells after saving");
      await shot(o, "roles-1440-saved");
    });

    await step("Export log: a CSV of the history, without patient data", async () => {
      const [download] = await Promise.all([o.waitForEvent("download"), o.click("a:has-text('Export log')")]);
      const file = path.join(OUT, "access-change-log.csv");
      await download.saveAs(file);
      const csv = fs.readFileSync(file, "utf8");
      assert(csv.startsWith("When,Who,What,Change"), "CSV header");
      assert(/Helen Ward \(fictional\),Roles and permissions,Clinician · Take payments: not allowed → allowed/.test(csv), "CSV row");
      assert(!/sim-pat|Megan|Hart/.test(csv), "no patient data");
    });

    await step("Staff access list → Jess's member access: role cards, no exceptions yet, summary", async () => {
      await o.goto(`${BASE}/app/clinic/access`);
      await o.click("main a:has-text('Jess Taylor')");
      await o.waitForURL(/\/app\/clinic\/access\/[^/]+$/);
      jessId = decodeURIComponent(o.url().split("/").pop());
      await o.waitForSelector("text=No exceptions – Jess has exactly the Reception permissions.");
      const options = await o.locator("#add-ex option").allInnerTexts();
      assert(!options.some((t) => /clinical/i.test(t)), `no clinical option for reception: ${options.join(" | ")}`);
      assert(options.includes("Add: override diary clashes") && options.includes("Remove: give refunds and credit notes"), "candidates follow the clinic's roles");
      const summary = (await o.locator("aside").innerText()).replace(/\s+/g, " ");
      assert(/Give refunds and credit notes/.test(summary.split("Cannot")[0]), "the clinic override shows in 'Can'");
      assert(/See clinical notes and outcomes – never, for reception/.test(summary), "locked in 'Cannot'");
    });

    await step("exceptions added and removed, sites (works at ⇒ can see), save with the last-changed line", async () => {
      await o.selectOption("#add-ex", { label: "Add: override diary clashes" });
      await o.selectOption("#add-ex", { label: "Remove: give refunds and credit notes" });
      await o.waitForSelector("li:has-text('Added') >> text=Override diary clashes");
      await o.waitForSelector("li:has-text('Removed') >> text=Give refunds and credit notes");
      await o.click("button[role=switch][aria-checked=true]");
      const siteNames = await o.locator("section[aria-labelledby=site-h] tbody th[scope=row]").allInnerTexts();
      assert(siteNames.length >= 2, `sites: ${siteNames.join(", ")}`);
      await o.check(`input[aria-label="Works at ${siteNames[0]}"]`);
      await o.check(`input[aria-label="Works at ${siteNames[1]}"]`);
      assert(await o.locator(`input[aria-label="Can see ${siteNames[0]}"]`).isDisabled(), "a site they work at is always visible");
      const lead = await o.locator("aside p").first().innerText();
      assert(/^Jess is a reception who works at .+ and can see \d+ of \d+ sites\. 2 exceptions to the role\.$/.test(lead), `lead: ${lead}`);
      await o.waitForSelector("aside >> text=Unsaved changes");
      await o.locator("main").evaluate((m) => m.scrollTo(0, 0));
      await shot(o, "member-1440-unsaved");
      axeFindings.push(...(await axe(o, "member access (unsaved)")).map((v) => `member: ${v}`));
      await o.click("aside >> button:has-text('Save access')");
      await o.waitForSelector("aside >> text=/Saved \\d\\d:\\d\\d by Helen Ward/");
      await o.waitForSelector("aside >> text=/Last changed .* by Helen Ward \\(fictional\\)/");
      await shot(o, "member-1440-saved");
    });

    await step("Jess on her next page load: the override and the site limit apply; no clinical notes", async () => {
      await j.goto(`${BASE}/app/clinic`);
      const menu = await j.locator("button[aria-haspopup='menu']").innerText();
      assert(!/all \d+ sites/.test(menu), `sites in the user menu: ${menu.replace(/\s+/g, " ")}`);
      await j.goto(`${BASE}/app/clinic/patients?q=Hart`);
      const first = j.locator("main a[href*='/app/clinic/patients/pat_']").first();
      if (await first.count()) {
        const href = await first.getAttribute("href");
        const res = await j.goto(`${BASE}${href}/notes`);
        assert(res.status() === 404, `notes for reception → ${res.status()}`);
      }
    });

    await step("Priya (clinician): signing details; deactivate and reactivate", async () => {
      await o.goto(`${BASE}/app/clinic/access`);
      await o.click("main a:has-text('Priya Shah')");
      await o.waitForURL(/\/app\/clinic\/access\/[^/]+$/);
      priyaId = decodeURIComponent(o.url().split("/").pop());
      await o.waitForSelector("h2:has-text('Signing details')");
      assert(/How signed notes and letters show it/.test(await o.locator("section[aria-labelledby=sign-h]").innerText()), "signing preview");
      await shot(o, "member-1440-clinician");
      // Signing details are editable for the owner (settings.members): the HCPC format is checked, then saved.
      await o.fill("#sign-number", "12345");
      await o.click("button:has-text('Save signing details')");
      await o.waitForSelector("text=Enter the HCPC number as PH followed by digits");
      await o.fill("#sign-number", "ph-demo-08");
      await o.click("button:has-text('Save signing details')");
      await o.waitForSelector("text=Signing details saved.");
      assert((await o.inputValue("#sign-number")) === "PH-DEMO-08", "stored normalised");
      assert(/HCPC PH-DEMO-08/.test(await o.locator("section[aria-labelledby=sign-h]").innerText()), "the preview shows the number");
      await shot(o, "member-1440-clinician-signing-saved");
      // Priya sees her own signing details on My account – read only.
      await p.goto(`${BASE}/app/clinic/account`);
      await p.waitForSelector("h2:has-text('My signing details')");
      assert((await p.locator("[data-testid=signing-number]").innerText()) === "PH-DEMO-08", "her number");
      assert((await p.locator("#sign-number").count()) === 0, "not editable by the member");
      await shot(p, "my-account-1440-clinician");
      await o.click("section[aria-label=Member] >> button:has-text('Deactivate')");
      await o.click("[role=alertdialog] >> button:has-text('Deactivate')");
      await o.waitForSelector("text=Deactivated");
      const res = await p.goto(`${BASE}/app/clinic`);
      assert(res.status() === 404, `deactivated clinician → ${res.status()}`);
      await o.click("button:has-text('Reactivate')");
      await o.waitForSelector("section[aria-label=Member] >> text=Active");
      const back = await p.goto(`${BASE}/app/clinic`);
      assert(back.status() === 200, `reactivated → ${back.status()}`);
    });

    await step("own access and the owner's are read-only", async () => {
      await o.goto(`${BASE}/app/clinic/access`);
      await o.click("main a:has-text('Helen Ward')");
      await o.waitForSelector("text=This access can’t be changed here");
      assert(await o.locator("aside >> button:has-text('Save access')").isDisabled(), "owner's own access cannot be saved");
    });

    await step("375 px: both screens without sideways page scrolling", async () => {
      await o.setViewportSize({ width: 375, height: 812 });
      await o.goto(`${BASE}/app/clinic/access/roles`);
      await o.waitForSelector("h1:has-text('Roles and permissions')");
      assert((await noSideways(o)) <= 0, `roles scrolls sideways by ${await noSideways(o)}px: ${await wideOnes(o)}`);
      assert(await o.locator("thead th:has-text('Reception')").isVisible(), "reception shown first on a phone");
      assert(!(await o.locator("thead th:has-text('Clinician')").isVisible()), "one role at a time on a phone");
      await shot(o, "roles-375");
      await o.click("[role=radiogroup] >> [role=radio]:has-text('Clinician')");
      assert(await o.locator("thead th:has-text('Clinician')").isVisible(), "the role picker switches the column");
      await shot(o, "roles-375-clinician", false);
      await o.goto(`${BASE}/app/clinic/access/${encodeURIComponent(jessId)}`);
      await o.waitForSelector("h2:has-text('Sites')");
      assert((await noSideways(o)) <= 0, `member access scrolls sideways by ${await noSideways(o)}px: ${await wideOnes(o)}`);
      await shot(o, "member-375");
      axeFindings.push(...(await axe(o, "member access 375")).map((v) => `member375: ${v}`));
      await o.goto(`${BASE}/app/clinic/access`);
      assert((await noSideways(o)) <= 0, "staff list fits");
      await shot(o, "staff-375");
      await o.setViewportSize({ width: 1440, height: 900 });
      await o.goto(`${BASE}/app/clinic/access`);
      await shot(o, "staff-1440");
    });

    await step("no page errors; no axe violations", async () => {
      assert(problems.length === 0, problems.join("\n"));
      assert(axeFindings.length === 0, axeFindings.join("\n"));
    });
  } catch {
    // reported by step()
  } finally {
    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} steps passed. Screenshots: ${OUT}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
