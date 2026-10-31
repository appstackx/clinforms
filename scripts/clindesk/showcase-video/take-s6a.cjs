// 18:30 · the audit trail, filtered to Sophie Marsh's day (signatures, amendment, filed form).
const { Take, L } = require("./rec.cjs");
(async () => {
  const t = new Take("s6a-audit");
  const page = await t.open("sam");
  await page.goto(`${L.APP}/app/clinic/setup/audit`);
  await page.waitForSelector("#au-user");
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("audit");
  await t.hold(1000);
  await t.moveToLoc(page.locator("#au-user"), 700);
  await page.selectOption("#au-user", { label: "Sophie Marsh" });
  await t.hold(500);
  await t.click(page.getByRole("button", { name: "Search" }), { mark: "search" });
  await page.waitForTimeout(1500);
  t.mark("rows");
  await t.moveTo(700, 700, 700);
  await t.hold(1200);
  await t.scrollTo(420, 1600);
  t.mark("scrolled");
  await t.hold(1500);
  await t.scrollTo(1300, 3200);
  await t.hold(1500);
  await t.shot("audit");
  await t.close();
})().catch((e) => { console.error(e); process.exit(1); });
