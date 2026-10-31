import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { DefaultCtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/home.css";

/**
 * ClinDesk website – / (ClinDesk – practice software for UK physio and MSK clinics).
 * Ported from the approved design export Site-Home (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/",
  title: `${CLINIC_SYSTEM_NAME} – practice software for UK physio and MSK clinics`,
  description: `${CLINIC_SYSTEM_NAME} is practice software for UK physio and MSK clinics: diary, notes, billing and multi-site in one patient record, with insurers’ own report forms filled from signed notes.`,
});

export default function HomePage() {
  return (
    <SitePage current="/">
      <Hero />
      <FactStrip />
      <NotesAndLetters />
      <Reports />
      <Groups />
      <Money />
      <MovingDay />
      <Security />
      <DefaultCtaBand />
    </SitePage>
  );
}

/** 1 · Hero */
function Hero() {
  return (
    <section className="hero g-sky" aria-labelledby="hero-title">
      <div className="hero-inner">
        <div className="hero-copy">
          <h1 className="display-xxl" id="hero-title">
            <span className="h1-line">Diary full. </span>
            <span className="h1-line">Notes signed. </span>
            <span className="h1-line">Home by </span>
            <span className="h1-line">
              <span className="hl">half four.<span className="tape tape--sun hl-tape" aria-hidden="true" /></span>
            </span>
          </h1>
          <p className="lead">
            <span className="t-long"><b>{CLINIC_SYSTEM_NAME} is practice software for UK physio and MSK clinics, from one treatment room to fifteen sites.</b> The diary, notes, invoices and reminders share one patient record. Add Reports, and even the insurer’s own report form arrives mostly filled in from notes you’ve already signed. You check it. You sign it.</span>
            <span className="t-short"><b>Practice software for UK physio and MSK clinics.</b> With the Reports add-on, insurer forms arrive mostly filled.</span>
          </p>
          <div className="hero-ctas">
            <a className="btn btn-coral" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
            {" "}
            <a className="btn btn-outline" href="#reports">See an insurer form filled <span className="arr" aria-hidden="true">↓</span></a>
          </div>
          <p className="small muted hero-signin">Already using {CLINIC_SYSTEM_NAME}? <a className="link" href="/login">Sign in</a></p>
        </div>
        <div className="hero-art">
          <div className="hero-plane" aria-hidden="true" />
          <div className="k0" aria-hidden="true">
            <div className="k0-crop">
              <Drawing src="/clindesk/treatment-room.svg" width={680} height={560} decoding="async" />
            </div>
          </div>
          <div className="hero-scene" role="img" aria-label={`${CLINIC_SYSTEM_NAME} diary for Tuesday 10/11/2026 at the Northgate site, showing an online booking made at 06:12, a follow-up note signed and locked at 09:58, and the insurer’s own progress report form with 14 of 16 answers prepared from signed notes. Sample data, fictional.`}>
            <span className="tape tape--teal hero-tape" />
            <div className="product dpanel">
              <div className="dp-head">
                <b>Tuesday 10/11/2026 · Northgate</b>
                <span className="dp-seg">
                  <span>Day</span>
                  <span>Week</span>
                </span>
              </div>
              <div className="dp-cols">
                <span />
                <span>Sophie Marsh · Room 1</span>
                <span>Tom Ellis · Room 2</span>
                <span>Hannah Doyle · Room 3</span>
              </div>
              <div className="dp-grid">
                <div className="dp-times">
                  <span style={cssVars({"--s": "0"})}>08:00</span>
                  <span style={cssVars({"--s": "30"})}>08:30</span>
                  <span style={cssVars({"--s": "60"})}>09:00</span>
                  <span style={cssVars({"--s": "90"})}>09:30</span>
                  <span style={cssVars({"--s": "120"})}>10:00</span>
                  <span style={cssVars({"--s": "150"})}>10:30</span>
                  <span style={cssVars({"--s": "180"})}>11:00</span>
                  <span style={cssVars({"--s": "210"})}>11:30</span>
                </div>
                <div className="dp-col">
                  <div className="blk blk--self" style={cssVars({"--s": "30", "--d": "45"})}>
                    <span className="bt">08:30 · Self-pay</span>
                    <b>Jane Fielding</b>
                    <span>Follow-up</span>
                  </div>
                  <div className="blk blk--ins" style={cssVars({"--s": "75", "--d": "45"})}>
                    <span className="bt">09:15 · Insurer</span>
                    <b>Robert Hale</b>
                    <span>Follow-up · session 4 of 6</span>
                  </div>
                  <div className="blk blk--self blk-opt" style={cssVars({"--s": "135", "--d": "60"})}>
                    <span className="bt">10:15 · Self-pay</span>
                    <b>Leo Fairbank</b>
                    <span>Initial assessment</span>
                  </div>
                  <div className="blk blk--admin" style={cssVars({"--s": "210", "--d": "30"})}>
                    <svg aria-hidden="true">
                      <defs>
                        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="2.5" height="8" className="hatch-line" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#hatch)" />
                    </svg>
                    <span>Admin</span>
                  </div>
                </div>
                <div className="dp-col">
                  <div className="blk blk--self" style={cssVars({"--s": "30", "--d": "45"})}>
                    <span className="bt">08:30 · Self-pay</span>
                    <b>Mia Calloway</b>
                    <span>Follow-up · Booked online</span>
                  </div>
                  <div className="blk blk--cm" style={cssVars({"--s": "120", "--d": "60"})}>
                    <span className="bt">10:00 · Case management</span>
                    <b>Isla Moreton</b>
                    <span>Initial assessment</span>
                  </div>
                </div>
                <div className="dp-col">
                  <div className="blk blk--self" style={cssVars({"--s": "15", "--d": "45"})}>
                    <span className="bt">08:15 · Self-pay</span>
                    <b>Grace Lowe</b>
                    <span>Follow-up</span>
                  </div>
                  <div className="blk blk--ml" style={cssVars({"--s": "90", "--d": "60"})}>
                    <span className="bt">09:30 · Medico-legal</span>
                    <b>Callum Reid</b>
                    <span>Initial assessment</span>
                  </div>
                </div>
                <i className="dp-rule" style={cssVars({"--s": "0"})} />
                <i className="dp-rule" style={cssVars({"--s": "30"})} />
                <i className="dp-rule" style={cssVars({"--s": "60"})} />
                <i className="dp-rule" style={cssVars({"--s": "90"})} />
                <i className="dp-rule" style={cssVars({"--s": "120"})} />
                <i className="dp-rule" style={cssVars({"--s": "150"})} />
                <i className="dp-rule" style={cssVars({"--s": "180"})} />
                <i className="dp-rule" style={cssVars({"--s": "210"})} />
                {" "}
                <i className="now" />
              </div>
            </div>
            <div className="product frag frag1">
              <span className="av">LB</span>
              <div>
                <b>Booked online · Lucy Barnes</b>
                <span>Follow-up with Sophie Marsh · Thu 12/11/2026 08:30 · Northgate · booked 06:12</span>
              </div>
            </div>
            <div className="product frag frag2">
              <b>Follow-up · session 4 of 6 · Robert Hale</b>
              <span className="f2-row">
                <span className="lock"><svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>Locked</span>
                <span className="f2-signed">Signed &amp; locked 09:58 · Sophie Marsh</span>
              </span>
            </div>
            <div className="product frag frag3">
              <span className="addon">Add-on</span>
              <b>Northway Health progress report</b>
              <span>Robert Hale · 14 of 16 answers from signed notes · 2 need you</span>
              <span className="mk">1</span>
            </div>
            <p className="pen-note hero-pen">the insurer’s form, mostly filled</p>
            <svg className="wl hero-wl draw" viewBox="0 0 760 960" aria-hidden="true">
              <path pathLength="1" d="M338 888 C 396 888, 446 868, 494 842" />
              <circle cx="338" cy="888" r="4" />
              <circle cx="494" cy="842" r="4" />
            </svg>
            {" "}
            <span className="ftag hero-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot hero-annot vh">
            <li><span className="n">1</span>The insurer’s form, mostly filled</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 2 · Fact strip */
function FactStrip() {
  return (
    <section className="facts g-pine on-dark" aria-label={`Three facts about ${CLINIC_SYSTEM_NAME}`}>
      <div className="wrap">
        <ul className="facts-list">
          <li><span className="tb tb--sage tb-first" aria-hidden="true" />Notes lock when they’re signed</li>
          <li><span className="tb tb--sun" aria-hidden="true" />Referrers’ own report forms, filled from your signed notes (add-on)</li>
          <li><span className="tb tb--sage" aria-hidden="true" />1 to 15 sites, one diary</li>
        </ul>
      </div>
    </section>
  );
}

/** 3 · 09:15 Notes and letters */
function NotesAndLetters() {
  return (
    <section className="notes g-couch" id="notes" aria-labelledby="notes-title">
      <div className="wrap grid12">
        <div className="notes-scene">
          <div className="scene-box" role="img" aria-label="A follow-up note for a fictional patient, signed and locked at 09:58 under a SIGNED & LOCKED stamp, and an amendment at 10:05 that moves the review date while keeping the original. A letter to the GP, an intake form and a discharge summary come from the same record. Sample data, fictional.">
            <div className="product note-panel">
              <div className="np-head">
                <b>Follow-up · session 4 of 6 · 10/11/2026 09:15</b>
                <span className="p-muted">Robert Hale · Sophie Marsh, Room 1, Northgate</span>
              </div>
              <dl className="soap">
                <div>
                  <dt>S</dt>
                  <dd>Sleeping through most nights now. Pain 3/10 reaching overhead.</dd>
                </div>
                <div>
                  <dt>O</dt>
                  <dd>Flex 150°, abd 140°, painful arc 110–130°. ER strength 4+/5.</dd>
                </div>
                <div>
                  <dt>A</dt>
                  <dd>Improving as expected.</dd>
                </div>
                <div>
                  <dt>P</dt>
                  <dd>Progress loading. Review 17/11/2026.</dd>
                </div>
              </dl>
              <div className="np-foot">
                <span className="lock"><svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>Locked</span>
                <span>Signed &amp; locked · 10/11/2026 09:58 · Sophie Marsh</span>
              </div>
            </div>
            <div className="product slip slip1">Letter to GP</div>
            <div className="product slip slip2">Intake form · Leo Fairbank · completed 09/11/2026</div>
            <div className="product slip slip3">Discharge summary</div>
            <div className="stamp notes-stamp" aria-hidden="true">
              <svg viewBox="0 0 140 140">
                <defs>
                  <path id="st1-arc" d="M70 70 m-53 0 a53 53 0 1 1 106 0 a53 53 0 1 1 -106 0" />
                  <mask id="st1-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="140" height="140">
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
                <g mask="url(#st1-mask)">
                  <circle className="ring" cx="70" cy="70" r="66" />
                  <circle className="ring-thin" cx="70" cy="70" r="41" />
                  <text className="stamp-text">
                    <textPath href="#st1-arc" textLength="324" lengthAdjust="spacing">Signed &amp; locked · 10/11/2026 · S. Marsh ·</textPath>
                  </text>
                  <path className="sig" d="M44 82 C 47 62, 57 52, 60 61 C 62 70, 52 75, 48 70 M62 84 C 65 75, 71 71, 73 77 C 75 83, 70 86, 78 81 M80 79 C 84 71, 88 70, 90 74 C 92 79, 88 84, 97 78 M99 64 C 99 74, 99 81, 101 86" />
                </g>
              </svg>
              <span className="mk">1</span>
            </div>
            <div className="product frag amend"><b>Amendment 1</b> · 10/11/2026 10:05 · S. Marsh — Plan: review <s>24/11/2026</s> 17/11/2026 · original kept</div>
            <p className="pen-note notes-pen">signed, sealed, on the record</p>
            <svg className="wl notes-wl draw" viewBox="0 0 712 470" aria-hidden="true">
              <path pathLength="1" d="M543 241 C 556 230, 570 226, 586 224" />
              <circle cx="543" cy="241" r="4" />
            </svg>
            {" "}
            <span className="ftag notes-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot notes-annot vh">
            <li><span className="n">1</span>Signed, sealed, on the record</li>
          </ol>
        </div>
        <div className="notes-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>09:15 · Sophie, room 1</p>
          <h2 className="display-l" id="notes-title">No more write-ups at the kitchen table</h2>
          <p className="body">
            <span className="t-long"><b>Write up from your own templates for assessments, follow-ups and discharges.</b> When you sign a note, it locks. Change something later and the amendment is tracked, with the original kept underneath – exactly what you want if a solicitor ever asks. Letters to GPs come from the same record, and intake forms are filled in before the patient arrives.</span>
            <span className="t-short"><b>Write up from your own templates.</b> Signed notes lock, and every amendment keeps the original.</span>
          </p>
          <a className="link" href="/features#notes">See notes and letters <span className="arr" aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>
  );
}

/** 4 · 11:40 Reports (add-on) */
function Reports() {
  return (
    <section className="reports g-sun" id="reports" aria-labelledby="reports-title">
      <div className="wrap">
        <div className="reports-head">
          <div className="lockup">
            <span className="display-m">{CLINIC_SYSTEM_NAME} Reports</span>
            <span className="lockup-sub">powered by ClinForms</span>
            <span className="addon addon--tilt">Add-on</span>
          </div>
          <p className="pen marker" style={cssVars({"--tilt": "-1.5deg"})}>11:40 · Sophie, an insurer’s form</p>
          <h2 className="display-xl" id="reports-title">Your notes. Their form. <span className="swash-wrap">Your signature.<svg className="swash draw" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M4 17 C 70 7, 150 23, 230 13 S 350 6, 396 13" /></svg></span></h2>
          <div className="rep-intro">
            <p className="lead">
              <span className="t-long"><b>Every insurer, case manager and solicitor has their own report form, and none of them match.</b> The Reports add-on fills in their form – their layout, their questions – from the notes you’ve already signed in {CLINIC_SYSTEM_NAME}. It draws on every signed note in the course of treatment, not just today’s. Every answer shows the note it came from. Anything your notes don’t cover is left for you. Nothing leaves until the treating physio has checked it and signed it.</span>
              <span className="t-short"><b>Every referrer has their own form.</b> Reports fills it from your signed notes. Nothing leaves until you sign.</span>
            </p>
            <div className="rep-under">
              <p className="rep-sigline">Not one report leaves without a physio’s signature.</p>
              <ul className="chips" aria-label="Referrers">
                <li className="chip">Insurers</li>
                <li className="chip">Case managers</li>
                <li className="chip">Solicitors</li>
              </ul>
              <div className="rep-cta">
                <a className="btn btn-pine" href="/reports">See the Reports add-on <span className="arr" aria-hidden="true">→</span></a>
                <p className="small">Add-on to your {CLINIC_SYSTEM_NAME} plan · <Fill k="reports.price" /></p>
              </div>
            </div>
          </div>
        </div>
        <div className="rep-scene">
          <div className="scene-box" role="img" aria-label="An insurer’s own progress report form for a fictional patient, with answers prepared from two signed notes. Lines link two answers to the sentences they came from, one question is marked as needing the physio’s input, and a stamp shows the physio reviewed and signed it at 11:52. Sample data, fictional.">
            <div className="sheet sheet-calder doc doc-calder">
              <div className="band">CALDER CASE MANAGEMENT<span>Rehabilitation progress report</span></div>
              <ol>
                <li><span className="box" />1. Sessions attended since the last report</li>
                <li><span className="box" />2. Current function at work</li>
                <li><span className="box" />3. Barriers to recovery</li>
              </ol>
            </div>
            <div className="sheet sheet-hm doc doc-hm">
              <div className="lh">HARTLEY &amp; MOSS SOLICITORS · Treatment report</div>
              <div className="ref">
                <span>Our ref HM/TR/0471</span>
                <span>Page 1</span>
              </div>
              <p>1. Please set out the treatment provided to date.</p>
              <p>2. Please give your opinion on prognosis.</p>
            </div>
            <div className="sheet sheet-front doc doc-front">
              <svg className="clip" viewBox="0 0 26 70" aria-hidden="true">
                <path d="M8 54 V14 a6 6 0 0 1 12 0 v42 a9 9 0 0 1 -18 0 V22" />
              </svg>
              <div className="doc-org">NORTHWAY HEALTH</div>
              <div className="doc-title">Physiotherapy progress report</div>
              <div className="doc-meta">Form PR-2 · Page 1 of 2 · Authorisation ref NW-448210</div>
              <table className="doc-table">
                <tbody>
                  <tr className="row-name">
                    <th>Patient name</th>
                    <td className="ans">Robert Hale</td>
                    <td className="src">
                      <span className="product p-chip pop">Patient record</span>
                    </td>
                  </tr>
                  <tr className="row-date">
                    <th>Date of initial assessment</th>
                    <td className="ans">20/10/2026</td>
                    <td className="src">
                      <span className="product p-chip pop">Note 20/10/2026</span>
                    </td>
                  </tr>
                  <tr className="row-pres">
                    <th>Presenting condition</th>
                    <td className="ans ans-pres">Right shoulder pain after lifting boxes at work, onset 06/10/2026. Pain 6/10 reaching overhead; disturbed sleep.<span className="mk">1</span></td>
                    <td className="src">
                      <span className="product p-chip pop chip-pres">Note 20/10/2026</span>
                    </td>
                  </tr>
                  <tr className="row-progress">
                    <th>Progress to date</th>
                    <td className="ans">Session 4 of 6. Pain 3/10 reaching overhead; sleeping through most nights. Flexion 150° (was 120°).</td>
                    <td className="src">
                      <span className="product p-chip pop chip-prog">Notes 20/10 + 10/11/2026</span>
                    </td>
                  </tr>
                  <tr className="row-need">
                    <th>Further sessions requested<span className="mk">2</span></th>
                    <td className="ans">
                      <span className="need">Needs your input</span>
                    </td>
                    <td className="src">–</td>
                  </tr>
                </tbody>
              </table>
              <div className="doc-sign">
                <span>Treating physiotherapist’s signature and date</span>
              </div>
              <div className="stamp rep-stamp" aria-hidden="true">
                <svg viewBox="0 0 150 150">
                  <defs>
                    <path id="st2-arc" d="M75 75 m-58 0 a58 58 0 1 1 116 0 a58 58 0 1 1 -116 0" />
                    <mask id="st2-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="150" height="150">
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
                  <g mask="url(#st2-mask)">
                    <circle className="ring" cx="75" cy="75" r="71" />
                    <circle className="ring-thin" cx="75" cy="75" r="45" />
                    <text className="stamp-text">
                      <textPath href="#st2-arc" textLength="356" lengthAdjust="spacing">Reviewed &amp; signed · S. Marsh · 10/11/2026 11:52 ·</textPath>
                    </text>
                    <path className="sig" d="M48 88 C 51 66, 61 56, 64 65 C 66 74, 56 79, 52 74 M66 90 C 69 81, 75 77, 77 83 C 79 89, 74 92, 82 87 M84 85 C 88 77, 92 76, 94 80 C 96 85, 92 90, 101 84 M103 70 C 103 80, 103 87, 105 92" />
                  </g>
                </svg>
              </div>
            </div>
            <div className="product src-a">
              <div className="src-head">
                <b>Initial assessment · 20/10/2026 · Sophie Marsh · Signed</b>
              </div>
              <div className="src-body">
                <p><span className="k">S</span><mark>R shoulder pain since lifting boxes at work 06/10/2026. 6/10 reaching overhead, wakes at night.</mark> Warehouse, now on light duties.</p>
                <p><span className="k">O</span>Flex 120°, abd 110°, painful arc 90–120°. ER strength 4/5.</p>
              </div>
              <span className="mk">1</span>
            </div>
            <div className="product src-b">
              <div className="src-head">
                <b>Follow-up · session 4 of 6 · 10/11/2026 · Signed 09:58</b>
              </div>
              <div className="src-body">
                <p>
                  <span className="k">S</span>
                  <mark>Sleeping through most nights now. Pain 3/10 reaching overhead.</mark>
                </p>
                <p><span className="k">O</span><mark>Flex 150°</mark>, abd 140°, painful arc 110–130°. ER strength 4+/5.</p>
                <p><span className="k">A</span>Improving as expected.</p>
                <p><span className="k">P</span>Progress loading. Review 17/11/2026.</p>
              </div>
              <div className="src-foot"><span className="lock"><svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" /></svg>Locked</span>Sophie Marsh</div>
            </div>
            <div className="product rep-progress"><span className="bar"><i /></span>14 of 16 answers filled from notes · 2 need you</div>
            <p className="pen-note rep-pen">the bit only you know</p>
            <svg className="wl rep-wl draw" viewBox="0 0 1280 700" aria-hidden="true">
              <path pathLength="1" d="M694 326 C 752 326, 762 282, 818 282" />
              <circle cx="694" cy="326" r="4" />
              <circle cx="818" cy="282" r="4" />
              <path pathLength="1" d="M746 430 C 790 430, 784 500, 818 500" />
              <circle cx="746" cy="430" r="4" />
              <circle cx="818" cy="500" r="4" />
              <path pathLength="1" d="M122 532 C 132 524, 140 522, 150 522" />
              <circle cx="150" cy="522" r="4" />
            </svg>
            {" "}
            <span className="ftag rep-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot rep-annot vh">
            <li><span className="n">1</span>Presenting condition: from the signed initial assessment of 20/10/2026</li>
            <li><span className="n">2</span>Further sessions requested: the bit only you know</li>
          </ol>
        </div>
      </div>
      <span className="tape tape--coral rep-tape" aria-hidden="true" />
    </section>
  );
}

/** 5 · 13:05 Groups */
function Groups() {
  return (
    <section className="groups g-pine on-dark" id="groups" aria-labelledby="groups-title">
      <div className="wrap grid12">
        <div className="groups-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>13:05 · Sam, group office</p>
          <p className="num-row">
            <span className="numeral">1–15</span>
            {" "}
            <span className="num-cap">sites, one diary</span>
          </p>
          <h2 className="display-l" id="groups-title">Book Kingsmead from the Northgate desk</h2>
          <p className="body">
            <span className="t-long"><b>One diary, one patient list and one set of numbers across every site.</b> Reception can book anyone into any room at any site. Practitioners see their own day, managers see all of it, and roles decide who sees what – so the Saturday locum at Abbey Road never wanders into the group’s finances.</span>
            <span className="t-short"><b>One diary, one patient list and one set of numbers across every site.</b> Roles decide who sees what.</span>
          </p>
          <a className="link" href="/features#groups">See the group view <span className="arr" aria-hidden="true">→</span></a>
        </div>
        <div className="groups-scene">
          <div className="scene-box" role="img" aria-label={`${CLINIC_SYSTEM_NAME} group view for the week commencing 09/11/2026 across three sites, Northgate, Abbey Road and Kingsmead, showing utilisation and DNA rate for each, and a Kingsmead appointment booked by reception at Northgate at 12:58. Sample data, fictional.`}>
            <div className="product g-panel">
              <div className="gp-switch">
                <span>Northgate</span>
                <span>Abbey Road</span>
                <span className="on">Kingsmead</span>
              </div>
              <div className="gp-title">
                <b>This week across the group</b>
                <span className="p-muted">w/c 09/11/2026</span>
              </div>
              <div className="gp-rows">
                <div className="gp-row gp-headrow">
                  <span>Site</span>
                  <span>Utilisation</span>
                  <span className="num">DNA rate</span>
                </div>
                <div className="gp-row">
                  <span>Northgate</span>
                  <span className="gp-util"><span className="gbar"><i style={cssVars({"--v": "86%"})} /></span>86%</span>
                  <span className="num">3.1%</span>
                </div>
                <div className="gp-row">
                  <span>Abbey Road</span>
                  <span className="gp-util"><span className="gbar"><i style={cssVars({"--v": "78%"})} /></span>78%</span>
                  <span className="num">4.4%</span>
                </div>
                <div className="gp-row">
                  <span>Kingsmead</span>
                  <span className="gp-util"><span className="gbar"><i style={cssVars({"--v": "91%"})} /></span>91%</span>
                  <span className="num">2.2%</span>
                </div>
              </div>
            </div>
            <div className="product frag g-toast">
              <span className="av">IM</span>
              <div>
                <b>Isla Moreton · Follow-up with Owen Price</b>
                <span>Kingsmead · Thu 12/11/2026 15:00 · booked by Jo Barker at Northgate, 12:58</span>
              </div>
            </div>
            <span className="ftag g-tag">Sample data (fictional)</span>
          </div>
        </div>
      </div>
      <figure className="print print-p5 deco" aria-hidden="true">
        <Drawing src="/clindesk/reception-desk.svg" width={600} height={400} loading="lazy" decoding="async" />
        <span className="tape tape--sun print-tape" aria-hidden="true" />
      </figure>
    </section>
  );
}

/** 6 · 16:30 Money */
function Money() {
  return (
    <section className="money g-blush" id="money" aria-labelledby="money-title">
      <figure className="print print-p8 deco" aria-hidden="true">
        <Drawing src="/clindesk/kettle-counter.svg" width={400} height={500} loading="lazy" decoding="async" />
        <span className="tape tape--teal print-tape" aria-hidden="true" />
      </figure>
      <div className="wrap grid12">
        <div className="money-scene">
          <div className="scene-box" role="img" aria-label="An insurer invoice for a fictional patient on authorisation NW-448210, at session 4 of 6 with 2 left, less the £50.00 excess he paid by card in the patient portal at 16:34, leaving £190.00 due from the insurer, sent at 16:40. Sample data, fictional.">
            <span className="money-plane" aria-hidden="true" />
            <div className="product inv-panel">
              <div className="inv-head">
                <b>INV-20431 · Northway Health</b>
                <span className="p-muted">Robert Hale · Auth NW-448210</span>
                <span className="inv-count">Session 4 of 6 · 2 left</span>
              </div>
              <div className="inv-lines">
                <div className="inv-line">
                  <span>20/10/2026 Initial assessment · Sophie Marsh</span>
                  <span className="num">£75.00</span>
                </div>
                <div className="inv-line">
                  <span>27/10/2026 Follow-up</span>
                  <span className="num">£55.00</span>
                </div>
                <div className="inv-line">
                  <span>03/11/2026 Follow-up</span>
                  <span className="num">£55.00</span>
                </div>
                <div className="inv-line">
                  <span>10/11/2026 Follow-up</span>
                  <span className="num">£55.00</span>
                </div>
                <div className="inv-line">
                  <span>Less excess paid by patient</span>
                  <span className="num">−£50.00</span>
                </div>
                <div className="inv-line inv-total">
                  <span>Due from insurer</span>
                  <span className="num">£190.00</span>
                </div>
              </div>
              <div className="inv-foot p-muted">Sent 10/11/2026 16:40</div>
            </div>
            <div className="product inv-chip">
              <b>Due from insurer £190.00</b>
              <span>Session 4 of 6 · 2 left</span>
            </div>
            <div className="phone">
              <div className="product phone-screen">
                <p className="ph-clinic">Pebblegate Physio</p>
                <p className="ph-hello">Hello Robert</p>
                <div className="ph-card">
                  <span className="p-muted">Your excess</span>
                  <b className="ph-amt">£50.00</b>
                  <span className="ph-pay">Pay by card</span>
                </div>
                <p className="ph-paid"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-5.5" /></svg>Paid · 16:34 · Receipt sent</p>
              </div>
            </div>
            <div className="loupe" aria-hidden="true">
              <span>Session 4 of 6 · 2 left</span>
            </div>
            <svg className="wl money-wl draw" viewBox="0 0 520 700" aria-hidden="true">
              <path pathLength="1" d="M118 281 C 94 281, 86 230, 70 184" />
              <circle cx="118" cy="281" r="4" />
            </svg>
            {" "}
            <span className="ftag money-tag">Sample data (fictional)</span>
          </div>
        </div>
        <div className="money-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>16:30 · Robert, on his sofa</p>
          <h2 className="display-l" id="money-title">Excess paid before the kettle’s boiled</h2>
          <p className="body">
            <span className="t-long"><b>Invoice the patient, the insurer, the case manager or the solicitor – each the way they want it.</b> {CLINIC_SYSTEM_NAME} counts down authorised sessions, so session seven of six doesn’t sneak up on anyone. Patients pay by card at the desk or in the patient portal, where they can also rebook, fill in forms and see what they owe.</span>
            <span className="t-short"><b>Invoice patients, insurers, case managers or solicitors.</b> Patients pay by card at the desk or online.</span>
          </p>
          <a className="link" href="/features#billing">See billing and insurers <span className="arr" aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>
  );
}

/** 7 · Moving day */
function MovingDay() {
  return (
    <section className="moving g-cardboard" id="switching" aria-labelledby="moving-title">
      <div className="wrap grid12">
        <div className="moving-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>moving day</p>
          <h2 className="display-l" id="moving-title">Switching? We’ll do the heavy lifting</h2>
          <p className="lead">
            <span className="t-long"><b>Knees bent, back straight – we know the drill.</b> We bring your patients, appointments, notes and balances across from your current system, check them with you before go-live, and train each role on the bits they use.</span>
            <span className="t-short"><b>Knees bent, back straight.</b> We move your patients, diary, notes and balances, and check them with you.</span>
          </p>
          <a className="btn btn-coral" href="/switching">Plan your switch <span className="arr" aria-hidden="true">→</span></a>
        </div>
        <div className="moving-ledger">
          <ol className="ledger">
            <li>
              <span className="ldg-n" aria-hidden="true">1</span>
              <div>
                <h3 className="display-m">A proper look first.</h3>
                <p className="body">A call about your current system, your sites and how your team actually works.</p>
              </div>
            </li>
            <li>
              <span className="ldg-n" aria-hidden="true">2</span>
              <div>
                <h3 className="display-m">A trial run.</h3>
                <p className="body">Your data in a test copy of {CLINIC_SYSTEM_NAME}, for you to poke at.</p>
              </div>
            </li>
            <li className="ldg-desk">
              <span className="ldg-n" aria-hidden="true">3</span>
              <div>
                <h3 className="display-m">Check it together.</h3>
                <p className="body">Patients, future appointments, balances and open authorisations, line by line.</p>
              </div>
            </li>
            <li className="ldg-desk">
              <span className="ldg-n" aria-hidden="true">4</span>
              <div>
                <h3 className="display-m">Training, by role.</h3>
                <p className="body">Reception, clinicians and managers, each on the bits they use, with your own data.</p>
              </div>
            </li>
            <li>
              <span className="ldg-n" aria-hidden="true">
                <span className="t-long">5</span>
                <span className="t-short">3</span>
              </span>
              <div>
                <h3 className="display-m">Go-live.</h3>
                <p className="body">The latest data comes across, and your current system stays to hand while everyone settles.</p>
              </div>
            </li>
          </ol>
          <p className="ldg-foot">
            <b>Typical move:</b>
            {" "}
            <Fill k="switching.typicalMove" />
          </p>
          <p className="small muted">What can move depends on what your current system can export. We’ll tell you on the first call, before you commit.</p>
        </div>
      </div>
      <div className="k6">
        <Drawing src="/clindesk/moving-box.svg" width={360} height={300} loading="lazy" decoding="async" />
        {" "}
        <span className="k6-label pen" aria-hidden="true">PATIENTS · DIARY<br />NOTES · BALANCES</span>
        <div className="k6-chip">
          <span className="product p-chip">Trial import · 53 records to check, together</span>
          <span className="ftag k6-tag">Sample data (fictional)</span>
        </div>
      </div>
    </section>
  );
}

/** 8 · 18:30 Security */
function Security() {
  return (
    <section className="security g-ink on-dark" id="security" aria-labelledby="security-title">
      <div className="wrap grid12">
        <div className="sec-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>18:30 · lights off</p>
          <h2 className="display-xl" id="security-title">Signed means signed.</h2>
          <p className="body sec-body"><span className="t-long"><b>Clinical records are the most sensitive thing a clinic keeps, and we build like it.</b> Notes lock when they’re signed. Every sign-in, view, change and signature goes on the audit trail – who, when and which site. Roles decide who sees what, site by site.</span><span className="t-short"><b>Signed notes lock. Every view and change is audited.</b></span> Hosting: <Fill k="hosting.summary" />.</p>
          <a className="link" href="/security">How we look after patient data <span className="arr" aria-hidden="true">→</span></a>
        </div>
        <div className="sec-art deco" aria-hidden="true">
          <div className="k7">
            <Drawing src="/clindesk/records-drawer.svg" width={360} height={340} loading="lazy" decoding="async" />
            <span className="k7-label label" aria-hidden="true">Signed</span>
          </div>
        </div>
        <div className="sec-scene">
          <div className="scene-box" role="img" aria-label="The audit trail for Tuesday 10/11/2026 across all sites: a note signed and locked at 09:58 and amended at 10:05 with the original kept, a report signed at 11:52, a Kingsmead booking at 12:58, a receptionist at Abbey Road blocked from clinical notes at 15:40 because it is not in their role, and a £50.00 portal payment at 16:34. Sample data, fictional.">
            <div className="product audit">
              <div className="audit-title">
                <b>Audit trail · Tuesday 10/11/2026 · all sites</b>
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
                <span>Northway Health PR-2</span>
                <span>Northgate</span>
              </div>
              <div className="audit-row audit-opt">
                <span className="num">12:58</span>
                <span>Jo Barker · Reception</span>
                <span>Booked appointment</span>
                <span>Isla Moreton</span>
                <span>Kingsmead</span>
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
            <p className="pen-note sec-pen">blocked, and still on the record</p>
            <svg className="wl sec-wl draw" viewBox="0 0 900 360" aria-hidden="true">
              <path pathLength="1" d="M832 237 C 856 237, 868 232, 892 230" />
              <circle cx="832" cy="237" r="4" />
            </svg>
            {" "}
            <span className="ftag sec-tag">Sample data (fictional)</span>
          </div>
          <ol className="annot sec-annot vh">
            <li><span className="n">1</span>Blocked, and still on the record</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
