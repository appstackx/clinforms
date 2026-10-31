// 11:40 continued (the first take stopped off camera after her opinion): finish the remaining answers off camera,
// then approve and sign on camera; filed back to the case and the Forms tab.
const fs = require("fs");
const path = require("path");
const { Take, L } = require("./rec.cjs");
const originFix = require("./origin-fix.cjs");
const P = "pat_01M725BQPE5KPDH2S2EJ27H543", C = "case_01M725BQPRPVWNNHK9MPKGTTFB";
const info = {};
/** Off camera: answer what is still open (fictional answers consistent with the notes) and resolve flags (from e2e). */
async function finishReview(app) {
  for (let round = 0; round < 8; round++) {
    const keys = await app.$$eval("article[id^='q-']", (els) => els.map((e) => e.id.slice(2)));
    for (const key of keys) {
      const card = app.locator(`[id='q-${key}']`);
      const text = await card.innerText();
      if (/no answer yet|Missing|needs your|Not answered|Answer this/i.test(text)) {
        const radios = card.locator("input[type=radio]");
        if (await radios.count()) {
          const opt = card.getByLabel(/^No$/).or(card.getByLabel("Yes", { exact: true }));
          if (/fit for work/i.test(text) && (await card.getByLabel("Modified duties").count())) await card.getByLabel("Modified duties").first().check();
          else if (/completed|discharged/i.test(text) && (await card.getByLabel(/^No$/).count())) await card.getByLabel(/^No$/).first().check();
          else if (await opt.count()) await opt.first().check();
          else await radios.first().check();
        } else {
          const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
          if (await add.count()) await add.first().click();
          const box = card.locator("textarea, input[type=text], input[type=number], input:not([type])");
          if (await box.count()) {
            let v = "Not applicable.";
            if (/date of injury/i.test(text)) v = "N/A";
            else if (/number|sessions/i.test(text)) v = "4";
            else if (/modified duties/i.test(text)) v = "Desk-based work; avoid sustained overhead lifting for four weeks.";
            await box.first().fill(v);
          }
        }
        const h = card.locator("h3").first();
        if (await h.count()) await h.click().catch(() => {});
        await app.waitForTimeout(300);
      }
      for (let g = 0; g < 6; g++) {
        const quick = card.getByRole("button", { name: "Mark resolved" });
        if ((await quick.count()) && !(await card.locator("form").count())) { await quick.first().click({ timeout: 8000 }).catch(() => {}); await app.waitForTimeout(250); continue; }
        const res = card.getByRole("button", { name: /^Resolve$/ });
        if (await res.count()) {
          await res.first().click({ timeout: 8000 }).catch(() => {});
          const ta = card.locator("form textarea").last();
          if (!(await ta.inputValue())) await ta.fill("Checked against the notes with the treating physio.");
          await card.locator("form").getByRole("button", { name: "Mark resolved" }).click({ timeout: 8000 }).catch(() => {});
          await app.waitForTimeout(250);
          continue;
        }
        const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
        if (await ack.count()) {
          if (!(await ack.first().click({ timeout: 8000 }).then(() => true).catch(() => false))) continue;
          await card.locator("form textarea").last().fill("Not recorded in the notes; checked with the treating physio.").catch(() => {});
          await card.locator("form").getByRole("button", { name: /Acknowledge/ }).last().click({ timeout: 8000 }).catch(() => {});
          await app.waitForTimeout(250);
          continue;
        }
        break;
      }
    }
    const blocked = await app.locator("#approve-blocked").innerText().catch(() => "");
    if (!/to resolve/.test(blocked)) return;
    await app.waitForTimeout(800);
  }
}

(async () => {
  const t = new Take("s3b-approve", { css: "[data-testid=product-switch],[data-demo-clinic-banner],body header.sticky.top-0.z-30{display:none!important}" });
  const page = await t.open("sophie");
  await originFix(page);
  page.setDefaultTimeout(60000);
  await page.goto(`${L.APP}/app/studio`);
  const href = await page.locator("a[href*='/app/studio/rpt_']").first().getAttribute("href");
  await page.goto(L.APP + href);
  await page.locator("article[id^='q-']").first().waitFor();
  await page.waitForTimeout(2000);
  // Off camera: the remaining answers and flags.
  await finishReview(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  info.blocked = await page.locator("#approve-blocked").innerText().catch(() => "");
  info.progressAfter = (await page.locator("text=/\\d+ of \\d+ answered/").first().innerText().catch(() => "")).trim();
  await t.roll();
  t.mark("ready");
  await t.hold(1500);
  await t.click(page.getByRole("button", { name: /^Approve/ }).first(), { mark: "approve" });
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  await t.hold(1200);
  const name = await dlg.getByLabel("Full name", { exact: true }).inputValue();
  await t.type(dlg.getByLabel(/Typed signature/), name, { cps: 16 });
  const boxes = dlg.locator("input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) { await t.click(boxes.nth(i), { ms: 350, pause: 120 }); await t.hold(250); }
  await t.hold(800);
  await t.click(dlg.getByRole("button", { name: /Approve and sign/ }), { mark: "sign" });
  await page.getByText(/Approved – the completed form is final/).waitFor({ timeout: 90000 });
  await page.waitForTimeout(300);
  t.mark("approved");
  await t.hold(1500);
  await page.getByText(/Filed .* to the/).first().waitFor({ timeout: 90000 });
  t.mark("filed");
  await t.moveToLoc(page.getByText(/Filed .* to the/).first(), 800);
  await t.hold(2600);
  await t.shot("approved");
  await t.cut();
  // Back on the case and the Forms tab.
  await page.goto(`${L.APP}/app/clinic/patients/${P}/cases/${C}`);
  await page.locator("[data-testid=filed-form]").first().waitFor();
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("case-filed");
  await t.moveToLoc(page.locator("[data-testid=filed-form]").first(), 900);
  await t.hold(2800);
  info.filed = await page.locator("[data-testid=filed-form]").first().innerText();
  await t.cut();
  await page.goto(`${L.APP}/app/clinic/patients/${P}/forms`);
  await page.locator("[data-testid=filed-forms]").waitFor();
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("forms-tab");
  await t.moveToLoc(page.locator("[data-testid=filed-forms]").first(), 900);
  await t.hold(2800);
  await t.shot("forms-tab");
  await t.close();
  fs.writeFileSync(path.join(t.dir, "info.json"), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
