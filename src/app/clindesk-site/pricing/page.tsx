import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { CtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/pricing.css";

/**
 * ClinDesk website – /pricing (Pricing – ClinDesk).
 * Ported from the approved design export Site-Pricing (bh2-handover/k2-designs/clindesk-site): same sections, copy,
 * classes and drawings; fill-ins via <Fill> (content/clindesk-site.json).
 */
export const metadata = clindeskMetadata({
  path: "/pricing",
  title: `Pricing – ${CLINIC_SYSTEM_NAME}`,
  description: `${CLINIC_SYSTEM_NAME} pricing: per practitioner, with plans for single clinics and multi-site groups and a Reports add-on.`,
});

export default function PricingPage() {
  return (
    <SitePage current="/pricing">
      <PricingHero />
      <Plans />
      <ReportsAddOn />
      <WithEveryPlan />
      <FAQs />
      <CtaBand
        title="Not sure which plan fits?"
        line="Tell us about your sites and team, and we’ll suggest the right set-up."
        extra={
          <p className="cta-price">
            Switching from your current system?{" "}
            <a className="link" href="/switching">
              How switching works <span className="arr" aria-hidden="true">→</span>
            </a>
          </p>
        }
      />
    </SitePage>
  );
}

/** 1 · Pricing hero */
function PricingHero() {
  return (
    <section className="p-hero g-sky" aria-labelledby="pricing-title">
      <div className="wrap grid12">
        <div className="p-hero-copy">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:10 · Sam, doing the sums</p>
          <h1 className="display-xxl" id="pricing-title">Pay per <span className="hl">practitioner.<span className="tape tape--sun hl-tape" aria-hidden="true" /></span></h1>
          <p className="lead">
            <span className="t-long"><b>Pay monthly for each practitioner using {CLINIC_SYSTEM_NAME}.</b> Add Reports if you need it. Groups get a plan built around their sites.</span>
            <span className="t-short"><b>Pay monthly for each practitioner.</b> Add Reports if you need it.</span>
          </p>
          <p className="p-vat">Prices <Fill k="pricing.vat" /> VAT · Free trial: <Fill k="pricing.trialSummary" /></p>
          <div className="p-ctas">
            <a className="btn btn-coral" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
            {" "}
            <a className="btn btn-outline" href="#plans">Compare the plans <span className="arr" aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="p-hero-art">
          <span className="p-plane" aria-hidden="true" />
          <figure className="print p-print deco" aria-hidden="true">
            <Drawing src="/clindesk/card-terminal.svg" width={600} height={400} decoding="async" />
            <span className="tape tape--teal print-tape" aria-hidden="true" />
          </figure>
          <div className="product frag p-plan-frag" role="img" aria-label="A fictional clinic’s plan summary: Pebblegate Physio on the Complete plan, 11 practitioners across 3 sites, with the Reports add-on, next invoice 01/12/2026. Sample data, fictional.">
            <span className="ftag p-tag">Sample data (fictional)</span>
            {" "}
            <span className="p-frag-k">Your plan · Pebblegate Physio</span>
            {" "}
            <b className="p-frag-plan">Complete</b>
            {" "}
            <span className="p-frag-row">
              <span>Practitioners</span>
              <b>11</b>
            </span>
            {" "}
            <span className="p-frag-row">
              <span>Sites</span>
              <b>3</b>
            </span>
            {" "}
            <span className="p-frag-row">
              <span>Reports add-on</span>
              <span className="lock">On</span>
            </span>
            {" "}
            <span className="p-frag-foot p-muted">Next invoice 01/12/2026</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 2 · Plans */
function Plans() {
  return (
    <section className="plans g-couch" id="plans" aria-labelledby="plans-title">
      <div className="wrap">
        <div className="plans-head">
          <div>
            <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:15 · three plans</p>
            <h2 className="display-l" id="plans-title">From one treatment room to fifteen sites</h2>
          </div>
          <p className="pen-note plans-pen">more than one site? this one</p>
          <svg className="wl plans-wl draw" viewBox="0 0 1280 260" aria-hidden="true">
            <path pathLength="1" d="M1128 118 C 1160 132, 1176 168, 1180 214" />
            <circle cx="1180" cy="214" r="4" />
          </svg>
        </div>
        <ul className="plan-grid">
          <li className="plan-wrap">
            <article className="plan" aria-labelledby="pl-ess">
              <span className="tape tape--coral plan-tape" aria-hidden="true" />
              <h3 className="display-m" id="pl-ess">Essentials</h3>
              <p className="plan-for">For a single clinic getting started.</p>
              <p className="plan-price">
                <Fill k="pricing.essentialsPrice" className="plan-amt" />
                <span className="plan-unit">per practitioner a month</span>
              </p>
              <a className="btn btn-outline plan-btn" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
              <ul className="plan-list">
                <li><span className="tb" aria-hidden="true" />Diary and online booking</li>
                <li><span className="tb" aria-hidden="true" />Patient records and signed notes</li>
                <li><span className="tb" aria-hidden="true" />Letters, templates and intake forms</li>
                <li><span className="tb" aria-hidden="true" />Invoicing and card payments</li>
                <li><span className="tb" aria-hidden="true" />Reminders and messages</li>
              </ul>
            </article>
          </li>
          <li className="plan-wrap">
            <article className="plan" aria-labelledby="pl-com">
              <span className="tape tape--sun plan-tape" aria-hidden="true" />
              <h3 className="display-m" id="pl-com">Complete</h3>
              <p className="plan-for">For clinics billing insurers and case managers.</p>
              <p className="plan-price">
                <Fill k="pricing.completePrice" className="plan-amt" />
                <span className="plan-unit">per practitioner a month</span>
              </p>
              <a className="btn btn-outline plan-btn" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
              <ul className="plan-list">
                <li className="plan-plus">Everything in Essentials, plus:</li>
                <li><span className="tb" aria-hidden="true" />Insurer, case-management and medico-legal billing</li>
                <li><span className="tb" aria-hidden="true" />Authorisations</li>
                <li><span className="tb" aria-hidden="true" />Patient portal</li>
                <li><span className="tb" aria-hidden="true" />Reporting</li>
              </ul>
            </article>
          </li>
          <li className="plan-wrap">
            <article className="plan plan--groups on-dark" aria-labelledby="pl-grp">
              <span className="tape tape--teal plan-tape" aria-hidden="true" />
              <h3 className="display-m" id="pl-grp">Groups</h3>
              <p className="plan-for">For groups with more than one site.</p>
              <p className="plan-price">
                <span className="plan-amt plan-amt--talk">Talk to us</span>
                <span className="plan-unit">a plan built around your sites</span>
              </p>
              <a className="btn btn-coral plan-btn" href="/demo">Talk to us <span className="arr" aria-hidden="true">→</span></a>
              <ul className="plan-list">
                <li className="plan-plus">Everything in Complete, plus:</li>
                <li><span className="tb tb--sun" aria-hidden="true" />Multi-site diary and central booking</li>
                <li><span className="tb tb--sun" aria-hidden="true" />Roles and multi-site admin</li>
                <li><span className="tb tb--sun" aria-hidden="true" />Group reporting</li>
                <li><span className="tb tb--sun" aria-hidden="true" />A switching plan for every site</li>
              </ul>
            </article>
          </li>
        </ul>
        <p className="small plans-note">
          <Fill k="pricing.groupPlan" />
        </p>
        {/* TrialLink: add "Start free trial" (href="#start-trial" data-todo="trial sign-up URL") under each plan button only if a free trial is confirmed */}
      </div>
    </section>
  );
}

/** 3 · Reports add-on */
function ReportsAddOn() {
  return (
    <section className="p-reports g-sun" id="reports-addon" aria-labelledby="addon-title">
      <div className="wrap grid12">
        <div className="p-reports-text">
          <div className="lockup">
            <span className="display-m">{CLINIC_SYSTEM_NAME} Reports</span>
            <span className="lockup-sub">powered by ClinForms</span>
            <span className="addon addon--tilt">Add-on</span>
          </div>
          <p className="pen marker" style={cssVars({"--tilt": "-1.5deg"})}>17:25 · the add-on</p>
          <h2 className="display-l" id="addon-title">Works with any plan</h2>
          <p className="body">
            <span className="t-long"><b>Referrers’ own report forms, completed from your notes and signed by the physio.</b> Add it to Essentials, Complete or Groups – the form arrives mostly filled, and nothing leaves until it’s signed.</span>
            <span className="t-short">
              <b>Referrers’ own report forms, completed from your notes and signed by the physio.</b>
            </span>
          </p>
          <p className="p-addon-price">
            <Fill k="reports.price" />
          </p>
          <a className="btn btn-pine" href="/reports">About Reports <span className="arr" aria-hidden="true">→</span></a>
        </div>
        <div className="p-reports-scene">
          <div className="scene-box" role="img" aria-label="Three referrers’ report forms, from Calder Case Management, Hartley and Moss Solicitors and Northway Health. The Northway form for a fictional patient is filled from signed notes, with one answer left for the physio, and stamped reviewed and signed by S. Marsh on 10/11/2026 at 11:52. Sample data, fictional.">
            <div className="sheet p-sheet-calder doc doc-calder">
              <div className="band">CALDER CASE MANAGEMENT<span>Rehabilitation progress report</span></div>
              <ol>
                <li><span className="box" />1. Sessions attended since the last report</li>
                <li><span className="box" />2. Current function at work</li>
              </ol>
            </div>
            <div className="sheet p-sheet-hm doc doc-hm">
              <div className="lh">HARTLEY &amp; MOSS SOLICITORS · Treatment report</div>
              <div className="ref">
                <span>Our ref HM/TR/0471</span>
                <span>Page 1</span>
              </div>
              <p>1. Please set out the treatment provided to date.</p>
            </div>
            <div className="sheet p-sheet-front doc doc-front">
              <span className="ftag p-sheet-tag">Sample data (fictional)</span>
              <div className="doc-org">NORTHWAY HEALTH</div>
              <div className="doc-title">Physiotherapy progress report</div>
              <table className="doc-table">
                <tbody>
                  <tr>
                    <th>Patient name</th>
                    <td className="ans">Robert Hale</td>
                  </tr>
                  <tr>
                    <th>Progress to date</th>
                    <td className="ans">Session 4 of 6. Pain 3/10 reaching overhead; sleeping through most nights.</td>
                  </tr>
                  <tr className="p-row-need">
                    <th>Further sessions requested</th>
                    <td className="ans">
                      <span className="need">Needs your input</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="doc-sign">
                <span>Treating physiotherapist’s signature and date</span>
              </div>
              <div className="stamp p-stamp" aria-hidden="true">
                <svg viewBox="0 0 150 150">
                  <defs>
                    <path id="pst-arc" d="M75 75 m-58 0 a58 58 0 1 1 116 0 a58 58 0 1 1 -116 0" />
                    <mask id="pst-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="150" height="150">
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
                      </g>
                    </mask>
                  </defs>
                  <g mask="url(#pst-mask)">
                    <circle className="ring" cx="75" cy="75" r="71" />
                    <circle className="ring-thin" cx="75" cy="75" r="45" />
                    <text className="stamp-text">
                      <textPath href="#pst-arc" textLength="356" lengthAdjust="spacing">Reviewed &amp; signed · S. Marsh · 10/11/2026 11:52 ·</textPath>
                    </text>
                    <path className="sig" d="M48 88 C 51 66, 61 56, 64 65 C 66 74, 56 79, 52 74 M66 90 C 69 81, 75 77, 77 83 C 79 89, 74 92, 82 87 M84 85 C 88 77, 92 76, 94 80 C 96 85, 92 90, 101 84 M103 70 C 103 80, 103 87, 105 92" />
                  </g>
                </svg>
                <span className="mk">1</span>
              </div>
            </div>
            <p className="pen-note p-reports-pen">signed by the physio, every time</p>
            <svg className="wl p-reports-wl draw" viewBox="0 0 628 460" aria-hidden="true">
              <path pathLength="1" d="M502 316 C 488 332, 468 346, 442 357" />
              <circle cx="442" cy="357" r="4" />
            </svg>
          </div>
          <ol className="annot p-reports-annot vh">
            <li><span className="n">1</span>Signed by the physio, every time</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** 4 · With every plan */
function WithEveryPlan() {
  return (
    <section className="p-every g-pine on-dark" aria-labelledby="every-title">
      <div className="wrap">
        <div className="every-head">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:30 · whichever you pick</p>
          <h2 className="display-l" id="every-title">With every plan</h2>
        </div>
        <ul className="every-list">
          <li>
            <span className="every-n" aria-hidden="true">1</span>
            <h3 className="display-m">Help switching</h3>
            <p className="body">We move your data from your current system. <Fill k="pricing.switchingFeeSummary" /></p>
          </li>
          <li>
            <span className="every-n" aria-hidden="true">2</span>
            <h3 className="display-m">Training</h3>
            <p className="body">Sessions for reception, clinicians and managers.</p>
          </li>
          <li>
            <span className="every-n" aria-hidden="true">3</span>
            <h3 className="display-m">Full audit trail</h3>
            <p className="body">Every view, change and signature, recorded.</p>
          </li>
          <li>
            <span className="every-n" aria-hidden="true">4</span>
            <h3 className="display-m">Support</h3>
            <p className="body">
              <Fill k="support.summary" />
            </p>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** 5 · FAQs */
function FAQs() {
  return (
    <section className="p-faq g-blush" id="faq" aria-labelledby="faq-title">
      <div className="wrap grid12">
        <div className="faq-head">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:40 · the small print</p>
          <h2 className="display-l" id="faq-title">Questions about pricing</h2>
          <p className="small faq-mail">Anything else? Email <a className="link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
        </div>
        <div className="faq-list">
          <details open>
            <summary>How long is the contract?</summary>
            <p className="body"><Fill k="pricing.contractLength" />. <Fill k="pricing.noticePeriod" />.</p>
          </details>
          <details>
            <summary>Can we export our data if we leave?</summary>
            <p className="body">Your data belongs to your clinic. <Fill k="pricing.dataExport" />.</p>
          </details>
          <details>
            <summary>Will you help us switch from our current system?</summary>
            <p className="body">Yes. We plan the move with you, import your data, check it with you and train your team. <a className="link" href="/switching">How switching works</a> <Fill k="pricing.switchingFee" /></p>
          </details>
          <details>
            <summary>When can we get support?</summary>
            <p className="body"><Fill k="support.hours" />, by <Fill k="support.channels" />.</p>
          </details>
          <details>
            <summary>How does Reports pricing work?</summary>
            <p className="body">Reports is an add-on to any plan. <Fill k="reports.aboveAllowance" />.</p>
          </details>
          <details>
            <summary>Is there a free trial?</summary>
            <p className="body"><Fill k="pricing.trialTerms" />.</p>
          </details>
          <details>
            <summary>Do prices include VAT?</summary>
            <p className="body">Prices <Fill k="pricing.vat" /> VAT.</p>
          </details>
        </div>
      </div>
    </section>
  );
}
