/**
 * The product demo video at /demo: the player, the chapter list, the transcript, the captions file's location, the
 * page's share image and the VideoObject markup all read this module, so they cannot disagree with each other.
 * Browser-safe and environment-free.
 *
 * The MP4s live in the Cloudflare R2 bucket `clinforms-media` (EU jurisdiction, appstackx-demos account), served
 * from media.clinforms.co.uk with a CORS policy allowing GET/HEAD from https://clinforms.co.uk and www. Each cut is
 * uploaded under its own dated folder and never overwritten (immutable, cached for a year): a new cut gets a new
 * folder and a new `publishedOn`. The poster, the share image and the captions are served from this site
 * (public/demo/), so showing the page discloses nothing to the media host.
 *
 * The cut is the outreach video v1 (10 Oct 2026) WITHOUT its burned-in caption pills: the page supplies the
 * captions as a WebVTT track instead. Same picture otherwise (title card, recording, "Fictional data" corner tag,
 * end card) and the same narration mix. Built outside this repo by
 * marketing/clinforms/outreach-video-v1-src/web-cut/build-web-assets.mjs (the two MP4s, the poster, the share image
 * and the captions, which it converts from the cut's SRT); timeline and narration are in that -src folder.
 *
 * Chapter times are the cut's screen changes (work/timeline.json `final.shots`); the first app screen and the end
 * card come in through a 0.15 s fade from white, so those two chapters start after the fade. Each chapter opens
 * just before its first narration line starts.
 */

/** The day this cut was published: its media folder, /demo's sitemap date and the markup's upload date. */
const PUBLISHED_ON = "2026-10-10";

export const DEMO_VIDEO_MEDIA_ORIGIN = "https://media.clinforms.co.uk";
export const DEMO_VIDEO_MEDIA_BASE = `${DEMO_VIDEO_MEDIA_ORIGIN}/demo/${PUBLISHED_ON}`;

export const DEMO_VIDEO = {
  title: "ClinForms demo",
  /** For the VideoObject markup. */
  description:
    "A 1:30 walk-through of ClinForms with fictional data: a referrer’s own form set up once, the answers drafted from a fictional patient’s notes into the form’s original layout, the source behind each answer, a gap flagged instead of guessed, the physiotherapist’s approval, the completed Word form, and the approved answers ready to copy into an insurer’s portal.",
  /** The cut runs 89.94 s; players and the poster show 1:30. */
  durationSeconds: 90,
  /** ISO 8601, for schema.org: 1 minute 30 seconds. */
  isoDuration: "PT1M30S",
  publishedOn: PUBLISHED_ON,
  uploadDate: `${PUBLISHED_ON}T15:40:00+01:00`,
  /**
   * Two encodes of the same cut, without burned-in captions. Phones get the lighter one.
   * full: 1920×1080, H.264 High 4.0, AAC 128 kb/s (9.2 MB); light: 1280×720, H.264 High 3.1, AAC 96 kb/s (4.6 MB).
   */
  sources: {
    full: { src: `${DEMO_VIDEO_MEDIA_BASE}/clinforms-demo-1080p.mp4`, width: 1920, height: 1080 },
    light: { src: `${DEMO_VIDEO_MEDIA_BASE}/clinforms-demo-720p.mp4`, width: 1280, height: 720 },
  },
  /** Captions (the narration word for word, at its times), as WebVTT. Same origin. */
  captions: "/demo/clinforms-demo.en-GB.vtt",
  /** The cut's own title card, 1920×1080. Same origin. */
  poster: "/demo/clinforms-demo-poster.jpg",
  /** 1200×630, the size link previews expect. Link previews only, not the markup. */
  shareImage: "/demo/clinforms-demo-share.jpg",
  shareImageAlt:
    "ClinForms demo, 1:30: a fictional referrer’s report form completed from clinic notes, with a play button",
} as const;

export type DemoChapter = {
  /** Seconds into the video. */
  at: number;
  title: string;
  /** What the narration says in this chapter, word for word. */
  transcript: readonly string[];
  /**
   * Facts the picture states that the narration does not, for anyone who cannot see the video. Material facts
   * only, not every label on screen.
   */
  onScreen?: readonly string[];
};

