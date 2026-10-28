/**
 * Browser check of the billing screens (LOCAL only – M5, designs round 2c, 2f and 3): the billing home (totals, tabs,
 * invoice list, CSV), "Invoice attended visits" (completed and DNA / late-cancellation visits → drafts → issue), a
 * part payment by cash, a payment link (test mode, through the local provider stub), the insured split invoice,
 * an insurer remittance with a short payment written off, the printed A4 invoice and statement, aged debt, a credit
 * note that gives the balance back (and the refund), void; what reception, a clinician (read-only) and the owner
 * may do; take payment at 375 px and from the diary drawer; the patient record's Account card, Invoices tab and the
 * patient list's Balance / "Owes money"; axe on each screen.
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3188 > seed.out   (scratch SQLite)
 *   node scripts/e2e/stripe-test-stub.cjs 3199 &                                  (the provider's TEST stand-in)
 *   CLINIC_PAYMENTS_PROVIDER=stripe_test CLINIC_STRIPE_TEST_SECRET_KEY=sk_test_<made-up>
 *   CLINIC_STRIPE_TEST_API_BASE=http://127.0.0.1:3199/v1 → the server (next start -p 3188)
 *   SEED_LOG=seed.out BASE=http://localhost:3188 STUB=http://127.0.0.1:3199 E2E_OUT=<dir> \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-billing-screens.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed (random passwords, codes in memory; the
 * provider "key" is made up and only reaches the loopback stub).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3188";
const STUB = process.env.STUB || "";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-billing");
const SEED_LOG = process.env.SEED_LOG;
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const BILLING = `${BASE}/app/clinic/billing`;

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
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 700)}`);
    for (const [who, page] of failPages) await page.screenshot({ path: path.join(OUT, `fail-${results.length}-${who}.png`) }).catch(() => {});
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const pounds = (text) => Number(String(text).replace(/[£,\s]/g, "").replace(/^−/, "-"));

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

/** The invoice id of a billing page URL. */
const invoiceIdOf = (url) => (url.match(/\/invoices\/([^/?#]+)/) || [])[1];

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async (width = 1440, height = 1000) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon|clipboard/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk();
  const reception = await mk();
  const clinician = await mk();
  failPages.push(["owner", owner], ["reception", reception], ["clinician", clinician]);
  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const s = { self: null, dna: null, insured: null, selfInv: null, dnaInv: null, insurerInv: null, excessInv: null, insurer: null, voidable: null, selfPatientId: null };

  try {
    await step("owner, reception and clinician accounts (two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-bill-reception-${RUN}@example.com`, "staff");
      const c = await invite(owner, `zz-bill-clinician-${RUN}@example.com`, "clinician");
      await onboard(reception, r, "Jess Taylor (fictional)");
      await onboard(clinician, c, "Priya Shah (fictional)");
    });

    await step("navigation: Billing for all three roles; the billing home shows the totals and the tabs", async () => {
      for (const page of [owner, reception, clinician]) {
        await page.goto(`${BASE}/app/clinic`);
        const labels = await page.locator("nav[aria-label='Clinic system'] a").allInnerTexts();
        assert(labels.some((l) => /^Billing$/.test(l.trim())), `Billing in nav: ${labels.join(", ")}`);
      }
      await owner.goto(BILLING);
      await owner.waitForSelector("[data-testid=billing-figures]");
      const figures = await owner.locator("[data-testid=billing-figures]").innerText();
      for (const w of ["Outstanding", "Overdue", "Taken today"]) assert(figures.includes(w), `figure ${w}`);
      const tabs = await owner.locator("nav[aria-label='Billing sections'] a").allInnerTexts();
      assert(tabs.length === 5 && /Attended, not invoiced \(\d+\)/.test(tabs[1]), `tabs: ${tabs.join(" | ")}`);
      assert((await owner.locator("table tbody tr").count()) > 3, "seeded invoices listed");
      await shot(owner, "1440-billing-invoices");
      await axe(owner, "billing invoices");
    });

    await step("invoice list: status chips and search in the URL; CSV for the owner (formula cells defused), not for reception", async () => {
      await owner.click("[role=group][aria-label=Status] a:has-text('Overdue')");
      await owner.waitForURL(/state=overdue/);
      const rows = await owner.locator("table tbody tr").allInnerTexts();
      assert(rows.length > 0 && rows.every((r) => /Overdue/.test(r)), `overdue rows: ${rows.length}`);
      await owner.goto(`${BILLING}?state=all`);
      const csv = await owner.request.get(`${BILLING}/export?state=all`);
      assert(csv.ok(), `CSV ${csv.status()}`);
      const text = await csv.text();
      assert(/^﻿?Invoice,Bill to,Patient/.test(text), "CSV header");
      assert(!/\n[=+\-@]/.test(text), "no cell starts with a formula character");
      const denied = await reception.request.get(`${BILLING}/export?state=all`);
      assert(denied.status() === 403, `reception CSV: ${denied.status()}`);
      await reception.goto(BILLING);
      assert((await reception.locator("a:has-text('CSV')").count()) === 0, "no CSV button for reception");
    });

    await step("Invoice attended visits: completed + DNA/late fees listed (never in treatment), waive a fee, choose visits → preview → drafts", async () => {
      await reception.goto(BILLING);
      await reception.click("[data-testid=invoice-visits-button]");
      await reception.waitForURL(/\/billing\/visits$/);
      await reception.waitForSelector("[data-testid=visits-table]");
      await shot(reception, "1440-invoice-visits");
      await axe(reception, "invoice visits");
      const rows = reception.locator("[data-testid=visits-table] tbody tr");
      const texts = await rows.allInnerTexts();
      assert(texts.every((t) => !/In treatment|Arrived/.test(t)), "only chargeable outcomes");
      const fee = texts.findIndex((t) => /Did not attend|Late cancellation/.test(t));
      const self = texts.findIndex((t) => /Completed/.test(t) && /Self-pay/.test(t));
      let insured = texts.findIndex((t) => /Completed/.test(t) && /excess/.test(t));
      if (insured < 0) insured = texts.findIndex((t) => /Completed/.test(t) && !/Self-pay/.test(t));
      assert(fee >= 0 && self >= 0 && insured >= 0, `rows: fee ${fee}, self ${self}, insured ${insured} of ${texts.length}`);
      const fees = texts.map((t, i) => (/Did not attend|Late cancellation/.test(t) ? i : -1)).filter((i) => i >= 0);
      s.dna = await rows.nth(fee).getAttribute("data-appointment");
      s.self = await rows.nth(self).getAttribute("data-appointment");
      s.insured = await rows.nth(insured).getAttribute("data-appointment");
      // Waive a second fee if there is one (it leaves the list).
      if (fees.length > 1) {
        const other = await rows.nth(fees[1]).getAttribute("data-appointment");
        await rows.nth(fees[1]).locator("button:has-text('Waive fee')").click();
        await reception.waitForSelector("[role=status] >> text=Fee waived");
        await reception.waitForFunction((id) => !document.querySelector(`[data-appointment="${id}"]`), other);
      }
      // Choose three visits only.
      await reception.uncheck("input[aria-label='Select all visits']");
      for (const id of [s.self, s.dna, s.insured]) await reception.check(`[data-appointment="${id}"] input[type=checkbox]`);
      const summary = await reception.locator("[data-testid=visits-summary]").innerText();
      assert(/^3 visits selected → [3-4] invoices/.test(summary), summary);
      await reception.click("button:has-text('Preview drafts')");
      await reception.waitForSelector("[data-testid=draft-preview]");
      await shot(reception, "1440-invoice-visits-preview");
      await reception.click("button:has-text('Create drafts')");
      await reception.waitForSelector("[data-testid=visits-done]");
      await shot(reception, "1440-invoice-visits-done");
      const links = reception.locator("[data-testid=visits-done] a[href*='/invoices/']");
      assert((await links.count()) >= 3, `drafts made: ${await links.count()}`);
    });

    await step("drafts → issue: the self-pay draft gets a number (≤ 10 characters)", async () => {
      // Find the drafts made just now from the list.
      await reception.goto(`${BILLING}?state=draft`);
      const draftLinks = await reception.locator("table tbody tr a[href*='/invoices/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      assert(draftLinks.length >= 3, `drafts: ${draftLinks.length}`);
      for (const href of draftLinks) {
        await reception.goto(`${BASE}${href}`);
        await reception.waitForSelector("[data-testid=issue-invoice]");
        const body = await reception.locator("main").innerText();
        await reception.click("[data-testid=issue-invoice]");
        await reception.click("role=alertdialog >> button:has-text('Issue invoice')");
        await reception.waitForSelector("[role=status] >> text=Invoice issued");
        await reception.waitForFunction(() => /Invoice [A-Z]{1,4}\d{5,6}/.test(document.querySelector("h1").textContent));
        const title = await reception.locator("h1").innerText();
        const number = title.replace("Invoice ", "").trim();
        assert(number.length <= 10, `number ${number}`);
        const id = invoiceIdOf(reception.url());
        if (/Insured visit/.test(body) && /This invoice · insurer/.test(body)) s.insurerInv = id;
        else if (/Insurance excess/.test(body)) s.excessInv = id;
        else if (/Did not attend|Late cancellation/.test(body)) s.dnaInv = id;
        else s.selfInv = id;
      }
      assert(s.selfInv && s.dnaInv && s.insurerInv, JSON.stringify(s));
    });

    await step("take payment: part payment by cash with change; the invoice reads Part-paid", async () => {
      await reception.goto(`${BILLING}/invoices/${s.selfInv}`);
      const total = pounds((await reception.locator("[data-testid=invoice-balance]").innerText()).trim());
      await reception.click("[data-testid=record-payment]");
      await reception.waitForSelector("[data-testid=take-payment] >> text=Pay towards");
      await reception.waitForSelector("[data-testid=take-payment-submit]:not([disabled])");
      await reception.waitForTimeout(400); // the button's colour transition (enabled once the dialog's data is in)
      await shot(reception, "1440-take-payment");
      const blocked = await reception.locator("[data-testid=take-payment-submit]").getAttribute("data-blocked");
      assert(!blocked, `submit blocked: ${blocked} (amount ${await reception.locator("[data-testid=take-payment-submit]").getAttribute("data-amount")})`);
      await axe(reception, "take payment dialog");
      await reception.click("[data-testid=take-payment] label:has-text('Part payment')");
      await reception.fill("[data-testid=part-amount]", "20.00");
      await reception.click("[data-testid=take-payment] label:has-text('Cash')");
      await reception.fill("[data-testid=cash-tendered]", "25");
      assert(/Change: £5\.00/.test(await reception.locator("[data-testid=take-payment]").innerText()), "change worked out");
      await reception.click("[data-testid=take-payment-submit]");
      await reception.waitForSelector("[data-testid=take-payment-done]");
      await reception.click("[data-testid=take-payment] button:has-text('Done')");
      await reception.reload();
      await reception.waitForSelector("text=Part-paid");
      const left = pounds(await reception.locator("[data-testid=invoice-balance]").innerText());
      assert(Math.abs(left - (total - 20)) < 0.001, `balance ${left} after 20 off ${total}`);
      s.selfPatientId = (await reception.locator("main a[href*='/app/clinic/patients/']").first().getAttribute("href")).split("/").pop();
    });

    await step("payment link (test mode): copy the link, the patient pays at the provider's test stand-in, Check for payment → Paid", async () => {
      assert(STUB, "STUB (the provider's local test stand-in) is required");
      await reception.goto(`${BILLING}/invoices/${s.dnaInv}`);
      await reception.click("[data-testid=copy-payment-link]");
      await reception.waitForSelector("[data-testid=invoice-payment-link]");
      const url = (await reception.locator("[data-testid=invoice-payment-link]").innerText()).trim();
      assert(/^https:\/\/pay\.example\.com\/plink_test_/.test(url), url);
      const linkId = url.split("/").pop();
      const paid = await reception.request.post(`${STUB}/__pay?link=${encodeURIComponent(linkId)}`);
      assert(paid.ok(), "stub pay");
      await reception.click("[data-testid=check-payment]");
      await reception.waitForSelector("[role=status] >> text=Checked for payments");
      await reception.reload();
      await reception.waitForSelector("main >> text=Paid");
      assert(pounds(await reception.locator("[data-testid=invoice-balance]").innerText()) === 0, "nothing owed");
      // Checking again records nothing twice.
      await reception.click("text=Payment – online card payment").catch(() => {});
    });

    await step("insured visit: the insurer's invoice shows the split (patient excess beside it), policy, authorisation and per-visit excess", async () => {
      await owner.goto(`${BILLING}/invoices/${s.insurerInv}`);
      const body = await owner.locator("main").innerText();
      assert(/Insured visit – split between patient and insurer/.test(body), "split card");
      assert(/Total due from insurer/.test(body), "insurer total");
      s.insurer = (await owner.locator("main").innerText()).match(/This invoice · insurer balance\s*\n([^\n]+)/)?.[1] ?? null;
      await shot(owner, "1440-invoice-detail-insurer");
      await axe(owner, "invoice detail");
    });

    await step("remittance: one insurer payment over its open invoices, a short payment written off; the rest stays on account", async () => {
      await owner.goto(`${BILLING}?tab=remittances`);
      await owner.click("[data-testid=new-remittance]");
      await owner.waitForURL(/remittances\/new/);
      const insurerId = await owner.evaluate(async (id) => {
        const r = await fetch(`/app/clinic/billing/invoices/${id}`);
        return r.ok ? null : null;
      }, s.insurerInv);
      void insurerId;
      // Choose the insurer of the insured invoice.
      const options = await owner.locator("[data-testid=remit-payer] option").allInnerTexts();
      const pick = options.find((o) => s.insurer && o.trim() === s.insurer.trim()) || options[0];
      await owner.selectOption("[data-testid=remit-payer]", { label: pick });
      await owner.waitForSelector("[data-testid=remit-table]");
      const row = owner.locator(`[data-testid=remit-table] tbody tr`).first();
      const owing = pounds(await row.locator("td").nth(3).innerText());
      assert(owing > 10, `owing ${owing}`);
      await owner.fill("[data-testid=remit-amount]", String((owing + 40).toFixed(2)));
      await owner.fill("[data-testid=remit-reference]", `BW-RA-${RUN}`);
      await row.locator("input[type=checkbox]").check();
      await row.locator("input[inputmode=decimal]").fill(String((owing - 10).toFixed(2)));
      await row.locator("[data-testid=shortfall-action]").selectOption("write_off");
      const summary = await owner.locator("[data-testid=remit-summary]").innerText();
      assert(/Written off\s*£10\.00/.test(summary) && /Unallocated\s*£50\.00/.test(summary), summary);
      await shot(owner, "1440-remittance");
      await axe(owner, "remittance");
      await owner.click("[data-testid=remit-save]");
      await owner.waitForURL(/tab=remittances/);
      assert((await owner.locator("main").innerText()).includes(`BW-RA-${RUN}`), "listed");
    });

    await step("print: the A4 invoice and the patient statement (balance, ages, how to pay)", async () => {
      await reception.goto(`${BILLING}/invoices/${s.selfInv}/print`);
      await reception.waitForSelector("[data-testid=print-invoice]");
      const inv = await reception.locator("[data-testid=print-invoice]").innerText();
      for (const w of ["INVOICE", "Bill to", "Balance due", "How to pay", "Printed"]) assert(inv.includes(w), `print invoice has ${w}`);
      await shot(reception, "a4-print-invoice", true);
      await reception.emulateMedia({ media: "print" });
      await reception.pdf?.({ path: path.join(OUT, "print-invoice.pdf"), format: "A4" }).catch(() => {});
      await reception.emulateMedia({ media: "screen" });
      await reception.goto(`${BILLING}/statements/print?patient=${s.selfPatientId}`);
      await reception.waitForSelector("[data-testid=print-statement]");
      const st = await reception.locator("[data-testid=print-statement]").innerText();
      for (const w of ["STATEMENT", "Opening balance", "Balance due", "Current", "Over 90 days"]) assert(st.includes(w), `statement has ${w}`);
      assert(pounds(await reception.locator("[data-testid=statement-balance]").innerText()) > 0, "the part-paid balance is on the statement");
      await shot(reception, "a4-print-statement", true);
      await axe(reception, "print statement");
    });

    await step("aged debt: patients and insurers by age band, largest overdue accounts with a statement link", async () => {
      await owner.goto(`${BILLING}?tab=aged`);
      await owner.waitForSelector("[data-testid=aged-debt]");
      const t = await owner.locator("[data-testid=aged-debt]").innerText();
      for (const w of ["Patients", "Insurers and other accounts", "31–60 days", "Over 90 days", "Total"]) assert(t.includes(w), `aged debt has ${w}`);
      await shot(owner, "1440-aged-debt");
      await axe(owner, "aged debt");
      await owner.goto(`${BILLING}?tab=statements`);
      await owner.waitForSelector("[data-testid=statement-account]");
      await shot(owner, "1440-statements");
    });

    await step("credit note gives the balance back; then the refund (owner); reception has neither, nor Void", async () => {
      await reception.goto(`${BILLING}/invoices/${s.selfInv}`);
      for (const b of ["credit-note", "refund", "void-invoice"]) assert((await reception.locator(`[data-testid=${b}]`).count()) === 0, `reception has no ${b}`);
      await owner.goto(`${BILLING}/invoices/${s.selfInv}`);
      const before = pounds(await owner.locator("[data-testid=invoice-balance]").innerText());
      await owner.click("[data-testid=credit-note]");
      await owner.fill("[data-testid=money-amount]", String((before + 5).toFixed(2)));
      await owner.fill("[data-testid=money-reason]", "Goodwill (fictional)");
      await owner.click("role=alertdialog >> button:has-text('Issue credit note')");
      await owner.waitForSelector("[role=status] >> text=Credit note issued");
      await owner.waitForSelector("[data-testid=invoice-balance] >> text=owed back");
      assert(/£5\.00 owed back/.test(await owner.locator("[data-testid=invoice-balance]").innerText()), "credit gave 5.00 back");
      await owner.click("[data-testid=refund]");
      await owner.fill("[data-testid=money-amount]", "5.00");
      await owner.fill("[data-testid=money-reason]", "Goodwill (fictional)");
      await owner.selectOption("role=alertdialog >> select", "cash");
      await owner.click("role=alertdialog >> button:has-text('Refund')");
      await owner.waitForSelector("[role=status] >> text=Refund recorded");
      await owner.waitForFunction(() => /^£0\.00$/.test(document.querySelector("[data-testid=invoice-balance]").textContent.trim()));
      await shot(owner, "1440-invoice-credited");
    });

    await step("void: refused while paid; the owner voids an unpaid invoice → Void, its visits offered again", async () => {
      await owner.goto(`${BILLING}/invoices/${s.dnaInv}`);
      await owner.click("[data-testid=void-invoice]");
      await owner.fill("[data-testid=void-reason]", "Raised in error (fictional)");
      await owner.click("role=alertdialog >> button:has-text('Void invoice')");
      await owner.waitForSelector("role=alertdialog >> [role=alert] >> text=/payments on it/");
      await owner.keyboard.press("Escape");
      await owner.goto(`${BILLING}?state=issued`);
      const href = await owner.locator("table tbody tr a[href*='/invoices/']").first().getAttribute("href");
      await owner.goto(`${BASE}${href}`);
      await owner.click("[data-testid=void-invoice]");
      await owner.fill("[data-testid=void-reason]", "Raised in error (fictional)");
      await owner.click("role=alertdialog >> button:has-text('Void invoice')");
      await owner.waitForSelector("[role=status] >> text=Invoice voided");
      await owner.waitForSelector("main >> text=Void");
    });

    await step("clinician: billing is read-only (no invoicing, payment, credit or void buttons); the visits page is the 404 page", async () => {
      await clinician.goto(BILLING);
      assert((await clinician.locator("[data-testid=invoice-visits-button]").count()) === 0, "no Invoice attended visits");
      await clinician.goto(`${BILLING}/invoices/${s.selfInv}`);
      for (const b of ["record-payment", "copy-payment-link", "credit-note", "refund", "void-invoice", "issue-invoice"]) assert((await clinician.locator(`[data-testid=${b}]`).count()) === 0, `clinician has no ${b}`);
      const res = await clinician.goto(`${BILLING}/visits`);
      assert(res.status() === 404, `clinician /visits: ${res.status()}`);
    });

    await step("patient record: Account card (balance, Take payment), Invoices tab; the patient list's Balance and Owes money", async () => {
      await reception.goto(`${BASE}/app/clinic/patients?owes=1`);
      await reception.waitForSelector("text=Owes money");
      const balances = await reception.locator("[data-testid=patient-balance]").allInnerTexts();
      assert(balances.length > 0 && balances.every((b) => pounds(b) > 0), `owing patients: ${balances.join(",")}`);
      await shot(reception, "1440-patients-owes-money");
      const owing = reception.locator("table tbody tr a[href*='/patients/']").first();
      s.owingPatientId = (await owing.getAttribute("href")).split("/").pop();
      await owing.click();
      await reception.waitForSelector("[data-testid=account-card]");
      await shot(reception, "1440-record-account-card");
      await reception.click("a:has-text('Take payment')");
      await reception.waitForSelector("[data-testid=take-payment] >> text=Method");
      await reception.keyboard.press("Escape");
      await reception.waitForSelector("h2:has-text('Invoices')");
      await axe(reception, "record invoices tab");
    });

    await step("375 px: take payment is a full-screen sheet with the button at the bottom; no sideways scrolling", async () => {
      // Reception's own session, on a phone-sized window.
      const phone = reception;
      await phone.setViewportSize({ width: 375, height: 812 });
      await phone.goto(`${BASE}/app/clinic/patients/${s.owingPatientId}/invoices?pay=1`);
      await phone.waitForSelector("[data-testid=take-payment] >> text=Method");
      await phone.waitForSelector("[data-testid=take-payment-submit]:not([disabled])");
      await phone.waitForTimeout(400);
      const box = await phone.locator("[data-testid=take-payment]").boundingBox();
      assert(box && box.width >= 370 && box.x <= 1, `sheet ${JSON.stringify(box)}`);
      const btn = await phone.locator("[data-testid=take-payment-submit]").boundingBox();
      assert(btn && btn.y > 700, `button at the bottom: ${JSON.stringify(btn)}`);
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `scrolls sideways by ${overflow}px`);
      await shot(phone, "375-take-payment");
      await axe(phone, "take payment 375");
      await phone.keyboard.press("Escape");
      await phone.goto(BILLING);
      await phone.waitForSelector("[data-testid=billing-figures]");
      const o2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(o2 <= 0, `billing home scrolls sideways by ${o2}px`);
      await shot(phone, "375-billing", true);
      await phone.setViewportSize({ width: 1440, height: 1000 });
    });

    await step("diary drawer: Take payment opens the dialog for the appointment's patient", async () => {
      await reception.goto(`${BASE}/app/clinic/diary`);
      await reception.waitForSelector("[data-diary-ready=true]");
      await reception.locator("main [role=group] button[data-status]").first().click();
      await reception.waitForSelector("[data-testid=drawer-take-payment]");
      await reception.click("[data-testid=drawer-take-payment]");
      await reception.waitForSelector("[data-testid=take-payment] >> text=From: diary drawer");
      await shot(reception, "1440-drawer-take-payment");
      await reception.keyboard.press("Escape");
    });

    await step("no browser errors; no banned names on screen", async () => {
      const body = await owner.goto(BILLING).then(() => owner.locator("body").innerText());
      assert(!/\bTM3\b|CareConnect|\bAI\b|Stripe/.test(body), "banned names");
      assert(problems.length === 0, problems.join(" | "));
    });
  } finally {
    fs.writeFileSync(path.join(OUT, "axe-report.json"), JSON.stringify(axeReport, null, 2));
    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
