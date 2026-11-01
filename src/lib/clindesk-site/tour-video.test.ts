/**
 * The ClinDesk tour at /tour (src/lib/clindesk-site/tour-video.ts). The video is served by our media delivery
 * provider, and ClinDesk's privacy policy says what reaches it and when: nothing until play is pressed, no cookies.
 * The checks below read the player's and pages' source with comments removed (so a comment that mentions an
 * attribute cannot stand in for it) and pin the media URLs, the element's settings, the chapters, `?t=` parsing, the
 * VideoObject markup, the links to the page, the sitemap, the middleware and the CSP. scripts/e2e/clindesk-tour.cjs
 * plays the real files in a browser and checks the captions file against the transcript.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GET as clindeskSitemap } from "@/app/clindesk-site/sitemap.xml/route";
import { CLINDESK_PAGES } from "@/lib/clindesk/site";
import { CLINDESK_SITE_PATHS, PUBLIC_SITE_PATHS } from "@/middleware";
import { BANNED_TERM_PATTERNS } from "@/modules/medreport/core/wording";
import {
  TOUR_CHAPTERS,
  TOUR_PATH,
  TOUR_TRANSCRIPT_DETAILS_ID,
  TOUR_VIDEO,
  TOUR_VIDEO_MEDIA_BASE,
  TOUR_VIDEO_MEDIA_ORIGIN,
  formatTourDurationWords,
  formatTourMegabytes,
  formatTourTime,
  tourChapterHref,
  tourChapterIndexAt,
  tourChapterName,
  tourStartFromQuery,
  tourTranscriptText,
  tourVideoStructuredData,
} from "./tour-video";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
const prose = (source: string) => stripComments(source).replace(/\s+/g, " ");

const PLAYER = stripComments(read("src/app/clindesk-site/tour/tour-player.tsx"));
const PAGE = stripComments(read("src/app/clindesk-site/tour/page.tsx"));
const PUBLISHER = { name: "Appstack X Ltd", url: "https://appstackx.co.uk" };

/** The approved cut's chapters.txt (marketing/clindesk/showcase-video-v1), as Khuram signed it off. */
const CHAPTERS_TXT = [
  "0:00 Welcome",
  "0:17 08:00 · Front desk: diary and online booking",
  "0:46 09:15 · Notes, amendments and letters",
  "1:07 11:40 · ClinDesk Reports (add-on)",
  "1:47 13:05 · Group office: sites, numbers and roles",
  "2:08 16:30 · Billing, authorisations and card payment",
  "2:31 18:30 · Audit trail, switching and booking a demo",
];

/* ------------------------------------------------------------------------------------------- media */

test("the files are on media.clinforms.co.uk, in the tour's own dated folder", () => {
  assert.equal(TOUR_VIDEO_MEDIA_ORIGIN, "https://media.clinforms.co.uk");
  assert.match(TOUR_VIDEO.publishedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(TOUR_VIDEO_MEDIA_BASE, `${TOUR_VIDEO_MEDIA_ORIGIN}/clindesk/tour/${TOUR_VIDEO.publishedOn}`);
  for (const url of [TOUR_VIDEO.sources.standard.src, TOUR_VIDEO.sources.high.src, TOUR_VIDEO.captions, TOUR_VIDEO.posterOnMedia, TOUR_VIDEO.shareImage.url]) {
    assert.ok(url.startsWith(`${TOUR_VIDEO_MEDIA_BASE}/`), url);
  }
  assert.match(TOUR_VIDEO.captions, /\.en-GB\.vtt$/);
  assert.ok(TOUR_VIDEO.uploadDate.startsWith(TOUR_VIDEO.publishedOn));
});

test("two encodes of the same cut: 720p plays by default, 1080p is the higher-quality choice", () => {
  const { standard, high } = TOUR_VIDEO.sources;
  assert.equal(TOUR_VIDEO.defaultQuality, "standard");
  assert.deepEqual([standard.width, standard.height, standard.label], [1280, 720, "720p"]);
  assert.deepEqual([high.width, high.height, high.label], [1920, 1080, "1080p"]);
  for (const s of [standard, high]) {
    assert.match(s.src, /\.mp4$/);
    assert.equal(s.width / s.height, 16 / 9);
  }
  // The objects' sizes in the bucket (the page shows them rounded).
  assert.equal(standard.bytes, 13_287_822);
  assert.equal(high.bytes, 93_559_315);
  assert.equal(formatTourMegabytes(standard.bytes), "13 MB");
  assert.equal(formatTourMegabytes(high.bytes), "94 MB");
});

test("the poster is served from this site (the page opens without a request to the media host), and exists", () => {
  assert.ok(TOUR_VIDEO.poster.startsWith("/clindesk/tour/"), TOUR_VIDEO.poster);
  const file = path.join(ROOT, "public", TOUR_VIDEO.poster);
  assert.ok(fs.existsSync(file), file);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "a JPEG");
  assert.ok(bytes.length < 150_000, `poster is ${bytes.length} bytes`);
});

