#!/usr/bin/env node
/**
 * Mixes a trial clinic's help video from the recorder's app segment (record-help.mjs) and the narration clips:
 * title card (first two lines) → for each chapter a short chapter card, then that chapter's app footage → end card
 * (last line). Narration-driven: every clip starts at its line's recorded start (the recorder held each line for at
 * least its clip), so no clip is sped up or cut. Captions (each line's `caption`, two lines at most) are burned in at
 * the line times; a chapter chip sits top left over the app; the sped-up drafting wait carries "Sped up – real time
 * about N s" and each labelled jump cut a short "Skipped ahead" tag.
 *
 * Per-line options in narration.json: `captionPos: "right"` (bottom right instead of bottom centre, for a line whose
 * screen has its key control under the centre caption) and `startOnCard: <s>` (the line starts this long after its
 * chapter card appears, instead of with the chapter's first app frame).
 *
 * Optional <src>/mix-edits.json (all times in seconds of the app segment, work/clips/app-clean.mp4):
 *   holds    [{at, dur}]          insert a still of the frame at `at` for `dur` s (e.g. to land a click on its words)
 *   cuts     [{from, dur}]        drop `dur` s of source from `from` (only where the page is still – give a hold back)
 *   replaces [{from, to, frameAt}] show the still frame at `frameAt` instead of [from, to) (same length)
 *   zooms    [{from, ease, to?, window: {x, y, zoom}}]  ease into a zoom (window = top-left of the zoomed view in
 *            1920x1080 frame pixels at full zoom) and hold it to `to` (eased back out) or to the chapter's end
 * Each edit must fall inside one chapter's footage. Line starts, chapter times and labels follow the edits.
 *
 * Outputs (--out): <name>.mp4 (1920x1080 master, H.264 + AAC), <name>-email.mp4 (1280x720, mono 64 kb/s audio, at most
 * --email-mb MB so that it still fits an e-mail once encoded for sending), <name>.srt (the narration as spoken, at its
 * real times), chapters.txt, poster.png. Both videos carry the chapters, the title tag and no tool tags. The first
 * frame is the title card itself (no fade from black), so thumbnails show the title. Working files: <src>/work/mix.
 *
 *   NODE_PATH=<node_modules with playwright> node scripts/medreport/video/mix-help.mjs --src <help-video src> --out <dir> \
 *     [--name ClinForms-Blue-Heart-getting-started] [--chapter-cards 1.6] [--email-mb 13] [--frames <dir>] [--plan-only]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  log,
  esc,
  bannedIn,
  ff,
  probeDuration,
  srtTime,
  CARD_CSS,
  LOGO,
  findChromium,
  mmss,
} from "./video-kit.mjs";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);
const SRC = path.resolve(arg("--src", ""));
const OUT = path.resolve(arg("--out", ""));
if (!arg("--src") || !arg("--out"))
  throw new Error("--src and --out are required");
const NAME = arg("--name", "ClinForms-Blue-Heart-getting-started");
const WORK = path.join(SRC, "work");
const MIX = path.join(WORK, "mix");
const FRAMES = path.resolve(arg("--frames", path.join(MIX, "frames")));
const W = 1920;
const H = 1080;
const FPS = 30;
const CFG = {
  chapterCard: Number(arg("--chapter-cards", 1.6)), // seconds; 0 = no chapter cards
  titleLead: 0.7, // title card on screen before the first line
  titleGap: 0.45, // between the two title lines
  titleTail: 0.8, // after the second line
  endLead: 0.6,
  endTail: 3.0, // the end card stays this long after the last line (the last 0.8 s fade out)
  capTail: 0.35, // a caption stays this long after its line
  // E-mail attachments grow by about 37 % when encoded for sending (base64): 13 MB -> about 17.8 MB, which leaves
  // room for the welcome pack inside Outlook.com's 20 MB and Gmail's 25 MB limits.
  emailMB: Number(arg("--email-mb", 13)),
  lufs: -16,
  tp: -1.5,
  lra: 11,
  comp: "acompressor=threshold=-26dB:ratio=2:attack=1:release=150:knee=8:makeup=1,acompressor=threshold=-14dB:ratio=4:attack=0.5:release=50:knee=4:makeup=1",
  x264: ["-profile:v", "high", "-level:v", "4.0", "-x264-params", "ref=4"],
};
// No tool tags in the files: bit-exact muxing/encoding drops the Lavf/Lavc "encoder" tags, and filter_units drops the
// encoder's SEI note (NAL type 6, informational only) from the H.264 stream.
const CLEAN = ["-fflags", "+bitexact", "-bsf:v", "filter_units=remove_types=6"];
const TITLE = "ClinForms – your Blue Heart trial: getting started";
const TAGS = [
  "-color_range",
  "tv",
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
];
const FILES = {
  master: path.join(OUT, `${NAME}.mp4`),
  email: path.join(OUT, `${NAME}-email.mp4`),
  srt: path.join(OUT, `${NAME}.srt`),
  chapters: path.join(OUT, "chapters.txt"),
  poster: path.join(OUT, "poster.png"),
};
const TL = JSON.parse(
  fs.readFileSync(path.join(WORK, "timeline.json"), "utf8"),
);
const NARR = JSON.parse(
  fs.readFileSync(path.join(SRC, "narration.json"), "utf8"),
);
const VOICE = Object.fromEntries(
  JSON.parse(
    fs.readFileSync(path.join(SRC, "voice", "lines.json"), "utf8"),
  ).map((v) => [v.id, v]),
);
const APP = path.join(WORK, "clips", "app-clean.mp4");
const EDITS_FILE = path.join(SRC, "mix-edits.json");
const EDITS = fs.existsSync(EDITS_FILE)
  ? JSON.parse(fs.readFileSync(EDITS_FILE, "utf8"))
  : {};
const NARR_BY_ID = Object.fromEntries(NARR.map((l) => [l.id, l]));
const grid = (x) => Math.round(x * FPS) / FPS;
const CH_NAMES = [
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
const CH_WHO = {
  1: "Dell, the owner",
  2: "Dell, the owner",
  3: "Dell, the owner",
  4: "Sarah Reid, a made-up physio",
  5: "Sarah Reid, a made-up physio",
  6: "Sarah Reid, a made-up physio",
  7: "Dell, the owner",
  8: "Dell, the owner",
};

/* ---------------------------------------------------------------------------------------------
 * Plan: where every line, chapter and overlay lands in the final video
 * -------------------------------------------------------------------------------------------*/
