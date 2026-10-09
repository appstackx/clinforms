#!/usr/bin/env node
/**
 * Records the "ClinForms" walkthrough video for Dell Baines, Blue Heart Clinics (fictional data only).
 *
 * The video is a point-by-point reply to Dell's email: every chapter opens with his own question (a quote
 * card) and ends with a one-line plain answer. It drives the real Studio and the Simulated TM3 sandbox with
 * Playwright, captures every painted frame with the Chrome DevTools screencast (JPEG q92, native 1920x1080:
 * a 1600x900 CSS viewport at device scale 1.2), and assembles an H.264 MP4 with ffmpeg, plus an e-mail
 * sized copy, matching .srt subtitles, a voice-over script, a poster and review frames. Captions, chapter
 * chips, question cards, the cursor dot and its click ripple are injected with addInitScript – no app code
 * is touched.
 *
 * Honesty rules baked in:
 *  - LIVE by default: the form reading and the drafts are produced live during the recording (the server
 *    must allow live drafting; the passcode is put into the tab's sessionStorage by an init script and is
 *    never shown). Each live wait is logged and sped up in post, labelled "Sped up – real time N s" with
 *    the measured wall time. Nothing else is sped up; dead time (page loads, downloads) is hard-cut.
 *    `--demo` records the prepared demo outputs instead and says so in the captions.
 *  - Customer-facing wording is neutral (src/modules/medreport/core/wording.ts). A guard scans the visible
 *    page text, title, aria-labels, titles, placeholders and alt text before every caption, question card
 *    and chapter and ABORTS the recording on a banned term; captions.json, the cards, the SRT, the
 *    narration script and the downloaded final forms are scanned too.
 *  - Counts in captions are read from the UI at record time; waits are measured.
 *
 * Usage (see README.md):
 *   MEDREPORT_AI_MODE=auto PORT=3110 npm run start &
 *   NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /path/to/video
 *   NODE_PATH=$(npm root -g) node scripts/medreport/video/record-demo.mjs --out /path/to/video --assemble-only [--cards]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright not found. Run with NODE_PATH=$(npm root -g) (global playwright).");
  process.exit(1);
}

/* ---------------------------------------------------------------------------------------------
 * Configuration
 * -------------------------------------------------------------------------------------------*/
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);
const BASE = (process.env.BASE || "http://localhost:3110").replace(/\/$/, "");
const OUT = path.resolve(arg("--out", process.env.VIDEO_OUT || path.join(os.tmpdir(), "clinforms-video")));
const LIVE = !flag("--demo");
/** Product name shown on the title cards and the top bar (matches PRODUCT.name in src/modules/medreport/config.public.ts). */
const PRODUCT_NAME = "ClinForms";
const FINAL_NAME = "clinforms-demo-blue-heart";
const EMAIL_MAX_BYTES = 23_000_000; // "24 MB or less" for e-mail, with a margin (decimal MB)
const CAP = JSON.parse(fs.readFileSync(path.join(HERE, "captions.json"), "utf8"));
const VIEW = { w: 1600, h: 900 };
const SCALE = 1.2; // 1600x900 CSS px -> 1920x1080 device px
const OUT_W = 1920;
const OUT_H = 1080;
const DIRS = {
  frames: path.join(OUT, "work", "frames"),
  cardFrames: path.join(OUT, "work", "card-frames"),
  clips: path.join(OUT, "work", "clips"),
  input: path.join(OUT, "work", "input"),
  downloads: path.join(OUT, "work", "downloads"),
  viewer: path.join(OUT, "work", "viewer"),
  badges: path.join(OUT, "work", "badges"),
  cards: path.join(OUT, "cards"),
  review: path.join(OUT, "frames"),
};

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = "/opt/pw-browsers";
  if (fs.existsSync(root)) {
    const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    const exe = dir && path.join(root, dir, "chrome-linux", "chrome");
    if (exe && fs.existsSync(exe)) return exe;
  }
  return undefined; // Playwright's default
}

/** The live drafting passcode from .env.local. Never printed, logged or shown on screen. */
function livePasscode() {
  const file = path.join(REPO, ".env.local");
  const env = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const m = env.match(/^MEDREPORT_LIVE_PASSCODE=(.*)$/m);
  const v = m ? m[1].trim().replace(/^["']|["']$/g, "") : process.env.MEDREPORT_LIVE_PASSCODE || "";
  if (!v) throw new Error("No live drafting passcode (MEDREPORT_LIVE_PASSCODE in .env.local). Use --demo to record prepared outputs.");
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const words = (t) => t.split(/\s+/).filter(Boolean).length;
/** Reading time: ~0.35 s per word, at least 2.5 s. */
const dwell = (t) => Math.max(2.5, words(t) * 0.35);
const fill = (t, vars) => t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** On-screen length of a sped-up live wait: about 3 s (12 s -> 2.5 s, 17 s -> 3.4 s, 30 s -> 3.5 s). */
const spedDuration = (real) => Math.min(real, Math.max(2.5, Math.min(3.5, real / 5)));

/* ---------------------------------------------------------------------------------------------
 * Banned customer-facing terms (same rules as the neutral-wording checks of the app)
 * "AI" is matched as an uppercase word (also inside codes such as AI_ERROR), so "Aisha", "maintain",
 * "said" and "[CLAIMANT]" are fine; everything else is case-insensitive.
 * -------------------------------------------------------------------------------------------*/
const BANNED_AI = /(?:^|[^A-Za-z])(?:AI|A\.I\.)(?![A-Za-z])/g;
const BANNED_CI =
  /artificial intelligence|claude|anthropic|\bLLMs?\b|language models?|\bGPT|machine learning|\bneural|\bprompts?\b|\bbots?\b|\bmodels?\b|\bopus\b|\bsonnet\b|\bhaiku\b|opus-\d|sonnet-\d/gi;
function bannedIn(text) {
  const hits = [];
  for (const re of [BANNED_AI, BANNED_CI]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) hits.push(text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, " "));
  }
  return hits;
}
const GUARD = { checks: 0, log: [], files: [] };
function scanOrThrow(label, text) {
  const hits = bannedIn(text);
  GUARD.files.push({ label, hits: hits.length });
  if (hits.length) throw new Error(`BANNED TERM in ${label}: ${JSON.stringify(Array.from(new Set(hits)).slice(0, 6))}`);
}
/** Every customer-facing string in captions.json (the "about" note is internal). */
function scanCaptionsJson() {
  const { about, ...rest } = CAP;
  void about;
  scanOrThrow("captions.json", JSON.stringify(rest));
}

/* ---------------------------------------------------------------------------------------------
 * Injected overlay: chapter bar (in a 36 px strip reserved at the top of the page), caption bar,
 * question card, cursor dot with click ripple. Runs in every document of the recording context.
 * -------------------------------------------------------------------------------------------*/
function overlayInit() {
  if (window.top !== window) return;
  if (location.protocol === "file:" && /\/cards\//.test(location.pathname)) return;
  const KEY = "__vid_state";
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null") || {};
    } catch {
      return {};
    }
  };
  const APP_CSS = [
    // Reserve a 36 px strip at the top for the chapter bar: push the page down and keep the Studio's
    // sticky header and the sticky side panels of the review and form-mapping screens below it.
    "body { padding-top: 36px !important; }",
    "header.sticky.top-0 { top: 36px !important; }",
    ".top-\\[4\\.25rem\\] { top: calc(4.25rem + 36px) !important; }",
    ".max-h-\\[calc\\(100vh-5\\.25rem\\)\\] { max-height: calc(100vh - 5.25rem - 36px) !important; }",
    ".h-\\[calc\\(100vh-5\\.25rem\\)\\] { height: calc(100vh - 5.25rem - 36px) !important; }",
    "@media (min-width: 1024px) { .lg\\:top-\\[96px\\] { top: 132px !important; } .lg\\:h-\\[calc\\(100vh-154px\\)\\] { height: calc(100vh - 190px) !important; } }",
    // Our scripted scrolling animates frame by frame; smooth-scroll CSS would fight it.
    "html { scroll-behavior: auto !important; }",
    // The Studio's toasts (bottom right) would sit half under the caption bar: lift them above it.
    'div[aria-live="polite"].fixed.inset-x-0.bottom-20 { bottom: 236px !important; }',
  ].join("\n");
  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .bar { position: fixed; left: 0; right: 0; top: 0; height: 36px; display: flex; align-items: center; gap: 12px;
      padding: 0 18px; background: #0f3d3a; color: #fff; font: 600 15px/1 var(--font-inter, Inter), "Inter Display", system-ui, sans-serif;
      letter-spacing: 0.005em; box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 2px 8px rgba(2,6,23,0.18); }
    .chip { display: inline-flex; align-items: center; height: 24px; padding: 0 11px; border-radius: 999px; background: #14b8a6;
      color: #042f2e; font-weight: 700; font-size: 14px; white-space: nowrap; }
    .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15.5px; }
    .right { margin-left: auto; font-weight: 500; font-size: 13px; color: rgba(255,255,255,0.72); white-space: nowrap; }
    .bar.empty .chip { display: none; }
    .cap { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 8px); max-width: 1180px; width: max-content;
      opacity: 0; transition: opacity 320ms ease, transform 320ms ease; }
    .cap.high { bottom: 104px; }
    .cap.wide, .cap.wide .capin { max-width: 1540px; }
    .cap.top { bottom: auto; top: 112px; }
    .cap.show { opacity: 1; transform: translate(-50%, 0); }
    .capin { background: rgba(15, 23, 42, 0.9); color: #fff; font: 500 23px/1.38 var(--font-inter, Inter), system-ui, sans-serif; letter-spacing: 0.002em;
      padding: 13px 26px 14px; border-radius: 14px; box-shadow: 0 10px 30px rgba(2,6,23,0.35); text-align: center;
      max-width: 1180px; text-wrap: balance; }
    .cap.answer .capin { background: rgba(4, 95, 80, 0.96); font-weight: 600; box-shadow: 0 0 0 2px rgba(94,234,212,0.55), 0 10px 30px rgba(2,6,23,0.35); }
    .cap.answer .capin::before { content: "\\2713"; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
      margin-right: 12px; border-radius: 50%; background: #5eead4; color: #064e3b; font-weight: 800; font-size: 17px; vertical-align: 2px; }
    .qw { position: fixed; inset: 36px 0 0 0; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.58);
      opacity: 0; transition: opacity 420ms ease; }
    .qw.show { opacity: 1; }
    .qc { width: 1120px; max-width: calc(100vw - 120px); background: #fff; border-radius: 24px; padding: 40px 56px 44px;
      box-shadow: 0 30px 80px rgba(2,6,23,0.45); transform: translateY(14px) scale(0.985); transition: transform 420ms ease; }
    .qw.show .qc { transform: none; }
    .qk { font: 700 15px/1 var(--font-inter, Inter), system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #0f766e; }
    .ql { font: 600 22px/1.2 var(--font-inter, Inter), system-ui, sans-serif; color: #475569; margin-top: 20px; }
    .qt { font: 600 36px/1.32 var(--font-inter, Inter), system-ui, sans-serif; color: #0f172a; margin-top: 12px; border-left: 6px solid #14b8a6;
      padding-left: 24px; letter-spacing: -0.01em; text-wrap: balance; }
    .qs { font: 500 16px/1.3 var(--font-inter, Inter), system-ui, sans-serif; color: #64748b; margin-top: 22px; }
    .cur { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(15, 23, 42, 0.28); border: 2.5px solid #fff; box-shadow: 0 0 0 1.5px rgba(15,23,42,0.55), 0 2px 6px rgba(2,6,23,0.35);
      transform: translate(-100px, -100px); transition: width 120ms, height 120ms, margin 120ms, background 120ms; }
    .cur.down { width: 18px; height: 18px; margin: -9px 0 0 -9px; background: rgba(13, 148, 136, 0.55); }
    .rip { position: fixed; left: 0; top: 0; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
      border: 3px solid #0d9488; opacity: 0.9; animation: rip 560ms ease-out forwards; }
    @keyframes rip { to { transform: var(--p) scale(3.6); opacity: 0; } }
    .hb { position: fixed; right: 0; bottom: 0; width: 2px; height: 2px; }
  `;
  let root = null;
  let cur = null;
  let pos = null;
  function build() {
    if (document.getElementById("__vid_host")) return;
    const host = document.createElement("div");
    host.id = "__vid_host";
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${SHADOW_CSS}</style>
      <div class="bar empty"><span class="chip"></span><span class="label"></span><span class="right">ClinForms · prepared for Blue Heart Clinics · fictional data</span></div>
      <div class="qw"><div class="qc"><div class="qk"></div><div class="ql"></div><div class="qt"></div><div class="qs">From your e-mail</div></div></div>
      <div class="cap"><div class="capin"></div></div><div class="cur"></div><div class="hb"></div>`;
    document.documentElement.appendChild(host);
    // Heartbeat: an imperceptible 2px change every 100 ms. The DevTools screencast drops a frame that is
    // painted while the previous one is still being acknowledged, so without a repaint afterwards the
    // last state of a transition could be missing from the recording.
    const hb = root.querySelector(".hb");
    let hbOn = false;
    setInterval(() => {
      hbOn = !hbOn;
      hb.style.background = hbOn ? "rgba(128,128,128,0.035)" : "rgba(128,128,128,0.02)";
    }, 100);
    const st = document.createElement("style");
    st.id = "__vid_css";
    st.textContent = APP_CSS;
    document.documentElement.appendChild(st);
    cur = root.querySelector(".cur");
    apply(read(), true);
  }
  function setCursor(x, y) {
    pos = { x, y };
    if (cur) cur.style.transform = `translate(${x}px, ${y}px)`;
  }
  function apply(s, instant) {
    if (!root) return;
    const bar = root.querySelector(".bar");
    if (s.chip) {
      bar.classList.remove("empty");
      root.querySelector(".chip").textContent = s.chip.n;
      root.querySelector(".label").textContent = s.chip.label;
    } else {
      bar.classList.add("empty");
      root.querySelector(".label").textContent = "";
    }
    const qw = root.querySelector(".qw");
    if (instant) qw.style.transition = "none";
    if (s.quote && s.quote.show) {
      root.querySelector(".qk").textContent = s.quote.kicker;
      root.querySelector(".ql").textContent = s.quote.lead;
      root.querySelector(".qt").textContent = s.quote.text;
      qw.classList.add("show");
    } else {
      qw.classList.remove("show");
    }
    const cap = root.querySelector(".cap");
    const inner = root.querySelector(".capin");
    if (instant) cap.style.transition = "none";
    if (s.caption && s.caption.show) {
      // A long caption gets a wider bar, so it never runs to a third line.
      const cls = `cap ${s.caption.pos || ""} ${s.caption.style || ""} ${s.caption.text.length > 180 ? "wide" : ""}`;
      if (inner.textContent !== s.caption.text && cap.classList.contains("show") && !instant) {
        // cross-fade text
        cap.classList.remove("show");
        setTimeout(() => {
          inner.textContent = s.caption.text;
          cap.className = cls;
          requestAnimationFrame(() => cap.classList.add("show"));
        }, 220);
      } else {
        inner.textContent = s.caption.text;
        cap.className = `${cls} show`;
      }
    } else {
      cap.classList.remove("show");
    }
    if (instant)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          cap.style.transition = "";
          qw.style.transition = "";
        }),
      );
    if (s.cursor && !pos) setCursor(s.cursor.x, s.cursor.y);
  }
  window.__vid = {
    apply: (s) => apply(s, false),
    applyInstant: (s) => apply(s, true),
    cursor: setCursor,
  };
  window.addEventListener("mousemove", (e) => setCursor(e.clientX, e.clientY), { capture: true, passive: true });
  window.addEventListener(
    "mousedown",
    (e) => {
      if (!root) return;
      cur && cur.classList.add("down");
      const r = document.createElement("div");
      r.className = "rip";
      r.style.setProperty("--p", `translate(${e.clientX}px, ${e.clientY}px)`);
      r.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      root.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    { capture: true, passive: true },
  );
  window.addEventListener("mouseup", () => cur && cur.classList.remove("down"), { capture: true, passive: true });
  if (document.documentElement) build();
  else document.addEventListener("readystatechange", build, { once: true });
}

/* ---------------------------------------------------------------------------------------------
 * Screencast capture + timeline
 * -------------------------------------------------------------------------------------------*/
