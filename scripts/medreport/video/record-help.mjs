#!/usr/bin/env node
/**
 * Records the PICTURE of a trial clinic's help video ("ClinForms – your Blue Heart trial: getting started") on a
 * LOCAL production build with a local SQLite copy of the trial clinic, following narration.json line by line, as a
 * real user would: the owner accepts the invitation and sets up two-step verification (code worked out in the
 * script), switches on drafting, sets up the approving physio (invited and signed up off camera); the physio
 * confirms a provider form, completes a report from a sample notes PDF with LIVE drafting, approves it, downloads the
 * Word file and adds portal questions; the owner invites a colleague and shows where help is.
 *
 * It is also the end-to-end TEST RUN: every step's result and timing goes to <src>/work/steps.json (and to --report,
 * if given, as JSON next to it). Nothing here changes app code; the recorder only drives the app.
 *
 * Narration-driven timing: each line's clip length (voice/lines.json) is the line's minimum slot. Actions run while the
 * line is spoken (clicks can be timed to a spoken word, voice/words.json); the next line starts only after the clip
 * has ended plus a pause, so a screen that belongs to the next line never appears before the current one is spoken.
 * Page loads, off-camera set-up and the two labelled jump cuts are hard cuts; the live drafting wait is recorded in
 * full and sped up in post (the mixer labels it with its real time).
 *
 * Secrets are never on screen: CSS injected before the first paint replaces the authenticator QR code, the key and
 * the backup codes with an opaque plate and masks the 6-digit code; links and tokens are read from files and the
 * server log by the script and never shown or printed; the page is recorded without browser chrome (no address bar).
 *
 * Outputs (under <src>/work, never in the repo): frames/, timeline.json, steps.json, clips/app-clean.mp4 (the app
 * segment, 1920x1080 30 fps, cuts and speed-up applied, no captions), downloads/ (the approved Word file).
 *
 * Usage (server on :3240 per the help-video setup; Playwright via NODE_PATH):
 *   NODE_PATH=<node_modules with playwright> node scripts/medreport/video/record-help.mjs --src <help-video-src> \
 *     --local <dir with local-invite.txt, server.log, db/> [--rehearse] [--assemble-only]
 *   --rehearse        leave drafting from the notes OFF (no live calls) – a dress rehearsal of every step
 *   --assemble-only   re-encode clips/app-clean.mp4 from work/timeline.json
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  sleep,
  now,
  log,
  findChromium,
  bannedIn,
  overlayInit,
  Cast,
  pageText,
  BaseDirector,
  ff,
  keptIntervals,
  mapper,
  keptTotal,
  writeConcat,
  spedDuration,
  documentText,
} from "./video-kit.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright not found. Run with NODE_PATH pointing at a node_modules that has playwright.",
  );
  process.exit(1);
}

/* ---------------------------------------------------------------------------------------------
 * Configuration
 * -------------------------------------------------------------------------------------------*/
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);
const BASE = (process.env.BASE || "http://localhost:3240").replace(/\/$/, "");
if (!/^http:\/\/localhost:324\d$/.test(BASE))
  throw new Error(
    "The help video is recorded against a LOCAL server on ports 3240–3249 only.",
  );
const SRC = path.resolve(arg("--src", ""));
const LOCAL = path.resolve(arg("--local", ""));
if (!arg("--src") || !arg("--local"))
  throw new Error(
    "--src <help-video src dir> and --local <local server dir> are required",
  );
const REHEARSE = flag("--rehearse");
/** --fast: a quick dry run of the steps (minimal pacing; the picture is not usable). */
const FAST = flag("--fast");
const WORK = path.join(SRC, "work");
const DIRS = {
  frames: path.join(WORK, "frames"),
  clips: path.join(WORK, "clips"),
  downloads: path.join(WORK, "downloads"),
};
const VIEW = { w: 1600, h: 900 };
const SCALE = 1.2;
const OUT_W = 1920;
const OUT_H = 1080;
const NOTES =
  arg("--notes") ||
  "/Users/khuram/Projects/Appstackx/clinforms/demo-assets/outputs/blue-heart/welcome/sample-notes/Fictional-patient-1-Jordan-Ellery-neck-whiplash-road-traffic-accident-printed-notes.pdf";
const NARR = JSON.parse(
  fs.readFileSync(path.join(SRC, "narration.json"), "utf8"),
);
const LINE = Object.fromEntries(NARR.map((l) => [l.id, l]));
const VOICE_RAW = (() => {
  const f = path.join(SRC, "voice", "lines.json");
  if (!fs.existsSync(f)) {
    log("WARNING: no voice/lines.json – line slots use 2.45 words a second");
    return Object.fromEntries(
      NARR.map((l) => [l.id, l.line.split(/\s+/).length / 2.45]),
    );
  }
  return Object.fromEntries(
    JSON.parse(fs.readFileSync(f, "utf8")).map((v) => [
      v.id,
      v.trimmedDurationSec,
    ]),
  );
})();
const VOICE = FAST
  ? Object.fromEntries(Object.keys(VOICE_RAW).map((k) => [k, 0.15]))
  : VOICE_RAW;
const WORDS = (() => {
  const f = path.join(SRC, "voice", "words.json");
  if (!fs.existsSync(f) || FAST) return {};
  return JSON.parse(fs.readFileSync(f, "utf8"));
})();
/** Pause after each spoken line before the next one starts (s). */
const PAD = FAST ? 0.05 : 0.5;
const CHAPTERS = [
  "Welcome",
  "First sign-in",
  "Turn on drafting",
  "Set up the physio who approves",
  "Check a provider form once",
  "Complete a report from notes",
  "Online portals",
  "Invite your team",
  "Help",
];

const PORTAL_QUESTIONS = [
  "# Treatment update",
  "Date of initial assessment [date]",
  "Number of sessions attended to date [number]",
  "Current symptoms and progress since the initial assessment [long]",
  "Is the patient back at work? [yes/no]",
  "Is further treatment requested? [yes/no]",
  "Number of further sessions requested [number]",
].join("\n");

/** Fictional people (passwords made here, kept in memory only). */
const pw = () => `Zz ${crypto.randomBytes(12).toString("base64url")} pw`;
const OWNER = {
  email: "owner-demo@example.com",
  name: "Dell Baines",
  password: pw(),
};
const SARAH = {
  email: "sarah.reid@example.com",
  name: "Sarah Reid",
  password: pw(),
  job: "Physiotherapist",
  hcpc: "ZZ0001",
};
const PM = { email: "practice.manager@example.com" };

/* ---------------------------------------------------------------------------------------------
 * Presentation-only CSS: the secrets plates (in place before the first paint of every page)
 * -------------------------------------------------------------------------------------------*/
const PLATE = `content:"Hidden in this video";position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;
  background:#334155;color:#e2e8f0;font:600 14px/1.3 Inter,system-ui,sans-serif;letter-spacing:.01em;border-radius:8px;z-index:5;`;
const PLATE_SVG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='22'><text x='110' y='16' font-family='Inter,Helvetica,Arial' font-size='14' font-weight='600' fill='%23e2e8f0' text-anchor='middle'>Hidden in this video</text></svg>\")";
const SECRET_CSS = `
  img[alt^="Authenticator set-up code"] { visibility: hidden !important; }
  div:has(> img[alt^="Authenticator set-up code"]) { position: relative !important; }
  div:has(> img[alt^="Authenticator set-up code"])::after { ${PLATE} left:50%; top:0; width:224px; height:224px; transform:translateX(-50%); }
  body:has(img[alt^="Authenticator set-up code"]) div:has(> code) { position: relative !important; }
  body:has(img[alt^="Authenticator set-up code"]) div:has(> code) > * { visibility: hidden !important; }
  body:has(img[alt^="Authenticator set-up code"]) div:has(> code)::after { ${PLATE} inset:0; }
  ul[aria-label="Backup codes"] { position: relative !important; }
  ul[aria-label="Backup codes"] > li { visibility: hidden !important; }
  ul[aria-label="Backup codes"]::after { ${PLATE} inset:0; }
  input[name="code"][autocomplete="one-time-code"] { color: transparent !important; caret-color: transparent !important; -webkit-text-security: disc !important;
    background: #334155 ${PLATE_SVG} center / auto no-repeat !important; }
  a[href^="otpauth:"] { display: none !important; }
`;

/* ---------------------------------------------------------------------------------------------
 * Logging of the test run
 * -------------------------------------------------------------------------------------------*/