/**
 * A chapter's footage as pieces in app time: {a, b} plays [a, b); {freeze, d} holds the frame at `freeze` for d s.
 * Holds, cuts and replaces inside [appA, appB) split the single piece; zooms are applied later (they keep time).
 */
function piecesFor(appA, appB) {
  const inside = (t) => t >= appA - 1e-6 && t < appB - 1e-6;
  const ops = [];
  for (const h of EDITS.holds || [])
    if (inside(h.at))
      ops.push({ at: grid(h.at), F: grid(h.at), d: grid(h.dur), skip: 0, edit: h });
  for (const c of EDITS.cuts || [])
    if (inside(c.from))
      ops.push({ at: grid(c.from), F: null, d: 0, skip: grid(c.dur), edit: c });
  for (const r of EDITS.replaces || [])
    if (inside(r.from)) {
      if (!inside(r.to) || !inside(r.frameAt))
        throw new Error(`replace ${JSON.stringify(r)} leaves its chapter`);
      ops.push({
        at: grid(r.from),
        F: grid(r.frameAt),
        d: grid(r.to - r.from),
        skip: grid(r.to - r.from),
        edit: r,
      });
    }
  ops.sort((x, y) => x.at - y.at);
  const pieces = [];
  let cur = appA;
  for (const o of ops) {
    if (o.at < cur - 1e-6)
      throw new Error(`overlapping edits near ${o.at}s: ${JSON.stringify(o.edit)}`);
    if (o.at > cur) pieces.push({ a: cur, b: o.at });
    if (o.d > 0) pieces.push({ freeze: o.F, d: o.d, edit: o.edit });
    cur = o.at + o.skip;
    if (cur > appB + 1e-6)
      throw new Error(`edit runs past its chapter: ${JSON.stringify(o.edit)}`);
  }
  if (cur < appB) pieces.push({ a: cur, b: appB });
  let local = 0;
  for (const p of pieces) {
    p.local = local;
    local += p.freeze !== undefined ? p.d : p.b - p.a;
  }
  return { pieces, len: local };
}
/** App time -> time within the chapter's (edited) footage; times inside a cut or replaced range map to its end. */
function appToLocal(s, t) {
  let last = 0;
  for (const p of s.pieces) {
    if (p.freeze !== undefined) {
      last = p.local + p.d;
      continue;
    }
    if (t < p.a) return Math.max(0, p.local);
    if (t < p.b) return p.local + (t - p.a);
    last = p.local + (p.b - p.a);
  }
  return Math.min(last, s.len);
}

function plan() {
  const dur = (id) => VOICE[id].trimmedDurationSec;
  const lines = [];
  // Title card: H01, H02.
  let t = CFG.titleLead;
  const titleLines = NARR.filter((l) => l.chapter === 0);
  for (const l of titleLines) {
    lines.push({ id: l.id, start: t, dur: dur(l.id) });
    t += dur(l.id) + CFG.titleGap;
  }
  const titleDur = Number((t - CFG.titleGap + CFG.titleTail).toFixed(3));
  // App chapters: footage from the chapter's start to the next chapter's start (last: to the end of the segment).
  const segs = [];
  let at = titleDur;
  const chs = TL.chapters;
  chs.forEach((c, i) => {
    const a = c.start;
    const b = i + 1 < chs.length ? chs[i + 1].start : TL.dur;
    const card = CFG.chapterCard;
    const { pieces, len } = piecesFor(a, b);
    segs.push({
      n: c.n,
      name: c.name,
      cardStart: at,
      card,
      appA: a,
      appB: b,
      start: at + card,
      pieces,
      len,
    });
    at += card + len;
  });
  const appEnd = at;
  const segOf = (appT) =>
    segs.find((x) => appT >= x.appA - 1e-6 && appT < x.appB - 1e-6) ||
    segs[segs.length - 1];
  const toFinal = (appT) => {
    const s = segOf(appT);
    return s.start + appToLocal(s, appT);
  };
  // A line belongs to its own chapter's footage (it never starts on the chapter card, even if it was logged a few
  // milliseconds before the chapter mark) – unless narration.json asks for it to start on the card (startOnCard).
  for (const l of TL.lines) {
    const s = segs.find((x) => x.n === l.chapter);
    const onCard = NARR_BY_ID[l.id] && NARR_BY_ID[l.id].startOnCard;
    let t = s ? s.start + appToLocal(s, l.start) : toFinal(l.start);
    if (s && onCard !== undefined && onCard !== null) {
      if (onCard < 0 || onCard >= s.card)
        throw new Error(`${l.id}: startOnCard must be within the ${s.card}s card`);
      t = s.cardStart + onCard;
    }
    lines.push({ id: l.id, start: Number(t.toFixed(3)), dur: dur(l.id) });
  }
  // End card: the last line.
  const endLine = NARR.filter(
    (l) => !TL.lines.some((x) => x.id === l.id) && l.chapter !== 0,
  );
  let e = appEnd + CFG.endLead;
  for (const l of endLine) {
    lines.push({ id: l.id, start: e, dur: dur(l.id) });
    e += dur(l.id) + 0.4;
  }
  const total = Number((e - 0.4 + CFG.endTail).toFixed(3));
  lines.sort((a, b) => a.start - b.start);
  // Overlap check (a clip must end before the next starts).
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].start - (lines[i - 1].start + lines[i - 1].dur);
    if (gap < 0.05)
      throw new Error(
        `${lines[i - 1].id} overlaps ${lines[i].id} by ${(-gap).toFixed(2)} s`,
      );
    lines[i - 1].gapAfter = Number(gap.toFixed(3));
  }
  const sped = (TL.sped || []).map((s) => ({
    ...s,
    fStart: toFinal(s.start),
    fEnd: toFinal(s.end),
  }));
  const jumps = (TL.jumps || []).map((j) => ({ ...j, f: toFinal(j.at) }));
  // Zooms, in each chapter's local (edited) time.
  const zooms = (EDITS.zooms || []).map((z) => {
    const s = segOf(z.from);
    const zs = grid(appToLocal(s, z.from));
    const ze =
      z.to === undefined || z.to === null ? s.len : grid(appToLocal(s, z.to));
    return { ...z, n: s.n, localFrom: zs, localTo: ze, fFrom: s.start + zs, fTo: s.start + ze };
  });
  const edits = segs.flatMap((s) =>
    s.pieces
      .filter((p) => p.freeze !== undefined)
      .map((p) => ({
        chapter: s.n,
        label: p.edit.label || "",
        frameAt: p.freeze,
        stillSec: p.d,
        fStart: Number((s.start + p.local).toFixed(3)),
      })),
  );
  return { titleDur, segs, appEnd, total, lines, sped, jumps, zooms, edits };
}

