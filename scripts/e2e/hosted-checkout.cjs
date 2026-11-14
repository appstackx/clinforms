/**
 * The payment provider's hosted payment page (TEST mode), shared by the brand journeys (journey-clindesk-only,
 * journey-clinforms-only, journey-edge-brands). Same approach as billing-subscriptions.cjs (fix/billing-e2e-checkout,
 * 14/11/2026) and the trial journey (13/11/2026): the page's payment-method list and its fields may sit in frames now,
 * so the method row is chosen in whichever frame holds it and every field is filled wherever it is. The old fixed ids
 * (#cardNumber, #billingName …) are still tried first. Fictional data only; nothing here reads or prints a key.
 *
 *   const { payByCard } = require("./hosted-checkout.cjs");
 *   await payByCard(page, { email: OWNER, name: "Dana Lark (fictional)" });          // choose card, fill, pay
 *   const frame = await chooseCard(page); …; await fillCard(frame); await fillCommon(page, …); await submitPayment(page);
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const CARD_SEL = "#cardNumber, input[name=cardnumber], input[name=number], input[autocomplete='cc-number']";
const EXPIRY_SEL = "#cardExpiry, input[name=exp-date], input[name=expiry], input[autocomplete='cc-exp']";
const CVC_SEL = "#cardCvc, input[name=cvc], input[autocomplete='cc-csc']";

/** The first visible match in the page or any of its frames (null when none). */
async function firstVisible(page, make) {
  for (const f of page.frames()) {
    const l = make(f).first();
    if (await l.isVisible().catch(() => false)) return l;
  }
  return null;
}

/** The frame (or the page's main frame) that shows `fieldSel`, or null. */
async function frameWith(page, fieldSel) {
  for (const f of page.frames()) if (await f.locator(fieldSel).first().isVisible().catch(() => false)) return f;
  return null;
}

/**
 * Choose the card method (when several are offered) and return the frame that holds the card fields. `notesFile`
 * (optional) records which controls were tried, for a failed run.
 */
async function chooseCard(page, { notesFile } = {}) {
  const method = "card";
  const label = "Card";
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const button = page.locator(`[data-testid=${method}-accordion-item-button]`);
  if (await button.count()) await button.dispatchEvent("click");
  await page.getByText(/Pay and subscribe|Subscribe|Pay/).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const notes = [];
  for (let attempt = 0; attempt < 3 && !(await frameWith(page, CARD_SEL)); attempt++) {
    for (const frame of page.frames()) {
      const tries = [frame.locator(`[data-testid=${method}-accordion-item-button]`), frame.locator(`input[type=radio][value=${method}]`), frame.getByRole("radio", { name: label }), frame.getByText(label, { exact: true })];
      for (const c of tries) {
        const n = await c.count().catch(() => 0);
        notes.push(`${frame.url().slice(0, 60)} ${n}`);
        if (!n) continue;
        await c.first().click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
        if (await frameWith(page, CARD_SEL)) break;
      }
      if (await frameWith(page, CARD_SEL)) break;
    }
  }
  if (notesFile) fs.writeFileSync(notesFile, notes.join("\n"));
  const f = await frameWith(page, CARD_SEL);
  assert(f, "the card fields did not show on the payment page");
  return f;
}

/** The test card 4242 … 12/34 … 123 into the frame chooseCard returned. */
async function fillCard(frame) {
  await frame.locator(CARD_SEL).first().fill("4242424242424242");
  await frame.locator(EXPIRY_SEL).first().fill("12 / 34");
  await frame.locator(CVC_SEL).first().fill("123");
}

/** Email, name, country and address: wherever the page puts them (main page or a frame); only empty fields. */
async function fillCommon(page, { email, name }) {
  if (email) {
    const em = await firstVisible(page, (f) => f.locator("#email, input[type=email], input[autocomplete=email]"));
    if (em && (await em.isEditable().catch(() => false)) && !(await em.inputValue().catch(() => ""))) await em.fill(email);
  }
  // Inside the payment frame the fields go by name, with "billing …" autocomplete tokens (matched with ~=).
  const billingName = await firstVisible(page, (f) => f.locator("#billingName, input[name=name], input[autocomplete~='cc-name'], input[autocomplete~=name]"));
  if (billingName && !(await billingName.inputValue().catch(() => ""))) await billingName.fill(name);
  const country = await firstVisible(page, (f) => f.locator("#billingCountry, select[name=country], select[autocomplete~=country]"));
  if (country) await country.selectOption("GB").catch(() => {});
  for (const [sel, v] of [
    ["#billingAddressLine1, input[name=addressLine1], input[autocomplete~='address-line1']", "1 Test Street (fictional)"],
    ["#billingLocality, input[name=locality], input[autocomplete~='address-level2']", "Milton Keynes"],
    ["#billingPostalCode, input[name=postalCode], input[autocomplete~='postal-code']", "MK9 9ZZ"],
  ]) {
    const f = await firstVisible(page, (fr) => fr.locator(sel));
    if (f && !(await f.inputValue().catch(() => ""))) {
      await f.fill(v);
      // The address line opens a suggestions list over the next fields: close it.
      await f.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

/** The pay button, wherever it is (by test id, else by its name). */
async function submitPayment(page) {
  const pay = await firstVisible(page, (f) => f.locator("button[data-testid=hosted-payment-submit-button], button[data-testid=payment-form-submit-button], button.SubmitButton"));
  if (pay) return pay.click();
  const byName = await firstVisible(page, (f) => f.getByRole("button", { name: /Pay and subscribe|Subscribe|^Pay/ }));
  assert(byName, "no pay button found on the payment page");
  await byName.click();
}

/** Choose card, fill the test card and the billing details, press pay. */
async function payByCard(page, { email, name, notesFile } = {}) {
  const frame = await chooseCard(page, { notesFile });
  await fillCard(frame);
  await fillCommon(page, { email, name });
  await submitPayment(page);
}

module.exports = { CARD_SEL, chooseCard, fillCard, fillCommon, submitPayment, payByCard, firstVisible, frameWith };
