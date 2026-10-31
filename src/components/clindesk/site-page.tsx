import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader, type ClindeskNavPath } from "./site-header";

/**
 * Every ClinDesk page: the site wrapper (.cd-site – all of the site's CSS is scoped under it, styles/site.css), the
 * skip link, the header (marking `current`), the page's sections in <main id="main"> and the footer.
 */
export function SitePage({ current, children }: { current: ClindeskNavPath; children: ReactNode }) {
  return (
    <div className="cd-site site">
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <SiteHeader current={current} />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
