// LIVE mode, detailed: passcode typed into the UI (read from .env.local, never printed), then
//   L2 live analysis of the Meridian form (compared with the recorded map) + confirm,
//   L3 Megan -> Harrow & Pike live drafting, L4 Megan -> Northfield live drafting,
//   L5 (optional, STEPS includes 5) Megan -> the just-analysed Meridian map, live.
// Every report is checked: generation mode live, every drafted paragraph cited, prognosis-type
// questions blank + gap, blocking flags other than gaps, leftover abbreviations, first person, and a
// neutral-wording scan of each screen. Writes JSON results to $OUTDIR (default <SP>/live-runs/<RUN>).
const L = require("./lib.cjs");
const F = require("./flows.cjs");
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(require("path").resolve(__dirname, "../../.env.local"), "utf8");
const PASS = (env.match(/^MEDREPORT_LIVE_PASSCODE=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const RUN = process.env.RUN || "run1";
const STEPS = (process.env.STEPS || "2,3,4").split(",");
const OUTDIR = process.env.OUTDIR || path.join(L.SP, "live-runs", RUN);
fs.mkdirSync(OUTDIR, { recursive: true });
const recordedMeridian = require("../../src/modules/medreport/ai/recorded/forms/meridian-discharge-report.json");

const summary = { run: RUN, steps: {} };
const neutralHits = [];
async function scan(p, label) {
  const hits = await L.neutralScan(p, label);
  neutralHits.push(...hits.map((h) => `${label}: ${h}`));
}

function captureApi(p, sink) {
  p.on("response", async (r) => {
    const u = r.url();
    if (!/\/api\/reports\/v1\/(drafts|forms\/analyse)/.test(u)) return;
    const started = r.request().timing ? r.request().timing().startTime : 0;
    try {
      const body = await r.json();
      sink.push({ url: u.replace(L.BASE, ""), status: r.status(), body, at: Date.now(), started });
    } catch {
      sink.push({ url: u.replace(L.BASE, ""), status: r.status(), body: null, at: Date.now() });
    }
  });
}

function abbreviations(text) {
  const skip = new Set(["GP", "HR", "II", "III", "IV", "I", "HCPC", "MCSP", "NHS", "UK"]);
  return Array.from(new Set((text.match(/\b[A-Z][A-Z0-9]{1,6}s?\b/g) || []).filter((t) => !skip.has(t) && !/^[CLTS]\d/.test(t))));
}

function checkReport(rep, opinionKeys) {
  const out = { id: rep.id, form: rep.form && rep.form.title, author: rep.author && rep.author.name };
  out.generation = rep.generation.map((g) => ({ mode: g.mode, keys: g.sectionKeys.join("+"), ms: g.durationMs, effort: g.effort, v: g.promptVersion, usage: g.usage }));
  const ai = [];
  for (const s of rep.sections) for (const p of s.paragraphs || []) if (p.origin === "ai") ai.push({ key: s.key, p });
  out.aiParagraphs = ai.length;
  out.uncited = ai.filter((x) => !(x.p.sourceIds || []).length).map((x) => x.key);
  out.firstPerson = ai.filter((x) => /\b(I|my|me)\b/.test(x.p.text)).length;
  out.thirdPersonAuthor = rep.author ? ai.filter((x) => x.p.text.includes(rep.author.name)).length : 0;
  out.abbreviations = abbreviations(ai.map((x) => x.p.text).join(" "));
  out.opinion = {};
  for (const k of opinionKeys) {
    const s = rep.sections.find((x) => x.key === k);
    const gaps = rep.gaps.filter((g) => g.sectionKey === k && !g.resolved);
    out.opinion[k] = {
      title: s && s.title,
      paragraphs: s ? (s.paragraphs || []).filter((p) => p.text.trim()).length : -1,
      answer: s && s.answer ? s.answer.value : undefined,
      gaps: gaps.length,
    };
  }
  const blocking = (rep.flags || []).filter((f) => f.severity === "blocking");
  out.blockingCodes = blocking.reduce((m, f) => ((m[f.code] = (m[f.code] || 0) + 1), m), {});
  out.otherBlocking = blocking.filter((f) => !["OPEN_GAP", "MISSING_PLACEHOLDER"].includes(f.code)).map((f) => `${f.code} [${f.sectionKey}] ${f.evidence || ""}`);
  out.texts = rep.sections.map((s) => ({ key: s.key, title: s.title, status: s.status, answer: s.answer, paras: (s.paragraphs || []).map((p) => `(${p.origin}; ${(p.sourceIds || []).join(",")}) ${p.text}`) }));
  out.gaps = rep.gaps.map((g) => `${g.sectionKey}: ${g.issue}`);
  return out;
}

async function draftFor(ctx, page, patientId, formRe, label, opinionKeys) {
  const api = [];
  const app = await F.launch(ctx, page, patientId);
  captureApi(app, api);
  await app.getByRole("button", { name: "Choose the referrer form" }).click();
  await app.waitForTimeout(500);
  await app.getByRole("radio", { name: formRe }).click();
  await scan(app, `${label}: choose form`);
  const t = Date.now();
  await app.getByRole("button", { name: "Complete this form" }).click();
  await app.waitForTimeout(1500);
  const during = (await app.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 500);
  await scan(app, `${label}: completing`);
  await L.shot(app, `live-${RUN}-${label}-completing`, false);
  let sawWait = false;
  const poll = setInterval(async () => {
    try { if (/at its limit for this minute/.test(await app.locator("main").innerText())) sawWait = true; } catch {}
  }, 1000);
  await app.waitForFunction(() => /\/reports\/(?!new)[^/?]+$/.test(location.pathname) || /could not be drafted/.test(document.body.innerText), null, { timeout: 240000 });
  clearInterval(poll);
  if (/\/reports\/new/.test(app.url())) {
    console.log("   FAILURE NOTICE:", (await app.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 900));
    await L.shot(app, `live-${RUN}-${label}-failed`, false);
    await app.getByRole("link", { name: /Open for review/ }).click();
    await app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 30000 });
  }
  await app.locator("[id^='q-F-']").first().waitFor({ timeout: 30000 });
  const ms = Date.now() - t;
  await app.waitForTimeout(2000);
  await L.shot(app, `live-${RUN}-${label}-review`, false);
  await scan(app, `${label}: review`);
  const header = (await app.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 400);
  const rep = await F.reportJson(app);
  const res = checkReport(rep, opinionKeys);
  res.clickToReviewMs = ms;
  res.waitedForSlot = sawWait;
  res.during = during;
  res.header = header;
  res.draftCalls = api.filter((a) => /drafts/.test(a.url)).map((a) => ({ status: a.status, mode: a.body && a.body.generation && a.body.generation.mode, ms: a.body && a.body.generation && a.body.generation.durationMs, keys: a.body && a.body.generation && a.body.generation.sectionKeys.join("+"), code: a.body && a.body.code }));
  // Flags tab and Preview tab, scanned for wording.
  res.flagsText = (await F.flagsText(app)).slice(0, 1500);
  await scan(app, `${label}: flags tab`);
  await app.getByRole("tab", { name: "Preview" }).click();
  await app.waitForTimeout(6000);
  await scan(app, `${label}: preview tab`);
  await L.shot(app, `live-${RUN}-${label}-preview`, false);
  fs.writeFileSync(path.join(OUTDIR, `${label}.json`), JSON.stringify({ ...res, report: rep }, null, 2));
  const { texts, ...brief } = res;
  console.log(`   ${label}:`, JSON.stringify(brief, null, 0).slice(0, 2500));
  await app.close();
  return res;
}

