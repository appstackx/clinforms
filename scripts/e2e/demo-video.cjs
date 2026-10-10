/**
 * The product demo video at /demo, in a real browser, as the privacy policy describes it (section 3, "The demo
 * video"): the page sends nothing to the media host until play is pressed, a ?t= chapter link does not either, and
 * the request play makes is an anonymous CORS request that carries no cookies. Plus: the fallback when the media
 * host cannot be reached, keyboard use, and the 375 px layout.
 *
 * Every request to media.clinforms.co.uk is intercepted and answered with a 404 (or, for the "hang" case, never
 * answered), so these checks never reach the media host and do not depend on it. The 404 also stands in for a clinic
 * whose network blocks the address, which is the case the player's "The video plays from media.clinforms.co.uk"
 * panel is for; the hang stands in for a network that drops the request silently. The end-of-video panel is checked
 * by sending the video's "ended" event (Playwright's Chromium cannot decode the H.264 files).
 *
 * REAL_MEDIA=1 adds checks against the real media host, in Google Chrome (Playwright's Chromium has no H.264):
 * the page is served as https://clinforms.co.uk/demo (proxied to BASE, so the media host's CORS policy applies as in
 * production), the 1080p file plays, the captions track loads, the end panel appears over the end card, and a
 * response held back past the stall time shows the panel, which goes when the video starts. Read-only: it uploads
 * nothing.
 *
 * ANALYTICS=1 (needs a build with NEXT_PUBLIC_POSTHOG_KEY set to a dummy key; /ingest is answered locally, nothing
 * reaches the analytics provider): no event before consent; after consent the play and completed events carry
 * area="marketing" only; and nothing at all is sent after consent is withdrawn.
 *
 *   npm run build && PORT=3123 CLINFORMS_DB=sqlite npx next start -p 3123
 *   BASE=http://localhost:3123 NODE_PATH=<node_modules with playwright> node scripts/e2e/demo-video.cjs   [REAL_MEDIA=1] [ANALYTICS=1]
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
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

/**
 * A fresh context (no cookies, no storage) whose requests to the media host are recorded and answered 404, or with
 * `mediaMode: "hang"` never answered (a network that drops the request silently).
 */
async function open(browser, contextOptions = {}, { mediaMode = "404", visitor = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions });
  if (visitor) {
    // The analytics library drops every event from an automated or headless browser as a bot (navigator.webdriver,
    // "HeadlessChrome" in the user agent or its brands). Look like an ordinary visitor's Chrome.
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
      const brands = typeof NavigatorUAData === "function" && Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, "brands");
      if (brands && brands.get) {
        Object.defineProperty(NavigatorUAData.prototype, "brands", {
          get() {
            return brands.get.call(this).map((b) => ({ ...b, brand: b.brand.replace("HeadlessChrome", "Google Chrome") }));
          },
        });
      }
    });
  }
  const media = [];
  const foreign = [];
  const errors = [];
  await context.route(`${MEDIA}/**`, async (route) => {
    const request = route.request();
    media.push({ url: request.url(), headers: await request.allHeaders(), type: request.resourceType() });
    if (mediaMode === "hang") return; // never answered
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
const endPanel = (page) => page.getByRole("group", { name: "See it with your referrers’ forms" });
const activeTag = (page) => page.evaluate(() => document.activeElement?.tagName || null);
/** The events in an analytics request body (plain JSON, gzip, or base64 "data=" form). */
function ingestEvents(request) {
  const buf = request.postDataBuffer();
  if (!buf || !buf.length) return [];
  const attempts = [
    () => buf.toString("utf8"),
    () => zlib.gunzipSync(buf).toString("utf8"),
    () => Buffer.from(decodeURIComponent(buf.toString("utf8").replace(/^data=/, "")), "base64").toString("utf8"),
  ];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt());
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.batch) ? parsed.batch : [parsed];
      return list.map((e) => ({ event: e.event, properties: e.properties || {} }));
    } catch {
      // next encoding
    }
  }
  return [{ event: "(unreadable)", properties: {} }];
}

