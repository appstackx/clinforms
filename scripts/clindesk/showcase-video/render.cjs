// Frame-accurate render of work/timeline.json through motion/render.html (Playwright, 1920x1080, 30 fps).
//   node render.cjs [--out work/frames] [--workers 4] [--from s] [--to s] [--times 1,2,3 --out dir]  (stills)
const fs = require("fs");
const path = require("path");
const { chromium } = require("/Users/khuram/Projects/Appstackx/pigeon-web/node_modules/playwright");
const SRC = path.resolve(__dirname, "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TL = JSON.parse(fs.readFileSync(path.join(SRC, "work/timeline.json"), "utf8"));
const out = path.resolve(SRC, arg("out", "work/frames"));
fs.mkdirSync(out, { recursive: true });
const fps = TL.fps;

async function worker(frames, wi) {
  const b = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--allow-file-access-from-files", "--disable-web-security"] });
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", String(e)));
  await page.goto("file://" + path.join(SRC, "motion/render.html"));
  await page.evaluate((tl) => window.init(tl), TL);
  await page.waitForTimeout(300);
  let n = 0;
  for (const f of frames) {
    await page.evaluate((t) => window.seek(t), f.t);
    await page.screenshot({ path: path.join(out, f.name), type: "jpeg", quality: 94 });
    if (++n % 300 === 0) console.log(`w${wi}: ${n}/${frames.length}`);
  }
  await b.close();
}

(async () => {
  let frames;
  if (arg("times")) frames = arg("times").split(",").map((x) => ({ t: +x, name: `t${(+x).toFixed(2).padStart(7, "0")}.jpg` }));
  else {
    const a = Math.round(+arg("from", 0) * fps), z = Math.round(+arg("to", TL.dur) * fps);
    frames = [];
    for (let k = a; k < z; k++) frames.push({ t: k / fps, name: `${String(k).padStart(5, "0")}.jpg` });
  }
  const W = Math.min(+arg("workers", 4), frames.length);
  const parts = Array.from({ length: W }, (_, i) => frames.filter((_, k) => k % W === i));
  const t0 = Date.now();
  await Promise.all(parts.map((p, i) => worker(p, i)));
  console.log(`rendered ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
