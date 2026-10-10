/**
 * Links to the public website's legal and trust pages, shown in the Studio footer in both modes (the
 * public demo and a clinic's own Studio). The pages live on the host site at fixed paths.
 */
import Link from "next/link";
import { cn } from "../../primitives";

export const STUDIO_LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/cookies", label: "Cookie policy" },
  { href: "/terms", label: "Terms" },
  // "(website)": the Studio's own "Security & GDPR" page is a different page (fix wave 3, demo review).
  { href: "/security", label: "Security (website)" },
] as const;

export function StudioLegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {STUDIO_LEGAL_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          prefetch={false}
          className="rounded underline-offset-2 hover:text-slate-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
