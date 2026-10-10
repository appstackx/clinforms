#!/usr/bin/env node
/**
 * Puts the narration under the ClinForms outreach video and builds the outreach deliverables.
 *
 * Inputs (all under --src, produced by record-outreach.mjs and the narration step):
 *   work/timeline.json          final.lines (recorded caption starts), final.shots, durationSec
 *   work/captions/captions.json caption PNGs, their positions, the corner tag and the cards
 *   work/clips/app-clean.mp4    the caption-free app segment with the punch-ins (high-quality intermediate)
 *   work/picture-clean.mp4      the caption-free master (only used to find still frames)
 *   voice/lines.json            one trimmed clip per line (voice/trimmed/line-NN.wav, levelled, 30 ms lead / 50 ms tail)
 *
 * Placement rules: each clip starts at its caption's start and never runs into the next line (min gap CFG.gap).
 * A line that is longer than its slot gets a small speed-up first (<= CFG.tempoSoft, inaudible); what is still
 * missing becomes a PICTURE HOLD (a frame repeated in the middle of a run of identical frames inside that line's
 * slot, so nothing visibly stops), or on the end card a longer end card. Only when a slot has no still run is the
 * clip sped up further, never beyond CFG.tempoHard. If the result is longer than --target, still frames are taken
 * out of the slots with the most spare time (never more than leaves CFG.trimMargin of that slot free). The title
 * card is shortened to --title seconds. Captions, the corner tag and the punch-in hides move with the edits.
 *
 * Picture: re-composed from the same sources as picture.mp4 (title card, app-clean.mp4, end card with the call to
 * action fading in as its line starts, caption PNGs, the corner tag), converted once to limited-range BT.709 (the most
 * widely supported tagging), H.264 High at level 4.0 (4 reference frames), CRF 18. The narration is mixed (fades
 * 12/15 ms), levelled (static gain, two-stage compression, a look-ahead limiter on the few remaining peaks) and
 * normalised with two-pass loudnorm in linear mode to about -16 LUFS, then muxed without re-encoding the picture.
 *
 * Outputs (in --out, the folder that is shared): ClinForms-demo.mp4, ClinForms-demo-email.mp4, ClinForms-demo.srt,
 * ClinForms-demo-poster.png, ClinForms-teaser.gif / .mp4 (from the recorder's teaser), README.md. Working files stay
 * under --src: work/mix/ holds plan.json, the placed narration (vo-final.wav) and the silent picture (picture-mixed.mp4).
 *
 * Usage:
 *   NODE_PATH=<dir with playwright> node scripts/medreport/video/mix-outreach.mjs --src <outreach-video-v1-src> --out <outreach-video-v1>
 *     [--plan-only] [--target 90] [--title <s>] [--frames <dir for verification frames>] [--email-crf 26]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ff, probeDuration, srtTime, bannedIn, log, findChromium } from "./video-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAP = JSON.parse(fs.readFileSync(path.join(HERE, "outreach-captions.json"), "utf8"));
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(n);
const OUT = path.resolve(arg("--out", process.env.VIDEO_OUT || "."));
const SRC = path.resolve(arg("--src", OUT));
const WORK = path.join(SRC, "work");
const MIX = path.join(WORK, "mix");
const FRAMES = path.resolve(arg("--frames", path.join(MIX, "frames")));
const FPS = 30;
const W = 1920;
const H = 1080;

const CFG = {
  gap: 0.22, // min silence between two clips (each clip also carries ~30 ms lead and ~50 ms tail)
  gapCta: 0.35, // pause before the closing call to action (last line)
  tail: 0.8, // end card after the last word (includes the 0.5 s fade to black)
  tempoSoft: 1.08, // speed-up used before a picture hold is added
  tempoHard: 1.15, // never faster than this
  holdMin: 0.04, // smaller overruns are absorbed by tempo
  titleSec: arg("--title", null) === null ? null : Number(arg("--title")), // null: keep the recorded title card
  target: Number(arg("--target", 90)),
  trimMax: 0.7, // most still picture removed from one slot
  trimMargin: 0.15, // spare time left in a slot after a trim
  stillThr: 0.005, // mean absolute grey difference (480x270) under which two frames count as identical
  edgeGuard: 0.15, // keep edits this far from a slot's ends
  crfMaster: 18,
  crfEmail: Number(arg("--email-crf", 26)),
  emailMaxMB: 18,
  lufs: -16,
  // Two-stage compression before the limiter (2:1 over the body of the speech, 4:1 with a fast attack on the peaks),
  // so the limiter only catches the last few transients (about 2 dB at most, measured on every build).
  comp: "acompressor=threshold=-26dB:ratio=2:attack=1:release=150:knee=8:makeup=1,acompressor=threshold=-14dB:ratio=4:attack=0.5:release=50:knee=4:makeup=1",
  x264: ["-profile:v", "high", "-level:v", "4.0", "-x264-params", "ref=4"],
  tp: -1.5,
  lra: 11,
  aacMaster: "160k",
  aacEmail: "96k",
};

const FILES = {
  master: path.join(OUT, "ClinForms-demo.mp4"),
  email: path.join(OUT, "ClinForms-demo-email.mp4"),
  srt: path.join(OUT, "ClinForms-demo.srt"),
  poster: path.join(OUT, "ClinForms-demo-poster.png"),
  gif: path.join(OUT, "ClinForms-teaser.gif"),
  teaser: path.join(OUT, "ClinForms-teaser.mp4"),
  readme: path.join(OUT, "README.md"),
};

/* ---------------------------------------------------------------------------------------------
 * Inputs
 * -------------------------------------------------------------------------------------------*/
const timeline = JSON.parse(fs.readFileSync(path.join(WORK, "timeline.json"), "utf8"));
const FIN = timeline.final;
const CAPS = JSON.parse(fs.readFileSync(path.join(WORK, "captions", "captions.json"), "utf8"));
const VOICE = JSON.parse(fs.readFileSync(path.join(SRC, "voice", "lines.json"), "utf8"));
const APP_FILE = path.join(WORK, "clips", "app-clean.mp4");
const CLEAN = path.join(WORK, "picture-clean.mp4");
const shotStart = (id) => FIN.shots.find((s) => s.id === id).start;
const fr = (t) => Math.round(t * FPS);
// On frame boundaries, so the title card, the recorded segment and the end card add up exactly.
const APP0 = fr(shotStart("S02")) / FPS; // title card before
const END0 = fr(shotStart("S07")) / FPS; // end card after
const DUR0 = FIN.durationSec;
const TITLE_F0 = fr(APP0);
const APP_F = fr(END0) - fr(APP0);
const END_F0 = fr(DUR0) - fr(END0);

const LINES = FIN.lines.map((l, i) => {
  const v = VOICE.find((x) => x.id === l.id);
  if (!v) throw new Error(`no narration clip for ${l.id}`);
  const capLine = CAP.lines.find((x) => x.id === l.id);
  return { i, id: l.id, c: l.start, D: v.trimmedDurationSec, file: path.join(SRC, v.trimmedWav), vo: capLine.vo, caption: l.caption, shot: capLine.shot, during: capLine.shotsDuring || [] };
});
const LAST = LINES.length - 1;

