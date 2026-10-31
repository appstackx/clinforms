import type { ReactNode } from "react";
import { SitePage } from "./site-page";

/**
 * A reused legal page (privacy, terms, cookies – the same text as on clinforms.co.uk, src/app/(marketing)) inside the
 * ClinDesk header and footer. `.cd-prose` keeps the site's browser-default rules (styles/site.css) off the legal
 * text, which is styled with the app's own Tailwind classes.
 */
export function LegalFrame({ children }: { children: ReactNode }) {
  return (
    <SitePage current="other">
      <div className="cd-prose cd-legal">{children}</div>
    </SitePage>
  );
}
