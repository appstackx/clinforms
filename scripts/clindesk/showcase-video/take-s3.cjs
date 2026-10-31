// 11:40 · Sophie, an insurer's form (ClinDesk Reports – powered by ClinForms, add-on): from Robert's case,
// "Complete referrer form" → the insurer's own form drafted from her signed notes (live, local, fictional notes) →
// sources → her own opinion → approve and sign → filed back to the record.
const fs = require("fs");
const path = require("path");
const { Take, L } = require("./rec.cjs");
const originFix = require("./origin-fix.cjs");
const P = "pat_01M725BQPE5KPDH2S2EJ27H543", C = "case_01M725BQPRPVWNNHK9MPKGTTFB";
const info = {};

function studioCss() {
  const add = () => {
    if (!location.pathname.startsWith("/app/studio") || document.getElementById("__studio_css")) return;
    const st = document.createElement("style");
    st.id = "__studio_css";
    st.textContent = "[data-testid=product-switch],[data-demo-clinic-banner],body header.sticky.top-0.z-30,body footer{display:none!important}";
    document.documentElement.appendChild(st);
  };
  add();
  document.addEventListener("DOMContentLoaded", add);
  setInterval(add, 200);
}

/** Off camera: answer what is still open (fictional answers consistent with the notes) and resolve flags (from e2e). */
async function finishReview(app) {
  for (let round = 0; round < 5; round++) {
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
          await res.first().click({ timeout: 8000 });
          const ta = card.locator("form textarea").last();
          if (!(await ta.inputValue())) await ta.fill("Checked against the notes with the treating physio.");
          await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
          await app.waitForTimeout(250);
          continue;
        }
        const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
        if (await ack.count()) {
          await ack.first().click({ timeout: 8000 });
          await card.locator("form textarea").last().fill("Not recorded in the notes; checked with the treating physio.");
          await card.locator("form").getByRole("button", { name: /Acknowledge/ }).last().click();
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
  const t = new Take("s3-referrer");
  const page = await t.open("sophie");
  await page.addInitScript(studioCss);
  await originFix(page);
  page.setDefaultTimeout(60000);
  await page.goto(`${L.APP}/app/clinic/patients/${P}/cases/${C}`);
  await page.waitForSelector("[data-testid=referrer-forms]");
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("case");
  await t.hold(1500);
  await t.click(page.locator("[data-testid=complete-referrer-form]"), { mark: "complete-click" });
  await page.getByRole("dialog").waitFor();
  await t.hold(900);
  t.mark("dialog");
  await t.moveToLoc(page.getByRole("dialog").locator("label").first(), 700);
  await t.hold(1400);
  await t.click(page.locator("[data-testid=open-in-clinforms]"), { mark: "open-click" });
  await t.cut();
  await page.waitForURL(/\/app\/studio\/new/, { timeout: 30000 });
  await page.getByRole("button", { name: "Choose the referrer form" }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await t.roll();
  t.mark("imported");
  await t.moveToLoc(page.locator("text=Imported from ClinDesk").first(), 800);
  await t.hold(2400);
  await t.click(page.getByRole("button", { name: "Choose the referrer form" }), { mark: "choose" });
  const radio = page.getByRole("radio", { name: /Rehabilitation Progress Report/ }).first();
  await radio.waitFor({ timeout: 20000 });
  if (!(await radio.isChecked())) await radio.click();
  await t.hold(1500);
  await t.shot("choose");
  const go = page.getByRole("button", { name: "Complete this form" });
  await t.moveToLoc(go);
  await t.hold(300);
  t.mark("complete");
  const t0 = Date.now();
  await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
  await t.hold(1800);
  t.mark("drafting");
  await t.shot("drafting");
  await t.cut();
  const open = page.locator("a:has-text('Open for review'), button:has-text('Open for review')").first();
  await Promise.race([open.waitFor({ timeout: 240000 }), page.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 240000 })]);
  info.draftSeconds = Math.round((Date.now() - t0) / 1000);
  await page.waitForTimeout(500);
  await t.roll();
  t.mark("drafted");
  await t.shot("drafted");
  await t.hold(1800);
  if (await open.count()) {
    await t.click(open, { mark: "open-review" });
    await t.cut();
  } else await t.cut();
  await page.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 120000 });
  await page.locator("article[id^='q-']").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  info.reportUrl = page.url().replace(L.APP, "");
  info.progressBefore = (await page.locator("text=/\\d+ of \\d+ answered/").first().innerText().catch(() => "")).trim();
  await t.roll();
  t.mark("review");
  await t.hold(2500);
  // A drafted answer and its sources.
  const cards = page.locator("article[id^='q-']");
  let drafted = null;
  for (let i = 0; i < (await cards.count()); i++) {
    const tx = await cards.nth(i).innerText();
    if (/Diagnosis|Treatment to date|Functional/i.test(tx) && !/no answer yet|Not answered/i.test(tx)) { drafted = cards.nth(i); break; }
  }
  if (drafted) {
    const b = await drafted.boundingBox();
    const y = await page.evaluate(() => window.scrollY);
    await t.scrollTo(y + b.y - 150, 1100);
    await t.hold(400);
    await t.moveToLoc(drafted.locator("h3").first(), 700);
    t.mark("drafted-answer");
    await t.hold(1600);
    const src = page.getByRole("tab", { name: /^Sources/ }).or(page.getByRole("button", { name: /^Sources/ })).first();
    if (await src.count()) {
      await t.click(src, { mark: "sources" });
      await t.hold(1200);
      const cite = drafted.locator("button, a").filter({ hasText: /note|Note|\d\d\/\d\d/ }).first();
      if (await cite.count()) { await t.click(cite, { mark: "cite" }); }
      await t.hold(2600);
    }
    await t.shot("sources");
    info.draftedCard = (await drafted.innerText()).slice(0, 400);
  }
  // What the notes don't cover: the prognosis is left for her.
  let prog = null;
  for (let i = 0; i < (await cards.count()); i++) if (/prognosis/i.test(await cards.nth(i).innerText())) { prog = cards.nth(i); break; }
  if (prog) {
    const b = await prog.boundingBox();
    const y = await page.evaluate(() => window.scrollY);
    await t.scrollTo(y + b.y - 160, 1200);
    t.mark("prognosis");
    await t.hold(1800);
    info.prognosisCard = (await prog.innerText()).slice(0, 400);
    const add = prog.getByRole("button", { name: "Add a paragraph in your own words" });
    if (await add.count()) { await t.click(add.first(), { mark: "own-words" }); await t.hold(500); }
    const box = prog.locator("textarea").first();
    if (await box.count()) {
      t.mark("opinion-type");
      await t.type(box, "Good progress. I expect a return to full overhead activity within 6 to 8 weeks.", { cps: 24 });
      await t.hold(500);
      const h = prog.locator("h3").first();
      if (await h.count()) await t.click(h, { ms: 400 });
      await t.hold(1500);
    }
    await t.shot("opinion");
  }
  await t.cut();
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
