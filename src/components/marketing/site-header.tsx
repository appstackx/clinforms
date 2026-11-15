import Link from "next/link";
import { TrackedLink } from "../analytics/tracked-link";
import { PUBLIC_SITE_BRAND, type Brand } from "@/lib/brand";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { DEMO_HREF, DEMO_VIDEO_HREF, MARKETING_NAV, REQUEST_ACCESS_HREF, SIGN_IN_HREF, btn } from "./nav";

/** Header links: laid out by the site's design system (.nav a – the current page gets the coral bar). */
const navLink = "cf-navlink";

/**
 * Public site header (ClinDesk's header pattern, src/components/clindesk/site-header.tsx): logo, navigation (incl.
 * "Demo video", the recorded walk-through at /demo, and "Interactive demo", the sandbox at /reports), "Sign in" and
 * "Request access" from 1100 px; below that a short "Request access" button and the menu. The link to the page being
 * shown carries aria-current="page".
 */
export function SiteHeader({ brand = PUBLIC_SITE_BRAND }: { brand?: Brand }) {
  return (
    <header className="site-header">
      <div className="wrap hbar">
        <Logo name={brand.productName} />
        <nav aria-label="Main" className="nav">
          {MARKETING_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} className={navLink}>
              {item.label}
            </NavLink>
          ))}
          <NavLink href={DEMO_VIDEO_HREF} className={navLink}>
            Demo video
          </NavLink>
          <TrackedLink href={DEMO_HREF} prefetch={false} className={navLink} event="demo_opened" eventProps={{ area: "marketing", cta: "header" }}>
            Interactive demo
          </TrackedLink>
        </nav>
        <div className="hactions">
          <Link href={SIGN_IN_HREF} prefetch={false} className="signin">
            Sign in
          </Link>
          <Link href={REQUEST_ACCESS_HREF} className={btn.small}>
            Request access <span className="arr" aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="hright">
          <Link href={REQUEST_ACCESS_HREF} className={`${btn.small} hdemo-s`}>
            Request access
          </Link>{" "}
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
