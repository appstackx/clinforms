/**
 * The product demo video at /demo. The video is served by our media delivery provider, and the privacy policy says
 * three things about it: nothing reaches the provider until play is pressed, the request carries no cookies, and
 * what the provider records. The checks below read the player's source with its comments removed, so a comment that
 * mentions an attribute cannot stand in for the attribute. They pin the element's settings, the captions file
 * against the transcript, the chapters, `?t=` parsing, the VideoObject markup, the links, the sitemap, robots and the
 * CSP; scripts/e2e/demo-video.cjs watches a real browser's requests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { ANALYTICS_EVENTS, sanitizeProps } from "@/components/analytics/events";
import { PRIVACY_LAST_UPDATED, SITE_URL, isPublicPagePath, showsConsentBanner } from "@/lib/site";
import {
  DEMO_CHAPTERS,
  DEMO_VIDEO,
  DEMO_VIDEO_MEDIA_BASE,
  DEMO_VIDEO_MEDIA_ORIGIN,
  TRANSCRIPT_DETAILS_ID,
  chapterIndexAt,
  demoTranscriptText,
  demoVideoStructuredData,
  formatChapterTime,
  formatDurationWords,
  formatMegabytes,
  startFromQuery,
} from "./demo-video";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
/** Comment-free, whitespace collapsed: JSX prose breaks lines anywhere. */
const prose = (source: string) => stripComments(source).replace(/\s+/g, " ");

const PAGE = stripComments(read("src/app/(marketing)/demo/page.tsx"));
const PLAYER = stripComments(read("src/app/(marketing)/demo/demo-player.tsx"));
const PRIVACY = prose(read("src/app/(marketing)/privacy/page.tsx"));
const PUBLISHER = { name: "AppstackX Ltd", url: "https://appstackx.co.uk" };

/* ------------------------------------------------------------------------------------------- player */