class Cast {
  constructor(dir) {
    this.dir = dir;
    this.frames = [];
    this.n = 0;
    this.session = null;
    this.page = null;
    this.pending = 0;
  }
  async flush() {
    while (this.pending > 0) await sleep(20);
  }
  async attach(page) {
    await this.detach();
    await page.bringToFront();
    const s = await page.context().newCDPSession(page);
    s.on("Page.screencastFrame", (f) => {
      const recv = now();
      // Ack first: Chrome holds back the next frame until this one is acknowledged.
      s.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      const file = `f${String(this.n++).padStart(6, "0")}.jpg`;
      this.pending++;
      fs.writeFile(path.join(this.dir, file), Buffer.from(f.data, "base64"), (err) => {
        this.pending--;
        if (err) console.error("frame write failed", file, err.message);
      });
      this.frames.push({ file, ts: f.metadata.timestamp, recv });
    });
    await s.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
    this.session = s;
    this.page = page;
  }
  async detach() {
    if (!this.session) return;
    const s = this.session;
    this.session = null;
    await s.send("Page.stopScreencast").catch(() => {});
    await s.detach().catch(() => {});
  }
  /** Frame times on the Date.now() clock (metadata timestamps are smoother; convert with the median offset). */
  timedFrames() {
    const offs = this.frames.map((f) => f.recv - f.ts).sort((a, b) => a - b);
    const off = offs.length ? offs[Math.floor(offs.length / 2)] : 0;
    const ok = Math.abs(off) < 2; // same epoch clock
    return this.frames.map((f) => ({ file: f.file, t: ok ? f.ts + off : f.recv })).sort((a, b) => a.t - b.t);
  }
}

/** Visible text, accessible names, tooltips, placeholders, alt text and the title of a page. */
async function pageText(page) {
  return page.evaluate(() => {
    const out = [document.title, document.body ? document.body.innerText : ""];
    for (const el of document.querySelectorAll(
      "[aria-label],[title],[placeholder],[alt],[aria-description],[aria-valuetext],meta[name=description],meta[property],meta[name^='twitter']",
    )) {
      for (const a of ["aria-label", "title", "placeholder", "alt", "aria-description", "aria-valuetext", "content"]) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    return out.join("\n");
  });
}

/* ---------------------------------------------------------------------------------------------
 * Director: captions, question cards, chapters, cursor, cuts, sped-up live waits, banned-term guard
 * -------------------------------------------------------------------------------------------*/
class Director {
  constructor(cast, facts) {
    this.cast = cast;
    this.facts = facts;
    this.events = [];
    this.state = { chip: null, caption: null, quote: null };
    this.mouse = { x: VIEW.w / 2, y: VIEW.h / 2 };
    this.capMinEnd = 0;
    this.speeds = [];
    this.tooltipsClosed = [];
  }
  get page() {
    return this.cast.page;
  }
  ev(type, data = {}) {
    this.events.push({ type, t: now(), ...data });
  }
  async push(page = this.page) {
    const s = { ...this.state, cursor: this.mouse };
    await page
      .evaluate((st) => {
        try {
          localStorage.setItem("__vid_state", JSON.stringify(st));
        } catch {}
        if (window.__vid) window.__vid.apply(st);
      }, s)
      .catch(() => {});
  }
  async pushInstant(page = this.page) {
    const s = { ...this.state, cursor: this.mouse };
    await page
      .evaluate((st) => {
        try {
          localStorage.setItem("__vid_state", JSON.stringify(st));
        } catch {}
        if (window.__vid) {
          window.__vid.applyInstant(st);
          window.__vid.cursor(st.cursor.x, st.cursor.y);
        }
      }, s)
      .catch(() => {});
  }
  /** Abort the recording if a banned term is visible anywhere on the current page. */
  async guard(label) {
    const p = this.page;
    if (!p || p.isClosed()) return;
    const text = await pageText(p).catch(() => "");
    GUARD.checks++;
    const hits = bannedIn(text);
    GUARD.log.push({ label, url: p.url().replace(BASE, ""), hits: hits.length });
    if (hits.length) throw new Error(`BANNED TERM visible at "${label}" (${p.url()}): ${JSON.stringify(Array.from(new Set(hits)).slice(0, 6))}`);
  }
  /** Close any open tooltip (blur its trigger, move the cursor off it) so none stays over the content. */
  async clearTooltips(page = this.page) {
    if (!page || page.isClosed()) return;
    const open = () =>
      page
        .evaluate(() => {
          const t = document.querySelector("[role=tooltip]");
          const w = t && t.closest("[data-radix-popper-content-wrapper]");
          return w ? (w.innerText || "").slice(0, 80) : null;
        })
        .catch(() => null);
    let txt = await open();
    if (!txt) return;
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()).catch(() => {});
    await sleep(150);
    if (await open()) {
      await this.moveTo(VIEW.w - 36, VIEW.h - 70, 420);
      for (let i = 0; i < 8 && (await open()); i++) await sleep(100);
    }
    this.tooltipsClosed.push(txt);
    log("tooltip closed:", txt.replace(/\s+/g, " "));
  }
  async chapter(key) {
    const c = CAP.chapters[key];
    this.state.chip = { n: c.n, label: c.label };
    await this.push();
    this.ev("chapter", { key, n: c.n, label: c.label });
    log("chapter", key, c.label);
  }
  async waitCaption() {
    const left = this.capMinEnd - now();
    if (left > 0.6) await this.clearTooltips();
    const rest = this.capMinEnd - now();
    if (rest > 0) await sleep(rest * 1000);
  }
  async say(id, vars = {}, opts = {}) {
    await this.waitCaption();
    const c = CAP.captions[id];
    if (!c) throw new Error(`No caption ${id}`);
    const all = { ...this.facts, ...vars };
    const text = fill(c.text, all);
    const vo = fill(c.vo || c.text, all);
    if (/\{\w+\}/.test(text) || /\{\w+\}/.test(vo)) throw new Error(`Unfilled placeholder in ${id}: ${text} / ${vo}`);
    scanOrThrow(`caption ${id}`, `${text}\n${vo}`);
    await this.guard(`before caption ${id}`);
    await this.clearTooltips();
    this.state.caption = { text, pos: opts.pos || "", style: opts.style || "", show: true };
    await this.push();
    this.ev("cap", { id, text, vo, style: opts.style || "" });
    this.capMinEnd = now() + dwell(text) + 0.25 + (opts.extra || 0);
    log("say", id, "|", text);
  }
  /** The one-line plain answer that closes a chapter. */
  async answer(id, opts = {}) {
    await this.say(id, {}, { ...opts, style: "answer" });
    await this.waitCaption();
  }
  async hide() {
    await this.waitCaption();
    if (this.state.caption?.show) {
      this.state.caption = { ...this.state.caption, show: false };
      await this.push();
      this.ev("caphide");
    }
  }
  /** Dell's own question, as a card over the screen, at the start of a chapter. */
  async quote(key) {
    await this.hide();
    const q = CAP.quotes[key];
    await this.guard(`before question card ${key}`);
    await this.clearTooltips();
    this.state.quote = { kicker: q.kicker, lead: q.lead, text: q.text, show: true };
    await this.push();
    this.ev("quote", { id: key, text: `${q.kicker} – ${q.lead} ${q.text}`, vo: q.vo || `${q.lead} ${q.text}` });
    log("quote", key, "|", q.text);
    await sleep((Math.max(3.2, words(`${q.lead} ${q.text}`) * 0.3) + 0.35) * 1000);
    this.state.quote = { ...this.state.quote, show: false };
    await this.push();
    this.ev("quotehide", { id: key });
    await sleep(380);
  }
  async cut(fn) {
    const t0 = now();
    this.ev("cut", { edge: "start" });
    try {
      return await fn();
    } finally {
      this.ev("cut", { edge: "end" });
      this.capMinEnd += now() - t0;
    }
  }
  /** Await a slow wait that is not a live drafting or form-reading run; anything beyond `keep` seconds is cut (hard cut, never sped up). */
  async trim(promise, keep = 0.5) {
    const t0 = now();
    const res = await promise;
    const t1 = now();
    if (t1 - t0 > keep + 1.2) {
      this.events.push({ type: "cut", edge: "start", t: t0 + keep });
      this.events.push({ type: "cut", edge: "end", t: t1 });
      this.capMinEnd += t1 - (t0 + keep);
    }
    return res;
  }
  /** A live drafting / form-reading wait: recorded in full, sped up in post and labelled with its real time. */
  async speed(id, fn) {
    const t0 = now();
    this.ev("speed", { edge: "start", id });
    let ok = false;
    try {
      const res = await fn();
      ok = true;
      return res;
    } finally {
      const t1 = now();
      const real = t1 - t0;
      this.ev("speed", { edge: "end", id, real });
      this.capMinEnd += real - spedDuration(real);
      this.speeds.push({ id, real: Number(real.toFixed(2)), shownAs: Number(spedDuration(real).toFixed(2)), ok });
      log(`live wait ${id}: ${real.toFixed(1)} s (shown as ${spedDuration(real).toFixed(1)} s)`);
    }
  }
  /* ---- mouse ---- */
  async moveTo(x, y, ms = 560) {
    // Time-based: input round trips are slower while the screencast runs, so the number of
    // intermediate points adapts and the move always takes about `dur`.
    const p = this.page;
    const from = { ...this.mouse };
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist < 2) return;
    const dur = Math.min(ms, 200 + dist * 0.75);
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      await p.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (k >= 1) break;
      await sleep(8);
    }
    this.mouse = { x, y };
  }
  async reveal(loc, opts = {}) {
    await loc.waitFor({ state: "visible", timeout: opts.timeout ?? 20000 });
    await loc.evaluate(
      async (el, o) => {
        const topSafe = o.top ?? 130;
        const botSafe = o.bottom ?? 150;
        let sp = el.parentElement;
        while (sp && sp !== document.body && sp !== document.documentElement) {
          const cs = getComputedStyle(sp);
          if (/(auto|scroll)/.test(cs.overflowY) && sp.scrollHeight > sp.clientHeight + 2) break;
          sp = sp.parentElement;
        }
        const win = !sp || sp === document.body || sp === document.documentElement;
        const r = el.getBoundingClientRect();
        let lo = topSafe;
        let hi = innerHeight - botSafe;
        if (!win) {
          const pr = sp.getBoundingClientRect();
          lo = Math.max(pr.top + 12, o.inner ? pr.top + 12 : lo);
          hi = Math.min(pr.bottom - 12, innerHeight - (o.inner ? 12 : botSafe));
        }
        const fits = r.height <= hi - lo;
        if (!o.force && r.top >= lo && r.bottom <= hi) return;
        let delta;
        if (o.block === "start" || !fits) delta = r.top - lo;
        else delta = r.top + r.height / 2 - (lo + hi) / 2;
        const max = win ? document.documentElement.scrollHeight - innerHeight - scrollY : sp.scrollHeight - sp.clientHeight - sp.scrollTop;
        const min = win ? -scrollY : -sp.scrollTop;
        delta = Math.max(min, Math.min(max, delta));
        if (Math.abs(delta) < 2) return;
        const start = win ? scrollY : sp.scrollTop;
        const dur = o.ms ?? Math.min(1400, 350 + Math.abs(delta) * 0.55);
        await new Promise((res) => {
          const t0 = performance.now();
          const step = (t) => {
            const k = Math.min(1, (t - t0) / dur);
            const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            const y = start + delta * e;
            if (win) window.scrollTo(0, y);
            else sp.scrollTop = y;
            if (k < 1) requestAnimationFrame(step);
            else res();
          };
          requestAnimationFrame(step);
        });
      },
      { ...opts },
    );
    await sleep(120);
  }
  async scrollWin(delta, ms) {
    await this.page.evaluate(
      async ({ delta, ms }) => {
        const start = scrollY;
        const max = document.documentElement.scrollHeight - innerHeight;
        const end = Math.max(0, Math.min(max, start + delta));
        const d = end - start;
        const dur = ms ?? Math.min(1600, 400 + Math.abs(d) * 0.6);
        await new Promise((res) => {
          const t0 = performance.now();
          const step = (t) => {
            const k = Math.min(1, (t - t0) / dur);
            const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            window.scrollTo(0, start + d * e);
            if (k < 1) requestAnimationFrame(step);
            else res();
          };
          requestAnimationFrame(step);
        });
      },
      { delta, ms },
    );
  }
  async scrollTop(ms) {
    const y = await this.page.evaluate(() => scrollY);
    if (y > 0) await this.scrollWin(-y, ms);
  }
  async hover(loc, opts = {}) {
    if (!opts.noReveal) await this.reveal(loc, opts.revealMs ? { ...opts, ms: opts.revealMs } : opts);
    const b = await loc.boundingBox();
    if (!b) throw new Error("hover: no box");
    const x = b.x + b.width * (opts.dx ?? 0.5);
    const y = b.y + Math.min(b.height * (opts.dy ?? 0.5), opts.maxDy ?? 1e9);
    await this.moveTo(x, y, opts.ms ?? 650);
  }
  async click(loc, opts = {}) {
    await this.hover(loc, opts);
    await sleep(opts.pause ?? 130);
    await this.page.mouse.down();
    await sleep(80);
    await this.page.mouse.up();
    await sleep(opts.after ?? 280);
  }
  /**
   * Click a control that opens a new tab. Everything from the click until the new tab is on screen is a
   * hard cut: while the new tab starts, Chrome briefly shows a "Debugger paused in another tab" infobar
   * and dims the opener, which must never appear in the video. `ready(newPage)` loads and attaches it.
   */
  async clickNewTab(ctx, loc, ready) {
    const popupP = ctx.waitForEvent("page");
    await this.hover(loc);
    await sleep(130);
    const opener = this.page;
    await opener.mouse.down();
    await sleep(90);
    const t0 = now();
    this.ev("cut", { edge: "start" });
    try {
      await opener.mouse.up();
      const p = await popupP;
      await ready(p);
      return p;
    } finally {
      this.ev("cut", { edge: "end" });
      this.capMinEnd += now() - t0;
    }
  }
  async type(loc, text, opts = {}) {
    await this.click(loc, opts);
    if (opts.end) await this.page.keyboard.press("Control+End");
    await this.typeText(text, opts.cps ?? 14);
    await sleep(200);
  }
  /** Types at about `cps` characters a second (time-based, so slow input round trips don't stretch it). */
  async typeText(text, cps = 14) {
    const kb = this.page.keyboard;
    const t0 = Date.now();
    let i = 0;
    while (i < text.length) {
      const due = Math.min(text.length, Math.max(i + 1, Math.floor(((Date.now() - t0) / 1000) * cps) + 1));
      const chunk = text.slice(i, due);
      if (chunk.length === 1) await kb.type(chunk);
      else await kb.insertText(chunk);
      i = due;
      const next = t0 + (i / cps) * 1000 - Date.now();
      if (next > 0) await sleep(next);
    }
  }
}

/* ---------------------------------------------------------------------------------------------
 * Helpers for the app
 * -------------------------------------------------------------------------------------------*/
async function progressCounts(page) {
  const txt = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("div, section, aside"));
    let best = null;
    for (const el of els) {
      const t = el.innerText || "";
      if (/answered and clear/.test(t) && /From records/.test(t) && (!best || t.length < best.length)) best = t;
    }
    return best || "";
  });
  const num = (re) => {
    const m = txt.match(re);
    return m ? Number(m[1]) : 0;
  };
  const m = txt.match(/(\d+)\s+of\s+(\d+)\s+answered and clear/);
  const answered = m ? Number(m[1]) : 0;
  const total = m ? Number(m[2]) : 0;
  return {
    raw: txt.replace(/\s+/g, " "),
    answered,
    total,
    fromRecords: num(/From records\s+(\d+)/),
    drafted: num(/Drafted\s+(\d+)/),
    clinician: num(/Clinician\s+(\d+)/),
    needsInput: num(/Needs input\s+(\d+)/),
    blocked: num(/Blocked\s+(\d+)/),
    left: total - answered,
  };
}

/** The report as the Studio stores it (localStorage), for the honesty checks after a live draft. */
async function reportJson(app) {
  const id = decodeURIComponent(app.url().split("/reports/")[1].split("?")[0]);
  return app.evaluate((id) => JSON.parse(localStorage.getItem("medreport.report." + id) || "null"), id);
}

/**
 * Checks a live draft before it goes on screen: drafted live, every drafted paragraph cited, the opinion
 * questions left blank (gap) rather than guessed, and no blocking flag other than gaps / sign-off.
 */
