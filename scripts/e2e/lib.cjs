const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "../..");
const SP = process.env.E2E_OUT || path.join(REPO, ".e2e-out");
const SCREENS = path.join(SP, "screens");
const OUT = path.join(SP, "final-outputs");
const BASE = process.env.BASE || "http://localhost:3107";
const EXE = process.env.PW_CHROMIUM || undefined; // undefined = Playwright's own Chromium

async function open({ profile = "desktop", width = 1440, height = 900, fresh = false } = {}) {
  const dir = path.join(SP, "e2e", `profile-${profile}`);
  if (fresh) fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: EXE, viewport: { width, height }, acceptDownloads: true });
  if (process.env.LIVE === "1") {
    // Live drafting: the passcode in this tab session's storage, as the mode dialog stores it (read from
    // .env.local, never printed).
    const env = fs.readFileSync(path.join(REPO, ".env.local"), "utf8");
    const pass = (env.match(/^MEDREPORT_LIVE_PASSCODE=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    await ctx.addInitScript((p) => { try { if (!sessionStorage.getItem("medreport.passcode")) sessionStorage.setItem("medreport.passcode", p); } catch {} }, pass);
  }
  const page = ctx.pages()[0] || (await ctx.newPage());
  const problems = [];
  const net = [];
  const hook = (p) => {
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`[${m.type()}] ${p.url().replace(BASE, "")} :: ${m.text().slice(0, 300)}`); });
    p.on("pageerror", (e) => problems.push(`[pageerror] ${p.url().replace(BASE, "")} :: ${String(e).slice(0, 300)}`));
    p.on("response", (r) => { if (r.status() >= 400) net.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  };
  hook(page);
  ctx.on("page", hook);
  return { ctx, page, problems, net };
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log("PASS", name, `${((Date.now() - t) / 1000).toFixed(1)}s`);
    return true;
  } catch (e) {
    results.push({ name, ok: false, err: String(e).split("\n").slice(0, 3).join(" | ") });
    console.log("FAIL", name, String(e).split("\n").slice(0, 4).join(" | "));
    return false;
  }
}
async function shot(page, name, full = true) {
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage: full });
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
function assert(c, msg) { if (!c) throw new Error("ASSERT: " + msg); }

// Neutral customer-facing wording (src/modules/medreport/core/wording.ts): no vendor, model or
// technology terms anywhere a customer can see or download. "AI" is matched as an uppercase word (also
// inside codes such as AI_ERROR) so "Aisha", "maintain" and "said" are fine.
const BANNED_AI = /(?:^|[^A-Za-z])(?:AI|A\.I\.)(?![A-Za-z])/g;
const BANNED_CI = /artificial intelligence|claude|anthropic|\bLLMs?\b|language model|\bGPT|machine learning|\bneural|\bprompts?\b|\bbots?\b|\bmodels?\b|opus-\d/gi;
function bannedIn(text) {
  const hits = [];
  for (const re of [BANNED_AI, BANNED_CI]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) hits.push(text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, " "));
  }
  return hits;
}
/** Visible text, accessible names, tooltips, placeholders and the page title/metadata of a page. */
async function neutralScan(page, label) {
  const parts = await page.evaluate(() => {
    const out = [document.title, document.body.innerText];
    for (const el of document.querySelectorAll("[aria-label],[title],[placeholder],[alt],[aria-description],[aria-valuetext],meta[name=description],meta[property],meta[name^='twitter']")) {
      for (const a of ["aria-label", "title", "placeholder", "alt", "aria-description", "aria-valuetext", "content"]) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    return out;
  });
  const hits = bannedIn(parts.join("\n"));
  if (hits.length) console.log(`   BANNED on ${label}:`, JSON.stringify(Array.from(new Set(hits)).slice(0, 8)));
  return hits;
}
module.exports = { open, step, shot, overflow, assert, results, SP, SCREENS, OUT, BASE, fs, path, bannedIn, neutralScan };