test("the player loads no video data when the page opens", () => {
  assert.equal(PLAYER.match(/preload=/g)?.length, 1);
  assert.match(PLAYER, /preload="none"/);
  assert.doesNotMatch(PLAYER, /\bautoPlay\b/i);
  assert.doesNotMatch(PLAYER, /\bloop\b/);
  // The files are named only on <source>, never on the <video> itself.
  assert.doesNotMatch(PLAYER, /<video[^>]*\ssrc=/);
  // Nothing else in the player names the media host (a <link rel=preload> or an <img> would fetch on load).
  assert.doesNotMatch(PLAYER, /media\.clinforms\.co\.uk\/demo/);
  assert.doesNotMatch(PLAYER, /<link\b|<img\b|new Image\(|fetch\(/);
});

test("the request for the file carries no cookies", () => {
  assert.equal(PLAYER.match(/crossOrigin=/g)?.length, 1);
  assert.match(PLAYER, /crossOrigin="anonymous"/);
});

test("the poster and captions come from our own domain, and the files exist", () => {
  assert.match(PLAYER, /poster=\{DEMO_VIDEO\.poster\}/);
  assert.match(PLAYER, /<track[^>]*kind="captions"[^>]*src=\{DEMO_VIDEO\.captions\}[^>]*srcLang="en-GB"[^>]*default/);
  for (const file of [DEMO_VIDEO.poster, DEMO_VIDEO.shareImage, DEMO_VIDEO.captions]) {
    assert.ok(file.startsWith("/demo/"), file);
    assert.ok(fs.existsSync(path.join(ROOT, "public", file)), file);
  }
});

test("phones get the light encode, and a failure is caught on the last source", () => {
  const sources = Array.from(PLAYER.matchAll(/<source\b[\s\S]*?\/>/g), (m) => m[0]);
  assert.equal(sources.length, 2);
  assert.match(sources[0], /src=\{DEMO_VIDEO\.sources\.light\.src\}/);
  assert.match(sources[0], /media=\{DEMO_VIDEO\.sources\.light\.media\}/);
  assert.equal(DEMO_VIDEO.sources.light.media, "(max-width: 767px)");
  assert.match(sources[1], /src=\{DEMO_VIDEO\.sources\.full\.src\}/);
  assert.doesNotMatch(sources[1], /media=/);
  assert.match(sources[1], /onError=\{\(\) => setFailed\(true\)\}/);
  for (const s of sources) assert.match(s, /type="video\/mp4"/);
});

test("the files play from media.clinforms.co.uk, out of the folder dated by the cut", () => {
  assert.equal(DEMO_VIDEO_MEDIA_ORIGIN, "https://media.clinforms.co.uk");
  assert.equal(DEMO_VIDEO_MEDIA_BASE, `${DEMO_VIDEO_MEDIA_ORIGIN}/demo/${DEMO_VIDEO.publishedOn}`);
  assert.match(DEMO_VIDEO.publishedOn, /^\d{4}-\d{2}-\d{2}$/);
  for (const source of Object.values(DEMO_VIDEO.sources)) {
    assert.ok(source.src.startsWith(`${DEMO_VIDEO_MEDIA_BASE}/`), source.src);
    assert.match(source.src, /\.mp4$/);
    assert.equal(source.width / source.height, 16 / 9);
  }
});

test("the player counts a play and a completed play through the allow-listed analytics only", () => {
  assert.ok((ANALYTICS_EVENTS as readonly string[]).includes("demo_video_played"));
  assert.ok((ANALYTICS_EVENTS as readonly string[]).includes("demo_video_completed"));
  const calls = Array.from(PLAYER.matchAll(/track\(([^;]*)\);/g), (m) => m[1].replace(/\s+/g, " ").trim());
  assert.deepEqual(calls, ['"demo_video_played", { area: "marketing" }', '"demo_video_completed", { area: "marketing" }']);
  assert.match(PLAYER, /import \{ track \} from "@\/components\/analytics"/);
  assert.deepEqual(sanitizeProps({ area: "marketing", title: DEMO_VIDEO.title, at: 12 }), { area: "marketing" });
});

test("a failure says where the video plays from and opens the transcript", () => {
  assert.match(PLAYER, /role="status"/);
  assert.match(PLAYER, /The video plays from media\.clinforms\.co\.uk/);
  assert.match(PLAYER, /href="#transcript"/);
  assert.match(PAGE, /id="transcript"/);
  assert.match(PAGE, /id=\{TRANSCRIPT_DETAILS_ID\}/);
  assert.equal(TRANSCRIPT_DETAILS_ID, "demo-transcript-details");
});

test("the panel offers the download for another network, sized for the screen, without a referrer", () => {
  const player = prose(read("src/app/(marketing)/demo/demo-player.tsx"));
  // The panel is for a network that blocks the media host, so the download (same host) is for another network.
  assert.match(player, /covers everything the video says and shows\. On another network you can also\{" "\} <a href=\{download\.src\} rel="noreferrer"/);
  assert.match(player, /download the video \(\{formatMegabytes\(download\.bytes\)\}\)/);
  // Phones (the light source's own media query) get the lighter file.
  assert.match(player, /window\.matchMedia\(DEMO_VIDEO\.sources\.light\.media\)\.matches \? DEMO_VIDEO\.sources\.light : DEMO_VIDEO\.sources\.full/);
  assert.equal(formatMegabytes(DEMO_VIDEO.sources.full.bytes), "9 MB");
  assert.equal(formatMegabytes(DEMO_VIDEO.sources.light.bytes), "5 MB");
  assert.equal(formatMegabytes(400_000), "1 MB");
  assert.ok(DEMO_VIDEO.sources.light.bytes < DEMO_VIDEO.sources.full.bytes);
});

test("a request that hangs (no error, no data) shows the same panel, which goes when the video starts", () => {
  const stall = Number(PLAYER.match(/const STALL_MS = ([\d_]+);/)?.[1].replace(/_/g, ""));
  assert.ok(stall >= 10_000 && stall <= 15_000, `STALL_MS ${stall}`);
  // Armed on play while there is no frame yet; the panel shows only if there is still none.
  assert.match(PLAYER, /if \(video\.readyState < HTMLMediaElement\.HAVE_CURRENT_DATA\) watchForStall\(\);/);
  assert.match(PLAYER, /if \(video && video\.readyState < HTMLMediaElement\.HAVE_CURRENT_DATA\) setFailed\(true\);/);
  // Data or playback clears it; playback after all removes the panel (a slow network, not a blocked one).
  assert.match(PLAYER, /onLoadedData=\{\(\) => window\.clearTimeout\(stallTimer\.current\)\}/);
  assert.match(PLAYER, /onPlaying=\{\(\) => \{\s*window\.clearTimeout\(stallTimer\.current\);[\s\S]*?setFailed\(false\);/);
  // Unmounting clears the timer.
  assert.match(PLAYER, /return \(\) => window\.clearTimeout\(stallTimer\.current\);/);
});

test("focus: a control that goes away hands focus to the video, however it was pressed", () => {
  // Not decided from the click's detail (a screen reader's double-tap is a real click).
  assert.doesNotMatch(PLAYER, /\.detail\b/);
  assert.match(PLAYER, /if \(!active \|\| active === document\.body\) videoRef\.current\?\.focus\(\);/);
  assert.match(PLAYER, /\}, \[started, ended, failed\]\);/);
});

test("the play button keeps the poster readable on a phone and respects reduced motion", () => {
  const button = PLAYER.match(/aria-label=\{`Play the demo, \$\{lengthInWords\}`\}\s*className="([^"]+)"/)?.[1] ?? "";
  // Below sm it sits in the poster's empty lower band; from sm up, centred.
  assert.match(button, /\bitems-end\b/);
  assert.match(button, /\bsm:items-center\b/);
  // No grey wash over the poster.
  assert.doesNotMatch(button, /bg-slate-900\/10\b/);
  assert.match(button, /motion-reduce:transition-none/);
  assert.match(PLAYER, /motion-reduce:group-hover:scale-100/);
});

/* ------------------------------------------------------------------------------------------- captions */

const VTT = read(`public${DEMO_VIDEO.captions}`);
const CUE = /^(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})$/;
const seconds = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
const CUES = VTT.replace(/^WEBVTT[^\n]*\n+/, "")
  .trim()
  .split(/\n{2,}/)
  .map((block) => {
    const [timing, ...text] = block.split("\n");
    const m = timing.match(CUE);
    assert.ok(m, `cue timing: ${timing}`);
    return { start: seconds(m[1], m[2], m[3], m[4]), end: seconds(m[5], m[6], m[7], m[8]), text: text.join(" ") };
  });
