/** ClinDesk "Book a demo" choices (browser-safe: the form and the server's validation, demo-request.ts, share them). */
import { CLINDESK_BANDS } from "@/lib/billing/plans";

/** "Number of sites" (Khuram 01/11/2026: the Multi-site plan goes to 200 practitioners, so up to "Over 30"). */
export const DEMO_SITE_BANDS = ["1", "2–5", "6–15", "16–30", "Over 30"] as const;
export type DemoSitesBand = (typeof DEMO_SITE_BANDS)[number];

const n = (v: number) => v.toLocaleString("en-GB");

/** The most practitioners a listed plan covers (above it: "Over …"). */
const LARGEST_BAND_MAX = Math.max(...CLINDESK_BANDS.map((b) => b.max));

/**
 * "Number of practitioners" – the pricing bands of the billing plan table (src/lib/billing/plans.ts CLINDESK_BANDS:
 * "1", "2–5", "6–10", "11–25", "26–200") plus "Over 200". No number is typed here: change a band there and the form,
 * the server's validation and the stored request follow. The option value is the text shown and stored.
 */
export const DEMO_PRACTITIONER_BANDS: readonly [string, ...string[]] = [
  ...CLINDESK_BANDS.map((b) => (b.min === b.max ? n(b.min) : `${n(b.min)}–${n(b.max)}`)),
  `Over ${n(LARGEST_BAND_MAX)}`,
] as unknown as readonly [string, ...string[]];

/** "What would you like to see?" – checkbox values and the labels stored and shown. */
export const DEMO_INTERESTS = {
  diary: "The diary",
  notes: "Notes and letters",
  billing: "Billing and insurers",
  reports: "Reports add-on",
  multisite: "Multi-site",
} as const;
export type DemoInterest = keyof typeof DEMO_INTERESTS;
