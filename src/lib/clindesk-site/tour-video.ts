/**
 * The ClinDesk product tour at /tour on clindesk.co.uk: the player, the chapter list, the transcript, the page's
 * share image and the VideoObject markup all read this module, so they cannot disagree with each other.
 * Browser-safe and environment-free. (ClinForms' own demo video is src/lib/site/demo-video.ts; same pattern.)
 *
 * The files live in the Cloudflare R2 bucket `clinforms-media` (EU jurisdiction, appstackx-demos account), served
 * from media.clinforms.co.uk, whose CORS policy allows GET/HEAD from clinforms.co.uk and clindesk.co.uk (and www).
 * Each cut is uploaded under its own dated folder, clindesk/tour/<date>/, and never overwritten (immutable, cached
 * for a year): a new cut gets a new folder and a new `publishedOn`. In that folder: the two MP4s, the captions
 * (WebVTT, converted from the cut's SRT), the clean poster frame and the share image.
 *
 * The page's poster is the same frame served from this site (public/clindesk/tour/), so opening the page sends
 * nothing to the media host: the CSP keeps the media host to media-src only (next.config.mjs). The captions track
 * is on the media host (media-src) and is not loaded until a viewer turns captions on.
 *
 * The cut is "A day at Pebblegate Physio", showcase v1 (31 Oct 2026, approved by Khuram), built outside this repo in
 * marketing/clindesk/showcase-video-v1/. Its captions are BURNED INTO THE PICTURE, so the captions track is off by
 * default (turned on, it would draw every line twice); it is there for players and tools that read text tracks,
 * and the transcript below the player says the same. The cut ends on its end card ("Book a demo", held to the last
 * frame), so the player does not need to seek back to it.
 *
 * Chapter times are the cut's chapter changes (each chapter's card comes in just before its first narration line;
 * chapters.txt in the source folder gives them in whole seconds). Transcript lines are the narration word for word,
 * the SRT's cues joined into sentences; scripts/e2e/clindesk-tour.cjs checks them against the captions file.
 */

/** The day this cut was published: its media folder, /tour's sitemap date and the markup's upload date. */
const PUBLISHED_ON = "2026-10-31";

export const TOUR_VIDEO_MEDIA_ORIGIN = "https://media.clinforms.co.uk";
export const TOUR_VIDEO_MEDIA_BASE = `${TOUR_VIDEO_MEDIA_ORIGIN}/clindesk/tour/${PUBLISHED_ON}`;

/** The page's path on clindesk.co.uk. */
export const TOUR_PATH = "/tour";

export type TourQuality = "standard" | "high";

export const TOUR_VIDEO = {
  title: "ClinDesk: a day at Pebblegate Physio",
  /** For the VideoObject markup and link previews. */
  description:
    "A 3-minute tour of ClinDesk, practice software for UK physio and MSK clinics, through one day at a fictional three-site clinic: the diary and online booking, signed notes and letters, an insurer’s own report form filled in from signed notes (the Reports add-on), the group office’s numbers across sites, billing and card payment, the audit trail and switching from your current system.",
  /** The cut runs 181.46 s; players and the page show 3:01. */
  durationSeconds: 181,
  /** ISO 8601, for schema.org: 3 minutes 1 second. */
  isoDuration: "PT3M1S",
  publishedOn: PUBLISHED_ON,
  uploadDate: `${PUBLISHED_ON}T19:07:00+00:00`,
  /**
   * Two encodes of the same cut. "standard" (720p) is what the player loads; "high" (1080p) is offered beside the
   * player for a big screen. `bytes` is each object's size in the bucket (the page shows it rounded, "94 MB").
   * standard: 1280×720, H.264 High 4.0, AAC mono; high: 1920×1080, H.264 High 4.1, AAC stereo. Both fast-start.
   */
  sources: {
    standard: { src: `${TOUR_VIDEO_MEDIA_BASE}/clindesk-tour-720p.mp4`, width: 1280, height: 720, bytes: 13_287_822, label: "720p" },
    high: { src: `${TOUR_VIDEO_MEDIA_BASE}/clindesk-tour-1080p.mp4`, width: 1920, height: 1080, bytes: 93_559_315, label: "1080p" },
  },
  /** The source the player starts with. */
  defaultQuality: "standard" as TourQuality,
  /** The narration word for word, at its times (WebVTT), on the media host. Off by default: see above. */
  captions: `${TOUR_VIDEO_MEDIA_BASE}/clindesk-tour.en-GB.vtt`,
  /** The cut's title card with the headline complete (6.0 s, between two captions), 1920×1080. Same origin. */
  poster: "/clindesk/tour/clindesk-tour-poster.jpg",
  /** The same frame on the media host (for emails and documents; the page does not use it). */
  posterOnMedia: `${TOUR_VIDEO_MEDIA_BASE}/clindesk-tour-poster.jpg`,
  /** The title card with a play button, 1280×720: link previews only (crawlers fetch it, visitors' browsers do not). */
  shareImage: { url: `${TOUR_VIDEO_MEDIA_BASE}/clindesk-tour-share.png`, width: 1280, height: 720 },
  shareImageAlt: "ClinDesk tour, 3:01: “Diary full. Notes signed. Home by half four.” with a play button",
} as const;

