"use client";

/**
 * Header menu below 1100 px (ClinDesk's <details> menu, styles/site.css .menu): opens a sheet under the header. It
 * closes when a link is followed (the layout stays mounted between pages) and on Escape.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TrackedLink } from "../analytics/tracked-link";
import { DEMO_HREF, DEMO_VIDEO_HREF, MARKETING_NAV, REQUEST_ACCESS_HREF, SIGN_IN_HREF, btn } from "./nav";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const item = "cf-menu-item";
  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);

  return (
    <details className="menu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="tb tb--teal" aria-hidden="true" />
        Menu
      </summary>
      <nav aria-label="Main (mobile)" className="menu-sheet">
        {MARKETING_NAV.map((link) => (
          <Link key={link.href} href={link.href} className={item} aria-current={current(link.href)} onClick={() => setOpen(false)}>
            {link.label}
          </Link>
        ))}
        <Link href={DEMO_VIDEO_HREF} className={item} aria-current={current(DEMO_VIDEO_HREF)} onClick={() => setOpen(false)}>
          Demo video
        </Link>
        <TrackedLink href={DEMO_HREF} prefetch={false} className={item} event="demo_opened" eventProps={{ area: "marketing", cta: "mobile_nav" }}>
          Interactive demo
        </TrackedLink>
        <Link href={SIGN_IN_HREF} prefetch={false} className={item} onClick={() => setOpen(false)}>
          Sign in
        </Link>
        <Link href={REQUEST_ACCESS_HREF} className={btn.primary} onClick={() => setOpen(false)}>
          Request access <span className="arr" aria-hidden="true">→</span>
        </Link>
      </nav>
    </details>
  );
}
