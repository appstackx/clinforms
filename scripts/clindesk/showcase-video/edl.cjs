// The edit: narration placement, chapter cards, product shots (with camera moves), rings, callouts, tags and captions.
// Writes work/timeline.json for motion/engine.js (render.cjs) and finish.cjs (sound, SRT, chapters).
const fs = require("fs");
const path = require("path");
const SRC = path.resolve(__dirname, "..");
const paras = JSON.parse(fs.readFileSync(path.join(SRC, "voice/paras.json"), "utf8"));
const P = Object.fromEntries(paras.map((p) => [p.id, p]));
const takes = {};
for (const d of fs.readdirSync(path.join(SRC, "work/takes"))) {
  const f = path.join(SRC, "work/takes", d, "take.json");
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  takes[d] = { seq: `../work/takes/${d}/seq`, n: fs.readdirSync(path.join(SRC, "work/takes", d, "seq")).length, W: j.w, H: j.h, marks: j.marks, dur: j.dur };
}
const M = (take, mark) => {
  const v = takes[take].marks[mark];
  if (v === undefined) throw new Error(`no mark ${take}.${mark}`);
  return v;
};

/* ---------------- narration placement ---------------- */
const CARD = 3.4; // chapter card length
const chapters = [
  { id: 0, title: "Welcome", ground: "var(--sky)", gaps: [1.0], p0: 0.9 },
  { id: 1, title: "08:00 · Front desk: diary and online booking", time: "08:00", who: "Jess, front desk", ground: "var(--sky)", art: "reception-desk.svg", gaps: [0.6, 1.6], p0: 0.8 },
  { id: 2, title: "09:15 · Notes, amendments and letters", time: "09:15", who: "Sophie, room 1", ground: "var(--couch-roll)", art: "treatment-room.svg", gaps: [1.5, 0.9, 0.8], p0: 0.8 },
  { id: 3, label: "Insurer forms from signed notes", title: "11:40 · ClinDesk Reports – powered by ClinForms (add-on)", time: "11:40", who: "Sophie, an insurer’s form", ground: "var(--sun)", art: "in-tray-clipboard.svg", gaps: [1.0, 3.6, 0.6, 0.6, 0.6], p0: 0.8, card: 4.6 },
  { id: 4, title: "13:05 · Group office: sites, numbers and roles", time: "13:05", who: "Sam, group office", ground: "var(--pine)", dark: true, art: "laptop-chart.svg", gaps: [0.7, 0.7], p0: 0.8 },
  { id: 5, title: "16:30 · Billing, authorisations and card payment", time: "16:30", who: "Robert, on his sofa", ground: "var(--blush)", art: "card-terminal.svg", gaps: [0.7, 0.7], p0: 0.8 },
  { id: 6, title: "18:30 · Audit trail, switching and booking a demo", time: "18:30", who: "lights off", ground: "var(--ink)", dark: true, art: "records-box.svg", gaps: [0.9, 0.9], p0: 0.8, tail: 4.8 },
];
const A = {}; // absolute start of each paragraph
let t = 0;
for (const ch of chapters) {
  ch.start = t;
  const ps = paras.filter((p) => p.chapter === ch.id);
  let at = t + ch.p0;
  ps.forEach((p, i) => {
    A[p.id] = at;
    at += p.end - p.start + (ch.gaps[i] ?? 0.8);
  });
  const last = ps[ps.length - 1];
  ch.end = A[last.id] + (last.end - last.start) + (ch.tail ?? 1.0);
  t = ch.end;
}
const TOTAL = t;
/** absolute time of the n-th occurrence of a word (prefix match, case-insensitive) in paragraph pid; "end" = paragraph end */
function W(pid, word, n = 1, which = "s") {
  const p = P[pid];
  if (word === "end") return A[pid] + (p.end - p.start);
  if (word === "start") return A[pid];
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9'’-]/g, "");
  for (const exact of [true, false]) {
    let k = 0;
    for (const w of p.words) {
      const v = norm(w.w);
      if (exact ? v === word.toLowerCase() : v.startsWith(word.toLowerCase())) {
        if (++k === n) return A[pid] + ((which === "e" ? w.e : w.s) - p.start);
      }
    }
  }
  throw new Error(`word ${word} not in ${pid}`);
}

