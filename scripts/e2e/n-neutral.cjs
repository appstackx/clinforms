// Neutral wording: every customer-facing surface (pages, dialogs, tooltips, aria-labels, titles,
// placeholders, downloads and their file names) is free of vendor, model and technology terms.
// Runs after a-forms, b-megan, c-d and e-misc (uses the forms, reports and final files they made).
const L = require("./lib.cjs");
const F = require("./flows.cjs");
const { execFileSync } = require("child_process");
const P = process.env.PFX || "n";

(async () => {
  const { ctx, page, problems, net } = await L.open({});
  const all = [];
  const scan = async (p, label) => {
    const hits = await L.neutralScan(p, label);
    all.push(...hits.map((h) => `${label}: ${h}`));
    return hits;
  };
  const scanText = (text, label) => {
    const hits = L.bannedIn(text);
    if (hits.length) console.log(`   BANNED in ${label}:`, JSON.stringify(Array.from(new Set(hits)).slice(0, 8)));
    all.push(...hits.map((h) => `${label}: ${h}`));
    return hits;
  };

  await L.step("N1 Studio pages, mode badge and its dialog", async () => {
    for (const path of ["/reports", "/reports/forms", "/reports/templates", "/reports/batch", "/reports/security", "/reports/new"]) {
      await page.goto(`${L.BASE}${path}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1200);
      await scan(page, path);
    }
    await page.goto(`${L.BASE}/reports`);
    await page.waitForLoadState("networkidle");
    const badge = page.getByRole("button", { name: /^Drafting mode:/ });
    await badge.waitFor({ timeout: 15000 });
    console.log("   badge:", await badge.innerText(), "| aria:", await badge.getAttribute("aria-label"));
    L.assert(/Demo mode/.test(await badge.innerText()), "the badge says Demo mode");
    await badge.click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    console.log("   dialog:", (await dlg.innerText()).replace(/\n+/g, " | "));
    await L.shot(page, `${P}-01-mode-dialog`, false);
    await scan(page, "drafting mode dialog");
    await page.keyboard.press("Escape");
    await page.locator("summary", { hasText: "Demo tools" }).click();
    await page.waitForTimeout(300);
    await scan(page, "demo tools");
    const sec = await (await page.goto(`${L.BASE}/reports/security`), page.locator("main").innerText());
    L.assert(/What the drafting service receives/.test(sec), "security: drafting service section");
    L.assert(/contracted sub-processor/.test(sec) && /not used for training/.test(sec) && /anonymised data only/.test(sec), "security: sub-processor, training, proof of concept");
    L.assert(!/zero retention|not retained|never stored/i.test(sec), "security: no zero-retention claim");
    await L.shot(page, `${P}-02-security`);
  });

  await L.step("N2 form upload and analysis (Meridian sample), mapping screens", async () => {
    const file = L.path.join(L.SP, "e2e", "meridian-sample.docx");
    const res = await fetch(`${L.BASE}/api/reports/v1/forms/samples/meridian-discharge-report/file`);
    L.fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    await page.goto(`${L.BASE}/reports/forms`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Upload a referrer form" }).first().click();
    await page.locator("[role=dialog] input[type=file]").setInputFiles(file);
    await page.getByRole("button", { name: /^Analyse (form|again)$/ }).waitFor({ timeout: 15000 });
    await scan(page, "upload dialog (ready)");
    await page.getByRole("button", { name: /^Analyse (form|again)$/ }).click();
    await page.getByRole("button", { name: /Review the mapping/ }).waitFor({ timeout: 90000 });
    const dlg = (await page.getByRole("dialog").innerText()).replace(/\n+/g, " | ");
    console.log("   analysed:", dlg.slice(0, 700));
    L.assert(/Prepared demo reading/.test(dlg), "the recorded reading is labelled as a prepared demo reading");
    await L.shot(page, `${P}-03-analysed`, false);
    await scan(page, "upload dialog (analysed)");
    await page.getByRole("button", { name: /Review the mapping/ }).click();
    await page.waitForURL(/\/reports\/forms\/[^/]+$/, { timeout: 20000 });
    await page.waitForTimeout(2500);
    await scan(page, "mapping screen (Meridian)");
    await L.shot(page, `${P}-04-mapping`);
    const ids = await page.evaluate(() => JSON.parse(localStorage.getItem("medreport.forms") || "[]").map((f) => f.id));
    for (const id of ids) {
      await page.goto(`${L.BASE}/reports/forms/${id}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      await scan(page, `mapping ${id}`);
    }
  });

  await L.step("N3 new form for Daniel: data step, what the drafting service receives, progress, review", async () => {
    const app = await F.launch(ctx, page, "sim-pat-002");
    await app.waitForTimeout(800);
    await app.getByRole("button", { name: /See exactly what the drafting service receives/ }).click();
    await app.locator("#ai-payload-body pre").waitFor({ timeout: 20000 });
    const panel = (await app.locator("#ai-payload-body").innerText()).replace(/\n+/g, " | ");
    console.log("   panel:", panel.slice(0, 300));
    L.assert(/exactly as the drafting service receives it/.test(panel), "record caption");
    L.assert(/Calculated by code from the record/.test(await app.locator("main").innerText()), "calculated-by-code heading");
    await scan(app, "data step + payload panel");
    await L.shot(app, `${P}-05-payload`, false);
    await app.getByRole("button", { name: "Choose the referrer form" }).click();
    await app.waitForTimeout(500);
    await scan(app, "form step");
    await app.getByRole("radio", { name: /Kingsway/ }).click();
    await app.getByRole("button", { name: "Complete this form" }).click();
    // The progress list shows briefly before the review opens.
    const progress = await app
      .waitForFunction(() => /Prepared demo draft|Loading the prepared demo answers|Drafting answers from/.test(document.body.innerText), null, { timeout: 30000 })
      .then(() => app.locator("main").innerText())
      .catch(() => "");
    if (progress) {
      console.log("   progress:", progress.replace(/\n+/g, " | ").slice(0, 500));
      scanText(progress, "draft progress");
    }
    await app.waitForURL(/\/reports\/(?!new)[^/?]+$/, { timeout: 120000 });
    await app.locator("[id^='q-F-']").first().waitFor({ timeout: 20000 });
    await app.waitForTimeout(1500);
    await scan(app, "review (Daniel, Kingsway)");
    const badge = app.locator("header button", { hasText: /Prepared demo draft|Sample draft|Drafted from the notes/ }).first();
    const label = await badge.innerText();
    console.log("   generation badge:", label);
    L.assert(/^Prepared demo draft \(\d{2}\/\d{2}\/\d{4}\)/.test(label), "generation badge wording");
    await badge.hover();
    await app.waitForTimeout(700);
    const tip = await app.locator("[role=tooltip]").first().innerText().catch(() => "");
    console.log("   tooltip:", tip.replace(/\n+/g, " | "));
    L.assert(/drafted \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(tip), "tooltip lists when each group was drafted");
    scanText(tip, "generation tooltip");
    await L.shot(app, `${P}-06-badge-tooltip`, false);
    const pills = await app.locator("main").innerText();
    L.assert(/\bDraft\b/.test(pills), "origin pill 'Draft'");
    for (const tab of [/Sources/, /Flags/, /Activity/, /Preview/]) {
      await app.getByRole("tab", { name: tab }).first().click();
      await app.waitForTimeout(tab.source === "Preview" ? 4000 : 700);
      await scan(app, `review tab ${tab.source}`);
    }
    // Draft copy download (file name and contents).
    const [dl] = await Promise.all([app.waitForEvent("download", { timeout: 60000 }), app.getByRole("button", { name: /Draft copy/ }).first().click()]);
    const draftPath = L.path.join(L.OUT, `neutral-draft-${dl.suggestedFilename()}`);
    await dl.saveAs(draftPath);
    console.log("   draft copy:", dl.suggestedFilename());
    scanText(dl.suggestedFilename(), "draft copy file name");
  });

  await L.step("N4 every stored report's review screen and Activity", async () => {
    const ids = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("medreport.report.")).map((k) => k.slice("medreport.report.".length)));
    const fallback = ids.length ? ids : await page.evaluate(() => (JSON.parse(localStorage.getItem("medreport.reports") || "[]") || []).map((r) => r.id));
    console.log("   reports:", fallback.length);
    for (const id of fallback.slice(0, 12)) {
      await page.goto(`${L.BASE}/reports/${id}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      await scan(page, `review ${id}`);
      const act = page.getByRole("tab", { name: /Activity/ }).first();
      if (await act.count()) {
        await act.click();
        await page.waitForTimeout(500);
        await scan(page, `activity ${id}`);
      }
    }
  });

  await L.step("N5 Export case JSON carries no vendor or model names", async () => {
    await page.goto(`${L.BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const btns = page.getByRole("button", { name: /^Export case JSON for / });
    const n = await btns.count();
    L.assert(n > 0, "an export button");
    for (let i = 0; i < Math.min(n, 6); i++) {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), btns.nth(i).click()]);
      const file = L.path.join(L.OUT, `neutral-case-${i}.json`);
      await dl.saveAs(file);
      const text = L.fs.readFileSync(file, "utf8");
      const vendor = text.match(/claude|anthropic|opus-\d/gi) || [];
      console.log(`   ${dl.suggestedFilename()}: ${text.length} bytes, vendor/model strings: ${vendor.length}`);
      scanText(dl.suggestedFilename(), "case file name");
      L.assert(vendor.length === 0, `case export ${dl.suggestedFilename()} has no vendor/model strings`);
    }
  });

  await L.step("N6 final and draft documents (Word / PDF) and their file names", async () => {
    const files = L.fs.readdirSync(L.OUT).filter((f) => /\.(docx|pdf)$/.test(f));
    L.assert(files.length > 0, "documents to check");
    for (const f of files) {
      const full = L.path.join(L.OUT, f);
      let text = "";
      if (f.endsWith(".pdf")) text = execFileSync("pdftotext", ["-layout", full, "-"], { encoding: "utf8" }) + "\n" + execFileSync("pdfinfo", [full], { encoding: "utf8" });
      else {
        const list = execFileSync("unzip", ["-Z1", full], { encoding: "utf8" }).split("\n").filter((n) => /\.xml$/.test(n));
        // unzip treats [ ] * ? in member names as wildcards ("[Content_Types].xml"): escape them.
        text = list
          .map((n) => execFileSync("unzip", ["-p", full, n.replace(/[[\]*?]/g, "\\$&")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(/<[^>]+>/g, " "))
          .join("\n");
      }
      const hits = scanText(text, `document ${f}`);
      scanText(f, "document file name");
      console.log(`   ${f}: ${text.length} chars, ${hits.length} hits`);
    }
  });

  await L.step("N7 simulated TM3 sandbox pages", async () => {
    for (const path of ["/pms-sandbox", "/pms-sandbox/patients/sim-pat-001", "/pms-sandbox/patients/sim-pat-002"]) {
      await page.goto(`${L.BASE}${path}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
      await scan(page, path);
      const docs = page.getByRole("tab", { name: /Documents/ });
      if (await docs.count()) {
        await docs.click();
        await page.waitForTimeout(600);
        await scan(page, `${path} documents`);
      }
    }
  });

  await L.step("N8 nothing customer-facing names a vendor, model or the technology", async () => {
    const unique = Array.from(new Set(all));
    console.log(`   ${unique.length} banned-term hits`);
    unique.slice(0, 40).forEach((h) => console.log("   -", h));
    L.assert(unique.length === 0, "no banned terms");
  });

  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("NET>=400:\n" + net.join("\n"));
  await ctx.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
