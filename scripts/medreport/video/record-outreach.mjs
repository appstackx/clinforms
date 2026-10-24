#!/usr/bin/env node
/**
 * Records the PICTURE of the generic ClinForms outreach video (v1, about 90 s) for owners and managers of UK private
 * physiotherapy clinics, driven by outreach-captions.json (lines, shots, cards, teaser). Fictional data only.
 *
 * It reuses the machinery of record-demo.mjs through video-kit.mjs: native 1920x1080 screencast frames
 * (1600x900 CSS viewport at device scale 1.2), the injected cursor dot with its click ripple and heartbeat,
 * hard cuts, the ffmpeg frame concat. Differences from record-demo.mjs:
 *  - The recording runs on a CLOCK: every action is scheduled relative to the start of its narration line (the line
 *    starts in outreach-captions.json are planned from the measured narration clips, voice/lines.json), holds pad the
 *    gaps, and everything off camera (page loads, the drafting, the remaining clinician answers, filling the approval
 *    dialog) happens inside hard cuts. Video time = wall time minus cut time, so each voice line lands at its planned
 *    start; a screen that belongs to the next line never appears before the current line has been spoken. Late
 *    actions are logged as drift.
 *  - The problem statement (S02) is a montage of the five bundled fictional blank forms, rendered from the forms
 *    themselves (Word via docx-preview, PDF via pdftoppm) and animated in a local page (work/cards/montage.html) that
 *    is recorded by the same screencast.
 *  - Captions are NOT burned into the page: they are rendered as PNGs and overlaid by ffmpeg at the recorded line
 *    times, so a caption-free master exists for the teaser and captions can be re-timed without re-recording.
 *  - A framing sampler runs in the page every 150 ms and the recording ABORTS (naming the shot) when a frame that is
 *    not inside a cut shows legible "TM3" without the "Simulated TM3" label, or a real insurer's name, unless a
 *    punch-in crop (S05c, S06) keeps it out of the picture.
 *  - Presentation only (no app code is changed): the Studio footer (version string, sandbox link) is hidden; on
 *    "Complete a form" the page intro and the "Launch from the patient record" card are hidden and the simulated
 *    picker is labelled "Clinic system (simulated)" with its "Simulated TM3 sandbox – demo data, not affiliated with
 *    TM3." label kept verbatim and enlarged; on the approved form "Completed form (PDF)" (no Word-to-PDF converter on
 *    the live site) and "Save to clinic record" (needs a live clinic-system connection) are hidden; the upload dialog's
 *    grid column is held to the dialog width (a long file name overflowed it).
 *  - Demo mode only (the server must report aiMode "demo"): the reading and the drafts are the app's prepared demo
 *    outputs, and nothing on screen or in the captions says otherwise.
 *
 * Outputs (all under <src>/work, never in the repo):
 *   picture.mp4         silent master with captions, 1920x1080, H.264, 30 fps
 *   picture-clean.mp4   the same without captions or the corner tag (source for the teaser and re-composition)
 *   picture.srt         subtitles at the recorded caption times
 *   timeline.json       frames, events, cuts, punch-ins, recorded caption start/end times, drift, framing log
 *   teaser-source.mp4   caption-free 20 s teaser cut (T0–T5) + teaser-source.json; teaser.mp4 / teaser.gif / teaser-1080.mp4
 *   cards/              title card, end card (tagline / with the call to action), teaser title card, montage page
 *   montage/            page 1 of each bundled fictional blank form (PNG)
 *   captions/           one PNG per caption (and the corner tags) with their positions in captions.json
 *   --review DIR        review frames every 2 s of picture.mp4 (default work/review)
 *
 * Usage:
 *   PORT=3310 MEDREPORT_AI_MODE=demo npm run start &
 *   NODE_PATH=<dir with playwright> node scripts/medreport/video/record-outreach.mjs --src <outreach-video-v1-src> [--review <dir>]
 *   ... --assemble-only      re-render cards and captions and re-encode from work/timeline.json (no recording)
 *   (--out is accepted as an alias of --src.)
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  sleep,
  now,
  log,
  esc,
  findChromium,
  bannedIn,
  overlayInit,
  Cast,
  pageText,
  BaseDirector,
  ff,
  probeDuration,
  keptIntervals,
  mapper,
  keptTotal,
  writeConcat,
  srtTime,
  wrapSrt,
  CARD_CSS,
  LOGO,
  documentText,
} from "./video-kit.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright not found. Run with NODE_PATH pointing at a node_modules that has playwright.");
  process.exit(1);
}

/* ---------------------------------------------------------------------------------------------
 * Configuration
 * -------------------------------------------------------------------------------------------*/
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const CAP = JSON.parse(fs.readFileSync(path.join(HERE, "outreach-captions.json"), "utf8"));
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);
const BASE = (process.env.BASE || CAP.video.base).replace(/\/$/, "");
const SRC = path.resolve(arg("--src", arg("--out", process.env.VIDEO_OUT || path.join(os.tmpdir(), "clinforms-outreach"))));
const WORK = path.join(SRC, "work");
const REVIEW = path.resolve(arg("--review", path.join(WORK, "review")));
const VIEW = { w: 1600, h: 900 };
const SCALE = 1.2;
const OUT_W = 1920;
const OUT_H = 1080;
const DIRS = {
  frames: path.join(WORK, "frames"),
  input: path.join(WORK, "input"),
  downloads: path.join(WORK, "downloads"),
  cards: path.join(WORK, "cards"),
  caps: path.join(WORK, "captions"),
  clips: path.join(WORK, "clips"),
  montage: path.join(WORK, "montage"),
};
const SHOT = Object.fromEntries(CAP.shots.map((s) => [s.id, s]));
const LINE = Object.fromEntries(CAP.lines.map((l) => [l.id, l]));
const APP_START = SHOT.S02.start; // the title card runs before the recorded segment (montage + app)
const APP_END = SHOT.S07.start; // the end card runs after it
const TOTAL = CAP.video.seconds;
/** Measured narration clip lengths (voice/lines.json); without them a line is assumed to fill its slot less 0.45 s. */
const VOICE = (() => {
  const f = path.join(SRC, "voice", "lines.json");
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(JSON.parse(fs.readFileSync(f, "utf8")).map((v) => [v.id, v.trimmedDurationSec]));
})();
/** Start of line `id` in the final cut, plus `dt`. */
const L = (id, dt = 0) => LINE[id].start + dt;
/** End of the spoken line `id` (its clip length after its start), plus `dt`. */
const LE = (id, dt = 0) => LINE[id].start + (VOICE[id] ?? LINE[id].end - LINE[id].start - 0.45) + dt;
/**
 * Presentation only (see the header): dialogs sit a little higher and end above the caption band; the upload dialog's
 * single grid column is held to the dialog width; the Studio footer and the "Launch from the patient record" card are
 * hidden, and the source cards then share two columns.
 */
const PRESENTATION_CSS = [
  "[role=dialog] { top: calc(50% - 58px) !important; max-height: calc(100vh - 140px) !important; }",
  "[role=dialog].grid { grid-template-columns: minmax(0, 1fr) !important; }",
  "footer.border-t.border-slate-200 { display: none !important; }",
  'main a.group[href="/pms-sandbox"] { display: none !important; }',
  '.grid:has(> a.group[href="/pms-sandbox"]) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }',
  "[data-vid-hide] { display: none !important; }",
  // The unfiltered patient list ends with a fictional patient whose insurer is a real company: only its first four
  // rows are shown (the step filters to Megan Hart straight away).
  'ul[aria-label="Patients"] > li:nth-child(n+5) { display: none !important; }',
].join("\n");
/** The caption band (CSS px of the 1600x900 viewport): a label under it is not legible. */
const CAPTION_ZONE = { x0: 460, x1: 1140, y0: 772 };
const PROGNOSIS = "In my opinion Ms Hart has made a good recovery; the remaining neck ache should settle within three to six months.";
const F15 =
  "In my opinion Ms Hart has no restrictions on work, domestic or leisure activities. She should continue to take regular breaks from prolonged sitting at the computer and from drives over 1 hour.";
const F16 =
  "In my opinion no further physiotherapy is needed. She should continue her maintenance home exercise programme and return to the clinic or her GP if her symptoms increase.";

/* ---------------------------------------------------------------------------------------------
 * Customer-facing wording guard (same patterns as record-demo.mjs, plus real insurers and prospects)
 * -------------------------------------------------------------------------------------------*/
const GUARD = { checks: 0, scenes: [], files: [] };
const REAL_NAMES = /\b(?:Bupa|AXA|Aviva|Vitality|WPA|Allianz|Freedom Health|Simplyhealth|Cigna|Healix|Rebecca Lane|Blue Heart|Dell Baines|RED Physio\w*|Vatamanu)\b/;
function scanOrThrow(label, text) {
  const hits = bannedIn(text);
  const real = text.match(REAL_NAMES);
  GUARD.files.push({ label, hits: hits.length + (real ? 1 : 0) });
  if (hits.length) throw new Error(`BANNED TERM in ${label}: ${JSON.stringify(Array.from(new Set(hits)).slice(0, 6))}`);
  if (real) throw new Error(`REAL NAME in ${label}: ${real[0]}`);
}

/* ---------------------------------------------------------------------------------------------
 * In-page framing sampler: legible "TM3" without the simulated label, a real insurer's name, open tooltips.
 * Positions are measured on the matched characters only (a Range over the match), and a match counts only
 * where it is the topmost thing on screen (elementFromPoint), so text under the sticky header, behind a dialog's
 * backdrop or scrolled out of a panel does not count.
 * -------------------------------------------------------------------------------------------*/
function framingSampler() {
  if (window.top !== window) return;
  const ANY = /TM3|Bupa|AXA|Aviva|Vitality|WPA|Allianz|Freedom Health|Simplyhealth|Cigna|Healix|Rebecca Lane/;
  const INS = /\b(?:Bupa|AXA|Aviva|Vitality|WPA|Allianz|Freedom Health|Simplyhealth|Cigna|Healix|Rebecca Lane)\b/g;
  const visible = (el, b) => {
    if (b.width < 1 || b.height < 1) return null;
    const top = Math.max(0, b.top);
    const bot = Math.min(innerHeight, b.bottom);
    const left = Math.max(0, b.left);
    const right = Math.min(innerWidth, b.right);
    if (bot - top < b.height * 0.4 || right - left < 2) return null;
    const hit = document.elementFromPoint((left + right) / 2, (top + bot) / 2);
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) return null;
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
  };
  const matchRects = (node, re) => {
    const out = [];
    const el = node.parentElement;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(node.nodeValue))) {
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      for (const b of r.getClientRects()) {
        const v = visible(el, b);
        if (v) out.push({ ...v, text: m[0] });
      }
      if (!re.global) break;
    }
    return out;
  };
  function scan() {
    const res = { tm3: [], label: false, labels: [], ins: [], tip: null };
    if (!document.body) return res;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (ANY.test(n.nodeValue) ? 1 : 3) });
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest("#__vid_host, script, style, noscript, template")) continue;
      const t = n.nodeValue;
      if (/Simulated TM3/.test(t)) {
        // The label itself ("Simulated TM3 sandbox – demo data, not affiliated with TM3"): its own TM3s are fine.
        const lr = matchRects(n, /Simulated TM3/g);
        if (lr.length) {
          res.label = true;
          res.labels.push(...lr);
        }
        // Its other TM3s ("…not affiliated with TM3") count only while "Simulated TM3" itself can be read.
        const inLabel = (b) => lr.some((l) => b.left >= l.left - 1 && b.right <= l.right + 1 && b.top >= l.top - 1 && b.bottom <= l.bottom + 1);
        const rest = matchRects(n, /TM3/g).filter((b) => !inLabel(b));
        if (rest.length) res.labelTm3 = (res.labelTm3 || []).concat([{ text: t.trim().slice(0, 90), rects: rest }]);
      } else {
        const tm = matchRects(n, /TM3/g);
        if (tm.length) res.tm3.push({ text: t.trim().slice(0, 90), rects: tm });
      }
      const ins = matchRects(n, INS);
      if (ins.length) res.ins.push({ text: t.trim().slice(0, 90), rects: ins });
    }
    for (const inp of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
      const p = inp.getAttribute("placeholder") || "";
      if (inp.value || !ANY.test(p)) continue;
      const v = visible(inp, inp.getBoundingClientRect());
      if (!v) continue;
      if (/Simulated TM3/.test(p)) res.label = true;
      else if (/TM3/.test(p)) res.tm3.push({ text: "placeholder: " + p.slice(0, 80), rects: [v] });
      if (INS.test(p)) res.ins.push({ text: "placeholder: " + p.slice(0, 80), rects: [v] });
    }
    const tip = document.querySelector("[role=tooltip]");
    if (tip) {
      const wr = tip.closest("[data-radix-popper-content-wrapper]") || tip;
      const b = wr.getBoundingClientRect();
      if (b.width && b.bottom > 0 && b.top < innerHeight) res.tip = (wr.innerText || "").replace(/\s+/g, " ").slice(0, 80);
    }
    return res;
  }
  setInterval(() => {
    try {
      if (typeof window.__vidReport !== "function") return;
      const r = scan();
      if (r.tm3.length || r.labelTm3 || r.ins.length || r.tip) window.__vidReport({ t: Date.now() / 1000, url: location.pathname, ...r });
    } catch {
      /* sampling must never break the page */
    }
  }, 150);
}

/* ---------------------------------------------------------------------------------------------
 * Director on a clock
 * -------------------------------------------------------------------------------------------*/