/* ---------------- layers ---------------- */
const layers = [];
let uid = 0;
const add = (L) => { L.id = L.id || `L${uid++}`; layers.push(L); return L; };
const B = { x: 150, y: 96, w: 1620, h: 911 };
const s2 = (v) => v * 2; // CSS px of a 1440x810 take → take px
const R = (x1, y1, x2, y2) => [s2(x1), s2(y1), s2(x2 - x1), s2(y2 - y1)];
const cam = (t, cx, cy, z, ease) => ({ t, cx: s2(cx), cy: s2(cy), z, ...(ease ? { ease } : {}) });
const FULL = (t = 0) => cam(t, 720, 405, 1);
function app(take, from, start, end, o = {}) {
  const T = takes[take];
  return add({ type: "app", take, seq: T.seq, n: T.n, W: T.W, H: T.H, from, rate: o.rate ?? 1, start, end, box: o.box || B,
    cam: o.cam || [FULL()], enter: o.enter ?? "fade", exit: o.exit ?? "cut", inDur: o.inDur ?? (o.enter === "rise" ? 0.7 : 0.25), outDur: o.outDur ?? 0.3,
    freezeAt: o.freeze, maxT: o.maxT ?? T.dur - 0.05, z: o.z ?? 10, cls: o.cls, dim: o.dim, float: o.float, id: o.id });
}
function ring(on, rect, start, end, o = {}) {
  start = Math.max(start, on.start + 0.35);
  return add({ type: "ring", on: on.id, rect, start, end, z: 40, pad: o.pad ?? 10, inDur: 0.2, outDur: 0.25, enter: "cut", exit: "fade" });
}
function html(start, end, h, o = {}) {
  return add({ type: "html", start, end, html: h, box: o.box, style: o.style, bt: o.bt, cls: o.cls, enter: o.enter ?? "fade", exit: o.exit ?? "fade", inDur: o.inDur ?? 0.35, outDur: o.outDur ?? 0.3, z: o.z ?? 45, follow: o.follow, tilt: o.tilt, float: o.float });
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function callout(on, rect, text, start, end, o = {}) {
  start = Math.max(start, on.start + 0.45);
  // pen label anchored to a source rect of an app layer (ax/ay = anchor on the rect, dx/dy = offset in stage px)
  return html(start, end, `<div class="callout ${o.dark ? "dark" : ""}" style="transform: rotate(${o.tilt ?? -2}deg)">${esc(text)}</div>`, {
    follow: { on: on.id, rect, ax: o.ax ?? 1, ay: o.ay ?? 0, dx: o.dx ?? 16, dy: o.dy ?? -70 }, enter: "pop", inDur: 0.45, z: 46 });
}
function tag(text, start, end, o = {}) {
  return html(start, end, `<div class="${o.cls || "ftag"}">${esc(text)}</div>`, { box: o.box || { x: B.x + B.w - 24, y: B.y + 22 }, bt: "translateX(-100%)", enter: "fade", z: 47 });
}
function ground(start, end, color, o = {}) {
  return add({ type: "ground", start, end, color, z: 0, enter: o.enter ?? "cut", exit: o.exit ?? "cut", inDur: 0.4, outDur: 0.4, cls: o.cls });
}
function marker(ch, start, end) {
  // top-left label for the whole chapter: the handwritten time line + the chapter name (never at the bottom)
  const name = (ch.label ?? ch.title.replace(/^\d\d:\d\d · /, "")).replace(/ \(add-on\)$/, "");
  return html(start, end, `<div style="display:flex;align-items:center;gap:18px;white-space:nowrap"><span class="marker ${ch.dark ? "dark" : ""}" style="transform: rotate(-1.5deg)">${esc(ch.time)} · ${esc(ch.who)}</span>${ch.noChip ? "" : `<span class="chip" style="font-size:20px;padding:6px 13px;${ch.dark ? "background:var(--couch-roll);color:var(--pine)" : ""}">${esc(name)}</span>`}</div>`, { box: { x: B.x + 6, y: 24 }, enter: "fade", z: 44 });
}
const LOGO = (size = 64) => `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><defs><pattern id="wv${size}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="5" fill="rgba(255,255,255,.2)"/></pattern></defs><g transform="rotate(-30 20 20)"><rect x="3" y="15" width="34" height="10" rx="4" fill="#0B6B65"/><rect x="3" y="15" width="34" height="10" rx="4" fill="url(#wv${size})"/></g><g transform="rotate(30 20 20)"><rect x="3" y="15" width="34" height="10" rx="4" fill="#C4432B"/><rect x="3" y="15" width="34" height="10" rx="4" fill="url(#wv${size})"/></g></svg>`;
const SAMPLE = (start, end, o = {}) => tag("Sample data (fictional)", start, end, o);

/* chapter card: big clock time, pen line, illustration, tape */
function chapterCard(ch, extra = "") {
  const d = ch.card ?? CARD;
  const s = ch.start, e = s + d;
  ground(s, ch.end, ch.ground);
  const fg = ch.dark ? "var(--couch-roll)" : "var(--pine)";
  const [hh, mm] = ch.time.split(":");
  html(s, e + 0.35, `
    <div style="position:absolute;left:150px;top:250px;">
      <div class="disp" style="font-size:300px;color:${fg};display:flex;gap:0">
        <span data-in="0.05" data-anim="rise" data-dist="120" data-dur="0.7">${hh}</span><span data-in="0.18" data-anim="pop" style="color:var(--tape-coral)">:</span><span data-in="0.25" data-anim="rise" data-dist="120" data-dur="0.7">${mm}</span>
      </div>
      <span class="tape" data-in="0.55" data-anim="wipe" data-dur="0.5" style="--tc:var(--sun);left:8px;top:300px;width:470px;height:30px;transform:rotate(-2deg)"></span>
      <div class="marker ${ch.dark ? "dark" : ""}" data-in="0.75" data-anim="left" style="font-size:64px;margin-top:70px;transform:rotate(-2deg)">${esc(ch.who)}</div>
      ${extra}
    </div>
    <img src="${ch.art}" data-in="0.3" data-anim="right" data-dist="160" data-dur="0.9" style="position:absolute;right:120px;top:${ch.id === 6 ? 250 : 230}px;width:720px;height:600px;object-fit:contain">
  `, { box: { x: 0, y: 0, w: 1920, h: 1080 }, enter: "cut", exit: "up", outDur: 0.45, z: 60 });
  return e;
}

/* ================= CH0 – title ================= */
{
  const ch = chapters[0];
  ground(ch.start, ch.end, "var(--sky)");
  const sw = W("c0p1", "let's") - 0.25;
  html(0, sw + 0.4, `
    <div class="logo" style="position:absolute;left:150px;top:90px" data-in="0" data-anim="fade" data-dur="0.5">${LOGO(70)}<span class="word" style="font-size:58px">ClinDesk</span></div>
    <div class="disp" style="position:absolute;left:150px;top:230px;font-size:168px">
      <div data-in="${W("c0p0", "diary")}" data-anim="ghost">Diary full.</div>
      <div data-in="${W("c0p0", "notes")}" data-anim="ghost">Notes signed.</div>
      <div data-in="${W("c0p0", "home")}" data-anim="ghost">Home by</div>
      <div data-in="${W("c0p0", "half")}" data-anim="ghost" style="position:relative;display:inline-block">half four.<span class="tape" data-in="${W("c0p0", "four") + 0.2}" data-anim="wipe" data-dur="0.5" style="--tc:var(--sun);left:-6px;right:-10px;bottom:6px;height:42px;z-index:-1;transform:rotate(-1.5deg)"></span></div>
    </div>
    <img src="treatment-room.svg" style="position:absolute;right:110px;top:200px;width:760px;height:640px;object-fit:contain">
    <div class="marker" data-in="${W("c0p1", "practice")}" data-anim="pop" style="position:absolute;right:200px;top:800px;font-size:40px;transform:rotate(-3deg)">diary · notes · billing · multi-site</div>
  `, { box: { x: 0, y: 0, w: 1920, h: 1080 }, enter: "cut", exit: "up", outDur: 0.5, z: 60 });
  // a day at Pebblegate Physio (fictional)
  const times = ["08:00", "09:15", "11:40", "13:05", "16:30", "18:30"];
  html(sw, ch.end + 0.3, `
    <div style="position:absolute;left:0;right:0;top:200px;text-align:center">
      <div class="marker" data-in="0.1" data-anim="pop" style="font-size:52px;display:inline-block;transform:rotate(-2deg)">a day at</div>
      <div class="disp" data-in="${W("c0p1", "pebblegate") - sw}" data-anim="rise" style="font-size:150px;margin-top:10px">Pebblegate Physio</div>
      <div class="lead" data-in="${W("c0p1", "fictional") - sw}" data-anim="rise" style="margin-top:22px">A fictional clinic · <b>three sites</b> · Northgate, Abbey Road, Kingsmead</div>
      <div style="display:flex;justify-content:center;gap:22px;margin-top:70px">
        ${times.map((x, i) => `<span class="chip" data-in="${W("c0p1", "three") - sw + i * 0.12}" data-anim="pop" style="font-size:34px;padding:12px 24px;${i === 2 ? "background:var(--tape-coral)" : ""}">${x}</span>`).join("")}
      </div>
    </div>
  `, { box: { x: 0, y: 0, w: 1920, h: 1080 }, enter: "slideup", inDur: 0.55, exit: "up", outDur: 0.45, z: 61 });
}

/* ================= CH1 – 08:00 front desk ================= */
{
  const ch = chapters[1];
  const ce = chapterCard(ch);
  marker(ch, ce, ch.end);
  const T = "s1-diary";
  const a = W("c1p0", "every");
  // Every practitioner, every room, at every site
  const a1 = app(T, M(T, "diary") + 0.5, ce, W("c1p0", "every", 2) - 0.05, { enter: "rise", cam: [cam(0, 720, 405, 1), cam(1, 760, 440, 1.12)] });
  SAMPLE(ce + 0.4, W("c1p0", "every", 2) - 0.05);
  const a2 = app(T, M(T, "rooms") + 1.0, W("c1p0", "every", 2) - 0.05, W("c1p0", "at") - 0.05, { cam: [cam(0, 760, 405, 1.1), cam(1, 740, 405, 1.18)] });
  ring(a2, R(300, 216, 1415, 262), W("c1p0", "every", 2) + 0.2, W("c1p0", "at") - 0.05, { pad: 6 });
  const a3 = app(T, M(T, "site-menu") + 0.9, W("c1p0", "at") - 0.05, A.c1p1 - 0.15, { cam: [cam(0, 420, 300, 1.35), cam(1, 380, 260, 1.6)] });
  ring(a3, R(133, 105, 420, 250), W("c1p0", "at") + 0.25, A.c1p1 - 0.15);
  callout(a3, R(133, 105, 420, 250), "one diary, three sites", W("c1p0", "site") + 0.1, A.c1p1 - 0.15, { dx: 24, dy: -10, ay: 0.5 });
  // Robert needs a follow-up with Sophie. Jess picks the 9:15 slot in Room 1.
  const b1 = app(T, M(T, "slot-click") - 1.5, A.c1p1 - 0.15, W("c1p1", "jess"), { cam: [cam(0, 600, 380, 1.15), cam(0.55, 600, 380, 1.15), cam(1, 520, 380, 1.3)] });
  const b2 = app(T, M(T, "patient") - 1.9, W("c1p1", "jess"), W("c1p1", "clindesk") - 0.1, { cam: [cam(0, 600, 400, 1.35), cam(1, 700, 390, 1.45)] });
  ring(b2, R(733, 412, 1129, 448), W("c1p1", "nine") - 0.1, W("c1p1", "clindesk") - 0.1, { pad: 6 });
  callout(b2, R(733, 412, 1129, 448), "Sophie · Room 1 · 09:15", W("c1p1", "nine") + 0.1, W("c1p1", "clindesk") - 0.1, { ax: 0, ay: 0.5, dx: -360, dy: -28 });
  // ClinDesk checks that Sophie and the room are free, and it's booked.
  const b3 = app(T, M(T, "slot-ok") - 0.7, W("c1p1", "clindesk") - 0.1, W("c1p1", "and", 2) - 0.1, { cam: [cam(0, 860, 470, 1.35), cam(1, 930, 495, 1.85)] });
  ring(b3, R(733, 461, 1129, 531), W("c1p1", "clindesk") + 0.4, W("c1p1", "and", 2) - 0.1);
  const b4 = app(T, M(T, "booked") - 0.9, W("c1p1", "and", 2) - 0.1, A.c1p2 - 0.2, { cam: [cam(0, 720, 430, 1.3), cam(1, 720, 430, 1.45)] });
  ring(b4, R(440, 340, 1000, 480), W("c1p1", "booked") + 0.15, A.c1p2 - 0.2);
  // Lucy books online on her phone; it lands in the diary; consent form
  const PH = "s1b-phone";
  const pbox = { x: 150, y: 110, w: 420, h: 890 };
  const ps = A.c1p2 - 0.2;
  const pc = [
    [M(PH, "service") - 0.4, ps, ps + 1.2],
    [M(PH, "time") - 0.5, ps + 1.2, ps + 2.3],
    [M(PH, "details") + 7.5, ps + 2.3, ps + 3.2],
    [M(PH, "booked") - 0.2, ps + 3.2, W("c1p2", "and") - 0.1],
    [M(PH, "form") + 0.2, W("c1p2", "and") - 0.1, ch.end],
  ];
  pc.forEach(([from, s, e], i) => add({ type: "phone", take: PH, seq: takes[PH].seq, n: takes[PH].n, W: 1170, H: 2532, from, rate: 1.4, start: s, end: e, box: pbox, enter: i === 0 ? "rise" : "fade", exit: "cut", inDur: i === 0 ? 0.6 : 0.15, z: 20 + i }));
  html(ps + 0.3, ch.end, `<div class="callout" style="transform:rotate(-3deg)">Lucy, on the bus</div>`, { box: { x: 600, y: 600 }, enter: "pop", z: 46 });
  const c1 = app("s1c-diary-online", 1.4, W("c1p2", "lands") - 0.2, ch.end, { box: { x: 760, y: 250, w: 1010, h: 568 }, enter: "rise", rate: 1, cam: [cam(0, 600, 470, 1.25), cam(1, 520, 520, 1.6)] });
  ring(c1, R(301, 615, 665, 670), W("c1p2", "lands") + 0.5, ch.end - 0.1);
  callout(c1, R(301, 615, 665, 670), "booked online", W("c1p2", "diary"), ch.end - 0.1, { dx: 14, dy: -20, ay: 0.5 });
  html(W("c1p2", "fills") - 0.2, ch.end, `<div class="callout" style="transform:rotate(-2deg)">her consent form, done before she arrives</div>`, { box: { x: 760, y: 150 }, enter: "pop", z: 46 });
}

/* ================= CH2 – 09:15 notes ================= */
{
  const ch = chapters[2];
  const ce = chapterCard(ch);
  marker(ch, ce, ch.end);
  const T = "s2-notes";
  // Robert arrives, and Sophie starts his note from her follow-up template.
  const d1 = app(T, M(T, "arrived") - 1.2, ce, W("c2p0", "sophie") - 0.05, { enter: "rise", cam: [cam(0, 900, 300, 1.25), cam(1, 1150, 250, 1.45)] });
  SAMPLE(ce + 0.4, W("c2p0", "sophie") - 0.05);
  ring(d1, R(1061, 299, 1237, 338), W("c2p0", "arrives") - 0.2, W("c2p0", "sophie") - 0.05, { pad: 6 });
  const d2 = app(T, M(T, "template") - 1.5, W("c2p0", "sophie") - 0.05, W("c2p0", "end") + 0.5, { cam: [cam(0, 720, 300, 1.2), cam(1, 760, 330, 1.35)] });
  callout(d2, R(517, 255, 757, 292), "her own templates", W("c2p0", "template") - 0.6, W("c2p0", "end") + 0.5, { dx: 20, dy: -20, ay: 0.5 });
  const d3 = app(T, M(T, "type-subjective") - 0.1, W("c2p0", "end") + 0.5, A.c2p1 - 0.05, { rate: 2, cam: [cam(0, 760, 380, 1.3), cam(1, 760, 420, 1.3)] });
  tag("Sped up", W("c2p0", "end") + 0.6, A.c2p1 - 0.05, { cls: "chip" });
  // When she signs it, the note locks.
  const d4 = app(T, M(T, "signed-click") - 1.0, A.c2p1 - 0.05, W("c2p1", "the") - 0.05, { cam: [cam(0, 720, 420, 1.45), cam(1, 760, 430, 1.6)] });
  const d5 = app(T, M(T, "locked") + 0.3, W("c2p1", "the") - 0.05, A.c2p2 - 0.1, { rate: 0.5, cam: [cam(0, 960, 240, 1.25), cam(1, 960, 230, 1.45)] });
  ring(d5, R(500, 213, 1416, 278), W("c2p1", "the") + 0.1, A.c2p2 - 0.1, { pad: 6 });
  html(W("c2p1", "locks") - 0.1, A.c2p2 - 0.1, `<svg width="230" height="230" viewBox="0 0 140 140" style="color:var(--tape-coral);opacity:.92;transform:rotate(-10deg)"><defs><path id="arc" d="M70 70 m-53 0 a53 53 0 1 1 106 0 a53 53 0 1 1 -106 0"/></defs><circle cx="70" cy="70" r="66" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="70" cy="70" r="41" fill="none" stroke="currentColor" stroke-width="1.5"/><text style="font:700 10.5px Figtree;letter-spacing:.1em;text-transform:uppercase" fill="currentColor"><textPath href="#arc" textLength="324" lengthAdjust="spacing">Signed &amp; locked · 10/11/2026 · S. Marsh ·</textPath></text><path d="M44 82 C 47 62, 57 52, 60 61 C 62 70, 52 75, 48 70 M62 84 C 65 75, 71 71, 73 77 C 75 83, 70 86, 78 81 M80 79 C 84 71, 88 70, 90 74 C 92 79, 88 84, 97 78 M99 64 C 99 74, 99 81, 101 86" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`, { box: { x: 1440, y: 520 }, enter: "pop", inDur: 0.45, z: 46 });
  // Change something later … tracked amendment, original kept underneath
  app(T, M(T, "amend-type") - 0.5, A.c2p2 - 0.1, W("c2p2", "tracked") - 0.1, { rate: 1.4, cam: [cam(0, 800, 560, 1.35), cam(1, 800, 600, 1.45)] });
  const d7 = app(T, M(T, "amended") + 0.4, W("c2p2", "tracked") - 0.1, A.c2p3 - 0.2, { rate: 0.4, cam: [cam(0, 800, 560, 1.3), cam(1, 800, 650, 1.6)] });
  ring(d7, R(500, 625, 1100, 790), W("c2p2", "tracked") + 0.15, A.c2p3 - 0.2, { pad: 6 });
  callout(d7, R(500, 625, 1100, 790), "the original stays put", W("c2p2", "original") - 0.1, A.c2p3 - 0.2, { ax: 1, ay: 0.3, dx: 18, dy: 0 });
  // The letter to his GP comes from the same record.
  app(T, M(T, "letter-template") - 0.6, A.c2p3 - 0.2, W("c2p3", "comes") - 0.1, { cam: [cam(0, 820, 330, 1.3), cam(1, 820, 330, 1.4)] });
  const d9 = app(T, M(T, "preview") + 0.4, W("c2p3", "comes") - 0.1, ch.end, { rate: 0.6, cam: [cam(0, 980, 500, 1.25), cam(1, 990, 560, 1.5)] });
  callout(d9, R(590, 230, 1385, 810), "Letter to GP · from the record", W("c2p3", "comes") + 0.3, ch.end, { ax: 0.08, ay: 0.12, dx: 0, dy: -10 });
}

/* ================= CH3 – 11:40 Reports add-on ================= */
{
  const ch = chapters[3];
  const lock = `<div data-in="1.0" data-anim="rise" style="position:absolute;left:0;top:520px;display:flex;align-items:flex-start;gap:22px">
      <div><div class="disp" style="font-size:64px;line-height:1">ClinDesk Reports</div><div style="font:600 32px/1.3 var(--text);color:var(--pine);margin-top:8px">powered by ClinForms</div></div>
      <span class="addon" data-in="1.4" data-anim="pop" data-base="rotate(-4deg)" style="margin-top:-6px">Add-on</span></div>`;
  const ce = chapterCard(ch, lock);
  marker(ch, ce, ch.end);
  html(ce, ch.end, `<span class="addon" style="font-size:22px;padding:6px 14px;white-space:nowrap">ClinDesk Reports · Add-on</span>`, { box: { x: B.x + B.w, y: 34 }, bt: "translateX(-100%)", z: 44 });
  const T = "s3-referrer";
  const HDR1 = (cx, cy, z, t = 0) => cam(t, cx, cy, z); // helper for readability
  // … on their own form: the case, then the insurer's form
  const e1 = app(T, 0.3, ce, W("c3p0", "on") - 0.05, { enter: "rise", cam: [cam(0, 820, 540, 1.3), cam(1, 820, 560, 1.4)] });
  ring(e1, R(240, 497, 1415, 618), ce + 0.3, W("c3p0", "on") - 0.05, { pad: 6 });
  SAMPLE(ce + 0.4, W("c3p0", "on") - 0.05);
  const e2 = app(T, 27.6, W("c3p0", "on") - 0.05, A.c3p1 - 0.2, { freeze: 27.6, cam: [cam(0, 1126, 560, 1.6), cam(1, 1126, 540, 2.1)] });
  callout(e2, R(940, 337, 1312, 810), "their layout, their questions", W("c3p0", "own") - 0.2, A.c3p1 - 0.2, { ax: 0, ay: 0.25, dx: -400, dy: 0 });
  // From his case, Sophie chooses Complete referrer form, and picks the insurer's form.
  const e3 = app(T, 1.6, A.c3p1 - 0.2, W("c3p1", "and") - 0.05, { cam: [cam(0, 1000, 500, 1.3), cam(1, 1150, 520, 1.5)] });
  ring(e3, R(1217, 515, 1399, 549), W("c3p1", "complete") - 0.2, W("c3p1", "and") - 0.05, { pad: 6 });
  const e4 = app(T, 4.4, W("c3p1", "and") - 0.05, W("c3p1", "end") + 0.4, { cam: [cam(0, 720, 400, 1.45), cam(1, 720, 380, 1.7)] });
  ring(e4, R(460, 297, 980, 353), W("c3p1", "insurer") - 0.3, W("c3p1", "end") + 0.4, { pad: 6 });
  // the Studio: imported from ClinDesk, choose the form, complete
  const e5 = app(T, 9.6, W("c3p1", "end") + 0.4, A.c3p2 - 1.6, { rate: 1, cam: [cam(0, 520, 396, 1.6), cam(1, 540, 400, 1.65)] });
  ring(e5, R(112, 345, 1328, 380), W("c3p1", "end") + 0.6, A.c3p2 - 1.6, { pad: 6 });
  callout(e5, R(112, 345, 1328, 380), "2 signed notes · 1 appointment · 1 score", W("c3p1", "end") + 0.8, A.c3p2 - 1.6, { ax: 0.12, ay: 1, dx: 0, dy: 40 });
  app(T, 17.0, A.c3p2 - 1.6, A.c3p2 - 0.1, { cam: [cam(0, 700, 480, 1.4), cam(1, 640, 485, 1.45)] });
  tag("Skipped ahead · drafting took 8 s", A.c3p2 - 0.7, A.c3p2 + 1.3, { cls: "chip coral" });
  // It's filled in from the notes she's already signed. Every answer shows the note it came from.
  const e7 = app(T, 22.6, A.c3p2 - 0.1, W("c3p2", "every") - 0.1, { rate: 0.6, cam: [cam(0, 720, 456, 1.3), cam(1, 520, 470, 1.5)] });
  ring(e7, R(113, 575, 327, 694), W("c3p2", "filled") + 0.2, W("c3p2", "every") - 0.1, { pad: 6 });
  ring(e7, R(113, 332, 299, 354), W("c3p2", "notes") , W("c3p2", "every") - 0.1, { pad: 6 });
  const e8 = app(T, 37.2, W("c3p2", "every") - 0.1, A.c3p3 - 0.15, { rate: 1, cam: [cam(0, 840, 380, 1.35), cam(1, 860, 385, 1.45)] });
  ring(e8, R(517, 377, 616, 399), W("c3p2", "every") + 0.6, A.c3p3 - 0.15, { pad: 6 });
  ring(e8, R(941, 141, 1311, 540), W("c3p2", "note", 1) + 0.0, A.c3p3 - 0.15, { pad: 4 });
  callout(e8, R(941, 141, 1311, 540), "the note it came from", W("c3p2", "came") - 0.4, A.c3p3 - 0.15, { ax: 0, ay: 1, dx: -200, dy: 18 });
  // Anything the notes don't cover is left for her. Here, that's her own opinion.
  const e9 = app(T, 42.6, A.c3p3 - 0.15, W("c3p3", "here") - 0.05, { rate: 0.5, cam: [cam(0, 630, 400, 1.45), cam(1, 630, 410, 1.6)] });
  ring(e9, R(377, 317, 882, 465), A.c3p3 + 0.3, W("c3p3", "here") - 0.05, { pad: 6 });
  app(T, 47.6, W("c3p3", "here") - 0.05, A.c3p4 - 0.15, { rate: 1.3, cam: [cam(0, 630, 400, 1.5), cam(1, 630, 405, 1.6)] });
  callout(layers[layers.length - 1], R(377, 200, 882, 260), "her opinion, in her words", W("c3p3", "opinion") - 0.4, A.c3p4 - 0.15, { ax: 0.55, ay: 0, dx: 0, dy: -90 });
  // She checks it, and signs. The completed form is filed straight back to Robert's record.
  const S3 = "s3b-approve";
  app(S3, M(S3, "sign") - 1.7, A.c3p4 - 0.15, W("c3p4", "the") - 0.05, { cam: [cam(0, 720, 560, 1.3), cam(1, 760, 620, 1.45)] });
  const e12 = app(S3, M(S3, "filed") + 0.3, W("c3p4", "the") - 0.05, W("c3p4", "robert's") - 0.1, { rate: 0.6, cam: [cam(0, 720, 410, 1.2), cam(1, 760, 430, 1.3)] });
  ring(e12, R(113, 281, 1328, 546), W("c3p4", "completed") - 0.1, W("c3p4", "robert's") - 0.1, { pad: 6 });
  const e13 = app(S3, M(S3, "case-filed") + 0.6, W("c3p4", "robert's") - 0.1, A.c3p5 - 0.1, { rate: 0.5, cam: [cam(0, 820, 560, 1.25), cam(1, 820, 600, 1.5)] });
  ring(e13, R(257, 583, 1398, 638), W("c3p4", "robert's") + 0.2, A.c3p5 - 0.1, { pad: 6 });
  callout(e13, R(257, 583, 1398, 638), "approved · signed · filed", W("c3p4", "record") - 0.3, A.c3p5 - 0.1, { ax: 0.1, ay: 1, dx: 0, dy: 24 });
  // Your notes. Their form. Your signature.
  const kt = A.c3p5 - 0.1;
  html(kt, ch.end + 0.2, `
    <div class="disp" style="position:absolute;left:150px;top:300px;font-size:150px;line-height:1.02">
      <div data-in="${W("c3p5", "your") - kt}" data-anim="rise">Your notes.</div>
      <div data-in="${W("c3p5", "their") - kt}" data-anim="rise">Their form.</div>
      <div data-in="${W("c3p5", "your", 2) - kt}" data-anim="rise" style="position:relative;display:inline-block">Your signature.
        <svg viewBox="0 0 400 26" preserveAspectRatio="none" style="position:absolute;left:-4px;right:-8px;bottom:-26px;width:calc(100% + 12px);height:36px;overflow:visible"><path pathLength="1" data-in="${W("c3p5", "signature") - kt + 0.2}" data-anim="draw" data-dur="0.7" d="M4 17 C 70 7, 150 23, 230 13 S 350 6, 396 13" style="fill:none;stroke:var(--tape-coral);stroke-width:6;stroke-linecap:round"/></svg></div>
    </div>
    <div style="position:absolute;right:150px;top:340px;text-align:right">
      <div class="disp" data-in="0.4" data-anim="fade" style="font-size:56px">ClinDesk Reports</div>
      <div data-in="0.5" data-anim="fade" style="font:600 30px var(--text);color:var(--pine);margin-top:6px">powered by ClinForms</div>
      <div data-in="0.8" data-anim="pop" style="margin-top:22px"><span class="addon">Add-on</span></div>
      <div class="marker" data-in="1.2" data-anim="fade" style="margin-top:60px;font-size:40px;transform:rotate(-2deg)">nothing leaves until the physio signs</div>
    </div>`, { box: { x: 0, y: 0, w: 1920, h: 1080 }, enter: "slideup", inDur: 0.5, exit: "up", z: 61, cls: "" });
  add({ type: "ground", start: kt, end: ch.end + 0.2, color: "var(--sun)", z: 59, enter: "slideup", exit: "cut", inDur: 0.5 });
}

/* ================= CH4 – 13:05 group office ================= */
{
  const ch = chapters[4];
  const ce = chapterCard(ch);
  marker(ch, ce, ch.end);
  const T = "s4-group";
  const f1 = app(T, 0.6, ce, A.c4p1 - 0.15, { enter: "rise", rate: 0.7, cam: [cam(0, 720, 405, 1), cam(0.4, 720, 405, 1.02), cam(1, 520, 330, 1.45)] });
  SAMPLE(ce + 0.4, A.c4p1 - 0.15);
  ring(f1, R(240, 374, 820, 523), W("c4p0", "one") + 0.1, A.c4p1 - 0.15, { pad: 6 });
  const chips = [["one diary", "diary"], ["one patient list", "list"], ["one set of numbers", "numbers"]];
  html(W("c4p0", "one") - 0.1, A.c4p1 - 0.15, `<div style="display:flex;flex-direction:column;gap:14px;align-items:flex-end">${chips.map(([x, w]) => `<span class="chip coral" data-in="${W("c4p0", w) - W("c4p0", "one") + 0.05}" data-anim="pop" style="font-size:30px">${x}</span>`).join("")}</div>`, { box: { x: B.x + B.w - 30, y: B.y + 110 }, bt: "translateX(-100%)", z: 46 });
  // Switch sites in a click, and see the numbers for one site, or all of them.
  const f2 = app(T, M(T, "site-menu") - 0.4, A.c4p1 - 0.15, W("c4p1", "and") - 0.05, { rate: 1.2, cam: [cam(0, 420, 260, 1.5), cam(1, 520, 330, 1.3)] });
  ring(f2, R(126, 12, 326, 48), A.c4p1, W("c4p1", "and") - 0.05, { pad: 6 });
  const f3 = app(T, M(T, "util-all") - 1.2, W("c4p1", "and") - 0.05, A.c4p2 - 0.15, { cam: [cam(0, 820, 300, 1.4), cam(1, 860, 420, 1.2)] });
  ring(f3, R(796, 160, 972, 192), W("c4p1", "all") - 0.4, A.c4p2 - 0.15, { pad: 6 });
  // Roles decide who sees what. Reception never sees clinical notes.
  app(T, M(T, "roles") + 0.2, A.c4p2 - 0.15, W("c4p2", "reception") - 0.1, { cam: [cam(0, 820, 330, 1.15), cam(1, 900, 360, 1.3)] });
  const f5 = app(T, M(T, "roles-scrolled") + 0.8, W("c4p2", "reception") - 0.1, ch.end, { freeze: M(T, "roles-scrolled") + 0.8, cam: [cam(0, 900, 120, 1.5), cam(1, 1000, 130, 1.75)] });
  ring(f5, R(1290, 64, 1405, 128), W("c4p2", "reception") + 0.3, ch.end, { pad: 6 });
  ring(f5, R(1290, 141, 1405, 204), W("c4p2", "never") + 0.1, ch.end, { pad: 6 });
  callout(f5, R(1290, 64, 1405, 204), "locked for reception", W("c4p2", "clinical"), ch.end, { ax: 0, ay: 1, dx: -360, dy: 20 });
}

/* ================= CH5 – 16:30 billing ================= */
{
  const ch = chapters[5];
  const ce = chapterCard(ch);
  marker(ch, ce, ch.end);
  const T = "s5-billing";
  const g1 = app(T, M(T, "robert-row") - 0.4, ce, W("c5p0", "robert's") - 0.1, { enter: "rise", cam: [cam(0, 720, 470, 1.15), cam(1, 640, 660, 1.4)] });
  SAMPLE(ce + 0.4, W("c5p0", "robert's") - 0.1);
  ring(g1, R(262, 728, 860, 758), W("c5p0", "visits") - 0.1, W("c5p0", "robert's") - 0.1, { pad: 8 });
  const g2 = app(T, M(T, "invoice") + 0.6, W("c5p0", "robert's") - 0.1, A.c5p1 - 0.15, { rate: 0.5, cam: [cam(0, 640, 290, 1.5), cam(1, 640, 300, 1.75)] });
  ring(g2, R(637, 287, 999, 384), W("c5p0", "insurer") - 0.1, A.c5p1 - 0.15, { pad: 6 });
  callout(g2, R(637, 287, 999, 384), "the rest · £30 to the insurer", W("c5p0", "invoice") - 0.2, A.c5p1 - 0.15, { ax: 0.4, ay: 0, dx: 0, dy: -86 });
  ring(g2, R(261, 287, 624, 384), W("c5p0", "excess") - 0.4, A.c5p1 - 0.15, { pad: 6 });
  callout(g2, R(261, 287, 624, 384), "his excess · £25", W("c5p0", "excess") - 0.2, A.c5p1 - 0.15, { ax: 0.1, ay: 1, dx: 0, dy: 22 });
  // Authorised sessions count down … (the 13:05 dashboard: authorisations ending soon)
  const g3 = app("s4-group", 2.2, A.c5p1 - 0.15, A.c5p2 - 0.15, { freeze: 2.2, cam: [cam(0, 530, 640, 1.6), cam(1, 530, 660, 1.9)] });
  ring(g3, R(580, 620, 645, 644), W("c5p1", "count") - 0.1, A.c5p2 - 0.15, { pad: 6 });
  ring(g3, R(580, 705, 645, 729), W("c5p1", "count") + 0.25, A.c5p2 - 0.15, { pad: 6 });
  html(Math.max(W("c5p1", "seven") - 0.2, A.c5p1 + 0.3), A.c5p2 - 0.15, `<div class="callout" style="transform:rotate(-2deg)">6 of 6 used · 0 left</div>`, { box: { x: 1260, y: 150 }, enter: "pop", inDur: 0.45, z: 46 });
  // Robert gets a payment link by text, and pays his £25 by card, from his sofa.
  app(T, M(T, "text-link") - 0.8, A.c5p2 - 0.15, ch.end, { rate: 0.0001, freeze: M(T, "text-link") + 1.0, cam: [cam(0, 720, 300, 1.2)], id: "g4" });
  const sms = JSON.parse(fs.readFileSync(path.join(SRC, "work/takes/s5-billing/info.json"), "utf8")).sms.replace("[link]", "<span style=\"background:#dbe7f5;border-radius:6px;padding:0 8px;color:#1F3A6B\">secure payment link</span>");
  html(A.c5p2 - 0.1, ch.end, `
    <div class="phone" style="position:absolute;left:0;top:0;width:430px;height:880px"><div class="scr" style="background:#f2f2f7">
      <div style="padding:70px 22px 0;font:600 26px var(--text);text-align:center;color:#111">Pebblegate</div>
      <div style="font:500 18px var(--text);text-align:center;color:#8a8a8e;margin-top:6px">Text message · 16:31</div>
      <div data-in="0.5" data-anim="pop" style="margin:26px 18px 0 18px;background:#e9e9eb;border-radius:22px;padding:16px 18px;font:500 25px/1.35 var(--text);color:#111">${sms}</div>
      <div data-in="${W("c5p2", "pays") - A.c5p2}" data-anim="pop" style="margin:22px 18px 0 auto;width:fit-content;background:var(--teal);color:#fff;border-radius:22px;padding:14px 18px;font:600 24px var(--text)">Paid £25.00 by card ✓</div>
    </div><div class="notch"></div></div>`, { box: { x: 1290, y: 120 }, enter: "rise", inDur: 0.6, z: 48 });
  const g5 = app(T, M(T, "paid") + 0.2, W("c5p2", "pays") - 0.2, ch.end, { freeze: M(T, "paid") + 0.6, enter: "fade", cam: [cam(0, 560, 230, 1.6), cam(1, 520, 240, 1.75)], box: { x: 150, y: 96, w: 1100, h: 911 } });
  ring(g5, R(455, 113, 516, 137), W("c5p2", "card") - 0.3, ch.end, { pad: 6 });
  ring(g5, R(553, 337, 606, 357), W("c5p2", "card") - 0.1, ch.end, { pad: 6 });
  tag("Card payment in test mode", W("c5p2", "pays"), ch.end, { box: { x: 150 + 1100 - 24, y: B.y + 22 } });
}

/* ================= CH6 – 18:30 audit, switching, close ================= */
{
  const ch = chapters[6];
  const ce = chapterCard(ch);
  const T = "s6a-audit";
  const mk = marker(ch, ce, A.c6p1 - 0.2);
  // Every change, and every signature, is on the audit trail: who, what and when.
  const h1 = app(T, 9.5, ce, A.c6p1 - 0.2, { enter: "rise", freeze: 9.5, cam: [cam(0, 560, 560, 1.9), cam(1, 560, 610, 2.2)] });
  ring(h1, R(500, 505, 740, 560), W("c6p0", "change") - 0.1, A.c6p1 - 0.2, { pad: 6 });
  SAMPLE(ce + 0.4, A.c6p1 - 0.2);
  ring(h1, R(500, 715, 740, 752), W("c6p0", "signature") - 0.1, A.c6p1 - 0.2, { pad: 6 });
  const cols = [["who", "who"], ["what", "what"], ["when", "when"]];
  html(W("c6p0", "who") - 0.1, A.c6p1 - 0.2, `<div style="display:flex;gap:14px">${cols.map(([x, w]) => `<span class="chip coral" data-in="${W("c6p0", w) - W("c6p0", "who") + 0.05}" data-anim="pop" style="font-size:30px">${x}</span>`).join("")}</div>`, { box: { x: B.x + B.w - 30, y: 830 }, bt: "translateX(-100%)", z: 46 });
  // Switching from your current system?
  const sw = A.c6p1 - 0.2, bring = W("c6p1", "bring") - 0.1;
  add({ type: "ground", start: sw, end: bring + 0.5, color: "var(--cardboard)", z: 58, enter: "slideup", exit: "cut", inDur: 0.5 });
  html(sw, bring + 0.5, `
    <div class="marker" data-in="0.2" data-anim="pop" style="position:absolute;left:150px;top:260px;font-size:56px;transform:rotate(-2deg)">moving day</div>
    <div class="disp" data-in="0.25" data-anim="rise" style="position:absolute;left:150px;top:350px;font-size:120px;width:1000px">Switching from your current system?</div>
    <img src="moving-box.svg" data-in="0.3" data-anim="right" data-dist="180" style="position:absolute;right:150px;top:260px;width:560px;height:470px;object-fit:contain">`, { box: { x: 0, y: 0, w: 1920, h: 1080 }, enter: "slideup", inDur: 0.5, exit: "up", outDur: 0.45, z: 59 });
  const S6 = "s6-audit";
  const h3 = app(S6, M(S6, "file") - 0.6, bring, W("c6p1", "check") - 0.05, { rate: 1.3, cam: [cam(0, 820, 300, 1.25), cam(1, 820, 330, 1.3)] });
  ground(bring, ch.end, "var(--cardboard)");
  marker({ ...ch, time: "18:30", who: "moving day", dark: false, label: "Switching from your current system" }, bring, A.c6p2 - 0.1);
  const h4 = app(S6, M(S6, "checked") + 0.4, W("c6p1", "check") - 0.05, W("c6p1", "undo") - 0.05, { rate: 0.6, cam: [cam(0, 820, 330, 1.35), cam(1, 820, 360, 1.5)] });
  ring(h4, R(261, 273, 1394, 349), W("c6p1", "row") - 0.3, W("c6p1", "undo") - 0.05, { pad: 6 });
  const h5 = app(S6, M(S6, "import") + 0.3, W("c6p1", "undo") - 0.05, A.c6p2 - 0.1, { freeze: M(S6, "import") + 0.3, cam: [cam(0, 700, 220, 1.6), cam(1, 700, 210, 1.8)] });
  ring(h5, R(236, 145, 850, 170), W("c6p1", "undo") + 0.1, A.c6p2 - 0.1, { pad: 6 });
  // close card
  const cs = A.c6p2 - 0.1;
  add({ type: "ground", start: cs, end: TOTAL, color: "var(--tape-coral)", z: 62, enter: "slideup", exit: "cut", inDur: 0.55 });
  html(cs, TOTAL, `
    <div class="logo" data-in="0.3" data-anim="rise" style="position:absolute;left:150px;top:150px">${LOGO(92)}<span class="word" style="font-size:84px;color:#fff">ClinDesk</span></div>
    <div class="disp" data-in="${W("c6p2", "book") - cs}" data-anim="rise" style="position:absolute;left:150px;top:330px;font-size:150px;color:#fff">Book a demo</div>
    <div data-in="${W("c6p2", "clindesk", 2) - cs}" data-anim="rise" style="position:absolute;left:150px;top:520px"><span class="btn btn-light" style="font-size:52px;height:110px">clindesk.co.uk <span style="margin-left:8px">→</span></span></div>
    <div data-in="${W("c6p2", "clindesk", 2) - cs + 0.5}" data-anim="rise" style="position:absolute;left:150px;top:680px;font:600 44px var(--text);color:#fff">hello@clindesk.co.uk</div>
    <div class="marker" data-in="${W("c6p2", "clindesk", 2) - cs + 0.9}" data-anim="pop" style="position:absolute;left:150px;top:790px;color:var(--sun-soft);font-size:40px;transform:rotate(-2deg)">diary full · notes signed · home by half four</div>
    <img src="sack-trolley.svg" data-in="0.4" data-anim="right" data-dist="160" style="position:absolute;right:170px;top:230px;width:520px;height:600px;object-fit:contain">
    <div data-in="1.2" data-anim="fade" style="position:absolute;left:150px;bottom:60px;font:500 24px var(--text);color:rgba(255,255,255,.85)">Pebblegate Physio and everyone in this video are fictional. Recorded on a test copy of ClinDesk with made-up data.</div>`,
    { box: { x: 0, y: 0, w: 1920, h: 1080 }, enter: "slideup", inDur: 0.55, exit: "cut", z: 63 });
}

/* ---------------- captions ---------------- */
const NOCAP = new Set(["c0p0", "c3p5", "c6p2"]);
const fix = (s) => s.replace(/clindesk dot co dot uk/gi, "clindesk.co.uk").replace(/nine-fifteen/gi, "9:15").replace(/Room One/g, "Room 1").replace(/twenty-five pounds/gi, "£25");
function wrap2(text) {
  if (text.length <= 42) return text;
  let best = null;
  const ws = text.split(" ");
  for (let i = 1; i < ws.length; i++) {
    const a = ws.slice(0, i).join(" "), b = ws.slice(i).join(" ");
    if (a.length <= 42 && b.length <= 42) { const sc = Math.abs(a.length - b.length); if (!best || sc < best.sc) best = { sc, s: `${a}\n${b}` }; }
  }
  return best ? best.s : null;
}
const captions = [];
const srt = [];
for (const p of paras) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur), (cur = []); };
  for (const [wi, w] of p.words.entries()) {
    const next = [...cur, w];
    const txt = fix(next.map((x) => x.w).join(" "));
    if (cur.length && !wrap2(txt)) flush();
    cur.push(w);
    const t2 = fix(cur.map((x) => x.w).join(" "));
    if (/[.?!]$/.test(w.w) && t2.length >= 20) flush();
    else if (/[,:;]$/.test(w.w) && t2.length >= 26 && p.words.length - wi - 1 >= 5) flush();
  }
  flush();
  // merge a very short tail into the previous cue when it still fits
  for (let i = cues.length - 1; i > 0; i--) {
    const tx = fix(cues[i].map((x) => x.w).join(" "));
    if (tx.length < 14 && wrap2(fix([...cues[i - 1], ...cues[i]].map((x) => x.w).join(" ")))) { cues[i - 1].push(...cues[i]); cues.splice(i, 1); }
  }
  cues.forEach((c, i) => {
    const s = A[p.id] + (c[0].s - p.start);
    let e = A[p.id] + (c[c.length - 1].e - p.start) + 0.3;
    const nextS = i + 1 < cues.length ? A[p.id] + (cues[i + 1][0].s - p.start) : e;
    if (i + 1 < cues.length) e = nextS;
    const text = wrap2(fix(c.map((x) => x.w).join(" ")));
    srt.push({ start: s, end: Math.max(e, s + 1.0), text });
    if (!NOCAP.has(p.id)) captions.push({ start: s, end: Math.max(e, s + 1.0), text });
  });
}
for (let i = 0; i + 1 < captions.length; i++) if (captions[i].end > captions[i + 1].start) captions[i].end = captions[i + 1].start;
for (let i = 0; i + 1 < srt.length; i++) if (srt[i].end > srt[i + 1].start) srt[i].end = srt[i + 1].start;