/* ---------------------------------------------------------------------------------------------
 * Still frames (from the caption-free master)
 * -------------------------------------------------------------------------------------------*/
function motion() {
  const cache = path.join(MIX, "motion.json");
  const size = fs.statSync(CLEAN).size;
  if (fs.existsSync(cache)) {
    const c = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (c.size === size) return c.d;
  }
  const w = 480;
  const h = 270;
  const n0 = w * h;
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", CLEAN, "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 31 - 1 });
  const n = Math.floor(buf.length / n0);
  const d = [];
  for (let i = 0; i + 1 < n; i++) {
    let s = 0;
    const a = i * n0;
    const b = a + n0;
    for (let k = 0; k < n0; k++) s += Math.abs(buf[a + k] - buf[b + k]);
    d.push(Number((s / n0).toFixed(4)));
  }
  fs.writeFileSync(cache, JSON.stringify({ size, frames: n, d }));
  return d;
}

/** Runs of identical frames [f0, f1] (inclusive) fully inside [t0, t1], longest first. */
function stillRuns(d, t0, t1, minFrames) {
  const runs = [];
  let i = Math.ceil(t0 * FPS);
  const end = Math.floor(t1 * FPS);
  while (i < end) {
    if (d[i] < CFG.stillThr) {
      let j = i;
      while (j < end && d[j] < CFG.stillThr) j++;
      // frames i..j are identical
      if (j - i + 1 >= minFrames) runs.push({ f0: i, f1: j, len: j - i + 1 });
      i = j + 1;
    } else i++;
  }
  return runs.sort((a, b) => b.len - a.len || b.f0 - a.f0);
}

/* ---------------------------------------------------------------------------------------------
 * Plan: tempo per clip, picture holds and trims (master frames), title and end card lengths
 * -------------------------------------------------------------------------------------------*/
function makeMapper(edits, titleF) {
  const sorted = [...edits].sort((a, b) => a.frame - b.frame);
  // New time of an original master time t.
  return (t) => {
    if (t <= APP0) return Math.min(t, titleF / FPS);
    const f = t * FPS;
    let g = f - TITLE_F0 + titleF;
    for (const e of sorted) {
      if (e.kind === "hold" && f >= e.frame + 1) g += e.n;
      if (e.kind === "trim") {
        if (f >= e.frame + e.n) g -= e.n;
        else if (f > e.frame) g -= f - e.frame;
      }
    }
    return g / FPS;
  };
}

function plan(d) {
  const titleF = CFG.titleSec === null ? TITLE_F0 : fr(CFG.titleSec);
  const edits = [];
  const P = LINES.map((l) => ({ id: l.id, c: l.c, D: l.D, tempo: 1, hold: 0, trim: 0, slack: 0, note: "" }));
  let N = makeMapper(edits, titleF);
  for (let i = 0; i < LAST; i++) {
    const p = P[i];
    const gap = i === LAST - 1 ? CFG.gapCta : CFG.gap;
    const slot = N(LINES[i + 1].c) - N(LINES[i].c);
    if (p.D + gap <= slot) {
      p.slack = slot - p.D - gap;
      continue;
    }
    p.tempo = Math.min(CFG.tempoSoft, p.D / (slot - gap));
    const rem = p.D / p.tempo + gap - slot;
    if (rem <= CFG.holdMin) {
      p.tempo = Math.max(1, p.D / (slot - gap));
      p.note = "small speed-up";
      continue;
    }
    if (i === LAST - 1) {
      // The last-but-one line runs on the end card: the end card simply stays up longer (set below).
      p.hold = rem;
      p.note = "end card held longer";
      continue;
    }
    const inApp = LINES[i].c >= APP0 && LINES[i + 1].c <= END0 + 1e-6;
    const runs = inApp ? stillRuns(d, LINES[i].c + CFG.edgeGuard, LINES[i + 1].c - CFG.edgeGuard, 3) : [];
    if (runs.length) {
      const r = runs[0];
      const n = Math.ceil(rem * FPS);
      edits.push({ kind: "hold", frame: Math.floor((r.f0 + r.f1) / 2), n, line: p.id, run: [r.f0 / FPS, r.f1 / FPS] });
      p.hold = n / FPS;
      p.note = `picture hold ${p.hold.toFixed(2)} s at ${(Math.floor((r.f0 + r.f1) / 2) / FPS).toFixed(2)} s`;
      N = makeMapper(edits, titleF);
    } else {
      p.tempo = p.D / (slot - gap);
      p.note = "no still frames in the slot: speed-up only";
      if (p.tempo > CFG.tempoHard) throw new Error(`${p.id}: needs x${p.tempo.toFixed(3)} (> ${CFG.tempoHard}) and its slot has no still frames`);
    }
  }
  const layout = () => {
    N = makeMapper(edits, titleF);
    const starts = LINES.map((l) => N(l.c));
    const durs = P.map((p) => p.D / p.tempo);
    starts[LAST] = Math.max(starts[LAST], starts[LAST - 1] + durs[LAST - 1] + CFG.gapCta);
    const endStart = N(END0);
    const endF = Math.max(END_F0, Math.ceil((starts[LAST] + durs[LAST] + CFG.tail - endStart) * FPS));
    return { starts, durs, endStart, endF, total: endStart + endF / FPS };
  };
  let L = layout();
  // Too long: take still frames out of the slots with the most spare time.
  if (L.total > CFG.target + 1e-6) {
    for (let i = 0; i < LAST; i++) {
      const gap = i === LAST - 1 ? CFG.gapCta : CFG.gap;
      P[i].slack = Math.max(0, L.starts[i + 1] - L.starts[i] - L.durs[i] - gap);
    }
    const cands = [];
    for (let i = 1; i < LAST - 1; i++) {
      if (P[i].hold || LINES[i].c < APP0 || LINES[i + 1].c > END0 + 1e-6) continue;
      const room = P[i].slack - CFG.trimMargin;
      if (room < 0.1) continue;
      const runs = stillRuns(d, LINES[i].c + CFG.edgeGuard, LINES[i + 1].c - CFG.edgeGuard, 8);
      if (runs.length) cands.push({ i, room, run: runs[0] });
    }
    cands.sort((a, b) => b.room - a.room);
    for (const c of cands) {
      const need = L.total - CFG.target;
      if (need <= 1e-6) break;
      const limit = Math.min(c.room, (c.run.len - 4) / FPS, CFG.trimMax);
      const n = Math.min(Math.floor(limit * FPS), Math.ceil(need * FPS));
      if (n < 3) continue;
      edits.push({ kind: "trim", frame: c.run.f0 + 2, n, line: P[c.i].id, run: [c.run.f0 / FPS, c.run.f1 / FPS] });
      P[c.i].trim = n / FPS;
      P[c.i].note = `still picture trimmed ${P[c.i].trim.toFixed(2)} s at ${((c.run.f0 + 2) / FPS).toFixed(2)} s`;
      L = layout();
    }
  }
  // Checks: no clip runs into the next one; tempo within the hard limit.
  const problems = [];
  for (let i = 0; i < LINES.length; i++) {
    if (P[i].tempo > CFG.tempoHard + 1e-9) problems.push(`${P[i].id} tempo ${P[i].tempo}`);
    if (i < LAST) {
      const gap = i === LAST - 1 ? CFG.gapCta : CFG.gap;
      const over = L.starts[i] + L.durs[i] + gap - L.starts[i + 1];
      if (over > 0.002) problems.push(`${P[i].id} overlaps ${P[i + 1].id} by ${over.toFixed(3)} s`);
    }
  }
  if (problems.length) throw new Error("placement problems:\n" + problems.join("\n"));
  return { CFG, titleF, edits: edits.sort((a, b) => a.frame - b.frame), P, L, N };
}