const spoken = (s: string) => s.replace(/\s+/g, " ").trim();

test("the captions file is WebVTT, with cues that run in order inside the video", () => {
  assert.ok(VTT.startsWith("WEBVTT\n"));
  assert.equal(CUES.length, 22);
  let last = 0;
  for (const c of CUES) {
    assert.ok(c.start >= last, `${c.start} after ${last}`);
    assert.ok(c.end > c.start);
    assert.ok(c.text.length > 0 && c.text.length <= 90, c.text);
    last = c.end;
  }
  assert.ok(last <= DEMO_VIDEO.durationSeconds);
});

test("the captions say what the transcript says, word for word", () => {
  assert.equal(spoken(CUES.map((c) => c.text).join(" ")), spoken(demoTranscriptText()));
  // Typographic apostrophes, as on the page.
  assert.doesNotMatch(VTT, /'/);
});

test("each chapter opens just before its first line is spoken", () => {
  const joined: string[] = [];
  const offsets: number[] = [];
  let length = 0;
  for (const c of CUES) {
    offsets.push(length);
    joined.push(c.text);
    length += c.text.length + 1;
  }
  const all = joined.join(" ");
  let cursor = 0;
  for (const chapter of DEMO_CHAPTERS) {
    const at = all.indexOf(chapter.transcript[0], cursor);
    assert.ok(at >= 0, chapter.title);
    cursor = at;
    const cue = offsets.reduce((found, offset, i) => (offset <= at ? i : found), 0);
    const lead = CUES[cue].start - chapter.at;
    assert.ok(lead >= 0 && lead <= 1, `${chapter.title}: line starts ${lead.toFixed(2)} s after the chapter`);
  }
});

/** The cut's real length (DEMO_VIDEO.durationSeconds is the rounded 1:30). */
const CUT_SECONDS = 89.94;

test("at the end the picture goes back to the end card and a panel offers the call, a replay and the interactive demo", () => {
  const player = prose(read("src/app/(marketing)/demo/demo-player.tsx"));
  assert.match(PLAYER, /video\.currentTime = DEMO_VIDEO\.endCardAt;\s*setCurrent\(DEMO_VIDEO\.endCardAt\);\s*setEnded\(true\);/);
  // The end card is up (its last caption has started) and the fade to black (the last half-second) has not begun.
  const last = CUES[CUES.length - 1];
  assert.ok(DEMO_VIDEO.endCardAt >= last.start && DEMO_VIDEO.endCardAt <= CUT_SECONDS - 0.5, String(DEMO_VIDEO.endCardAt));
  assert.ok(DEMO_VIDEO.endCardAt > DEMO_CHAPTERS[DEMO_CHAPTERS.length - 1].at);
  assert.match(player, /\{ended && !failed && \(/);
  assert.match(player, /<Link href=\{REQUEST_ACCESS_HREF\} className="[^"]*" > Book a 15-minute call <ArrowRight/);
  assert.match(player, /<button type="button" onClick=\{watchAgain\}[^>]*> <RotateCcw[^>]*\/> Watch again <\/button>/);
  assert.match(player, /<TrackedLink href=\{DEMO_HREF\}[^>]*eventProps=\{\{ area: "marketing", cta: "demo_video_end" \}\} > Try the interactive demo <\/TrackedLink>/);
  // The native controls give way to the panel; any play (a chapter, "Watch again") removes it.
  assert.match(PLAYER, /controls=\{started && !failed && !ended\}/);
  assert.match(PLAYER, /onPlay=\{\(\) => \{\s*setStarted\(true\);\s*setEnded\(false\);/);
  // Focus moves to the panel only if the video had it.
  assert.match(PLAYER, /focusEndPanel\.current = document\.activeElement === video;/);
});

/* ------------------------------------------------------------------------------------------- chapters */

test("chapters start at zero, run in order and end inside the video", () => {
  assert.equal(DEMO_CHAPTERS[0].at, 0);
  for (let i = 1; i < DEMO_CHAPTERS.length; i++) assert.ok(DEMO_CHAPTERS[i].at > DEMO_CHAPTERS[i - 1].at);
  assert.ok(DEMO_CHAPTERS[DEMO_CHAPTERS.length - 1].at < DEMO_VIDEO.durationSeconds);
});

test("each chapter has a distinct title, a distinct whole second and some transcript", () => {
  assert.equal(new Set(DEMO_CHAPTERS.map((c) => c.title)).size, DEMO_CHAPTERS.length);
  assert.equal(new Set(DEMO_CHAPTERS.map((c) => Math.floor(c.at))).size, DEMO_CHAPTERS.length);
  for (const c of DEMO_CHAPTERS) assert.ok(c.transcript.length > 0, c.title);
});

test("the chapter playing is the last one that has started", () => {
  assert.equal(chapterIndexAt(0), 0);
  assert.equal(chapterIndexAt(14.84), 0);
  assert.equal(chapterIndexAt(14.85), 1);
  assert.equal(chapterIndexAt(89), DEMO_CHAPTERS.length - 1);
});

test("times show as a player shows them, and the length in words", () => {
  assert.equal(formatChapterTime(0), "0:00");
  assert.equal(formatChapterTime(62.39), "1:02");
  assert.equal(formatChapterTime(DEMO_VIDEO.durationSeconds), "1:30");
  assert.equal(formatDurationWords(90), "1 minute 30 seconds");
  assert.equal(formatDurationWords(61), "1 minute 1 second");
  assert.equal(formatDurationWords(120), "2 minutes");
  assert.equal(formatDurationWords(45), "45 seconds");
});

test("the duration and dates agree", () => {
  const [, m, s] = DEMO_VIDEO.isoDuration.match(/^PT(\d+)M(\d+)S$/) ?? [];
  assert.equal(Number(m) * 60 + Number(s), DEMO_VIDEO.durationSeconds);
  assert.ok(DEMO_VIDEO.uploadDate.startsWith(DEMO_VIDEO.publishedOn));
});

test('copy that rounds the length ("1½ minutes") stays within 15 seconds of it', () => {
  for (const file of ["src/app/(marketing)/demo/page.tsx", "src/app/(marketing)/page.tsx"]) {
    for (const [, whole] of Array.from(read(file).matchAll(/(\d+)½[- ]minute/g))) {
      assert.ok(Math.abs(Number(whole) * 60 + 30 - DEMO_VIDEO.durationSeconds) <= 15, file);
    }
  }
});

test("the transcript and chapter titles are neutral and carry the fictional-data labels", () => {
  const text = DEMO_CHAPTERS.flatMap((c) => [c.title, ...c.transcript, ...(c.onScreen ?? [])]).join(" ");
  assert.match(text, /fictional/i);
  assert.match(text, /Fictional patient data shown/);
  // Every organisation named on screen is marked fictional.
  for (const org of ["Harrow & Pike Solicitors", "Harrow & Pike Medico-Legal"]) assert.ok(text.includes(`${org} (fictional)`), org);
  assert.doesNotMatch(text, /\bTM3\b/);
});

/* ------------------------------------------------------------------------------------------- ?t= */

test("?t= ignores anything that is not a whole second inside the video", () => {
  const tooLate = String(DEMO_VIDEO.durationSeconds);
  for (const raw of [null, undefined, "", "abc", "0", "-5", "1.5", "1e2", tooLate, "9999", " 24", "24s", "0x10"]) {
    assert.equal(startFromQuery(raw), null, String(raw));
  }
});

test("?t= opens a chapter at the chapter's own start, and any other second at that second", () => {
  for (const c of DEMO_CHAPTERS.filter((c) => c.at > 0)) assert.equal(startFromQuery(String(Math.floor(c.at))), c.at);
  assert.equal(startFromQuery("50"), 50);
  assert.equal(startFromQuery("89"), 89);
});

test("the player reads ?t= only to set the start position", () => {
  assert.match(PLAYER, /startFromQuery\(new URLSearchParams\(window\.location\.search\)\.get\("t"\)\)/);
  assert.match(PLAYER, /videoRef\.current\.currentTime = start;/);
});

/* ------------------------------------------------------------------------------------------- markup */

const DATA = demoVideoStructuredData(SITE_URL, PUBLISHER);

test("the VideoObject names the player's own poster, the length and the full encode", () => {
  assert.equal(DATA["@type"], "VideoObject");
  assert.deepEqual(DATA.thumbnailUrl, [`${SITE_URL}${DEMO_VIDEO.poster}`]);
  assert.equal(DATA.duration, DEMO_VIDEO.isoDuration);
  assert.equal(DATA.contentUrl, DEMO_VIDEO.sources.full.src);
  assert.equal(DATA.uploadDate, DEMO_VIDEO.uploadDate);
  assert.equal(DATA.transcript, demoTranscriptText());
  assert.deepEqual(DATA.publisher, { "@type": "Organization", ...PUBLISHER });
});

test("the chapters are clips that run end to end", () => {
  const clips = DATA.hasPart;
  assert.equal(clips.length, DEMO_CHAPTERS.length);
  assert.equal(clips[0].startOffset, 0);
  assert.equal(clips[clips.length - 1].endOffset, DEMO_VIDEO.durationSeconds);
  clips.forEach((clip, i) => {
    assert.equal(clip["@type"], "Clip");
    assert.ok(clip.endOffset > clip.startOffset);
    if (i > 0) assert.equal(clip.startOffset, clips[i - 1].endOffset);
  });
});

test("each clip links to the page at its chapter, which the player opens there", () => {
  DATA.hasPart.forEach((clip, i) => {
    const url = new URL(clip.url);
    assert.equal(`${url.origin}${url.pathname}`, `${SITE_URL}/demo`);
    // The first chapter's link is ?t=0, which plays from the start.
    assert.equal(startFromQuery(url.searchParams.get("t")), i === 0 ? null : DEMO_CHAPTERS[i].at);
  });
});

test("the page publishes the markup, escaped", () => {
  assert.match(PAGE, /demoVideoStructuredData\(SITE_URL, \{ name: COMPANY\.legalName, url: COMPANY\.website \}\)/);
  assert.match(PAGE, /type="application\/ld\+json"/);
  assert.match(PAGE, /JSON\.stringify\(STRUCTURED_DATA\)\.replace\(\/<\/g, "\\\\u003c"\)/);
});

/* ------------------------------------------------------------------------------------------- page, links, search */

test("the page has its canonical, a description that fits and its own share image", () => {
  assert.match(PAGE, /alternates: \{ canonical: "\/demo" \}/);
  const description = PAGE.match(/const DESCRIPTION =\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(description.length > 50 && description.length <= 160, `${description.length}: ${description}`);
  assert.match(PAGE, /url: DEMO_VIDEO\.shareImage, width: 1200, height: 630/);
  assert.match(PAGE, /openGraph: \{[\s\S]*images: \[SHARE_IMAGE\]/);
  assert.match(PAGE, /twitter: \{ card: "summary_large_image",.*images: \[SHARE_IMAGE\] \}/);
  // The share image is a JPEG of 1200x630 (SOF0/SOF2 marker).
  const jpeg = fs.readFileSync(path.join(ROOT, "public", DEMO_VIDEO.shareImage));
  const sof = jpeg.findIndex((b, i) => b === 0xff && (jpeg[i + 1] === 0xc0 || jpeg[i + 1] === 0xc2));
  assert.ok(sof > 0);
  assert.equal(jpeg.readUInt16BE(sof + 5), 630);
  assert.equal(jpeg.readUInt16BE(sof + 7), 1200);
});

test("the page labels the video as fictional data", () => {
  const page = prose(read("src/app/(marketing)/demo/page.tsx"));
  assert.match(page, /<DemoPlayer note=\{ <p[^>]*> <strong[^>]*>Fictional data:<\/strong> recorded in the \{PRODUCT\.name\} demo with fictional patients, clinicians and referrers/);
  // The player shows the note directly under the video, before the chapters.
  assert.ok(PLAYER.indexOf("{note}") > PLAYER.indexOf("</video>") && PLAYER.indexOf("{note}") < PLAYER.indexOf("<nav"));
});

test("the header, the mobile menu, the hero, the final call to action and the footer link to the video", () => {
  assert.match(read("src/components/marketing/nav.ts"), /DEMO_VIDEO_HREF = "\/demo"/);
  // Two different things, two clearly different names: the recorded video and the sandbox you click through.
  const header = prose(read("src/components/marketing/site-header.tsx"));
  assert.match(header, /<NavLink href=\{DEMO_VIDEO_HREF\} className=\{navLink\}> Demo video <\/NavLink>/);
  assert.match(header, /<TrackedLink href=\{DEMO_HREF\}[^>]*> Interactive demo <\/TrackedLink>/);
  const mobile = prose(read("src/components/marketing/mobile-nav.tsx"));
  assert.match(mobile, /<Link href=\{DEMO_VIDEO_HREF\} className=\{item\} aria-current=\{current\(DEMO_VIDEO_HREF\)\} onClick=\{\(\) => setOpen\(false\)\}> Demo video <\/Link>/);
  assert.match(mobile, /<TrackedLink href=\{DEMO_HREF\}[^>]*> Interactive demo <\/TrackedLink>/);
  const footer = read("src/components/marketing/site-footer.tsx");
  assert.match(footer, /\{ href: "\/demo", label: "Demo video" \}/);
  assert.match(footer, /\{ href: "\/reports", label: "Interactive demo" \}/);
  for (const file of ["src/components/marketing/site-header.tsx", "src/components/marketing/mobile-nav.tsx", "src/components/marketing/site-footer.tsx"]) {
    assert.doesNotMatch(prose(read(file)), /> (Watch|Try) the demo </, file);
  }
  // The header marks the page being shown.
  assert.match(read("src/components/marketing/nav-link.tsx"), /aria-current=\{pathname === href \? "page" : undefined\}/);
  // Hero and final call to action: the video right after "Request access", its length spoken in words.
  const landing = prose(read("src/app/(marketing)/page.tsx"));
  assert.equal(landing.match(/Request access <ArrowRight[^>]*\/> <\/Link> <Link href=\{DEMO_VIDEO_HREF\} className=\{btn\.secondary\}> <Play[^>]*\/> Watch the demo <DemoLength \/> <\/Link>/g)?.length, 2);
  assert.match(landing, /<span aria-hidden>\{formatChapterTime\(DEMO_VIDEO\.durationSeconds\)\}<\/span> <span className="sr-only">, \{formatDurationWords\(DEMO_VIDEO\.durationSeconds\)\}<\/span>/);
});

test("the page says who it is for and what the problem is before the video, and books the call the video promises", () => {
  const page = prose(read("src/app/(marketing)/demo/page.tsx"));
  assert.match(page, /For UK physiotherapy clinics · <span aria-hidden>\{formatChapterTime\(DEMO_VIDEO\.durationSeconds\)\}<\/span> <span className="sr-only">\{formatDurationWords\(DEMO_VIDEO\.durationSeconds\)\}<\/span> demo/);
  assert.match(page, /Insurers, medico-legal companies and case managers each send their own report form\./);
  // The video ends with "Book a 15-minute call": the page's main button says the same and leads to the request form.
  assert.match(page, /<Link href=\{REQUEST_ACCESS_HREF\} className=\{btn\.primary\}> Book a 15-minute call <ArrowRight/);
  assert.equal(DEMO_CHAPTERS[DEMO_CHAPTERS.length - 1].transcript.at(-1), "Book a 15-minute call at clinforms.co.uk.");
  assert.match(prose(read("src/app/(marketing)/request-access/page.tsx")), /We reply by email to arrange a 15-minute call\./);
  // The transcript sits on the page's grid (left edge in line with the video), its lines kept short inside it.
  assert.match(page, /<section id="transcript"[^>]*> (\{\} )?<div className="mx-auto max-w-6xl px-4 [^"]*"> <div className="max-w-3xl"> <h2 id="demo-transcript-title"/);
});

test("/demo is in the sitemap, dated by the cut, and open to crawlers", () => {
  const entries = sitemap();
  assert.equal(entries.find((e) => e.url === `${SITE_URL}/demo`)?.lastModified, DEMO_VIDEO.publishedOn);
  assert.equal(entries.find((e) => e.url === `${SITE_URL}/privacy`)?.lastModified, PRIVACY_LAST_UPDATED);
  const rules = robots().rules;
  const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) => (r.disallow === undefined ? [] : Array.isArray(r.disallow) ? r.disallow : [r.disallow]));
  for (const prefix of disallow) assert.ok(!"/demo".startsWith(prefix) && !"/demo/clinforms-demo-poster.jpg".startsWith(prefix), prefix);
  assert.ok(isPublicPagePath("/demo"));
  assert.ok(showsConsentBanner("/demo"));
});

test("next.config: the CSP allows the media host for media only, and /demo is neither redirected nor noindexed", async () => {
  const config = (await import(pathToFileURL(path.join(ROOT, "next.config.mjs")).href)).default;
  const groups: Array<{ source: string; headers: Array<{ key: string; value: string }> }> = await config.headers();
  const all = groups.find((g) => g.source === "/:path*");
  const csp = all?.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value ?? "";
  const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
  assert.deepEqual(directives["media-src"], ["'self'", DEMO_VIDEO_MEDIA_ORIGIN]);
  for (const [name, values] of Object.entries(directives)) {
    if (name !== "media-src") assert.ok(!values.includes(DEMO_VIDEO_MEDIA_ORIGIN), name);
  }
  for (const g of groups) {
    if (g.headers.some((h) => h.key === "X-Robots-Tag")) assert.ok(!/^\/demo(\/|$)/.test(g.source), g.source);
  }
  const redirects: Array<{ source: string }> = config.redirects ? await config.redirects() : [];
  assert.ok(!redirects.some((r) => r.source === "/demo"));
});

/* ------------------------------------------------------------------------------------------- privacy */

test("the privacy policy describes the player as it behaves, naming no vendor", () => {
  assert.match(PRIVACY, /lastUpdated=\{PRIVACY_LAST_UPDATED\}/);
  assert.equal(PRIVACY_LAST_UPDATED, "2026-10-10");
  assert.match(PRIVACY, /<h3 id="demo-video">The demo video<\/h3>/);
  assert.match(PRIVACY, /stored in the EU by our media delivery provider/);
  assert.match(PRIVACY, /Opening the page loads nothing from that provider: the poster image and the captions come from this website, and the video is fetched only when you press play or choose a chapter \(or download the file\)\./);
  assert.match(PRIVACY, /It carries no cookies, the video sets none/);
  assert.match(PRIVACY, /The provider keeps a record of each request: for example the IP address, the time, the file, the browser type, the site it was played from and the country it came from\./);
  // Network Error Logging is OFF on the media zone since 10/10 (owner decision), so the media host sends no `nel` /
  // `report-to` headers and the policy no longer mentions error reports. Switching it back on needs the disclosure back.
  assert.doesNotMatch(PRIVACY, /error report|report failed requests/i);
  assert.match(PRIVACY, /about the last month\. We use these records only to keep the video available and to count how often it is played/);
  assert.match(PRIVACY, /its records of requests may be kept there; as with our other providers/);
  assert.match(PRIVACY, /<strong>Demo video plays<\/strong> \(only if you play or download our\{" "\} <Link href="\/demo">product demo<\/Link>\)/);
  assert.match(PRIVACY, /Our lawful basis is our legitimate interest in showing our product to people who choose to watch it/);
  assert.match(PRIVACY, /<strong>Media delivery<\/strong> – stores our product demo video in the EU/);
  assert.match(PRIVACY, /We keep no copy\. Our media delivery provider keeps its own records of requests/);
  assert.doesNotMatch(PRIVACY, /cloudflare|\bR2\b/i);
});
