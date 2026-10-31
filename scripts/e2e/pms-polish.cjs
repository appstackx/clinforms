/**
 * Browser check of the M9b polish items (LOCAL only, handover §19): seen statuses refused for future appointments
 * (drawer + reception's Today "Arrived"), the record's Book opening the booking form for the patient, diary blocks
 * that never overlap their text at short lengths (Double-booked marker in the top line), the "Closed – Christmas"
 * notice, waiting-list offers that HOLD their slot (held in the diary, refused to another patient in the booking
 * form, released on withdraw), "Send message" from the appointment drawer, and an axe check of each screen.
 *
 *   npm run pms:seed-demo -- --fresh   (scratch SQLite; prints the owner's invitation → SEED_LOG)
 *   Run on `next dev` with the TEST clock at 10:30 London today (scratchpad run-e2e-polish.sh … dev).
 *   SEED_LOG=… BASE=http://localhost:3170 E2E_OUT=… NODE_PATH=<playwright + axe-core> node scripts/e2e/pms-polish.cjs
 *
 * Fictional data only (the demo clinic). Nothing secret is printed.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3170";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/pms-polish");
const SEED_LOG = process.env.SEED_LOG;
const AXE = require.resolve("axe-core/axe.min.js");
const RUN = crypto.randomBytes(3).toString("hex");
const DIARY = `${BASE}/app/clinic/diary`;

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

const LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function londonParts(ms) {
  const p = Object.fromEntries(LONDON.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** Rectangles intersect (with a 0.5 px tolerance). */
