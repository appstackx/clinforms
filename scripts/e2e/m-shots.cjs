const L = require("./lib.cjs");
const W = Number(process.env.W || 390), H = Number(process.env.H || 844);
const P = process.env.PFX || "m";
(async () => {
  const { ctx, page, problems, net } = await L.open({ width: W, height: H });
  await page.goto(`${L.BASE}/reports`);
  await page.waitForLoadState("networkidle");
  const info = await page.evaluate(() => {
    const reps = Object.keys(localStorage).filter((k) => k.startsWith("medreport.report.")).map((k) => JSON.parse(localStorage.getItem(k)));
    const forms = JSON.parse(localStorage.getItem("medreport.forms") || "[]");
    return {
      approved: reps.filter((r) => r.signoff || r.status === "signed" || r.receipt).map((r) => ({ id: r.id, p: r.patientLabel, f: r.form?.title })),
      all: reps.map((r) => ({ id: r.id, p: r.patientLabel, f: r.form?.title, st: r.status })),
      hp: forms.find((f) => f.sampleId === "harrow-pike-treating-physio")?.id,
      nf: forms.find((f) => f.sampleId === "northfield-rehab-progress")?.id,
    };
  });
  console.log(JSON.stringify(info.all));
  const draft = info.all.find((r) => r.p === "Megan Hart" && r.st !== "signed" && /Treating/.test(r.f || ""));
  const signed = info.all.find((r) => r.st === "signed" && r.p === "Megan Hart");
  const pages = [
    ["01-home", "/reports"],
    ["02-forms", "/reports/forms"],
    ["03-map-harrow", `/reports/forms/${info.hp}`],
    ["04-map-northfield", `/reports/forms/${info.nf}`],
    ["05-new", "/reports/new"],
    ["06-review-draft", `/reports/${draft?.id}`],
    ["07-review-approved", `/reports/${signed?.id}`],
    ["08-batch", "/reports/batch"],
    ["09-templates", "/reports/templates"],
    ["10-sandbox", "/pms-sandbox"],
    ["11-sandbox-megan", "/pms-sandbox/patients/sim-pat-001"],
    ["12-security", "/reports/security"],
  ];
  for (const [n, p] of pages) {
    await L.step(`${P} ${n}`, async () => {
      await page.goto(`${L.BASE}${p}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2500);
      const o = await L.overflow(page);
      await L.shot(page, `${P}-${n}`, false);
      console.log(`   ${n} overflow=${o}px`);
      L.assert(o <= 0, `no horizontal overflow (${o}px)`);
    });
  }
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
