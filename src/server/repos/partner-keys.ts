/**
 * `partner_keys` – API keys a clinic system (e.g. its PMS integration) sends as x-partner-key.
 * The key is shown ONCE on creation; only its SHA-256 and last 4 characters are stored.
 *
 * Key format: "cfk_<tenantId>_<43 base64url chars>" (256 random bits). The tenant is part of the key so a
 * verifier always knows which tenant to check (`partnerKeyTenant()`), and every lookup is tenant-scoped.
 */
import { createHash, randomBytes } from "node:crypto";
import { assertId, assertTenantId, assertText, nowIso, optionalText, randomId, type RepoContext } from "./context";

const PREFIX = "cfk_";
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface PartnerKeyInfo {
  id: string;
  tenantId: string;
  name: string;
  last4: string;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedPartnerKey extends PartnerKeyInfo {
  /** The full key. Shown once; never stored or retrievable again. */
  key: string;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** The tenant a presented key belongs to, or null when the key is malformed. */
export function partnerKeyTenant(key: string): string | null {
  if (typeof key !== "string" || !key.startsWith(PREFIX) || key.length > 200) return null;
  const rest = key.slice(PREFIX.length);
  const sep = rest.indexOf("_");
  if (sep <= 0) return null;
  const tenantId = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantId) || !SECRET.test(secret)) return null;
  return tenantId;
}

export async function createPartnerKey(
  ctx: RepoContext,
  tenantId: string,
  input: { name: string; createdBy?: string | null },
): Promise<CreatedPartnerKey> {
  assertTenantId(tenantId);
  const name = assertText(input.name, "Key name", 80);
  const createdBy = optionalText(input.createdBy, "createdBy", 128);
  const key = `${PREFIX}${tenantId}_${randomBytes(32).toString("base64url")}`;
  const info: PartnerKeyInfo = {
    id: randomId("pk"),
    tenantId,
    name,
    last4: key.slice(-4),
    createdBy,
    createdAt: nowIso(ctx),
    revokedAt: null,
  };
  await ctx.db
    .insertInto("partner_keys")
    .values({
      id: info.id,
      tenant_id: tenantId,
      name,
      key_hash: hashKey(key),
      last4: info.last4,
      created_by: createdBy,
      created_at: info.createdAt,
      revoked_at: null,
    })
    .execute();
  return { ...info, key };
}

export async function listPartnerKeys(ctx: RepoContext, tenantId: string): Promise<PartnerKeyInfo[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("partner_keys")
    .select(["id", "tenant_id", "name", "last4", "created_by", "created_at", "revoked_at"])
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    last4: r.last4,
    createdBy: r.created_by,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  }));
}

/** Revokes a key of this tenant. Returns false when it does not exist or was already revoked. */
export async function revokePartnerKey(ctx: RepoContext, tenantId: string, id: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "Key id");
  const result = await ctx.db
    .updateTable("partner_keys")
    .set({ revoked_at: nowIso(ctx) })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/** Checks a presented key against the tenant's active keys. */
export async function verifyPartnerKey(
  ctx: RepoContext,
  tenantId: string,
  presentedKey: string,
): Promise<{ id: string; tenantId: string; name: string } | null> {
  assertTenantId(tenantId);
  if (partnerKeyTenant(presentedKey) !== tenantId) return null;
  const row = await ctx.db
    .selectFrom("partner_keys")
    .select(["id", "tenant_id", "name"])
    .where("tenant_id", "=", tenantId)
    .where("key_hash", "=", hashKey(presentedKey))
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return row ? { id: row.id, tenantId: row.tenant_id, name: row.name } : null;
}
