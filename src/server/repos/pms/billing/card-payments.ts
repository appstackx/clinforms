/**
 * Card payments through the clinic's own connected account (migrations 0226–0229, 0239–0241,
 * docs/clinic-system/card-payments.md): the clinic's card settings, desk readers, intents (every payment, card
 * set-up and refund made through the account), handled webhook events, saved cards with consent, membership plans
 * and memberships. Every statement names tenant_id; the ONE cross-clinic read is findTenantByAccount (the webhook
 * learns the clinic from the account an event came from). Money itself is recorded only in pms_payments
 * (./payments.ts) – these tables never count takings.
 */
import { sql } from "kysely";
import {
  CARD_CONSENT_VERSION,
  clampDay,
  type AccountState,
  type CardAccountStatus,
  type CardIntentKind,
  type CardIntentPurpose,
  type CardIntentStatus,
  type ConsentChannel,
  type MandateStatus,
  type MembershipStatus,
} from "../../../../modules/pms/billing/card-payments";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { DbContext } from "../../context";
import { RepoInputError, assertId, assertTenantId, b01, isOn, nowIso, num, numOrNull, pmsAuditQuery, pmsId, type RepoContext } from "../context";
import { readOrEmpty } from "./healthcode";
import { ensureSettingsQuery } from "./settings";
import { affected, billingAuditWhen, billingBatch } from "./shared";

const SETTINGS = "pms_card_settings";
const READERS = "pms_card_readers";
const INTENTS = "pms_card_intents";
const EVENTS = "pms_card_events";
const MANDATES = "pms_card_mandates";
const PLANS = "pms_membership_plans";
const MEMBERS = "pms_memberships";

export const CARD_ID_PREFIXES = { reader: "crdr", intent: "cint", mandate: "cmdt", plan: "mplan", membership: "mbr" } as const;

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