class Director extends BaseDirector {
  constructor(cast, reports) {
    super(cast, VIEW);
    this.reports = reports; // pushed by the page's framing sampler
    this.seen = 0;
    this.t0 = null;
    this.shot = null;
    this.drift = [];
    this.fail = null;
    this.emitted = new Set();
    this.violations = [];
    this.tooltips = [];
    this.zoom = null;
  }
  /** Seconds of cut time since the segment started (an open cut counts up to now). */
  cutTime(at = now()) {
    let sum = 0;
    let open = null;
    for (const e of this.events) {
      if (e.type !== "cut" || e.t < this.t0) continue;
      if (e.edge === "start") open = e.t;
      else if (open !== null) {
        sum += Math.min(e.t, at) - open;
        open = null;
      }
    }
    if (open !== null && at > open) sum += at - open;
    return sum;
  }
  inCut(t) {
    let open = null;
    for (const e of this.events) {
      if (e.type !== "cut") continue;
      if (e.edge === "start") open = e.t;
      else if (open !== null) {
        if (t >= open && t <= e.t) return true;
        open = null;
      }
    }
    return open !== null && t >= open;
  }
  /** Time in the final cut. */
  vt() {
    return APP_START + (now() - this.t0) - this.cutTime();
  }
  start() {
    this.t0 = now();
    this.ev("seg", { edge: "start" });
    this.ticker = setInterval(() => this.tick(), 25);
  }
  stop() {
    clearInterval(this.ticker);
    this.tick();
    this.tEnd = now();
    this.ev("seg", { edge: "end" });
  }
  tick() {
    if (this.t0 === null || this.fail) return;
    // A machine that gets busy mid-take gives late actions and dropped frames: stop early so the take can be redone.
    if (now() - (this.loadAt || 0) > 2) {
      this.loadAt = now();
      const l = os.loadavg()[0];
      this.maxLoad = Math.max(this.maxLoad || 0, l);
      if (l > Number(process.env.ABORT_LOAD || 30)) this.fail = new Error(`MACHINE BUSY: load ${l.toFixed(1)} during shot ${this.shot}; record again when it is quieter`);
    }
    const v = this.vt();
    for (const l of CAP.lines) {
      if (this.emitted.has(l.id) || l.start < APP_START || l.start >= APP_END || l.start > v) continue;
      this.emitted.add(l.id);
      this.ev("line", { id: l.id, vt: Number(v.toFixed(3)), shot: this.shot });
      this.guard(`line ${l.id}`).catch((e) => (this.fail = this.fail || e));
    }
    this.checkReports();
  }
  checkReports() {
    while (this.seen < this.reports.length) {
      const r = this.reports[this.seen++];
      if (r.tip) {
        const last = this.tooltips[this.tooltips.length - 1];
        if (!last || last.text !== r.tip) this.tooltips.push({ t: r.t, shot: this.shot, text: r.tip, inCut: this.inCut(r.t) });
      }
      if (this.t0 === null || r.t < this.t0 || (this.tEnd && r.t > this.tEnd) || this.inCut(r.t)) continue;
      const crop = this.zoomAt(r.t);
      const inside = (b) => !crop || (b.bottom > crop.y0 && b.top < crop.y1 && b.right > crop.x0 && b.left < crop.x1 && Math.min(b.bottom, crop.y1) - Math.max(b.top, crop.y0) >= (b.bottom - b.top) * 0.4);
      // The label counts only where a caption pill does not cover it.
      const z = CAPTION_ZONE;
      const labelShown = !crop && (r.labels || []).some((b) => b.bottom < z.y0 || b.right < z.x0 || b.left > z.x1);
      const uncovered = (b) => !(b.bottom > z.y0 && b.right > z.x0 && b.left < z.x1);
      const tm3 = labelShown ? [] : [...r.tm3.filter((x) => x.rects.some(inside)), ...(r.labelTm3 || []).filter((x) => x.rects.some((b) => inside(b) && uncovered(b)))];
      const ins = r.ins.filter((x) => x.rects.some(inside));
      if (tm3.length || ins.length) {
        const v = { t: r.t, shot: this.shot, url: r.url, tm3, ins, crop };
        this.violations.push(v);
        this.fail = this.fail || new Error(`FRAMING in shot ${this.shot} (${r.url}): ${JSON.stringify({ tm3: tm3.slice(0, 3), ins: ins.slice(0, 3) })}`);
      }
    }
  }
  zoomAt(t) {
    let z = null;
    for (const e of this.events) {
      if (e.type !== "zoom" || e.t > t) continue;
      z = e.edge === "start" ? e.crop : null;
    }
    return z;
  }
  zoomOn(crop) {
    this.zoom = crop;
    this.ev("zoom", { edge: "start", crop });
  }
  zoomOff() {
    if (!this.zoom) return;
    this.zoom = null;
    this.ev("zoom", { edge: "end" });
  }
  check() {
    this.checkReports();
    if (this.fail) throw this.fail;
  }
  async guard(label) {
    const p = this.page;
    if (!p || p.isClosed()) return;
    const text = await pageText(p).catch(() => "");
    GUARD.checks++;
    const hits = bannedIn(text);
    GUARD.scenes.push({ label, shot: this.shot, url: p.url().replace(BASE, "").replace(/^file:.*\//, "file:"), hits: hits.length });
    if (hits.length) throw new Error(`BANNED TERM visible at "${label}" (${p.url()}): ${JSON.stringify(Array.from(new Set(hits)).slice(0, 6))}`);
  }
  async shotStart(id) {
    this.check();
    this.shot = id;
    this.ev("shot", { id, vt: Number(this.vt().toFixed(3)) });
    log(`shot ${id} at ${this.vt().toFixed(2)} (planned ${SHOT[id].start})`);
    await this.guard(`shot ${id}`);
  }
  /** Hold until time `t` of the final cut. A call that arrives late is logged as drift. */
  async until(t, label = "", { quiet = false } = {}) {
    this.check();
    const late = this.vt() - t;
    if (!quiet && late > 0.2) {
      this.drift.push({ shot: this.shot, label, target: Number(t.toFixed(2)), late: Number(late.toFixed(2)) });
      log(`late ${this.shot} ${label}: ${late.toFixed(2)} s after ${t.toFixed(2)}`);
    }
    for (;;) {
      const left = t - this.vt();
      if (left <= 0.003) break;
      await sleep(Math.min(40, left * 1000));
    }
    this.check();
  }
  /** Hover/click never scroll the page on their own here: every framing is set inside a cut. */
  async hover(loc, opts = {}) {
    return super.hover(loc, { noReveal: true, ...opts });
  }
  /** Move to `loc` so that the click lands at time `t` of the final cut. */
  async clickAt(t, loc, opts = {}) {
    const ms = opts.ms ?? 550;
    await this.until(t - (ms + (opts.pause ?? 130)) / 1000, `click ${opts.label || ""}`, { quiet: true });
    await this.click(loc, { ms, ...opts });
    const late = this.vt() - t - (opts.after ?? 280) / 1000;
    if (late > 0.3) {
      this.drift.push({ shot: this.shot, label: `click ${opts.label || ""}`, target: Number(t.toFixed(2)), late: Number(late.toFixed(2)) });
      log(`late click ${this.shot} ${opts.label || ""}: ${late.toFixed(2)} s`);
    }
  }
  async hoverAt(t, loc, opts = {}) {
    await this.until(t - (opts.lead ?? 0.05), `hover ${opts.label || ""}`, { quiet: true });
    await this.hover(loc, { ms: 600, ...opts });
  }
  async moveAt(t, x, y, ms = 600) {
    await this.until(t, `move at ${t.toFixed(2)}`);
    await this.moveTo(x, y, ms);
  }
  /** Put the cursor somewhere without moving it on camera (inside a cut). */
  async park(x, y) {
    await this.page.mouse.move(x, y);
    this.mouse = { x, y };
    await this.pushInstant();
    await sleep(200); // let a frame with the cursor in its new place reach the screencast before the cut ends
  }
  /**
   * Await something slow: once it has taken `keep` seconds a hard cut opens (never sped up, never labelled), so the
   * clock stops while it lasts and the cut is in the events in real-time order.
   */
  async waitCut(promise, keep = 0.3) {
    let opened = false;
    const timer = setTimeout(() => {
      opened = true;
      this.ev("cut", { edge: "start" });
    }, keep * 1000);
    try {
      return await promise;
    } finally {
      clearTimeout(timer);
      if (opened) this.ev("cut", { edge: "end" });
    }
  }
}

/* ---------------------------------------------------------------------------------------------
 * App helpers
 * -------------------------------------------------------------------------------------------*/
/** Box of the first occurrence of `needle` (exact characters) inside `loc`. */
async function textBox(loc, needle) {
  return loc.evaluate((root, needle) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      const b = r.getBoundingClientRect();
      if (b.width && b.height) return { x: b.left, y: b.top, width: b.width, height: b.height };
    }
    return null;
  }, needle);
}

async function dismissToasts(page) {
  const n = await page.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('button[aria-label="Dismiss notification"]'));
    bs.forEach((b) => b.click());
    return bs.length;
  });
  if (n) await sleep(350);
}

/** Presentation only: move the Studio's toast stack (top-right inside a punch-in crop), or back to its own place. */
async function placeToasts(page, pos) {
  await page.evaluate((pos) => {
    const c = document.querySelector('div[aria-live="polite"].fixed.inset-x-0');
    if (!c) return;
    if (!pos) {
      for (const p of ["top", "bottom", "padding-right"]) c.style.removeProperty(p);
      return;
    }
    c.style.setProperty("top", `${pos.top}px`, "important");
    c.style.setProperty("bottom", "auto", "important");
    c.style.setProperty("padding-right", `${pos.right}px`, "important");
  }, pos);
}

/** Top of the first legible "TM3" below the Studio's header (CSS px), or the viewport height. */
async function firstTm3Top(page) {
  return page.evaluate(() => {
    let m = innerHeight;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/TM3/.test(n.nodeValue) ? 1 : 3) });
    let n;
    while ((n = w.nextNode())) {
      if (!n.parentElement || n.parentElement.closest("#__vid_host")) continue;
      let i = -1;
      while ((i = n.nodeValue.indexOf("TM3", i + 1)) >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 3);
        for (const b of r.getClientRects()) if (b.width && b.bottom > 60 && b.top < innerHeight) m = Math.min(m, b.top);
      }
    }
    return m;
  });
}

/**
 * Punch-in crop (CSS px, 16:9) for the approved report at the top of the page: the full content width (192–1408 plus
 * a 20 px margin) from just under the Studio's header. The first registration answer card (F-01) names TM3 on its
 * source chips; when its first TM3 would fall inside the crop the card is pushed down (presentation only: a margin,
 * no text changed) so the crop ends 8 px above it.
 */
async function computeCrop(page) {
  const x0 = 172;
  const x1 = 1428;
  const y0 = 58;
  const y1 = y0 + ((x1 - x0) * 9) / 16;
  let minTop = await firstTm3Top(page);
  let pushed = 0;
  for (let i = 0; i < 4 && minTop < y1 + 8; i++) {
    pushed += Math.ceil(y1 + 14 - minTop);
    await page.evaluate((px) => {
      const c = document.getElementById("q-F-01");
      if (c) c.style.setProperty("margin-top", `${px}px`, "important");
    }, pushed);
    await sleep(250);
    minTop = await firstTm3Top(page);
  }
  if (minTop < y1 + 4) throw new Error(`Punch-in: TM3 text at y ${minTop} is still inside the crop (ends ${y1})`);
  return { x0, y0, x1, y1, minTop, pushed };
}

/**
 * Presentation only, on the approved form: hide "Completed form (PDF)" (a Word form; there is no Word-to-PDF converter
 * on the live site) and "Save to clinic record" (it needs a live clinic-system connection). Returns what was hidden.
 */
async function hideApprovedExtras(page) {
  return page.evaluate(() => {
    const hidden = [];
    for (const b of document.querySelectorAll("main button")) {
      const t = (b.innerText || "").replace(/\s+/g, " ").trim();
      if (t === "Completed form (PDF)" || t === "Save to clinic record") {
        b.setAttribute("data-vid-hide", "");
        hidden.push(t);
      }
    }
    for (const p of document.querySelectorAll("main p")) if (/needs the live TM3 connection/.test(p.textContent || "")) p.setAttribute("data-vid-hide", "");
    return hidden;
  });
}

/**
 * Presentation only, on "Complete a form" step 1: hide the page intro (it names the simulated system), label the
 * simulated picker "Clinic system (simulated)", and keep its "Simulated TM3 sandbox – demo data, not affiliated with
 * TM3." label verbatim, larger and darker so it can be read at e-mail size.
 */
async function presentSourceStep(page) {
  return page.evaluate(() => {
    const done = {};
    const h1 = document.querySelector("main h1");
    const intro = h1 && h1.nextElementSibling;
    if (intro && /registration details and physiotherapy notes/.test(intro.textContent || "")) {
      intro.setAttribute("data-vid-hide", "");
      done.intro = true;
    }
    for (const el of document.querySelectorAll("main span, main label")) {
      if (el.children.length) continue;
      const t = (el.textContent || "").trim();
      if (t === "Simulated TM3") {
        el.textContent = "Clinic system (simulated)";
        done.card = true;
      } else if (t === "Find a patient in Simulated TM3") {
        el.textContent = "Find a patient (simulated clinic system)";
        done.search = true;
      }
    }
    const label = Array.from(document.querySelectorAll("main p")).find((p) => /^Simulated TM3 sandbox – demo data, not affiliated with TM3\.?$/.test((p.textContent || "").trim()));
    if (label) {
      label.style.setProperty("font-size", "14px", "important");
      label.style.setProperty("color", "#334155", "important");
      label.style.setProperty("font-weight", "500", "important");
      label.style.setProperty("margin-top", "6px", "important");
      done.label = true;
    }
    return done;
  });
}

