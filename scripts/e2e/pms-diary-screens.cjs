/**
 * Browser check of the diary screens (LOCAL only – design round 2): day and week views, the booking dialog, the
 * appointment drawer, moves by keyboard and drag, statuses with Undo (booked → arrived → in treatment → completed),
 * double-booking a practitioner with "Override clashes" (dialog and Shift+Enter; rooms never), late cancellation with the fee, recurring
 * bookings with a skipped date, the rota and waiting-list page, the printed day sheet (dates of birth only when the
 * clinic's setting is on), the phone diary at 375 px, keyboard-only use, an axe check of each screen, and what
 * reception, a clinician and the owner may do.
 *
 *   npm run pms:seed-demo -- --fresh   (scratch SQLite; prints the owner's invitation → SEED_LOG)
 *   SEED_LOG=… BASE=http://localhost:3184 E2E_OUT=… \
 *     NODE_PATH=<node_modules with playwright and axe-core> node scripts/e2e/pms-diary-screens.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed (random passwords, codes in memory). Dates: the
 * demo week is the week of 26/10/2026; bookings are made on the following Mondays (rota time, no seed data).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3184";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-diary");
const SEED_LOG = process.env.SEED_LOG;
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const DIARY = `${BASE}/app/clinic/diary`;
const MON1 = "2026-11-02";
const MON3 = "2026-11-16";

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

/** axe-core on the page (WCAG 2.1 A/AA): serious and critical findings fail. */
async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(" ") }));
  });
  const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
  axeReport.push({ label, found });
  assert(bad.length === 0, `${label}: ${JSON.stringify(bad)}`);
}
const axeReport = [];

/** The diary grid's data for a day (the same route the screen uses). */
async function viewData(page, query) {
  const res = await page.request.get(`${DIARY}/api/view?${query}`);
  assert(res.ok(), `view ${res.status()}`);
  return (await res.json()).data;
}

/** Clicks the empty grid at `minute` in column `index` (opens the booking dialog). */
async function clickSlot(page, index, minute) {
  const col = page.locator("main [role=group][aria-label^='Appointments'] > div[role=group]").nth(index);
  const box = await col.boundingBox();
  const first = await page.locator("main [aria-hidden] > span.absolute").first().innerText();
  const [h, m] = first.split(":").map(Number);
  const y = box.y + ((minute - (h * 60 + m)) * 80) / 60 + 6;
  await page.mouse.click(box.x + box.width / 2, y);
}

/** The diary is interactive once its client code runs (keyboard handlers attached). */
const ready = (page) => page.waitForSelector("[data-diary-ready=true]");

async function pickPatient(page, q, name) {
  await page.fill("#bk-search", q);
  await page.locator(`[role=option]:has-text("${name}")`).first().click();
  await page.waitForSelector(`text=Chosen:`);
}

