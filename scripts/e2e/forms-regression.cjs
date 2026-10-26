/**
 * Referrer-form regression in the public demo (run against two builds and compare the downloads):
 * upload + confirm the two unmapped samples (Ashcroft flat PDF – pre-written map; Meridian Word – recorded
 * analysis), then complete, approve (Sarah Reid, PH-DEMO-01) and download:
 *   R1 Megan Hart × Harrow & Pike (Word)          R2 Megan Hart × Northfield (fillable PDF)
 *   R3 Daniel Brooks × Kingsway (Word)            R4 Megan Hart × Ashcroft (flat PDF)
 *   R5 Megan Hart × Meridian (Word, uploaded)
 * Word forms download as Word only (Word → PDF needs LibreOffice, not installed on this machine).
 * Downloads go to $E2E_OUT/final-outputs; compare two runs with scripts/e2e/compare-form-outputs.ts.
 *
 *   PORT=3160 MEDREPORT_AI_MODE=demo npm run start   # in the checkout under test
 *   BASE=http://localhost:3160 E2E_OUT=/tmp/run-a NODE_PATH=<node_modules with playwright> node scripts/e2e/forms-regression.cjs
 */
const L = require("./lib.cjs");
const F = require("./flows.cjs");

const SIGNER = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };
const KEYS = (n) => Array.from({ length: n }, (_, i) => `F-${String(i + 1).padStart(2, "0")}`);

/**
 * Approve as the clinician the report was launched for (prefilled; the demo session is bound to them –
 * Sarah Reid for Megan Hart, Tom Ellis for Daniel Brooks), else Sarah Reid. Returns who signed.
 */
async function approveAs(app, shotName) {
  await app.getByRole("button", { name: /^Approve/ }).first().click();
  const dlg = app.getByRole("dialog");
  await dlg.waitFor();
  await app.waitForTimeout(300);
  const name = dlg.getByLabel("Full name", { exact: true });
  const hcpc = dlg.getByLabel("HCPC registration number");
  if (!(await name.inputValue())) await name.fill(SIGNER.name);
  if (!(await hcpc.inputValue())) await hcpc.fill(SIGNER.hcpc);
  const signer = `${await name.inputValue()} (${await hcpc.inputValue()})`;
  await dlg.getByLabel(/Typed signature/).fill(await name.inputValue());
  const boxes = dlg.locator("input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  if (shotName) await L.shot(app, shotName, false);
  await dlg.getByRole("button", { name: /Approve and sign/ }).click();
  await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 30000 });
  await app.waitForTimeout(1000);
  console.log("   approved by", signer);
  return signer;
}

/** Answer what still blocks approval: choices take their first option, other questions the clinician's own words. */
async function answerBlockers(app, text) {
  for (let round = 0; round < 3; round++) {
    const flags = await F.flagsText(app);
    const keys = Array.from(new Set((flags.match(/(?:Missing field|Required – no answer yet|Required – needs your opinion|Optional, but must be filled in) \| \(blocks approval\) \| (F-\d+)/g) ?? []).map((m) => m.match(/F-\d+/)[0])));
    if (keys.length === 0) return;
    for (const k of keys) {
      const card = app.locator(`#q-${k}`);
      const radios = card.locator("input[type=radio]");
      if ((await radios.count()) > 0) await radios.first().check();
      else await F.addOwn(app, k, text);
    }
  }
}

async function nothingBlocks(app) {
  await app.waitForTimeout(800);
  const f = await F.flagsText(app);
  if (!/Nothing blocks approval/.test(f)) console.log("   flags:", f.slice(0, 1200));
  L.assert(/Nothing blocks approval/.test(f), "nothing blocks approval");
}

async function confirmMapping(page) {
  await page.getByRole("button", { name: /^Confirm mapping$/ }).first().click();
  await page.locator("#confirm-by").fill(SIGNER.name);
  await page.locator("[role=dialog] input[type=checkbox], [role=dialog] button[role=checkbox]").first().click();
  await page.locator("[role=dialog]").getByRole("button", { name: /Confirm mapping/ }).click();
  await page.getByText(new RegExp(`Mapping confirmed by ${SIGNER.name}`)).waitFor({ timeout: 10000 });
  await page.waitForTimeout(1000); // let the "Use for a patient" link's prefetch finish before leaving the page
}

