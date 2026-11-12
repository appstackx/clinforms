/**
 * The public clinic API's keys and the clinic's on/off setting (migration 0171, tracker xt03). Pattern of the Report
 * API's partner keys (src/server/repos/partner-keys.ts: shown once, SHA-256 stored, revocable, audited, the clinic id
 * inside the key), kept separate from them, plus scopes, a site restriction, expiry, rotation and use counters.
 *
 *   pms_api_settings   one row per clinic (no row = off), the parent of its keys (ON DELETE CASCADE)
 *   pms_api_keys       lookup (the key's id inside the key) + key_hash (SHA-256 of the whole key) + last4
 *   pms_api_key_days   calls / patient reads per key per UK day; the FIRST call of a day writes one audit row
 *
 * Verification: the key names its clinic and its lookup → ONE row read by (tenant_id, lookup), then the SHA-256 of
 * the presented key is compared with the stored one in constant time (timingSafeEqual). A key that is unknown,
 * revoked or expired is refused the same way (the caller answers 401 for all three).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import {
  API_KEY_PREFIX,
  API_LIMITS,
  API_ROTATION_GRACE_HOURS,
  CreateApiKeySchema,
  expiryFrom,
  parseApiKey,
  parseScopes,
  type ApiScope,
  type CreateApiKeyInput,
} from "../../../../modules/pms/integration/api";
import { londonDate } from "../../../../modules/pms/diary/time";
import type { BatchQuery } from "../../../db/batch";
import { runBatch } from "../../../db/batch";
import { auditInsertWhenExists } from "../../audit";
import { RepoInputError, assertActor, assertId, assertTenantId, nowIso, num, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type PmsActor } from "../context";

const K = "pms_api_keys";
const S = "pms_api_settings";
const D = "pms_api_key_days";
const LOOKUP_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface ApiSettings {
  enabled: boolean;
  rev: number;
  updatedAt: string | null;
}

export interface ApiKeyInfo {
  id: string;
  tenantId: string;
  name: string;
  /** What the list shows: "cdk_<clinic>_<lookup>". */
  prefix: string;
  last4: string;
  scopes: ApiScope[];
  /** null = every site. */
  siteIds: string[] | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  replacedById: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeyInfo {
  /** The full key. Shown once; never stored or retrievable again. */
  key: string;
}

/** A verified key, as the API's handlers see it. */
export interface VerifiedApiKey {
  id: string;
  tenantId: string;
  name: string;
  scopes: ApiScope[];
  siteIds: ReadonlySet<string> | null;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function newLookup(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += LOOKUP_ALPHABET[bytes[i] % LOOKUP_ALPHABET.length];
  return out;
}

function parseSiteIds(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return [];
  }
}

const COLUMNS = ["id", "tenant_id", "name", "lookup", "last4", "scopes_json", "site_ids_json", "expires_at", "last_used_at", "use_count", "replaced_by_id", "revoked_at", "created_by", "created_at"] as const;

type KeyRow = {
  id: string;
  tenant_id: string;
  name: string;
  lookup: string;
  last4: string;
  scopes_json: string;
  site_ids_json: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  use_count: number;
  replaced_by_id: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
};

function toInfo(r: KeyRow): ApiKeyInfo {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    prefix: `${API_KEY_PREFIX}${r.tenant_id}_${r.lookup}`,
    last4: r.last4,
    scopes: parseScopes(r.scopes_json),
    siteIds: parseSiteIds(r.site_ids_json),
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    useCount: num(r.use_count),
    replacedById: r.replaced_by_id,
    revokedAt: r.revoked_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** Whether a key works at `at`: not revoked, not past its expiry. */
export function apiKeyActive(k: Pick<ApiKeyInfo, "revokedAt" | "expiresAt">, at: string): boolean {
  return !k.revokedAt && (!k.expiresAt || Date.parse(k.expiresAt) > Date.parse(at));
}

/* ------------------------------------------------------------------------------------------------
 * The clinic's setting
 * ----------------------------------------------------------------------------------------------*/

export async function getApiSettings(ctx: DbContext, tenantId: string): Promise<ApiSettings> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(S).select(["enabled", "rev", "updated_at"]).where("tenant_id", "=", tenantId).executeTakeFirst();
  return row ? { enabled: num(row.enabled) === 1, rev: num(row.rev), updatedAt: row.updated_at } : { enabled: false, rev: 0, updatedAt: null };
}

