"use client";

/** Header menu below the lg breakpoint (four links do not fit beside the buttons at md): a disclosure button and a panel under the header. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";
import { TrackedLink } from "../analytics/tracked-link";
import { DEMO_HREF, DEMO_VIDEO_HREF, MARKETING_NAV, REQUEST_ACCESS_HREF, SIGN_IN_HREF, btn } from "./nav";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const item =
    "block rounded-lg px-3 py-2.5 text-base font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-16 border-b border-slate-200 bg-white px-4 pb-4 pt-2 shadow-lg"
      >
        <nav aria-label="Main (mobile)" className="space-y-1">
          {MARKETING_NAV.map((link) => (
            <Link key={link.href} href={link.href} className={item} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link href={DEMO_VIDEO_HREF} className={item} onClick={() => setOpen(false)}>
            Watch the demo
          </Link>
          <TrackedLink href={DEMO_HREF} prefetch={false} className={item} event="demo_opened" eventProps={{ area: "marketing", cta: "mobile_nav" }}>
            Try the demo
          </TrackedLink>
          <Link href={SIGN_IN_HREF} prefetch={false} className={item} onClick={() => setOpen(false)}>
            Sign in
          </Link>
          <Link href={REQUEST_ACCESS_HREF} className={`${btn.primary} mt-2 w-full`} onClick={() => setOpen(false)}>
            Request access
          </Link>
        </nav>
      </div>
    </div>
  );
}
