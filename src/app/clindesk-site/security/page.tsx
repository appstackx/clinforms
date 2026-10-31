import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { CtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/security.css";

/**
 * ClinDesk website – /security (Security and data – how ClinDesk looks after patient data).
 * Ported from the approved design export Site-Security (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/security",
  title: `Security and data – how ${CLINIC_SYSTEM_NAME} looks after patient data`,
  description: `How ${CLINIC_SYSTEM_NAME} looks after patient data: hosting, encryption, audit trail, roles, signed notes, backups, DPA and retention.`,
});

export default function SecurityPage() {
  return (
    <SitePage current="/security">
      <Hero />
      <WhatProtectsYourData />
      <AuditTrail />
      <Documents />
      <CtaBand
        title="Bring your data protection lead"
        line="We’re happy to go through security and data protection with your DPO or IT lead before you sign."
        lineShort="We’ll go through security with your DPO or IT lead before you sign."
        rows={{ when: "before you sign", bring: "your DPO’s questions" }}
        extra={
          <p className="cta-price">
            Need a document first?{" "}
            <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Security%20documents`}>
              Request it by email <span className="arr" aria-hidden="true">→</span>
            </a>
          </p>
        }
      />
    </SitePage>
  );
}

/** 1 · Hero */
function Hero() {
  return (
    <section className="sc-hero g-ink on-dark" aria-labelledby="sc-title">
      <div className="wrap grid12">
        <div className="pg-copy">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>18:30 · lights off</p>
          <h1 className="display-xxl" id="sc-title">
            <span className="h1-line">Patient data, </span>
            <span className="h1-line">under lock </span>
            <span className="h1-line">
              <span className="hl">and key.<span className="tape tape--coral hl-tape" aria-hidden="true" /></span>
            </span>
          </h1>
          <p className="lead">
            <span className="t-long"><b>Clinical records are some of the most sensitive data a clinic holds.</b> Here’s how {CLINIC_SYSTEM_NAME} protects them, and what you can ask us for.</span>
            <span className="t-short"><b>Clinical records are some of the most sensitive data a clinic holds.</b> Here’s how we protect them.</span>
          </p>
          <div className="pg-ctas">
            <a className="btn btn-coral" href={`mailto:${CONTACT_EMAIL}?subject=Data%20processing%20agreement`}>Request our DPA <span className="arr" aria-hidden="true">→</span></a>
            {" "}
            <a className="btn btn-outline" href={`mailto:${CONTACT_EMAIL}?subject=Security%20question`}>Ask a question <span className="arr" aria-hidden="true">→</span></a>
          </div>
          <ul className="sc-badges" aria-label="Hosting and registration">
            <li>
              <span className="tb tb--sun" aria-hidden="true" />
              <Fill k="hosting.summary" />
            </li>
            <li>
              <span className="tb tb--sage" aria-hidden="true" />
              <Fill k="security.icoRegistration" />
            </li>
            <li>
              <span className="tb" aria-hidden="true" />
              <Fill k="security.certifications" />
            </li>
          </ul>
        </div>
        <div className="sc-hero-art">
          <div className="sc-drawer deco" aria-hidden="true">
            <div className="k7">
              <Drawing src="/clindesk/records-drawer.svg" width={360} height={340} decoding="async" />
              <span className="k7-label label">Signed</span>
            </div>
          </div>
          <div className="scene-box" role="img" aria-label="Role settings for a fictional clinic, Pebblegate Physio: reception can use the diary and payments but not clinical notes or reporting; the physio can use the diary and clinical notes; the Saturday locum sees clinical notes for their own patients at Abbey Road only; the practice manager can use the diary, payments and reporting but not clinical notes. Sample data, fictional.">
            <div className="product panel sc-roles">
              <div className="sc-roles-head">
                <b>Roles · who sees what</b>
                <span className="p-muted">Pebblegate Physio · Northgate, Abbey Road, Kingsmead</span>
              </div>
              <div className="sc-roles-row sc-roles-headrow">
                <span>Role</span>
                <span>Diary</span>
                <span>
                  <span className="t-long">Payments</span>
                  <span className="t-short">Pay</span>
                </span>
                <span>
                  <span className="t-long">Clinical notes</span>
                  <span className="t-short">Notes</span>
                </span>
                <span>
                  <span className="t-long">Reporting</span>
                  <span className="t-short">Reports</span>
                </span>
              </div>
              <div className="sc-roles-row">
                <span>
                  <b>Reception</b>
                  <span className="p-muted">Jo Barker</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
              </div>
              <div className="sc-roles-row sc-opt">
                <span>
                  <b>Physio</b>
                  <span className="p-muted">Sophie Marsh</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
              </div>
              <div className="sc-roles-row sc-roles-flag">
                <span>
                  <b>Saturday locum</b>
                  <span className="p-muted">Owen Price · Abbey Road only</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                  <span className="sc-own">own patients</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
                <span className="mk">1</span>
              </div>
              <div className="sc-roles-row">
                <span>
                  <b>Practice manager</b>
                  <span className="p-muted">Sam Whitley</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
                <span className="no">
                  <i />
                  <span className="vh">No access</span>
                </span>
                <span className="yes">
                  <i />
                  <span className="vh">Yes</span>
                </span>
              </div>
            </div>
            <p className="pen-note sc-hero-pen">set by role, site by site</p>
            <svg className="wl sc-hero-wl draw" viewBox="0 0 628 640" aria-hidden="true">
              <path pathLength="1" d="M491 514 C 506 512, 512 490, 520 470" />
              <circle cx="491" cy="514" r="4" />
            </svg>
            {" "}
            <span className="ftag sc-hero-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot sc-hero-annot vh">
            <li><span className="n">1</span>Set by role, site by site</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 2 · What protects your data */
function WhatProtectsYourData() {
  return (
    <section className="sc-locks g-couch" aria-labelledby="locks-title">
      <div className="wrap">
        <div className="sc-locks-head">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>the locks</p>
          <h2 className="display-l" id="locks-title">What protects your data</h2>
          <p className="body sc-desk">Eight things stand between a patient’s record and the wrong pair of eyes. Where a detail is still being confirmed, it’s marked in brackets.</p>
        </div>
        <ul className="sc-grid">
          <li>
            <span className="tb tb--teal" aria-hidden="true" />
            <h3 className="display-m">Hosting</h3>
            <p className="body">Your data is stored in <Fill k="security.region" />. <Fill k="security.hostingDetails" /></p>
          </li>
          <li>
            <span className="tb tb--sun" aria-hidden="true" />
            <h3 className="display-m">Encryption</h3>
            <p className="body">In transit: <Fill k="security.encryptionInTransit" />. At rest: <Fill k="security.encryptionAtRest" />.</p>
          </li>
          <li>
            <span className="tb" aria-hidden="true" />
            <h3 className="display-m">Full audit trail</h3>
            <p className="body">
              <span className="t-long">Every sign-in, view, change and signature is recorded – who, when and which site.</span>
              <span className="t-short">Every sign-in, view, change and signature is recorded.</span>
            </p>
          </li>
          <li>
            <span className="tb tb--teal" aria-hidden="true" />
            <h3 className="display-m">Roles and permissions</h3>
            <p className="body">
              <span className="t-long">Access is set by role and by site, so people see what their job needs.</span>
              <span className="t-short">Set by role and by site.</span>
            </p>
          </li>
          <li className="sc-signed">
            <span className="tb tb--sun" aria-hidden="true" />
            <h3 className="display-m">Signed, locked notes</h3>
            <p className="body">
              <span className="t-long">Notes lock when signed. Amendments are tracked and the original is kept.</span>
              <span className="t-short">Notes lock when signed; the original is kept.</span>
            </p>
            <div className="stamp sc-stamp" aria-hidden="true">
              <svg viewBox="0 0 140 140">
                <defs>
                  <path id="sc-arc" d="M70 70 m-53 0 a53 53 0 1 1 106 0 a53 53 0 1 1 -106 0" />
                  <mask id="sc-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="140" height="140">
                    <rect width="140" height="140" className="mask-on" />
                    <g className="mask-off">
                      <circle cx="22" cy="48" r="1.6" />
                      <circle cx="38" cy="22" r="1.2" />
                      <circle cx="64" cy="10" r="1.8" />
                      <circle cx="96" cy="18" r="1.3" />
                      <circle cx="118" cy="40" r="1.7" />
                      <circle cx="128" cy="76" r="1.2" />
                      <circle cx="112" cy="110" r="1.9" />
                      <circle cx="84" cy="126" r="1.3" />
                      <circle cx="50" cy="124" r="1.6" />
                      <circle cx="20" cy="98" r="1.2" />
                      <circle cx="56" cy="56" r="1.4" />
                      <circle cx="86" cy="62" r="1.1" />
                    </g>
                  </mask>
                </defs>
                <g mask="url(#sc-mask)">
                  <circle className="ring" cx="70" cy="70" r="66" />
                  <circle className="ring-thin" cx="70" cy="70" r="41" />
                  <text className="stamp-text">
                    <textPath href="#sc-arc" textLength="324" lengthAdjust="spacing">Signed &amp; locked · original kept ·</textPath>
                  </text>
                  <path className="sig" d="M44 82 C 47 62, 57 52, 60 61 C 62 70, 52 75, 48 70 M62 84 C 65 75, 71 71, 73 77 C 75 83, 70 86, 78 81 M80 79 C 84 71, 88 70, 90 74 C 92 79, 88 84, 97 78" />
                </g>
              </svg>
            </div>
          </li>
          <li>
            <span className="tb" aria-hidden="true" />
            <h3 className="display-m">Backups</h3>
            <p className="body"><Fill k="security.backupFrequency" />, kept for <Fill k="security.backupRetention" />, stored in <Fill k="security.region" />.</p>
          </li>
          <li>
            <span className="tb tb--teal" aria-hidden="true" />
            <h3 className="display-m">Data processing agreement</h3>
            <p className="body">A DPA is available to every customer. <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Data%20processing%20agreement`}>Request a copy</a></p>
          </li>
          <li>
            <span className="tb tb--sun" aria-hidden="true" />
            <h3 className="display-m">Retention</h3>
            <p className="body"><span className="t-long">Records are kept for the period you set, in line with</span><span className="t-short">Kept for the period you set, in line with</span> <Fill k="security.retentionGuidance" />. <Fill k="security.deletionProcess" /></p>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** 3 · Audit trail */
function AuditTrail() {
  return (
    <section className="sc-audit g-sun" aria-labelledby="audit-title">
      <div className="wrap grid12">
        <div className="sc-audit-text">
          <p className="pen marker" style={cssVars({"--tilt": "-1.5deg"})}>15:40 · Abbey Road</p>
          <h2 className="display-l" id="audit-title">See who did what, and when</h2>
          <p className="body">
            <span className="t-long">
              <b>If a patient, a referrer or a regulator asks, you can show exactly who opened, changed or signed a record.</b>
            </span>
            <span className="t-short">
              <b>Show exactly who opened, changed or signed a record.</b>
            </span>
          </p>
          <ul className="tb-list sc-audit-list">
            <li><span className="tb" aria-hidden="true" />Filter by person, action, record, site and date.</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Covers every site in the group.</li>
            <li>
              <span className="tb tb--sage" aria-hidden="true" />
              <span>Kept for <Fill k="security.auditRetention" />.</span>
            </li>
          </ul>
        </div>
        <div className="sc-audit-scene">
          <div className="scene-box" role="img" aria-label="One day in the audit trail for a fictional clinic, Tuesday 10/11/2026 across all sites, filtered to the patient record of Robert Hale: a note signed and locked at 09:58 and amended at 10:05 with the original kept, a report signed at 11:52, a receptionist at Abbey Road blocked from clinical notes at 15:40 because it is not in their role, and a £50.00 portal payment at 16:34. Sample data, fictional.">
            <div className="product audit">
              <div className="audit-title">
                <b>Audit trail · Tuesday 10/11/2026 · all sites</b>
              </div>
              <div className="audit-filters">
                <span className="on">Record: Robert Hale</span>
                <span>Person: anyone</span>
                <span>Site: all</span>
                <span>Date: 10/11/2026</span>
              </div>
              <div className="audit-row audit-headrow">
                <span>Time</span>
                <span>Who</span>
                <span>Action</span>
                <span>Record</span>
                <span>Site</span>
              </div>
              <div className="audit-row">
                <span className="num">09:58</span>
                <span>Sophie Marsh · Physio</span>
                <span>Signed &amp; locked note</span>
                <span>Robert Hale</span>
                <span>Northgate</span>
              </div>
              <div className="audit-row">
                <span className="num">10:05</span>
                <span>Sophie Marsh · Physio</span>
                <span>Amended note · original kept</span>
                <span>Robert Hale</span>
                <span>Northgate</span>
              </div>
              <div className="audit-row audit-opt">
                <span className="num">11:52</span>
                <span>Sophie Marsh · Physio</span>
                <span>Signed report</span>
                <span>Robert Hale</span>
                <span>Northgate</span>
              </div>
              <div className="audit-row audit-blocked">
                <span className="num">15:40</span>
                <span>Dan Hughes · Reception</span>
                <span>Tried to open clinical notes · <b>Blocked: not in role</b></span>
                <span>Robert Hale</span>
                <span>Abbey Road</span>
                <span className="mk">1</span>
              </div>
              <div className="audit-row">
                <span className="num">16:34</span>
                <span>Patient portal</span>
                <span>Payment £50.00</span>
                <span>Robert Hale</span>
                <span>–</span>
              </div>
            </div>
            <p className="pen-note sc-audit-pen">blocked, and still on the record</p>
            <svg className="wl sc-audit-wl draw" viewBox="0 0 900 460" aria-hidden="true">
              <path pathLength="1" d="M846 266 C 884 266, 886 330, 840 346" />
              <circle cx="846" cy="266" r="4" />
            </svg>
            {" "}
            <span className="ftag sc-audit-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot sc-audit-annot vh">
            <li><span className="n">1</span>Blocked, and still on the record</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 4 · Documents */
function Documents() {
  return (
    <section className="sc-docs g-blush" aria-labelledby="docs-title">
      <div className="wrap grid12">
        <div className="sc-docs-head">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>for your DPO</p>
          <h2 className="display-l" id="docs-title">Documents you can ask for</h2>
          <p className="body">For your data protection lead, your IT support or your own records.</p>
        </div>
        <figure className="print sc-box deco" aria-hidden="true">
          <Drawing src="/clindesk/records-box.svg" width={480} height={360} loading="lazy" decoding="async" />
          <span className="tape tape--teal print-tape" aria-hidden="true" />
        </figure>
        <ul className="sc-papers">
          <li>
            <div className="doc sc-paper">
              <p className="sc-paper-t">Data processing agreement</p>
              <i />
              <i />
              <i />
            </div>
            <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Data%20processing%20agreement`}>Request a copy <span className="arr" aria-hidden="true">→</span></a>
          </li>
          <li>
            <div className="doc sc-paper">
              <p className="sc-paper-t">
                <Fill k="security.overviewDocument" />
              </p>
              <i />
              <i />
              <i />
            </div>
            <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Security%20overview`}>Request a copy <span className="arr" aria-hidden="true">→</span></a>
          </li>
          <li>
            <div className="doc sc-paper">
              <p className="sc-paper-t">
                <Fill k="security.subProcessorsDocument" />
              </p>
              <i />
              <i />
              <i />
            </div>
            <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Sub-processors`}>Request a copy <span className="arr" aria-hidden="true">→</span></a>
          </li>
        </ul>
        <p className="sc-issue"><b>Found a security issue?</b> Email <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Security%20issue`}>{CONTACT_EMAIL}</a> and we’ll respond within <Fill k="security.issueResponseTime" />.</p>
      </div>
    </section>
  );
}
