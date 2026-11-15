/** Public site navigation (header, mobile menu). */
export const MARKETING_NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
] as const;

/** The interactive demo (Studio with fictional patients). */
export const DEMO_HREF = "/reports";
/** The product demo video (src/app/(marketing)/demo). */
export const DEMO_VIDEO_HREF = "/demo";
export const REQUEST_ACCESS_HREF = "/request-access";
/** Clinic members sign in here (invitation-only accounts, two-step verification required). */
export const SIGN_IN_HREF = "/login";

/**
 * Shared button styles for the public site: the ClinDesk design system's buttons (src/components/clindesk/styles/site.css,
 * loaded by the site's layout) – coral main button (white on #C4432B, about 5:1), dark-green outline, dark-green solid.
 */
export const btn = {
  primary: "btn btn-coral",
  secondary: "btn btn-outline",
  dark: "btn btn-pine",
  small: "btn btn-coral",
} as const;
