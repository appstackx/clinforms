/**
 * A clinic system's letter merge codes and large RTF templates in the public demo, end to end (10/2026; FICTIONAL
 * template scripts/medreport/fixtures/rtf/practice-codes-report.rtf – "Larkfield Rehabilitation Network
 * (fictional)" – that mimics TM3's <<P_…>> syntax; fictional patient Megan Hart, sim-pat-001):
 *
 *   B-big   an 8 MB RTF (the fixture plus a large picture) is accepted and converted in the browser;
 *   U-codes upload → analyse → "Matched the clinic system's merge codes to the record" → the map's questions are
 *           bound to the record (name parts, DOB, address lines, postcode, reference, clinician, date, clinic) and two
 *           are for staff → confirm (Sarah Reid);
 *   C-codes Megan Hart on the form → the record's values in place, empty address lines empty → staff enter what
 *           the record does not hold → approve (Sarah Reid, PH-DEMO-01) → the Word file holds the values and no
 *           merge code at all.
 *
 *   PORT=3171 MEDREPORT_AI_MODE=demo npm run start
 *   BASE=http://localhost:3171 E2E_OUT=… NODE_PATH=<playwright> node scripts/e2e/practice-codes.cjs
 */
const L = require("./lib.cjs");
const F = require("./flows.cjs");
const PizZip = require(L.path.join(__dirname, "../../node_modules/pizzip"));

const FIX = L.path.join(__dirname, "../medreport/fixtures/rtf/practice-codes-report.rtf");
const REFERRER = "Larkfield Rehabilitation Network (fictional)";

function bigRtf() {
  const src = L.fs.readFileSync(FIX, "latin1");
  const line = "89504e470d0a1a0a0000000d49484452".repeat(4) + "\r\n";
  const pict = `{\\pict\\pngblip\\picw100\\pich100 ${line.repeat(Math.ceil((8 * 1024 * 1024) / line.length))}}`;
  const out = L.path.join(L.SP, "practice-codes-with-logo.rtf");
  L.fs.writeFileSync(out, src.replace("\\pard\\plain\\f0\\fs28\\b ", `\\pard\\plain\\f0\\fs28 ${pict}\\par\\pard\\plain\\f0\\fs28\\b `), "latin1");
  return out;
}

