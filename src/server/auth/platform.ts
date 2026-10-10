/**
 * Platform operations (run by ClinForms staff through scripts/admin/*, never from a web page in this wave):
 * create a clinic, list clinics, offboard a clinic, reset a locked-out member's two-step verification.
 * Runbook: docs/auth.md.
 *
 * These write Better Auth's tables directly (in one atomic batch where it matters, which also works on D1),
 * using Better Auth's encodings: ids are random strings, timestamps ISO-8601, booleans true/false (stored
 * 0/1 on SQLite/D1).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import type { DataCipher } from "../crypto/envelope";
import { runBatch, type BatchQuery } from "../db/batch";
import { authBool, type Database } from "../db/schema";
import { deliverEmail, emailProviderName, invitationEmail, type DeliveryResult } from "../email";
import { appendAudit, listAudit } from "../repos/audit";
import { getClinicProfile } from "../repos/clinic-profile";
import { RepoInputError, assertText } from "../repos/context";
import { getFormFile, listFormFiles } from "../repos/form-files";
import { listMemberProfiles } from "../repos/member-profile";
import { listPartnerKeys } from "../repos/partner-keys";
import { getTenantSettings } from "../repos/tenant-settings";
import { INVITATION_TTL_SECONDS, PLATFORM_USER_EMAIL, PLATFORM_USER_ID, invitationRef } from "./create-auth";
import { inviteLink } from "./invite-token";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "../../lib/account-copy";
import { assertTenantSlug } from "./tenant";

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A Better Auth-style id: 32 random alphanumerics (~190 bits). */
export function authId(): string {
  const bytes = randomBytes(64);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < 32; i++) {
    if (bytes[i] < 248) out += ALPHANUM[bytes[i] % 62];
  }
  return out.length === 32 ? out : authId();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(email: string): string {
  const e = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 254) throw new RepoInputError("Enter a valid email address.");
  return e;
}

export { inviteLink } from "./invite-token";

