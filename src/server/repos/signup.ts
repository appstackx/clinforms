/**
 * `signup_requests` and `signup_acceptances` (migration 0010) – self-serve sign-up (src/server/signup/self-signup.ts,
 * docs/auth.md §1b). Not tenant data until the clinic exists: a request belongs to nobody yet; an acceptance is keyed by
 * the clinic it created. No patient data; the link's token and the password are never stored (hashes only).
 */
import { RepoInputError, assertIso, assertText, nowIso, randomId, type DbContext } from "./context";

export type SignupBrand = "clinforms" | "clinic";

export interface SignupRequestInput {
  tokenHash: string;
  brand: SignupBrand;
  clinicName: string;
  ownerName: string;
  email: string;
  passwordHash: string;
  termsVersion: string;
  dpaVersion: string;
  ipHash: string;
  uaHash: string;
  expiresAt: string;
}

export interface SignupRequest {
  id: string;
  brand: SignupBrand;
  clinicName: string;
  ownerName: string;
  email: string;
  passwordHash: string | null;
  termsVersion: string;
  dpaVersion: string;
  ipHash: string;
  uaHash: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  tenantId: string | null;
  completedAt: string | null;
}

function brandOf(value: string): SignupBrand {
  if (value !== "clinforms" && value !== "clinic") throw new RepoInputError("brand must be clinforms or clinic.");
  return value;
}

type Row = {
  id: string;
  brand: string;
  clinic_name: string;
  owner_name: string;
  email: string;
  password_hash: string | null;
  terms_version: string;
  dpa_version: string;
  ip_hash: string;
  ua_hash: string;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  tenant_id: string | null;
  completed_at: string | null;
};

function toRequest(r: Row): SignupRequest {
  return {
    id: r.id,
    brand: brandOf(r.brand),
    clinicName: r.clinic_name,
    ownerName: r.owner_name,
    email: r.email,
    passwordHash: r.password_hash,
    termsVersion: r.terms_version,
    dpaVersion: r.dpa_version,
    ipHash: r.ip_hash,
    uaHash: r.ua_hash,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    claimedAt: r.claimed_at,
    tenantId: r.tenant_id,
    completedAt: r.completed_at,
  };
}

const COLUMNS = [
  "id",
  "brand",
  "clinic_name",
  "owner_name",
  "email",
  "password_hash",
  "terms_version",
  "dpa_version",
  "ip_hash",
  "ua_hash",
  "created_at",
  "expires_at",
  "claimed_at",
  "tenant_id",
  "completed_at",
] as const;

export async function createSignupRequest(ctx: DbContext, input: SignupRequestInput): Promise<SignupRequest> {
  const row: Row = {
    id: randomId("su"),
    brand: brandOf(input.brand),
    clinic_name: assertText(input.clinicName, "Clinic name", 200),
    owner_name: assertText(input.ownerName, "Name", 200),
    email: assertText(input.email, "Email", 254),
    password_hash: assertText(input.passwordHash, "Password hash", 1000),
    terms_version: assertText(input.termsVersion, "Terms version", 80),
    dpa_version: assertText(input.dpaVersion, "DPA version", 80),
    ip_hash: assertText(input.ipHash, "IP hash", 128),
    ua_hash: assertText(input.uaHash, "User agent hash", 128),
    created_at: nowIso(ctx),
    expires_at: assertIso(input.expiresAt, "expiresAt"),
    claimed_at: null,
    tenant_id: null,
    completed_at: null,
  };
  await ctx.db
    .insertInto("signup_requests")
    .values({ ...row, token_hash: assertText(input.tokenHash, "Token hash", 128) })
    .execute();
  return toRequest(row);
}

export async function findSignupRequestByTokenHash(ctx: DbContext, tokenHash: string): Promise<SignupRequest | null> {
  const row = await ctx.db.selectFrom("signup_requests").select(COLUMNS).where("token_hash", "=", tokenHash).executeTakeFirst();
  return row ? toRequest(row as Row) : null;
}

export async function getSignupRequest(ctx: DbContext, id: string): Promise<SignupRequest | null> {
  const row = await ctx.db.selectFrom("signup_requests").select(COLUMNS).where("id", "=", id).executeTakeFirst();
  return row ? toRequest(row as Row) : null;
}

/**
 * Claims an unused, unexpired request – ONE statement, so two clicks (two tabs, a double submit) cannot both go on to
 * create a clinic. True when this call claimed it.
 */
