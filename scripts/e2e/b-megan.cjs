const L = require("./lib.cjs");
const F = require("./flows.cjs");
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const P = process.env.PFX || "d";
(async () => {
  const { ctx, page, problems, net } = await L.open({ width: W, height: H });
  let app;
  await L.step("B1 sandbox -> Megan -> launch", async () => {
    await page.goto(`${L.BASE}/pms-sandbox`);
    await page.waitForLoadState("networkidle");
    await L.shot(page, `${P}-11-sandbox-list`, false);
    await page.goto(`${L.BASE}/pms-sandbox/patients/sim-pat-001`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    await L.shot(page, `${P}-12-sandbox-megan`, false);
    const t = Date.now();
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("button", { name: /Complete referrer's report form/ }).click()]);
    app = popup;
    await app.getByText(/Imported from Simulated TM3/).waitFor({ timeout: 30000 });
    console.log("   launch -> imported in", Date.now() - t, "ms; url", app.url().replace(L.BASE, ""));
    await app.waitForTimeout(800);
    await L.shot(app, `${P}-13-launch-data-preview`);
    const txt = await app.locator("main").innerText();
    L.assert(/Integration log/i.test(txt), "integration log visible");
    console.log("   banner:", (txt.match(/Imported from Simulated TM3[^\n]*/) || [""])[0]);
  });
  let reportUrl;
  await L.step("B2 choose Harrow & Pike form -> generate", async () => {
    await app.getByRole("button", { name: "Choose the referrer form" }).click();
    await app.waitForTimeout(600);
    const radio = app.getByRole("radio", { name: /Harrow & Pike/ });
    console.log("   preselected:", await radio.getAttribute("aria-checked"));
    await radio.click();
    await L.shot(app, `${P}-14-choose-form`);
    const t = Date.now();
    await app.getByRole("button", { name: "Complete this form" }).click();
    await app.waitForTimeout(400);
    await L.shot(app, `${P}-15-completing`, false);
    await app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 120000 });
    reportUrl = app.url();
    console.log("   generate -> review in", Date.now() - t, "ms", reportUrl.replace(L.BASE, ""));
    await app.locator("#q-F-07").waitFor({ timeout: 20000 });
    await app.waitForTimeout(1500);
    await L.shot(app, `${P}-16-review`, false);
  });
  await L.step("B3 citation chip -> source note", async () => {
    const chip = app.locator("#q-F-12 button[aria-label^='Source N-010']").first();
    await chip.click();
    await app.waitForTimeout(800);
    const active = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
    L.assert(/N-010/.test(active), "sources panel shows N-010");
    await L.shot(app, `${P}-17-chip-source`, false);
  });
  await L.step("B4 edit adds opinion+figure -> flags; revert clears", async () => {
    const ta = app.locator("#q-F-12 textarea").first();
    await ta.click();
    await ta.press("Control+End");
    await app.keyboard.type(" She will make a full recovery by March 2027.");
    await app.locator("#q-F-12 h3").first().click();
    await app.waitForTimeout(1500);
    const card = await app.locator("#q-F-12").innerText();
    console.log("   card flags:", card.split("\n").filter((l) => /opinion|figure|date|not in|record/i.test(l)).slice(0, 8).join(" || "));
    await app.locator("#q-F-12").scrollIntoViewIfNeeded();
    await L.shot(app, `${P}-18-edit-flags`, false);
    L.assert(/opinion/i.test(card), "opinion flag shown");
    L.assert(/figure|date|2027/i.test(card), "figure flag shown");
    await app.locator("#q-F-12").getByRole("button", { name: "Revert to the draft" }).click();
    await app.waitForTimeout(1200);
    const card2 = await app.locator("#q-F-12").innerText();
    L.assert(!/Opinion language/i.test(card2), "flags cleared after revert");
  });
  await L.step("B5 prognosis empty + flagged; DNA = 1 and reason flagged", async () => {
    const prog = await app.locator("#q-F-14").innerText();
    console.log("   F-14:", prog.replace(/\n+/g, " | ").slice(0, 500));
    L.assert(/clinician/i.test(prog), "prognosis needs clinician input");
    const dna = await app.locator("#q-F-11").innerText();
    console.log("   F-11:", dna.replace(/\n+/g, " | ").slice(0, 300));
    await app.locator("#q-F-14").scrollIntoViewIfNeeded();
    await L.shot(app, `${P}-19-prognosis-gap`, false);
    await app.getByRole("tab", { name: /Flags/ }).click();
    await app.waitForTimeout(500);
    const flags = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
    console.log("   FLAGS PANEL:", flags.replace(/\n+/g, " | ").slice(0, 2500));
    L.assert(/15\/04\/2026/.test(flags) || /did not attend|DNA/i.test(flags), "DNA reason flag");
    await L.shot(app, `${P}-20-flags`, false);
  });
  await L.step("B6 clinician answers opinion questions and resolves gaps", async () => {
    await app.locator("#q-F-13").getByLabel("Yes").check();
    const fill = async (k, text) => {
      const add = app.locator(`#q-${k}`).getByRole("button", { name: "Add a paragraph in your own words" });
      if (await add.count()) { await add.click(); await app.waitForTimeout(200); }
      await app.locator(`#q-${k} textarea`).last().fill(text);
      await app.locator(`#q-${k} h3`).first().click();
      await app.waitForTimeout(400);
    };
    await fill("F-14", "In my opinion Ms Hart has made a good recovery. I expect the remaining intermittent neck ache to settle over the next three to six months with her home exercise programme.");
    await fill("F-15", "In my opinion Ms Hart has no restrictions on work, domestic or leisure activities. She should continue to take regular breaks from prolonged sitting at the computer and from drives over 1 hour.");
    await fill("F-16", "In my opinion no further physiotherapy is needed. She should continue her maintenance home exercise programme and return to the clinic or her GP if her symptoms increase.");
    await app.waitForTimeout(800);
    const status14 = await app.locator("#q-F-14 header").innerText();
    console.log("   F-14 status after answering:", status14.replace(/\n+/g, " | ").slice(-60));
    L.assert(/Answered – confirm the gap/.test(status14), "answered opinion shows 'confirm the gap', not 'Blocked'");
    // The superseded "not recorded" sentence on F-15 can be removed in one click.
    const removeIt = app.locator("#q-F-15").getByRole("button", { name: "Remove it" });
    console.log("   offer to remove the draft's not-recorded wording on F-15:", await removeIt.count());
    if (await removeIt.count()) {
      await app.locator("#q-F-15").scrollIntoViewIfNeeded();
      await L.shot(app, `${P}-20b-remove-not-recorded`, false);
      await removeIt.click();
      await app.waitForTimeout(400);
    }
    await F.resolveAll(app, ["F-13", "F-14", "F-15", "F-16"]);
    const res14 = await app.locator("#q-F-14").innerText();
    L.assert(/Answered on the form by Sarah Reid/.test(res14), "resolution names who answered");
    const voice = await F.ownVoice(app, `${P}-20c-own-voice-offer`);
    console.log("   own voice:", voice);
    await app.waitForTimeout(1200);
    const blocked = await app.locator("#approve-blocked").innerText().catch(() => "(no approve-blocked)");
    console.log("   approve status:", blocked.replace(/\n/g, " "));
    await L.shot(app, `${P}-21-after-clinician`, false);
  });
  await L.step("B7 remaining blockers resolved / acknowledged", async () => {
    await app.getByRole("tab", { name: /Flags/ }).click();
    await app.waitForTimeout(500);
    const flags = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
    console.log("   FLAGS NOW:", flags.replace(/\n+/g, " | ").slice(0, 2000));
    const header = await app.locator("header").nth(1).innerText();
    console.log("   HEADER:", header.replace(/\n+/g, " | ").slice(0, 400));
  });
  await L.step("B8 preview shows Harrow layout with DRAFT", async () => {
    await app.getByRole("tab", { name: "Preview" }).click();
    await app.locator("[role=tabpanel][data-state=active] section.docx").first().waitFor({ timeout: 30000 });
    await app.waitForTimeout(2500);
    const pv = await app.locator("[role=tabpanel][data-state=active]").first().innerText();
    L.assert(/DRAFT/.test(pv), "DRAFT marking in preview");
    L.assert(/HARROW|Harrow/.test(pv), "Harrow layout");
    await L.shot(app, `${P}-22-preview-draft`, false);
  });
  await L.step("B9 approve", async () => {
    await app.getByRole("button", { name: /^Approve/ }).first().click();
    const dlg = app.getByRole("dialog");
    await dlg.waitFor();
    await app.waitForTimeout(400);
    const nameVal = await dlg.getByLabel("Full name", { exact: true }).inputValue();
    const hcpcVal = await dlg.getByLabel("HCPC registration number").inputValue();
    console.log("   prefilled:", nameVal, hcpcVal);
    if (!nameVal) await dlg.getByLabel("Full name", { exact: true }).fill("Sarah Reid");
    if (!hcpcVal) await dlg.getByLabel("HCPC registration number").fill("PH-DEMO-01");
    await dlg.getByLabel(/Typed signature/).fill(await dlg.getByLabel("Full name", { exact: true }).inputValue());
    const boxes = dlg.locator("input[type=checkbox]");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).check();
    await L.shot(app, `${P}-23-approve-dialog`, false);
    await dlg.getByRole("button", { name: /Approve and sign/ }).click();
    await app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 20000 });
    await app.waitForTimeout(1500);
    await L.shot(app, `${P}-24-approved`, false);
  });
  await L.step("B10 download final Word + PDF", async () => {
    const [d1] = await Promise.all([app.waitForEvent("download", { timeout: 60000 }), app.getByRole("button", { name: "Completed form (Word)" }).click()]);
    await d1.saveAs(L.path.join(L.OUT, "megan-hart_harrow-pike_FINAL.docx"));
    console.log("   word:", d1.suggestedFilename());
    const [d2] = await Promise.all([app.waitForEvent("download", { timeout: 90000 }), app.getByRole("button", { name: "Completed form (PDF)" }).click()]);
    await d2.saveAs(L.path.join(L.OUT, "megan-hart_harrow-pike_FINAL.pdf"));
    console.log("   pdf:", d2.suggestedFilename());
  });
  await L.step("B11 save to clinic record", async () => {
    await app.getByRole("button", { name: /Save to clinic record/ }).click();
    await app.getByText(/Filed to the Simulated TM3 record/).first().waitFor({ timeout: 30000 });
    const toast = await app.getByText(/Filed to the Simulated TM3 record/).first().locator("xpath=..").innerText();
    console.log("   filed:", toast.replace(/\n+/g, " | "));
    L.assert(/\.docx/.test(toast) && /\.pdf/.test(toast), "Word and PDF both filed");
    await app.waitForTimeout(600);
    L.assert(await app.getByRole("button", { name: "File again" }).count(), "quiet filed state with File again");
    await L.shot(app, `${P}-25-filed`, false);
  });
  await L.step("B12 final preview", async () => {
    await app.getByRole("tab", { name: "Preview" }).click();
    await app.waitForTimeout(4000);
    await L.shot(app, `${P}-26-final-preview`, false);
  });
  require("fs").writeFileSync(L.path.join(L.SP, "e2e", "megan-report-url.txt"), reportUrl || "");
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