/** The settings row (and the billing settings row it hangs off) – first in any batch that writes a child row. */
function ensureCardSettingsQueries(ctx: DbContext, tenantId: string, at: string) {
  return [
    ensureSettingsQuery(ctx, tenantId, at),
    ctx.db
      .insertInto(SETTINGS)
      .values({ tenant_id: tenantId, created_at: at, updated_at: at })
      .onConflict((oc) => oc.column("tenant_id").doNothing()),
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Settings and the connected account
 * ----------------------------------------------------------------------------------------------*/

export interface CardSettings {
  tenantId: string;
  rev: number;
  enabled: boolean;
  accountRef: string | null;
  accountMode: "test" | "live" | null;
  status: CardAccountStatus;
  cardCapability: string | null;
  payoutsCapability: string | null;
  requirementsDue: number;
  lastSyncedAt: string | null;
  feeBps: number;
  feeFixedPence: number;
  noShowEnabled: boolean;
  noShowPolicy: string | null;
}

export function emptyCardSettings(tenantId: string): CardSettings {
  return {
    tenantId,
    rev: 0,
    enabled: false,
    accountRef: null,
    accountMode: null,
    status: "none",
    cardCapability: null,
    payoutsCapability: null,
    requirementsDue: 0,
    lastSyncedAt: null,
    feeBps: 0,
    feeFixedPence: 0,
    noShowEnabled: false,
    noShowPolicy: null,
  };
}

export async function getCardSettings(ctx: DbContext, tenantId: string): Promise<CardSettings> {
  assertTenantId(tenantId);
  return readOrEmpty(SETTINGS, emptyCardSettings(tenantId), async () => {
    const r = await ctx.db.selectFrom(SETTINGS).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!r) return emptyCardSettings(tenantId);
    return {
      tenantId,
      rev: num(r.rev),
      enabled: isOn(r.enabled),
      accountRef: r.account_ref,
      accountMode: r.account_mode === "test" || r.account_mode === "live" ? r.account_mode : null,
      status: (r.account_status as CardAccountStatus) ?? "none",
      cardCapability: r.card_capability,
      payoutsCapability: r.payouts_capability,
      requirementsDue: num(r.requirements_due),
      lastSyncedAt: iso(r.last_synced_at),
      feeBps: num(r.fee_bps),
      feeFixedPence: num(r.fee_fixed_pence),
      noShowEnabled: isOn(r.no_show_enabled),
      noShowPolicy: r.no_show_policy,
    };
  });
}

/**
 * The clinic whose connected account this is (the webhook's only cross-clinic read: an event names the account it
 * came from, never a clinic). Null for an account no clinic has.
 */
export async function findTenantByAccount(ctx: DbContext, accountRef: string): Promise<string | null> {
  if (!/^acct_[A-Za-z0-9]{6,60}$/.test(accountRef)) return null;
  const r = await readOrEmpty(SETTINGS, undefined, () => ctx.db.selectFrom(SETTINGS).select("tenant_id").where("account_ref", "=", accountRef).executeTakeFirst());
  return r?.tenant_id ?? null;
}

/** Records the connected account just made (or replaces one of the other mode). Audited. */
export async function saveConnectedAccount(ctx: DbContext, tenantId: string, input: { accountRef: string; mode: "test" | "live"; state: AccountState }, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await billingBatch(
    ctx,
    [
      ...ensureCardSettingsQueries(ctx, tenantId, at),
      ctx.db
        .updateTable(SETTINGS)
        .set((eb) => ({
          account_ref: input.accountRef,
          account_mode: input.mode,
          account_status: input.state.status,
          card_capability: input.state.cardPayments.slice(0, 30),
          payouts_capability: input.state.payouts.slice(0, 30),
          requirements_due: input.state.requirementsDue,
          last_synced_at: at,
          rev: eb("rev", "+", 1),
          updated_by: actor.userId,
          updated_at: at,
        }))
        .where("tenant_id", "=", tenantId),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.card_account.connect", targetType: "pms_card_settings", targetId: tenantId, detail: { mode: input.mode, status: input.state.status } }),
    ],
    { unique: "That payment account is already connected to another clinic." },
  );
}

/** The provider's latest answer about the account (onboarding return, refresh, webhook). Audited when the status changes. */
export async function syncAccountState(ctx: DbContext, tenantId: string, accountRef: string, state: AccountState, actor: PmsActor = { userId: null, sessionId: null }): Promise<{ changed: boolean }> {
  assertTenantId(tenantId);
  const before = await getCardSettings(ctx, tenantId);
  if (before.accountRef !== accountRef) return { changed: false };
  const at = nowIso(ctx);
  await billingBatch(ctx, [
    ctx.db
      .updateTable(SETTINGS)
      .set({
        account_status: state.status,
        card_capability: state.cardPayments.slice(0, 30),
        payouts_capability: state.payouts.slice(0, 30),
        requirements_due: state.requirementsDue,
        last_synced_at: at,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("account_ref", "=", accountRef),
    ...(before.status !== state.status
      ? [pmsAuditQuery(ctx, tenantId, actor, { action: "pms.card_account.status", targetType: "pms_card_settings", targetId: tenantId, detail: { from: before.status, to: state.status, due: state.requirementsDue } })]
      : []),
  ]);
  return { changed: before.status !== state.status };
}

/** The clinic's own switch. Turning it on needs a connected account (the service checks the account is usable). */
export async function setCardEnabled(ctx: DbContext, tenantId: string, enabled: boolean, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await billingBatch(ctx, [
    ...ensureCardSettingsQueries(ctx, tenantId, at),
    ctx.db
      .updateTable(SETTINGS)
      .set((eb) => ({ enabled: b01(enabled), rev: eb("rev", "+", 1), updated_by: actor.userId, updated_at: at }))
      .where("tenant_id", "=", tenantId),
    pmsAuditQuery(ctx, tenantId, actor, { action: enabled ? "pms.card_payments.enable" : "pms.card_payments.disable", targetType: "pms_card_settings", targetId: tenantId, detail: {} }),
  ]);
}

/** Missed-appointment charges to saved cards: on/off and the policy wording patients agree to. */
export async function setNoShowPolicy(ctx: DbContext, tenantId: string, input: { enabled: boolean; policy: string | null }, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const policy = input.policy?.trim() || null;
  if (input.enabled && (!policy || policy.length < 10)) throw new RepoInputError("Write the missed-appointment policy patients agree to (at least 10 characters).");
  if (policy && policy.length > 500) throw new RepoInputError("The policy is too long (500 characters at most).");
  const at = nowIso(ctx);
  await billingBatch(ctx, [
    ...ensureCardSettingsQueries(ctx, tenantId, at),
    ctx.db
      .updateTable(SETTINGS)
      .set((eb) => ({ no_show_enabled: b01(input.enabled), no_show_policy: policy, rev: eb("rev", "+", 1), updated_by: actor.userId, updated_at: at }))
      .where("tenant_id", "=", tenantId),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.card_payments.no_show_policy", targetType: "pms_card_settings", targetId: tenantId, detail: { enabled: input.enabled } }),
  ]);
}

/** The platform fee for this clinic (platform admin only – owner's decision; default 0). */
export async function setPlatformFee(ctx: DbContext, tenantId: string, input: { bps: number; fixedPence: number }, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  if (!Number.isInteger(input.bps) || input.bps < 0 || input.bps > 1000) throw new RepoInputError("The percentage fee must be 0–1000 basis points.");
  if (!Number.isInteger(input.fixedPence) || input.fixedPence < 0 || input.fixedPence > 500) throw new RepoInputError("The fixed fee must be 0–500 pence.");
  const at = nowIso(ctx);
  await billingBatch(ctx, [
    ...ensureCardSettingsQueries(ctx, tenantId, at),
    ctx.db
      .updateTable(SETTINGS)
      .set((eb) => ({ fee_bps: input.bps, fee_fixed_pence: input.fixedPence, rev: eb("rev", "+", 1), updated_by: actor.userId, updated_at: at }))
      .where("tenant_id", "=", tenantId),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.card_payments.fee", targetType: "pms_card_settings", targetId: tenantId, detail: { bps: input.bps, fixedPence: input.fixedPence } }),
  ]);
}

/* ------------------------------------------------------------------------------------------------
 * Readers
 * ----------------------------------------------------------------------------------------------*/

export interface CardReader {
  id: string;
  siteId: string;
  /** The connected account the reader is registered on (a reader never moves between accounts or modes). */
  accountRef: string;
  locationRef: string;
  readerRef: string;
  label: string;
  deviceType: string | null;
  simulated: boolean;
  status: "active" | "removed";
}

export async function addReader(ctx: DbContext, tenantId: string, input: { siteId: string; accountRef: string; locationRef: string; readerRef: string; label: string; deviceType: string | null; simulated: boolean }, actor: PmsActor): Promise<CardReader> {
  assertTenantId(tenantId);
  assertId(input.siteId, "site id");
  const label = input.label.trim();
  if (label.length < 1 || label.length > 60) throw new RepoInputError("Give the reader a name (60 characters at most).");
  const id = pmsId(CARD_ID_PREFIXES.reader, ctx);
  const at = nowIso(ctx);
  await billingBatch(
    ctx,
    [
      ...ensureCardSettingsQueries(ctx, tenantId, at),
      ctx.db.insertInto(READERS).values({
        tenant_id: tenantId,
        id,
        site_id: input.siteId,
        account_ref: input.accountRef,
        location_ref: input.locationRef,
        reader_ref: input.readerRef,
        label,
        device_type: input.deviceType?.slice(0, 40) ?? null,
        simulated: b01(input.simulated),
        status: "active",
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.card_reader.add", targetType: "pms_card_reader", targetId: id, detail: { siteId: input.siteId, simulated: input.simulated } }),
    ],
    { unique: "That reader is already registered.", foreignKey: "That site does not exist in this clinic." },
  );
  return { id, siteId: input.siteId, accountRef: input.accountRef, locationRef: input.locationRef, readerRef: input.readerRef, label, deviceType: input.deviceType, simulated: input.simulated, status: "active" };
}

function toReader(r: Record<string, unknown>): CardReader {
  return {
    id: String(r.id),
    siteId: String(r.site_id),
    accountRef: String(r.account_ref),
    locationRef: String(r.location_ref),
    readerRef: String(r.reader_ref),
    label: String(r.label),
    deviceType: (r.device_type as string | null) ?? null,
    simulated: isOn(r.simulated),
    status: r.status === "removed" ? "removed" : "active",
  };
}

export async function listReaders(ctx: DbContext, tenantId: string, options: { activeOnly?: boolean; accountRef?: string | null } = {}): Promise<CardReader[]> {
  assertTenantId(tenantId);
  return readOrEmpty(READERS, [] as CardReader[], async () => {
    let q = ctx.db.selectFrom(READERS).selectAll().where("tenant_id", "=", tenantId);
    if (options.activeOnly) q = q.where("status", "=", "active");
    if (options.accountRef !== undefined) q = q.where("account_ref", "=", options.accountRef ?? "-");
    return (await q.orderBy("created_at").execute()).map((r) => toReader(r as unknown as Record<string, unknown>));
  });
}

export async function getReader(ctx: DbContext, tenantId: string, id: string): Promise<CardReader | null> {
  assertTenantId(tenantId);
  if (!/^[a-z]+_[0-9A-Z]{26}$/.test(id)) return null;
  const r = await ctx.db.selectFrom(READERS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toReader(r as unknown as Record<string, unknown>) : null;
}

export async function removeReader(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "reader id");
  const at = nowIso(ctx);
  const results = await billingBatch(ctx, [
    ctx.db.updateTable(READERS).set({ status: "removed", removed_at: at, removed_by: actor.userId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "active"),
    billingAuditWhen(ctx, tenantId, actor, { action: "pms.card_reader.remove", targetType: "pms_card_reader", targetId: id, detail: {} }, ctx.db.selectFrom(READERS).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("removed_at", "=", at)),
  ]);
  return affected(results[0]) > 0;
}

/* ------------------------------------------------------------------------------------------------
 * Intents
 * ----------------------------------------------------------------------------------------------*/

export interface CardIntent {
  id: string;
  kind: CardIntentKind;
  purpose: CardIntentPurpose;
  status: CardIntentStatus;
  intentRef: string | null;
  checkoutRef: string | null;
  parentRef: string | null;
  invoiceId: string | null;
  patientId: string | null;
  mandateId: string | null;
  readerId: string | null;
  membershipId: string | null;
  period: string | null;
  amountPence: number;
  feePence: number;
  paymentId: string | null;
  failureCode: string | null;
  attempts: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function toIntent(r: Record<string, unknown>): CardIntent {
  return {
    id: String(r.id),
    kind: r.kind as CardIntentKind,
    purpose: r.purpose as CardIntentPurpose,
    status: r.status as CardIntentStatus,
    intentRef: (r.intent_ref as string | null) ?? null,
    checkoutRef: (r.checkout_ref as string | null) ?? null,
    parentRef: (r.parent_ref as string | null) ?? null,
    invoiceId: (r.invoice_id as string | null) ?? null,
    patientId: (r.patient_id as string | null) ?? null,
    mandateId: (r.mandate_id as string | null) ?? null,
    readerId: (r.reader_id as string | null) ?? null,
    membershipId: (r.membership_id as string | null) ?? null,
    period: (r.period as string | null) ?? null,
    amountPence: num(r.amount_pence),
    feePence: num(r.fee_pence),
    paymentId: (r.payment_id as string | null) ?? null,
    failureCode: (r.failure_code as string | null) ?? null,
    attempts: num(r.attempts),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
  };
}

export interface NewIntent {
  kind: CardIntentKind;
  purpose: CardIntentPurpose;
  amountPence: number;
  feePence?: number;
  invoiceId?: string | null;
  patientId?: string | null;
  mandateId?: string | null;
  readerId?: string | null;
  membershipId?: string | null;
  period?: string | null;
  parentRef?: string | null;
}

/** Writes the intent row BEFORE the provider is asked (its id is the provider's idempotency key). */
export async function createIntent(ctx: DbContext, tenantId: string, input: NewIntent, actor: PmsActor): Promise<CardIntent> {
  assertTenantId(tenantId);
  if (!Number.isInteger(input.amountPence) || input.amountPence < 0) throw new RepoInputError("The amount must be whole pence.");
  const id = pmsId(CARD_ID_PREFIXES.intent, ctx);
  const at = nowIso(ctx);
  await billingBatch(
    ctx,
    [
      ...ensureCardSettingsQueries(ctx, tenantId, at),
      ctx.db.insertInto(INTENTS).values({
        tenant_id: tenantId,
        id,
        kind: input.kind,
        purpose: input.purpose,
        status: "open",
        invoice_id: input.invoiceId ?? null,
        patient_id: input.patientId ?? null,
        mandate_id: input.mandateId ?? null,
        reader_id: input.readerId ?? null,
        membership_id: input.membershipId ?? null,
        period: input.period ?? null,
        parent_ref: input.parentRef ?? null,
        amount_pence: input.amountPence,
        fee_pence: input.feePence ?? 0,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
    ],
    { unique: "This is already being charged.", foreignKey: "The invoice or patient does not exist in this clinic." },
  );
  return (await getIntent(ctx, tenantId, id)) as CardIntent;
}

/**
 * A refund intent for `amountPence` of the payment `parentRef` – written only while what is left of that payment
 * (its amount less every refund not failed or cancelled) covers it. The check runs IN the insert: a NULL amount
 * refuses the statement, so two members refunding at the same moment can never refund more than was paid.
 */
export async function createRefundIntent(
  ctx: DbContext,
  tenantId: string,
  input: { parentRef: string; paymentId: string | null; paymentAmountPence: number; amountPence: number; invoiceId: string; patientId: string | null; feePence: number; intentRef?: string | null },
  actor: PmsActor,
): Promise<CardIntent> {
  assertTenantId(tenantId);
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new RepoInputError("Enter the amount to refund.");
  const id = pmsId(CARD_ID_PREFIXES.intent, ctx);
  const at = nowIso(ctx);
  const paid = Math.trunc(input.paymentAmountPence);
  const want = Math.trunc(input.amountPence);
  const left = sql<number>`(cast(${paid} as integer) - (select coalesce(sum(amount_pence), 0) from pms_card_intents where tenant_id = ${tenantId} and kind = 'refund' and parent_ref = ${input.parentRef} and status not in ('failed', 'canceled')))`;
  await billingBatch(
    ctx,
    [
      // First: lock the payment's row (Postgres) so two refunds of the same payment are checked one after the other.
      ...(input.paymentId ? [ctx.db.updateTable("pms_payments").set((eb) => ({ updated_at: eb.ref("updated_at") })).where("tenant_id", "=", tenantId).where("id", "=", input.paymentId)] : []),
      ctx.db.insertInto(INTENTS).values({
        tenant_id: tenantId,
        id,
        kind: "refund",
        purpose: "refund",
        status: "open",
        parent_ref: input.parentRef,
        intent_ref: input.intentRef ?? null,
        invoice_id: input.invoiceId,
        patient_id: input.patientId,
        amount_pence: sql<number>`(case when ${left} >= cast(${want} as integer) then cast(${want} as integer) end)`,
        fee_pence: input.feePence,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
    ],
    { notNull: "That is more than is left to refund on this card payment.", unique: "That refund is already recorded." },
  );
  return (await getIntent(ctx, tenantId, id)) as CardIntent;
}

export async function getIntent(ctx: DbContext, tenantId: string, id: string): Promise<CardIntent | null> {
  assertTenantId(tenantId);
  if (!/^[a-z]+_[0-9A-Z]{26}$/.test(id)) return null;
  const r = await ctx.db.selectFrom(INTENTS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toIntent(r as unknown as Record<string, unknown>) : null;
}

export async function findIntentByRef(ctx: DbContext, tenantId: string, ref: string): Promise<CardIntent | null> {
  assertTenantId(tenantId);
  const col = ref.startsWith("cs_") ? "checkout_ref" : "intent_ref";
  const r = await ctx.db.selectFrom(INTENTS).selectAll().where("tenant_id", "=", tenantId).where(col, "=", ref).executeTakeFirst();
  return r ? toIntent(r as unknown as Record<string, unknown>) : null;
}

export async function listIntentsForInvoice(ctx: DbContext, tenantId: string, invoiceId: string): Promise<CardIntent[]> {
  assertTenantId(tenantId);
  return readOrEmpty(INTENTS, [] as CardIntent[], async () =>
    (await ctx.db.selectFrom(INTENTS).selectAll().where("tenant_id", "=", tenantId).where("invoice_id", "=", invoiceId).orderBy("created_at").execute()).map((r) => toIntent(r as unknown as Record<string, unknown>)),
  );
}

export async function listRefundIntents(ctx: DbContext, tenantId: string, parentRef: string): Promise<CardIntent[]> {
  assertTenantId(tenantId);
  return (await ctx.db.selectFrom(INTENTS).selectAll().where("tenant_id", "=", tenantId).where("kind", "=", "refund").where("parent_ref", "=", parentRef).execute()).map((r) => toIntent(r as unknown as Record<string, unknown>));
}

/** Intents still open or processing (the "check payments" sweep and the invoice screen). */
export async function listOpenIntents(ctx: DbContext, tenantId: string, limit = 50): Promise<CardIntent[]> {
  assertTenantId(tenantId);
  return (await ctx.db.selectFrom(INTENTS).selectAll().where("tenant_id", "=", tenantId).where("status", "in", ["open", "processing"]).orderBy("created_at").limit(limit).execute()).map((r) => toIntent(r as unknown as Record<string, unknown>));
}

/** The provider's references once known (never overwritten with another value). */
export async function setIntentRefs(ctx: DbContext, tenantId: string, id: string, refs: { intentRef?: string; checkoutRef?: string }, options: { replace?: boolean } = {}): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const set: Record<string, unknown> = { updated_at: at };
  if (refs.intentRef) set.intent_ref = refs.intentRef;
  if (refs.checkoutRef) set.checkout_ref = refs.checkoutRef;
  let q = ctx.db.updateTable(INTENTS).set(set).where("tenant_id", "=", tenantId).where("id", "=", id);
  if (refs.intentRef && !options.replace) q = q.where((eb) => eb.or([eb("intent_ref", "is", null), eb("intent_ref", "=", refs.intentRef as string)]));
  if (refs.intentRef && options.replace) q = q.where("status", "!=", "succeeded");
  if (refs.checkoutRef) q = q.where((eb) => eb.or([eb("checkout_ref", "is", null), eb("checkout_ref", "=", refs.checkoutRef as string)]));
  await billingBatch(ctx, [q], { unique: "That payment reference is already used." });
}

/**
 * Moves an intent from one of `from` to `to` (a conditional update: exactly one caller wins). Never moves a
 * succeeded intent anywhere. Returns whether this call changed it.
 */
export async function moveIntent(ctx: DbContext, tenantId: string, id: string, from: readonly CardIntentStatus[], to: CardIntentStatus, extra: { failureCode?: string | null; bumpAttempts?: boolean } = {}): Promise<boolean> {
  assertTenantId(tenantId);
  const allowed = from.filter((s) => s !== "succeeded");
  if (allowed.length === 0) return false;
  const at = nowIso(ctx);
  const results = await billingBatch(ctx, [
    ctx.db
      .updateTable(INTENTS)
      .set((eb) => ({
        status: to,
        updated_at: at,
        ...(extra.failureCode !== undefined ? { failure_code: extra.failureCode ? extra.failureCode.slice(0, 40) : null } : {}),
        ...(extra.bumpAttempts ? { attempts: eb("attempts", "+", 1) } : {}),
      }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "in", allowed as CardIntentStatus[]),
  ]);
  return affected(results[0]) > 0;
}

/** The statement that marks an intent succeeded with its payment – for the payment's OWN batch (recordPayment extra). */
export function intentSucceededQuery(ctx: DbContext, tenantId: string, id: string, paymentId: string, at: string, intentRef: string) {
  return ctx.db
    .updateTable(INTENTS)
    .set({ status: "succeeded", payment_id: paymentId, intent_ref: intentRef, failure_code: null, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    // Never moves an intent already succeeded with another payment; a retried charge (a new provider reference after
    // a decline) replaces the declined one's reference.
    .where("status", "!=", "succeeded");
}

/** Marks an intent succeeded when its payment was recorded by an earlier call (idempotent). */
export async function markIntentSucceeded(ctx: DbContext, tenantId: string, id: string, paymentId: string, intentRef: string): Promise<void> {
  await billingBatch(ctx, [intentSucceededQuery(ctx, tenantId, id, paymentId, nowIso(ctx), intentRef)]);
}

/* ------------------------------------------------------------------------------------------------
 * Webhook events
 * ----------------------------------------------------------------------------------------------*/

export async function eventHandled(ctx: DbContext, tenantId: string, eventId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(EVENTS).select("id").where("tenant_id", "=", tenantId).where("id", "=", eventId).executeTakeFirst();
  return Boolean(r);
}

/** Notes an event as handled (a second delivery of the same event changes nothing: insert or nothing). */
export async function noteEvent(ctx: DbContext, tenantId: string, input: { eventId: string; type: string; objectRef: string | null; outcome: string }): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await billingBatch(ctx, [
    ...ensureCardSettingsQueries(ctx, tenantId, at),
    ctx.db
      .insertInto(EVENTS)
      .values({ tenant_id: tenantId, id: input.eventId.slice(0, 120), type: input.type.slice(0, 100), object_ref: input.objectRef?.slice(0, 200) ?? null, outcome: input.outcome.slice(0, 60) || "handled", created_at: at })
      .onConflict((oc) => oc.columns(["tenant_id", "id"]).doNothing()),
  ]);
}

/* ------------------------------------------------------------------------------------------------
 * Saved cards and consent
 * ----------------------------------------------------------------------------------------------*/

export interface CardMandate {
  id: string;
  patientId: string;
  status: MandateStatus;
  /** The connected account the card was saved on (it can only be charged there). */
  accountRef: string;
  customerRef: string;
  methodRef: string | null;
  setupRef: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  consentWording: string;
  consentVersion: string;
  consentChannel: ConsentChannel;
  consentRecordedBy: string | null;
  consentAt: string;
  allowsNoShow: boolean;
  removedAt: string | null;
}

function toMandate(r: Record<string, unknown>): CardMandate {
  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    status: r.status as MandateStatus,
    accountRef: String(r.account_ref),
    customerRef: String(r.customer_ref),
    methodRef: (r.method_ref as string | null) ?? null,
    setupRef: (r.setup_ref as string | null) ?? null,
    brand: (r.brand as string | null) ?? null,
    last4: (r.last4 as string | null) ?? null,
    expMonth: numOrNull(r.exp_month),
    expYear: numOrNull(r.exp_year),
    consentWording: String(r.consent_wording),
    consentVersion: String(r.consent_version),
    consentChannel: r.consent_channel as ConsentChannel,
    consentRecordedBy: (r.consent_recorded_by as string | null) ?? null,
    consentAt: iso(r.consent_at) as string,
    allowsNoShow: isOn(r.allows_no_show),
    removedAt: iso(r.removed_at),
  };
}

export function mandateLabel(m: Pick<CardMandate, "brand" | "last4" | "expMonth" | "expYear">): string {
  const brand = m.brand ? m.brand.charAt(0).toUpperCase() + m.brand.slice(1) : "Card";
  const exp = m.expMonth && m.expYear ? ` · expires ${String(m.expMonth).padStart(2, "0")}/${String(m.expYear).slice(-2)}` : "";
  return `${brand} ending ${m.last4 ?? "····"}${exp}`;
}

/** The consent is recorded when the card form opens (status pending); the card is filled in once the provider confirms. */
export async function createMandate(
  ctx: DbContext,
  tenantId: string,
  input: { patientId: string; accountRef: string; customerRef: string; consentWording: string; channel: ConsentChannel; allowsNoShow: boolean },
  actor: PmsActor,
): Promise<CardMandate> {
  assertTenantId(tenantId);
  assertId(input.patientId, "patient id");
  const id = pmsId(CARD_ID_PREFIXES.mandate, ctx);
  const at = nowIso(ctx);
  await billingBatch(
    ctx,
    [
      ...ensureCardSettingsQueries(ctx, tenantId, at),
      ctx.db.insertInto(MANDATES).values({
        tenant_id: tenantId,
        id,
        patient_id: input.patientId,
        status: "pending",
        account_ref: input.accountRef,
        customer_ref: input.customerRef,
        consent_wording: input.consentWording,
        consent_version: CARD_CONSENT_VERSION,
        consent_channel: input.channel,
        consent_recorded_by: input.channel === "portal" ? null : actor.userId,
        consent_at: at,
        allows_no_show: b01(input.allowsNoShow),
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.card_consent.record", targetType: "pms_patient", targetId: input.patientId, detail: { mandateId: id, channel: input.channel, version: CARD_CONSENT_VERSION, noShow: input.allowsNoShow } }),
    ],
    { foreignKey: "That patient does not exist in this clinic." },
  );
  return (await getMandate(ctx, tenantId, id)) as CardMandate;
}

export async function setMandateSetupRef(ctx: DbContext, tenantId: string, id: string, setupRef: string): Promise<void> {
  assertTenantId(tenantId);
  await billingBatch(ctx, [ctx.db.updateTable(MANDATES).set({ setup_ref: setupRef, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).where("setup_ref", "is", null)], {
    unique: "That card form is already in use.",
  });
}

/** pending → active with the card's details (once: a second confirmation changes nothing). */
export async function activateMandate(ctx: DbContext, tenantId: string, id: string, card: { methodRef: string; brand: string; last4: string; expMonth: number | null; expYear: number | null }, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const results = await billingBatch(ctx, [
    ctx.db
      .updateTable(MANDATES)
      .set({ status: "active", method_ref: card.methodRef, brand: card.brand.slice(0, 20), last4: card.last4.slice(-4), exp_month: card.expMonth, exp_year: card.expYear, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "pending"),
    billingAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.card_mandate.active", targetType: "pms_card_mandate", targetId: id, detail: { last4: card.last4.slice(-4) } },
      ctx.db.selectFrom(MANDATES).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "active").where("updated_at", "=", at),
    ),
  ]);
  return affected(results[0]) > 0;
}

export async function removeMandate(ctx: DbContext, tenantId: string, id: string, actor: PmsActor, status: "removed" | "failed" = "removed"): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "card id");
  const at = nowIso(ctx);
  const results = await billingBatch(ctx, [
    ctx.db.updateTable(MANDATES).set({ status, removed_at: at, removed_by: actor.userId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "in", ["pending", "active"]),
    billingAuditWhen(ctx, tenantId, actor, { action: status === "removed" ? "pms.card_mandate.remove" : "pms.card_mandate.fail", targetType: "pms_card_mandate", targetId: id, detail: {} }, ctx.db.selectFrom(MANDATES).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("removed_at", "=", at)),
  ]);
  return affected(results[0]) > 0;
}

export async function getMandate(ctx: DbContext, tenantId: string, id: string): Promise<CardMandate | null> {
  assertTenantId(tenantId);
  if (!/^[a-z]+_[0-9A-Z]{26}$/.test(id)) return null;
  const r = await ctx.db.selectFrom(MANDATES).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toMandate(r as unknown as Record<string, unknown>) : null;
}

export async function findMandateBySetupRef(ctx: DbContext, tenantId: string, setupRef: string): Promise<CardMandate | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(MANDATES).selectAll().where("tenant_id", "=", tenantId).where("setup_ref", "=", setupRef).executeTakeFirst();
  return r ? toMandate(r as unknown as Record<string, unknown>) : null;
}

export async function listMandates(ctx: DbContext, tenantId: string, patientId: string): Promise<CardMandate[]> {
  assertTenantId(tenantId);
  return readOrEmpty(MANDATES, [] as CardMandate[], async () =>
    (await ctx.db.selectFrom(MANDATES).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).orderBy("created_at", "desc").limit(50).execute()).map((r) => toMandate(r as unknown as Record<string, unknown>)),
  );
}

/** The provider customer already made for this patient on THIS account (reused for every card). */
export async function customerRefFor(ctx: DbContext, tenantId: string, patientId: string, accountRef: string): Promise<string | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(MANDATES).select("customer_ref").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).where("account_ref", "=", accountRef).orderBy("created_at", "desc").executeTakeFirst();
  return r?.customer_ref ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Membership plans and memberships (pk03)
 * ----------------------------------------------------------------------------------------------*/

export interface MembershipPlan {
  id: string;
  name: string;
  pricePence: number;
  vatCode: "exempt" | "standard" | "reduced" | "zero";
  active: boolean;
}

export async function createPlan(ctx: DbContext, tenantId: string, input: { name: string; pricePence: number; vatCode?: MembershipPlan["vatCode"] }, actor: PmsActor): Promise<MembershipPlan> {
  assertTenantId(tenantId);
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new RepoInputError("Give the plan a name (80 characters at most).");
  if (!Number.isInteger(input.pricePence) || input.pricePence < 30 || input.pricePence > 100000) throw new RepoInputError("The monthly price must be between £0.30 and £1,000.");
  const vat = input.vatCode ?? "exempt";
  const id = pmsId(CARD_ID_PREFIXES.plan, ctx);
  const at = nowIso(ctx);
  await billingBatch(
    ctx,
    [
      ...ensureCardSettingsQueries(ctx, tenantId, at),
      ctx.db.insertInto(PLANS).values({ tenant_id: tenantId, id, name, price_pence: input.pricePence, vat_code: vat, active: 1, created_by: actor.userId, created_at: at, updated_at: at }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.membership_plan.create", targetType: "pms_membership_plan", targetId: id, detail: { pricePence: input.pricePence } }),
    ],
    { unique: "A plan with that name already exists." },
  );
  return { id, name, pricePence: input.pricePence, vatCode: vat, active: true };
}

export async function setPlanActive(ctx: DbContext, tenantId: string, id: string, active: boolean, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "plan id");
  const at = nowIso(ctx);
  const r = await billingBatch(ctx, [
    ctx.db.updateTable(PLANS).set((eb) => ({ active: b01(active), rev: eb("rev", "+", 1), updated_at: at })).where("tenant_id", "=", tenantId).where("id", "=", id),
    pmsAuditQuery(ctx, tenantId, actor, { action: active ? "pms.membership_plan.on" : "pms.membership_plan.off", targetType: "pms_membership_plan", targetId: id, detail: {} }),
  ]);
  return affected(r[0]) > 0;
}

export async function listPlans(ctx: DbContext, tenantId: string): Promise<MembershipPlan[]> {
  assertTenantId(tenantId);
  return readOrEmpty(PLANS, [] as MembershipPlan[], async () =>
    (await ctx.db.selectFrom(PLANS).selectAll().where("tenant_id", "=", tenantId).orderBy("name").execute()).map((r) => ({
      id: r.id,
      name: r.name,
      pricePence: num(r.price_pence),
      vatCode: r.vat_code as MembershipPlan["vatCode"],
      active: isOn(r.active),
    })),
  );
}

export interface Membership {
  id: string;
  patientId: string;
  planId: string;
  mandateId: string;
  siteId: string | null;
  status: MembershipStatus;
  chargeDay: number;
  startedOn: string;
  nextChargeOn: string | null;
  attempts: number;
  consentWording: string;
  consentAt: string;
}

function toMembership(r: Record<string, unknown>): Membership {
  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    planId: String(r.plan_id),
    mandateId: String(r.mandate_id),
    siteId: (r.site_id as string | null) ?? null,
    status: r.status as MembershipStatus,
    chargeDay: num(r.charge_day),
    startedOn: String(r.started_on),
    nextChargeOn: (r.next_charge_on as string | null) ?? null,
    attempts: num(r.attempts),
    consentWording: String(r.consent_wording),
    consentAt: iso(r.consent_at) as string,
  };
}

export async function createMembership(
  ctx: DbContext,
  tenantId: string,
  input: { patientId: string; planId: string; mandateId: string; siteId: string | null; chargeDay: number; startedOn: string; consentWording: string; channel: ConsentChannel },
  actor: PmsActor,
): Promise<Membership> {
  assertTenantId(tenantId);
  const id = pmsId(CARD_ID_PREFIXES.membership, ctx);
  const at = nowIso(ctx);
  const day = clampDay(input.chargeDay);
  await billingBatch(
    ctx,
    [
      ctx.db.insertInto(MEMBERS).values({
        tenant_id: tenantId,
        id,
        patient_id: input.patientId,
        // Only an active plan, and only the patient's own ACTIVE card (NULL refuses the statement).
        plan_id: sql<string>`(select id from pms_membership_plans where tenant_id = ${tenantId} and id = ${input.planId} and active = 1)`,
        mandate_id: sql<string>`(select id from pms_card_mandates where tenant_id = ${tenantId} and id = ${input.mandateId} and patient_id = ${input.patientId} and status = 'active')`,
        site_id: input.siteId,
        status: "active",
        charge_day: day,
        started_on: input.startedOn,
        next_charge_on: input.startedOn,
        consent_wording: input.consentWording,
        consent_channel: input.channel,
        consent_recorded_by: input.channel === "portal" ? null : actor.userId,
        consent_at: at,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.membership.start", targetType: "pms_patient", targetId: input.patientId, detail: { membershipId: id, planId: input.planId, chargeDay: day } }),
    ],
    { notNull: "Choose an active plan and one of the patient's saved cards.", foreignKey: "That patient does not exist in this clinic." },
  );
  return (await getMembership(ctx, tenantId, id)) as Membership;
}

export async function getMembership(ctx: DbContext, tenantId: string, id: string): Promise<Membership | null> {
  assertTenantId(tenantId);
  if (!/^[a-z]+_[0-9A-Z]{26}$/.test(id)) return null;
  const r = await ctx.db.selectFrom(MEMBERS).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toMembership(r as unknown as Record<string, unknown>) : null;
}

export async function listMemberships(ctx: DbContext, tenantId: string, patientId: string): Promise<Membership[]> {
  assertTenantId(tenantId);
  return readOrEmpty(MEMBERS, [] as Membership[], async () =>
    (await ctx.db.selectFrom(MEMBERS).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).orderBy("created_at", "desc").execute()).map((r) => toMembership(r as unknown as Record<string, unknown>)),
  );
}

export async function countMembersByPlan(ctx: DbContext, tenantId: string): Promise<Map<string, number>> {
  assertTenantId(tenantId);
  return readOrEmpty(MEMBERS, new Map<string, number>(), async () => {
    const rows = await ctx.db.selectFrom(MEMBERS).select(["plan_id", sql<number>`count(*)`.as("n")]).where("tenant_id", "=", tenantId).where("status", "!=", "cancelled").groupBy("plan_id").execute();
    return new Map(rows.map((r) => [r.plan_id, num(r.n)]));
  });
}

/** Memberships to charge today (active, or failed-and-retrying, with a charge date on or before today). */
export async function dueMemberships(ctx: DbContext, tenantId: string, today: string, limit = 100): Promise<Membership[]> {
  assertTenantId(tenantId);
  return (
    await ctx.db.selectFrom(MEMBERS).selectAll().where("tenant_id", "=", tenantId).where("status", "=", "active").where("next_charge_on", "<=", today).orderBy("next_charge_on").limit(limit).execute()
  ).map((r) => toMembership(r as unknown as Record<string, unknown>));
}

/** After a month's charge: the next date (success) or one more attempt / payment_failed (decline). System actor. */
export async function membershipCharged(ctx: DbContext, tenantId: string, id: string, outcome: { ok: true; nextChargeOn: string } | { ok: false; giveUp: boolean }, actor: PmsActor = { userId: null, sessionId: null }): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const q = outcome.ok
    ? ctx.db.updateTable(MEMBERS).set((eb) => ({ next_charge_on: outcome.nextChargeOn, attempts: 0, rev: eb("rev", "+", 1), updated_at: at }))
    : ctx.db.updateTable(MEMBERS).set((eb) => ({ attempts: eb("attempts", "+", 1), ...(outcome.giveUp ? { status: "payment_failed" } : {}), rev: eb("rev", "+", 1), updated_at: at }));
  await billingBatch(ctx, [
    q.where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "active"),
    ...(!outcome.ok && outcome.giveUp ? [pmsAuditQuery(ctx, tenantId, actor, { action: "pms.membership.payment_failed", targetType: "pms_membership", targetId: id, detail: {} })] : []),
  ]);
}

export async function cancelMembership(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "membership id");
  const at = nowIso(ctx);
  const r = await billingBatch(ctx, [
    ctx.db.updateTable(MEMBERS).set((eb) => ({ status: "cancelled", next_charge_on: null, cancelled_at: at, cancelled_by: actor.userId, rev: eb("rev", "+", 1), updated_at: at })).where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "!=", "cancelled"),
    billingAuditWhen(ctx, tenantId, actor, { action: "pms.membership.cancel", targetType: "pms_membership", targetId: id, detail: {} }, ctx.db.selectFrom(MEMBERS).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("cancelled_at", "=", at)),
  ]);
  return affected(r[0]) > 0;
}

/** Cancels every membership charged to a card being removed (a membership never outlives its card). */
export async function cancelMembershipsOfMandate(ctx: DbContext, tenantId: string, mandateId: string, actor: PmsActor): Promise<number> {
  const rows = await ctx.db.selectFrom(MEMBERS).select("id").where("tenant_id", "=", tenantId).where("mandate_id", "=", mandateId).where("status", "!=", "cancelled").execute();
  let n = 0;
  for (const r of rows) if (await cancelMembership(ctx, tenantId, r.id, actor)) n += 1;
  return n;
}

/**
 * The clinics with card payments switched on (the daily membership run: a cross-clinic read of the settings table
 * only – each clinic's memberships are then read with its own tenant id).
 */
export async function clinicsWithCardPayments(ctx: DbContext): Promise<{ tenantId: string; accountRef: string; mode: string | null }[]> {
  return readOrEmpty(SETTINGS, [] as { tenantId: string; accountRef: string; mode: string | null }[], async () =>
    (await ctx.db.selectFrom(SETTINGS).select(["tenant_id", "account_ref", "account_mode"]).where("enabled", "=", 1).where("account_ref", "is not", null).execute()).map((r) => ({
      tenantId: r.tenant_id,
      accountRef: r.account_ref as string,
      mode: r.account_mode,
    })),
  );
}

export type { RepoContext };