const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

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
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload|favicon|Fast Refresh|hydrat/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
    return page;
  };
  const owner = await mk();
  const reception = await mk();
  failPages.push(["owner", owner], ["reception", reception]);
  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const now = () => clockNow();
  const today = londonParts(now()).date;
  let site = null;

  try {
    await step("owner and reception accounts (two-step on)", async () => {
      await onboard(owner, ownerInvite, "Helen Ward (fictional)");
      const r = await invite(owner, `zz-polish-reception-${RUN}@example.com`, "staff");
      await onboard(reception, r, "Jess Taylor (fictional)");
      const data = await viewData(owner, `date=${today}`);
      site = data.site.id;
    });

    await step("item 1 – a future appointment offers no Arrived / Completed in the drawer; reception's Today shows Arrived only within 60 minutes of the start", async () => {
      const data = await viewData(reception, `date=${today}&site=${site}`);
      const later = data.cards.find((c) => c.kind === "appointment" && c.status === "booked" && Date.parse(c.startsAt) - now() > 70 * 60e3);
      assert(later, "a booked appointment more than 70 minutes away today");
      await reception.goto(`${DIARY}?date=${today}&site=${site}&focus=${later.id}`);
      await ready(reception);
      await reception.waitForSelector("aside >> text=Quick actions");
      assert((await reception.locator("aside button:has-text('Arrived')").count()) === 0, "no Arrived");
      assert((await reception.locator("aside button:has-text('Completed')").count()) === 0, "no Completed");
      await reception.waitForSelector("aside [data-testid=future-status-note]");
      await shot(reception, "1440-drawer-future-no-arrived");
      await reception.goto(`${BASE}/app/clinic`);
      await reception.waitForSelector("[data-testid=dashboard]");
      const rows = await reception.locator("[data-testid=dash-row]:has([data-testid=dash-action-arrived])").allInnerTexts();
      const nowMin = londonParts(now()).minute;
      for (const r of rows) {
        const m = /^(\d{2}):(\d{2})/.exec(r.trim());
        assert(m, `row starts with a time: ${r}`);
        const start = Number(m[1]) * 60 + Number(m[2]);
        assert(start - nowMin <= 60, `Arrived offered ${start - nowMin} minutes early: ${r.split("\n")[0]}`);
      }
      await shot(reception, "1440-today-reception-arrivals");
    });

    let megan = null;
    await step("item 3 – the record's Book opens the booking form with the patient chosen (not just the diary)", async () => {
      const res = await owner.request.post(`${DIARY}/api/patients`, { data: { q: "Megan Hart" } });
      if (res.ok()) {
        const j = await res.json();
        const hit = (j.data || []).find((h) => /Megan Hart/.test(h.name));
        megan = hit && hit.id;
      }
      if (!megan) {
        await owner.goto(`${BASE}/app/clinic/patients?q=Megan%20Hart`);
        const link = owner.locator("main a[href*='/app/clinic/patients/']:has-text('Megan')").first();
        megan = ((await link.getAttribute("href")) || "").split("/").pop();
      }
      assert(megan, "Megan Hart's record");
      await owner.goto(`${BASE}/app/clinic/patients/${megan}`);
      await owner.locator("main a:has-text('Book'), main button:has-text('Book')").first().click();
      await owner.waitForURL(/\/app\/clinic\/diary\?/);
      await owner.waitForSelector("role=dialog >> text=New appointment");
      await owner.waitForSelector("role=dialog >> text=Chosen:");
      assert(/Megan Hart/.test(await owner.locator("role=dialog").innerText()), "Megan is chosen");
      await shot(owner, "1440-record-book-opens-booking-form");
      await owner.keyboard.press("Escape");
    });

    await step("item 2 – double-booked 30- and 15-minute blocks: the marker sits in the top line and never covers the time, name or status", async () => {
      const D = "2026-12-07";
      const data = await viewData(owner, `date=${D}&site=${site}`);
      const col = data.columns.find((c) => c.practitionerId && c.freeSlots.filter((s) => s.startMinute >= 9 * 60).length >= 4);
      assert(col, "a practitioner with free time on the rota");
      const slots = col.freeSlots.filter((s) => s.startMinute >= 9 * 60 && s.startMinute % 30 === 0);
      const pairs = [
        { time: hh(slots[0].startMinute), service: "Follow-up" },
        { time: hh(slots[2].startMinute), service: "Telephone review" },
      ];
      await owner.goto(`${DIARY}?date=${D}&site=${site}`);
      await ready(owner);
      const book = async (q, name, p, anyway) => {
        await owner.click("main button:visible:has-text('New appointment')");
        await pickPatient(owner, q, name);
        await owner.selectOption("#bk-pr", col.practitionerId);
        await owner.selectOption("#bk-svc", { label: p.service }).catch(async () => {
          const opt = await owner.locator(`#bk-svc option:has-text("${p.service}")`).first().getAttribute("value");
          await owner.selectOption("#bk-svc", opt);
        });
        await owner.selectOption("#bk-rm", "");
        await owner.fill("#bk-dt", D);
        await owner.selectOption("#bk-tm", p.time);
        if (anyway) {
          await owner.waitForSelector("text=Book anyway (double-booking is logged)");
          await owner.check("text=Book anyway (double-booking is logged)");
        } else await owner.waitForSelector("text=Slot available");
        await owner.click("role=dialog >> button:has-text('Book appointment')");
        await owner.waitForSelector("text=Appointment booked");
        await owner.click("text=Back to diary");
      };
      for (const p of pairs) {
        await book("Megan", "Megan Hart", p, false);
        await book("Daniel", "Daniel Brooks", p, true);
      }
      await owner.goto(`${DIARY}?date=${D}&site=${site}`);
      await ready(owner);
      await owner.waitForFunction(() => document.querySelectorAll("[data-double-booked=true]").length >= 4, null, { timeout: 30000 }).catch(() => {});
      const markers = owner.locator("[data-double-booked=true]");
      const n = await markers.count();
      assert(n >= 4, `markers on both blocks of both pairs: ${n}`);
      for (let i = 0; i < n; i++) {
        const block = markers.nth(i).locator("xpath=ancestor::button[1]");
        const mb = await markers.nth(i).boundingBox();
        const bb = await block.boundingBox();
        assert(mb.x >= bb.x - 0.5 && mb.x + mb.width <= bb.x + bb.width + 0.5 && mb.y >= bb.y - 0.5 && mb.y + mb.height <= bb.y + bb.height + 0.5, `marker ${i} inside its block`);
        // Every text run of the block (time, name, status) is clear of the marker.
        const texts = await block.evaluate((btn, marker) => {
          const m = btn.querySelector("[data-double-booked]");
          const out = [];
          const walk = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
          for (let node = walk.nextNode(); node; node = walk.nextNode()) {
            if (!node.textContent.trim() || m.contains(node)) continue;
            const el = node.parentElement;
            if (el.closest(".sr-only")) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) out.push({ x: r.x, y: r.y, width: r.width, height: r.height, text: node.textContent.trim() });
          }
          return out;
        });
        for (const t of texts) {
          const visible = t.y + t.height <= bb.y + bb.height + 0.5;
          if (visible) assert(!overlaps(mb, t), `marker ${i} covers "${t.text}"`);
        }
      }
      await owner.locator("[data-double-booked=true]").first().scrollIntoViewIfNeeded();
      await shot(owner, "1440-double-booked-short-blocks");
      const clip = await owner.locator("[data-double-booked=true]").first().locator("xpath=ancestor::div[@role='group'][1]").boundingBox();
      if (clip) await owner.screenshot({ path: path.join(OUT, "1440-double-booked-short-blocks-column.png"), clip: { x: clip.x, y: Math.max(0, (await markers.first().boundingBox()).y - 60), width: Math.min(clip.width, 400), height: 360 } });
      await axe(owner, "diary with short double-booked blocks");
    });

    await step("item 9 – the diary day view says 'Closed – Christmas' on a closure day", async () => {
      await reception.goto(`${DIARY}?date=2026-12-25&site=${site}`);
      await ready(reception);
      const notice = await reception.locator("[data-testid=diary-closed]").innerText();
      assert(/Closed – Christmas/.test(notice), notice);
      await shot(reception, "1440-diary-closed-christmas");
      await axe(reception, "diary closure notice");
    });

    await step("M10 #8 – the 375 px phone diary says 'Closed – Christmas' and offers no New appointment on a closed day", async () => {
      await reception.setViewportSize({ width: 375, height: 812 });
      try {
        await reception.goto(`${DIARY}?date=2026-12-25&site=${site}`);
        await ready(reception);
        const notice = await reception.locator("[data-testid=mobile-closed]").innerText();
        assert(/Closed – Christmas/.test(notice), notice);
        assert((await reception.locator("button:visible:has-text('New appointment')").count()) === 0, "no New appointment on a closed day");
        await shot(reception, "375-diary-closed-christmas", true);
        await axe(reception, "phone diary closed day");
      } finally {
        await reception.setViewportSize({ width: 1440, height: 1000 });
      }
    });

    let freed = null;
    await step("item 4 – a freed slot offered to a waiting patient is HELD: 'Held until' on the list, a dashed hold in the diary", async () => {
      // The demo seed leaves a late cancellation later today ("Slot freed") and waiting patients who match it. When the
      // seed has none in the week, free one: book Megan into a free slot tomorrow and cancel it.
      await reception.goto(`${DIARY}/waiting-list?site=${site}`);
      if ((await reception.locator("[role=status]:has-text('Slot freed')").count()) === 0) {
        const day = addDays(today, 1);
        const data = await viewData(reception, `date=${day}&site=${site}`);
        const col = data.columns.find((c) => c.practitionerId && c.freeSlots.some((s) => s.startMinute >= 9 * 60 && s.startMinute <= 16 * 60));
        assert(col, "a free slot tomorrow");
        const s = col.freeSlots.find((x) => x.startMinute >= 9 * 60 && x.startMinute <= 16 * 60);
        await reception.goto(`${DIARY}?date=${day}&site=${site}`);
        await ready(reception);
        await reception.click("main button:visible:has-text('New appointment')");
        await pickPatient(reception, "Megan", "Megan Hart");
        await reception.selectOption("#bk-pr", col.practitionerId);
        await reception.fill("#bk-dt", day);
        await reception.selectOption("#bk-tm", hh(s.startMinute));
        await reception.waitForSelector("text=Slot available");
        await reception.click("role=dialog >> button:has-text('Book appointment')");
        await reception.waitForSelector("text=Appointment booked");
        await reception.click("text=Back to diary");
        const after = await viewData(reception, `date=${day}&site=${site}`);
        const mine = after.cards.find((c) => c.patientName === "Megan Hart" && c.practitionerId === col.practitionerId && c.timeLabel.startsWith(hh(s.startMinute)));
        await reception.goto(`${DIARY}?date=${day}&site=${site}&focus=${mine.id}`);
        await ready(reception);
        await reception.waitForSelector("aside >> text=Quick actions");
        await reception.click("aside button:has-text('Cancel…')");
        await reception.click("aside button:has-text('Cancel appointment')");
        await reception.waitForSelector("[role=status] >> text=/cancel/i");
        await reception.goto(`${DIARY}/waiting-list?site=${site}`);
      }
      const banner = await reception.locator("[role=status]:has-text('Slot freed')").innerText();
      const m = /Slot freed: \S+ (\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})–(\d{2}:\d{2}), (.+)/.exec(banner);
      assert(m, `freed banner: ${banner}`);
      freed = { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4], end: m[5], practitioner: m[6].split("\n")[0].trim() };
      // Anyone the freed slot matches (any day / time, that practitioner or anyone).
      const matching = reception.locator("article:has-text('Matches slot')");
      if ((await matching.count()) === 0) {
        await reception.click("main button:has-text('Add'):not(:has-text('leave'))");
        await reception.fill("#wl-q", "Daniel Brooks");
        await reception.locator("ul[aria-label='Matching patients'] button:has-text('Daniel Brooks')").first().click();
        await reception.click("button[type=submit]:has-text('Add to waiting list')");
        await reception.waitForSelector("article:has-text('Matches slot')");
      }
      const who = await matching.first().getAttribute("aria-label");
      freed.who = who;
      const card = reception.locator(`article[aria-label="${who}"]`).first();
      assert((await card.locator("button:has-text('Offer slot by text')").count()) === 1, `${who} matches the freed slot`);
      await reception.selectOption("[data-testid=offer-hold]", "60");
      await card.locator("button:has-text('Offer slot by text')").click();
      await reception.waitForSelector("text=/held for them until/");
      await card.locator("[data-testid=offer-held]").waitFor();
      const held = await card.locator("[data-testid=offer-held]").innerText();
      assert(/Held until \d{2}:\d{2}/.test(held), held);
      assert((await card.locator("button:has-text('Withdraw offer')").count()) === 1 && (await card.locator("button:has-text('Book offered slot')").count()) === 1, "answer buttons");
      await shot(reception, "1440-waiting-list-offer-held");
      await axe(reception, "waiting list with a held offer");
      await reception.goto(`${DIARY}?date=${freed.date}&site=${site}`);
      await ready(reception);
      const hold = reception.locator("[data-testid=diary-hold]");
      await hold.first().waitFor();
      const label = (await hold.first().textContent()).replace(/\s+/g, " ").trim();
      assert(label.startsWith(`${freed.time}–`) && label.includes(`Held for ${freed.who} until`) && label.includes("not bookable"), label);
      await shot(reception, "1440-diary-hold");
      await axe(reception, "diary with a hold");
      // M10 #8: the phone diary lists the hold too (the practitioner's day).
      await reception.setViewportSize({ width: 375, height: 812 });
      try {
        await reception.goto(`${DIARY}?date=${freed.date}&site=${site}`);
        await ready(reception);
        if (await reception.locator("#m-who").count()) await reception.selectOption("#m-who", { label: freed.practitioner });
        const mhold = reception.locator("[data-testid=mobile-hold]").first();
        await mhold.waitFor();
        const mtext = (await mhold.textContent()).replace(/\s+/g, " ").trim();
        assert(mtext.startsWith(freed.time) && mtext.includes(`Held for ${freed.who} until`), mtext);
        await shot(reception, "375-diary-hold", true);
        await axe(reception, "phone diary with a hold");
      } finally {
        await reception.setViewportSize({ width: 1440, height: 1000 });
      }
    });

    await step("item 4 – nobody else can book the held slot: the booking form says it is held; withdrawing the offer frees it", async () => {
      assert(freed, "the freed slot of the step before");
      const data = await viewData(reception, `date=${freed.date}&site=${site}`);
      const col = data.columns.find((c) => c.label === freed.practitioner);
      assert(col, `column ${freed.practitioner}`);
      await reception.goto(`${DIARY}?date=${freed.date}&site=${site}`);
      await ready(reception);
      await reception.click("main button:visible:has-text('New appointment')");
      if (freed.who === "Megan Hart") await pickPatient(reception, "Daniel", "Daniel Brooks");
      else await pickPatient(reception, "Megan", "Megan Hart");
      await reception.selectOption("#bk-pr", col.practitionerId);
      await reception.fill("#bk-dt", freed.date);
      await reception.selectOption("#bk-tm", freed.time);
      await reception.waitForSelector("#bk-slot >> text=/held for a waiting-list offer/");
      assert(!(await reception.locator("role=dialog >> button:has-text('Book appointment')").isEnabled().catch(() => false)), "cannot book over it");
      await shot(reception, "1440-booking-form-slot-held");
      await reception.keyboard.press("Escape");
      await reception.goto(`${DIARY}/waiting-list?site=${site}`);
      const card = reception.locator(`article[aria-label="${freed.who}"]:has([data-testid=offer-held])`);
      await card.locator("button:has-text('Withdraw offer')").click();
      await reception.waitForSelector("text=Offer withdrawn – the slot is free again.");
      await reception.goto(`${DIARY}?date=${freed.date}&site=${site}`);
      await ready(reception);
      assert((await reception.locator("[data-testid=diary-hold]").count()) === 0, "the hold is gone");
    });

    await step("item 5 – Send message from the appointment drawer: comms' send form (templates, text or email), sent to the outbox", async () => {
      const data = await viewData(reception, `date=${today}&site=${site}`);
      const appt = data.cards.find((c) => c.kind === "appointment" && c.patientName && c.status === "booked");
      assert(appt, "a booked appointment today");
      await reception.goto(`${DIARY}?date=${today}&site=${site}&focus=${appt.id}`);
      await ready(reception);
      await reception.waitForSelector("aside >> text=Quick actions");
      await reception.click("aside [data-testid=drawer-send-message]");
      await reception.waitForSelector("[data-testid=send-message-dialog] [data-testid=send-form]");
      const dlg = reception.locator("[data-testid=send-message-dialog]");
      assert(/About the appointment on/.test(await dlg.innerText()), "says what it is about");
      assert((await dlg.locator("#sm-t option").count()) >= 1, "templates offered");
      await dlg.locator("#sm-b").fill("Hello, a quick note about your appointment (fictional e2e).");
      // Wait for Send now to be enabled and its colour transition to finish before the contrast check.
      await dlg.locator("[data-testid=send-now]:not([disabled])").waitFor();
      await reception.waitForTimeout(500);
      await shot(reception, "1440-drawer-send-message");
      await axe(reception, "send message dialog");
      await dlg.locator("[data-testid=send-now]").click();
      await reception.waitForSelector("[data-testid=send-message-dialog]", { state: "detached" });
      await reception.goto(`${BASE}/app/clinic/messages`);
      await reception.waitForSelector(`text=${appt.patientName}`);
    });
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(axeReport, null, 2));
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} steps passed`);
    if (problems.length) console.log(`page problems:\n${Array.from(new Set(problems)).slice(0, 20).join("\n")}`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
