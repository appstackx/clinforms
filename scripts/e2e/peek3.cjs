const L = require("./lib.cjs");
(async () => {
  const { ctx, page } = await L.open({ profile: "desktop" });
  await page.goto(`${L.BASE}/reports`);
  const r = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("medreport.report.")).map((k) => JSON.parse(localStorage.getItem(k))).find((r) => r.createdAt === "2026-10-07T00:15:14.352Z"));
  for (const k of ["F-12", "F-13", "F-14", "F-15", "F-16"]) {
    const s = r.sections.find((x) => x.key === k);
    console.log(k, s.title, JSON.stringify(s.answer), s.status);
    for (const p of s.paragraphs) console.log("   -", p.origin, p.sourceIds.join(","), p.text);
  }
  console.log(r.gaps.filter((g) => ["F-12","F-13","F-14"].includes(g.sectionKey)).map((g) => g.sectionKey + ": " + g.issue).join("\n"));
  console.log((r.flags||[]).filter((f) => f.severity === "blocking").map((f) => f.code + " " + f.sectionKey + " " + (f.evidence||"")).join("\n"));
  await ctx.close();
})();
