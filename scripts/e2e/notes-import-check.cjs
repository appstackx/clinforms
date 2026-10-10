/**
 * Notes import in a clinic's own Studio (production wave 3), in the browser – LOCAL database only.
 *
 * A clinic is created beforehand with `npm run admin:create-clinic` against the same local SQLite database the app
 * uses (its output file holds the owner's invitation link). The owner accepts the invitation, sets up two-step
 * verification, then in /app/studio/new uploads each FICTIONAL fixture (scripts/medreport/write-notes-fixtures.ts):
 *
 *   practice-printout.pdf        two-page printout → review (insurer offered as who the form is for) → confirm
 *   treatment-letter.docx        letter → review: the letter's signature names its entries (warned) → confirm
 *   treatment-record-table.docx  Word notes table → review → confirm
 *   appointments-export.csv      one row per appointment → review with attendance → confirm
 *   email-notes.txt              email-style notes → review → choose the missing clinician → confirm
 *   pasted practice printout     review → confirm
 *   pasted uncertain notes       review: confirm blocked → fill date of birth, name, who the form is for, clinician → confirm
 *   pasted documented layout     → straight to "Check what was imported" (no review)
 *   fix wave 3 – the exports a clinic actually has:
 *   clinical-notes-report.pdf    practice-system report: footer dropped, admin note left out, DNA read, "Mark the
 *                                others as attended", consent "Needed for approval", other details → confirm
 *   booking-export.csv           "Appointment start" column, late cancellation → who the form is for typed → confirm
 *   progress-letter.docx         addressee, bulleted attendance (no times: not counted), dated outcome table, the
 *                                letter's date offered → confirm
 *
 * and checks each lands on "Check what was imported" with the expected counts, nothing about the notes is kept in
 * browser storage, the review fits a 375 px screen, and the clinic's activity lists "Patient notes imported".
 *
 * Run (app on a local SQLite database, see the wave 3 notes in src/modules/medreport/README.md):
 *   INVITE_FILE=<create-clinic output> INPUTS=<fixtures dir> BASE=http://localhost:3141 RUN_ID=<n> \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/notes-import-check.cjs
 * State (the fictional test account's password and authenticator key) goes to E2E_OUT/state.json (chmod 600) and is
 * never printed; screenshots and results to E2E_OUT (default .e2e-out/notes-import/, gitignored).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const BASE = (process.env.BASE || "http://localhost:3141").replace(/\/+$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("Run this against a local server only");
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "notes-import");
const INPUTS = process.env.INPUTS || path.join(OUT, "inputs");
const STATE_FILE = path.join(OUT, "state.json");
const N = process.env.RUN_ID;
if (!N) throw new Error("RUN_ID is required");
const inviteFile = process.env.INVITE_FILE;
if (!inviteFile) throw new Error("INVITE_FILE is required");
const inviteLink = (fs.readFileSync(inviteFile, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
if (!inviteLink || !inviteLink.startsWith(BASE)) throw new Error("No local invitation link in INVITE_FILE");

fs.mkdirSync(OUT, { recursive: true });
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
const OWNER = { email: `zz-w3-owner-${N}@example.com`, name: "Nia Notes (fictional)" };
state[OWNER.email] ??= { password: `Zz-${crypto.randomBytes(12).toString("base64url")}-w3` };
save();

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
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
async function freshCode() {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    const window = Math.floor(Date.now() / 30000);
    if (left > 3000 && state.lastWindow !== window) {
      state.lastWindow = window;
      return totp(state[OWNER.email].key);
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
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)${detail ? ` – ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message).slice(0, 600) });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 600)}`);
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });

  await step("owner accepts the invitation and sets up two-step verification", async () => {
    await page.goto(inviteLink);
    await page.waitForSelector("text=Create your account");
    await page.fill("#f-name", OWNER.name);
    await page.fill("#f-password", state[OWNER.email].password);
    await page.fill("#f-confirm", state[OWNER.email].password);
    await page.click("button[type=submit]");
    await page.waitForURL(`${BASE}/two-factor`, { timeout: 30000 });
    await page.waitForSelector("button:has-text('Set up two-step verification')");
    await page.fill("#f-password", state[OWNER.email].password);
    await page.click("button[type=submit]");
    await page.waitForSelector("img[alt^='Authenticator set-up code']");
    state[OWNER.email].key = (await page.locator("code").first().innerText()).trim();
    save();
    await page.check("input[name=saved]");
    await page.fill("#f-code", await freshCode());
    await page.click("button[type=submit]");
    await page.waitForURL(`${BASE}/app`, { timeout: 30000 });
  });

  const openNew = async () => {
    await page.goto(`${BASE}/app/studio/new`);
    await page.waitForSelector("text=Drop the patient's notes here", { timeout: 30000 });
  };
  const imported = async () => {
    await page.waitForSelector("h2:has-text('Check what was imported')", { timeout: 30000 });
    return (await page.locator("p:has-text('Imported from')").first().innerText()).replace(/\s+/g, " ").trim();
  };
  const restart = async () => {
    await page.getByRole("button", { name: "Choose another patient" }).click();
    await page.waitForSelector("text=Drop the patient's notes here");
  };
  const waitReview = async () => {
    await page.waitForSelector("[data-testid=notes-review]", { timeout: 30000 });
    return (await page.locator("[data-testid=notes-review-summary]").innerText()).trim();
  };
  const blockers = async () => ((await page.locator("[data-testid=notes-review-blockers]").count()) ? (await page.locator("[data-testid=notes-review-blockers]").innerText()).trim() : "");
  const confirmEnabled = async () => !(await page.locator("[data-testid=notes-review-confirm]").isDisabled());

  const uploadCases = [
    { file: "practice-printout.pdf", summary: "4 entries · 2 clinicians · 7 outcome scores", imported: /3 notes · 4 appointments · 7 scores/, check: async () => {
      assert((await page.locator("#notes-reg-instructingPartyName").inputValue()) === "Northgate Health Insurance (fictional)", "insurer offered as who the form is for");
      assert(/insurer line – check it/.test(await page.locator("[data-field=instructingPartyName]").innerText()), "insurer hint shown");
      assert((await page.locator("#notes-reg-dob").inputValue()) === "1984-09-14", "date of birth found");
    } },
    { file: "treatment-letter.docx", summary: "4 entries · 1 clinician · 5 outcome scores", imported: /4 notes · 0 appointments · 5 scores/, check: async () => {
      assert(/The letter is signed by Sarah Reid, so the 3 entries that name no clinician have that clinician/.test(await page.locator("[data-testid=notes-review-warnings]").innerText()), "letter: signature applied, with a warning");
      assert((await blockers()) === "", "letter: nothing blocks");
      assert(/Use the letter's date \(09\/10\/2026\)/.test(await page.locator("[data-entry-key=E-1]").innerText()), "the letter's date is offered for its undated paragraph");
    } },
    { file: "clinical-notes-report.pdf", summary: "6 entries · 2 clinicians · 5 outcome scores", imported: /5 notes · 6 appointments · 5 scores/, check: async () => {
      const text = await page.locator("[data-testid=notes-review]").innerText();
      assert(!/CONFIDENTIAL|AP-004127|Page \d of \d/.test(text), "the running footer is in no note");
      assert(/Attendance is set for 1 of 6 entries/.test(await page.locator("[data-testid=notes-review-attendance]").innerText()), "partial attendance said plainly");
      assert(/Needed for approval/.test(await page.locator("[data-field=consent]").innerText()), "consent asked for");
      assert(/Case: Lower back - injury at work/.test(await page.locator("[data-testid=notes-review-other-details]").innerText()), "other details shown");
      assert((await page.locator("#notes-reg-membershipNumber").inputValue()) === "NFA-88213407", "policy number read");
      assert((await page.locator("#notes-reg-postcode").inputValue()) === "ZZ3 9LT", "address continuation read");
      assert(!(await page.locator("[data-entry-key=E-4] input[type=checkbox]").isChecked()), "the admin note is left out");
    }, fix: async () => {
      await page.getByRole("button", { name: "Mark the others as attended" }).click();
      assert((await page.locator("[data-testid=notes-review-attendance]").count()) === 0, "attendance complete");
      assert(/Attendance is taken from the status/.test(await page.locator("[data-testid=notes-review]").innerText()), "attendance counted");
    } },
    { file: "booking-export.csv", summary: "6 entries · 1 clinician · 5 outcome scores", imported: /4 notes · 6 appointments · 5 scores/, fix: async () => {
      assert(/enter who the form is for/.test(await blockers()), "booking export: who the form is for asked for, in plain words");
      await page.fill("#notes-reg-instructingPartyName", "Northfield Assurance (fictional)");
      await page.selectOption("#notes-reg-instructingPartyType", "insurer");
      assert((await page.locator("[data-entry-key=E-4] select[id$='-status']").inputValue()) === "LCN", "late cancellation read");
    } },
    { file: "progress-letter.docx", summary: "6 entries · 1 clinician · 4 outcome scores", imported: /6 notes · 0 appointments · 4 scores/, check: async () => {
      assert(/6 appointments have no time/.test(await page.locator("[data-testid=notes-review-attendance]").innerText()), "no times: attendance not counted, said plainly");
      assert((await page.locator("#notes-reg-instructingPartyName").inputValue()) === "Northfield Assurance (fictional)", "the letter's addressee offered");
      assert((await page.locator("#notes-reg-authorisationNumber").inputValue()) === "AUTH-60412", "authorisation from the Re: line");
      const scores = await page.locator("[data-testid=notes-review-scores]").innerText();
      assert(/QuickDASH 22\.7 · 12\/08\/2026/.test(scores) && /QuickDASH 54\.5 · 01\/07\/2026/.test(scores), `dated table columns: ${scores}`);
    } },
    { file: "treatment-record-table.docx", summary: "3 entries · 1 clinician · 3 outcome scores", imported: /3 notes · 0 appointments · 3 scores/ },
    { file: "appointments-export.csv", summary: "5 entries · 1 clinician · 3 outcome scores", imported: /3 notes · 5 appointments · 3 scores/, check: async () => {
      assert(/Attendance is taken from the status/.test(await page.locator("[data-testid=notes-review]").innerText()), "attendance from the status column");
    } },
    { file: "email-notes.txt", summary: "3 entries · 2 clinicians · 2 outcome scores", imported: /3 notes · 0 appointments · 2 scores/, fix: async () => {
      assert(/1 entry without a clinician – choose one/.test(await blockers()), "email: one clinician missing");
      const row = page.locator("[data-entry-key=E-2]");
      await row.locator("select[id$='-clinician']").selectOption({ label: "Sarah Reid" });
    } },
  ];

  for (const c of uploadCases) {
    await step(`upload ${c.file} → check the notes → confirm`, async () => {
      await openNew();
      await page.setInputFiles("input[type=file]", path.join(INPUTS, c.file));
      const summary = await waitReview();
      await shot(page, `review-${c.file}`);
      assert(summary === c.summary, `${c.file}: summary "${summary}"`);
      if (c.check) await c.check();
      if (c.fix) await c.fix();
      assert(await confirmEnabled(), `${c.file}: confirm enabled (${await blockers()})`);
      await page.locator("[data-testid=notes-review-confirm]").click();
      const line = await imported();
      assert(c.imported.test(line), `${c.file}: "${line}"`);
      await restart();
      return line;
    });
  }

  await step("paste the practice printout → check → confirm", async () => {
    await openNew();
    await page.fill("#paste-notes", fs.readFileSync(path.join(INPUTS, "paste-practice.txt"), "utf8"));
    await page.getByRole("button", { name: "Use pasted notes" }).click();
    const summary = await waitReview();
    assert(summary === "4 entries · 2 clinicians · 7 outcome scores", summary);
    await page.locator("[data-testid=notes-review-confirm]").click();
    const line = await imported();
    assert(/Pasted notes \(checked\)/.test(line) && /3 notes · 4 appointments · 7 scores/.test(line), line);
    await restart();
    return line;
  });

  await step("pasted notes with uncertain details: nothing guessed, confirm blocked until staff fill them in", async () => {
    await openNew();
    await page.fill("#paste-notes", fs.readFileSync(path.join(INPUTS, "paste-uncertain.txt"), "utf8"));
    await page.getByRole("button", { name: "Use pasted notes" }).click();
    await waitReview();
    for (const id of ["firstName", "lastName", "dob", "phone", "postcode", "membershipNumber"]) {
      assert((await page.locator(`#notes-reg-${id}`).inputValue()) === "", `${id} left blank`);
    }
    const warn = await page.locator("[data-testid=notes-review-warnings]").innerText();
    assert(/two-digit year/.test(warn) && /written as a range/.test(warn), `warnings: ${warn}`);
    assert(!(await confirmEnabled()), "confirm blocked");
    await shot(page, "review-uncertain-before");
    await page.fill("#notes-reg-firstName", "Ruth");
    await page.fill("#notes-reg-lastName", "Example");
    await page.fill("#notes-reg-dob", "1985-04-03");
    await page.fill("#notes-reg-instructingPartyName", "Calder & Moss Solicitors (fictional)");
    await page.selectOption("#notes-reg-instructingPartyType", "solicitor");
    await page.locator("[data-entry-key=E-1] select[id$='-clinician']").selectOption({ label: "P. Shah" });
    assert(await confirmEnabled(), `still blocked: ${await blockers()}`);
    await page.locator("[data-testid=notes-review-confirm]").click();
    const line = await imported();
    assert(/2 notes · 0 appointments · 0 scores/.test(line), line);
    const shown = await page.locator("main").innerText();
    assert(/Ruth Example/.test(shown) && /03\/04\/1985/.test(shown), "the details staff typed are used");
    await restart();
    return line;
  });

  await step("pasted notes in the documented layout go straight to the record (no review)", async () => {
    await openNew();
    await page.fill("#paste-notes", fs.readFileSync(path.join(INPUTS, "paste-documented.txt"), "utf8"));
    await page.getByRole("button", { name: "Use pasted notes" }).click();
    const line = await imported();
    assert((await page.locator("[data-testid=notes-review]").count()) === 0, "no review step");
    assert(/2 notes · 0 appointments · 2 scores/.test(line), line);
    return line;
  });

  await step("nothing about the notes is kept in browser storage", async () => {
    const stored = await page.evaluate(() => {
      const out = [];
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i)}=${s.getItem(s.key(i))}`);
      return out.join("\n");
    });
    assert(!/Quill|Bramble|Fenwick|Pemberly|Hartley|Larch Avenue|NGH-4471|Tate|Holloway|Dhaliwal|NFA-88213407/.test(stored), "notes content in storage");
    return `${stored.split("\n").filter(Boolean).length} storage entries, none with notes content`;
  });

  await step("the review fits a 375 px screen", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openNew();
    await page.setInputFiles("input[type=file]", path.join(INPUTS, "practice-printout.pdf"));
    await waitReview();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, "review-375");
    await page.setViewportSize({ width: 1280, height: 900 });
    assert(overflow <= 1, `horizontal overflow ${overflow}px`);
  });

  await step("the clinic's activity lists the imports (counts only)", async () => {
    await page.goto(`${BASE}/app/settings/activity`);
    await page.waitForSelector("text=Activity");
    const body = await page.locator("main").innerText();
    const n = (body.match(/Patient notes imported/g) || []).length;
    await shot(page, "activity");
    assert(n >= 11, `expected 11 imports, saw ${n}`);
    assert(/checked before use/.test(body) && /from a PDF/.test(body) && /from a Word document/.test(body) && /from a CSV export/.test(body), "detail lines");
    assert(!/Quill|Bramble|Northgate|practice-printout/.test(body), "no patient details or file names in the activity");
    return `${n} imports listed`;
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, problems }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed${problems.length ? `; ${problems.length} problems: ${problems.slice(0, 10).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
