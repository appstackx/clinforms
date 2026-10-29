import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  /** Absent for the current page (the last item). */
  href?: string;
}

/** A link element: "a" by default; screens pass next/link's Link for client navigation. */
type LinkLike = React.ElementType<{ href: string; className?: string; children?: React.ReactNode }>;

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  linkAs?: LinkLike;
  className?: string;
}

const linkCls =
  "rounded-[4px] text-[#475569] underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The item a phone's back link goes to: the last one with a link before the current page. */
export function parentOf(items: readonly BreadcrumbItem[]): BreadcrumbItem | null {
  for (let i = items.length - 2; i >= 0; i--) if (items[i].href) return items[i];
  return null;
}

/**
 * Breadcrumb (brief Part A): where this page sits ("Patients › Margaret Ellis › Note 27/10/2026"), the current page last
 * with aria-current="page" and no link. On a phone it becomes a single "‹ Back to Margaret Ellis" link (44 px tall) to
 * the parent, so a long trail never wraps into three lines.
 */
export function Breadcrumb({ items, linkAs: L = "a", className }: BreadcrumbProps) {
  const parent = parentOf(items);
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0 text-sm", className)}>
      <ol className="hidden min-w-0 flex-wrap items-center gap-1.5 sm:flex">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {item.href && !last ? (
                <L href={item.href} className={linkCls}>
                  {item.label}
                </L>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "font-medium text-foreground" : "text-[#475569]")}>
                  {item.label}
                </span>
              )}
              {!last ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#64748B]" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
      {parent?.href ? (
        <div className="sm:hidden">
          <BackLink href={parent.href} linkAs={L}>
            Back to {parent.label}
          </BackLink>
        </div>
      ) : null}
    </nav>
  );
}

/** "‹ Back to …" on its own (a page with no trail, or a phone header). 44 px tall on a phone. */
export function BackLink({ href, children, linkAs: L = "a", className }: { href: string; children: React.ReactNode; linkAs?: LinkLike; className?: string }) {
  return (
    <L
      href={href}
      className={cn(
        "inline-flex min-h-9 items-center gap-1 rounded-[6px] text-sm font-medium text-primary-strong underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-sm:min-h-11",
        className,
      )}
    >
      <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </L>
  );
}
