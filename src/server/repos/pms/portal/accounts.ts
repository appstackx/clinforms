/**
 * Patient portal accounts, one-time sign-in links and sessions (`pms_portal_accounts`, `pms_portal_links`,
 * `pms_portal_sessions`). SEPARATE from staff accounts: no password, no Better Auth user, no membership – a portal
 * account belongs to ONE patient record of ONE clinic and can never reach /app.
 *
 * - A sign-in link and a session are random secrets held by the patient (the email, the cookie); the database
 *   keeps only their SHA-256, so a copy of the database signs nobody in.
 * - A link is used at most once: claimed by one conditional UPDATE (used_at IS NULL AND not expired).
 * - Disabling an account revokes its sessions; the sign-in page then behaves exactly as for an unknown person.
 */
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import type { PortalAccount, PortalSession } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch } from "../../../db/batch";
import type { PmsPortalAccountsTable, PmsPortalSessionsTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, nowIso, pmsAudit, pmsAuditQuery, pmsId, translateDbError, writeWithAudit, type DbContext } from "../context";

const HASH = /^[0-9a-f]{64}$/;

function checkHash(hash: string, what: string): string {
  if (typeof hash !== "string" || !HASH.test(hash)) throw new RepoInputError(`${what} must be SHA-256 hex.`);
  return hash;
}

function toAccount(r: Selectable<PmsPortalAccountsTable>): PortalAccount {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    status: r.status === "disabled" ? "disabled" : "active",
    lastSignInAt: r.last_sign_in_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getPortalAccount(ctx: DbContext, tenantId: string, id: string): Promise<PortalAccount | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_portal_accounts").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toAccount(row) : null;
}

export async function getPortalAccountForPatient(ctx: DbContext, tenantId: string, patientId: string): Promise<PortalAccount | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom("pms_portal_accounts").selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).executeTakeFirst();
  return row ? toAccount(row) : null;
}

/** The patient's portal account, created (active) on first use. */
export async function ensurePortalAccount(ctx: DbContext, tenantId: string, patientId: string, actor: PmsActor): Promise<PortalAccount> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const existing = await getPortalAccountForPatient(ctx, tenantId, patientId);
  if (existing) return existing;
  const id = pmsId(P.account, ctx);
  const at = nowIso(ctx);
  try {
    await writeWithAudit(
      ctx,
      [
        ctx.db.insertInto("pms_portal_accounts").values({ tenant_id: tenantId, id, patient_id: patientId, status: "active", updated_by: actor.userId, created_at: at, updated_at: at }),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.portal_account.create", targetType: "pms_portal_account", targetId: id, detail: { patientId } }),
      ],
      { foreignKey: "That patient does not exist in this clinic." },
    );
  } catch (err) {
    // Two requests at once: the other one created it.
    const again = await getPortalAccountForPatient(ctx, tenantId, patientId);
    if (again) return again;
    throw err;
  }
  return (await getPortalAccount(ctx, tenantId, id)) as PortalAccount;
}

