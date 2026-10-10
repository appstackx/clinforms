import Link from "next/link";
import { TrackedLink } from "../analytics/tracked-link";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { DEMO_HREF, DEMO_VIDEO_HREF, MARKETING_NAV, REQUEST_ACCESS_HREF, SIGN_IN_HREF, btn } from "./nav";

const navLink =
  "rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 aria-[current=page]:bg-slate-100 aria-[current=page]:text-slate-900";

/**
 * Public site header: logo, navigation (incl. "Demo video", the recorded walk-through at /demo, and "Interactive demo",
 * the sandbox at /reports), "Sign in", "Request access". The link to the page being shown carries aria-current="page".
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 lg:flex">
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
        <div className="ml-auto flex items-center gap-2">
          <Link href={SIGN_IN_HREF} prefetch={false} className={`${navLink} hidden sm:inline-flex`}>
            Sign in
          </Link>
          <Link href={REQUEST_ACCESS_HREF} className={`${btn.small} hidden sm:inline-flex`}>
            Request access
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
