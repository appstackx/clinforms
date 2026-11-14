/**
 * After a self-serve free trial ends without a paid plan (docs/clinic-system/trial.md): the clinic system is
 * READ-ONLY – every record stays readable (diary, patients, notes, invoices, letters, reports, exports), nothing new
 * is created or changed. The same rule the Report API has always applied to an ended trial (403 TRIAL_ENDED), now for
 * the clinic system too, and ONLY for clinics that came from self sign-up (a self_trial row – their sample clinic
 * included): a trial ClinForms staff set by hand keeps its earlier behaviour. Paying (Plan and billing) and buying
 * text credits always work. Nothing is ever deleted.
 *
 * Pure server code over a database handle (no Next imports). Fails OPEN on a read error (never locks a clinic out of
 * its own records because a table could not be read) – the trial's end is also enforced by the Report API.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { clinicAccessOf, readClinicPlan } from "../repos/clinic-plan";
import { readSelfTrial } from "../repos/self-trial";

/** Permissions that only READ: still allowed once the trial has ended. */
export const READ_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([
  "clinic.view",
  "diary.view",
  "patients.view",
  "patients.referral",
  "clinical.view",
  "billing.view",
  "reports.own",
  "reports.all",
  "reports.export",
  "reports.view",
  "patients.export",
]);

export const TRIAL_ENDED_MESSAGE =
  "Your free trial has ended, so nothing new can be added or changed. Your data is safe: you can still open and download everything. The clinic owner can choose a plan under Plan and billing to carry on.";

/** Whether the clinic's self-serve trial has ended without a paid plan (then the clinic system is read-only). */
export async function selfTrialEnded(db: Kysely<Database>, tenantId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const plan = await readClinicPlan({ db }, tenantId);
    if (clinicAccessOf(plan, now).state !== "trial_ended") return false;
    return Boolean(await readSelfTrial({ db }, tenantId));
  } catch {
    return false;
  }
}

/** Whether `permission` is refused because the self-serve trial ended (`allowAfterTrial`: paying, buying credits). */
export function pausedByEndedTrial(permission: string, allowAfterTrial = false): boolean {
  return !allowAfterTrial && !READ_ONLY_PERMISSIONS.has(permission);
}