function printPlan(pl) {
  const { P, L } = pl;
  const rows = P.map((p, i) => {
    const s = L.starts[i];
    const e = s + L.durs[i];
    const next = i < LAST ? L.starts[i + 1] : L.total;
    return `${p.id}  caption ${p.c.toFixed(2).padStart(6)} -> ${s.toFixed(2).padStart(6)}  clip ${p.D.toFixed(2)} s x${p.tempo.toFixed(3)} = ${L.durs[i].toFixed(2)} s  ends ${e.toFixed(2).padStart(6)}  next ${next.toFixed(2).padStart(6)}  gap ${(next - e).toFixed(2)}  ${p.note}`;
  });
  log(`plan: title ${(pl.titleF / FPS).toFixed(2)} s, app ${(APP_F / FPS).toFixed(2)} s + edits, end card ${(L.endF / FPS).toFixed(2)} s (was ${(END_F0 / FPS).toFixed(2)}), total ${L.total.toFixed(3)} s (was ${DUR0})`);
  console.log(rows.join("\n"));
  console.log("edits:", pl.edits.map((e) => `${e.kind} ${e.line} ${(e.n / FPS).toFixed(2)} s at ${(e.frame / FPS).toFixed(2)} s (still ${e.run.map((x) => x.toFixed(2)).join("-")})`).join("; ") || "none");
}

/* ---------------------------------------------------------------------------------------------
 * Picture
 * -------------------------------------------------------------------------------------------*/
