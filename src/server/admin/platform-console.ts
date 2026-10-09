/**
 * The platform page (/app/platform), for ClinForms staff only: who counts as a platform administrator, the
 * access requests, the clinics with their last recorded activity, and "create a clinic + owner invitation"
 * (the same createClinic() the admin script uses).
 *
 * Every platform action writes an audit row under the pseudo-tenant "platform" (a reserved word: no clinic can
 * have it as its id, so a clinic's activity page never shows these rows), naming the administrator who acted.
 * createClinic() also writes its own "clinic.create" row under the new clinic's id.
 *
 * Pure functions over a database handle (no Next imports): the page's guard and server actions are thin
 * wrappers (./guards.ts and src/app/app/platform/*).
 */
import type { Kysely } from "kysely";
import { isPlatformAdmin } from "../auth/config";
import { createClinic, listClinics, type ClinicSummary, type CreateClinicInput, type CreatedClinic } from "../auth/platform";
import { RESERVED_TENANT_SLUGS } from "../auth/tenant";
import type { Database } from "../db/schema";
import { listAccessRequests, setAccessRequestContacted, type AccessRequest } from "../repos/access-requests";
import { appendAudit, listAudit, type AuditEntry } from "../repos/audit";
import { RepoInputError, type DbContext } from "../repos/context";

export const PLATFORM_PATH = "/app/platform";

/** The audit pseudo-tenant of platform actions (reserved: never a clinic id). */
export const PLATFORM_AUDIT_TENANT = "platform";
if (!RESERVED_TENANT_SLUGS.has(PLATFORM_AUDIT_TENANT)) {
  throw new Error("The platform audit pseudo-tenant must be a reserved clinic id.");
}

/** The parts of a Better Auth session the gate looks at. */
export interface PlatformSessionLike {
  user: { id: string; email: string; name?: string | null; twoFactorEnabled?: boolean | null };
  session: { id: string };
}

export interface PlatformAdmin {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
}

/**
 * A platform administrator: signed in, two-step verification on, and the account's email address listed in
 * CLINFORMS_PLATFORM_ADMINS. Anything else is null – the page answers 404 and the actions do nothing.
 */
export function platformAdminFromSession(
  session: PlatformSessionLike | null | undefined,
  isAdmin: (email: string) => boolean = (email) => isPlatformAdmin(email),
): PlatformAdmin | null {
  if (!session?.user?.id || !session.session?.id) return null;
  if (session.user.twoFactorEnabled !== true) return null;
  if (typeof session.user.email !== "string" || !isAdmin(session.user.email)) return null;
  return { userId: session.user.id, sessionId: session.session.id, email: session.user.email, name: session.user.name ?? session.user.email };
}

export interface PlatformAuditInput {
  /** "platform.<what>" */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function appendPlatformAudit(ctx: DbContext, admin: PlatformAdmin, entry: PlatformAuditInput): Promise<AuditEntry> {
  if (!entry.action.startsWith("platform.")) throw new RepoInputError('Platform audit actions start with "platform.".');
  return appendAudit(ctx, PLATFORM_AUDIT_TENANT, { ...entry, userId: admin.userId, sessionId: admin.sessionId });
}

export async function listPlatformActivity(ctx: DbContext, limit = 20): Promise<AuditEntry[]> {
  return listAudit(ctx, PLATFORM_AUDIT_TENANT, { limit });
}

/* ------------------------------------------------------------------------------------------------
 * Access requests
 * ----------------------------------------------------------------------------------------------*/

export const ACCESS_REQUESTS_SHOWN = 100;

/** Newest first. */
export async function listAccessRequestsForPlatform(ctx: DbContext, limit = ACCESS_REQUESTS_SHOWN): Promise<AccessRequest[]> {
  return listAccessRequests(ctx, { limit });
}

/** Marks a request as contacted (or back to not contacted) and audits it when something changed. */
export async function markAccessRequest(ctx: DbContext, admin: PlatformAdmin, id: string, contacted: boolean): Promise<boolean> {
  const changed = await setAccessRequestContacted(ctx, id, contacted);
  if (changed) {
    await appendPlatformAudit(ctx, admin, {
      action: contacted ? "platform.access_request_contacted" : "platform.access_request_reopened",
      targetType: "access_request",
      targetId: id,
    });
  }
  return changed;
}

/* ------------------------------------------------------------------------------------------------
 * Clinics
 * ----------------------------------------------------------------------------------------------*/

export interface ClinicOverview extends ClinicSummary {
  /** The newest audit entry of the clinic (any member, any action), or null. */
  lastActivityAt: string | null;
}

/**
 * tenant id → time of its newest audit entry. One GROUP BY over the (tenant_id, id) index (ids are ULIDs, so the
 * greatest id is the newest entry), then those rows by primary key.
 */
export async function lastActivityByTenant(db: Kysely<Database>): Promise<Map<string, string>> {
  const newest = await db
    .selectFrom("audit_log")
    .select(["tenant_id", (eb) => eb.fn.max("id").as("last_id")])
    .groupBy("tenant_id")
    .execute();
  const ids = newest.map((r) => String(r.last_id));
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    // D1 allows at most 100 bound parameters per statement
    const rows = await db.selectFrom("audit_log").select(["tenant_id", "at"]).where("id", "in", ids.slice(i, i + 90)).execute();
    for (const row of rows) out.set(row.tenant_id, row.at);
  }
  return out;
}

export async function listClinicsOverview(db: Kysely<Database>, now = new Date()): Promise<ClinicOverview[]> {
  const [clinics, last] = await Promise.all([listClinics(db, now), lastActivityByTenant(db)]);
  return clinics.map((c) => ({ ...c, lastActivityAt: last.get(c.tenantId) ?? null }));
}

/** createClinic() (organization + clinic profile + owner invitation, link returned once), audited as the admin. */
export async function createClinicAsPlatform(db: Kysely<Database>, admin: PlatformAdmin, input: CreateClinicInput): Promise<CreatedClinic> {
  const created = await createClinic(db, input);
  await appendPlatformAudit({ db }, admin, {
    action: "platform.clinic_create",
    targetType: "organization",
    targetId: created.organizationId,
    detail: { tenantId: created.tenantId, emailStatus: created.email.status },
  });
  return created;
}
