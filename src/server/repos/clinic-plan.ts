/**
 * `clinic_plan` (migration 0006) – a clinic's trial and its own drafting limits. Written by ClinForms staff only
 * (the platform page /app/platform and the admin scripts admin:set-trial / admin:set-limits, both through
 * src/server/admin/clinic-plan.ts, which audits every change); read on every clinic page and Report API call
 * that creates something (src/server/auth/medreport-actor.ts loadClinicProfile → the module's ClinicProfile).
 *
 * One row per clinic (tenant_id = organization slug). No row = no trial and the default drafting limits – every
 * clinic made before this table existed.
 *
 * A trial is `trial_days` long. It either starts when it is set, or – the default for a new clinic – when an
 * owner first opens the clinic area (`start_on_first_sign_in`; noteOwnerAccess() records that moment once, in
 * one conditional UPDATE, so two first page loads at once start it once). While the trial runs, or before it
 * starts, the clinic works as usual; once `trial_ends_at` has passed nothing new can be created (reports,
 * drafts, uploads, form readings) and existing records stay readable and downloadable. "paid" = the trial was
 * converted; "standard" = a row that only holds the clinic's own limits.
 *
 * Pure database code (no Next imports); the clock comes from ctx.now (tests pin it).
 */
import { RepoInputError, assertTenantId, nowIso, toBool, toInt, type DbContext } from "./context";

export type ClinicPlanStatus = "standard" | "trial" | "paid";

export const TRIAL_MAX_DAYS = 366;
/** Upper bounds for a clinic's own drafting limits (a typo cannot open the floodgates). */
export const LIMIT_MAX_PER_MINUTE = 600;
export const LIMIT_MAX_PER_DAY = 100_000;

const DAY_MS = 86_400_000;

export interface ClinicPlan {
  tenantId: string;
  status: ClinicPlanStatus;
  trialDays: number | null;
  startOnFirstSignIn: boolean;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  ownerFirstSignInAt: string | null;
  endedAt: string | null;
  livePerMinute: number | null;
  livePerDay: number | null;
  createdAt: string;
  updatedAt: string;
}

type PlanRow = {
  tenant_id: string;
  status: string;
  trial_days: number | null;
  start_on_first_sign_in: number;
  trial_starts_at: string | null;
  trial_ends_at: string | null;
  owner_first_sign_in_at: string | null;
  ended_at: string | null;
  live_calls_per_minute: number | null;
  live_calls_per_day: number | null;
  created_at: string;
  updated_at: string;
};

function toPlan(row: PlanRow): ClinicPlan {
  const status: ClinicPlanStatus = row.status === "trial" || row.status === "paid" ? row.status : "standard";
  return {
    tenantId: row.tenant_id,
    status,
    trialDays: row.trial_days === null ? null : toInt(row.trial_days),
    startOnFirstSignIn: toBool(row.start_on_first_sign_in),
    trialStartsAt: row.trial_starts_at,
    trialEndsAt: row.trial_ends_at,
    ownerFirstSignInAt: row.owner_first_sign_in_at,
    endedAt: row.ended_at,
    livePerMinute: row.live_calls_per_minute === null ? null : toInt(row.live_calls_per_minute),
    livePerDay: row.live_calls_per_day === null ? null : toInt(row.live_calls_per_day),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getClinicPlan(ctx: DbContext, tenantId: string): Promise<ClinicPlan | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("clinic_plan").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return row ? toPlan(row) : null;
}

export async function listClinicPlans(ctx: DbContext): Promise<ClinicPlan[]> {
  const rows = await ctx.db.selectFrom("clinic_plan").selectAll().orderBy("tenant_id").execute();
  return rows.map(toPlan);
}

function assertDays(days: number, what = "Trial length"): number {
  if (!Number.isInteger(days) || days < 1 || days > TRIAL_MAX_DAYS) throw new RepoInputError(`${what} must be 1–${TRIAL_MAX_DAYS} days.`);
  return days;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

async function saved(ctx: DbContext, tenantId: string): Promise<ClinicPlan> {
  const plan = await getClinicPlan(ctx, tenantId);
  if (!plan) throw new Error("clinic_plan write did not persist.");
  return plan;
}

export interface SetTrialInput {
  days: number;
  /** Start when an owner first opens the clinic area (default), or now. */
  startOnFirstSignIn: boolean;
}

/**
 * Sets (or restarts) the clinic's trial: status "trial", `days` long, starting now or at an owner's first visit.
 * The clinic's own drafting limits are kept. An owner visit recorded earlier is kept but does not start the new
 * trial: with startOnFirstSignIn the trial waits for the next one (the admin layer starts it at once instead when
 * the clinic already has an owner – see admin/clinic-plan.ts).
 */
export async function setClinicTrial(ctx: DbContext, tenantId: string, input: SetTrialInput): Promise<ClinicPlan> {
  assertTenantId(tenantId);
  const days = assertDays(input.days);
  const at = nowIso(ctx);
  const values = {
    status: "trial",
    trial_days: days,
    start_on_first_sign_in: input.startOnFirstSignIn ? 1 : 0,
    trial_starts_at: input.startOnFirstSignIn ? null : at,
    trial_ends_at: input.startOnFirstSignIn ? null : addDays(at, days),
    ended_at: null,
  };
  await ctx.db
    .insertInto("clinic_plan")
    .values({ tenant_id: tenantId, ...values, owner_first_sign_in_at: null, live_calls_per_minute: null, live_calls_per_day: null, created_at: at, updated_at: at })
    .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ ...values, updated_at: at }))
    .execute();
  return saved(ctx, tenantId);
}

