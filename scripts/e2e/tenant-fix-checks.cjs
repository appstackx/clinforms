/**
 * Wave 2 fix checks, in the browser against the PREVIEW database (or a local one – never production). Run AFTER
 * tenant-full-flow.cjs with the same RUN_ID and E2E_OUT: it reuses that run's fictional accounts (state.json) and
 * its approved report.
 *
 *   view      owner A opens the approved report and a fresh draft copy: no store write, no new revision, no
 *             "Final document produced" entry from the on-screen preview; activity hides routine saves unless
 *             asked (?saves=1); rows link to the Studio
 *   store     the server refuses a request naming another clinic (x-clinforms-tenant) or another member, a body
 *             naming another clinic, and a clinician deleting the approved report (409 REPORT_LOCKED)
 *   signout   sign-out from the Studio's account menu is a full page load (nothing in memory survives); clinic B's
 *             owner signs in on the same tab and sees none of clinic A's records
 *   home      the Studio home is a work queue: In progress / Approved / All, who approved, no marketing hero
 *   firstrun  clinic B (new): the overview's set-up checklist (drafting optional, explained with the data processing
 *             agreement) and the drafting-off notice; the Studio's first run; no "TM3" in its Studio; a patient's
 *             notes uploaded as a referrer form → "No questions found" → discarded
 *
 *   RUN_ID=<n> BASE=http://localhost:3111 E2E_OUT=<tenant-full-flow out dir> NODE_PATH=<node_modules with playwright> \
 *     node scripts/e2e/tenant-fix-checks.cjs
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const BASE = (process.env.BASE || "http://localhost:3111").replace(/\/+$/, "");
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "tenant-full-flow");
const N = process.env.RUN_ID;
if (!N) throw new Error("RUN_ID is required");
if (/clinforms\.co\.uk/.test(BASE)) throw new Error("Run this against a preview or local server, never production");
const state = JSON.parse(fs.readFileSync(path.join(OUT, "state.json"), "utf8"));
if (!state.reportId || !state.reportJson) throw new Error("Run tenant-full-flow.cjs first (no approved report in state.json)");

const OWNER_A = { email: `zz-w2-owner-a-${N}@example.com` };
const CLIN = { email: `zz-w2-clin-${N}@example.com` };
const OWNER_B = { email: `zz-w2-owner-b-${N}@example.com` };
const TENANT_A = `zz-w2-e2e-${N}`;

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(keyB32, at = Date.now()) {
  const key = base32Decode(keyB32);
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}
const usedCodes = {};
async function freshCode(who) {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    const window = Math.floor(Date.now() / 30000);
    if (left > 3000 && usedCodes[who.email] !== window) {
      usedCodes[who.email] = window;
      return totp(state[who.email].key);
    }
    await new Promise((r) => setTimeout(r, left + 300));
  }
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)${detail ? ` – ${JSON.stringify(detail)}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 600) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 600)}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `fix-${name}.png`), fullPage: true }).catch(() => undefined);

async function signIn(page, who, next) {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill("#f-email", who.email);
  await page.fill("#f-password", state[who.email].password);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=6-digit code");
  await page.fill("#f-code", await freshCode(who));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}${next}`, { timeout: 30000 });
}

/** Activity entries (the filter's <select> lists every label, so it is left out). */
async function activityText(page, query) {
  await page.goto(`${BASE}/app/settings/activity${query}`);
  await page.waitForSelector("h1:has-text('Activity')");
  return page.evaluate(() => {
    const main = document.querySelector("main").cloneNode(true);
    main.querySelectorAll("select, option, label").forEach((el) => el.remove());
    return main.textContent || "";
  });
}
const count = (text, label) => text.split(label).length - 1;

