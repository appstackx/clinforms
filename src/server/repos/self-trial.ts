/**
 * `self_trial` and `trial_email` (migration 0011) – the self-serve free trial (src/server/trial, docs/clinic-system/
 * trial.md). Keyed hashes, counts and dates only: never an address, a name or patient data. Tenant id in every WHERE.
 *
 * A database before migration 0011 (the switch is off there): the app's READ paths absorb the missing table
 * (readSelfTrial → null, the sweep → nothing to do), so a deploy before the migration changes nothing; writes fail
 * loudly (they only run once the switch is on, after the migration – docs/auth.md §1b checklist).
 */
import { isTrialEmailKind, type TrialEmailKind } from "../../lib/trial";
import { RepoInputError, assertTenantId, nowIso, toInt, type DbContext } from "./context";

export type TrialBrand = "clinforms" | "clinic";
export type RepeatReason = "email" | "network" | "domain";
export type SampleState = "creating" | "ready" | "declined";

export interface SelfTrial {
  tenantId: string;
  brand: TrialBrand;
  /** Set on a SAMPLE clinic's row: the real clinic it belongs to. */
  sampleOf: string | null;
  emailKey: string;
  networkKey: string;
  domainKey: string | null;
  reportsIncluded: number;
  textsGranted: number;
  /** Free reports reserved by live drafting so far (never more than reportsIncluded). */
  reportsReserved: number;
  repeatReason: RepeatReason | null;
  sampleTenantId: string | null;
  sampleState: SampleState | null;
  sampleClaimedAt: string | null;
  /** How far the sample clinic's creation got (resumable steps). */
  sampleStep: number;
  tipsOffAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = {
  tenant_id: string;
  brand: string;
  sample_of: string | null;
  email_key: string;
  network_key: string;
  domain_key: string | null;
  reports_included: number;
  texts_granted: number;
  reports_reserved?: number | null;
  repeat_reason: string | null;
  sample_tenant_id: string | null;
  sample_state: string | null;
  sample_claimed_at: string | null;
  sample_step?: number | null;
  tips_off_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
};

function toTrial(r: Row): SelfTrial {
  return {
    tenantId: r.tenant_id,
    brand: r.brand === "clinic" ? "clinic" : "clinforms",
    sampleOf: r.sample_of,
    emailKey: r.email_key,
    networkKey: r.network_key,
    domainKey: r.domain_key,
    reportsIncluded: toInt(r.reports_included),
    textsGranted: toInt(r.texts_granted),
    reportsReserved: toInt(r.reports_reserved ?? 0),
    repeatReason: r.repeat_reason === "email" || r.repeat_reason === "network" || r.repeat_reason === "domain" ? r.repeat_reason : null,
    sampleTenantId: r.sample_tenant_id,
    sampleState: r.sample_state === "creating" || r.sample_state === "ready" || r.sample_state === "declined" ? r.sample_state : null,
    sampleClaimedAt: r.sample_claimed_at,
    sampleStep: toInt(r.sample_step ?? 0),
    tipsOffAt: r.tips_off_at,
    convertedAt: r.converted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Whether `err` says a 0011 table does not exist (SQLite / D1 "no such table", Postgres 42P01). */
export function isMissingTrialTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (/no such table: (?:main\.)?(self_trial|trial_email|trial_report_hold)\b|relation "(?:public\.)?(self_trial|trial_email|trial_report_hold)" does not exist/i.test(message)) return true;
  if (e.code === "42P01" && /self_trial|trial_email|trial_report_hold/.test(message)) return true;
  return e.cause !== undefined && e.cause !== err ? isMissingTrialTable(e.cause) : false;
}

let missingNoted = false;
function noteMissing(): void {
  if (missingNoted) return;
  missingNoted = true;
  console.warn("[self_trial] table missing: migration 0011 not applied to this database; no clinic has a self-serve trial.");
}

export async function getSelfTrial(ctx: DbContext, tenantId: string): Promise<SelfTrial | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("self_trial").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return row ? toTrial(row as Row) : null;
}

/** getSelfTrial for the app's read paths: a database before migration 0011 reads as "no self-serve trial". */
export async function readSelfTrial(ctx: DbContext, tenantId: string): Promise<SelfTrial | null> {
  try {
    return await getSelfTrial(ctx, tenantId);
  } catch (err) {
    if (!isMissingTrialTable(err)) throw err;
    noteMissing();
    return null;
  }
}

/** Every self-serve trial (the real clinics, not their samples) – the platform page and the email sweep. */
export async function listSelfTrials(ctx: DbContext, options: { includeSamples?: boolean } = {}): Promise<SelfTrial[]> {
  try {
    let q = ctx.db.selectFrom("self_trial").selectAll();
    if (!options.includeSamples) q = q.where("sample_of", "is", null);
    const rows = await q.orderBy("created_at", "desc").execute();
    return rows.map((r) => toTrial(r as Row));
  } catch (err) {
    if (!isMissingTrialTable(err)) throw err;
    noteMissing();
    return [];
  }
}

export interface SelfTrialInput {
  brand: TrialBrand;
  sampleOf?: string | null;
  emailKey: string;
  networkKey: string;
  domainKey?: string | null;
  reportsIncluded: number;
  textsGranted: number;
  repeatReason: RepeatReason | null;
}

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Records the clinic's trial ONCE (a retried sign-up keeps the first row). Returns the row and whether it is new. */
export async function createSelfTrial(ctx: DbContext, tenantId: string, input: SelfTrialInput): Promise<{ trial: SelfTrial; created: boolean }> {
  assertTenantId(tenantId);
  if (input.brand !== "clinforms" && input.brand !== "clinic") throw new RepoInputError("brand must be clinforms or clinic.");
  if (!KEY.test(input.emailKey) || !KEY.test(input.networkKey) || (input.domainKey != null && !KEY.test(input.domainKey))) throw new RepoInputError("Invalid trial keys.");
  for (const [n, v] of [["reports", input.reportsIncluded], ["texts", input.textsGranted]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 1000) throw new RepoInputError(`Trial ${n} must be 0–1000.`);
  }
  if (input.sampleOf) assertTenantId(input.sampleOf);
  const at = nowIso(ctx);
  const r = await ctx.db
    .insertInto("self_trial")
    .values({
      tenant_id: tenantId,
      brand: input.brand,
      sample_of: input.sampleOf ?? null,
      email_key: input.emailKey,
      network_key: input.networkKey,
      domain_key: input.domainKey ?? null,
      reports_included: input.reportsIncluded,
      texts_granted: input.textsGranted,
      reports_reserved: 0,
      repeat_reason: input.repeatReason,
      sample_tenant_id: null,
      sample_state: null,
      sample_claimed_at: null,
      sample_step: 0,
      tips_off_at: null,
      converted_at: null,
      created_at: at,
      updated_at: at,
    })
    .onConflict((oc) => oc.column("tenant_id").doNothing())
    .executeTakeFirst();
  const trial = await getSelfTrial(ctx, tenantId);
  if (!trial) throw new Error("self_trial write did not persist.");
  return { trial, created: Number(r.numInsertedOrUpdatedRows ?? 0) > 0 };
}

/** Earlier trials (real clinics only) from the same canonical address, at any time. */
export async function countTrialsByEmailKey(ctx: DbContext, emailKey: string): Promise<number> {
  const row = await ctx.db
    .selectFrom("self_trial")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("email_key", "=", emailKey)
    .where("sample_of", "is", null)
    .executeTakeFirst();
  return toInt(row?.n ?? 0);
}

/** Trials WITH a free allowance from the same network since `since` (repeats do not count again). */
export async function countAllowanceTrialsByNetwork(ctx: DbContext, networkKey: string, since: string): Promise<number> {
  const row = await ctx.db
    .selectFrom("self_trial")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("network_key", "=", networkKey)
    .where("sample_of", "is", null)
    .where("repeat_reason", "is", null)
    .where("created_at", ">=", since)
    .executeTakeFirst();
  return toInt(row?.n ?? 0);
}

/** Trials WITH a free allowance from the same own (non-webmail) email domain since `since`. */
export async function countAllowanceTrialsByDomain(ctx: DbContext, domainKey: string, since: string): Promise<number> {
  const row = await ctx.db
    .selectFrom("self_trial")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("domain_key", "=", domainKey)
    .where("sample_of", "is", null)
    .where("repeat_reason", "is", null)
    .where("created_at", ">=", since)
    .executeTakeFirst();
  return toInt(row?.n ?? 0);
}

/** The owner stopped the tips emails (welcome / tips). Idempotent: the first moment is kept. */
export async function setTrialTipsOff(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const r = await ctx.db.updateTable("self_trial").set({ tips_off_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("tips_off_at", "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** The trial was converted by the first paid activation (once). */
export async function markTrialConverted(ctx: DbContext, tenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const r = await ctx.db.updateTable("self_trial").set({ converted_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("converted_at", "is", null).executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** How long one step of the sample clinic's creation may hold its lock before another attempt takes over (a crash). */
export const SAMPLE_CLAIM_STALE_MS = 2 * 60_000;

/**
 * Takes the lock for the next step(s) of the clinic's sample clinic: ONE conditional UPDATE – no sample yet (it starts,
 * with `sampleTenantId`), or a "creating" one whose lock is free or stale. Two clicks at once: one wins.
 */
export async function claimSampleClinic(ctx: DbContext, tenantId: string, sampleTenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertTenantId(sampleTenantId);
  const at = nowIso(ctx);
  const stale = new Date(Date.parse(at) - SAMPLE_CLAIM_STALE_MS).toISOString();
  const r = await ctx.db
    .updateTable("self_trial")
    .set({ sample_state: "creating", sample_tenant_id: sampleTenantId, sample_claimed_at: at, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("sample_of", "is", null)
    .where((eb) =>
      eb.or([
        eb("sample_state", "is", null),
        eb.and([eb("sample_state", "=", "creating"), eb("sample_tenant_id", "=", sampleTenantId), eb.or([eb("sample_claimed_at", "is", null), eb("sample_claimed_at", "<", stale)])]),
      ]),
    )
    .executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** Records the step reached, keeping the lock (refreshed). */
export async function saveSampleStep(ctx: DbContext, tenantId: string, step: number): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await ctx.db.updateTable("self_trial").set({ sample_step: step, sample_claimed_at: at, updated_at: at }).where("tenant_id", "=", tenantId).execute();
}

/** Records the step reached and frees the lock (the next call carries on from there). */
export async function releaseSampleClaim(ctx: DbContext, tenantId: string, step: number): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await ctx.db.updateTable("self_trial").set({ sample_step: step, sample_claimed_at: null, updated_at: at }).where("tenant_id", "=", tenantId).execute();
}

export async function setSampleState(ctx: DbContext, tenantId: string, state: SampleState): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  let q = ctx.db.updateTable("self_trial").set({ sample_state: state, updated_at: at, ...(state === "ready" ? { sample_claimed_at: null } : {}) }).where("tenant_id", "=", tenantId).where("sample_of", "is", null);
  // "declined" only while there is no sample; "ready" only for the clinic's own claim.
  if (state === "declined") q = q.where("sample_state", "is", null);
  await q.execute();
}

/* ------------------------------------------------------------------ free-report reservations */

export type TrialReportReservation = "reserved" | "held" | "full";

/**
 * Reserves one of the trial's free reports for a report BEFORE its live drafting call (13/11/2026, review): "held" =
 * this report holds one already (drafted again – no second reservation); "reserved" = one taken now; "full" = none
 * left. Atomic on every database: the hold row is claimed by its primary key, then ONE conditional UPDATE takes a free
 * report (reports_reserved < reports_included – a row lock in Postgres, single writer in SQLite / D1), so parallel
 * drafts can never take more than the allowance; a refused one gives its hold row back.
 */
export async function reserveTrialReport(ctx: DbContext, tenantId: string, reportKey: string, episodeFp: string): Promise<TrialReportReservation> {
  assertTenantId(tenantId);
  if (!/^[A-Za-z0-9._:@-]{1,160}$/.test(reportKey)) throw new RepoInputError("Invalid report key.");
  const fp = /^[A-Za-z0-9_-]{0,64}$/.test(episodeFp) ? episodeFp : "";
  const at = nowIso(ctx);
  const hold = await ctx.db
    .insertInto("trial_report_hold")
    .values({ tenant_id: tenantId, report_key: reportKey, episode_fp: fp, held_at: at })
    .onConflict((oc) => oc.columns(["tenant_id", "report_key", "episode_fp"]).doNothing())
    .executeTakeFirst();
  if (Number(hold.numInsertedOrUpdatedRows ?? 0) === 0) return "held";
  const take = await ctx.db
    .updateTable("self_trial")
    .set((eb) => ({ reports_reserved: eb("reports_reserved", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where((eb) => eb("reports_reserved", "<", eb.ref("reports_included")))
    .executeTakeFirst();
  if (Number(take.numUpdatedRows) > 0) return "reserved";
  await ctx.db.deleteFrom("trial_report_hold").where("tenant_id", "=", tenantId).where("report_key", "=", reportKey).where("episode_fp", "=", fp).execute();
  return "full";
}

/** Gives a reservation back (the live call failed without any cost): the hold row, then the free report. */
export async function releaseTrialReport(ctx: DbContext, tenantId: string, reportKey: string, episodeFp: string): Promise<void> {
  assertTenantId(tenantId);
  const fp = /^[A-Za-z0-9_-]{0,64}$/.test(episodeFp) ? episodeFp : "";
  const gone = await ctx.db.deleteFrom("trial_report_hold").where("tenant_id", "=", tenantId).where("report_key", "=", reportKey).where("episode_fp", "=", fp).executeTakeFirst();
  if (Number(gone.numDeletedRows) === 0) return;
  await ctx.db
    .updateTable("self_trial")
    .set((eb) => ({ reports_reserved: eb("reports_reserved", "-", 1), updated_at: nowIso(ctx) }))
    .where("tenant_id", "=", tenantId)
    .where("reports_reserved", ">", 0)
    .execute();
}

/* ------------------------------------------------------------------ trial_email */

export type TrialEmailStatus = "claimed" | "sent" | "failed" | "skipped";

export interface TrialEmailRow {
  tenantId: string;
  kind: TrialEmailKind;
  /** "" = the clinic's row (the schedule's); else the recipient's user id. */
  recipientRef: string;
  status: TrialEmailStatus;
  attempts: number;
  recipients: number;
  claimedAt: string;
  sentAt: string | null;
}

/** Retries of a failed send (the provider refused it) before it is left as failed. */
export const TRIAL_EMAIL_MAX_ATTEMPTS = 3;

/** The clinic's rows (recipient "" – the schedule) or, with `recipients`, every row. */
export async function listTrialEmails(ctx: DbContext, tenantId: string, options: { recipients?: boolean } = {}): Promise<TrialEmailRow[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("trial_email").selectAll().where("tenant_id", "=", tenantId);
  if (!options.recipients) q = q.where("recipient_ref", "=", "");
  const rows = await q.execute();
  return rows
    .filter((r) => isTrialEmailKind(r.kind))
    .map((r) => ({
      tenantId: r.tenant_id,
      kind: r.kind as TrialEmailKind,
      recipientRef: r.recipient_ref,
      status: (["claimed", "sent", "failed", "skipped"].includes(r.status) ? r.status : "claimed") as TrialEmailStatus,
      attempts: toInt(r.attempts),
      recipients: toInt(r.recipients),
      claimedAt: r.claimed_at,
      sentAt: r.sent_at,
    }));
}

/**
 * Claims one email (recipient "" = for the clinic; a user id = one send to that owner) BEFORE it is sent: true = this
 * caller sends it (or records the skip). A row that exists already wins (sent, claimed by another run, skipped) –
 * except a FAILED one, taken back by one conditional UPDATE while it has attempts left. So every email goes at most
 * once per clinic and per owner.
 */
export async function claimTrialEmail(ctx: DbContext, tenantId: string, kind: TrialEmailKind, status: "claimed" | "skipped" = "claimed", recipientRef = ""): Promise<boolean> {
  assertTenantId(tenantId);
  if (!isTrialEmailKind(kind)) throw new RepoInputError("Unknown trial email.");
  if (recipientRef !== "" && !/^[A-Za-z0-9_-]{1,80}$/.test(recipientRef)) throw new RepoInputError("Invalid recipient.");
  const at = nowIso(ctx);
  const r = await ctx.db
    .insertInto("trial_email")
    .values({ tenant_id: tenantId, kind, recipient_ref: recipientRef, status, attempts: 1, recipients: 0, claimed_at: at, sent_at: null })
    .onConflict((oc) => oc.columns(["tenant_id", "kind", "recipient_ref"]).doNothing())
    .executeTakeFirst();
  if (Number(r.numInsertedOrUpdatedRows ?? 0) > 0) return true;
  if (status === "skipped") return false;
  const retry = await ctx.db
    .updateTable("trial_email")
    .set((eb) => ({ status: "claimed", attempts: eb("attempts", "+", 1), claimed_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind)
    .where("recipient_ref", "=", recipientRef)
    .where("status", "=", "failed")
    .where("attempts", "<", TRIAL_EMAIL_MAX_ATTEMPTS)
    .executeTakeFirst();
  return Number(retry.numUpdatedRows) > 0;
}

/** The outcome of a claimed send. */
export async function finishTrialEmail(
  ctx: DbContext,
  tenantId: string,
  kind: TrialEmailKind,
  outcome: { status: "sent" | "failed" | "skipped"; recipients?: number },
  recipientRef = "",
): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await ctx.db
    .updateTable("trial_email")
    .set({ status: outcome.status, recipients: outcome.recipients ?? 0, sent_at: outcome.status === "sent" ? at : null })
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind)
    .where("recipient_ref", "=", recipientRef)
    .where("status", "=", "claimed")
    .execute();
}