function ensureSettingsRow(ctx: DbContext, tenantId: string, at: string): BatchQuery {
  return ctx.db
    .insertInto(S)
    .values({ tenant_id: tenantId, enabled: 0, rev: 1, updated_by: null, created_at: at, updated_at: at })
    .onConflict((oc) => oc.column("tenant_id").doNothing());
}

/** Switches the clinic's API on or off (owner – checked by the caller). Returns false when nothing changed. */
export async function setApiEnabled(ctx: DbContext, tenantId: string, enabled: boolean, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  const at = nowIso(ctx);
  const before = await getApiSettings(ctx, tenantId);
  if (before.enabled === enabled && before.rev > 0) return false;
  await writeWithAudit(ctx, [
    ensureSettingsRow(ctx, tenantId, at),
    ctx.db
      .updateTable(S)
      .set((eb) => ({ enabled: enabled ? 1 : 0, rev: eb("rev", "+", 1), updated_by: who.userId, updated_at: at }))
      .where("tenant_id", "=", tenantId),
    pmsAuditQuery(ctx, tenantId, actor, { action: "pms.api_settings.update", targetType: "pms_api_settings", targetId: tenantId, detail: { enabled } }),
  ]);
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Keys
 * ----------------------------------------------------------------------------------------------*/

async function countActiveKeys(ctx: DbContext, tenantId: string, at: string): Promise<number> {
  const row = await ctx.db
    .selectFrom(K)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("revoked_at", "is", null)
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", at)]))
    .executeTakeFirst();
  return num(row?.n ?? 0);
}

async function checkSites(ctx: DbContext, tenantId: string, siteIds: readonly string[]): Promise<void> {
  if (siteIds.length === 0) return;
  const rows = await ctx.db.selectFrom("pms_sites").select("id").where("tenant_id", "=", tenantId).where("id", "in", siteIds as string[]).execute();
  if (rows.length !== new Set(siteIds).size) throw new RepoInputError("A chosen site is not one of this clinic's sites.");
}

function keyRow(ctx: DbContext, tenantId: string, input: { id: string; name: string; scopes: readonly ApiScope[]; siteIds: readonly string[] | null; expiresAt: string | null; createdBy: string | null }, at: string) {
  const lookup = newLookup();
  const key = `${API_KEY_PREFIX}${tenantId}_${lookup}_${randomBytes(32).toString("base64url")}`;
  const row = {
    tenant_id: tenantId,
    id: input.id,
    lookup,
    key_hash: hashApiKey(key),
    last4: key.slice(-4),
    name: input.name,
    scopes_json: JSON.stringify(input.scopes),
    site_ids_json: input.siteIds && input.siteIds.length > 0 ? JSON.stringify(Array.from(new Set(input.siteIds)).sort()) : null,
    expires_at: input.expiresAt,
    last_used_at: null,
    use_count: 0,
    replaced_by_id: null,
    revoked_at: null,
    revoked_by: null,
    created_by: input.createdBy,
    created_at: at,
    updated_at: at,
  };
  return { key, row };
}

/** Creates a key (owner – checked by the caller). The settings row is written if missing, in the same batch. */
export async function createApiKey(ctx: DbContext, tenantId: string, input: CreateApiKeyInput, actor: PmsActor): Promise<CreatedApiKey> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  const d = parseInput(CreateApiKeySchema, input, "API key");
  const at = nowIso(ctx);
  if ((await countActiveKeys(ctx, tenantId, at)) >= API_LIMITS.activeKeysMax) throw new RepoInputError(`A clinic can have at most ${API_LIMITS.activeKeysMax} active keys. Revoke one first.`);
  await checkSites(ctx, tenantId, d.siteIds);
  const id = pmsId("apik", ctx);
  const { key, row } = keyRow(ctx, tenantId, { id, name: d.name, scopes: d.scopes, siteIds: d.siteIds, expiresAt: expiryFrom(at, d.expiresInDays), createdBy: who.userId }, at);
  await writeWithAudit(
    ctx,
    [
      ensureSettingsRow(ctx, tenantId, at),
      ctx.db.insertInto(K).values(row),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.api_key.create",
        targetType: "pms_api_key",
        targetId: id,
        detail: { last4: row.last4, scopes: d.scopes, sites: d.siteIds.length, expiresInDays: d.expiresInDays },
      }),
    ],
    { unique: "Please try again." },
  );
  return { ...toInfo(row as KeyRow), key };
}

