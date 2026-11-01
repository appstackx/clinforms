/**
 * The ClinDesk tour at /tour, in Google Chrome (Playwright's Chromium cannot decode H.264), against the REAL media
 * host: the page is served as https://clindesk.co.uk/tour (every request to clindesk.co.uk is answered by the local
 * server at BASE on its clinic host, so the bucket's CORS policy applies exactly as in production; nothing reaches the
 * real clindesk.co.uk). Read-only towards the media host: it uploads nothing.
 *
 *   - 1440 and 375 px: the page renders (one h1, the player, 7 chapters, the calls to action), no sideways scroll,
 *     axe-core WCAG 2.2 AA scan clean; screenshots;
 *   - opening the page (and a ?t= chapter link) sends nothing to the media host; the poster is same-origin;
 *   - play: the 720p file's metadata loads from the media host (200/206, CORS for https://clindesk.co.uk, no cookies);
 *   - captions: the WebVTT track loads from the media host, and its cues say exactly what the transcript says;
 *   - a chapter button seeks to its chapter; ?t=67 opens the Reports chapter; "1080p" switches files at the same point;
 *   - the media host refused (a clinic's web filter): the panel names the host and opens the transcript;
 *   - the home hero, the Reports page (at its chapter) and the footer link to /tour; clinforms.co.uk has no /tour.
 *
 *   npm run build && PORT=3197 CLINFORMS_DB=sqlite npx next start -p 3197
 *   BASE=http://localhost:3197 [SHOTS=<folder for the screenshots>] NODE_PATH=<node_modules with playwright> \
 *     node scripts/e2e/clindesk-tour.cjs
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const BASE = (process.env.BASE || "http://localhost:3197").replace(/\/+$/, "");
const LOCAL_SITE = BASE.replace("localhost", "clinic.localhost");
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "clindesk-tour");
const SHOTS = process.env.SHOTS || OUT;
const AXE = process.env.AXE || require.resolve("axe-core/axe.min.js", { paths: [REPO] });
const SITE = "https://clindesk.co.uk";
const MEDIA = "https://media.clinforms.co.uk";
const MEDIA_BASE = `${MEDIA}/clindesk/tour/2026-10-31`;
if (/clindesk\.co\.uk|clinforms\.co\.uk/.test(BASE)) throw new Error("Run this against a local or preview server");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// The chapters and transcript as the page's module defines them (src/lib/clindesk-site/tour-video.ts), read from the source.
const SOURCE = fs.readFileSync(path.join(REPO, "src/lib/clindesk-site/tour-video.ts"), "utf8");
const CHAPTERS = Array.from(SOURCE.matchAll(/\{\s*at: ([\d.]+),(?:\s*clock: "([^"]+)",)?\s*title: "([^"]+)"/g), (m) => ({ at: Number(m[1]), clock: m[2], title: m[3] }));
assert.equal(CHAPTERS.length, 7, "chapters read from tour-video.ts");
const TRANSCRIPT = Array.from(SOURCE.matchAll(/transcript: \[([\s\S]*?)\],/g), (m) => Array.from(m[1].matchAll(/"([^"]+)"/g), (x) => x[1]).join(" ")).join(" ");
/** Words only: apostrophes straight or curly, punctuation and line breaks ignored. */
const words = (s) => s.replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'£:]+/gu, " ").trim().toLowerCase();

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e && e.stack ? e.stack : e).slice(0, 1500) });
    console.log(`FAIL ${name}\n     ${String(e && e.message ? e.message : e).slice(0, 800)}`);
  }
}
async function poll(fn, { timeout = 15000, interval = 100 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

/**
 * A fresh Chrome context whose requests to https://clindesk.co.uk are answered by the local server (clinic host),
 * with every media-host request and response recorded. `mediaMode: "refuse"` answers the media host with a 404.
 */
async function open(browser, viewport, { mediaMode = "real" } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 768 ? 2 : 1, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  await context.route(`${SITE}/**`, async (route) => {
    const u = new URL(route.request().url());
    // Node does not resolve *.localhost: fetch BASE with the clinic host's Host header.
    const headers = { ...route.request().headers(), host: new URL(LOCAL_SITE).host };
    const response = await route.fetch({ url: `${BASE}${u.pathname}${u.search}`, headers });
    await route.fulfill({ response });
  });
  if (mediaMode === "refuse") await context.route(`${MEDIA}/**`, (route) => route.fulfill({ status: 404, body: "" }));
  const page = await context.newPage();
  const media = [];
  const foreign = [];
  const errors = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(SITE) && !u.startsWith(MEDIA) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
  });
  page.on("response", async (r) => {
    if (!r.url().startsWith(MEDIA)) return;
    const req = await r.request().allHeaders();
    media.push({ url: r.url(), status: r.status(), acao: (await r.allHeaders())["access-control-allow-origin"], origin: req.origin, cookie: req.cookie, type: r.request().resourceType() });
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return { context, page, media, foreign, errors };
}

const video = (page) => page.locator("video");
const playButton = (page) => page.getByRole("button", { name: /^Play the tour/ });

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    // .f-giant is the footer's decorative giant word (aria-hidden, 20% opacity), exempt as in clindesk-site.cjs.
    // eslint-disable-next-line no-undef
    const r = await axe.run({ exclude: [[".f-giant"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  assert.equal(res.length, 0, `${label}: axe – ${res.join("; ")}`);
}

async function layout(page, width) {
  const m = await page.evaluate(() => {
    const v = document.querySelector("video").getBoundingClientRect();
    return {
      scrollWidth: document.scrollingElement.scrollWidth,
      h1: Array.from(document.querySelectorAll("h1"), (h) => h.textContent.trim()),
      video: [Math.round(v.left), Math.round(v.right), Math.round(v.height)],
      chapters: document.querySelectorAll("nav[aria-labelledby='tv-chapters-heading'] li button").length,
      poster: document.querySelector("video").getAttribute("poster"),
      track: (() => {
        const t = document.querySelector("video track");
        return { src: t.getAttribute("src"), def: t.default, kind: t.kind, mode: document.querySelector("video").textTracks[0].mode };
      })(),
      ctas: Array.from(document.querySelectorAll(".tv-ctas a"), (a) => [a.textContent.replace(/\s+/g, " ").trim(), a.getAttribute("href")]),
      ld: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent),
      title: document.title,
      canonical: document.querySelector("link[rel=canonical]")?.href,
      description: document.querySelector("meta[name=description]")?.content,
    };
  });
  assert.ok(m.scrollWidth <= width, `${width}: scrollWidth ${m.scrollWidth}`);
  assert.deepEqual(m.h1, ["Watch the 3-minute tour"]);
  assert.ok(m.video[0] >= 0 && m.video[1] <= width && m.video[2] > 150, `${width}: video box ${m.video}`);
  assert.equal(m.chapters, 7);
  assert.equal(m.poster, "/clindesk/tour/clindesk-tour-poster.jpg");
  assert.deepEqual(m.track, { src: `${MEDIA_BASE}/clindesk-tour.en-GB.vtt`, def: false, kind: "captions", mode: "disabled" });
  assert.deepEqual(m.ctas, [["Book a demo →", "/demo"], ["See pricing →", "/pricing"]]);
  assert.equal(m.title, "Watch the 3-minute tour – ClinDesk");
  assert.equal(m.canonical, `${SITE}/tour`);
  assert.ok(m.description && m.description.length > 50);
  assert.equal(m.ld["@type"], "VideoObject");
  assert.equal(m.ld.contentUrl, `${MEDIA_BASE}/clindesk-tour-1080p.mp4`);
  assert.equal(m.ld.hasPart.length, 7);
  return m;
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch (e) {
    throw new Error(`Google Chrome is needed for H.264: ${e.message}`);
  }

  await step("1440: /tour renders on clindesk.co.uk, nothing goes to the media host on open, axe clean", async () => {
    const { context, page, media, foreign, errors } = await open(browser, { width: 1440, height: 900 });
    const res = await page.goto(`${SITE}/tour`, { waitUntil: "networkidle" });
    assert.equal(res.status(), 200);
    await layout(page, 1440);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    assert.deepEqual(media, [], `media requests on open: ${JSON.stringify(media)}`);
    assert.deepEqual(foreign, []);
    await page.screenshot({ path: path.join(SHOTS, "tour-1440.png"), fullPage: true });
    await page.screenshot({ path: path.join(SHOTS, "tour-1440-fold.png") });
    await axe(page, "/tour@1440");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await step("play: the 720p file's metadata loads from the media host, CORS for clindesk.co.uk, no cookies", async () => {
    const { context, page, media } = await open(browser, { width: 1440, height: 900 });
    await context.addCookies([{ name: "probe", value: "1", domain: ".clinforms.co.uk", path: "/", secure: true }]);
    await page.goto(`${SITE}/tour`, { waitUntil: "networkidle" });
    await playButton(page).click();
    const meta = await poll(() => video(page).evaluate((v) => (v.readyState >= 1 && v.duration > 0 ? { d: v.duration, src: v.currentSrc, w: v.videoWidth, h: v.videoHeight } : null)), { timeout: 30000 });
    assert.ok(meta, `no metadata: ${JSON.stringify(await video(page).evaluate((v) => ({ rs: v.readyState, err: v.error && v.error.code, ns: v.networkState })))}`);
    assert.equal(meta.src, `${MEDIA_BASE}/clindesk-tour-720p.mp4`);
    assert.deepEqual([meta.w, meta.h], [1280, 720]);
    assert.ok(Math.abs(meta.d - 181.46) < 0.1, `duration ${meta.d}`);
    const playing = await poll(() => video(page).evaluate((v) => (!v.paused && v.currentTime > 1 ? v.currentTime : null)), { timeout: 20000 });
    assert.ok(playing, "plays");
    assert.equal(await video(page).evaluate((v) => v.controls), true, "native controls after the first play");
    assert.ok(media.length > 0);
    for (const r of media) {
      assert.ok([200, 206].includes(r.status), `${r.status} ${r.url}`);
      assert.equal(r.acao, SITE, r.url);
      assert.equal(r.origin, SITE, r.url);
      assert.equal(r.cookie, undefined, `cookie sent to ${r.url}`);
    }
    assert.ok(media.some((r) => r.status === 206), "range requests answered 206");
    await page.screenshot({ path: path.join(OUT, "playing-1440.png") });
    await context.close();
  });

  await step("captions: the WebVTT track loads from the media host, 50 cues, word for word the transcript", async () => {
    const { context, page, media } = await open(browser, { width: 1440, height: 900 });
    await page.goto(`${SITE}/tour`, { waitUntil: "networkidle" });
    await video(page).evaluate((v) => (v.textTracks[0].mode = "hidden"));
    const cues = await poll(() => video(page).evaluate((v) => (v.textTracks[0].cues && v.textTracks[0].cues.length ? Array.from(v.textTracks[0].cues, (c) => ({ s: c.startTime, e: c.endTime, t: c.text })) : null)), { timeout: 15000 });
    assert.ok(cues, "cues loaded");
    assert.equal(cues.length, 50);
    const vtt = media.find((r) => r.url.endsWith(".vtt"));
    assert.ok(vtt && vtt.status === 200 && vtt.acao === SITE, JSON.stringify(vtt));
    assert.equal(words(cues.map((c) => c.t).join(" ")), words(TRANSCRIPT), "captions = transcript");
    // Each chapter's transcript is the cues inside it.
    for (let i = 0; i < CHAPTERS.length; i++) {
      const end = CHAPTERS[i + 1]?.at ?? 1e9;
      const inside = cues.filter((c) => c.s >= CHAPTERS[i].at && c.s < end);
      assert.ok(inside.length > 0, CHAPTERS[i].title);
    }
    await context.close();
  });

  await step("chapters: a chapter button seeks; ?t=67 opens the Reports chapter without fetching; 1080p keeps the place", async () => {
    const { context, page, media } = await open(browser, { width: 1440, height: 900 });
    await page.goto(`${SITE}/tour?t=67`, { waitUntil: "networkidle" });
    assert.equal(await video(page).evaluate((v) => v.currentTime), 67.167);
    assert.equal(await page.locator(".tv-ch[aria-current='true']").innerText().then((t) => t.replace(/\s+/g, " ")), "1:07 11:40 ClinDesk Reports (add-on)");
    assert.deepEqual(media, [], "a ?t= link fetches nothing");
    const chapter = CHAPTERS[5];
    await page.getByRole("button", { name: new RegExp(`^2:08 .*${chapter.title}`) }).click();
    const seeked = await poll(() => video(page).evaluate((v) => (v.readyState >= 2 && !v.seeking && v.currentTime >= 128 ? v.currentTime : null)), { timeout: 30000 });
    assert.ok(seeked && seeked < 131, `at ${seeked}`);
    assert.match(await page.locator(".tv-ch[aria-current='true']").innerText(), /Billing, authorisations and card payment/);
    await page.getByRole("button", { name: /^1080p/ }).click();
    const hd = await poll(() => video(page).evaluate((v) => (v.videoWidth === 1920 && v.readyState >= 2 ? { src: v.currentSrc, t: v.currentTime, paused: v.paused } : null)), { timeout: 30000 });
    assert.ok(hd, "1080p loaded");
    assert.equal(hd.src, `${MEDIA_BASE}/clindesk-tour-1080p.mp4`);
    assert.ok(hd.t >= 128 && hd.t < 140, `kept the place: ${hd.t}`);
    assert.equal(await page.getByRole("button", { name: /^1080p/ }).getAttribute("aria-pressed"), "true");
    await context.close();
  });

  await step("375: no sideways scroll, the player fits, axe clean; the phone screenshot", async () => {
    const { context, page, media } = await open(browser, { width: 375, height: 812 });
    await page.goto(`${SITE}/tour`, { waitUntil: "networkidle" });
    await layout(page, 375);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    assert.deepEqual(media, []);
    await page.screenshot({ path: path.join(SHOTS, "tour-375.png"), fullPage: true });
    await page.screenshot({ path: path.join(SHOTS, "tour-375-fold.png") });
    await axe(page, "/tour@375");
    // Opened transcript: still no sideways scroll.
    await page.getByText("Read what the tour says and shows").click();
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 375));
    await axe(page, "/tour@375 transcript open");
    await context.close();
  });

  await step("the media host refused: the panel names it, opens the transcript, and fits at 375", async () => {
    for (const width of [1440, 375]) {
      const { context, page } = await open(browser, { width, height: width === 375 ? 812 : 900 }, { mediaMode: "refuse" });
      await page.goto(`${SITE}/tour`, { waitUntil: "networkidle" });
      await playButton(page).click();
      const panel = page.getByRole("status").filter({ hasText: "The video plays from media.clinforms.co.uk" });
      await panel.waitFor({ state: "visible", timeout: 10000 });
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, `panel fits ${JSON.stringify(box)}`);
      await panel.getByRole("link", { name: "full transcript" }).click();
      assert.equal(await page.locator("#tour-transcript-details").evaluate((d) => d.open), true);
      if (width === 375) await page.screenshot({ path: path.join(OUT, "refused-375.png") });
      await context.close();
    }
  });

  await step("links: home hero, Reports page (its chapter) and footer lead to /tour; clinforms.co.uk has no /tour", async () => {
    const { context, page } = await open(browser, { width: 1440, height: 900 });
    await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
    const hero = page.locator(".hero-copy").getByRole("link", { name: "Watch the 3-minute tour" });
    assert.equal(await hero.getAttribute("href"), "/tour");
    const heroBox = await hero.boundingBox();
    const demoBox = await page.locator(".hero-ctas").getByRole("link", { name: /Book a demo/ }).boundingBox();
    assert.ok(heroBox.y > demoBox.y && heroBox.y - demoBox.y < 140, `tour link near "Book a demo": ${heroBox.y} vs ${demoBox.y}`);
    assert.ok(heroBox.height >= 44, `hero link target ${heroBox.height}`);
    await page.screenshot({ path: path.join(OUT, "home-hero-1440.png") });
    assert.equal(await page.locator("footer").getByRole("link", { name: "Watch the 3-minute tour" }).getAttribute("href"), "/tour");
    await page.goto(`${SITE}/reports`, { waitUntil: "domcontentloaded" });
    const reports = page.locator(".rp-hero-copy").getByRole("link", { name: /Watch Reports in the 3-minute tour \(from 1:07\)/ });
    assert.equal(await reports.getAttribute("href"), "/tour?t=67");
    await page.screenshot({ path: path.join(OUT, "reports-hero-1440.png") });
    await reports.click();
    await page.waitForURL(`${SITE}/tour?t=67`);
    assert.equal(await video(page).evaluate((v) => v.currentTime), 67.167);
    await context.close();
    const other = await browser.newPage();
    const res = await other.goto(`${BASE}/tour`);
    assert.equal(res.status(), 404, "clinforms host /tour");
    await other.close();
  });

  await browser.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` – FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})();
