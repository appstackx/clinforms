import type { Metadata } from "next";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CLINDESK_SITE_URL, clindeskMetadata } from "@/lib/clindesk/site";
import {
  TOUR_CHAPTERS,
  TOUR_PATH,
  TOUR_TRANSCRIPT_DETAILS_ID,
  TOUR_VIDEO,
  formatTourDurationWords,
  formatTourTime,
  tourVideoStructuredData,
} from "@/lib/clindesk-site/tour-video";
import { COMPANY } from "@/lib/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { DefaultCtaBand } from "@/components/clindesk/cta-band";
import { SitePage } from "@/components/clindesk/site-page";
import { TourPlayer } from "./tour-player";
import "@/components/clindesk/styles/tour.css";

/**
 * ClinDesk website – /tour (Watch the 3-minute tour – ClinDesk): the product tour video, its chapters, the
 * transcript and the calls to action. Everything about the video comes from src/lib/clindesk-site/tour-video.ts.
 * Linked from the home hero, the Reports page (at its chapter) and the footer.
 */
const TITLE = `Watch the 3-minute tour – ${CLINIC_SYSTEM_NAME}`;
const DESCRIPTION = `A 3-minute tour of ${CLINIC_SYSTEM_NAME} through one day at a fictional three-site physio clinic: diary and online booking, signed notes, an insurer’s own form filled from notes, group numbers, billing and switching.`;
const SHARE_IMAGE = { ...TOUR_VIDEO.shareImage, alt: TOUR_VIDEO.shareImageAlt };

const BASE_METADATA = clindeskMetadata({ path: TOUR_PATH, title: TITLE, description: DESCRIPTION });
export const metadata: Metadata = {
  ...BASE_METADATA,
  openGraph: { ...BASE_METADATA.openGraph, images: [SHARE_IMAGE] },
  twitter: { ...BASE_METADATA.twitter, images: [SHARE_IMAGE.url] },
};

/** The VideoObject markup, built where the chapters live so it is tested there. */
const STRUCTURED_DATA = tourVideoStructuredData(CLINDESK_SITE_URL, { name: COMPANY.legalName, url: COMPANY.website });
/** `<` escaped so no transcript text can close the script element early. */
const STRUCTURED_DATA_JSON = JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c");

export default function TourPage() {
  return (
    <SitePage current="other">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA_JSON }} />
      <TourHero />
      <Transcript />
      <DefaultCtaBand />
    </SitePage>
  );
}

/** 1 · The tour: intro, player and chapters, calls to action */
function TourHero() {
  const length = formatTourTime(TOUR_VIDEO.durationSeconds);
  return (
    <section className="tv-hero g-sky" aria-labelledby="tour-title">
      <div className="wrap">
        <div className="tv-intro">
          <p className="pen marker" style={cssVars({ "--tilt": "-2deg" })}>
            08:00 to 18:30 · a day at Pebblegate Physio
          </p>
          <h1 className="display-xl" id="tour-title">
            Watch the <span className="tv-nowrap">3-minute</span> tour
          </h1>
          <p className="lead">
            <span className="t-long">
              <b>
                One day at a fictional three-site clinic, in <span aria-hidden="true">{length}</span>
                <span className="vh">{formatTourDurationWords(TOUR_VIDEO.durationSeconds)}</span>.
              </b>{" "}
              The diary and online booking, notes that lock when signed, an insurer’s own form filled in from those notes,
              one set of numbers across sites, billing and card payment, and how you’d move from your current system.
            </span>
            <span className="t-short">
              <b>One day at a fictional three-site clinic</b>, from the front desk at 08:00 to lights off at 18:30.
            </span>
          </p>
        </div>

        <TourPlayer />

        <div className="tv-ctas">
          <a className="btn btn-coral" href="/demo">
            Book a demo <span className="arr" aria-hidden="true">→</span>
          </a>{" "}
          <a className="btn btn-outline" href="/pricing">
            See pricing <span className="arr" aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/** 2 · Transcript */
function Transcript() {
  return (
    <section id="transcript" className="tv-transcript g-couch" aria-labelledby="tv-transcript-title">
      <div className="wrap">
        <h2 className="display-l" id="tv-transcript-title">
          Transcript
        </h2>
        <details id={TOUR_TRANSCRIPT_DETAILS_ID} className="tv-details">
          <summary>Read what the tour says and shows</summary>
          <div className="tv-details-body">
            {TOUR_CHAPTERS.map((chapter) => (
              <div key={chapter.at} className="tv-tchapter">
                <h3 className="tv-th">
                  <span className="tv-ch-time">{formatTourTime(chapter.at)}</span>{" "}
                  {chapter.clock ? <span className="pen tv-ch-clock">{chapter.clock}</span> : null} {chapter.title}
                </h3>
                {chapter.transcript.map((line) => (
                  <p key={line} className="body">
                    {line}
                  </p>
                ))}
                {chapter.onScreen?.map((line) => (
                  <p key={line} className="small tv-onscreen">
                    <b>On screen:</b> {line}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
