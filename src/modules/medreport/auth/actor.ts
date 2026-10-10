import "server-only";

/**
 * Who is calling the Report API (wave 2, docs/production-architecture.md §3).
 *
 *   requireActor(req, deps, {roles?, scope?, connectorId?}) → Actor, or throws an HttpError:
 *     401 UNAUTHORIZED / TOKEN_EXPIRED / TOKEN_INVALID   no caller
 *     403 TWO_FACTOR_REQUIRED                            a signed-in member without two-step verification
 *     403 DEMO_DISABLED                                  a demo session while CLINFORMS_PUBLIC_DEMO=0
 *     403 ROLE_NOT_ALLOWED                               the member's role is not in `roles`
 *     403 SESSION_MISMATCH                               a launch session for another episode / connector
 *
 * Two kinds of caller:
 * 1. A signed-in clinic member ("user"): the HOST works it out (MedreportDeps.authenticate – Better Auth
 *    session read from the database, active clinic, role, member profile). It acts for its own clinic
 *    (tenantId = the clinic's slug). A launch session of THE SAME clinic sent alongside (Bearer, from
 *    POST /launch/verify) narrows it to that patient's episode ("user+launch"). Any other session token
 *    (a demo session, another clinic's launch, an expired one) is ignored: a signed-in member's request
 *    is never handled as the demo.
 * 2. The public demo ("demo", tenant "demo", fictional data): ONLY through the existing demo / launch
 *    session tokens (POST /sessions/demo, POST /launch/verify with the demo partner key) and only while
 *    CLINFORMS_PUBLIC_DEMO is not "0". A request from the public demo's own pages (/reports,
 *    /pms-sandbox – same-origin Referer) that carries a demo session is the demo even when the browser
 *    also holds a clinic sign-in: the demo tenant grants nothing an anonymous visitor could not get, and
 *    a clinic member can still try the demo in the browser they work in.
 *
 * Tenant checks (assertActorTenant): every form, report, bundle and receipt a request carries must belong
 * to the actor's tenant (403 TENANT_MISMATCH).
 *
 * Owner: API slice (wave 2).
 */
import { DEMO_TENANT_ID } from "../config.public";
import { allowedRequestOrigins, publicDemoEnabled } from "../config.server";
import type { AuditEvent, AuthContext, ClinicProfile, MedreportDeps, MemberRole } from "../api/deps";
import { HttpError, getBearerToken, logEvent } from "../api/http";
import type { Clinician, ConnectorId, SessionClaims, TenantId } from "../core/types";
import { WORDING } from "../core/wording";
import { verifySessionToken } from "./session-token";
import type { TokenVerifyResult } from "./hmac-token";

export type ActorVia = "user" | "user+launch" | "demo";

/** The one episode a launch-bound actor may read and write. */
export interface ActorScope {
  connectorId: ConnectorId;
  patientId: string;
  episodeId: string;
}

export interface Actor {
  tenantId: TenantId;
  /** The signed-in member (via "user" / "user+launch"). */
  userId?: string;
  /** The sign-in session's id (user) or the session token's id (demo). Not a secret. */
  sid: string;
  via: ActorVia;
  /** The member's role; the demo acts as a "clinician". */
  role: MemberRole;
  /** The member's display name (user). */
  name?: string;
  /**
   * user: the signer identity from the member's clinic profile. demo: the clinician a launch session was
   * opened for (clinic system), if any.
   */
  clinician?: { name: string; hcpc?: string; jobTitle?: string; canSign: boolean };
  /** Set when a launch session binds the caller to one patient's episode. */
  scope?: ActorScope;
  /** The session token's claims (demo; or the launch session of a "user+launch" actor). */
  session?: SessionClaims;
}

export interface RequireActorOptions {
  /** Roles allowed (default: any). The demo acts as "clinician". */
  roles?: readonly MemberRole[];
  /** The action refused to other roles, for the problem detail (e.g. "confirm form mappings"). */
  action?: string;
  /** The episode the request reads or writes: a launch-bound actor must match it (403 SESSION_MISMATCH). */
  scope?: ActorScope;
  /** The connector the request uses: a session bound to another connector → 403 SESSION_MISMATCH. */
  connectorId?: ConnectorId;
}

/** Every role a clinic has; staff prepare drafts but never approve or confirm. */
export const ALL_ROLES: readonly MemberRole[] = ["owner", "admin", "clinician", "staff"];
/** Roles that may confirm a form map (checked once, reused for every patient). */
export const CONFIRM_ROLES: readonly MemberRole[] = ["owner", "admin", "clinician"];
/** Roles that may approve (sign) – with an HCPC number and "may sign" on the member profile. */
export const SIGN_ROLES: readonly MemberRole[] = ["owner", "admin", "clinician"];
/** Roles that manage the clinic's records (fix wave 2: delete an approved report). */
export const MANAGE_ROLES: readonly MemberRole[] = ["owner", "admin"];

