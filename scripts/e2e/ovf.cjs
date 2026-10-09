const L = require("./lib.cjs");
(async () => {
  const { ctx, page } = await L.open({ width: 390, height: 844 });
  await page.goto(`${L.BASE}/reports/forms`);
  const forms = await page.evaluate(() => JSON.parse(localStorage.getItem("medreport.forms") || "[]").map((f) => ({ id: f.id, sampleId: f.sampleId })));
  for (const sid of ["harrow-pike-treating-physio", "northfield-rehab-progress"]) {
    const id = forms.find((f) => f.sampleId === sid).id;
    await page.goto(`${L.BASE}/reports/forms/${encodeURIComponent(id)}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    const wide = await page.evaluate(() => {
      const W = window.innerWidth;
      const out = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > W + 1 && r.width > 0) {
          let p = el.parentElement, clipped = false;
          while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
          if (!clipped) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} right=${Math.round(r.right)} w=${Math.round(r.width)} text=${(el.innerText || "").slice(0, 40).replace(/\n/g, " ")}`);
        }
      });
      return out.slice(0, 12);
    });
    console.log(sid, "\n  " + wide.join("\n  "));
  }
  await ctx.close();
})();
