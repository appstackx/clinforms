import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/demo.css";

/**
 * ClinDesk website – /demo/thanks (Thanks – we’ve got your request – ClinDesk).
 * Ported from the approved design export Site-Demo/thanks (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/demo/thanks",
  title: `Thanks – we’ve got your request – ${CLINIC_SYSTEM_NAME}`,
  description: `Thanks for requesting a ${CLINIC_SYSTEM_NAME} demo.`,
  index: false,
});

export default function DemoThanksPage() {
  return (
    <SitePage current="other">
      <RequestReceived />
      <WhileYouWait />
    </SitePage>
  );
}

/** 1 · Request received */
function RequestReceived() {
  return (
    <section className="t-hero g-sky" aria-labelledby="thanks-title">
      <div className="wrap grid12">
        <div className="t-copy">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>10:32 · request sent</p>
          <h1 className="display-xl" id="thanks-title">Thanks – we’ve got your request</h1>
          <p className="lead">We’ll email you within <Fill k="contact.responseTime" /> to arrange a time for your demo.</p>
          <p className="body t-urgent">If it’s urgent, email <a className="link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
          <a className="btn btn-outline" href="/">Back to home <span className="arr" aria-hidden="true">→</span></a>
        </div>
        <div className="t-art">
          <div className="appt t-appt">
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
                <dd className="pen">we’ll email you a time</dd>
              </div>
              <div>
                <dt className="label">Bring</dt>
                <dd className="pen">your diary, and that form</dd>
              </div>
            </dl>
          </div>
          <div className="stamp t-stamp" aria-hidden="true">
            <svg viewBox="0 0 150 150">
              <defs>
                <path id="tst-arc" d="M75 75 m-58 0 a58 58 0 1 1 116 0 a58 58 0 1 1 -116 0" />
              </defs>
              <circle className="ring" cx="75" cy="75" r="71" />
              <circle className="ring-thin" cx="75" cy="75" r="45" />
              <text className="stamp-text">
                <textPath href="#tst-arc" textLength="356" lengthAdjust="spacing">Request received · thank you ·</textPath>
              </text>
              <path className="sig" d="M54 78 L68 92 L98 60" />
            </svg>
            <span className="mk">1</span>
          </div>
          <p className="pen-note t-pen">a real person reads every one</p>
          <svg className="wl t-wl draw" viewBox="0 0 620 520" aria-hidden="true">
            <path pathLength="1" d="M196 214 C 212 222, 224 234, 238 248" />
            <circle cx="238" cy="248" r="4" />
          </svg>
          <ol className="annot t-annot vh">
            <li><span className="n">1</span>A real person reads every one</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 2 · While you wait */
function WhileYouWait() {
  return (
    <section className="t-wait g-couch" aria-labelledby="wait-title">
      <div className="wrap grid12">
        <div className="t-wait-head">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>while the kettle boils</p>
          <h2 className="display-l" id="wait-title">While you wait</h2>
        </div>
        <figure className="print t-print deco" aria-hidden="true">
          <Drawing src="/clindesk/kettle-counter.svg" width={400} height={500} loading="lazy" decoding="async" />
          <span className="tape tape--coral print-tape" aria-hidden="true" />
        </figure>
        <ul className="t-cards">
          <li>
            <a className="t-card" href="/features">
              <span className="display-m">Features</span>
              <span className="t-card-line">The diary, notes, billing and the rest</span>
              <span className="arr" aria-hidden="true">→</span>
            </a>
          </li>
          <li>
            <a className="t-card" href="/reports">
              <span className="display-m">Referrer reports <span className="addon">Add-on</span></span>
              <span className="t-card-line">Reports, powered by ClinForms</span>
              <span className="arr" aria-hidden="true">→</span>
            </a>
          </li>
          <li>
            <a className="t-card" href="/switching">
              <span className="display-m">Switching</span>
              <span className="t-card-line">How the move from your current system works</span>
              <span className="arr" aria-hidden="true">→</span>
            </a>
          </li>
          <li>
            <a className="t-card" href="/security">
              <span className="display-m">Security</span>
              <span className="t-card-line">How we look after patient data</span>
              <span className="arr" aria-hidden="true">→</span>
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}
