// LIVE mode: passcode typed into the UI (read from .env.local, never printed).
const L = require("./lib.cjs");
const F = require("./flows.cjs");
const fs = require("fs");
const env = fs.readFileSync(require("path").resolve(__dirname, "../../.env.local"), "utf8");
const PASS = (env.match(/^MEDREPORT_LIVE_PASSCODE=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
(async () => {
  const { ctx, page, problems, net } = await L.open({ profile: "live", fresh: true });
  await L.step("L0 health reports live available", async () => {
    const h = await (await fetch(`${L.BASE}/api/reports/v1/health`)).json();
    console.log("   health:", JSON.stringify({ aiMode: h.aiMode, liveAiAvailable: h.liveAiAvailable }));
  });
  await L.step("L1 enter passcode in the UI", async () => {
    await page.goto(`${L.BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^Drafting mode:/ }).click();
    await page.locator("#medreport-passcode").fill(PASS);
    await page.locator("#medreport-passcode").press("Enter");
    await page.waitForTimeout(800);
    await L.shot(page, "l-01-passcode", false);
    await page.keyboard.press("Escape");
    console.log("   badge:", await page.getByRole("button", { name: /^Drafting mode:/ }).innerText());
  });
  await L.step("L2 live analysis of Meridian", async () => {
    await page.goto(`${L.BASE}/reports/forms`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Upload a referrer form" }).first().click();
    await page.locator("[role=dialog] input[type=file]").setInputFiles(`${L.SP}/demo-forms/Meridian-Claims_Physiotherapy-Discharge-Report_MCS-PDR-3.docx`);
    await page.getByRole("button", { name: /^Analyse form$/ }).click();
    const t = Date.now();
    await page.waitForFunction(() => /Review the mapping|could not be analysed|Try again/.test(document.querySelector("[role=dialog]")?.textContent || ""), null, { timeout: 120000 });
    console.log("   analysis ended after", Date.now() - t, "ms");
    console.log("   dialog:", (await page.locator("[role=dialog]").innerText()).replace(/\n+/g, " | ").slice(0, 900));
    await L.shot(page, "l-02-analysis", false);
  });
  await L.step("L3 live drafting for Megan on Harrow & Pike", async () => {
    await page.keyboard.press("Escape");
    const app = await F.launch(ctx, page, "sim-pat-001");
    await app.getByRole("button", { name: "Choose the referrer form" }).click();
    await app.getByRole("radio", { name: /Harrow & Pike/ }).click();
    const t = Date.now();
    await app.getByRole("button", { name: "Complete this form" }).click();
    await app.waitForFunction(() => /Ready for clinician review|could not be drafted|left for the clinician/i.test(document.body.innerText), null, { timeout: 180000 });
    console.log("   drafting ended after", Date.now() - t, "ms");
    await app.waitForTimeout(1500);
    console.log("   step4:", (await app.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 1200));
    await L.shot(app, "l-03-drafting", false);
  });
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
