import { StartTrialButton, TrialSummary } from "@/components/clindesk/trial-cta";
import type { ReactNode } from "react";
import { BRANDS, CLINFORMS_NAME, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import {
  EXTRA_REPORT_PRICE,
  FREE_MONTHS_TEXT,
  FROM_PRICE,
  LARGEST_BAND_MAX,
  PLAN_CARDS,
  REPORTS_ALLOWANCES,
  REPORTS_FROM,
  REPORTS_TIERS,
  TEXT_PACKS,
} from "@/lib/clindesk/pricing";
import { CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { cssVars } from "@/components/clindesk/css-vars";
import { CtaBand } from "@/components/clindesk/cta-band";
import { Fill } from "@/components/clindesk/fill";
import { Drawing } from "@/components/clindesk/drawing";
import { SitePage } from "@/components/clindesk/site-page";
import "@/components/clindesk/styles/pricing.css";

/**
 * ClinDesk website – /pricing (Pricing – ClinDesk), the real offer (01/11/2026).
 * Layout, classes and drawings from the approved design export Site-Pricing (bh2-handover/k2-designs/clindesk-site).
 * Every amount comes from the billing plan table checkout uses (src/lib/clindesk/pricing.ts → src/lib/billing/plans.ts
 * and src/modules/pms/comms/credits.ts) – never typed here. Every plan button books a demo: no checkout on the public
 * site; the free trial is offered after the demo.
 *
 * Monthly / yearly: two radio buttons (#bill-month, #bill-year) and CSS only (pricing.css, `:has()`), so the switch
 * works without JavaScript; a browser without `:has()` simply shows both prices.
 */
export const metadata = clindeskMetadata({
  path: "/pricing",
  title: `Pricing – ${CLINIC_SYSTEM_NAME}`,
  description: `${CLINIC_SYSTEM_NAME} pricing: plans by number of practitioners from ${FROM_PRICE}, every feature on every plan, a Reports add-on and prepaid text messages.`,
});

const CLINFORMS_HOST = BRANDS.clinforms.hosts[0];
const GROUP_CARD = PLAN_CARDS.find((c) => c.key === "group") ?? PLAN_CARDS[PLAN_CARDS.length - 1];
const PLAN_TAPES = ["tape--coral", "tape--sun", "tape--teal", "tape--pink", "tape--coral"];

export default function PricingPage() {
  return (
    <SitePage current="/pricing">
      <PricingHero />
      <Plans />
      <ReportsAddOn />
      <TextMessages />
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

/** A price on each billing interval: only the chosen one shows (pricing.css), both without CSS. */
function MonthYear({ month, year }: { month: ReactNode; year: ReactNode }) {
  return (
    <>
      <span className="when-month">{month}</span>
      <span className="when-year">{year}</span>
    </>
  );
}

/** 1 · Pricing hero */
function PricingHero() {
  return (
    <section className="p-hero g-sky" aria-labelledby="pricing-title">
      <div className="wrap grid12">
        <div className="p-hero-copy">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:10 · Sam, doing the sums</p>
          <h1 className="display-xxl" id="pricing-title">Priced by your <span className="hl">team size.<span className="tape tape--sun hl-tape" aria-hidden="true" /></span></h1>
          <p className="lead">
            <span className="t-long"><b>One monthly price, set by how many practitioners you have – from {FROM_PRICE}.</b> Every feature on every plan, with unlimited reception staff, sites and patients.</span>
            <span className="t-short"><b>Plans by number of practitioners, from {FROM_PRICE}.</b> Every feature on every plan.</span>
          </p>
          <p className="p-vat"><Fill k="pricing.vat" /> · <TrialSummary /></p>
          <div className="p-ctas">
            <a className="btn btn-coral" href="/demo">Book a demo <span className="arr" aria-hidden="true">→</span></a>
            <StartTrialButton />
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
          <div className="product frag p-plan-frag" role="img" aria-label={`A fictional clinic’s plan summary: Pebblegate Physio on the ${GROUP_CARD.name} plan (${GROUP_CARD.practitioners}) at ${GROUP_CARD.price.month} a month, 11 practitioners across 3 sites, with the Reports add-on, next invoice 01/12/2026. Sample data, fictional.`}>
            <span className="ftag p-tag">Sample data (fictional)</span>
            {" "}
            <span className="p-frag-k">Your plan · Pebblegate Physio</span>
            {" "}
            <b className="p-frag-plan">{GROUP_CARD.name} · {GROUP_CARD.price.month} a month</b>
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

const EVERY_PLAN_FEATURES = [
  "Diary and online booking",
  "Patient records and signed notes",
  "Letters, templates and intake forms",
  "Invoicing and card payments",
  "Insurer, case-management and medico-legal billing",
  "Authorisations",
  "Patient portal",
  "Reminders and messages",
  "Multi-site diary and central booking",
  "Roles and multi-site admin",
  "Reporting",
];

/** 2 · Plans */
function Plans() {
  return (
    <section className="plans g-couch" id="plans" aria-labelledby="plans-title">
      <div className="wrap">
        <div className="plans-head">
          <div>
            <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:15 · count the practitioners</p>
            <h2 className="display-l" id="plans-title">From one treatment room to {LARGEST_BAND_MAX} practitioners</h2>
            <p className="body plans-lead">Pick the plan for the number of practitioners at your clinic. Every plan has every feature, with unlimited reception staff, sites and patients.</p>
          </div>
          <fieldset className="bill-switch">
            <legend className="bill-legend">Show prices</legend>
            <div className="bill-opts">
              <label className="bill-opt" htmlFor="bill-month">
                <input type="radio" name="billing" id="bill-month" value="month" defaultChecked />
                <span>Monthly</span>
              </label>
              <label className="bill-opt" htmlFor="bill-year">
                <input type="radio" name="billing" id="bill-year" value="year" />
                <span>Yearly <span className="bill-save">{FREE_MONTHS_TEXT}</span></span>
              </label>
            </div>
          </fieldset>
        </div>
        <ul className="plan-grid">
          {PLAN_CARDS.map((card, i) => (
            <li className="plan-wrap" key={card.key}>
              <article className="plan" aria-labelledby={`pl-${card.key}`}>
                <span className={`tape ${PLAN_TAPES[i % PLAN_TAPES.length]} plan-tape`} aria-hidden="true" />
                <h3 className="display-m" id={`pl-${card.key}`}>{card.name}</h3>
                <p className="plan-for">{card.practitioners}</p>
                <p className="plan-price">
                  <MonthYear
                    month={<><span className="plan-amt">{card.price.month}</span> <span className="plan-unit">a month</span></>}
                    year={<><span className="plan-amt">{card.price.year}</span> <span className="plan-unit">a year · {FREE_MONTHS_TEXT}</span></>}
                  />
                </p>
                <a className="btn btn-outline plan-btn" href="/demo">Book a demo<span className="vh"> for the {card.name} plan</span> <span className="arr" aria-hidden="true">→</span></a>
              </article>
            </li>
          ))}
          <li className="plan-wrap">
            <article className="plan plan--groups on-dark" aria-labelledby="pl-larger">
              <span className="tape tape--teal plan-tape" aria-hidden="true" />
              <h3 className="display-m" id="pl-larger">Larger groups</h3>
              <p className="plan-for">Over {LARGEST_BAND_MAX} practitioners</p>
              <p className="plan-price">
                <span className="plan-amt plan-amt--talk">Talk to us</span>
                <span className="plan-unit">a plan built around your sites</span>
              </p>
              <a className="btn btn-coral plan-btn" href="/demo">Talk to us <span className="arr" aria-hidden="true">→</span></a>
            </article>
          </li>
        </ul>
        <div className="plan-every">
          <h3 className="display-m">Every plan includes</h3>
          <ul className="plan-every-list">
            <li className="plan-every-key"><span className="tb" aria-hidden="true" />Unlimited reception staff, sites and patients</li>
            {EVERY_PLAN_FEATURES.map((f) => (
              <li key={f}><span className="tb tb--teal" aria-hidden="true" />{f}</li>
            ))}
          </ul>
          <p className="small plans-note">
            Paying yearly costs ten months’ price – {FREE_MONTHS_TEXT}. <Fill k="pricing.vat" />.
          </p>
        </div>
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
            <span className="addon addon--tilt">Add-on</span>
          </div>
          <p className="pen marker" style={cssVars({"--tilt": "-1.5deg"})}>17:25 · the add-on</p>
          <h2 className="display-l" id="addon-title">Works with any plan</h2>
          <p className="body">
            <span className="t-long"><b>Referrers’ own report forms, completed from your notes and signed by the physio.</b> Add it to any plan – the form arrives mostly filled, and nothing leaves until it’s signed.</span>
            <span className="t-short">
              <b>Referrers’ own report forms, completed from your notes and signed by the physio.</b>
            </span>
          </p>
          <table className="addon-tiers">
            <caption className="vh">Reports add-on prices</caption>
            <thead>
              <tr>
                <th scope="col">Reports a month</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {REPORTS_TIERS.map((t) => (
                <tr key={t.key}>
                  <th scope="row">Up to {t.reports}</th>
                  <td>
                    <MonthYear month={<><b>{t.price.month}</b> a month</>} year={<><b>{t.price.year}</b> a year</>} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small addon-extra">Extra reports {EXTRA_REPORT_PRICE} each. Billed with your plan, monthly or yearly.</p>
          <a className="btn btn-pine" href="/reports">About Reports <span className="arr" aria-hidden="true">→</span></a>
          <p className="small addon-alone">
            On another clinic system? {CLINFORMS_NAME} works on its own:{" "}
            <a className="link" href={BRANDS.clinforms.siteUrl}>{CLINFORMS_HOST}</a>
          </p>
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

/** 4 · Text messages */
function TextMessages() {
  return (
    <section className="p-texts g-cardboard" id="texts" aria-labelledby="texts-title">
      <div className="wrap grid12">
        <div className="p-texts-text">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:30 · reminders out</p>
          <h2 className="display-l" id="texts-title">Text messages, paid as you go</h2>
          <p className="body">
            Appointment reminders and messages by text use prepaid credits. Buy a pack when you need one – one credit sends one text of up to 160 characters.
          </p>
          <ul className="p-texts-notes small">
            <li><span className="tb tb--teal" aria-hidden="true" />Credits don’t expire while your account is open.</li>
            <li><span className="tb tb--teal" aria-hidden="true" />Nothing is sent on credit, and credits are not refundable.</li>
          </ul>
        </div>
        <ul className="pack-grid" aria-label="Text message packs">
          {TEXT_PACKS.map((p) => (
            <li className="pack" key={p.key}>
              <span className="pack-n">{p.credits}</span>
              <span className="pack-k">credits</span>
              <span className="pack-price">{p.price}</span>
              <span className="pack-each">{p.perText}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** 5 · With every plan */
function WithEveryPlan() {
  return (
    <section className="p-every g-pine on-dark" aria-labelledby="every-title">
      <div className="wrap">
        <div className="every-head">
          <p className="pen marker" style={cssVars({"--tilt": "-2deg"})}>17:35 · whichever you pick</p>
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

/** "500, 1,000 or 5,000" */
function orList(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items.join("");
}

/** 6 · FAQs */
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
            <summary>Can we pay yearly?</summary>
            <p className="body">Yes. A year costs ten months’ price – {FREE_MONTHS_TEXT}. The Reports add-on is billed the same way as your plan.</p>
          </details>
          <details>
            <summary>What if our team grows?</summary>
            <p className="body">Your plan follows the number of practitioners. If you add more than your plan covers, we’ll suggest the next plan up – nothing stops working. Over {LARGEST_BAND_MAX} practitioners, <a className="link" href="/demo">talk to us</a>.</p>
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
            <p className="body">Reports is an add-on to any plan, for up to {REPORTS_ALLOWANCES} reports a month. {REPORTS_FROM}. Each report above your allowance is {EXTRA_REPORT_PRICE}.</p>
          </details>
          <details>
            <summary>How do text messages work?</summary>
            <p className="body">Texts are prepaid: buy a pack of {orList(TEXT_PACKS.map((p) => p.credits))} credits ({orList(TEXT_PACKS.map((p) => p.price))}). Credits don’t expire while your account is open, and they’re not refundable.</p>
          </details>
          <details>
            <summary>Is there a free trial?</summary>
            <p className="body">Yes. <TrialSummary /> – <a className="link" href="/demo">book a demo</a> to get started.</p>
          </details>
          <details>
            <summary>Do prices include VAT?</summary>
            <p className="body"><Fill k="pricing.vat" />.</p>
          </details>
        </div>
      </div>
    </section>
  );
}