/** The public demo's own pages: a request from one of them carrying a demo session is the demo. */
const PUBLIC_DEMO_PATHS = ["/reports", "/pms-sandbox"];

/** Whether the request comes from one of the public demo's pages on this site (same-origin Referer). */
export function isPublicDemoPageRequest(req: Request): boolean {
  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    const url = new URL(referer);
    if (allowedRequestOrigins(req).indexOf(url.origin.toLowerCase()) < 0) return false;
    return PUBLIC_DEMO_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  } catch {
    return false;
  }
}

function verifyBearer(token: string): TokenVerifyResult<SessionClaims> {
  try {
    return verifySessionToken(token);
  } catch (err) {
    // The session secret is not configured (live mode): the token cannot be checked.
    logEvent("session_token_unverifiable", { error: err instanceof Error ? err.name : "error" });
    return { ok: false, reason: "bad_signature" };
  }
}

function memberActor(member: AuthContext, claims: SessionClaims | null): Actor {
  if (!member.twoFactorVerified) {
    throw new HttpError(403, WORDING.server.access.twoFactorTitle, { code: "TWO_FACTOR_REQUIRED", detail: WORDING.server.access.twoFactorDetail });
  }
  // A launch session of the member's own clinic narrows the member to that episode; anything else is ignored.
  const launch =
    claims && claims.kind === "launch" && claims.tenantId === member.tenantId && claims.connectorId && claims.patientId && claims.episodeId
      ? claims
      : null;
  return {
    tenantId: member.tenantId,
    userId: member.userId,
    sid: member.authSessionId,
    via: launch ? "user+launch" : "user",
    role: member.role,
    ...(member.name || member.clinician?.name ? { name: member.name ?? member.clinician?.name } : {}),
    ...(member.clinician ? { clinician: { ...member.clinician } } : {}),
    ...(launch
      ? {
          scope: { connectorId: launch.connectorId as ConnectorId, patientId: launch.patientId as string, episodeId: launch.episodeId as string },
          session: launch,
        }
      : {}),
  };
}

function demoActor(claims: SessionClaims): Actor {
  const scope =
    claims.kind === "launch" && claims.connectorId && claims.patientId && claims.episodeId
      ? { connectorId: claims.connectorId, patientId: claims.patientId, episodeId: claims.episodeId }
      : undefined;
  return {
    tenantId: DEMO_TENANT_ID,
    sid: claims.sid,
    via: "demo",
    role: "clinician",
    ...(claims.clinician
      ? { clinician: { name: claims.clinician.name, hcpc: claims.clinician.hcpc, ...(claims.clinician.role ? { jobTitle: claims.clinician.role } : {}), canSign: true } }
      : {}),
    ...(scope ? { scope } : {}),
    session: claims,
  };
}

/**
 * The caller, without role or scope checks. Throws the 401/403 of requireActor() when there is none;
 * see the header for the rules.
 */
export async function resolveActor(req: Request, deps: MedreportDeps): Promise<Actor> {
  const token = getBearerToken(req);
  const verified = token ? verifyBearer(token) : null;
  const claims = verified && verified.ok ? verified.claims : null;

  // The public demo's own pages with a demo session: the demo (never the clinic sign-in in the same browser).
  const demoPage = claims !== null && claims.tenantId === DEMO_TENANT_ID && isPublicDemoPageRequest(req);
  const member = !demoPage && deps.authenticate ? await deps.authenticate(req) : null;
  if (member) return memberActor(member, claims);

  if (!token) {
    throw new HttpError(401, WORDING.server.access.signInTitle, {
      code: "UNAUTHORIZED",
      detail: WORDING.server.access.signInDetail,
      headers: { "www-authenticate": 'Bearer realm="appstackx-reports"' },
    });
  }
  if (!verified || !verified.ok || !claims) {
    const expired = verified?.ok === false && verified.reason === "expired";
    throw new HttpError(401, expired ? "Session expired" : "Session token invalid", {
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      detail: expired
        ? "The session has expired (sessions last 1 hour). Start again from the clinic system or the Studio."
        : "The session token could not be verified.",
      headers: { "www-authenticate": `Bearer realm="appstackx-reports", error="invalid_token"` },
    });
  }
  if (claims.tenantId !== DEMO_TENANT_ID) {
    // A clinic's launch session only works together with that clinic's signed-in member.
    throw new HttpError(401, WORDING.server.access.signInTitle, { code: "UNAUTHORIZED", detail: WORDING.server.access.clinicSignInDetail });
  }
  if (!publicDemoEnabled()) {
    throw new HttpError(403, WORDING.server.access.demoOffTitle, { code: "DEMO_DISABLED", detail: WORDING.server.access.demoOffDetail });
  }
  return demoActor(claims);
}

/** The caller, or null when there is none (public endpoints that answer differently for callers). */
export async function optionalActor(req: Request, deps: MedreportDeps): Promise<Actor | null> {
  try {
    return await resolveActor(req, deps);
  } catch {
    return null;
  }
}

