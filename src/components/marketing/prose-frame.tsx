import type { ReactNode } from "react";

/**
 * A ClinForms page whose content keeps the app's own Tailwind styling (legal pages, security, the demo video page, the
 * request form) inside the site's design system: `.cd-prose` keeps the design system's browser-default rules
 * (src/components/clindesk/styles/site.css) off the content, as ClinDesk's legal pages do, and `.cf-prose`
 * (styles/cf-site.css) gives it the site's ground, display headings, colours and links.
 */
export function ProseFrame({ children }: { children: ReactNode }) {
  return <div className="cd-prose cf-prose">{children}</div>;
}
