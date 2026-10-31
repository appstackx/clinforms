"use client";

import { useEffect, useRef, useState } from "react";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import {
  TOUR_CHAPTERS,
  TOUR_TRANSCRIPT_DETAILS_ID,
  TOUR_VIDEO,
  type TourQuality,
  formatTourDurationWords,
  formatTourMegabytes,
  formatTourTime,
  tourChapterIndexAt,
  tourStartFromQuery,
} from "@/lib/clindesk-site/tour-video";

/**
 * How long after play the first frame may take before the player says the video cannot be reached. A network that
 * drops the request silently (black-holed rather than refused) never reports an error, so without this the visitor
 * would watch a spinner. Loading carries on behind the panel, and the panel goes away if the video starts.
 */
const STALL_MS = 12_000;

/**
 * The ClinDesk tour and its chapter list (the pattern of ClinForms' /demo player, src/app/(marketing)/demo, in the
 * ClinDesk site's own style; no analytics – ClinDesk's hosts have none).
 *
 * Privacy settings (the privacy policy, section 3, "The tour video", describes them):
 * - `preload="none"`: the files are on our media delivery provider, so with any other value merely opening the page
 *   would send the visitor's IP address there. The poster is on our own domain; the captions track is off by
 *   default (the captions are burned into the picture) and is only fetched if a viewer turns it on.
 * - `crossOrigin="anonymous"`: an anonymous CORS request never carries cookies. The bucket's CORS policy allows
 *   GET and HEAD from clindesk.co.uk.
 * - A `?t=` link only sets where playback will start: setting `currentTime` before anything has loaded records a
 *   start position without fetching.
 *
 * Until the first play a button over the poster is the one control (desktop browsers draw no play button on a
 * paused video). The 720p file plays by default; "1080p" beside the player switches to the larger file at the same
 * point (and back). If the video cannot be reached, a panel says so and offers the transcript: when the source fails
 * (a clinic's web filter, no connection) or no frame has arrived STALL_MS after play. When the video ends (on its
 * own "Book a demo" end card), a panel offers the demo and "Watch again".
 *
 * Focus: a control that disappears hands focus to the video when focus would otherwise fall back to the page; a
 * panel that covers the video takes focus when the video had it.
 */
