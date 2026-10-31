// 13:05 · Sam, group office: the day across all sites, switching sites, the numbers, roles.
const { Take, L } = require("./rec.cjs");
const originFix = require("./origin-fix.cjs");

(async () => {
  const t = new Take("s4-group");
  const page = await t.open("sam");
  await originFix(page);
  await page.goto(`${L.APP}/app/clinic`);
  await page.waitForSelector("text=Today by site");
  await page.waitForTimeout(1000);
  await t.roll();
  t.mark("dashboard");
  await t.moveToLoc(page.locator("text=Today by site").first(), 900);
  await t.hold(2600);
  // switch sites in the diary
  await t.click(page.getByRole("link", { name: "Diary" }).filter({ visible: true }).first(), { mark: "diary-click" });
  await page.waitForSelector("text=Sophie Marsh >> visible=true");
  await page.waitForTimeout(600);
  await t.hold(1200);
  const site = page.getByRole("button", { name: /^Site:/ }).filter({ visible: true }).first();
  await t.click(site, { mark: "site-menu" });
  await t.hold(1500);
  await t.click(page.getByText("Abbey Road (fictional)", { exact: true }).filter({ visible: true }).first(), { mark: "abbey" });
  await page.waitForTimeout(1500);
  t.mark("abbey-diary");
  await t.hold(2500);
  await t.cut();
  // reports across sites
  await page.goto(`${L.APP}/app/clinic/reports/utilisation`);
  await page.waitForSelector("text=Average utilisation");
  const siteSel = page.locator("main select").first();
  const opts = await siteSel.locator("option").allInnerTexts();
  console.log("report site options", opts);
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("utilisation");
  await t.hold(1800);
  const all = opts.find((o) => /all/i.test(o));
  if (all) {
    await t.moveToLoc(siteSel);
    await siteSel.selectOption({ label: all });
    await page.waitForTimeout(1800);
    t.mark("util-all");
  }
  await t.hold(2400);
  await t.click(page.getByRole("link", { name: "Revenue" }).filter({ visible: true }).first(), { mark: "revenue" });
  await page.waitForTimeout(1800);
  await t.hold(2400);
  await t.cut();
  // roles
  await page.goto(`${L.APP}/app/clinic/access/roles`);
  await page.waitForSelector("text=Roles and permissions >> visible=true");
  await page.waitForTimeout(800);
  await t.roll();
  t.mark("roles");
  await t.hold(1800);
  await t.moveTo(1240, 340, 900);
  await t.hold(800);
  await t.scrollTo(900, 2200);
  t.mark("roles-scrolled");
  await t.hold(2000);
  await t.shot("roles");
  await t.close();
})().catch((e) => { console.error(e); process.exit(1); });
