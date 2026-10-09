const L = require("./lib.cjs");
const F = require("./flows.cjs");
const P = process.env.PFX || "d";
(async () => {
  const { ctx, page, problems, net } = await L.open({});
  let app;
  await L.step("C1 Megan -> Northfield PDF form -> generate", async () => {
    app = await F.launch(ctx, page, "sim-pat-001");
    const r = await F.chooseAndGenerate(app, /Northfield Assurance/);
    console.log("   generate:", JSON.stringify(r));
    await L.shot(app, `${P}-30-megan-northfield-review`, false);
  });
  await L.step("C2 clinician completes opinion fields", async () => {
    console.log("   flags before:", (await F.flagsText(app)).slice(0, 600));
    await F.addOwn(app, "F-12", "In my opinion Ms Hart has no functional limitations affecting work or daily activities. She should continue to take regular breaks from prolonged sitting and driving.");
    await app.locator("#q-F-13").getByLabel("Yes", { exact: true }).check();
    await F.addOwn(app, "F-17", "In my opinion the residual intermittent neck ache should settle within three to six months with her home exercise programme.");
    // Northfield uses its own claim number: the solicitor's reference is NOT copied in; staff enter it.
    const f01 = await app.locator("#q-F-01").innerText();
    L.assert(/uses its own reference here/.test(f01), "F-01 asks for the insurer's own reference");
    await F.addOwn(app, "F-01", "NA-PI-77310");
    await F.resolveAll(app, ["F-01", "F-12", "F-13", "F-14", "F-15", "F-16", "F-17"]);
    console.log("   own voice:", await F.ownVoice(app, `${P}-30b-own-voice`));
    await app.waitForTimeout(1000);
    const f = await F.flagsText(app);
    console.log("   flags after:", f.slice(0, 900));
    L.assert(/Nothing blocks approval/.test(f), "nothing blocks");
    const rep = await F.reportJson(app);
    const f01s = rep.sections.find((s) => s.key === "F-01");
    L.assert(f01s && f01s.paragraphs.some((p) => p.text === "NA-PI-77310"), "F-01 holds the staff-entered claim number");
    await app.getByRole("tab", { name: "Preview" }).click();
    await app.locator("[role=tabpanel][data-state=active] canvas").first().waitFor({ timeout: 30000 });
    await app.waitForTimeout(2500);
    await L.shot(app, `${P}-31-megan-northfield-preview`, false);
  });
  await L.step("C3 approve -> final filled+flattened PDF", async () => {
    await F.approve(app, `${P}-32-northfield-approve`);
    const n = await F.download(app, "Completed form (PDF)", "megan-hart_northfield_FINAL.pdf");
    console.log("   pdf:", n);
    await app.getByRole("button", { name: /Save to clinic record/ }).click();
    await app.getByText(/Filed to the Simulated TM3 record/).first().waitFor({ timeout: 30000 });
    await L.shot(app, `${P}-33-northfield-approved`, false);
  });
  if (process.env.ONLY === "C") { console.log("PROBLEMS:\n" + problems.join("\n")); console.log("NET>=400:\n" + net.join("\n")); await ctx.close(); return; }
  let dan;
  await L.step("D1 Daniel -> Kingsway form -> generate", async () => {
    dan = await F.launch(ctx, page, "sim-pat-002");
    await dan.waitForTimeout(500);
    await L.shot(dan, `${P}-40-daniel-launch`, false);
    const r = await F.chooseAndGenerate(dan, /Kingsway/);
    console.log("   generate:", JSON.stringify(r));
    await L.shot(dan, `${P}-41-daniel-review`, false);
  });
  await L.step("D2 recorded return-to-duties opinion cited; no past history leaked", async () => {
    const rep = await F.reportJson(dan);
    const all = rep.sections.map((s) => `${s.key} ${s.title}: ${(s.paragraphs || []).map((p) => `${p.text} [${(p.sourceIds || []).join(",")}]`).join(" ")}`).join("\n");
    const rtw = rep.sections.filter((s) => /return-to-work|adjustments|modified/i.test(s.title));
    for (const s of rtw) console.log("   ", s.key, s.title, "=>", (s.paragraphs || []).map((p) => p.text + " [" + p.sourceIds.join(",") + "]").join(" ").slice(0, 300), s.answer ? JSON.stringify(s.answer) : "");
    L.assert(/phased return to normal duties over 2 weeks/.test(all) && /N-006/.test(all), "phased return opinion attributed with N-006");
    L.assert(!/knee|asthma|arthroscop|smok|alcohol/i.test(all.replace(/knee rolls/gi, "")), "no past/social history");
    await dan.locator("#q-F-16").scrollIntoViewIfNeeded();
    await L.shot(dan, `${P}-42-daniel-rtw-opinion`, false);
  });
  await L.step("D3 clinician completes + approve + export Word/PDF", async () => {
    console.log("   flags before:", (await F.flagsText(dan)).slice(0, 700));
    await dan.locator("#q-F-13").getByLabel("No", { exact: true }).check();
    // Question 5 ("If not, are they fit for modified or restricted duties?"): the recorded opinion is a
    // phased return with a lifting restriction, so the clinician ticks "Yes, with the adjustments below".
    const q5 = dan.locator("#q-F-14").getByLabel(/^Yes, with the adjustments/);
    if ((await q5.count()) && !(await q5.isChecked())) await q5.check();
    await F.addOwn(dan, "F-12", "At the final review on 22/09/2026 Mr Brooks could sit for over 1 hour and stand for over 2 hours without symptoms.");
    await F.resolveAll(dan, ["F-01", "F-02", "F-10", "F-11", "F-12", "F-13", "F-14", "F-15", "F-16", "F-17", "F-18"]);
    console.log("   own voice:", await F.ownVoice(dan, `${P}-43a-own-voice`));
    const rep = await F.reportJson(dan);
    const opinion = rep.sections.flatMap((s) => s.paragraphs || []).map((p) => p.text).join(" ");
    console.log("   first person:", /\bI recorded\b|in my opinion/.test(opinion));
    await dan.waitForTimeout(1000);
    const f = await F.flagsText(dan);
    console.log("   flags after:", f.slice(0, 900));
    L.assert(/Nothing blocks approval/.test(f), "nothing blocks");
    await F.approve(dan, `${P}-43-daniel-approve`);
    console.log("   word:", await F.download(dan, "Completed form (Word)", "daniel-brooks_kingsway_FINAL.docx"));
    console.log("   pdf:", await F.download(dan, "Completed form (PDF)", "daniel-brooks_kingsway_FINAL.pdf"));
    await dan.getByRole("button", { name: /Save to clinic record/ }).click();
    await dan.getByText(/Filed to the Simulated TM3 record/).first().waitFor({ timeout: 30000 });
    await L.shot(dan, `${P}-44-daniel-approved`, false);
  });
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