/** The video's "ended" event, as a browser sends it when playback reaches the end. */
const sendEnded = (page) => page.locator("video").evaluate((v) => v.dispatchEvent(new Event("ended")));
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
    const download = failPanel(page).getByRole("link", { name: /^download the video/ });
    assert.equal(await download.textContent(), "download the video (9 MB)");
    assert.match(await download.getAttribute("href"), /^https:\/\/media\.clinforms\.co\.uk\/demo\/\d{4}-\d{2}-\d{2}\/clinforms-demo-1080p\.mp4$/);
    assert.equal(await download.getAttribute("rel"), "noreferrer");
    await failPanel(page).getByText("On another network you can also", { exact: false }).waitFor({ state: "visible" });
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

  await step("a request that hangs (no error, no data): play by mouse hands focus to the video, then the panel appears and takes it", async () => {
    const { context, page, media } = await open(browser, {}, { mediaMode: "hang" });
    await page.goto(`${BASE}/demo`);
    await playButton(page).waitFor({ state: "visible" });
    await playButton(page).click();
    await poll(() => media.length > 0);
    assert.ok(media.length > 0, "a media request after play");
    // A mouse click removes the button; focus goes to the video, not back to the top of the page.
    assert.equal(await poll(async () => ((await activeTag(page)) === "VIDEO" ? "VIDEO" : null), { timeout: 3000 }), "VIDEO");
    assert.equal(await failPanel(page).count(), 0, "no panel while the request is young");
    const t0 = Date.now();
    await failPanel(page).waitFor({ state: "visible", timeout: 20000 });
    const waited = Date.now() - t0;
    assert.ok(waited > 5000, `panel after ${waited} ms`);
    const state = await page.locator("video").evaluate((v) => ({ readyState: v.readyState, networkState: v.networkState, error: v.error && v.error.code, controls: v.controls }));
    assert.equal(state.readyState, 0);
    assert.equal(state.error, null, "no media error: the request just hangs");
    assert.equal(state.controls, false);
    assert.ok(await poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="status"]'))), "focus moved into the panel");
    await failPanel(page).getByRole("link", { name: "full transcript" }).waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(OUT, "hang-fallback.png") });
    await context.close();
  });

  await step("the end: a panel offers the call, a replay and the interactive demo over the end card", async () => {
    const { context, page, media } = await open(browser);
    await page.goto(`${BASE}/demo`);
    await playButton(page).waitFor({ state: "visible" });
    await settle(page);
    await sendEnded(page);
    await endPanel(page).waitFor({ state: "visible" });
    // Back to the end card (the cut fades to black over its last half-second).
    assert.equal(await videoTime(page), 89);
    assert.equal(await page.locator("video").evaluate((v) => v.controls), false);
    const book = endPanel(page).getByRole("link", { name: "Book a 15-minute call" });
    assert.equal(await book.getAttribute("href"), "/request-access");
    assert.equal(await endPanel(page).getByRole("link", { name: "Try the interactive demo" }).getAttribute("href"), "/reports");
    // The chapter list shows the last chapter as current.
    assert.equal(await page.getByRole("button", { name: /Book a 15-minute call$/ }).getAttribute("aria-current"), "true");
    await page.screenshot({ path: path.join(OUT, "ended.png") });
    assert.deepEqual(media, []);
    await endPanel(page).getByRole("button", { name: "Watch again" }).click();
    await endPanel(page).waitFor({ state: "hidden" });
    await poll(() => media.length > 0);
    assert.ok(media.length > 0, "Watch again plays");
    assert.equal(await videoTime(page), 0);
    await failPanel(page).waitFor({ state: "visible" }); // the stubbed 404
    await context.close();

    // At 375 px the panel fits inside the player.
    const phone = await open(browser, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.page.goto(`${BASE}/demo`);
    await playButton(phone.page).waitFor({ state: "visible" });
    await sendEnded(phone.page);
    await endPanel(phone.page).waitFor({ state: "visible" });
    const fit = await phone.page.evaluate(() => {
      const v = document.querySelector("video").getBoundingClientRect();
      const items = Array.from(document.querySelectorAll('[role="group"] a, [role="group"] button')).map((el) => el.getBoundingClientRect());
      return items.every((r) => r.top >= v.top && r.bottom <= v.bottom && r.left >= v.left && r.right <= v.right) ? true : JSON.stringify({ v, items });
    });
    assert.equal(fit, true, `end panel controls inside the player: ${fit}`);
    await phone.page.screenshot({ path: path.join(OUT, "ended-375.png") });
    await phone.context.close();
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
    // The pill sits in the poster's empty lower band, clear of its name and headline (upper two thirds).
    const band = await page.evaluate(() => {
      const v = document.querySelector("video").getBoundingClientRect();
      const b = document.querySelector('button[aria-label^="Play the demo"] > span').getBoundingClientRect();
      return { top: (b.top - v.top) / v.height, bottom: (b.bottom - v.top) / v.height };
    });
    assert.ok(band.top >= 0.68 && band.bottom <= 0.98, `pill at ${JSON.stringify(band)} of the video's height`);
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
    const mobileDownload = failPanel(page).getByRole("link", { name: /^download the video/ });
    assert.match(await mobileDownload.getAttribute("href"), /clinforms-demo-720p\.mp4$/);
    assert.equal(await mobileDownload.textContent(), "download the video (5 MB)");
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
        const nav = page.getByRole("navigation", { name: "Main" });
        await nav.getByRole("link", { name: "Demo video" }).waitFor({ state: "visible" });
        await nav.getByRole("link", { name: "Interactive demo" }).waitFor({ state: "visible" });
      } else {
        await page.getByRole("button", { name: "Open menu" }).click();
        const nav = page.getByRole("navigation", { name: "Main (mobile)" });
        await nav.getByRole("link", { name: "Demo video" }).waitFor({ state: "visible" });
        await nav.getByRole("link", { name: "Interactive demo" }).waitFor({ state: "visible" });
      }
      if (width === 1280) {
        // The hero's and the final section's calls to action; the length is spoken in words.
        const cta = page.getByRole("link", { name: /^Watch the demo ?, 1 minute 30 seconds$/ });
        assert.equal(await cta.count(), 2);
        await cta.first().waitFor({ state: "visible" });
        await page.screenshot({ path: path.join(OUT, "home-1280.png") });
        // On /demo the header marks the video's link as the current page, and only that one.
        await page.goto(`${BASE}/demo`);
        const current = await page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]').allTextContents();
        assert.deepEqual(current, ["Demo video"]);
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
      // Near the end: it finishes, the picture goes back to the end card and the end panel covers it.
      await page.locator("video").evaluate((v) => (v.currentTime = 88.5));
      await endPanel(page).waitFor({ state: "visible", timeout: 15000 });
      const rest = await poll(() => page.locator("video").evaluate((v) => (v.seeking ? null : { t: v.currentTime, paused: v.paused, ended: v.ended })));
      assert.deepEqual(rest, { t: 89, paused: true, ended: false });
      // The frame behind the panel is the end card, not black: sample the picture.
      const brightness = await page.locator("video").evaluate((v) => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 36;
        const g = c.getContext("2d");
        g.drawImage(v, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return sum / (d.length / 4);
      });
      assert.ok(brightness > 200, `end card brightness ${brightness}`);
      await page.screenshot({ path: path.join(OUT, "real-ended.png") });
      await endPanel(page).getByRole("button", { name: "Watch again" }).click();
      const again = await poll(() => page.locator("video").evaluate((v) => (!v.paused && v.currentTime > 0.3 && v.currentTime < 5 ? v.currentTime : null)), { timeout: 10000 });
      assert.ok(again, "Watch again plays from the start");
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), "VIDEO");
      await chrome.close();
    });

    await step("REAL_MEDIA: a response held back past the stall time shows the panel, which goes when the video starts", async () => {
      const chrome = await chromium.launch({ channel: "chrome" });
      const context = await chrome.newContext({ viewport: { width: 1440, height: 900 } });
      await context.route(`${SITE}/**`, async (route) => {
        const u = new URL(route.request().url());
        await route.fulfill({ response: await route.fetch({ url: `${BASE}${u.pathname}${u.search}` }) });
      });
      let held = 0;
      await context.route(`${MEDIA}/**`, async (route) => {
        if (held++ === 0) await new Promise((r) => setTimeout(r, 15000));
        await route.continue();
      });
      const page = await context.newPage();
      await page.goto(`${SITE}/demo`);
      await playButton(page).click();
      await failPanel(page).waitFor({ state: "visible", timeout: 20000 });
      await page.screenshot({ path: path.join(OUT, "real-stalled.png") });
      await failPanel(page).waitFor({ state: "hidden", timeout: 30000 });
      const playing = await poll(() => page.locator("video").evaluate((v) => (!v.paused && v.readyState >= 3 && v.currentTime > 0.5 ? true : null)), { timeout: 15000 });
      assert.ok(playing, "playing after the held response");
      assert.equal(await page.locator("video").evaluate((v) => v.controls), true);
      await chrome.close();
    });
  }

  if (process.env.ANALYTICS === "1") {
    const probe = await browser.newPage();
    const userAgent = (await probe.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome");
    await probe.close();
    await step("ANALYTICS: nothing before consent; play and completed carry area only; nothing after withdrawal", async () => {
      const { context, page } = await open(browser, { userAgent }, { visitor: true });
      const events = [];
      await context.route(`${BASE}/ingest/**`, async (route) => {
        if (route.request().method() === "POST") events.push(...ingestEvents(route.request()));
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"status":1}' });
      });
      await page.goto(`${BASE}/demo`);
      await playButton(page).waitFor({ state: "visible" });
      await settle(page);
      assert.deepEqual(events, [], "nothing before consent");

      await page.getByRole("button", { name: "Accept analytics" }).click();
      const pageview = await poll(() => events.find((e) => e.event === "$pageview"), { timeout: 8000 });
      assert.ok(pageview, "a page view after consent");
      assert.equal(new URL(pageview.properties.$current_url).pathname, "/demo");
      // As the browser reports it: playback started, then reached the end.
      await page.locator("video").evaluate((v) => v.dispatchEvent(new Event("playing")));
      await sendEnded(page);
      const played = await poll(() => events.find((e) => e.event === "demo_video_played"));
      const completed = await poll(() => events.find((e) => e.event === "demo_video_completed"));
      for (const e of [played, completed]) {
        assert.ok(e, "demo event sent");
        const custom = Object.keys(e.properties).filter((k) => !k.startsWith("$") && k !== "token" && k !== "distinct_id");
        assert.deepEqual(custom, ["area"]);
        assert.equal(e.properties.area, "marketing");
      }
      await context.close();

      // Withdrawal right after the page view is captured: nothing may leave afterwards, not even on unload.
      const second = await open(browser, { userAgent }, { visitor: true });
      const after = [];
      let withdrawnAt = Infinity;
      await second.context.route(`${BASE}/ingest/**`, async (route) => {
        if (route.request().method() === "POST" && Date.now() >= withdrawnAt) after.push(...ingestEvents(route.request()).map((e) => e.event));
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"status":1}' });
      });
      const sent = [];
      second.page.on("request", (r) => {
        if (r.url().startsWith(`${BASE}/ingest/`) && r.method() === "POST") sent.push(Date.now());
      });
      await second.page.goto(`${BASE}/demo`);
      await second.page.getByRole("button", { name: "Accept analytics" }).click();
      // The page view leaves at once (no batching), well inside a batch's flush interval.
      await poll(() => sent.length > 0, { timeout: 2500 });
      await second.page.getByRole("button", { name: "Cookie settings" }).click();
      withdrawnAt = Date.now();
      await second.page.getByRole("button", { name: "Reject all" }).click();
      await second.page.locator("video").evaluate((v) => v.dispatchEvent(new Event("playing")));
      await second.page.waitForTimeout(4000);
      await second.page.goto(`${BASE}/privacy`);
      await second.page.waitForTimeout(1500);
      assert.deepEqual(after, [], `sent after withdrawal: ${JSON.stringify(after)}`);
      assert.ok(sent.length > 0, "the page view was sent before the withdrawal");
      await second.context.close();
    });
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` – FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})();
