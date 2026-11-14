/**
 * What a self-serve free trial's clinic may still CHANGE (docs/clinic-system/trial.md §2–3). Owner principle: never
 * lose access to data – everything stays readable and downloadable; only new writes stop:
 *
 *   trial_ended   the trial ended without a plan: every write in the clinic system (server actions, the clinic area's
 *                 POST routes, the clinic API's writes, scheduled reminders and campaigns, public booking) is refused.
 *   read_only     the clinic paid for ONE product and the trial's other product (its data kept, its package left on
 *                 as "trial") is read-only: "Add ClinDesk / the Reports add-on to keep working on these".
 *
 * ONLY clinics that came from self sign-up (a self_trial row – their sample clinic included); a trial ClinForms staff
 * set by hand, and every other clinic, are never affected. Paying (Plan and billing) and buying text credits always
 * work. Nothing is deleted here (14/11/2026: an unpaid trial clinic is deleted 90 days after its end by ./retention.ts). Pure server code over a database handle (no Next imports). Fails OPEN on a read error
 * (never locks a clinic out of its own records because a table could not be read) – the Report API enforces the trial
 * on its own too.
 */
import type { Kysely } from "kysely";
import { CLINIC_SYSTEM_NAME, REPORTS_ADDON_NAME } from "../../lib/brand";
import type { Database } from "../db/schema";
import { clinicAccessOf, readClinicPlan } from "../repos/clinic-plan";
import { getEntitlement } from "../repos/pms/entitlements";
import { readSelfTrial } from "../repos/self-trial";

export const TRIAL_ENDED_MESSAGE =
  "Your free trial has ended, so nothing new can be added or changed. Your data is safe: you can still open and download everything. The clinic owner can choose a plan under Plan and billing to carry on.";

/** "Read-only – add <product> to keep working on these" (a product of the trial that the paid plan does not include). */
export function readOnlyProductMessage(pkg: "clinic" | "reports"): string {
  const add = pkg === "clinic" ? CLINIC_SYSTEM_NAME : `the ${REPORTS_ADDON_NAME} add-on`;
  return `Read-only – these records are from your free trial and stay available to open and download. Add ${add} to your plan under Plan and billing to keep working on them.`;
}

export type TrialWriteBlock = { reason: "trial_ended"; message: string } | { reason: "read_only"; message: string };

/**
 * Whether writes to `pkg` ("clinic" = the clinic system, "reports" = the Studio) are blocked for the clinic now, and
 * why. One read for every clinic without a self-serve trial (its plan); null = writes allowed.
 */
export async function trialWriteBlock(db: Kysely<Database>, tenantId: string, pkg: "clinic" | "reports", now: Date = new Date()): Promise<TrialWriteBlock | null> {
  try {
    const plan = await readClinicPlan({ db }, tenantId);
    if (!plan) return null;
    if (plan.status === "trial") {
      if (clinicAccessOf(plan, now).state !== "trial_ended") return null;
      return (await readSelfTrial({ db }, tenantId)) ? { reason: "trial_ended", message: TRIAL_ENDED_MESSAGE } : null;
    }
    if (plan.status !== "paid") return null;
    const trial = await readSelfTrial({ db }, tenantId);
    if (!trial?.convertedAt) return null;
    // Converted: a package still on "trial" is the trial's product the plan did not include – kept readable only.
    const e = await getEntitlement({ db, now: () => now }, tenantId, pkg);
    return e?.status === "trial" ? { reason: "read_only", message: readOnlyProductMessage(pkg) } : null;
  } catch {
    return null;
  }
}

/** Whether the clinic's self-serve trial has ended without a plan (then everything is read-only). */
export async function selfTrialEnded(db: Kysely<Database>, tenantId: string, now: Date = new Date()): Promise<boolean> {
  return (await trialWriteBlock(db, tenantId, "clinic", now))?.reason === "trial_ended";
}
