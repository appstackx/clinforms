/**
 * The ClinForms Better Auth instance, built for one database (contract: docs/production-architecture.md §3,
 * runbook: docs/auth.md). `getAuth()` (./auth.ts) builds it once for the app from the environment; tests
 * and scripts call `createAuth()` directly with their own database.
 *
 * - Database: Better Auth's Kysely adapter on our Kysely instance (getDb()).
 *     sqlite / d1 → type "sqlite";  postgres → type "postgres" (+ AuthDateParsePlugin, see pg-dates.ts).
 *     `transaction: false` on every dialect: D1 has NO interactive transactions (the gateway refuses them),
 *     and the same behaviour everywhere keeps local runs and tests honest. Better Auth then runs its
 *     multi-step writes one statement at a time (each one atomic).
 * - Email + password, 12–128 characters; invite-only (a user can only be created for an email address
 *   with an open invitation); password reset by link.
 * - Two-step verification (TOTP) is REQUIRED: the /app layout sends anyone without it to /two-factor; it
 *   cannot be turned off (the disable endpoint is switched off); no "trusted devices".
 * - Organization = clinic (slug = tenantId, immutable); roles owner / admin / clinician / staff;
 *   invitations; clinics are created by the platform only (scripts/admin/create-clinic.ts).
 * - Rate limits stored in the database (shared by every server instance), cookie prefix "clinforms",
 *   secure cookies on https, session cookie cache 5 minutes.
 * - Every membership / security change writes an audit_log row (ids only, never patient data).
 */
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import type { Kysely } from "kysely";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../lib/account-copy";
import type { Database } from "../db/schema";
import { deliverEmail, invitationEmail, passwordResetEmail, twoFactorEnabledEmail } from "../email";
import { logAuthEvent } from "../email/log";
import { appendAudit } from "../repos/audit";
import { deleteMemberProfile } from "../repos/member-profile";
import { appOrigin, betterAuthBaseURL, isPlatformAdmin, usesSecureCookies, type BaseUrlSetting } from "./config";
import { inviteLink } from "./invite-token";
import { AuthDateParsePlugin } from "./pg-dates";
import { MEMBER_ROLES, accessControl, parseMemberRole, roles } from "./roles";
import { assertTenantSlug } from "./tenant";

export type AuthDialect = "sqlite" | "d1" | "postgres";

/**
 * Audit rows record this one-way reference to an invitation ("inv_" + 16 characters of its id's SHA-256):
 * enough to match rows to each other. (The link itself is `<id>.<MAC>` – see ./invite-token.ts – so an id
 * alone does not accept an invitation either.)
 */
export function invitationRef(invitationId: string): string {
  return `inv_${createHash("sha256").update(invitationId, "utf8").digest("base64url").slice(0, 16)}`;
}

export const INVITATION_TTL_SECONDS = 7 * 24 * 3600;
export const RESET_TOKEN_TTL_SECONDS = 2 * 3600;
export const SESSION_TTL_SECONDS = 12 * 3600;
export const COOKIE_PREFIX = "clinforms";
export const TWO_FACTOR_ISSUER = "ClinForms";
/** The platform's own user: the inviter of record for clinics set up by the platform. It has no password. */
export const PLATFORM_USER_ID = "clinforms-platform";
export const PLATFORM_USER_EMAIL = "platform@clinforms.invalid";

/** HTTP paths of Better Auth endpoints that ClinForms does not offer (server code still calls some of them). */
export const DISABLED_PATHS = [
  "/sign-up/email", // invite-only: accounts are created by /accept-invite (server action)
  "/two-factor/disable", // two-step verification is required
  "/organization/create", // clinics are created by the platform
  "/organization/delete", // offboarding is a platform task (scripts/admin/offboard-clinic.ts)
  "/organization/update", // via Settings → Clinic (server action), slug immutable
  "/organization/check-slug",
  "/delete-user",
  "/change-email",
  // Both list a clinic's pending invitations (ids included) to ANY member, whatever the role. ClinForms shows
  // open invitations to owners and administrators only, server-side (Settings → Members).
  "/organization/list-invitations",
  "/organization/get-full-organization",
];

/** Successful calls to these paths are audited by the after hook (it knows the acting member). */
const AFTER_AUDITED_PATHS = new Set([
  "/two-factor/generate-backup-codes",
  "/organization/update-member-role",
  "/organization/remove-member",
  "/revoke-session",
  "/revoke-other-sessions",
  "/revoke-sessions",
]);

/** Clinic-management endpoints refused (403 TWO_FACTOR_REQUIRED) to a session without two-step verification. */
const TWO_FACTOR_GUARDED_PATHS = new Set([
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/add-member",
  "/organization/update",
]);