/**
 * Adds `days` to the trial. A running trial ends `days` later; one that has already ended runs for `days` from
 * now; one waiting for the owner's first visit becomes `days` longer. Refused when the clinic has no trial.
 */
export async function extendClinicTrial(ctx: DbContext, tenantId: string, days: number): Promise<ClinicPlan> {
  assertTenantId(tenantId);
  assertDays(days, "The extension");
  const plan = await getClinicPlan(ctx, tenantId);
  if (!plan || plan.status !== "trial") throw new RepoInputError(`The clinic "${tenantId}" has no trial to extend.`);
  const at = nowIso(ctx);
  if (!plan.trialEndsAt) {
    const total = (plan.trialDays ?? 0) + days;
    assertDays(total, "The trial with its extension");
    await ctx.db.updateTable("clinic_plan").set({ trial_days: total, updated_at: at }).where("tenant_id", "=", tenantId).execute();
    return saved(ctx, tenantId);
  }
  const from = Date.parse(plan.trialEndsAt) > Date.parse(at) ? plan.trialEndsAt : at;
  await ctx.db
    .updateTable("clinic_plan")
    .set({ trial_ends_at: addDays(from, days), trial_days: (plan.trialDays ?? 0) + days, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .execute();
  return saved(ctx, tenantId);
}

/**
 * Ends the trial: "paid" converts the clinic (full access from now on); "now" ends it at once (nothing new can be
 * created until it is extended or converted). Refused when the clinic has no trial.
 */
export async function endClinicTrial(ctx: DbContext, tenantId: string, how: "paid" | "now"): Promise<ClinicPlan> {
  assertTenantId(tenantId);
  const plan = await getClinicPlan(ctx, tenantId);
  if (!plan || plan.status !== "trial") throw new RepoInputError(`The clinic "${tenantId}" has no trial to end.`);
  const at = nowIso(ctx);
  if (how === "paid") {
    await ctx.db.updateTable("clinic_plan").set({ status: "paid", ended_at: at, updated_at: at }).where("tenant_id", "=", tenantId).execute();
  } else {
    await ctx.db
      .updateTable("clinic_plan")
      .set({ trial_starts_at: plan.trialStartsAt ?? at, trial_ends_at: at, ended_at: at, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .execute();
  }
  return saved(ctx, tenantId);
}

export interface DraftingLimitsInput {
  /** null = the default. */
  perMinute: number | null;
  perDay: number | null;
}

function assertLimit(value: number | null, max: number, what: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new RepoInputError(`${what} must be a whole number from 1 to ${max.toLocaleString("en-GB")}.`);
  return value;
}

/** The clinic's own drafting limits (null = the deployment's default). Creates a "standard" row when there is none. */
export async function setClinicDraftingLimits(ctx: DbContext, tenantId: string, input: DraftingLimitsInput): Promise<ClinicPlan> {
  assertTenantId(tenantId);
  const values = {
    live_calls_per_minute: assertLimit(input.perMinute, LIMIT_MAX_PER_MINUTE, "Drafting calls per minute"),
    live_calls_per_day: assertLimit(input.perDay, LIMIT_MAX_PER_DAY, "Drafting calls per day"),
  };
  const at = nowIso(ctx);
  await ctx.db
    .insertInto("clinic_plan")
    .values({
      tenant_id: tenantId,
      status: "standard",
      trial_days: null,
      start_on_first_sign_in: 0,
      trial_starts_at: null,
      trial_ends_at: null,
      owner_first_sign_in_at: null,
      ended_at: null,
      ...values,
      created_at: at,
      updated_at: at,
    })
    .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ ...values, updated_at: at }))
    .execute();
  return saved(ctx, tenantId);
}

export interface OwnerAccessResult {
  /** The moment was recorded now (the first visit since the plan was set). */
  firstVisit: boolean;
  /** This visit started a trial that was waiting for it. */
  trialStarted: boolean;
  plan: ClinicPlan | null;
}

/**
 * An owner opened the clinic area (signed in, two-step done). Records the first such visit after the plan was set
 * and starts a trial that waits for it – each in ONE conditional UPDATE, so concurrent first visits do it once.
 * Nothing happens for a clinic without a plan row.
 */
export async function noteOwnerAccess(ctx: DbContext, tenantId: string): Promise<OwnerAccessResult> {
  assertTenantId(tenantId);
  const plan = await getClinicPlan(ctx, tenantId);
  if (!plan) return { firstVisit: false, trialStarted: false, plan: null };
  const at = nowIso(ctx);
  let firstVisit = false;
  let trialStarted = false;
  if (!plan.ownerFirstSignInAt) {
    const r = await ctx.db
      .updateTable("clinic_plan")
      .set({ owner_first_sign_in_at: at })
      .where("tenant_id", "=", tenantId)
      .where("owner_first_sign_in_at", "is", null)
      .executeTakeFirst();
    firstVisit = Number(r.numUpdatedRows) > 0;
  }
  if (plan.status === "trial" && plan.startOnFirstSignIn && !plan.trialStartsAt && plan.trialDays) {
    const r = await ctx.db
      .updateTable("clinic_plan")
      .set({ trial_starts_at: at, trial_ends_at: addDays(at, plan.trialDays), updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "trial")
      .where("trial_starts_at", "is", null)
      .where("trial_days", "=", plan.trialDays)
      .executeTakeFirst();
    trialStarted = Number(r.numUpdatedRows) > 0;
  }
  return { firstVisit, trialStarted, plan: firstVisit || trialStarted ? await getClinicPlan(ctx, tenantId) : plan };
}

export async function deleteClinicPlan(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const result = await ctx.db.deleteFrom("clinic_plan").where("tenant_id", "=", tenantId).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

/* ------------------------------------------------------------------------------------------------
 * What the plan means right now (pure)
 * ----------------------------------------------------------------------------------------------*/

export type ClinicAccess =
  /** No trial (no row, "standard" or "paid"): everything works. */
  | { state: "full"; plan: ClinicPlanStatus | "none" }
  /** A running trial, or one waiting for the owner's first visit (`pending`). */
  | { state: "trial"; daysLeft: number; endsAt: string | null; pending: boolean }
  /** The trial is over: existing records stay readable and downloadable, nothing new can be created. */
  | { state: "trial_ended"; endedAt: string };

/** Days left, rounded up: 2 days and 1 hour left = 3; 5 minutes left = 1. */
export function trialDaysLeft(endsAt: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now.getTime()) / DAY_MS));
}

export function clinicAccessOf(plan: ClinicPlan | null, now: Date = new Date()): ClinicAccess {
  if (!plan || plan.status !== "trial") return { state: "full", plan: plan?.status ?? "none" };
  if (!plan.trialEndsAt) return { state: "trial", daysLeft: plan.trialDays ?? 0, endsAt: null, pending: true };
  if (Date.parse(plan.trialEndsAt) <= now.getTime()) return { state: "trial_ended", endedAt: plan.trialEndsAt };
  return { state: "trial", daysLeft: Math.max(1, trialDaysLeft(plan.trialEndsAt, now)), endsAt: plan.trialEndsAt, pending: false };
}
