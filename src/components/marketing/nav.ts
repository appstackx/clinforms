/** Public site navigation (header, mobile menu). */
export const MARKETING_NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
] as const;

export const DEMO_HREF = "/reports";
export const REQUEST_ACCESS_HREF = "/request-access";

/** Shared button styles for the public site (teal-700 on white text passes WCAG AA contrast). */
export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-teal-900/10 transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2",
  small:
    "inline-flex items-center justify-center rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2",
} as const;
