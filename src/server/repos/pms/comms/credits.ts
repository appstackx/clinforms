/**
 * Prepaid text credits – the per-clinic ledger (migration 0143, src/modules/pms/comms/credits.ts for the rules).
 *
 * `pms_sms_credit_entries` is APPEND-ONLY (a database trigger refuses any UPDATE): purchase, auto_topup, debit,
 * adjustment, reversal. `pms_sms_credit_accounts.balance` is the cached balance. CONSISTENCY GUARANTEE: every
 * balance change and its ledger entry (and its audit row) are ONE atomic batch, built so that the entry exists
 * exactly when the change happened:
 *
 *   1. INSERT the clinic's account row if it is missing (ON CONFLICT DO NOTHING);
 *   2. UPDATE balance = balance + Δ, last_entry_id = <new id> WHERE tenant_id = ? AND balance + Δ >= 0 [AND the
 *      payment / reversal is not recorded yet];
 *   3. INSERT the entry with balance_after = the account's balance – SELECTed FROM the account WHERE last_entry_id
 *      = <new id> (so nothing is written when step 2 changed nothing);
 *   4. the audit row, written only when the entry exists.
 *
 * Hence sum(credits) = balance for every clinic (ledgerCheck), and the balance is never negative (step 2's
 * condition, backed by CHECK (balance >= 0)). Debits are concurrency-safe without interactive transactions (D1):
 * the condition is in the UPDATE itself – SQLite and D1 run one batch at a time, and Postgres re-checks the
 * condition on the latest row after a concurrent writer commits (row lock) – so parallel sends can never spend the
 * same credit twice. A payment is credited at most once (NOT EXISTS in step 2 + the unique index on payment_ref:
 * the second of two simultaneous deliveries fails as a whole and is answered "already recorded"); a debit is
 * returned at most once (unique (tenant_id, reverses_id)); a webhook event is applied at most once (its id in the
 * entry's event_ref, unique everywhere).
 *
 * Nothing here holds message text or patient data: entries name the message id only.
 */
import { sql, type Selectable, type Updateable, type UpdateQueryBuilder, type UpdateResult } from "kysely";
import {
  AUTO_TOPUP_DEFAULT_THRESHOLD,
  AutoTopupInputSchema,
  CreditAdjustmentSchema,
  isSmsPackKey,
  lowThresholdFor,
  smsPack,
  type AutoTopupInput,
  type CreditAdjustmentInput,
  type CreditEntryKind,
  type CreditWarning,
  type SmsPackKey,
} from "../../../../modules/pms/comms/credits";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { classifyDbError } from "../../../db/errors";
import type { PmsSmsCreditAccountsTable, PmsSmsCreditEntriesTable } from "../../../db/pms-schema/comms";
import type { Database } from "../../../db/schema";
import { RepoInputError, assertId, assertTenantId, nowIso, num, numOrNull, parseInput, pmsId, translateDbError, type DbContext } from "../context";
import { affected, commsAuditWhen } from "./shared";

const A = "pms_sms_credit_accounts";
const E = "pms_sms_credit_entries";
/** Id prefix of ledger entries (comms: msg mtpl rrule msch cev ltr ltpl smsc). */
export const CREDIT_ENTRY_PREFIX = "smsc";
/**
 * A top-up claim older than this is free again (a crashed request never blocks top-ups for long) – and, review fix
 * 31/10/2026, at most ONE automatic top-up is attempted per clinic in this many minutes (the claim's time stays as
 * "the last attempt" after a top-up ends), so a misconfiguration can never charge the card again and again.
 */
export const TOPUP_CLAIM_MINUTES = 10;

/** The payment mode of a customer or a paid entry (migrations 0144 / 0145). */
export type PaymentMode = "test" | "live";
const modeOf = (v: string | null | undefined): PaymentMode | null => (v === "test" || v === "live" ? v : null);

export interface SmsCreditAccount {
  tenantId: string;
  balance: number;
  lastPackCredits: number | null;
  lowThreshold: number;
  lowWarned: boolean;
  zeroWarned: boolean;
  autoTopup: boolean;
  autoTopupThreshold: number;
  autoTopupPack: SmsPackKey | null;
  /** Automatic top-up paused after a failed card payment (until the owner switches it on again). */
  autoTopupPausedAt: string | null;
  autoTopupFailure: string | null;
  customerRef: string | null;
  /** The mode the customer was made in (null = before migration 0144, i.e. test mode). */
  customerMode: PaymentMode | null;
  card: { methodRef: string; brand: string; last4: string; expMonth: number; expYear: number } | null;
  rev: number;
  updatedAt: string | null;
}

