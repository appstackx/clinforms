"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import { track } from "@/components/analytics";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { DEMO_HREF, REQUEST_ACCESS_HREF } from "@/components/marketing/nav";
import {
  DEMO_CHAPTERS,
  DEMO_VIDEO,
  chapterIndexAt,
  formatChapterTime,
  formatDurationWords,
  formatMegabytes,
  startFromQuery,
  TRANSCRIPT_DETAILS_ID,
} from "@/lib/site/demo-video";
import { cn } from "@/lib/utils";

/**
 * How long after play the first frame may take before the player says the video cannot be reached. A network that
 * drops the request silently (black-holed rather than refused) never reports an error, so without this the visitor
 * would watch a spinner. Loading carries on behind the panel, and the panel goes away if the video starts.
 */
const STALL_MS = 12_000;

/**
 * The demo video and its chapter list.
 *
 * Three settings here are privacy decisions, and the privacy policy (section 3, "The demo video") describes them:
 * - `preload="none"`: the files are served by our media delivery provider, so with any other value merely opening
 *   the page would send the visitor's IP address there. The poster and the captions are on our own domain.
 * - `crossOrigin="anonymous"`: an anonymous CORS request never carries cookies, whatever cookies a browser holds
 *   for clinforms.co.uk or its media subdomain. The bucket's CORS policy allows GET and HEAD from the site.
 * - A `?t=` link only sets where playback will start: setting `currentTime` before anything has loaded records a
 *   start position without fetching.
 *
 * Until the first play a button over the poster is the one control: desktop browsers draw no play button on a
 * paused video, so without it the video reads as a picture. On a phone it sits in the poster's empty lower band so
 * the poster's name and headline stay readable.
 *
 * If the video cannot be reached, a panel says so and offers the transcript: when every source fails (a clinic's
 * web filter, no connection; the browser reports it on the last <source>, not on the <video>), or when no frame has
 * arrived STALL_MS after play (a network that drops the request silently).
 *
 * When the video ends, a panel offers the call (the end card's own call to action), "Watch again" and the
 * interactive demo, and the picture goes back to the end card: the cut fades to black over its last half-second.
 * The end card is held inside the last caption's cue (the narration's last words run past `endCardAt`), so captions
 * that were showing are hidden while the panel is up, or the browser would draw that line behind it; they come back
 * as soon as the panel goes (any play, "Watch again", a chapter). Captions the viewer turned off stay off.
 *
 * Focus: a control that disappears hands focus to the video when focus would otherwise fall back to the page (the
 * play button, "Watch again", the panel when the video starts after all); a panel that covers the video takes focus
 * when the video had it.
 *
 * Analytics (consent-gated, allow-listed, no-op without consent): "demo_video_played" once per page view when
 * playback actually starts, "demo_video_completed" once when it reaches the end. No other properties.
 *
 * `note` is shown directly under the video (above the chapters on a phone): the page's fictional-data label.
 */