export const DEMO_CHAPTERS: readonly DemoChapter[] = [
  {
    at: 0,
    title: "Every referrer’s own form",
    transcript: [
      "Every referrer’s own report form – completed from your clinic notes.",
      "Insurers, medico-legal companies and case managers each send their own form.",
      "And your team retypes the same notes into every one.",
    ],
    onScreen: [
      "Five fictional blank referrer forms, from two medico-legal companies, two insurers and a case manager, as Word, fillable PDF and flat PDF files.",
      "From here on, a “Fictional data” label stays in the corner of every screen recorded in ClinForms.",
    ],
  },
  {
    at: 14.85,
    title: "Set up a referrer’s form once",
    transcript: [
      "Upload each referrer’s form once, exactly as it arrived.",
      "It maps the questions, and where each answer goes on the page.",
      "Your team checks it once; then it’s reused for every patient.",
    ],
    onScreen: [
      "The form uploaded is a fictional referrer’s Word form. The demo’s prepared reading of it finds 17 questions and lists one for staff to check.",
      "A named member of staff confirms the mapping before the form is used for any patient.",
    ],
  },
  {
    at: 29.268,
    title: "Pick the patient and the form",
    transcript: [
      "Now pick the patient – or upload their notes.",
      "Choose the referrer’s form, and the answers are drafted from the notes, straight into its original layout.",
    ],
    onScreen: [
      "The patient, Megan Hart, is fictional, picked from a simulated clinic system that holds demo data only.",
      "Her referral is from Harrow & Pike Solicitors (fictional), and ClinForms selects the form that matches it: Harrow & Pike Medico-Legal (fictional)’s Treating Physiotherapist Report, a Word form.",
      "The completed draft is marked “DRAFT – awaiting clinician approval”.",
    ],
  },
  {
    at: 39.499,
    title: "Every answer shows its source",
    transcript: ["Every answer shows its source.", "One click, and there’s the note it came from."],
    onScreen: [
      "Each drafted answer is labelled “Drafted from the notes”; its citation, N-001 · 18/03, opens the initial assessment note of 18/03/2026 beside it.",
    ],
  },
  {
    at: 45.319,
    title: "Gaps flagged, never guessed",
    transcript: [
      "Anything not in the notes – like a prognosis – is flagged, never guessed.",
      "Opinions only ever come from a clinician.",
    ],
    onScreen: [
      "The prognosis question is marked “Needs clinician input” and “Gap – not in the record”: no clinician recorded a prognosis in the notes, so it is left blank for the treating clinician.",
    ],
  },
  {
    at: 54.439,
    title: "The physiotherapist approves",
    transcript: [
      "The physiotherapist adds her opinion, checks every answer and approves.",
      "Nothing is issued until she does.",
    ],
    onScreen: [
      "The treating physiotherapist, Sarah Reid, is fictional, and so is her registration number, PH-DEMO-01. She writes her own prognosis, ticks the declaration and types her signature to approve. After approval the form is read-only.",
    ],
  },
  {
    at: 62.39,
    title: "Download the completed form",
    transcript: ["Then download the referrer’s own Word or PDF file – completed, in their layout, ready to send."],
    onScreen: [
      "This referrer’s form is a Word form, and the completed form downloads as a Word file. The final copy shows her prognosis in her own words, and her name, registration number and electronic signature in the declaration.",
    ],
  },
  {
    at: 69.849,
    title: "Answers for an insurer’s portal",
    transcript: [
      "If an insurer uses an online portal, every approved answer is ready to copy and paste.",
      "One at a time, or all at once.",
    ],
    onScreen: ["The approved answers can also be downloaded as a text file."],
  },
  {
    at: 79.599,
    title: "Book a 15-minute call",
    transcript: [
      "ClinForms. Their form, your notes, your clinician’s sign-off.",
      "Book a 15-minute call at clinforms.co.uk.",
    ],
    onScreen: ["The end card gives khuram@appstackx.co.uk and says “Fictional patient data shown.”"],
  },
];

/**
 * The page's transcript <details>, which the player opens when the video cannot play. Here rather than in the
 * player: a constant exported from a client component reaches a server component as a reference, not a string.
 */
export const TRANSCRIPT_DETAILS_ID = "demo-transcript-details";

/** "1:02" for 62.39 seconds. Whole seconds, rounded down, as a player shows them. */
export function formatChapterTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "1 minute 30 seconds", for screen readers, which read "1:30" as digits. */
export function formatDurationWords(seconds: number): string {
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  const minutes = m === 0 ? "" : `${m} minute${m === 1 ? "" : "s"}`;
  const secs = s === 0 ? "" : `${s} second${s === 1 ? "" : "s"}`;
  return [minutes, secs].filter(Boolean).join(" ") || "0 seconds";
}

/**
 * The time a `?t=` link asks for, or null if it is not a usable one (whole seconds only, inside the video). A
 * second that matches a chapter opens at that chapter's exact start, so a shared chapter link lands where the
 * chapter button does.
 */
export function startFromQuery(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d{1,4}$/.test(raw)) return null;
  const seconds = Number(raw);
  if (seconds <= 0 || seconds >= DEMO_VIDEO.durationSeconds) return null;
  return DEMO_CHAPTERS.find((c) => Math.floor(c.at) === seconds)?.at ?? seconds;
}

/** The chapter playing at `seconds` (the last one that has started). */
export function chapterIndexAt(seconds: number): number {
  return DEMO_CHAPTERS.reduce((found, c, i) => (seconds >= c.at ? i : found), 0);
}

/** The whole transcript, as one text (the markup's `transcript`; the captions file says the same). */
export function demoTranscriptText(): string {
  return DEMO_CHAPTERS.flatMap((c) => c.transcript).join(" ");
}

/**
 * VideoObject markup, so search engines can show the video with its chapters ("key moments"). The thumbnail is
 * the player's own poster. Each chapter is a Clip whose URL is the page with `?t=`, which the player honours;
 * the clips run end to end.
 */
export function demoVideoStructuredData(siteUrl: string, publisher: { name: string; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: DEMO_VIDEO.title,
    description: DEMO_VIDEO.description,
    thumbnailUrl: [`${siteUrl}${DEMO_VIDEO.poster}`],
    uploadDate: DEMO_VIDEO.uploadDate,
    duration: DEMO_VIDEO.isoDuration,
    contentUrl: DEMO_VIDEO.sources.full.src,
    inLanguage: "en-GB",
    publisher: { "@type": "Organization", name: publisher.name, url: publisher.url },
    transcript: demoTranscriptText(),
    hasPart: DEMO_CHAPTERS.map((chapter, i) => ({
      "@type": "Clip",
      name: chapter.title,
      startOffset: Math.floor(chapter.at),
      endOffset: Math.floor(DEMO_CHAPTERS[i + 1]?.at ?? DEMO_VIDEO.durationSeconds),
      url: `${siteUrl}/demo?t=${Math.floor(chapter.at)}`,
    })),
  };
}
