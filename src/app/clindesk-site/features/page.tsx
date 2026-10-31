import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { CtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/features.css";

/**
 * ClinDesk website – /features (Features – ClinDesk).
 * Ported from the approved design export Site-Features (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/features",
  title: `Features – ${CLINIC_SYSTEM_NAME}`,
  description: `${CLINIC_SYSTEM_NAME} features: diary, notes and letters, billing and insurers, reminders, patient portal, reporting, multi-site groups and the Reports add-on.`,
});

export default function FeaturesPage() {
  return (
    <SitePage current="/features">
      <Hero />
      <OnThisPage />
      <Diary />
      <NotesAndLetters />
      <Billing />
      <RemindersAndPortal />
      <Reporting />
      <Groups />
      <ReportsAddOn />
      <BehindTheScenes />
      <CtaBand
        title="See it with your clinic in mind"
        line="We’ll set up a demo around your sites, your team and the referrers you work with. Online, at a time that suits you."
        lineShort="A demo set up around your sites, your team and your referrers."
      />
    </SitePage>
  );
}

/** 1 · Hero */
function Hero() {
  return (
    <section className="fxh g-sky" aria-labelledby="fx-title">
      <div className="wrap grid12 fxh-grid">
        <div className="fxh-copy">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>07:58 · keys in the door at Northgate</p>
          <h1 className="display-xxl" id="fx-title">
            <span className="h1-line">Everything </span>
            <span className="h1-line">your clinic </span>
            <span className="h1-line">
              <span className="hl">runs on.<span className="tape tape--sun hl-tape" aria-hidden="true" /></span>
            </span>
          </h1>
          <p className="lead">
            <span className="t-long"><b>Diary, notes, billing, reminders, a patient portal, reporting and multi-site admin – all sharing one patient record.</b> Add Reports when you want referrers’ own forms filled in from the notes you’ve already signed.</span>
            <span className="t-short"><b>Everything shares one patient record.</b> Add Reports for referrer forms filled from your signed notes.</span>
          </p>
          <div className="hero-ctas">
            <a className="btn btn-coral" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
            {" "}
            <a className="btn btn-outline" href="/pricing">See pricing <span className="arr" aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="fxh-art">
          <figure className="print fxh-print" aria-hidden="true">
            <Drawing src="/clindesk/reception-desk.svg" width={600} height={400} decoding="async" />
            <span className="tape tape--teal print-tape" aria-hidden="true" />
          </figure>
          <div className="fxh-scene" role="img" aria-label="Today at the Northgate site, Tuesday 10/11/2026: 38 appointments across 3 rooms, 4 booked online overnight, 9 intake forms completed and 2 invoices waiting. Sample data, fictional.">
            <div className="product fxh-today">
              <div className="ft-head">
                <b>Today · Tuesday 10/11/2026</b>
                <span className="p-muted">Northgate</span>
              </div>
              <div className="ft-row">
                <span>Appointments</span>
                <b className="num">38</b>
              </div>
              <div className="ft-row">
                <span>Rooms in use</span>
                <b className="num">3 of 3</b>
              </div>
              <div className="ft-row">
                <span>Booked online overnight</span>
                <b className="num">4</b>
              </div>
              <div className="ft-row">
                <span>Intake forms completed</span>
                <b className="num">9</b>
              </div>
              <div className="ft-row">
                <span>Invoices waiting</span>
                <b className="num">2</b>
              </div>
            </div>
            <span className="ftag fxh-tag">Sample data (fictional)</span>
            <p className="pen-note fxh-pen" aria-hidden="true">all of it, before the first patient</p>
            <svg className="wl fxh-wl draw" viewBox="0 0 628 560" aria-hidden="true">
              <path pathLength="1" d="M196 406 C 220 402, 240 396, 266 390" />
              <circle cx="266" cy="390" r="4" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 2 · On this page */
function OnThisPage() {
  return (
    <section className="fx-index g-pine on-dark" aria-label="On this page">
      <div className="wrap">
        <nav aria-label="Features on this page">
          <ul className="fxi-list">
            <li>
              <a href="#diary">Diary</a>
            </li>
            <li>
              <span className="tb tb--sun" aria-hidden="true" />
              <a href="#notes">Notes and letters</a>
            </li>
            <li>
              <span className="tb tb--sage" aria-hidden="true" />
              <a href="#billing">Billing</a>
            </li>
            <li>
              <span className="tb tb--sun" aria-hidden="true" />
              <a href="#reminders">Reminders</a>
            </li>
            <li>
              <span className="tb tb--sage" aria-hidden="true" />
              <a href="#portal">Patient portal</a>
            </li>
            <li>
              <span className="tb tb--sun" aria-hidden="true" />
              <a href="#reporting">Reporting</a>
            </li>
            <li>
              <span className="tb tb--sage" aria-hidden="true" />
              <a href="#groups">Groups</a>
            </li>
            <li>
              <span className="tb tb--sun" aria-hidden="true" />
              <a href="#reports">Referrer reports <span className="addon">Add-on</span></a>
            </li>
            <li>
              <span className="tb tb--sage" aria-hidden="true" />
              <a href="#admin">Behind the scenes</a>
            </li>
          </ul>
        </nav>
      </div>
    </section>
  );
}

/** 3 · 08:30 Diary */
function Diary() {
  return (
    <section className="fx fx-diary g-couch" id="diary" aria-labelledby="diary-title">
      <div className="wrap grid12">
        <div className="fx-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>08:30 · Jo, front desk</p>
          <h2 className="display-l" id="diary-title">Every room, every rota, one diary</h2>
          <p className="body fx-lead">
            <span className="t-long"><b>See practitioners, rooms and sites side by side, or filter to just one.</b> Set rotas once and the diary shows who is working where.</span>
            <span className="t-short"><b>Practitioners, rooms and sites side by side.</b> Rotas set once.</span>
          </p>
          <ul className="fx-points">
            <li><span className="tb" aria-hidden="true" />Rooms are booked with the appointment, so clashes show straight away.</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Patients book online at times you choose to open.</li>
          </ul>
        </div>
        <div className="fx-scene">
          <div className="scene-box" role="img" aria-label={`${CLINIC_SYSTEM_NAME} diary for Wednesday 11/11/2026 at Abbey Road by room: Room 1 with Emma Clarke, Room 2 with Marcus Webb, and the gym with Owen Price, who is on the rota from 12:00. A booking into Room 2 at 10:45 is flagged as a clash, and an online booking made at 06:41 is shown. Sample data, fictional.`}>
            <div className="product dpanel fxd-panel">
              <div className="dp-head">
                <b>Wednesday 11/11/2026 · Abbey Road · Rooms</b>
                <span className="dp-seg">
                  <span>Rooms</span>
                  <span>People</span>
                </span>
              </div>
              <div className="fxd-rota">
                <span className="fxd-rl">Rota</span>
                <span>Emma Clarke 08:00–16:00</span>
                <span>Marcus Webb 09:00–17:00</span>
                <span>Owen Price 12:00–20:00</span>
              </div>
              <div className="dp-cols">
                <span />
                <span>Room 1 · Emma Clarke</span>
                <span>Room 2 · Marcus Webb</span>
                <span>Gym · Owen Price</span>
              </div>
              <div className="dp-grid">
                <div className="dp-times">
                  <span style={cssVars({"--s": "0"})}>09:00</span>
                  <span style={cssVars({"--s": "30"})}>09:30</span>
                  <span style={cssVars({"--s": "60"})}>10:00</span>
                  <span style={cssVars({"--s": "90"})}>10:30</span>
                  <span style={cssVars({"--s": "120"})}>11:00</span>
                  <span style={cssVars({"--s": "150"})}>11:30</span>
                </div>
                <div className="dp-col">
                  <div className="blk blk--self" style={cssVars({"--s": "0", "--d": "45"})}>
                    <span className="bt">09:00 · Self-pay</span>
                    <b>Jane Fielding</b>
                    <span>Follow-up</span>
                  </div>
                  <div className="blk blk--ins" style={cssVars({"--s": "60", "--d": "60"})}>
                    <span className="bt">10:00 · Insurer</span>
                    <b>Callum Reid</b>
                    <span>Initial assessment</span>
                  </div>
                  <div className="blk blk--self fx-opt" style={cssVars({"--s": "135", "--d": "45"})}>
                    <span className="bt">11:15 · Self-pay</span>
                    <b>Mia Calloway</b>
                    <span>Follow-up</span>
                  </div>
                </div>
                <div className="dp-col">
                  <div className="blk blk--cm" style={cssVars({"--s": "30", "--d": "45"})}>
                    <span className="bt">09:30 · Case management</span>
                    <b>Isla Moreton</b>
                    <span>Follow-up</span>
                  </div>
                  <div className="blk blk--self" style={cssVars({"--s": "90", "--d": "45"})}>
                    <span className="bt">10:30 · Self-pay</span>
                    <b>Grace Lowe</b>
                    <span>Follow-up</span>
                  </div>
                </div>
                <div className="dp-col">
                  <div className="blk blk--admin" style={cssVars({"--s": "0", "--d": "180"})}>
                    <svg aria-hidden="true">
                      <defs>
                        <pattern id="fx-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="2.5" height="8" className="hatch-line" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#fx-hatch)" />
                    </svg>
                    <span>Not on the rota until 12:00</span>
                  </div>
                </div>
                <i className="dp-rule" style={cssVars({"--s": "0"})} />
                <i className="dp-rule" style={cssVars({"--s": "30"})} />
                <i className="dp-rule" style={cssVars({"--s": "60"})} />
                <i className="dp-rule" style={cssVars({"--s": "90"})} />
                <i className="dp-rule" style={cssVars({"--s": "120"})} />
                <i className="dp-rule" style={cssVars({"--s": "150"})} />
              </div>
            </div>
            <div className="product frag fxd-clash">
              <b>Clash · Room 2 at 10:45</b>
              <span>Grace Lowe is booked in Room 2 until 11:15</span>
              <span className="mk">1</span>
            </div>
            <div className="product frag fxd-online fx-opt">
              <span className="av">LF</span>
              <div>
                <b>Booked online · Leo Fairbank</b>
                <span>Follow-up with Emma Clarke · Thu 12/11/2026 09:00 · Abbey Road · booked 06:41</span>
              </div>
            </div>
            <span className="ftag fxd-tag">Sample data (fictional)</span>
            <p className="pen-note fxd-pen">clash caught at booking, not at the door</p>
            <svg className="wl fxd-wl draw" viewBox="0 0 733 470" aria-hidden="true">
              <path pathLength="1" d="M524 412 C 528 402, 536 394, 546 388" />
              <circle cx="546" cy="388" r="4" />
            </svg>
          </div>
          <ol className="annot fx-annot vh">
            <li><span className="n">1</span>Clash caught at booking, not at the door</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 4 · 09:58 Notes and letters */
function NotesAndLetters() {
  return (
    <section className="fx fx-notes fx--flip g-pine on-dark" id="notes" aria-labelledby="notes-title">
      <div className="wrap grid12">
        <div className="fx-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>11:02 · Sophie, room 1</p>
          <h2 className="display-l" id="notes-title">Notes you can stand behind</h2>
          <p className="body fx-lead">
            <span className="t-long"><b>Signed notes lock.</b> Change one later and the amendment is tracked – who, when and why – with the original kept underneath.</span>
            <span className="t-short"><b>Signed notes lock.</b> Amendments are tracked and the original is kept.</span>
          </p>
          <ul className="fx-points">
            <li><span className="tb tb--sun" aria-hidden="true" />Letters and templates for assessments, progress and discharge, filled from the record.</li>
            <li><span className="tb tb--sage" aria-hidden="true" />Intake forms that patients complete before they arrive.</li>
            <li><span className="tb tb--sun" aria-hidden="true" />One record for each patient, across every site.</li>
          </ul>
        </div>
        <div className="fx-scene">
          <div className="scene-box" role="img" aria-label="An initial assessment note for a fictional patient, signed and locked at 11:02, with an amendment at 11:40 that changes the review date while keeping the original. A letter to the GP, an intake form and a discharge summary template sit beside it. Sample data, fictional.">
            <div className="product note-panel fxn-panel">
              <div className="np-head">
                <b>Initial assessment · 10/11/2026 10:15</b>
                <span className="p-muted">Leo Fairbank · Sophie Marsh, Room 1, Northgate</span>
              </div>
              <dl className="soap">
                <div>
                  <dt>S</dt>
                  <dd>Low back pain after gardening, two weeks. 5/10 bending forward.</dd>
                </div>
                <div>
                  <dt>O</dt>
                  <dd>Flexion to knees, extension full. SLR negative both sides.</dd>
                </div>
                <div>
                  <dt>A</dt>
                  <dd>Mechanical low back pain. No red flags.</dd>
                </div>
                <div>
                  <dt>P</dt>
                  <dd>Advice, graded walking. Review 17/11/2026.</dd>
                </div>
              </dl>
              <div className="np-foot">
                <span className="lock"><svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>Locked</span>
                <span>Signed &amp; locked · 10/11/2026 11:02 · Sophie Marsh</span>
              </div>
            </div>
            <div className="product slip fxn-slip fxn-s1">Letter to GP · ready to sign</div>
            <div className="product slip fxn-slip fxn-s2">Intake form · Lucy Barnes · completed 09/11/2026</div>
            <div className="product slip fxn-slip fxn-s3">Discharge summary · template</div>
            <div className="stamp fxn-stamp" aria-hidden="true">
              <svg viewBox="0 0 140 140">
                <defs>
                  <path id="fxst1-arc" d="M70 70 m-53 0 a53 53 0 1 1 106 0 a53 53 0 1 1 -106 0" />
                  <mask id="fxst1-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="140" height="140">
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
                      <circle cx="44" cy="84" r="1" />
                      <circle cx="100" cy="88" r="1.2" />
                    </g>
                  </mask>
                </defs>
                <g mask="url(#fxst1-mask)">
                  <circle className="ring" cx="70" cy="70" r="66" />
                  <circle className="ring-thin" cx="70" cy="70" r="41" />
                  <text className="stamp-text">
                    <textPath href="#fxst1-arc" textLength="324" lengthAdjust="spacing">Signed &amp; locked · 10/11/2026 · S. Marsh ·</textPath>
                  </text>
                  <path className="sig" d="M44 82 C 47 62, 57 52, 60 61 C 62 70, 52 75, 48 70 M62 84 C 65 75, 71 71, 73 77 C 75 83, 70 86, 78 81 M80 79 C 84 71, 88 70, 90 74 C 92 79, 88 84, 97 78 M99 64 C 99 74, 99 81, 101 86" />
                </g>
              </svg>
            </div>
            <div className="product frag amend fxn-amend"><b>Amendment 1</b> · 10/11/2026 11:40 · S. Marsh — Plan: review <s>24/11/2026</s> 17/11/2026 · original kept<span className="mk">1</span></div>
            <span className="ftag fxn-tag">Sample data (fictional)</span>
            <p className="pen-note fxn-pen">the original stays underneath</p>
            <svg className="wl fxn-wl draw" viewBox="0 0 737 470" aria-hidden="true">
              <path pathLength="1" d="M522 414 C 504 414, 488 406, 472 400" />
              <circle cx="472" cy="400" r="4" />
            </svg>
          </div>
          <ol className="annot fx-annot vh">
            <li><span className="n">1</span>The original stays underneath</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 5 · 12:10 Billing */
function Billing() {
  return (
    <section className="fx fx-billing g-blush" id="billing" aria-labelledby="billing-title">
      <div className="wrap grid12">
        <div className="fx-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>12:10 · Jo, between patients</p>
          <h2 className="display-l" id="billing-title">Paid by patients, insurers and accounts</h2>
          <p className="body fx-lead">
            <span className="t-long"><b>Invoice self-pay patients, insurers, and case-management or medico-legal accounts from the same appointment.</b> See what’s outstanding, by payer.</span>
            <span className="t-short">
              <b>Invoice patients, insurers and accounts from one appointment.</b>
            </span>
          </p>
          <ul className="fx-points">
            <li><span className="tb" aria-hidden="true" />Authorisations tracked: sessions approved, used and left.</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Card payments at the desk or in the patient portal.</li>
          </ul>
        </div>
        <div className="fx-scene">
          <div className="scene-box" role="img" aria-label="Outstanding invoices by payer across all sites on 10/11/2026, totalling £1,860.00, an insurer authorisation with 4 of 6 sessions used, and a £55.00 card payment approved at 12:08. Sample data, fictional.">
            <div className="product fxb-panel">
              <div className="fxb-head">
                <b>Outstanding by payer</b>
                <span className="p-muted">All sites · 10/11/2026</span>
              </div>
              <div className="fxb-row fxb-hrow">
                <span>Payer</span>
                <span className="num">Invoices</span>
                <span className="num">Outstanding</span>
              </div>
              <div className="fxb-row">
                <span>Self-pay patients</span>
                <span className="num">6</span>
                <span className="num">£330.00</span>
              </div>
              <div className="fxb-row">
                <span>Northway Health</span>
                <span className="num">4</span>
                <span className="num">£760.00</span>
              </div>
              <div className="fxb-row">
                <span>Calder Case Management</span>
                <span className="num">2</span>
                <span className="num">£420.00</span>
              </div>
              <div className="fxb-row">
                <span>Hartley &amp; Moss Solicitors</span>
                <span className="num">1</span>
                <span className="num">£350.00</span>
              </div>
              <div className="fxb-row fxb-total">
                <span>All payers</span>
                <span className="num">13</span>
                <span className="num">£1,860.00</span>
              </div>
            </div>
            <div className="product frag fxb-auth">
              <b>Authorisation NW-448210</b>
              <span className="p-muted">Robert Hale · Northway Health</span>
              {" "}
              <span className="fxb-dots" aria-hidden="true">
                <i className="on" />
                <i className="on" />
                <i className="on" />
                <i className="on" />
                <i />
                <i />
              </span>
              {" "}
              <span><b>4 of 6</b> sessions used · 2 left</span>
            </div>
            <div className="product fxb-paid fx-opt">
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 6.5 5 9l4.5-5.5" />
              </svg>
              <span>Card payment · Mia Calloway · £55.00 · approved 12:08</span>
            </div>
            <span className="ftag fxb-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 6 · 15:00 Reminders and 16:34 Portal */
function RemindersAndPortal() {
  return (
    <section className="fx-duo g-cardboard" aria-label="Reminders and the patient portal">
      <div className="wrap grid12">
        <article className="fxr" id="reminders" aria-labelledby="reminders-title">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>15:00 · tomorrow’s reminders go out</p>
          <h2 className="display-l" id="reminders-title">Reminders, without the ring-round</h2>
          <p className="body fx-lead">
            <b>Appointment reminders by <Fill k="features.reminderChannels" />, sent when you choose.</b>
            <span className="t-long"> Every message is saved to the patient record.</span>
          </p>
          <ul className="fx-points">
            <li><span className="tb" aria-hidden="true" />Templates for confirmations, changes, intake forms and follow-ups.</li>
          </ul>
          <div className="fxr-scene">
            <div className="scene-box" role="img" aria-label="Messages sent at 15:00 on Tuesday 10/11/2026: reminders for four of Wednesday’s Abbey Road patients and an intake form, each saved to the patient’s record. Sample data, fictional.">
              <div className="product fxr-panel">
                <div className="fxr-head">
                  <b>Messages · Tuesday 10/11/2026</b>
                  <span className="fxr-rule">Rule: day before, 15:00</span>
                </div>
                <div className="fxr-row">
                  <span className="num">15:00</span>
                  <span><b>Reminder</b> · Jane Fielding · Wed 09:00</span>
                  <span className="fxr-ok">Sent</span>
                </div>
                <div className="fxr-row">
                  <span className="num">15:00</span>
                  <span><b>Reminder</b> · Isla Moreton · Wed 09:30</span>
                  <span className="fxr-ok">Sent</span>
                </div>
                <div className="fxr-row fx-opt">
                  <span className="num">15:00</span>
                  <span><b>Intake form</b> · Callum Reid · Wed 10:00</span>
                  <span className="fxr-ok">Sent</span>
                </div>
                <div className="fxr-row fx-opt">
                  <span className="num">15:00</span>
                  <span><b>Reminder</b> · Grace Lowe · Wed 10:30</span>
                  <span className="fxr-ok">Sent</span>
                </div>
                <div className="fxr-foot p-muted">Each one saved to the patient’s record</div>
              </div>
              <figure className="print fxr-print deco" aria-hidden="true">
                <Drawing src="/clindesk/phone-reminder.svg" width={400} height={500} loading="lazy" decoding="async" />
                <span className="tape tape--sun print-tape" aria-hidden="true" />
              </figure>
              <span className="ftag fxr-tag">Sample data (fictional)</span>
            </div>
          </div>
        </article>
        <article className="fxp" id="portal" aria-labelledby="portal-title">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>16:34 · Robert, on his sofa</p>
          <h2 className="display-l" id="portal-title">A portal for your patients</h2>
          <p className="body fx-lead">
            <span className="t-long"><b>Patients see what’s coming up, and book or change appointments online.</b> Questionnaires get done before the visit.</span>
            <span className="t-short">
              <b>Patients book and change appointments online.</b>
            </span>
          </p>
          <ul className="fx-points">
            <li><span className="tb tb--teal" aria-hidden="true" />Invoices and receipts in one place, with card payment.</li>
          </ul>
          <div className="fxp-scene">
            <div className="scene-box" role="img" aria-label="The patient portal on a phone for a fictional patient: his next appointment on Tuesday 17/11/2026 at 09:15 with Sophie Marsh at Northgate, a questionnaire marked done, and a receipt for a £50.00 excess paid on 10/11/2026. Sample data, fictional.">
              <div className="fxp-phone">
                <div className="product fxp-screen">
                  <p className="ph-clinic">Pebblegate Physio</p>
                  <p className="ph-hello">Hello Robert</p>
                  <div className="fxp-card">
                    <span className="p-muted">Next appointment</span>
                    <b>Tue 17/11/2026 · 09:15</b>
                    <span>Sophie Marsh · Northgate</span>
                    <span className="fxp-btn">Change</span>
                  </div>
                  <p className="fxp-line">
                    <span>Questionnaire</span>
                    <b className="fxp-done">Done</b>
                  </p>
                  <p className="fxp-line">
                    <span>Receipt · excess £50.00</span>
                    <b>Paid</b>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

/** 7 · 17:30 Reporting */
function Reporting() {
  return (
    <section className="fx fx-report fx--flip g-ink on-dark" id="reporting" aria-labelledby="reporting-title">
      <div className="wrap grid12">
        <div className="fx-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:30 · Sam, group office</p>
          <h2 className="display-l" id="reporting-title">Know how each site is doing</h2>
          <p className="body fx-lead">
            <span className="t-long"><b>Appointments, utilisation, cancellations and income, by site or practitioner.</b> Compare sites side by side, month by month.</span>
            <span className="t-short">
              <b>Appointments, utilisation and income, by site or practitioner.</b>
            </span>
          </p>
          <ul className="fx-points">
            <li><span className="tb tb--sun" aria-hidden="true" />Outstanding balances by patient, insurer and account.</li>
          </ul>
        </div>
        <div className="fx-scene">
          <figure className="print fxm-print deco" aria-hidden="true">
            <Drawing src="/clindesk/laptop-chart.svg" width={600} height={400} loading="lazy" decoding="async" />
            <span className="tape tape--coral print-tape" aria-hidden="true" />
          </figure>
          <div className="scene-box" role="img" aria-label="October 2026 compared across three sites: Northgate 612 appointments at 84% utilisation, Abbey Road 488 at 77%, Kingsmead 701 at 90%, with cancellations, income and outstanding balances for each, and utilisation for August to October. Sample data, fictional.">
            <div className="product fxm-panel">
              <div className="fxm-head">
                <b>October 2026 · by site</b>
                <span className="p-muted">All practitioners</span>
              </div>
              <div className="fxm-row fxm-hrow">
                <span />
                <span className="num">Northgate</span>
                <span className="num">Abbey Road</span>
                <span className="num">Kingsmead</span>
              </div>
              <div className="fxm-row">
                <span>Appointments</span>
                <span className="num">612</span>
                <span className="num">488</span>
                <span className="num">701</span>
              </div>
              <div className="fxm-row">
                <span>Utilisation</span>
                <span className="num">84%</span>
                <span className="num">77%</span>
                <span className="num">
                  <b>90%</b>
                </span>
              </div>
              <div className="fxm-row fx-opt">
                <span>Cancellations</span>
                <span className="num">3.6%</span>
                <span className="num">4.8%</span>
                <span className="num">2.5%</span>
              </div>
              <div className="fxm-row">
                <span>Income</span>
                <span className="num">£33,660</span>
                <span className="num">£26,840</span>
                <span className="num">£38,555</span>
              </div>
              <div className="fxm-row fx-opt">
                <span>Outstanding</span>
                <span className="num">£640</span>
                <span className="num">£1,020</span>
                <span className="num">£200</span>
              </div>
              <div className="fxm-trend fx-opt">
                <span className="p-muted">Utilisation · Aug, Sep, Oct</span>
                {" "}
                <span className="fxm-bars">
                  <i style={cssVars({"--v": "80%"})} />
                  <i style={cssVars({"--v": "82%"})} />
                  <i style={cssVars({"--v": "84%"})} />
                </span>
                {" "}
                <span className="fxm-bars">
                  <i style={cssVars({"--v": "74%"})} />
                  <i style={cssVars({"--v": "75%"})} />
                  <i style={cssVars({"--v": "77%"})} />
                </span>
                {" "}
                <span className="fxm-bars">
                  <i style={cssVars({"--v": "86%"})} />
                  <i style={cssVars({"--v": "88%"})} />
                  <i style={cssVars({"--v": "90%"})} />
                </span>
              </div>
            </div>
            <span className="ftag fxm-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 8 · 17:50 Groups */
function Groups() {
  return (
    <section className="fx fx-groups g-couch" id="groups" aria-labelledby="groups-title">
      <div className="wrap grid12">
        <div className="fx-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:50 · Sam, sorting Saturday’s locum</p>
          <h2 className="display-l" id="groups-title">Run several sites as one group</h2>
          <p className="body fx-lead">
            <span className="t-long"><b>Sites, rooms and rotas set up centrally, with booking across every site.</b> Roles decide who can see and change what, site by site.</span>
            <span className="t-short"><b>Sites, rooms and rotas set up centrally.</b> Roles decide who sees what.</span>
          </p>
          <ul className="fx-points">
            <li><span className="tb" aria-hidden="true" />A full audit trail across the group.</li>
          </ul>
        </div>
        <div className="fx-scene">
          <div className="scene-box" role="img" aria-label="Roles and permissions for the Abbey Road site: reception can use the diary and billing, physios the diary, clinical notes and reports, the practice manager everything, and the Saturday locum only the diary and their own notes. The change was recorded on the audit trail at 17:52 on 10/11/2026 by Sam Whitley. Sample data, fictional.">
            <div className="product fxg-panel">
              <div className="fxg-switch">
                <span>All sites</span>
                <span>Northgate</span>
                <span className="on">Abbey Road</span>
                <span>Kingsmead</span>
              </div>
              <div className="fxg-head">
                <b>Roles and permissions</b>
                <span className="p-muted">Abbey Road</span>
              </div>
              <div className="fxg-row fxg-hrow">
                <span>Role</span>
                <span>Diary</span>
                <span>Notes</span>
                <span>Billing</span>
                <span>Reports</span>
                <span>Settings</span>
              </div>
              <div className="fxg-row">
                <span>Reception</span>
                <i className="y" />
                <i />
                <i className="y" />
                <i />
                <i />
              </div>
              <div className="fxg-row">
                <span>Physio</span>
                <i className="y" />
                <i className="y" />
                <i />
                <i className="y" />
                <i />
              </div>
              <div className="fxg-row">
                <span>Practice manager</span>
                <i className="y" />
                <i className="y" />
                <i className="y" />
                <i className="y" />
                <i className="y" />
              </div>
              <div className="fxg-row fxg-new">
                <span>Saturday locum</span>
                <i className="y" />
                <i className="own">Own</i>
                <i />
                <i />
                <i />
              </div>
              <div className="fxg-foot p-muted fx-opt">On the audit trail · 10/11/2026 17:52 · Sam Whitley</div>
            </div>
            <span className="ftag fxg-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 9 · 18:05 Reports add-on */
function ReportsAddOn() {
  return (
    <section className="fx fx-reports fx--flip g-sun" id="reports" aria-labelledby="reports-title">
      <div className="wrap grid12">
        <div className="fx-text">
          <div className="lockup">
            <span className="display-m">{CLINIC_SYSTEM_NAME} Reports</span>
            <span className="lockup-sub">powered by ClinForms</span>
            <span className="addon addon--tilt">Add-on</span>
          </div>
          <p className="pen marker" style={cssVars({"--tilt": "-1.5deg"})}>18:05 · Sophie, the last report</p>
          <h2 className="display-l" id="reports-title">Referrer reports, filled from your notes</h2>
          <ul className="fx-points">
            <li><span className="tb tb--teal" aria-hidden="true" />Each insurer’s, case manager’s and solicitor’s own report form.</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Every answer shows the note it came from.</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Nothing is sent without the physio’s approval and signature.</li>
          </ul>
          <div className="fxq-cta">
            <a className="btn btn-pine" href="/reports">Explore Reports <span className="arr" aria-hidden="true">→</span></a>
            <p className="small">Add-on · <Fill k="reports.price" /></p>
          </div>
        </div>
        <div className="fx-scene">
          <div className="scene-box" role="img" aria-label="A case manager’s own rehabilitation progress report form for a fictional patient, with two answers prepared from signed notes and one left for the physio. Sample data, fictional.">
            <div className="sheet doc doc-calder fxq-sheet">
              <div className="band">CALDER CASE MANAGEMENT<span>Rehabilitation progress report · Isla Moreton</span></div>
              <div className="fxq-rows">
                <div className="fxq-row fx-opt">
                  <p className="fxq-q">1. Sessions attended since the last report</p>
                  <p className="fxq-a">3 of 6 attended, none missed.</p>
                  <span className="product p-chip">Notes 20/10–10/11/2026</span>
                </div>
                <div className="fxq-row">
                  <p className="fxq-q">2. Current function at work</p>
                  <p className="fxq-a">Back on full duties; lifting to 15 kg without pain.</p>
                  <span className="product p-chip">Note 10/11/2026</span>
                </div>
                <div className="fxq-row">
                  <p className="fxq-q">3. Barriers to recovery</p>
                  <span className="need">Needs your input</span>
                </div>
              </div>
            </div>
            <span className="tape tape--coral fxq-tape" aria-hidden="true" />
            {" "}
            <span className="ftag fxq-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 10 · 18:30 Behind the scenes */
function BehindTheScenes() {
  return (
    <section className="fx-admin g-couch" id="admin" aria-labelledby="admin-title">
      <div className="wrap">
        <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>18:30 · lights off</p>
        <h2 className="display-l" id="admin-title">Running the clinic, behind the scenes</h2>
        <Drawing className="fxa-box deco" src="/clindesk/moving-box.svg" aria-hidden="true" width={360} height={300} loading="lazy" decoding="async" />
        <ul className="fxa-grid">
          <li className="fxa-card">
            <span className="fxa-n" aria-hidden="true">01</span>
            <h3 className="display-m">Data import</h3>
            <p className="body">We bring your data across from your current system.</p>
            <a className="link" href="/switching">
              <span className="t-long">How switching works</span>
              <span className="t-short">Switching</span>
              {" "}
              <span className="arr" aria-hidden="true">→</span>
            </a>
          </li>
          <li className="fxa-card">
            <span className="fxa-n" aria-hidden="true">02</span>
            <h3 className="display-m">Full audit trail</h3>
            <p className="body">Every view, change and signature, recorded with who and when.</p>
            <a className="link" href="/security">
              <span className="t-long">Security and data</span>
              <span className="t-short">Security</span>
              {" "}
              <span className="arr" aria-hidden="true">→</span>
            </a>
          </li>
          <li className="fxa-card">
            <span className="fxa-n" aria-hidden="true">03</span>
            <h3 className="display-m">Roles and admin</h3>
            <p className="body">Access set by role and by site, managed in one place.</p>
          </li>
          <li className="fxa-card">
            <span className="fxa-n" aria-hidden="true">04</span>
            <h3 className="display-m">Support</h3>
            <p className="body">
              <Fill k="support.summary" />
            </p>
            <a className="link" href={`mailto:${CONTACT_EMAIL}`}>Email us <span className="arr" aria-hidden="true">→</span></a>
          </li>
        </ul>
      </div>
    </section>
  );
}
