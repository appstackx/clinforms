/**
 * The trial banner at the top of the clinic area (/app) and of the clinic's Studio (/app/studio). Browser-safe and
 * pure. The wording itself lives in src/lib/account-copy.ts (TRIAL_COPY, the single source; neutral wording checked in
 * src/lib/trial-copy.test.ts and src/server/auth/neutral-copy.test.ts).
 */
import { TRIAL_COPY } from "./account-copy";

export { TRIAL_COPY } from "./account-copy";

/** What a clinic's plan means now, as the banner needs it (the server's ClinicAccess, structurally). */
export type TrialBannerState =
  | { state: "full" }
  | { state: "trial"; daysLeft: number; endsAt: string | null; pending: boolean }
  | { state: "trial_ended"; endedAt: string };

export interface TrialBanner {
  tone: "info" | "warning";
  text: string;
}

/** The banner for this state, or null (no trial, or a full account). */
export function trialBanner(access: TrialBannerState | null | undefined, contactEmail: string): TrialBanner | null {
  if (!access || access.state === "full") return null;
  if (access.state === "trial_ended") return { tone: "warning", text: TRIAL_COPY.ended(contactEmail) };
  return { tone: "info", text: TRIAL_COPY.running(Math.max(1, access.daysLeft)) };
}
