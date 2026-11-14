/**
 * What the clinic's pages show about a self-serve free trial (13/11/2026): the banner's extra facts (free reports used,
 * "Choose a plan" for owners and admins) and the sample-clinic offer. Never throws – a trial that cannot be read shows
 * the plain trial banner (src/lib/trial-copy.ts) and no offer.
 */
import type { Kysely } from "kysely";
import { londonDay, trialDeletionDay } from "../../lib/trial";
import type { TrialBannerState } from "../../lib/trial-copy";
import type { Database } from "../db/schema";
import { readSelfTrial, type SelfTrial } from "../repos/self-trial";
import type { ClinicAccess } from "../repos/clinic-plan";
import { trialReportAllowance } from "./allowance";
import { trialWriteBlock } from "./access";
import { noteClinicVisit } from "../admin/clinic-plan";

/**
 * The banner state for the clinic: ClinicAccess plus, for a self-serve trial, its free reports and the plan link; and
 * (13/11/2026) after converting, the read-only notice for `product` when the paid plan does not include it. Every other
 * clinic: the ClinicAccess exactly as before.
 */
export async function trialBannerState(
  db: Kysely<Database>,
  tenantId: string,
  access: ClinicAccess | null | undefined,
  canChoosePlan: boolean,
  product?: "clinic" | "reports",
): Promise<TrialBannerState | null> {
  if (!access) return null;
  if (access.state === "full") {
    if (!product || access.plan !== "paid") return access;
    const block = await trialWriteBlock(db, tenantId, product);
    return block?.reason === "read_only" ? { state: "read_only", text: block.message, canChoosePlan } : access;
  }
  try {
    const trial = await readSelfTrial({ db }, tenantId);
    if (!trial) return access;
    const allowance = trial.sampleOf ? null : await trialReportAllowance(db, tenantId);
    const kept = access.state === "trial_ended" ? await keptUntilFor(db, trial, access.endedAt) : null;
    return {
      ...access,
      selfServe: {
        reportsIncluded: allowance?.included ?? 0,
        reportsUsed: allowance?.used ?? 0,
        canChoosePlan: canChoosePlan && !trial.sampleOf,
        ...(kept ? { keptUntil: kept.day, keptNinetyDays: kept.ninety } : {}),
      },
    };
  } catch {
    return access;
  }
}

/**
 * 14/11/2026: the UK day an ended, unpaid self-serve trial's clinic will be deleted (the day its deletion warning
 * promised, else 90 days after the end) – for a sample clinic, its real clinic's (they go together). null after paying.
 */
async function keptUntilFor(db: Kysely<Database>, trial: SelfTrial, endedAt: string): Promise<{ day: string; ninety: boolean } | null> {
  const owner = trial.sampleOf ? await readSelfTrial({ db }, trial.sampleOf) : trial;
  if (!owner || owner.convertedAt || owner.deletedAt) return null;
  const standard = trialDeletionDay(endedAt);
  const promised = owner.deletionDueAt ? londonDay(owner.deletionDueAt) : null;
  // A date promised for an earlier end (the trial was extended since) does not count.
  const day = promised && promised > standard ? promised : standard;
  return { day, ninety: day === standard };
}

/** The sample-clinic offer: shown to the OWNER of a self-serve trial clinic while the trial runs and no sample exists. */
export async function sampleOfferFor(db: Kysely<Database>, tenantId: string, role: string, access: ClinicAccess | null): Promise<{ trial: SelfTrial } | null> {
  if (role !== "owner" || access?.state !== "trial") return null;
  try {
    const trial = await readSelfTrial({ db }, tenantId);
    // ClinDesk trials only: the sample is the clinic system's demonstration data (a ClinForms trial has no clinic system).
    if (!trial || trial.sampleOf || trial.brand !== "clinic" || trial.sampleState === "declined" || trial.sampleState === "ready" || trial.sampleState === "removed") return null;
    return { trial };
  } catch {
    return null;
  }
}

/**
 * The clinic system's shell (/app/clinic): ONLY for a clinic with a self-serve trial (a self_trial row) – its owner's
 * first visit there starts the trial (a ClinDesk owner lands in the clinic system) and the banner shows. Every other
 * clinic – including a trial ClinForms staff set by hand – gets nothing here, exactly as before (null, no write).
 */
export async function clinicShellTrial(
  db: Kysely<Database>,
  visit: { tenantId: string; userId: string; sessionId?: string; role: string },
  canChoosePlan: boolean,
): Promise<TrialBannerState | null> {
  const trial = await readSelfTrial({ db }, visit.tenantId).catch(() => null);
  if (!trial) return null;
  const access = await noteClinicVisit(db, visit);
  return trialBannerState(db, visit.tenantId, access, canChoosePlan, "clinic");
}