const TAGS = ["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];

/** An ffmpeg `enable` expression: inside [s, e], outside every `hide` interval and (if given) inside one `only` interval. */
function enableExpr(s, e, hide = [], only = null) {
  const parts = [`between(t,${s.toFixed(3)},${e.toFixed(3)})`];
  for (const [a, b] of hide) parts.push(`not(between(t,${a.toFixed(3)},${b.toFixed(3)}))`);
  if (only) parts.push(only.length ? `(${only.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+")})` : "0");
  return parts.join("*");
}

function renderPicture(pl, out) {
  const { titleF, edits, L, N } = pl;
  const titleDur = titleF / FPS;
  const endDur = L.endF / FPS;
  // App segment with the holds and trims (app-local frames).
  const segs = [];
  let cur = 0;
  for (const e of edits) {
    const k = e.frame - TITLE_F0;
    if (e.kind === "hold") {
      segs.push({ a: cur, b: k + 1, pad: e.n });
      cur = k + 1;
    } else {
      segs.push({ a: cur, b: k, pad: 0 });
      cur = k + e.n;
    }
  }
  segs.push({ a: cur, b: APP_F, pad: 0 });
  const appF = segs.reduce((s, x) => s + (x.b - x.a) + x.pad, 0);
  const appDur = appF / FPS;
  if (Math.abs(titleDur + appDur - L.endStart) > 0.001) throw new Error(`app length mismatch ${titleDur + appDur} vs ${L.endStart}`);
  // The call to action fades in on the end card just before its line (the last line) starts.
  const ctaLocal = Math.max(0.2, L.starts[LAST] - 0.15 - L.endStart);
  const inputs = [
    "-loop", "1", "-framerate", "30", "-t", titleDur.toFixed(3), "-i", CAPS.cards.title,
    "-i", APP_FILE,
    "-loop", "1", "-framerate", "30", "-t", endDur.toFixed(3), "-i", CAPS.cards.end,
    "-loop", "1", "-framerate", "30", "-t", endDur.toFixed(3), "-i", CAPS.cards.endCta,
  ];
  const card = `crop=${W}:${H}:0:0,setsar=1,fps=30,format=rgb24`;
  const g = [];
  g.push(`[0:v]${card},fade=t=in:st=0:d=0.35,fade=t=out:st=${(titleDur - 0.15).toFixed(3)}:d=0.15:color=white[t]`);
  g.push(`[1:v]setsar=1,split=${segs.length}${segs.map((_, j) => `[s${j}]`).join("")}`);
  segs.forEach((s, j) => g.push(`[s${j}]trim=start_frame=${s.a}:end_frame=${s.b},setpts=PTS-STARTPTS${s.pad ? `,tpad=stop=${s.pad}:stop_mode=clone` : ""}[g${j}]`));
  g.push(`${segs.map((_, j) => `[g${j}]`).join("")}concat=n=${segs.length}:v=1:a=0,format=rgb24,fade=t=in:st=0:d=0.15:color=white,fade=t=out:st=${(appDur - 0.15).toFixed(3)}:d=0.15:color=white[a]`);
  g.push(`[2:v]${card}[e0]`);
  g.push(`[3:v]crop=${W}:${H}:0:0,setsar=1,fps=30,format=rgba,fade=t=in:st=${ctaLocal.toFixed(3)}:d=0.45:alpha=1[cta]`);
  g.push(`[e0][cta]overlay=0:0:format=rgb,format=rgb24,fade=t=in:st=0:d=0.15:color=white,fade=t=out:st=${(endDur - 0.5).toFixed(3)}:d=0.5[e]`);
  g.push("[t][a][e]concat=n=3:v=1:a=0[c0]");
  let last = "c0";
  const mapIv = (iv) => (iv || []).map(([a, b]) => [N(a), N(b)]);
  const items = [
    ...CAPS.captions.map((c) => ({ ...c, s: N(c.start), e: N(c.end), fade: 0.2, hide: [], only: null })),
    { ...CAPS.tag, s: N(CAPS.tag.start), e: N(CAPS.tag.end), fade: 0.3, hide: mapIv(CAPS.tag.hide), only: null },
    ...(CAPS.tagZoom ? [{ ...CAPS.tagZoom, s: N(CAPS.tagZoom.start), e: N(CAPS.tagZoom.end), fade: 0, hide: [], only: mapIv(CAPS.tagZoom.only) }] : []),
  ];
  items.forEach((c, i) => {
    const idx = 4 + i;
    inputs.push("-loop", "1", "-framerate", "30", "-t", (c.e + 0.2).toFixed(3), "-i", c.file);
    const fades = c.fade ? `,fade=t=in:st=${c.s.toFixed(3)}:d=${c.fade}:alpha=1,fade=t=out:st=${(c.e - c.fade).toFixed(3)}:d=${c.fade}:alpha=1` : "";
    g.push(`[${idx}:v]format=rgba${fades}[k${i}]`, `[${last}][k${i}]overlay=x=${c.x}:y=${c.y}:format=rgb:eof_action=pass:enable='${enableExpr(c.s, c.e, c.hide, c.only)}'[o${i}]`);
    last = `o${i}`;
  });
  g.push(`[${last}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]`);
  ff([...inputs, "-filter_complex", g.join(";"), "-map", "[vout]", "-t", L.total.toFixed(3), "-c:v", "libx264", "-preset", "slow", "-crf", String(CFG.crfMaster), ...CFG.x264, "-pix_fmt", "yuv420p", ...TAGS, "-r", "30", "-an", "-map_metadata", "-1", "-movflags", "+faststart", out]);
  return {
    segments: segs,
    appDur,
    ctaAt: Number((L.endStart + ctaLocal).toFixed(3)),
    captions: items.map((c) => ({ id: c.id || "tag", start: Number(c.s.toFixed(3)), end: Number(c.e.toFixed(3)) })),
  };
}

/* ---------------------------------------------------------------------------------------------
 * Narration
 * -------------------------------------------------------------------------------------------*/
function ffStderr(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-2000)}`);
  return r.stderr;
}
const lastJson = (s) => JSON.parse(s.slice(s.lastIndexOf("{"), s.lastIndexOf("}") + 1));

function renderNarration(pl) {
  const { P, L } = pl;
  const inputs = [];
  const g = [];
  P.forEach((p, i) => {
    inputs.push("-i", LINES[i].file);
    const dur = L.durs[i];
    const chain = [];
    if (Math.abs(p.tempo - 1) > 1e-4) chain.push(`atempo=${p.tempo.toFixed(4)}`);
    chain.push("aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=mono", "afade=t=in:st=0:d=0.012", `afade=t=out:st=${(dur - 0.015).toFixed(4)}:d=0.015`, `adelay=delays=${Math.round(L.starts[i] * 1000)}:all=1`);
    g.push(`[${i}:a]${chain.join(",")}[v${i}]`);
  });
  g.push(`${P.map((_, i) => `[v${i}]`).join("")}amix=inputs=${P.length}:normalize=0:dropout_transition=0,apad=whole_dur=${L.total.toFixed(3)},atrim=0:${L.total.toFixed(3)}[mix]`);
  const placed = path.join(MIX, "vo-placed.wav");
  ff([...inputs, "-filter_complex", g.join(";"), "-map", "[mix]", "-ar", "48000", "-ac", "1", "-c:a", "pcm_f32le", placed]);
  const ln = `loudnorm=I=${CFG.lufs}:TP=${CFG.tp}:LRA=${CFG.lra}`;
  // Speech peaks sit ~19 dB above its loudness, more than -16 LUFS / -1.5 dBTP allows, so a straight gain would
  // overshoot and loudnorm would fall back to its dynamic (gain-riding) mode. Instead: static gain to the target,
  // a look-ahead peak limiter on the few transients, then loudnorm in LINEAR mode for the last fraction of a dB.
  const m0 = lastJson(ffStderr(["-i", placed, "-af", `${ln}:print_format=json`, "-f", "null", "-"]));
  const gain = CFG.lufs - Number(m0.input_i);
  // Static gain + a gentle compressor, then a second static gain back to the target (the compressor lowers the
  // loudness a little). Written out, so the limiter's own gain reduction can be measured against it.
  const comp0 = path.join(MIX, "vo-compressed0.wav");
  ff(["-i", placed, "-af", `volume=${gain.toFixed(2)}dB,${CFG.comp}`, "-ar", "48000", "-c:a", "pcm_f32le", comp0]);
  const mc = lastJson(ffStderr(["-i", comp0, "-af", `${ln}:print_format=json`, "-f", "null", "-"]));
  const gain2 = CFG.lufs - Number(mc.input_i);
  const pre = path.join(MIX, "vo-compressed.wav");
  ff(["-i", comp0, "-af", `volume=${gain2.toFixed(2)}dB`, "-ar", "48000", "-c:a", "pcm_f32le", pre]);
  let limited;
  let m1;
  let limit;
  for (const lim of [-2.3, -2.8, -3.3]) {
    limit = lim;
    limited = path.join(MIX, "vo-limited.wav");
    ff(["-i", pre, "-af", `alimiter=limit=${(10 ** (lim / 20)).toFixed(4)}:attack=5:release=60:level=false:asc=1`, "-ar", "48000", "-c:a", "pcm_f32le", limited]);
    m1 = lastJson(ffStderr(["-i", limited, "-af", `${ln}:print_format=json`, "-f", "null", "-"]));
    // linear mode is possible when the gain still to apply keeps the true peak under the target
    if (Number(m1.input_tp) + (CFG.lufs - Number(m1.input_i)) <= CFG.tp - 0.05) break;
  }
  const reduction = limiterReduction(pre, limited, 5);
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
  if (m2.normalization_type !== "linear") throw new Error(`loudnorm used ${m2.normalization_type} mode`);
  return { placed, final, placedLoudness: { I: Number(m0.input_i), TP: Number(m0.input_tp), LRA: Number(m0.input_lra) }, gainDb: Number(gain.toFixed(2)), gainAfterCompressorDb: Number(gain2.toFixed(2)), compressor: CFG.comp, limiterDbfs: limit, limiterReduction: reduction, pass1: m1, pass2: m2 };
}

/** Mono float PCM of a file at 48 kHz. */
function pcm(file) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 2 ** 31 - 1 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

/**
 * How much the limiter turned the signal down: per 5 ms window, the peak before (after the compressor) over the peak
 * after (shifted by the limiter's look-ahead), in dB. Returns the largest reduction and how many windows exceed 1 and 2 dB.
 */
function limiterReduction(preFile, postFile, lookaheadMs) {
  const a = pcm(preFile);
  const b = pcm(postFile);
  const lag = Math.round((lookaheadMs / 1000) * 48000);
  const win = 240;
  let max = 0;
  let at = 0;
  let over1 = 0;
  let over2 = 0;
  for (let i = 0; i + win + lag < Math.min(a.length, b.length); i += win) {
    let pa = 0;
    let pb = 0;
    for (let k = i; k < i + win; k++) {
      pa = Math.max(pa, Math.abs(a[k]));
      pb = Math.max(pb, Math.abs(b[k + lag]));
    }
    if (pa < 0.05) continue;
    const gr = 20 * Math.log10(pa / Math.max(pb, 1e-6));
    if (gr > max) {
      max = gr;
      at = i / 48000;
    }
    if (gr > 1) over1++;
    if (gr > 2) over2++;
  }
  return { maxDb: Number(max.toFixed(2)), atSec: Number(at.toFixed(2)), windowsOver1dB: over1, windowsOver2dB: over2 };
}

function loudness(file) {
  const s = ffStderr(["-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const tail = s.slice(s.lastIndexOf("Summary:"));
  const num = (re) => Number((tail.match(re) || [])[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/** Speech segments in the final narration (silencedetect), to check every line lands where it was planned. */
function speechSegments(file, total) {
  const s = ffStderr(["-i", file, "-map", "0:a:0", "-af", "silencedetect=n=-45dB:d=0.18", "-f", "null", "-"]);
  const starts = [...s.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...s.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  // speech = gaps between silences
  const segs = [];
  let t = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > t + 0.05) segs.push([t, starts[i]]);
    t = ends[i] ?? total;
  }
  if (t < total - 0.05) segs.push([t, total]);
  return segs.map(([a, b]) => [Number(a.toFixed(3)), Number(b.toFixed(3))]);
}

/* ---------------------------------------------------------------------------------------------
 * Subtitles (the narration as spoken, at the narration's times)
 * -------------------------------------------------------------------------------------------*/
const SUBTITLE_TEXT = (t) => t.replace(/fifteen-minute/g, "15-minute").replace(/clinforms dot co dot u\.?k\.?/gi, "clinforms.co.uk.").replace(/\.\.$/, ".");

function wrap42(text) {
  if (text.length <= 42) return [text];
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") continue;
    const a = i;
    const b = text.length - i - 1;
    if (a <= 42 && b <= 42 && (best < 0 || Math.abs(a - b) < Math.abs(best - (text.length - best - 1)))) best = i;
  }
  return best > 0 ? [text.slice(0, best), text.slice(best + 1)] : [text];
}

/** One line of narration as one or more subtitle events (split at clause breaks when it is over 2 x 42 characters). */
function subtitleEvents(text, start, end) {
  const parts = [];
  const fits = (t) => wrap42(t).length <= 2 && wrap42(t).every((x) => x.length <= 42);
  if (fits(text)) parts.push(text);
  else {
    // split at the clause break nearest the middle (", " or " – ")
    // split after the comma or the dash, so the punctuation ends the first event
    const cands = [...text.matchAll(/, | – /g)].map((m) => m.index + (m[0] === ", " ? 1 : 2));
    const mid = text.length / 2;
    cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const k = cands.find((c) => fits(text.slice(0, c).trim()) && fits(text.slice(c).trim()));
    if (k === undefined) throw new Error(`subtitle does not fit two lines: ${text}`);
    parts.push(text.slice(0, k).trim(), text.slice(k).trim());
  }
  const chars = parts.reduce((s, p) => s + p.length, 0);
  let t = start;
  return parts.map((p, i) => {
    const e = i === parts.length - 1 ? end : t + ((end - start) * p.length) / chars;
    const ev = { start: t, end: e, lines: wrap42(p) };
    t = e;
    return ev;
  });
}

function writeSrt(pl) {
  const { L } = pl;
  const events = [];
  LINES.forEach((l, i) => {
    const s = L.starts[i] + 0.03;
    const spokenEnd = L.starts[i] + L.durs[i];
    const next = i < LAST ? L.starts[i + 1] : L.total;
    const e = Math.min(spokenEnd + 0.35, next - 0.06);
    events.push(...subtitleEvents(SUBTITLE_TEXT(l.vo), s, e));
  });
  const srt = events.map((ev, i) => `${i + 1}\n${srtTime(ev.start)} --> ${srtTime(ev.end)}\n${ev.lines.join("\n")}\n`).join("\n");
  const hits = bannedIn(srt);
  if (hits.length) throw new Error("banned terms in the subtitles: " + hits.join(" | "));
  fs.writeFileSync(FILES.srt, srt);
  return events;
}

/* ---------------------------------------------------------------------------------------------
 * Poster (title card + play button + length badge), via the same browser as the cards
 * -------------------------------------------------------------------------------------------*/
async function renderPoster(total) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const font = JSON.parse(fs.readFileSync(path.join(WORK, "font.json"), "utf8"));
  const bg = `data:image/png;base64,${fs.readFileSync(CAPS.cards.title).toString("base64")}`;
  const len = `${Math.floor(Math.round(total) / 60)}:${String(Math.round(total) % 60).padStart(2, "0")}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${font.faces}
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
    body{position:relative;background:url(${bg}) 0 0 no-repeat;font-family:${font.family}Inter,system-ui,sans-serif}
    .play{position:absolute;left:${1470 - 115}px;top:${398 - 115}px;width:230px;height:230px;border-radius:50%;background:rgba(13,148,136,.94);
      box-shadow:0 0 0 10px rgba(255,255,255,.85),0 24px 60px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center}
    .play svg{width:96px;height:96px;margin-left:14px}
    .badge{position:absolute;right:44px;bottom:40px;display:flex;align-items:center;gap:12px;background:rgba(15,23,42,.88);color:#fff;
      font-weight:600;font-size:30px;padding:12px 22px;border-radius:14px;box-shadow:0 10px 30px rgba(2,6,23,.3)}
    .badge i{width:0;height:0;border-left:16px solid #fff;border-top:10px solid transparent;border-bottom:10px solid transparent}
  </style></head><body>
    <div class="play"><svg viewBox="0 0 24 24"><path d="M6 3.8v16.4a1 1 0 0 0 1.5.86l13.2-8.2a1 1 0 0 0 0-1.72L7.5 2.94A1 1 0 0 0 6 3.8z" fill="#fff"/></svg></div>
    <div class="badge"><i></i>Watch the demo · ${len}</div>
  </body></html>`;
  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const text = await page.evaluate(() => document.body.innerText);
  const hits = bannedIn(text);
  if (hits.length) throw new Error("banned terms on the poster: " + hits.join(" | "));
  const big = path.join(MIX, "poster-1080.png");
  await page.screenshot({ path: big });
  await browser.close();
  ff(["-i", big, "-vf", "scale=1280:720:flags=lanczos", FILES.poster]);
  return { file: FILES.poster, len };
}

/* ---------------------------------------------------------------------------------------------
 * Verification frames: every 3 s and 0.35 s after each caption / narration start
 * -------------------------------------------------------------------------------------------*/
function verificationFrames(pl, total) {
  fs.mkdirSync(FRAMES, { recursive: true });
  for (const f of fs.readdirSync(FRAMES)) if (/\.(png|jpg)$/.test(f)) fs.rmSync(path.join(FRAMES, f));
  const shots = [];
  for (let t = 0.5; t < total; t += 3) shots.push({ t, name: `t-${t.toFixed(1).padStart(4, "0")}` });
  LINES.forEach((l, i) => shots.push({ t: pl.L.starts[i] + 0.35, name: `line-${l.id}-${(pl.L.starts[i] + 0.35).toFixed(2)}` }));
  for (const s of shots) ff(["-ss", s.t.toFixed(3), "-i", FILES.master, "-frames:v", "1", "-vf", "scale=960:540:flags=lanczos", path.join(FRAMES, `${s.name}.png`)]);
  // 2x2 contact sheets (1920x1080) for reading
  const lineShots = shots.filter((s) => s.name.startsWith("line-"));
  const timeShots = shots.filter((s) => s.name.startsWith("t-"));
  const sheets = [];
  for (const [label, list] of [["time", timeShots], ["lines", lineShots]]) {
    for (let k = 0; k < list.length; k += 4) {
      const group = list.slice(k, k + 4);
      const ins = [];
      group.forEach((s) => ins.push("-i", path.join(FRAMES, `${s.name}.png`)));
      for (let j = group.length; j < 4; j++) ins.push("-f", "lavfi", "-i", "color=c=white:s=960x540:d=1");
      const out = path.join(FRAMES, `sheet-${label}-${String(k / 4 + 1).padStart(2, "0")}.jpg`);
      const lab = group.map((s, j) => `[${j}:v]drawbox=x=0:y=0:w=iw:h=ih:color=gray@0.6:t=2[i${j}]`);
      for (let j = group.length; j < 4; j++) lab.push(`[${j}:v]null[i${j}]`);
      ff([...ins, "-filter_complex", `${lab.join(";")};[i0][i1][i2][i3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "3", out]);
      sheets.push({ file: out, frames: group.map((s) => s.name) });
    }
  }
  return { dir: FRAMES, count: shots.length, sheets };
}