export type TourChapter = {
  /** Seconds into the video. */
  at: number;
  /** The story's clock time, shown as the chapter's handwritten note (none for the welcome). */
  clock?: string;
  title: string;
  /** What the narration says in this chapter, word for word. */
  transcript: readonly string[];
  /** Facts the picture states that the narration does not, for anyone who cannot see the video. Material only. */
  onScreen?: readonly string[];
};

export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    at: 0,
    title: "Welcome",
    transcript: [
      "Diary full. Notes signed. Home by half four.",
      "This is ClinDesk: practice software for UK physio and MSK clinics.",
      "Let’s spend a day at Pebblegate Physio, a fictional clinic with three sites.",
    ],
    onScreen: [
      "Pebblegate Physio, its sites (Northgate, Abbey Road and Kingsmead), its staff, patients, insurers and GP practices are all fictional. Each chapter carries a “Sample data (fictional)” tag.",
    ],
  },
  {
    at: 17.9,
    clock: "08:00",
    title: "Front desk: diary and online booking",
    transcript: [
      "Eight o’clock. Jess opens the diary. Every practitioner, every room, at every site.",
      "Robert needs a follow-up with Sophie. Jess picks the 9:15 slot in Room 1. ClinDesk checks that Sophie and the room are free, and it’s booked.",
      "Meanwhile, Lucy books her first appointment on her phone. It lands straight in the diary, and she fills in her consent form before she arrives.",
    ],
    onScreen: ["Lucy’s booking appears in the diary marked as an online booking."],
  },
  {
    at: 46.4,
    clock: "09:15",
    title: "Notes, amendments and letters",
    transcript: [
      "Quarter past nine. Robert arrives, and Sophie starts his note from her follow-up template.",
      "When she signs it, the note locks. Change something later, and it’s a tracked amendment, with the original kept underneath.",
      "The letter to his GP comes from the same record.",
    ],
    onScreen: ["The typing is sped up, and labelled as such on screen."],
  },
  {
    at: 67.167,
    clock: "11:40",
    title: "ClinDesk Reports – powered by ClinForms (add-on)",
    transcript: [
      "Twenty to twelve. Robert’s insurer wants a progress report, on their own form.",
      "From his case, Sophie chooses Complete referrer form, and picks the insurer’s form.",
      "It’s filled in from the notes she’s already signed. Every answer shows the note it came from.",
      "Anything the notes don’t cover is left for her. Here, that’s her own opinion.",
      "She checks it, and signs. The completed form is filed straight back to Robert’s record.",
      "Your notes. Their form. Your signature.",
    ],
    onScreen: [
      "Reports is an add-on. The insurer, Northfield Assurance, is fictional; each answer cites one of Sophie’s two signed notes, and the prognosis is left for her own opinion. The short wait while the form is filled in is cut, and labelled on screen.",
    ],
  },
  {
    at: 107.467,
    clock: "13:05",
    title: "Group office: sites, numbers and roles",
    transcript: [
      "Five past one. Sam runs the group office. One diary, one patient list, and one set of numbers across every site.",
      "Switch sites in a click, and see the numbers for one site, or all of them.",
      "Roles decide who sees what. Reception never sees clinical notes.",
    ],
  },
  {
    at: 128.167,
    clock: "16:30",
    title: "Billing, authorisations and card payment",
    transcript: [
      "Half past four. Jess invoices the day’s visits in one go. Robert’s insurer gets their invoice, and Robert gets one for his excess.",
      "Authorised sessions count down, so session seven of six doesn’t sneak up on anyone.",
      "Robert gets a payment link by text, and pays his £25 by card, from his sofa.",
    ],
    onScreen: ["The card payment is made in test mode, labelled on screen: no real money moves. The invoice then shows Paid."],
  },
  {
    at: 151.467,
    clock: "18:30",
    title: "Audit trail, switching and booking a demo",
    transcript: [
      "Half past six. Lights off. Every change, and every signature, is on the audit trail: who, what and when.",
      "Switching from your current system? Bring in your patients, cases and appointments, check every row first, and undo an import for up to seven days.",
      "ClinDesk. Book a demo at clindesk.co.uk.",
    ],
    onScreen: [
      "The import uses a made-up file. The end card reads “Book a demo – clindesk.co.uk”, gives hello@clindesk.co.uk, and says Pebblegate Physio and everyone in the video are fictional, recorded on a test copy of ClinDesk with made-up data.",
    ],
  },
];