/** The platform's own user (inviter of record for platform-made invitations). No password: cannot sign in. */
export async function ensurePlatformUser(db: Kysely<Database>): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto("user")
    .values({
      id: PLATFORM_USER_ID,
      name: "ClinForms",
      email: PLATFORM_USER_EMAIL,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: false,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

export interface CreateClinicInput {
  name: string;
  slug: string;
  ownerEmail: string;
  retentionDays?: number;
  /** The app's public origin, for the invitation link (e.g. https://clinforms.co.uk). */
  appOrigin: string;
  /** BETTER_AUTH_SECRET of the target app: signs the invitation link (an invitation id alone is not a link). */
  linkSecret: string;
  now?: Date;
}

export interface CreatedClinic {
  organizationId: string;
  tenantId: string;
  invitationId: string;
  inviteLink: string;
  invitationExpiresAt: string;
  email: DeliveryResult;
}

/**
 * The checks every new clinic passes (createClinic, createClinicForExistingOwner): a valid, unused clinic id that no
 * earlier clinic's audit trail is kept under, a name, and a retention period in range.
 */
async function checkNewClinic(
  db: Kysely<Database>,
  input: { name: string; slug: string; retentionDays?: number },
): Promise<{ slug: string; name: string; retentionDays: number }> {
  const slug = assertTenantSlug(String(input.slug ?? "").trim());
  const name = assertText(String(input.name ?? "").trim(), "Clinic name", 200);
  const retentionDays = input.retentionDays ?? 365;
  if (!Number.isInteger(retentionDays) || retentionDays < RETENTION_MIN_DAYS || retentionDays > RETENTION_MAX_DAYS) {
    throw new RepoInputError(`Retention must be ${RETENTION_MIN_DAYS}–${RETENTION_MAX_DAYS} days.`);
  }
  const existing = await db.selectFrom("organization").select("id").where("slug", "=", slug).executeTakeFirst();
  if (existing) throw new RepoInputError(`A clinic with the id "${slug}" already exists (or was offboarded and keeps its id).`);
  // An earlier clinic's audit trail stays under its id for good: a new clinic must not inherit it.
  const history = await db.selectFrom("audit_log").select("id").where("tenant_id", "=", slug).limit(1).executeTakeFirst();
  if (history) throw new RepoInputError(`The id "${slug}" was used by an earlier clinic (its audit trail is kept): choose another id.`);
  return { slug, name, retentionDays };
}

export async function createClinic(db: Kysely<Database>, input: CreateClinicInput): Promise<CreatedClinic> {
  const ownerEmail = normaliseEmail(input.ownerEmail);
  const { slug, name, retentionDays } = await checkNewClinic(db, input);

  await ensurePlatformUser(db);
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const organizationId = authId();
  const invitationId = authId();
  const invitationExpiresAt = new Date(now.getTime() + INVITATION_TTL_SECONDS * 1000).toISOString();
  const link = inviteLink(input.appOrigin, invitationId, input.linkSecret); // before any write: a bad secret changes nothing
  await runBatch(db, [
    db.insertInto("organization").values({ id: organizationId, name, slug, logo: null, createdAt: at, metadata: null }),
    db.insertInto("clinic_profile").values({
      tenant_id: slug,
      organization_id: organizationId,
      display_name: name,
      legal_name: null,
      address_json: null,
      postcode: null,
      phone: null,
      email: null,
      retention_days: retentionDays,
      drafting_enabled: 0,
      created_at: at,
      updated_at: at,
    }),
    db.insertInto("invitation").values({
      id: invitationId,
      organizationId,
      email: ownerEmail,
      role: "owner",
      status: "pending",
      expiresAt: invitationExpiresAt,
      createdAt: at,
      inviterId: PLATFORM_USER_ID,
    }),
  ]);
  const email = await deliverEmail(
    invitationEmail({ to: { email: ownerEmail }, clinicName: name, role: "owner", inviterName: null, link, expiresAt: invitationExpiresAt }),
  );
  await appendAudit({ db }, slug, {
    userId: PLATFORM_USER_ID,
    action: "clinic.create",
    targetType: "organization",
    targetId: organizationId,
    detail: { invitation: invitationRef(invitationId), retentionDays, emailProvider: emailProviderName(), emailStatus: email.status },
  });
  return { organizationId, tenantId: slug, invitationId, inviteLink: link, invitationExpiresAt, email };
}

/* ------------------------------------------------------------------------------------------------
 * A clinic whose owner already has an account (scripts/admin/seed-demo-clinic.ts – the demonstration clinic)
 * ----------------------------------------------------------------------------------------------*/

export interface ClinicProfileDetails {
  legalName?: string | null;
  address?: string[] | null;
  postcode?: string | null;
  phone?: string | null;
  email?: string | null;
  draftingEnabled?: boolean;
}

export interface CreateClinicForOwnerInput {
  name: string;
  slug: string;
  /** An EXISTING account (never created here): it becomes the clinic's owner directly, without an invitation. */
  ownerUserId: string;
  retentionDays?: number;
  profile?: ClinicProfileDetails;
  /** Extra, non-identifying detail for the audit rows (e.g. {demonstration: true}). */
  auditDetail?: Record<string, unknown>;
  now?: Date;
}

export interface CreatedClinicForOwner {
  organizationId: string;
  tenantId: string;
  memberId: string;
}

/**
 * Creates a clinic (organization + clinic profile) with an existing account as its owner – one atomic batch, no
 * invitation and no email. The same checks as createClinic (id rules, unused id, no earlier audit trail, retention).
 * Audited under the clinic as "clinic.create" and "member.add" (ids only), by the platform's own user.
 */
export async function createClinicForExistingOwner(db: Kysely<Database>, input: CreateClinicForOwnerInput): Promise<CreatedClinicForOwner> {
  const { slug, name, retentionDays } = await checkNewClinic(db, input);
  const owner = await db.selectFrom("user").select("id").where("id", "=", String(input.ownerUserId ?? "")).executeTakeFirst();
  if (!owner || owner.id === PLATFORM_USER_ID) throw new RepoInputError("The owner must be an existing account.");
  const profile = input.profile ?? {};
  if (profile.address && (!Array.isArray(profile.address) || profile.address.some((l) => typeof l !== "string" || l.length > 200))) {
    throw new RepoInputError("address must be a list of lines (≤ 200 characters each).");
  }
  await ensurePlatformUser(db);
  const at = (input.now ?? new Date()).toISOString();
  const organizationId = authId();
  const memberId = authId();
  await runBatch(db, [
    db.insertInto("organization").values({ id: organizationId, name, slug, logo: null, createdAt: at, metadata: null }),
    db.insertInto("clinic_profile").values({
      tenant_id: slug,
      organization_id: organizationId,
      display_name: name,
      legal_name: profile.legalName ?? null,
      address_json: profile.address ? JSON.stringify(profile.address) : null,
      postcode: profile.postcode ?? null,
      phone: profile.phone ?? null,
      email: profile.email ?? null,
      retention_days: retentionDays,
      drafting_enabled: profile.draftingEnabled ? 1 : 0,
      created_at: at,
      updated_at: at,
    }),
    db.insertInto("member").values({ id: memberId, organizationId, userId: owner.id, role: "owner", createdAt: at }),
  ]);
  const detail = input.auditDetail ?? {};
  await appendAudit({ db }, slug, {
    userId: PLATFORM_USER_ID,
    action: "clinic.create",
    targetType: "organization",
    targetId: organizationId,
    detail: { ...detail, retentionDays, owner: "existing_account" },
  });
  await appendAudit({ db }, slug, {
    userId: PLATFORM_USER_ID,
    action: "member.add",
    targetType: "user",
    targetId: owner.id,
    detail: { ...detail, role: "owner" },
  });
  return { organizationId, tenantId: slug, memberId };
}

/**
 * Makes an existing account an owner of an existing clinic directly (no invitation). Idempotent: an owner stays an
 * owner (null returned, nothing written); a member with another role is refused (change roles in the app). Audited
 * under the clinic as "member.add".
 */
export async function addExistingOwner(
  db: Kysely<Database>,
  input: { organizationId: string; tenantId: string; userId: string; auditDetail?: Record<string, unknown>; now?: Date },
): Promise<{ memberId: string } | null> {
  const owner = await db.selectFrom("user").select("id").where("id", "=", String(input.userId ?? "")).executeTakeFirst();
  if (!owner || owner.id === PLATFORM_USER_ID) throw new RepoInputError("The owner must be an existing account.");
  const current = await db
    .selectFrom("member")
    .select(["id", "role"])
    .where("organizationId", "=", input.organizationId)
    .where("userId", "=", owner.id)
    .executeTakeFirst();
  if (current) {
    if (current.role === "owner") return null;
    throw new RepoInputError(`This account is already a member of the clinic (role ${current.role}): change the role in the clinic's settings.`);
  }
  const memberId = authId();
  await db
    .insertInto("member")
    .values({ id: memberId, organizationId: input.organizationId, userId: owner.id, role: "owner", createdAt: (input.now ?? new Date()).toISOString() })
    .execute();
  await appendAudit({ db }, input.tenantId, {
    userId: PLATFORM_USER_ID,
    action: "member.add",
    targetType: "user",
    targetId: owner.id,
    detail: { ...(input.auditDetail ?? {}), role: "owner" },
  });
  return { memberId };
}

export interface ClinicSummary {
  organizationId: string;
  tenantId: string;
  name: string;
  createdAt: string;
  members: number;
  owners: number;
  pendingInvitations: number;
  retentionDays: number | null;
  offboardedAt: string | null;
}

function offboardedAt(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { offboardedAt?: unknown };
    return typeof parsed.offboardedAt === "string" ? parsed.offboardedAt : null;
  } catch {
    return null;
  }
}

export async function listClinics(db: Kysely<Database>, now = new Date()): Promise<ClinicSummary[]> {
  const orgs = await db.selectFrom("organization").selectAll().orderBy("slug").execute();
  const members = await db.selectFrom("member").select(["organizationId", "role"]).execute();
  const invites = await db
    .selectFrom("invitation")
    .select("organizationId")
    .where("status", "=", "pending")
    .where("expiresAt", ">", now.toISOString())
    .execute();
  const profiles = await db.selectFrom("clinic_profile").select(["tenant_id", "retention_days"]).execute();
  return orgs.map((o) => ({
    organizationId: o.id,
    tenantId: o.slug,
    name: o.name,
    createdAt: o.createdAt,
    members: members.filter((m) => m.organizationId === o.id).length,
    owners: members.filter((m) => m.organizationId === o.id && m.role === "owner").length,
    pendingInvitations: invites.filter((i) => i.organizationId === o.id).length,
    retentionDays: profiles.find((p) => p.tenant_id === o.slug)?.retention_days ?? null,
    offboardedAt: offboardedAt(o.metadata),
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Offboarding
 * ----------------------------------------------------------------------------------------------*/

export interface OffboardInput {
  slug: string;
  /** Where the decrypted export goes (created 0700, files 0600). Required with confirm. */
  exportDir?: string;
  /** false (default) = dry run: count only, change nothing. */
  confirm?: boolean;
  /**
   * Also delete the organization row so its id can be used again (default: keep it as a tombstone). Refused
   * when the id has audit rows (append-only, keyed by the id): the next clinic would inherit them.
   */
  releaseSlug?: boolean;
}

export interface OffboardPlan {
  organizationId: string;
  tenantId: string;
  counts: Record<string, number>;
  /** Users who belong to no other clinic: their accounts are deleted. */
  usersToDelete: number;
  /** Members who also belong to another clinic: only their membership here goes. */
  usersKept: number;
}

export interface OffboardResult extends OffboardPlan {
  dryRun: boolean;
  exportDir: string | null;
  exportFiles: string[];
}

/** Every row of an encrypted table for one tenant, decrypted (keyset paging: no row limit). */
async function exportEncrypted(
  db: Kysely<Database>,
  cipher: DataCipher,
  table: "reports" | "forms",
  tenantId: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let after = "";
  for (;;) {
    const rows = await db.selectFrom(table).selectAll().where("tenant_id", "=", tenantId).where("id", ">", after).orderBy("id").limit(20).execute();
    for (const row of rows) {
      const { payload_enc: enc, ...meta } = row as Record<string, unknown> & { payload_enc: string; id: string };
      out.push({ ...meta, payload: JSON.parse(cipher.decryptString(enc, { tenantId, table, rowId: row.id })) });
    }
    if (rows.length < 20) return out;
    after = rows[rows.length - 1].id;
  }
}

async function exportAudit(db: Kysely<Database>, tenantId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let beforeId: string | undefined;
  for (;;) {
    const page = await listAudit({ db }, tenantId, { limit: 500, beforeId });
    out.push(...page);
    if (page.length < 500) return out;
    beforeId = page[page.length - 1].id;
  }
}

function writePrivate(file: string, content: string | Buffer): void {
  fs.writeFileSync(file, content, { mode: 0o600 });
}

async function countRows(db: Kysely<Database>, table: "reports" | "forms" | "form_files" | "audit_log", tenantId: string): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** `cipher` is needed only with confirm (the export decrypts); a dry run only counts. */
export async function offboardClinic(db: Kysely<Database>, cipher: DataCipher | null, input: OffboardInput): Promise<OffboardResult> {
  const tenantId = String(input.slug ?? "").trim();
  const org = await db.selectFrom("organization").selectAll().where("slug", "=", tenantId).executeTakeFirst();
  if (!org) throw new RepoInputError(`No clinic with the id "${tenantId}".`);

  const members = await db
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .select(["member.id", "member.userId", "member.role", "member.createdAt", "user.name", "user.email"])
    .where("member.organizationId", "=", org.id)
    .execute();
  const memberUserIds = members.map((m) => m.userId);
  // In groups of 90 ids: D1 allows at most 100 bound parameters per statement.
  const keep = new Set<string>();
  for (let i = 0; i < memberUserIds.length; i += 90) {
    const rows = await db
      .selectFrom("member")
      .select("userId")
      .where("userId", "in", memberUserIds.slice(i, i + 90))
      .where("organizationId", "!=", org.id)
      .execute();
    for (const row of rows) keep.add(row.userId);
  }
  const deleteUserIds = memberUserIds.filter((id) => !keep.has(id) && id !== PLATFORM_USER_ID);
  const invitations = await db.selectFrom("invitation").selectAll().where("organizationId", "=", org.id).execute();
  const keys = await listPartnerKeys({ db }, tenantId);
  const profiles = await listMemberProfiles({ db }, org.id);
  const counts = {
    members: members.length,
    invitations: invitations.length,
    forms: await countRows(db, "forms", tenantId),
    reports: await countRows(db, "reports", tenantId),
    formFiles: await countRows(db, "form_files", tenantId),
    partnerKeys: keys.length,
    memberProfiles: profiles.length,
    auditRows: await countRows(db, "audit_log", tenantId),
  };
  const plan: OffboardPlan = { organizationId: org.id, tenantId, counts, usersToDelete: deleteUserIds.length, usersKept: keep.size };
  if (input.releaseSlug && counts.auditRows > 0) {
    // The audit log is append-only and keyed by the clinic id: a new clinic created with a released id would
    // show (and export) this clinic's audit trail as its own.
    throw new RepoInputError(
      `The clinic id "${tenantId}" has ${counts.auditRows} audit rows, which are kept for good: it cannot be released for reuse. Offboard without --release-slug.`,
    );
  }
  if (!input.confirm) return { ...plan, dryRun: true, exportDir: null, exportFiles: [] };
  if (!cipher) throw new RepoInputError("The data keys (CLINFORMS_DATA_KEYS) are needed to export the clinic's data.");
  const ctx = { db, cipher };
  const forms = await exportEncrypted(db, cipher, "forms", tenantId);
  const reports = await exportEncrypted(db, cipher, "reports", tenantId);
  const files = await listFormFiles(ctx, tenantId);
  const audit = await exportAudit(db, tenantId);

  // 1. Export (decrypted) and verify it before anything is deleted.
  if (!input.exportDir) throw new RepoInputError("--export-dir is required with --confirm.");
  const dir = path.resolve(input.exportDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dir, "files"), { recursive: true, mode: 0o700 });
  const exportFiles: string[] = [];
  const fileManifest: { sha256: string; fileName: string; mimeType: string; sizeBytes: number; path: string }[] = [];
  for (const meta of files) {
    const file = await getFormFile(ctx, tenantId, meta.sha256);
    if (!file) throw new Error(`Form file ${meta.sha256} is incomplete: stop and investigate before offboarding.`);
    const rel = path.join("files", meta.sha256);
    writePrivate(path.join(dir, rel), file.bytes);
    fileManifest.push({ sha256: meta.sha256, fileName: meta.fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, path: rel });
  }
  const clinic = {
    exportedAt: new Date().toISOString(),
    tenantId,
    organization: { id: org.id, name: org.name, createdAt: org.createdAt },
    clinicProfile: await getClinicProfile(ctx, tenantId),
    tenantSettings: await getTenantSettings(ctx, tenantId),
    members: members.map((m) => ({ memberId: m.id, userId: m.userId, name: m.name, email: m.email, role: m.role, joinedAt: m.createdAt })),
    memberProfiles: profiles,
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, status: i.status, createdAt: i.createdAt, expiresAt: i.expiresAt })),
    partnerKeys: keys,
    auditLog: audit,
    files: fileManifest,
  };
  const outputs: [string, unknown][] = [
    ["clinic.json", clinic],
    ["forms.json", forms],
    ["reports.json", reports],
  ];
  for (const [name, value] of outputs) {
    writePrivate(path.join(dir, name), JSON.stringify(value, null, 2));
    exportFiles.push(name);
  }
  for (const [name, value] of outputs) {
    const back = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    if (JSON.stringify(back) !== JSON.stringify(JSON.parse(JSON.stringify(value)))) throw new Error(`Export check failed for ${name}: nothing deleted.`);
  }
  exportFiles.push(...fileManifest.map((f) => f.path));

  // 2. Delete the tenant's data, memberships and the accounts that belong to no other clinic – one atomic batch.
  const now = new Date().toISOString();
  const queries: BatchQuery[] = [
    db.deleteFrom("reports").where("tenant_id", "=", tenantId),
    db.deleteFrom("forms").where("tenant_id", "=", tenantId),
    db.deleteFrom("form_file_chunks").where("tenant_id", "=", tenantId),
    db.deleteFrom("form_files").where("tenant_id", "=", tenantId),
    db.deleteFrom("tenant_settings").where("tenant_id", "=", tenantId),
    db.deleteFrom("clinic_profile").where("tenant_id", "=", tenantId),
    db.deleteFrom("member_profile").where("organization_id", "=", org.id),
    db.updateTable("partner_keys").set({ revoked_at: now }).where("tenant_id", "=", tenantId).where("revoked_at", "is", null),
    db.deleteFrom("invitation").where("organizationId", "=", org.id),
    db.deleteFrom("member").where("organizationId", "=", org.id),
    db.updateTable("session").set({ activeOrganizationId: null }).where("activeOrganizationId", "=", org.id),
  ];
  for (let i = 0; i < deleteUserIds.length; i += 90) {
    // sessions, accounts and two-step secrets go with the user (ON DELETE CASCADE)
    queries.push(db.deleteFrom("user").where("id", "in", deleteUserIds.slice(i, i + 90)));
  }
  queries.push(
    input.releaseSlug
      ? db.deleteFrom("organization").where("id", "=", org.id)
      : db.updateTable("organization").set({ metadata: JSON.stringify({ offboardedAt: now }) }).where("id", "=", org.id),
  );
  await runBatch(db, queries);
  await appendAudit({ db }, tenantId, {
    userId: PLATFORM_USER_ID,
    action: "clinic.offboard",
    targetType: "organization",
    targetId: org.id,
    detail: { ...counts, usersDeleted: deleteUserIds.length, slugReleased: Boolean(input.releaseSlug) },
  });
  return { ...plan, dryRun: false, exportDir: dir, exportFiles };
}

/* ------------------------------------------------------------------------------------------------
 * Two-step verification reset (a member lost their phone AND their backup codes)
 * ----------------------------------------------------------------------------------------------*/

export interface TwoFactorResetResult {
  userId: string;
  hadTwoFactor: boolean;
  sessionsRevoked: number;
  memberships: string[];
  dryRun: boolean;
}

export async function resetTwoFactor(db: Kysely<Database>, email: string, options: { confirm?: boolean } = {}): Promise<TwoFactorResetResult> {
  const address = normaliseEmail(email);
  const user = await db.selectFrom("user").select(["id", "twoFactorEnabled"]).where("email", "=", address).executeTakeFirst();
  if (!user) throw new RepoInputError("No account with that email address.");
  const sessions = await db.selectFrom("session").select("id").where("userId", "=", user.id).execute();
  const memberships = await db
    .selectFrom("member")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select("organization.slug")
    .where("member.userId", "=", user.id)
    .execute();
  const result: TwoFactorResetResult = {
    userId: user.id,
    hadTwoFactor: authBool(user.twoFactorEnabled),
    sessionsRevoked: sessions.length,
    memberships: memberships.map((m) => m.slug),
    dryRun: !options.confirm,
  };
  if (!options.confirm) return result;
  await runBatch(db, [
    db.deleteFrom("twoFactor").where("userId", "=", user.id),
    db.updateTable("user").set({ twoFactorEnabled: false, updatedAt: new Date().toISOString() }).where("id", "=", user.id),
    db.deleteFrom("session").where("userId", "=", user.id),
  ]);
  for (const m of memberships) {
    await appendAudit({ db }, m.slug, { userId: PLATFORM_USER_ID, action: "auth.two_factor_reset", targetType: "user", targetId: user.id });
  }
  return result;
}