const STEPS = [];
const FACTS = {};
/** Error text without element sources (a QR code's data URI) or link tokens. */
const clean = (t) =>
  String(t)
    .replace(/data:[a-z]+\/[^\s"')]+/gi, "data:…")
    .replace(/token=[A-Za-z0-9._%-]+/g, "token=…");
const FINDINGS = [];
const finding = (kind, text) => {
  FINDINGS.push({ kind, text, at: new Date().toISOString() });
  log(`FINDING (${kind}): ${text}`);
};
async function step(name, fn) {
  const t = now();
  const rec = { name, ok: false, startedAt: new Date().toISOString() };
  STEPS.push(rec);
  try {
    const detail = await fn();
    rec.ok = true;
    if (detail !== undefined) rec.detail = detail;
    return detail;
  } catch (e) {
    rec.error = clean(String((e && e.message) || e)).slice(0, 900);
    throw e;
  } finally {
    rec.seconds = Number((now() - t).toFixed(2));
    log(
      `${rec.ok ? "PASS" : "FAIL"} ${name} (${rec.seconds}s)${rec.detail ? ` – ${typeof rec.detail === "string" ? rec.detail : JSON.stringify(rec.detail).slice(0, 300)}` : ""}${rec.error ? ` – ${rec.error.slice(0, 300)}` : ""}`,
    );
  }
}

/* ---------------------------------------------------------------------------------------------
 * TOTP (worked out in memory; never printed)
 * -------------------------------------------------------------------------------------------*/
function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(key, at = Date.now()) {
  const c = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(c / 2 ** 32), 0);
  buf.writeUInt32BE(c >>> 0, 4);
  const h = crypto.createHmac("sha1", b32(key)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(
    (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) %
      1e6,
  ).padStart(6, "0");
}
/** Seconds left in the current 30 s window. */
const totpLeft = () => (30000 - (Date.now() % 30000)) / 1000;

/* ---------------------------------------------------------------------------------------------
 * Local files: owner link, emailed links (server log), live-call counter (read only, never printed)
 * -------------------------------------------------------------------------------------------*/
function ownerLink() {
  const m = fs
    .readFileSync(path.join(LOCAL, "local-invite.txt"), "utf8")
    .match(/http:\/\/localhost:324\d\/accept-invite\?token=[A-Za-z0-9._%-]+/);
  if (!m || !m[0].startsWith(BASE))
    throw new Error("No local owner invitation link in local-invite.txt");
  return m[0];
}
const logSize = () => fs.statSync(path.join(LOCAL, "server.log")).size;
async function emailedLink(to, fromByte) {
  for (let i = 0; i < 40; i++) {
    const text = fs
      .readFileSync(path.join(LOCAL, "server.log"))
      .subarray(fromByte)
      .toString("utf8");
    const at = text.lastIndexOf(`[email:log] to=${to}`);
    if (at >= 0) {
      const m = text
        .slice(at)
        .match(
          /http:\/\/localhost:324\d\/accept-invite\?token=[A-Za-z0-9._%-]+/,
        );
      if (m) return m[0];
    }
    await sleep(250);
  }
  throw new Error(`No emailed invitation for ${to} in the server log`);
}
function liveCalls() {
  const db = path.join(LOCAL, "db", "clinforms-help.db");
  try {
    const out = execFileSync(
      "sqlite3",
      [db, "select key, window_start, count from rate_limits"],
      { encoding: "utf8" },
    );
    const rows = out.trim()
      ? out
          .trim()
          .split("\n")
          .map((l) => l.split("|"))
      : [];
    // The per-day window of the clinic's drafting calls (the longest window per key prefix).
    const day = rows.filter(
      (r) => /live|draft/i.test(r[0]) && /day|86400/i.test(r[0] + r[1]),
    );
    return {
      rows: rows.map((r) => [
        r[0].replace(/[0-9a-f]{8,}/g, "…"),
        r[1],
        Number(r[2]),
      ]),
      dayTotal: day.reduce((s, r) => s + Number(r[2]), 0),
    };
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

/* ---------------------------------------------------------------------------------------------
 * Director: narration-driven clock, cuts (merged, nestable), sped-up waits, word-timed clicks
 * -------------------------------------------------------------------------------------------*/
class Director extends BaseDirector {
  constructor(cast) {
    super(cast, VIEW);
    this.t0 = null;
    this.cutsDone = [];
    this.cutDepth = 0;
    this.cutOpen = null;
    this.speeds = [];
    this.jumps = [];
    this.lines = [];
    this.cur = null;
    this.late = [];
    this.guardHits = [];
  }
  start() {
    this.t0 = now();
    this.ev("seg", { edge: "start" });
  }
  stop() {
    this.tEnd = now();
    this.ev("seg", { edge: "end" });
  }
  cutIntervals(at = now()) {
    const iv = this.cutsDone.map(([s, e]) => [s, e]);
    if (this.cutOpen !== null) iv.push([this.cutOpen, at]);
    return iv;
  }
  cutTime(at = now()) {
    const iv = this.cutIntervals(at)
      .map(([s, e]) => [Math.max(s, this.t0), Math.min(e, at)])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let sum = 0;
    let cs = null;
    let ce = null;
    for (const [s, e] of iv) {
      if (ce === null || s > ce) {
        if (ce !== null) sum += ce - cs;
        cs = s;
        ce = e;
      } else ce = Math.max(ce, e);
    }
    if (ce !== null) sum += ce - cs;
    return sum;
  }
  speedSaved() {
    return this.speeds.reduce(
      (s, sp) => s + (sp.t1 - sp.t0 - spedDuration(sp.t1 - sp.t0)),
      0,
    );
  }
  /** Time in the recorded app segment (wall time minus cuts minus what the speed-ups save). */
  vt() {
    return now() - this.t0 - this.cutTime() - this.speedSaved();
  }
  async until(t) {
    for (;;) {
      const left = t - this.vt();
      if (left <= 0.004) break;
      await sleep(Math.min(40, left * 1000));
    }
  }
  async hold(sec) {
    await this.until(this.vt() + (FAST ? sec * 0.1 : sec));
  }
  async moveTo(x, y, ms = 560) {
    return super.moveTo(x, y, FAST ? 40 : ms);
  }
  async typeText(text, cps = 14) {
    if (FAST) return this.page.keyboard.insertText(text);
    return super.typeText(text, cps);
  }
  async reveal(loc, opts = {}) {
    return super.reveal(loc, FAST ? { ...opts, ms: 60 } : opts);
  }
  async scrollWin(delta, ms) {
    return super.scrollWin(delta, FAST ? 60 : ms);
  }
  /** Seconds into the current line at which `word` (nth match) is spoken. */
  w(word, n = 0) {
    const list = WORDS[this.cur.id] || [];
    const hits = list.filter((x) =>
      x.w
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .startsWith(word.toLowerCase().replace(/[^a-z0-9]/g, "")),
    );
    if (!hits.length) return 0;
    return hits[Math.min(n, hits.length - 1)].t;
  }
  /** Wait until `t` seconds into the current line. */
  async at(t) {
    if (!this.cur) return;
    const target = this.cur.v0 + t;
    if (this.vt() > target + 0.6)
      this.late.push({
        line: this.cur.id,
        target: Number(t.toFixed(2)),
        late: Number((this.vt() - target).toFixed(2)),
      });
    await this.until(target);
  }
  /** Click so the press lands when `word` is spoken (or as soon as possible after). */
  async clickWord(loc, word, opts = {}) {
    const n = opts.n ?? 0;
    const ms = opts.ms ?? 520;
    if (!opts.noReveal) await this.reveal(loc, opts);
    const t =
      this.w(word, n) - (ms + (opts.pause ?? 120)) / 1000 + (opts.dt ?? 0);
    await this.at(Math.max(0, t));
    await this.click(loc, { ...opts, ms, noReveal: true });
  }
  async hoverWord(loc, word, opts = {}) {
    if (!opts.noReveal) await this.reveal(loc, opts);
    await this.at(
      Math.max(0, this.w(word, opts.n ?? 0) - 0.45 + (opts.dt ?? 0)),
    );
    await this.hover(loc, { ms: 450, ...opts, noReveal: true });
  }
  async guard(label) {
    const p = this.page;
    if (!p || p.isClosed()) return;
    const text = await pageText(p).catch(() => "");
    const hits = bannedIn(text);
    const secret = [];
    if (/otpauth:|token=|\/accept-invite\?|\/reset-password\?/i.test(text))
      secret.push("link or token text");
    if (
      /\b[A-Z2-7]{26,}\b/.test(text) ||
      /\b(?:[A-Z2-7]{4}\s){5,}[A-Z2-7]{2,}\b/.test(text)
    )
      secret.push("authenticator-key-like text");
    if (hits.length || secret.length) {
      this.guardHits.push({
        label,
        banned: Array.from(new Set(hits)).slice(0, 6),
        secret,
      });
      finding(
        "guard",
        `${label}: ${JSON.stringify({ banned: Array.from(new Set(hits)).slice(0, 4), secret })}`,
      );
      if (secret.length)
        throw new Error(
          `SECRET-LIKE TEXT visible at ${label} – recording stopped`,
        );
    }
  }
  /** One narration line: runs `fn` while the line is spoken; the line lasts at least its clip + PAD. */
  async line(id, fn, { pad = PAD } = {}) {
    const L = LINE[id];
    if (!L) throw new Error(`No line ${id}`);
    const v0 = this.vt();
    this.cur = { id, v0, wall: now() };
    this.ev("line", { id, vt: Number(v0.toFixed(3)) });
    await step(`${id} – ${L.line}`, async () => {
      await this.guard(`line ${id}`);
      if (fn) await fn();
      await this.until(v0 + VOICE[id] + pad);
    });
    const rec = {
      id,
      chapter: L.chapter,
      wall: this.cur.wall,
      v0,
      v1: this.vt(),
    };
    this.lines.push(rec);
    this.cur = null;
    return rec;
  }
  /** A hard cut: everything inside is left out of the video. Nestable. */
  async cut(fn) {
    if (this.cutDepth++ === 0) this.cutOpen = now();
    try {
      return await fn();
    } finally {
      if (--this.cutDepth === 0) {
        this.cutsDone.push([this.cutOpen, now()]);
        this.cutOpen = null;
      }
    }
  }
  /** Await something slow; anything beyond `keep` seconds becomes a hard cut. */
  async trim(promise, keep = 0.4) {
    const t0 = now();
    const res = await promise;
    const t1 = now();
    if (this.cutDepth === 0 && t1 - t0 > keep + 0.25)
      this.cutsDone.push([t0 + keep, t1]);
    return res;
  }
  /** Record a live wait in full; it is sped up to about 3 s in post and labelled with its real time. */
  /** `since`: when the wait really began (the click), so the label states the whole real time. */
  async speed(promise, label, since = null) {
    const t0 = now();
    const res = await promise;
    const t1 = now();
    this.speeds.push({ t0, t1, label, real: since ? t1 - since : t1 - t0 });
    return res;
  }
  async jump(fn, label) {
    const r = await this.cut(fn);
    this.jumps.push({ wall: now(), label });
    return r;
  }
  /** Hover with a short wait for the element (4 s), so an optional hover that has nothing to point at fails fast. */
  async hover(loc, opts = {}) {
    await loc.waitFor({ state: "attached", timeout: opts.wait ?? 4000 });
    return super.hover(loc, opts);
  }
  /** Re-show the cursor dot after a full page load (the overlay is rebuilt without a position). */
  async syncCursor() {
    const p = this.page;
    if (!p || p.isClosed()) return;
    await p.mouse.move(this.mouse.x + 1, this.mouse.y).catch(() => {});
    await p.mouse.move(this.mouse.x, this.mouse.y).catch(() => {});
    await this.pushInstant().catch(() => {});
  }
  /** Put the cursor somewhere without moving it on camera. */
  async park(x, y) {
    await this.page.mouse.move(x, y);
    this.mouse = { x, y };
    await this.pushInstant();
  }
  async scrollTo(y, ms) {
    if (FAST) ms = 60;
    await this.page.evaluate(
      async ({ y, ms }) => {
        const start = scrollY;
        const end = Math.max(
          0,
          Math.min(document.documentElement.scrollHeight - innerHeight, y),
        );
        const d = end - start;
        if (Math.abs(d) < 2) return;
        const dur = ms ?? Math.min(1400, 350 + Math.abs(d) * 0.55);
        await new Promise((res) => {
          const t0 = performance.now();
          const stepF = (t) => {
            const k = Math.min(1, (t - t0) / dur);
            const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            window.scrollTo(0, start + d * e);
            if (k < 1) requestAnimationFrame(stepF);
            else res();
          };
          requestAnimationFrame(stepF);
        });
      },
      { y, ms },
    );
  }
}

/* ---------------------------------------------------------------------------------------------
 * App helpers
 * -------------------------------------------------------------------------------------------*/
const exact = (p, role, name) => p.getByRole(role, { name, exact: true });
const topLink = (p, name) =>
  p.locator("header").getByRole("link", { name, exact: true }).first();

async function settle(page, ms = 400) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await sleep(ms);
}

/** Sign-up from an invitation link, off camera (Sarah). Returns with two-step on and the overview open. */
async function signUpOffCamera(page, link, who) {
  await page.goto(link);
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page.getByLabel("Full name", { exact: true }).fill(who.name);
  await page
    .getByLabel("Choose a password", { exact: true })
    .fill(who.password);
  await page
    .getByLabel("Repeat the password", { exact: true })
    .fill(who.password);
  await exact(page, "button", "Create account and join").click();
  await page.waitForURL(/\/two-factor/, { timeout: 30000 });
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await exact(page, "button", "Set up two-step verification").click();
  await page.waitForSelector("img[alt^='Authenticator set-up code']", {
    state: "attached",
  });
  who.key = ((await page.locator("code").first().textContent()) || "").replace(
    /\s+/g,
    "",
  );
  await page.getByLabel("I have saved my backup codes").check();
  while (totpLeft() < 4) await sleep(300);
  await page.getByLabel("6-digit code").fill(totp(who.key));
  await exact(page, "button", "Turn on two-step verification").click();
  await page.waitForURL(/\/app(\/select-clinic)?(\?.*)?$/, { timeout: 30000 });
  if (/select-clinic/.test(page.url())) {
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.waitForURL(/\/app(\?.*)?$/, { timeout: 30000 });
  }
}

/** Answers for the off-camera finishing of a report (fictional, consistent with the sample notes). */
const TEXT_ANSWERS = [
  [/affected area 1$/i, "Neck"],
  [
    /area 1: pain VAS/i,
    "Pain 7/10 at worst and 3/10 at rest, across the back of the neck into the right upper shoulder.",
  ],
  [
    /area 1: range of movement/i,
    "Flexion 75%, extension 50%, right rotation 50%, left rotation 67%, side flexion 50% both ways.",
  ],
  [/affected area 2$/i, "Headaches"],
  [/area 2: pain VAS/i, "Headaches at the base of the skull 3–4 times a week."],
  [/area 2: range of movement/i, "N/A"],
  [/Pre-existing conditions – comments/i, "No previous neck or back problems."],
  [/Pre-existing conditions$/i, "None reported"],
  [/Medication 1 – frequency/i, "As needed"],
  [/Medication 1$/i, "Paracetamol and ibuprofen, as advised by his GP"],
  [/Activity 1 – frequency before/i, "Weekly"],
  [/Activity 1 – frequency since/i, "Stopped since the accident"],
  [/Activity 1 – comments/i, "Back to training by 19/08/2026."],
  [/Activity 1$/i, "Five-a-side football"],
  [/Activity 2 – frequency before/i, "2–3 times a week"],
  [/Activity 2 – frequency since/i, "Lower body work only"],
  [/Activity 2 – comments/i, "Gym limited to lower body work at first."],
  [/Activity 2$/i, "Gym"],
  [
    /time off sick/i,
    "3 days, then back on normal duties with breaks from the desk.",
  ],
  [/Restrictions at work/i, "None – regular breaks from the desk advised."],
  [/preventing return to work/i, "None – back on normal duties."],
  [/red flags/i, "Screened at the initial assessment: none found."],
  [/Barriers to recovery – details/i, "Mild travel anxiety when driving."],
  [/please specify/i, "N/A"],
  [/Occupation/i, "Lettings negotiator"],
  [
    /symptoms and progress/i,
    "Pain down from 7/10 to 4/10 at worst; headaches stopped; full range of movement returning.",
  ],
];
const CHOICE_ANSWERS = [
  [/taking medication/i, "Yes"],
  [/barriers to recovery\?/i, "Yes"],
  [/treatment currently appropriate/i, "Yes"],
  [/Manipulation/i, "Ticked"],
  [/Exercise Therapy/i, "Ticked"],
  [/Education/i, "Ticked"],
  [/Acupuncture|Physical Agents|Multimodal/i, "Not ticked"],
  [/WAD grade/i, "IIb"],
  [/back at work/i, "Yes"],
  [/further treatment requested/i, "No"],
];
const VALUE_ANSWERS = [
  [/Number of sessions required/i, "6"],
  [/Estimated date/i, "09/09/2026"],
  [/Date of initial assessment/i, "15/07/2026"],
  [/sessions attended/i, "7"],
  [/further sessions/i, "0"],
];
const pick = (list, label, def) =>
  (list.find(([re]) => re.test(label)) || [null, def])[1];
const ACK_REASON = "Checked against the made-up notes – nothing to add.";

/**
 * Off camera: answer every open box the clinician must answer, resolve or acknowledge every gap and flag, until the
 * header reads "Ready for your approval". Returns what was done.
 */
async function finishReview(page) {
  const done = {
    answered: [],
    choices: [],
    values: [],
    edited: [],
    resolved: 0,
    acknowledged: 0,
    rounds: 0,
  };
  for (let round = 0; round < 6; round++) {
    done.rounds = round + 1;
    // 1) Empty required (and any needs-input) answers.
    const todo = await page.$$eval("article[id^='q-']", (els) =>
      els.map((el) => {
        const label = (el.querySelector("h3")?.textContent || "").trim();
        const meta = el.innerText;
        const ta = Array.from(
          el.querySelectorAll("textarea[aria-label^='Answer to']"),
        ).filter((t) => !t.readOnly && !t.disabled && !t.closest("form"));
        const emptyTa = ta.length > 0 && ta.every((t) => !t.value.trim());
        const radios = Array.from(
          el.querySelectorAll("fieldset input[type=radio]"),
        );
        const radioEmpty =
          radios.length > 0 &&
          !radios.some((r) => r.checked) &&
          !radios[0].disabled;
        const val = el.querySelector("input[id^='value-']");
        const valEmpty =
          !!val && !val.value.trim() && !val.disabled && !val.readOnly;
        const needs =
          /Needs clinician input|To be entered by staff|Missing field/.test(
            meta,
          );
        const blankOk = /record's address has no line for it/.test(meta);
        return {
          id: el.id,
          label,
          required: /\bRequired\b/.test(meta),
          needs,
          emptyTa,
          radioEmpty,
          valEmpty,
          blankOk,
        };
      }),
    );
    let acted = 0;
    for (const q of todo) {
      if (!(q.required || q.needs) || q.blankOk) continue;
      const card = page.locator(`article[id='${q.id}']`);
      if (q.radioEmpty) {
        const want = pick(CHOICE_ANSWERS, q.label, null);
        const labels = card.locator("fieldset label");
        let target = want
          ? labels
              .filter({
                hasText: new RegExp(
                  `^\\s*${want.replace(/[()]/g, "\\$&")}\\s*$`,
                ),
              })
              .first()
          : labels.first();
        if (!(await target.count())) target = labels.first();
        await target.scrollIntoViewIfNeeded();
        await target.click();
        done.choices.push(`${q.label}: ${(await target.innerText()).trim()}`);
        acted++;
      } else if (q.valEmpty) {
        const v = pick(VALUE_ANSWERS, q.label, "N/A");
        const inp = card.locator("input[id^='value-']").first();
        await inp.scrollIntoViewIfNeeded();
        await inp.fill(v);
        await inp.press("Tab");
        done.values.push(`${q.label}: ${v}`);
        acted++;
      } else if (q.emptyTa) {
        const v = pick(
          TEXT_ANSWERS,
          q.label,
          "Made-up answer for this trial test.",
        );
        const ta = card.locator("textarea[aria-label^='Answer to']").first();
        await ta.scrollIntoViewIfNeeded();
        await ta.click();
        await page.keyboard.insertText(v.slice(0, 1));
        await sleep(150);
        const ed = card.locator("textarea[aria-label^='Answer to']").first();
        await ed.focus();
        await page.keyboard.press("End");
        await page.keyboard.insertText(v.slice(1));
        await card.locator("h3").first().click();
        done.answered.push(`${q.label}: ${v}`);
        acted++;
      }
      await sleep(120);
    }
    // 2) Gaps and flags: one-click "Mark resolved", else "Acknowledge with a reason".
    for (let guard = 0; guard < 80; guard++) {
      const quick = page
        .locator("main article[id^='q-'] button", {
          hasText: /^\s*Mark resolved\s*$/,
        })
        .first();
      if (await quick.count()) {
        if (!(await quick.evaluate((b) => !!b.closest("form")))) {
          await quick.scrollIntoViewIfNeeded();
          await quick.click();
          done.resolved++;
          await sleep(150);
          continue;
        }
      }
      const ack = page
        .locator("main article[id^='q-'] button", {
          hasText: /^\s*Acknowledge with a reason\s*$/,
        })
        .first();
      if (await ack.count()) {
        await ack.scrollIntoViewIfNeeded();
        await ack.click();
        const form = page
          .locator("main article[id^='q-'] form")
          .filter({ has: page.locator("textarea") })
          .first();
        await form.locator("textarea").last().fill(ACK_REASON);
        await form
          .getByRole("button", { name: /Acknowledge/ })
          .last()
          .click();
        done.acknowledged++;
        await sleep(150);
        continue;
      }
      break;
    }
    // 3) Drafted wording the app's own checks reject (an opinion phrase that is not in the cited note): the clinician
    //    rewrites the paragraph in her own words (a mapped answer from the notes) or takes the sentence out.
    const wording = await page.$$eval("article[id^='q-']", (els) =>
      els
        .map((el) => {
          // The evidence is shown in a <q> element, whose quotation marks are CSS (not in innerText).
          const m = el.innerText.match(
            /(?:Opinion language not in the cited note|not in the cited (?:note|record))[\s\S]*?Found: [“"]?([^\n”"]+)/,
          );
          return m
            ? {
                id: el.id,
                label: (el.querySelector("h3")?.textContent || "").trim(),
                phrase: m[1].trim(),
              }
            : null;
        })
        .filter(Boolean),
    );
    for (const w of wording) {
      const card = page.locator(`article[id='${w.id}']`);
      const tas = card.locator("textarea[aria-label^='Answer to']");
      for (let i = 0; i < (await tas.count()); i++) {
        const ta = tas.nth(i);
        const v = await ta.inputValue();
        if (!v.toLowerCase().includes(w.phrase.toLowerCase())) continue;
        const mapped = pick(TEXT_ANSWERS, w.label, null);
        const next =
          mapped ||
          v
            .split(/(?<=[.!?])\s+/)
            .filter((x) => !x.toLowerCase().includes(w.phrase.toLowerCase()))
            .join(" ")
            .trim() ||
          "As recorded in the notes.";
        await ta.scrollIntoViewIfNeeded();
        await ta.fill(next);
        await card.locator("h3").first().click();
        done.edited.push({
          question: w.label,
          phrase: w.phrase,
          before: v.slice(0, 240),
          after: next,
        });
        acted++;
        await sleep(200);
      }
    }
    await sleep(600);
    const status = await page
      .locator("#approve-blocked")
      .innerText()
      .catch(() => "");
    if (/Ready for your approval/.test(status))
      return { ...done, status: status.trim() };
    if (!acted && round > 1) {
      await page
        .getByRole("tab", { name: /Flags/ })
        .click()
        .catch(() => {});
      await sleep(500);
      const flags = await page
        .locator("[role=tabpanel][data-state=active]")
        .first()
        .innerText()
        .catch(() => "");
      throw new Error(
        `Not ready for approval after ${round + 1} rounds: ${status.replace(/\s+/g, " ")} | ${flags.replace(/\s+/g, " ").slice(0, 700)}`,
      );
    }
  }
  throw new Error("finishReview: too many rounds");
}

/** Off camera: approve the open report as the signed-in clinician (used for the portal report). */
async function approveOffCamera(page, who) {
  await page
    .getByRole("button", { name: /^Approve/ })
    .first()
    .click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  await approveDialog(dlg, who, null);
  await page
    .getByText(/Approved/)
    .first()
    .waitFor({ timeout: 60000 });
}

/** Ticks the declaration, types the signature, ticks the attestations and clicks "Approve and sign". */
async function approveDialog(dlg, who, d) {
  const boxes = dlg.locator("input[type=checkbox]");
  const typed = dlg.getByLabel(/Typed signature/);
  const tick = async (i) => {
    const b = boxes.nth(i);
    if (await b.isChecked()) return;
    if (d)
      await d.click(
        dlg.locator(`label[for='${await b.getAttribute("id")}']`).first(),
        { ms: 300, pause: 60, after: 120, inner: true },
      );
    else await b.check();
  };
  const n0 = await boxes.count();
  if (n0) await tick(0);
  if (d) await d.type(typed, who.name, { cps: 14, ms: 380, inner: true });
  else await typed.fill(who.name);
  const n = await boxes.count();
  for (let i = 1; i < n; i++) await tick(i);
  const btn = dlg.getByRole("button", { name: "Approve and sign" });
  if (d) await d.click(btn, { ms: 380, inner: true });
  else await btn.click();
}

/* ---------------------------------------------------------------------------------------------
 * The take
 * -------------------------------------------------------------------------------------------*/
async function record() {
  for (const k of ["frames", "downloads"]) {
    fs.rmSync(DIRS[k], { recursive: true, force: true });
    fs.mkdirSync(DIRS[k], { recursive: true });
  }
  const health = await (await fetch(`${BASE}/api/reports/v1/health`)).json();
  await step("server health", async () => {
    if (!REHEARSE && !(health.aiMode === "live" && health.liveAiAvailable))
      throw new Error(
        `Live drafting is not available (aiMode ${health.aiMode})`,
      );
    return {
      aiMode: health.aiMode,
      liveAiAvailable: health.liveAiAvailable,
      version: health.version,
    };
  });
  const callsBefore = liveCalls();
  const link = ownerLink();

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      `--force-device-scale-factor=${SCALE}`,
      `--window-size=${VIEW.w},${VIEW.h}`,
      "--hide-scrollbars",
    ],
  });
  const problems = [];
  const mkCtx = async (label) => {
    const ctx = await browser.newContext({
      viewport: null,
      acceptDownloads: true,
      locale: "en-GB",
      timezoneId: "Europe/London",
    });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: BASE,
    });
    await ctx.addInitScript(overlayInit, {
      bar: false,
      liftToasts: true,
      css: SECRET_CSS,
    });
    ctx.on("page", (p) => {
      p.on("pageerror", (e) =>
        problems.push(`[${label} pageerror] ${String(e).slice(0, 300)}`),
      );
      p.on("console", (m) => {
        if (m.type() === "error")
          problems.push(`[${label} console] ${m.text().slice(0, 300)}`);
      });
      p.on("response", (r) => {
        if (r.status() >= 400 && /\/api\//.test(r.url()))
          problems.push(
            `[${label}] ${r.status()} ${r.request().method()} ${r
              .url()
              .replace(BASE, "")
              .replace(/token=[^&]+/, "token=…")}`,
          );
      });
    });
    return ctx;
  };
  const ctxD = await mkCtx("owner");
  const ctxS = await mkCtx("physio");
  const D = await ctxD.newPage();
  const S = await ctxS.newPage();
  const size = await D.evaluate(() => [
    innerWidth,
    innerHeight,
    devicePixelRatio,
  ]);
  if (Math.abs(size[0] - VIEW.w) > 2 || size[1] !== VIEW.h)
    throw new Error(`Unexpected viewport ${size}`);

  const cast = new Cast(DIRS.frames);
  const d = new Director(cast);
  const facts = FACTS;
  Object.assign(facts, { rehearse: REHEARSE, viewport: size });
  let reportUrl = null;

  /* ---------- Before the segment: the owner's invitation page ---------- */
  await step(
    "open the owner's invitation link (page only, link never shown)",
    async () => {
      await D.goto(link);
      await D.getByRole("heading", { name: "Create your account" }).waitFor();
      await settle(D, 600);
      await cast.attach(D);
      await d.park(1180, 520);
      await sleep(500);
    },
  );
  d.start();
  await d.hold(0.6);

  const chapterAt = [];
  const chapter = (n) => chapterAt.push({ n, wall: now(), name: CHAPTERS[n] });
  try {
    /* ======================= Chapter 1 – First sign-in (Dell) ======================= */
    chapter(1);
    await d.line("H03", async () => {
      facts.inviteSummary = (
        await D.getByText(/You have been invited to join/).innerText()
      ).replace(/\s+/g, " ");
      await d.hover(D.getByText(/You have been invited to join/), {
        dx: 0.35,
        ms: 900,
      });
      await d.at(d.w("once") - 0.2);
      await d
        .hover(D.getByText(/This\s+invitation expires/).first(), {
          dx: 0.6,
          ms: 500,
        })
        .catch(() => {});
    });
    await d.line("H04", async () => {
      await d.hoverWord(D.getByLabel("Full name", { exact: true }), "name", {
        dx: 0.2,
      });
      await d.type(D.getByLabel("Full name", { exact: true }), OWNER.name, {
        cps: 13,
        ms: 300,
      });
      await d.at(Math.max(0, d.w("password") - 0.6));
      await d.type(
        D.getByLabel("Choose a password", { exact: true }),
        OWNER.password,
        { cps: 24, ms: 400 },
      );
      await d.type(
        D.getByLabel("Repeat the password", { exact: true }),
        OWNER.password,
        { cps: 24, ms: 350 },
      );
    });
    await d.line("H05", async () => {
      await d.clickWord(
        exact(D, "button", "Create account and join"),
        "Create",
      );
      await d.trim(
        (async () => {
          await D.waitForURL(/\/two-factor/, { timeout: 30000 });
          await D.getByRole("heading", {
            name: "Two-step verification",
          }).waitFor();
          await settle(D, 200);
          await d.syncCursor();
        })(),
      );
      await d.at(Math.max(0, d.w("password") - 0.7));
      await d.type(D.getByLabel("Password", { exact: true }), OWNER.password, {
        cps: 24,
        ms: 450,
      });
      await d.clickWord(
        exact(D, "button", "Set up two-step verification"),
        "set",
        { n: 0, dt: 0.1 },
      );
      await d.trim(
        (async () => {
          await D.waitForSelector("img[alt^='Authenticator set-up code']", {
            state: "attached",
            timeout: 30000,
          });
          await settle(D, 250);
          await d.syncCursor();
        })(),
      );
      OWNER.key = (
        (await D.locator("code").first().textContent()) || ""
      ).replace(/\s+/g, "");
      if (OWNER.key.length < 16)
        throw new Error("No authenticator key on the set-up page");
    });
    await d.line("H06", async () => {
      await d.hoverWord(
        D.locator("img[alt^='Authenticator set-up code']"),
        "code",
        { noReveal: true, ms: 700 },
      );
      await d.at(d.w("authenticator"));
      await d.hover(D.getByText("1. Add ClinForms to your authenticator app"), {
        dx: 0.3,
        ms: 600,
      });
    });
    await d.line("H07", async () => {
      await d.reveal(
        D.getByRole("heading", { name: "2. Save your backup codes" }),
        { block: "start", top: 120 },
      );
      await d.hover(D.locator("ul[aria-label='Backup codes']"), {
        ms: 600,
        noReveal: true,
      });
      await d.at(Math.max(0, d.w("tick") - 0.8));
      await d.click(D.getByLabel("I have saved my backup codes"), { ms: 600 });
    });
    await d.line("H08", async () => {
      const field = D.getByLabel("6-digit code");
      await d.reveal(field, { top: 200, bottom: 260 });
      await d.at(Math.max(0, d.w("Type") - 0.2));
      // A code with too little of its 30 s left is not typed: wait for the next one inside a cut (the field is masked anyway).
      if (totpLeft() < 8) {
        await d.cut(async () => {
          while (totpLeft() < 8 || totpLeft() > 29.5) await sleep(150);
        });
      }
      await d.type(field, totp(OWNER.key), { cps: 7, ms: 450 });
      await d.clickWord(
        exact(D, "button", "Turn on two-step verification"),
        "Turn",
      );
      await d.trim(
        (async () => {
          await D.waitForURL(/\/app(\/select-clinic)?(\?.*)?$/, {
            timeout: 30000,
          });
          if (/select-clinic/.test(D.url())) {
            facts.clinicChooserShown = true;
            await D.getByRole("button", { name: /Open/ }).first().click();
            await D.waitForURL(/\/app(\?.*)?$/, { timeout: 30000 });
          }
          await D.locator("[data-testid=trial-banner]")
            .first()
            .waitFor({ timeout: 20000 });
          await D.evaluate(() => window.scrollTo(0, 0));
          await settle(D, 300);
          await d.syncCursor();
        })(),
      );
    });
    await d.line("H09", async () => {
      const banner = D.locator("[data-testid=trial-banner]").first();
      facts.trialBanner = (await banner.innerText()).trim();
      facts.signedInAs = (
        await D.getByText(/Signed in as/)
          .first()
          .innerText()
      ).trim();
      if (!/3 days left/.test(facts.trialBanner))
        finding(
          "check",
          `Trial banner after the first sign-in reads "${facts.trialBanner}" (expected 3 days left)`,
        );
      await d.hover(D.getByText(/Signed in as/).first(), { dx: 0.3, ms: 600 });
      await d.clickWord(banner, "banner", { dx: 0.35, noReveal: true });
      await d.until(d.cur.v0 + VOICE.H09 + 0.2);
      const setup = D.getByRole("heading", { name: "Set up your clinic" });
      await d.reveal(setup, { block: "start", top: 110 });
      facts.setupSteps =
        (
          await setup
            .locator("xpath=..")
            .innerText()
            .catch(() => "")
        ).split("\n")[1] || null;
      for (const t of [
        "Clinic details",
        "Drafting from the notes",
        "Invite your clinicians",
        "Signing details",
        "Your first referrer form",
      ]) {
        await d
          .hover(
            setup.locator("xpath=..").getByText(t, { exact: true }).first(),
            { dx: 0.2, ms: 420, noReveal: true },
          )
          .catch(() => {});
        await sleep(250);
      }
    });

    /* ======================= Chapter 2 – Turn on drafting (Dell) ======================= */
    chapter(2);
    await d.line("H10", async () => {
      await d.scrollTo(0, 700);
      await d.clickWord(topLink(D, "Clinic"), "Clinic", { noReveal: true });
      await d.trim(
        (async () => {
          await D.getByRole("heading", { name: "Clinic details" }).waitFor({
            timeout: 30000,
          });
          await settle(D, 300);
          await d.syncCursor();
        })(),
      );
      facts.draftingInitiallyOn = await D.locator("#f-drafting").isChecked();
      if (facts.draftingInitiallyOn)
        finding(
          "check",
          "Drafting from the notes was already on before the owner ticked it",
        );
      await d.hover(
        D.getByText(
          "These details are written into the referrer forms your clinic completes.",
        ),
        { dx: 0.3, ms: 600 },
      );
    });
    await d.line("H11", async () => {
      const box = D.locator("#f-drafting");
      await d.reveal(box, { top: 260, bottom: 200 });
      if (REHEARSE) await d.hoverWord(box, "Tick", { noReveal: true });
      else await d.clickWord(box, "Tick", { noReveal: true });
      await d.at(d.w("text") - 0.3);
      const hint = D.locator("#f-drafting-hint");
      const hb = await hint.boundingBox();
      if (hb) {
        await d.moveTo(hb.x + 20, hb.y + hb.height + 14, 500);
        await d.moveTo(
          hb.x + Math.min(hb.width, 900),
          hb.y + hb.height + 14,
          2200,
        );
      }
      facts.draftingHint = (await hint.innerText()).replace(/\s+/g, " ");
    });
    await d.line("H12", async () => {
      await d.reveal(D.getByLabel("Clinic name", { exact: true }), {
        top: 140,
        ms: 900,
      });
      for (const l of [
        "Clinic name",
        "Address",
        "Postcode",
        "Phone",
        "Email for referrers",
      ]) {
        const f =
          l === "Address"
            ? D.locator("#f-address")
            : D.getByLabel(l, { exact: true });
        await d.hover(f, { dx: 0.25, ms: 380, noReveal: true });
        await sleep(120);
      }
      const save = exact(D, "button", "Save clinic details");
      await d.reveal(save, { bottom: 220, ms: 800 });
      await d.clickWord(save, "Save", { noReveal: true });
      const saved = D.getByText("Saved.", { exact: true }).first();
      await d.trim(saved.waitFor({ timeout: 20000 }));
      await d.reveal(saved, { top: 140, ms: 700 });
      await d.hover(saved, { dx: 0.4, ms: 400, noReveal: true });
      facts.draftingSaved = await D.locator("#f-drafting").isChecked();
      await d.hold(1.0);
    });

    /* ---------- Off camera: Dell invites Sarah (clinician); Sarah accepts and sets up two-step ---------- */
    await step(
      "off camera: owner invites sarah.reid@example.com (Clinician); her emailed link is read from the server log",
      () =>
        d.cut(async () => {
          await D.goto(`${BASE}/app/settings/members`);
          await D.getByRole("heading", { name: "Invite someone" }).waitFor();
          const from = logSize();
          await D.locator("form:has(input[name=email])")
            .getByLabel("Email address")
            .fill(SARAH.email);
          await D.selectOption(
            "form:has(input[name=email]) select[name=role]",
            "clinician",
          );
          await exact(D, "button", "Invite").click();
          await D.getByText(`Invitation emailed to ${SARAH.email}.`).waitFor({
            timeout: 20000,
          });
          SARAH.link = await emailedLink(SARAH.email, from);
          await signUpOffCamera(S, SARAH.link, SARAH);
          await D.goto(`${BASE}/app/settings/clinic`);
          await D.getByRole("heading", { name: "Clinic details" }).waitFor();
          await D.evaluate(() => window.scrollTo(0, 0));
          await settle(D, 400);
          await d.syncCursor();
          return "invited, accepted, two-step on";
        }),
    );

    /* ======================= Chapter 3 – Set up the physio who approves (Dell) ======================= */
    chapter(3);
    await d.line("H13", async () => {
      await d.clickWord(topLink(D, "Members"), "physio", {
        noReveal: true,
        dt: 0.2,
      });
      await d.trim(
        (async () => {
          await D.getByText(/^Members \(\d+\)$/)
            .first()
            .waitFor({ timeout: 30000 });
          await settle(D, 300);
          await d.syncCursor();
        })(),
      );
      facts.membersHeading = (
        await D.getByText(/^Members \(\d+\)$/)
          .first()
          .innerText()
      ).trim();
      const row = D.locator("li", {
        has: D.locator(`text=${SARAH.email}`),
      }).first();
      await d.reveal(row, { top: 160, bottom: 260, ms: 900 });
      await d.hoverWord(row.locator("p").first(), "Sarah", {
        noReveal: true,
        dx: 0.3,
      });
      facts.sarahRowBefore = (await row.innerText())
        .replace(/\s+/g, " ")
        .slice(0, 160);
    });
    const sarahRow = D.locator("li", {
      has: D.locator(`text=${SARAH.email}`),
    }).first();
    await d.line("H14", async () => {
      await d.clickWord(
        sarahRow.locator("summary", { hasText: "Manage" }),
        "Manage",
      );
      await sleep(350);
      await d.reveal(sarahRow.locator("input[name=hcpcNumber]"), {
        top: 160,
        bottom: 240,
        ms: 700,
      });
      await d.at(Math.max(0, d.w("job") - 0.4));
      await d.type(sarahRow.locator("input[name=jobTitle]"), SARAH.job, {
        cps: 15,
        ms: 420,
      });
      await d.type(sarahRow.locator("input[name=hcpcNumber]"), SARAH.hcpc, {
        cps: 9,
        ms: 420,
      });
    });
    await d.line("H15", async () => {
      await d.clickWord(sarahRow.locator("input[name=canSign]"), "Tick");
      await d.clickWord(
        sarahRow.getByRole("button", { name: "Save signing details" }),
        "Save",
      );
      await d.trim(
        sarahRow
          .getByText("Saved.", { exact: true })
          .waitFor({ timeout: 20000 }),
      );
      await d.hover(sarahRow.getByText("Saved.", { exact: true }), {
        dx: 0.3,
        ms: 400,
        noReveal: true,
      });
      await d.at(d.w("approve") - 0.6);
      const summary = sarahRow.locator("p", { hasText: /HCPC/ }).first();
      if (await summary.count()) {
        await d.reveal(summary, { top: 160, ms: 700 });
        await d.hover(summary, { dx: 0.5, ms: 500, noReveal: true });
        facts.sarahRowAfter = (await summary.innerText()).trim();
      } else
        finding(
          "check",
          "Sarah's row did not show her signing details right after saving",
        );
    });

    /* ---------- Off camera: switch to Sarah (fresh load so her signing details are current) ---------- */
    await step(
      "off camera: switch to Sarah's browser (overview reloaded after her signing details were saved)",
      () =>
        d.cut(async () => {
          await S.goto(`${BASE}/app`);
          await S.locator("[data-testid=trial-banner]")
            .first()
            .waitFor({ timeout: 20000 });
          await settle(S, 500);
          await cast.attach(S);
          await d.park(1000, 450);
          await sleep(400);
        }),
    );

    /* ======================= Chapter 4 – Check a provider form once (Sarah) ======================= */
    chapter(4);
    await d.line("H16", async () => {
      await d.click(topLink(S, "Studio"), { ms: 650 });
      await d.trim(
        (async () => {
          await S.waitForURL(/\/app\/studio/, { timeout: 30000 });
          await S.locator("header")
            .getByRole("link", { name: "Referrer forms", exact: true })
            .first()
            .waitFor({ timeout: 30000 });
          await settle(S, 500);
          await d.syncCursor();
        })(),
      );
      facts.studioAccountChip = await S.locator("header")
        .getByText(SARAH.name)
        .first()
        .isVisible()
        .catch(() => false);
      await d.clickWord(
        S.locator("header")
          .getByRole("link", { name: "Referrer forms", exact: true })
          .first(),
        "checked",
        { noReveal: true, ms: 600 },
      );
      await d.trim(
        (async () => {
          await S.getByText("Proposed – needs review")
            .first()
            .waitFor({ timeout: 30000 });
          await S.getByText(/forms from \d+ referrers/)
            .first()
            .waitFor({ timeout: 30000 });
          await settle(S, 600);
        })(),
      );
      const lib = S.getByText(/forms from \d+ referrers/).first();
      facts.formsLibrary = (await lib.innerText()).trim();
      await d.reveal(lib, { top: 160, bottom: 380, ms: 900 });
      await d.hover(lib, { dx: 0.4, ms: 500, noReveal: true });
      await d.hoverWord(
        S.getByText("Proposed – needs review").first(),
        "Sarah",
        { dt: -0.6, top: 150, bottom: 200 },
      );
    });
    const card = S.locator('p[title="10Bridge"]')
      .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
      .filter({
        has: S.locator("h3", { hasText: "Initial Assessment Report" }),
      })
      .first();
    await d.line("H17", async () => {
      await d.reveal(card, { top: 130, bottom: 160, ms: 1100 });
      await d.hover(card.locator("h3"), { dx: 0.3, ms: 500, noReveal: true });
      await d.clickWord(
        card.getByRole("link", { name: "Review mapping" }),
        "Review",
        { noReveal: true },
      );
      await d.trim(
        (async () => {
          await S.getByText(
            "Form details – referrer, title and version",
          ).waitFor({ timeout: 30000 });
          await S.getByRole("group", { name: "Filter questions" }).waitFor({
            timeout: 30000,
          });
          await sleep(1800);
          // The first question to check opens by default; close it, so the list starts closed (off camera).
          const open = S.locator("button[aria-expanded='true']").first();
          if (await open.count()) {
            facts.mappingOpenByDefault = (await open.innerText())
              .replace(/\s+/g, " ")
              .slice(0, 80);
            await open.click();
            await sleep(300);
          }
          await S.evaluate(() => window.scrollTo(0, 0));
          await settle(S, 400);
          await d.syncCursor();
        })(),
      );
      const head = (await S.locator("main").innerText())
        .split("\n")
        .slice(0, 12)
        .join(" | ");
      facts.mappingHeader = head.slice(0, 400);
      await d.hover(
        S.getByText("Proposed mapping – check it once, then confirm").first(),
        { dx: 0.3, ms: 500 },
      );
    });
    const chips = S.getByRole("group", { name: "Filter questions" });
    await d.line("H18", async () => {
      await d.reveal(chips, { block: "start", top: 110, ms: 1000 });
      facts.filterChips = (await chips.innerText()).replace(/\s+/g, " ");
      await d.clickWord(
        chips.getByRole("button", { name: /To check/ }).first(),
        "check",
        { noReveal: true },
      );
      await sleep(300);
      const wad = S.locator("button[aria-expanded]", {
        hasText: "WAD grade",
      }).first();
      if (!(await wad.count()))
        throw new Error("WAD grade question not in the To check list");
      await d.clickWord(wad, "question", { top: 200, bottom: 200 });
      await sleep(900);
      facts.previewHighlight = await S.getByText(/highlighting F-\d+/)
        .first()
        .innerText()
        .catch(() => null);
      await d.at(d.w("form") + 0.2);
      const occ = S.locator("button[aria-expanded]", {
        hasText: /^F-\d+\s*Occupation/,
      }).first();
      if (await occ.count()) {
        await d.click(occ, { top: 200, bottom: 200 });
        facts.occupationInToCheck = true;
      } else facts.occupationInToCheck = false;
    });
    await d.line("H19", async () => {
      const rg = S.getByRole("radiogroup", {
        name: "Where the answer comes from",
      }).first();
      await d.reveal(rg, { top: 160, bottom: 200, ms: 700 });
      for (const [label, word] of [
        ["From the patient record", "record"],
        ["Drafted from notes", "notes"],
        ["Clinician opinion", "opinion"],
      ]) {
        const r = rg.getByRole("radio", { name: label, exact: true });
        if (await r.count()) await d.hoverWord(r, word, { noReveal: true });
      }
      await d.until(d.cur.v0 + VOICE.H19);
      const rw = S.locator("button[aria-expanded]", {
        hasText: "Restrictions at work",
      }).first();
      if (await rw.count()) {
        await d.click(rw, { top: 200, bottom: 200 });
        await sleep(700);
      } else
        finding("check", "Restrictions at work was not in the To check list");
    });
    await d.line("H20", async () => {
      const bar = S.getByRole("button", { name: "Confirm mapping" }).first();
      await d.clickWord(bar, "Confirm", { noReveal: true });
      const dlg = S.getByRole("dialog");
      await d.trim(dlg.waitFor({ timeout: 20000 }));
      await sleep(300);
      facts.confirmName = await dlg
        .locator("#confirm-by")
        .inputValue()
        .catch(() => null);
      if (!facts.confirmName) await dlg.locator("#confirm-by").fill(SARAH.name);
      await d.click(dlg.locator("input[type=checkbox]").first(), {
        ms: 420,
        inner: true,
      });
      await d.click(dlg.getByRole("button", { name: "Confirm mapping" }), {
        ms: 420,
        inner: true,
      });
      await d.trim(dlg.waitFor({ state: "detached", timeout: 30000 }));
      const conf = S.getByText(
        /Mapping confirmed by .* It will be reused/,
      ).first();
      await d.trim(conf.waitFor({ timeout: 20000 }));
      facts.mappingConfirmed = (await conf.innerText()).trim();
      await d.at(d.w("ready") - 0.6);
      await d.reveal(conf, { top: 140, ms: 900 });
      await d.hover(conf, { dx: 0.35, ms: 500, noReveal: true });
      await d.hold(1.5);
    });

    /* ======================= Chapter 5 – Complete a report from notes (Sarah) ======================= */
    chapter(5);
    await d.line("H21", async () => {
      await d.scrollTo(0, 600);
      await d.clickWord(
        S.locator("header")
          .getByRole("link", { name: "Complete a form", exact: true })
          .first(),
        "Complete",
        { noReveal: true },
      );
      const zone = S.getByText(
        "Drop the patient's notes here, or choose a file",
      );
      await d.trim(
        (async () => {
          await zone.waitFor({ timeout: 30000 });
          await settle(S, 400);
        })(),
      );
      await d.hoverWord(zone, "drop", { top: 200, bottom: 240 });
      await d.at(d.w("Jordan"));
      await S.locator("input[type=file]").first().setInputFiles(NOTES);
      await d.trim(
        (async () => {
          await S.getByText("Check the notes before they are used").waitFor({
            timeout: 60000,
          });
          await settle(S, 500);
          await S.evaluate(() => window.scrollTo(0, 0));
          await d.syncCursor();
        })(),
        0.6,
      );
    });
    await d.line("H22", async () => {
      const sum = S.getByText(/\d+ entries · \d+ clinicians?/).first();
      facts.notesSummary = (await sum.innerText().catch(() => "")).trim();
      await d.reveal(sum, { top: 160, ms: 700 });
      await d.hoverWord(sum, "details", { noReveal: true, dx: 0.3 });
      await d.reveal(S.getByText("Patient and referral details").first(), {
        block: "start",
        top: 110,
        ms: 1100,
      });
      await d.hover(S.getByText("Patient and referral details").first(), {
        dx: 0.2,
        ms: 400,
        noReveal: true,
      });
      await d.at(d.w("notes") - 0.2);
      const notesHead = S.getByText(/^Notes \(\d+ of \d+ included\)$/).first();
      facts.notesIncluded = (
        await notesHead.innerText().catch(() => "")
      ).trim();
      await d.reveal(notesHead, { block: "start", top: 110, ms: 1600 });
      await d.at(d.w("correct") - 0.3);
      await d.scrollWin(420, 1400);
    });
    await d.line("H23", async () => {
      const consent = S.getByLabel("Consent to share the report");
      await d.reveal(consent, { top: 220, bottom: 260, ms: 1100 });
      facts.consent = await consent
        .evaluate((el) =>
          el.tagName === "SELECT"
            ? el.options[el.selectedIndex]?.text
            : el.value,
        )
        .catch(() => null);
      await d.hover(consent, { ms: 450, noReveal: true });
      const use = S.getByRole("button", { name: "Use these notes" });
      await d.clickWord(use, "Use", { top: 160, bottom: 140 });
      await d.trim(
        (async () => {
          await S.getByRole("heading", {
            name: "Check what was imported",
          }).waitFor({ timeout: 60000 });
          await S.evaluate(() => window.scrollTo(0, 0));
          await settle(S, 400);
          await d.syncCursor();
        })(),
      );
    });
    await d.line("H24", async () => {
      facts.imported = (
        await S.getByText(/^Imported from/)
          .first()
          .innerText()
          .catch(() => "")
      ).replace(/\s+/g, " ");
      await d.reveal(S.getByText("Referred by", { exact: true }).first(), {
        top: 220,
        bottom: 300,
        ms: 700,
      });
      await d.hover(S.getByText("Referred by", { exact: true }).first(), {
        dx: 0.3,
        ms: 500,
        noReveal: true,
      });
      await d
        .hover(S.getByText("Disclosure consent", { exact: true }).first(), {
          dx: 0.3,
          ms: 500,
          noReveal: true,
        })
        .catch(() => {});
      await d.clickWord(
        S.getByRole("button", { name: "Choose the referrer form" }),
        "choose",
        { bottom: 120 },
      );
      const radio = S.getByRole("radio", {
        name: /Initial Assessment Report/,
      }).first();
      await d.trim(
        (async () => {
          await S.getByRole("heading", {
            name: "Which referrer form?",
          }).waitFor({ timeout: 30000 });
          await radio.waitFor({ timeout: 30000 });
          await settle(S, 300);
        })(),
      );
      facts.formChoice =
        (await S.locator("main").innerText()).match(
          /No form in the library[^\n]*/,
        )?.[0] || null;
      const radioCard = radio.locator("xpath=ancestor::label[1]");
      await d.click((await radioCard.count()) ? radioCard : radio, {
        top: 220,
        bottom: 260,
        dx: 0.3,
      });
      await d.clickWord(
        S.getByRole("button", { name: "Complete this form" }),
        "Complete",
        { bottom: 120 },
      );
      facts.completeClickedAt = now();
    });
    await d.line("H25", async () => {
      await S.getByText(/groups? of questions/)
        .first()
        .waitFor({ timeout: 30000 });
      await d.hover(S.getByText(/groups? of questions/).first(), {
        dx: 0.3,
        ms: 600,
      });
      await d.hold(1.0);
      const readyRe = REHEARSE
        ? /Open for review/
        : /Ready for clinician review/;
      const t0 = now();
      await d.speed(
        S.waitForFunction(
          (src) =>
            new RegExp(src).test(document.body.innerText) ||
            /could not be drafted|Could not complete the form/.test(
              document.body.innerText,
            ),
          readyRe.source,
          { timeout: 600000, polling: 250 },
        ),
        "drafting",
        facts.completeClickedAt,
      );
      facts.draftingWallSeconds = Number(
        (now() - facts.completeClickedAt).toFixed(1),
      );
      facts.draftingSpedSeconds = Number((now() - t0).toFixed(1));
      const body = await S.locator("main").innerText();
      facts.draftingResult = (body.match(
        /(Ready for clinician review[^\n]*\n?[^\n]*)|(\d+ groups? of questions could not be drafted[^\n]*)|(Could not complete the form[^\n]*)/,
      ) || [""])[0].replace(/\s+/g, " ");
      facts.draftingGroups = (body.match(/\d+ of \d+ groups? of questions/) || [
        null,
      ])[0];
      if (/could not be drafted|Could not complete/.test(body))
        finding("bug", `Drafting: ${facts.draftingResult}`);
      await d.hold(0.7);
      await d.trim(
        (async () => {
          if (REHEARSE || !/Ready for clinician review/.test(body)) {
            const open = S.getByRole("link", { name: "Open for review" });
            await open.waitFor({ timeout: 30000 });
            await open.click();
          }
          await S.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 60000 });
          await S.locator("article[id^='q-']")
            .first()
            .waitFor({ timeout: 60000 });
          await sleep(1500);
          await settle(S, 300);
          await d.syncCursor();
        })(),
        0.3,
      );
      reportUrl = S.url();
      facts.callsAfterDraft = liveCalls();
    });
    await d.line("H26", async () => {
      // A drafted answer with a citation chip; F-14 first (the storyboard's choice), then any other.
      let target = null;
      for (const sel of [
        "article#q-F-14",
        "article#q-F-15",
        "article[id^='q-F-']",
      ]) {
        const c = S.locator(sel)
          .filter({ has: S.locator("button", { hasText: /^N-\d+/ }) })
          .first();
        if (await c.count()) {
          target = c;
          break;
        }
      }
      let chipRe = /^N-\d+/;
      if (!target && REHEARSE) {
        chipRe = /\S/;
        target = S.locator("article[id^='q-F-']")
          .filter({ has: S.locator("button.font-mono") })
          .first();
        finding(
          "rehearsal",
          "No drafted answer to cite (drafting off): a record answer's source chip is clicked instead",
        );
      }
      if (!target || !(await target.count()))
        throw new Error("No answer with a citation chip on the review page");
      facts.citedQuestion = (
        await target.locator("h3").first().innerText()
      ).trim();
      facts.citedPill = await target
        .getByText("Draft", { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      await d.reveal(target.locator("h3").first(), {
        block: "start",
        top: 120,
        ms: 1100,
      });
      const chip = target
        .locator("button.font-mono", { hasText: chipRe })
        .first();
      await d
        .hover(target.getByText("Draft", { exact: true }).first(), {
          ms: 500,
          noReveal: true,
        })
        .catch(() => {});
      await d.clickWord(chip, "Click", { noReveal: true });
      await sleep(600);
      facts.sourcesTabActive = await S.getByRole("tab", { name: /Sources/ })
        .getAttribute("data-state")
        .catch(() => null);
      facts.citedNote = (
        await S.locator("[role=tabpanel][data-state=active]")
          .first()
          .innerText()
          .catch(() => "")
      )
        .split("\n")
        .slice(0, 3)
        .join(" | ")
        .slice(0, 160);
      await d.hold(1.5);
    });
    await d.line("H27", async () => {
      await d.clickWord(S.getByRole("tab", { name: /Flags/ }), "Flags", {
        noReveal: true,
      });
      await sleep(500);
      const panel = S.locator("[role=tabpanel][data-state=active]").first();
      facts.flagsHeader = (await panel.innerText())
        .split("\n")
        .slice(0, 3)
        .join(" | ");
      // A gap that is not the provider's own reference (typed in later) and not the opinion typed in next.
      const ackButtons = panel.getByRole("button", {
        name: "Acknowledge with a reason",
      });
      const n = await ackButtons.count();
      let gap = null;
      const seen = [];
      for (const wantGap of [true, false]) {
        for (let i = 0; i < n && !gap; i++) {
          const g = ackButtons
            .nth(i)
            .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
          const t = await g
            .innerText()
            .catch((e) => `ERR ${String(e.message).slice(0, 80)}`);
          if (wantGap) seen.push(t.replace(/\s+/g, " ").slice(0, 70));
          if (wantGap && !/^Gap – not in the record/.test(t.trim())) continue;
          if (/F-01\b|F-16\b|Case Reference|range of movement/i.test(t))
            continue;
          gap = g;
          facts.ackKind = wantGap ? "gap" : "flag";
        }
        if (gap) break;
      }
      if (gap) {
        // A stable handle: the item's buttons change once "Acknowledge with a reason" is clicked.
        await gap.evaluate((el) => el.setAttribute("data-vid-ack", "1"));
        gap = panel.locator("[data-vid-ack='1']").first();
      }
      if (gap && facts.ackKind !== "gap")
        finding(
          REHEARSE ? "rehearsal" : "check",
          "No 'Gap – not in the record' item to acknowledge besides the provider reference; a flag was acknowledged instead",
        );
      if (!gap)
        throw new Error(
          `No gap to acknowledge in the Flags tab (${n} acknowledge buttons): ${JSON.stringify(seen.slice(0, 6))}`,
        );
      facts.ackGap = (await gap.innerText()).replace(/\s+/g, " ").slice(0, 200);
      await d.reveal(gap, { top: 220, bottom: 200, ms: 900 });
      await d.hoverWord(gap.locator("p").first(), "gap", { noReveal: true });
      await d.clickWord(
        gap.getByRole("button", { name: "Acknowledge with a reason" }),
        "acknowledge",
        { noReveal: true },
      );
      const ta = gap.locator("form textarea").last();
      await ta.waitFor({ timeout: 10000 });
      await d.type(ta, ACK_REASON, { cps: 26, ms: 350, inner: true });
      await d.click(
        gap
          .locator("form")
          .getByRole("button", { name: /^Acknowledge$/ })
          .last(),
        { ms: 380, inner: true },
      );
      // The acknowledged item moves into "Resolved and acknowledged (n)"; open it to show the result.
      const doneBox = panel
        .locator("summary", { hasText: "Resolved and acknowledged" })
        .first();
      await d.trim(
        doneBox
          .waitFor({ timeout: 10000 })
          .catch(() =>
            finding(
              "check",
              "No 'Resolved and acknowledged' list after acknowledging in the Flags tab",
            ),
          ),
      );
      facts.flagsAfterAck = (await panel.innerText()).split("\n")[0];
      if (await doneBox.count()) {
        await d.click(doneBox, { inner: true, ms: 500 });
        const ackDone = panel
          .getByText(/^(Gap acknowledged|Acknowledged: )/)
          .first();
        if (await ackDone.count()) {
          await d.reveal(ackDone, { inner: true, ms: 600 });
          await d.hover(ackDone, { ms: 450, noReveal: true });
        }
      }
    });
    let opinionKey = null;
    await d.line("H28", async () => {
      let target = null;
      for (const sel of [
        "article#q-F-16",
        "article#q-F-38",
        "article[id^='q-F-']",
      ]) {
        const c = S.locator(sel)
          .filter({
            has: S.getByText("Needs clinician input", { exact: true }),
          })
          .filter({
            has: S.locator(
              "textarea[placeholder^='Write your clinical opinion']",
            ),
          })
          .first();
        if (await c.count()) {
          target = c;
          break;
        }
      }
      if (!target) {
        target = S.locator("article[id^='q-F-']")
          .filter({
            has: S.getByText("Needs clinician input", { exact: true }),
          })
          .filter({ has: S.locator("textarea[aria-label^='Answer to']") })
          .first();
        if (!(await target.count()))
          throw new Error(
            "No 'Needs clinician input' question with an empty answer box",
          );
        finding(
          "check",
          "No opinion question with the 'Write your clinical opinion here' box; another 'Needs clinician input' question was used",
        );
      }
      opinionKey = (await target.getAttribute("id")).slice(2);
      // A stable handle: the card's status (and so the filter above) changes as soon as a character is typed.
      target = S.locator(`article[id='q-${opinionKey}']`);
      const label = (await target.locator("h3").first().innerText()).trim();
      facts.opinionQuestion = `${opinionKey} ${label}`;
      await d.reveal(target.locator("h3").first(), {
        block: "start",
        top: 120,
        ms: 1100,
      });
      await d.hoverWord(
        target.getByText("Needs clinician input", { exact: true }).first(),
        "Needs",
        { noReveal: true },
      );
      const box = target.locator("textarea[aria-label^='Answer to']").first();
      await d.clickWord(box, "physio", { noReveal: true, dx: 0.2 });
      const answer = pick(
        TEXT_ANSWERS,
        label,
        "In my opinion the findings are as recorded in the notes.",
      );
      await S.keyboard.type(answer.slice(0, 1));
      await sleep(200);
      const ed = target.locator("textarea[aria-label^='Answer to']").first();
      await ed.focus();
      await S.keyboard.press("End");
      await d.typeText(answer.slice(1), 26);
      facts.opinionAnswer = answer;
      // Commit inside a short cut, so no transient red state is on screen.
      await d.cut(async () => {
        await target.locator("h3").first().click();
        await sleep(350);
      });
      await d
        .hover(
          target.getByText("Your own words – no citation needed").first(),
          { ms: 500, noReveal: true },
        )
        .catch(() =>
          finding(
            "check",
            "The clinician's answer did not show 'Your own words – no citation needed'",
          ),
        );
    });
    await d.line("H29", async () => {
      const ref = S.locator("article#q-F-01");
      await d.reveal(ref.locator("h3").first(), {
        block: "start",
        top: 120,
        ms: 1300,
      });
      facts.caseRefNotice =
        (await ref.innerText())
          .match(/10Bridge (?:uses|asks)[^\n]*/)?.[0]
          ?.slice(0, 220) || null;
      const box = ref.locator("textarea[aria-label^='Answer to']").first();
      await d.clickWord(box, "type", { noReveal: true, dx: 0.2 });
      await S.keyboard.type("S");
      await sleep(200);
      const ed = ref.locator("textarea[aria-label^='Answer to']").first();
      await ed.focus();
      await S.keyboard.press("End");
      await d.typeText("AMPLE-REF-01", 9);
      await d.cut(async () => {
        await ref.locator("h3").first().click();
        await sleep(350);
      });
      facts.caseRefPill = await ref
        .getByText("Entered by staff")
        .first()
        .isVisible()
        .catch(() => false);
      await d
        .hover(ref.getByText("Entered by staff").first(), {
          ms: 450,
          noReveal: true,
        })
        .catch(() =>
          finding("check", "Case Reference did not show 'Entered by staff'"),
        );
    });
    await d.line("H30", async () => {
      await d.at(d.w("skip") + 0.3);
      facts.finish10Bridge = await step(
        "off camera (labelled jump cut): Sarah answers the remaining boxes and resolves or acknowledges every gap",
        () =>
          d.jump(async () => {
            const r = await finishReview(S);
            await S.getByRole("tab", { name: /Flags/ }).click();
            await sleep(600);
            await S.evaluate(() => window.scrollTo(0, 0));
            await settle(S, 400);
            await d.syncCursor();
            return r;
          }, "H30 skip ahead"),
      );
      const panel = S.locator("[role=tabpanel][data-state=active]").first();
      facts.flagsAfter = (await panel.innerText())
        .split("\n")
        .slice(0, 2)
        .join(" | ");
      if (!/Nothing blocks approval/.test(facts.flagsAfter))
        finding("check", `Flags tab after finishing: ${facts.flagsAfter}`);
      await d
        .hover(panel.getByText("Nothing blocks approval").first(), {
          ms: 500,
          inner: true,
        })
        .catch(() => {});
      const status = S.locator("#approve-blocked");
      facts.headerStatus = (await status.innerText()).trim();
      await d.hoverWord(status, "Ready", { noReveal: true, dx: 0.3 });
    });
    await d.line("H31", async () => {
      await d.clickWord(
        S.getByRole("button", {
          name: /^Approve…$|^Approve\.\.\.$|^Approve…/,
        }).first(),
        "Approve",
        { noReveal: true },
      );
      const dlg = S.getByRole("dialog");
      await d.trim(dlg.waitFor({ timeout: 20000 }));
      await sleep(300);
      facts.approveDialog = {
        name: await dlg
          .getByLabel("Full name", { exact: true })
          .inputValue()
          .catch(() => null),
        hcpc: await dlg
          .getByLabel("HCPC registration number")
          .inputValue()
          .catch(() => null),
        checkboxes: await dlg.locator("input[type=checkbox]").count(),
        declaration: ((await dlg.innerText()).match(
          /I approve it for issue to [^.\n]*/,
        ) || [null])[0],
      };
      await approveDialog(dlg, SARAH, d);
      await d.trim(
        (async () => {
          await dlg.waitFor({ state: "detached", timeout: 60000 });
          await S.getByText(
            /Approved – the completed form is final|Approved by/,
          )
            .first()
            .waitFor({ timeout: 60000 });
          await settle(S, 300);
        })(),
      );
    });
    await d.line("H32", async () => {
      const banner = S.getByText(/Approved by .*HCPC/).first();
      facts.approvedBanner = (await banner.innerText().catch(() => "")).trim();
      await d
        .reveal(S.getByText("Approved – the completed form is final").first(), {
          top: 140,
          ms: 600,
        })
        .catch(() => {});
      await d.hover(banner, { dx: 0.3, ms: 500 }).catch(() => {});
      const word = S.getByRole("button", { name: "Completed form (Word)" });
      await d.reveal(word, { top: 140, bottom: 200 });
      const dlP = S.waitForEvent("download", { timeout: 120000 });
      await d.clickWord(word, "Download", { noReveal: true });
      const dl = await d.trim(dlP);
      const file = path.join(DIRS.downloads, dl.suggestedFilename());
      await d.trim(dl.saveAs(file));
      const isDocx = fs.readFileSync(file).subarray(0, 2).toString() === "PK";
      const text = isDocx ? documentText(file) : "";
      facts.wordFile = {
        name: path.basename(file),
        bytes: fs.statSync(file).size,
        isDocx,
        banned: bannedIn(text).slice(0, 3),
        sampleRef: /SAMPLE-REF-01/.test(text),
        signedBy: /Sarah Reid/.test(text),
        hcpc: /ZZ0001/.test(text),
        mergeCodesLeft: (text.match(/<<[A-Z_0-9]+>>/g) || []).slice(0, 5),
      };
      facts.pdfButton = await S.getByRole("button", {
        name: "Completed form (PDF)",
      })
        .isDisabled()
        .catch(() => "absent");
      await d.at(d.w("test") - 0.3);
      await d.hover(word, { dx: 0.5, ms: 300, noReveal: true });
    });

    /* ======================= Chapter 6 – Online portals (Sarah) ======================= */
    chapter(6);
    let portalFormUrl = null;
    await d.line("H33", async () => {
      await d.scrollTo(0, 600);
      await d.clickWord(
        S.locator("header")
          .getByRole("link", { name: "Referrer forms", exact: true })
          .first(),
        "Referrer",
        { noReveal: true },
      );
      await d.trim(
        (async () => {
          await S.getByRole("button", { name: "Add portal questions" }).waitFor(
            { timeout: 30000 },
          );
          await settle(S, 500);
        })(),
      );
      await d.clickWord(
        S.getByRole("button", { name: "Add portal questions" }),
        "Add",
        { top: 140 },
      );
      await d.trim(S.getByRole("dialog").waitFor({ timeout: 20000 }));
    });
    await d.line("H34", async () => {
      const dlg = S.getByRole("dialog");
      await d.type(
        dlg.locator("input[id$='-referrer']"),
        "Sample Insurer Portal (fictional)",
        { cps: 30, ms: 380, inner: true },
      );
      await d.hover(dlg.locator("select[id$='-type']"), {
        ms: 350,
        inner: true,
      });
      await dlg
        .locator("select[id$='-type']")
        .selectOption({ label: "Insurer" });
      await sleep(250);
      const ta = dlg.locator("textarea[id$='-questions']");
      await d.clickWord(ta, "paste", { inner: true });
      await S.keyboard.insertText(PORTAL_QUESTIONS);
      await sleep(500);
      facts.portalFound = ((await dlg.innerText()).match(
        /\d+ questions? found[^\n]*/,
      ) || [null])[0];
      const found = dlg.getByText(/\d+ questions? found/).first();
      if (await found.count()) await d.hover(found, { ms: 450, inner: true });
      await d.clickWord(
        dlg.getByRole("button", { name: "Add and check the questions" }),
        "Add",
        { inner: true, n: 0, dt: 0 },
      );
      await d.trim(
        (async () => {
          await dlg.waitFor({ state: "detached", timeout: 30000 });
          await S.waitForURL(/\/app\/studio\/forms\/[^/]+$/, {
            timeout: 30000,
          });
          await S.getByRole("button", { name: "Confirm mapping" })
            .first()
            .waitFor({ timeout: 30000 });
          await settle(S, 800);
          await d.syncCursor();
        })(),
      );
      portalFormUrl = S.url();
      facts.portalMapping = (await S.locator("main").innerText())
        .split("\n")
        .slice(0, 8)
        .join(" | ")
        .slice(0, 300);
    });
    await d.line("H35", async () => {
      await d.clickWord(
        S.getByRole("button", { name: "Confirm mapping" }).first(),
        "Confirm",
        { noReveal: true },
      );
      const dlg = S.getByRole("dialog");
      await d.trim(dlg.waitFor({ timeout: 20000 }));
      if (
        !(await dlg
          .locator("#confirm-by")
          .inputValue()
          .catch(() => ""))
      )
        await dlg.locator("#confirm-by").fill(SARAH.name);
      await d.click(dlg.locator("input[type=checkbox]").first(), {
        ms: 380,
        inner: true,
      });
      await d.click(dlg.getByRole("button", { name: "Confirm mapping" }), {
        ms: 380,
        inner: true,
      });
      await d.trim(dlg.waitFor({ state: "detached", timeout: 30000 }));
      await S.getByText(/Mapping confirmed by/)
        .first()
        .waitFor({ timeout: 20000 });
      await d.hold(0.6);
      facts.portalReport = await step(
        "off camera (labelled jump cut): Use for a patient → Jordan's notes → Complete this form → review → finish → approve",
        () =>
          d.jump(async () => {
            const t0 = now();
            await S.goto(portalFormUrl.replace(/\/forms\/([^/]+)$/, "/forms"));
            const pc = S.locator('p[title="Sample Insurer Portal (fictional)"]')
              .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
              .first();
            await pc.waitFor({ timeout: 30000 });
            await pc.getByRole("link", { name: "Use for a patient" }).click();
            await S.getByText(
              "Drop the patient's notes here, or choose a file",
            ).waitFor({ timeout: 30000 });
            await S.locator("input[type=file]").first().setInputFiles(NOTES);
            await S.getByText("Check the notes before they are used").waitFor({
              timeout: 60000,
            });
            await S.getByRole("button", { name: "Use these notes" }).click();
            await S.getByRole("heading", {
              name: "Check what was imported",
            }).waitFor({ timeout: 60000 });
            await S.getByRole("button", {
              name: "Choose the referrer form",
            }).click();
            await S.getByRole("heading", {
              name: "Which referrer form?",
            }).waitFor({ timeout: 30000 });
            const r = S.getByRole("radio", {
              name: /Sample Insurer Portal|portal/i,
            }).first();
            if ((await r.count()) && !(await r.isChecked())) await r.click();
            await S.getByRole("button", { name: "Complete this form" }).click();
            const open = S.getByRole("link", { name: "Open for review" });
            await Promise.race([
              S.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, { timeout: 600000 }),
              open.waitFor({ timeout: 600000 }),
            ]);
            if (!/rpt_/.test(S.url())) await open.click();
            await S.waitForURL(/\/app\/studio\/rpt_[^/?]+$/, {
              timeout: 60000,
            });
            await S.locator("article[id^='q-']")
              .first()
              .waitFor({ timeout: 60000 });
            await sleep(1500);
            const fin = await finishReview(S);
            await approveOffCamera(S, SARAH);
            const panel = S.getByRole("heading", {
              name: "Answers for the portal",
            });
            await panel.waitFor({ timeout: 30000 });
            await panel.scrollIntoViewIfNeeded();
            await S.evaluate(() => window.scrollBy(0, -140));
            await settle(S, 500);
            await d.syncCursor();
            return {
              seconds: Number((now() - t0).toFixed(1)),
              ...fin,
              calls: liveCalls().dayTotal,
            };
          }, "H35 jump"),
      );
    });
    await d.line("H36", async () => {
      const panel = S.locator("section", {
        has: S.getByRole("heading", { name: "Answers for the portal" }),
      }).first();
      facts.portalPanel = (await panel.innerText())
        .replace(/\s+/g, " ")
        .slice(0, 300);
      await d.reveal(panel, { top: 120, bottom: 200, ms: 600 });
      await d
        .hover(
          panel
            .getByText(/Approved: copied text is the approved answers/)
            .first(),
          { ms: 500, noReveal: true },
        )
        .catch(() =>
          finding(
            "check",
            "Portal panel lacks 'Approved: copied text is the approved answers.'",
          ),
        );
      const one = S.locator("button[aria-label^='Copy the answer to']").first();
      await d.clickWord(one, "one", { top: 160, bottom: 240 });
      await sleep(500);
      facts.toastOne = await S.getByText(/^Answer to “.*” copied$/)
        .first()
        .innerText()
        .catch(() => null);
      const all = panel.getByRole("button", { name: "Copy all answers" });
      await d.clickWord(all, "all", { top: 160, bottom: 240 });
      await sleep(500);
      facts.toastAll = await S.getByText(/answers? copied$/)
        .first()
        .innerText()
        .catch(() => null);
      facts.clipboard = await S.evaluate(() => navigator.clipboard.readText())
        .then((t) => ({
          chars: t.length,
          firstLine: t.split("\n")[0].slice(0, 80),
        }))
        .catch(() => null);
      facts.draftTagAfterApproval = await S.getByText("Draft", { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      await d.hold(1.0);
    });

    /* ---------- Off camera: back to Dell ---------- */
    await step("off camera: switch back to Dell's browser (overview)", () =>
      d.cut(async () => {
        await D.goto(`${BASE}/app`);
        await D.locator("[data-testid=trial-banner]")
          .first()
          .waitFor({ timeout: 20000 });
        await settle(D, 500);
        await cast.attach(D);
        await d.park(900, 420);
        await sleep(400);
      }),
    );

    /* ======================= Chapter 7 – Invite your team (Dell) ======================= */
    chapter(7);
    await d.line("H37", async () => {
      await d.clickWord(topLink(D, "Members"), "Members", { noReveal: true });
      await d.trim(
        (async () => {
          await D.getByRole("heading", { name: "Invite someone" }).waitFor({
            timeout: 30000,
          });
          await settle(D, 300);
          await d.syncCursor();
        })(),
      );
      const form = D.locator("form:has(input[name=email])");
      await d.at(Math.max(0, d.w("email") - 0.6));
      await d.type(form.getByLabel("Email address"), PM.email, {
        cps: 26,
        ms: 420,
      });
      await d.hoverWord(form.locator("select[name=role]"), "role", {
        noReveal: true,
      });
      await form.locator("select[name=role]").selectOption("admin");
      await sleep(300);
      await d.clickWord(exact(D, "button", "Invite"), "Invite", {
        noReveal: true,
      });
      await d.trim(
        D.getByText(`Invitation emailed to ${PM.email}.`).waitFor({
          timeout: 20000,
        }),
      );
    });
    await d.line("H38", async () => {
      const note = D.getByText(`Invitation emailed to ${PM.email}.`);
      facts.inviteNotice = (await note.innerText()).trim();
      await d.hover(note, { dx: 0.3, ms: 500 });
      const open = D.getByRole("heading", { name: "Open invitations" });
      await d.at(d.w("worth") - 0.3);
      await d.reveal(open, { block: "start", top: 140, ms: 1000 });
      const inv = D.locator("li", {
        has: D.getByText(PM.email, { exact: true }),
      }).first();
      facts.openInvitation = (await inv.innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .slice(0, 160);
      await d
        .hover(inv.getByText(/Administrator ·/).first(), {
          dx: 0.4,
          ms: 500,
          noReveal: true,
        })
        .catch(() => {});
    });
    await d.line("H39", async () => {
      const inv = D.locator("li", {
        has: D.getByText(PM.email, { exact: true }),
      }).first();
      const cancel = inv.getByRole("button", { name: "Cancel" });
      await d.at(d.w("cancel") - 0.6);
      const b = await cancel.boundingBox();
      if (b) await d.moveTo(b.x - 40, b.y + b.height / 2, 600);
    });

    /* ======================= Chapter 8 – Help (Dell) ======================= */
    chapter(8);
    await d.line("H40", async () => {
      await d.scrollTo(0, 600);
      await d.clickWord(topLink(D, "Security"), "help", {
        noReveal: true,
        dt: 0.1,
      });
      const support = D.getByText("Lost your phone and your backup codes?");
      await d.trim(
        (async () => {
          await support.waitFor({ timeout: 30000 });
          facts.signedInPanelMoved = await D.evaluate(() => {
            const h = Array.from(
              document.querySelectorAll("h1,h2,h3,p,span"),
            ).find((e) => e.textContent.trim() === "Where you are signed in");
            let p = h;
            while (p && p.parentElement && !/rounded/.test(p.className || ""))
              p = p.parentElement;
            if (p && p !== document.body) p.style.marginTop = "520px";
            return !!p;
          });
          await settle(D, 300);
          await d.syncCursor();
        })(),
      );
      // Only the Support panel in frame: its bottom above the caption band; the next panel ("Where you are signed in",
      // devices and IP addresses) is moved further down the page, presentation only, so it stays below the frame.
      const panelBox = await support.evaluate((el) => {
        let p = el;
        while (p && !/rounded/.test(p.className || "")) p = p.parentElement;
        const r = (p || el).getBoundingClientRect();
        return { top: r.top + scrollY, bottom: r.bottom + scrollY };
      });
      await d.scrollTo(Math.max(0, panelBox.bottom - (VIEW.h - 150)), 1100);
      facts.supportPanel = (
        await support
          .locator("xpath=..")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .slice(0, 260);
      const email = D.getByText(/khuram@appstackx\.co\.uk/).first();
      await d.hoverWord(email, "Email", { noReveal: true, dx: 0.5, dy: 2.4 });
      facts.signedInListInFrame = await D.getByText("Where you are signed in")
        .first()
        .evaluate((el) => el.getBoundingClientRect().top < innerHeight)
        .catch(() => false);
      if (facts.signedInListInFrame)
        finding(
          "check",
          "'Where you are signed in' entered the frame on the Security page",
        );
    });
    await d.line("H41", async () => {
      const email = D.getByText(/khuram@appstackx\.co\.uk/).first();
      await d.hover(email, { dx: 0.9, dy: 2.4, ms: 900, noReveal: true });
    });
  } catch (e) {
    fs.mkdirSync(path.join(WORK, "debug"), { recursive: true });
    for (const [label, p] of [
      ["owner", D],
      ["physio", S],
    ]) {
      const html = await p.content().catch(() => "");
      fs.writeFileSync(
        path.join(WORK, "debug", `${label}.html`),
        clean(html).replace(/<input type="hidden"[^>]*>/g, ""),
      );
      await p
        .screenshot({ path: path.join(WORK, "debug", `${label}.png`) })
        .catch(() => {});
    }
    throw e;
  }
  await d.hold(0.4);
  d.stop();
  await cast.detach();
  await cast.flush();
  facts.callsAfter = liveCalls();
  facts.callsBefore = callsBefore;
  facts.reportUrlPath = reportUrl ? reportUrl.replace(BASE, "") : null;
  await browser.close();
  return { d, cast, facts, problems, chapterAt };
}

/* ---------------------------------------------------------------------------------------------
 * Timeline and the app clip
 * -------------------------------------------------------------------------------------------*/
function buildTimeline({ d, cast, facts, problems, chapterAt }) {
  const frames = cast.timedFrames();
  const cuts = d.cutIntervals(d.tEnd).map(([s, e]) => [s, e]);
  const speeds = d.speeds.map((s) => ({
    t0: s.t0,
    t1: s.t1,
    label: s.label,
    real: s.real,
  }));
  const kept = keptIntervals(d.t0, d.tEnd, cuts, speeds);
  const map = mapper(kept);
  const at = (t) => Number(map(t, true).toFixed(3));
  const dur = Number(keptTotal(kept).toFixed(3));
  const lines = d.lines.map((l, i) => ({
    id: l.id,
    chapter: l.chapter,
    start: at(l.wall),
    voice: VOICE[l.id],
    end: i + 1 < d.lines.length ? at(d.lines[i + 1].wall) : dur,
    caption: LINE[l.id].caption,
    text: LINE[l.id].line,
  }));
  const chapters = chapterAt.map((c) => ({
    n: c.n,
    name: c.name,
    start: at(c.wall),
  }));
  const sped = speeds.map((s) => ({
    label: s.label,
    start: at(s.t0),
    end: at(s.t1),
    real: Number((s.real ?? s.t1 - s.t0).toFixed(1)),
    recorded: Number((s.t1 - s.t0).toFixed(1)),
  }));
  const jumps = d.jumps.map((j) => ({ label: j.label, at: at(j.wall) }));
  return {
    created: new Date().toISOString(),
    base: BASE,
    rehearse: REHEARSE,
    view: VIEW,
    scale: SCALE,
    t0: d.t0,
    tEnd: d.tEnd,
    dur,
    lines,
    chapters,
    sped,
    jumps,
    cuts,
    speeds,
    kept,
    late: d.late,
    guardHits: d.guardHits,
    tooltipsClosed: d.tooltipsClosed,
    frames,
    facts,
    problems,
  };
}

function encodeApp(tl) {
  fs.mkdirSync(DIRS.clips, { recursive: true });
  const list = path.join(DIRS.clips, "app.txt");
  writeConcat(tl.frames, tl.kept, DIRS.frames, list);
  const out = path.join(DIRS.clips, "app-clean.mp4");
  const vf = `crop=w='min(iw,${OUT_W})':h='min(ih,${OUT_H})':x=0:y=0,pad=${OUT_W}:${OUT_H}:0:0:color=white,setsar=1,fps=30`;
  ff([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    vf,
    "-t",
    tl.dur.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-an",
    out,
  ]);
  return out;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  if (flag("--assemble-only")) {
    const tl = JSON.parse(
      fs.readFileSync(path.join(WORK, "timeline.json"), "utf8"),
    );
    log("encoded", encodeApp(tl));
    return;
  }
  const t0 = now();
  let res = null;
  let err = null;
  try {
    res = await record();
  } catch (e) {
    err = e;
    log("STOPPED:", clean(String((e && e.stack) || e)).slice(0, 1500));
  }
  const report = {
    rehearse: REHEARSE,
    started: new Date(t0 * 1000).toISOString(),
    wallSeconds: Number((now() - t0).toFixed(1)),
    steps: STEPS,
    findings: FINDINGS,
    error: err ? clean(String(err.message || err)) : null,
  };
  report.facts = FACTS;
  if (res) {
    const tl = buildTimeline(res);
    fs.writeFileSync(path.join(WORK, "timeline.json"), JSON.stringify(tl));
    report.facts = tl.facts;
    report.problems = tl.problems;
    report.dur = tl.dur;
    report.lines = tl.lines.map(({ id, start, end, voice }) => ({
      id,
      start,
      end,
      voice,
    }));
    report.chapters = tl.chapters;
    report.sped = tl.sped;
    report.jumps = tl.jumps;
    report.late = tl.late;
    report.frames = tl.frames.length;
    log(`app segment ${tl.dur}s, ${tl.frames.length} frames; encoding…`);
    fs.writeFileSync(
      path.join(WORK, "steps.json"),
      JSON.stringify(report, null, 1),
    );
    if (!FAST) report.clip = encodeApp(tl);
  }
  fs.writeFileSync(
    path.join(WORK, "steps.json"),
    JSON.stringify(report, null, 1),
  );
  const rep = arg("--report");
  if (rep) fs.writeFileSync(rep, JSON.stringify(report, null, 1));
  if (err) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
