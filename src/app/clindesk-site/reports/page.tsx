import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { CtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/reports.css";

/**
 * ClinDesk website – /reports (ClinDesk Reports – referrer reports in their own form, completed from your notes).
 * Ported from the approved design export Site-Reports (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/reports",
  title: `${CLINIC_SYSTEM_NAME} Reports – referrer reports in their own form, completed from your notes`,
  description: `${CLINIC_SYSTEM_NAME} Reports, powered by ClinForms: each referrer’s own report form, filled from your signed notes, checked and signed by the treating physio.`,
});

export default function ReportsPage() {
  return (
    <SitePage current="/reports">
      <Hero />
      <FactStrip />
      <HowItWorks />
      <FormsYoureSent />
      <TheirLayout />
      <CheckTheSource />
      <ThePhysiosSignature />
      <PortalAnswers />
      <CtaBand
        title="See Reports with a form you know"
        line="Bring a referrer form your team fills in often, and we’ll show you how it comes together from your notes."
        lineShort="Bring a form you fill in often. We’ll show you it filled from notes."
        rows={{ bring: "the form you fill in most" }}
        extra={
          <>
            <p className="cta-price">
              Reports is an add-on to any {CLINIC_SYSTEM_NAME} plan ·{" "}
              <a className="link" href="/pricing">
                See pricing <span className="arr" aria-hidden="true">→</span>
              </a>
            </p>
            <p className="cta-q rp-cf">
              Using a different practice system? {CLINFORMS_NAME} is also available on its own at{" "}
              <a className="link" href="https://clinforms.co.uk">
                clinforms.co.uk
              </a>
              .
            </p>
          </>
        }
      />
    </SitePage>
  );
}

/** 1 · Hero */
function Hero() {
  return (
    <section className="rp-hero g-sun" aria-labelledby="rp-title">
      <div className="wrap grid12">
        <div className="rp-hero-copy">
          <div className="lockup">
            <span className="display-m">{CLINIC_SYSTEM_NAME} Reports</span>
            <span className="lockup-sub">powered by ClinForms</span>
            <span className="addon addon--tilt">Add-on</span>
          </div>
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>11:40 · Sophie, an insurer’s form</p>
          <h1 className="display-xxl" id="rp-title">Their form, filled in from <span className="hl">your notes.<span className="tape tape--pink hl-tape" aria-hidden="true" /></span></h1>
          <p className="lead">
            <span className="t-long"><b>Insurers, medico-legal companies, case managers, solicitors and employers each want a different report.</b> Reports fills in their form from the notes already signed in {CLINIC_SYSTEM_NAME}, then waits for the treating physio to review, approve and sign.</span>
            <span className="t-short"><b>Every referrer wants their own form.</b> Reports fills it in from your signed notes, then waits for your signature.</span>
          </p>
          <div className="rp-ctas">
            <a className="btn btn-coral" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
            {" "}
            <a className="btn btn-outline" href="/pricing">See pricing <span className="arr" aria-hidden="true">→</span></a>
          </div>
          <p className="small rp-price">Add-on to any {CLINIC_SYSTEM_NAME} plan · <Fill k="reports.price" /></p>
        </div>
        <div className="rp-hero-art">
          <span className="rp-plane" aria-hidden="true" />
          <div className="rp-k9 deco" aria-hidden="true">
            <Drawing src="/clindesk/in-tray-clipboard.svg" width={560} height={440} decoding="async" />
          </div>
          <p className="pen-note rp-hero-pen" aria-hidden="true">the pile that used to go home</p>
          <svg className="wl rp-hero-wl draw" viewBox="0 0 628 640" aria-hidden="true">
            <path pathLength="1" d="M250 60 C 236 90, 222 112, 212 146" />
            <circle cx="212" cy="146" r="4" />
          </svg>
          <div className="rp-hero-scene" role="img" aria-label="A draft of Northway Health’s own progress report form for a fictional patient: 14 of 16 answers are filled from signed notes, each showing the note it came from, and 2 are left for the physio. Sample data, fictional.">
            <span className="tape tape--teal rp-hero-tape" aria-hidden="true" />
            <div className="product panel rp-draft">
              <div className="rp-draft-head">
                <b>Northway Health · Physiotherapy progress report</b>
                <span className="p-muted">Form PR-2 · Robert Hale · Auth NW-448210 · Draft</span>
              </div>
              <div className="rp-draft-row">
                <span>Presenting condition</span>
                <span className="p-chip">Note 20/10/2026</span>
              </div>
              <div className="rp-draft-row">
                <span>Progress to date</span>
                <span className="p-chip">Notes 20/10 + 10/11/2026</span>
              </div>
              <div className="rp-draft-row">
                <span>Further sessions requested</span>
                <span className="p-chip p-chip--need">Needs your input</span>
              </div>
              <div className="rp-draft-foot"><span className="bar"><i /></span>14 of 16 answers filled from notes · 2 need you</div>
            </div>
            <span className="ftag rp-hero-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 2 · Fact strip */
function FactStrip() {
  return (
    <section className="rp-facts g-pine on-dark" aria-label={`Three facts about ${CLINIC_SYSTEM_NAME} Reports`}>
      <div className="wrap">
        <ul className="rp-facts-list">
          <li><span className="tb tb--sun" aria-hidden="true" />Their layout, their questions</li>
          <li><span className="tb tb--sage" aria-hidden="true" />Every answer linked to a signed note</li>
          <li><span className="tb tb--sun" aria-hidden="true" />Nothing leaves without the physio’s signature</li>
        </ul>
      </div>
    </section>
  );
}

/** 3 · How it works */
function HowItWorks() {
  return (
    <section className="rp-steps g-couch" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>11:40 – 11:55 · one report, start to finish</p>
        <h2 className="display-l" id="how-title">From signed notes to a signed report</h2>
        <div className="rp-steps-box">
          <svg className="wl rp-steps-wl draw" viewBox="0 0 1280 120" aria-hidden="true">
            <path pathLength="1" d="M78 72 C 160 40, 250 104, 384 72 C 480 44, 560 102, 690 72 C 790 44, 870 104, 994 72" />
          </svg>
          <ol className="rp-steps-list">
            <li>
              <span className="pen rp-time">11:40</span>
              <span className="rp-n" aria-hidden="true">1</span>
              <h3 className="display-m">Choose the referrer’s form</h3>
              <p className="body">
                <span className="t-long">Pick the insurer, case manager or solicitor, and the form they’ve asked for.</span>
                <span className="t-short">Pick the referrer and the form they’ve asked for.</span>
              </p>
            </li>
            <li>
              <span className="pen rp-time">11:41</span>
              <span className="rp-n" aria-hidden="true">2</span>
              <h3 className="display-m">Answers come from your notes</h3>
              <p className="body">
                <span className="t-long">Each answer is filled in from the patient’s signed notes, in the referrer’s layout.</span>
                <span className="t-short">Filled in from signed notes, in their layout.</span>
              </p>
            </li>
            <li>
              <span className="pen rp-time">11:52</span>
              <span className="rp-n" aria-hidden="true">3</span>
              <h3 className="display-m">Review, edit and sign</h3>
              <p className="body">
                <span className="t-long">Check every answer against its source, fill any gaps, then approve and sign.</span>
                <span className="t-short">Check the sources, fill any gaps, then sign.</span>
              </p>
            </li>
            <li>
              <span className="pen rp-time">11:55</span>
              <span className="rp-n" aria-hidden="true">4</span>
              <h3 className="display-m">Download Word or PDF</h3>
              <p className="body">
                <span className="t-long">Send it the way the referrer prefers. The signed version stays on the patient record.</span>
                <span className="t-short">Send it their way. It stays on the record.</span>
              </p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 4 · Forms you're sent */
function FormsYoureSent() {
  return (
    <section className="rp-forms g-pine on-dark" id="forms" aria-labelledby="forms-title">
      <div className="wrap grid12">
        <div className="rp-forms-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>09:00 · the morning’s post</p>
          <h2 className="display-l" id="forms-title">Works with the forms you’re sent</h2>
          <p className="body">
            <span className="t-long"><b>Each referrer keeps their own form, and Reports keeps it too.</b> No retyping into a template of ours. It supports forms from:</span>
            <span className="t-short"><b>Each referrer keeps their own form.</b> Reports supports forms from:</span>
          </p>
          <dl className="rp-types">
            <div>
              <dt><span className="tb tb--sun" aria-hidden="true" />Insurers</dt>
              <dd>Initial, progress and discharge reports.</dd>
            </div>
            <div>
              <dt><span className="tb tb--sun" aria-hidden="true" />Medico-legal companies</dt>
              <dd>Reports in each company’s own format.</dd>
            </div>
            <div>
              <dt><span className="tb tb--sun" aria-hidden="true" />Case managers</dt>
              <dd>Progress updates and requests for further treatment.</dd>
            </div>
            <div>
              <dt><span className="tb tb--sun" aria-hidden="true" />Solicitors</dt>
              <dd>Reports on each firm’s own template.</dd>
            </div>
            <div>
              <dt><span className="tb tb--sun" aria-hidden="true" />Employers</dt>
              <dd>Occupational health and return-to-work updates.</dd>
            </div>
          </dl>
          <p className="small rp-forms-ph">
            <Fill k="reports.supportedForms" />
          </p>
        </div>
        <div className="rp-forms-scene">
          <div className="scene-box" role="img" aria-label="Five referrers’ own blank report forms: an insurer’s progress report, a medico-legal company’s expert report, a case manager’s rehabilitation report, a solicitor’s treatment report and an employer’s return-to-work update. Sample data, fictional.">
            <span className="tape tape--sun rp-forms-tape" aria-hidden="true" />
            <div className="rp-mini rp-mini--mlc doc">
              <div className="mh">BROOKFIELD MEDICO-LEGAL</div>
              <div className="mt">Expert physiotherapy report</div>
              <div className="mq">
                <span>1. History of the index event</span>
                <span>2. Examination findings</span>
              </div>
              <span className="product p-chip rp-type">Medico-legal</span>
            </div>
            <div className="rp-mini rp-mini--emp doc">
              <div className="mh">ASHBY FREIGHT LTD</div>
              <div className="mt">Return-to-work update</div>
              <div className="mq">
                <span>Duties the employee can do now</span>
                <span>Adjustments advised</span>
                <span>Expected return to full duties</span>
              </div>
              <span className="product p-chip rp-type">Employer</span>
            </div>
            <div className="rp-mini rp-mini--hm doc doc-hm">
              <div className="lh">HARTLEY &amp; MOSS SOLICITORS · Treatment report</div>
              <div className="ref">
                <span>Our ref HM/TR/0471</span>
                <span>Page 1</span>
              </div>
              <div className="mq">
                <span>1. Treatment provided to date</span>
                <span>2. Opinion on prognosis</span>
              </div>
              <span className="product p-chip rp-type">Solicitor</span>
            </div>
            <div className="rp-mini rp-mini--cm doc doc-calder">
              <div className="band">CALDER CASE MANAGEMENT<span>Rehabilitation progress report</span></div>
              <ol>
                <li><span className="box" />1. Sessions attended since the last report</li>
                <li><span className="box" />2. Current function at work</li>
                <li><span className="box" />3. Barriers to recovery</li>
              </ol>
              <span className="product p-chip rp-type">Case manager</span>
            </div>
            <div className="rp-mini rp-mini--ins doc">
              <div className="doc-org">NORTHWAY HEALTH</div>
              <div className="mt">Physiotherapy progress report</div>
              <div className="doc-meta">Form PR-2 · Page 1 of 2</div>
              <div className="mq">
                <span>Presenting condition</span>
                <span>Progress to date</span>
                <span>Further sessions requested</span>
              </div>
              <span className="product p-chip rp-type">Insurer</span>
            </div>
            <span className="ftag rp-forms-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 5 · Their layout */
function TheirLayout() {
  return (
    <section className="rp-layout g-cardboard" id="layout" aria-labelledby="layout-title">
      <div className="wrap grid12">
        <div className="rp-layout-scene">
          <div className="scene-box" role="img" aria-label="Calder Case Management’s own rehabilitation progress report, completed in their layout for a fictional patient: sessions attended in their table, answers under their questions, their tick boxes ticked and their signature block signed by the treating physio. Sample data, fictional.">
            <span className="tape tape--teal rp-layout-tape" aria-hidden="true" />
            <div className="rp-calder doc doc-calder">
              <div className="band">CALDER CASE MANAGEMENT<span>Rehabilitation progress report · Report 2</span></div>
              <div className="rp-cmeta">
                <span>Client: Robert Hale</span>
                <span>Case ref CCM-31882</span>
                <span>Report date 10/11/2026</span>
              </div>
              <div className="rp-q">
                <p className="rp-qh">1. Sessions attended since the last report</p>
                <table className="rp-ctable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Attended</th>
                      <th>Clinician</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>27/10/2026</td>
                      <td><svg className="tick" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg> Yes</td>
                      <td>S. Marsh</td>
                    </tr>
                    <tr>
                      <td>03/11/2026</td>
                      <td><svg className="tick" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg> Yes</td>
                      <td>S. Marsh</td>
                    </tr>
                    <tr>
                      <td>10/11/2026</td>
                      <td><svg className="tick" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg> Yes</td>
                      <td>S. Marsh</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="rp-q">
                <p className="rp-qh">2. Current function at work</p>
                <p className="rp-a">Light duties in the warehouse. Lifting to waist height; no overhead work yet.</p>
              </div>
              <div className="rp-q">
                <p className="rp-qh">3. Further treatment recommended?</p>
                <p className="rp-boxes">
                  <span><span className="box on" aria-hidden="true"><svg className="tick" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg></span> Yes</span>
                  <span><span className="box" aria-hidden="true" /> No</span>
                </p>
              </div>
              <div className="rp-csign">
                <span>Treating physiotherapist</span>
                <b>Sophie Marsh</b>
                <svg viewBox="0 0 120 40" aria-hidden="true">
                  <path d="M6 30 C 12 8, 24 4, 26 16 C 28 28, 16 30, 14 24 M30 32 C 34 20, 42 16, 44 24 C 46 32, 40 34, 50 28 M54 26 C 60 16, 66 16, 68 22 C 70 28, 64 32, 76 26 M80 14 C 80 26, 82 32, 84 36" />
                </svg>
                <span>10/11/2026</span>
              </div>
            </div>
            <div className="rp-dl">
              <span className="product p-chip">Word (.docx)</span>
              <span className="product p-chip">PDF</span>
            </div>
            <span className="ftag rp-layout-tag">Sample data (fictional)</span>
          </div>
        </div>
        <div className="rp-layout-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>11:41 · their layout, untouched</p>
          <h2 className="display-l" id="layout-title">The report arrives the way they asked for it</h2>
          <p className="body">
            <span className="t-long"><b>Referrers notice when a report isn’t on their form.</b> Reports keeps their layout, headings and question wording, so there’s nothing to reformat.</span>
            <span className="t-short"><b>Referrers notice when a report isn’t on their form.</b> Reports keeps their layout and wording.</span>
          </p>
          <ul className="rp-ticks">
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span><b>Word and PDF forms.</b> The referrer’s own file is the template.</span>
            </li>
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span><b>Their headings and question order.</b> Nothing is moved or renamed.</span>
            </li>
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span><b>Tick boxes, tables and signature blocks.</b> Completed where they expect them.</span>
            </li>
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span><b>Word or PDF download.</b> Whichever the referrer prefers.</span>
            </li>
          </ul>
          <p className="small rp-layout-ph">Adding a new referrer’s form: <Fill k="reports.newFormProcess" /></p>
        </div>
      </div>
    </section>
  );
}

/** 6 · Check the source */
function CheckTheSource() {
  return (
    <section className="rp-check g-sky" id="sources" aria-labelledby="check-title">
      <div className="wrap grid12">
        <div className="rp-check-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>11:46 · Sophie checks the sources</p>
          <h2 className="display-l" id="check-title">Check any answer against the note it came from</h2>
          <p className="body">
            <span className="t-long"><b>Select an answer to see the exact passage in the signed note, highlighted.</b> If the notes don’t cover a question, Reports says so rather than filling the gap.</span>
            <span className="t-short"><b>Select an answer to see its source, highlighted.</b> Gaps are left for you, never guessed.</span>
          </p>
          <ul className="rp-ticks">
            <li>
              <span className="tb" aria-hidden="true" />
              <span>Each answer is linked to its note, date and author.</span>
            </li>
            <li>
              <span className="tb" aria-hidden="true" />
              <span>Gaps are marked as needing the physio’s input.</span>
            </li>
            <li>
              <span className="tb" aria-hidden="true" />
              <span>Any answer can be edited before signing.</span>
            </li>
          </ul>
        </div>
        <div className="rp-check-scene">
          <div className="scene-box" role="img" aria-label="Northway Health’s progress report form in review for a fictional patient. The selected answer, presenting condition, is linked to the highlighted passage in the signed initial assessment of 20/10/2026. A further question is marked as needing the physio’s input. Sample data, fictional.">
            <span className="tape tape--coral rp-check-tape" aria-hidden="true" />
            <div className="rp-review doc doc-front">
              <div className="doc-org">NORTHWAY HEALTH</div>
              <div className="doc-title">Physiotherapy progress report</div>
              <div className="doc-meta">Form PR-2 · Robert Hale · In review</div>
              <div className="rp-rows">
                <div className="rp-row rp-sel">
                  <p className="rp-qh">Presenting condition</p>
                  <p>Right shoulder pain after lifting boxes at work, onset 06/10/2026. Pain 6/10 reaching overhead; disturbed sleep.</p>
                  <span className="product p-chip rp-chip-pres">Note 20/10/2026</span>
                  <span className="mk">1</span>
                </div>
                <div className="rp-row">
                  <p className="rp-qh">Progress to date</p>
                  <p>Session 4 of 6. Pain 3/10 reaching overhead; sleeping through most nights.</p>
                  <span className="product p-chip">Notes 20/10 + 10/11/2026</span>
                </div>
                <div className="rp-row">
                  <p className="rp-qh">Further sessions requested</p>
                  <span className="need">Needs your input</span>
                  <span className="mk">2</span>
                </div>
              </div>
            </div>
            <div className="product panel rp-src">
              <div className="src-head">
                <b>Initial assessment · 20/10/2026 · Sophie Marsh · Signed</b>
              </div>
              <div className="src-body">
                <p><span className="k">S</span><mark>R shoulder pain since lifting boxes at work 06/10/2026. 6/10 reaching overhead, wakes at night.</mark> Warehouse, now on light duties.</p>
                <p><span className="k">O</span>Flex 120°, abd 110°, painful arc 90–120°. ER strength 4/5.</p>
              </div>
              <div className="src-foot"><span className="lock"><svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>Locked</span>Sophie Marsh</div>
            </div>
            <p className="pen-note rp-check-pen">the bit only you know</p>
            <svg className="wl rp-check-wl draw" viewBox="0 0 737 530" aria-hidden="true">
              <path pathLength="1" d="M168 266 C 300 266, 380 240, 440 240" />
              <circle cx="168" cy="266" r="4" />
              <circle cx="440" cy="240" r="4" />
              <path pathLength="1" d="M494 492 C 468 492, 448 472, 426 467" />
              <circle cx="426" cy="466" r="4" />
            </svg>
            {" "}
            <span className="ftag rp-check-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot rp-check-annot vh">
            <li><span className="n">1</span>Presenting condition: linked to the signed initial assessment of 20/10/2026</li>
            <li><span className="n">2</span>Further sessions requested: the bit only you know</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 7 · The physio's signature */
function ThePhysiosSignature() {
  return (
    <section className="rp-sign g-ink on-dark" id="signature" aria-labelledby="sign-title">
      <div className="wrap grid12">
        <div className="rp-sign-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>11:52 · signed</p>
          <h2 className="display-l" id="sign-title">Nothing leaves without the physio’s signature</h2>
          <p className="body">
            <span className="t-long"><b>Every report starts as a draft, and only the treating physio can approve and sign it.</b> Once it’s signed, it’s locked.</span>
            <span className="t-short"><b>Every report starts as a draft.</b> Only the treating physio can approve and sign it.</span>
          </p>
          <ul className="rp-steps3">
            <li>
              <h3 className="rp-h3"><span className="tb tb--sun" aria-hidden="true" />A draft until approved</h3>
              <p className="body">Every report starts as a draft. The physio reviews and approves it.</p>
            </li>
            <li>
              <h3 className="rp-h3"><span className="tb tb--sun" aria-hidden="true" />Signed and locked</h3>
              <p className="body">Once signed, the report is locked and the signature is recorded in the audit trail.</p>
            </li>
            <li>
              <h3 className="rp-h3"><span className="tb tb--sun" aria-hidden="true" />You choose how it’s sent</h3>
              <p className="body">Download Word or PDF and send it the way the referrer asks. Reports doesn’t send anything itself.</p>
            </li>
          </ul>
        </div>
        <div className="rp-sign-scene">
          <div className="scene-box" role="img" aria-label="The history of a fictional patient’s Northway Health report: draft prepared at 11:41 with 14 of 16 answers from notes, two answers added by the physio at 11:49, approved at 11:51 and signed and locked at 11:52 by the treating physio, with Word and PDF downloads. Sample data, fictional.">
            <div className="product panel rp-status">
              <div className="rp-status-head">
                <b>Northway Health · PR-2 · Robert Hale</b>
                <span className="lock"><svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>Signed &amp; locked</span>
              </div>
              <ol className="rp-hist">
                <li>
                  <span className="num">11:41</span>
                  <span><b>Draft prepared</b> · 14 of 16 answers from signed notes</span>
                </li>
                <li>
                  <span className="num">11:49</span>
                  <span><b>2 answers added</b> · Sophie Marsh</span>
                </li>
                <li>
                  <span className="num">11:51</span>
                  <span><b>Approved</b> · Sophie Marsh, treating physio</span>
                </li>
                <li className="on">
                  <span className="num">11:52</span>
                  <span><b>Signed &amp; locked</b> · Sophie Marsh</span>
                </li>
              </ol>
              <div className="rp-status-foot">
                <span className="rp-btn">Download Word</span>
                <span className="rp-btn">Download PDF</span>
              </div>
            </div>
            <div className="stamp rp-sign-stamp" aria-hidden="true">
              <svg viewBox="0 0 150 150">
                <defs>
                  <path id="rps-arc" d="M75 75 m-58 0 a58 58 0 1 1 116 0 a58 58 0 1 1 -116 0" />
                  <mask id="rps-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="150" height="150">
                    <rect width="150" height="150" className="mask-on" />
                    <g className="mask-off">
                      <circle cx="24" cy="52" r="1.6" />
                      <circle cx="40" cy="22" r="1.3" />
                      <circle cx="70" cy="9" r="1.8" />
                      <circle cx="104" cy="18" r="1.2" />
                      <circle cx="128" cy="44" r="1.7" />
                      <circle cx="138" cy="82" r="1.2" />
                      <circle cx="120" cy="118" r="1.9" />
                      <circle cx="88" cy="136" r="1.3" />
                      <circle cx="52" cy="132" r="1.6" />
                      <circle cx="20" cy="104" r="1.2" />
                      <circle cx="60" cy="60" r="1.4" />
                      <circle cx="94" cy="66" r="1.1" />
                      <circle cx="78" cy="102" r="1.5" />
                    </g>
                  </mask>
                </defs>
                <g mask="url(#rps-mask)">
                  <circle className="ring" cx="75" cy="75" r="71" />
                  <circle className="ring-thin" cx="75" cy="75" r="45" />
                  <text className="stamp-text">
                    <textPath href="#rps-arc" textLength="356" lengthAdjust="spacing">Reviewed &amp; signed · S. Marsh · 10/11/2026 11:52 ·</textPath>
                  </text>
                  <path className="sig" d="M48 88 C 51 66, 61 56, 64 65 C 66 74, 56 79, 52 74 M66 90 C 69 81, 75 77, 77 83 C 79 89, 74 92, 82 87 M84 85 C 88 77, 92 76, 94 80 C 96 85, 92 90, 101 84 M103 70 C 103 80, 103 87, 105 92" />
                </g>
              </svg>
            </div>
            <p className="pen-note rp-sign-pen" aria-hidden="true">you send it, not us</p>
            <svg className="wl rp-sign-wl draw" viewBox="0 0 628 440" aria-hidden="true">
              <path pathLength="1" d="M306 386 C 290 360, 270 340, 266 312" />
              <circle cx="266" cy="312" r="4" />
            </svg>
            {" "}
            <span className="ftag rp-sign-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 8 · Portal answers */
function PortalAnswers() {
  return (
    <section className="rp-portal g-blush" id="portals" aria-labelledby="portal-title">
      <div className="wrap grid12">
        <div className="rp-portal-scene">
          <div className="scene-box" role="img" aria-label="Answers for a fictional patient prepared in the order Calder Case Management’s online portal asks for them, each with a copy button, approved by the treating physio at 11:52. One answer shows as copied. Sample data, fictional.">
            <div className="product panel rp-pp">
              <div className="rp-pp-head">
                <b>Portal answers · Calder Case Management</b>
                <span className="p-muted">Robert Hale · progress update · in the portal’s order</span>
                <span className="p-chip">Approved by Sophie Marsh · 11:52</span>
              </div>
              <div className="rp-pp-row">
                <div>
                  <span className="rp-pp-q">1 · Sessions attended since the last update</span>
                  <span>3 – on 27/10, 03/11 and 10/11/2026</span>
                </div>
                <span className="rp-copy">Copy</span>
              </div>
              <div className="rp-pp-row">
                <div>
                  <span className="rp-pp-q">2 · Current function at work</span>
                  <span>Light duties. Lifting to waist height; no overhead work yet.</span>
                </div>
                <span className="rp-copy rp-copied"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg>Copied</span>
              </div>
              <div className="rp-pp-row">
                <div>
                  <span className="rp-pp-q">3 · Further treatment recommended</span>
                  <span>Yes – the 2 remaining authorised sessions.</span>
                </div>
                <span className="rp-copy">Copy</span>
              </div>
              <div className="rp-pp-row">
                <div>
                  <span className="rp-pp-q">4 · Next review</span>
                  <span>17/11/2026</span>
                </div>
                <span className="rp-copy">Copy</span>
              </div>
            </div>
            <span className="ftag rp-portal-tag">Sample data (fictional)</span>
          </div>
        </div>
        <figure className="print rp-portal-print deco" aria-hidden="true">
          <Drawing src="/clindesk/kettle-counter.svg" width={400} height={500} loading="lazy" decoding="async" />
          <span className="tape tape--sun print-tape" aria-hidden="true" />
        </figure>
        <div className="rp-portal-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>12:10 · Calder’s portal, kettle on</p>
          <h2 className="display-l" id="portal-title">Portal answers, ready to copy</h2>
          <p className="body">
            <span className="t-long"><b>Some referrers want answers typed into their own online portal rather than a form.</b> Reports prepares each answer in the order the portal asks for it, with a copy button beside it.</span>
            <span className="t-short"><b>Some referrers use an online portal.</b> Each answer is ready to copy, in the portal’s order.</span>
          </p>
          <ul className="rp-ticks">
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span>Answers in the portal’s own order.</span>
            </li>
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span>Copy each answer with one click.</span>
            </li>
            <li>
              <span className="tb tb--teal" aria-hidden="true" />
              <span>Approved by the physio before anything is copied.</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
