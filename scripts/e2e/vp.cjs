// viewport screenshots of a given path list: node vp.cjs name=path ...
const L = require("./lib.cjs");
(async () => {
  const w = Number(process.env.W || 1440), h = Number(process.env.H || 900);
  const { ctx, page, problems } = await L.open({ profile: process.env.PROFILE || "desktop", width: w, height: h });
  for (const arg of process.argv.slice(2)) {
    const [name, p, action] = arg.split("=");
    await page.goto(`${L.BASE}${p}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(Number(process.env.WAIT || 3000));
    if (action) await page.getByRole("button", { name: new RegExp(action, "i") }).first().click().catch(() => {}), await page.waitForTimeout(1200);
    await L.shot(page, name, process.env.FULL === "1");
    console.log(name, "overflow", await L.overflow(page));
  }
  console.log("PROBLEMS:\n" + problems.join("\n"));
  await ctx.close();
})();
