const L = require("./lib.cjs");
// Shared review helpers
async function launch(ctx, page, patientId) {
  await page.goto(`${L.BASE}/pms-sandbox/patients/${patientId}`);
  await page.waitForLoadState("networkidle");
  const [popup] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("button", { name: /Complete referrer's report form/ }).click()]);
  await popup.getByText(/Imported from Simulated TM3/).waitFor({ timeout: 30000 });
  return popup;
}
async function chooseAndGenerate(app, formName) {
  await app.getByRole("button", { name: "Choose the referrer form" }).click();
  await app.waitForTimeout(500);
  const radio = app.getByRole("radio", { name: formName });
  const pre = await radio.getAttribute("aria-checked");
  await radio.click();
  const t = Date.now();
  await app.getByRole("button", { name: "Complete this form" }).click();
  await app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 120000 });
  await app.locator("[id^='q-F-']").first().waitFor({ timeout: 20000 });
  await app.waitForTimeout(1500);
  return { preselected: pre, ms: Date.now() - t, url: app.url() };
}
async function addOwn(app, k, text) {
  const card = app.locator(`#q-${k}`);
  const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
  if (await add.count()) { await add.click(); await app.waitForTimeout(200); }
  await card.locator("textarea").last().fill(text);
  await card.locator("h3").first().click();
  await app.waitForTimeout(400);
}
async function resolveAll(app, keys) {
  // One-click "Mark resolved" when a person answered; "Resolve" with own words for other gaps; an
  // unanswered OPINION gap can only be acknowledged with a reason (never "resolved" by the draft).
  for (const key of keys) {
    const card = app.locator(`#q-${key}`);
    let guard = 0;
    while (guard++ < 6) {
      const quick = card.getByRole("button", { name: "Mark resolved" });
      if ((await quick.count()) && !(await card.locator("form").count())) {
        await quick.first().click();
        await app.waitForTimeout(400);
        continue;
      }
      const res = card.getByRole("button", { name: /^Resolve$/ });
      if (await res.count()) {
        await res.first().click();
        const ta = card.locator("form textarea").last();
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
        await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
        await app.waitForTimeout(400);
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await ack.first().click();
        await card.locator("form textarea").last().fill("No opinion on this was formed at discharge; the form is returned without one.");
        await card.locator("form").getByRole("button", { name: "Acknowledge" }).click();
        await app.waitForTimeout(400);
        continue;
      }
      break;
    }
  }
}
async function ownVoice(app, shotName) {
  const btn = app.getByRole("button", { name: "Write in my own voice" });
  if (!(await btn.count())) return 0;
  const title = await app.locator("text=/answers? describes?/").first().innerText().catch(() => "");
  if (shotName) await L.shot(app, shotName, false);
  await btn.click();
  await app.waitForTimeout(800);
  return title;
}
async function flagsText(app) {
  await app.getByRole("tab", { name: /Flags/ }).click();
  await app.waitForTimeout(500);
  return (await app.locator("[role=tabpanel][data-state=active]").first().innerText()).replace(/\n+/g, " | ");
}
async function approve(app, shotName) {
  await app.getByRole("button", { name: /^Approve/ }).first().click();
  const dlg = app.getByRole("dialog");
  await dlg.waitFor();
  await app.waitForTimeout(300);
  const name = dlg.getByLabel("Full name", { exact: true });
  if (!(await name.inputValue())) await name.fill("Tom Ellis");
  const hcpc = dlg.getByLabel("HCPC registration number");
  if (!(await hcpc.inputValue())) await hcpc.fill("PH-DEMO-02");
  await dlg.getByLabel(/Typed signature/).fill(await name.inputValue());
  const boxes = dlg.locator("input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  if (shotName) await L.shot(app, shotName, false);
  await dlg.getByRole("button", { name: /Approve and sign/ }).click();
  await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 20000 });
  await app.waitForTimeout(1000);
}
async function download(app, buttonName, out) {
  const [d] = await Promise.all([app.waitForEvent("download", { timeout: 90000 }), app.getByRole("button", { name: buttonName }).click()]);
  await d.saveAs(L.path.join(L.OUT, out));
  return d.suggestedFilename();
}
async function reportJson(app) {
  const id = decodeURIComponent(app.url().split("/reports/")[1].split("?")[0]);
  return app.evaluate((id) => JSON.parse(localStorage.getItem("medreport.report." + id) || "null"), id);
}
module.exports = { launch, chooseAndGenerate, addOwn, resolveAll, ownVoice, flagsText, approve, download, reportJson };
