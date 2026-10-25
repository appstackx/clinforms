/**
 * Trials, drafting limits and demo clinics per clinic (10/2026), for ClinForms staff: the platform page
 * (/app/platform) and the admin scripts (admin:set-trial, admin:set-limits, admin:set-demo-clinic) call these – never
 * a clinic's own pages. Every change is audited twice: under the clinic ("clinic.trial_set", "clinic.demo_on" …, shown
 * on its activity page – who acted is "ClinForms") and, from the platform page, under the "platform" pseudo-tenant
 * naming the administrator ("platform.trial_set", "platform.demo_on" …).
 *
 * The owner's first visit (clinic layout and Studio layout, noteClinicVisit) records the moment and starts a trial
 * that was waiting for it, audited as "clinic.trial_started" under the owner.
 *
 * Pure functions over a database handle (no Next imports).
 */
import type { Kysely } from "kysely";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import type { Database } from "../db/schema";
import { appendAudit } from "../repos/audit";
import {
  clinicAccessOf,
  endClinicTrial,
  extendClinicTrial,
  getClinicPlan,
  noteOwnerAccess,
  readClinicPlan,
  setClinicDemoFlag,
  setClinicDraftingLimits,
  setClinicTrial,
  type ClinicAccess,
  type ClinicPlan,
  type DraftingLimitsInput,
} from "../repos/clinic-plan";
import { RepoInputError } from "../repos/context";
import { listMemberProfiles } from "../repos/member-profile";
import { isDemoHcpc } from "../../modules/medreport/core/demo-clinic";
import { appendPlatformAudit, type PlatformAdmin } from "./platform-console";

/** Who changes a plan: a platform administrator on the platform page, or an admin script (ClinForms itself). */
export type PlanActor = { kind: "platform"; admin: PlatformAdmin } | { kind: "script" };

