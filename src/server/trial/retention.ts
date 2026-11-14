/**
 * After a self-serve free trial that ended WITHOUT a plan (owner decision 14/11/2026, docs/clinic-system/trial.md §2):
 * the clinic stays read-only for TRIAL_KEEP_DAYS (90) days after the trial's end, its owner gets ONE branded warning
 * TRIAL_DELETION_NOTICE_DAYS (14) days before, and then the clinic is deleted for good – through the offboarding's own
 * deletes (src/server/auth/platform.ts offboardClinic, `withoutExport`): every record and stored file, its memberships
 * and the accounts that belong to no other clinic; the organization row stays as a tombstone, the audit trail, the
 * acceptance records and the billing records stay, exactly as an offboarding keeps them. Its SAMPLE clinic goes with it
 * (first). The self_trial row is kept (keyed hashes and counts – the abuse brakes still see the earlier trial) and
 * marked deleted.
 *
 * Run by the EXISTING daily cron (/api/cron/retention, after the trial emails; only after a successful retention pass).
 * Safe to run twice or at the same time:
 *   - the warning is claimed per clinic and per owner (trial_email, kind deletion_warning – ./emails.ts sendTrialEmail);
 *   - the date it promises is recorded (self_trial.deletion_due_at) and never moves earlier once an owner has it; a
 *     warning that goes late (the sweep was off, the provider refused it) promises 14 days from the day it goes; a
 *     warning for an EARLIER end (staff extended or restarted the trial since) is forgotten and a fresh one goes;
 *   - nothing is deleted unless an owner was actually SENT the warning for the current end, at least 14 UK days before,
 *     and the promised day has come;
 *   - the deletion is claimed per clinic (one conditional UPDATE, stale after 30 minutes); a deletion that stopped
 *     part-way (a crash, a timeout, a failed batch) keeps its claim and is FINISHED by a later run;
 *   - right before deleting, everything is read again: still a self-serve trial (never a trial ClinForms staff set by
 *     hand – those have no self_trial row), not converted, the plan still an ENDED trial (staff may have extended or
 *     converted it), no subscription that is not over, no payment page opened in the last 48 hours, the clinic open;
 *   - the stored files' keys are saved before the rows go and removed after them (retried until removed).
 * A clinic that paid is never touched – nor the sample clinic of a clinic that paid (its owner may remove it: ./sample.ts).
 *
 * Never throws into the cron: failures are logged (no clinic id, no address) and counted.
 */
import type { Kysely } from "kysely";
import { TRIAL_DELETION_NOTICE_DAYS, addUkDays, londonDay, trialDeletionDay, trialDeletionDayIfWarnedAt, trialDeletionWarningDay, ukDayStart } from "../../lib/trial";
import { offboardClinic } from "../auth/platform";
import type { Database } from "../db/schema";
import { logAuthEvent } from "../email/log";
import { listAudit } from "../repos/audit";
import { clinicAccessOf, readClinicPlan } from "../repos/clinic-plan";
import { readClinicSubscription } from "../repos/clinic-subscription";
import { nowIso, type DbContext } from "../repos/context";
import {
  TRIAL_DELETION_CLAIM_STALE_MS,
  claimTrialDeletion,
  clearPendingDeletionFiles,
  deleteTrialReportHolds,
  getSelfTrial,
  listSelfTrials,
  listTrialEmails,
  markTrialDeleted,
  releaseTrialDeletionClaim,
  resetTrialDeletionWarning,
  savePendingDeletionFiles,
  setTrialDeletionDue,
  type SelfTrial,
} from "../repos/self-trial";
import { getFileStore } from "../storage/file-store";
import { sendTrialEmail, type TrialEmailDeps } from "./emails";

/** Subscription statuses that are over (the payment service's): anything else means a payment may be under way. */
const SUBSCRIPTION_OVER = new Set(["canceled", "incomplete_expired"]);
/** A payment page opened this recently holds the deletion (the payment service's pages expire within 24 hours). */
const CHECKOUT_HOLD_MS = 48 * 3_600_000;