/** Clinician answers and gap resolution on the review page, off camera (direct clicks inside a cut). */
async function resolveAllDirect(page) {
  const keys = await page.locator("article[id^='q-']").evaluateAll((els) => els.map((e) => e.id.slice(2)));
  for (const key of keys) {
    const card = page.locator(`[id="q-${key}"]`);
    for (let guard = 0; guard < 6; guard++) {
      const removeIt = card.getByRole("button", { name: "Remove it" });
      if (await removeIt.count()) {
        await removeIt.first().click();
        await sleep(200);
        continue;
      }
      const quick = card.getByRole("button", { name: "Mark resolved" });
      if ((await quick.count()) && !(await card.locator("form").count())) {
        await quick.first().click();
        await sleep(250);
        continue;
      }
      const res = card.getByRole("button", { name: /^Resolve$/ });
      if (await res.count()) {
        await res.first().click();
        const ta = card.locator("form textarea").last();
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
        await card.locator("form").getByRole("button", { name: "Mark resolved" }).click();
        await sleep(250);
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await ack.first().click();
        await card.locator("form textarea").last().fill("Not recorded at discharge; the treating clinician has returned the form without it.");
        await card.locator("form").getByRole("button", { name: "Acknowledge" }).click();
        await sleep(250);
        continue;
      }
      break;
    }
  }
}

async function addOwnDirect(page, key, text) {
  const card = page.locator(`[id="q-${key}"]`);
  const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
  if (await add.count()) await add.first().click();
  const ta = card.locator("textarea").last();
  await ta.fill(text);
  await card.locator("h3").first().click();
  await sleep(250);
}

async function answeredLine(page) {
  const t = await page.locator("main").innerText();
  const m = t.match(/(\d+)\s+of\s+(\d+)\s+answered and clear/);
  return m ? { answered: Number(m[1]), total: Number(m[2]) } : { answered: 0, total: 0 };
}

/** Scroll the window so that `loc`'s top sits at `y` (instant: inside a cut). */
async function scrollToY(loc, y) {
  await loc.evaluate((el, y) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - y), y);
  await sleep(250);
}

/**
 * Smooth-scroll the scroll container of `anchor` (inside a dialog) so that the bottom of the table that holds
 * `anchor` ends at `bottomY` (CSS px), over `ms`. Used on the final form so the signed declaration ends above the
 * caption band and the page footer stays below the visible area.
 */
async function scrollTableBottomTo(loc, bottomY, ms) {
  return loc.evaluate(
    async (el, { bottomY, ms }) => {
      let sp = el.parentElement;
      while (sp && !(sp.scrollHeight > sp.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sp).overflowY))) sp = sp.parentElement;
      if (!sp) return null;
      const table = el.closest("table") || el;
      // Never past the visible part of the scroll container (less a 14 px margin).
      const target = Math.min(bottomY, sp.getBoundingClientRect().bottom - 14);
      const delta = table.getBoundingClientRect().bottom - target;
      const start = sp.scrollTop;
      const end = Math.max(0, Math.min(sp.scrollHeight - sp.clientHeight, start + delta));
      await new Promise((res) => {
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          sp.scrollTop = start + (end - start) * e;
          if (k < 1) requestAnimationFrame(step);
          else res();
        };
        requestAnimationFrame(step);
      });
      const r = sp.getBoundingClientRect();
      return { tableBottom: Math.round(table.getBoundingClientRect().bottom), viewBottom: Math.round(r.bottom) };
    },
    { bottomY, ms },
  );
}

/* ---------------------------------------------------------------------------------------------
 * The problem-statement montage: page 1 of each bundled fictional blank form, animated in a local page
 * -------------------------------------------------------------------------------------------*/