export function TourPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const endPanelRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [quality, setQuality] = useState<TourQuality>(TOUR_VIDEO.defaultQuality);
  const handFocusToVideo = useRef(false);
  const focusEndPanel = useRef(false);
  const stallTimer = useRef<number | undefined>(undefined);
  // Set when the quality changes: where to carry on in the new file, and whether to keep playing.
  const resumeAfterSwitch = useRef<{ at: number; play: boolean } | null>(null);

  useEffect(() => {
    const start = tourStartFromQuery(new URLSearchParams(window.location.search).get("t"));
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
    if (failed && panelRef.current && (document.activeElement === videoRef.current || document.activeElement === document.body)) {
      panelRef.current.focus();
    }
  }, [failed]);

  useEffect(() => {
    if (ended && focusEndPanel.current) {
      focusEndPanel.current = false;
      endPanelRef.current?.focus({ preventScroll: true });
    }
  }, [ended]);

  useEffect(() => {
    // The new file's <source> is in place: load it, and carry on where the old one was.
    const resume = resumeAfterSwitch.current;
    const video = videoRef.current;
    if (!resume || !video) return;
    resumeAfterSwitch.current = null;
    video.load();
    video.currentTime = resume.at;
    if (resume.play) play();
    // play() is stable for this purpose (it only reads refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  const activeIndex = tourChapterIndexAt(current);
  const source = TOUR_VIDEO.sources[quality];

  function watchForStall() {
    window.clearTimeout(stallTimer.current);
    stallTimer.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) setFailed(true);
    }, STALL_MS);
  }

  function play() {
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

  function chooseQuality(next: TourQuality) {
    const video = videoRef.current;
    if (next === quality || !video) return;
    resumeAfterSwitch.current = { at: video.currentTime, play: started && !video.paused };
    setFailed(false);
    setQuality(next);
  }

  function openTranscript() {
    const details = document.getElementById(TOUR_TRANSCRIPT_DETAILS_ID);
    if (details instanceof HTMLDetailsElement) details.open = true;
  }

  const lengthInWords = formatTourDurationWords(TOUR_VIDEO.durationSeconds);

  return (
    <div className="tv-player">
      <div className="tv-main">
        <div className="tv-frame">
          <video
            ref={videoRef}
            className="tv-video"
            width={TOUR_VIDEO.sources.high.width}
            height={TOUR_VIDEO.sources.high.height}
            poster={TOUR_VIDEO.poster}
            preload="none"
            crossOrigin="anonymous"
            controls={started && !failed && !ended}
            playsInline
            aria-label={`${CLINIC_SYSTEM_NAME} tour video, ${lengthInWords}`}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => {
              setStarted(true);
              setEnded(false);
            }}
            onLoadedData={() => window.clearTimeout(stallTimer.current)}
            onPlaying={() => {
              window.clearTimeout(stallTimer.current);
              if (panelRef.current?.contains(document.activeElement)) handFocusToVideo.current = true;
              setFailed(false);
            }}
            onEnded={(e) => {
              focusEndPanel.current = document.activeElement === e.currentTarget;
              setEnded(true);
            }}
          >
            <source key={source.src} src={source.src} type="video/mp4" onError={() => setFailed(true)} />
            <track kind="captions" src={TOUR_VIDEO.captions} srcLang="en-GB" label="English" />
          </video>

          {!started && !failed && (
            <button
              type="button"
              className="tv-play"
              onClick={() => {
                handFocusToVideo.current = true;
                play();
              }}
            >
              <span className="tv-play-pill">
                <span className="tv-play-dot" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                </span>
                <span className="tv-play-text">
                  Play the tour{" "}
                  <span className="tv-play-len" aria-hidden="true">
                    {formatTourTime(TOUR_VIDEO.durationSeconds)}
                  </span>
                  <span className="vh">, {lengthInWords}</span>
                </span>
              </span>
            </button>
          )}

          {ended && !failed && (
            <div className="tv-overlay tv-overlay--end">
              <div ref={endPanelRef} tabIndex={-1} role="group" aria-labelledby="tv-end-title" className="tv-panel tv-panel--end">
                <p id="tv-end-title" className="display-m">
                  See it with your clinic in mind
                </p>
                <div className="tv-panel-actions">
                  <a className="btn btn-coral" href="/demo">
                    Book a demo <span className="arr" aria-hidden="true">→</span>
                  </a>{" "}
                  <button type="button" className="btn btn-outline" onClick={watchAgain}>
                    Watch again
                  </button>
                </div>
              </div>
            </div>
          )}

          {failed && (
            <div role="status" className="tv-overlay tv-overlay--fail">
              <div ref={panelRef} tabIndex={-1} className="tv-panel">
                <p className="tv-panel-title">The video plays from media.clinforms.co.uk</p>
                <p className="tv-panel-text">
                  If your network blocks that address, the{" "}
                  <a href="#transcript" onClick={openTranscript} className="link">
                    full transcript
                  </a>{" "}
                  below covers everything the video says and shows. On another network you can also{" "}
                  <a href={source.src} rel="noreferrer" className="link">
                    download the video ({formatTourMegabytes(source.bytes)})
                  </a>
                  .
                </p>
                <button type="button" className="btn btn-outline tv-retry" onClick={retry}>
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="tv-under">
          <p className="small tv-note">
            <b>Sample data (fictional):</b> Pebblegate Physio and everyone in the video are made up, recorded on a test copy
            of {CLINIC_SYSTEM_NAME}. Captions are part of the picture; the transcript is below.
          </p>
          <div className="tv-quality" role="group" aria-label="Video quality">
            <span className="label tv-quality-label" aria-hidden="true">
              Quality
            </span>
            {(Object.keys(TOUR_VIDEO.sources) as TourQuality[]).map((q) => (
              <button
                key={q}
                type="button"
                className="tv-q"
                aria-pressed={quality === q}
                aria-label={`${TOUR_VIDEO.sources[q].label}, ${formatTourMegabytes(TOUR_VIDEO.sources[q].bytes)}`}
                onClick={() => chooseQuality(q)}
              >
                {TOUR_VIDEO.sources[q].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <nav className="tv-chapters" aria-labelledby="tv-chapters-heading">
        <h2 className="label tv-chapters-h" id="tv-chapters-heading">
          Chapters
        </h2>
        <ol>
          {TOUR_CHAPTERS.map((chapter, i) => (
            <li key={chapter.at}>
              <button type="button" className="tv-ch" onClick={() => playFrom(chapter.at)} aria-current={i === activeIndex ? "true" : undefined}>
                <span className="tv-ch-time">{formatTourTime(chapter.at)}</span>{" "}
                <span className="tv-ch-name">
                  {chapter.clock ? (
                    <>
                      <span className="pen tv-ch-clock">{chapter.clock}</span>{" "}
                    </>
                  ) : null}
                  {chapter.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
