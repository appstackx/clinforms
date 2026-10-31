// Shared helpers for the ClinDesk showcase recordings (local server only, fictional data only).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("/Users/khuram/Projects/Appstackx/pigeon-web/node_modules/playwright");

const SRC = "/Users/khuram/Projects/Appstackx/marketing/clindesk/showcase-video-v1-src";
const LOCAL = path.join(SRC, "local");
const APP = "http://clinic.localhost:3320";
const CREDS = path.join(LOCAL, "creds.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Offset (ms) between the server's story clock and the real clock (local/clock.txt from start-server.sh). */
function clockOffset() {
  const [iso, setAt] = fs.readFileSync(path.join(LOCAL, "clock.txt"), "utf8").trim().split(/\s+/);
  return Date.parse(iso) - Number(setAt);
}

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
function totp(keyB32, at) {
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
/** A two-step code on the server's (shifted) clock, not too close to the 30 s boundary. */
async function freshCode(keyB32) {
  const off = clockOffset();
  const left = 30000 - ((Date.now() + off) % 30000);
  if (left < 4000) await sleep(left + 300);
  return totp(keyB32, Date.now() + off);
}

function loadCreds() {
  try { return JSON.parse(fs.readFileSync(CREDS, "utf8")); } catch { return {}; }
}
function saveCreds(c) {
  fs.writeFileSync(CREDS, JSON.stringify(c, null, 2), { mode: 0o600 });
}

/** Browser-side clock shift, so "today" in the page is the story day too. */
function clockInit(off) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); }
    static now() { return RealDate.now() + off; }
  }
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  // eslint-disable-next-line no-global-assign
  Date = FakeDate;
}

/** Native-resolution capture: the window is w×h CSS px at device scale `scale` (frames are w*scale × h*scale). */
async function launch({ w = 1440, h = 810, scale = 2, headless = true } = {}) {
  const b = await chromium.launch({ headless, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", `--force-device-scale-factor=${scale}`, `--window-size=${w},${h}`] });
  b.__opts = { w, h, scale };
  return b;
}

/** A context for one user: viewport, device scale, story clock, saved session (if any). */
async function context(browser, who, { mobile = false } = {}) {
  const state = path.join(LOCAL, `state-${who}.json`);
  const ctx = await browser.newContext({
    viewport: null,
    ...(mobile ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}),
    acceptDownloads: true,
    locale: "en-GB",
    timezoneId: "Europe/London",
    storageState: fs.existsSync(state) ? state : undefined,
  });
  await ctx.addInitScript(clockInit, clockOffset());
  ctx.__state = state;
  return ctx;
}
async function saveState(ctx) {
  await ctx.storageState({ path: ctx.__state });
  fs.chmodSync(ctx.__state, 0o600);
}

/** Sign in (password + two-step) when the saved session has gone. */
async function ensureSignedIn(page, who) {
  const c = loadCreds()[who];
  await page.goto(`${APP}/app`);
  if (!/\/login|sign-in/.test(page.url())) return;
  await page.fill("input[type=email]", c.email);
  await page.fill("input[type=password]", c.password);
  await page.click("button[type=submit]");
  await page.waitForSelector("#f-code, input[name=code]", { timeout: 20000 });
  await page.fill("#f-code, input[name=code]", await freshCode(c.key));
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app/, { timeout: 20000 });
}

module.exports = { SRC, LOCAL, APP, sleep, totp, freshCode, loadCreds, saveCreds, launch, context, saveState, ensureSignedIn, clockOffset, base32Decode };