/* ---------------------------------------------------------------------------------------------
 * Probe helpers
 * -------------------------------------------------------------------------------------------*/
function probe(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size,bit_rate:format_tags:stream=index,codec_type,codec_name,profile,level,refs,width,height,r_frame_rate,nb_frames,pix_fmt,color_range,color_space,sample_rate,channels,bit_rate:stream_tags", "-of", "json", file], { encoding: "utf8" }));
  return j;
}
const MB = (b) => Number((b / 1e6).toFixed(2));

/* ---------------------------------------------------------------------------------------------
 * README for the deliverables folder (for whoever sends the outreach; internal, never attached)
 * -------------------------------------------------------------------------------------------*/
function writeReadme(r) {
  // A reviewer's notes on this build (work/mix/review.md), included verbatim when present.
  const reviewFile = path.join(MIX, "review.md");
  const review = fs.existsSync(reviewFile) ? fs.readFileSync(reviewFile, "utf8") : "";
  const gen = fs.existsSync(path.join(SRC, "voice", "generation.json")) ? JSON.parse(fs.readFileSync(path.join(SRC, "voice", "generation.json"), "utf8")) : null;
  const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  const len = r.poster.len;
  const v = (k) => r.probes[k].streams.find((s) => s.codec_type === "video");
  const a = (k) => r.probes[k].streams.find((s) => s.codec_type === "audio");
  const lvl = (k) => (v(k).level ? (v(k).level / 10).toFixed(1) : "?");
  const gifInfo = v("gif");
  const holds = r.edits.filter((e) => e.kind === "hold");
  const trims = r.edits.filter((e) => e.kind === "trim");
  const sped = r.lines.filter((l) => l.tempo > 1.0005);
  const srcRel = path.relative(OUT, SRC);
  const md = `# ClinForms outreach video (v1)

> **Internal notes for the sender – do not attach or forward this README.** Send or host only the six media files
> below. Working files (recording, narration clips, storyboard, scripts' inputs) are in \`${srcRel}/\`, outside this folder.

A ${len} demo of ClinForms for owners and managers of UK private physiotherapy clinics, made for cold outreach
e-mails. It opens with five different fictional referrer forms (the problem), then follows one fictional patient
(Megan Hart) on one fictional referrer form (Harrow & Pike Medico-Legal (fictional), Word): a new referrer form
uploaded and its mapping checked once, the answers drafted from the notes into the referrer's own layout, the source
note behind an answer, the prognosis gap flagged instead of guessed, the physiotherapist's own opinion and approval,
the completed Word form, and the approved answers copied for an insurer's portal. It ends on "Their form, your
notes, your clinician's sign-off" and "Book a 15-minute call · clinforms.co.uk · khuram@appstackx.co.uk".
All data on screen is fictional.

## Files

| File | What it is | Length | Size | Format |
|---|---|---|---|---|
| \`ClinForms-demo.mp4\` | Master: narration + short on-screen captions burned in | ${mmss(r.totalSec)} | ${r.master.MB} MB | ${v("master").width}x${v("master").height}, 30 fps, H.264 High @ level ${lvl("master")}, AAC stereo ${Math.round(a("master").bit_rate / 1000)} kb/s, ${r.master.loudness.I} LUFS |
| \`ClinForms-demo-email.mp4\` | Same video, lighter encode for attaching to an e-mail | ${mmss(r.totalSec)} | ${r.email.MB} MB | ${r.email.scale.replace(":", "x")}, CRF ${r.email.crf}, H.264 High @ level ${lvl("email")}, AAC stereo ${Math.round(a("email").bit_rate / 1000)} kb/s, ${r.email.loudness.I} LUFS |
| \`ClinForms-demo.srt\` | Subtitles: the narration word for word, at the narration's times (${r.srt.events} cues) | ${mmss(r.totalSec)} | ${(fs.statSync(r.srt.file).size / 1000).toFixed(1)} kB | SRT, UTF-8 |
| \`ClinForms-demo-poster.png\` | Thumbnail for e-mails and links: title card with a play button and "Watch the demo · ${len}" | – | ${MB(fs.statSync(r.poster.file).size)} MB | 1280x720 PNG |
| \`ClinForms-teaser.gif\` | Silent looping teaser: title frame with play badge → five fictional forms → completed form → source note → gap flagged → call to action | ${r.teaser.seconds} s | ${r.teaser.gifMB} MB | ${gifInfo.width}x${gifInfo.height}, ${gifInfo.r_frame_rate.split("/").reduce((x, y) => Number(x) / Number(y))} fps, loops |
| \`ClinForms-teaser.mp4\` | The same teaser as a silent MP4 | ${r.teaser.seconds} s | ${r.teaser.mp4MB} MB | 1280x720, 30 fps, H.264, no audio |

## Using it in outreach

- **First (cold) e-mail: link, don't attach.** Put the master on a page you control (for example an unlisted video
  link or a page on clinforms.co.uk), then paste \`ClinForms-demo-poster.png\` (or \`ClinForms-teaser.gif\`) into the
  e-mail as an image that links to it. Attachments from an unknown sender are more likely to be filtered, and a
  tracked link shows who watched. Suggested alt text: "ClinForms – ${len} demo (fictional patient data)".
- **The GIF** shows movement in the inbox; it is ${r.teaser.gifMB} MB, under the usual 3 MB comfort limit. Its first
  frame is a title frame ("ClinForms – Every referrer's own report form, completed from your notes – Watch the demo ·
  ${len}" with a play button), so a desktop mail app that shows only the first frame (some Outlook versions) still
  shows a readable, clickable title. Use the poster if you want one static, crisp image.
- **Replies and warm leads: attach \`ClinForms-demo-email.mp4\`** (${r.email.MB} MB, well under Gmail's 25 MB limit).
  Gmail and most phones play it inline (H.264 level ${lvl("email")}, which older phones and mail previews accept).
- **Hosting the master:** upload \`ClinForms-demo.mp4\`; add \`ClinForms-demo.srt\` as closed captions (accessibility,
  search). The master already has short captions in the picture, so leave the closed captions off by default.
- **One-line lead-in that matches the video:** "Here is a ${len} look at how ClinForms completes each referrer's own
  report form from your notes – every answer shows its source, and nothing leaves until your physio approves it."
- Don't present it as a customer's real case: the patient, clinicians, referrers and forms are fictional (the corner
  tag and the end card say so).

## Narration (as spoken, with start times in this cut)

${r.lines.map((l) => `- ${mmss(l.start)} – ${l.vo}`).join("\n")}

## How the picture and narration fit

- The recording runs on the narration's clock: each action is scheduled from the start of its line, so a screen that
  belongs to the next line never appears before the current line has been spoken (checked below).
- Each narration clip starts at its caption's recorded start and never runs into the next line (at least
  ${r.config.gap.toFixed(2)} s apart; ${r.config.gapCta.toFixed(2)} s before the closing call to action).
- Picture holds (a frame repeated inside a run of identical frames, so nothing visibly stops): ${holds.map((e) => `${e.line} +${e.sec.toFixed(2)} s`).join(", ") || "none"}; the end card runs ${r.endCardSec.toFixed(2)} s.
- Still frames taken out to stay within ${r.config.target} s: ${trims.map((e) => `${e.line} −${e.sec.toFixed(2)} s`).join(", ") || "none"}; the title card runs ${r.titleSec.toFixed(1)} s.
- Speed-ups: ${sped.map((l) => `${l.id} x${l.tempo.toFixed(3)}`).join(", ") || "none – every line plays at its natural speed"}.
- Loudness: ${r.narration.measured.I} LUFS integrated, true peak ${r.narration.measured.TP} dBTP, LRA ${r.narration.measured.LRA} LU. Static gain, two-stage compression (2:1 over the speech, 4:1 with a fast attack on the peaks), then a look-ahead limiter that turns the loudest peak down by ${r.narration.limiterReduction.maxDb} dB (${r.narration.limiterReduction.windowsOver2dB} of the 5 ms windows by more than 2 dB), then two-pass loudnorm in linear mode. Clip fades 12 ms in / 15 ms out.
- The end card shows the tagline while it is spoken; the call to action fades in at ${mmss(r.ctaAt)}, as its line starts.
- Picture: converted once to limited-range BT.709 (the tagging every player and mail preview expects), H.264 High
  level 4.0 with 4 reference frames; the master's picture was muxed without a second encode.

## Checks done (${r.made.slice(0, 10)})

- Durations and streams: master ${r.probes.master.format.duration} s (video ${v("master").nb_frames} frames + stereo audio), e-mail ${r.probes.email.format.duration} s (stereo audio), teaser ${r.probes.teaser.format.duration} s, GIF ${r.probes.gif.format.duration} s.
- Loudness as played (both channels): master ${r.master.loudness.I} LUFS, e-mail ${r.email.loudness.I} LUFS.
- Every narration line was found in the final audio at its planned start (silence detection; largest offset ${r.narration.startCheck.maxOffset.toFixed(3)} s, the clips' 30 ms lead included), no overlaps.
- Screen changes: ${r.junctions.filter((j) => j.early > 0.08).length ? `${r.junctions.filter((j) => j.early > 0.08).length} screen(s) appear before the previous line ends: ${r.junctions.filter((j) => j.early > 0.08).map((j) => `${j.shot} ${j.early.toFixed(2)} s early`).join(", ")}` : `each line's first screen appears once the previous line has been spoken (${r.junctions.length} junctions; the closest is ${Math.min(...r.junctions.map((j) => j.screenAt - j.previousLineEnds)).toFixed(2)} s after the previous line's last word, which includes the clip's 0.1 s tail)`}.
- Picture edits are inside runs of identical frames (checked on the caption-free master before editing).
- GIF frame 0 (what a first-frame-only mail app shows) was extracted and read: \`${path.relative(OUT, r.gifFrame0)}\`.
- File metadata carries only a neutral title ("ClinForms demo"); subtitles, poster and this README pass the banned-term scan.
- ${r.frames.count} verification frames (every 3 s and 0.35 s after each line starts) and 2x2 contact sheets were written
  to ${r.frames.dir.startsWith(SRC + path.sep) ? `\`${path.relative(OUT, r.frames.dir)}\`` : "the folder given with --frames"}.