/** PNG of page 1 of each bundled fictional form (Word via docx-preview in a browser page, PDF via pdftoppm). */
async function renderFormPages(browser) {
  fs.mkdirSync(DIRS.montage, { recursive: true });
  const out = {};
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 })).newPage();
  await page.setContent(
    `<!doctype html><html><head><style>body{margin:0;background:#fff}.docx-wrapper{background:#fff!important;padding:0!important}section.docx{box-shadow:none!important;margin:0!important}</style></head><body><div id="c"></div></body></html>`,
  );
  await page.addScriptTag({ path: path.join(REPO, "node_modules/jszip/dist/jszip.min.js") });
  await page.addScriptTag({ path: path.join(REPO, "node_modules/docx-preview/dist/docx-preview.min.js") });
  for (const f of CAP.cards.montage.forms) {
    const png = path.join(DIRS.montage, `${f.id}.png`);
    const res = await fetch(`${BASE}/api/reports/v1/forms/samples/${f.id}/file`);
    if (!res.ok) throw new Error(`Could not fetch the sample form ${f.id}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 4).toString() === "%PDF") {
      const pdf = path.join(DIRS.montage, `${f.id}.pdf`);
      fs.writeFileSync(pdf, buf);
      execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "144", "-png", "-singlefile", pdf, png.replace(/\.png$/, "")]);
      scanOrThrow(`montage form ${f.id}`, documentText(pdf));
    } else {
      const docx = path.join(DIRS.montage, `${f.id}.docx`);
      fs.writeFileSync(docx, buf);
      scanOrThrow(`montage form ${f.id}`, documentText(docx));
      await page.evaluate(async (b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const c = document.getElementById("c");
        c.innerHTML = "";
        await window.docx.renderAsync(new Blob([bin]), c, null, { breakPages: true, inWrapper: true, experimental: true });
      }, buf.toString("base64"));
      await page.evaluate(() => document.fonts.ready);
      await sleep(300);
      // Page 1 at A4 proportions (docx-preview draws one long section when the form has no explicit page break).
      const b = await page.locator("section.docx").first().boundingBox();
      await page.screenshot({ path: png, clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, b.width * Math.SQRT2) } });
    }
    out[f.id] = png;
  }
  await page.context().close();
  return out;
}

function montageHtml(font, pages) {
  const M = CAP.cards.montage;
  const img = (f) => `data:image/png;base64,${fs.readFileSync(pages[f.id]).toString("base64")}`;
  const W = 272;
  const H = Math.round(W * Math.SQRT2);
  const cx = [232, 516, 800, 1084, 1368];
  const top = 158;
  const rot = [-3.5, 2.2, -1.4, 2.8, -2.2];
  const dy = [8, -8, 4, -12, 6];
  const forms = M.forms
    .map(
      (f, i) => `<div class="form" style="--x:${cx[i] - W / 2}px;--y:${top + dy[i]}px;--r:${rot[i]}deg;--d:${(0.08 + i * 0.32).toFixed(2)}s">
        <div class="paper"><img src="${img(f)}" alt=""><div class="badge"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>${esc(M.retyped)}</div></div>
        <div class="lab"><b>${esc(f.kind)}</b><span class="fmt ${/PDF/.test(f.format) ? "pdf" : "word"}">${esc(f.format)}</span></div>
      </div>`,
    )
    .join("");
  const notes = `<div id="notes"><div class="nh"><span class="ni"><svg viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg></span><div><b>${esc(M.notes.title)}</b><small>${esc(M.notes.sub)}</small></div></div>${M.notes.lines.map((l) => `<p>${esc(l)}</p>`).join("")}<div class="bars"><i></i><i></i><i style="width:62%"></i></div></div>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>ClinForms</title><style>${font.faces}
  ${CARD_CSS}
  body{font-family:${font.family}Inter,system-ui,sans-serif}
  #fan{position:absolute;inset:0;transform-origin:800px 420px;transition:transform .65s cubic-bezier(.3,.7,.2,1)}
  body.p2 #fan{transform:translateX(150px) scale(.78)}
  .form{position:absolute;left:0;top:0;width:${W}px;transform:translate(var(--x),calc(var(--y) + 620px)) rotate(var(--r));opacity:0;
    transition:transform .75s cubic-bezier(.2,.8,.2,1) var(--d),opacity .35s ease var(--d)}
  body.p1 .form{transform:translate(var(--x),var(--y)) rotate(var(--r));opacity:1}
  .paper{position:relative;width:${W}px;height:${H}px;background:#fff;border-radius:4px;overflow:visible;
    box-shadow:0 22px 44px rgba(15,23,42,.18),0 0 0 1px rgba(15,23,42,.08);transition:box-shadow .3s}
  .paper img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:4px}
  .hit .paper{box-shadow:0 22px 44px rgba(15,23,42,.18),0 0 0 3px #f59e0b}
  .badge{position:absolute;right:-14px;top:-16px;display:flex;align-items:center;gap:7px;background:#fffbeb;color:#92400e;font-weight:700;font-size:19px;
    padding:8px 13px;border-radius:999px;box-shadow:0 0 0 2px #f59e0b,0 8px 18px rgba(146,64,14,.25);transform:scale(0);opacity:0;
    transition:transform .35s cubic-bezier(.3,1.6,.5,1),opacity .2s}
  .badge svg{width:19px;height:19px;fill:none;stroke:#b45309;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .hit .badge{transform:scale(1);opacity:1}
  .lab{margin-top:18px;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center}
  .lab b{font-size:19px;color:#0f172a;font-weight:650}
  .fmt{display:inline-flex;font-size:16px;font-weight:600;padding:4px 11px;border-radius:8px}
  .fmt.word{background:#eff6ff;color:#1d4ed8;box-shadow:0 0 0 1px #bfdbfe}
  .fmt.pdf{background:#fef2f2;color:#b91c1c;box-shadow:0 0 0 1px #fecaca}
  #notes{position:absolute;left:48px;top:246px;width:318px;background:#fff;border-radius:18px;padding:22px 22px 20px;
    box-shadow:0 22px 44px rgba(15,23,42,.16),0 0 0 2px #14b8a6;transform:translateX(-440px);opacity:0;transition:transform .6s cubic-bezier(.2,.8,.2,1),opacity .3s}
  body.p2 #notes{transform:none;opacity:1}
  .nh{display:flex;gap:12px;align-items:center;margin-bottom:14px}
  .nh b{display:block;font-size:22px}.nh small{display:block;font-size:14px;color:#64748b;margin-top:2px}
  .ni{width:42px;height:42px;border-radius:11px;background:#ccfbf1;display:flex;align-items:center;justify-content:center;flex:none}
  .ni svg{width:24px;height:24px;fill:none;stroke:#0f766e;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  #notes p{margin:0 0 9px;font-size:15.5px;line-height:1.38;color:#334155}
  .bars i{display:block;height:9px;border-radius:5px;background:#e2e8f0;margin-top:9px}
  .chip{position:absolute;left:0;top:0;background:#0d9488;color:#fff;font-weight:700;font-size:17px;padding:8px 14px;border-radius:999px;
    box-shadow:0 10px 22px rgba(13,148,136,.35);white-space:nowrap;opacity:0;z-index:5}
  .hb{position:fixed;right:0;bottom:0;width:2px;height:2px}
  </style></head><body>
  <div id="fan">${forms}</div>${notes}<div class="hb"></div>
  <script>
    // A 2 px repaint every 100 ms keeps the screencast delivering frames during still stretches.
    let on = false; setInterval(() => { on = !on; document.querySelector('.hb').style.background = on ? 'rgba(128,128,128,.035)' : 'rgba(128,128,128,.02)'; }, 100);
    window.__play = (n) => { document.body.classList.add('p' + n); if (n === 2) setTimeout(fly, 700); };
    function fly() {
      const nr = document.getElementById('notes').getBoundingClientRect();
      const from = { x: nr.right - 40, y: nr.top + nr.height * 0.42 };
      document.querySelectorAll('.form').forEach((f, i) => {
        const p = f.querySelector('.paper').getBoundingClientRect();
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = ${JSON.stringify("Same notes")};
        document.body.appendChild(chip);
        const cw = chip.offsetWidth, ch = chip.offsetHeight;
        const to = { x: p.left + p.width / 2, y: p.top + p.height * 0.45 };
        const at = (o, s) => 'translate(' + (o.x - cw / 2) + 'px,' + (o.y - ch / 2) + 'px) scale(' + s + ')';
        chip.animate([{ transform: at(from, .85), opacity: 0 }, { opacity: 1, offset: .12 }, { transform: at(to, 1), opacity: 1, offset: .82 }, { transform: at(to, .6), opacity: 0 }],
          { duration: 640, delay: i * 330, easing: 'cubic-bezier(.35,.6,.25,1)', fill: 'forwards' });
        setTimeout(() => f.classList.add('hit'), i * 330 + 540);
      });
    }
  </script></body></html>`;
}

/* ---------------------------------------------------------------------------------------------
 * The recording
 * -------------------------------------------------------------------------------------------*/
/** A loaded machine gives jerky frames and late actions: wait (up to 20 min) until the 1-minute load is below MAX_LOAD. */
async function waitForQuietMachine() {
  const max = Number(process.env.MAX_LOAD || 12);
  const t0 = now();
  while (os.loadavg()[0] > max) {
    if (now() - t0 > 1200) throw new Error(`Load average still ${os.loadavg()[0].toFixed(1)} after 20 minutes (MAX_LOAD ${max}); record later.`);
    log(`load ${os.loadavg()[0].toFixed(1)} > ${max}: waiting before recording`);
    await sleep(20000);
  }
  return Number(os.loadavg()[0].toFixed(1));
}

async function record() {
  for (const k of ["frames", "input", "downloads"]) {
    fs.rmSync(DIRS[k], { recursive: true, force: true });
    fs.mkdirSync(DIRS[k], { recursive: true });
  }
  fs.mkdirSync(DIRS.cards, { recursive: true });
  const health = await (await fetch(`${BASE}/api/reports/v1/health`)).json();
  if (health.aiMode !== "demo") throw new Error(`The outreach video is recorded in demo mode: start the server with MEDREPORT_AI_MODE=demo (got ${health.aiMode}).`);
  if (Object.keys(VOICE).length !== CAP.lines.length) log(`WARNING: voice/lines.json not found or incomplete under ${SRC}: actions are timed on the line slots instead`);
  const meridianName = "Meridian-Claims_Physiotherapy-Discharge-Report_MCS-PDR-3.docx";
  const res = await fetch(`${BASE}/api/reports/v1/forms/samples/meridian-discharge-report/file`);
  if (!res.ok) throw new Error(`Could not fetch the Meridian sample form: ${res.status}`);
  const meridianPath = path.join(DIRS.input, meridianName);
  fs.writeFileSync(meridianPath, Buffer.from(await res.arrayBuffer()));

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.w},${VIEW.h}`, "--hide-scrollbars", "--allow-file-access-from-files"],
  });
  // The montage page: the five fictional blank forms, page 1 each.
  const font = await appFontCss();
  const pages = await renderFormPages(browser);
  const montageFile = path.join(DIRS.cards, "montage.html");
  fs.writeFileSync(montageFile, montageHtml(font, pages));
  const loadAtStart = await waitForQuietMachine();

  const ctx = await browser.newContext({ viewport: null, acceptDownloads: true, locale: "en-GB", timezoneId: "Europe/London" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const reports = [];
  await ctx.exposeBinding("__vidReport", (_src, r) => {
    reports.push(r);
  });
  await ctx.addInitScript(overlayInit, { bar: false, liftToasts: false, css: PRESENTATION_CSS });
  await ctx.addInitScript(framingSampler);
  const problems = [];
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => problems.push(`[pageerror] ${p.url()} :: ${String(e).slice(0, 300)}`));
    p.on("console", (m) => {
      if (m.type() === "error") problems.push(`[console] ${p.url()} :: ${m.text().slice(0, 300)}`);
    });
  });
  const page = await ctx.newPage();
  const size = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  log("viewport", size);
  if (Math.abs(size[0] - VIEW.w) > 2 || size[1] !== VIEW.h) throw new Error(`Unexpected viewport ${size}`);

  // ---- Fresh state: the app's own Demo tools > Reset demo, then warm the pages used in cuts.
  await page.goto(`${BASE}/reports`);
  await page.waitForLoadState("networkidle");
  await page.locator("summary", { hasText: "Demo tools" }).click();
  await page.getByRole("button", { name: "Reset demo" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset demo" }).click();
  await sleep(1200);
  for (const u of ["/reports/new", "/reports", "/reports/forms"]) {
    await page.goto(BASE + u);
    await page.waitForLoadState("networkidle");
  }
  await page.getByText(/3 confirmed/).first().waitFor({ timeout: 20000 });

  const cast = new Cast(DIRS.frames);
  const d = new Director(cast, reports);
  const checks = {};
  const downloads = {};

  // ---- S02 set-up (before the segment starts, so not in the video): the montage page, forms not yet in.
  await page.goto(pathToFileURL(montageFile).href);
  await page.locator(".form img").first().waitFor();
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.complete ? null : new Promise((r) => (i.onload = r))))));
  await page.evaluate(() => document.fonts.ready);
  await sleep(600);
  await cast.attach(page);
  await sleep(500);

  /* ======================= Recorded segment (S02 start – S07 start in the final cut) ======================= */
  d.start();

  // ---------- S02: every referrer's own form (montage) ----------
  await d.shotStart("S02");
  await page.evaluate(() => window.__play(1));
  await d.until(L("V03", -0.15), "montage phase 2");
  await page.evaluate(() => window.__play(2));
  await d.until(Math.max(SHOT.S03a.start, LE("V03", 0.12)), "end S02");

  // ---------- S03a: upload their form once ----------
  const dlg = page.getByRole("dialog");
  await d.cut(async () => {
    await page.goto(`${BASE}/reports/forms`);
    await page.waitForLoadState("networkidle");
    await page.locator("main canvas").first().waitFor({ timeout: 20000 });
    await page.locator("main section.docx").first().waitFor({ timeout: 20000 });
    await sleep(1200);
    await page.getByRole("button", { name: "Upload a referrer form" }).first().click();
    await dlg.locator(".border-dashed button").first().waitFor();
    await sleep(500);
    const z = await dlg.locator(".border-dashed button").first().boundingBox();
    await d.park(z.x + z.width / 2 + 150, z.y + z.height / 2 + 60);
  });
  await d.shotStart("S03a");
  const chooserP = page.waitForEvent("filechooser");
  await d.clickAt(L("V04", 0.25), dlg.locator(".border-dashed button").first(), { ms: 300, label: "drop zone", after: 60 });
  const chooser = await chooserP;
  await chooser.setFiles(meridianPath);
  await d.waitCut(dlg.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 15000 }), 0.25);
  await d.until(L("V04", 0.85), "type referrer", { quiet: true });
  await d.type(dlg.locator("#upload-referrer"), "Meridian Claims Services (fictional)", { cps: 60, ms: 300, after: 60 });
  await d.hover(dlg.locator("#upload-referrer-type"), { ms: 300 });
  await dlg.locator("#upload-referrer-type").selectOption({ label: "Insurer" });
  await sleep(200);
  checks.uploadDialogFits = await dlg.evaluate((el) => Array.from(el.querySelectorAll("*")).every((c) => c.getBoundingClientRect().right <= el.getBoundingClientRect().right - 8));
  // The result appears 0.3 s after the click (the prepared reading is cut), just after "…exactly as it arrived".
  await d.clickAt(LE("V04", -0.15), dlg.getByRole("button", { name: /^Analyse form$/ }), { ms: 420, label: "Analyse form", after: 0 });
  await d.waitCut(
    page.waitForFunction(() => /Review the mapping|could not be analysed|Try again/.test(document.querySelector("[role=dialog]")?.textContent || ""), null, { timeout: 60000 }),
    0.3,
  );
  const dlgText = (await dlg.innerText()).replace(/\s+/g, " ");
  if (!/Review the mapping/.test(dlgText)) throw new Error("Form reading failed: " + dlgText.slice(0, 400));
  if (!/Prepared demo reading/.test(dlgText)) throw new Error("Expected the prepared demo reading label: " + dlgText.slice(0, 300));
  checks.formReading = { questions: Number((dlgText.match(/(\d+) questions found/) || [])[1]), toCheck: Number((dlgText.match(/(\d+) questions? to check/) || [0, 0])[1]) };

  // ---------- S03b: questions found (the prepared reading is on screen for under a second) ----------
  await d.shotStart("S03b");
  const tResult = d.vt();
  checks.resultShownAt = Number(tResult.toFixed(2));
  await d.clickAt(tResult + 0.78, dlg.getByRole("button", { name: /Review the mapping/ }), { ms: 520, label: "Review the mapping", after: 0 });

  // ---------- S03c: where each answer goes ----------
  await d.cut(async () => {
    await page.waitForURL(/\/reports\/forms\/.+/, { timeout: 30000 });
    await page.locator(".mr-preview section.docx").first().waitFor({ timeout: 30000 });
    await sleep(600);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(600);
    await d.park(1060, 700);
  });
  await d.shotStart("S03c");
  const tMap = d.vt();
  checks.resultOnScreenSec = Number((tMap - tResult).toFixed(2));
  const hl = page.locator(".mr-preview .mr-hl").first();
  await d.hoverAt(tMap + 0.45, hl, { ms: 800, dx: 1.025, dy: 0.5, label: "answer space" });
  {
    // The "Clinician opinion" chip on the question list's F-14 card (not the form preview's copy of the question).
    const best = await page.evaluate(() => {
      const w = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (!/likely long-term outcome/.test(n.nodeValue) || n.parentElement.closest(".mr-preview")) continue;
        let card = n.parentElement;
        for (let i = 0; i < 6 && card; i++) {
          card = card.parentElement;
          const chip = card && Array.from(card.querySelectorAll("*")).find((x) => x.children.length === 0 && (x.textContent || "").trim() === "Clinician opinion");
          if (chip) {
            const r = chip.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          }
        }
      }
      return null;
    });
    if (best) await d.moveAt(Math.max(tMap + 1.6, L("V05", 2.95)), best.x + best.width / 2, best.y + best.height / 2, 800);
    else log("S03c: F-14 'Clinician opinion' chip not found");
  }
  const confirmBtn = page.getByRole("button", { name: /^Confirm mapping$/ }).first();
  await d.hoverAt(L("V06", -0.75), confirmBtn, { ms: 600, label: "Confirm mapping" });

  // ---------- S03d: checked once by your team ----------
  await d.until(L("V06", -0.1), "S03d", { quiet: true });
  await d.shotStart("S03d");
  await d.clickAt(L("V06", 0.1), confirmBtn, { ms: 150, label: "Confirm mapping" });
  await page.locator("#confirm-by").waitFor();
  const by = page.locator("#confirm-by");
  await d.click(by, { ms: 320, after: 60 });
  if (await by.inputValue()) {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
  }
  await d.typeText("Sarah Reid", 30);
  const tick = page.locator("[role=dialog] input[type=checkbox], [role=dialog] button[role=checkbox]").first();
  await d.clickAt(L("V06", 1.9), tick, { ms: 450, label: "tick" });
  {
    const desc = page.getByRole("dialog").getByText(/is completed this way for every patient/).first();
    if (await desc.count()) await d.hoverAt(L("V06", 2.45), desc, { ms: 650, dx: 0.6, dy: 1.15, label: "description" });
  }
  // Once confirmed, the sticky confirm bar goes and the page gets shorter, so the browser pins it to its new bottom and
  // the page's last section comes up. In the same frame, while the dialog's backdrop is still fading out, the page is
  // moved 120 px up so the framing stays as it was.
  const settle = page.evaluate(
    () =>
      new Promise((res) => {
        const t0 = performance.now();
        const step = () => {
          if (/Mapping confirmed by/.test(document.body.innerText)) {
            window.scrollBy(0, -120);
            return res(true);
          }
          if (performance.now() - t0 > 10000) return res(false);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  await d.clickAt(L("V06", 3.35), page.locator("[role=dialog]").getByRole("button", { name: /Confirm mapping/ }), { ms: 600, label: "Confirm mapping (dialog)" });
  if (!(await settle)) throw new Error("The mapping was not confirmed");
  await page.getByText(/Mapping confirmed by Sarah Reid/).first().waitFor({ timeout: 10000 });

  // ---------- S04a: pick the patient ----------
  await d.until(Math.max(LE("V06", 0.3), L("V07", -0.15)), "end S03d");
  await d.cut(async () => {
    await page.goto(`${BASE}/reports/new`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Name, e\.g\. Megan/).waitFor({ timeout: 20000 });
    checks.sourceStep = await presentSourceStep(page);
    if (!checks.sourceStep.card || !checks.sourceStep.label || !checks.sourceStep.intro) throw new Error(`Patient step presentation incomplete: ${JSON.stringify(checks.sourceStep)}`);
    await sleep(500);
    await d.park(560, 600);
  });
  await d.shotStart("S04a");
  await d.hoverAt(L("V07", 0.1), page.getByText("Upload the notes", { exact: true }).first(), { ms: 600, dx: 0.5, label: "Upload the notes" });
  const search = page.getByPlaceholder(/Name, e\.g\. Megan/);
  await d.clickAt(L("V07", 1.25), search, { ms: 550, dx: 0.12, label: "search" });
  await d.typeText("Megan", 12);
  await d.clickAt(LE("V07", 0.05), page.getByText("Neck pain and headaches following road traffic accident").first(), { ms: 600, dx: 0.3, label: "episode", after: 0 });

  // ---------- S04b: their form, chosen for you ----------
  await d.cut(async () => {
    const choose = page.getByRole("button", { name: "Choose the referrer form" });
    await choose.waitFor({ timeout: 30000 });
    await sleep(300);
    await choose.click();
    await page.getByRole("radio", { name: /Harrow & Pike/ }).waitFor({ timeout: 20000 });
    await sleep(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const m = await page.getByText(/Matches the referrer on the referral/).first().boundingBox();
    await d.park(m.x + m.width + 140, m.y + 90);
  });
  await d.until(L("V08", -0.3), "S04b", { quiet: true });
  await d.shotStart("S04b");
  checks.harrowPikePreselected = await page.getByRole("radio", { name: /Harrow & Pike/ }).isChecked().catch(() => null);
  await d.hoverAt(L("V08", -0.2), page.getByText(/Matches the referrer on the referral/).first(), { ms: 500, label: "matches chip" });
  const completeBtn = page.getByRole("button", { name: "Complete this form" });
  await d.clickAt(L("V08", 1.45), completeBtn, { ms: 650, label: "Complete this form", after: 0 });

  // ---------- S04c: filled in, in their own layout ----------
  const pv = page.getByRole("dialog");
  await d.cut(async () => {
    await page.waitForFunction(() => /\/reports\/(?!new)[^/?]+$/.test(location.pathname) || /could not be drafted/.test(document.body.innerText), null, { timeout: 120000 });
    if (/\/reports\/new/.test(page.url())) throw new Error("Drafting failed: " + (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400));
    await page.locator("#q-F-07").waitFor({ timeout: 30000 });
    checks.reportUrl = page.url().replace(BASE, "");
    checks.draftLabel = /Prepared demo draft/.test(await page.locator("main").innerText());
    const pvTab = page.getByRole("tab", { name: "Preview" });
    if ((await pvTab.getAttribute("data-state")) !== "active") await pvTab.click();
    await page.locator("[role=tabpanel][data-state=active] section.docx").first().waitFor({ timeout: 30000 });
    await sleep(500);
    await dismissToasts(page);
    await page.getByRole("button", { name: "Open a larger preview" }).first().click();
    await pv.locator("section.docx").first().waitFor({ timeout: 30000 });
    await sleep(700);
    const sb = await pv.locator("section.docx").first().boundingBox();
    await d.park(sb.x - 40, sb.y + 140);
  });
  await d.shotStart("S04c");
  const tDraft = d.vt();
  {
    const sb = await pv.locator("section.docx").first().boundingBox();
    const cn = await pv.getByText("Claimant name", { exact: true }).first().boundingBox();
    if (cn) await d.moveAt(tDraft + 0.6, sb.x - 30, cn.y + cn.height / 2, 900);
    await d.until(Math.max(tDraft + 2.0, LE("V08", -2.6)), "scroll to B1");
    await d.reveal(pv.getByText(/Mechanism of injury/).first(), { inner: true, force: true, ms: 1600 });
    const mb = await pv.getByText(/Mechanism of injury/).first().boundingBox();
    if (mb) await d.moveTo(sb.x - 30, mb.y + mb.height / 2, 700);
  }

  // ---------- S04d: every answer shows its source ----------
  await d.until(Math.max(LE("V08", 0.15), L("V09", -0.2)), "end S04c");
  const f7 = page.locator("#q-F-07");
  await d.cut(async () => {
    await pv
      .getByRole("button", { name: "Close" })
      .first()
      .click()
      .catch(async () => page.keyboard.press("Escape"));
    await pv.waitFor({ state: "hidden" });
    await sleep(300);
    await scrollToY(f7, 122);
    await dismissToasts(page);
    const p = await f7.locator("textarea").first().boundingBox();
    await d.park(p.x + 40, p.y + 30);
  });
  await d.shotStart("S04d");
  {
    const p = await f7.locator("textarea").first().boundingBox();
    await d.moveAt(L("V09", 0.15), p.x + p.width * 0.75, p.y + 30, 700);
    const chip = await textBox(f7, "Drafted from the notes");
    if (chip) await d.moveAt(L("V09", 1.0), chip.x + chip.width / 2, chip.y + chip.height / 2, 600);
  }
  await d.clickAt(L("V10", 0.15), f7.locator("button[aria-label^='Source N-001']").first(), { ms: 650, label: "citation N-001" });
  const note = page.locator('article[data-source-id="N-001"]').first();
  await note.waitFor({ timeout: 10000 });
  {
    await d.until(L("V10", 0.9), "note", { quiet: true });
    const b = await textBox(note, "restrained driver");
    if (b) await d.moveTo(b.x + b.width / 2, b.y + b.height / 2 + 2, 700);
  }

  // ---------- S04e: a gap is flagged, not guessed ----------
  await d.until(Math.max(LE("V10", 0.15), L("V11", -0.15)), "end S04d");
  const f14 = page.locator("#q-F-14");
  await d.cut(async () => {
    await scrollToY(f14, 150);
    await dismissToasts(page);
    await d.park(1000, 380);
  });
  await d.shotStart("S04e");
  {
    const boxes = f14.getByText("Needs clinician input", { exact: true });
    let box = null;
    for (let i = 0; i < (await boxes.count()); i++) {
      const b = await boxes.nth(i).boundingBox();
      if (b && (!box || b.y > box.y)) box = b;
    }
    if (box) await d.moveAt(L("V11", 0.7), box.x + box.width + 24, box.y + box.height / 2, 650);
  }
  await d.hoverAt(L("V11", 3.0), f14.getByText(/Gap – not in the record/).first(), { ms: 650, dx: 1.06, label: "gap" });
  {
    const b = await textBox(f14, "Only an opinion a clinician recorded");
    if (b) await d.moveAt(L("V12", 0.1), b.x + b.width + 18, b.y + b.height / 2, 700);
  }

  // ---------- S05a: her own opinion ----------
  await d.until(Math.max(LE("V12", 0.1), L("V13", -0.15)), "end S04e");
  await d.shotStart("S05a");
  {
    const add = f14.getByRole("button", { name: "Add a paragraph in your own words" });
    if (!(await f14.locator("textarea").count()) && (await add.count())) await d.clickAt(L("V13", -0.1), add, { ms: 300, label: "add paragraph" });
    await d.clickAt(L("V13", 0.3), f14.locator("textarea").last(), { ms: 450, dx: 0.25, dy: 0.4, label: "answer box", after: 40 });
    const parkAt = { ...d.mouse };
    await d.until(L("V13", 0.75), "opinion", { quiet: true });
    // While a paragraph is being typed the card shows a transient red "Missing field" state (the answer is only
    // committed on blur), so her words are entered and committed inside a short cut.
    await d.cut(async () => {
      await f14.locator("textarea").last().fill(PROGNOSIS);
      await f14.locator("h3").first().click();
      await sleep(450);
      await d.park(parkAt.x, parkAt.y);
    });
    checks.opinionCommitted = /Your own words/.test(await f14.innerText());
    const quick = f14.getByRole("button", { name: "Mark resolved" });
    if ((await quick.count()) && !(await f14.locator("form").count())) await d.clickAt(L("V13", 2.0), quick.first(), { ms: 600, label: "Mark resolved", after: 60 });
  }

  // ---------- S05b: approve – nothing is issued before ----------
  await d.until(L("V13", 3.0), "end S05a");
  const appr = page.getByRole("dialog");
  await d.cut(async () => {
    await page.locator("#q-F-13").getByLabel("Yes", { exact: true }).click();
    await sleep(200);
    await addOwnDirect(page, "F-15", F15);
    await addOwnDirect(page, "F-16", F16);
    await resolveAllDirect(page);
    const voice = page.getByRole("button", { name: "Write in my own voice" });
    if (await voice.count()) {
      await voice.first().click();
      await sleep(800);
    }
    for (let i = 0; i < 3; i++) {
      const c = await answeredLine(page);
      if (c.total && c.answered === c.total) break;
      await resolveAllDirect(page);
    }
    const c = await answeredLine(page);
    checks.beforeApproval = c;
    if (!c.total || c.answered !== c.total) throw new Error(`Not ready for approval: ${c.answered} of ${c.total} answered and clear`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await page.getByRole("button", { name: /^Approve/ }).first().click();
    await appr.waitFor();
    await sleep(400);
    const name = appr.getByLabel("Full name", { exact: true });
    if (!(await name.inputValue())) await name.fill("Sarah Reid");
    const hcpc = appr.getByLabel("HCPC registration number");
    if (!(await hcpc.inputValue())) await hcpc.fill("PH-DEMO-01");
    await appr.getByLabel(/Typed signature/).fill("Sarah Reid");
    const boxes = appr.locator("input[type=checkbox]");
    for (let i = 0; i < (await boxes.count()); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
    // Back to the top of the dialog: its title, "Nothing is issued until you approve it", the declaration.
    await appr.evaluate((el) => {
      for (const n of el.querySelectorAll("*")) if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) n.scrollTop = 0;
    });
    await dismissToasts(page);
    await sleep(400);
    const first = await appr.locator("input[type=checkbox]").first().boundingBox();
    await d.park(first.x + 260, first.y - 40);
  });
  await d.shotStart("S05b");
  {
    const cbs = appr.locator("input[type=checkbox]");
    const btn = await appr.getByRole("button", { name: /Approve and sign/ }).boundingBox();
    const pts = [];
    for (let i = 0; i < (await cbs.count()); i++) {
      const b = await cbs.nth(i).boundingBox();
      if (b && b.y > 0 && b.y + b.height < (btn ? btn.y - 24 : VIEW.h - 130)) pts.push(b);
    }
    if (pts.length) {
      await d.moveAt(L("V13", 3.35), pts[0].x + 28, pts[0].y + pts[0].height / 2, 400);
      const last = pts[pts.length - 1];
      await d.moveTo(last.x + 28, last.y + last.height / 2, 1400);
    }
  }
  await d.clickAt(LE("V14", -0.3), appr.getByRole("button", { name: /Approve and sign/ }), { ms: 700, label: "Approve and sign", after: 0 });

  // ---------- S05c: download their own file (punch-in: the cards below the copy panel name TM3) ----------
  await d.cut(async () => {
    await page.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 30000 });
    await sleep(600);
    checks.hiddenOnApproved = await hideApprovedExtras(page);
    if (checks.hiddenOnApproved.length !== 2) throw new Error(`Expected to hide two buttons on the approved form, hid ${JSON.stringify(checks.hiddenOnApproved)}`);
    await dismissToasts(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    const crop = await computeCrop(page);
    await placeToasts(page, { top: Math.round(crop.y0 + 12), right: Math.round(VIEW.w - crop.x1 + 14) });
    d.zoomOn(crop);
    checks.cropS05c = crop;
    const w = await page.getByRole("button", { name: "Completed form (Word)" }).boundingBox();
    await d.park(w.x + w.width + 160, w.y - 70);
  });
  await d.until(L("V15", -0.3), "S05c", { quiet: true });
  await d.shotStart("S05c");
  const wordBtn = page.getByRole("button", { name: "Completed form (Word)" });
  await d.hoverAt(L("V15", 0.1), wordBtn, { ms: 550, label: "Completed form (Word)" });
  {
    const dl = page.waitForEvent("download", { timeout: 60000 });
    await d.clickAt(L("V15", 0.75), wordBtn, { ms: 100, label: "Completed form (Word)", after: 60 });
    const download = await d.waitCut(dl, 0.3);
    const file = path.join(DIRS.downloads, download.suggestedFilename());
    await download.saveAs(file);
    downloads.word = file;
    checks.wordFile = download.suggestedFilename();
    if (!/_SIGNED\.docx$/.test(checks.wordFile)) throw new Error(`Unexpected final Word file name ${checks.wordFile}`);
    await d.waitCut(page.getByText(/Final document downloaded/).first().waitFor({ timeout: 10000 }), 0.3);
    log("downloaded", checks.wordFile);
  }

  // ---------- S05d: the final form, in their layout ----------
  await d.until(Math.max(SHOT.S05d.start, L("V15", 2.3)), "end S05c");
  await d.cut(async () => {
    d.zoomOff();
    await dismissToasts(page);
    await placeToasts(page, null);
    const pvTab = page.getByRole("tab", { name: "Preview" });
    if ((await pvTab.getAttribute("data-state")) !== "active") await pvTab.click();
    await page.getByText(/FINAL – approved by the clinician/).first().waitFor({ timeout: 30000 });
    await page.locator("[role=tabpanel][data-state=active] section.docx").first().waitFor({ timeout: 30000 });
    await sleep(300);
    await page.getByRole("button", { name: "Open a larger preview" }).first().click();
    await pv.locator("section.docx").first().waitFor({ timeout: 30000 });
    await pv.getByText(/Final completed form/).first().waitFor({ timeout: 20000 });
    // The larger preview may still be redrawing the approved document: wait until no DRAFT marking is left.
    let pvText = "";
    for (let i = 0; i < 40; i++) {
      pvText = await pv.innerText();
      if (!/\bDRAFT\b/.test(pvText)) break;
      await sleep(250);
    }
    await sleep(600);
    pvText = await pv.innerText();
    const dm = pvText.match(/[\s\S]{0,80}\bDRAFT\b[\s\S]{0,80}/);
    checks.finalPreview = { final: /Final completed form/.test(pvText), draftMark: dm ? dm[0].replace(/\s+/g, " ") : null };
    if (dm) throw new Error(`The final preview still shows a DRAFT mark: …${checks.finalPreview.draftMark}…`);
    // Page 1 of the completed form, for the title card.
    // Only what the dialog shows of it (an element screenshot would also take in the page behind the dialog).
    {
      const sec = pv.locator("section.docx").first();
      const sbox = await sec.boundingBox();
      const vis = await sec.evaluate((el) => {
        let sp = el.parentElement;
        while (sp && !(sp.scrollHeight > sp.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sp).overflowY))) sp = sp.parentElement;
        const r = (sp || document.documentElement).getBoundingClientRect();
        return { top: Math.max(0, r.top), bottom: Math.min(innerHeight, r.bottom) };
      });
      const y = Math.max(sbox.y, vis.top);
      const clip = { x: sbox.x, y, width: sbox.width, height: Math.min(sbox.y + sbox.height, vis.bottom) - y };
      await page.screenshot({ path: path.join(DIRS.cards, "final-form-p1.png"), clip });
    }
    const sb = await pv.locator("section.docx").first().boundingBox();
    await d.park(sb.x - 40, sb.y + 110);
  });
  await d.shotStart("S05d");
  const tFinal = d.vt();
  {
    const sb = await pv.locator("section.docx").first().boundingBox();
    await d.until(tFinal + 1.4, "scroll to B7 and Part C");
    // The signed declaration ends above the caption band; the page footer (its page-number fields are not drawn by
    // the preview) stays below the visible part of the dialog.
    checks.finalScroll = await scrollTableBottomTo(pv.getByText(/approved electronically/).first(), 752, 1600);
    const pb = await textBox(pv, "In my opinion Ms Hart has made a good recovery");
    if (pb) await d.moveAt(tFinal + 3.2, sb.x - 30, pb.y + pb.height / 2, 600);
    const sig = await textBox(pv, "approved electronically");
    if (sig) await d.moveAt(tFinal + 4.0, sb.x - 30, sig.y + sig.height / 2, 600);
    checks.finalSignedVisible = Boolean(sig && sig.y > 0 && sig.y < VIEW.h - 120);
    checks.finalFooterHidden = await pv.evaluate((el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (!/Form HPM-TP3/.test(n.nodeValue)) continue;
        let sp = n.parentElement;
        while (sp && !(sp.scrollHeight > sp.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(sp).overflowY))) sp = sp.parentElement;
        const r = n.parentElement.getBoundingClientRect();
        return !sp || r.top >= sp.getBoundingClientRect().bottom - 2;
      }
      return true;
    });
  }

  // ---------- S06: portal answers (punch-in on the approved "Copy answers" panel; no answer cards on screen) ----------
  await d.until(Math.max(LE("V15", 0.15), L("V16", -0.15)), "end S05d");
  await d.cut(async () => {
    await pv
      .getByRole("button", { name: "Close" })
      .first()
      .click()
      .catch(async () => page.keyboard.press("Escape"));
    await pv.waitFor({ state: "hidden" });
    await sleep(300);
    await dismissToasts(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    const crop = await computeCrop(page);
    await placeToasts(page, { top: Math.round(crop.y0 + 12), right: Math.round(VIEW.w - crop.x1 + 14) });
    d.zoomOn(crop);
    checks.cropS06 = crop;
    const c = await page.getByRole("button", { name: "Copy all answers" }).boundingBox();
    await d.park(c.x + c.width + 150, c.y + 110);
  });
  await d.shotStart("S06");
  {
    const h = await textBox(page.locator("main"), "Copy answers");
    if (h) await d.moveAt(L("V16", 0.2), h.x + h.width + 14, h.y + h.height / 2, 650);
    // The cursor points at the words from just above the line or from the margin, never over the text.
    const p = await textBox(page.locator("main"), "for a portal, an e-mail or a letter");
    if (p) await d.moveAt(L("V16", 2.3), p.x + p.width * 0.45, p.y - 7, 900);
    const one = await textBox(page.locator("main"), "Copy an answer, or all of them");
    if (one) await d.moveAt(L("V17", 0.0), one.x - 26, one.y + one.height / 2, 650);
  }
  const copyAll = page.getByRole("button", { name: "Copy all answers" });
  await d.clickAt(L("V17", 1.2), copyAll, { ms: 500, label: "Copy all answers" });
  {
    const toast = page.getByText(/\d+ answers copied/).first();
    await toast.waitFor({ timeout: 5000 });
    checks.copyAll = (await toast.innerText()).trim();
  }
  await d.until(Math.max(APP_END, LE("V17", 0.25)), "end S06");
  d.stop();
  d.zoomOff();
  await d.guard("end");
  d.check();
  await cast.detach();
  await cast.flush();
  await sleep(300);

  const timeline = {
    recordedAt: new Date().toISOString(),
    load: { atStart: loadAtStart, max: Number((d.maxLoad || 0).toFixed(1)), atEnd: Number(os.loadavg()[0].toFixed(1)) },
    base: BASE,
    health,
    viewport: size,
    voiceDurations: VOICE,
    checks,
    downloads,
    drift: d.drift,
    tooltips: d.tooltips,
    framing: { samples: reports.length, violations: d.violations },
    guard: { checks: GUARD.checks, scenes: GUARD.scenes },
    problems,
    frames: cast.timedFrames(),
    events: d.events,
  };
  fs.writeFileSync(path.join(WORK, "timeline.json"), JSON.stringify(timeline, null, 1));
  await browser.close();
  log(`recorded ${timeline.frames.length} frames; drift ${d.drift.length}; tooltips ${d.tooltips.length}; problems ${problems.length}; load ${loadAtStart} -> ${timeline.load.atEnd} (max ${timeline.load.max})`);
  const worst = d.drift.reduce((m, x) => Math.max(m, x.late), 0);
  if (worst > 1) log(`WARNING: an action ran ${worst.toFixed(2)} s late (machine busy?): check the drift list and consider re-recording`);
  if (problems.length) log(problems.join("\n"));
  return timeline;
}

/* ---------------------------------------------------------------------------------------------
 * Layout: cuts, the recorded segment's kept intervals and the final-cut times of lines, shots and punch-ins
 * -------------------------------------------------------------------------------------------*/
function computeLayout(timeline) {
  const ev = timeline.events;
  const a = ev.find((e) => e.type === "seg" && e.edge === "start").t;
  const b = ev.find((e) => e.type === "seg" && e.edge === "end").t;
  const cuts = [];
  let open = null;
  for (const e of ev.filter((x) => x.type === "cut").sort((x, y) => x.t - y.t)) {
    if (e.edge === "start") open = open ?? e.t;
    else if (open !== null) {
      cuts.push([open, e.t]);
      open = null;
    }
  }
  const kept = keptIntervals(a, b, cuts);
  const map = mapper(kept);
  const fin = (t) => APP_START + map(Math.min(Math.max(t, a), b), true);
  const dur = keptTotal(kept);
  const appEnd = APP_START + dur;
  const lineEv = ev.filter((e) => e.type === "line");
  const lines = CAP.lines.map((l, i) => {
    let start = l.start;
    let recorded = false;
    const e = lineEv.find((x) => x.id === l.id);
    if (e) {
      start = fin(e.t);
      recorded = true;
    } else if (l.start >= APP_END) start = appEnd + (l.start - APP_END); // end-card lines keep their place on the card
    return { id: l.id, start, recorded, planned: l.start, caption: l.caption, srt: l.srt, vo: l.vo, i };
  });
  const total = Math.max(TOTAL, appEnd + (TOTAL - APP_END));
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].end = next ? next.start : total;
    // A caption pill never runs over the end card.
    lines[i].capEnd = lines[i].start < appEnd ? Math.min(lines[i].end, appEnd) : lines[i].end;
  }
  const shots = [];
  for (const e of ev.filter((x) => x.type === "shot")) shots.push({ id: e.id, start: fin(e.t), planned: SHOT[e.id].start });
  shots.unshift({ id: "S01", start: 0, planned: 0 });
  shots.push({ id: "S07", start: appEnd, planned: APP_END });
  for (let i = 0; i < shots.length; i++) shots[i].end = shots[i + 1] ? shots[i + 1].start : total;
  const zooms = [];
  let z = null;
  for (const e of ev.filter((x) => x.type === "zoom")) {
    if (e.edge === "start") z = { t0: e.t, crop: e.crop };
    else if (z) {
      zooms.push({ start: fin(z.t0) - APP_START, end: fin(e.t) - APP_START, crop: z.crop });
      z = null;
    }
  }
  const cta = lines.find((l) => l.id === CAP.cards.end.ctaWith);
  return { a, b, cuts, kept, dur, lines, shots, zooms, fin, total, ctaAt: cta ? cta.start - 0.15 : appEnd + 5 };
}