export interface SmsCreditEntry {
  tenantId: string;
  id: string;
  kind: CreditEntryKind;
  credits: number;
  balanceAfter: number;
  pack: SmsPackKey | null;
  amountPence: number | null;
  messageId: string | null;
  reversesId: string | null;
  paymentRef: string | null;
  /** purchase / auto_topup: the payment's mode (null = before migration 0145, i.e. test mode). */
  mode: PaymentMode | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

const EMPTY = (tenantId: string): SmsCreditAccount => ({
  tenantId,
  balance: 0,
  lastPackCredits: null,
  lowThreshold: lowThresholdFor(null),
  lowWarned: false,
  zeroWarned: false,
  autoTopup: false,
  autoTopupThreshold: AUTO_TOPUP_DEFAULT_THRESHOLD,
  autoTopupPack: null,
  autoTopupPausedAt: null,
  autoTopupFailure: null,
  customerRef: null,
  customerMode: null,
  card: null,
  rev: 0,
  updatedAt: null,
});

function toAccount(r: Selectable<PmsSmsCreditAccountsTable>): SmsCreditAccount {
  const card =
    r.card_method_ref && r.card_brand && r.card_last4
      ? { methodRef: r.card_method_ref, brand: r.card_brand, last4: r.card_last4, expMonth: num(r.card_exp_month ?? 12), expYear: num(r.card_exp_year ?? 2030) }
      : null;
  return {
    tenantId: r.tenant_id,
    balance: num(r.balance),
    lastPackCredits: numOrNull(r.last_pack_credits),
    lowThreshold: num(r.low_threshold),
    lowWarned: num(r.low_warned) === 1,
    zeroWarned: num(r.zero_warned) === 1,
    autoTopup: num(r.auto_topup) === 1,
    autoTopupThreshold: num(r.auto_topup_threshold),
    autoTopupPack: isSmsPackKey(r.auto_topup_pack) ? r.auto_topup_pack : null,
    autoTopupPausedAt: r.auto_topup_paused_at,
    autoTopupFailure: r.auto_topup_failure,
    customerRef: r.customer_ref,
    customerMode: modeOf(r.customer_mode),
    card,
    rev: num(r.rev),
    updatedAt: r.updated_at,
  };
}

function toEntry(r: Selectable<PmsSmsCreditEntriesTable>): SmsCreditEntry {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    kind: r.kind as CreditEntryKind,
    credits: num(r.credits),
    balanceAfter: num(r.balance_after),
    pack: isSmsPackKey(r.pack) ? r.pack : null,
    amountPence: numOrNull(r.amount_pence),
    messageId: r.message_id,
    reversesId: r.reverses_id,
    paymentRef: r.payment_ref,
    mode: modeOf(r.mode),
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** The clinic's account (the defaults when it has none yet – no row is written by reading). */
export async function getSmsCreditAccount(ctx: DbContext, tenantId: string): Promise<SmsCreditAccount> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(A).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return r ? toAccount(r) : EMPTY(tenantId);
}

/** Several clinics' accounts (the platform page) – by id, in groups of 90. Clinics without a row are left out. */
export async function getSmsCreditAccounts(ctx: DbContext, tenantIds: readonly string[]): Promise<Map<string, SmsCreditAccount>> {
  const out = new Map<string, SmsCreditAccount>();
  const ids = Array.from(new Set(tenantIds));
  for (const t of ids) assertTenantId(t);
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await ctx.db.selectFrom(A).selectAll().where("tenant_id", "in", ids.slice(i, i + 90)).execute();
    for (const r of rows) out.set(r.tenant_id, toAccount(r));
  }
  return out;
}

/** The ledger, newest first (keyset by id). */
export async function listSmsCreditEntries(ctx: DbContext, tenantId: string, options: { limit?: number; beforeId?: string; kind?: CreditEntryKind } = {}): Promise<SmsCreditEntry[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 500);
  let q = ctx.db.selectFrom(E).selectAll().where("tenant_id", "=", tenantId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  if (options.beforeId) q = q.where("id", "<", options.beforeId);
  return (await q.orderBy("id", "desc").limit(limit).execute()).map(toEntry);
}

