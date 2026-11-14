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
  repeatReason: RepeatReason | null;
  sampleTenantId: string | null;
  sampleState: SampleState | null;
  sampleClaimedAt: string | null;
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
  repeat_reason: string | null;
  sample_tenant_id: string | null;
  sample_state: string | null;
  sample_claimed_at: string | null;
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
    repeatReason: r.repeat_reason === "email" || r.repeat_reason === "network" || r.repeat_reason === "domain" ? r.repeat_reason : null,
    sampleTenantId: r.sample_tenant_id,
    sampleState: r.sample_state === "creating" || r.sample_state === "ready" || r.sample_state === "declined" ? r.sample_state : null,
    sampleClaimedAt: r.sample_claimed_at,
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
  if (/no such table: (?:main\.)?(self_trial|trial_email)\b|relation "(?:public\.)?(self_trial|trial_email)" does not exist/i.test(message)) return true;
  if (e.code === "42P01" && /self_trial|trial_email/.test(message)) return true;
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
      repeat_reason: input.repeatReason,
      sample_tenant_id: null,
      sample_state: null,
      sample_claimed_at: null,
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

/** How long a "creating" sample claim stays held before another attempt may take it over (a crashed attempt). */
export const SAMPLE_CLAIM_STALE_MS = 5 * 60_000;

/**
 * Claims the right to create the clinic's sample clinic: ONE conditional UPDATE (no sample yet and not declined, or a
 * stale "creating" claim). Two clicks at once: one wins.
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
        eb.and([eb("sample_state", "=", "creating"), eb("sample_claimed_at", "<", stale)]),
      ]),
    )
    .executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

export async function setSampleState(ctx: DbContext, tenantId: string, state: SampleState): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  let q = ctx.db.updateTable("self_trial").set({ sample_state: state, updated_at: at }).where("tenant_id", "=", tenantId).where("sample_of", "is", null);
  // "declined" only while there is no sample; "ready" only for the clinic's own claim.
  if (state === "declined") q = q.where("sample_state", "is", null);
  await q.execute();
}

/* ------------------------------------------------------------------ trial_email */

export type TrialEmailStatus = "claimed" | "sent" | "failed" | "skipped";

export interface TrialEmailRow {
  tenantId: string;
  kind: TrialEmailKind;
  status: TrialEmailStatus;
  attempts: number;
  recipients: number;
  claimedAt: string;
  sentAt: string | null;
}

/** Retries of a failed send (the provider refused it) before it is left as failed. */
export const TRIAL_EMAIL_MAX_ATTEMPTS = 3;

export async function listTrialEmails(ctx: DbContext, tenantId: string): Promise<TrialEmailRow[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom("trial_email").selectAll().where("tenant_id", "=", tenantId).execute();
  return rows
    .filter((r) => isTrialEmailKind(r.kind))
    .map((r) => ({
      tenantId: r.tenant_id,
      kind: r.kind as TrialEmailKind,
      status: (["claimed", "sent", "failed", "skipped"].includes(r.status) ? r.status : "claimed") as TrialEmailStatus,
      attempts: toInt(r.attempts),
      recipients: toInt(r.recipients),
      claimedAt: r.claimed_at,
      sentAt: r.sent_at,
    }));
}

/**
 * Claims one email for one clinic BEFORE it is sent: true = this caller sends it (or records the skip). A row that
 * exists already wins (sent, claimed by another run, skipped) – except a FAILED send, which is taken back by one
 * conditional UPDATE while it has attempts left. So every email goes at most once per clinic.
 */
export async function claimTrialEmail(ctx: DbContext, tenantId: string, kind: TrialEmailKind, status: "claimed" | "skipped" = "claimed"): Promise<boolean> {
  assertTenantId(tenantId);
  if (!isTrialEmailKind(kind)) throw new RepoInputError("Unknown trial email.");
  const at = nowIso(ctx);
  const r = await ctx.db
    .insertInto("trial_email")
    .values({ tenant_id: tenantId, kind, status, attempts: 1, recipients: 0, claimed_at: at, sent_at: null })
    .onConflict((oc) => oc.columns(["tenant_id", "kind"]).doNothing())
    .executeTakeFirst();
  if (Number(r.numInsertedOrUpdatedRows ?? 0) > 0) return true;
  if (status === "skipped") return false;
  const retry = await ctx.db
    .updateTable("trial_email")
    .set((eb) => ({ status: "claimed", attempts: eb("attempts", "+", 1), claimed_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind)
    .where("status", "=", "failed")
    .where("attempts", "<", TRIAL_EMAIL_MAX_ATTEMPTS)
    .executeTakeFirst();
  return Number(retry.numUpdatedRows) > 0;
}

/** The outcome of a claimed send. */
export async function finishTrialEmail(ctx: DbContext, tenantId: string, kind: TrialEmailKind, outcome: { status: "sent" | "failed" | "skipped"; recipients?: number }): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await ctx.db
    .updateTable("trial_email")
    .set({ status: outcome.status, recipients: outcome.recipients ?? 0, sent_at: outcome.status === "sent" ? at : null })
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", kind)
    .where("status", "=", "claimed")
    .execute();
}