async function checkDraft(app, label, opinionKeys) {
  const rep = await reportJson(app);
  if (!rep) throw new Error(`${label}: report not found in storage`);
  const modes = Array.from(new Set((rep.generation || []).map((g) => g.mode)));
  const problems = [];
  if (LIVE && modes.some((m) => m !== "live")) problems.push(`not all groups live: ${modes.join(",")}`);
  const ai = [];
  for (const s of rep.sections || []) for (const p of s.paragraphs || []) if (p.origin === "ai") ai.push({ key: s.key, p });
  const uncited = ai.filter((x) => !(x.p.sourceIds || []).length).map((x) => x.key);
  if (uncited.length) problems.push(`uncited paragraphs in ${uncited.join(",")}`);
  const warnings = [];
  for (const k of opinionKeys) {
    const soft = k.startsWith("~");
    const key = soft ? k.slice(1) : k;
    const s = (rep.sections || []).find((x) => x.key === key);
    const paras = s ? (s.paragraphs || []).filter((p) => p.text.trim()).length : 0;
    const v = s && s.answer ? s.answer.value : null;
    const answered = paras > 0 || (v !== null && v !== undefined && v !== "");
    if (answered) (soft ? warnings : problems).push(`${key} (${s.title}) was answered – expected blank for the clinician`);
  }
  const blocking = (rep.flags || []).filter((f) => f.severity === "blocking" && !["OPEN_GAP", "MISSING_PLACEHOLDER"].includes(f.code));
  if (blocking.length) problems.push(`blocking flags: ${blocking.map((f) => `${f.code}[${f.sectionKey}]`).join(", ")}`);
  const groups = (rep.generation || []).map((g) => ({ mode: g.mode, keys: (g.sectionKeys || []).join("+"), ms: g.durationMs }));
  log(`draft check ${label}:`, JSON.stringify({ modes, groups, aiParagraphs: ai.length, problems, warnings }));
  if (problems.length) throw new Error(`LIVE DRAFT CHECK FAILED (${label}): ${problems.join(" | ")} – re-run the recording`);
  return { modes, groups, aiParagraphs: ai.length, warnings };
}

async function waitDownload(d, page, loc, name) {
  const dl = page.waitForEvent("download", { timeout: 120000 });
  await d.click(loc);
  const download = await d.trim(dl, 0.6);
  const out = path.join(DIRS.downloads, name || download.suggestedFilename());
  await download.saveAs(out);
  log("downloaded", download.suggestedFilename(), "->", out);
  return { file: out, suggested: download.suggestedFilename() };
}

/** Clinician's answers and gap resolution on a review page (every card when `keys` is omitted). */
async function resolveAll(d, app, keys) {
  if (!keys) keys = await app.locator("article[id^='q-']").evaluateAll((els) => els.map((e) => e.id.slice(2)));
  for (const key of keys) {
    const card = app.locator(`[id="q-${key}"]`);
    if (!(await card.count())) continue;
    let guard = 0;
    while (guard++ < 6) {
      const removeIt = card.getByRole("button", { name: "Remove it" });
      if (await removeIt.count()) {
        await d.click(removeIt.first(), { ms: 200, after: 250 });
        continue;
      }
      const quick = card.getByRole("button", { name: "Mark resolved" });
      if ((await quick.count()) && !(await card.locator("form").count())) {
        await d.click(quick.first(), { ms: 300, after: 350 });
        continue;
      }
      const res = card.getByRole("button", { name: /^Resolve$/ });
      if (await res.count()) {
        await d.click(res.first(), { ms: 300, after: 300 });
        const ta = card.locator("form textarea").last();
        if (!(await ta.inputValue())) await ta.fill("Confirmed with the treating clinician: nothing further to add here.");
        await d.click(card.locator("form").getByRole("button", { name: "Mark resolved" }), { ms: 300, after: 350 });
        continue;
      }
      const ack = card.getByRole("button", { name: "Acknowledge with a reason" });
      if (await ack.count()) {
        await d.click(ack.first(), { ms: 300, after: 300 });
        await card.locator("form textarea").last().fill("Not recorded at discharge; the treating clinician has returned the form without it.");
        await d.click(card.locator("form").getByRole("button", { name: "Acknowledge" }), { ms: 300, after: 350 });
        continue;
      }
      break;
    }
  }
}

async function addOwn(d, app, key, text, { typed = false } = {}) {
  const card = app.locator(`[id="q-${key}"]`);
  const add = card.getByRole("button", { name: "Add a paragraph in your own words" });
  if (await add.count()) await d.click(add, { ms: 450, after: 250 });
  const ta = card.locator("textarea").last();
  if (typed) {
    await d.type(ta, text, { cps: 16 });
  } else {
    await d.click(ta, { ms: 400, after: 100 });
    await ta.fill(text);
    await sleep(350);
  }
  await d.click(card.locator("h3").first(), { ms: 380, after: 350 });
}

/**
 * The review page's preview, drawn: a tab that sat in the background (behind the viewer pages) may still
 * be drawing it, or show "Preview unavailable" from a draw that failed there. Called inside a cut.
 */
async function ensurePreviewDrawn(app) {
  const busy = () => app.evaluate(() => /Preview unavailable|Drawing the form…/.test(document.querySelector("main")?.innerText || ""));
  for (let i = 0; i < 40 && (await busy()); i++) await sleep(250);
  if (await busy()) {
    log("preview not drawn after returning to the tab: refreshing it (inside a cut)");
    await app.getByRole("button", { name: "Refresh the preview" }).first().click().catch(() => {});
    for (let i = 0; i < 60 && (await busy()); i++) await sleep(250);
  }
  if (await busy()) throw new Error("The review page's preview is still not drawn");
}

/** One click to confirm a gap the clinician has just answered ("Answered – confirm the gap"). */
async function markResolvedIfAsked(d, card) {
  const quick = card.getByRole("button", { name: "Mark resolved" });
  if ((await quick.count()) && !(await card.locator("form").count())) await d.click(quick.first(), { ms: 420, after: 300 });
}

async function itemsToResolve(app) {
  const t = await app.locator("main").innerText();
  const m = t.match(/(\d+) items? to resolve before approval/);
  return m ? Number(m[1]) : 0;
}

async function approve(d, app, { slow }) {
  await d.scrollTop(700);
  await d.click(app.getByRole("button", { name: /^Approve/ }).first());
  const dlg = app.getByRole("dialog");
  await dlg.waitFor();
  await sleep(350);
  const name = dlg.getByLabel("Full name", { exact: true });
  if (!(await name.inputValue())) await d.type(name, "Sarah Reid", { cps: 22 });
  const hcpc = dlg.getByLabel("HCPC registration number");
  if (!(await hcpc.inputValue())) await d.type(hcpc, "PH-DEMO-01", { cps: 22 });
  const sig = dlg.getByLabel(/Typed signature/);
  if (await sig.inputValue()) await sig.fill("");
  await d.type(sig, await name.inputValue(), { cps: slow ? 30 : 40, revealMs: 400 });
  const boxes = dlg.locator("input[type=checkbox]");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const b = boxes.nth(i);
    if (!(await b.isChecked())) await d.click(b, { ms: slow ? 240 : 200, after: slow ? 70 : 60, pause: 90, inner: true, bottom: 20, revealMs: 300 });
  }
  await sleep(slow ? 300 : 200);
  if (slow) await d.hide(); // the caption sits over the dialog's buttons
  await d.click(dlg.getByRole("button", { name: /Approve and sign/ }));
  await d.trim(app.locator("h2", { hasText: "Approved" }).first().waitFor({ timeout: 30000 }), 0.5);
  await sleep(400);
}

/* ---------------------------------------------------------------------------------------------
 * Final-PDF rendering (pdftoppm) + word boxes (pdftotext -bbox-layout) for the viewers
 * -------------------------------------------------------------------------------------------*/
function pdfWords(pdf) {
  const html = execFileSync("pdftotext", ["-bbox-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  const pages = [];
  const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const pm of html.split(/<page /).slice(1)) {
    const [, w, h] = pm.match(/width="([\d.]+)" height="([\d.]+)"/);
    const wordsArr = [];
    for (const m of pm.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g)) {
      wordsArr.push({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: dec(m[5]) });
    }
    pages.push({ w: +w, h: +h, words: wordsArr });
  }
  return pages;
}