export interface CreateAuthInput {
  db: Kysely<Database>;
  dialect: AuthDialect;
  secret: string;
  baseUrl: BaseUrlSetting;
  /** The request headers of the current server action / request, when there is one (for link origins). */
  currentHeaders?: () => Promise<Headers | null>;
  /** Default true. Tests turn it off unless they test it. */
  rateLimit?: boolean;
  /** Better Auth's start-up schema check. Default: on, except on D1 (see below). */
  validateSchema?: boolean;
  /**
   * Whether an address belongs to a platform administrator (/app/platform). Default: isPlatformAdmin() on
   * CLINFORMS_PLATFORM_ADMINS. While email is off, a clinic administrator is shown the invitation links they
   * create, so an invitation from a clinic could otherwise create an account for a platform administrator's
   * address: such an account can only come from a platform invitation (createClinic), and clinics cannot invite
   * the address while it has no account.
   */
  isPlatformAdminEmail?: (email: string) => boolean;
}

type AnyCtx = { path?: string; body?: Record<string, unknown> } | null | undefined;

/** Rows Better Auth hands to hooks (dates may be Date objects or ISO strings). */
function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function createAuth(input: CreateAuthInput) {
  const { db, dialect } = input;
  const dbCtx = { db };
  const platformAdminEmail = input.isPlatformAdminEmail ?? ((email: string) => isPlatformAdmin(email));
  const slugCache = new Map<string, string>();
  /** Endpoint contexts in which two-step verification was just turned on (user.update → session.create). */
  const enablingContexts = new WeakSet<object>();
  /** member id → role before an update, from the organization hook to the after hook of the same request. */
  const previousRoles = new Map<string, string>();

  async function tenantOf(organizationId: string | null | undefined): Promise<string | null> {
    if (!organizationId) return null;
    const cached = slugCache.get(organizationId);
    if (cached) return cached;
    const row = await db.selectFrom("organization").select("slug").where("id", "=", organizationId).executeTakeFirst();
    if (row) slugCache.set(organizationId, row.slug);
    return row?.slug ?? null;
  }

  async function audit(
    organizationId: string | null | undefined,
    entry: { userId?: string | null; sessionId?: string | null; action: string; targetType?: string; targetId?: string; detail?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const tenantId = await tenantOf(organizationId);
      if (!tenantId) return;
      await appendAudit(dbCtx, tenantId, entry);
    } catch (err) {
      logAuthEvent("audit.write_failed", { action: entry.action, error: err instanceof Error ? err.name : "error" });
    }
  }

  async function auditForUser(userId: string, entry: { sessionId?: string | null; action: string; detail?: Record<string, unknown> }): Promise<void> {
    const memberships = await db.selectFrom("member").select("organizationId").where("userId", "=", userId).execute();
    for (const m of memberships) await audit(m.organizationId, { userId, targetType: "user", targetId: userId, ...entry });
  }

  async function origin(request?: Request | null): Promise<string> {
    if (request) return appOrigin(input.baseUrl, request.headers);
    const headers = input.currentHeaders ? await input.currentHeaders().catch(() => null) : null;
    return appOrigin(input.baseUrl, headers);
  }

  function requireClinicRole(role: unknown): void {
    if (!parseMemberRole(role)) {
      throw new APIError("BAD_REQUEST", { message: `Role must be one of ${MEMBER_ROLES.join(", ")}.`, code: "INVALID_ROLE" });
    }
  }

  const kysely = dialect === "postgres" ? db.withPlugin(new AuthDateParsePlugin()) : db;

  return betterAuth({
    appName: "ClinForms",
    secret: input.secret,
    baseURL: betterAuthBaseURL(input.baseUrl),
    // transaction: false on EVERY dialect – D1 has none, and on SQLite/Postgres our hooks (invite-only check,
    // active clinic, audit) query through the shared Kysely instance: inside a Better Auth transaction that
    // deadlocks a single connection and can exhaust a small Postgres pool. Each statement is still atomic.
    database: { db: kysely, type: dialect === "postgres" ? "postgres" : "sqlite", transaction: false },
    disabledPaths: DISABLED_PATHS,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }, request) {
        const link = `${await origin(request)}/reset-password?token=${encodeURIComponent(token)}`;
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000).toISOString();
        await deliverEmail(passwordResetEmail({ to: { email: user.email, name: user.name }, link, expiresAt }));
      },
      async onPasswordReset({ user }) {
        await auditForUser(user.id, { action: "auth.password_reset" });
      },
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 3600,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      enabled: input.rateLimit ?? true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
        "/organization/accept-invitation": { window: 60, max: 10 },
      },
    },
    advanced: {
      // Better Auth checks the live schema at start-up by introspection. On real D1 that cannot work through
      // the gateway (D1 refuses pragma_table_info on its internal _cf_KV table, and the gateway refuses PRAGMA),
      // so it is off there. The schema is guarded by the committed migrations instead: auth.test.ts proves
      // Better Auth wants nothing more from them, and the local-D1 run keeps the check on.
      database: { validateSchema: input.validateSchema ?? dialect !== "d1" },
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: usesSecureCookies(input.baseUrl),
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    },
    databaseHooks: {
      user: {
        create: {
          // Invite-only: an account can only be created for an email address with an open invitation.
          async before(user) {
            const email = String(user.email ?? "").trim().toLowerCase();
            const now = new Date().toISOString();
            const open = await db
              .selectFrom("invitation")
              .select(["id", "inviterId"])
              .where("email", "=", email)
              .where("status", "=", "pending")
              .where("expiresAt", ">", now)
              .execute();
            if (open.length === 0) {
              logAuthEvent("auth.sign_up_refused", { reason: "no_invitation" });
              throw new APIError("FORBIDDEN", { message: "An invitation is needed to create an account.", code: "INVITATION_REQUIRED" });
            }
            // A platform administrator's account only from platform invitations (none from a clinic still open).
            if (platformAdminEmail(email) && open.some((inv) => inv.inviterId !== PLATFORM_USER_ID)) {
              logAuthEvent("auth.sign_up_refused", { reason: "platform_admin_address" });
              throw new APIError("FORBIDDEN", { message: "This address can only be set up from a ClinForms invitation.", code: "PLATFORM_INVITATION_REQUIRED" });
            }
            // The invitation link was sent to (or passed on for) this address.
            return { data: { ...user, email, emailVerified: true } };
          },
        },
        update: {
          async after(user, ctx) {
            const c = ctx as AnyCtx;
            if (c?.path === "/two-factor/verify-totp" && user.twoFactorEnabled === true) {
              // Turned on just now (the only update on this path). Sessions that never passed the second
              // factor must not live on: revoke them all – Better Auth issues the new session right after.
              enablingContexts.add(c as object);
              await db.deleteFrom("session").where("userId", "=", user.id).execute();
              await auditForUser(user.id, { action: "auth.two_factor_enable" });
              await deliverEmail(twoFactorEnabledEmail({ to: { email: user.email, name: user.name }, at: new Date().toISOString() }));
            }
          },
        },
      },
      session: {
        create: {
          // A new session opens the member's most recent clinic, so /app works straight after sign-in.
          async before(session) {
            if (session.activeOrganizationId) return;
            const m = await db
              .selectFrom("member")
              .select("organizationId")
              .where("userId", "=", session.userId)
              .orderBy("createdAt", "desc")
              .limit(1)
              .executeTakeFirst();
            if (!m) return;
            return { data: { ...session, activeOrganizationId: m.organizationId } };
          },
          async after(session, ctx) {
            const c = ctx as AnyCtx;
            const path = c?.path;
            if ((path === "/two-factor/verify-totp" || path === "/two-factor/verify-backup-code") && !enablingContexts.has(c as object)) {
              await audit(session.activeOrganizationId as string | null, {
                userId: session.userId,
                sessionId: session.id,
                action: "auth.sign_in",
                targetType: "user",
                targetId: session.userId,
                detail: { method: path.endsWith("backup-code") ? "backup_code" : "totp" },
              });
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (TWO_FACTOR_GUARDED_PATHS.has(ctx.path)) {
          // Clinic management needs a member who has finished setting up two-step verification.
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session && session.user.twoFactorEnabled !== true) {
            throw new APIError("FORBIDDEN", { message: "Set up two-step verification first.", code: "TWO_FACTOR_REQUIRED" });
          }
        }
        if ((ctx.path === "/two-factor/verify-totp" || ctx.path === "/two-factor/verify-backup-code") && ctx.body?.trustDevice) {
          throw new APIError("BAD_REQUEST", { message: "Trusted devices are not offered: enter a code each time.", code: "TRUST_DEVICE_DISABLED" });
        }
        if (ctx.path === "/two-factor/enable" && ctx.body?.method && ctx.body.method !== "totp") {
          throw new APIError("BAD_REQUEST", { message: "Use an authenticator app.", code: "TOTP_ONLY" });
        }
      }),
      // Audit rows that need the acting member (Better Auth's organization hooks only name the target).
      after: createAuthMiddleware(async (ctx) => {
        if (!AFTER_AUDITED_PATHS.has(ctx.path)) return;
        const returned = ctx.context.returned;
        if (returned === undefined || returned === null || isAPIError(returned) || returned instanceof Error) return;
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx).catch(() => null));
        if (!session) return;
        const base = { userId: session.user.id, sessionId: session.session.id };
        const activeOrg = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
        if (ctx.path === "/two-factor/generate-backup-codes") {
          await audit(activeOrg, { ...base, action: "auth.backup_codes_regenerate", targetType: "user", targetId: session.user.id });
        } else if (ctx.path === "/organization/update-member-role") {
          const member = returned as { id: string; organizationId: string; role: string };
          const previous = previousRoles.get(member.id);
          previousRoles.delete(member.id);
          await audit(member.organizationId, {
            ...base,
            action: "member.role_change",
            targetType: "member",
            targetId: member.id,
            detail: { from: previous ?? null, to: member.role },
          });
        } else if (ctx.path === "/organization/remove-member") {
          const member = (returned as { member?: { id: string; organizationId: string; role: string } }).member;
          if (member) {
            await audit(member.organizationId, { ...base, action: "member.remove", targetType: "member", targetId: member.id, detail: { role: member.role } });
          }
        } else {
          await audit(activeOrg, { ...base, action: "auth.session_revoke", targetType: "user", targetId: session.user.id, detail: { scope: ctx.path.slice(1) } });
        }
      }),
    },
    plugins: [
      twoFactor({
        issuer: TWO_FACTOR_ISSUER,
        skipVerificationOnEnable: false,
        backupCodeOptions: { amount: 10, length: 10 },
        twoFactorCookieMaxAge: 600,
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
      }),
      organization({
        ac: accessControl,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITATION_TTL_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: false,
        invitationLimit: 100,
        membershipLimit: 500,
        async sendInvitationEmail(data, request) {
          const inviterName = data.inviter.user.id === PLATFORM_USER_ID ? null : data.inviter.user.name;
          const link = inviteLink(await origin(request), data.id, input.secret);
          await deliverEmail(
            invitationEmail({
              to: { email: data.email },
              clinicName: data.organization.name,
              role: data.role,
              inviterName,
              link,
              expiresAt: isoOf(data.invitation.expiresAt),
            }),
          );
        },
        organizationHooks: {
          async beforeCreateOrganization({ organization: org }) {
            assertTenantSlug(String(org.slug ?? ""));
          },
          async beforeUpdateOrganization({ organization: org, member }) {
            if (org.slug === undefined) return;
            const current = await tenantOf(member.organizationId);
            if (org.slug !== current) {
              throw new APIError("BAD_REQUEST", { message: "A clinic's id cannot be changed.", code: "SLUG_IMMUTABLE" });
            }
          },
          async beforeCreateInvitation({ invitation }) {
            requireClinicRole(invitation.role);
            const email = String(invitation.email ?? "").trim().toLowerCase();
            if (platformAdminEmail(email) && !(await db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst())) {
              throw new APIError("FORBIDDEN", { message: "This address cannot be invited from a clinic.", code: "PLATFORM_ADMIN_ADDRESS" });
            }
          },
          async beforeUpdateMemberRole({ newRole }) {
            requireClinicRole(newRole);
          },
          async beforeAddMember({ member }) {
            requireClinicRole(member.role);
          },
          async afterCreateInvitation({ invitation, inviter }) {
            await audit(invitation.organizationId, {
              userId: inviter.id,
              action: "member.invite",
              targetType: "invitation",
              targetId: invitationRef(invitation.id),
              detail: { role: invitation.role },
            });
          },
          async afterCancelInvitation({ invitation, cancelledBy }) {
            await audit(invitation.organizationId, {
              userId: cancelledBy.id,
              action: "member.invite_cancel",
              targetType: "invitation",
              targetId: invitationRef(invitation.id),
            });
          },
          async afterAcceptInvitation({ invitation, member, user }) {
            await audit(invitation.organizationId, {
              userId: user.id,
              action: "member.join",
              targetType: "member",
              targetId: member.id,
              detail: { role: member.role, invitation: invitationRef(invitation.id) },
            });
          },
          async afterUpdateMemberRole({ member, previousRole }) {
            previousRoles.set(member.id, previousRole); // read by the after hook, which knows who did it
          },
          async afterRemoveMember({ member }) {
            await deleteMemberProfile(dbCtx, member.organizationId, member.userId).catch(() => false);
          },
        },
      }),
      nextCookies(), // must stay last: copies Set-Cookie into Next's cookie store for server actions
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
