/**
 * What the clinic's pages show about a self-serve free trial (13/11/2026): the banner's extra facts (free reports used,
 * "Choose a plan" for owners and admins) and the sample-clinic offer. Never throws – a trial that cannot be read shows
 * the plain trial banner (src/lib/trial-copy.ts) and no offer.
 */
import type { Kysely } from "kysely";
import type { TrialBannerState } from "../../lib/trial-copy";
import type { Database } from "../db/schema";
import { readSelfTrial, type SelfTrial } from "../repos/self-trial";
import type { ClinicAccess } from "../repos/clinic-plan";
import { trialReportAllowance } from "./allowance";

/** The banner state for the clinic: ClinicAccess plus, for a self-serve trial, its free reports and the plan link. */
export async function trialBannerState(db: Kysely<Database>, tenantId: string, access: ClinicAccess | null | undefined, canChoosePlan: boolean): Promise<TrialBannerState | null> {
  if (!access) return null;
  if (!access || access.state === "full") return access;
  try {
    const trial = await readSelfTrial({ db }, tenantId);
    if (!trial) return access;
    const allowance = trial.sampleOf ? null : await trialReportAllowance(db, tenantId);
    return { ...access, selfServe: { reportsIncluded: allowance?.included ?? 0, reportsUsed: allowance?.used ?? 0, canChoosePlan: canChoosePlan && !trial.sampleOf } };
  } catch {
    return access;
  }
}

/** The sample-clinic offer: shown to the OWNER of a self-serve trial clinic while the trial runs and no sample exists. */
export async function sampleOfferFor(db: Kysely<Database>, tenantId: string, role: string, access: ClinicAccess | null): Promise<{ trial: SelfTrial } | null> {
  if (role !== "owner" || access?.state !== "trial") return null;
  try {
    const trial = await readSelfTrial({ db }, tenantId);
    // ClinDesk trials only: the sample is the clinic system's demonstration data (a ClinForms trial has no clinic system).
    if (!trial || trial.sampleOf || trial.brand !== "clinic" || trial.sampleState === "declined" || trial.sampleState === "ready") return null;
    return { trial };
  } catch {
    return null;
  }
}
