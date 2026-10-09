const L = require("./lib.cjs");
const OP = { "Treating Physiotherapist Report": ["F-13", "F-14", "F-15", "F-16"], "Rehabilitation Progress Report": ["F-12", "F-13", "F-14", "F-16", "F-17"], "Physiotherapy Discharge Report": ["F-11", "F-12", "F-13", "F-14"], "Return to Work Assessment": ["F-13", "F-14", "F-15", "F-16", "F-17", "F-18"] };
(async () => {
  const out = [];
  for (const profile of process.argv.slice(2)) {
    const { ctx, page } = await L.open({ profile });
    await page.goto(`${L.BASE}/reports`);
    const reps = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("medreport.report.")).map((k) => JSON.parse(localStorage.getItem(k))));
    for (const r of reps) {
      if (!r.generation.length || r.amends) continue;
      const modes = Array.from(new Set(r.generation.map((g) => g.mode)));
      const pt = r.bundleSnapshot.patient || r.bundleSnapshot.registration || {}; const name = r.patientLabel || pt.fullName || [pt.firstName, pt.lastName].filter(Boolean).join(" ") || r.bundleSnapshot.source.externalPatientId;
      const ai = r.sections.flatMap((s) => (s.paragraphs || []).filter((p) => p.origin === "ai" || (p.origin === "edited" && p.aiText)).map((p) => ({ k: s.key, t: p.aiText || p.text, src: p.sourceIds })));
      const op = {};
      for (const k of OP[r.form?.title] || []) {
        const s = r.sections.find((x) => x.key === k);
        const aiParas = (s?.paragraphs || []).filter((p) => p.origin === "ai" || p.aiText).length;
        const aiGap = r.gaps.some((g) => g.sectionKey === k && g.raisedBy === "ai");
        op[k] = `${aiParas}p${aiGap ? "+gap" : ""}`;
      }
      out.push({ profile, created: r.createdAt, patient: name, form: r.form?.title, author: r.author?.name, modes: modes.join(","), aiParas: ai.length, words: ai.reduce((n, x) => n + x.t.split(/\s+/).length, 0), uncited: ai.filter((x) => !x.src?.length).length, firstPerson: ai.filter((x) => /\b(I|my|me)\b/.test(x.t)).length, aiGaps: r.gaps.filter((g) => g.raisedBy === "ai").length, opinion: op });
    }
    await ctx.close();
  }
  out.sort((a, b) => (a.patient + a.form).localeCompare(b.patient + b.form) || a.created.localeCompare(b.created));
  for (const o of out) console.log(JSON.stringify(o));
})();