/* ---------------------------------------------------------------------------------------------
 * Cards and caption images (rendered on the app's origin so the Studio's own Inter font is used)
 * -------------------------------------------------------------------------------------------*/
/**
 * The Studio's own Inter @font-face rules with the font files inlined (data: URIs), cached in work/font.json
 * so that --assemble-only works without the server.
 */
async function appFontCss() {
  const cache = path.join(WORK, "font.json");
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const html = await (await fetch(`${BASE}/reports`)).text();
  const links = Array.from(html.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)"/g)).map((m) => m[1]);
  let css = "";
  for (const l of links) css += await (await fetch(BASE + l)).text();
  const faces = [];
  const seen = new Set();
  for (const f of css.match(/@font-face\{[^}]*\}/g) || []) {
    // Latin and Latin-extended subsets only (dashes, quotes and the middle dot are in Latin); each file once.
    if (/unicode-range/i.test(f) && !/unicode-range:[^;}]*u\+0(?:000-00ff|100-02)/i.test(f)) continue;
    const key = (f.match(/url\(([^)]+)\)/) || [])[1] || f;
    if (seen.has(key)) continue;
    seen.add(key);
    let out = f;
    for (const m of f.matchAll(/url\((\/_next\/[^)]+)\)/g)) {
      const buf = Buffer.from(await (await fetch(BASE + m[1])).arrayBuffer());
      out = out.replace(m[0], `url(data:font/woff2;base64,${buf.toString("base64")})`);
    }
    faces.push(out);
  }
  const fam = (faces.find((f) => /Inter/.test(f) && !/Fallback/.test(f)) || "").match(/font-family:([^;]+);/);
  const res = { faces: faces.join("\n"), family: fam ? `${fam[1]}, ` : "" };
  if (!res.family) throw new Error("The Studio's Inter font was not found in its CSS");
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(res));
  return res;
}