/** The caller (see the header), checked against `roles`, `connectorId` and `scope`. */
export async function requireActor(req: Request, deps: MedreportDeps, opts: RequireActorOptions = {}): Promise<Actor> {
  const actor = await resolveActor(req, deps);
  if (opts.roles && opts.roles.indexOf(actor.role) < 0) {
    throw new HttpError(403, WORDING.server.access.roleTitle, {
      code: "ROLE_NOT_ALLOWED",
      detail: WORDING.server.access.role(opts.action ?? "do this"),
    });
  }
  if (opts.connectorId) assertActorConnector(actor, opts.connectorId);
  if (opts.scope) assertActorEpisode(actor, opts.scope);
  return actor;
}

/** 403 SESSION_MISMATCH when the actor's session is bound to another connector. */
export function assertActorConnector(actor: Actor, connectorId: ConnectorId): void {
  const bound = actor.scope?.connectorId ?? actor.session?.connectorId;
  if (bound && bound !== connectorId) {
    throw new HttpError(403, "Session does not cover this connector", {
      code: "SESSION_MISMATCH",
      detail: `This session was issued for the ${bound} connector.`,
    });
  }
}

/** 403 SESSION_MISMATCH when a launch-bound actor asks for another episode (or connector). */
export function assertActorEpisode(actor: Actor, ref: ActorScope): void {
  assertActorConnector(actor, ref.connectorId);
  if (actor.scope && (actor.scope.patientId !== ref.patientId || actor.scope.episodeId !== ref.episodeId)) {
    throw new HttpError(403, "Session does not cover this episode", {
      code: "SESSION_MISMATCH",
      detail: "This session was opened from the clinic system for a different patient or episode.",
    });
  }
}

/** Whether the actor may read or write this episode (launch scope and connector binding). */
export function actorCoversEpisode(actor: Actor, ref: ActorScope): boolean {
  try {
    assertActorEpisode(actor, ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * 403 TENANT_MISMATCH unless `tenantId` (of a form, report, bundle or receipt the request carries) is the
 * actor's own clinic. `what` names it in the problem detail ("form", "report", "patient record", "approval").
 */
export function assertActorTenant(actor: Actor, tenantId: string | undefined | null, what: string): void {
  if (tenantId !== actor.tenantId) {
    throw new HttpError(403, WORDING.server.access.otherClinicTitle, { code: "TENANT_MISMATCH", detail: WORDING.server.access.otherClinic(what) });
  }
}

/**
 * The signer identity of a signed-in member who may approve: role owner/admin/clinician, an HCPC number and
 * "may sign" on the member profile (403 SIGNER_NOT_ALLOWED otherwise). Not for the demo.
 */
export function memberSigner(actor: Actor): Clinician {
  const c = actor.clinician;
  if (actor.via === "demo" || SIGN_ROLES.indexOf(actor.role) < 0 || !c || !c.canSign || !c.hcpc || !c.name) {
    throw new HttpError(403, WORDING.server.access.cannotSignTitle, { code: "SIGNER_NOT_ALLOWED", detail: WORDING.server.access.cannotSignDetail });
  }
  return { name: c.name, hcpc: c.hcpc, ...(c.jobTitle ? { role: c.jobTitle } : {}) };
}

/** A clinic actor's clinic profile (null for the demo, without deps.clinicProfile, or when it cannot be read). */
export async function clinicProfileOf(deps: MedreportDeps, actor: Actor): Promise<ClinicProfile | null> {
  if (actor.via === "demo" || !deps.clinicProfile) return null;
  try {
    return await deps.clinicProfile(actor.tenantId);
  } catch (err) {
    logEvent("clinic_profile_unavailable", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Audit trail (tenant actors only; never patient data)
 * ----------------------------------------------------------------------------------------------*/

export const AUDIT_ACTIONS = {
  formConfirm: "form.confirm",
  formAnalyseLive: "form.analyse_live",
  draftLive: "report.draft_live",
  sign: "report.sign",
  renderFinal: "report.render_final",
  fileBack: "report.file_back",
  /** For the server store's endpoints (report deletion / export). */
  reportDelete: "report.delete",
  reportExport: "report.export",
  launchIssue: "launch.issue",
} as const;

/** The first characters of a receipt MAC: enough to match audit rows to receipts, useless to forge one. */
export function macPrefix(mac: string | undefined | null): string | null {
  return mac ? mac.slice(0, 12) : null;
}

/**
 * Append an audit row for a clinic's actor (no-op for the demo, or without deps.audit). Best effort: a
 * failed write is logged (ids only) and never fails the request – the receipt and logs remain.
 */
export async function auditActor(deps: MedreportDeps, actor: Actor, event: Omit<AuditEvent, "userId" | "sessionId">): Promise<void> {
  if (actor.via === "demo" || !deps.audit) return;
  try {
    await deps.audit(actor.tenantId, { ...event, userId: actor.userId ?? null, sessionId: actor.sid });
  } catch (err) {
    logEvent("audit_write_failed", { action: event.action, error: err instanceof Error ? err.name : "error" });
  }
}