export type DeleteReason = "trial_expired" | "trial_expired_sample" | "sample_removed";

export interface TrialRetentionDeps extends TrialEmailDeps {
  /** Time budget for the whole pass (the cron's other steps share its minute); the rest goes the next night. */
  budgetMs?: number;
  /** At most this many clinics deleted per run (default 10). */
  maxDeletions?: number;
  /** Tests: called before each clinic's own deletion (default: nothing). */
  beforeDelete?: (tenantId: string, reason: DeleteReason) => Promise<void>;
}

export interface TrialRetentionResult {
  clinics: number;
  warned: number;
  deleted: number;
  samplesDeleted: number;
  /** Due for deletion but held back: no owner has received the warning (yet). */
  held: number;
  /** Deletions that had stopped part-way, finished now. */
  resumed: number;
  failed: number;
  deferred: number;
}

type Why = "not_self_serve" | "sample" | "deleted" | "converted" | "no_end" | "not_ended" | "paid" | "subscription" | "checkout" | "closed";

const isClosed = (metadata: string | null | undefined) => Boolean(metadata && /"offboardedAt"/.test(metadata));

async function orgOf(db: Kysely<Database>, tenantId: string): Promise<{ id: string; open: boolean; sampleOf: string | null } | null> {
  const org = await db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", tenantId).executeTakeFirst();
  if (!org) return null;
  let sampleOf: string | null = null;
  try {
    const m = org.metadata ? (JSON.parse(org.metadata) as Record<string, unknown>) : null;
    sampleOf = m && typeof m.sampleOf === "string" ? m.sampleOf : null;
  } catch {
    sampleOf = null;
  }
  return { id: org.id, open: !isClosed(org.metadata), sampleOf };
}

/** Whether a payment page was opened for the clinic recently (it may still be paid). */
async function recentCheckout(ctx: DbContext, tenantId: string, now: Date): Promise<boolean> {
  const rows = await listAudit(ctx, tenantId, { action: "clinic.subscription_checkout", limit: 1 });
  return rows.some((r) => now.getTime() - Date.parse(r.at) < CHECKOUT_HOLD_MS);
}

/** Whether the clinic is an unpaid, ended, open self-serve trial now – read fresh: its trial and end, or why not. */
export async function unpaidEndedTrial(db: Kysely<Database>, tenantId: string, now: Date): Promise<{ why: Why } | { trial: SelfTrial; endsAt: string }> {
  const ctx: DbContext = { db, now: () => now };
  const trial = await getSelfTrial(ctx, tenantId);
  if (!trial) return { why: "not_self_serve" };
  if (trial.sampleOf) return { why: "sample" };
  if (trial.deletedAt) return { why: "deleted" };
  if (trial.convertedAt) return { why: "converted" };
  const plan = await readClinicPlan(ctx, tenantId);
  if (!plan || plan.status !== "trial") return { why: plan?.status === "paid" ? "paid" : "not_self_serve" };
  if (!plan.trialEndsAt) return { why: "no_end" };
  if (clinicAccessOf(plan, now).state !== "trial_ended") return { why: "not_ended" };
  const sub = await readClinicSubscription(ctx, tenantId);
  if (sub && !SUBSCRIPTION_OVER.has(sub.status)) return { why: "subscription" };
  if (await recentCheckout(ctx, tenantId, now)) return { why: "checkout" };
  const org = await orgOf(db, tenantId);
  if (!org?.open) return { why: "closed" };
  return { trial, endsAt: plan.trialEndsAt };
}

/** The first moment an owner was SENT the deletion warning, or null. */
async function firstWarningSentAt(ctx: DbContext, tenantId: string): Promise<string | null> {
  const rows = await listTrialEmails(ctx, tenantId, { recipients: true });
  const sent = rows.filter((r) => r.kind === "deletion_warning" && r.recipientRef !== "" && r.status === "sent" && r.sentAt).map((r) => r.sentAt as string);
  return sent.length ? sent.sort()[0] : null;
}