/** The ledger entry recorded for a payment, if any. */
export async function findCreditByPayment(ctx: DbContext, tenantId: string, paymentRef: string): Promise<SmsCreditEntry | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(E).selectAll().where("tenant_id", "=", tenantId).where("payment_ref", "=", paymentRef).executeTakeFirst();
  return r ? toEntry(r) : null;
}

/** Ledger and cached balance agree: sum of the entries = the balance = the last entry's balance_after. */
export async function ledgerCheck(ctx: DbContext, tenantId: string): Promise<{ ok: boolean; balance: number; ledgerSum: number; entries: number }> {
  assertTenantId(tenantId);
  const [acct, sum] = await Promise.all([
    getSmsCreditAccount(ctx, tenantId),
    ctx.db
      .selectFrom(E)
      .select((eb) => [eb.fn.coalesce(eb.fn.sum<number>("credits"), sql<number>`0`).as("total"), eb.fn.countAll<number>().as("n")])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst(),
  ]);
  const ledgerSum = num(sum?.total ?? 0);
  const last = await ctx.db.selectFrom(E).select("balance_after").where("tenant_id", "=", tenantId).orderBy("id", "desc").limit(1).executeTakeFirst();
  const lastOk = last ? num(last.balance_after) === acct.balance : acct.balance === 0;
  return { ok: ledgerSum === acct.balance && lastOk, balance: acct.balance, ledgerSum, entries: num(sum?.n ?? 0) };
}

/* ------------------------------------------------------------------------------------------------
 * Balance changes (the only way the balance moves)
 * ----------------------------------------------------------------------------------------------*/

function ensureAccountQuery(ctx: DbContext, tenantId: string, at: string): BatchQuery {
  return ctx.db
    .insertInto(A)
    .values({ tenant_id: tenantId, created_at: at, updated_at: at })
    .onConflict((oc) => oc.column("tenant_id").doNothing());
}

export interface CreditChange {
  kind: CreditEntryKind;
  /** Signed: + adds credits, − takes them. */
  credits: number;
  pack?: SmsPackKey | null;
  amountPence?: number | null;
  messageId?: string | null;
  /** reversal: the debit it returns. */
  reversesId?: string | null;
  /** purchase / auto_topup: the payment provider's payment reference (credited once). */
  paymentRef?: string | null;
  /** The webhook event that made it (applied once) – or a platform adjustment's request id (submitted once). */
  eventRef?: string | null;
  /** purchase / auto_topup: the payment's mode (test / live). */
  mode?: PaymentMode | null;
  reason?: string | null;
  /** Audit detail besides the entry's own (ids and counts only). */
  detail?: Record<string, unknown>;
}

export type CreditChangeResult = { ok: true; entryId: string; balance: number } | { ok: false; reason: "insufficient" | "duplicate" };

const AUDIT_ACTION: Readonly<Record<CreditEntryKind, string>> = {
  purchase: "pms.sms_credit.purchase",
  auto_topup: "pms.sms_credit.auto_topup",
  debit: "pms.sms_credit.debit",
  adjustment: "pms.sms_credit.adjust",
  reversal: "pms.sms_credit.reversal",
};

/**
 * Applies one balance change with its ledger entry and audit row (one batch – see the file comment). `extra` are
 * written in the same batch, unconditionally (e.g. the webhook event row: a replayed event fails the batch as a
 * whole). Answers "insufficient" (a debit or negative adjustment larger than the balance – nothing written) or
 * "duplicate" (the payment or reversal is already recorded – nothing written).
 */
