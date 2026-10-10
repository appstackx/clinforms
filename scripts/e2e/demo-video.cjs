/**
 * The product demo video at /demo, in a real browser, as the privacy policy describes it (section 3, "The demo
 * video"): the page sends nothing to the media host until play is pressed, a ?t= chapter link does not either, and
 * the request play makes is an anonymous CORS request that carries no cookies. Plus: the fallback when the media
 * host cannot be reached, keyboard use, and the 375 px layout.
 *
 * Every request to media.clinforms.co.uk is intercepted and answered with a 404, so these checks never reach the
 * media host and do not depend on it. The 404 also stands in for a clinic whose network blocks the address, which is
 * the case the player's "The video plays from media.clinforms.co.uk" panel is for.
 *
 * REAL_MEDIA=1 adds one check against the real media host, in Google Chrome (Playwright's Chromium has no H.264):
 * the page is served as https://clinforms.co.uk/demo (proxied to BASE, so the media host's CORS policy applies as in
 * production), the 1080p file plays and the captions track loads. Read-only: it uploads nothing.
 *
 *   npm run build && PORT=3123 CLINFORMS_DB=sqlite npx next start -p 3123
 *   BASE=http://localhost:3123 NODE_PATH=<node_modules with playwright> node scripts/e2e/demo-video.cjs   [REAL_MEDIA=1]
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "../..");
const BASE = (process.env.BASE || "http://localhost:3123").replace(/\/+$/, "");
const OUT = process.env.E2E_OUT || path.join(REPO, ".e2e-out", "demo-video");
const MEDIA = "https://media.clinforms.co.uk";
const SITE = "https://clinforms.co.uk";
if (/clinforms\.co\.uk/.test(BASE)) throw new Error("Run this against a local or preview server; REAL_MEDIA=1 covers the media host");
fs.mkdirSync(OUT, { recursive: true });

// The chapters as the page's module defines them (src/lib/site/demo-video.ts), read from the source.
const SOURCE = fs.readFileSync(path.join(REPO, "src/lib/site/demo-video.ts"), "utf8");
const CHAPTERS = Array.from(SOURCE.matchAll(/\{\s*at: ([\d.]+),\s*title: "([^"]+)"/g), (m) => ({ at: Number(m[1]), title: m[2] }));
assert.ok(CHAPTERS.length >= 5, "chapters read from demo-video.ts");

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

async function poll(fn, { timeout = 10000, interval = 100 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

/** A fresh context (no cookies, no storage) whose requests to the media host are recorded and answered 404. */
async function open(browser, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions });
  const media = [];
  const foreign = [];
  const errors = [];
  await context.route(`${MEDIA}/**`, async (route) => {
    const request = route.request();
    media.push({ url: request.url(), headers: await request.allHeaders(), type: request.resourceType() });
    await route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith(MEDIA) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return { context, page, media, foreign, errors };
}

const playButton = (page) => page.getByRole("button", { name: /^Play the demo/ });
const failPanel = (page) => page.getByRole("status").filter({ hasText: "The video plays from media.clinforms.co.uk" });
const videoTime = (page) => page.locator("video").evaluate((v) => v.currentTime);
const settle = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
};