(async () => {
  assert(SEED_LOG, "SEED_LOG is required (the output of pms:seed-demo)");
  fs.mkdirSync(OUT, { recursive: true });
  const ownerInvite = (fs.readFileSync(SEED_LOG, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  assert(ownerInvite, "no owner invitation in the seed log");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const problems = [];
  const owner = await mk();
  const reception = await mk();
  const clinician = await mk();
  failPages.push(["owner", owner], ["reception", reception], ["clinician", clinician]);
  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  let site = null;
  let sarah = null;
  let doubleAt = null;

  try {
    await step("owner, reception and clinician accounts (two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-diary-reception-${RUN}@example.com`, "staff");
      const c = await invite(owner, `zz-diary-clinician-${RUN}@example.com`, "clinician");
      await onboard(reception, r, "Jess Taylor (fictional)");
      await onboard(clinician, c, "Priya Shah (fictional)");
    });

    await step("navigation by role: Diary for all; Rotas (set-up, diary.rota) for the owner and reception; the clinician gets the 404 page for rotas", async () => {
      for (const [page, rota] of [[owner, true], [reception, true], [clinician, false]]) {
        await page.goto(DIARY);
        const labels = await page.locator("nav[aria-label='Clinic system'] a").allInnerTexts();
        assert(labels.includes("Diary"), `Diary in nav: ${labels.join(", ")}`);
        assert(labels.includes("Rotas") === rota, `Rotas in nav = ${rota}: ${labels.join(", ")}`);
      }
      const res = await clinician.goto(`${DIARY}/rotas`);
      assert(res.status() === 404, `clinician /rotas: ${res.status()}`);
    });

    await step("day view (1440): practitioner columns with avatar and % booked, statuses as words, URL carries site and date", async () => {
      await owner.goto(`${DIARY}?date=2026-10-27`);
      await ready(owner);
      await owner.waitForSelector("text=Tuesday 27/10/2026");
      const headers = await owner.locator("main").innerText();
      assert(/% booked/.test(headers), "% booked in the headers");
      assert(/Completed|Booked/.test(headers), "status words on the blocks (attended reads Completed)");
      assert(!/\bAttended\b/.test(headers), "no Attended on screen");
      const data = await viewData(owner, "date=2026-10-27");
      site = data.site.id;
      sarah = data.columns.find((c) => c.practitionerId && c.windows.length > 0).practitionerId;
      await owner.goto(`${DIARY}?date=2026-10-27&site=${site}&cancelled=1`);
      await ready(owner);
      await owner.waitForSelector("[data-status=attended]");
      assert(/site=/.test(owner.url()) && /date=2026-10-27/.test(owner.url()), owner.url());
      await shot(owner, "1440-day-view");
      await axe(owner, "day view");
    });

    await step("rooms columns and the week view of one practitioner", async () => {
      await owner.goto(`${DIARY}?date=2026-10-27&site=${site}&by=room`);
      await ready(owner);
      await owner.waitForSelector("text=Room 1");
      await owner.goto(`${DIARY}?date=2026-10-27&site=${site}&view=week&resource=${sarah}`);
      await ready(owner);
      await owner.waitForSelector("text=This week:");
      const text = await owner.locator("main").innerText();
      assert(/Mon\s+26\/10/.test(text) && /appts/.test(text), "week columns");
      await shot(owner, "1440-week-view");
      await axe(owner, "week view");
    });

    let booked = null;
    await step("reception: click a free slot → booking dialog prefilled → book Megan Hart → the block appears", async () => {
      const data = await viewData(reception, `date=${MON1}&site=${site}`);
      // A quarter-hour slot that another practitioner also has free (the patient-only clash step needs one).
      let ci = -1;
      let slot = null;
      for (let i = 0; i < data.columns.length && !slot; i++) {
        for (const s of data.columns[i].freeSlots) {
          if (s.startMinute % 15 !== 0 || s.startMinute < 9 * 60) continue;
          if (data.columns.some((c, j) => j !== i && c.practitionerId && c.freeSlots.some((x) => x.startMinute === s.startMinute))) {
            ci = i;
            slot = s;
            break;
          }
        }
      }
      assert(slot, "a free quarter-hour slot that two practitioners share");
      booked = { ci, minute: slot.startMinute, practitionerId: data.columns[ci].practitionerId, practitioner: data.columns[ci].label };
      await reception.goto(`${DIARY}?date=${MON1}&site=${site}`);
      await ready(reception);
      await clickSlot(reception, ci, slot.startMinute);
      await reception.waitForSelector("role=dialog >> text=New appointment");
      const hh = `${String(Math.floor(slot.startMinute / 60)).padStart(2, "0")}:${String(slot.startMinute % 60).padStart(2, "0")}`;
      assert((await reception.inputValue("#bk-tm")) === hh, `start time prefilled ${hh}`);
      assert((await reception.inputValue("#bk-pr")) === booked.practitionerId, "practitioner prefilled");
      booked.time = hh;
      await pickPatient(reception, "Megan", "Megan Hart");
      await reception.waitForSelector("text=Slot available");
      await shot(reception, "1440-booking-dialog-free");
      await axe(reception, "booking dialog");
      await reception.click("role=dialog >> button:has-text('Book appointment')");
      await reception.waitForSelector("text=Appointment booked");
      await reception.click("text=Back to diary");
      await reception.waitForSelector(`[role=group] button:has-text("Megan Hart")`);
    });

    await step("open the drawer: details, Take payment (billing), and no Arrived / Completed for a future appointment (they open 60 minutes before)", async () => {
      await reception.click(`[role=group] button:has-text("Megan Hart")`);
      await reception.waitForSelector("aside[aria-label='Appointment details'] >> text=Quick actions");
      const drawer = await reception.locator("aside[aria-label='Appointment details']").innerText();
      for (const w of ["When", "Service", "With", "Payer", "Mobile", "Booked by Jess Taylor"]) assert(drawer.includes(w), `drawer has ${w}`);
      assert(await reception.locator("aside [data-testid=drawer-take-payment]").isEnabled(), "Take payment (billing, M5) is on");
      assert((await reception.locator("aside button:has-text('Arrived')").count()) === 0, "no Arrived for next week's appointment");
      assert((await reception.locator("aside button:has-text('Completed')").count()) === 0, "no Completed either");
      await reception.waitForSelector("aside [data-testid=future-status-note]");
      await shot(reception, "1440-drawer-booked");
      await axe(reception, "drawer");
    });

    await step("clash: another patient at the same time is refused (Resolve clash to book, no override for a practitioner)", async () => {
      await reception.keyboard.press("Escape");
      await reception.click("main button:visible:has-text('New appointment')");
      await reception.waitForSelector("role=dialog");
      await pickPatient(reception, "Daniel", "Daniel Brooks");
      await reception.selectOption("#bk-pr", booked.practitionerId);
      await reception.fill("#bk-dt", MON1);
      await reception.selectOption("#bk-tm", booked.time);
      await reception.waitForSelector("text=This time clashes");
      const text = await reception.locator("#bk-slot").innerText();
      assert(text.includes("Megan Hart") && !text.includes("megan hart"), `proper names: ${text}`);
      assert(/next free/.test(text), "next free slot offered");
      assert(await reception.locator("button:has-text('Resolve clash to book')").isDisabled(), "button blocked");
      assert((await reception.locator("text=Book anyway").count()) === 0, "no Book anyway for a practitioner clash");
      await shot(reception, "1440-booking-dialog-clash");
      await reception.keyboard.press("Escape");
    });

    await step("patient-only clash: reception may not book over it; the owner books anyway (logged)", async () => {
      const data = await viewData(owner, `date=${MON1}&site=${site}`);
      const other = data.columns.find((c) => c.practitionerId && c.practitionerId !== booked.practitionerId && c.freeSlots.some((s) => s.startMinute === booked.minute));
      assert(other, "another practitioner free at the same time");
      for (const [page, may] of [[reception, false], [owner, true]]) {
        await page.goto(`${DIARY}?date=${MON1}&site=${site}`);
      await ready(page);
        await page.click("main button:visible:has-text('New appointment')");
        await pickPatient(page, "Megan", "Megan Hart");
        await page.selectOption("#bk-pr", other.practitionerId);
        await page.selectOption("#bk-rm", "");
        await page.fill("#bk-dt", MON1);
        await page.selectOption("#bk-tm", booked.time);
        await page.waitForSelector("text=This time clashes");
        assert(/already has another appointment/.test(await page.locator("#bk-slot").innerText()), "patient's own appointment named");
        assert((await page.locator("text=Book anyway (double-booking is logged)").count()) === (may ? 1 : 0), `Book anyway shown = ${may}`);
        if (!may) {
          await page.keyboard.press("Escape");
          continue;
        }
        await page.check("text=Book anyway (double-booking is logged)");
        await page.click("role=dialog >> button:has-text('Book appointment')");
        await page.waitForSelector("text=Appointment booked");
        await page.click("text=Back to diary");
      }
    });

    await step("double-booking (decision A): the owner books a practitioner twice with Book anyway – logged, marked on both blocks; a room never", async () => {
      const DB = "2026-11-30";
      const data = await viewData(owner, `date=${DB}&site=${site}`);
      const col = data.columns.find((c) => c.practitionerId === booked.practitionerId);
      // Free slots come one appointment length each: three in a row leave room to move by 15 minutes.
      const starts = new Set(col.freeSlots.map((x) => x.startMinute));
      const free = col.freeSlots.find((x) => x.startMinute % 15 === 0 && x.startMinute >= 9 * 60 && starts.has(x.endMinute) && starts.has(x.endMinute + (x.endMinute - x.startMinute)));
      assert(free, "a free stretch on the rota");
      const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      doubleAt = { date: DB, minute: free.startMinute, time: hh(free.startMinute) };
      // Megan, normally (with the rota's room).
      await owner.goto(`${DIARY}?date=${DB}&site=${site}`);
      await ready(owner);
      await owner.click("main button:visible:has-text('New appointment')");
      await pickPatient(owner, "Megan", "Megan Hart");
      await owner.selectOption("#bk-pr", booked.practitionerId);
      await owner.fill("#bk-dt", DB);
      await owner.selectOption("#bk-tm", doubleAt.time);
      await owner.waitForSelector("text=Slot available");
      const room = await owner.inputValue("#bk-rm");
      await owner.click("role=dialog >> button:has-text('Book appointment')");
      await owner.waitForSelector("text=Appointment booked");
      await owner.click("text=Back to diary");
      // Daniel, same practitioner, same time, SAME room: the room is strict – no Book anyway.
      await owner.click("main button:visible:has-text('New appointment')");
      await pickPatient(owner, "Daniel", "Daniel Brooks");
      await owner.selectOption("#bk-pr", booked.practitionerId);
      await owner.fill("#bk-dt", DB);
      await owner.selectOption("#bk-tm", doubleAt.time);
      if (room) {
        await owner.selectOption("#bk-rm", room);
        await owner.waitForSelector("text=This time clashes");
        assert((await owner.locator("text=Book anyway (double-booking is logged)").count()) === 0, "no override over a room");
        assert(/room or blocked time cannot be double-booked/.test(await owner.locator("#bk-slot").innerText()), "says why");
        await shot(owner, "1440-booking-dialog-room-strict");
      }
      // No room: only the practitioner clashes – the owner (Override clashes) may book anyway.
      await owner.selectOption("#bk-rm", "");
      await owner.waitForSelector("text=This time clashes");
      await owner.waitForSelector("text=Book anyway (double-booking is logged)");
      await owner.check("text=Book anyway (double-booking is logged)");
      await shot(owner, "1440-booking-dialog-book-anyway");
      await owner.click("role=dialog >> button:has-text('Book appointment')");
      await owner.waitForSelector("text=Appointment booked");
      await owner.click("text=Back to diary");
      // Both blocks carry the marker; the drawer names the other appointment.
      await owner.waitForSelector(`[role=group] button:has-text("Daniel Brooks")`);
      assert((await owner.locator("[data-double-booked=true]").count()) >= 2, "a marker on both blocks");
      const after = await viewData(owner, `date=${DB}&site=${site}`);
      const pair = after.cards.filter((c) => c.doubleBookedWith && c.doubleBookedWith.length > 0).map((c) => c.patientName).sort();
      assert(JSON.stringify(pair) === JSON.stringify(["Daniel Brooks", "Megan Hart"]), `marked: ${pair.join(", ")}`);
      await shot(owner, "1440-double-booked-markers");
      await owner.click(`[role=group] button:has-text("Megan Hart")`);
      await owner.waitForSelector("[data-testid=double-booked-note] >> text=Daniel Brooks");
      await shot(owner, "1440-drawer-double-booked");
      await owner.keyboard.press("Escape");
      // Reception (no Override clashes) sees the same clash but no Book anyway.
      await reception.goto(`${DIARY}?date=${DB}&site=${site}`);
      await ready(reception);
      await reception.click("main button:visible:has-text('New appointment')");
      await pickPatient(reception, "Megan", "Megan Hart");
      await reception.selectOption("#bk-pr", booked.practitionerId);
      await reception.selectOption("#bk-rm", "");
      await reception.fill("#bk-dt", DB);
      await reception.selectOption("#bk-tm", doubleAt.time);
      await reception.waitForSelector("text=This time clashes");
      assert((await reception.locator("text=Book anyway (double-booking is logged)").count()) === 0, "no Book anyway for reception");
      await reception.keyboard.press("Escape");
    });

    await step("keyboard override: Shift+Enter drops a move over the practitioner's other appointment (owner, logged)", async () => {
      await owner.goto(`${DIARY}?date=${doubleAt.date}&site=${site}`);
      await ready(owner);
      const block = owner.locator(`button[data-status=booked]:has-text("Daniel Brooks")`).first();
      await block.focus();
      await owner.keyboard.press("m");
      await owner.waitForSelector("text=/Moving Daniel Brooks/");
      await owner.keyboard.press("ArrowDown");
      const hint = await owner.locator("[aria-live=polite]").first().innerText();
      assert(/clashes with Megan Hart/.test(hint) && /book anyway/i.test(hint), `hint offers Shift+Enter: ${hint}`);
      await owner.keyboard.press("Enter");
      await owner.waitForSelector("text=/Can't drop here/");
      await shot(owner, "1440-keyboard-move-override-hint");
      await owner.keyboard.press("Shift+Enter");
      await owner.waitForSelector("[role=status] >> text=/Daniel Brooks moved to/");
      assert(/double-booked/i.test(await owner.locator("[role=status]").first().innerText()), "the toast says it is double-booked");
    });

    await step("owner: leave on a Monday (rota page), then a weekly series with that date skipped", async () => {
      await owner.goto(`${DIARY}/rotas?practitioner=${booked.practitionerId}&site=${site}`);
      await owner.waitForSelector("text=Weekly working pattern");
      await shot(owner, "1440-rota-waiting");
      await axe(owner, "rota and waiting list");
      await owner.click("button:has-text('Add leave or change')");
      await owner.fill("form >> input[type=date]", MON3);
      await owner.fill("form >> label:has-text('From') input", "07:00");
      await owner.fill("form >> label:has-text('Until') input", "20:00");
      await owner.click("button:has-text('Block the time')");
      await owner.waitForSelector("text=Annual leave");
      await owner.goto(`${DIARY}?date=${MON1}&site=${site}`);
      await ready(owner);
      await owner.click("main button:visible:has-text('New appointment')");
      await pickPatient(owner, "Daniel", "Daniel Brooks");
      await owner.selectOption("#bk-pr", booked.practitionerId);
      await owner.fill("#bk-dt", MON1);
      const later = booked.minute + 60;
      const t = `${String(Math.floor(later / 60)).padStart(2, "0")}:${String(later % 60).padStart(2, "0")}`;
      await owner.selectOption("#bk-tm", t);
      await owner.check("label:has-text('Weekly') input");
      await owner.waitForSelector("text=occurrences · untick to skip");
      await owner.waitForSelector("text=/Skipped – .*annual leave/");
      assert(/Skipped – [A-Z][a-z]+ [A-Z][a-z]+ – annual leave/.test(await owner.locator("role=dialog").innerText()), "the practitioner's name keeps its capitals");
      const list = await owner.locator("role=dialog").innerText();
      assert(/Tue|Mon 16\/11\/2026/.test(list), "the dates as Mon DD/MM/YYYY");
      await shot(owner, "1440-booking-dialog-recurring");
      await owner.click("role=dialog >> button:has-text('Book 5 appointments')");
      await owner.waitForSelector("text=5 appointments booked");
      await owner.click("text=Back to diary");
    });

    await step("keyboard: Tab to Megan's block, M, ↓ ↓ shows the live hint, Enter moves it 45 minutes earlier (a clash is refused); Undo is offered", async () => {
      await reception.goto(`${DIARY}?date=${MON1}&site=${site}`);
      await ready(reception);
      const block = reception.locator(`button[data-status=booked]:has-text("Megan Hart")`).first();
      await block.focus();
      await reception.keyboard.press("m");
      await reception.waitForSelector("text=/Moving Megan Hart/");
      // Up 30 minutes would overlap Megan's own appointment with the other practitioner – the hint says so.
      await reception.keyboard.press("ArrowUp");
      await reception.keyboard.press("ArrowUp");
      assert(/the patient already has/.test(await reception.locator("[aria-live=polite]").first().innerText()), "patient's own appointment in the hint");
      await reception.keyboard.press("ArrowUp");
      const hint = await reception.locator("[aria-live=polite]").first().innerText();
      assert(/Slot is free/.test(hint), `hint: ${hint}`);
      await shot(reception, "1440-keyboard-move");
      // Down into Daniel's series at the next hour: the hint says it clashes and Enter refuses to drop there.
      for (let i = 0; i < 6; i++) await reception.keyboard.press("ArrowDown");
      assert(/clashes with Daniel Brooks/.test(await reception.locator("[aria-live=polite]").first().innerText()), "clash named in the hint");
      await reception.keyboard.press("Enter");
      await reception.waitForSelector("text=/Can't drop here/");
      await shot(reception, "1440-keyboard-move-clash");
      for (let i = 0; i < 6; i++) await reception.keyboard.press("ArrowUp");
      await reception.keyboard.press("Enter");
      await reception.waitForSelector("[role=status] >> text=/Megan Hart moved to/");
    });

    await step("keyboard: Shift+↑ shortens the focused appointment by 15 minutes (Shift+↓ lengthens)", async () => {
      await reception.reload();
      await ready(reception);
      const block = reception.locator(`button[data-status=booked]:has-text("Megan Hart")`).first();
      await block.focus();
      await reception.keyboard.press("Shift+ArrowUp");
      await reception.waitForSelector("[role=status] >> text=/now 30 min/");
    });

    await step("DNA is not offered before the appointment starts (tomorrow's demo appointment): no button, the drawer says when it opens", async () => {
      await reception.goto(`${DIARY}?date=2026-10-29&site=${site}`);
      await ready(reception);
      await reception.locator("button[data-status=booked]").first().click();
      await reception.waitForSelector("aside >> text=Quick actions");
      assert((await reception.locator("aside button:has-text('Did not attend')").count()) === 0, "no Did not attend before the start");
      await reception.waitForSelector("aside [data-testid=future-status-note]");
      await reception.keyboard.press("Escape");
    });

    await step("late cancellation with the fee (an appointment less than 24 hours away)", async () => {
      const data = await viewData(reception, `date=2026-10-28&site=${site}`);
      const soon = data.cards.find((c) => c.kind === "appointment" && c.status === "booked" && Date.parse(c.startsAt) > Date.now() && Date.parse(c.startsAt) - Date.now() < 23 * 3600e3);
      assert(soon, "a booked appointment within 24 hours");
      await reception.goto(`${DIARY}?date=2026-10-28&site=${site}&focus=${soon.id}`);
      await ready(reception);
      await reception.waitForSelector("aside >> text=Quick actions");
      await reception.click("aside button:has-text('Cancel…')");
      await reception.waitForSelector("text=Late cancellation");
      const fee = reception.locator("aside label:has-text('Charge late cancellation fee')");
      if (await fee.count()) assert(await fee.locator("input").isChecked(), "fee ticked by default");
      await shot(reception, "1440-drawer-late-cancel");
      await reception.click("aside button:has-text('Cancel appointment')");
      await reception.waitForSelector("[role=status] >> text=late cancellation recorded");
    });

    let today = null;
    await step("reception books Megan Hart TODAY in the next hour → Arrived → Undo (toast) → back to booked", async () => {
      const first = await viewData(reception, "");
      const date = first.params.date;
      const now = new Date();
      const nowMinute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(now)) * 60 + now.getMinutes();
      let found = null;
      for (const st of first.sites) {
        const data = await viewData(reception, `date=${date}&site=${st.id}`);
        for (let i = 0; i < data.columns.length && !found; i++) {
          const c = data.columns[i];
          if (!c.practitionerId) continue;
          const sl = c.freeSlots.find((x) => x.startMinute >= nowMinute + 2 && x.startMinute <= nowMinute + 50);
          if (sl) found = { site: st.id, ci: i, minute: sl.startMinute, practitionerId: c.practitionerId };
        }
        if (found) break;
      }
      assert(found, `a free slot in the next hour today (now ${nowMinute}) – this step needs the clinic's opening hours`);
      await reception.goto(`${DIARY}?date=${date}&site=${found.site}`);
      await ready(reception);
      await clickSlot(reception, found.ci, found.minute);
      await reception.waitForSelector("role=dialog >> text=New appointment");
      await pickPatient(reception, "Megan", "Megan Hart");
      await reception.waitForSelector("text=Slot available");
      await reception.click("role=dialog >> button:has-text('Book appointment')");
      await reception.waitForSelector("text=Appointment booked");
      await reception.click("text=Back to diary");
      const data = await viewData(reception, `date=${date}&site=${found.site}`);
      const card = data.cards.find((c) => c.patientName === "Megan Hart" && c.status === "booked" && c.practitionerId === found.practitionerId && Math.abs(Date.parse(c.startsAt) - Date.now()) < 3600e3);
      assert(card, "today's booking for Megan Hart");
      today = { date, site: found.site, id: card.id };
      await reception.goto(`${DIARY}?date=${date}&site=${found.site}&focus=${card.id}`);
      await ready(reception);
      await reception.waitForSelector("aside >> text=Quick actions");
      await reception.click("aside button:has-text('Arrived')");
      await reception.waitForSelector("[role=status] >> text=marked as arrived");
      await reception.waitForSelector(`button[data-status=arrived]:has-text("Megan Hart")`);
      await reception.click("[role=status] button:has-text('Undo')");
      await reception.waitForSelector(`button[data-status=booked]:has-text("Megan Hart")`);
    });

    await step("clinician: Start treatment on an arrived patient → In treatment and the linked clinical note opens", async () => {
      assert(today, "today's booking (previous step)");
      await clinician.goto(`${DIARY}?date=${today.date}&site=${today.site}&focus=${today.id}`);
      await ready(clinician);
      await clinician.waitForSelector("aside >> text=Quick actions");
      await clinician.click("aside button:has-text('Arrived')");
      await clinician.waitForSelector("aside button:has-text('Start treatment')");
      await clinician.click("aside button:has-text('Start treatment')");
      await clinician.waitForURL(/\/patients\/[^/]+\/notes\/[^/]+$/, { timeout: 20000 });
      await clinician.goto(`${DIARY}?date=${today.date}&site=${today.site}`);
      await ready(clinician);
      await clinician.waitForSelector(`button[data-status=in_treatment]:has-text("Megan Hart")`);
    });

    await step("reception: In treatment → Undo start of treatment (back to arrived) → Start treatment sets the status only (no note) → Completed", async () => {
      await reception.goto(`${DIARY}?date=${today.date}&site=${today.site}`);
      await ready(reception);
      await reception.locator(`button[data-status=in_treatment]:has-text("Megan Hart")`).first().click();
      await reception.waitForSelector("aside >> text=Quick actions");
      assert((await reception.locator("aside button:has-text('Open note')").count()) === 0, "no note for reception");
      await shot(reception, "1440-drawer-in-treatment");
      await reception.click("aside button:has-text('Undo start of treatment')");
      await reception.waitForSelector(`button[data-status=arrived]:has-text("Megan Hart")`);
      await reception.locator(`button[data-status=arrived]:has-text("Megan Hart")`).first().click();
      await reception.waitForSelector("aside button:has-text('Start treatment')");
      assert((await reception.locator("aside button:has-text('Undo arrival')").count()) === 1, "Undo arrival");
      await reception.click("aside button:has-text('Start treatment')");
      await reception.waitForSelector(`button[data-status=in_treatment]:has-text("Megan Hart")`);
      assert(/\/app\/clinic\/diary/.test(reception.url()), "reception stays in the diary");
      await reception.locator(`button[data-status=in_treatment]:has-text("Megan Hart")`).first().click();
      await reception.waitForSelector("aside button:has-text('Completed')");
      await reception.click("aside button:has-text('Completed')");
      await reception.waitForSelector(`button[data-status=attended]:has-text("Megan Hart")`);
      assert(/Completed/.test(await reception.locator(`button[data-status=attended]:has-text("Megan Hart")`).first().innerText()), "reads Completed");
    });

    await step("waiting list: entries with wants / available / waiting; Book opens the booking dialog for the patient", async () => {
      await reception.goto(`${DIARY}/waiting-list?site=${site}`);
      await reception.waitForSelector("text=Waiting list");
      const text = await reception.locator("main").innerText();
      assert(/Wants/.test(text) && /Available/.test(text) && /Waiting/.test(text), "entry details");
      // Roles design round 2: reception holds diary.rota by default – the rota editor shows beside the list.
      assert(/Weekly working pattern/.test(text), "reception (diary.rota): the rota editor too");
      await axe(reception, "waiting list");
      await reception.locator("article a:has-text('Book')").first().click();
      await reception.waitForSelector("role=dialog >> text=Chosen:");
      await reception.keyboard.press("Escape");
    });

    await step("day sheet: no dates of birth by default; the owner switches the setting on and they print", async () => {
      await owner.goto(`${DIARY}/day-sheet?site=${site}&date=2026-10-27`);
      await owner.waitForSelector("text=Day sheet –");
      let text = await owner.locator("#day-sheet").innerText();
      assert(!/DOB \d\d\/\d\d\/\d{4}/.test(text), "no DOB by default");
      assert(/No clinical notes are printed/.test(text), "footer");
      await reception.goto(`${DIARY}/day-sheet?site=${site}&date=2026-10-27`);
      assert((await reception.locator("text=Show date of birth on the printed day sheet").count()) === 0, "reception cannot switch it");
      await owner.click("[role=switch]");
      await owner.waitForSelector("[role=status] >> text=Dates of birth will be printed");
      await owner.reload();
      text = await owner.locator("#day-sheet").innerText();
      assert(/DOB \d\d\/\d\d\/\d{4}/.test(text), "DOB printed when on");
      await owner.emulateMedia({ media: "print" });
      await shot(owner, "1440-day-sheet-print", true);
      await owner.emulateMedia({ media: "screen" });
      await owner.click("[role=switch]");
      await owner.waitForSelector("[role=status] >> text=will not be printed");
      await axe(owner, "day sheet");
    });

    await step("patient record → Appointments tab lists Megan's appointments", async () => {
      await reception.goto(`${BASE}/app/clinic/patients?q=Hart`);
      await reception.locator("main a:has-text('Megan')").first().click();
      await reception.locator("nav[aria-label='Patient record sections'] a:has-text('Appointments')").click();
      await reception.waitForURL(/\/appointments$/);
      await reception.waitForSelector("main h2:has-text('Appointments')");
      await reception.waitForSelector("text=Upcoming appointments");
      // The diary's tab renders inside the record (the records layout: summary card and tabs).
      assert((await reception.locator("section[aria-label='Patient summary']").count()) === 1, "inside the record layout");
      assert(/\/appointments$/.test(reception.url()), reception.url());
      await shot(reception, "1440-patient-appointments");
    });

    await step("keyboard only: Tab reaches an appointment, Enter opens the drawer, Esc closes it and focus returns", async () => {
      await reception.goto(`${DIARY}?date=2026-10-27&site=${site}`);
      await ready(reception);
      let found = false;
      for (let i = 0; i < 60 && !found; i++) {
        await reception.keyboard.press("Tab");
        found = await reception.evaluate(() => Boolean(document.activeElement && document.activeElement.getAttribute("data-status")));
      }
      assert(found, "Tab reaches an appointment block");
      const id = await reception.evaluate(() => document.activeElement.textContent);
      await reception.keyboard.press("Enter");
      await reception.waitForSelector("aside[aria-label='Appointment details']");
      await reception.keyboard.press("Escape");
      await reception.waitForTimeout(200);
      assert(await reception.evaluate((t) => document.activeElement && document.activeElement.textContent === t, id), "focus back on the block");
      await reception.keyboard.press("n");
      await reception.waitForSelector("role=dialog >> text=New appointment");
      await reception.keyboard.press("Escape");
    });

    await step("375 px: the phone diary (day strip, cards with status pills), no sideways scrolling", async () => {
      await clinician.setViewportSize({ width: 375, height: 812 });
      await clinician.goto(`${DIARY}?date=2026-10-27&site=${site}`);
      await ready(clinician);
      await clinician.waitForSelector("nav[aria-label='Days of the week']");
      const overflow = await clinician.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `scrolls sideways by ${overflow}px`);
      assert((await clinician.locator(".md\\:hidden li button").count()) > 0, "cards listed");
      await shot(clinician, "375-diary", true);
      await axe(clinician, "phone diary");
      await clinician.locator(".md\\:hidden li button").first().click();
      await clinician.waitForSelector("aside[aria-label='Appointment details']");
      await shot(clinician, "375-drawer");
    });

    await step("no product errors in the browser; no banned names on screen", async () => {
      const body = await owner.goto(DIARY).then(() => owner.locator("body").innerText());
      assert(!/\bTM3\b|CareConnect|\bAI\b/.test(body), "banned names");
      assert(problems.length === 0, problems.join(" | "));
    });
  } finally {
    fs.writeFileSync(path.join(OUT, "axe-report.json"), JSON.stringify(axeReport, null, 2));
    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