/** Removes stored files whose keys were saved for a deleted clinic, then forgets them. */
async function removePendingFiles(ctx: DbContext, tenantId: string): Promise<void> {
  const trial = await getSelfTrial(ctx, tenantId);
  if (!trial?.pendingFileKeys.length) return;
  const store = getFileStore();
  if (!store) throw new Error("The file store is not configured here: the stored files of a deleted clinic are still to remove.");
  await store.remove(trial.pendingFileKeys);
  await clearPendingDeletionFiles(ctx, tenantId);
}

/**
 * Deletes ONE clinic of a self-serve trial (the trial clinic, or a sample clinic) through the offboarding's deletes, its
 * stored-file keys kept on its self_trial row until the files are gone, then marks the row deleted. Idempotent: a closed
 * clinic is only finished (pending files, holds, the mark).
 */
export async function deleteTrialTenant(db: Kysely<Database>, tenantId: string, reason: DeleteReason, options: { now?: () => Date; byUserId?: string } = {}): Promise<void> {
  const ctx: DbContext = { db, now: options.now };
  const org = await orgOf(db, tenantId);
  if (org?.open) {
    await offboardClinic(db, null, {
      slug: tenantId,
      confirm: true,
      withoutExport: {
        reason,
        byUserId: options.byUserId,
        saveFileKeys: (keys) => savePendingDeletionFiles(ctx, tenantId, keys),
        filesRemoved: () => clearPendingDeletionFiles(ctx, tenantId),
      },
    });
  }
  await removePendingFiles(ctx, tenantId);
  await deleteTrialReportHolds(ctx, tenantId);
  await markTrialDeleted(ctx, tenantId);
}

/**
 * The trial clinic's sample clinic, if it has one that is still to delete: the id the trial recorded, confirmed by the
 * sample's own self_trial row OR its organization's `sampleOf` (written with the organization – a crash before the
 * sample's row was written still leaves it recognisable). Never any other clinic.
 */
export async function sampleOfTrial(db: Kysely<Database>, trial: SelfTrial): Promise<string | null> {
  const id = trial.sampleTenantId;
  if (!id || id === trial.tenantId || trial.sampleOf) return null;
  const sample = await getSelfTrial({ db }, id);
  if (sample && sample.sampleOf !== trial.tenantId) return null;
  if (sample?.deletedAt) return null;
  const org = await orgOf(db, id);
  if (!sample && org?.sampleOf !== trial.tenantId) return null;
  if (sample && org && org.sampleOf !== null && org.sampleOf !== trial.tenantId) return null;
  return id;
}

export type DeleteOutcome = { status: "deleted"; sampleDeleted: boolean; resumed?: boolean } | { status: "skipped"; why: Why | "claimed" | "not_due" | "not_warned" };

/**
 * Deletes ONE unpaid trial clinic now (and its sample clinic first), with every check re-read. Throws only when a
 * deletion step failed: before anything was deleted the claim is given back; once deleting has begun the claim is kept
 * and a later run finishes the job (resumeTrialDeletion).
 */
