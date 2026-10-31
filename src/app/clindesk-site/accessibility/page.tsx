import { Fill } from "@/components/clindesk/fill";
import { SitePage } from "@/components/clindesk/site-page";
import { CLINDESK_APEX_HOST, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { ACCESSIBILITY_LAST_UPDATED, CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { COMPANY, formatLongDate } from "@/lib/site";
import "@/components/clindesk/styles/legal.css";

/**
 * /accessibility on clindesk.co.uk – a short, honest accessibility statement for this website (not designed in the
 * export; written in the site's own type and colours). It states only what was built and checked.
 */
export const metadata = clindeskMetadata({
  path: "/accessibility",
  title: `Accessibility – ${CLINIC_SYSTEM_NAME}`,
  description: `How accessible the ${CLINIC_SYSTEM_NAME} website is, how it was checked and how to tell us about a problem.`,
});

export default function AccessibilityPage() {
  return (
    <SitePage current="other">
      <section className="lg-page g-couch" aria-labelledby="acc-title">
        <div className="wrap lg-wrap">
          <p className="label lg-kicker">Accessibility statement</p>
          <h1 className="display-xl" id="acc-title">
            A website everyone can use
          </h1>
          <p className="small muted lg-updated">
            Last updated: <time dateTime={ACCESSIBILITY_LAST_UPDATED}>{formatLongDate(ACCESSIBILITY_LAST_UPDATED)}</time>
          </p>
          <p className="lead">
            This statement covers this website, {CLINDESK_APEX_HOST}. It does not cover the {CLINIC_SYSTEM_NAME}{" "}
            application clinics sign in to.
          </p>

          <h2 className="display-m">What we aim for</h2>
          <p className="body">
            We built this website to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. In practice that
            means:
          </p>
          <ul className="lg-list body">
            <li>every page has a skip link, a clear heading order and labelled navigation;</li>
            <li>every form field has a visible label, and errors are explained in words next to the field;</li>
            <li>you can reach every link, button and field with a keyboard, and you can always see where you are;</li>
            <li>text has a contrast of at least 4.5:1 (3:1 for large text) and buttons and links are at least 44 pixels high;</li>
            <li>pages work at 320 pixels wide without scrolling sideways, and at 400% zoom;</li>
            <li>pages work without JavaScript, including the menu, the questions on the pricing page and the demo form;</li>
            <li>movement stops if your device asks for reduced motion;</li>
            <li>drawings are decorative and hidden from screen readers; each product picture has a written description.</li>
          </ul>

          <h2 className="display-m">How we checked</h2>
          <p className="body">
            Before launch every page was checked at 1440, 375 and 320 pixels wide with an automated accessibility checker,
            and with scripted checks for sideways scrolling, target sizes, the skip link from the keyboard and use without
            JavaScript. We will check again whenever the website changes.
          </p>

          <h2 className="display-m">Known problems</h2>
          <p className="body">We are not aware of any part of this website that does not meet WCAG 2.2 AA. If you find one, please tell us.</p>

          <h2 className="display-m">Tell us about a problem</h2>
          <p className="body">
            If something on this website is hard to use, or you need information in a different format, email{" "}
            <a className="link" href={`mailto:${CONTACT_EMAIL}?subject=Accessibility`}>
              {CONTACT_EMAIL}
            </a>
            . We will reply within <Fill k="contact.responseTime" />.
          </p>
          <p className="small muted lg-org">This website is run by {COMPANY.legalName}.</p>
        </div>
      </section>
    </SitePage>
  );
}
