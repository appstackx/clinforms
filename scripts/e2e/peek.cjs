const L = require("./lib.cjs");
(async () => {
  const { ctx, page } = await L.open({});
  await page.goto(`${L.BASE}/reports`);
  const reps = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("medreport.report.")).map((k) => JSON.parse(localStorage.getItem(k))));
  reps.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const r of reps.slice(-6)) {
    console.log(r.createdAt, r.patientLabel || r.bundleSnapshot?.patient?.fullName, "|", r.form?.title, "|", r.status, "| gen:", r.generation.map((g) => `${g.mode}:${g.sectionKeys.join("+")}`).join(", "), "| failed:", r.activity.filter((a) => a.action === "draft_failed").map((a) => a.detail).join(" / "));
  }
  await ctx.close();
})();