const normTok = (s) => s.toLowerCase().replace(/[“”"’']/g, "");
const tokEq = (word, tok) => (tok instanceof RegExp ? tok.test(word.t) : normTok(word.t) === normTok(tok));
const seqAt = (ws, i, toks) => toks.every((t, k) => ws[i + k] && tokEq(ws[i + k], t));

function findBox(pages, spec) {
  for (let p = 0; p < pages.length; p++) {
    const ws = pages[p].words;
    let startAt = 0;
    if (spec.after) {
      const ai = ws.findIndex((_, i) => seqAt(ws, i, spec.after));
      if (ai < 0) continue;
      startAt = ai + spec.after.length;
    }
    for (let i = startAt; i < ws.length; i++) {
      if (!seqAt(ws, i, spec.from)) continue;
      let j = i + spec.from.length - 1;
      if (spec.to) {
        let k = i;
        while (k < ws.length && !seqAt(ws, k, spec.to)) k++;
        if (k >= ws.length) continue;
        j = k + spec.to.length - 1;
      }
      const sel = ws.slice(i, j + 1);
      const box = {
        page: p,
        x0: Math.min(...sel.map((w) => w.x0)),
        y0: Math.min(...sel.map((w) => w.y0)),
        x1: Math.max(...sel.map((w) => w.x1)),
        y1: Math.max(...sel.map((w) => w.y1)),
      };
      if (spec.x0 !== undefined) box.x0 = spec.x0;
      if (spec.x1 !== undefined) box.x1 = spec.x1;
      return box;
    }
  }
  return null;
}

/**
 * A whole question row/section: from the line that starts with `start` down to just above the line that
 * starts with `end` (same page), or to the last line above the footer. Spans the page's text width.
 */
function findBand(pages, spec) {
  for (let p = 0; p < pages.length; p++) {
    const pg = pages[p];
    const ws = pg.words;
    const i = ws.findIndex((_, k) => seqAt(ws, k, spec.start));
    if (i < 0) continue;
    const top = ws[i].y0;
    let bottom = null;
    if (spec.end) {
      const j = ws.findIndex((w, k) => k > i && w.y0 > top + 2 && seqAt(ws, k, spec.end));
      if (j >= 0) bottom = ws[j].y0 - (spec.endGap ?? 7);
    }
    if (bottom === null) {
      const below = ws.filter((w) => w.y0 > top && w.y1 < pg.h - (spec.footer ?? 70));
      bottom = Math.max(...below.map((w) => w.y1)) + 4;
    }
    const xs = ws.filter((w) => w.y1 < pg.h - 70);
    return {
      page: p,
      x0: spec.x0 ?? Math.min(...xs.map((w) => w.x0)) - 6,
      x1: spec.x1 ?? Math.max(...xs.map((w) => w.x1)) + 6,
      y0: top - (spec.topGap ?? 6),
      y1: bottom,
    };
  }
  return null;
}

function renderPdf(pdf, name) {
  const dir = path.join(DIRS.viewer, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("pdftoppm", ["-r", "170", "-png", pdf, path.join(dir, "p")]);
  const imgs = fs.readdirSync(dir).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
  return { dir, imgs, pages: pdfWords(pdf) };
}

const VIEWER_CSS = `
  html,body{margin:0;background:#334155;font-family:Inter,system-ui,sans-serif;scroll-behavior:auto}
  header{position:fixed;top:36px;left:0;right:0;height:56px;z-index:5;display:flex;align-items:center;gap:14px;padding:0 28px;background:#1e293b;color:#e2e8f0;font-size:15px;box-shadow:0 2px 10px rgba(0,0,0,.25)}
  header b{color:#fff;font-weight:600}
  header .tag{margin-left:auto;background:#0d9488;color:#fff;border-radius:999px;padding:5px 12px;font-weight:600;font-size:13px}
  .pg{position:relative;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.35)}
  .pg img{display:block;width:100%;height:auto}
  .hl{position:absolute;border:3px solid var(--c,#0d9488);border-radius:8px;background:color-mix(in srgb, var(--c,#0d9488) 10%, transparent);opacity:0;transform:scale(1.03);transition:opacity .45s ease, transform .45s ease;box-shadow:0 0 0 4px color-mix(in srgb, var(--c,#0d9488) 16%, transparent)}
  .hl.on{opacity:1;transform:none}
  .hl span{position:absolute;left:-3px;top:-31px;white-space:nowrap;background:var(--c,#0d9488);color:#fff;font:600 14px/1 Inter,system-ui,sans-serif;padding:7px 10px;border-radius:7px 7px 7px 0}
`;

function buildViewer(pdf, name, title, highlights) {
  const { dir, imgs, pages } = renderPdf(pdf, name);
  const W = 1040; // CSS px per page
  const boxes = [];
  for (const h of highlights) {
    const b = h.band ? findBand(pages, h.band) : findBox(pages, h);
    if (!b) {
      log(`viewer ${name}: highlight ${h.id} not found`);
      continue;
    }
    const s = W / pages[b.page].w;
    const pad = (h.pad ?? 5) * s;
    boxes.push({ id: h.id, page: b.page, label: h.label, left: b.x0 * s - pad, top: b.y0 * s - pad, width: (b.x1 - b.x0) * s + 2 * pad, height: (b.y1 - b.y0) * s + 2 * pad });
  }
  const pageH = (i) => (pages[i] ? (pages[i].h * W) / pages[i].w : W * 1.414);
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${VIEWER_CSS}
  main{padding:118px 0 220px;display:flex;flex-direction:column;align-items:center;gap:28px}
  .pg{width:${W}px}
  .num{position:absolute;right:-74px;top:8px;color:#cbd5e1;font-size:13px}
</style></head><body>
<header><b>${esc(title)}</b><span>${esc(path.basename(pdf))}</span><span class="tag">Final PDF – exactly as downloaded</span></header>
<main>
${imgs
  .map(
    (f, i) => `<div class="pg" id="page-${i}" style="height:${pageH(i).toFixed(1)}px"><img src="${f}" alt="Page ${i + 1}"><div class="num">${i + 1} / ${imgs.length}</div>
${boxes
  .filter((b) => b.page === i)
  .map((b) => `<div class="hl" id="hl-${b.id}" style="left:${b.left.toFixed(1)}px;top:${b.top.toFixed(1)}px;width:${b.width.toFixed(1)}px;height:${b.height.toFixed(1)}px"><span>${esc(b.label)}</span></div>`)
  .join("\n")}</div>`,
  )
  .join("\n")}
</main></body></html>`;
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  return { file, found: boxes.map((b) => b.id), pages: imgs.length };
}

/**
 * Dell's example, side by side: the same patient's completed Harrow & Pike (Word) and Northfield
 * (fillable PDF) forms, two columns of final pages, with the matching questions highlighted pair by pair.
 */
function buildSideBySide(left, right) {
  const dir = path.join(DIRS.viewer, "side-by-side");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const W = 700; // CSS px per page column
  const PAIRS = [
    { id: "prog", n: "1", label: "Prognosis", color: "#7c3aed", l: { start: ["B7.", "Prognosis"], end: ["B8."] }, r: { start: ["6.", "EXPECTED"], end: ["DECLARATION"], topGap: 9, endGap: 16 } },
    { id: "func", n: "2", label: "Functional restrictions", color: "#d97706", l: { start: ["B8.", "Functional"], end: ["B9."] }, r: { start: ["3.", "FUNCTIONAL"], end: ["4.", "IS"], topGap: 9, endGap: 16 } },
    { id: "treat", n: "3", label: "Treatment recommendations", color: "#0d9488", l: { start: ["B9.", "Treatment"], end: ["PART", "C"] }, r: { start: ["5.", "RECOMMENDED"], end: ["6.", "EXPECTED"], topGap: 9, endGap: 16 } },
  ];
  const col = (side, src, prefix) => {
    const imgs = src.imgs.map((f, i) => {
      const to = path.join(dir, `${prefix}-${f}`);
      fs.copyFileSync(path.join(src.dir, f), to);
      return { file: path.basename(to), i };
    });
    let y = 0;
    const tops = [];
    const parts = imgs.map(({ file, i }) => {
      const pg = src.pages[i];
      const h = pg ? (pg.h * W) / pg.w : W * 1.414;
      tops[i] = y;
      y += h + 22;
      return `<div class="pg" style="width:${W}px;height:${h.toFixed(1)}px"><img src="${file}" alt="Page ${i + 1}">__HL${i}__</div>`;
    });
    const boxes = [];
    for (const p of PAIRS) {
      const b = findBand(src.pages, p[side]);
      if (!b) {
        log(`side-by-side ${side}: ${p.id} not found`);
        continue;
      }
      const s = W / src.pages[b.page].w;
      const pad = 4 * s;
      boxes.push({ id: p.id, page: b.page, color: p.color, label: `${p.n} · ${p.label}`, left: b.x0 * s - pad, top: b.y0 * s - pad, width: (b.x1 - b.x0) * s + 2 * pad, height: (b.y1 - b.y0) * s + 2 * pad, abs: tops[b.page] + b.y0 * s });
    }
    let html = parts.join("\n");
    imgs.forEach(({ i }) => {
      html = html.replace(
        `__HL${i}__`,
        boxes
          .filter((b) => b.page === i)
          .map((b) => `<div class="hl" id="${side}-${b.id}" data-abs="${b.abs.toFixed(1)}" data-h="${b.height.toFixed(1)}" style="--c:${b.color};left:${b.left.toFixed(1)}px;top:${b.top.toFixed(1)}px;width:${b.width.toFixed(1)}px;height:${b.height.toFixed(1)}px"><span>${esc(b.label)}</span></div>`)
          .join(""),
      );
    });
    return { html, found: boxes.map((b) => b.id) };
  };
  const L = col("l", left, "hp");
  const R = col("r", right, "nf");
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Same notes, two referrers' forms</title>
<style>${VIEWER_CSS}
  body{overflow:hidden}
  .cols{position:fixed;top:92px;bottom:0;left:0;right:0;display:flex;justify-content:center;gap:36px;padding:0 40px}
  .col{width:${W + 24}px;display:flex;flex-direction:column}
  .ch{height:62px;display:flex;flex-direction:column;justify-content:center;color:#e2e8f0;font-size:14px;padding:0 4px}
  .ch b{color:#fff;font-size:17px;font-weight:650}
  .ch i{font-style:normal;color:#5eead4;font-weight:600}
  .vp{position:relative;flex:1;overflow:hidden;border-radius:10px}
  .stack{position:absolute;left:12px;top:0;display:flex;flex-direction:column;gap:22px;will-change:transform}
  .hl.dim{border-width:2px;box-shadow:none;background:color-mix(in srgb, var(--c,#0d9488) 5%, transparent)}
  .hl.dim span{opacity:0}
  .hl span{transition:opacity .3s ease}
</style></head><body>
<header><b>Same patient, same notes – two referrers' own forms</b><span>Final documents as downloaded</span><span class="tag">Matching questions highlighted</span></header>
<div class="cols">
  <div class="col"><div class="ch"><b>Harrow &amp; Pike Medico-Legal (fictional)</b><span>Treating Physiotherapist Report · <i>Word form</i></span></div><div class="vp"><div class="stack" id="l">${L.html}</div></div></div>
  <div class="col"><div class="ch"><b>Northfield Assurance (fictional)</b><span>Rehabilitation Progress Report · <i>fillable PDF</i></span></div><div class="vp"><div class="stack" id="r">${R.html}</div></div></div>
</div>
<script>
  const pos = { l: 0, r: 0 };
  function target(side, id) {
    const el = document.getElementById(side + "-" + id);
    const vp = document.getElementById(side).parentElement;
    if (!el) return pos[side];
    const abs = parseFloat(el.dataset.abs), h = parseFloat(el.dataset.h);
    const stackH = document.getElementById(side).scrollHeight;
    const want = abs + h / 2 - vp.clientHeight * 0.46;
    return Math.max(0, Math.min(stackH - vp.clientHeight, want));
  }
  window.focusPair = (id, ms) => new Promise((res) => {
    const from = { ...pos }, to = { l: target("l", id), r: target("r", id) };
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      for (const s of ["l", "r"]) { pos[s] = from[s] + (to[s] - from[s]) * e; document.getElementById(s).style.transform = "translateY(" + (-pos[s]) + "px)"; }
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  window.showPair = (id) => {
    document.querySelectorAll(".hl.on").forEach((e) => e.classList.add("dim"));
    for (const s of ["l", "r"]) { const e = document.getElementById(s + "-" + id); if (e) { e.classList.remove("dim"); e.classList.add("on"); } }
  };
</script>
</body></html>`;
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  return { file, found: { left: L.found, right: R.found }, pairs: PAIRS.map((p) => p.id) };
}

async function openViewer(d, ctx, viewer, park = { x: 120, y: 470 }) {
  return d.cut(async () => {
    const vp = await ctx.newPage();
    await vp.goto("file://" + viewer.file);
    await vp.waitForLoadState("load");
    await sleep(400);
    await d.cast.attach(vp);
    // Start the cursor off the document (page margin or header), not where it was in the app.
    await vp.mouse.move(park.x, park.y);
    d.mouse = { ...park };
    await d.pushInstant(vp);
    await sleep(500);
    return vp;
  });
}
async function showHl(vp, d, id, opts = {}) {
  const el = vp.locator(`#hl-${id}`);
  if (!(await el.count())) {
    log("missing highlight", id);
    return;
  }
  await d.reveal(el, { top: 170, bottom: 190, ms: opts.ms ?? 1100, force: opts.force });
  await vp.evaluate((id) => document.getElementById("hl-" + id)?.classList.add("on"), id);
  await sleep(250);
  // Point at the highlight from outside the page, level with its first line: never over the document's text.
  const b = await el.boundingBox();
  const pageLeft = await el.evaluate((e) => e.closest(".pg").getBoundingClientRect().left);
  if (b) await d.moveTo(Math.max(20, pageLeft - 30), b.y + Math.min(b.height / 2, 28), 700);
}

/* ---------------------------------------------------------------------------------------------
 * The recording
 * -------------------------------------------------------------------------------------------*/
async function record(facts) {
  for (const k of ["frames", "input", "downloads", "viewer"]) {
    fs.rmSync(DIRS[k], { recursive: true, force: true });
    fs.mkdirSync(DIRS[k], { recursive: true });
  }
  // The referrer's new form, exactly as the app ships it (bundled fictional sample).
  const meridianName = "Meridian-Claims_Physiotherapy-Discharge-Report_MCS-PDR-3.docx";
  const res = await fetch(`${BASE}/api/reports/v1/forms/samples/meridian-discharge-report/file`);
  if (!res.ok) throw new Error(`Could not fetch the Meridian sample form: ${res.status}`);
  const meridianPath = path.join(DIRS.input, meridianName);
  fs.writeFileSync(meridianPath, Buffer.from(await res.arrayBuffer()));

  const health = await (await fetch(`${BASE}/api/reports/v1/health`)).json();
  if (LIVE && !health.liveAiAvailable) throw new Error(`Live drafting is not available on this server (aiMode ${health.aiMode}). Start it with MEDREPORT_AI_MODE=auto, or record --demo.`);
  if (!LIVE && health.aiMode !== "demo") throw new Error(`--demo needs the server in MEDREPORT_AI_MODE=demo (got ${health.aiMode}).`);

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.w},${VIEW.h + 87}`, "--hide-scrollbars"],
  });
  const ctx = await browser.newContext({ viewport: null, acceptDownloads: true, locale: "en-GB", timezoneId: "Europe/London" });
  await ctx.addInitScript(overlayInit);
  if (LIVE) {
    // Live drafting: the passcode goes straight into this tab session's storage, as the mode dialog would
    // store it. The dialog is never opened, so the passcode is never on screen.
    await ctx.addInitScript((p) => {
      try {
        if (!sessionStorage.getItem("medreport.passcode")) sessionStorage.setItem("medreport.passcode", p);
      } catch {}
    }, livePasscode());
  }
  const problems = [];
  const watch = (p) => {
    p.on("pageerror", (e) => problems.push(`[pageerror] ${p.url()} :: ${String(e).slice(0, 300)}`));
    p.on("console", (m) => {
      if (m.type() === "error") problems.push(`[console] ${p.url()} :: ${m.text().slice(0, 300)}`);
    });
  };
  ctx.on("page", watch);
  const page = await ctx.newPage();
  const size = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  log("viewport", size, "mode", LIVE ? "LIVE" : "demo");

  // ---- Reset the demo (fresh context + the app's own Demo tools > Reset demo), then warm up.
  await page.goto(`${BASE}/reports`);
  await page.waitForLoadState("networkidle");
  await page.locator("summary", { hasText: "Demo tools" }).click();
  await page.getByRole("button", { name: "Reset demo" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset demo" }).click();
  await sleep(1200);
  await page.goto(`${BASE}/reports`);
  await page.waitForLoadState("networkidle");
  const badge = await page.getByRole("button", { name: /^Drafting mode:/ }).getAttribute("aria-label");
  log("mode badge:", badge);
  if (LIVE && !/Live drafting/.test(badge || "")) throw new Error(`Expected the Studio in live drafting, badge says: ${badge}`);
  await page.goto(`${BASE}/pms-sandbox/patients/sim-pat-001`);
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}/reports/forms`);
  await page.waitForLoadState("networkidle");
  await page.getByText(/3 confirmed/).first().waitFor({ timeout: 20000 });

  const cast = new Cast(DIRS.frames);
  const d = new Director(cast, facts);
  const vars = {};
  const checks = {};
  await cast.attach(page);
  await d.pushInstant(page);

  /* ======================= Segment A ======================= */
  d.ev("seg", { name: "A", edge: "start" });

  // ---------- Question 1: each referrer's own form ----------
  await d.cut(async () => {
    await d.chapter("q1");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator("main canvas").first().waitFor({ timeout: 20000 });
    await page.locator("main section.docx").first().waitFor({ timeout: 20000 });
    await sleep(2500);
    await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll("h2")).find((x) => /Forms library/.test(x.textContent || ""));
      if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 92);
    });
    await sleep(600);
    await d.pushInstant(page);
    await d.moveTo(800, 330, 10);
    await sleep(300);
  });
  await d.quote("q1");
  await d.say("q1.library");
  const lib = page.locator("main");
  for (const t of ["Treating Physiotherapist Report", "Rehabilitation Progress Report", "Return to Work Assessment"]) {
    const h = lib.getByText(t, { exact: true }).first();
    const b = await h.boundingBox();
    if (b) await d.moveTo(b.x + b.width / 2, b.y - 120, 800);
    await sleep(1300);
  }
  await d.hover(lib.getByText("Fillable PDF").first(), { ms: 700 });
  await d.waitCaption();
  await d.scrollTop(700);

  await d.say("q1.upload");
  await d.click(page.getByRole("button", { name: "Upload a referrer form" }).first());
  const dlg = page.getByRole("dialog");
  await dlg.waitFor();
  await sleep(400);
  const chooserP = page.waitForEvent("filechooser");
  await d.click(dlg.locator(".border-dashed button").first());
  const chooser = await chooserP;
  await chooser.setFiles(meridianPath);
  await dlg.getByRole("button", { name: /^Analyse form$/ }).waitFor({ timeout: 15000 });
  await sleep(500);
  // The referrer's full name is in the form's page header, which the reading step does not use: staff type it.
  const refInput = dlg.locator("#upload-referrer");
  if (await refInput.count()) await d.type(refInput, "Meridian Claims Services (fictional)", { cps: 26 });
  // Meridian is an insurer's claims service (as the forms library labels it), not a medico-legal company.
  const refType = dlg.locator("#upload-referrer-type");
  if (await refType.count()) {
    await d.hover(refType, { ms: 500 });
    await refType.selectOption({ label: "Insurer" });
    await sleep(350);
  }
  await d.waitCaption();
  await d.say("q1.reading");
  await d.speed("form-reading", async () => {
    await d.click(dlg.getByRole("button", { name: /^Analyse form$/ }));
    await d.hover(dlg.getByText(/Reading the form layout/).first(), { ms: 600, noReveal: true, dx: 0.35 }).catch(() => {});
    await page.waitForFunction(() => /Review the mapping|could not be analysed|Try again/.test(document.querySelector("[role=dialog]")?.textContent || ""), null, {
      timeout: 180000,
    });
  });
  await sleep(250);
  const dlgText = (await dlg.innerText()).replace(/\s+/g, " ");
  if (!/Review the mapping/.test(dlgText)) throw new Error("Form reading failed: " + dlgText.slice(0, 400));
  if (LIVE && (!/Read from the form \(live\)/.test(dlgText) || /could not finish|layout rules/i.test(dlgText)))
    throw new Error("Expected a live form reading: " + dlgText.slice(0, 500));
  if (!LIVE && !/Prepared demo reading/.test(dlgText)) throw new Error("Expected the prepared demo reading label: " + dlgText.slice(0, 300));
  vars.questions = Number((dlgText.match(/(\d+) questions found/) || [])[1]);
  vars.toCheck = Number((dlgText.match(/(\d+) questions? to check/) || [0, 0])[1]);
  vars.toCheckPhrase = vars.toCheck ? `${vars.toCheck} flagged` : "none flagged";
  checks.formReading = { live: LIVE, questions: vars.questions, toCheck: vars.toCheck };
  await d.say("q1.analysed", vars);
  // Point just right of the summary line and of the list heading, not over their text.
  await d.hover(dlg.getByText(/questions found in/).first(), { ms: 700, dx: 0.985 });
  await sleep(900);
  const things = dlg.getByText("Things to check");
  if (await things.count()) await d.hover(things.first(), { ms: 700, dx: 0.97, dy: 0.08 });
  await d.waitCaption();
  await d.click(dlg.getByRole("button", { name: /Review the mapping/ }));
  await d.trim(page.waitForURL(/\/reports\/forms\/.+/), 0.4);
  await d.trim(page.locator(".mr-preview section.docx").first().waitFor({ timeout: 30000 }), 0.4);
  await sleep(500);

  await d.say("q1.mapping", {}, { pos: "high" });
  await d.reveal(page.locator("main button").filter({ hasText: /full name/i }).first(), { block: "start", top: 300, force: true, ms: 1200 }).catch(() => {});
  for (const re of [/^From TM3 registration$/, /^Drafted from notes$/]) {
    const chip = page.locator("main span, main div").filter({ hasText: re }).first();
    if (await chip.count()) {
      await d.hover(chip, { ms: 500, top: 140, bottom: 220 }).catch(() => {});
      await sleep(300);
    }
  }
  let opinionQ = page.getByRole("button", { name: /likely long-term outcome/i }).first();
  if (!(await opinionQ.count())) opinionQ = page.locator("main button").filter({ hasText: /opinion/i }).first();
  await d.click(opinionQ, { top: 140, bottom: 220 });
  await sleep(350);
  const hl = page.locator(".mr-preview .mr-hl").first();
  if (await hl.count()) await d.hover(hl, { noReveal: true, ms: 800, dx: 0.3 });
  await sleep(800);
  await d.hover(page.getByRole("button", { name: "Clinician opinion" }).first(), { ms: 700 }).catch(() => {});
  await d.waitCaption();

  await d.say("q1.confirm", {}, { pos: "top" });
  await d.click(page.getByRole("button", { name: /^Confirm mapping$/ }).first());
  await page.locator("#confirm-by").waitFor();
  await sleep(300);
  const by = page.locator("#confirm-by");
  if (await by.inputValue()) await by.fill("");
  await d.type(by, "Sarah Reid", { cps: 20 });
  await d.click(page.locator("[role=dialog] input[type=checkbox], [role=dialog] button[role=checkbox]").first());
  await sleep(250);
  await d.click(page.locator("[role=dialog]").getByRole("button", { name: /Confirm mapping/ }));
  await page.getByText(/Mapping confirmed by Sarah Reid/).first().waitFor({ timeout: 10000 });
  await sleep(300);
  await d.hover(page.getByText(/Mapping confirmed by Sarah Reid/).first(), { ms: 600 });
  await d.waitCaption();
  await d.answer("q1.answer");
  await d.hide();

  // ---------- Question 3: TM3 data, no retyping ----------
  await d.cut(async () => {
    await d.chapter("q3");
    await page.goto(`${BASE}/pms-sandbox`);
    await page.waitForLoadState("networkidle");
    await sleep(600);
    await d.pushInstant(page);
  });
  await d.quote("q3");
  await d.say("q3.sandbox");
  await d.hover(page.getByText("Simulated TM3 sandbox – demo data, not affiliated with TM3").first(), { ms: 700, dx: 0.3 });
  await sleep(1600);
  await d.hover(page.getByText("Hart, Megan").first(), { ms: 700 });
  await sleep(500);
  await d.click(page.getByText("Hart, Megan").first());
  await d.trim(page.waitForURL(/\/pms-sandbox\/patients\/sim-pat-001/), 0.3);
  await d.trim(page.getByRole("button", { name: /Complete referrer's report form/ }).waitFor({ timeout: 20000 }), 0.3);
  await sleep(400);
  const tabTxt = (await page.locator("[role=tablist]").first().innerText()).replace(/\s+/g, " ");
  vars.appts = Number((tabTxt.match(/Appointments\s+(\d+)/) || [])[1]);
  vars.notes = Number((tabTxt.match(/Clinical notes\s+(\d+)/) || [])[1]);
  await d.waitCaption();
  await d.say("q3.record", { appts: vars.appts, notes: vars.notes });
  await d.click(page.getByRole("tab", { name: /Clinical notes/ }));
  await sleep(600);
  await d.scrollWin(300, 1000);
  await sleep(700);
  await d.scrollTop(700);
  await d.hover(page.getByText("Connected apps").first(), { ms: 600 });
  await d.waitCaption();
  const app = await d.clickNewTab(ctx, page.getByRole("button", { name: /Complete referrer's report form/ }), async (p) => {
    await p.waitForLoadState("domcontentloaded");
    await p.getByText(/Imported from Simulated TM3/).first().waitFor({ timeout: 30000 });
    await sleep(900);
    await cast.attach(p);
    await d.pushInstant(p);
    await sleep(300);
  });
  const banner = (await app.getByText(/Imported from Simulated TM3/).first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  const bm = banner.match(/(\d+) notes · (\d+) appointments · (\d+) scores/);
  if (!bm) throw new Error("Import banner not parsed: " + banner);
  vars.importNotes = Number(bm[1]);
  vars.importAppts = Number(bm[2]);
  vars.scores = Number(bm[3]);
  await d.say("q3.imported", { notes: vars.importNotes, appts: vars.importAppts, scores: vars.scores });
  await d.hover(app.getByText(/Imported from Simulated TM3/).first(), { ms: 700, dx: 0.3 });
  await sleep(1100);
  await d.reveal(app.getByText("Calculated by code from the record").first(), { block: "start", top: 140, force: true, ms: 1100 });
  await d.hover(app.getByText(/appointments attended/).first(), { ms: 600 }).catch(() => {});
  await sleep(900);
  await d.reveal(app.getByText("Integration log").first(), { block: "start", top: 300, force: true, ms: 1100 });
  await d.hover(app.getByText(/\/api\/tm3-sim\/v1\/episodes\/sim-ep-1001\/notes/).first(), { ms: 700 });
  await d.waitCaption();
  await d.answer("q3.answer", { pos: "high" });
  await d.hide();

  // ---------- Question 2: the referrer's own layout ----------
  await d.chapter("q2");
  await d.scrollTop(600);
  await d.quote("q2");
  await d.say("q2.choose", {}, { pos: "high" });
  await d.click(app.getByRole("button", { name: "Choose the referrer form" }));
  await sleep(500);
  await d.hover(app.getByText(/Matches the referrer on the referral/).first(), { ms: 700 }).catch(() => {});
  await sleep(800);
  await d.click(app.getByRole("radio", { name: /Harrow & Pike/ }), { dy: 0.3 });
  await d.waitCaption();
  await d.say("q2.drafting");
  await d.speed("harrow-pike-draft", async () => {
    await d.click(app.getByRole("button", { name: "Complete this form" }));
    await app.waitForFunction(() => /\/reports\/(?!new)[^/?]+$/.test(location.pathname) || /could not be drafted/.test(document.body.innerText), null, { timeout: 240000 });
    if (/\/reports\/new/.test(app.url())) throw new Error("Harrow & Pike drafting failed: " + (await app.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600));
    await app.locator("#q-F-07").waitFor({ timeout: 20000 });
  });
  await d.pushInstant(app);
  await sleep(700);
  const hpReportUrl = app.url();
  checks.harrowPike = await checkDraft(app, "Harrow & Pike", ["~F-13", "F-14"]);
  const hpHeader = (await app.locator("main").innerText()).slice(0, 600);
  if (LIVE && !/Drafted from the notes/.test(hpHeader)) throw new Error("Expected the live draft label on the review screen");
  const c1 = await progressCounts(app);
  log("progress after draft", c1.raw);
  // The red "Blocked" count needs a word of explanation for a non-technical viewer, when there is one.
  const blockedNote = c1.blocked ? " – red “Blocked” marks a check to clear before approval" : " to answer or check";
  await d.say("q2.review", { ...c1, blockedNote });
  await d.hover(app.getByText(/answered and clear/).first(), { ms: 700 });
  await sleep(1000);
  await d.hover(app.locator("#q-F-01").getByText("Filled from records").first(), { ms: 600 }).catch(() => {});
  await sleep(500);
  await d.click(app.getByRole("tab", { name: "Preview" }));
  await d.trim(app.locator("[role=tabpanel][data-state=active] section.docx").first().waitFor({ timeout: 30000 }), 0.5);
  await d.waitCaption();
  await d.click(app.getByRole("button", { name: "Open a larger preview" }));
  const pv = app.getByRole("dialog");
  await pv.locator("section.docx").first().waitFor({ timeout: 30000 });
  await sleep(600);
  await d.say("q2.preview");
  await d.hover(pv.getByText(/DRAFT/).first(), { ms: 800, noReveal: true }).catch(() => {});
  await sleep(1300);
  await d.hover(pv.getByText("Claimant name", { exact: true }).first(), { inner: true, ms: 800, dx: 1.4 }).catch(() => {});
  await sleep(1100);
  await d.reveal(pv.getByText(/Mechanism of injury/).first(), { inner: true, block: "start", force: true, ms: 1500 }).catch(() => {});
  await d.hover(pv.getByText(/Mechanism of injury/).first(), { noReveal: true, ms: 700, dx: 2.5 }).catch(() => {});
  await d.waitCaption();
  await d.answer("q2.answer");
  await d.click(pv.getByRole("button", { name: "Close" }).first()).catch(async () => app.keyboard.press("Escape"));
  await sleep(350);
  await d.hide();

  // ---------- Question 4: clinician review, amendment & approval ----------
  await d.chapter("q4");
  const f12 = app.locator("#q-F-12");
  await d.reveal(f12, { block: "start", top: 120, force: true, ms: 1100 });
  await d.quote("q4");
  await d.say("q4.cite");
  const cite = f12.locator("button[aria-label^='Source N-']").first();
  const citeLabel = (await cite.getAttribute("aria-label")) || "";
  const citeId = (citeLabel.match(/Source (N-\d+)/) || [])[1];
  await d.click(cite, { top: 120, bottom: 200 });
  await sleep(700);
  if (citeId) await d.hover(app.locator(`article[data-source-id="${citeId}"]`).first(), { ms: 800, noReveal: true, dy: 0.15 }).catch(() => {});
  await d.waitCaption();
  await d.say("q4.edit");
  const ta = f12.locator("textarea").first();
  await d.click(ta, { dx: 0.9, dy: 0.85 });
  await app.keyboard.press("Control+End");
  await d.typeText(" She will make a full recovery by March 2027.", 17);
  await sleep(200);
  await d.click(f12.locator("h3").first(), { ms: 450 });
  await sleep(900);
  await d.say("q4.flags");
  const flagBox = f12.getByText("Date or figure not in the cited source").first();
  const opinionFlag = f12.getByText("Opinion language not in the cited note").first();
  checks.amendFlags = { dateFlag: await flagBox.count(), opinionFlag: await opinionFlag.count() };
  if (!checks.amendFlags.dateFlag && !checks.amendFlags.opinionFlag) throw new Error("The unsupported edit raised no flag");
  if (checks.amendFlags.dateFlag) {
    await d.reveal(flagBox, { top: 220, bottom: 260, ms: 800 });
    await d.hover(flagBox, { noReveal: true, ms: 600 });
    await sleep(1300);
  }
  if (checks.amendFlags.opinionFlag) await d.hover(opinionFlag, { ms: 600, top: 220, bottom: 260 });
  await d.waitCaption();
  await d.say("q4.undo");
  await d.click(f12.getByRole("button", { name: "Revert to the draft" }), { top: 140 });
  await sleep(700);
  await d.waitCaption();

  const f14 = app.locator("#q-F-14");
  await d.reveal(f14, { block: "start", top: 120, force: true, ms: 1200 });
  await d.say("q4.prognosis");
  await d.hover(f14.getByText("Needs clinician input").first(), { ms: 700 });
  await sleep(1300);
  await d.hover(f14.getByText(/Gap – not in the record/).first(), { ms: 700 }).catch(() => {});
  await sleep(600);
  const prognosis =
    "In my opinion Ms Hart has made a good recovery. I expect the remaining intermittent neck ache to settle over the next three to six months with her home exercise programme.";
  {
    const add = f14.getByRole("button", { name: "Add a paragraph in your own words" });
    if (await add.count()) await d.click(add);
    await d.type(f14.locator("textarea").last(), prognosis, { cps: 42 });
    await d.click(f14.locator("h3").first(), { ms: 450 });
  }
  await sleep(400);
  await d.waitCaption();
  await d.say("q4.rest");
  await d.reveal(app.locator("#q-F-13"), { block: "start", top: 120, force: true, ms: 1000 });
  await d.click(app.locator("#q-F-13").getByLabel("Yes", { exact: true }), { ms: 550 });
  await sleep(300);
  await addOwn(
    d,
    app,
    "F-15",
    "In my opinion Ms Hart has no restrictions on work, domestic or leisure activities. She should continue to take regular breaks from prolonged sitting at the computer and from drives over 1 hour.",
  );
  // The rest of her answers and resolutions are the same kind of clicks: hard cut, not sped up.
  await d.cut(async () => {
    await addOwn(
      d,
      app,
      "F-16",
      "In my opinion no further physiotherapy is needed. She should continue her maintenance home exercise programme and return to the clinic or her GP if her symptoms increase.",
    );
    await resolveAll(d, app);
    const voice = app.getByRole("button", { name: "Write in my own voice" });
    if (await voice.count()) {
      await d.scrollTop(200);
      await d.click(voice, { ms: 200 });
      await sleep(900);
    }
    const left = await itemsToResolve(app);
    if (left) {
      await resolveAll(d, app);
      const left2 = await itemsToResolve(app);
      if (left2) throw new Error(`Harrow & Pike: ${left2} items still to resolve before approval`);
    }
    await d.scrollTop(200);
    await d.click(app.getByRole("tab", { name: "Activity" }), { ms: 200 });
    await sleep(900);
    await d.pushInstant(app);
  });
  await d.hover(app.locator("[role=tabpanel][data-state=active]").first(), { ms: 700, dy: 0.25, noReveal: true }).catch(() => {});
  await d.waitCaption();
  const c2 = await progressCounts(app);
  log("progress after clinician", c2.raw);
  await d.say("q4.approve", c2);
  await d.hover(app.getByText(/answered and clear/).first(), { ms: 700 });
  await sleep(900);
  await approve(d, app, { slow: true });
  await d.say("q4.approved");
  await d.hover(app.getByText(/Approved – the completed form is final/).first(), { ms: 700 }).catch(() => {});
  await sleep(400);
  const hpWord = await waitDownload(d, app, app.getByRole("button", { name: "Completed form (Word)" }), "megan-hart_harrow-pike_FINAL.docx");
  const hpPdf = await waitDownload(d, app, app.getByRole("button", { name: "Completed form (PDF)" }), "megan-hart_harrow-pike_FINAL.pdf");
  await d.click(app.getByRole("button", { name: /Save to clinic record/ }));
  await d.trim(app.getByText(/Filed to the Simulated TM3 record/).first().waitFor({ timeout: 30000 }), 0.4);
  await sleep(700);
  await d.hide();

  // Final PDF, full screen.
  const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
  const hpViewer = await d.cut(async () =>
    buildViewer(hpPdf.file, "harrow-pike", "Harrow & Pike Medico-Legal (fictional) – Treating Physiotherapist Report", [
      { id: "reg", from: ["Claimant", "name"], to: ["07/07/2026"], label: "From the TM3 registration – filled by code", x1: 445 },
      { id: "b2", band: { start: ["B2."], end: ["B3."] }, label: "Drafted from the physiotherapy notes", pad: 2 },
      { id: "tick", from: ["☒", "Yes"], to: ["No"], label: "Tick box set", pad: 6 },
      { id: "prog", from: ["In", "my", "opinion", "Ms", "Hart", "has", "made"], to: ["programme."], label: "The clinician's own opinion", pad: 6 },
      { id: "sign", from: ["Name", "Sarah", "Reid"], to: ["Date", DATE_RE], label: "Completed from the approval", x1: 445, pad: 7 },
    ]),
  );
  log("viewer HP", JSON.stringify(hpViewer));
  const vp = await openViewer(d, ctx, hpViewer);
  await d.say("q4.final1", {}, { extra: 0.6 });
  await showHl(vp, d, "reg");
  await sleep(900);
  await showHl(vp, d, "b2", { ms: 1300 });
  await sleep(700);
  await showHl(vp, d, "prog", { ms: 1300 });
  await sleep(800);
  await showHl(vp, d, "sign", { ms: 1100 });
  await d.waitCaption();
  await d.answer("q4.answer");
  await d.hide();

  // ---------- Question 1 again: same notes, different form ----------
  const sandbox = page;
  await d.cut(async () => {
    await vp.close();
    await app.close();
    await d.chapter("q1b");
    await cast.attach(sandbox);
    await sandbox.reload();
    await sandbox.waitForLoadState("networkidle");
    await sleep(600);
    await d.pushInstant(sandbox);
  });
  await d.quote("q1b");
  await d.say("q1b.intro");
  const app2 = await d.clickNewTab(ctx, sandbox.getByRole("button", { name: /Complete referrer's report form/ }), async (p) => {
    await p.waitForLoadState("domcontentloaded");
    await p.getByText(/Imported from Simulated TM3/).first().waitFor({ timeout: 30000 });
    await sleep(700);
    await cast.attach(p);
    await d.pushInstant(p);
  });
  await d.click(app2.getByRole("button", { name: "Choose the referrer form" }));
  await sleep(500);
  await d.click(app2.getByRole("radio", { name: /Northfield Assurance/ }), { dy: 0.3 });
  await sleep(400);
  await d.waitCaption();
  await d.say("q1b.drafting");
  await d.speed("northfield-draft", async () => {
    await d.click(app2.getByRole("button", { name: "Complete this form" }));
    await app2.waitForFunction(() => /\/reports\/(?!new)[^/?]+$/.test(location.pathname) || /could not be drafted/.test(document.body.innerText), null, { timeout: 300000 });
    if (/\/reports\/new/.test(app2.url())) throw new Error("Northfield drafting failed: " + (await app2.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600));
    await app2.locator("[id^='q-F-']").first().waitFor({ timeout: 20000 });
  });
  await d.pushInstant(app2);
  await sleep(600);
  checks.northfield = await checkDraft(app2, "Northfield", ["~F-13", "F-17"]);
  const c3 = await progressCounts(app2);
  log("northfield progress", c3.raw);
  await d.say("q1b.drafted", c3);
  await d.hover(app2.getByText(/answered and clear/).first(), { ms: 700 });
  await sleep(1000);
  // Her opinions, Northfield's claim number and the checks work exactly as shown for Harrow & Pike: hard
  // cut (the caption says so). The two questions that don't apply are then answered on screen, so the form
  // is approved with nothing left open.
  const NOT_APPLICABLE = ["F-14", "F-16"];
  await d.cut(async () => {
    await addOwn(d, app2, "F-01", "NA-PI-77310");
    await addOwn(
      d,
      app2,
      "F-12",
      "In my opinion Ms Hart has no functional limitations affecting work or daily activities. She should continue to take regular breaks from prolonged sitting and driving.",
    );
    await d.click(app2.locator("#q-F-13").getByLabel("Yes", { exact: true }), { ms: 200 });
    await addOwn(d, app2, "F-17", "In my opinion the residual intermittent neck ache should settle within three to six months with her home exercise programme.");
    const keys = (await app2.locator("article[id^='q-']").evaluateAll((els) => els.map((e) => e.id.slice(2)))).filter((k) => !NOT_APPLICABLE.includes(k));
    await resolveAll(d, app2, keys);
    const voice2 = app2.getByRole("button", { name: "Write in my own voice" });
    if (await voice2.count()) {
      await d.scrollTop(200);
      await d.click(voice2, { ms: 200 });
      await sleep(800);
    }
    await d.reveal(app2.locator("#q-F-14"), { block: "start", top: 150, force: true, ms: 10 });
    await sleep(300);
    await d.pushInstant(app2);
  });
  await d.hover(app2.locator("#q-F-14 h3").first(), { ms: 600, noReveal: true });
  await d.waitCaption();
  await d.say("q1b.complete", { total: c3.total });
  // "If modified duties, please give details": she is fit for normal duties.
  const nf14 = app2.locator("#q-F-14");
  const add14 = nf14.getByRole("button", { name: "Add a paragraph in your own words" });
  if (await add14.count()) await d.click(add14, { ms: 450, after: 250 });
  await d.type(nf14.locator("textarea").last(), "Not applicable – fit for normal duties.", { cps: 40, ms: 450 });
  await sleep(250);
  await markResolvedIfAsked(d, nf14);
  // "Estimated number of further sessions": discharged to self-management, so none.
  const nf16 = app2.locator("#q-F-16");
  await d.reveal(nf16, { block: "start", top: 220, force: true, ms: 700 });
  await d.type(nf16.locator("#value-F-16"), "0", { cps: 8, ms: 450 });
  await app2.keyboard.press("Enter");
  await sleep(350);
  await markResolvedIfAsked(d, nf16);
  await d.waitCaption();
  if (await itemsToResolve(app2)) {
    await d.cut(async () => {
      await resolveAll(d, app2);
      await d.pushInstant(app2);
    });
    const left2 = await itemsToResolve(app2);
    if (left2) throw new Error(`Northfield: ${left2} items still to resolve before approval`);
  }
  const c4 = await progressCounts(app2);
  log("northfield progress after clinician", c4.raw);
  checks.northfieldBeforeApproval = { answered: c4.answered, total: c4.total, needsInput: c4.needsInput, blocked: c4.blocked };
  // The caption says "all N are answered and clear before she approves": it must be true on screen.
  if (c4.answered !== c4.total || c4.total !== c3.total) throw new Error(`Northfield: only ${c4.answered} of ${c4.total} answered and clear before approval (${c4.raw})`);
  await d.hover(app2.getByText(/answered and clear/).first(), { ms: 600, noReveal: true, dx: -0.05 });
  await sleep(600);
  await d.waitCaption();
  // Approval works exactly as shown for Harrow & Pike: hard cut.
  await d.cut(async () => {
    await approve(d, app2, { slow: false });
    await d.pushInstant(app2);
    await d.moveTo(700, 420, 100);
  });
  await d.hover(app2.getByText(/Approved – the completed form is final/).first(), { ms: 700 }).catch(() => {});
  await sleep(400);
  const nfPdf = await waitDownload(d, app2, app2.getByRole("button", { name: "Completed form (PDF)" }), "megan-hart_northfield_FINAL.pdf");
  await d.hide();

  // Dell's example, side by side.
  const sbs = await d.cut(async () => buildSideBySide(renderPdf(hpPdf.file, "harrow-pike-pages"), renderPdf(nfPdf.file, "northfield-pages")));
  log("side-by-side", JSON.stringify(sbs.found));
  const vp2 = await openViewer(d, ctx, sbs, { x: VIEW.w / 2, y: 70 });
  await d.moveTo(VIEW.w / 2, 70, 300);
  await d.say("q1b.compare", {}, { extra: 0.8 });
  for (const id of sbs.pairs) {
    await vp2.evaluate((id) => window.focusPair(id, 1100), id);
    await vp2.evaluate((id) => window.showPair(id), id);
    await sleep(2700);
  }
  await d.waitCaption();
  await d.answer("q1b.answer");
  await d.hide();

  // ---------- Question 3 again: filed back to the patient's record ----------
  await d.cut(async () => {
    await vp2.close();
    await d.chapter("q3b");
    await cast.attach(app2);
    await d.pushInstant(app2);
    await ensurePreviewDrawn(app2);
    await sleep(300);
  });
  await d.quote("q3b");
  await d.say("q3b.save");
  await d.click(app2.getByRole("button", { name: /Save to clinic record/ }));
  await d.trim(app2.getByText(/Filed to the Simulated TM3 record/).first().waitFor({ timeout: 30000 }), 0.4);
  await sleep(400);
  // The banner on the page (the toast says the same, top right).
  await d.hover(app2.getByText(/to the Simulated TM3 record \(document/).first(), { ms: 700, dx: 0.2 }).catch(() => {});
  await sleep(500);
  await d.cut(async () => {
    await cast.attach(sandbox);
    await sandbox.reload();
    await sandbox.waitForLoadState("networkidle");
    await sleep(600);
    await d.pushInstant(sandbox);
  });
  await d.click(sandbox.getByRole("tab", { name: /Documents/ }));
  await sleep(600);
  const docs = sandbox.locator("[role=tabpanel]:visible").first();
  await d.hover(docs.getByText(/Rehabilitation Progress Report – Northfield/).first(), { ms: 700 }).catch(() => {});
  await sleep(1000);
  await d.hover(docs.getByText(/Treating Physiotherapist Report – Harrow & Pike Medico-Legal \(fictional\) \(Word\)/).first(), { ms: 800 }).catch(() => {});
  await sleep(600);
  await d.hover(docs.getByText(/Signed by/).first(), { ms: 600, dx: -0.05 }).catch(() => {});
  await d.waitCaption();
  await d.answer("q3b.answer");
  await d.hide();
  await d.guard("end of segment A");
  d.ev("seg", { name: "A", edge: "end" });

  /* ======================= Segment B: security ======================= */
  await d.chapter("q5");
  const popupP3 = ctx.waitForEvent("page");
  await d.click(sandbox.getByRole("button", { name: /Complete referrer's report form/ }));
  const app3 = await popupP3;
  await app3.getByText(/Imported from Simulated TM3/).first().waitFor({ timeout: 30000 });
  await app2.close();
  await cast.attach(app3);
  await d.pushInstant(app3);
  const toggle = app3.getByRole("button", { name: /See exactly what the drafting service receives/ });
  await d.reveal(toggle, { force: true, block: "start", top: 300, ms: 10 });
  await sleep(300);
  await d.moveTo(900, 520, 10);
  await sleep(500);
  d.ev("seg", { name: "B", edge: "start" });
  await d.quote("q5");
  await d.click(toggle);
  const pre = app3.locator("#ai-payload-body pre");
  await pre.waitFor({ timeout: 20000 });
  await sleep(500);
  await d.say("q5.payload", {}, { pos: "high" });
  await d.reveal(app3.getByText("Removed or replaced before sending").first(), { block: "start", top: 120, force: true, ms: 1200 });
  await d.hover(app3.getByText(/The patient's name \(every form of it\)/).first(), { ms: 700 }).catch(() => {});
  await sleep(1100);
  await d.hover(pre.getByText(/\[CLAIMANT\]/).first(), { ms: 800, dx: 0.2 }).catch(() => {});
  await d.waitCaption();
  await d.click(app3.getByRole("link", { name: /Security & GDPR/ }).first());
  await d.trim(app3.waitForURL(/\/reports\/security/), 0.3);
  await d.trim(app3.getByRole("heading", { name: /Security & data protection/ }).waitFor({ timeout: 20000 }), 0.3);
  await sleep(400);
  await d.say("q5.security");
  await d.hover(app3.getByText("Who is responsible (UK GDPR)").first(), { ms: 700 });
  await sleep(1100);
  await d.scrollWin(880, 3000);
  await sleep(500);
  await d.reveal(app3.getByText("This demo, and what is in place before real patient data").first(), { block: "start", top: 120, force: true, ms: 1700 });
  await d.hover(app3.getByText("Before any real patient data").first(), { ms: 700 }).catch(() => {});
  await d.waitCaption();
  await d.guard("end of segment B");
  await d.hide();
  await sleep(500);
  d.ev("seg", { name: "B", edge: "end" });
  await cast.detach();
  await cast.flush();
  await sleep(300);

  const timeline = {
    recordedAt: new Date().toISOString(),
    base: BASE,
    live: LIVE,
    health,
    facts,
    vars,
    checks,
    speeds: d.speeds,
    tooltipsClosed: d.tooltipsClosed,
    guard: { checks: GUARD.checks, hits: GUARD.log.filter((g) => g.hits).length, scenes: GUARD.log },
    frames: cast.timedFrames(),
    events: d.events,
    downloads: { hpWord: hpWord.file, hpPdf: hpPdf.file, nfPdf: nfPdf.file },
    hpReportUrl,
    problems,
  };
  fs.writeFileSync(path.join(OUT, "work", "timeline.json"), JSON.stringify(timeline, null, 1));
  await browser.close();
  log(`recorded ${timeline.frames.length} frames; guard checks ${GUARD.checks}; problems: ${problems.length}`);
  if (problems.length) log(problems.join("\n"));
  return timeline;
}

/* ---------------------------------------------------------------------------------------------
 * Cards (title, intro, GDPR, recap, next step): local HTML pages styled like the Studio, recorded as clips
 * -------------------------------------------------------------------------------------------*/
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CARD_CSS = `
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:#0f172a;background:radial-gradient(1200px 700px at 85% -10%, #ccfbf1 0%, rgba(204,251,241,0) 60%), linear-gradient(180deg,#f8fafc,#f1f5f9);overflow:hidden}
  .wrap{position:absolute;inset:0;padding:64px 96px 56px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:22px;color:#0f172a}
  .logo{width:40px;height:40px;border-radius:11px;background:#0d9488;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(13,148,136,.35)}
  .logo svg{width:22px;height:22px}
  .kicker{color:#0f766e;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:16px}
  h1{font-size:56px;line-height:1.08;letter-spacing:-.02em;margin:18px 0 0;font-weight:750}
  h2{font-size:38px;line-height:1.15;letter-spacing:-.015em;margin:12px 0 0;font-weight:700}
  .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;color:#475569;font-size:17px}
  .pill{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:8px 14px;font-weight:600;color:#0f766e}
  .fade{opacity:0;transform:translateY(10px);animation:in .7s ease forwards}
  @keyframes in{to{opacity:1;transform:none}}
  .quote{font-size:25px;line-height:1.42;color:#0f172a;font-weight:500;border-left:5px solid #14b8a6;padding-left:20px;margin:14px 0 0}
  .ans{display:flex;align-items:center;gap:14px;background:#065f50;color:#fff;border-radius:14px;padding:14px 22px;font-size:23px;font-weight:600;box-shadow:0 0 0 2px rgba(94,234,212,.55),0 10px 30px rgba(2,6,23,.25)}
  .ans .ck{flex:none;width:30px;height:30px;border-radius:50%;background:#5eead4;color:#064e3b;display:flex;align-items:center;justify-content:center;font-weight:800}
`;
const LOGO = `<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div>`;

function cardHtml(key, c, extras) {
  const head = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${PRODUCT_NAME} – ${esc(key)}</title><style>${CARD_CSS}${extras.css || ""}</style></head><body><div class="wrap">`;
  // Heartbeat (see overlayInit): keeps the screencast delivering the final frame of each animation.
  const tail = `</div><div id="hb" style="position:fixed;right:0;bottom:0;width:2px;height:2px"></div><script>let o=false;setInterval(()=>{o=!o;document.getElementById("hb").style.background=o?"rgba(128,128,128,.035)":"rgba(128,128,128,.02)"},100)</script></body></html>`;
  if (key === "title") {
    return `${head}
      <div class="brand fade" style="animation-delay:.05s">${LOGO}${PRODUCT_NAME}</div>
      <div style="display:flex;gap:56px;align-items:center;margin-top:40px;flex:1">
        <div style="flex:1.2">
          <div class="kicker fade" style="animation-delay:.2s">${esc(c.kicker)}</div>
          <h1 class="fade" style="animation-delay:.35s">${esc(c.title)}</h1>
          <p class="fade" style="animation-delay:.6s;font-size:22px;color:#334155;line-height:1.5;margin-top:26px;max-width:660px">${esc(c.lede)}</p>
        </div>
        <div class="fade" style="flex:.8;animation-delay:.5s;position:relative;height:640px">
          ${extras.pageImg ? `<img src="${extras.pageImg}" style="position:absolute;right:10px;top:0;width:430px;border-radius:6px;box-shadow:0 30px 60px rgba(15,23,42,.25),0 0 0 1px rgba(15,23,42,.08);transform:rotate(2.2deg)"><div style="position:absolute;right:300px;bottom:40px;background:#0d9488;color:#fff;font-weight:600;font-size:15px;padding:9px 14px;border-radius:10px;box-shadow:0 10px 24px rgba(13,148,136,.35)">A referrer's own form, completed · fictional patient</div>` : ""}
        </div>
      </div>
      <div class="foot fade" style="animation-delay:.8s"><span class="pill">${esc(c.footer)}</span><span>appstackx.co.uk</span></div>${tail}`;
  }
  if (key === "intro") {
    const qs = c.questions
      .map((q, i) => `<li class="fade" style="animation-delay:${(5.0 + i * 0.6).toFixed(2)}s"><span class="n">${i + 1}</span><span>${esc(q)}</span></li>`)
      .join("");
    return `${head}
      <div style="display:flex;gap:56px;flex:1;min-height:0">
        <div style="flex:1;display:flex;flex-direction:column">
          <div class="brand fade">${LOGO}${PRODUCT_NAME}</div>
          <div class="kicker fade" style="margin-top:34px;animation-delay:.2s">${esc(c.kicker)}</div>
          ${c.quotes.map((q, i) => `<p class="quote fade" style="animation-delay:${(0.35 + i * 0.6).toFixed(2)}s">${esc(q)}</p>`).join("")}
          <div class="ng fade" style="animation-delay:2.2s">${esc(c.notGeneric)}</div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;padding-top:8px">
          <div class="kicker fade" style="margin-top:62px;animation-delay:4.6s">${esc(c.questionsTitle)}</div>
          <ol class="qs">${qs}</ol>
        </div>
      </div>
      <div class="foot fade" style="animation-delay:8.4s;font-size:15px;margin-top:22px">${esc(c.note)}</div>${tail}`;
  }
  if (key === "gdpr") {
    const bl = c.bullets
      .map(
        ([b, t], i) =>
          `<li class="fade" style="animation-delay:${(0.7 + i * 0.6).toFixed(2)}s"><span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#0d9488" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span><b>${esc(b)}</b>${t ? ` – ${esc(t)}` : ""}</span></li>`,
      )
      .join("");
    return `${head}
      <div class="kicker fade">${esc(c.kicker)}</div>
      <h2 class="fade" style="animation-delay:.25s">${esc(c.title)}</h2>
      <ul class="gd">${bl}</ul>
      <div class="ans fade" style="animation-delay:6.6s;margin-top:22px"><span class="ck">&#10003;</span><span>${esc(c.answer)}</span></div>
      <div class="foot fade" style="animation-delay:7.2s;font-size:15px"><span>Set out in full on the app's Security &amp; GDPR page.</span><span class="pill">AppStackX · all data fictional</span></div>${tail}`;
  }
  if (key === "recap") {
    const rows = c.rows
      .map(
        (r, i) => `<tr class="fade" style="animation-delay:${(0.5 + i * 0.45).toFixed(2)}s"><td class="n"><span>${i + 1}</span></td><td class="q">${esc(r.q)}</td><td class="a">${esc(r.a)}</td><td class="t">${esc(extras.times[i] || "")}</td></tr>`,
      )
      .join("");
    return `${head}
      <div class="brand fade">${LOGO}${PRODUCT_NAME}</div>
      <h2 class="fade" style="animation-delay:.15s;margin-top:26px">${esc(c.kicker)}</h2>
      <table class="rc"><thead class="fade" style="animation-delay:.3s"><tr><th></th><th>You asked about</th><th>What the walkthrough showed</th><th>Shown at</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="foot fade" style="animation-delay:3s;font-size:15px"><span>All patients, clinicians and referrers are fictional · the TM3 shown is a simulated sandbox, not affiliated with TM3</span><span class="pill">AppStackX</span></div>${tail}`;
  }
  if (key === "next") {
    return `${head}
      <div class="brand fade">${LOGO}${PRODUCT_NAME}</div>
      <div style="margin-top:auto;margin-bottom:auto">
        <div class="kicker fade" style="animation-delay:.2s">${esc(c.kicker)}</div>
        <h1 class="fade" style="animation-delay:.4s;max-width:1400px;font-size:52px">${esc(c.title)}</h1>
        <p class="fade" style="animation-delay:.8s;font-size:30px;color:#334155;margin-top:22px;max-width:1300px">${esc(c.body)}</p>
        <p class="quote fade" style="animation-delay:1.3s;font-size:21px;color:#475569;margin-top:30px;max-width:1300px">${esc(c.offer)}</p>
      </div>
      <div class="foot fade" style="animation-delay:1.6s"><span class="pill" style="font-size:20px">${esc(c.footer)}</span><span>Fictional data only in this walkthrough</span></div>${tail}`;
  }
  throw new Error("unknown card " + key);
}
const CARD_EXTRA_CSS = `
  .ng{margin-top:24px;background:#ecfdf5;border:1px solid #99f6e4;color:#065f46;border-radius:14px;padding:14px 18px;font-size:21px;line-height:1.4;font-weight:600}
  .qs{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:11px}
  .qs li{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 16px;font-size:20px;line-height:1.35;font-weight:600;box-shadow:0 2px 8px rgba(15,23,42,.04)}
  .qs .n{flex:none;width:34px;height:34px;border-radius:50%;background:#0d9488;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px}
  .gd{list-style:none;padding:0;margin:22px 0 0;display:flex;flex-direction:column;gap:8px;max-width:1400px}
  .gd li{display:flex;gap:14px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:13px;padding:9px 18px;font-size:21px;line-height:1.35;color:#334155;box-shadow:0 2px 8px rgba(15,23,42,.04)}
  .gd b{color:#0f172a}
  .gd .tick{flex:none;width:30px;height:30px;border-radius:9px;background:#ccfbf1;display:flex;align-items:center;justify-content:center}
  .gd .tick svg{width:18px;height:18px}
  .rc{margin-top:26px;border-collapse:separate;border-spacing:0 10px;width:100%;font-size:21px}
  .rc th{text-align:left;color:#64748b;font-size:15px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:0 16px}
  .rc td{background:#fff;padding:16px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;line-height:1.35;vertical-align:middle}
  .rc td:first-child{border-left:1px solid #e2e8f0;border-radius:14px 0 0 14px}
  .rc td:last-child{border-right:1px solid #e2e8f0;border-radius:0 14px 14px 0}
  .rc .n span{width:36px;height:36px;border-radius:50%;background:#0d9488;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px}
  .rc .q{font-weight:700;width:25%}
  .rc .a{color:#334155}
  .rc .t{white-space:nowrap;color:#0f766e;font-weight:700;font-variant-numeric:tabular-nums;width:9%}
`;

/** "Sped up – real time N s" badge PNG for one live wait (transparent background, device pixels). */
async function renderBadges(ctx, speeds) {
  fs.rmSync(DIRS.badges, { recursive: true, force: true });
  fs.mkdirSync(DIRS.badges, { recursive: true });
  const out = {};
  for (const s of speeds) {
    const label = fill(CAP.sped.label, { secs: Math.round(s.real) });
    scanOrThrow(`badge ${s.id}`, label);
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}
      .b{display:inline-flex;align-items:center;gap:10px;margin:6px;padding:9px 18px 9px 14px;border-radius:999px;background:#fbbf24;color:#422006;
      font:700 19px/1 Inter,system-ui,sans-serif;box-shadow:0 0 0 2px rgba(66,32,6,.18),0 8px 22px rgba(2,6,23,.35)}
      .b svg{width:20px;height:20px} #w{display:inline-block;padding:14px}</style></head><body><div id="w"><span class="b"><svg viewBox="0 0 24 24" fill="#422006"><path d="M4 5v14l8-7zM12 5v14l8-7z"/></svg>${esc(label)}</span></div></body></html>`,
    );
    const file = path.join(DIRS.badges, `${s.id}.png`);
    await page.locator("#w").screenshot({ path: file, omitBackground: true });
    await page.close();
    out[s.id] = { file, label };
  }
  return out;
}

async function recordCards(timeline, layout) {
  fs.rmSync(DIRS.cardFrames, { recursive: true, force: true });
  fs.mkdirSync(DIRS.cardFrames, { recursive: true });
  fs.mkdirSync(DIRS.cards, { recursive: true });
  // Title card shows page 1 of the completed Harrow & Pike form, as downloaded in this recording.
  let pageImg = null;
  const hpPng = path.join(DIRS.viewer, "harrow-pike", "p-1.png");
  if (fs.existsSync(hpPng)) {
    fs.copyFileSync(hpPng, path.join(DIRS.cards, "completed-form-p1.png"));
    pageImg = "completed-form-p1.png";
  }
  // Recap: where each answer was shown (chapter start times in the final video).
  const times = CAP.cards.recap.rows.map((r) =>
    r.chapters
      .map((k) => layout.chapters.find((c) => c.key === k))
      .filter(Boolean)
      .map((c) => mmss(c.t))
      .join(" · "),
  );
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.w},${VIEW.h + 87}`, "--hide-scrollbars"],
  });
  const ctx = await browser.newContext({ viewport: null });
  const badges = await renderBadges(ctx, timeline.speeds || []);
  const out = { badges, recapTimes: times };
  for (const key of ["title", "intro", "gdpr", "recap", "next"]) {
    const c = CAP.cards[key];
    const file = path.join(DIRS.cards, `${key}.html`);
    const html = cardHtml(key, c, { pageImg, css: CARD_EXTRA_CSS, times });
    fs.writeFileSync(file, html);
    const page = await ctx.newPage();
    const dir = path.join(DIRS.cardFrames, key);
    fs.mkdirSync(dir, { recursive: true });
    const cast = new Cast(dir);
    await page.goto("about:blank");
    await page.evaluate(() => (document.body.style.background = "#f8fafc"));
    await cast.attach(page);
    const t0 = now();
    await page.goto("file://" + file);
    await page.waitForLoadState("load");
    scanOrThrow(`card ${key}`, await pageText(page));
    await sleep(c.seconds * 1000 + 400);
    const t1 = now();
    await cast.detach();
    await cast.flush();
    await page.screenshot({ path: path.join(DIRS.cards, `${key}.png`) });
    await page.close();
    out[key] = { frames: cast.timedFrames(), t0, t1: Math.min(t1, t0 + c.seconds) };
    log("card", key, cast.frames.length, "frames");
  }
  await browser.close();
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Assembly
 * -------------------------------------------------------------------------------------------*/
function ff(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}
function probeDuration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}

/** Kept intervals of [a,b] after removing cut ranges, then split at the sped-up live waits: [start, end, rate]. */
function keptIntervals(a, b, cuts, speeds = []) {
  let parts = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [s, e] of parts) {
      if (c1 <= s || c0 >= e) next.push([s, e]);
      else {
        if (c0 > s) next.push([s, c0]);
        if (c1 < e) next.push([c1, e]);
      }
    }
    parts = next;
  }
  parts = parts.filter(([s, e]) => e - s > 0.02).map(([s, e]) => [s, e, 1]);
  for (const sp of speeds) {
    const rate = (sp.t1 - sp.t0) / spedDuration(sp.t1 - sp.t0);
    const next = [];
    for (const [s, e, r] of parts) {
      if (sp.t1 <= s || sp.t0 >= e || r !== 1) next.push([s, e, r]);
      else {
        if (sp.t0 > s) next.push([s, sp.t0, 1]);
        next.push([Math.max(s, sp.t0), Math.min(e, sp.t1), rate]);
        if (sp.t1 < e) next.push([sp.t1, e, 1]);
      }
    }
    parts = next;
  }
  return parts.filter(([s, e]) => e - s > 0.005);
}
function mapper(kept) {
  // wall time -> clip time (null if inside a cut / outside)
  return (t, clamp = false) => {
    let acc = 0;
    for (const [s, e, r] of kept) {
      if (t < s) return clamp ? acc : null;
      if (t <= e) return acc + (t - s) / r;
      acc += (e - s) / r;
    }
    return clamp ? acc : null;
  };
}
const keptTotal = (kept) => kept.reduce((s, [x, y, r]) => s + (y - x) / r, 0);

function writeConcat(frames, kept, dir, listFile) {
  const lines = [];
  let last = null;
  for (const [s, e, r = 1] of kept) {
    // frame showing at s
    let i = frames.findIndex((f) => f.t > s) - 1;
    if (i < 0) i = frames.findIndex((f) => f.t > s) === -1 ? frames.length - 1 : 0;
    let tCur = s;
    for (; i < frames.length; i++) {
      const f = frames[i];
      if (f.t >= e) break;
      const nextT = i + 1 < frames.length ? Math.min(frames[i + 1].t, e) : e;
      const start = Math.max(tCur, f.t);
      const dur = (nextT - start) / r;
      if (dur > 0.0005) {
        lines.push(`file '${path.join(dir, f.file)}'`, `duration ${dur.toFixed(5)}`);
        last = f;
      }
      tCur = nextT;
    }
  }
  if (last) lines.push(`file '${path.join(dir, last.file)}'`);
  fs.writeFileSync(listFile, lines.join("\n") + "\n");
}

function encodeFrames(listFile, out, durTotal, { fadeIn = 0.35, fadeOut = 0.35, overlays = [] } = {}) {
  const base = [`crop=w='min(iw,${OUT_W})':h='min(ih,${OUT_H})':x=0:y=0`, `pad=${OUT_W}:${OUT_H}:0:0:color=white`, "setsar=1", "fps=30"].join(",");
  const tail = [
    fadeIn ? `fade=t=in:st=0:d=${fadeIn}` : null,
    fadeOut ? `fade=t=out:st=${Math.max(0, durTotal - fadeOut).toFixed(3)}:d=${fadeOut}` : null,
    "format=yuv420p",
  ]
    .filter(Boolean)
    .join(",");
  const inputs = ["-f", "concat", "-safe", "0", "-i", listFile];
  const graph = [`[0:v]${base}[v0]`];
  overlays.forEach((o, i) => {
    inputs.push("-i", o.png);
    graph.push(`[v${i}][${i + 1}:v]overlay=x=(W-w)/2:y=${o.y}:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})'[v${i + 1}]`);
  });
  graph.push(`[v${overlays.length}]${tail}[vout]`);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[vout]", "-t", durTotal.toFixed(3), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-an", out]);
}

