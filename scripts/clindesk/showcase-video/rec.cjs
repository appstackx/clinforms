// Recorder for the showcase takes: CDP screencast of one page at native 2880x1620 (1440x810 CSS at scale 2),
// a drawn cursor with click ripple, presentation-only CSS, cuts (paused capture) and named marks in video time.
// Output per take: work/takes/<name>/frames/*.jpg, take.json {frames:[{file,t}], marks:{}, cuts:[]}, seq/ (30 fps).
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");

const now = () => Date.now() / 1000;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function overlayInit(cfg) {
  const css = cfg.css;
  if (window.top !== window) return;
  const build = () => {
    if (document.getElementById("__rec")) return;
    const host = document.createElement("div");
    host.id = "__rec";
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(15,59,53,.22);
        border:2.5px solid #fff;box-shadow:0 0 0 1.5px rgba(15,59,53,.6),0 3px 8px rgba(15,59,53,.35);transform:translate(-200px,-200px);
        transition:width .12s,height .12s,margin .12s,background .12s}
      .cur.down{width:20px;height:20px;margin:-10px 0 0 -10px;background:rgba(196,67,43,.55)}
      .rip{position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:3px solid #C4432B;opacity:.9;animation:rip .6s ease-out forwards}
      :host(.touch) .rip{width:34px;height:34px;margin:-17px 0 0 -17px;background:rgba(196,67,43,.25);border-width:2px}
      @keyframes rip{to{transform:var(--p) scale(3.4);opacity:0}}
      .hb{position:fixed;right:0;bottom:0;width:2px;height:2px}
    </style><div class="cur"></div><div class="hb"></div>`;
    if (cfg.touch) root.host.classList.add("touch");
    document.documentElement.appendChild(host);
    const st = document.createElement("style");
    st.textContent = "html{scroll-behavior:auto!important} " + (css || "");
    document.documentElement.appendChild(st);
    const cur = root.querySelector(".cur");
    if (cfg.touch) { cur.style.opacity = "0"; }
    const hb = root.querySelector(".hb");
    let on = 0;
    setInterval(() => { on ^= 1; hb.style.background = on ? "rgba(128,128,128,.035)" : "rgba(128,128,128,.02)"; }, 33);
    const p = window.__recPos;
    if (p) cur.style.transform = `translate(${p.x}px,${p.y}px)`;
    window.addEventListener("mousemove", (e) => { window.__recPos = { x: e.clientX, y: e.clientY }; cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, { capture: true, passive: true });
    window.addEventListener("mousedown", (e) => {
      cur.classList.add("down");
      const r = document.createElement("div"); r.className = "rip";
      r.style.setProperty("--p", `translate(${e.clientX}px,${e.clientY}px)`); r.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
      root.appendChild(r); setTimeout(() => r.remove(), 700);
    }, { capture: true, passive: true });
    window.addEventListener("mouseup", () => cur.classList.remove("down"), { capture: true, passive: true });
    window.__recHide = (h) => { cur.style.display = h ? "none" : ""; };
  };
  if (document.documentElement) build(); else document.addEventListener("readystatechange", build, { once: true });
  document.addEventListener("DOMContentLoaded", build);
}

class Take {
  constructor(name, { css = "", w = 1440, h = 810, scale = 2, mobile = false } = {}) {
    this.name = name;
    this.dir = path.join(L.SRC, "work/takes", name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(this.dir, "frames"), { recursive: true });
    this.opts = { css, w, h, scale, mobile };
    this.frames = []; this.marks = {}; this.cuts = []; this.n = 0; this.pending = 0;
    this.paused = true; this.pausedTotal = 0; this.pauseStart = now(); this.mouse = { x: w / 2, y: h / 2 };
    this.log = [];
  }
  vt(t = now()) { return t - this.t0 - this.pausedTotal - (this.paused ? t - this.pauseStart : 0); }
  async open(who) {
    const o = this.opts;
    this.browser = await L.launch({ w: o.w, h: o.h, scale: o.scale });
    this.ctx = await L.context(this.browser, who, { mobile: o.mobile });
    await this.ctx.addInitScript(overlayInit, { css: o.css, touch: o.mobile });
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(30000);
    if (who) await L.ensureSignedIn(this.page, who);
    return this.page;
  }
  async startCast() {
    const s = await this.ctx.newCDPSession(this.page);
    s.on("Page.screencastFrame", (f) => {
      const recv = now();
      s.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      if (this.paused) return;
      const file = `f${String(this.n++).padStart(6, "0")}.jpg`;
      this.pending++;
      fs.writeFile(path.join(this.dir, "frames", file), Buffer.from(f.data, "base64"), () => this.pending--);
      this.frames.push({ file, t: this.vt(recv) });
    });
    await s.send("Page.startScreencast", { format: "jpeg", quality: 90 });
    this.session = s;
    this.t0 = now(); this.pauseStart = this.t0; this.paused = true;
  }
  /** Start (or resume) capture. */
  async roll() {
    if (!this.session) await this.startCast();
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
    await this.page.waitForTimeout(120);
    if (this.paused) { this.pausedTotal += now() - this.pauseStart; this.paused = false; this.cuts.push(this.vt()); }
  }
  /** Pause capture (a hard cut in the take). */
  async cut() {
    await this.page.waitForTimeout(60);
    if (!this.paused) { this.paused = true; this.pauseStart = now(); }
  }
  mark(name) { this.marks[name] = +this.vt().toFixed(3); this.log.push(`${this.marks[name].toFixed(2)} ${name}`); }
  async hold(ms) { await this.page.waitForTimeout(ms); }
  async moveTo(x, y, ms = 650) {
    const p = this.page, from = { ...this.mouse };
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await p.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await p.waitForTimeout(ms / steps);
    }
    this.mouse = { x, y };
  }
  async box(loc) {
    await loc.waitFor({ state: "visible" });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error("no box");
    return b;
  }
  async moveToLoc(loc, ms = 650, dx = 0.5, dy = 0.5) {
    const b = await this.box(loc);
    await this.moveTo(b.x + b.width * dx, b.y + b.height * dy, ms);
    return b;
  }
  async click(loc, { ms = 650, pause = 260, mark } = {}) {
    await this.moveToLoc(loc, ms);
    await this.page.waitForTimeout(pause);
    if (mark) this.mark(mark);
    await this.page.mouse.down(); await this.page.waitForTimeout(70); await this.page.mouse.up();
  }
  async type(loc, text, { cps = 14, click = true } = {}) {
    if (click) await this.click(loc);
    else await loc.focus();
    await this.page.keyboard.type(text, { delay: 1000 / cps });
  }
  async scrollTo(y, ms = 900) {
    const p = this.page;
    const from = await p.evaluate(() => window.scrollY);
    const steps = Math.max(10, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const v = from + (y - from) * ease(i / steps);
      await p.evaluate((v) => window.scrollTo(0, v), v);
      await p.waitForTimeout(ms / steps);
    }
  }
  async scrollEl(sel, y, ms = 900) {
    const p = this.page;
    const from = await p.evaluate((s) => document.querySelector(s).scrollTop, sel);
    const steps = Math.max(10, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      await p.evaluate(([s, v]) => { document.querySelector(s).scrollTop = v; }, [sel, from + (y - from) * ease(i / steps)]);
      await p.waitForTimeout(ms / steps);
    }
  }
  async shot(name) { await this.page.screenshot({ path: path.join(this.dir, `${name}.png`) }); }
  async close() {
    await this.cut();
    if (this.session) await this.session.send("Page.stopScreencast").catch(() => {});
    while (this.pending > 0) await new Promise((r) => setTimeout(r, 20));
    await L.saveState(this.ctx).catch(() => {});
    await this.browser.close();
    const dur = this.frames.length ? this.frames[this.frames.length - 1].t + 0.5 : 0;
    fs.writeFileSync(path.join(this.dir, "take.json"), JSON.stringify({ name: this.name, dur, frames: this.frames, marks: this.marks, cuts: this.cuts, w: this.opts.w * this.opts.scale, h: this.opts.h * this.opts.scale }, null, 1));
    // 30 fps sequence (hard links to the latest frame at or before each tick).
    const seq = path.join(this.dir, "seq");
    fs.mkdirSync(seq, { recursive: true });
    let j = 0, k = 0;
    for (let t = 0; t < dur; t += 1 / 30, k++) {
      while (j + 1 < this.frames.length && this.frames[j + 1].t <= t) j++;
      fs.linkSync(path.join(this.dir, "frames", this.frames[j].file), path.join(seq, `${String(k).padStart(5, "0")}.jpg`));
    }
    console.log(`take ${this.name}: ${dur.toFixed(1)} s, ${this.frames.length} frames, ${k} seq`);
    console.log(this.log.join("\n"));
  }
}

module.exports = { Take, L };
