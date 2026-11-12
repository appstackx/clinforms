/**
 * Xero sync (0172, xe03–xe06): the clinic's connection row, its mappings, the links ClinDesk record → Xero id and the
 * send list. Rules (docs/clinic-system/decisions/xero-sync-scope.md, docs/clinic-system/xero.md):
 *
 * - EVERY statement names the clinic (tenant_id) – the tenant-scope guard checks it; the one cross-clinic read
 *   (clinicsToSend, for the scheduled run) returns clinic ids only.
 * - Tokens: sealed with the data envelope (AAD "<tenant>:pms_xero_connections.tokens_sealed:<tenant>"), so a row copied
 *   to another clinic cannot be opened there. Never returned by any read except openTokens (the sync engine's).
 * - A refresh token works once: refreshing is claimed with the row's token_rev (one worker at a time,
 *   refresh_lock_until), and the new pair is stored only where that claim still holds. Settings use rev, so saving one
 *   mid-refresh never discards the new tokens.
 * - OAuth state: only its SHA-256, tied to the member's session, single use (cleared by the same UPDATE that checks
 *   it), 10 minutes.
 * - The send list's id is "<type>:<op>:<local id>": queuing twice is a no-op. Links are written once and never
 *   replaced, so a record that has a Xero id is never created in Xero again.
 * - Before the migration every read answers "off / nothing" (readOrEmpty).
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "kysely";
import {
  XERO_LEASE_SECONDS,
  XERO_REFRESH_LOCK_SECONDS,
  XERO_SINGLE_KEY,
  XERO_WAIT_SECONDS,
  XeroMappingInputSchema,
  XeroOptionsInputSchema,
  nextAttemptDelaySeconds,
  oneLine,
  syncItemId,
  syncOrder,
  validXeroValue,
  type XeroErrorClass,
  type XeroLocalType,
  type XeroMapKind,
  type XeroMappingInput,
  type XeroOptionsInput,
  type XeroOp,
  type XeroSyncStatus,
} from "../../../../modules/pms/integration/xero";
import type { XeroMaps } from "../../../../modules/pms/integration/xero-mappers";
import type { XeroConnectionView } from "../../../../modules/pms/integration/xero-view";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { londonDate } from "../../../../modules/pms/diary/time";
import { runBatch } from "../../../db/batch";
import { RepoInputError, assertTenantId, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, type RepoContext } from "../context";
import type { DbContext } from "../../context";
import { readOrEmpty } from "../billing/healthcode";
import { ensureSettingsQuery } from "../billing/settings";
import { affected, chunks } from "../billing/shared";

const CONN = "pms_xero_connections";
const MAPS = "pms_xero_mappings";
const LINKS = "pms_xero_links";
const ITEMS = "pms_xero_sync_items";
const TOKENS_AAD_TABLE = "pms_xero_connections.tokens_sealed";

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const plus = (at: string, seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type { XeroConnectionView };
export type XeroConnectionStatus = XeroConnectionView["status"];

const OFF: XeroConnectionView = { enabled: false, status: "not_connected", orgName: null, baseCurrency: null, sendFrom: null, sendContactDetails: false, connectedAt: null, connectedBy: null, lastError: null, rev: 0 };

export async function getXeroConnection(ctx: DbContext, tenantId: string): Promise<XeroConnectionView> {
  assertTenantId(tenantId);
  return readOrEmpty(CONN, OFF, async () => {
    const r = await ctx.db
      .selectFrom(CONN)
      .select(["enabled", "status", "org_name", "base_currency", "send_from", "send_contact_details", "connected_at", "connected_by", "last_error", "rev"])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    if (!r) return OFF;
    return {
      enabled: num(r.enabled) === 1,
      status: r.status as XeroConnectionStatus,
      orgName: r.org_name,
      baseCurrency: r.base_currency,
      sendFrom: r.send_from,
      sendContactDetails: num(r.send_contact_details) === 1,
      connectedAt: iso(r.connected_at),
      connectedBy: r.connected_by,
      lastError: r.last_error,
      rev: num(r.rev),
    };
  });
}

/** The clinic's own switch. Writes the clinic's billing-settings row and its connection row if missing (one batch). */
export async function setXeroEnabled(ctx: RepoContext, tenantId: string, enabled: boolean, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  await runBatch(ctx.db, [
    ensureSettingsQuery(ctx, tenantId, at),
    ctx.db.insertInto(CONN).values({ tenant_id: tenantId, created_at: at, updated_at: at }).onConflict((oc) => oc.column("tenant_id").doNothing()),
    ctx.db
      .updateTable(CONN)
      .set((eb) => ({ enabled: enabled ? 1 : 0, rev: eb("rev", "+", 1), updated_by: actor.userId, updated_at: at }))
      .where("tenant_id", "=", tenantId),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.xero.settings", targetType: "pms_xero_connection", targetId: tenantId, detail: { enabled } }),
  ]);
}