/**
 * The voice-over line for a recorded caption, from the CURRENT captions.json (so the script can be
 * re-written without re-recording): the placeholder values are read back from the caption text as shown.
 */
function currentVo(e) {
  const c = CAP.captions[e.id];
  if (!c) return e.vo;
  const tpl = c.vo || c.text;
  if (!/\{\w+\}/.test(tpl)) return tpl;
  const names = [];
  const re = new RegExp(
    "^" +
      c.text
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = part.match(/^\{(\w+)\}$/);
          if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (names.includes(m[1])) return ".+?";
          names.push(m[1]);
          return `(?<${m[1]}>.+?)`;
        })
        .join("") +
      "$",
  );
  const m = e.text.match(re);
  if (!m) return e.vo;
  const out = fill(tpl, m.groups || {});
  return /\{\w+\}/.test(out) ? e.vo : out;
}

const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

const PLAN = [
  { kind: "card", key: "title" },
  { kind: "card", key: "intro" },
  { kind: "app", key: "A" },
  { kind: "app", key: "B" },
  { kind: "card", key: "gdpr" },
  { kind: "card", key: "recap" },
  { kind: "card", key: "next" },
];
const CARD_CHAPTERS = {
  title: "Title",
  intro: "Introduction – what you told us and your five questions",
  gdpr: "Your question 5 of 5 · What is in place before real patient data",
  recap: "Your five questions – answered",
  next: "Your next step",
};

