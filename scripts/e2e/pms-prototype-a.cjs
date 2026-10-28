/**
 * Prototype A (design round 2h, approved 28/10/2026 – "Book, arrive, write & sign note") end to end in the browser –
 * LOCAL only, on a fresh demo seed:
 *
 *   npm run pms:seed-demo -- --fresh --app-url http://localhost:3186 > seed.out   # owner invitation in seed.out
 *   npm run build && PORT=3186 npm run start
 *   SEED_LOG=seed.out BASE=http://localhost:3186 E2E_OUT=<dir> SQLITE_PATH=<the server's scratch SQLite> \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-prototype-a.cjs
 *
 * The flow, as reception (Jess Taylor) and the physiotherapist (Priya Shah), one screenshot per step at 1440 px:
 *   0. the owner sets Priya's signing details on Member access (HCPC number) – the new "Signing details" screen;
 *   1. reception opens today's diary at a seeded site and clicks a free slot → the booking dialog;
 *   2. creates a NEW patient: the duplicate check stops a near-copy of an existing record first, then the new
 *      patient (Nadia Hussain, fictional) is saved and booked; the block appears;
 *   3. the patient arrives: reception marks her Arrived;
 *   4. Priya opens the drawer → Start treatment: status "In treatment" and the clinical note opens, linked to the
 *      appointment;
 *   5. Priya writes the SOAP note with a body-chart marker → Sign and lock (with "Mark appointment as completed");
 *   6. the appointment reads "Completed"; reception cannot reach the note and the record has no clinical tab.
 *
 * SQLITE_PATH: the one direct write – linking Priya's account to the seeded practitioner whose column is booked
 * (and clearing that record's registration number, so the owner sets it on the screen). There is no screen for
 * linking a member to a practitioner yet. Scratch database only (refused unless under a temporary folder).
 * Fictional data only; nothing secret is printed (random passwords and codes stay in memory).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3186";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-prototype-a");
const SEED_LOG = process.env.SEED_LOG;
const SQLITE = process.env.SQLITE_PATH || process.env.CLINFORMS_SQLITE_PATH || "";
const RUN = crypto.randomBytes(3).toString("hex");
const DIARY = `${BASE}/app/clinic/diary`;
const SIGNING_NUMBER = "PH-DEMO-08";

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

// The clinic system's TEST clock (src/modules/pms/core/clock.ts – never in a production build): when the runner
// sets PMS_TEST_CLOCK=1 PMS_TEST_NOW PMS_TEST_NOW_SET_AT for the seed, the dev server and this script, all three
// agree on "now" (e.g. 10:30 today), so the steps that need clinic hours pass at any hour. Two-step codes keep
// the real clock.
const CLOCK_OFFSET = process.env.PMS_TEST_CLOCK === "1" && process.env.PMS_TEST_NOW && process.env.PMS_TEST_NOW_SET_AT ? Date.parse(process.env.PMS_TEST_NOW) - Number(process.env.PMS_TEST_NOW_SET_AT) : 0;
const clockNow = () => Date.now() + CLOCK_OFFSET;

function totp(key, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}
async function freshCode(key) {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(key);
}

const results = [];
const failPages = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 600)}`);
    for (const [who, page] of failPages) await page.screenshot({ path: path.join(OUT, `fail-${results.length}-${who}.png`) }).catch(() => {});
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function onboard(page, invite, name) {
  const password = `e2e ${crypto.randomBytes(12).toString("base64url")} password`;
  await page.goto(invite);
  await page.waitForSelector("text=Create your account");
  await page.fill("#f-name", name);
  await page.fill("#f-password", password);
  await page.fill("#f-confirm", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/two-factor`);
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = base32Decode(await page.locator("code").first().innerText());
  await page.check("input[name=saved]");
  await page.fill("#f-code", await freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/app`);
}

async function invite(owner, email, role) {
  await owner.goto(`${BASE}/app/settings/members`);
  await owner.fill("input[name=email]", email);
  await owner.selectOption("form:has(input[name=email]) select[name=role]", role);
  await owner.click("button[type=submit]:has-text('Invite')");
  const code = owner.locator("code").filter({ hasText: "/accept-invite?token=" }).last();
  await code.waitFor({ timeout: 20000 });
  return (await code.innerText()).trim();
}

/** Links the member with `email` to a seeded practitioner (scratch SQLite only – see the top of this file). */
function linkPractitioner(email, practitionerId, displayName) {
  if (!SQLITE || !/^\/(private\/)?(tmp|var\/folders)\//.test(SQLITE)) throw new Error("SQLITE_PATH must be a scratch database under /tmp");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(SQLITE);
  try {
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
    if (!user) throw new Error("no such member");
    const r = db
      .prepare("UPDATE pms_practitioners SET user_id = ?, display_name = ?, registration_number = NULL WHERE id = ? AND user_id IS NULL")
      .run(user.id, displayName, practitionerId);
    if (r.changes !== 1) throw new Error(`practitioner not linked (${r.changes})`);
  } finally {
    db.close();
  }
}

async function viewData(page, query) {
  const res = await page.request.get(`${DIARY}/api/view?${query}`);
  assert(res.ok(), `view ${res.status()}`);
  return (await res.json()).data;
}

/** Clicks the empty grid at `minute` in column `index` (opens the booking dialog). */
async function clickSlot(page, index, minute) {
  const col = page.locator("main [role=group][aria-label^='Appointments'] > div[role=group]").nth(index);
  await col.scrollIntoViewIfNeeded();
  const box = await col.boundingBox();
  const first = await page.locator("main [aria-hidden] > span.absolute").first().innerText();
  const [h, m] = first.split(":").map(Number);
  const y = box.y + ((minute - (h * 60 + m)) * 80) / 60 + 6;
  await page.mouse.click(box.x + box.width / 2, y);
}

const ready = (page) => page.waitForSelector("[data-diary-ready=true]");
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk();
  const jess = await mk();
  const priya = await mk();
  failPages.push(["owner", owner], ["reception", jess], ["clinician", priya]);
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const priyaEmail = `zz-proto-priya-${RUN}@example.com`;
  const s = { site: null, practitionerId: null, practitioner: null, columnIndex: -1, minute: null, today: null, apptId: null, patientId: null, noteUrl: null };

  try {
    await step("set-up: owner and reception (Jess) accounts with two-step", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-proto-jess-${RUN}@example.com`, "staff");
      await onboard(jess, r, "Jess Taylor (fictional)");
    });

    await step("set-up: today's diary at a seeded site – a physiotherapist with 45 free minutes later today; her account (clinician, two-step) linked to her record", async () => {
      await jess.goto(DIARY);
      await ready(jess);
      const first = await viewData(jess, "");
      s.today = first.params.date;
      const sites = first.sites.map((x) => x.id);
      const now = new Date(clockNow());
      const nowMinute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(now)) * 60 + now.getMinutes();
      const seen = [];
      /** A slot with free time for 45 minutes after it (the list holds one slot per step). */
      const room45 = (c, x) => {
        const starts = new Set(c.freeSlots.map((y) => y.startMinute));
        const stepMin = x.endMinute - x.startMinute;
        for (let m = x.startMinute; m < x.startMinute + 45; m += stepMin) if (!starts.has(m)) return false;
        return true;
      };
      for (const site of sites) {
        const data = await viewData(jess, `date=${s.today}&site=${site}`);
        seen.push(data.columns.map((c) => `${c.label}:${c.practitionerId ? "p" : "-"}:${c.freeSlots.slice(0, 3).map((x) => `${x.startMinute}-${x.endMinute}`).join(",")}`).join(" | "));
        for (let i = 0; i < data.columns.length && s.site === null; i++) {
          const c = data.columns[i];
          if (!c.practitionerId) continue;
          // Free slots are listed one appointment length each: two in a row hold a 45-minute initial assessment.
          // Within the next hour: "Arrived" opens 60 minutes before the start (handover §13.4 item 2).
          const slot = c.freeSlots.find((x) => x.startMinute % 15 === 0 && x.startMinute >= nowMinute + 5 && x.startMinute <= nowMinute + 50 && room45(c, x));
          if (slot) Object.assign(s, { site, practitionerId: c.practitionerId, practitioner: c.label, columnIndex: i, minute: slot.startMinute });
        }
        if (s.site) break;
      }
      assert(s.site, `a practitioner with a free 45-minute slot in the next hour (now ${nowMinute}, today ${s.today}, sites ${sites.length}: ${seen.join(" || ")})`);
      // The physiotherapist ("Priya" in the design) is the seeded practitioner of that column: her account is made with
      // that name and linked to the record (no screen links a member to a practitioner yet).
      const c = await invite(owner, priyaEmail, "clinician");
      await onboard(priya, c, s.practitioner);
      linkPractitioner(priyaEmail, s.practitionerId, s.practitioner);
    });

    await step("0. owner: Member access → Signing details – HCPC number for Priya (the new screen); Priya sees it on My account", async () => {
      await owner.goto(`${BASE}/app/clinic/access`);
      await owner.click(`main a:has-text("${s.practitioner}")`);
      await owner.waitForSelector("h2:has-text('Signing details')");
      await owner.selectOption("#sign-body", "HCPC");
      await owner.fill("#sign-number", SIGNING_NUMBER);
      await owner.check("label:has-text('May sign clinical notes') input");
      await owner.click("button:has-text('Save signing details')");
      await owner.waitForSelector("text=Signing details saved.");
      await owner.locator("section[aria-labelledby=sign-h]").scrollIntoViewIfNeeded();
      await shot(owner, "00-owner-signing-details");
      await priya.goto(`${BASE}/app/clinic/account`);
      await priya.waitForSelector(`[data-testid=signing-number]:has-text("${SIGNING_NUMBER}")`);
      await shot(priya, "00b-priya-my-account");
    });

    await step("1. reception: today's diary at the site; click the free slot → booking dialog", async () => {
      await jess.goto(`${DIARY}?date=${s.today}&site=${s.site}`);
      await ready(jess);
      await jess.locator(`main >> text=${s.practitioner} >> visible=true`).first().waitFor();
      await shot(jess, "01-reception-diary-today");
      await clickSlot(jess, s.columnIndex, s.minute);
      await jess.waitForSelector("role=dialog >> text=New appointment");
      assert((await jess.inputValue("#bk-tm")) === hhmm(s.minute), `start time ${hhmm(s.minute)}`);
      assert((await jess.inputValue("#bk-pr")) === s.practitionerId, "Priya prefilled");
      await shot(jess, "02-booking-dialog");
    });

    await step("2. new patient: no match for Nadia Hussain; the duplicate check stops a copy of an existing record; Nadia is created and booked", async () => {
      await jess.fill("#bk-search", "Nadia Hussain");
      await jess.waitForSelector("text=/No patient found yet/");
      await shot(jess, "03-no-match");
      // The duplicate check: an existing patient's name and date of birth as a "new" patient is stopped.
      await jess.fill("#bk-search", "Megan Hart");
      const hit = jess.locator("[role=option]:has-text('Megan Hart')").first();
      await hit.waitFor();
      const dob = ((await hit.innerText()).match(/DOB (\d{2}\/\d{2}\/\d{4})/) || [])[1];
      assert(dob, "Megan's date of birth in the search");
      await jess.click("role=dialog >> button:has-text('Create new')");
      await jess.fill("#np-f", "Megan");
      await jess.fill("#np-l", "Hart");
      await jess.fill("#np-d", dob);
      const ia = await jess.locator("#bk-svc option", { hasText: /Initial/ }).first().getAttribute("value");
      if (ia) await jess.selectOption("#bk-svc", ia);
      await jess.waitForSelector("text=Slot available");
      await jess.click("role=dialog >> button:has-text('Book appointment')");
      await jess.waitForSelector("text=Possible existing record");
      await shot(jess, "04-duplicate-check");
      // The real new patient.
      await jess.fill("#np-f", "Nadia");
      await jess.fill("#np-l", "Hussain");
      await jess.fill("#np-d", "12/05/1994");
      await jess.fill("#np-m", "07700 900526");
      await jess.fill("#np-e", `nadia.hussain.${RUN}@example.com`);
      await jess.waitForSelector("text=Slot available");
      await shot(jess, "05-new-patient-details");
      await jess.click("role=dialog >> button:has-text('Book appointment')");
      await jess.waitForSelector("text=Appointment booked");
      assert(/A new patient record has been created/.test(await jess.locator("role=dialog").innerText()), "new record created");
      await shot(jess, "06-booked-confirmation");
      await jess.click("text=Back to diary");
      await jess.waitForSelector(`button[data-status=booked]:has-text("Nadia Hussain")`);
      const data = await viewData(jess, `date=${s.today}&site=${s.site}`);
      const card = data.cards.find((c) => c.patientName === "Nadia Hussain");
      assert(card && card.practitionerId === s.practitionerId && card.status === "booked", "Nadia booked with Priya");
      s.apptId = card.id;
      s.patientId = card.patientId;
      await jess.locator(`button[data-status=booked]:has-text("Nadia Hussain")`).scrollIntoViewIfNeeded();
      await shot(jess, "07-block-in-diary");
    });

    await step("3. reception: Nadia arrives – open her appointment, mark Arrived", async () => {
      await jess.click(`button[data-status=booked]:has-text("Nadia Hussain")`);
      await jess.waitForSelector("aside[aria-label='Appointment details'] >> text=Quick actions");
      await shot(jess, "08-drawer-booked");
      await jess.click("aside button:has-text('Arrived')");
      await jess.waitForSelector("[role=status] >> text=marked as arrived");
      await jess.waitForSelector(`button[data-status=arrived]:has-text("Nadia Hussain")`);
      await shot(jess, "09-arrived");
    });

    await step("4. Priya: her diary shows Arrived; drawer → Start treatment → In treatment, the note opens linked to the appointment", async () => {
      await priya.goto(`${DIARY}?date=${s.today}&site=${s.site}`);
      await ready(priya);
      await priya.click(`button[data-status=arrived]:has-text("Nadia Hussain")`);
      await priya.waitForSelector("aside button:has-text('Start treatment')");
      await shot(priya, "10-priya-drawer-arrived");
      await priya.click("aside button:has-text('Start treatment')");
      await priya.waitForURL(/\/patients\/[^/]+\/notes\/note_[0-9A-Z]+$/, { timeout: 30000 });
      s.noteUrl = priya.url().replace(BASE, "");
      assert(s.noteUrl.includes(s.patientId), "Nadia's note");
      const data = await viewData(priya, `date=${s.today}&site=${s.site}`);
      assert(data.cards.find((c) => c.id === s.apptId).status === "in_treatment", "status In treatment");
      await priya.waitForSelector("text=Unsigned draft");
      await shot(priya, "11-note-open-in-treatment");
    });

    await step("5. Priya: SOAP note with a body-chart marker → Sign and lock (Mark appointment as completed)", async () => {
      const sel = await priya.locator("#note-template").inputValue();
      if (sel !== "builtin-initial-soap") {
        await priya.selectOption("#note-template", "builtin-initial-soap");
        await priya.click("[role=alertdialog] button:has-text('Switch template')");
        await priya.waitForSelector("#section-subjective", { timeout: 20000 });
      }
      await priya.fill("#section-subjective", "L knee pain 3/52 after increasing running to 30 km/week (fictional). Pain around the kneecap on stairs and after runs, 5/10. No swelling, locking or giving way.");
      for (const flag of ["Weight loss", "Fever", "Trauma"]) {
        const box = priya.locator(`label:has-text('${flag} – none') input`);
        if (await box.count()) await box.check();
      }
      await priya.fill("#section-objective", "Squat reproduces pain at 60°. Single-leg squat: dynamic valgus R>L. Patellar tap −. Ligament tests normal. Hip abduction strength 4/5.");
      await priya.fill("#section-assessment", "Patellofemoral pain related to training load. No red flags.");
      await priya.fill("#section-plan", "Load advice: reduce to 15 km/week, no hills for 2 weeks. Hip and quad strengthening programme. Review in 2 weeks.");
      await priya.click("button:has-text('Add marker')");
      await priya.fill("#marker-0-label", "Left knee, anterior (patellofemoral)");
      await priya.selectOption("#marker-0-score", "5");
      await priya.waitForSelector("text=/Draft saved \\d{2}:\\d{2}/", { timeout: 20000 });
      await shot(priya, "12-soap-and-body-chart");
      await priya.click("button:has-text('Sign and lock')");
      await priya.waitForSelector("[role=alertdialog] >> text=Sign this note?");
      const complete = priya.locator("[role=alertdialog] label:has-text('Mark appointment as completed') input");
      assert((await complete.count()) === 1 && (await complete.isChecked()), "Mark appointment as completed, ticked");
      await shot(priya, "13-sign-confirm");
      await priya.click("[role=alertdialog] button:has-text('Sign and lock')");
      await priya.waitForSelector("text=Signed and locked", { timeout: 30000 });
      const main = await priya.locator("main").innerText();
      assert(main.includes(SIGNING_NUMBER), "signed with Priya's registration number");
      await shot(priya, "14-signed-and-locked");
    });

    await step("6. the appointment reads Completed (attended); reception cannot reach the note and the record has no clinical tab", async () => {
      const data = await viewData(jess, `date=${s.today}&site=${s.site}`);
      assert(data.cards.find((c) => c.id === s.apptId).status === "attended", "status attended");
      await jess.goto(`${DIARY}?date=${s.today}&site=${s.site}`);
      await ready(jess);
      const block = jess.locator(`button[data-status=attended]:has-text("Nadia Hussain")`);
      await block.waitFor();
      assert(/Completed/.test(await block.innerText()), "the block reads Completed");
      await block.scrollIntoViewIfNeeded();
      await shot(jess, "15-diary-completed");
      const res = await jess.goto(`${BASE}${s.noteUrl}`);
      assert(res.status() === 404, `note URL as reception → ${res.status()}`);
      await jess.goto(`${BASE}/app/clinic/patients/${s.patientId}`);
      const tabs = (await jess.locator("nav[aria-label='Patient record sections']").innerText()).replace(/\s+/g, " ");
      for (const t of ["Clinical notes", "Outcomes", "Attachments"]) assert(!tabs.includes(t), `reception sees ${t}`);
      assert(/Appointments/.test(tabs) && /History/.test(tabs), `tabs: ${tabs}`);
      await shot(jess, "16-reception-record-no-clinical-tab");
      await jess.goto(`${BASE}/app/clinic/patients/${s.patientId}/appointments`);
      await jess.waitForSelector("main >> text=Completed");
      await shot(jess, "17-reception-appointments-tab");
    });

    await step("no product errors in the browser; no banned names on screen", async () => {
      assert(problems.length === 0, problems.join(" | "));
      for (const page of [owner, jess, priya]) {
        const text = await page.locator("body").innerText();
        assert(!/\bAI\b|OpenAI|Anthropic|Claude|GPT/.test(text), "no AI or vendor names");
      }
    });
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` – FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