const PLAY_SVG = `<svg viewBox="0 0 24 24"><path d="M6 3.8v16.4a1 1 0 0 0 1.5.86l13.2-8.2a1 1 0 0 0 0-1.72L7.5 2.94A1 1 0 0 0 6 3.8z" fill="#fff"/></svg>`;

function cardHtml(key, font, finalImg) {
  const ff_ = `${font.family}Inter, system-ui, sans-serif`;
  const head = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>ClinForms</title><style>${font.faces}\n${CARD_CSS}
    body{font-family:${ff_}}
    .chips{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
    .chip{display:inline-flex;align-items:center;gap:10px;background:#fff;border:1px solid #cbd5e1;border-radius:999px;padding:11px 18px;font-size:20px;font-weight:600;color:#0f172a;box-shadow:0 2px 8px rgba(15,23,42,.05)}
    .chip i{width:24px;height:24px;border-radius:50%;background:#ccfbf1;display:inline-flex;align-items:center;justify-content:center;font-style:normal;color:#0f766e;font-weight:800;font-size:14px}
    .big{display:flex;align-items:center;gap:22px;margin-top:18px}
    .big .logo{width:78px;height:78px;border-radius:20px}
    .big .logo svg{width:42px;height:42px}
    .big h1{font-size:92px;margin:0;letter-spacing:-.03em}
    .play{width:132px;height:132px;border-radius:50%;background:rgba(13,148,136,.96);box-shadow:0 0 0 8px rgba(255,255,255,.9),0 20px 50px rgba(15,23,42,.3);display:flex;align-items:center;justify-content:center;flex:none}
    .play svg{width:58px;height:58px;margin-left:9px}
  </style></head><body><div class="wrap">`;
  const tail = "</div></body></html>";
  // A line break after the comma nearest the middle keeps a line on two balanced lines (no orphan word).
  const lede = (t) => {
    const cuts = [...t.matchAll(/, /g)].map((m) => m.index);
    if (!cuts.length) return esc(t);
    const k = cuts.sort((a, b) => Math.abs(a - t.length / 2) - Math.abs(b - t.length / 2))[0];
    return `${esc(t.slice(0, k + 1))}<br>${esc(t.slice(k + 2))}`;
  };
  if (key === "title") {
    const c = CAP.cards.title;
    return `${head}
      <div style="display:flex;gap:40px;align-items:center;flex:1;min-height:0">
        <div style="flex:1.25">
          <div class="kicker" style="font-size:19px">${esc(c.kicker)}</div>
          <div class="big">${LOGO}<h1>${esc(c.title)}</h1></div>
          <p style="font-size:31px;color:#1e293b;line-height:1.35;margin:30px 0 0;max-width:760px;font-weight:600;letter-spacing:-.01em">${lede(c.lede)}</p>
          <div class="chips">${c.chips.map((x) => `<span class="chip"><i>&#10003;</i>${esc(x)}</span>`).join("")}</div>
        </div>
        <div style="flex:.75;position:relative;height:700px">
          ${finalImg ? `<img src="${finalImg}" style="position:absolute;right:20px;top:40px;width:520px;border-radius:6px;-webkit-mask-image:linear-gradient(180deg,#000 82%,transparent);mask-image:linear-gradient(180deg,#000 82%,transparent);box-shadow:0 30px 60px rgba(15,23,42,.25),0 0 0 1px rgba(15,23,42,.08);transform:rotate(2deg)"><div style="position:absolute;right:250px;top:470px;background:#0d9488;color:#fff;font-weight:600;font-size:16px;padding:10px 15px;border-radius:10px;box-shadow:0 10px 24px rgba(13,148,136,.35)">A referrer's own form, completed · fictional patient</div>` : ""}
        </div>
      </div>
      <div class="foot"><span class="pill" style="font-size:20px">${esc(c.footer)}</span><span></span></div>${tail}`;
  }
  if (key === "end" || key === "endCta") {
    const c = CAP.cards.end;
    const show = key === "endCta" ? "visible" : "hidden";
    return `${head}
      <div style="margin:auto 0;display:flex;flex-direction:column;align-items:center;text-align:center">
        <div class="brand" style="font-size:30px;gap:16px">${LOGO.replace('class="logo"', 'class="logo" style="width:52px;height:52px;border-radius:14px"')}${esc(c.kicker)}</div>
        <div style="margin-top:30px;font-size:50px;line-height:1.16;font-weight:750;letter-spacing:-.02em;color:#0f172a">${lede(c.tagline)}</div>
        <div style="visibility:${show};margin-top:46px;display:flex;flex-direction:column;align-items:center">
          <div style="background:#0d9488;color:#fff;font-size:46px;font-weight:750;letter-spacing:-.01em;padding:18px 40px;border-radius:20px;box-shadow:0 16px 36px rgba(13,148,136,.3)">${esc(c.title)}</div>
          <div style="margin-top:28px;font-size:40px;font-weight:700;color:#0f766e">${esc(c.lines[0])}</div>
          <div style="margin-top:10px;font-size:31px;font-weight:500;color:#334155">${esc(c.lines[1])}</div>
        </div>
        <div style="margin-top:34px;font-size:17px;color:#64748b">${esc(c.small)}</div>
      </div>
      <div class="foot" style="justify-content:center"><span>${esc(c.footer)}</span></div>${tail}`;
  }
  if (key === "teaserTitle") {
    // Frame 0 of the e-mail GIF (some desktop mail apps show only that frame): big enough to read at 800 px wide.
    const c = CAP.cards.teaserTitle;
    return `${head}
      <div style="margin:auto 0;display:flex;align-items:center;gap:80px;padding:0 20px">
        <div style="flex:1">
          <div class="big">${LOGO}<h1 style="font-size:116px">${esc(c.title)}</h1></div>
          <p style="font-size:50px;color:#1e293b;line-height:1.22;margin:34px 0 0;font-weight:650;letter-spacing:-.015em">${lede(c.lede)}</p>
          <div style="margin-top:44px;display:inline-flex;align-items:center;gap:16px;background:rgba(15,23,42,.9);color:#fff;font-weight:650;font-size:40px;padding:16px 28px;border-radius:18px">
            <span style="width:0;height:0;border-left:24px solid #fff;border-top:15px solid transparent;border-bottom:15px solid transparent"></span>${esc(c.badge)}</div>
        </div>
        <div style="position:relative;width:520px;height:640px;flex:none">
          ${finalImg ? `<img src="${finalImg}" style="position:absolute;left:30px;top:10px;width:460px;border-radius:6px;-webkit-mask-image:linear-gradient(180deg,#000 80%,transparent);mask-image:linear-gradient(180deg,#000 80%,transparent);box-shadow:0 30px 60px rgba(15,23,42,.25),0 0 0 1px rgba(15,23,42,.08);transform:rotate(2deg)">` : ""}
          <div class="play" style="position:absolute;left:194px;top:230px">${PLAY_SVG}</div>
          ${finalImg ? `<div style="position:absolute;left:110px;top:560px;background:#0d9488;color:#fff;font-weight:650;font-size:24px;padding:10px 18px;border-radius:12px;box-shadow:0 10px 24px rgba(13,148,136,.35)">Fictional patient data</div>` : ""}
        </div>
      </div>${tail}`;
  }
  throw new Error("unknown card " + key);
}

const CAPTION_CSS = (font) => `${font.faces}
  html,body{margin:0;background:transparent}
  body{font-family:${font.family}Inter, system-ui, sans-serif}
  .w{display:inline-block;padding:20px}
  .pill{background:rgba(15,23,42,.88);color:#fff;font-weight:600;font-size:28px;line-height:1.32;letter-spacing:.002em;padding:13px 28px 14px;border-radius:16px;
    box-shadow:0 10px 30px rgba(2,6,23,.35);text-align:center}
  .pill div{white-space:nowrap}
  .tag{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.92);color:#334155;font-weight:600;font-size:13px;padding:6px 11px;border-radius:999px;
    box-shadow:0 0 0 1px rgba(15,23,42,.12),0 2px 6px rgba(2,6,23,.12)}
  .tag i{width:7px;height:7px;border-radius:50%;background:#0d9488}
  .tag.l{font-size:30px;gap:14px;padding:12px 24px}
  .tag.l i{width:14px;height:14px}
  .big{background:rgba(15,23,42,.9);color:#fff;font-weight:700;font-size:76px;line-height:1.2;padding:24px 50px 28px;border-radius:30px;text-align:center;box-shadow:0 14px 40px rgba(2,6,23,.4)}
  .big div{white-space:nowrap}
`;

async function renderCardsAndCaptions(layout) {
  fs.mkdirSync(DIRS.cards, { recursive: true });
  fs.rmSync(DIRS.caps, { recursive: true, force: true });
  fs.mkdirSync(DIRS.caps, { recursive: true });
  const font = await appFontCss();
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.w},${VIEW.h}`, "--hide-scrollbars"],
  });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const imgFile = path.join(DIRS.cards, "final-form-p1.png");
  const finalImg = fs.existsSync(imgFile) ? `data:image/png;base64,${fs.readFileSync(imgFile).toString("base64")}` : null;
  const out = { cards: {}, captions: [], teaser: [], ctaAt: layout.ctaAt };
  for (const key of ["title", "end", "endCta", "teaserTitle"]) {
    const html = cardHtml(key, font, finalImg);
    fs.writeFileSync(path.join(DIRS.cards, `${key}.html`), html);
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(300);
    scanOrThrow(`card ${key}`, await pageText(page));
    const png = path.join(DIRS.cards, `${key}.png`);
    await page.screenshot({ path: png });
    out.cards[key] = png;
  }
  // Caption pills (one PNG per line with words), the corner tags and the teaser's big captions.
  const shoot = async (html, file) => {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CAPTION_CSS(font)}</style></head><body><div class="w">${html}</div></body></html>`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    scanOrThrow(`caption image ${path.basename(file)}`, await pageText(page));
    await page.locator(".w").screenshot({ path: file, omitBackground: true });
    const [w, h] = (await page.locator(".w").evaluate((e) => [e.offsetWidth, e.offsetHeight])).map((v) => Math.round(v * SCALE));
    return { w, h };
  };
  for (const l of layout.lines) {
    if (!l.caption.length) continue;
    const file = path.join(DIRS.caps, `${l.id}.png`);
    const { w, h } = await shoot(`<div class="pill">${l.caption.map((x) => `<div>${esc(x)}</div>`).join("")}</div>`, file);
    const pad = Math.round(20 * SCALE);
    // Bottom centre, the pill's bottom edge 18 device px above the frame's bottom (inside CAPTION_ZONE).
    out.captions.push({ id: l.id, file, w, h, x: Math.round((OUT_W - w) / 2), y: OUT_H - 18 - (h - pad), start: l.start, end: l.capEnd, text: l.caption.join(" ") });
  }
  {
    const file = path.join(DIRS.caps, "tag-fictional.png");
    const { w, h } = await shoot(`<span class="tag"><i></i>Fictional data</span>`, file);
    const pad = Math.round(20 * SCALE);
    const zoomed = layout.zooms.map((z) => [APP_START + z.start, APP_START + z.end]);
    // Top left on every recorded frame; inside a punch-in it moves right of the page's "← Reports" link.
    out.tag = { id: "tag", file, w, h, x: 22 - pad, y: 18 - pad, start: APP_START, end: APP_START + layout.dur, hide: zoomed };
    out.tagZoom = { id: "tagZoom", file, w, h, x: 190 - pad, y: 18 - pad, start: APP_START, end: APP_START + layout.dur, only: zoomed };
  }
  {
    const file = path.join(DIRS.caps, "tag-fictional-large.png");
    const { w, h } = await shoot(`<span class="tag l"><i></i>Fictional data</span>`, file);
    out.tagLarge = { file, w, h };
  }
  for (const tsh of CAP.teaser.shots) {
    if (!tsh.caption.length || tsh.from === "card") continue;
    const file = path.join(DIRS.caps, `teaser-${tsh.id}.png`);
    const { w, h } = await shoot(`<div class="big">${tsh.caption.map((x) => `<div>${esc(x)}</div>`).join("")}</div>`, file);
    out.teaser.push({ id: tsh.id, file, w, h });
  }
  await browser.close();
  fs.writeFileSync(path.join(DIRS.caps, "captions.json"), JSON.stringify(out, null, 1));
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Assembly
 * -------------------------------------------------------------------------------------------*/
const even = (v) => 2 * Math.round(v / 2);

/** The recorded segment, caption-free, with the punch-ins applied: work/clips/app-clean.mp4 (high quality intermediate). */
function encodeApp(timeline, layout) {
  fs.rmSync(DIRS.clips, { recursive: true, force: true });
  fs.mkdirSync(DIRS.clips, { recursive: true });
  const list = path.join(DIRS.clips, "app.txt");
  writeConcat(timeline.frames, layout.kept, DIRS.frames, list);
  const total = layout.dur;
  const base = `[0:v]crop=w='min(iw,${OUT_W})':h='min(ih,${OUT_H})':x=0:y=0,pad=${OUT_W}:${OUT_H}:0:0:color=white,setsar=1,fps=30[base]`;
  const parts = [];
  let t = 0;
  for (const z of layout.zooms) {
    if (z.start > t + 0.01) parts.push({ s: t, e: z.start });
    parts.push({ s: z.start, e: Math.min(z.end, total), crop: z.crop });
    t = Math.min(z.end, total);
  }
  if (total > t + 0.01) parts.push({ s: t, e: total });
  // Punch-ins: a cropped, scaled copy of the stream laid over the full frame while each one lasts (overlay keeps both
  // branches in step frame by frame; a split + trim + concat graph dropped the parts after the first punch-in).
  const zooms = parts.filter((p) => p.crop);
  const graph = [base];
  if (!zooms.length) graph.push("[base]null[vout]");
  else {
    graph.push(`[base]split=${zooms.length + 1}[m0]${zooms.map((_, i) => `[z${i}]`).join("")}`);
    zooms.forEach((p, i) => {
      const h = even((p.crop.y1 - p.crop.y0) * SCALE);
      const w = even((h * 16) / 9);
      const x = even(Math.max(0, Math.min(OUT_W - w, p.crop.x0 * SCALE)));
      const y = even(p.crop.y0 * SCALE);
      p.device = { x, y, w, h, scale: Number((OUT_H / h).toFixed(3)) };
      graph.push(`[z${i}]crop=${w}:${h}:${x}:${y},scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1[zz${i}]`);
      graph.push(`[m${i}][zz${i}]overlay=0:0:enable='gte(t,${p.s.toFixed(4)})*lt(t,${p.e.toFixed(4)})'${i === zooms.length - 1 ? "[vout]" : `[m${i + 1}]`}`);
    });
  }
  const out = path.join(DIRS.clips, "app-clean.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-filter_complex", graph.join(";"), "-map", "[vout]", "-t", total.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", "-r", "30", "-an", out]);
  return { file: out, parts };
}

/** An ffmpeg `enable` expression: inside [start, end], outside every `hide` interval and (if given) inside one `only` interval. */
function enableExpr(c, s = c.start, e = c.end, hide = c.hide || [], only = c.only) {
  const parts = [`between(t,${s.toFixed(3)},${e.toFixed(3)})`];
  for (const [a, b] of hide) parts.push(`not(between(t,${a.toFixed(3)},${b.toFixed(3)}))`);
  if (only) parts.push(only.length ? `(${only.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+")})` : "0");
  return parts.join("*");
}

/** Title card + recorded segment + end card (call to action fading in) (+ captions and the corner tags): one 1920x1080 30 fps H.264 file. */
function compose(appFile, appDur, rendered, layout, { captions, out, crf, preset }) {
  const titleDur = APP_START;
  const endDur = layout.total - APP_START - appDur;
  const inputs = ["-loop", "1", "-framerate", "30", "-t", titleDur.toFixed(3), "-i", rendered.cards.title, "-i", appFile, "-loop", "1", "-framerate", "30", "-t", endDur.toFixed(3), "-i", rendered.cards.end];
  const norm = `crop=w='min(iw,${OUT_W})':h='min(ih,${OUT_H})':x=0:y=0,scale=${OUT_W}:${OUT_H},setsar=1,fps=30,format=yuv420p`;
  const graph = [
    `[0:v]${norm},fade=t=in:st=0:d=0.35,fade=t=out:st=${(titleDur - 0.15).toFixed(3)}:d=0.15:color=white[t]`,
    `[1:v]${norm},fade=t=in:st=0:d=0.15:color=white,fade=t=out:st=${(appDur - 0.15).toFixed(3)}:d=0.15:color=white[a]`,
    `[2:v]${norm}[e0]`,
  ];
  // The call to action fades in over the tagline card as its line starts.
  inputs.push("-loop", "1", "-framerate", "30", "-t", endDur.toFixed(3), "-i", rendered.cards.endCta);
  const ctaLocal = Math.max(0.2, layout.ctaAt - (APP_START + appDur));
  graph.push(
    `[3:v]${norm},format=rgba,fade=t=in:st=${ctaLocal.toFixed(3)}:d=0.45:alpha=1[cta]`,
    `[e0][cta]overlay=0:0:format=auto,format=yuv420p,fade=t=in:st=0:d=0.15:color=white,fade=t=out:st=${(endDur - 0.5).toFixed(3)}:d=0.5[e]`,
    "[t][a][e]concat=n=3:v=1:a=0[c0]",
  );
  let last = "c0";
  if (captions) {
    const items = [...rendered.captions, { ...rendered.tag, fade: 0.3 }, { ...rendered.tagZoom, fade: 0 }];
    items.forEach((c, i) => {
      const idx = 4 + i;
      inputs.push("-loop", "1", "-framerate", "30", "-t", (c.end + 0.2).toFixed(3), "-i", c.file);
      const fd = c.fade ?? 0.2;
      const fades = fd ? `,fade=t=in:st=${c.start.toFixed(3)}:d=${fd}:alpha=1,fade=t=out:st=${(c.end - fd).toFixed(3)}:d=${fd}:alpha=1` : "";
      graph.push(`[${idx}:v]format=rgba${fades}[k${i}]`, `[${last}][k${i}]overlay=x=${c.x}:y=${c.y}:eof_action=pass:enable='${enableExpr(c)}'[o${i}]`);
      last = `o${i}`;
    });
  }
  graph.push(`[${last}]format=yuv420p[vout]`);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[vout]", "-t", layout.total.toFixed(3), "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", "-an", out]);
}

/** The caption-free teaser source: T0 = teaser title card, T1–T4 from picture-clean.mp4 at their master times, T5 = the end card with the call to action. */
function teaserSource(cleanFile, layout, rendered) {
  const cutsAt = layout.shots.map((s) => s.start);
  const segs = [];
  for (const tsh of CAP.teaser.shots) {
    if (tsh.from === "card") {
      segs.push({ id: tsh.id, card: rendered.cards[tsh.card === "end" ? "endCta" : tsh.card], dur: tsh.seconds, caption: tsh.caption });
      continue;
    }
    const dur = tsh.out - tsh.in;
    // Planned master times follow the recorded shot (a shot that started late moves its teaser window with it).
    const shot = layout.shots.find((s) => s.id === tsh.from);
    const off = shot ? shot.start - shot.planned : 0;
    let a = tsh.in + off;
    let b = tsh.out + off;
    // Keep each teaser shot inside one master shot: if a cut falls inside, slide the window back before it.
    const inside = cutsAt.find((c) => c > a + 0.05 && c < b - 0.05);
    if (inside !== undefined) {
      b = inside - 0.04;
      a = b - dur;
    }
    segs.push({ id: tsh.id, from: tsh.from, in: Number(a.toFixed(3)), out: Number(b.toFixed(3)), dur, caption: tsh.caption, slid: inside !== undefined });
  }
  const inputs = [];
  const graph = [];
  segs.forEach((s, i) => {
    if (s.card) {
      inputs.push("-loop", "1", "-framerate", "30", "-t", s.dur.toFixed(3), "-i", s.card);
      graph.push(`[${i}:v]crop=w='min(iw,${OUT_W})':h='min(ih,${OUT_H})':x=0:y=0,scale=${OUT_W}:${OUT_H},setsar=1,fps=30,format=yuv420p[t${i}]`);
    } else {
      inputs.push("-ss", s.in.toFixed(3), "-t", s.dur.toFixed(3), "-i", cleanFile);
      graph.push(`[${i}:v]setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[t${i}]`);
    }
  });
  graph.push(`${segs.map((_, i) => `[t${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[vout]`);
  const out = path.join(WORK, "teaser-source.mp4");
  const total = segs.reduce((x, s) => x + s.dur, 0);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[vout]", "-t", total.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-r", "30", "-an", out]);
  let t = 0;
  const meta = segs.map((s) => {
    const r = { ...s, card: s.card ? path.basename(s.card) : undefined, teaserStart: Number(t.toFixed(3)), teaserEnd: Number((t + s.dur).toFixed(3)) };
    t += s.dur;
    return r;
  });
  fs.writeFileSync(path.join(WORK, "teaser-source.json"), JSON.stringify({ file: out, seconds: Number(total.toFixed(2)), segments: meta, captionImages: rendered.teaser }, null, 1));
  return { file: out, seconds: total, segments: meta };
}

/**
 * The e-mail teaser from the caption-free source: big captions (lower third, faded in and out) and the large
 * "Fictional data" tag on every recorded segment, then an MP4 (1280x720) and a looping GIF (800x450, 10 fps, palette
 * per CAP.teaser.gif; dropped to 8 fps / 720x405 if it is over the target size). Frame 0 is the teaser title card.
 * The card segments carry no extra caption: the cards say the same words.
 */
function teaserFinal(src, rendered) {
  const segs = src.segments;
  const inputs = ["-i", src.file];
  const graph = ["[0:v]format=yuv420p[b0]"];
  let last = "b0";
  const rec = segs.filter((s) => !s.card);
  // The large corner tag on the recorded segments.
  {
    inputs.push("-loop", "1", "-framerate", "30", "-t", src.seconds.toFixed(3), "-i", rendered.tagLarge.file);
    const k = inputs.filter((x) => x === "-i").length - 1;
    const pad = Math.round(20 * SCALE);
    graph.push(`[${last}][${k}:v]overlay=x=${30 - pad}:y=${26 - pad}:enable='${rec.map((s) => `between(t,${s.teaserStart.toFixed(3)},${(s.teaserEnd - 0.01).toFixed(3)})`).join("+")}'[tg]`);
    last = "tg";
  }
  segs.forEach((sg, i) => {
    if (sg.card) return;
    const cap = rendered.teaser.find((x) => x.id === sg.id);
    if (!cap) return;
    const a = sg.teaserStart + 0.15;
    const b = sg.teaserEnd - 0.1;
    inputs.push("-loop", "1", "-framerate", "30", "-t", (b + 0.1).toFixed(3), "-i", cap.file);
    const k = inputs.filter((x) => x === "-i").length - 1;
    const y = Math.round(OUT_H * 0.8 - cap.h / 2);
    graph.push(
      `[${k}:v]format=rgba,fade=t=in:st=${a.toFixed(3)}:d=0.25:alpha=1,fade=t=out:st=${(b - 0.2).toFixed(3)}:d=0.2:alpha=1[c${i}]`,
      `[${last}][c${i}]overlay=x=(W-w)/2:y=${y}:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[v${i}]`,
    );
    last = `v${i}`;
  });
  const big = path.join(WORK, "teaser-1080.mp4");
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", `[${last}]`, "-t", src.seconds.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-r", "30", "-an", big]);
  const mp4 = path.join(WORK, "teaser.mp4");
  ff(["-i", big, "-vf", "scale=1280:720:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  const gif = path.join(WORK, "teaser.gif");
  const g = CAP.teaser.gif;
  const target = (g.targetMB || 3) * 1e6;
  let used = null;
  for (const [w, h, fps] of [[g.width, g.height, g.fps], [g.width, g.height, 8], [720, 405, 8]]) {
    const pal = path.join(WORK, "teaser-palette.png");
    ff(["-i", big, "-vf", `fps=${fps},scale=${w}:${h}:flags=lanczos,palettegen=stats_mode=diff`, pal]);
    ff(["-i", big, "-i", pal, "-lavfi", `fps=${fps},scale=${w}:${h}:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", gif]);
    used = { w, h, fps, bytes: fs.statSync(gif).size };
    if (used.bytes <= target) break;
  }
  // Frame 0 of the GIF, as a mail app that shows only the first frame would show it.
  const first = path.join(WORK, "teaser-gif-frame0.png");
  ff(["-i", gif, "-frames:v", "1", first]);
  // Static fallback for clients that block animation: T2's first second (the completed form) with its caption.
  const t2 = segs.find((x) => x.id === "T2") || segs[0];
  const poster = path.join(WORK, "teaser-poster.png");
  ff(["-ss", (t2.teaserStart + 0.9).toFixed(2), "-i", big, "-frames:v", "1", "-vf", "scale=800:450:flags=lanczos", poster]);
  return { mp4, gif, poster, frame0: first, gifSettings: used, gifMB: Number((used.bytes / 1e6).toFixed(2)) };
}

function writeSrt(layout) {
  const entries = [];
  for (const l of layout.lines) entries.push({ start: l.start, end: l.end - 0.05, text: l.srt });
  entries[entries.length - 1].end = layout.total - 0.4;
  const srt = entries.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${wrapSrt(s.text)}\n`).join("\n");
  scanOrThrow("SRT", srt);
  const file = path.join(WORK, "picture.srt");
  fs.writeFileSync(file, srt);
  return file;
}

function reviewFrames(file, dur) {
  fs.mkdirSync(REVIEW, { recursive: true });
  for (const f of fs.readdirSync(REVIEW)) if (/^f-.*\.png$/.test(f)) fs.rmSync(path.join(REVIEW, f));
  const out = [];
  for (let t = 1; t < dur; t += 2) {
    const name = `f-${String(t.toFixed(1)).padStart(4, "0")}.png`;
    ff(["-ss", t.toFixed(2), "-i", file, "-frames:v", "1", path.join(REVIEW, name)]);
    out.push(name);
  }
  return out;
}

async function assemble(timeline) {
  const layout = computeLayout(timeline);
  log(`recorded segment ${layout.dur.toFixed(2)} s (planned ${(APP_END - APP_START).toFixed(2)}); cuts ${layout.cuts.length}; punch-ins ${layout.zooms.length}; total ${layout.total.toFixed(2)} s`);
  if (Math.abs(layout.dur - (APP_END - APP_START)) > 0.3) log(`WARNING: recorded segment is ${layout.dur.toFixed(2)} s, planned ${(APP_END - APP_START).toFixed(2)} s`);
  for (const f of Object.values(timeline.downloads || {})) if (f && fs.existsSync(f)) scanOrThrow(`download ${path.basename(f)}`, `${path.basename(f)}\n${documentText(f)}`);
  const rendered = await renderCardsAndCaptions(layout);
  const app = encodeApp(timeline, layout);
  const clean = path.join(WORK, "picture-clean.mp4");
  compose(app.file, layout.dur, rendered, layout, { captions: false, out: clean, crf: 14, preset: "medium" });
  const picture = path.join(WORK, "picture.mp4");
  compose(app.file, layout.dur, rendered, layout, { captions: true, out: picture, crf: 18, preset: "slow" });
  const srt = writeSrt(layout);
  fs.copyFileSync(rendered.cards.title, path.join(WORK, "poster.png"));
  const teaser = teaserSource(clean, layout, rendered);
  teaser.final = teaserFinal(teaser, rendered);
  const dur = probeDuration(picture);
  const frames = reviewFrames(picture, dur);
  // Recorded times written back into the timeline (final-cut seconds).
  timeline.final = {
    picture,
    pictureClean: clean,
    srt,
    durationSec: Number(dur.toFixed(3)),
    appSegmentSec: Number(layout.dur.toFixed(3)),
    ctaAt: Number(layout.ctaAt.toFixed(3)),
    lines: layout.lines.map((l) => ({
      id: l.id,
      start: Number(l.start.toFixed(3)),
      end: Number(l.end.toFixed(3)),
      captionEnd: Number(l.capEnd.toFixed(3)),
      planned: l.planned,
      offset: Number((l.start - l.planned).toFixed(3)),
      recorded: l.recorded,
      caption: l.caption,
      srt: l.srt,
      vo: l.vo,
    })),
    shots: layout.shots.map((s) => ({ id: s.id, start: Number(s.start.toFixed(3)), end: Number(s.end.toFixed(3)), planned: s.planned })),
    punchIns: app.parts.filter((p) => p.crop).map((p) => ({ start: Number((APP_START + p.s).toFixed(3)), end: Number((APP_START + p.e).toFixed(3)), cropCss: p.crop, cropDevice: p.device })),
    cuts: layout.cuts.length,
    teaser,
    reviewFrames: { dir: REVIEW, count: frames.length },
    guardFiles: GUARD.files,
  };
  fs.writeFileSync(path.join(WORK, "timeline.json"), JSON.stringify(timeline, null, 1));
  return timeline.final;
}

/** --preview-montage: render the montage page and the cards, and screenshot the montage at a few moments (no take). */
async function previewMontage() {
  const browser = await chromium.launch({ executablePath: findChromium(), args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.w},${VIEW.h}`, "--hide-scrollbars"] });
  const font = await appFontCss();
  const pages = await renderFormPages(browser);
  fs.mkdirSync(DIRS.cards, { recursive: true });
  const file = path.join(DIRS.cards, "montage.html");
  fs.writeFileSync(file, montageHtml(font, pages));
  const page = await (await browser.newContext({ viewport: null })).newPage();
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  fs.mkdirSync(REVIEW, { recursive: true });
  await page.evaluate(() => window.__play(1));
  for (const [ms, name] of [[700, "a"], [2600, "b"]]) {
    await sleep(ms);
    await page.screenshot({ path: path.join(REVIEW, `montage-${name}.png`) });
  }
  await page.evaluate(() => window.__play(2));
  for (const [ms, name] of [[900, "c"], [900, "d"], [1600, "e"]]) {
    await sleep(ms);
    await page.screenshot({ path: path.join(REVIEW, `montage-${name}.png`) });
  }
  for (const key of ["title", "end", "endCta", "teaserTitle"]) {
    await page.setContent(cardHtml(key, font, null), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(200);
    await page.screenshot({ path: path.join(REVIEW, `card-${key}.png`) });
  }
  await browser.close();
  log("montage preview in", REVIEW);
}

/* ---------------------------------------------------------------------------------------------
 * Main
 * -------------------------------------------------------------------------------------------*/
async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  {
    const { about, shots, ...rest } = CAP;
    void about;
    // Customer-facing strings (captions, SRT, voice-over, cards, teaser); the shot notes are internal.
    scanOrThrow("outreach-captions.json", JSON.stringify(rest));
    void shots;
  }
  if (flag("--preview-montage")) return previewMontage();
  let timeline;
  if (flag("--assemble-only")) timeline = JSON.parse(fs.readFileSync(path.join(WORK, "timeline.json"), "utf8"));
  else timeline = await record();
  const final = await assemble(timeline);
  log(
    "DONE",
    JSON.stringify(
      {
        picture: final.picture,
        duration: final.durationSec,
        lines: final.lines.map((l) => `${l.id}@${l.start}`).join(" "),
        drift: timeline.drift,
        checks: timeline.checks,
        violations: timeline.framing.violations.length,
        tooltips: timeline.tooltips,
        teaser: final.teaser.file,
      },
      null,
      1,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
