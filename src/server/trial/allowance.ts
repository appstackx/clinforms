/**
 * The self-serve free trial's reports (docs/clinic-system/trial.md): `included` free reports for the whole trial (the
 * clinic's "Trial" package, written at sign-up – a paid plan's own package replaces it) and `used` = the clinic's
 * reports that have counted so far. The Report API refuses live drafting for a new report once they are used
 * (src/modules/medreport/auth/clinic-access.ts assertTrialReportsLeft). Null for every clinic without a self-serve trial
 * (and for a sample clinic – it has no Reports). Pure server code (no Next imports).
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { readClinicPackage } from "../repos/clinic-package";
import { readSelfTrial } from "../repos/self-trial";
import { countBillableReports } from "../repos/usage";
import { isMissingUsageTable } from "../repos/usage-period";

export interface TrialReportAllowance {
  included: number;
  used: number;
  /** The clinic brand: "buy the Reports add-on"; ClinForms: "choose a plan". */
  addon: boolean;
}

export async function trialReportAllowance(db: Kysely<Database>, tenantId: string): Promise<TrialReportAllowance | null> {
  const trial = await readSelfTrial({ db }, tenantId);
  if (!trial || trial.sampleOf) return null;
  const pkg = await readClinicPackage({ db }, tenantId);
  // A paid plan's package (anything but "Trial") – no trial cap.
  if (pkg && pkg.package !== "trial") return null;
  let used = 0;
  try {
    used = await countBillableReports({ db }, tenantId);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
  }
  return { included: pkg ? pkg.reportsIncluded : trial.reportsIncluded, used, addon: trial.brand === "clinic" };
}
