import Link from "next/link";
import { BRANDS, CLINIC_SYSTEM_NAME, PUBLIC_SITE_BRAND, type Brand } from "@/lib/brand";
import { COMPANY, companyRegistrationLine, registeredOfficeLine } from "@/lib/site";
import { CookieSettingsButton } from "../consent/cookie-settings-button";
import { Logo } from "./logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/security", label: "Security" },
      { href: "/demo", label: "Demo video" },
      { href: "/reports", label: "Interactive demo" },
      { href: "/request-access", label: "Request access" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/cookies", label: "Cookie policy" },
      { href: "/terms", label: "Terms of service" },
    ],
  },
] as const;

/**
 * Public site footer (ClinDesk's footer pattern on dark green, styles/site.css .site-footer): brand, the line to
 * ClinDesk (same makers – a plain link to clindesk.co.uk, counted as cross_site_clicked), contact, link columns with
 * cookie settings, the company line and, last and small, the registered office; the big faded name is decorative.
 */
export function SiteFooter({ brand = PUBLIC_SITE_BRAND }: { brand?: Brand }) {
  const registration = companyRegistrationLine();
  const office = registeredOfficeLine();
  return (
    <footer className="site-footer g-pine on-dark">
      <div className="wrap">
        <div className="f-grid cf-f-grid">
          <div className="f-brand">
            <Logo name={brand.productName} />
            <p className="f-tag">
              Completes each referrer&rsquo;s own report form from your clinic notes, ready for your clinician to review and
              approve.
            </p>
            <p className="f-tag cf-f-contact">
              Contact:{" "}
              <a className="link" href={`mailto:${COMPANY.contactEmail}`}>
                {COMPANY.contactEmail}
              </a>
            </p>
            <p className="cf-family">
              <a className="link" href={BRANDS.clinic.siteUrl}>
                From the makers of {CLINIC_SYSTEM_NAME} <span className="arr" aria-hidden="true">→</span>
              </a>
            </p>
            <div className="f-sign">
              <span className="stamp f-stamp" aria-hidden="true">
                <svg viewBox="0 0 140 140">
                  <circle className="ring" cx="70" cy="70" r="64" />
                  <circle className="ring-thin" cx="70" cy="70" r="44" />
                  <path className="sig" d="M42 72 L60 90 L98 50" />
                </svg>
              </span>
              <p className="pen">Checked. Approved. Sent.</p>
            </div>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} className="f-col" aria-label={column.title}>
              <h2 className="f-h">{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} prefetch={link.href === "/reports" || link.href === "/login" ? false : undefined}>
                      {link.label}
                    </Link>
                  </li>
                ))}
                {column.title === "Legal" ? (
                  <li>
                    <CookieSettingsButton className="f-cookie-btn" />
                  </li>
                ) : null}
              </ul>
            </nav>
          ))}
        </div>
        <div className="small f-legal cf-f-company">
          <p>
            {brand.productName} is a product of {COMPANY.legalName}. © {new Date().getFullYear()} {COMPANY.legalName}.
          </p>
          {registration ? <p>{registration}</p> : null}
        </div>
        {office ? (
          <p className="f-office" data-registered-office="">
            {office}
          </p>
        ) : null}
      </div>
      <div className="f-giant" aria-hidden="true">
        {brand.productName}
      </div>
    </footer>
  );
}