export async function changeSmsCredits(ctx: DbContext, tenantId: string, change: CreditChange, actor: PmsActor, extra: BatchQuery[] = []): Promise<CreditChangeResult> {
  assertTenantId(tenantId);
  const delta = change.credits;
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw new RepoInputError("A credit change must be a whole number of credits other than 0.");
  if ((change.kind === "debit") !== delta < 0 && change.kind !== "adjustment") throw new RepoInputError("A debit takes credits and every other change adds them.");
  if ((change.kind === "purchase" || change.kind === "auto_topup") && !change.paymentRef) throw new RepoInputError("A purchase needs its payment reference.");
  if ((change.kind === "purchase" || change.kind === "auto_topup") && !modeOf(change.mode)) throw new RepoInputError("A purchase needs its payment mode (test or live).");
  if (change.kind === "reversal" && !change.reversesId) throw new RepoInputError("A reversal needs the debit it returns.");
  if (change.paymentRef) assertId(change.paymentRef, "payment reference");
  if (change.eventRef) assertId(change.eventRef, "event reference");
  const pack = change.pack ? smsPack(change.pack) : null;
  const at = nowIso(ctx);
  const id = pmsId(CREDIT_ENTRY_PREFIX, ctx);
  const setsPack = Boolean(pack) && (change.kind === "purchase" || change.kind === "auto_topup");

  let update = ctx.db
    .updateTable(A)
    .set((eb) => ({
      balance: eb("balance", "+", delta),
      last_entry_id: id,
      rev: eb("rev", "+", 1),
      updated_at: at,
      ...(setsPack && pack ? { last_pack_credits: pack.credits, low_threshold: lowThresholdFor(pack.credits) } : {}),
    }))
    .where("tenant_id", "=", tenantId)
    .where((eb) => eb(eb("balance", "+", delta), ">=", 0));
  if (change.paymentRef) {
    const ref = change.paymentRef;
    update = update.where((eb) => eb.not(eb.exists(ctx.db.selectFrom(E).select("id").where("tenant_id", "=", tenantId).where("payment_ref", "=", ref))));
  }
  if (change.reversesId) {
    const rid = change.reversesId;
    update = update.where((eb) => eb.not(eb.exists(ctx.db.selectFrom(E).select("id").where("tenant_id", "=", tenantId).where("reverses_id", "=", rid))));
  }
  if (change.eventRef) {
    const ev = change.eventRef;
    update = update.where((eb) => eb.not(eb.exists(ctx.db.selectFrom(E).select("id").where("tenant_id", "=", tenantId).where("event_ref", "=", ev))));
  }

  const insert = ctx.db
    .insertInto(E)
    .columns(["tenant_id", "id", "kind", "credits", "balance_after", "pack", "amount_pence", "message_id", "reverses_id", "payment_ref", "event_ref", "mode", "reason", "created_by", "created_at"])
    .expression(
      ctx.db
        .selectFrom(A)
        .select((eb) => [
          "tenant_id",
          eb.val(id).as("id"),
          eb.val(change.kind).as("kind"),
          eb.val(delta).as("credits"),
          "balance as balance_after",
          eb.val(pack?.key ?? null).as("pack"),
          eb.val(change.amountPence ?? null).as("amount_pence"),
          eb.val(change.messageId ?? null).as("message_id"),
          eb.val(change.reversesId ?? null).as("reverses_id"),
          eb.val(change.paymentRef ?? null).as("payment_ref"),
          eb.val(change.eventRef ?? null).as("event_ref"),
          eb.val(modeOf(change.mode)).as("mode"),
          eb.val(change.reason ? change.reason.slice(0, 200) : null).as("reason"),
          eb.val(actor.userId).as("created_by"),
          eb.val(at).as("created_at"),
        ])
        .where("tenant_id", "=", tenantId)
        .where("last_entry_id", "=", id),
    );

  // Credit that lifts the balance above a warning line arms that warning again (once per crossing).
  const rearm: BatchQuery[] =
    delta > 0
      ? [
          ctx.db
            .updateTable(A)
            .set({ low_warned: 0 })
            .where("tenant_id", "=", tenantId)
            .where("last_entry_id", "=", id)
            .where((eb) => eb("balance", ">", eb.ref("low_threshold"))),
          ctx.db.updateTable(A).set({ zero_warned: 0 }).where("tenant_id", "=", tenantId).where("last_entry_id", "=", id).where("balance", ">", 0),
        ]
      : [];

  const audit = commsAuditWhen(
    ctx,
    tenantId,
    actor,
    {
      action: AUDIT_ACTION[change.kind],
      targetType: "pms_sms_credit_entry",
      targetId: id,
      detail: {
        credits: delta,
        ...(pack ? { pack: pack.key } : {}),
        ...(change.messageId ? { messageId: change.messageId } : {}),
        ...(change.reversesId ? { reversesId: change.reversesId } : {}),
        ...(change.paymentRef ? { paymentRef: change.paymentRef } : {}),
        ...(change.detail ?? {}),
      },
    },
    ctx.db.selectFrom(E).select("id").where("tenant_id", "=", tenantId).where("id", "=", id),
  );

  let results;
  try {
    results = await runBatch(ctx.db, [ensureAccountQuery(ctx, tenantId, at), update, insert, ...rearm, audit, ...extra]);
  } catch (err) {
    // Two deliveries of one payment (or reversal) at the same moment: the second fails on the unique index.
    if (classifyDbError(err) === "CONSTRAINT_UNIQUE" && (change.paymentRef || change.reversesId || change.eventRef || extra.length)) return { ok: false, reason: "duplicate" };
    throw translateDbError(err, {});
  }
  if (affected(results[1] as { numAffectedRows?: bigint }) === 0) {
    if (change.paymentRef && (await findCreditByPayment(ctx, tenantId, change.paymentRef))) return { ok: false, reason: "duplicate" };
    if (change.eventRef && (await webhookEventApplied(ctx, tenantId, change.eventRef))) return { ok: false, reason: "duplicate" };
    if (change.reversesId) {
      const done = await ctx.db.selectFrom(E).select("id").where("tenant_id", "=", tenantId).where("reverses_id", "=", change.reversesId).executeTakeFirst();
      if (done) return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: "insufficient" };
  }
  const row = await ctx.db.selectFrom(E).select("balance_after").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return { ok: true, entryId: id, balance: num(row?.balance_after ?? 0) };
}