/* ------------------------------------------------------------------------------------------- player */

test("the player loads no video data when the page opens, and its request carries no cookies", () => {
  assert.equal(PLAYER.match(/preload=/g)?.length, 1);
  assert.match(PLAYER, /preload="none"/);
  assert.equal(PLAYER.match(/crossOrigin=/g)?.length, 1);
  assert.match(PLAYER, /crossOrigin="anonymous"/);
  assert.doesNotMatch(PLAYER, /\bautoPlay\b/i);
  assert.doesNotMatch(PLAYER, /\bloop\b/);
  assert.doesNotMatch(PLAYER, /<video[^>]*\ssrc=/);
  assert.doesNotMatch(PLAYER, /media\.clinforms\.co\.uk\/clindesk/);
  assert.doesNotMatch(PLAYER, /<link\b|<img\b|new Image\(|fetch\(/);
  assert.match(PLAYER, /poster=\{TOUR_VIDEO\.poster\}/);
});

test("captions: a WebVTT track on the media host, off by default (the captions are burned into the picture)", () => {
  const track = PLAYER.match(/<track\b[^>]*\/>/)?.[0] ?? "";
  assert.match(track, /kind="captions"/);
  assert.match(track, /src=\{TOUR_VIDEO\.captions\}/);
  assert.match(track, /srcLang="en-GB"/);
  assert.match(track, /label="English"/);
  assert.doesNotMatch(track, /\bdefault\b/);
});

test("one source, the chosen quality's file, whose failure shows the panel", () => {
  const sources = Array.from(PLAYER.matchAll(/<source\b[\s\S]*?\/>/g), (m) => m[0]);
  assert.equal(sources.length, 1);
  assert.match(sources[0], /src=\{source\.src\}/);
  assert.match(sources[0], /type="video\/mp4"/);
  assert.match(sources[0], /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(PLAYER, /const source = TOUR_VIDEO\.sources\[quality\]/);
  assert.match(PLAYER, /useState<TourQuality>\(TOUR_VIDEO\.defaultQuality\)/);
  assert.match(PLAYER, /aria-pressed=\{quality === q\}/);
});

test("no analytics on ClinDesk's hosts: the player sends nothing", () => {
  assert.doesNotMatch(PLAYER, /@\/components\/analytics/);
  assert.doesNotMatch(PLAYER, /\btrack\(/);
});

test("a failure says where the video plays from and opens the transcript", () => {
  const player = prose(read("src/app/clindesk-site/tour/tour-player.tsx"));
  assert.match(PLAYER, /role="status"/);
  assert.match(PLAYER, /The video plays from media\.clinforms\.co\.uk/);
  assert.match(PLAYER, /href="#transcript"/);
  assert.match(player, /<a href=\{source\.src\} rel="noreferrer"/);
  assert.match(PAGE, /id="transcript"/);
  assert.match(PAGE, /id=\{TOUR_TRANSCRIPT_DETAILS_ID\}/);
  assert.equal(TOUR_TRANSCRIPT_DETAILS_ID, "tour-transcript-details");
});

test("the play button and the video say how long the tour is, in words for screen readers", () => {
  assert.equal(formatTourTime(TOUR_VIDEO.durationSeconds), "3:01");
  assert.equal(formatTourDurationWords(TOUR_VIDEO.durationSeconds), "3 minutes 1 second");
  assert.equal(TOUR_VIDEO.isoDuration, "PT3M1S");
  // The play button's name is its own text ("Play the tour, 3 minutes 1 second"): the visible "3:01" is hidden from
  // screen readers and the words stand in for it, so the name contains the visible label (WCAG 2.5.3).
  assert.match(prose(read("src/app/clindesk-site/tour/tour-player.tsx")), /Play the tour\{" "\} <span className="tv-play-len" aria-hidden="true"> \{formatTourTime\(TOUR_VIDEO\.durationSeconds\)\} <\/span> <span className="vh">, \{lengthInWords\}<\/span>/);
  assert.match(PLAYER, /aria-label=\{`\$\{CLINIC_SYSTEM_NAME\} tour video, \$\{lengthInWords\}`\}/);
});

/* ------------------------------------------------------------------------------------------- chapters */

test("the chapters are the approved cut's chapters.txt, in order, inside the video", () => {
  assert.deepEqual(
    TOUR_CHAPTERS.map((c) => `${formatTourTime(c.at)} ${tourChapterName(c)}`),
    CHAPTERS_TXT,
  );
  assert.equal(TOUR_CHAPTERS[0].at, 0);
  for (let i = 1; i < TOUR_CHAPTERS.length; i++) assert.ok(TOUR_CHAPTERS[i].at > TOUR_CHAPTERS[i - 1].at);
  assert.ok(TOUR_CHAPTERS[TOUR_CHAPTERS.length - 1].at < TOUR_VIDEO.durationSeconds);
  for (const c of TOUR_CHAPTERS) {
    assert.ok(c.transcript.length > 0, c.title);
    if (c.clock) assert.match(c.clock, /^\d{2}:\d{2}$/);
  }
});

test("the transcript: the narration, in the site's own voice (no banned or vendor words, curly apostrophes)", () => {
  const text = tourTranscriptText();
  assert.match(text, /^Diary full\. Notes signed\. Home by half four\./);
  assert.match(text, /ClinDesk\. Book a demo at clindesk\.co\.uk\.$/);
  const all = [text, ...TOUR_CHAPTERS.flatMap((c) => [c.title, ...(c.onScreen ?? [])]), TOUR_VIDEO.description, TOUR_VIDEO.title];
  for (const line of all) {
    for (const re of BANNED_TERM_PATTERNS) assert.ok(!re.test(line), `${re}: ${line}`);
    for (const vendor of [/cloudflare/i, /vercel/i, /stripe/i, /mailersend/i, /posthog/i]) assert.ok(!vendor.test(line), `${vendor}: ${line}`);
    assert.ok(!line.includes("'"), `straight apostrophe: ${line}`);
  }
});

test("?t= opens a chapter at its exact start, or any whole second inside the video; anything else is ignored", () => {
  assert.equal(tourStartFromQuery("67"), 67.167);
  assert.equal(tourStartFromQuery("17"), 17.9);
  assert.equal(tourStartFromQuery("100"), 100);
  for (const bad of [null, undefined, "", "0", "181", "999", "-5", "12.5", "1e2", "abc", "12345"]) assert.equal(tourStartFromQuery(bad), null, String(bad));
  assert.equal(tourChapterIndexAt(0), 0);
  assert.equal(tourChapterIndexAt(17.89), 0);
  assert.equal(tourChapterIndexAt(17.9), 1);
  assert.equal(tourChapterIndexAt(180), TOUR_CHAPTERS.length - 1);
  assert.equal(tourChapterHref(TOUR_CHAPTERS[0]), "/tour");
  assert.equal(tourChapterHref(TOUR_CHAPTERS[3]), "/tour?t=67");
});

/* ------------------------------------------------------------------------------------------- page, SEO */

test("VideoObject markup: real values only, chapters as clips end to end", () => {
  const data = tourVideoStructuredData("https://clindesk.co.uk", PUBLISHER);
  assert.equal(data["@type"], "VideoObject");
  assert.equal(data.name, TOUR_VIDEO.title);
  assert.deepEqual(data.thumbnailUrl, ["https://clindesk.co.uk/clindesk/tour/clindesk-tour-poster.jpg"]);
  assert.equal(data.uploadDate, "2026-10-31T19:07:00+00:00");
  assert.equal(data.duration, "PT3M1S");
  assert.equal(data.contentUrl, TOUR_VIDEO.sources.high.src);
  assert.equal(data.inLanguage, "en-GB");
  assert.deepEqual(data.publisher, { "@type": "Organization", ...PUBLISHER });
  assert.equal(data.transcript, tourTranscriptText());
  assert.equal(data.hasPart.length, TOUR_CHAPTERS.length);
  assert.equal(data.hasPart[0].startOffset, 0);
  for (let i = 1; i < data.hasPart.length; i++) assert.equal(data.hasPart[i].startOffset, data.hasPart[i - 1].endOffset);
  assert.equal(data.hasPart[data.hasPart.length - 1].endOffset, TOUR_VIDEO.durationSeconds);
  assert.equal(data.hasPart[3].url, "https://clindesk.co.uk/tour?t=67");
  assert.ok(!JSON.stringify(data).includes("undefined"));
});

test("/tour: title, description, canonical, share image, markup, calls to action", () => {
  const page = prose(read("src/app/clindesk-site/tour/page.tsx"));
  assert.match(page, /const TITLE = `Watch the 3-minute tour – \$\{CLINIC_SYSTEM_NAME\}`/);
  assert.match(page, /clindeskMetadata\(\{ path: TOUR_PATH, title: TITLE, description: DESCRIPTION \}\)/);
  assert.match(page, /images: \[SHARE_IMAGE\]/);
  assert.match(page, /<script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: STRUCTURED_DATA_JSON \}\} \/>/);
  assert.match(page, /\.replace\(\/<\/g, "\\\\u003c"\)/);
  assert.match(page, /<h1 className="display-xl" id="tour-title"> Watch the <span className="tv-nowrap">3-minute<\/span> tour <\/h1>/);
  assert.match(page, /<a className="btn btn-coral" href="\/demo"> Book a demo/);
  assert.match(page, /<a className="btn btn-outline" href="\/pricing"> See pricing/);
  assert.equal(TOUR_PATH, "/tour");
});

test("the home hero, the Reports page (at its chapter) and the footer link to the tour", () => {
  const home = prose(read("src/app/clindesk-site/page.tsx"));
  const heroCtas = home.slice(home.indexOf('<div className="hero-ctas">'), home.indexOf("hero-signin"));
  assert.match(heroCtas, /href="\/demo">Book a demo/);
  assert.match(heroCtas, /<p className="hero-tour"><TourLink \/><\/p>/);
  const reports = prose(read("src/app/clindesk-site/reports/page.tsx"));
  assert.match(reports, /<TourLink href=\{tourChapterHref\(REPORTS_CHAPTER\)\}> Watch Reports in the 3-minute tour/);
  assert.match(reports, /TOUR_CHAPTERS\.find\(\(c\) => c\.clock === "11:40"\)/);
  assert.equal(tourChapterHref(TOUR_CHAPTERS.find((c) => c.clock === "11:40")!), "/tour?t=67");
  const footer = prose(read("src/components/clindesk/site-footer.tsx"));
  assert.match(footer, /<a href="\/tour">Watch the 3-minute tour<\/a>/);
  const link = prose(read("src/components/clindesk/tour-link.tsx"));
  assert.match(link, /children = "Watch the 3-minute tour"/);
  assert.match(link, /href = TOUR_PATH/);
});

test("served on ClinDesk's hosts only, indexed, in the sitemap with the video's date", async () => {
  assert.ok((CLINDESK_SITE_PATHS as readonly string[]).includes("/tour"));
  assert.ok(!(PUBLIC_SITE_PATHS as readonly string[]).includes("/tour"), "not a ClinForms page");
  assert.deepEqual(CLINDESK_PAGES.find((p) => p.path === "/tour"), { path: "/tour", indexed: true, changeFrequency: "monthly", priority: 0.8 });
  const middleware = read("src/middleware.ts");
  assert.ok(middleware.includes('{ source: "/tour", has: [{ type: "host", value: "clindesk\\\\.co\\\\.uk|www\\\\.clindesk\\\\.co\\\\.uk|clinic\\\\.localhost" }] }'));
  const xml = await clindeskSitemap().text();
  assert.ok(xml.includes(`<loc>https://clindesk.co.uk/tour</loc>\n<lastmod>${TOUR_VIDEO.publishedOn}</lastmod>`), xml);
  assert.ok(!fs.existsSync(path.join(ROOT, "src/app/(marketing)/tour")), "no /tour on clinforms.co.uk");
});

test("next.config: the CSP lets the media host serve media only (the poster is same-origin)", async () => {
  const config = (await import(pathToFileURL(path.join(ROOT, "next.config.mjs")).href)).default;
  const headers = await config.headers();
  const csp = headers.flatMap((h: { headers: Array<{ key: string; value: string }> }) => h.headers).find((h: { key: string }) => h.key === "Content-Security-Policy-Report-Only").value as string;
  const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
  assert.ok(directives["media-src"].includes(TOUR_VIDEO_MEDIA_ORIGIN));
  assert.ok(!directives["img-src"].includes(TOUR_VIDEO_MEDIA_ORIGIN));
});

test("ClinDesk's privacy policy describes the tour video", () => {
  const privacy = prose(read("src/app/clindesk-site/privacy/page.tsx"));
  assert.match(privacy, /<strong>Tour video plays<\/strong>/);
  assert.match(privacy, /<a href="\/tour">3-minute tour<\/a>/);
  assert.match(privacy, /<strong>Media delivery<\/strong>/);
  assert.match(privacy, /played from media\.clinforms\.co\.uk/);
});
