import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CONTACT_EMAIL } from "@/lib/clindesk/site";
import { COMPANY } from "@/lib/site";
import { Fill } from "./fill";
import { Logo } from "./logo";

/** Footer of every page: brand, product / company / legal links, company line (fill-ins) and the sample-data note. */
export function SiteFooter() {
  return (
    <footer className="site-footer g-pine on-dark">
      <div className="wrap">
        <div className="f-grid">
          <div className="f-brand">
            <Logo id="ftr" />
            <p className="f-tag">Practice software for UK physiotherapy and MSK clinics.</p>
            <div className="f-sign">
              <span className="stamp f-stamp" aria-hidden="true">
                <svg viewBox="0 0 140 140">
                  <circle className="ring" cx="70" cy="70" r="64" />
                  <circle className="ring-thin" cx="70" cy="70" r="44" />
                  <path
                    className="sig"
                    d="M44 82 C 47 62, 57 52, 60 61 C 62 70, 52 75, 48 70 M62 84 C 65 75, 71 71, 73 77 C 75 83, 70 86, 78 81 M80 79 C 84 71, 88 70, 90 74 C 92 79, 88 84, 97 78"
                  />
                </svg>
              </span>
              <p className="pen">18:30 · Notes signed. Lights off.</p>
            </div>
          </div>
          <nav className="f-col" aria-labelledby="f-product">
            <h2 className="f-h" id="f-product">
              Product
            </h2>
            <ul>
              <li>
                <a href="/features">Features</a>
              </li>
              <li>
                <a href="/reports">
                  Referrer reports <span className="addon">Add-on</span>
                </a>
              </li>
              <li>
                <a href="/pricing">Pricing</a>
              </li>
              <li>
                <a href="/switching">Switching to {CLINIC_SYSTEM_NAME}</a>
              </li>
              <li>
                <a href="/security">Security and data</a>
              </li>
            </ul>
          </nav>
          <nav className="f-col" aria-labelledby="f-company">
            <h2 className="f-h" id="f-company">
              Company
            </h2>
            <ul>
              <li>
                <a href="/demo">Book a demo</a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
              </li>
              <li>
                <a href="/login">Sign in</a>
              </li>
            </ul>
          </nav>
          <nav className="f-col f-legalnav" aria-labelledby="f-legal">
            <h2 className="f-h" id="f-legal">
              Legal
            </h2>
            <ul>
              <li>
                <a href="/privacy">Privacy</a>
              </li>
              <li>
                <a href="/terms">Terms</a>
              </li>
              <li>
                <a href="/cookies">Cookies</a>
              </li>
              <li>
                <a href="/accessibility">Accessibility</a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="small f-legal">
          © 2026 {COMPANY.legalName} · Made in the UK · Company no. <Fill k="company.number" /> · Registered office: <Fill k="company.registeredOffice" /> ·{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        <p className="small f-fine">Names, clinics, insurers and figures shown on this site are fictional sample data.</p>
      </div>
      <div className="f-giant" aria-hidden="true">
        {CLINIC_SYSTEM_NAME}
      </div>
    </footer>
  );
}