/* ---------------------------------------------------------------------------------------------
 * Cards, captions and tags (rendered with the app's own Inter font)
 * -------------------------------------------------------------------------------------------*/
async function appFont() {
  const cache = path.join(WORK, "font.json");
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const base = TL.base;
  const html = await (await fetch(`${base}/login`)).text();
  const links = Array.from(
    html.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)"/g),
  ).map((m) => m[1]);
  let css = "";
  for (const l of links) css += await (await fetch(base + l)).text();
  const faces = [];
  const seen = new Set();
  for (const f of css.match(/@font-face\{[^}]*\}/g) || []) {
    if (
      /unicode-range/i.test(f) &&
      !/unicode-range:[^;}]*u\+0(?:000-00ff|100-02)/i.test(f)
    )
      continue;
    const key = (f.match(/url\(([^)]+)\)/) || [])[1] || f;
    if (seen.has(key)) continue;
    seen.add(key);
    let out = f;
    for (const m of f.matchAll(/url\((\/_next\/[^)]+)\)/g)) {
      const buf = Buffer.from(await (await fetch(base + m[1])).arrayBuffer());
      out = out.replace(
        m[0],
        `url(data:font/woff2;base64,${buf.toString("base64")})`,
      );
    }
    faces.push(out);
  }
  const fam = (
    faces.find((f) => /Inter/.test(f) && !/Fallback/.test(f)) || ""
  ).match(/font-family:([^;]+);/);
  const res = { faces: faces.join("\n"), family: fam ? `${fam[1]}, ` : "" };
  fs.writeFileSync(cache, JSON.stringify(res));
  return res;
}

const NOTE =
  "Made-up notes only until your data processing agreement is signed. Forms completed in the trial are tests.";
function cardHtml(kind, font, extra = {}) {
  const ffam = `${font.family}Inter, system-ui, sans-serif`;
  const head = `<!doctype html><html><head><meta charset="utf-8"><style>${font.faces}${CARD_CSS}
    body{font-family:${ffam}} .sub{font-size:27px;color:#334155;margin-top:26px;line-height:1.4;max-width:1300px}
    .note{margin-top:34px;display:inline-flex;align-items:center;gap:14px;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;border-radius:16px;
      padding:16px 24px;font-size:24px;font-weight:600;max-width:1400px;line-height:1.35}
    .note i{flex:none;width:12px;height:12px;border-radius:50%;background:#f97316}
    .ch{font-size:96px;font-weight:800;letter-spacing:-.03em;color:#0d9488;line-height:1}
    .who{margin-top:22px;font-size:26px;color:#475569;font-weight:600}
    .center{margin:auto 0;padding-bottom:40px}
    .mail{font-size:40px;font-weight:700;color:#0f766e;margin-top:10px}
  </style></head><body><div class="wrap">`;
  const brand = `<div class="brand">${LOGO}<span>ClinForms</span></div>`;
  const foot = `<div class="foot"><span class="pill">Blue Heart Clinics · trial</span><span>clinforms.co.uk</span></div>`;
  if (kind === "title")
    return `${head}${brand}<div class="center"><div class="kicker">Getting started</div><h1>ClinForms – your Blue Heart trial:<br>getting started</h1>
      <div class="sub">For Dell Baines and the Blue Heart Clinics team</div>
      ${extra.note ? `<div class="note"><i></i>${esc(NOTE)}</div>` : `<div class="note" style="visibility:hidden"><i></i>${esc(NOTE)}</div>`}</div>${foot}</div></body></html>`;
  if (kind === "chapter")
    return `${head}${brand}<div class="center"><div class="kicker">Chapter ${extra.n} of 8</div><div class="ch" style="margin-top:22px">${extra.n}</div>
      <h1 style="margin-top:24px">${esc(extra.name)}</h1><div class="who">${esc(extra.who)}</div></div>${foot}</div></body></html>`;
  if (kind === "end")
    return `${head}${brand}<div class="center"><div class="kicker">That's it</div><h1>ClinForms · clinforms.co.uk</h1>
      <div class="sub">Help: <span class="mail">khuram@appstackx.co.uk</span></div>
      <div class="note"><i></i>${esc(NOTE)}</div></div>${foot}</div></body></html>`;
  throw new Error(kind);
}
const OVERLAY_CSS = (font) => `${font.faces}
  html,body{margin:0;background:transparent}
  body{font-family:${font.family}Inter, system-ui, sans-serif}
  .w{display:inline-block;padding:16px}
  .pill{background:rgba(15,23,42,.88);color:#fff;font-weight:600;font-size:30px;line-height:1.3;letter-spacing:.002em;padding:12px 30px 14px;border-radius:16px;
    box-shadow:0 10px 30px rgba(2,6,23,.35);text-align:center}
  .pill div{white-space:nowrap}
  .chip{box-sizing:border-box;display:inline-flex;flex-direction:column;gap:2px;background:rgba(255,255,255,.96);border-radius:12px;padding:8px 12px 9px;
    box-shadow:0 0 0 1px rgba(15,23,42,.12),0 4px 14px rgba(2,6,23,.14);max-width:178px}
  .chip b{font-size:14px;color:#0f766e;font-weight:700;letter-spacing:.02em}
  .chip span{font-size:14px;color:#0f172a;font-weight:600;line-height:1.22}
  .badge{display:inline-flex;align-items:center;gap:10px;background:#f59e0b;color:#1f2937;font-weight:700;font-size:24px;padding:10px 18px;border-radius:12px;
    box-shadow:0 6px 18px rgba(2,6,23,.25)}
  .badge i{width:0;height:0;border-left:13px solid #1f2937;border-top:9px solid transparent;border-bottom:9px solid transparent}
  .badge i+i{margin-left:-8px}
`;

