import type { ReactNode } from "react";
import { TOUR_PATH } from "@/lib/clindesk-site/tour-video";

/**
 * The link to the 3-minute tour (/tour): a small coral play mark and an underlined label, in the site's .link style.
 * `href` lets a page open the tour at its own chapter (tourChapterHref).
 */
export function TourLink({ href = TOUR_PATH, children = "Watch the 3-minute tour", className }: { href?: string; children?: ReactNode; className?: string }) {
  return (
    <a className={`link tour-link${className ? ` ${className}` : ""}`} href={href}>
      <span className="tour-link-dot" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
      {children}
    </a>
  );
}