/** Takes `credits` for a text BEFORE the provider is called (the reservation). "insufficient": nothing taken. */
export async function reserveSmsCredits(ctx: DbContext, tenantId: string, input: { credits: number; messageId: string }, actor: PmsActor): Promise<CreditChangeResult> {
  if (!Number.isInteger(input.credits) || input.credits < 1) throw new RepoInputError("A text costs at least one credit.");
  assertId(input.messageId, "message id");
  return changeSmsCredits(ctx, tenantId, { kind: "debit", credits: -input.credits, messageId: input.messageId }, actor);
}

/**
 * Gives a reservation back (the provider did not send the text, or it was only kept in the outbox): a reversal
 * entry of the same size, at most once per debit.
 */
export async function releaseSmsCredits(ctx: DbContext, tenantId: string, input: { debitId: string; credits: number; messageId: string | null; why: string }, actor: PmsActor): Promise<CreditChangeResult> {
  assertId(input.debitId, "debit id");
  const debit = await ctx.db.selectFrom(E).select(["kind", "credits"]).where("tenant_id", "=", tenantId).where("id", "=", input.debitId).executeTakeFirst();
  if (!debit || debit.kind !== "debit" || num(debit.credits) !== -Math.abs(input.credits)) throw new RepoInputError("That text credit reservation does not exist in this clinic.");
  return changeSmsCredits(
    ctx,
    tenantId,
    { kind: "reversal", credits: Math.abs(input.credits), reversesId: input.debitId, messageId: input.messageId, detail: { why: input.why.slice(0, 40) } },
    actor,
  );
}

/** A pack paid for (checkout or automatic top-up), credited once per payment reference. */
export async function creditSmsPack(
  ctx: DbContext,
  tenantId: string,
  input: { kind: "purchase" | "auto_topup"; pack: SmsPackKey; amountPence: number; paymentRef: string; mode: PaymentMode; eventRef?: string | null },
  actor: PmsActor,
  extra: BatchQuery[] = [],
): Promise<CreditChangeResult> {
  const pack = smsPack(input.pack);
  if (!pack) throw new RepoInputError("Unknown text credit pack.");
  return changeSmsCredits(ctx, tenantId, { kind: input.kind, credits: pack.credits, pack: pack.key, amountPence: input.amountPence, paymentRef: input.paymentRef, mode: input.mode, eventRef: input.eventRef ?? null, detail: { mode: input.mode } }, actor, extra);
}

/**
 * A support adjustment (+ or −) with its reason. A negative one larger than the balance is refused. `requestId`
 * (review fix 31/10/2026): the form's one-time id – a second submit of the same form is "duplicate", not a second
 * adjustment (kept in event_ref, unique everywhere, as "adj_<id>").
 */