/**
 * bh2-rc1 (WE, map lint L5): a judgement question whose answer comes from the record holds up the confirm until the
 * clinician answers it themselves or someone allowed to accepts it with a reason. The bundled Meridian sample has
 * two (F-08 daily activities, F-11 reason for discharge – both facts the record holds): accepted here with that
 * reason, as a demo visitor would. Returns the ids accepted.
 */
async function acceptJudgementChecks(page, ids, reason) {
  const done = [];
  for (const id of ids) {
    const row = page.locator("li").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${id}$`) }) }).first();
    if (!(await row.count())) continue;
    const toggle = row.locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const group = page.locator(`[role=group][aria-label="Checks for ${id}"]`);
    if (!(await group.count())) continue;
    const input = group.getByLabel("Or accept it as it is, because");
    if (!(await input.count())) continue;
    await input.fill(reason);
    await group.getByRole("button", { name: /^Accept$/ }).click();
    await group.getByText(/^Accepted – /).first().waitFor({ timeout: 10000 });
    done.push(id);
  }
  return done;
}

async function analyseSample(page, title) {
  await page.goto(`${L.BASE}/reports/forms`);
  await page.waitForLoadState("networkidle");
  const card = page.locator("h3", { hasText: title }).first().locator("xpath=ancestor::*[.//button[normalize-space()='Analyse this form']][1]");
  await card.getByRole("button", { name: "Analyse this form" }).click();
  await page.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 20000 });
  const t = Date.now();
  await page.getByRole("button", { name: /^Analyse form$/ }).click();
  await page.getByRole("button", { name: /Review the mapping/ }).waitFor({ timeout: 90000 });
  const dialog = (await page.locator("[role=dialog]").innerText()).replace(/\n+/g, " | ");
  await page.getByRole("button", { name: /Review the mapping/ }).click();
  await page.waitForURL(/\/reports\/forms\/.+/);
  return { ms: Date.now() - t, dialog };
}

(async () => {
  const { ctx, page, problems, net } = await L.open({ fresh: true, profile: `regression-${process.env.PFX || "x"}` });
  await L.step("R0a library: Ashcroft flat PDF → pre-written map → confirm", async () => {
    const r = await analyseSample(page, "Physiotherapy Update Report");
    console.log("   analysed in", r.ms, "ms:", r.dialog.slice(0, 300));
    await page.locator(".mr-preview canvas").first().waitFor({ timeout: 30000 });
    await confirmMapping(page);
  });
  await L.step("R0b library: Meridian Word form → recorded analysis → confirm", async () => {
    const r = await analyseSample(page, "Physiotherapy Discharge Report");
    console.log("   analysed in", r.ms, "ms:", r.dialog.slice(0, 300));
    await page.locator(".mr-preview section.docx").first().waitFor({ timeout: 30000 });
    const accepted = await acceptJudgementChecks(page, ["F-08", "F-11"], "Facts the record holds: the patient's own account and the discharge entry.");
    console.log("   judgement checks accepted (L5):", accepted.join(", ") || "none");
    await confirmMapping(page);
  });

  await L.step("R1 Megan Hart × Harrow & Pike (Word) → approve → Word", async () => {
    const app = await F.launch(ctx, page, "sim-pat-001");
    console.log("   generate:", JSON.stringify(await F.chooseAndGenerate(app, /Harrow & Pike/)));
    await app.locator("#q-F-13").getByLabel("Yes").check();
    await F.addOwn(app, "F-14", "In my opinion Ms Hart has made a good recovery. I expect the remaining intermittent neck ache to settle over the next three to six months with her home exercise programme.");
    await F.addOwn(app, "F-15", "In my opinion Ms Hart has no restrictions on work, domestic or leisure activities. She should continue to take regular breaks from prolonged sitting at the computer and from drives over 1 hour.");
    await F.addOwn(app, "F-16", "In my opinion no further physiotherapy is needed. She should continue her maintenance home exercise programme and return to the clinic or her GP if her symptoms increase.");
    const removeIt = app.locator("#q-F-15").getByRole("button", { name: "Remove it" });
    if (await removeIt.count()) await removeIt.click();
    await F.resolveAll(app, ["F-13", "F-14", "F-15", "F-16"]);
    await F.ownVoice(app, null);
    await nothingBlocks(app);
    await approveAs(app, "r1-approve");
    console.log("   word:", await F.download(app, "Completed form (Word)", "R1_megan-hart_harrow-pike_FINAL.docx"));
    await app.close();
  });

  await L.step("R2 Megan Hart × Northfield (fillable PDF) → approve → PDF", async () => {
    const app = await F.launch(ctx, page, "sim-pat-001");
    console.log("   generate:", JSON.stringify(await F.chooseAndGenerate(app, /Northfield Assurance/)));
    await F.addOwn(app, "F-12", "In my opinion Ms Hart has no functional limitations affecting work or daily activities. She should continue to take regular breaks from prolonged sitting and driving.");
    await app.locator("#q-F-13").getByLabel("Yes", { exact: true }).check();
    await F.addOwn(app, "F-17", "In my opinion the residual intermittent neck ache should settle within three to six months with her home exercise programme.");
    await F.addOwn(app, "F-01", "NA-PI-77310");
    await F.resolveAll(app, ["F-01", "F-12", "F-13", "F-14", "F-15", "F-16", "F-17"]);
    await F.ownVoice(app, null);
    await nothingBlocks(app);
    await approveAs(app, "r2-approve");
    console.log("   pdf:", await F.download(app, "Completed form (PDF)", "R2_megan-hart_northfield_FINAL.pdf"));
    await app.close();
  });

  await L.step("R3 Daniel Brooks × Kingsway (Word) → approve → Word", async () => {
    const app = await F.launch(ctx, page, "sim-pat-002");
    console.log("   generate:", JSON.stringify(await F.chooseAndGenerate(app, /Kingsway/)));
    await app.locator("#q-F-13").getByLabel("No", { exact: true }).check();
    const q5 = app.locator("#q-F-14").getByLabel(/^Yes, with the adjustments/);
    if ((await q5.count()) && !(await q5.isChecked())) await q5.check();
    await F.addOwn(app, "F-12", "At the final review on 22/09/2026 Mr Brooks could sit for over 1 hour and stand for over 2 hours without symptoms.");
    await F.resolveAll(app, ["F-01", "F-02", "F-10", "F-11", "F-12", "F-13", "F-14", "F-15", "F-16", "F-17", "F-18"]);
    await F.ownVoice(app, null);
    await nothingBlocks(app);
    await approveAs(app, "r3-approve");
    console.log("   word:", await F.download(app, "Completed form (Word)", "R3_daniel-brooks_kingsway_FINAL.docx"));
    await app.close();
  });

  await L.step("R4 Megan Hart × Ashcroft (flat PDF) → approve → PDF", async () => {
    const app = await F.launch(ctx, page, "sim-pat-001");
    console.log("   generate:", JSON.stringify(await F.chooseAndGenerate(app, /Ashcroft/)));
    await F.addOwn(app, "F-09", "In my opinion the residual intermittent neck ache should settle within three to six months with her home exercise programme.");
    const c2 = app.locator("#q-F-10");
    if (await c2.getByLabel("No", { exact: true }).count()) await c2.getByLabel("No", { exact: true }).check();
    await F.resolveAll(app, KEYS(16));
    await F.ownVoice(app, null);
    await nothingBlocks(app);
    await approveAs(app, "r4-approve");
    console.log("   pdf:", await F.download(app, "Completed form (PDF)", "R4_megan-hart_ashcroft_FINAL.pdf"));
    await app.close();
  });

  await L.step("R5 Megan Hart × Meridian (uploaded Word) → approve → Word", async () => {
    const app = await F.launch(ctx, page, "sim-pat-001");
    console.log("   generate:", JSON.stringify(await F.chooseAndGenerate(app, /Meridian/)));
    const keys = await app.locator("[id^='q-F-']").evaluateAll((els) => els.map((e) => e.id.slice(2)));
    await answerBlockers(app, "In my opinion Ms Hart has made a good recovery and needs no further physiotherapy.");
    await F.resolveAll(app, keys);
    await F.ownVoice(app, null);
    await nothingBlocks(app);
    await approveAs(app, "r5-approve");
    console.log("   word:", await F.download(app, "Completed form (Word)", "R5_megan-hart_meridian_FINAL.docx"));
    await app.close();
  });

  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  console.log("RESULTS:", JSON.stringify(L.results.map((r) => ({ name: r.name, ok: r.ok, ms: r.ms, err: r.err }))));
  await ctx.close();
  process.exit(L.results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
