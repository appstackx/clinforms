import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { CtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/switching.css";

/**
 * ClinDesk website – /switching (Switching to ClinDesk – we do the heavy lifting).
 * Ported from the approved design export Site-Switching (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/switching",
  title: `Switching to ${CLINIC_SYSTEM_NAME} – we do the heavy lifting`,
  description: `Switching to ${CLINIC_SYSTEM_NAME} from your current system: how the move works, a typical timeline, what comes across and go-live.`,
});

export default function SwitchingPage() {
  return (
    <SitePage current="/switching">
      <Hero />
      <HowTheMoveWorks />
      <ATypicalTimeline />
      <WhatComesAcross />
      <GoLiveDay />
      <CtaBand
        title="Tell us what you’re moving from"
        line="Tell us which system you use now and how many sites you have. We’ll explain what moves, what it involves and how long it takes."
        lineShort="Tell us what you use now and how many sites. We’ll explain what moves."
        rows={{ bring: "the system you use now" }}
        button="Talk to us about switching"
        extra={
          <p className="cta-price">
            Help switching comes with every plan ·{" "}
            <a className="link" href="/pricing">
              See pricing <span className="arr" aria-hidden="true">→</span>
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
    <section className="sw-hero g-cardboard" aria-labelledby="sw-title">
      <div className="wrap grid12">
        <div className="pg-copy">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>moving day</p>
          <h1 className="display-xxl" id="sw-title">
            <span className="h1-line">Switching? </span>
            <span className="h1-line">We carry </span>
            <span className="h1-line">
              <span className="hl">the boxes.<span className="tape tape--sun hl-tape" aria-hidden="true" /></span>
            </span>
          </h1>
          <p className="lead">
            <span className="t-long"><b>Changing system is a big decision for a busy clinic.</b> We plan the move with you, bring your data across from your current system, train your team and stay close until you’re settled.</span>
            <span className="t-short"><b>Changing system is a big decision.</b> We plan the move, bring your data across and train your team.</span>
          </p>
          <div className="pg-ctas">
            <a className="btn btn-coral" href="/demo">Talk to us about switching <span className="arr" aria-hidden="true">→</span></a>
            {" "}
            <a className="btn btn-outline" href="#how">See how the move works <span className="arr" aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="sw-hero-art">
          <span className="sw-plane deco" aria-hidden="true" />
          <div className="sw-trolley deco" aria-hidden="true">
            <Drawing src="/clindesk/sack-trolley.svg" width={440} height={500} decoding="async" />
          </div>
          <div className="scene-box" role="img" aria-label={`Trial import results for a fictional clinic, Pebblegate Physio, in a test copy of ${CLINIC_SYSTEM_NAME}: patients, appointments and notes moved across from the clinic’s current system, with 3 balances, 2 open authorisations and 48 custom fields – 53 records – left to check together. Sample data, fictional.`}>
            <div className="product panel sw-import">
              <div className="sw-imp-head">
                <b>Trial import · Pebblegate Physio</b>
                <span className="p-muted">Test copy · from your current system · 03/11/2026</span>
              </div>
              <div className="sw-imp-row sw-imp-headrow">
                <span>What came across</span>
                <span className="num">Records</span>
                <span>Status</span>
              </div>
              <div className="sw-imp-row">
                <span>Patients and contact details</span>
                <span className="num">4,186</span>
                <span>
                  <span className="st st-ok">Moved</span>
                </span>
              </div>
              <div className="sw-imp-row">
                <span>Appointments, past and future</span>
                <span className="num">58,302</span>
                <span>
                  <span className="st st-ok">Moved</span>
                </span>
              </div>
              <div className="sw-imp-row">
                <span>Notes, letters and documents</span>
                <span className="num">37,914</span>
                <span>
                  <span className="st st-ok">Moved</span>
                </span>
              </div>
              <div className="sw-imp-row">
                <span>Balances</span>
                <span className="num">212</span>
                <span>
                  <span className="st st-check">3 to check</span>
                </span>
              </div>
              <div className="sw-imp-row">
                <span>Open authorisations</span>
                <span className="num">46</span>
                <span>
                  <span className="st st-check">2 to check</span>
                </span>
              </div>
              <div className="sw-imp-row">
                <span>Custom fields</span>
                <span className="num">12</span>
                <span>
                  <span className="st st-check">48 to check</span>
                </span>
                <span className="mk">1</span>
              </div>
              <div className="sw-imp-foot">
                <b>53 records to check, together</b>
              </div>
            </div>
            <span className="tape tape--teal sw-imp-tape" aria-hidden="true" />
            <p className="pen-note sw-hero-pen">53 to check – and we check them with you</p>
            <svg className="wl sw-hero-wl draw" viewBox="0 0 628 640" aria-hidden="true">
              <path pathLength="1" d="M196 488 C 212 494, 214 526, 228 531" />
              <circle cx="228" cy="531" r="4" />
            </svg>
            {" "}
            <span className="ftag sw-hero-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot sw-hero-annot vh">
            <li><span className="n">1</span>53 to check – and we check them with you</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 2 · How the move works */
function HowTheMoveWorks() {
  return (
    <section className="sw-how g-couch" id="how" aria-labelledby="how-title">
      <div className="wrap grid12">
        <div className="sw-how-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>the plan</p>
          <h2 className="display-l" id="how-title">Five steps. One moving day.</h2>
          <p className="body">
            <span className="t-long"><b>We do the lifting; you check what lands.</b> Your data goes into a test copy of {CLINIC_SYSTEM_NAME} first, so nothing goes live until you’ve seen it and we’ve put right anything that’s off.</span>
            <span className="t-short"><b>We do the lifting; you check what lands.</b> Nothing goes live until you’ve seen it.</span>
          </p>
          <div className="k6">
            <Drawing src="/clindesk/moving-box.svg" width={360} height={300} loading="lazy" decoding="async" />
            {" "}
            <span className="k6-label pen" aria-hidden="true">PATIENTS · DIARY<br />NOTES · BALANCES</span>
          </div>
        </div>
        <div className="sw-how-ledger">
          <ol className="ledger">
            <li>
              <span className="ldg-n" aria-hidden="true">1</span>
              <div>
                <h3 className="display-m">Discovery call.</h3>
                <p className="body">We look at your current system, your sites and how your team actually works.</p>
              </div>
            </li>
            <li>
              <span className="ldg-n" aria-hidden="true">2</span>
              <div>
                <h3 className="display-m">Export.</h3>
                <p className="body">We help you request a full export from your current system.</p>
              </div>
            </li>
            <li>
              <span className="ldg-n" aria-hidden="true">3</span>
              <div>
                <h3 className="display-m">Map and trial import.</h3>
                <p className="body">We map your data to {CLINIC_SYSTEM_NAME} and import it into a test copy.</p>
              </div>
            </li>
            <li>
              <span className="ldg-n" aria-hidden="true">4</span>
              <div>
                <h3 className="display-m">Check together.</h3>
                <p className="body">You check patients, appointments and balances, and we put right anything that’s off.</p>
              </div>
            </li>
            <li>
              <span className="ldg-n" aria-hidden="true">5</span>
              <div>
                <h3 className="display-m">Final import and go-live.</h3>
                <p className="body">We move the latest data across just before you switch.</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 3 · A typical timeline */
function ATypicalTimeline() {
  return (
    <section className="sw-time g-sun" aria-labelledby="time-title">
      <div className="wrap">
        <div className="sw-time-head">
          <p className="pen marker" style={cssVars({"--tilt": "-1.5deg"})}>the calendar</p>
          <h2 className="display-l" id="time-title">A typical timeline</h2>
          <p className="body">
            <span className="t-long">Every clinic is different – it depends on your sites and how much data you have.</span>
            <span className="t-short">It depends on your sites and your data.</span>
            {" "}
            <Fill k="switching.timelineNote" />
          </p>
        </div>
        <ol className="sw-track">
          <li>
            <p className="sw-when pen">
              <Fill k="switching.whenDiscovery" />
            </p>
            <h3 className="display-m">Discovery and plan</h3>
            <p className="body">We agree what moves, when, and who does what.</p>
          </li>
          <li>
            <p className="sw-when pen">
              <Fill k="switching.whenTrialImport" />
            </p>
            <h3 className="display-m">Export and trial import</h3>
            <p className="body">Your data in a test copy of {CLINIC_SYSTEM_NAME}, ready to check.</p>
          </li>
          <li>
            <p className="sw-when pen">
              <Fill k="switching.whenTraining" />
            </p>
            <h3 className="display-m">Training</h3>
            <p className="body">Sessions for each role, using your own data.</p>
          </li>
          <li>
            <p className="sw-when pen">
              <Fill k="switching.whenGoLive" />
            </p>
            <h3 className="display-m">Final import and go-live</h3>
            <p className="body">The latest data moves across and your team starts.</p>
          </li>
          <li>
            <p className="sw-when pen">
              <Fill k="switching.whenSettlingIn" />
            </p>
            <h3 className="display-m">Settling in</h3>
            <p className="body">Both systems side by side while you check in with us.</p>
          </li>
        </ol>
      </div>
      <span className="tape tape--coral sw-time-tape" aria-hidden="true" />
    </section>
  );
}

/** 4 · What comes across */
function WhatComesAcross() {
  return (
    <section className="sw-what g-blush" aria-labelledby="what-title">
      <div className="wrap grid12">
        <div className="sw-what-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>unpacking</p>
          <h2 className="display-l" id="what-title">What usually comes across</h2>
          <ul className="tb-list">
            <li><span className="tb" aria-hidden="true" />Patients and contact details</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Appointments, past and future</li>
            <li><span className="tb tb--sun" aria-hidden="true" />Clinical notes, letters and documents</li>
            <li><span className="tb" aria-hidden="true" />Invoices, payments and balances</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Insurers, accounts and authorisations</li>
            <li><span className="tb tb--sun" aria-hidden="true" />Practitioners, rooms and rotas</li>
          </ul>
          <p className="small sw-what-ph">
            <Fill k="switching.whatMoves" />
          </p>
          <h3 className="display-m sw-what-h3 sw-desk">What we check with you</h3>
          <ul className="tb-list sw-desk">
            <li><span className="tb" aria-hidden="true" />Custom fields, templates and letter layouts</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Outstanding balances and open authorisations</li>
            <li><span className="tb tb--sun" aria-hidden="true" />Future appointments booked after the export</li>
          </ul>
        </div>
        <div className="sw-what-scene">
          <div className="scene-box" role="img" aria-label="The list of 53 records to check after a trial import for a fictional clinic: a balance that differs between the current system and the test copy, a balance split across two invoices, an open insurer authorisation with 2 sessions left, a future appointment booked after the export that moves at go-live, and 48 patients with a custom referral-source field to map. A stamp shows it was checked together on 03/11/2026. Sample data, fictional.">
            <div className="product panel sw-check">
              <div className="sw-chk-head">
                <b>Trial import · 53 records to check, together</b>
                <span className="p-muted">Test copy · checking with Jo Barker, Pebblegate Physio</span>
              </div>
              <div className="sw-chk-tabs">
                <span className="on">All 53</span>
                <span>Balances 3</span>
                <span>Authorisations 2</span>
                <span>Custom fields 48</span>
              </div>
              <div className="sw-chk-row sw-chk-flag">
                <span className="sw-chk-type">Balance</span>
                <span>
                  <b>Jane Fielding</b>
                  <span className="p-muted">£35.00 in your current system · £0.00 in the test copy</span>
                </span>
                <span>
                  <span className="st st-check">To check</span>
                </span>
                <span className="mk">1</span>
              </div>
              <div className="sw-chk-row sw-opt">
                <span className="sw-chk-type">Balance</span>
                <span>
                  <b>Callum Reid</b>
                  <span className="p-muted">£120.00 split across two invoices</span>
                </span>
                <span>
                  <span className="st st-ok">Checked · Jo</span>
                </span>
              </div>
              <div className="sw-chk-row">
                <span className="sw-chk-type">Authorisation</span>
                <span>
                  <b>Robert Hale</b>
                  <span className="p-muted">Northway Health NW-448210 · 2 sessions left</span>
                </span>
                <span>
                  <span className="st st-ok">Checked · Jo</span>
                </span>
              </div>
              <div className="sw-chk-row sw-opt">
                <span className="sw-chk-type">Appointment</span>
                <span>
                  <b>Lucy Barnes</b>
                  <span className="p-muted">Thu 12/11/2026 08:30 · booked after the export</span>
                </span>
                <span>
                  <span className="st st-move">Moves at go-live</span>
                </span>
              </div>
              <div className="sw-chk-row">
                <span className="sw-chk-type">Custom field</span>
                <span>
                  <b>Referral source</b>
                  <span className="p-muted">48 patients · map to a {CLINIC_SYSTEM_NAME} field</span>
                </span>
                <span>
                  <span className="st st-check">To check</span>
                </span>
              </div>
            </div>
            <div className="stamp sw-stamp" aria-hidden="true">
              <svg viewBox="0 0 140 140">
                <defs>
                  <path id="sw-arc" d="M70 70 m-53 0 a53 53 0 1 1 106 0 a53 53 0 1 1 -106 0" />
                  <mask id="sw-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="140" height="140">
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
                      <circle cx="72" cy="94" r="1.5" />
                    </g>
                  </mask>
                </defs>
                <g mask="url(#sw-mask)">
                  <circle className="ring" cx="70" cy="70" r="66" />
                  <circle className="ring-thin" cx="70" cy="70" r="41" />
                  <text className="stamp-text">
                    <textPath href="#sw-arc" textLength="324" lengthAdjust="spacing">Checked together · 03/11/2026 · J. Barker ·</textPath>
                  </text>
                  <path className="sig" d="M46 80 C 50 60, 62 54, 62 66 C 62 78, 50 84, 52 72 M66 82 C 70 72, 76 70, 78 76 C 80 82, 74 86, 84 80 M86 78 C 90 70, 94 68, 96 74 C 98 80, 94 84, 102 78" />
                </g>
              </svg>
            </div>
            <p className="pen-note sw-what-pen">the odd one out – we find it with you</p>
            <svg className="wl sw-what-wl draw" viewBox="0 0 760 520" aria-hidden="true">
              <path pathLength="1" d="M26 64 C 12 140, 18 222, 44 238" />
              <circle cx="44" cy="238" r="4" />
            </svg>
            {" "}
            <span className="ftag sw-what-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot sw-what-annot vh">
            <li><span className="n">1</span>The odd one out – we find it with you</li>
          </ol>
          <p className="small sw-what-small">What can move depends on what your current system can export. We’ll confirm it with you on the discovery call, before you commit.</p>
        </div>
      </div>
    </section>
  );
}

/** 5 · Go-live day */
function GoLiveDay() {
  return (
    <section className="sw-live g-pine on-dark" aria-labelledby="live-title">
      <div className="wrap grid12">
        <div className="sw-live-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>go-live day</p>
          <h2 className="display-xl" id="live-title">No rush on go-live day.</h2>
          <div className="sw-live-item">
            <h3 className="display-m">Run both systems side by side</h3>
            <p className="body"><span className="t-long">Keep your current system available while your team settles in, so nobody is rushed and you can look things up as you go:</span><span className="t-short">Your current system stays to hand while everyone settles:</span> <Fill k="switching.oldSystemAccess" />.</p>
          </div>
          <div className="sw-live-item">
            <h3 className="display-m">Training for every role</h3>
            <p className="body"><span className="t-long">Reception, clinicians and managers each learn the bits they use, with your own data in the test copy.</span><span className="t-short">Each role learns the bits they use, with your own data.</span> Format: <Fill k="switching.trainingFormat" />.</p>
          </div>
        </div>
        <div className="sw-live-scene">
          <div className="scene-box" role="img" aria-label="A training plan for a fictional clinic using its own data in the test copy: reception learns the diary, booking, messages and payments; clinicians learn notes, letters and Reports; the practice manager learns reporting, rotas, roles and billing. Sample data, fictional.">
            <div className="product panel sw-train">
              <div className="sw-chk-head">
                <b>Training · Pebblegate Physio</b>
                <span className="p-muted">Using your own data, in the test copy</span>
              </div>
              <div className="sw-train-row">
                <span className="sw-role sw-role--rec">Reception</span>
                <span>
                  <b>Jo Barker, Dan Hughes</b>
                  <span className="p-muted">Diary, booking, messages and payments</span>
                </span>
              </div>
              <div className="sw-train-row">
                <span className="sw-role sw-role--cli">Clinicians</span>
                <span>
                  <b>Sophie Marsh, Tom Ellis, Hannah Doyle</b>
                  <span className="p-muted">Notes, letters and Reports</span>
                </span>
              </div>
              <div className="sw-train-row">
                <span className="sw-role sw-role--man">Managers</span>
                <span>
                  <b>Sam Whitley</b>
                  <span className="p-muted">Reporting, rotas, roles and billing</span>
                </span>
              </div>
            </div>
            <span className="ftag sw-live-tag">Sample data (fictional)</span>
          </div>
          <figure className="print sw-kettle deco" aria-hidden="true">
            <Drawing src="/clindesk/kettle-counter.svg" width={400} height={500} loading="lazy" decoding="async" />
            <span className="tape tape--sun print-tape" aria-hidden="true" />
          </figure>
          <p className="pen-note sw-live-pen">kettle on – nobody’s rushed</p>
        </div>
      </div>
    </section>
  );
}
