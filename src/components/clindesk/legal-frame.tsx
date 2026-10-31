import type { ReactNode } from "react";
import { SitePage } from "./site-page";

/**
 * A ClinDesk legal page (privacy, terms, cookies – ClinDesk's own text in src/app/clindesk-site, laid out with the
 * shared LegalPage of src/components/marketing/legal-page.tsx) inside the ClinDesk header and footer. `.cd-prose`
 * keeps the site's browser-default rules (styles/site.css) off the legal text, which is styled with the app's own
 * Tailwind classes.
 */
export function LegalFrame({ children }: { children: ReactNode }) {
  return (
    <SitePage current="other">
      <div className="cd-prose cd-legal">{children}</div>
    </SitePage>
  );
}
