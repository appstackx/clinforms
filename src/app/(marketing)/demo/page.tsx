import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { DEMO_HREF, REQUEST_ACCESS_HREF, btn } from "@/components/marketing/nav";
import { COMPANY, SITE_URL } from "@/lib/site";
import {
  DEMO_CHAPTERS,
  DEMO_VIDEO,
  demoVideoStructuredData,
  formatChapterTime,
  TRANSCRIPT_DETAILS_ID,
} from "@/lib/site/demo-video";
import { PRODUCT } from "@/modules/medreport/config.public";
import { DemoPlayer } from "./demo-player";

const TITLE = "Product demo video";
const DESCRIPTION =
  "Watch ClinForms in 1½ minutes: a referrer’s own form completed from a fictional patient’s notes, every answer sourced, a gap flagged, then approved.";
const SHARE_IMAGE = { url: DEMO_VIDEO.shareImage, width: 1200, height: 630, alt: DEMO_VIDEO.shareImageAlt };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/demo" },
  openGraph: {
    title: `${TITLE} · ${PRODUCT.name}`,
    description: DESCRIPTION,
    url: "/demo",
    siteName: PRODUCT.name,
    locale: "en_GB",
    type: "website",
    images: [SHARE_IMAGE],
  },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${PRODUCT.name}`, description: DESCRIPTION, images: [SHARE_IMAGE] },
};

/** The VideoObject markup, built where the chapters live so it is tested there. */
const STRUCTURED_DATA = demoVideoStructuredData(SITE_URL, { name: COMPANY.legalName, url: COMPANY.website });
/** `<` escaped so no transcript text can close the script element early. */
const STRUCTURED_DATA_JSON = JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c");

/** The product demo video: public, indexable, linked from the header, the hero and the footer. */
export default function DemoPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA_JSON }} />

      <section aria-labelledby="demo-title" className="bg-gradient-to-b from-teal-50/70 via-white to-white">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">
              Product demo · {formatChapterTime(DEMO_VIDEO.durationSeconds)}
            </p>
            <h1 id="demo-title" className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl lg:leading-[1.1]">
              Watch {PRODUCT.name} complete a referrer&rsquo;s own form
            </h1>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              One fictional patient, one fictional referrer&rsquo;s form: set up once, answers drafted from the notes into
              the form&rsquo;s original layout, the source behind each answer, a gap flagged rather than guessed, and the
              physiotherapist&rsquo;s approval before anything is issued.
            </p>
          </div>

          <div className="mt-8">
            <DemoPlayer
              note={
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  <strong className="font-semibold text-slate-800">Fictional data:</strong> recorded in the {PRODUCT.name} demo
                  with fictional patients, clinicians and referrers. The form reading and the drafts shown are the demo&rsquo;s
                  prepared results for these fictional forms and notes.
                </p>
              }
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="demo-next-title" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="max-w-xl">
              <h2 id="demo-next-title" className="text-xl font-semibold tracking-tight text-slate-900">
                See it with your referrers&rsquo; forms
              </h2>
              <p className="mt-2 text-[15px] leading-7 text-slate-600">
                Request access and we&rsquo;ll reply by email to arrange a 15-minute call. Or write to{" "}
                <a href={`mailto:${COMPANY.contactEmail}`} className="font-medium text-teal-800 underline underline-offset-2">
                  {COMPANY.contactEmail}
                </a>
                .
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href={REQUEST_ACCESS_HREF} className={btn.primary}>
                Request access
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <TrackedLink href={DEMO_HREF} prefetch={false} className={btn.secondary} event="demo_opened" eventProps={{ area: "marketing", cta: "demo_page" }}>
                Try the interactive demo
              </TrackedLink>
            </div>
          </div>
        </div>
      </section>

      <section id="transcript" aria-labelledby="demo-transcript-title" className="scroll-mt-20 bg-white">
        <div className="mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6 lg:px-8">
          <h2 id="demo-transcript-title" className="text-xl font-semibold tracking-tight text-slate-900">
            Transcript
          </h2>
          <details id={TRANSCRIPT_DETAILS_ID} className="group mt-3 rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer select-none rounded-2xl px-5 py-4 text-sm font-medium text-slate-800 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
              Read what the video says and shows
            </summary>
            <div className="space-y-6 border-t border-slate-200 px-5 py-5">
              {DEMO_CHAPTERS.map((chapter) => (
                <div key={chapter.at}>
                  <h3 className="text-sm font-semibold text-slate-900">
                    <span className="mr-2 font-mono text-xs text-slate-600">{formatChapterTime(chapter.at)}</span> {chapter.title}
                  </h3>
                  {chapter.transcript.map((line) => (
                    <p key={line} className="mt-2 text-[15px] leading-7 text-slate-700">
                      {line}
                    </p>
                  ))}
                  {chapter.onScreen?.map((line) => (
                    <p key={line} className="mt-2 text-sm leading-6 text-slate-600">
                      <span className="font-medium text-slate-700">On screen:</span> {line}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </div>
      </section>
    </>
  );
}