(async () => {
  const browser = await chromium.launch();

  await step("opening /demo sends nothing to the media host (or anywhere else off-site)", async () => {
    const { context, page, media, foreign, errors } = await open(browser);
    const res = await page.goto(`${BASE}/demo`);
    assert.equal(res.status(), 200);
    await playButton(page).waitFor({ state: "visible" });
    await settle(page);
    assert.deepEqual(media, []);
    assert.deepEqual(foreign, []);
    // The poster and the captions are same-origin.
    const attrs = await page.locator("video").evaluate((v) => ({
      poster: v.getAttribute("poster"),
      preload: v.getAttribute("preload"),
      crossorigin: v.getAttribute("crossorigin"),
      autoplay: v.autoplay,
      networkState: v.networkState,
      track: v.querySelector("track").getAttribute("src"),
      controls: v.controls,
    }));
    assert.deepEqual(
      { ...attrs, networkState: undefined },
      { poster: "/demo/clinforms-demo-poster.jpg", preload: "none", crossorigin: "anonymous", autoplay: false, networkState: undefined, track: "/demo/clinforms-demo.en-GB.vtt", controls: false },
    );
    assert.notEqual(attrs.networkState, 2, "NETWORK_LOADING before play");
    assert.equal(await page.locator('script[type="application/ld+json"]').count(), 1);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    assert.equal(ld["@type"], "VideoObject");
    assert.equal(ld.hasPart.length, CHAPTERS.length);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(OUT, "desktop.png"), fullPage: false });
    await context.close();
  });

  await step("a ?t= chapter link sets where playback starts without fetching anything", async () => {
    const chapter = CHAPTERS.find((c) => /gap/i.test(c.title)) || CHAPTERS[4];
    const { context, page, media } = await open(browser);
    await page.goto(`${BASE}/demo?t=${Math.floor(chapter.at)}`);
    const t = await poll(async () => {
      const v = await videoTime(page);
      return Math.abs(v - chapter.at) < 0.01 ? v : null;
    });
    assert.ok(t, `currentTime ${await videoTime(page)} != ${chapter.at}`);
    const button = page.getByRole("button", { name: new RegExp(chapter.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    assert.equal(await button.getAttribute("aria-current"), "true");
    await settle(page);
    assert.deepEqual(media, []);
    await context.close();
  });

  await step("play asks the media host anonymously (no cookies, even with a cookie for that host), then offers the transcript when it fails", async () => {
    const { context, page, media } = await open(browser);
    await context.addCookies([{ name: "probe", value: "1", domain: "media.clinforms.co.uk", path: "/", secure: true, sameSite: "None" }]);
    await page.goto(`${BASE}/demo`);
    await playButton(page).waitFor({ state: "visible" });
    await settle(page);
    assert.deepEqual(media, []);
    // Control: a plain (credentialed) request to the media host from this page does carry the cookie.
    await page.evaluate((src) => {
      const img = document.createElement("img");
      img.src = src;
      document.body.appendChild(img);
    }, `${MEDIA}/control-probe.png`);
    const control = await poll(() => media.find((m) => m.url.endsWith("/control-probe.png")));
    assert.ok(control, "control request seen");
    assert.match(control.headers.cookie || "", /probe=1/, "a credentialed request carries the cookie (control)");
    media.length = 0;

    await playButton(page).click();
    await poll(() => media.length > 0);
    assert.ok(media.length > 0, "a media request after play");
    for (const { url, headers } of media) {
      assert.match(url, /^https:\/\/media\.clinforms\.co\.uk\/demo\/\d{4}-\d{2}-\d{2}\/clinforms-demo-1080p\.mp4$/);
      // crossOrigin="anonymous": a CORS request names its origin and carries no cookies.
      assert.equal(headers.origin, BASE, url);
      assert.equal(headers.cookie, undefined, url);
    }
    await failPanel(page).waitFor({ state: "visible" });
    assert.equal(await page.locator("video").evaluate((v) => v.controls), false);
    await failPanel(page).getByRole("link", { name: "full transcript" }).click();
    assert.equal(await page.locator("details#demo-transcript-details").getAttribute("open"), "");
    await page.getByText("Book a 15-minute call at clinforms.co.uk.", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Fictional patient data shown", { exact: false }).first().waitFor({ state: "visible" });
    const download = failPanel(page).getByRole("link", { name: "download the video" });
    assert.match(await download.getAttribute("href"), /^https:\/\/media\.clinforms\.co\.uk\/demo\/.+\.mp4$/);
    await page.screenshot({ path: path.join(OUT, "fallback.png") });
    await context.close();
  });

  await step("keyboard: the play button and the chapters are reachable, visibly focused, and work with Enter", async () => {
    const { context, page, media } = await open(browser);
    await page.goto(`${BASE}/demo`);
    await playButton(page).waitFor({ state: "visible" });
    let label = "";
    for (let i = 0; i < 40 && !/^Play the demo/.test(label); i++) {
      await page.keyboard.press("Tab");
      label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || "");
    }
    assert.match(label, /^Play the demo, 1 minute 30 seconds$/);
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement.querySelector("span")).boxShadow);
    assert.notEqual(ring, "none", "focus ring on the play button");
    await page.screenshot({ path: path.join(OUT, "keyboard-focus.png") });
    await page.keyboard.press("Enter");
    await poll(() => media.length > 0);
    assert.ok(media.length > 0, "Enter on the play button starts loading");
    await failPanel(page).waitFor({ state: "visible" });
    // Focus moves into the panel, so the next Tab reaches its links.
    const inPanel = await poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="status"]')));
    assert.ok(inPanel, "focus moved into the fallback panel");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "full transcript");
    await context.close();

    const second = await open(browser);
    const chapter = CHAPTERS.find((c) => /source/i.test(c.title)) || CHAPTERS[3];
    await second.page.goto(`${BASE}/demo`);
    await playButton(second.page).waitFor({ state: "visible" });
    let text = "";
    for (let i = 0; i < 60 && !text.includes(chapter.title); i++) {
      await second.page.keyboard.press("Tab");
      text = await second.page.evaluate(() => document.activeElement?.textContent || "");
    }
    assert.ok(text.includes(chapter.title), `reached the chapter "${chapter.title}" by Tab`);
    await second.page.keyboard.press("Enter");
    const t = await poll(async () => (Math.abs((await videoTime(second.page)) - chapter.at) < 0.01 ? true : null));
    assert.ok(t, "Enter on a chapter sets its start");
    await poll(() => second.media.length > 0);
    assert.ok(second.media.length > 0, "and starts loading");
    await second.context.close();
  });

  await step("375 px: no sideways scroll, the player fits, phones get the 720p file", async () => {
    const { context, page, media } = await open(browser, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/demo`);
    await playButton(page).waitFor({ state: "visible" });
    const layout = await page.evaluate(() => {
      const v = document.querySelector("video").getBoundingClientRect();
      const b = document.querySelector('button[aria-label^="Play the demo"] > span').getBoundingClientRect();
      return { scrollWidth: document.documentElement.scrollWidth, v: [v.left, v.right, v.height], b: [b.left, b.right] };
    });
    assert.ok(layout.scrollWidth <= 375, `scrollWidth ${layout.scrollWidth}`);
    assert.ok(layout.v[0] >= 0 && layout.v[1] <= 375 && layout.v[2] > 150, JSON.stringify(layout));
    assert.ok(layout.b[0] >= layout.v[0] && layout.b[1] <= layout.v[1], `play button inside the video ${JSON.stringify(layout)}`);
    await page.screenshot({ path: path.join(OUT, "mobile-375.png"), fullPage: true });
    await settle(page);
    assert.deepEqual(media, []);
    await playButton(page).tap();
    await poll(() => media.length > 0);
    assert.match(media[0].url, /clinforms-demo-720p\.mp4$/);
    await failPanel(page).waitFor({ state: "visible" });
    const panel = await failPanel(page).evaluate((el) => {
      const r = el.firstElementChild.getBoundingClientRect();
      return [r.left, r.right];
    });
    assert.ok(panel[0] >= 0 && panel[1] <= 375, `fallback panel fits ${panel}`);
    await page.screenshot({ path: path.join(OUT, "mobile-375-fallback.png") });
    await context.close();
  });

  await step("the header fits from 375 px to desktop (links collapse into the menu below lg)", async () => {
    for (const width of [375, 768, 1023, 1024, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/`);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, nav: getComputedStyle(document.querySelector('nav[aria-label="Main"]')).display }));
      assert.ok(m.sw <= width, `${width}: scrollWidth ${m.sw}`);
      assert.equal(m.nav === "none", width < 1024, `${width}: nav display ${m.nav}`);
      if (width >= 1024) {
        const header = await page.locator("header").evaluate((h) => h.scrollWidth <= h.clientWidth);
        assert.ok(header, `${width}: header overflows`);
        await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Watch the demo" }).waitFor({ state: "visible" });
      } else {
        await page.getByRole("button", { name: "Open menu" }).click();
        await page.getByRole("navigation", { name: "Main (mobile)" }).getByRole("link", { name: "Watch the demo" }).waitFor({ state: "visible" });
      }
      if (width === 1280) {
        await page.getByRole("link", { name: /^Watch the demo/ }).nth(1).waitFor({ state: "visible" }); // the hero's call to action
        await page.screenshot({ path: path.join(OUT, "home-1280.png") });
      }
      await context.close();
    }
  });

  if (process.env.REAL_MEDIA === "1") {
    await step("REAL_MEDIA: served as https://clinforms.co.uk/demo, the 1080p file plays from the media host with captions", async () => {
      let chrome;
      try {
        chrome = await chromium.launch({ channel: "chrome" });
      } catch (e) {
        throw new Error(`Google Chrome is needed for H.264: ${e.message}`);
      }
      const context = await chrome.newContext({ viewport: { width: 1440, height: 900 } });
      await context.route(`${SITE}/**`, async (route) => {
        const u = new URL(route.request().url());
        const response = await route.fetch({ url: `${BASE}${u.pathname}${u.search}` });
        await route.fulfill({ response });
      });
      const mediaResponses = [];
      const page = await context.newPage();
      page.on("response", async (r) => {
        if (r.url().startsWith(MEDIA)) mediaResponses.push({ url: r.url(), status: r.status(), acao: (await r.allHeaders())["access-control-allow-origin"], origin: (await r.request().allHeaders()).origin, cookie: (await r.request().allHeaders()).cookie });
      });
      await page.goto(`${SITE}/demo`);
      await playButton(page).click();
      const playing = await poll(() => page.locator("video").evaluate((v) => (v.readyState >= 3 && v.currentTime > 1.5 ? { t: v.currentTime, d: v.duration, src: v.currentSrc, w: v.videoWidth } : null)), { timeout: 30000 });
      assert.ok(playing, `did not play: ${JSON.stringify(await page.locator("video").evaluate((v) => ({ rs: v.readyState, err: v.error && v.error.code, t: v.currentTime })))}`);
      assert.match(playing.src, /clinforms-demo-1080p\.mp4$/);
      assert.equal(playing.w, 1920);
      assert.ok(Math.abs(playing.d - 89.94) < 0.1, `duration ${playing.d}`);
      const cues = await page.locator("video").evaluate((v) => (v.textTracks[0] && v.textTracks[0].cues ? v.textTracks[0].cues.length : 0));
      assert.equal(cues, 22);
      assert.ok(mediaResponses.length > 0);
      for (const r of mediaResponses) {
        assert.ok([200, 206].includes(r.status), `${r.status} ${r.url}`);
        assert.equal(r.acao, SITE);
        assert.equal(r.origin, SITE);
        assert.equal(r.cookie, undefined);
      }
      await page.screenshot({ path: path.join(OUT, "real-playing.png") });
      // Near the end: it finishes cleanly.
      await page.locator("video").evaluate((v) => (v.currentTime = 88.5));
      const ended = await poll(() => page.locator("video").evaluate((v) => v.ended), { timeout: 15000 });
      assert.ok(ended, "reached the end");
      await chrome.close();
    });
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` – FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})();
