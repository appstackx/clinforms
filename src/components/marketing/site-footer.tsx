import Link from "next/link";
import { PRODUCT } from "@/modules/medreport/config.public";
import { COMPANY, companyRegistrationLine } from "@/lib/site";
import { CookieSettingsButton } from "../consent/cookie-settings-button";
import { LogoMark } from "./logo";

const footerLink =
  "rounded text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/security", label: "Security" },
      { href: "/reports", label: "Try the demo" },
      { href: "/request-access", label: "Request access" },
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

/** Public site footer: links, legal, cookie settings, company line, contact. */
export function SiteFooter() {
  const registration = companyRegistrationLine();
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <LogoMark className="h-7 w-7" />
            {PRODUCT.name}
          </div>
          <p className="max-w-sm text-sm text-slate-600">
            Completes each referrer&rsquo;s own report form from your clinic notes, ready for your clinician to
            review and approve.
          </p>
          <p className="text-sm text-slate-600">
            Contact:{" "}
            <a href={`mailto:${COMPANY.contactEmail}`} className={`${footerLink} font-medium text-teal-800`}>
              {COMPANY.contactEmail}
            </a>
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-sm font-semibold text-slate-900">{column.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={footerLink} prefetch={link.href === "/reports" ? false : undefined}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {column.title === "Legal" ? (
                <li>
                  <CookieSettingsButton className={footerLink} />
                </li>
              ) : null}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-slate-600 sm:px-6 lg:px-8">
          <p>
            {PRODUCT.name} is a product of {COMPANY.legalName}. © {new Date().getFullYear()} {COMPANY.legalName}.
          </p>
          {registration ? <p>{registration}</p> : null}
        </div>
      </div>
    </footer>
  );
}
