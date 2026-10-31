// Off camera: the owner fills the clinic details used on completed forms and turns on drafting from the notes.
const L = require("./lib.cjs");
(async () => {
  const browser = await L.launch();
  const ctx = await L.context(browser, "sam", { scale: 1 });
  const page = await ctx.newPage();
  await L.ensureSignedIn(page, "sam");
  await page.goto(`${L.APP}/app/settings/clinic`);
  await page.fill("#f-address", "2 Station Parade (fictional)\nNorthgate\nPebblegate");
  await page.fill("#f-postcode", "MK2 9ZZ");
  await page.fill("#f-phone", "01632 960101");
  await page.fill("#f-email", "hello@pebblegate-demo.example.com");
  await page.check("#f-drafting");
  await page.click("button:has-text('Save clinic details')");
  await page.waitForTimeout(2500);
  console.log((await page.locator("main").innerText()).match(/Saved[^\n]*/)?.[0] || "no saved text", await page.isChecked("#f-drafting"));
  await L.saveState(ctx); await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
