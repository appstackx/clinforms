/**
 * ClinDesk's website and the self-serve free trial (13/11/2026): when self sign-up is ON for the clinic brand
 * (CLINFORMS_SELF_SIGNUP includes "clinic" – src/lib/self-signup.ts), the home hero, the pricing page and the header
 * offer "Start free trial" next to "Book a demo", and the pricing page's trial sentence becomes
 * "14-day free trial, no card needed" (the trial's length from CLINFORMS_TRIAL_DAYS). When it is off, nothing changes:
 * no link to the sign-up, and the sentence stays content/clindesk-site.json's pricing.trialSummary exactly.
 * Read at render (the website's pages are built with the deployment's settings – changing the switch needs a redeploy,
 * as the sign-up runbook already says).
 */
import { SIGNUP_PATH, selfSignupEnabled } from "../self-signup";
import { trialDays } from "../trial";
import { contentText } from "./content";

type Env = Readonly<Record<string, string | undefined>>;

export const START_TRIAL_LABEL = "Start free trial";
export const START_TRIAL_HREF = SIGNUP_PATH;

/** Whether ClinDesk's website offers the free trial. */
export function clindeskTrialOffered(env: Env = process.env): boolean {
  return selfSignupEnabled("clinic", env);
}

/** The pricing page's trial sentence: the switch's wording when on, else the content file's value (as before). */
export function clindeskTrialSummary(env: Env = process.env): { text: string; filled: boolean } {
  if (clindeskTrialOffered(env)) return { text: `${trialDays(env)}-day free trial, no card needed`, filled: true };
  const t = contentText("pricing.trialSummary");
  return { text: t.text, filled: t.filled };
}