/** Stores a new OAuth state (its hash) for this member's session. False when Xero is off for the clinic. */
export async function beginXeroConnect(ctx: RepoContext, tenantId: string, stateHash: string, expiresAt: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  if (!/^[0-9a-f]{64}$/.test(stateHash) || !actor.sessionId || !actor.userId) throw new RepoInputError("A connection needs a signed-in member.");
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set({ state_hash: stateHash, state_session: actor.sessionId, state_user: actor.userId, state_expires_at: expiresAt, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("enabled", "=", 1)
    .executeTakeFirst();
  if (affected(r) !== 1) return false;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.connect_start", targetType: "pms_xero_connection", targetId: tenantId, detail: {} });
  return true;
}

/**
 * Checks AND uses up the OAuth state in one statement: true only for the same clinic, member and session, before it
 * expires, once. A forged or replayed callback (or one finished in another browser) is refused.
 */
export async function consumeXeroState(ctx: RepoContext, tenantId: string, stateHash: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  if (!/^[0-9a-f]{64}$/.test(stateHash) || !actor.sessionId || !actor.userId) return false;
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set({ state_hash: null, state_session: null, state_user: null, state_expires_at: null, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("enabled", "=", 1)
    .where("state_hash", "=", stateHash)
    .where("state_session", "=", actor.sessionId)
    .where("state_user", "=", actor.userId)
    .where("state_expires_at", ">", at)
    .executeTakeFirst();
  return affected(r) === 1;
}

export interface XeroTokens {
  accessToken: string;
  refreshToken: string;
}

function sealTokens(ctx: RepoContext, tenantId: string, tokens: XeroTokens): string {
  return ctx.cipher.encrypt(JSON.stringify({ a: tokens.accessToken, r: tokens.refreshToken }), { tenantId, table: TOKENS_AAD_TABLE, rowId: tenantId });
}

function unsealTokens(ctx: RepoContext, tenantId: string, sealed: string): XeroTokens {
  const v = JSON.parse(ctx.cipher.decryptString(sealed, { tenantId, table: TOKENS_AAD_TABLE, rowId: tenantId })) as { a?: unknown; r?: unknown };
  if (typeof v.a !== "string" || typeof v.r !== "string") throw new Error("Stored Xero tokens are unreadable.");
  return { accessToken: v.a, refreshToken: v.r };
}

export interface ConnectedOrg {
  tokens: XeroTokens;
  accessExpiresAt: string;
  xeroTenantId: string;
  connectionId: string;
  orgName: string;
  baseCurrency: string;
  scopes: string;
}

/**
 * The organisation the clinic was connected to before (if any) and whether anything was sent there. Connecting a
 * DIFFERENT organisation after records were sent is refused: the stored Xero ids belong to the first one.
 */
export async function previousXeroOrg(ctx: DbContext, tenantId: string): Promise<{ xeroTenantId: string | null; orgName: string | null; hasLinks: boolean }> {
  assertTenantId(tenantId);
  const row = await readOrEmpty(CONN, undefined, () => ctx.db.selectFrom(CONN).select(["xero_tenant_id", "org_name"]).where("tenant_id", "=", tenantId).executeTakeFirst());
  const link = await readOrEmpty(LINKS, undefined, () => ctx.db.selectFrom(LINKS).select("local_id").where("tenant_id", "=", tenantId).limit(1).executeTakeFirst());
  return { xeroTenantId: row?.xero_tenant_id ?? null, orgName: row?.org_name ?? null, hasLinks: Boolean(link) };
}

/**
 * Is this Xero organisation connected to ANOTHER clinic (connected or paused)? A yes/no only – no other clinic's data.
 * One organisation, one clinic: two clinics would share one ledger, numbers and contacts.
 */
export async function xeroOrgInUseElsewhere(ctx: DbContext, tenantId: string, xeroTenantId: string): Promise<boolean> {
  assertTenantId(tenantId);
  const r = await ctx.db
    .selectFrom(CONN)
    .select("status")
    .where("xero_tenant_id", "=", xeroTenantId)
    .where("tenant_id", "<>", tenantId)
    .where("status", "in", ["connected", "paused"])
    .limit(1)
    .executeTakeFirst();
  return Boolean(r);
}

/** The callback's result: tokens sealed, the organisation recorded, status connected. Links and history are kept. */
export async function saveXeroConnection(ctx: RepoContext, tenantId: string, org: ConnectedOrg, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set((eb) => ({
      status: "connected",
      tokens_sealed: sealTokens(ctx, tenantId, org.tokens),
      access_expires_at: org.accessExpiresAt,
      refresh_lock_until: null,
      xero_tenant_id: org.xeroTenantId.slice(0, 64),
      connection_id: org.connectionId.slice(0, 64),
      org_name: org.orgName.slice(0, 200),
      base_currency: org.baseCurrency.slice(0, 3),
      scopes: org.scopes.slice(0, 500),
      send_from: sql<string>`coalesce(send_from, ${londonDate(at)})`,
      last_error: null,
      connected_by: actor.userId,
      connected_at: at,
      rev: eb("rev", "+", 1),
      token_rev: eb("token_rev", "+", 1),
      updated_by: actor.userId,
      updated_at: at,
    }))
    .where("tenant_id", "=", tenantId)
    .where("enabled", "=", 1)
    .executeTakeFirst();
  if (affected(r) !== 1) throw new RepoInputError("Xero is switched off for this clinic.");
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.connect", targetType: "pms_xero_connection", targetId: tenantId, detail: { currency: org.baseCurrency } });
}

/** The sync engine's view of the connection, with the tokens opened. Null unless connected AND switched on. */
export interface OpenConnection {
  tokens: XeroTokens;
  accessExpiresAt: string | null;
  xeroTenantId: string;
  connectionId: string | null;
  /** The tokens' revision (refresh claims). */
  tokenRev: number;
  refreshLockUntil: string | null;
  sendFrom: string | null;
  sendContactDetails: boolean;
}

export async function openConnection(ctx: RepoContext, tenantId: string): Promise<OpenConnection | null> {
  assertTenantId(tenantId);
  const r = await readOrEmpty(CONN, undefined, () =>
    ctx.db
      .selectFrom(CONN)
      .select(["tokens_sealed", "access_expires_at", "xero_tenant_id", "connection_id", "token_rev", "refresh_lock_until", "send_from", "send_contact_details"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "connected")
      .where("enabled", "=", 1)
      .executeTakeFirst(),
  );
  if (!r || !r.tokens_sealed || !r.xero_tenant_id) return null;
  return {
    tokens: unsealTokens(ctx, tenantId, r.tokens_sealed),
    accessExpiresAt: iso(r.access_expires_at),
    xeroTenantId: r.xero_tenant_id,
    connectionId: r.connection_id,
    tokenRev: num(r.token_rev),
    refreshLockUntil: iso(r.refresh_lock_until),
    sendFrom: r.send_from,
    sendContactDetails: num(r.send_contact_details) === 1,
  };
}

/** Claims the token refresh (token_rev must not have moved, nobody else refreshing). Returns the claimed revision, or null. */
export async function claimTokenRefresh(ctx: DbContext, tenantId: string, tokenRev: number): Promise<number | null> {
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set({ token_rev: tokenRev + 1, refresh_lock_until: plus(at, XERO_REFRESH_LOCK_SECONDS), updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("token_rev", "=", tokenRev)
    .where("status", "=", "connected")
    .where((eb) => eb.or([eb("refresh_lock_until", "is", null), eb("refresh_lock_until", "<", at)]))
    .executeTakeFirst();
  return affected(r) === 1 ? tokenRev + 1 : null;
}

/** Stores the refreshed pair where our claim still holds (the old refresh token is dead from now on). */
export async function storeRefreshedTokens(ctx: RepoContext, tenantId: string, claimedRev: number, tokens: XeroTokens, accessExpiresAt: string): Promise<boolean> {
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set({ tokens_sealed: sealTokens(ctx, tenantId, tokens), access_expires_at: accessExpiresAt, refresh_lock_until: null, token_rev: claimedRev + 1, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("token_rev", "=", claimedRev)
    .where("status", "=", "connected")
    .executeTakeFirst();
  return affected(r) === 1;
}

export async function releaseTokenRefresh(ctx: DbContext, tenantId: string, claimedRev: number): Promise<void> {
  await ctx.db.updateTable(CONN).set({ refresh_lock_until: null, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("token_rev", "=", claimedRev).execute();
}

/** Xero refused our tokens (revoked, removed in Xero): stop sending until the clinic connects again. Audited once. */
export async function pauseXero(ctx: RepoContext, tenantId: string, reason: string): Promise<void> {
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set((eb) => ({ status: "paused", last_error: oneLine(reason).slice(0, 500), refresh_lock_until: null, rev: eb("rev", "+", 1), token_rev: eb("token_rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "connected")
    .executeTakeFirst();
  if (affected(r) === 1) await pmsAudit(ctx, tenantId, { userId: null, sessionId: null }, { action: "pms.xero.paused", targetType: "pms_xero_connection", targetId: tenantId, detail: {} });
}

/**
 * Disconnects: the tokens are wiped (the caller revokes them at Xero first, best effort). The organisation's name,
 * mappings, links and the send history stay – connecting the same organisation again carries on where it stopped.
 * Returns the tokens it wiped (for the revocation), or null when nothing was connected.
 */
export async function disconnectXero(ctx: RepoContext, tenantId: string, actor: PmsActor): Promise<{ tokens: XeroTokens | null; connectionId: string | null } | null> {
  assertTenantId(tenantId);
  const row = await readOrEmpty(CONN, undefined, () => ctx.db.selectFrom(CONN).select(["tokens_sealed", "connection_id", "status", "rev"]).where("tenant_id", "=", tenantId).executeTakeFirst());
  if (!row || (row.status !== "connected" && row.status !== "paused")) return null;
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set((eb) => ({
      status: "disconnected",
      tokens_sealed: null,
      access_expires_at: null,
      refresh_lock_until: null,
      state_hash: null,
      state_session: null,
      state_user: null,
      state_expires_at: null,
      rev: num(row.rev) + 1,
      token_rev: eb("token_rev", "+", 1),
      updated_by: actor.userId,
      updated_at: at,
    }))
    .where("tenant_id", "=", tenantId)
    .where("rev", "=", num(row.rev))
    .executeTakeFirst();
  if (affected(r) !== 1) throw new RepoInputError("The Xero connection changed meanwhile. Please try again.");
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.disconnect", targetType: "pms_xero_connection", targetId: tenantId, detail: {} });
  let tokens: XeroTokens | null = null;
  try {
    tokens = row.tokens_sealed ? unsealTokens(ctx, tenantId, row.tokens_sealed) : null;
  } catch {
    tokens = null;
  }
  return { tokens, connectionId: row.connection_id };
}

export async function setXeroOptions(ctx: RepoContext, tenantId: string, input: XeroOptionsInput, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const d = parseInput(XeroOptionsInputSchema, input, "Xero options");
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(CONN)
    .set((eb) => ({ send_from: d.sendFrom, send_contact_details: d.sendContactDetails ? 1 : 0, rev: eb("rev", "+", 1), updated_by: actor.userId, updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("enabled", "=", 1)
    .executeTakeFirst();
  if (affected(r) !== 1) throw new RepoInputError("Xero is switched off for this clinic.");
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.options", targetType: "pms_xero_connection", targetId: tenantId, detail: { sendFrom: d.sendFrom, sendContactDetails: d.sendContactDetails } });
}

/* ------------------------------------------------------------------------------------------------
 * Mappings (xe04)
 * ----------------------------------------------------------------------------------------------*/

export async function getXeroMaps(ctx: DbContext, tenantId: string): Promise<XeroMaps> {
  assertTenantId(tenantId);
  const rows = await readOrEmpty(MAPS, [] as { map_kind: string; local_key: string; xero_value: string; xero_label: string | null }[], () =>
    ctx.db.selectFrom(MAPS).select(["map_kind", "local_key", "xero_value", "xero_label"]).where("tenant_id", "=", tenantId).limit(2000).execute(),
  );
  const out: Partial<Record<XeroMapKind, Record<string, { value: string; label: string | null }>>> = {};
  for (const r of rows) (out[r.map_kind as XeroMapKind] ??= {})[r.local_key] = { value: r.xero_value, label: r.xero_label };
  return out;
}

/**
 * Sets (or with xeroValue null/"" removes) one map. `label` is what the clinic chose, as the organisation's live list
 * named it (the caller checked the value is in that list). Single-value maps use local key "*".
 */
export async function setXeroMapping(ctx: RepoContext, tenantId: string, input: XeroMappingInput, label: string | null, actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  const d = parseInput(XeroMappingInputSchema, input, "Xero mapping");
  const single = ["default_account", "item_account", "visit_account", "write_off_account"].includes(d.kind);
  const key = single ? XERO_SINGLE_KEY : d.localKey;
  const value = (d.xeroValue ?? "").trim();
  if (value && !validXeroValue(d.kind, value)) throw new RepoInputError("That Xero value is not valid.");
  const at = nowIso(ctx);
  const exists = await ctx.db.selectFrom(CONN).select("tenant_id").where("tenant_id", "=", tenantId).where("enabled", "=", 1).executeTakeFirst();
  if (!exists) throw new RepoInputError("Xero is switched off for this clinic.");
  const audit = pmsAuditQuery(ctx, tenantId, actor, { action: "pms.xero.mapping_set", targetType: "pms_xero_connection", targetId: tenantId, detail: { kind: d.kind, key, removed: !value } });
  if (!value) {
    await runBatch(ctx.db, [ctx.db.deleteFrom(MAPS).where("tenant_id", "=", tenantId).where("map_kind", "=", d.kind).where("local_key", "=", key), audit]);
    return;
  }
  await runBatch(ctx.db, [
    ctx.db
      .insertInto(MAPS)
      .values({ tenant_id: tenantId, map_kind: d.kind, local_key: key, xero_value: value, xero_label: label ? label.slice(0, 200) : null, updated_by: actor.userId, created_at: at, updated_at: at })
      .onConflict((oc) => oc.columns(["tenant_id", "map_kind", "local_key"]).doUpdateSet({ xero_value: value, xero_label: label ? label.slice(0, 200) : null, updated_by: actor.userId, updated_at: at })),
    audit,
  ]);
}

/* ------------------------------------------------------------------------------------------------
 * Links (idempotency)
 * ----------------------------------------------------------------------------------------------*/

export type XeroLinkType = "patient" | "referrer" | "invoice" | "credit_note" | "allocation";

export async function getLink(ctx: DbContext, tenantId: string, type: XeroLinkType, localId: string): Promise<{ xeroId: string; sentHash: string | null } | null> {
  const r = await ctx.db.selectFrom(LINKS).select(["xero_id", "sent_hash"]).where("tenant_id", "=", tenantId).where("local_type", "=", type).where("local_id", "=", localId).executeTakeFirst();
  return r ? { xeroId: r.xero_id, sentHash: r.sent_hash } : null;
}

/** Writes a link once (an existing link wins and is returned): a record is tied to one Xero id for good. */
export async function putLink(ctx: DbContext, tenantId: string, type: XeroLinkType, localId: string, xeroId: string, xeroNumber: string | null, sentHash: string | null): Promise<string> {
  const at = nowIso(ctx);
  await ctx.db
    .insertInto(LINKS)
    .values({ tenant_id: tenantId, id: `${type}:${localId}`.slice(0, 120), local_type: type, local_id: localId, xero_id: xeroId.slice(0, 64), xero_number: xeroNumber ? xeroNumber.slice(0, 100) : null, sent_hash: sentHash, pushed_at: at, created_at: at, updated_at: at })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return (await getLink(ctx, tenantId, type, localId))?.xeroId ?? xeroId;
}

export async function countLinks(ctx: DbContext, tenantId: string): Promise<Record<string, number>> {
  const rows = await readOrEmpty(LINKS, [] as { local_type: string; n: unknown }[], () =>
    ctx.db
      .selectFrom(LINKS)
      .select((eb) => ["local_type", eb.fn.countAll().as("n")])
      .where("tenant_id", "=", tenantId)
      .groupBy("local_type")
      .execute() as Promise<{ local_type: string; n: unknown }[]>,
  );
  return Object.fromEntries(rows.map((r) => [r.local_type, num(r.n)]));
}

/* ------------------------------------------------------------------------------------------------
 * The send list (xe05)
 * ----------------------------------------------------------------------------------------------*/

const SWEEP_LIMIT = 50;

/**
 * Queues what is due for Xero and not queued yet (idempotent – the item id is its primary key): issued invoices from
 * the clinic's "send from" date, their credit notes, positive payment allocations to them, and the removal of a
 * payment already in Xero once it is taken off or reversed. Returns how many it queued.
 *
 * Why a sweep and not a write in every billing action's batch: it needs no change to the billing repositories, and it
 * cannot miss anything – whatever the billing screens did, the next run finds it.
 */
export async function queueDueItems(ctx: DbContext, tenantId: string, sendFrom: string): Promise<number> {
  assertTenantId(tenantId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sendFrom)) return 0;
  const notQueued = (type: XeroLocalType, op: XeroOp, idCol: string) =>
    sql<boolean>`not exists (select 1 from pms_xero_sync_items s where s.tenant_id = ${tenantId} and s.id = ${`${type}:${op}:`} || ${sql.ref(idCol)})`;
  const invoices = await ctx.db
    .selectFrom("pms_invoices as i")
    .select("i.id")
    .where("i.tenant_id", "=", tenantId)
    .where("i.status", "=", "issued")
    .where("i.issued_on", ">=", sendFrom)
    .where(notQueued("invoice", "create", "i.id"))
    .orderBy("i.issued_on")
    .orderBy("i.id")
    .limit(SWEEP_LIMIT)
    .execute();
  const credits = await ctx.db
    .selectFrom("pms_credit_notes as c")
    .innerJoin("pms_invoices as i", (j) => j.onRef("i.tenant_id", "=", "c.tenant_id").onRef("i.id", "=", "c.invoice_id"))
    .select("c.id")
    .where("c.tenant_id", "=", tenantId)
    .where("i.status", "=", "issued")
    .where("i.issued_on", ">=", sendFrom)
    .where(notQueued("credit_note", "create", "c.id"))
    .orderBy("c.id")
    .limit(SWEEP_LIMIT)
    .execute();
  const allocations = await ctx.db
    .selectFrom("pms_payment_allocations as a")
    .innerJoin("pms_payments as p", (j) => j.onRef("p.tenant_id", "=", "a.tenant_id").onRef("p.id", "=", "a.payment_id"))
    .innerJoin("pms_invoices as i", (j) => j.onRef("i.tenant_id", "=", "a.tenant_id").onRef("i.id", "=", "a.invoice_id"))
    .select("a.id")
    .where("a.tenant_id", "=", tenantId)
    .where("a.amount_pence", ">", 0)
    .where("a.reversed", "=", 0)
    .where("p.status", "=", "recorded")
    .where("p.kind", "=", "payment")
    .where("i.status", "=", "issued")
    .where("i.issued_on", ">=", sendFrom)
    .where(notQueued("allocation", "create", "a.id"))
    .orderBy("a.id")
    .limit(SWEEP_LIMIT)
    .execute();
  const removals = await ctx.db
    .selectFrom("pms_payment_allocations as a")
    .innerJoin("pms_payments as p", (j) => j.onRef("p.tenant_id", "=", "a.tenant_id").onRef("p.id", "=", "a.payment_id"))
    .innerJoin("pms_xero_links as l", (j) => j.onRef("l.tenant_id", "=", "a.tenant_id").on("l.local_type", "=", "allocation").onRef("l.local_id", "=", "a.id"))
    .select("a.id")
    .where("a.tenant_id", "=", tenantId)
    .where((eb) => eb.or([eb("a.reversed", "=", 1), eb("p.status", "=", "reversed")]))
    .where(notQueued("allocation", "delete", "a.id"))
    .orderBy("a.id")
    .limit(SWEEP_LIMIT)
    .execute();
  const at = nowIso(ctx);
  const rows = [
    ...invoices.map((r) => ["invoice", "create", r.id] as const),
    ...credits.map((r) => ["credit_note", "create", r.id] as const),
    ...allocations.map((r) => ["allocation", "create", r.id] as const),
    ...removals.map((r) => ["allocation", "delete", r.id] as const),
  ].map(([type, op, id]) => ({ tenant_id: tenantId, id: syncItemId(type, op, id), local_type: type, local_id: id, op, next_attempt_at: at, created_at: at, updated_at: at }));
  if (rows.length === 0) return 0;
  // 8 bound values a row: 10 rows a statement stays inside D1's 100 parameters.
  await runBatch(
    ctx.db,
    chunks(rows, 10).map((part) => ctx.db.insertInto(ITEMS).values(part).onConflict((oc) => oc.columns(["tenant_id", "id"]).doNothing())),
  );
  return rows.length;
}

export interface SyncItem {
  id: string;
  localType: XeroLocalType;
  localId: string;
  op: XeroOp;
  status: XeroSyncStatus;
  attempts: number;
  payloadVersion: number;
  nextAttemptAt: string;
  errorClass: XeroErrorClass | null;
  errorMessage: string | null;
  xeroId: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toItem(r: Record<string, unknown>): SyncItem {
  return {
    id: String(r.id),
    localType: r.local_type as XeroLocalType,
    localId: String(r.local_id),
    op: r.op as XeroOp,
    status: r.status as XeroSyncStatus,
    attempts: num(r.attempts),
    payloadVersion: num(r.payload_version),
    nextAttemptAt: iso(r.next_attempt_at) ?? "",
    errorClass: (r.error_class as XeroErrorClass | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    xeroId: (r.xero_id as string | null) ?? null,
    doneAt: iso(r.done_at),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
  };
}

/** Items due now (pending, or held by a worker whose lease ran out), in send order. */
export async function dueItems(ctx: DbContext, tenantId: string, limit: number): Promise<SyncItem[]> {
  const at = nowIso(ctx);
  const rows = await ctx.db
    .selectFrom(ITEMS)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where((eb) => eb.or([eb.and([eb("status", "=", "pending"), eb("next_attempt_at", "<=", at)]), eb.and([eb("status", "=", "in_flight"), eb("lease_until", "<", at)])]))
    .orderBy("next_attempt_at")
    .orderBy("id")
    .limit(Math.max(1, Math.min(limit * 4, 400)))
    .execute();
  return rows
    .map((r) => toItem(r as Record<string, unknown>))
    .sort((a, b) => syncOrder(a.localType, a.op) - syncOrder(b.localType, b.op) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * One worker takes the item (conditional UPDATE). Returns its lease token – only the holder of that token records the
 * outcome (finishItem) – or null: someone else has it, or it is no longer due.
 */
export async function claimItem(ctx: DbContext, tenantId: string, id: string): Promise<string | null> {
  const at = nowIso(ctx);
  const token = randomBytes(16).toString("hex");
  const r = await ctx.db
    .updateTable(ITEMS)
    .set({ status: "in_flight", lease_until: plus(at, XERO_LEASE_SECONDS), lease_token: token, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where((eb) => eb.or([eb.and([eb("status", "=", "pending"), eb("next_attempt_at", "<=", at)]), eb.and([eb("status", "=", "in_flight"), eb("lease_until", "<", at)])]))
    .executeTakeFirst();
  return affected(r) === 1 ? token : null;
}

export type ItemOutcome =
  | { kind: "done"; xeroId: string | null }
  | { kind: "skipped"; message: string }
  | { kind: "waiting"; message: string }
  | { kind: "deferred" }
  | { kind: "transient"; message: string; retryAfterSeconds?: number | null }
  | { kind: "validation"; message: string }
  | { kind: "auth"; message: string };

/**
 * Records what happened to an item this worker holds (its lease token must still be on the row – a worker whose
 * lease ran out and was taken over records nothing). A transient failure past the last back-off is "failed".
 */
export async function finishItem(ctx: DbContext, tenantId: string, item: Pick<SyncItem, "id" | "attempts">, leaseToken: string, outcome: ItemOutcome): Promise<XeroSyncStatus> {
  const at = nowIso(ctx);
  const base = ctx.db.updateTable(ITEMS).where("tenant_id", "=", tenantId).where("id", "=", item.id).where("status", "=", "in_flight").where("lease_token", "=", leaseToken);
  let status: XeroSyncStatus;
  switch (outcome.kind) {
    case "done":
      status = "done";
      await base.set({ status, xero_id: outcome.xeroId, error_class: null, error_message: null, lease_until: null, lease_token: null, done_at: at, attempts: item.attempts + 1, updated_at: at }).execute();
      return status;
    case "skipped":
      status = "skipped";
      await base.set({ status, error_class: null, error_message: oneLine(outcome.message), lease_until: null, lease_token: null, done_at: at, updated_at: at }).execute();
      return status;
    case "waiting":
      // Its invoice is not in Xero yet: looked at again soon. Waiting is not a try.
      status = "pending";
      await base.set({ status, error_class: "waiting", error_message: oneLine(outcome.message), lease_until: null, lease_token: null, next_attempt_at: plus(at, XERO_WAIT_SECONDS), updated_at: at }).execute();
      return status;
    case "deferred":
      // The run's time was up before a call: back on the list now, untouched.
      status = "pending";
      await base.set({ status, lease_until: null, lease_token: null, updated_at: at }).execute();
      return status;
    case "transient": {
      const attempts = item.attempts + 1;
      const delay = nextAttemptDelaySeconds(attempts, outcome.retryAfterSeconds);
      status = delay === null ? "failed" : "pending";
      await base
        .set({ status, attempts, error_class: "transient", error_message: oneLine(outcome.message), lease_until: null, lease_token: null, next_attempt_at: delay === null ? at : plus(at, delay), updated_at: at })
        .execute();
      return status;
    }
    case "validation":
      status = "blocked";
      await base.set({ status, attempts: item.attempts + 1, error_class: "validation", error_message: oneLine(outcome.message), lease_until: null, lease_token: null, updated_at: at }).execute();
      return status;
    case "auth":
      // Not the item's fault: back to the list untouched; the connection is paused by the caller.
      status = "pending";
      await base.set({ status, error_class: "auth", error_message: oneLine(outcome.message), lease_until: null, lease_token: null, updated_at: at }).execute();
      return status;
  }
}

/**
 * Retry (blocked / failed / skipped): back on the list now with a fresh try count. Only a BLOCKED item (the clinic fixed
 * a map, so the body changes) gets a new payload version – and with it a new Idempotency-Key. A failed or skipped item
 * keeps its key, so Xero still recognises a create whose answer was lost and never posts it twice.
 */
export async function retryItem(ctx: RepoContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(ITEMS)
    .set(() => ({ status: "pending", attempts: 0, payload_version: sql<number>`payload_version + (case when status = 'blocked' then 1 else 0 end)`, next_attempt_at: at, error_class: null, error_message: null, done_at: null, resolved_by: actor.userId, updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", String(id))
    .where("status", "in", ["blocked", "failed", "skipped"])
    .executeTakeFirst();
  if (affected(r) !== 1) return false;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.retry", targetType: "pms_xero_sync_item", targetId: String(id), detail: {} });
  return true;
}

/** Skip (blocked / failed / pending): never sent unless retried. The clinic records it in Xero by hand. */
export async function skipItem(ctx: RepoContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(ITEMS)
    .set({ status: "skipped", resolved_by: actor.userId, done_at: at, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", String(id))
    .where("status", "in", ["blocked", "failed", "pending"])
    .executeTakeFirst();
  if (affected(r) !== 1) return false;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.skip", targetType: "pms_xero_sync_item", targetId: String(id), detail: {} });
  return true;
}

export async function syncCounts(ctx: DbContext, tenantId: string): Promise<Record<XeroSyncStatus, number>> {
  const empty: Record<XeroSyncStatus, number> = { pending: 0, in_flight: 0, done: 0, failed: 0, blocked: 0, skipped: 0 };
  const rows = await readOrEmpty(ITEMS, [] as { status: string; n: unknown }[], () =>
    ctx.db
      .selectFrom(ITEMS)
      .select((eb) => ["status", eb.fn.countAll().as("n")])
      .where("tenant_id", "=", tenantId)
      .groupBy("status")
      .execute() as Promise<{ status: string; n: unknown }[]>,
  );
  for (const r of rows) if (r.status in empty) empty[r.status as XeroSyncStatus] = num(r.n);
  return empty;
}

/** The screen's list: what needs the clinic first (failed, blocked), then the newest. */
export async function listSyncItems(ctx: DbContext, tenantId: string, options: { statuses?: XeroSyncStatus[]; withWaiting?: boolean; limit?: number } = {}): Promise<SyncItem[]> {
  return readOrEmpty(ITEMS, [] as SyncItem[], async () => {
    let q = ctx.db.selectFrom(ITEMS).selectAll().where("tenant_id", "=", tenantId);
    const statuses = options.statuses;
    if (statuses?.length && options.withWaiting) {
      // Also what waits on something that needs the clinic (its invoice blocked or failed) – never silently pending.
      q = q.where((eb) => eb.or([eb("status", "in", statuses), eb.and([eb("status", "=", "pending"), eb("error_class", "=", "waiting")])]));
    } else if (statuses?.length) q = q.where("status", "in", statuses);
    const rows = await q.orderBy("updated_at", "desc").orderBy("id").limit(Math.min(options.limit ?? 50, 200)).execute();
    return rows.map((r) => toItem(r as Record<string, unknown>));
  });
}

/** Audit row of one run that sent something (counts only). */
export async function auditPush(ctx: RepoContext, tenantId: string, actor: PmsActor, counts: Record<string, number>): Promise<void> {
  await pmsAudit(ctx, tenantId, actor, { action: "pms.xero.push", targetType: "pms_xero_connection", targetId: tenantId, detail: counts });
}

/**
 * CROSS-CLINIC (the scheduled run only): the clinics with Xero switched on and connected. Ids only. The run then
 * works on each clinic with that clinic's id in every statement.
 */
export async function clinicsToSend(ctx: DbContext, limit = 500): Promise<string[]> {
  const rows = await readOrEmpty(CONN, [] as { tenant_id: string }[], () =>
    ctx.db
      .selectFrom(CONN)
      .select("tenant_id")
      .where("status", "=", "connected")
      .where("enabled", "=", 1)
      // The clinic the run worked on longest ago first, so a long list never starves the clinics at its end.
      .orderBy(sql`coalesce(last_run_at, ${"1970-01-01T00:00:00.000Z"})`)
      .orderBy("tenant_id")
      .limit(limit)
      .execute(),
  );
  return rows.map((r) => r.tenant_id);
}

/** The scheduled run worked on this clinic now (its place in the rotation). */
export async function markClinicRun(ctx: DbContext, tenantId: string): Promise<void> {
  await ctx.db.updateTable(CONN).set({ last_run_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).execute();
}

/** The send list's item of a record (its status), or null. */
export async function itemStatus(ctx: DbContext, tenantId: string, id: string): Promise<XeroSyncStatus | null> {
  const r = await ctx.db.selectFrom(ITEMS).select("status").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return (r?.status as XeroSyncStatus | undefined) ?? null;
}