/** Turns a patient's portal access on or off; off also signs them out everywhere. */
export async function setPortalAccountStatus(ctx: DbContext, tenantId: string, accountId: string, status: "active" | "disabled", actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(accountId, "account id");
  if (status !== "active" && status !== "disabled") throw new RepoInputError("Status must be active or disabled.");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable("pms_portal_accounts")
    .set({ status, updated_by: actor.userId, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", accountId)
    .where("status", "!=", status)
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (!changed) return false;
  if (status === "disabled") {
    await ctx.db.updateTable("pms_portal_sessions").set({ revoked_at: at }).where("tenant_id", "=", tenantId).where("account_id", "=", accountId).where("revoked_at", "is", null).execute();
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.portal_account.status", targetType: "pms_portal_account", targetId: accountId, detail: { status } });
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * One-time sign-in links
 * ----------------------------------------------------------------------------------------------*/

/** Stores a new sign-in link (its hash) for an account. The message carrying it is written by the caller. */
export async function createSignInLink(ctx: DbContext, tenantId: string, accountId: string, tokenHash: string, expiresAt: string, actor: PmsActor, extra: Parameters<typeof runBatch>[1] = []): Promise<{ id: string }> {
  assertTenantId(tenantId);
  assertId(accountId, "account id");
  checkHash(tokenHash, "tokenHash");
  const id = pmsId(P.signInLink, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto("pms_portal_links").values({ tenant_id: tenantId, id, account_id: accountId, token_hash: tokenHash, expires_at: expiresAt, used_at: null, created_at: at }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.portal_link.create", targetType: "pms_portal_account", targetId: accountId, detail: { link: id } }),
      ...extra,
    ],
    { foreignKey: "That portal account does not exist in this clinic." },
  );
  return { id };
}

export type SignInResult = { ok: true; session: PortalSession; account: PortalAccount } | { ok: false; reason: "invalid" };

/**
 * Uses a sign-in link: claims it (once, unexpired), checks the account is active, and opens a session whose
 * secret's hash the caller passes in. Any failure looks the same to the patient ("invalid").
 */
export async function signInWithLink(ctx: DbContext, tenantId: string, linkTokenHash: string, sessionTokenHash: string, sessionExpiresAt: string): Promise<SignInResult> {
  assertTenantId(tenantId);
  if (!HASH.test(linkTokenHash)) return { ok: false, reason: "invalid" };
  checkHash(sessionTokenHash, "sessionTokenHash");
  const at = nowIso(ctx);
  const claim = await ctx.db
    .updateTable("pms_portal_links")
    .set({ used_at: at })
    .where("tenant_id", "=", tenantId)
    .where("token_hash", "=", linkTokenHash)
    .where("used_at", "is", null)
    .where("expires_at", ">", at)
    .executeTakeFirst();
  if (Number(claim.numUpdatedRows) === 0) return { ok: false, reason: "invalid" };
  const link = await ctx.db.selectFrom("pms_portal_links").select(["id", "account_id"]).where("tenant_id", "=", tenantId).where("token_hash", "=", linkTokenHash).executeTakeFirst();
  if (!link) return { ok: false, reason: "invalid" };
  const account = await getPortalAccount(ctx, tenantId, link.account_id);
  if (!account || account.status !== "active") return { ok: false, reason: "invalid" };
  const id = pmsId(P.session, ctx);
  const actor: PmsActor = { userId: null, sessionId: id };
  try {
    await runBatch(ctx.db, [
      ctx.db.insertInto("pms_portal_sessions").values({ tenant_id: tenantId, id, account_id: account.id, token_hash: sessionTokenHash, expires_at: sessionExpiresAt, last_seen_at: at, revoked_at: null, created_at: at }),
      ctx.db.updateTable("pms_portal_accounts").set({ last_sign_in_at: at, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", account.id),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.portal_session.create", targetType: "pms_portal_account", targetId: account.id, detail: { via: "patient", link: link.id } }),
    ]);
  } catch (err) {
    throw translateDbError(err);
  }
  const session = (await getPortalSession(ctx, tenantId, id)) as PortalSession;
  return { ok: true, session, account: { ...account, lastSignInAt: at } };
}

/* ------------------------------------------------------------------------------------------------
 * Sessions
 * ----------------------------------------------------------------------------------------------*/

function toSession(r: Selectable<PmsPortalSessionsTable>, patientId: string): PortalSession {
  return { tenantId: r.tenant_id, id: r.id, accountId: r.account_id, patientId, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at, createdAt: r.created_at };
}

/** A session by id with its patient (the caller compares the cookie secret's hash with `tokenHash`). */
export async function getPortalSession(ctx: DbContext, tenantId: string, id: string): Promise<(PortalSession & { tokenHash: string; accountStatus: "active" | "disabled" }) | null> {
  assertTenantId(tenantId);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(id)) return null;
  const row = await ctx.db.selectFrom("pms_portal_sessions").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const account = await getPortalAccount(ctx, tenantId, row.account_id);
  if (!account) return null;
  return { ...toSession(row, account.patientId), tokenHash: row.token_hash, accountStatus: account.status };
}

/** Moves "last seen" forward (the idle timeout). A derived column: no audit row. */
export async function touchPortalSession(ctx: DbContext, tenantId: string, id: string): Promise<void> {
  assertTenantId(tenantId);
  await ctx.db.updateTable("pms_portal_sessions").set({ last_seen_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("id", "=", id).where("revoked_at", "is", null).execute();
}

/** Signs a session out (the patient's "Sign out"). */
export async function revokePortalSession(ctx: DbContext, tenantId: string, id: string): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const result = await ctx.db.updateTable("pms_portal_sessions").set({ revoked_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id).where("revoked_at", "is", null).executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) {
    const row = await ctx.db.selectFrom("pms_portal_sessions").select("account_id").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    await pmsAudit(ctx, tenantId, { userId: null, sessionId: id }, { action: "pms.portal_session.end", targetType: "pms_portal_account", targetId: row?.account_id ?? null, detail: { via: "patient" } });
  }
  return changed;
}

/** Sign-in links created for an account since an instant (a cap on how many emails one person can trigger). */
export async function countRecentSignInLinks(ctx: DbContext, tenantId: string, accountId: string, sinceIso: string): Promise<number> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom("pms_portal_links")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("account_id", "=", accountId)
    .where("created_at", ">=", sinceIso)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
