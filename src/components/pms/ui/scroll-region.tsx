"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface ScrollRegionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The region's accessible name ("Invoices", "Letter preview"). */
  label: string;
  children: React.ReactNode;
}

/**
 * A box that scrolls on its own (a wide table on a phone, an A4 sheet) and can be reached by keyboard (WCAG 2.1.1):
 * while its content overflows it is a named region in the tab order, so arrow keys scroll it. When nothing overflows it
 * is a plain div (no extra tab stop). The server renders the focusable form, so the page is never unreachable before
 * the script runs.
 */
export function ScrollRegion({ label, className, children, ...rest }: ScrollRegionProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = React.useState(true);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      {...rest}
      {...(scrolls ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
      data-scroll-region={scrolls ? "scrolls" : "fits"}
      className={cn("focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", className)}
    >
      {children}
    </div>
  );
}