/** Cuts, sped-up waits and the kept intervals of each app segment; chapter times in the final video. */
function computeLayout(timeline) {
  const ev = timeline.events;
  const cuts = [];
  let open = null;
  for (const e of ev.filter((x) => x.type === "cut")) {
    if (e.edge === "start") open = e.t;
    else if (open !== null) {
      cuts.push([open, e.t]);
      open = null;
    }
  }
  const speeds = [];
  for (const e of ev.filter((x) => x.type === "speed" && x.edge === "start")) {
    const end = ev.find((x) => x.type === "speed" && x.edge === "end" && x.id === e.id && x.t >= e.t);
    if (end) speeds.push({ id: e.id, t0: e.t, t1: end.t, real: end.real });
  }
  const seg = (name) => [ev.find((e) => e.type === "seg" && e.name === name && e.edge === "start").t, ev.find((e) => e.type === "seg" && e.name === name && e.edge === "end").t];
  const items = [];
  const chapters = [];
  let offset = 0;
  for (const item of PLAN) {
    if (item.kind === "card") {
      const dur = CAP.cards[item.key].seconds;
      items.push({ ...item, start: offset, dur });
      chapters.push({ key: item.key, label: CARD_CHAPTERS[item.key], t: offset });
      offset += dur;
      continue;
    }
    const [a, b] = seg(item.key);
    const kept = keptIntervals(a, b, cuts, speeds);
    const map = mapper(kept);
    const dur = keptTotal(kept);
    for (const c of ev.filter((x) => x.type === "chapter")) {
      if (c.t > b || chapters.some((x) => x.key === c.key)) continue;
      chapters.push({ key: c.key, label: `${c.n} · ${c.label}`, t: offset + map(Math.max(c.t, a), true) });
    }
    const sp = speeds
      .filter((s) => s.t0 >= a && s.t1 <= b)
      .map((s) => ({ ...s, vStart: offset + map(s.t0, true), vEnd: offset + map(s.t1, true) }));
    items.push({ ...item, start: offset, dur, a, b, kept, speeds: sp });
    offset += dur;
  }
  chapters.sort((x, y) => x.t - y.t);
  return { items, chapters, total: offset, cuts, speeds };
}

