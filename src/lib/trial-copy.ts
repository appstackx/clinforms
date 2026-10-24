/**
 * Customer-facing wording for a clinic's trial (10/2026): the banner at the top of the clinic area (/app) and of the
 * clinic's Studio (/app/studio). Browser-safe and pure; neutral wording only (checked with the module's banned terms
 * in src/lib/trial-copy.test.ts).
 */

/** What a clinic's plan means now, as the banner needs it (the server's ClinicAccess, structurally). */
export type TrialBannerState =
  | { state: "full" }
  | { state: "trial"; daysLeft: number; endsAt: string | null; pending: boolean }
  | { state: "trial_ended"; endedAt: string };

export interface TrialBanner {
  tone: "info" | "warning";
  text: string;
}

export const TRIAL_COPY = {
  running: (daysLeft: number) =>
    `Trial – ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left. Use made-up or anonymised notes until your data processing agreement is signed.`,
  ended: (contactEmail: string) =>
    `Your trial has ended. You can still open and download your existing reports and forms. To create new reports, upload files or read new forms, contact us at ${contactEmail}.`,
} as const;

/** The banner for this state, or null (no trial, or a full account). */
export function trialBanner(access: TrialBannerState | null | undefined, contactEmail: string): TrialBanner | null {
  if (!access || access.state === "full") return null;
  if (access.state === "trial_ended") return { tone: "warning", text: TRIAL_COPY.ended(contactEmail) };
  return { tone: "info", text: TRIAL_COPY.running(Math.max(1, access.daysLeft)) };
}
