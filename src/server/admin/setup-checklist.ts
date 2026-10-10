/**
 * The clinic overview's set-up checklist (fix wave 2, from the end-to-end review): what a new clinic still has to
 * do before its first form – clinic details, drafting from the notes, members, signing details, a confirmed
 * referrer form. Ids and counts only; read from the clinic's own rows.
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { getClinicProfile } from "../repos/clinic-profile";
import { listMemberProfiles } from "../repos/member-profile";

export interface SetupChecklist {
  /** Name, address and postcode are on the clinic profile (they appear on completed forms). */
  clinicDetails: boolean;
  /** Drafting from the notes is switched on (off for a new clinic). */
  draftingEnabled: boolean;
  /** At least one member besides the owner, or an open invitation. */
  team: boolean;
  /** At least one member who may sign (HCPC number and "may sign"). */
  signer: boolean;
  /** At least one confirmed referrer form in the library. */
  confirmedForm: boolean;
}

export async function loadSetupChecklist(
  db: Kysely<Database>,
  clinic: { tenantId: string; organizationId: string },
  counts: { members: number; openInvitations: number },
): Promise<SetupChecklist> {
  const [profile, profiles, forms] = await Promise.all([
    getClinicProfile({ db }, clinic.tenantId),
    listMemberProfiles({ db }, clinic.organizationId),
    db
      .selectFrom("forms")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("tenant_id", "=", clinic.tenantId)
      .where("status", "=", "confirmed")
      .executeTakeFirst(),
  ]);
  return {
    clinicDetails: Boolean(profile && profile.displayName.trim() && (profile.address ?? []).some((l) => l.trim()) && profile.postcode),
    draftingEnabled: profile?.draftingEnabled === true,
    team: counts.members > 1 || counts.openInvitations > 0,
    signer: profiles.some((p) => p.canSign && Boolean(p.hcpcNumber)),
    confirmedForm: Number(forms?.n ?? 0) > 0,
  };
}
