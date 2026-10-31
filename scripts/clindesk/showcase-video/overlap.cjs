// QA: every 0.5 s, list text boxes/labels that intersect the caption pill.
const fs = require("fs"), path = require("path");
const { chromium } = require("/Users/khuram/Projects/Appstackx/pigeon-web/node_modules/playwright");
const SRC = path.resolve(__dirname, "..");
const TL = JSON.parse(fs.readFileSync(path.join(SRC, "work/timeline.json"), "utf8"));
(async () => {
  const b = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto("file://" + path.join(SRC, "motion/render.html"));
  await page.evaluate((tl) => window.init(tl), TL);
  const out = [];
  let n = 0;
  for (let t = 0; t < TL.dur; t += 0.5, n++) {
    await page.evaluate((t) => window.seek(t), t);
    const h = await page.evaluate(() => window.capOverlaps());
    if (h.length) out.push(`${t.toFixed(1)}  ${[...new Set(h)].join(" | ")}`);
  }
  console.log(`checked ${n} times, ${out.length} with overlaps`);
  console.log(out.join("\n"));
  fs.writeFileSync(path.join(SRC, "work/qa/overlaps.txt"), out.join("\n") + "\n");
  await b.close();
})();
