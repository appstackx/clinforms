// 09:15 · Sophie, room 1: Robert arrives, a follow-up note from her template, signed and locked, an amendment,
// a letter to the GP from the same record.
const { Take, L } = require("./rec.cjs");
const originFix = require("./origin-fix.cjs");
const P = "pat_01M725BQPE5KPDH2S2EJ27H543";

(async () => {
  const t = new Take("s2-notes", { css: "[data-sonner-toaster]{display:none!important}" });
  const page = await t.open("sophie");
  await originFix(page);
  await page.goto(`${L.APP}/app/clinic`);
  await page.waitForSelector("text=My next patients");
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("today");
  await t.moveToLoc(page.locator("text=Robert Hale >> visible=true").first(), 900);
  await t.hold(1600);
  await t.cut();
  // diary drawer
  await page.goto(`${L.APP}/app/clinic/diary`);
  await page.waitForSelector("text=Robert Hale >> visible=true");
  await page.waitForTimeout(700);
  await t.roll();
  t.mark("diary");
  await t.click(page.locator("text=Robert Hale >> visible=true").first(), { mark: "open-drawer" });
  await page.getByRole("button", { name: /^Arrived/ }).waitFor();
  await t.hold(1100);
  await t.click(page.getByRole("button", { name: /^Arrived/ }), { mark: "arrived" });
  await page.getByRole("button", { name: /^Start treatment/ }).waitFor();
  await t.hold(1100);
  await t.click(page.getByRole("button", { name: /^Start treatment/ }), { mark: "start" });
  await page.waitForURL(/\/notes\/note_/);
  await page.waitForSelector("#note-template");
  await t.cut();
  const noteUrl = page.url();
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("note");
  await t.hold(900);
  await t.moveToLoc(page.locator("#note-template"));
  await page.selectOption("#note-template", "builtin-follow-up-soap");
  await page.getByRole("button", { name: "Switch template" }).waitFor();
  await t.hold(700);
  await t.click(page.getByRole("button", { name: "Switch template" }), { mark: "template" });
  await page.waitForTimeout(900);
  const lines = [
    ["subjective", "Sleeping through most nights now. Pain 3/10 reaching overhead."],
    ["objective", "Flex 150°, abd 140°, painful arc 110–130°. ER strength 4+/5."],
    ["assessment", "Improving as expected."],
    ["plan", "Progress loading. Review 24/11/2026."],
  ];
  for (const [id, text] of lines) {
    t.mark(`type-${id}`);
    await t.type(page.locator(`#section-${id}`), text, { cps: 26 });
    await t.hold(350);
    if ((await page.locator(`#section-${id}`).inputValue()).trim() !== text) { await page.locator(`#section-${id}`).fill(text); await t.hold(300); }
  }
  await page.locator("text=/Draft saved/").first().waitFor();
  await t.hold(900);
  await t.click(page.getByRole("button", { name: /Sign and lock/ }).last(), { mark: "sign" });
  const dlg = page.locator("[role=dialog],[role=alertdialog]");
  await dlg.getByRole("button", { name: /Sign and lock/ }).waitFor();
  await t.hold(1600);
  t.mark("sign-dialog");
  await t.click(dlg.getByRole("button", { name: /Sign and lock/ }), { mark: "signed-click" });
  await page.locator("text=Signed and locked").first().waitFor();
  await page.waitForTimeout(400);
  await t.scrollTo(0, 400);
  await t.moveTo(900, 236, 700);
  t.mark("locked");
  await t.hold(2600);
  // amendment
  await t.click(page.getByRole("button", { name: "Add amendment" }), { mark: "amend-open" });
  await page.waitForSelector("#amend-text");
  await page.locator("#amend-text").scrollIntoViewIfNeeded();
  await t.hold(700);
  await t.moveToLoc(page.locator("#amend-reason"));
  await page.selectOption("#amend-reason", "correction");
  await t.hold(600);
  const secSel = page.locator("select").filter({ has: page.locator("option", { hasText: /^Plan$/ }) }).last();
  await t.moveToLoc(secSel, 500);
  await secSel.selectOption({ label: "Plan" });
  await t.hold(500);
  t.mark("amend-type");
  await t.type(page.locator("#amend-text"), "Plan: review on 17/11/2026, not 24/11/2026.", { cps: 24 });
  await t.hold(500);
  await t.click(page.getByRole("button", { name: "Sign amendment" }), { mark: "amend-sign" });
  await page.waitForTimeout(1800);
  t.mark("amended");
  await t.shot("amended");
  await t.hold(2400);
  await t.cut();
  // letter to the GP
  await page.goto(`${L.APP}/app/clinic/letters/new?patient=${P}`);
  await page.waitForSelector("[data-testid=start-letter]");
  await page.selectOption("#letter-case", { label: "Right shoulder – rotator cuff" });
  await page.waitForTimeout(600);
  await t.roll();
  t.mark("letter-new");
  await t.click(page.locator("input[value='standard:gp-assessment']"), { mark: "letter-template" });
  await t.hold(900);
  await t.click(page.locator("[data-testid=start-letter]"), { mark: "letter-start" });
  await page.waitForURL(/\/letters\/ltr_/);
  await page.waitForTimeout(1500);
  await t.cut();
  // fill the gaps off camera, then show the A4 preview
  const body = page.locator("main textarea").filter({ hasText: "Dear" }).first();
  const text = (await body.inputValue())
    .replace("[[date of the assessment]]", "09/11/2026")
    .replace("[[Summarise the history and the findings]]", "Six weeks of right shoulder pain, worse reaching overhead. Painful arc and positive impingement tests; neck clear. Rotator cuff related shoulder pain.")
    .replace("[[Treatment plan and expected number of sessions]]", "Education, progressive loading and a home programme, reviewed weekly. Up to six sessions.");
  await body.fill(text);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForTimeout(1500);
  await t.scrollTo(0, 300);
  await t.roll();
  t.mark("letter-filled");
  await t.hold(1500);
  await t.click(page.getByRole("button", { name: "A4 preview" }).or(page.getByRole("tab", { name: "A4 preview" })).first(), { mark: "preview" });
  await t.hold(3200);
  await t.shot("letter");
  await t.close();
  console.log("note", noteUrl.replace(L.APP, ""));
})().catch((e) => { console.error(e); process.exit(1); });