export async function adjustSmsCredits(
  ctx: DbContext,
  tenantId: string,
  input: CreditAdjustmentInput,
  actor: PmsActor,
  detail: Record<string, unknown> = {},
  options: { requestId?: string | null; reversesId?: string | null } = {},
): Promise<CreditChangeResult> {
  const d = parseInput(CreditAdjustmentSchema, input, "Adjustment");
  const requestId = options.requestId ? String(options.requestId) : null;
  if (requestId !== null && !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new RepoInputError("The form has expired. Reload the page and try again.");
  return changeSmsCredits(
    ctx,
    tenantId,
    { kind: "adjustment", credits: d.credits, reason: d.reason, detail, eventRef: requestId ? `adj_${requestId}` : null, reversesId: options.reversesId ?? null },
    actor,
  );
}

/* ------------------------------------------------------------------------------------------------
 * Webhook events (idempotency by event id: an event's credit carries its id in event_ref, unique everywhere)
 * ----------------------------------------------------------------------------------------------*/

/** Whether a webhook event already made a ledger entry for this clinic. */
export async function webhookEventApplied(ctx: DbContext, tenantId: string, eventId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(E).select("id").where("tenant_id", "=", tenantId).where("event_ref", "=", eventId).executeTakeFirst();
  return Boolean(r);
}

/* ------------------------------------------------------------------------------------------------
 * Settings, the saved card and the payment provider's customer
 * ----------------------------------------------------------------------------------------------*/

async function accountChange(
  ctx: DbContext,
  tenantId: string,
  actor: PmsActor,
  set: Updateable<PmsSmsCreditAccountsTable>,
  audit: { action: string; detail?: Record<string, unknown> },
  where?: (q: AccountUpdate) => AccountUpdate,
): Promise<boolean> {
  const at = nowIso(ctx);
  let q: AccountUpdate = ctx.db
    .updateTable(A)
    .set((eb) => ({ ...set, rev: eb("rev", "+", 1), updated_at: at, updated_by: actor.userId }))
    .where("tenant_id", "=", tenantId);
  if (where) q = where(q);
  try {
    const results = await runBatch(ctx.db, [
      ensureAccountQuery(ctx, tenantId, at),
      q,
      commsAuditWhen(
        ctx,
        tenantId,
        actor,
        { action: audit.action, targetType: "pms_sms_credit_account", targetId: tenantId, detail: audit.detail ?? {} },
        ctx.db.selectFrom(A).select("tenant_id").where("tenant_id", "=", tenantId).where("updated_at", "=", at),
      ),
    ]);
    return affected(results[1] as { numAffectedRows?: bigint }) > 0;
  } catch (err) {
    throw translateDbError(err, { unique: "That card or customer is already linked to another clinic." });
  }
}

type AccountUpdate = UpdateQueryBuilder<Database, typeof A, typeof A, UpdateResult>;

/** Automatic top-up on/off, its threshold and pack (owner / admin). Switching it on clears a pause. */
export async function saveAutoTopup(ctx: DbContext, tenantId: string, input: AutoTopupInput, actor: PmsActor): Promise<SmsCreditAccount> {
  assertTenantId(tenantId);
  const d = parseInput(AutoTopupInputSchema, input, "Automatic top-up");
  // Review fix 31/10/2026: the schema refuses a trigger level above the pack's credits (repeated charges).
  if (d.enabled) {
    const acct = await getSmsCreditAccount(ctx, tenantId);
    if (!acct.card) throw new RepoInputError("Save a card first: automatic top-up charges the saved card.");
  }
  await accountChange(
    ctx,
    tenantId,
    actor,
    {
      auto_topup: d.enabled ? 1 : 0,
      auto_topup_threshold: d.threshold,
      auto_topup_pack: d.pack,
      // Switching it on is the owner's own decision: the pause and the 10-minute spacing start afresh (but never
      // while a top-up is running – its claim keeps its time).
      ...(d.enabled ? { auto_topup_paused_at: null, auto_topup_failure: null, topup_claimed_at: sql<string | null>`CASE WHEN topup_claim IS NULL THEN NULL ELSE topup_claimed_at END` as unknown as string | null } : {}),
    },
    { action: "pms.sms_credit.settings", detail: { autoTopup: d.enabled, threshold: d.threshold, pack: d.pack } },
  );
  return getSmsCreditAccount(ctx, tenantId);
}

/**
 * The payment provider's customer for this clinic in `mode`, set once per mode (later calls keep the first). A
 * customer of the OTHER mode (a test customer once live payments are on – review fix 31/10/2026) is replaced, and the
 * card saved with it is cleared and automatic top-up switched off: test references are never used in live mode.
 * True = set now.
 */
export async function setCreditCustomer(ctx: DbContext, tenantId: string, customerRef: string, actor: PmsActor, mode: PaymentMode = "test"): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(customerRef, "customer reference");
  if (!modeOf(mode)) throw new RepoInputError("The customer's payment mode must be test or live.");
  const acct = await getSmsCreditAccount(ctx, tenantId);
  const stale = acct.customerRef !== null && (acct.customerMode ?? "test") !== mode;
  if (!stale) {
    return accountChange(ctx, tenantId, actor, { customer_ref: customerRef, customer_mode: mode }, { action: "pms.sms_credit.customer", detail: { mode } }, (q) => q.where("customer_ref", "is", null));
  }
  const old = acct.customerRef as string;
  return accountChange(
    ctx,
    tenantId,
    actor,
    { customer_ref: customerRef, customer_mode: mode, card_method_ref: null, card_brand: null, card_last4: null, card_exp_month: null, card_exp_year: null, auto_topup: 0 },
    { action: "pms.sms_credit.customer", detail: { mode, replacedOtherMode: true } },
    (q) => q.where("customer_ref", "=", old),
  );
}