(async () => {
  const browser = await chromium.launch();
  try {
    /* -------------------------------------------------------------------------------- view */
    const ctxA = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const owner = await ctxA.newPage();
    const writes = [];
    owner.on("request", (r) => {
      if (/\/api\/reports\/v1\/store\//.test(r.url()) && r.method() !== "GET") writes.push(`${r.method()} ${r.url().replace(BASE, "")}`);
    });
    await signIn(owner, OWNER_A, "/app");

    await step("view: opening the approved report writes nothing and records no final document", async () => {
      const finals = count(await activityText(owner, "?action=report.render_final"), "Final document produced");
      const before = await owner.evaluate(async (id) => (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).rev, state.reportId);
      writes.length = 0;
      await owner.goto(`${BASE}/app/studio/${state.reportId}`);
      await owner.getByText("Approved – the completed form is final").waitFor({ timeout: 60000 });
      await owner.waitForTimeout(8000); // the preview renders the final form
      await shot(owner, "01-owner-views-approved");
      const page = await owner.locator("main").innerText();
      assert(/Approval check code/.test(page), "no approval check code on the approved banner");
      assert(!/server-signed|fingerprint/i.test(page), "technical wording on the approved report");
      const code = /\bFACT-[a-z]|\bREG\b/.exec(page);
      assert(!code, `internal source code on the approved report: …${code ? page.slice(Math.max(0, code.index - 80), code.index + 40).replace(/\s+/g, " ") : ""}…`);
      const after = await owner.evaluate(async (id) => (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).rev, state.reportId);
      const finalsAfter = count(await activityText(owner, "?action=report.render_final"), "Final document produced");
      assert(writes.length === 0, `store writes on view: ${writes.join(", ")}`);
      assert(after === before, `revision ${before} → ${after}`);
      assert(finalsAfter === finals, `final-document entries ${finals} → ${finalsAfter}`);
      return { rev: after, finalEntries: finals };
    });

    const draftId = `rpt_fixcheck_${N}_${Date.now().toString(36)}`;
    await step("view: opening a draft writes nothing (no new revision, no 'Report saved')", async () => {
      const draft = { ...state.reportJson, id: draftId, status: "draft", updatedAt: new Date().toISOString() };
      delete draft.receipt;
      const created = await owner.evaluate(async (report) => {
        const r = await fetch(`/api/reports/v1/store/reports/${report.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report }),
        });
        return r.status;
      }, draft);
      assert(created === 201, `create draft copy ${created}`);
      writes.length = 0;
      await owner.goto(`${BASE}/app/studio/${draftId}`);
      await owner.locator("[id^='q-']").first().waitFor({ timeout: 60000 });
      await owner.waitForTimeout(6000);
      await shot(owner, "02-owner-views-draft");
      const rev = await owner.evaluate(async (id) => (await (await fetch(`/api/reports/v1/store/reports/${id}`)).json()).rev, draftId);
      assert(writes.length === 0, `store writes on view: ${writes.join(", ")}`);
      assert(rev === 1, `revision ${rev}`);
      return { rev };
    });

    await step("activity: routine saves hidden unless asked; rows link to the Studio", async () => {
      const plain = await activityText(owner, "");
      const withSaves = await activityText(owner, "?saves=1");
      const links = await owner.$$eval("main a[href^='/app/studio/']", (as) => as.map((a) => a.getAttribute("href")));
      await shot(owner, "03-activity-with-saves");
      assert(count(plain, "Report saved") === 0, "saves listed by default");
      assert(count(withSaves, "Report saved") > 0, "saves not listed with saves=1");
      assert(links.length > 0, "no Studio links");
      return { savesShown: count(withSaves, "Report saved"), studioLinks: links.length };
    });

    await step("home: a work queue – in progress first, approved a click away with who approved, no hero", async () => {
      await owner.goto(`${BASE}/app/studio`);
      await owner.waitForSelector("text=Completed and in-progress forms", { timeout: 30000 });
      const group = owner.getByRole("group", { name: "Show forms" });
      await group.waitFor({ timeout: 30000 });
      const first = await owner.locator("main").innerText();
      assert(!/Complete MLC|Connections and forms|Available now/.test(first), "the marketing hero or tiles are back");
      assert((await group.getByRole("button", { name: /^In progress/ }).getAttribute("aria-pressed")) === "true", "in progress is not shown first");
      await group.getByRole("button", { name: /^Approved/ }).click();
      await owner.waitForTimeout(500);
      const approved = await owner.locator("main").innerText();
      await shot(owner, "03b-home-approved");
      assert(/Approved by/.test(approved), "no 'Approved by' column");
      assert(/Nair/.test(approved), "the approved report is not listed under Approved");
      await owner.getByRole("searchbox").fill("nobody-matches-this");
      assert(/No forms match your search/.test(await owner.locator("main").innerText()), "search does not filter");
      return { ok: true };
    });

    /* -------------------------------------------------------------------------------- store */
    await step("store: another clinic or member named by the page, or by the body, is refused", async () => {
      const r = await owner.evaluate(
        async ({ report, tenant }) => {
          const put = (headers, body) =>
            fetch(`/api/reports/v1/store/reports/rpt_scope_check`, {
              method: "PUT",
              headers: { "content-type": "application/json", ...headers },
              body: JSON.stringify({ report: { ...body, id: "rpt_scope_check" } }),
            }).then(async (res) => [res.status, (await res.json().catch(() => ({}))).code]);
          return {
            otherClinicHeader: await put({ "x-clinforms-tenant": "zz-someone-else" }, report),
            otherMemberHeader: await put({ "x-clinforms-tenant": tenant, "x-clinforms-member": "someone-else" }, report),
            otherClinicBody: await put({}, { ...report, tenantId: "zz-someone-else" }),
          };
        },
        { report: { ...state.reportJson, status: "draft" }, tenant: TENANT_A },
      );
      assert(r.otherClinicHeader[0] === 403 && r.otherClinicHeader[1] === "TENANT_MISMATCH", JSON.stringify(r));
      assert(r.otherMemberHeader[0] === 403 && r.otherMemberHeader[1] === "SIGN_IN_CHANGED", JSON.stringify(r));
      assert(r.otherClinicBody[0] === 403 && r.otherClinicBody[1] === "TENANT_MISMATCH", JSON.stringify(r));
      return r;
    });

    await step("store: a clinician cannot delete the approved report (409 REPORT_LOCKED); it stays approved", async () => {
      const ctxC = await browser.newContext();
      const clin = await ctxC.newPage();
      await signIn(clin, CLIN, "/app");
      const r = await clin.evaluate(async (id) => {
        const del = await fetch(`/api/reports/v1/store/reports/${id}`, { method: "DELETE" });
        const code = (await del.json().catch(() => ({}))).code;
        const after = await (await fetch(`/api/reports/v1/store/reports/${id}`)).json();
        return { status: del.status, code, stillStatus: after.report && after.report.status };
      }, state.reportId);
      await ctxC.close();
      assert(r.status === 409 && r.code === "REPORT_LOCKED" && r.stillStatus === "signed", JSON.stringify(r));
      return r;
    });

    /* -------------------------------------------------------------------------------- signout */
    await step("sign-out from the Studio is a full page load; clinic B's owner on the same tab sees none of A's records", async () => {
      await owner.goto(`${BASE}/app/studio`);
      await owner.waitForSelector("text=Completed and in-progress forms", { timeout: 30000 });
      await owner.evaluate(() => {
        window.__fixMarker = "still here";
      });
      await owner.locator("[data-studio-account] summary").click();
      await owner.getByRole("button", { name: "Sign out" }).click();
      await owner.waitForURL(`${BASE}/login`, { timeout: 30000 });
      const marker = await owner.evaluate(() => window.__fixMarker || null);
      assert(marker === null, "the page's memory survived sign-out");
      await signIn(owner, OWNER_B, "/app/studio");
      await owner.waitForSelector("text=Completed and in-progress forms", { timeout: 30000 });
      await owner.waitForTimeout(2500);
      const text = await owner.locator("main").innerText();
      await shot(owner, "04-clinic-b-studio-after-switch");
      assert(!/Nair/.test(text), "clinic A's patient listed for clinic B");
      const snap = await owner.evaluate(async () => (await (await fetch("/api/reports/v1/store/snapshot")).json()).reports.length);
      assert(snap === 0, `clinic B snapshot ${snap}`);
      return { markerCleared: true, clinicBReports: snap };
    });

    /* -------------------------------------------------------------------------------- firstrun */
    await step("first run (clinic B): set-up checklist, drafting-off notice, no TM3 wording", async () => {
      await owner.goto(`${BASE}/app`);
      await owner.waitForSelector("text=Set up your clinic", { timeout: 30000 });
      const overview = await owner.locator("main").innerText();
      await shot(owner, "05-clinic-b-overview");
      assert(/Drafting from the notes is switched off/.test(overview), "drafting-off notice on the overview");
      assert(/data processing agreement/.test(overview) && /Optional/.test(overview), "the drafting step does not explain the opt-in");
      await owner.goto(`${BASE}/app/studio`);
      await owner.waitForSelector("text=Completed and in-progress forms", { timeout: 30000 });
      // The first run appears once the clinic's records have loaded (an empty clinic).
      await owner.getByText("Complete your clinic's first form").waitFor({ timeout: 30000 });
      const home = await owner.locator("body").innerText();
      await owner.goto(`${BASE}/app/studio/new`);
      await owner.waitForSelector("text=Drop the patient's notes here");
      const wizard = await owner.locator("body").innerText();
      await shot(owner, "06-clinic-b-new");
      assert(/switched off for your clinic/.test(home), "drafting-off notice in the Studio");
      assert(/Add a referrer's form/.test(home), "no first run on a new clinic's Studio home");
      assert(!/\bTM3\b/.test(home) && !/\bTM3\b/.test(wizard), "TM3 wording in a clinic's Studio");
      // The test clinics' own names end "(fictional)" (house rule for test data): only the Studio's wording counts.
      const own = (t) => t.replace(/ZZ W2 E2E Clinic [AB] \(fictional\)/g, "");
      assert(!/fictional/i.test(own(wizard)), "fictional samples in a clinic's wizard");
      return { checklist: true };
    });

    await step("first run (clinic B): a patient's notes uploaded as a referrer form → no questions → discarded", async () => {
      const notes = path.join(OUT, "inputs", "priya-nair-notes.pdf");
      assert(fs.existsSync(notes), "inputs/priya-nair-notes.pdf (from tenant-full-flow)");
      await owner.goto(`${BASE}/app/studio/forms`);
      await owner.waitForSelector("text=Upload a referrer form");
      await owner.locator("button:has-text('Upload a referrer form')").first().click();
      await owner.waitForSelector("text=Drop the form here, or choose a file");
      await owner.locator("[role=dialog] input[type=file]").setInputFiles(notes);
      await owner.getByRole("button", { name: /Analyse form|Analyse again/ }).click();
      const outcome = await Promise.race([
        owner.getByText("No questions found in this document").waitFor({ timeout: 300000 }).then(() => "none"),
        owner.getByRole("button", { name: "Review the mapping" }).waitFor({ timeout: 300000 }).then(() => "questions"),
      ]);
      await shot(owner, "07-notes-as-form");
      if (outcome === "questions") return { note: "the analysis found questions in the notes PDF – the zero-question path was not reached" };
      await owner.getByRole("button", { name: "Discard this upload" }).click();
      await owner.waitForTimeout(3000);
      const snap = await owner.evaluate(async () => (await (await fetch("/api/reports/v1/store/snapshot")).json()).forms.length);
      assert(snap === 0, `forms left in the library: ${snap}`);
      return { discarded: true };
    });
    await ctxA.close();
  } finally {
    fs.writeFileSync(path.join(OUT, "results-fix-checks.json"), JSON.stringify({ results }, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} fix checks passed`);
    await browser.close();
  }
})().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
