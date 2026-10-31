import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { Fill } from "@/components/clindesk/fill";
import { DemoForm } from "@/components/clindesk/demo-form";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/demo.css";

/**
 * ClinDesk website – /demo (Book a demo – ClinDesk).
 * Ported from the approved design export Site-Demo (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/demo",
  title: `Book a demo – ${CLINIC_SYSTEM_NAME}`,
  description: `Book a demo of ${CLINIC_SYSTEM_NAME}, practice software for UK physio and MSK clinics.`,
});

export default function DemoPage() {
  return (
    <SitePage current="/demo">
      <BookADemoIntroAndForm />
      <WhatToExpect />
      <EmailOrSignIn />
    </SitePage>
  );
}

/** 1 · Book a demo: intro and form */
function BookADemoIntroAndForm() {
  return (
    <section className="d-hero g-sky" aria-labelledby="demo-title">
      <div className="wrap grid12">
        <div className="d-intro">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>10:30 · you, between patients</p>
          <h1 className="display-xl" id="demo-title">See {CLINIC_SYSTEM_NAME} with your clinic in mind</h1>
          <p className="lead">
            <span className="t-long"><b>Tell us a little about your clinic</b> and we’ll arrange a time to show you {CLINIC_SYSTEM_NAME} – your diary, notes, billing and reports, and how you’d move from your current system.</span>
            <span className="t-short"><b>Tell us about your clinic</b> and we’ll show you {CLINIC_SYSTEM_NAME} running it.</span>
          </p>
          <div className="appt d-appt">
            <p className="label appt-label">Appointment</p>
            <p className="display-m appt-title">{CLINIC_SYSTEM_NAME} demo</p>
            <dl className="appt-rows">
              <div>
                <dt className="label">With</dt>
                <dd className="pen">the AppstackX team</dd>
              </div>
              <div>
                <dt className="label">Where</dt>
                <dd className="pen">online, on your screen</dd>
              </div>
              <div>
                <dt className="label">When</dt>
                <dd className="pen">a day that suits you</dd>
              </div>
              <div>
                <dt className="label">Bring</dt>
                <dd className="pen">your diary, and that form</dd>
              </div>
            </dl>
          </div>
          <p className="pen-note d-pen">1 to 15 sites, one diary</p>
        </div>
        <DemoForm />
        <svg className="wl d-wl draw" viewBox="0 0 1280 600" aria-hidden="true">
          <path pathLength="1" d="M714 318 C 736 318, 750 344, 768 352" />
          <circle cx="768" cy="352" r="4" />
        </svg>
      </div>
    </section>
  );
}

/** 2 · What to expect */
function WhatToExpect() {
  return (
    <section className="d-expect g-couch" aria-labelledby="expect-title">
      <div className="wrap grid12">
        <div className="d-expect-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>on the call</p>
          <h2 className="display-l" id="expect-title">What to expect</h2>
          <ol className="d-steps">
            <li>
              <span className="d-n" aria-hidden="true">1</span>
              <div>
                <h3 className="display-m">A call at a time that suits you.</h3>
                <p className="body">Online, <Fill k="demo.callLength" />.</p>
              </div>
            </li>
            <li>
              <span className="d-n" aria-hidden="true">2</span>
              <div>
                <h3 className="display-m">Built around your clinic.</h3>
                <p className="body">Your sites, your team and the referrers you work with.</p>
              </div>
            </li>
            <li>
              <span className="d-n" aria-hidden="true">3</span>
              <div>
                <h3 className="display-m">Switching questions answered.</h3>
                <p className="body">What moves from your current system, and how long it takes.</p>
              </div>
            </li>
          </ol>
        </div>
        <div className="d-expect-art">
          <figure className="print d-print deco" aria-hidden="true">
            <Drawing src="/clindesk/laptop-desk.svg" width={600} height={400} loading="lazy" decoding="async" />
            <span className="tape tape--sun print-tape" aria-hidden="true" />
          </figure>
        </div>
      </div>
    </section>
  );
}

/** 3 · Email or sign in */
function EmailOrSignIn() {
  return (
    <section className="d-more g-cardboard" aria-label="Other ways to reach us">
      <div className="wrap grid12">
        <div className="d-more-col">
          <h2 className="display-m">Prefer email?</h2>
          <p className="body">Write to <a className="link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we’ll reply within <Fill k="contact.responseTime" />.</p>
        </div>
        <div className="d-more-col d-more-col--b">
          <h2 className="display-m">Already using {CLINIC_SYSTEM_NAME}?</h2>
          <p className="body">
            <a className="link" href="/login">Sign in to {CLINIC_SYSTEM_NAME} <span className="arr" aria-hidden="true">→</span></a>
          </p>
        </div>
      </div>
    </section>
  );
}