async function renderAssets(pl) {
  const dir = path.join(MIX, "assets");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const font = await appFont();
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await (
    await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    })
  ).newPage();
  const scan = async (label) => {
    const text = await page.evaluate(() => document.body.innerText);
    const hits = bannedIn(text);
    if (hits.length)
      throw new Error(`banned term on ${label}: ${hits.join(" | ")}`);
  };
  const card = async (name, html) => {
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() =>
      document
        .querySelectorAll(".fade")
        .forEach((e) => e.classList.remove("fade")),
    );
    await scan(name);
    const f = path.join(dir, `${name}.png`);
    await page.screenshot({ path: f });
    return f;
  };
  const shot = async (name, inner) => {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${OVERLAY_CSS(font)}</style></head><body><div class="w">${inner}</div></body></html>`,
      { waitUntil: "load" },
    );
    await page.evaluate(() => document.fonts.ready);
    await scan(name);
    const f = path.join(dir, `${name}.png`);
    await page.locator(".w").screenshot({ path: f, omitBackground: true });
    const [w, h] = await page
      .locator(".w")
      .evaluate((e) => [e.offsetWidth, e.offsetHeight]);
    return { file: f, w, h };
  };
  const out = {
    title: await card("title", cardHtml("title", font)),
    titleNote: await card(
      "title-note",
      cardHtml("title", font, { note: true }),
    ),
    end: await card("end", cardHtml("end", font)),
    chapters: {},
    chips: {},
    captions: {},
  };
  for (const s of pl.segs) {
    out.chapters[s.n] = await card(
      `chapter-${s.n}`,
      cardHtml("chapter", font, { n: s.n, name: s.name, who: CH_WHO[s.n] }),
    );
    out.chips[s.n] = await shot(
      `chip-${s.n}`,
      `<div class="chip"><b>${s.n} of 8</b><span>${esc(s.name)}</span></div>`,
    );
  }
  for (const l of NARR)
    out.captions[l.id] = await shot(
      `cap-${l.id}`,
      `<div class="pill">${l.caption.map((x) => `<div>${esc(x)}</div>`).join("")}</div>`,
    );
  out.sped = pl.sped.map((s, i) => ({ ...s, img: null, i }));
  for (const s of out.sped)
    s.img = await shot(
      `sped-${s.i}`,
      `<span class="badge"><i></i><i></i>Sped up – real time about ${Math.round(s.real)} s</span>`,
    );
  out.skip = await shot(
    "skipped",
    `<span class="badge"><i></i><i></i>Skipped ahead</span>`,
  );
  await browser.close();
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Picture
 * -------------------------------------------------------------------------------------------*/
function enable(s, e) {
  return `between(t,${s.toFixed(3)},${e.toFixed(3)})`;
}
function renderPicture(pl, A, out) {
  const inputs = [];
  const g = [];
  let n = 0;
  const input = (args) => {
    inputs.push(...args);
    return n++;
  };
  const card = `scale=${W}:${H},setsar=1,fps=${FPS},format=rgb24`;
  const parts = [];
  // Title card, with the made-up-notes line fading in as the second line starts.
  const tIdx = input([
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-t",
    pl.titleDur.toFixed(3),
    "-i",
    A.title,
  ]);
  const tnIdx = input([
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-t",
    pl.titleDur.toFixed(3),
    "-i",
    A.titleNote,
  ]);
  const h02 = pl.lines.find((l) => l.id === "H02").start;
  g.push(
    `[${tIdx}:v]${card}[t0]`,
    `[${tnIdx}:v]${card},format=rgba,fade=t=in:st=${(h02 - 0.2).toFixed(3)}:d=0.5:alpha=1[tn]`,
  );
  g.push(
    // No fade-in: the very first frame is the title card, so mail and file thumbnails show the title, not black.
    `[t0][tn]overlay=0:0:format=rgb,format=rgb24,fade=t=out:st=${(pl.titleDur - 0.3).toFixed(3)}:d=0.3:color=white[p0]`,
  );
  parts.push("p0");
  const appIdx = input(["-i", APP]);
  g.push(
    `[${appIdx}:v]setsar=1,fps=${FPS},format=rgb24,split=${pl.segs.length}${pl.segs.map((_, i) => `[a${i}]`).join("")}`,
  );
  pl.segs.forEach((s, i) => {
    if (s.card > 0) {
      const cIdx = input([
        "-loop",
        "1",
        "-framerate",
        String(FPS),
        "-t",
        s.card.toFixed(3),
        "-i",
        A.chapters[s.n],
      ]);
      g.push(
        `[${cIdx}:v]${card},fade=t=in:st=0:d=0.25:color=white,fade=t=out:st=${(s.card - 0.25).toFixed(3)}:d=0.25:color=white[c${i}]`,
      );
      parts.push(`c${i}`);
    }
    const d = s.len;
    const P = s.pieces;
    const lo = 0.4 / FPS; // trim edges sit 0.4 frame before a grid time (trim rounds through microseconds,
    const hi = 0.6 / FPS; // so an edge exactly half a frame off can land either side)
    if (P.length === 1 && P[0].freeze === undefined)
      g.push(
        `[a${i}]trim=start=${s.appA.toFixed(4)}:end=${s.appB.toFixed(4)},setpts=PTS-STARTPTS[r${i}]`,
      );
    else {
      g.push(`[a${i}]split=${P.length}${P.map((_, k) => `[a${i}p${k}]`).join("")}`);
      P.forEach((p, k) => {
        if (p.freeze !== undefined)
          g.push(
            `[a${i}p${k}]trim=start=${(p.freeze - lo).toFixed(4)}:end=${(p.freeze + hi).toFixed(4)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${Math.round(p.d * FPS) - 1}[a${i}q${k}]`,
          );
        else
          g.push(
            `[a${i}p${k}]trim=start=${(k === 0 ? p.a : p.a - lo).toFixed(4)}:end=${(k === P.length - 1 ? p.b : p.b - lo).toFixed(4)},setpts=PTS-STARTPTS[a${i}q${k}]`,
          );
      });
      g.push(
        `${P.map((_, k) => `[a${i}q${k}]`).join("")}concat=n=${P.length}:v=1:a=0,setpts=N/(${FPS}*TB)[r${i}]`,
      );
    }
    let src = `r${i}`;
    for (const [zi, z] of pl.zooms.filter((x) => x.n === s.n).entries()) {
      const K = 4; // zoom on a 4x upscale, so the eased pan moves in quarter pixels (no jitter)
      const Z = z.window.zoom;
      const px = z.window.x / (1 - 1 / Z); // the fixed point of the zoom, in frame pixels
      const py = z.window.y / (1 - 1 / Z);
      const E = z.ease;
      const tIn = `clip(it/${E},0,1)`;
      const sIn = `(${tIn})*(${tIn})*(3-2*(${tIn}))`;
      const len = z.localTo - z.localFrom;
      const tOut = `clip((${len.toFixed(4)}-it)/${E},0,1)`;
      const sOut =
        z.to === undefined || z.to === null
          ? "1"
          : `(${tOut})*(${tOut})*(3-2*(${tOut}))`;
      const zexpr = `1+${(Z - 1).toFixed(4)}*min(${sIn},${sOut})`;
      const pre = `r${i}z${zi}pre`;
      const mid = `r${i}z${zi}mid`;
      const post = `r${i}z${zi}post`;
      const hasPost = len < d - z.localFrom - 1e-6;
      g.push(
        `[${src}]split=${hasPost ? 3 : 2}[${pre}i][${mid}i]${hasPost ? `[${post}i]` : ""}`,
        `[${pre}i]trim=end=${(z.localFrom - lo).toFixed(4)},setpts=PTS-STARTPTS[${pre}]`,
        `[${mid}i]trim=start=${(z.localFrom - lo).toFixed(4)}${hasPost ? `:end=${(z.localTo - lo).toFixed(4)}` : ""},setpts=PTS-STARTPTS,scale=${W * K}:${H * K}:flags=bicubic,` +
          `zoompan=z='${zexpr}':x='${(K * px).toFixed(2)}*(1-1/zoom)':y='${(K * py).toFixed(2)}*(1-1/zoom)':d=1:s=${W}x${H}:fps=${FPS},setsar=1,format=rgb24[${mid}]`,
      );
      if (hasPost)
        g.push(
          `[${post}i]trim=start=${(z.localTo - lo).toFixed(4)},setpts=PTS-STARTPTS[${post}]`,
        );
      g.push(
        `[${pre}][${mid}]${hasPost ? `[${post}]` : ""}concat=n=${hasPost ? 3 : 2}:v=1:a=0,setpts=N/(${FPS}*TB)[r${i}z${zi}]`,
      );
      src = `r${i}z${zi}`;
    }
    g.push(
      `[${src}]fade=t=in:st=0:d=0.2:color=white${i === pl.segs.length - 1 ? `,fade=t=out:st=${(d - 0.3).toFixed(3)}:d=0.3:color=white` : ""}[s${i}]`,
    );
    parts.push(`s${i}`);
  });
  const endDur = pl.total - pl.appEnd;
  const eIdx = input([
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-t",
    endDur.toFixed(3),
    "-i",
    A.end,
  ]);
  g.push(
    `[${eIdx}:v]${card},fade=t=in:st=0:d=0.35:color=white,fade=t=out:st=${(endDur - 0.8).toFixed(3)}:d=0.8[e]`,
  );
  parts.push("e");
  g.push(
    `${parts.map((p) => `[${p}]`).join("")}concat=n=${parts.length}:v=1:a=0[c0]`,
  );
  let last = "c0";
  const items = [];
  // Captions: with their line, until shortly after it (never into the next line).
  pl.lines.forEach((l, i) => {
    const next = i + 1 < pl.lines.length ? pl.lines[i + 1].start : pl.total;
    const s = l.start;
    const e = Math.min(l.start + l.dur + CFG.capTail, next - 0.08);
    const c = A.captions[l.id];
    const right = NARR_BY_ID[l.id] && NARR_BY_ID[l.id].captionPos === "right";
    items.push({
      file: c.file,
      x: right ? W - 12 - c.w : Math.round((W - c.w) / 2),
      y: H - 14 - c.h,
      s,
      e,
      fade: 0.18,
    });
  });
  // Chapter chips over the app footage (top left; the page keeps its left margin free at this width).
  pl.segs.forEach((s) => {
    const c = A.chips[s.n];
    items.push({
      file: c.file,
      x: 0,
      y: 0,
      s: s.start + 0.15,
      e: s.start + s.len - 0.1,
      fade: 0.25,
    });
  });
  for (const s of A.sped)
    items.push({
      file: s.img.file,
      x: W - s.img.w - 8,
      y: 8,
      s: s.fStart - 0.1,
      e: s.fEnd + 0.15,
      fade: 0.15,
    });
  for (const j of pl.jumps)
    items.push({
      file: A.skip.file,
      x: W - A.skip.w - 8,
      y: 8,
      s: j.f,
      e: j.f + 2.6,
      fade: 0.2,
    });
  items.forEach((c, i) => {
    const idx = input([
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-t",
      (c.e + 0.3).toFixed(3),
      "-i",
      c.file,
    ]);
    g.push(
      `[${idx}:v]format=rgba,fade=t=in:st=${c.s.toFixed(3)}:d=${c.fade}:alpha=1,fade=t=out:st=${(c.e - c.fade).toFixed(3)}:d=${c.fade}:alpha=1[k${i}]`,
      `[${last}][k${i}]overlay=x=${c.x}:y=${c.y}:format=rgb:eof_action=pass:enable='${enable(c.s, c.e)}'[o${i}]`,
    );
    last = `o${i}`;
  });
  g.push(
    `[${last}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]`,
  );
  const script = path.join(MIX, "picture.filter");
  fs.writeFileSync(script, g.join(";\n"));
  ff([
    ...inputs,
    "-/filter_complex",
    script,
    "-map",
    "[vout]",
    "-t",
    pl.total.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    ...CFG.x264,
    "-pix_fmt",
    "yuv420p",
    ...TAGS,
    "-r",
    String(FPS),
    "-an",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    out,
  ]);
  return items.length;
}

/* ---------------------------------------------------------------------------------------------
 * Narration (placed at the line starts; levelled like the outreach mix: gain, compression, limiter, linear loudnorm)
 * -------------------------------------------------------------------------------------------*/
function ffStderr(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(`ffmpeg failed: ${r.stderr.slice(-2000)}`);
  return r.stderr;
}
const lastJson = (s) =>
  JSON.parse(s.slice(s.lastIndexOf("{"), s.lastIndexOf("}") + 1));
function renderNarration(pl) {
  const inputs = [];
  const g = [];
  pl.lines.forEach((l, i) => {
    inputs.push("-i", path.join(SRC, VOICE[l.id].trimmedWav));
    g.push(
      `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,afade=t=in:st=0:d=0.012,afade=t=out:st=${(l.dur - 0.015).toFixed(4)}:d=0.015,adelay=delays=${Math.round(l.start * 1000)}:all=1[v${i}]`,
    );
  });
  g.push(
    `${pl.lines.map((_, i) => `[v${i}]`).join("")}amix=inputs=${pl.lines.length}:normalize=0:dropout_transition=0,apad=whole_dur=${pl.total.toFixed(3)},atrim=0:${pl.total.toFixed(3)}[mix]`,
  );
  const placed = path.join(MIX, "vo-placed.wav");
  const script = path.join(MIX, "narration.filter");
  fs.writeFileSync(script, g.join(";\n"));
  ff([
    ...inputs,
    "-/filter_complex",
    script,
    "-map",
    "[mix]",
    "-ar",
    "48000",
    "-ac",
    "1",
    "-c:a",
    "pcm_f32le",
    placed,
  ]);
  const ln = `loudnorm=I=${CFG.lufs}:TP=${CFG.tp}:LRA=${CFG.lra}`;
  const m0 = lastJson(
    ffStderr([
      "-i",
      placed,
      "-af",
      `${ln}:print_format=json`,
      "-f",
      "null",
      "-",
    ]),
  );
  const comp0 = path.join(MIX, "vo-compressed0.wav");
  ff([
    "-i",
    placed,
    "-af",
    `volume=${(CFG.lufs - Number(m0.input_i)).toFixed(2)}dB,${CFG.comp}`,
    "-ar",
    "48000",
    "-c:a",
    "pcm_f32le",
    comp0,
  ]);
  const mc = lastJson(
    ffStderr([
      "-i",
      comp0,
      "-af",
      `${ln}:print_format=json`,
      "-f",
      "null",
      "-",
    ]),
  );
  const pre = path.join(MIX, "vo-compressed.wav");
  ff([
    "-i",
    comp0,
    "-af",
    `volume=${(CFG.lufs - Number(mc.input_i)).toFixed(2)}dB`,
    "-ar",
    "48000",
    "-c:a",
    "pcm_f32le",
    pre,
  ]);
  let m1;
  let limited;
  let limit;
  for (const lim of [-2.3, -2.8, -3.3, -4]) {
    limit = lim;
    limited = path.join(MIX, "vo-limited.wav");
    ff([
      "-i",
      pre,
      "-af",
      `alimiter=limit=${(10 ** (lim / 20)).toFixed(4)}:attack=5:release=60:level=false:asc=1`,
      "-ar",
      "48000",
      "-c:a",
      "pcm_f32le",
      limited,
    ]);
    m1 = lastJson(
      ffStderr([
        "-i",
        limited,
        "-af",
        `${ln}:print_format=json`,
        "-f",
        "null",
        "-",
      ]),
    );
    if (Number(m1.input_tp) + (CFG.lufs - Number(m1.input_i)) <= CFG.tp - 0.05)
      break;
  }
  const final = path.join(MIX, "vo-final.wav");
  const m2 = lastJson(
    ffStderr([
      "-i",
      limited,
      "-af",
      `${ln}:measured_I=${m1.input_i}:measured_TP=${m1.input_tp}:measured_LRA=${m1.input_lra}:measured_thresh=${m1.input_thresh}:offset=${m1.target_offset}:linear=true:print_format=json,aresample=48000`,
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s24le",
      "-map_metadata",
      "-1",
      final,
    ]),
  );
  if (m2.normalization_type !== "linear")
    throw new Error(`loudnorm used ${m2.normalization_type} mode`);
  return { final, limit, loudnorm: m2.normalization_type };
}
function loudness(file) {
  const s = ffStderr([
    "-i",
    file,
    "-map",
    "0:a:0",
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  const tail = s.slice(s.lastIndexOf("Summary:"));
  const num = (re) => Number((tail.match(re) || [])[1]);
  return {
    I: num(/I:\s+(-?[\d.]+) LUFS/),
    LRA: num(/LRA:\s+(-?[\d.]+) LU/),
    TP: num(/Peak:\s+(-?[\d.]+) dBFS/),
  };
}
function speechStarts(file, pl) {
  const s = ffStderr([
    "-i",
    file,
    "-map",
    "0:a:0",
    "-af",
    "silencedetect=n=-45dB:d=0.18",
    "-f",
    "null",
    "-",
  ]);
  const ends = [...s.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  return pl.lines.map((l) => {
    const e = ends.find((x) => x >= l.start - 0.05 && x <= l.start + 0.3);
    return {
      id: l.id,
      planned: Number(l.start.toFixed(3)),
      heard: e === undefined ? null : Number(e.toFixed(3)),
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * Subtitles, chapters, poster
 * -------------------------------------------------------------------------------------------*/
const SPOKEN = (t) =>
  t
    .replace(
      /khuram at app stack X dot co dot U\.K\./i,
      "khuram@appstackx.co.uk.",
    )
    .replace(/\.\.$/, ".");
function wrap42(text) {
  if (text.length <= 42) return [text];
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") continue;
    const a = i;
    const b = text.length - i - 1;
    if (
      a <= 42 &&
      b <= 42 &&
      (best < 0 || Math.abs(a - b) < Math.abs(best - (text.length - best - 1)))
    )
      best = i;
  }
  return best > 0 ? [text.slice(0, best), text.slice(best + 1)] : [text];
}
function subtitleEvents(text, start, end) {
  const fits = (t) =>
    wrap42(t).length <= 2 && wrap42(t).every((x) => x.length <= 42);
  const parts = [];
  if (fits(text)) parts.push(text);
  else {
    const cands = [...text.matchAll(/\. |, | – |: /g)].map(
      (m) => m.index + (m[0] === " – " ? 2 : 1),
    );
    const mid = text.length / 2;
    // Prefer a sentence end (if neither part is very short), then the break nearest the middle.
    const sentence = (c) =>
      text[c - 1] === "." &&
      Math.min(c, text.length - c) >= 0.3 * text.length
        ? 0
        : 1;
    cands.sort(
      (a, b) =>
        sentence(a) - sentence(b) || Math.abs(a - mid) - Math.abs(b - mid),
    );
    const k = cands.find(
      (c) => fits(text.slice(0, c).trim()) && fits(text.slice(c).trim()),
    );
    if (k === undefined)
      throw new Error(`subtitle does not fit two lines: ${text}`);
    parts.push(text.slice(0, k).trim(), text.slice(k).trim());
  }
  const chars = parts.reduce((s, p) => s + p.length, 0);
  let t = start;
  return parts.map((p, i) => {
    const e =
      i === parts.length - 1 ? end : t + ((end - start) * p.length) / chars;
    const ev = { start: t, end: e, lines: wrap42(p) };
    t = e;
    return ev;
  });
}
function writeSrt(pl) {
  const ev = [];
  pl.lines.forEach((l, i) => {
    const next = i + 1 < pl.lines.length ? pl.lines[i + 1].start : pl.total;
    const text = SPOKEN(NARR.find((x) => x.id === l.id).line);
    ev.push(
      ...subtitleEvents(
        text,
        l.start + 0.03,
        Math.min(l.start + l.dur + CFG.capTail, next - 0.06),
      ),
    );
  });
  const srt = ev
    .map(
      (e, i) =>
        `${i + 1}\n${srtTime(e.start)} --> ${srtTime(e.end)}\n${e.lines.join("\n")}\n`,
    )
    .join("\n");
  const hits = bannedIn(srt);
  if (hits.length)
    throw new Error("banned terms in the subtitles: " + hits.join(" | "));
  fs.writeFileSync(FILES.srt, srt);
  return ev.length;
}
function writeChapters(pl) {
  const rows = [
    `0:00 Welcome`,
    ...pl.segs.map((s) => `${mmss(s.cardStart)} ${s.name}`),
    `${mmss(pl.appEnd)} Help: khuram@appstackx.co.uk`,
  ];
  // The help chapter (8) already covers the address; keep YouTube-style rows for the 9 chapters only.
  rows.pop();
  fs.writeFileSync(FILES.chapters, rows.join("\n") + "\n");
  // The same chapters as file metadata (players with a chapter menu show them).
  const marks = [
    { t: 0, name: "Welcome" },
    ...pl.segs.map((s) => ({ t: s.cardStart, name: s.name })),
  ];
  const escMeta = (x) => x.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const meta = [";FFMETADATA1"];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].t : pl.total;
    meta.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${Math.round(m.t * 1000)}`,
      `END=${Math.round(end * 1000)}`,
      `title=${escMeta(m.name)}`,
    );
  });
  fs.writeFileSync(CHAPTER_META, meta.join("\n") + "\n");
  return rows;
}
async function renderPoster(A, total) {
  const { chromium } = require("playwright");
  const font = await appFont();
  const bg = `data:image/png;base64,${fs.readFileSync(A.titleNote).toString("base64")}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${font.faces}
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
    body{position:relative;background:url(${bg}) 0 0 no-repeat;font-family:${font.family}Inter,system-ui,sans-serif}
    .play{position:absolute;right:190px;top:300px;width:220px;height:220px;border-radius:50%;background:rgba(13,148,136,.94);
      box-shadow:0 0 0 10px rgba(255,255,255,.85),0 24px 60px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center}
    .play svg{width:92px;height:92px;margin-left:12px}
    .badge{position:absolute;right:44px;bottom:110px;display:flex;align-items:center;gap:12px;background:rgba(15,23,42,.88);color:#fff;
      font-weight:600;font-size:30px;padding:12px 22px;border-radius:14px}
    .badge i{width:0;height:0;border-left:16px solid #fff;border-top:10px solid transparent;border-bottom:10px solid transparent}
  </style></head><body>
    <div class="play"><svg viewBox="0 0 24 24"><path d="M6 3.8v16.4a1 1 0 0 0 1.5.86l13.2-8.2a1 1 0 0 0 0-1.72L7.5 2.94A1 1 0 0 0 6 3.8z" fill="#fff"/></svg></div>
    <div class="badge"><i></i>Getting started · ${mmss(Math.round(total))}</div></body></html>`;
  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await (
    await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    })
  ).newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const big = path.join(MIX, "poster-1080.png");
  await page.screenshot({ path: big });
  await browser.close();
  ff(["-i", big, "-vf", "scale=1280:720:flags=lanczos", FILES.poster]);
}