export async function claimSignupRequest(ctx: DbContext, id: string): Promise<boolean> {
  const now = nowIso(ctx);
  const result = await ctx.db
    .updateTable("signup_requests")
    .set({ claimed_at: now })
    .where("id", "=", id)
    .where("claimed_at", "is", null)
    .where("expires_at", ">", now)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

/** Records the clinic created from a claimed request (before the owner's account exists). */
export async function setSignupTenant(ctx: DbContext, id: string, tenantId: string): Promise<void> {
  await ctx.db.updateTable("signup_requests").set({ tenant_id: tenantId }).where("id", "=", id).where("tenant_id", "is", null).execute();
}

/** The owner's account joined the clinic: the request is done and its password hash is cleared. */
export async function completeSignupRequest(ctx: DbContext, id: string): Promise<void> {
  await ctx.db.updateTable("signup_requests").set({ completed_at: nowIso(ctx), password_hash: null }).where("id", "=", id).execute();
}

/** A claimed request whose clinic could not be created (nothing was written): free it for another try. */
export async function releaseSignupClaim(ctx: DbContext, id: string): Promise<void> {
  await ctx.db.updateTable("signup_requests").set({ claimed_at: null }).where("id", "=", id).where("tenant_id", "is", null).where("completed_at", "is", null).execute();
}

/** The request is no longer needed (e.g. the address has an account meanwhile): used up, password hash cleared. */
export async function closeSignupRequest(ctx: DbContext, id: string): Promise<void> {
  const now = nowIso(ctx);
  await ctx.db.updateTable("signup_requests").set({ claimed_at: now, completed_at: now, password_hash: null }).where("id", "=", id).execute();
}

/**
 * Retention: requests whose link expired more than `graceDays` ago are deleted (with what the person typed). Completed
 * requests go too – the acceptance record and the audit trail keep what has to be kept. Tolerates a database before
 * migration 0010 (0).
 */
export async function purgeSignupRequests(ctx: DbContext, before: string): Promise<number> {
  try {
    const result = await ctx.db.deleteFrom("signup_requests").where("expires_at", "<", assertIso(before, "before")).executeTakeFirst();
    return Number(result.numDeletedRows);
  } catch (err) {
    if (isMissingSignupTable(err)) return 0;
    throw err;
  }
}

export interface SignupAcceptanceInput {
  tenantId: string;
  userId: string;
  signupId: string;
  brand: SignupBrand;
  termsVersion: string;
  dpaVersion: string;
  acceptedAt: string;
  ipHash: string;
  uaHash: string;
}

export interface SignupAcceptance extends SignupAcceptanceInput {
  id: string;
  confirmedAt: string;
}

export async function recordSignupAcceptance(ctx: DbContext, input: SignupAcceptanceInput): Promise<SignupAcceptance> {
  const acceptance: SignupAcceptance = {
    id: randomId("sa"),
    tenantId: assertText(input.tenantId, "Clinic id", 63),
    userId: assertText(input.userId, "User id", 100),
    signupId: assertText(input.signupId, "Sign-up id", 100),
    brand: brandOf(input.brand),
    termsVersion: assertText(input.termsVersion, "Terms version", 80),
    dpaVersion: assertText(input.dpaVersion, "DPA version", 80),
    acceptedAt: assertIso(input.acceptedAt, "acceptedAt"),
    confirmedAt: nowIso(ctx),
    ipHash: assertText(input.ipHash, "IP hash", 128),
    uaHash: assertText(input.uaHash, "User agent hash", 128),
  };
  await ctx.db
    .insertInto("signup_acceptances")
    .values({
      id: acceptance.id,
      tenant_id: acceptance.tenantId,
      user_id: acceptance.userId,
      signup_id: acceptance.signupId,
      brand: acceptance.brand,
      terms_version: acceptance.termsVersion,
      dpa_version: acceptance.dpaVersion,
      accepted_at: acceptance.acceptedAt,
      confirmed_at: acceptance.confirmedAt,
      ip_hash: acceptance.ipHash,
      ua_hash: acceptance.uaHash,
    })
    .execute();
  return acceptance;
}

export async function listSignupAcceptances(ctx: DbContext, tenantId: string): Promise<SignupAcceptance[]> {
  const rows = await ctx.db.selectFrom("signup_acceptances").selectAll().where("tenant_id", "=", tenantId).orderBy("confirmed_at", "asc").execute();
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    signupId: r.signup_id,
    brand: brandOf(r.brand),
    termsVersion: r.terms_version,
    dpaVersion: r.dpa_version,
    acceptedAt: r.accepted_at,
    confirmedAt: r.confirmed_at,
    ipHash: r.ip_hash,
    uaHash: r.ua_hash,
  }));
}

/** A database before migration 0010 (deployed code, migration not applied yet). */
export function isMissingSignupTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (/no such table: (?:main\.)?signup_(requests|acceptances)\b|relation "(?:public\.)?signup_(requests|acceptances)" does not exist/i.test(message)) return true;
  if (e.code === "42P01" && /signup_(requests|acceptances)/.test(message)) return true;
  return e.cause !== undefined && e.cause !== err ? isMissingSignupTable(e.cause) : false;
}