async function assemble(timeline, cardsRec, layout, { docsOnly = false } = {}) {
  // docsOnly: rewrite the SRT and the narration script from the clips already encoded (no re-encoding).
  if (!docsOnly) {
    fs.rmSync(DIRS.clips, { recursive: true, force: true });
    fs.mkdirSync(DIRS.clips, { recursive: true });
  }
  const ev = timeline.events;
  const clips = [];
  let offset = 0;
  const subs = [];
  const chapters = [];
  const spedShown = [];
  for (const item of layout.items) {
    const out = path.join(DIRS.clips, `${String(clips.length).padStart(2, "0")}-${item.kind}-${item.key}.mp4`);
    if (item.kind === "card") {
      const r = cardsRec[item.key];
      const c = CAP.cards[item.key];
      const kept = [[r.t0 + 0.15, r.t0 + 0.15 + c.seconds, 1]];
      const list = out.replace(/\.mp4$/, ".txt");
      if (!docsOnly) {
        writeConcat(r.frames, kept, path.join(DIRS.cardFrames, item.key), list);
        encodeFrames(list, out, c.seconds, { fadeIn: 0.45, fadeOut: 0.45 });
      }
      const dur = probeDuration(out);
      // A card's subtitle text may be given as its own short entries (an array), shown one after another.
      const parts = Array.isArray(c.srt) ? c.srt : null;
      subs.push({ start: offset + 0.3, end: offset + dur - 0.3, text: parts ? parts.join(" ") : c.srt, parts, vo: c.vo, chapter: CARD_CHAPTERS[item.key], card: item.key });
      chapters.push({ key: item.key, label: CARD_CHAPTERS[item.key], t: offset });
      clips.push({ file: out, dur });
      offset += dur;
      continue;
    }
    const { a, b, kept } = item;
    const map = mapper(kept);
    const total = keptTotal(kept);
    const list = out.replace(/\.mp4$/, ".txt");
    if (!docsOnly) writeConcat(timeline.frames, kept, DIRS.frames, list);
    // "Sped up – real time N s" badge over each sped-up live wait (and for a moment after it).
    const overlays = item.speeds.map((s) => {
      const start = map(s.t0, true);
      const end = Math.min(total - 0.1, map(s.t1, true) + 1.2);
      spedShown.push({ id: s.id, real: Number(s.real.toFixed(1)), shownSec: Number((map(s.t1, true) - start).toFixed(2)), at: offset + start });
      return { png: cardsRec.badges[s.id].file, start, end, y: 88 };
    });
    if (!docsOnly) encodeFrames(list, out, total, { fadeIn: 0.35, fadeOut: 0.35, overlays });
    const dur = probeDuration(out);
    // captions
    const caps = ev.filter((e) => e.type === "cap" || e.type === "caphide");
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      if (c.type !== "cap") continue;
      const endEv = caps[i + 1];
      const tEnd = Math.min(endEv ? endEv.t : b, b);
      if (c.t >= b || tEnd <= a) continue;
      const s = map(Math.max(c.t, a), true);
      const e = map(tEnd, true);
      if (e - s < 0.3) continue;
      const chap = ev.filter((x) => x.type === "chapter" && x.t <= c.t + 0.01).pop();
      subs.push({ start: offset + s, end: offset + e, text: c.text, vo: currentVo(c), chapter: chap ? `${chap.n} · ${chap.label}` : "", id: c.id, answer: c.style === "answer" });
    }
    // question cards
    for (const q of ev.filter((e) => e.type === "quote")) {
      if (q.t < a || q.t >= b) continue;
      const hideEv = ev.find((e) => e.type === "quotehide" && e.id === q.id && e.t >= q.t);
      const s = map(q.t, true);
      const e = map(Math.min(hideEv ? hideEv.t : b, b), true);
      const chap = ev.filter((x) => x.type === "chapter" && x.t <= q.t + 0.01).pop();
      subs.push({ start: offset + s, end: offset + e, text: q.text, vo: CAP.quotes[q.id]?.vo || q.vo, chapter: chap ? `${chap.n} · ${chap.label}` : "", id: `quote.${q.id}`, quote: true });
    }
    for (const c of ev.filter((x) => x.type === "chapter")) {
      if (c.t > b || chapters.some((x) => x.key === c.key)) continue;
      chapters.push({ key: c.key, label: `${c.n} · ${c.label}`, t: offset + map(Math.max(c.t, a), true) });
    }
    clips.push({ file: out, dur });
    offset += dur;
  }
  chapters.sort((x, y) => x.t - y.t);
  // concat
  const listAll = path.join(DIRS.clips, "all.txt");
  fs.writeFileSync(listAll, clips.map((c) => `file '${c.file}'`).join("\n") + "\n");
  const finalMp4 = path.join(OUT, `${FINAL_NAME}.mp4`);
  if (!docsOnly) ff(["-f", "concat", "-safe", "0", "-i", listAll, "-c", "copy", "-movflags", "+faststart", finalMp4]);
  const finalDur = probeDuration(finalMp4);

  // SRT: same timings as the burned-in captions; a caption on screen during a sped-up wait carries the label.
  subs.sort((x, y) => x.start - y.start);
  for (let i = 0; i < subs.length - 1; i++) if (subs[i].end > subs[i + 1].start - 0.05) subs[i].end = subs[i + 1].start - 0.05;
  // Long entries (long captions) are split at sentence/clause breaks into shorter consecutive entries; cards
  // use their own short entries. An entry on screen during a sped-up wait carries the label, once (the
  // sentence is not repeated with and without it).
  const srtSubs = [];
  for (const s of subs.flatMap((x) => chunkSub(x))) {
    const sp = spedShown.find((x) => x.at < s.end && x.at + x.shownSec > s.start);
    srtSubs.push(sp ? { ...s, text: `${s.text} ${fill(CAP.sped.srt, { secs: Math.round(sp.real) })}` } : s);
  }
  const srt = srtSubs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${wrapSrt(s.text)}\n`).join("\n");
  scanOrThrow("SRT", srt);
  fs.writeFileSync(path.join(OUT, `${FINAL_NAME}.srt`), srt);

  // Narration script
  const nar = narration(subs, chapters, finalDur, timeline, spedShown);
  scanOrThrow("narration-script.md", nar);
  fs.writeFileSync(path.join(OUT, "narration-script.md"), nar);
  if (docsOnly) return { docsOnly: true, durationSec: Number(finalDur.toFixed(2)), captions: subs.length, srtEntries: srtSubs.length };

  // Poster: the title card (fully faded in)
  ff(["-ss", "3.6", "-i", finalMp4, "-frames:v", "1", path.join(OUT, `${FINAL_NAME}-poster.png`)]);
  ff(["-ss", "3.6", "-i", finalMp4, "-frames:v", "1", path.join(OUT, "poster.png")]);

  // Review frames: every 8 s, 2.5 s into each chapter, and the middle of each sped-up wait
  fs.rmSync(DIRS.review, { recursive: true, force: true });
  fs.mkdirSync(DIRS.review, { recursive: true });
  ff(["-i", finalMp4, "-vf", "fps=1/8", path.join(DIRS.review, "t%03d.png")]);
  for (const c of chapters) {
    const t = Math.min(finalDur - 0.1, c.t + 2.5);
    ff(["-ss", t.toFixed(2), "-i", finalMp4, "-frames:v", "1", path.join(DIRS.review, `chapter-${String(Math.round(c.t)).padStart(3, "0")}-${c.key}.png`)]);
  }
  for (const s of spedShown) {
    ff(["-ss", (s.at + s.shownSec / 2).toFixed(2), "-i", finalMp4, "-frames:v", "1", path.join(DIRS.review, `sped-${s.id}.png`)]);
  }

  // E-mail copy (<= 24 MB): stronger compression tuned for screen content.
  const emailMp4 = path.join(OUT, `${FINAL_NAME}-email.mp4`);
  let emailCrf = null;
  // --no-email (dry runs): skip the slow e-mail encode.
  for (const crf of flag("--no-email") ? [] : [27, 28, 29, 30]) {
    ff(["-i", finalMp4, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", "-an", emailMp4]);
    emailCrf = crf;
    if (fs.statSync(emailMp4).size <= EMAIL_MAX_BYTES) break;
  }

  const summary = {
    file: finalMp4,
    live: timeline.live,
    durationSec: Number(finalDur.toFixed(2)),
    duration: mmss(finalDur),
    sizeMB: Number((fs.statSync(finalMp4).size / 1e6).toFixed(2)),
    email: emailCrf === null ? null : { file: emailMp4, crf: emailCrf, bytes: fs.statSync(emailMp4).size, sizeMB: Number((fs.statSync(emailMp4).size / 1e6).toFixed(2)) },
    chapters: chapters.map((c) => ({ ...c, at: mmss(c.t) })),
    recapTimes: cardsRec.recapTimes,
    sped: spedShown,
    captions: subs.length,
    guard: { ...timeline.guard, scenes: undefined, fileScans: GUARD.files },
    tooltipsClosed: timeline.tooltipsClosed,
    checks: timeline.checks,
    clips: clips.map((c) => ({ file: path.basename(c.file), dur: Number(c.dur.toFixed(2)) })),
  };
  fs.writeFileSync(path.join(OUT, "work", "summary.json"), JSON.stringify(summary, null, 1));
  return summary;
}

/** Splits a subtitle longer than ~2 lines into consecutive entries at sentence / clause breaks, timed by length. */
function chunkSub(s, max = 118) {
  if (s.parts && s.parts.length > 1) return timeChunks(s, s.parts);
  if (s.text.length <= max || (s.quote && s.text.length <= 150)) return [s];
  // Sentence breaks only where the punctuation is followed by a space (so "appstackx.co.uk" stays whole).
  const parts = s.text.split(/(?<=[.;!?][”"’)]?)\s+/).filter(Boolean);
  const packed = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length >= 30 && (cur + " " + p).length > max) {
      packed.push(cur);
      cur = p;
    } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) packed.push(cur);
  // A chunk that is still too long is split at the comma or dash nearest its middle (recursively).
  const splitLong = (ch) => {
    if (ch.length <= max + 10) return [ch];
    const mid = ch.length / 2;
    let best = -1;
    for (const m of ch.matchAll(/, | – /g)) if (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid)) best = m.index;
    if (best <= 0) return [ch];
    return [...splitLong(ch.slice(0, best + 1).trim()), ...splitLong(ch.slice(best + 1).trim())];
  };
  const out = packed.flatMap(splitLong);
  // Never leave a scrap on its own.
  for (let i = out.length - 1; i > 0; i--) if (out[i].length < 28) out.splice(i - 1, 2, `${out[i - 1]} ${out[i]}`);
  if (out.length > 1 && out[0].length < 28) out.splice(0, 2, `${out[0]} ${out[1]}`);
  if (out.length < 2) return [s];
  return timeChunks(s, out);
}

/** Consecutive entries for the pieces of one subtitle, each timed by its length. */
function timeChunks(s, pieces) {
  const total = pieces.reduce((a, x) => a + x.length, 0);
  const dur = s.end - s.start;
  let t = s.start;
  return pieces.map((text, i) => {
    const d = (dur * text.length) / total;
    const e = i === pieces.length - 1 ? s.end : t + d - 0.04;
    const r = { ...s, start: t, end: e, text, parts: undefined };
    t += d;
    return r;
  });
}

function wrapSrt(text) {
  // two lines max, split near the middle on a space
  if (text.length <= 64) return text;
  const mid = Math.floor(text.length / 2);
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best > 0 ? `${text.slice(0, best)}\n${text.slice(best + 1)}` : text;
}

const SPED_NAMES = { "form-reading": "reading Meridian's form", "harrow-pike-draft": "Harrow & Pike draft", "northfield-draft": "Northfield draft" };

function narration(subs, chapters, finalDur, timeline, spedShown) {
  const lines = [];
  lines.push(`# Voice-over script – ${PRODUCT_NAME} walkthrough for Dell Baines, Blue Heart Clinics`);
  lines.push("");
  lines.push(
    `Video: \`${FINAL_NAME}.mp4\` · ${mmss(finalDur)} (${finalDur.toFixed(1)} s) · 1920×1080 · no audio track. Subtitles: \`${FINAL_NAME}.srt\` (the same timings as the on-screen captions). E-mail copy: \`${FINAL_NAME}-email.mp4\`.`,
  );
  lines.push("");
  lines.push(
    "How to use it: the video is a point-by-point reply to Dell's e-mail, so speak to him directly (\"you\", \"your\"). Record each line so it starts at the time shown (a little after is fine). Each line is written to fit its slot at a relaxed pace (about 2.5 words a second); a line marked ⚠ is tight – read it briskly or trim it. The on-screen captions already carry the message, so the voice-over can be dropped or shortened without losing anything.",
  );
  lines.push("");
  lines.push("Honesty notes for the narrator:");
  lines.push(`- Refer to the product as "the system" or "${PRODUCT_NAME}". Do not name any supplier or the technology behind the drafting.`);
  lines.push("- The TM3 shown is a **Simulated TM3 sandbox – demo data, not affiliated with TM3**. Every patient, clinician and referrer is fictional.");
  if (timeline.live) {
    lines.push(
      `- The form reading and both drafts were produced **live during this recording**. The waits are sped up on screen and labelled with their real times (the whole wait, so about a second or two more than the app's own "drafted in N s" chip): ${spedShown
        .map((s) => `${SPED_NAMES[s.id] || s.id} about ${Math.round(s.real)} s`)
        .join("; ")}. Say "sped up" if you mention the wait; never call it instant.`,
    );
  } else {
    lines.push("- This cut uses the app's prepared demo outputs (labelled \"Prepared demo reading\" / \"Prepared demo draft\" on screen). Don't describe them as live.");
  }
  lines.push("- A direct TM3 connection is subject to TM3 providing access; today's route is a TM3 notes export, uploaded in one step.");
  lines.push("- Don't claim time savings – none have been measured yet. Counts on screen are read from the app during the recording.");
  lines.push("- Security: describe the measures as what will be in place before any real patient data is used, not as already certified.");
  lines.push("");
  lines.push("## Chapters");
  lines.push("");
  for (const c of chapters) lines.push(`- ${mmss(c.t)} – ${c.label}`);
  lines.push("");
  lines.push("## Script");
  lines.push("");
  let lastChap = null;
  for (const s of subs) {
    if (s.chapter && s.chapter !== lastChap) {
      lines.push(`### ${s.chapter}`);
      lines.push("");
      lastChap = s.chapter;
    }
    const slot = s.end - s.start;
    const need = words(s.vo) / 2.5;
    const warn = need > slot + 0.6 ? " ⚠" : "";
    const tag = s.quote ? " *(question card)*" : s.answer ? " *(answer)*" : "";
    lines.push(`**${mmss(s.start)} – ${mmss(s.end)}**${warn} (${slot.toFixed(1)} s)${tag}  `);
    lines.push(s.vo);
    lines.push("");
  }
  return lines.join("\n");
}