(async () => {
  const { ctx, page, problems, net } = await L.open({ profile: `live-${RUN}`, fresh: true });
  await L.step("L0 health reports live available", async () => {
    const h = await (await fetch(`${L.BASE}/api/reports/v1/health`)).json();
    console.log("   health:", JSON.stringify(h));
    summary.health = h;
  });
  await L.step("L1 enter passcode in the UI", async () => {
    await page.goto(`${L.BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^Drafting mode:/ }).click();
    await scan(page, "mode dialog (before passcode)");
    await page.locator("#medreport-passcode").fill(PASS);
    await page.locator("#medreport-passcode").press("Enter");
    await page.waitForTimeout(800);
    await scan(page, "mode dialog (after passcode)");
    await L.shot(page, `live-${RUN}-01-passcode`, false);
    await page.keyboard.press("Escape");
    const badge = await page.getByRole("button", { name: /^Drafting mode:/ }).innerText();
    console.log("   badge:", badge);
    L.assert(/Live drafting/.test(badge), "badge says Live drafting");
    await scan(page, "home (live)");
  });
  if (STEPS.includes("2")) {
    await L.step("L2 live analysis of Meridian + compare with the recorded map + confirm", async () => {
      const api = [];
      captureApi(page, api);
      await page.goto(`${L.BASE}/reports/forms`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2500);
      await page.getByRole("button", { name: "Upload a referrer form" }).first().click();
      await page.locator("[role=dialog] input[type=file]").setInputFiles(`${L.SP}/demo-forms/Meridian-Claims_Physiotherapy-Discharge-Report_MCS-PDR-3.docx`);
      await page.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 10000 });
      const t = Date.now();
      await page.getByRole("button", { name: /^Analyse form$/ }).click();
      await page.waitForTimeout(1500);
      await scan(page, "upload dialog (analysing)");
      await L.shot(page, `live-${RUN}-02a-analysing`, false);
      await page.waitForFunction(() => /Review the mapping|could not be analysed|Try again/.test(document.querySelector("[role=dialog]")?.textContent || ""), null, { timeout: 150000 });
      const ms = Date.now() - t;
      const dlg = (await page.locator("[role=dialog]").innerText()).replace(/\n+/g, " | ");
      console.log("   analysis ended after", ms, "ms");
      console.log("   dialog:", dlg.slice(0, 900));
      await scan(page, "upload dialog (analysed)");
      await L.shot(page, `live-${RUN}-02b-analysed`, false);
      const a = api.find((x) => /forms\/analyse/.test(x.url));
      const form = a && a.body && a.body.form;
      const rec = recordedMeridian.form;
      const cmp = { clickToResultMs: ms, status: a && a.status, analysis: form && form.analysis && { mode: form.analysis.mode, model: form.analysis.model, ms: form.analysis.durationMs, usage: form.analysis.usage, warnings: form.analysis.warnings } };
      if (form) {
        cmp.fieldCount = { live: form.fields.length, recorded: rec.fields.length };
        const key = (f) => `${f.anchor.blockId || f.anchor.fieldName || ""}|${f.anchor.target || f.anchor.kind}`;
        const recBy = new Map(rec.fields.map((f) => [key(f), f]));
        cmp.diffs = [];
        for (const f of form.fields) {
          const r = recBy.get(key(f));
          if (!r) { cmp.diffs.push(`NEW ${f.id} ${f.label} ${f.answerType} ${f.fillSource.kind} @${key(f)}`); continue; }
          const d = [];
          if (r.answerType !== f.answerType) d.push(`type ${r.answerType}->${f.answerType}`);
          if (r.fillSource.kind !== f.fillSource.kind) d.push(`source ${r.fillSource.kind}->${f.fillSource.kind}`);
          if (JSON.stringify(r.fillSource) !== JSON.stringify(f.fillSource) && r.fillSource.kind === f.fillSource.kind) d.push(`source detail ${JSON.stringify(r.fillSource)}->${JSON.stringify(f.fillSource)}`);
          if (r.required !== f.required) d.push(`required ${r.required}->${f.required}`);
          if (r.label !== f.label) d.push(`label "${r.label}" -> "${f.label}"`);
          if (d.length) cmp.diffs.push(`${f.id}: ${d.join("; ")}`);
          recBy.delete(key(f));
        }
        for (const [k, r] of recBy) cmp.diffs.push(`MISSING (in recorded) ${r.id} ${r.label} @${k}`);
        cmp.fields = form.fields.map((f) => `${f.id} | ${f.section || ""} | ${f.label} | ${f.answerType} ${f.required ? "req" : "opt"} | ${JSON.stringify(f.fillSource)} | ${JSON.stringify(f.anchor)} | ${f.confidence}`);
        cmp.title = form.title;
        cmp.referrer = form.referrer;
      }
      summary.steps.L2 = cmp;
      fs.writeFileSync(path.join(OUTDIR, "meridian-analysis.json"), JSON.stringify({ cmp, response: a && a.body }, null, 2));
      console.log("   compare:", JSON.stringify({ ...cmp, fields: undefined }).slice(0, 2500));
      L.assert(cmp.analysis && cmp.analysis.mode === "live", "the analysis ran live");
      await page.getByRole("button", { name: /Review the mapping/ }).click();
      await page.waitForURL(/\/reports\/forms\/.+/);
      await page.locator(".mr-preview section.docx").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
      await scan(page, "mapping screen (live Meridian)");
      await L.shot(page, `live-${RUN}-02c-mapping`);
      await page.getByRole("button", { name: /^Confirm mapping$/ }).first().click();
      await page.locator("#confirm-by").fill("Sarah Reid");
      await page.locator("[role=dialog] input[type=checkbox], [role=dialog] button[role=checkbox]").first().click();
      await scan(page, "confirm mapping dialog");
      await page.locator("[role=dialog]").getByRole("button", { name: /Confirm mapping/ }).click();
      await page.getByText(/Mapping confirmed by Sarah Reid/).waitFor({ timeout: 10000 });
    });
  }
  if (STEPS.includes("3")) {
    await L.step("L3 Megan -> Harrow & Pike, live drafting", async () => {
      summary.steps.L3 = await draftFor(ctx, page, "sim-pat-001", /Harrow & Pike/, "megan-harrow", ["F-13", "F-14", "F-15", "F-16"]);
    });
  }
  if (STEPS.includes("4")) {
    await L.step("L4 Megan -> Northfield (fillable PDF), live drafting", async () => {
      summary.steps.L4 = await draftFor(ctx, page, "sim-pat-001", /Northfield Assurance/, "megan-northfield", ["F-12", "F-13", "F-14", "F-16", "F-17"]);
    });
  }
  if (STEPS.includes("5")) {
    await L.step("L5 Megan -> Meridian (live-analysed map), live drafting", async () => {
      summary.steps.L5 = await draftFor(ctx, page, "sim-pat-001", /Meridian/, "megan-meridian", ["F-11", "F-12", "F-13", "F-14"]);
    });
  }
  summary.neutralHits = neutralHits;
  summary.problems = problems;
  summary.net = net;
  fs.writeFileSync(path.join(OUTDIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("NEUTRAL HITS:", neutralHits.length, JSON.stringify(neutralHits.slice(0, 20)));
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
