"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import { track } from "@/components/analytics";
import {
  DEMO_CHAPTERS,
  DEMO_VIDEO,
  chapterIndexAt,
  formatChapterTime,
  formatDurationWords,
  startFromQuery,
  TRANSCRIPT_DETAILS_ID,
} from "@/lib/site/demo-video";
import { cn } from "@/lib/utils";

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
 * Until the first play a large button covers the poster: desktop browsers draw no play button on a paused video,
 * so without it the video reads as a picture. If every source fails (a clinic's web filter, no connection), the
 * browser reports it on the last <source>, not on the <video>, and a panel says so and offers the transcript.
 *
 * Analytics (consent-gated, allow-listed, no-op without consent): "demo_video_played" once per page view when
 * playback actually starts, "demo_video_completed" once when it reaches the end. No other properties.
 *
 * `note` is shown directly under the video (above the chapters on a phone): the page's fictional-data label.
 */
export function DemoPlayer({ note }: { note?: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  // Focus was on the play button when it went away; give it to the video.
  const handFocusToVideo = useRef(false);
  const counted = useRef({ played: false, completed: false });

  useEffect(() => {
    const start = startFromQuery(new URLSearchParams(window.location.search).get("t"));
    if (start !== null && videoRef.current) {
      videoRef.current.currentTime = start;
      setCurrent(start);
    }
  }, []);

  useEffect(() => {
    if (started && handFocusToVideo.current) {
      handFocusToVideo.current = false;
      videoRef.current?.focus();
    }
  }, [started]);

  useEffect(() => {
    // The video (or the play button) had focus and is now covered by the panel: move focus into the panel.
    if (failed && panelRef.current && (document.activeElement === videoRef.current || document.activeElement === document.body)) {
      panelRef.current.focus();
    }
  }, [failed]);

  const activeIndex = chapterIndexAt(current);

  function play() {
    // A refused play (a browser that blocks it) leaves the video paused where it was asked to start. A source that
    // cannot be fetched never settles this promise; the <source> error handler covers that case.
    void videoRef.current?.play().catch(() => undefined);
  }

  function playFrom(at: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = at;
    setCurrent(at);
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

  function openTranscript() {
    const details = document.getElementById(TRANSCRIPT_DETAILS_ID);
    if (details instanceof HTMLDetailsElement) details.open = true;
  }

  const lengthInWords = formatDurationWords(DEMO_VIDEO.durationSeconds);

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
            controls={started && !failed}
            playsInline
            aria-label={`ClinForms demo video, ${lengthInWords}`}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => setStarted(true)}
            onPlaying={() => {
              if (counted.current.played) return;
              counted.current.played = true;
              track("demo_video_played", { area: "marketing" });
            }}
            onEnded={() => {
              if (counted.current.completed) return;
              counted.current.completed = true;
              track("demo_video_completed", { area: "marketing" });
            }}
          >
            <source src={DEMO_VIDEO.sources.light.src} type="video/mp4" media="(max-width: 767px)" />
            <source src={DEMO_VIDEO.sources.full.src} type="video/mp4" onError={() => setFailed(true)} />
            <track kind="captions" src={DEMO_VIDEO.captions} srcLang="en-GB" label="English" default />
          </video>

          {!started && !failed && (
            <button
              type="button"
              onClick={(e) => {
                // A keyboard press has no pointer position.
                handFocusToVideo.current = e.detail === 0;
                play();
              }}
              aria-label={`Play the demo, ${lengthInWords}`}
              className="group absolute inset-0 flex items-center justify-center bg-slate-900/10 transition-colors hover:bg-slate-900/5 focus:outline-none"
            >
              <span className="flex items-center gap-3 rounded-full bg-white py-2 pl-2 pr-5 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/5 transition-transform group-hover:scale-[1.03] group-focus-visible:ring-4 group-focus-visible:ring-teal-700 group-focus-visible:ring-offset-2 sm:py-2.5 sm:pl-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 text-white sm:h-12 sm:w-12">
                  <Play className="ml-0.5 h-5 w-5 fill-current" strokeWidth={2} aria-hidden />
                </span>
                <span className="text-sm font-semibold text-slate-900 sm:text-base" aria-hidden>
                  Play the demo{" "}
                  <span className="ml-1 font-normal tabular-nums text-slate-600">{formatChapterTime(DEMO_VIDEO.durationSeconds)}</span>
                </span>
              </span>
            </button>
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
                  below covers everything the video says and shows, or you can{" "}
                  <a href={DEMO_VIDEO.sources.full.src} className="font-medium text-teal-800 underline underline-offset-2">
                    download the video
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
                  "flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700",
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