/** The final documents the clinic would download: scanned for banned terms too. */
function scanDownloads(timeline) {
  for (const f of Object.values(timeline.downloads || {})) {
    if (!f || !fs.existsSync(f)) continue;
    let text = "";
    if (f.endsWith(".pdf")) text = execFileSync("pdftotext", [f, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
    else if (f.endsWith(".docx")) {
      const names = execFileSync("unzip", ["-Z1", f], { encoding: "utf8" }).split("\n").filter((n) => /^(word\/.*\.xml|docProps\/.*\.xml)$/.test(n));
      text = names.map((n) => execFileSync("unzip", ["-p", f, n], { encoding: "utf8", maxBuffer: 64 << 20 }).replace(/<[^>]+>/g, " ")).join("\n");
    }
    scanOrThrow(`download ${path.basename(f)}`, `${path.basename(f)}\n${text}`);
    if (/\bDRAFT\b/.test(text)) throw new Error(`Final file ${path.basename(f)} still carries a DRAFT marking`);
  }
}

/* ---------------------------------------------------------------------------------------------
 * Main
 * -------------------------------------------------------------------------------------------*/
/** Dev aid: `--viewer-test HP.pdf NF.pdf` builds the final-PDF viewer and the side-by-side page and screenshots them. */
async function viewerTest(hp, nf) {
  fs.mkdirSync(DIRS.viewer, { recursive: true });
  const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
  const v = buildViewer(hp, "harrow-pike", "Harrow & Pike Medico-Legal (fictional) – Treating Physiotherapist Report", [
    { id: "reg", from: ["Claimant", "name"], to: ["07/07/2026"], label: "From the TM3 registration – filled by code", x1: 445 },
    { id: "b2", band: { start: ["B2."], end: ["B3."] }, label: "Drafted from the physiotherapy notes", pad: 2 },
    { id: "tick", from: ["☒", "Yes"], to: ["No"], label: "Tick box set", pad: 6 },
    { id: "sign", from: ["Name", "Sarah", "Reid"], to: ["Date", DATE_RE], label: "Completed from the approval", x1: 445, pad: 7 },
  ]);
  const sbs = buildSideBySide(renderPdf(hp, "harrow-pike-pages"), renderPdf(nf, "northfield-pages"));
  log("viewer", JSON.stringify(v), "side-by-side", JSON.stringify(sbs.found));
  const browser = await chromium.launch({ executablePath: findChromium(), args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.w},${VIEW.h + 87}`, "--hide-scrollbars"] });
  const ctx = await browser.newContext({ viewport: null });
  const p = await ctx.newPage();
  await p.goto("file://" + v.file);
  await p.evaluate(() => document.querySelectorAll(".hl").forEach((e) => e.classList.add("on")));
  for (const id of ["b2", "sign"]) {
    await p.evaluate((id) => document.getElementById("hl-" + id).scrollIntoView({ block: "center" }), id);
    await sleep(300);
    await p.screenshot({ path: path.join(DIRS.viewer, `test-viewer-${id}.png`) });
  }
  await p.goto("file://" + sbs.file);
  await sleep(500);
  for (const id of sbs.pairs) {
    await p.evaluate((id) => window.focusPair(id, 10), id);
    await p.evaluate((id) => window.showPair(id), id);
    await sleep(700);
    await p.screenshot({ path: path.join(DIRS.viewer, `test-sbs-${id}.png`) });
  }
  await browser.close();
}

async function main() {
  fs.mkdirSync(path.join(OUT, "work"), { recursive: true });
  if (flag("--viewer-test")) {
    const i = argv.indexOf("--viewer-test");
    return viewerTest(path.resolve(argv[i + 1]), path.resolve(argv[i + 2]));
  }
  scanCaptionsJson();
  const facts = {};
  let timeline;
  const tlFile = path.join(OUT, "work", "timeline.json");
  if (flag("--assemble-only") || flag("--docs-only")) timeline = JSON.parse(fs.readFileSync(tlFile, "utf8"));
  else timeline = await record(facts);
  scanDownloads(timeline);
  const layout = computeLayout(timeline);
  log("layout", JSON.stringify({ total: layout.total.toFixed(1), chapters: layout.chapters.map((c) => `${c.key}@${mmss(c.t)}`) }));
  let cardsRec;
  const cardsFile = path.join(OUT, "work", "cards.json");
  if ((flag("--assemble-only") || flag("--docs-only")) && fs.existsSync(cardsFile) && !flag("--cards")) cardsRec = JSON.parse(fs.readFileSync(cardsFile, "utf8"));
  else {
    cardsRec = await recordCards(timeline, layout);
    fs.writeFileSync(cardsFile, JSON.stringify(cardsRec));
  }
  const summary = await assemble(timeline, cardsRec, layout, { docsOnly: flag("--docs-only") });
  log("DONE", JSON.stringify(summary, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
