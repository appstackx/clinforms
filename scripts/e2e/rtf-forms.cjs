/**
 * RTF referrer forms in the public demo, end to end (fictional fixtures in scripts/medreport/fixtures/rtf):
 *   for each RTF: upload → the dialog shows it as RTF converted to Word → Analyse → "Converted the RTF file
 *   to Word" + the conversion notes → the mapping screen's "Converted from RTF" note and the Word preview
 *   (no «merge» field left) → confirm the mapping (Sarah Reid);
 *   then complete the initial assessment and the mail-merge report for Megan Hart, answer what the record
 *   cannot, approve as Sarah Reid (PH-DEMO-01) and download the completed Word file.
 * Downloads: $E2E_OUT/final-outputs/RTF_*.docx (check them with a script; see the module README).
 *
 *   PORT=3160 MEDREPORT_AI_MODE=demo npm run start                     # demo: layout rules, no drafting calls
 *   BASE=http://localhost:3160 E2E_OUT=… NODE_PATH=<playwright> node scripts/e2e/rtf-forms.cjs
 * LIVE=1 (server in auto mode with the key and passcode in .env.local; the passcode is read, never printed):
 * live reading and live drafting. ONLY=initial limits the run to the initial assessment (fewest live calls).
 */
const L = require("./lib.cjs");
const F = require("./flows.cjs");

const FIX = L.path.join(__dirname, "../medreport/fixtures/rtf");
const ALL = [
  { key: "initial", file: "initial-assessment-report.rtf", referrer: "Larchfield Medico-Legal Services (fictional)", type: "mlc", title: /Larchfield Medico-Legal/, complete: "R1_megan-hart_initial-assessment" },
  { key: "progress", file: "progress-report-textedit.rtf", referrer: "Fernhill Case Management (fictional)", type: "case_manager", title: /Fernhill Case Management/ },
  { key: "merge", file: "mail-merge-report.rtf", referrer: "Wrenfield Reporting Partners (fictional)", type: "mlc", title: /Wrenfield Reporting Partners/, complete: "R2_megan-hart_mail-merge" },
  { key: "ticks", file: "tick-box-discharge.rtf", referrer: "Brookvale Rehabilitation (fictional)", type: "case_manager", title: /Brookvale Rehabilitation/ },
];
const RUN = process.env.ONLY ? ALL.filter((f) => process.env.ONLY.split(",").includes(f.key)) : ALL;
const timings = {};

/** Choose the form, complete it, and open the review (demo mode stops on a summary with "Open for review"). */
async function generate(app, formName) {
  await app.getByRole("button", { name: "Choose the referrer form" }).click();
  await app.waitForTimeout(500);
  await app.getByRole("radio", { name: formName }).click();
  const t = Date.now();
  await app.getByRole("button", { name: "Complete this form" }).click();
  const open = app.locator("a, button").filter({ hasText: /^Open for review$/ }).first();
  await Promise.race([app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 180000 }), open.waitFor({ timeout: 180000 })]);
  const summary = (await app.locator("main").innerText()).replace(/\n+/g, " | ");
  if (await open.count()) await open.click();
  await app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 60000 });
  await app.locator("[id^='q-F-']").first().waitFor({ timeout: 20000 });
  await app.waitForTimeout(1500);
  return { ms: Date.now() - t, summary: summary.slice(summary.indexOf("Completing"), summary.indexOf("Completing") + 900) };
}

async function answerBlockers(app, text) {
  for (let round = 0; round < 4; round++) {
    const flags = await F.flagsText(app);
    const keys = Array.from(new Set((flags.match(/(?:Missing field|Placeholder) \| \(blocks approval\) \| (F-\d+)/g) ?? []).map((m) => m.match(/F-\d+/)[0])));
    if (keys.length === 0) return;
    for (const k of keys) {
      const card = app.locator(`#q-${k}`);
      const radios = card.locator("input[type=radio]");
      const dateOrNumber = card.locator("input[placeholder='DD/MM/YYYY or N/A'], input[placeholder='Number or N/A']");
      if ((await radios.count()) > 0) await radios.first().check();
      else if ((await dateOrNumber.count()) > 0) {
        const input = dateOrNumber.first();
        await input.fill((await input.getAttribute("placeholder"))?.startsWith("DD") ? "18/03/2026" : "6");
        await input.press("Enter");
        await app.waitForTimeout(300);
      } else await F.addOwn(app, k, text(k));
    }
  }
}