## Voice-over (internal provenance)

${gen ? `- Generated with ${gen.provider}; voice "${gen.voice.name.split(" - ")[0]}" (\`${gen.voice.voiceId}\`, ${gen.voice.accent}), \`${gen.engine || "eleven_v4"}\`, one clip per line.
- Flow: "${gen.flowName}" – ${gen.flowUrl} (open it from the account that owns the connector; the link may need \`?mode=switchWorkspace\`).
- ${gen.passes.map((p) => `${p.date} ${p.label}: ${p.lines}`).join("\n- ")}
- Credits: ${gen.credits.summary}
- Every clip was checked with speech-to-text (Scribe) against the script: ${gen.transcription.result}.
- The original downloads carried content credentials that mark the audio as synthetic; these were removed along with
  all other file metadata. Decide whether to say "voice-over generated" wherever the video is hosted.` : "- voice/generation.json not found."}

## Rebuilding

From the \`sales/outreach-video\` worktree (\`clinforms-wt/video\`), with its demo server running on port 3310 in demo mode
(see \`scripts/medreport/video/README.md\` there):

\`\`\`bash
NODE_PATH=<node_modules with playwright> node scripts/medreport/video/record-outreach.mjs --src ${SRC}   # the take (about 3 min)
NODE_PATH=<node_modules with playwright> node scripts/medreport/video/mix-outreach.mjs --src ${SRC} --out ${OUT}
#   --plan-only   print the placement only     --target 90   longest allowed length (s)
\`\`\`
${review ? `\n## Manual review\n\n${review.trim()}\n` : ""}`;
  const hits = bannedIn(md);
  if (hits.length) throw new Error("banned terms in README: " + hits.join(" | "));
  fs.writeFileSync(FILES.readme, md);
}

