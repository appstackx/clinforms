/**
 * 15/11/2026 (Khuram): what the menus say about report forms during a self-serve trial – the free reports left, and,
 * in a trial's SAMPLE clinic (no report forms there on purpose), the owner's real clinic to switch to. Never throws.
 */
import type { Kysely } from "kysely";
import type { TrialBannerState } from "../../lib/trial-copy";
import type { Membership } from "../auth/membership";
import type { Database } from "../db/schema";
import { readSelfTrial } from "../repos/self-trial";

/** "8 of 10 free reports left" while a self-serve trial with free reports runs; undefined otherwise. */
export function freeReportsNote(trial: TrialBannerState | null | undefined): string | undefined {
  if (!trial || trial.state !== "trial" || !trial.selfServe || trial.selfServe.reportsIncluded <= 0) return undefined;
  const { reportsIncluded: included, reportsUsed: used } = trial.selfServe;
  const left = Math.max(0, included - used);
  return left === 0 ? `All ${included} free reports used` : `${left} of ${included} free reports left`;
}

/** For a sample clinic: the member's real clinic (it must be one of their clinics). null for every other clinic. */
export async function sampleClinicHome(
  db: Kysely<Database>,
  tenantId: string,
  memberships: readonly Membership[],
): Promise<{ organizationId: string; clinicName: string } | null> {
  try {
    const trial = await readSelfTrial({ db }, tenantId);
    if (!trial?.sampleOf) return null;
    const home = memberships.find((m) => m.tenantId === trial.sampleOf);
    return home ? { organizationId: home.organizationId, clinicName: home.clinicName } : null;
  } catch {
    return null;
  }
}