/**
 * Go-live (npm run admin:billing-go-live): forgets the clinic's TEST customer and saved card (references only) and
 * switches automatic top-up off. True = something was cleared.
 */
export async function clearTestCreditCustomer(ctx: DbContext, tenantId: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  return accountChange(
    ctx,
    tenantId,
    actor,
    { customer_ref: null, customer_mode: null, card_method_ref: null, card_brand: null, card_last4: null, card_exp_month: null, card_exp_year: null, auto_topup: 0 },
    { action: "pms.sms_credit.test_customer_cleared" },
    (q) => q.where("customer_ref", "is not", null).where((eb) => eb.or([eb("customer_mode", "is", null), eb("customer_mode", "=", "test")])),
  );
}

/** Paid entries (purchase / auto_topup) of a mode other than live, not yet reversed (go-live). */
export async function listUnreversedTestPurchases(ctx: DbContext, tenantId: string): Promise<SmsCreditEntry[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(E)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("kind", "in", ["purchase", "auto_topup"])
    .where((eb) => eb.or([eb("mode", "is", null), eb("mode", "=", "test")]))
    .where((eb) => eb.not(eb.exists(ctx.db.selectFrom(`${E} as r`).select("r.id").where("r.tenant_id", "=", tenantId).where(sql<boolean>`r.reverses_id = pms_sms_credit_entries.id`))))
    .orderBy("id")
    .execute();
  return rows.map(toEntry);
}

/** Every clinic with a credit account (go-live: the clinics to clean). */
export async function listCreditAccountTenants(ctx: DbContext): Promise<string[]> {
  const rows = await ctx.db.selectFrom(A).select("tenant_id").orderBy("tenant_id").execute();
  return rows.map((r) => r.tenant_id);
}

/** Saves the clinic's card for automatic top-up (references, brand, last four, expiry – never a card number). */
export async function saveCreditCard(
  ctx: DbContext,
  tenantId: string,
  card: { customerRef: string; methodRef: string; brand: string; last4: string; expMonth: number; expYear: number },
  actor: PmsActor,
): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(card.methodRef, "card reference");
  if (!/^\d{4}$/.test(card.last4)) throw new RepoInputError("The card's last four digits are not valid.");
  return accountChange(
    ctx,
    tenantId,
    actor,
    {
      card_method_ref: card.methodRef,
      card_brand: card.brand.slice(0, 20) || "card",
      card_last4: card.last4,
      card_exp_month: Math.min(12, Math.max(1, Math.floor(card.expMonth))),
      card_exp_year: Math.min(2100, Math.max(2000, Math.floor(card.expYear))),
      auto_topup_paused_at: null,
      auto_topup_failure: null,
    },
    { action: "pms.sms_credit.card_save", detail: { brand: card.brand.slice(0, 20) } },
    // The card must belong to this clinic's own customer at the provider.
    (q) => q.where("customer_ref", "=", card.customerRef),
  );
}