/* ---------------------------------------------------------------------------------------------
 * Verification frames
 * -------------------------------------------------------------------------------------------*/
function verificationFrames(pl) {
  fs.mkdirSync(FRAMES, { recursive: true });
  for (const f of fs.readdirSync(FRAMES))
    fs.rmSync(path.join(FRAMES, f), { force: true });
  const shots = [];
  for (let t = 0.6; t < pl.total; t += 4)
    shots.push({ t, name: `t-${t.toFixed(1).padStart(5, "0")}` });
  pl.lines.forEach((l) =>
    shots.push({ t: l.start + 0.4, name: `line-${l.id}` }),
  );
  for (const s of shots)
    ff([
      "-ss",
      s.t.toFixed(3),
      "-i",
      FILES.master,
      "-frames:v",
      "1",
      "-vf",
      "scale=960:540:flags=lanczos",
      "-q:v",
      "3",
      path.join(FRAMES, `${s.name}.jpg`),
    ]);
  const sheets = [];
  const lineShots = shots.filter((s) => s.name.startsWith("line-"));
  for (let k = 0; k < lineShots.length; k += 4) {
    const group = lineShots.slice(k, k + 4);
    const ins = [];
    group.forEach((s) => ins.push("-i", path.join(FRAMES, `${s.name}.jpg`)));
    for (let j = group.length; j < 4; j++)
      ins.push("-f", "lavfi", "-i", "color=c=white:s=960x540:d=1");
    const out = path.join(
      FRAMES,
      `sheet-${String(k / 4 + 1).padStart(2, "0")}.jpg`,
    );
    ff([
      ...ins,
      "-filter_complex",
      "[0:v][1:v][2:v][3:v]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v]",
      "-map",
      "[v]",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      out,
    ]);
    sheets.push({ file: out, lines: group.map((s) => s.name) });
  }
  return { dir: FRAMES, count: shots.length, sheets: sheets.length };
}