/** The page's transcript <details>, which the player opens when the video cannot play. */
export const TOUR_TRANSCRIPT_DETAILS_ID = "tour-transcript-details";

/** "1:07" for 67.167 seconds. Whole seconds, rounded down, as a player shows them. */
export function formatTourTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "94 MB" for a file of 93 559 315 bytes: whole megabytes (10^6), at least 1. */
export function formatTourMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/** "3 minutes 1 second", for screen readers, which read "3:01" as digits. */
export function formatTourDurationWords(seconds: number): string {
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  const minutes = m === 0 ? "" : `${m} minute${m === 1 ? "" : "s"}`;
  const secs = s === 0 ? "" : `${s} second${s === 1 ? "" : "s"}`;
  return [minutes, secs].filter(Boolean).join(" ") || "0 seconds";
}

/** "08:00 · Front desk: diary and online booking" – a chapter's full name, as chapters.txt writes it. */
export function tourChapterName(chapter: TourChapter): string {
  return chapter.clock ? `${chapter.clock} · ${chapter.title}` : chapter.title;
}

/**
 * The time a `?t=` link asks for, or null if it is not a usable one (whole seconds only, inside the video). A
 * second that matches a chapter opens at that chapter's exact start, so a chapter link lands where its button does.
 */
export function tourStartFromQuery(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d{1,4}$/.test(raw)) return null;
  const seconds = Number(raw);
  if (seconds <= 0 || seconds >= TOUR_VIDEO.durationSeconds) return null;
  return TOUR_CHAPTERS.find((c) => Math.floor(c.at) === seconds)?.at ?? seconds;
}

/** The chapter playing at `seconds` (the last one that has started). */
export function tourChapterIndexAt(seconds: number): number {
  return TOUR_CHAPTERS.reduce((found, c, i) => (seconds >= c.at ? i : found), 0);
}

/** `/tour?t=67` – a link that opens the tour at a chapter (the Reports page links to its chapter). */
export function tourChapterHref(chapter: TourChapter): string {
  const t = Math.floor(chapter.at);
  return t === 0 ? TOUR_PATH : `${TOUR_PATH}?t=${t}`;
}

/** The whole transcript, as one text (the markup's `transcript`; the captions file says the same). */
export function tourTranscriptText(): string {
  return TOUR_CHAPTERS.flatMap((c) => c.transcript).join(" ");
}

/**
 * VideoObject markup, so search engines can show the video with its chapters ("key moments"). Real values only:
 * the thumbnail is the player's own poster, the content URL the 1080p file, the clips the chapters (each one's URL
 * is the page with `?t=`, which the player honours), end to end.
 */
export function tourVideoStructuredData(siteUrl: string, publisher: { name: string; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: TOUR_VIDEO.title,
    description: TOUR_VIDEO.description,
    thumbnailUrl: [`${siteUrl}${TOUR_VIDEO.poster}`],
    uploadDate: TOUR_VIDEO.uploadDate,
    duration: TOUR_VIDEO.isoDuration,
    contentUrl: TOUR_VIDEO.sources.high.src,
    inLanguage: "en-GB",
    publisher: { "@type": "Organization", name: publisher.name, url: publisher.url },
    transcript: tourTranscriptText(),
    hasPart: TOUR_CHAPTERS.map((chapter, i) => ({
      "@type": "Clip",
      name: tourChapterName(chapter),
      startOffset: Math.floor(chapter.at),
      endOffset: Math.floor(TOUR_CHAPTERS[i + 1]?.at ?? TOUR_VIDEO.durationSeconds),
      url: `${siteUrl}${tourChapterHref(chapter)}`,
    })),
  };
}