(async () => {
  const { ctx, page, problems, net } = await L.open({ fresh: true, profile: `rtf-${process.env.PFX || "x"}` });
  for (const fx of RUN) {
    await L.step(`U-${fx.key} upload ${fx.file} → analyse → mapping note → confirm`, async () => {
      await page.goto(`${L.BASE}/reports/forms`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Upload a referrer form" }).first().click();
      const t0 = Date.now();
      await page.locator("[role=dialog] input[type=file]").setInputFiles(L.path.join(FIX, fx.file));
      await page.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 20000 });
      const converted = Date.now() - t0;
      const ready = await page.locator("[role=dialog]").innerText();
      L.assert(/\bRTF\b/.test(ready), "the file is shown as RTF");
      L.assert(new RegExp(fx.file.replace(/\./g, "\\.")).test(ready), "the original file name is kept");
      await page.locator("#upload-referrer").fill(fx.referrer);
      await page.locator("#upload-referrer-type").selectOption(fx.type);
      await L.shot(page, `rtf-${fx.key}-1-ready`, false);
      const t1 = Date.now();
      await page.getByRole("button", { name: /^Analyse form$/ }).click();
      await page.getByRole("button", { name: /Review the mapping/ }).waitFor({ timeout: 120000 });
      const analysed = Date.now() - t1;
      const dialog = (await page.locator("[role=dialog]").innerText()).replace(/\n+/g, " | ");
      console.log(`   converted+checked in ${converted} ms; analysed in ${analysed} ms`);
      console.log("   dialog:", dialog.slice(0, 1200));
      L.assert(/Converted the RTF file to Word/.test(dialog), "trace step shown");
      await L.shot(page, `rtf-${fx.key}-2-analysed`, false);
      await page.getByRole("button", { name: /Review the mapping/ }).click();
      await page.waitForURL(/\/reports\/forms\/.+/);
      await page.locator(".mr-preview section.docx").first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      const main = await page.locator("main").innerText();
      L.assert(/Converted from RTF/.test(main), "map screen note");
      const note = (await page.locator("text=Converted from RTF").first().locator("xpath=ancestor::*[self::div][2]").innerText()).replace(/\n+/g, " | ");
      console.log("   map note:", note.slice(0, 700));
      const preview = await page.locator(".mr-preview").first().innerText();
      L.assert(!/«|»|<<|>>|MERGEFIELD/.test(preview), "no merge field in the preview");
      L.assert(await page.getByRole("button", { name: "Download Word version" }).count(), "download button says Word version");
      const fields = await page.locator("[id^='field-F-'], button:has-text('F-0')").count();
      console.log("   questions on the map screen (approx.):", fields);
      await L.shot(page, `rtf-${fx.key}-3-mapping`);
      await page.getByRole("button", { name: /^Confirm mapping$/ }).first().click();
      await page.locator("#confirm-by").fill("Sarah Reid");
      await page.locator("[role=dialog] input[type=checkbox], [role=dialog] button[role=checkbox]").first().click();
      await page.locator("[role=dialog]").getByRole("button", { name: /Confirm mapping/ }).click();
      await page.getByText(/Mapping confirmed by Sarah Reid/).waitFor({ timeout: 10000 });
      await page.waitForTimeout(1000); // let the "Use for a patient" link's prefetch finish before leaving the page
      const map = await page.evaluate((name) => (JSON.parse(localStorage.getItem("medreport.forms") || "[]").find((f) => f.file.fileName === name) || null), fx.file);
      console.log(`   map: ${map.fields.length} questions, ${map.analysis.mode}, file ${map.file.fileName} ${map.file.mimeType.includes("word") ? "(Word)" : map.file.mimeType}`);
      timings[fx.key] = { converted, analysed, questions: map.fields.length, mode: map.analysis.mode };
    });
  }

  for (const fx of RUN.filter((f) => f.complete)) {
    await L.step(`C-${fx.key} Megan Hart × ${fx.file} → answer → approve → Word`, async () => {
      const app = await F.launch(ctx, page, "sim-pat-001");
      const t = Date.now();
      const r = await generate(app, fx.title);
      console.log(`   completed in ${r.ms} ms:`, r.summary);
      const rep = await F.reportJson(app);
      const filled = rep.sections.filter((s) => (s.paragraphs || []).some((p) => p.text.trim()) || (s.answer && s.answer.value !== null && s.answer.value !== undefined));
      console.log(`   ${filled.length}/${rep.sections.length} answered after drafting (${rep.sections.map((s) => s.paragraphs?.[0]?.origin ?? "-").join(",")})`);
      await answerBlockers(app, (k) => `Fictional answer for ${k}: Ms Hart's neck pain settled with treatment.`);
      const keys = await app.locator("[id^='q-F-']").evaluateAll((els) => els.map((e) => e.id.slice(2)));
      await F.resolveAll(app, keys);
      await app.waitForTimeout(800);
      const flags = await F.flagsText(app);
      if (!/Nothing blocks approval/.test(flags)) console.log("   flags:", flags.slice(0, 1500));
      L.assert(/Nothing blocks approval/.test(flags), "nothing blocks approval");
      await app.getByRole("tab", { name: "Preview" }).click();
      await app.locator("[role=tabpanel][data-state=active] section.docx").first().waitFor({ timeout: 30000 });
      await app.waitForTimeout(2000);
      await L.shot(app, `rtf-${fx.key}-4-preview`, false);
      await app.getByRole("button", { name: /^Approve/ }).first().click();
      const dlg = app.getByRole("dialog");
      await dlg.waitFor();
      const name = dlg.getByLabel("Full name", { exact: true });
      const hcpc = dlg.getByLabel("HCPC registration number");
      if (!(await name.inputValue())) await name.fill("Sarah Reid");
      if (!(await hcpc.inputValue())) await hcpc.fill("PH-DEMO-01");
      console.log("   approving as", await name.inputValue(), await hcpc.inputValue());
      await dlg.getByLabel(/Typed signature/).fill(await name.inputValue());
      const boxes = dlg.locator("input[type=checkbox]");
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
      await dlg.getByRole("button", { name: /Approve and sign/ }).click();
      await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 30000 });
      const word = await F.download(app, "Completed form (Word)", `${fx.complete}_FINAL.docx`);
      console.log("   word:", word, "· total", Date.now() - t, "ms");
      L.assert(/\.docx$/.test(word), "downloads as .docx");
      await L.shot(app, `rtf-${fx.key}-5-approved`, false);
      await app.close();
    });
  }
  console.log("TIMINGS:", JSON.stringify(timings));
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  console.log("RESULTS:", JSON.stringify(L.results.map((r) => ({ name: r.name, ok: r.ok, ms: r.ms, err: r.err }))));
  await ctx.close();
  process.exit(L.results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