/* ---------------------------------------------------------------------------------------------
 * Main
 * -------------------------------------------------------------------------------------------*/
async function main() {
  fs.mkdirSync(MIX, { recursive: true });
  const d = motion();
  const pl = plan(d);
  printPlan(pl);
  if (flag("--plan-only")) return;
  const { L } = pl;

  log("narration: placing, mixing, normalising");
  const vo = renderNarration(pl);
  const voLoud = loudness(vo.final);
  log(`narration ${JSON.stringify(voLoud)} (loudnorm ${vo.pass2.normalization_type})`);

  log("picture: re-composing with the holds and trims");
  const pic = path.join(MIX, "picture-mixed.mp4");
  // Re-use the silent picture when nothing that shapes it changed (same edits, card lengths and sources).
  const picKey = JSON.stringify({ edits: pl.edits, titleF: pl.titleF, endF: L.endF, total: L.total, cta: L.starts[LAST], app: fs.statSync(APP_FILE).size, caps: CAPS.captions.map((c) => [c.id, c.start, c.end, c.x, c.y]), tag: [CAPS.tag, CAPS.tagZoom], crf: CFG.crfMaster, x264: CFG.x264 });
  const picMeta = path.join(MIX, "picture-mixed.json");
  let picInfo;
  if (fs.existsSync(pic) && fs.existsSync(picMeta) && JSON.parse(fs.readFileSync(picMeta, "utf8")).key === picKey) {
    picInfo = JSON.parse(fs.readFileSync(picMeta, "utf8")).info;
    log("picture unchanged: re-using work/mix/picture-mixed.mp4");
  } else {
    picInfo = renderPicture(pl, pic);
    fs.writeFileSync(picMeta, JSON.stringify({ key: picKey, info: picInfo }));
  }
  const picDur = probeDuration(pic);
  if (Math.abs(picDur - L.total) > 0.05) throw new Error(`picture is ${picDur} s, planned ${L.total}`);

  log("master: muxing (picture copied, not re-encoded)");
  ff(["-i", pic, "-i", vo.final, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac_at", "-b:a", CFG.aacMaster, "-ac", "2", "-ar", "48000", "-t", L.total.toFixed(3), "-map_metadata", "-1", "-metadata", "title=ClinForms demo", "-movflags", "+faststart", FILES.master]);

  log("e-mail version");
  let email = null;
  for (const [crf, scale] of [[CFG.crfEmail, null], [CFG.crfEmail + 2, null], [CFG.crfEmail + 2, "1600:900"], [30, "1600:900"], [32, "1600:900"]]) {
    const vf = scale ? ["-vf", `scale=${scale}:flags=lanczos:in_range=tv:out_range=tv`] : [];
    // Two identical channels (a mono AAC track plays on both speakers about 3 dB louder than the stereo master).
    ff(["-i", pic, "-i", vo.final, "-map", "0:v:0", "-map", "1:a:0", ...vf, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-tune", "stillimage", ...CFG.x264, "-pix_fmt", "yuv420p", ...TAGS, "-r", "30", "-c:a", "aac_at", "-b:a", CFG.aacEmail, "-ac", "2", "-ar", "48000", "-t", L.total.toFixed(3), "-map_metadata", "-1", "-metadata", "title=ClinForms demo", "-movflags", "+faststart", FILES.email]);
    const size = fs.statSync(FILES.email).size;
    email = { crf, scale: scale || `${W}:${H}`, bytes: size, MB: MB(size) };
    log(`e-mail encode crf ${crf} ${email.scale}: ${email.MB} MB`);
    if (size <= CFG.emailMaxMB * 1e6) break;
  }

  log("subtitles, poster, teaser");
  const subs = writeSrt(pl);
  const poster = await renderPoster(L.total);
  fs.copyFileSync(path.join(WORK, "teaser.gif"), FILES.gif);
  // What a mail app that shows only the first frame of the GIF shows.
  const gifFrame0 = path.join(MIX, "gif-frame0.png");
  ff(["-i", FILES.gif, "-frames:v", "1", gifFrame0]);
  // The teaser MP4 again from the recorder's 1080p teaser, with the same limited-range BT.709 tagging as the masters.
  ff(["-i", path.join(WORK, "teaser-1080.mp4"), "-vf", "format=rgb24,scale=1280:720:flags=lanczos,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", ...TAGS, "-r", "30", "-an", "-map_metadata", "-1", "-movflags", "+faststart", FILES.teaser]);

  log("checks");
  const masterLoud = loudness(FILES.master);
  const emailLoud = loudness(FILES.email);
  const speech = speechSegments(vo.final, L.total);
  // Each line must begin a speech segment close to its planned start (the clip carries ~30 ms of lead-in).
  const offsets = LINES.map((l, i) => {
    const seg = speech.find((s) => s[0] >= L.starts[i] - 0.02 && s[0] <= L.starts[i] + 0.12);
    if (!seg) throw new Error(`${l.id}: no speech starts near ${L.starts[i].toFixed(3)} s`);
    return seg[0] - L.starts[i];
  });
  const startCheck = { maxOffset: Math.max(...offsets.map(Math.abs)), offsets: offsets.map((x) => Number(x.toFixed(3))) };
  // Screen changes against the narration: the first screen of each line must not appear before the previous line
  // has been spoken (a later screen change inside a line is part of that line).
  const junctions = [];
  for (let i = 1; i < LINES.length; i++) {
    const shot = FIN.shots.find((s) => s.id === LINES[i].shot);
    // A screen that the previous line itself introduces (shotsDuring) is part of that line.
    if (!shot || shot.id === LINES[i - 1].shot || LINES[i - 1].during.includes(shot.id)) continue;
    const at = pl.N(shot.start);
    const prevEnd = L.starts[i - 1] + L.durs[i - 1];
    junctions.push({ line: LINES[i].id, shot: shot.id, screenAt: Number(at.toFixed(3)), previousLineEnds: Number(prevEnd.toFixed(3)), early: Number(Math.max(0, prevEnd - at).toFixed(3)) });
  }
  const earlyScreens = junctions.filter((j) => j.early > 0.08);
  if (earlyScreens.length) log(`WARNING: a screen appears before the previous line has finished: ${JSON.stringify(earlyScreens)}`);
  const frames = verificationFrames(pl, L.total);
  const probes = Object.fromEntries(["master", "email", "teaser", "gif"].map((k) => [k, probe(FILES[k])]));
  // Metadata must not name tools or vendors.
  const metaText = JSON.stringify(probes);
  const metaHits = bannedIn(metaText).concat((metaText.match(/eleven|labs|anthropic|claude/gi) || []).map((x) => `metadata: ${x}`));
  if (metaHits.length) throw new Error("metadata names a tool or vendor: " + metaHits.join(" | "));

  const report = {
    made: new Date().toISOString(),
    config: CFG,
    sources: { timeline: path.join(WORK, "timeline.json"), app: APP_FILE, voice: path.join(OUT, "voice", "lines.json") },
    titleSec: pl.titleF / FPS,
    endCardSec: L.endF / FPS,
    totalSec: Number(L.total.toFixed(3)),
    edits: pl.edits.map((e) => ({ kind: e.kind, line: e.line, at: Number((e.frame / FPS).toFixed(3)), sec: Number((e.n / FPS).toFixed(3)), stillRun: e.run.map((x) => Number(x.toFixed(2))) })),
    lines: pl.P.map((p, i) => ({
      id: p.id,
      captionRecorded: p.c,
      start: Number(L.starts[i].toFixed(3)),
      end: Number((L.starts[i] + L.durs[i]).toFixed(3)),
      clipSec: p.D,
      tempo: Number(p.tempo.toFixed(4)),
      playedSec: Number(L.durs[i].toFixed(3)),
      gapToNext: i < LAST ? Number((L.starts[i + 1] - L.starts[i] - L.durs[i]).toFixed(3)) : Number((L.total - L.starts[i] - L.durs[i]).toFixed(3)),
      note: p.note,
      vo: LINES[i].vo,
    })),
    captions: picInfo.captions,
    ctaAt: picInfo.ctaAt,
    junctions,
    gifFrame0,
    narration: { gainDb: vo.gainDb, compressor: vo.compressor, limiterDbfs: vo.limiterDbfs, limiterReduction: vo.limiterReduction, placedLoudness: vo.placedLoudness, loudnorm: vo.pass2, measured: voLoud, speechSegments: speech, startCheck },
    master: { file: FILES.master, MB: MB(fs.statSync(FILES.master).size), loudness: masterLoud },
    email: { file: FILES.email, ...email, loudness: emailLoud },
    srt: { file: FILES.srt, events: subs.length },
    poster,
    teaser: { gif: FILES.gif, gifMB: MB(fs.statSync(FILES.gif).size), mp4: FILES.teaser, mp4MB: MB(fs.statSync(FILES.teaser).size), seconds: Number(FIN.teaser.seconds.toFixed(1)) },
    probes,
    frames,
  };
  fs.writeFileSync(path.join(MIX, "plan.json"), JSON.stringify(report, null, 1));
  writeReadme(report);
  log("DONE", JSON.stringify({ total: report.totalSec, master: report.master, email: report.email, frames: frames.dir }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