export async function listApiKeys(ctx: DbContext, tenantId: string): Promise<ApiKeyInfo[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom(K).select(COLUMNS).where("tenant_id", "=", tenantId).orderBy("created_at", "desc").orderBy("id", "desc").limit(200).execute();
  return rows.map((r) => toInfo(r as KeyRow));
}

export async function getApiKey(ctx: DbContext, tenantId: string, id: string): Promise<ApiKeyInfo | null> {
  assertTenantId(tenantId);
  assertId(id, "Key id");
  const row = await ctx.db.selectFrom(K).select(COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toInfo(row as KeyRow) : null;
}

/** Calls per key today and over the last 30 UK days (the settings screen). */
export async function apiKeyUsage(ctx: DbContext, tenantId: string, today: string): Promise<Map<string, { today: number; last30: number; patientReads30: number }>> {
  assertTenantId(tenantId);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const rows = await ctx.db.selectFrom(D).select(["key_id", "day", "calls", "patient_reads"]).where("tenant_id", "=", tenantId).where("day", ">=", from).limit(5000).execute();
  const out = new Map<string, { today: number; last30: number; patientReads30: number }>();
  for (const r of rows) {
    const u = out.get(r.key_id) ?? { today: 0, last30: 0, patientReads30: 0 };
    if (r.day === today) u.today += num(r.calls);
    u.last30 += num(r.calls);
    u.patientReads30 += num(r.patient_reads);
    out.set(r.key_id, u);
  }
  return out;
}

/** Revokes a key of this clinic. False when it does not exist or was revoked already. */
export async function revokeApiKey(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "Key id");
  const who = assertActor(actor);
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(K)
    .set({ revoked_at: at, revoked_by: who.userId, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) return false;
  await runBatch(ctx.db, [pmsAuditQuery(ctx, tenantId, actor, { action: "pms.api_key.revoke", targetType: "pms_api_key", targetId: id })]);
  return true;
}

/**
 * Rotation: a new key with the same name, scopes, sites and expiry length; the old one keeps working for
 * API_ROTATION_GRACE_HOURS (its expiry is brought forward, never pushed back) and points at its replacement. One
 * atomic batch: the old key is marked first (conditionally: active and not replaced yet), the new key and the
 * audit row are inserted only where that mark is found – a second rotation of the same key writes nothing.
 */
export async function rotateApiKey(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<CreatedApiKey | null> {
  assertTenantId(tenantId);
  const who = assertActor(actor);
  const old = await getApiKey(ctx, tenantId, id);
  const at = nowIso(ctx);
  if (!old || !apiKeyActive(old, at) || old.replacedById) return null;
  const graceEnd = new Date(Date.parse(at) + API_ROTATION_GRACE_HOURS * 3_600_000).toISOString();
  const oldEnd = old.expiresAt && Date.parse(old.expiresAt) < Date.parse(graceEnd) ? old.expiresAt : graceEnd;
  const lengthMs = old.expiresAt ? Math.max(86_400_000, Date.parse(old.expiresAt) - Date.parse(old.createdAt)) : null;
  const newId = pmsId("apik", ctx);
  const { key, row } = keyRow(
    ctx,
    tenantId,
    { id: newId, name: old.name, scopes: old.scopes, siteIds: old.siteIds, expiresAt: lengthMs ? new Date(Date.parse(at) + lengthMs).toISOString() : null, createdBy: who.userId },
    at,
  );
  const marked = ctx.db.selectFrom(K).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("replaced_by_id", "=", newId);
  const columns = Object.keys(row) as (keyof typeof row)[];
  const insertNew = ctx.db
    .insertInto(K)
    .columns(columns)
    .expression(ctx.db.selectNoFrom((eb) => columns.map((c) => eb.val(row[c]).as(c)) as never).where((eb) => eb.exists(marked)) as never);
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(K)
      .set({ replaced_by_id: newId, expires_at: oldEnd, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .where("replaced_by_id", "is", null),
    insertNew,
    auditInsertWhenExists(ctx, tenantId, { action: "pms.api_key.rotate", targetType: "pms_api_key", targetId: id, detail: { newKeyId: newId, last4: row.last4 }, userId: who.userId, sessionId: who.sessionId }, marked).query,
  ]);
  if (Number(results[0]?.numAffectedRows ?? 0) === 0) return null;
  return { ...toInfo(row as KeyRow), key };
}

/* ------------------------------------------------------------------------------------------------
 * Verification and use
 * ----------------------------------------------------------------------------------------------*/

const DUMMY_HASH = Buffer.alloc(32);

/**
 * The key's row when the presented key is exactly one of the clinic's working keys, else null. The tenant comes
 * from the key itself (every statement is scoped to it); the hashes are compared in constant time.
 */
export async function verifyApiKey(ctx: DbContext, presented: string): Promise<VerifiedApiKey | null> {
  const parsed = parseApiKey(presented);
  const presentedHash = createHash("sha256").update(String(presented ?? ""), "utf8").digest();
  if (!parsed) {
    timingSafeEqual(presentedHash, DUMMY_HASH);
    return null;
  }
  const row = await ctx.db
    .selectFrom(K)
    .select(["id", "tenant_id", "name", "key_hash", "scopes_json", "site_ids_json", "expires_at", "revoked_at"])
    .where("tenant_id", "=", parsed.tenantId)
    .where("lookup", "=", parsed.lookup)
    .executeTakeFirst();
  const stored = row && /^[0-9a-f]{64}$/.test(row.key_hash) ? Buffer.from(row.key_hash, "hex") : DUMMY_HASH;
  const same = timingSafeEqual(presentedHash, stored);
  if (!row || !same) return null;
  if (!apiKeyActive({ revokedAt: row.revoked_at, expiresAt: row.expires_at }, nowIso(ctx))) return null;
  const sites = parseSiteIds(row.site_ids_json);
  return { id: row.id, tenantId: row.tenant_id, name: row.name, scopes: parseScopes(row.scopes_json), siteIds: sites ? new Set(sites) : null };
}

/**
 * Counts one call of a key: the day's counter (+ patient reads) and the key's last_used_at / use_count, in one batch.
 * The first call of a UK day also writes ONE audit row ("pms.api_key.use") – never one per call.
 */
export async function recordApiUse(ctx: DbContext, tenantId: string, keyId: string, options: { patientReads?: number; actor?: PmsActor } = {}): Promise<void> {
  assertTenantId(tenantId);
  assertId(keyId, "Key id");
  const at = nowIso(ctx);
  const day = londonDate(at);
  const reads = Math.max(0, Math.floor(options.patientReads ?? 0));
  const results = await runBatch(ctx.db, [
    ctx.db
      .insertInto(D)
      .values({ tenant_id: tenantId, key_id: keyId, day, calls: 1, patient_reads: reads, created_at: at, updated_at: at })
      .onConflict((oc) => oc.columns(["tenant_id", "key_id", "day"]).doUpdateSet((eb) => ({ calls: eb("pms_api_key_days.calls", "+", 1), updated_at: at })))
      .returning("calls"),
    ctx.db
      .updateTable(K)
      .set((eb) => ({ last_used_at: at, use_count: eb("use_count", "+", 1) }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", keyId),
  ]);
  const calls = num((results[0]?.rows?.[0] as { calls?: unknown } | undefined)?.calls ?? 0);
  if (calls === 1) {
    await runBatch(ctx.db, [
      pmsAuditQuery(ctx, tenantId, options.actor ?? { userId: null, sessionId: null }, { action: "pms.api_key.use", targetType: "pms_api_key", targetId: keyId, detail: { day, apiKeyId: keyId } }),
    ]);
  }
}

/** Adds patient reads to the key's counter for today (the day row exists: recordApiUse ran first). */
export function patientReadsQuery(ctx: DbContext, tenantId: string, keyId: string, count: number): BatchQuery {
  const at = nowIso(ctx);
  return ctx.db
    .updateTable(D)
    .set({ patient_reads: sql<number>`patient_reads + ${Math.max(0, Math.floor(count))}`, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("key_id", "=", keyId)
    .where("day", "=", londonDate(at));
}