async function openUpload(page, file) {
  await page.goto(`${L.BASE}/reports/forms`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Upload a referrer form" }).first().click();
  await page.locator("[role=dialog] input[type=file]").setInputFiles(file);
}

async function answerBlockers(app) {
  for (let round = 0; round < 5; round++) {
    const flags = await F.flagsText(app);
    const keys = Array.from(new Set((flags.match(/(?:Missing field|Placeholder|Merge field|Mail-merge field|Required – no answer yet|Required – needs your opinion|Optional, but must be filled in)[^|]*\| \(blocks approval\) \| (F-\d+)/g) ?? []).map((m) => m.match(/F-\d+/)[0])));
    if (keys.length === 0) return;
    for (const k of keys) await F.addOwn(app, k, `Entered by staff for ${k} (fictional)`);
  }
}

(async () => {
  const { ctx, page, problems, net } = await L.open({ fresh: true, profile: `codes-${process.env.PFX || "x"}` });

  await L.step("B-big an 8 MB RTF template with a large picture is accepted and converted in the browser", async () => {
    const file = bigRtf();
    const size = L.fs.statSync(file).size;
    L.assert(size > 8 * 1024 * 1024 && size < 12 * 1024 * 1024, `fixture is ${size} bytes`);
    const t = Date.now();
    await openUpload(page, file);
    await page.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 30000 });
    const dialog = await page.locator("[role=dialog]").innerText();
    console.log(`   converted ${(size / 1048576).toFixed(1)} MB in ${Date.now() - t} ms`);
    L.assert(/\bRTF\b/.test(dialog), "shown as RTF converted to Word");
    L.assert(!/limit is|could not be converted/.test(dialog), "no size refusal");
    await page.keyboard.press("Escape");
  });

  await L.step("U-codes upload → analyse → merge codes matched to the record → confirm", async () => {
    await openUpload(page, FIX);
    await page.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 20000 });
    await page.locator("#upload-referrer").fill(REFERRER);
    await page.locator("#upload-referrer-type").selectOption("mlc");
    await page.getByRole("button", { name: /^Analyse form$/ }).click();
    await page.getByRole("button", { name: /Review the mapping/ }).waitFor({ timeout: 120000 });
    const dialog = (await page.locator("[role=dialog]").innerText()).replace(/\n+/g, " | ");
    console.log("   dialog:", dialog.slice(0, 900));
    L.assert(/Matched the clinic system's merge codes to the record/.test(dialog), "trace step shown");
    await page.getByRole("button", { name: /Review the mapping/ }).click();
    await page.waitForURL(/\/reports\/forms\/.+/);
    await page.locator(".mr-preview section.docx").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const map = await page.evaluate(() => (JSON.parse(localStorage.getItem("medreport.forms") || "[]").find((f) => f.file.fileName === "practice-codes-report.rtf") || null));
    L.assert(map, "the map is stored");
    const bound = (code) => map.fields.find((f) => f.anchor.kind === "docx" && f.anchor.placeholderText === code);
    const path = (code) => (bound(code)?.fillSource.kind === "registration" ? bound(code).fillSource.path : bound(code)?.fillSource.kind);
    for (const [code, want] of [
      ["<<P_GROUPREF>>", "referral.reference"],
      ["<<P_TITLE>>", "patient.title"],
      ["<<P_SURNAME>>", "patient.lastName"],
      ["<<P_DOB>>", "patient.dob"],
      ["<<P_ADDRESS2>>", "patient.addressLines"],
      ["<<P_POSTCODE>>", "patient.postcode"],
      ["<<P_ALTERNATE_REF1>>", "incident.date"],
      ["<<P_HOSP_NUM>>", "staff.entry"],
      ["<<P_CONSNAME>>", "clinician.name"],
      ["<<DATE>>", "report.date"],
      ["<<P_LOCATION_POSTCODE>>", "clinic.postcode"],
    ]) {
      L.assert(path(code) === want, `${code} → ${path(code)} (want ${want})`);
    }
    console.log(`   map: ${map.fields.length} questions, ${map.fields.filter((f) => f.fillSource.kind === "registration").length} from the record, ${map.analysis.mergeFields?.length ?? 0} merge codes recorded`);
    await L.shot(page, "codes-1-mapping");
    await page.getByRole("button", { name: /^Confirm mapping$/ }).first().click();
    await page.locator("#confirm-by").fill("Sarah Reid");
    await page.locator("[role=dialog] input[type=checkbox], [role=dialog] button[role=checkbox]").first().click();
    await page.locator("[role=dialog]").getByRole("button", { name: /Confirm mapping/ }).click();
    await page.getByText(/Mapping confirmed by Sarah Reid/).waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  await L.step("C-codes Megan Hart → record values in place → staff entries → approve → Word without merge codes", async () => {
    const app = await F.launch(ctx, page, "sim-pat-001");
    await app.getByRole("button", { name: "Choose the referrer form" }).click();
    await app.waitForTimeout(500);
    await app.getByRole("radio", { name: /Larkfield/ }).click();
    await app.getByRole("button", { name: "Complete this form" }).click();
    const open = app.locator("a, button").filter({ hasText: /^Open for review$/ }).first();
    await Promise.race([app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 180000 }), open.waitFor({ timeout: 180000 })]);
    if (await open.count()) await open.click();
    await app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 60000 });
    await app.locator("[id^='q-F-']").first().waitFor({ timeout: 20000 });
    await app.waitForTimeout(1500);
    const rep = await F.reportJson(app);
    const forms = await app.evaluate(() => JSON.parse(localStorage.getItem("medreport.forms") || "[]"));
    const map = forms.find((f) => f.file.fileName === "practice-codes-report.rtf");
    const sectionFor = (code) => {
      const field = map.fields.find((f) => f.anchor.kind === "docx" && f.anchor.placeholderText === code);
      return rep.sections.find((s) => s.key === field?.id);
    };
    const text = (code) => (sectionFor(code)?.paragraphs ?? []).map((p) => p.text).join(" ");
    L.assert(text("<<P_FIRSTNAM>>") === "Megan", `first name: ${text("<<P_FIRSTNAM>>")}`);
    L.assert(text("<<P_ADDRESS1>>") === "14 Willow Bank (fictional)", `address line 1: ${text("<<P_ADDRESS1>>")}`);
    L.assert(sectionFor("<<P_ADDRESS5>>")?.blankFromRecords === true, "address line 5 is left empty on purpose");
    L.assert(text("<<P_POSTCODE>>") === "MK3 9ZZ", "postcode");
    await L.shot(app, "codes-2-review", false);
    await answerBlockers(app);
    const keys = await app.locator("[id^='q-F-']").evaluateAll((els) => els.map((e) => e.id.slice(2)));
    await F.resolveAll(app, keys);
    await answerBlockers(app);
    await app.waitForTimeout(800);
    const flags = await F.flagsText(app);
    if (!/Nothing blocks approval/.test(flags)) console.log("   flags:", flags.slice(0, 1500));
    L.assert(/Nothing blocks approval/.test(flags), "nothing blocks approval");
    await app.getByRole("button", { name: /^Approve/ }).first().click();
    const dlg = app.getByRole("dialog");
    await dlg.waitFor();
    const name = dlg.getByLabel("Full name", { exact: true });
    const hcpc = dlg.getByLabel("HCPC registration number");
    if (!(await name.inputValue())) await name.fill("Sarah Reid");
    if (!(await hcpc.inputValue())) await hcpc.fill("PH-DEMO-01");
    await dlg.getByLabel(/Typed signature/).fill(await name.inputValue());
    const boxes = dlg.locator("input[type=checkbox]");
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
    await dlg.getByRole("button", { name: /Approve and sign/ }).click();
    await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 30000 });
    const word = await F.download(app, "Completed form (Word)", "CODES_megan-hart_FINAL.docx");
    L.assert(/\.docx$/.test(word), "downloads as .docx");
    const xml = new PizZip(L.fs.readFileSync(L.path.join(L.OUT, "CODES_megan-hart_FINAL.docx"))).file("word/document.xml").asText();
    const plain = xml.replace(/<w:tab\/>/g, " ").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    L.assert(!/<<[A-Z]/.test(plain), "no merge code in the Word file");
    L.assert(/Claimant: Ms Megan Hart/.test(plain), "name in place");
    L.assert(/14 Willow Bank \(fictional\)/.test(plain) && /MK3 9ZZ/.test(plain), "address and postcode");
    L.assert(/Date of Accident: 12\/03\/2026/.test(plain), "date of accident from the record");
    console.log("   word:", word);
    await L.shot(app, "codes-3-approved", false);
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