/* ---------------- audio placement ---------------- */
const audio = [];
for (const ch of chapters) {
  const ps = paras.filter((p) => p.chapter === ch.id);
  ps.forEach((p, i) => {
    const prevEnd = i > 0 ? ps[i - 1].end : 0;
    const nextStart = i + 1 < ps.length ? ps[i + 1].start : 1e9;
    const cin = Math.max(prevEnd + 0.02, p.start - 0.12, 0);
    const cout = Math.min(nextStart - 0.02, p.end + 0.25);
    audio.push({ id: p.id, file: `voice/raw/c${ch.id}.mp3`, in: +cin.toFixed(3), out: +cout.toFixed(3), at: +(A[p.id] - (p.start - cin)).toFixed(3) });
  });
}

const tl = { fps: 30, dur: +TOTAL.toFixed(3), layers, captions, srt, audio, chapters: chapters.map((c) => ({ title: c.title, start: +c.start.toFixed(3), end: +c.end.toFixed(3) })) };
fs.writeFileSync(path.join(SRC, "work/timeline.json"), JSON.stringify(tl, null, 1));
console.log(`duration ${TOTAL.toFixed(2)} s, ${layers.length} layers, ${captions.length} captions`);
for (const c of tl.chapters) console.log(`${c.start.toFixed(1).padStart(6)}  ${c.title}`);
