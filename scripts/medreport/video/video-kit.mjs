/**
 * Shared machinery for the ClinForms screen-recording scripts (record-demo.mjs, record-outreach.mjs):
 * timing helpers, the banned-term patterns, the in-page overlay (cursor dot, click ripple, heartbeat, optional
 * chapter bar / caption / question card), the Chrome DevTools screencast capture, the scripted cursor and
 * scrolling (BaseDirector), the ffmpeg frame-concat helpers, SRT helpers and the card styles.
 * Nothing here talks to a particular demo flow; the recorders drive the app themselves.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/* ---------------------------------------------------------------------------------------------
 * Small helpers
 * -------------------------------------------------------------------------------------------*/
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Date.now() / 1000;
export const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
export const words = (t) => t.split(/\s+/).filter(Boolean).length;
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** On-screen length of a sped-up live wait: about 3 s (12 s -> 2.5 s, 17 s -> 3.4 s, 30 s -> 3.5 s). */
export const spedDuration = (real) => Math.min(real, Math.max(2.5, Math.min(3.5, real / 5)));
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The browser to use: $CHROMIUM_PATH, then the newest /opt/pw-browsers/chromium-* (Linux), then Playwright's own. */
export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = "/opt/pw-browsers";
  if (fs.existsSync(root)) {
    const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    const exe = dir && path.join(root, dir, "chrome-linux", "chrome");
    if (exe && fs.existsSync(exe)) return exe;
  }
  return undefined; // Playwright's default
}

/* ---------------------------------------------------------------------------------------------
 * Banned customer-facing terms (same rules as the neutral-wording checks of the app)
 * "AI" is matched as an uppercase word (also inside codes such as AI_ERROR), so "Aisha", "maintain",
 * "said" and "[CLAIMANT]" are fine; everything else is case-insensitive.
 * -------------------------------------------------------------------------------------------*/
export const BANNED_AI = /(?:^|[^A-Za-z])(?:AI|A\.I\.)(?![A-Za-z])/g;
export const BANNED_CI =
  /artificial intelligence|claude|anthropic|\bLLMs?\b|language models?|\bGPT|machine learning|\bneural|\bprompts?\b|\bbots?\b|\bmodels?\b|\bopus\b|\bsonnet\b|\bhaiku\b|opus-\d|sonnet-\d/gi;
export function bannedIn(text) {
  const hits = [];
  for (const re of [BANNED_AI, BANNED_CI]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) hits.push(text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, " "));
  }
  return hits;
}

/* ---------------------------------------------------------------------------------------------
 * Injected overlay: chapter bar (in a 36 px strip reserved at the top of the page), caption bar,
 * question card, cursor dot with click ripple. Runs in every document of the recording context.
 * Pass it to addInitScript with options: { bar: false } drops the chapter bar and its reserved strip (the page keeps
 * its own layout), barRight is the bar's right-hand label, liftToasts: false leaves the Studio's toasts where they are,
 * css is extra presentation-only CSS for the app.
 * -------------------------------------------------------------------------------------------*/