export async function deleteUnpaidTrialClinic(db: Kysely<Database>, tenantId: string, deps: Pick<TrialRetentionDeps, "now" | "beforeDelete"> = {}): Promise<DeleteOutcome> {
  const now = deps.now ? deps.now() : new Date();
  const ctx: DbContext = { db, now: () => now };
  const before = await unpaidEndedTrial(db, tenantId, now);
  if ("why" in before) return { status: "skipped", why: before.why };
  const due = before.trial.deletionDueAt;
  const sentAt = await firstWarningSentAt(ctx, tenantId);
  if (!due || !sentAt) return { status: "skipped", why: "not_warned" };
  // A warning for an earlier end (the trial was extended or restarted since) does not count.
  if (trialDeletionDay(before.endsAt) > londonDay(due)) return { status: "skipped", why: "not_warned" };
  // The promised day, and 14 UK days after the warning actually went – both must have come.
  const earliest = [londonDay(due), addUkDays(londonDay(sentAt), TRIAL_DELETION_NOTICE_DAYS)].sort().at(-1) as string;
  if (londonDay(now) < earliest) return { status: "skipped", why: "not_due" };
  if (!(await claimTrialDeletion(ctx, tenantId))) return { status: "skipped", why: "claimed" };
  let started = false;
  try {
    // Read everything again under the claim (a payment, a staff change or another run meanwhile).
    const fresh = await unpaidEndedTrial(db, tenantId, now);
    if ("why" in fresh) {
      await releaseTrialDeletionClaim(ctx, tenantId);
      return { status: "skipped", why: fresh.why };
    }
    let sampleDeleted = false;
    const sampleId = await sampleOfTrial(db, fresh.trial);
    if (sampleId) {
      started = true;
      await deps.beforeDelete?.(sampleId, "trial_expired_sample");
      await deleteTrialTenant(db, sampleId, "trial_expired_sample", { now: () => now });
      // The real clinic no longer has a sample (whatever happens next).
      await db.updateTable("self_trial").set({ sample_state: "removed", updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("sample_state", "in", ["ready", "creating"]).execute();
      sampleDeleted = true;
    }
    // Once more, right before the clinic itself.
    const last = await unpaidEndedTrial(db, tenantId, now);
    if ("why" in last) {
      await releaseTrialDeletionClaim(ctx, tenantId);
      return { status: "skipped", why: last.why };
    }
    started = true;
    await deps.beforeDelete?.(tenantId, "trial_expired");
    await deleteTrialTenant(db, tenantId, "trial_expired", { now: () => now });
    return { status: "deleted", sampleDeleted };
  } catch (err) {
    if (!started) await releaseTrialDeletionClaim(ctx, tenantId).catch(() => undefined);
    throw err;
  }
}

/**
 * A deletion that stopped part-way (its claim kept and gone stale, the clinic's plan already deleted or the clinic
 * closed – the offboarding's first batch ran): finished now, the sample clinic included. Never for a converted clinic.
 */
export async function resumeTrialDeletion(db: Kysely<Database>, trial: SelfTrial, now: Date): Promise<DeleteOutcome> {
  const ctx: DbContext = { db, now: () => now };
  if (trial.sampleOf || trial.deletedAt || trial.convertedAt || !trial.deletionClaimedAt) return { status: "skipped", why: "not_due" };
  if (now.getTime() - Date.parse(trial.deletionClaimedAt) < TRIAL_DELETION_CLAIM_STALE_MS) return { status: "skipped", why: "claimed" };
  const [plan, org] = await Promise.all([readClinicPlan(ctx, trial.tenantId), orgOf(db, trial.tenantId)]);
  // Begun = the plan row is gone (the offboarding's first batch) or the clinic is closed.
  if (plan && org?.open) return { status: "skipped", why: "not_due" };
  if (plan?.status === "paid") return { status: "skipped", why: "paid" };
  if (!(await claimTrialDeletion(ctx, trial.tenantId))) return { status: "skipped", why: "claimed" };
  const sampleId = await sampleOfTrial(db, trial);
  if (sampleId) await deleteTrialTenant(db, sampleId, "trial_expired_sample", { now: () => now });
  await deleteTrialTenant(db, trial.tenantId, "trial_expired", { now: () => now });
  return { status: "deleted", sampleDeleted: Boolean(sampleId), resumed: true };
}

/**
 * The nightly pass over unpaid ended self-serve trials: the deletion warning when it is due, the deletion when its day
 * has come, unfinished deletions finished, stored files still to remove removed. Never throws.
 */
export async function runTrialRetentionSweep(db: Kysely<Database>, deps: TrialRetentionDeps = {}): Promise<TrialRetentionResult> {
  const out: TrialRetentionResult = { clinics: 0, warned: 0, deleted: 0, samplesDeleted: 0, held: 0, resumed: 0, failed: 0, deferred: 0 };
  const started = Date.now();
  const maxDeletions = deps.maxDeletions ?? 10;
  let trials: SelfTrial[];
  try {
    trials = await listSelfTrials({ db }, { includeSamples: true });
  } catch (err) {
    logAuthEvent("trial.retention_failed", { error: err instanceof Error ? err.name : "error" });
    return out;
  }
  for (const listed of trials) {
    if (listed.convertedAt) continue;
    if (deps.budgetMs !== undefined && Date.now() - started > deps.budgetMs) {
      out.deferred++;
      continue;
    }
    try {
      const now = deps.now ? deps.now() : new Date();
      const ctx: DbContext = { db, now: () => now };
      // Files of a deleted clinic (or sample) still to remove.
      if (listed.deletedAt || listed.sampleOf) {
        if (listed.pendingFileKeys.length) await removePendingFiles(ctx, listed.tenantId);
        continue;
      }
      // A deletion that stopped part-way: finished.
      if (listed.deletionClaimedAt) {
        const r = await resumeTrialDeletion(db, listed, now);
        if (r.status === "deleted") {
          out.resumed++;
          out.deleted++;
          if (r.sampleDeleted) out.samplesDeleted++;
          logAuthEvent("trial.clinic_deleted", { sample: r.sampleDeleted, resumed: true });
          continue;
        }
      }
      const state = await unpaidEndedTrial(db, listed.tenantId, now);
      if ("why" in state) continue;
      out.clinics++;
      const { trial, endsAt } = state;
      const today = londonDay(now);
      if (today < trialDeletionWarningDay(endsAt)) continue;
      let sentAt = await firstWarningSentAt(ctx, trial.tenantId);
      // A warning for an earlier end (staff extended or restarted the trial since): forgotten, a fresh one goes.
      if (sentAt && trial.deletionDueAt && trialDeletionDay(endsAt) > londonDay(trial.deletionDueAt)) {
        await resetTrialDeletionWarning(ctx, trial.tenantId);
        sentAt = null;
      }
      if (!sentAt) {
        // Nobody has the warning yet: (re)state the date from today – never less than 14 days' notice.
        const day = trialDeletionDayIfWarnedAt(endsAt, now);
        await setTrialDeletionDue(ctx, trial.tenantId, ukDayStart(day).toISOString());
        const r = await sendTrialEmail(db, trial, "deletion_warning", deps, { deletionDay: day });
        if (r === "sent") out.warned++;
        else if (r === "failed") out.failed++;
        if (!(await firstWarningSentAt(ctx, trial.tenantId))) out.held++;
        continue;
      }
      // Another owner still waiting for their copy (their send failed): retried with the date already promised.
      if (trial.deletionDueAt) {
        const rows = await listTrialEmails(ctx, trial.tenantId);
        if (rows.some((r) => r.kind === "deletion_warning" && r.status === "failed")) await sendTrialEmail(db, trial, "deletion_warning", deps, { deletionDay: londonDay(trial.deletionDueAt) });
      }
      if (out.deleted >= maxDeletions) {
        out.deferred++;
        continue;
      }
      const r = await deleteUnpaidTrialClinic(db, trial.tenantId, deps);
      if (r.status === "deleted") {
        out.deleted++;
        if (r.sampleDeleted) out.samplesDeleted++;
        logAuthEvent("trial.clinic_deleted", { sample: r.sampleDeleted });
      }
    } catch (err) {
      out.failed++;
      logAuthEvent("trial.retention_clinic_failed", { error: err instanceof Error ? err.name : "error" });
    }
  }
  return out;
}