const MB = (b) => Number((b / 1e6).toFixed(2));
const CHAPTER_META = path.join(MIX, "chapters.ffmeta");
function probe(file) {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,bit_rate:format_tags:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:stream_tags:chapter=start_time,end_time:chapter_tags",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
}

async function main() {
  fs.mkdirSync(MIX, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const pl = plan();
  log(
    `plan: title ${pl.titleDur}s, app ${TL.dur}s in ${pl.segs.length} chapters (+${CFG.chapterCard}s cards), end ${(pl.total - pl.appEnd).toFixed(2)}s, total ${pl.total}s (${mmss(pl.total)})`,
  );
  fs.writeFileSync(path.join(MIX, "plan.json"), JSON.stringify(pl, null, 1));
  if (flag("--plan-only")) return;
  const A = await renderAssets(pl);
  log("narration");
  const vo = renderNarration(pl);
  log("picture");
  const pic = path.join(MIX, "picture.mp4");
  const overlays = renderPicture(pl, A, pic);
  const picDur = probeDuration(pic);
  if (Math.abs(picDur - pl.total) > 0.08)
    throw new Error(`picture is ${picDur}s, planned ${pl.total}s`);
  const chapters = writeChapters(pl);
  log("master");
  ff([
    "-i",
    pic,
    "-i",
    vo.final,
    "-i",
    CHAPTER_META,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-flags:a",
    "+bitexact",
    ...CLEAN,
    "-t",
    pl.total.toFixed(3),
    // Global tags from the chapters file (none) – not "-1", which would also drop the chapter titles.
    "-map_metadata",
    "2",
    "-map_chapters",
    "2",
    "-metadata:s:v",
    "encoder=",
    "-metadata:s:a",
    "encoder=",
    "-metadata",
    `title=${TITLE}`,
    "-movflags",
    "+faststart",
    FILES.master,
  ]);
  log("e-mail version (1280x720)");
  let email = null;
  for (const crf of [27, 28, 29, 30, 31, 32]) {
    ff([
      "-i",
      pic,
      "-i",
      vo.final,
      "-i",
      CHAPTER_META,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-vf",
      "scale=1280:720:flags=lanczos:in_range=tv:out_range=tv",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(crf),
      "-tune",
      "stillimage",
      ...CFG.x264,
      "-pix_fmt",
      "yuv420p",
      ...TAGS,
      "-r",
      String(FPS),
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-flags:v",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      ...CLEAN,
      "-t",
      pl.total.toFixed(3),
      "-map_metadata",
      "2",
      "-map_chapters",
      "2",
      "-metadata:s:v",
      "encoder=",
      "-metadata:s:a",
      "encoder=",
      "-metadata",
      `title=${TITLE}`,
      "-movflags",
      "+faststart",
      FILES.email,
    ]);
    const size = fs.statSync(FILES.email).size;
    // Size once attached to an e-mail: base64 (4/3) plus a line break every 76 characters.
    const sent = Math.ceil(size / 3) * 4 * (78 / 76);
    email = { crf, bytes: size, MB: MB(size), asAttachmentMB: MB(sent) };
    log(`e-mail crf ${crf}: ${email.MB} MB`);
    if (size <= CFG.emailMB * 1e6) break;
  }
  const subs = writeSrt(pl);
  await renderPoster(A, pl.total);
  const frames = verificationFrames(pl);
  const probes = { master: probe(FILES.master), email: probe(FILES.email) };
  const metaText = JSON.stringify(probes);
  const metaHits = bannedIn(metaText).concat(
    (metaText.match(/eleven|labs|anthropic|claude|lavf|lavc|x264/gi) || []).map(
      (x) => `metadata: ${x}`,
    ),
  );
  const report = {
    made: new Date().toISOString(),
    totalSec: pl.total,
    length: mmss(pl.total),
    titleSec: pl.titleDur,
    chapterCardSec: CFG.chapterCard,
    chapters,
    overlays,
    master: {
      file: FILES.master,
      MB: MB(fs.statSync(FILES.master).size),
      loudness: loudness(FILES.master),
    },
    email: { file: FILES.email, ...email, loudness: loudness(FILES.email) },
    srt: { file: FILES.srt, events: subs },
    poster: FILES.poster,
    narration: vo,
    speechStarts: speechStarts(vo.final, pl),
    lines: pl.lines,
    sped: pl.sped.map(({ label, fStart, fEnd, real }) => ({
      label,
      fStart: Number(fStart.toFixed(2)),
      fEnd: Number(fEnd.toFixed(2)),
      real,
    })),
    jumps: pl.jumps.map(({ label, f }) => ({
      label,
      at: Number(f.toFixed(2)),
    })),
    edits: pl.edits,
    zooms: pl.zooms.map(({ label, fFrom, fTo, window }) => ({
      label,
      fFrom: Number(fFrom.toFixed(2)),
      fTo: Number(fTo.toFixed(2)),
      window,
    })),
    metadataHits: metaHits,
    probes,
    frames,
  };
  fs.writeFileSync(
    path.join(MIX, "mix-report.json"),
    JSON.stringify(report, null, 1),
  );
  log(
    "DONE",
    JSON.stringify(
      {
        total: report.totalSec,
        length: report.length,
        master: report.master,
        email: report.email,
        metaHits,
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