export function overlayInit(opts) {
  opts = opts || {};
  const BAR = opts.bar !== false;
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
  const STRIP_CSS = [
    // Reserve a 36 px strip at the top for the chapter bar: push the page down and keep the Studio's
    // sticky header and the sticky side panels of the review and form-mapping screens below it.
    "body { padding-top: 36px !important; }",
    "header.sticky.top-0 { top: 36px !important; }",
    ".top-\\[4\\.25rem\\] { top: calc(4.25rem + 36px) !important; }",
    ".max-h-\\[calc\\(100vh-5\\.25rem\\)\\] { max-height: calc(100vh - 5.25rem - 36px) !important; }",
    ".h-\\[calc\\(100vh-5\\.25rem\\)\\] { height: calc(100vh - 5.25rem - 36px) !important; }",
    "@media (min-width: 1024px) { .lg\\:top-\\[96px\\] { top: 132px !important; } .lg\\:h-\\[calc\\(100vh-154px\\)\\] { height: calc(100vh - 190px) !important; } }",
  ];
  const APP_CSS = [
    ...(BAR ? STRIP_CSS : []),
    // Our scripted scrolling animates frame by frame; smooth-scroll CSS would fight it.
    "html { scroll-behavior: auto !important; }",
    // The Studio's toasts (bottom right) would sit half under the caption bar: lift them above it.
    ...(opts.liftToasts === false ? [] : ['div[aria-live="polite"].fixed.inset-x-0.bottom-20 { bottom: 236px !important; }']),
    opts.css || "",
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
      <div class="bar empty"><span class="chip"></span><span class="label"></span><span class="right"></span></div>
      <div class="qw"><div class="qc"><div class="qk"></div><div class="ql"></div><div class="qt"></div><div class="qs">From your e-mail</div></div></div>
      <div class="cap"><div class="capin"></div></div><div class="cur"></div><div class="hb"></div>`;
    root.querySelector(".right").textContent = opts.barRight || "";
    if (!BAR) root.querySelector(".bar").style.display = "none";
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
 * Screencast capture
 * -------------------------------------------------------------------------------------------*/
export class Cast {
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
export async function pageText(page) {
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
 * BaseDirector: events, cuts, the scripted cursor, scrolling, clicks and typing (no captions)
 * -------------------------------------------------------------------------------------------*/
export class BaseDirector {
  constructor(cast, view) {
    this.cast = cast;
    this.view = view;
    this.events = [];
    this.state = {};
    this.mouse = { x: view.w / 2, y: view.h / 2 };
    this.capMinEnd = 0;
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
      await this.moveTo(this.view.w - 36, this.view.h - 70, 420);
      for (let i = 0; i < 8 && (await open()); i++) await sleep(100);
    }
    this.tooltipsClosed.push(txt);
    log("tooltip closed:", txt.replace(/\s+/g, " "));
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
 * Assembly helpers (ffmpeg concat of screencast frames)
 * -------------------------------------------------------------------------------------------*/
export function ff(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}
export function probeDuration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}

/** Kept intervals of [a,b] after removing cut ranges, then split at the sped-up live waits: [start, end, rate]. */
export function keptIntervals(a, b, cuts, speeds = [], sped = spedDuration) {
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
    const rate = (sp.t1 - sp.t0) / sped(sp.t1 - sp.t0);
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
export function mapper(kept) {
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
export const keptTotal = (kept) => kept.reduce((s, [x, y, r]) => s + (y - x) / r, 0);

export function writeConcat(frames, kept, dir, listFile) {
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

/* ---------------------------------------------------------------------------------------------
 * Subtitles and cards
 * -------------------------------------------------------------------------------------------*/
export const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** Two lines at most, split near the middle on a space. */
export function wrapSrt(text) {
  // two lines max, split near the middle on a space
  if (text.length <= 64) return text;
  const mid = Math.floor(text.length / 2);
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best > 0 ? `${text.slice(0, best)}\n${text.slice(best + 1)}` : text;
}

/** Card styles shared by the recorders' title and end cards (styled like the Studio). */
export const CARD_CSS = `
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
export const LOGO = `<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div>`;

/** The text of a downloaded final document (PDF via pdftotext, Word via its XML parts), for the banned-term scans. */
export function documentText(file) {
  if (file.endsWith(".pdf")) return execFileSync("pdftotext", [file, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (file.endsWith(".docx")) {
    const names = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
      .split("\n")
      .filter((n) => /^(word\/.*\.xml|docProps\/.*\.xml)$/.test(n));
    return names.map((n) => execFileSync("unzip", ["-p", file, n], { encoding: "utf8", maxBuffer: 64 << 20 }).replace(/<[^>]+>/g, " ")).join("\n");
  }
  return "";
}