/** A clinic that exists and is not closed (offboarded clinics keep their id as a tombstone). Also used for packages. */
export async function requireOpenClinic(db: Kysely<Database>, tenantId: string): Promise<{ organizationId: string; hasOwner: boolean }> {
  const slug = String(tenantId ?? "").trim();
  const org = await db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", slug).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${slug}".`);
  if (org.metadata && /"offboardedAt"/.test(org.metadata)) throw new RepoInputError(`The clinic "${slug}" is closed.`);
  const owner = await db.selectFrom("member").select("id").where("organizationId", "=", org.id).where("role", "=", "owner").limit(1).executeTakeFirst();
  return { organizationId: org.id, hasOwner: Boolean(owner) };
}

/** Audits a plan change twice: "clinic.<what>" under the clinic (who = ClinForms) and "platform.<what>" naming the administrator. */
export async function auditPlanChange(db: Kysely<Database>, actor: PlanActor, tenantId: string, what: string, detail: Record<string, unknown>): Promise<void> {
  await appendAudit({ db }, tenantId, {
    // The clinic's own trail names ClinForms; the platform trail below names the administrator.
    userId: PLATFORM_USER_ID,
    action: `clinic.${what}`,
    targetType: "clinic",
    targetId: tenantId,
    detail,
  });
  if (actor.kind === "platform") {
    await appendPlatformAudit({ db }, actor.admin, { action: `platform.${what}`, targetType: "clinic", targetId: tenantId, detail: { tenantId, ...detail } });
  }
}

export type TrialStart = "first_sign_in" | "now";

export interface SetTrialResult {
  plan: ClinicPlan;
  /** The trial started at once although "first_sign_in" was asked: the clinic's owner had already signed in. */
  startedNow: boolean;
  access: ClinicAccess;
}

/**
 * Sets (or restarts) a trial of `days`. "first_sign_in" (the default for a new clinic) waits for the owner's first
 * visit – unless the clinic already has an owner (they have signed in: accepting the invitation signs them in), in
 * which case it starts now and the result says so.
 */
export async function setTrial(db: Kysely<Database>, actor: PlanActor, tenantId: string, input: { days: number; start: TrialStart }, now = new Date()): Promise<SetTrialResult> {
  const clinic = await requireOpenClinic(db, tenantId);
  const waitForOwner = input.start === "first_sign_in" && !clinic.hasOwner;
  const plan = await setClinicTrial({ db, now: () => now }, tenantId, { days: input.days, startOnFirstSignIn: waitForOwner });
  const startedNow = input.start === "first_sign_in" && clinic.hasOwner;
  await auditPlanChange(db, actor, tenantId, "trial_set", {
    days: plan.trialDays,
    start: waitForOwner ? "first_sign_in" : "now",
    ...(startedNow ? { ownerAlreadySignedIn: true } : {}),
    endsAt: plan.trialEndsAt,
  });
  return { plan, startedNow, access: clinicAccessOf(plan, now) };
}

export async function extendTrial(db: Kysely<Database>, actor: PlanActor, tenantId: string, days: number, now = new Date()): Promise<ClinicPlan> {
  await requireOpenClinic(db, tenantId);
  const before = await getClinicPlan({ db }, tenantId);
  const plan = await extendClinicTrial({ db, now: () => now }, tenantId, days);
  await auditPlanChange(db, actor, tenantId, "trial_extended", { days, endsBefore: before?.trialEndsAt ?? null, endsAt: plan.trialEndsAt, trialDays: plan.trialDays });
  return plan;
}

/** "paid": the trial is converted (full access from now on). "now": it ends at once. */
export async function endTrial(db: Kysely<Database>, actor: PlanActor, tenantId: string, how: "paid" | "now", now = new Date()): Promise<ClinicPlan> {
  await requireOpenClinic(db, tenantId);
  const plan = await endClinicTrial({ db, now: () => now }, tenantId, how);
  await auditPlanChange(db, actor, tenantId, how === "paid" ? "trial_converted" : "trial_ended", { endedAt: plan.endedAt });
  return plan;
}

export async function setDraftingLimits(db: Kysely<Database>, actor: PlanActor, tenantId: string, limits: DraftingLimitsInput, now = new Date()): Promise<ClinicPlan> {
  await requireOpenClinic(db, tenantId);
  const before = await getClinicPlan({ db }, tenantId);
  const plan = await setClinicDraftingLimits({ db, now: () => now }, tenantId, limits);
  await auditPlanChange(db, actor, tenantId, "limits_set", {
    perMinute: plan.livePerMinute,
    perDay: plan.livePerDay,
    before: { perMinute: before?.livePerMinute ?? null, perDay: before?.livePerDay ?? null },
  });
  return plan;
}

/**
 * A member opened the clinic area (two-step done). For an owner: records the first visit after the plan was set and
 * starts a trial that waited for it (audited under the owner). Returns what the clinic's plan means now (banner).
 * Never throws: a plan that cannot be read or written leaves the page working (the Report API re-checks the trial
 * itself on every request that creates something).
 */
export async function noteClinicVisit(
  db: Kysely<Database>,
  visit: { tenantId: string; userId: string; sessionId?: string; role: string },
  now = new Date(),
): Promise<ClinicAccess | null> {
  try {
    if (visit.role === "owner") {
      const r = await noteOwnerAccess({ db, now: () => now }, visit.tenantId);
      if (r.trialStarted && r.plan) {
        await appendAudit({ db }, visit.tenantId, {
          userId: visit.userId,
          sessionId: visit.sessionId ?? null,
          action: "clinic.trial_started",
          targetType: "clinic",
          targetId: visit.tenantId,
          detail: { days: r.plan.trialDays, endsAt: r.plan.trialEndsAt },
        }).catch(() => undefined);
      }
      return r.plan ? clinicAccessOf(r.plan, now) : null;
    }
    const plan = await getClinicPlan({ db }, visit.tenantId);
    return plan ? clinicAccessOf(plan, now) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the clinic's trial runs now (or waits for the owner's first visit): the clinic's pages then word drafting for
 * made-up notes only (src/lib/account-copy.ts DRAFTING_COPY.*Trial). false without a trial, after it ended, and on
 * any error (the wording falls back to the standard text).
 */
export async function clinicTrialRunning(db: Kysely<Database>, tenantId: string, now = new Date()): Promise<boolean> {
  try {
    return clinicAccessOf(await getClinicPlan({ db }, tenantId), now).state === "trial";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Demo clinics (made-up data only – src/modules/medreport/core/demo-clinic.ts)
 * ----------------------------------------------------------------------------------------------*/

export interface SetDemoClinicResult {
  /** The flag after this call. */
  demoClinic: boolean;
  /** false when the clinic already was (or was not) a demo clinic: nothing written, nothing audited. */
  changed: boolean;
  /** Members whose signing details hold a made-up PH-DEMO number (a real clinic refuses them at approval). */
  membersWithDemoNumbers: number;
}

/**
 * Makes a clinic a DEMO clinic (on) or a real clinic again (off) – platform staff only (the platform page and
 * admin:set-demo-clinic); a clinic's own owners and administrators have no way to change it. Audited under the clinic
 * ("clinic.demo_on" / "clinic.demo_off", by ClinForms) and, from the platform page, under the platform naming the
 * administrator. Refused for an unknown or closed clinic. The audit rows hold the flag and a count, never a number.
 */
export async function setDemoClinic(db: Kysely<Database>, actor: PlanActor, tenantId: string, on: boolean, now = new Date()): Promise<SetDemoClinicResult> {
  const clinic = await requireOpenClinic(db, tenantId);
  const { changed, plan } = await setClinicDemoFlag({ db, now: () => now }, tenantId, on);
  const membersWithDemoNumbers = (await listMemberProfiles({ db }, clinic.organizationId)).filter((m) => isDemoHcpc(m.hcpcNumber)).length;
  if (changed) await auditPlanChange(db, actor, tenantId, on ? "demo_on" : "demo_off", { demoClinic: on, membersWithDemoNumbers });
  return { demoClinic: plan?.demoClinic === true, changed, membersWithDemoNumbers };
}

/**
 * Whether the clinic is a demo clinic, for the app's pages and actions (clinic layout, Studio, members page). Read on
 * the server from the clinic's plan – never from a request. false without a plan row, on a database before migration
 * 0008, and on any error (fail closed: a real clinic's strict rules apply).
 */
export async function isDemoClinic(db: Kysely<Database>, tenantId: string): Promise<boolean> {
  try {
    return (await readClinicPlan({ db }, tenantId))?.demoClinic === true;
  } catch {
    return false;
  }
}