export function DemoPlayer({ note }: { note?: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const endPanelRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  // A control that had focus is going away: give focus to the video if it would otherwise drop to the page.
  const handFocusToVideo = useRef(false);
  // The video had focus when it ended: the end panel takes it.
  const focusEndPanel = useRef(false);
  const stallTimer = useRef<number | undefined>(undefined);
  const counted = useRef({ played: false, completed: false });
  // The captions were showing when the video ended, and are hidden while the end panel is up.
  const captionsHiddenForEnd = useRef(false);

  useEffect(() => {
    const start = startFromQuery(new URLSearchParams(window.location.search).get("t"));
    if (start !== null && videoRef.current) {
      videoRef.current.currentTime = start;
      setCurrent(start);
    }
    return () => window.clearTimeout(stallTimer.current);
  }, []);

  useEffect(() => {
    if (!handFocusToVideo.current) return;
    handFocusToVideo.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) videoRef.current?.focus();
  }, [started, ended, failed]);

  useEffect(() => {
    // The video (or the play button) had focus and is now covered by the panel: move focus into the panel.
    if (failed && panelRef.current && (document.activeElement === videoRef.current || document.activeElement === document.body)) {
      panelRef.current.focus();
    }
  }, [failed]);

  useEffect(() => {
    if (ended && focusEndPanel.current) {
      focusEndPanel.current = false;
      endPanelRef.current?.focus({ preventScroll: true });
    }
    // The end panel has gone: the captions it hid come back.
    if (!ended && captionsHiddenForEnd.current) {
      captionsHiddenForEnd.current = false;
      const captions = trackRef.current?.track;
      if (captions) captions.mode = "showing";
    }
  }, [ended]);

  const activeIndex = chapterIndexAt(current);

  function watchForStall() {
    window.clearTimeout(stallTimer.current);
    stallTimer.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) setFailed(true);
    }, STALL_MS);
  }

  function play() {
    // A refused play (a browser that blocks it) leaves the video paused where it was asked to start. A source that
    // cannot be fetched never settles this promise; the <source> error handler and the stall check cover that.
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) watchForStall();
    void video.play().catch(() => undefined);
  }

  function playFrom(at: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = at;
    setCurrent(at);
    setEnded(false);
    play();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    video.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }

  function retry() {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    video.load();
    play();
  }

  function watchAgain() {
    const video = videoRef.current;
    if (!video) return;
    handFocusToVideo.current = true;
    video.currentTime = 0;
    setCurrent(0);
    setEnded(false);
    play();
  }

  function openTranscript() {
    const details = document.getElementById(TRANSCRIPT_DETAILS_ID);
    if (details instanceof HTMLDetailsElement) details.open = true;
  }

  const lengthInWords = formatDurationWords(DEMO_VIDEO.durationSeconds);
  // The panel only renders in the browser (after a failure), so the screen size is known here.
  const download = failed && window.matchMedia(DEMO_VIDEO.sources.light.media).matches ? DEMO_VIDEO.sources.light : DEMO_VIDEO.sources.full;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_17rem] lg:items-start">
      <div>
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-xl shadow-teal-900/10">
          <video
            ref={videoRef}
            className="block aspect-video h-auto w-full scroll-mt-24"
            width={DEMO_VIDEO.sources.full.width}
            height={DEMO_VIDEO.sources.full.height}
            poster={DEMO_VIDEO.poster}
            preload="none"
            crossOrigin="anonymous"
            // The native controls appear with the first play; before it, the play button over the poster is the one control.
            controls={started && !failed && !ended}
            playsInline
            aria-label={`ClinForms demo video, ${lengthInWords}`}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => {
              setStarted(true);
              setEnded(false);
            }}
            onLoadedData={() => window.clearTimeout(stallTimer.current)}
            onPlaying={() => {
              window.clearTimeout(stallTimer.current);
              // It started after all (a slow network, not a blocked one): the panel goes, and so does its focus.
              if (panelRef.current?.contains(document.activeElement)) handFocusToVideo.current = true;
              setFailed(false);
              if (counted.current.played) return;
              counted.current.played = true;
              track("demo_video_played", { area: "marketing" });
            }}
            onEnded={(e) => {
              const video = e.currentTarget;
              focusEndPanel.current = document.activeElement === video;
              // Hide showing captions before going back: the end card is held inside the last line's cue.
              const captions = trackRef.current?.track;
              if (captions?.mode === "showing") {
                captions.mode = "hidden";
                captionsHiddenForEnd.current = true;
              }
              // Back to the end card: the last frames are black.
              video.currentTime = DEMO_VIDEO.endCardAt;
              setCurrent(DEMO_VIDEO.endCardAt);
              setEnded(true);
              if (counted.current.completed) return;
              counted.current.completed = true;
              track("demo_video_completed", { area: "marketing" });
            }}
          >
            <source src={DEMO_VIDEO.sources.light.src} type="video/mp4" media={DEMO_VIDEO.sources.light.media} />
            <source src={DEMO_VIDEO.sources.full.src} type="video/mp4" onError={() => setFailed(true)} />
            <track ref={trackRef} kind="captions" src={DEMO_VIDEO.captions} srcLang="en-GB" label="English" default />
          </video>

          {!started && !failed && (
            <button
              type="button"
              onClick={() => {
                // The button goes away once playback starts; focus moves to the video rather than to the page.
                handFocusToVideo.current = true;
                play();
              }}
              aria-label={`Play the demo, ${lengthInWords}`}
              className="group absolute inset-0 flex items-end justify-center pb-2.5 transition-colors hover:bg-slate-900/[0.04] focus:outline-none motion-reduce:transition-none sm:items-center sm:pb-0"
            >
              <span className="flex items-center gap-2.5 rounded-full bg-white py-1.5 pl-1.5 pr-4 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/5 transition-transform group-hover:scale-[1.03] group-focus-visible:ring-4 group-focus-visible:ring-teal-700 group-focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:group-hover:scale-100 sm:gap-3 sm:py-2.5 sm:pl-2.5 sm:pr-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-white sm:h-12 sm:w-12">
                  <Play className="ml-0.5 h-4 w-4 fill-current sm:h-5 sm:w-5" strokeWidth={2} aria-hidden />
                </span>
                <span className="text-sm font-semibold text-slate-900 sm:text-base" aria-hidden>
                  Play the demo{" "}
                  <span className="ml-1 font-normal tabular-nums text-slate-600">{formatChapterTime(DEMO_VIDEO.durationSeconds)}</span>
                </span>
              </span>
            </button>
          )}

          {ended && !failed && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-3 backdrop-blur-sm sm:p-6">
              <div
                ref={endPanelRef}
                tabIndex={-1}
                role="group"
                aria-labelledby="demo-end-title"
                className="flex max-w-md flex-col items-center gap-2 text-center focus:outline-none sm:gap-3"
              >
                <p id="demo-end-title" className="text-sm font-semibold text-slate-900 sm:text-lg">
                  See it with your referrers&rsquo; forms
                </p>
                <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                  <Link
                    href={REQUEST_ACCESS_HREF}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 motion-reduce:transition-none sm:rounded-xl sm:px-5 sm:py-3"
                  >
                    Book a 15-minute call
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                  <button
                    type="button"
                    onClick={watchAgain}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 motion-reduce:transition-none sm:rounded-xl sm:px-5 sm:py-3"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Watch again
                  </button>
                </div>
                <TrackedLink
                  href={DEMO_HREF}
                  prefetch={false}
                  className="text-sm font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900"
                  event="demo_opened"
                  eventProps={{ area: "marketing", cta: "demo_video_end" }}
                >
                  Try the interactive demo
                </TrackedLink>
              </div>
            </div>
          )}

          {failed && (
            <div role="status" className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-slate-900/80 p-3 sm:p-4">
              <div ref={panelRef} tabIndex={-1} className="max-w-md rounded-xl bg-white p-4 text-sm text-slate-700 shadow-lg focus:outline-none sm:p-5">
                <p className="font-semibold text-slate-900">The video plays from media.clinforms.co.uk</p>
                <p className="mt-1.5">
                  If your network blocks that address, the{" "}
                  <a href="#transcript" onClick={openTranscript} className="font-medium text-teal-800 underline underline-offset-2">
                    full transcript
                  </a>{" "}
                  below covers everything the video says and shows. On another network you can also{" "}
                  <a href={download.src} rel="noreferrer" className="font-medium text-teal-800 underline underline-offset-2">
                    download the video ({formatMegabytes(download.bytes)})
                  </a>
                  .
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>
        {note}
      </div>

      <nav aria-labelledby="demo-chapters-heading">
        <h2 id="demo-chapters-heading" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Chapters
        </h2>
        <ol className="mt-3 space-y-1">
          {DEMO_CHAPTERS.map((chapter, i) => (
            <li key={chapter.at}>
              <button
                type="button"
                onClick={() => playFrom(chapter.at)}
                aria-current={i === activeIndex ? "true" : undefined}
                className={cn(
                  "flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 motion-reduce:transition-none",
                  i === activeIndex ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-700 hover:bg-white",
                )}
              >
                <span className={cn("w-9 shrink-0 font-mono text-xs tabular-nums", i === activeIndex ? "text-teal-800" : "text-slate-600")}>
                  {formatChapterTime(chapter.at)}
                </span>{" "}
                <span>{chapter.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
