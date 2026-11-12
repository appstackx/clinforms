/**
 * The installable staff app's icons (12/11/2026, tracker xt05), rendered from the EXISTING ClinDesk mark
 * (public/clindesk/favicon.svg – no new artwork) in a real Chromium:
 *
 *   public/clindesk/app/icon-192.png, icon-512.png   the mark as is (its rounded cream tile, transparent corners)
 *   public/clindesk/app/icon-maskable-512.png        full-bleed cream, the mark scaled into the maskable safe zone
 *                                                   (the centre circle of 80% – Android crops to any shape)
 *   public/clindesk/apple-touch-icon.png (180)       full-bleed cream square (iOS rounds the corners itself)
 *
 *   NODE_PATH=/Users/khuram/Projects/Appstackx/pigeon-web/node_modules node scripts/pwa/gen-icons.cjs
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PW_MODULE || "playwright");

const REPO = path.resolve(__dirname, "../..");
const MARK = fs.readFileSync(path.join(REPO, "public/clindesk/favicon.svg"), "utf8").trim();
const CREAM = (MARK.match(/<rect width="40" height="40" rx="9" fill="(#[0-9A-Fa-f]{6})"/) || [])[1];
if (!CREAM) throw new Error("favicon.svg changed: the tile colour was not found");
const inner = MARK.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

/** The mark on a full-bleed cream square, scaled about its centre. */
const onSquare = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${CREAM}"/><g transform="translate(20 20) scale(${scale}) translate(-20 -20)">${inner}</g></svg>`;

const OUTPUTS = [
  { file: "public/clindesk/app/icon-192.png", size: 192, svg: MARK },
  { file: "public/clindesk/app/icon-512.png", size: 512, svg: MARK },
  // The tapes reach ~17 units from the centre; the safe zone is a circle of radius 16 (40 × 0.4) → 0.72 keeps them inside.
  { file: "public/clindesk/app/icon-maskable-512.png", size: 512, svg: onSquare(0.72) },
  // iOS rounds the corners itself (a squircle): the tapes keep clear of them.
  { file: "public/clindesk/apple-touch-icon.png", size: 180, svg: onSquare(0.82) },
];

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const out of OUTPUTS) {
      const page = await browser.newPage({ viewport: { width: out.size, height: out.size }, deviceScaleFactor: 1 });
      const svg = out.svg.replace("<svg ", `<svg width="${out.size}" height="${out.size}" `);
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
      fs.mkdirSync(path.dirname(path.join(REPO, out.file)), { recursive: true });
      await page.screenshot({ path: path.join(REPO, out.file), omitBackground: true, clip: { x: 0, y: 0, width: out.size, height: out.size } });
      await page.close();
      console.log(`wrote ${out.file} (${out.size}×${out.size})`);
    }
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