/** Removes the saved card; automatic top-up goes off with it. */
export async function removeCreditCard(ctx: DbContext, tenantId: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  return accountChange(
    ctx,
    tenantId,
    actor,
    { card_method_ref: null, card_brand: null, card_last4: null, card_exp_month: null, card_exp_year: null, auto_topup: 0 },
    { action: "pms.sms_credit.card_remove" },
    (q) => q.where("card_method_ref", "is not", null),
  );
}

/**
 * Claims the clinic's automatic top-up (only one at a time: a claim older than TOPUP_CLAIM_MINUTES is free again).
 * True = this caller may charge the card, with `token` as the payment's idempotency key.
 */
export async function claimTopUp(ctx: DbContext, tenantId: string, token: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(token, "top-up token");
  const at = nowIso(ctx);
  const stale = new Date(Date.parse(at) - TOPUP_CLAIM_MINUTES * 60_000).toISOString();
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(A)
      .set({ topup_claim: token, topup_claimed_at: at })
      .where("tenant_id", "=", tenantId)
      .where("auto_topup", "=", 1)
      .where("auto_topup_paused_at", "is", null)
      .where("card_method_ref", "is not", null)
      // One attempt per TOPUP_CLAIM_MINUTES: topup_claimed_at stays as the last attempt after a top-up ends; a claim
      // still held (topup_claim set) is free again only once it is stale.
      .where((eb) => eb.or([eb.and([eb("topup_claim", "is", null), eb("topup_claimed_at", "is", null)]), eb("topup_claimed_at", "<", stale)])),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.sms_credit.topup_claim", targetType: "pms_sms_credit_account", targetId: tenantId },
      ctx.db.selectFrom(A).select("tenant_id").where("tenant_id", "=", tenantId).where("topup_claim", "=", token).where("topup_claimed_at", "=", at),
    ),
  ]);
  return affected(results[0] as { numAffectedRows?: bigint }) > 0;
}

/** Ends a claim: on failure automatic top-up is paused with the provider's code (audited). */
export async function finishTopUp(ctx: DbContext, tenantId: string, token: string, outcome: { ok: true } | { ok: false; code: string }, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  if (outcome.ok) {
    // topup_claimed_at is kept: the last attempt's time (one attempt per TOPUP_CLAIM_MINUTES).
    await runBatch(ctx.db, [ctx.db.updateTable(A).set({ topup_claim: null }).where("tenant_id", "=", tenantId).where("topup_claim", "=", token)]);
    return;
  }
  const at = nowIso(ctx);
  await runBatch(ctx.db, [
    ctx.db
      .updateTable(A)
      .set({ topup_claim: null, auto_topup_paused_at: at, auto_topup_failure: outcome.code.slice(0, 40), updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("topup_claim", "=", token),
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.sms_credit.topup_failed", targetType: "pms_sms_credit_account", targetId: tenantId, detail: { code: outcome.code.slice(0, 40) } },
      ctx.db.selectFrom(A).select("tenant_id").where("tenant_id", "=", tenantId).where("auto_topup_paused_at", "=", at),
    ),
  ]);
}

/**
 * Claims a balance warning (once per crossing): sets its flag 0 → 1 while the balance is still on the warned side,
 * with the audit row in the same batch. True = this caller sends the email. "zero" also marks "low" as sent.
 */
export async function claimCreditWarning(ctx: DbContext, tenantId: string, warning: CreditWarning, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const q =
    warning === "zero"
      ? ctx.db.updateTable(A).set({ zero_warned: 1, low_warned: 1, updated_at: at }).where("tenant_id", "=", tenantId).where("zero_warned", "=", 0).where("balance", "<=", 0)
      : ctx.db
          .updateTable(A)
          .set({ low_warned: 1, updated_at: at })
          .where("tenant_id", "=", tenantId)
          .where("low_warned", "=", 0)
          .where((eb) => eb("balance", "<=", eb.ref("low_threshold")));
  const results = await runBatch(ctx.db, [
    q,
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.sms_credit.warning", targetType: "pms_sms_credit_account", targetId: tenantId, detail: { warning } },
      ctx.db
        .selectFrom(A)
        .select("tenant_id")
        .where("tenant_id", "=", tenantId)
        .where("updated_at", "=", at)
        .where(warning === "zero" ? "zero_warned" : "low_warned", "=", 1),
    ),
  ]);
  return affected(results[0] as { numAffectedRows?: bigint }) > 0;
}
