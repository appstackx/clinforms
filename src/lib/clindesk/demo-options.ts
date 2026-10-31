/** ClinDesk "Book a demo" choices (browser-safe: the form and the server's validation, demo-request.ts, share them). */

/** "Number of sites" – the design's bands (ClinDesk serves 1 to 15 sites). */
export const DEMO_SITE_BANDS = ["1", "2–5", "6–15"] as const;
export type DemoSitesBand = (typeof DEMO_SITE_BANDS)[number];

/** "What would you like to see?" – checkbox values and the labels stored and shown. */
export const DEMO_INTERESTS = {
  diary: "The diary",
  notes: "Notes and letters",
  billing: "Billing and insurers",
  reports: "Reports add-on",
  multisite: "Multi-site",
} as const;
export type DemoInterest = keyof typeof DEMO_INTERESTS;
