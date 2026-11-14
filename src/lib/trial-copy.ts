/**
 * The trial banner at the top of the clinic area (/app) and of the clinic's Studio (/app/studio). Browser-safe and
 * pure. The wording itself lives in src/lib/account-copy.ts (TRIAL_COPY, the single source; neutral wording checked in
 * src/lib/trial-copy.test.ts and src/server/auth/neutral-copy.test.ts).
 */
import { TRIAL_COPY } from "./account-copy";

export { TRIAL_COPY } from "./account-copy";

/**
 * 13/11/2026: a SELF-SERVE free trial (self sign-up – src/server/trial): its free reports, and whether the member may
 * choose a plan (owners and admins see the link). Absent for a trial ClinForms staff set by hand (wording as before).
 */
export interface SelfServeTrialInfo {
  reportsIncluded: number;
  reportsUsed: number;
  /** Owners and admins: "Choose a plan" links to Plan and billing. */
  canChoosePlan: boolean;
}

/** What a clinic's plan means now, as the banner needs it (the server's ClinicAccess, structurally). */
export type TrialBannerState =
  | { state: "full" }
  | { state: "trial"; daysLeft: number; endsAt: string | null; pending: boolean; selfServe?: SelfServeTrialInfo }
  | { state: "trial_ended"; endedAt: string; selfServe?: SelfServeTrialInfo }
  /** 13/11/2026: a self-serve trial's product the paid plan does not include – its records read-only (the text says so). */
  | { state: "read_only"; text: string; canChoosePlan: boolean };

export interface TrialBanner {
  tone: "info" | "warning";
  text: string;
  /** A link after the text (self-serve trials: Plan and billing). */
  link?: { href: string; label: string };
}

export const SELF_SERVE_TRIAL_COPY = {
  running: (daysLeft: number, info: SelfServeTrialInfo) =>
    `Free trial – ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left${
      info.reportsIncluded > 0 ? ` · ${info.reportsUsed} of ${info.reportsIncluded} free reports used` : ""
    }. Use made-up patient details only during the trial.`,
  ended: "Your free trial has ended. Your data is safe: you can still open and download everything, but nothing new can be added or changed until a plan is chosen.",
  choosePlan: "Choose a plan",
} as const;

export const PLAN_AND_BILLING_PATH = "/app/settings/billing";

/** The banner for this state, or null (no trial, or a full account). */
export function trialBanner(access: TrialBannerState | null | undefined, contactEmail: string): TrialBanner | null {
  if (!access || access.state === "full") return null;
  if (access.state === "read_only") return { tone: "warning", text: access.text, ...(access.canChoosePlan ? { link: { href: PLAN_AND_BILLING_PATH, label: "Plan and billing" } } : {}) };
  const self = access.selfServe;
  const link = self?.canChoosePlan ? { href: PLAN_AND_BILLING_PATH, label: SELF_SERVE_TRIAL_COPY.choosePlan } : undefined;
  if (access.state === "trial_ended") {
    if (self) return { tone: "warning", text: SELF_SERVE_TRIAL_COPY.ended, ...(link ? { link } : {}) };
    return { tone: "warning", text: TRIAL_COPY.ended(contactEmail) };
  }
  if (self) return { tone: "info", text: SELF_SERVE_TRIAL_COPY.running(Math.max(1, access.daysLeft), self), ...(link ? { link } : {}) };
  return { tone: "info", text: TRIAL_COPY.running(Math.max(1, access.daysLeft)) };
}
