/**
 * The trial banner at the top of the clinic area (/app) and of the clinic's Studio (/app/studio). Browser-safe and
 * pure. The wording itself lives in src/lib/account-copy.ts (TRIAL_COPY, the single source; neutral wording checked in
 * src/lib/trial-copy.test.ts and src/server/auth/neutral-copy.test.ts).
 */
import { TRIAL_COPY } from "./account-copy";
import { TRIAL_KEEP_DAYS, addUkDays, ukDayStart } from "./trial";

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
  /**
   * 14/11/2026: after an unpaid trial – the UK day ("YYYY-MM-DD") the clinic will be deleted (90 days after the end, or
   * the day the deletion warning promised); the banner names the day BEFORE (the last day kept – the deletion runs early
   * that morning). Absent while the trial runs, after paying, and for the sample of a paid clinic.
   */
  keptUntil?: string | null;
  /** keptUntil is exactly the 90 days (not a later day a late warning promised). */
  keptNinetyDays?: boolean;
}

const UK_LONG_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "Friday 26 February 2027" for a UK day. */
function ukDayLong(day: string): string {
  return UK_LONG_DAY.format(ukDayStart(day)).replace(",", "");
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
    }.`,
  ended: "Your free trial has ended. Your data is safe: you can still open and download everything, but nothing new can be added or changed until a plan is chosen.",
  /** 14/11/2026: an unpaid self-serve trial – kept for 90 days, then deleted. */
  endedKept: (deletionDay: string, ninetyDays = true) =>
    `Your free trial has ended. Your data is safe and kept${ninetyDays ? ` for ${TRIAL_KEEP_DAYS} days` : ""}, until ${ukDayLong(addUkDays(deletionDay, -1))}: you can still open and download everything, but nothing new can be added or changed until a plan is chosen.`,
  choosePlan: "Choose a plan",
} as const;

export const PLAN_AND_BILLING_PATH = "/app/settings/billing";

/** 14/11/2026: the query a start page is reloaded with after "Remove sample clinic" (it then shows a notice). */
export const SAMPLE_REMOVED_PARAM = "sample";

/** The banner for this state, or null (no trial, or a full account). */
export function trialBanner(access: TrialBannerState | null | undefined, contactEmail: string): TrialBanner | null {
  if (!access || access.state === "full") return null;
  if (access.state === "read_only") return { tone: "warning", text: access.text, ...(access.canChoosePlan ? { link: { href: PLAN_AND_BILLING_PATH, label: "Plan and billing" } } : {}) };
  const self = access.selfServe;
  const link = self?.canChoosePlan ? { href: PLAN_AND_BILLING_PATH, label: SELF_SERVE_TRIAL_COPY.choosePlan } : undefined;
  if (access.state === "trial_ended") {
    if (self) return { tone: "warning", text: self.keptUntil ? SELF_SERVE_TRIAL_COPY.endedKept(self.keptUntil, self.keptNinetyDays !== false) : SELF_SERVE_TRIAL_COPY.ended, ...(link ? { link } : {}) };
    return { tone: "warning", text: TRIAL_COPY.ended(contactEmail) };
  }
  if (self) return { tone: "info", text: SELF_SERVE_TRIAL_COPY.running(Math.max(1, access.daysLeft), self), ...(link ? { link } : {}) };
  return { tone: "info", text: TRIAL_COPY.running(Math.max(1, access.daysLeft)) };
}
