/**
 * Who is acting in the clinic system. EVERY clinic-system page, server action and route handler starts here
 * (docs/clinic-system/contract.md §6):
 *
 *   pages / layouts:  const actor = await requireClinicActor({ permission: "patients.view" });
 *   server actions:   const actor = await clinicActionActor({ permission: "patients.edit" });
 *                     if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
 *
 * Both re-read the session from the database (past the 5-minute cookie cache), require two-step verification,
 * membership of the active clinic AND the "clinic" package, then the member's EFFECTIVE permission (role default →
 * clinic override → member exception → locks, read on every request by ./access.ts). Pages answer the 404 page when
 * the package or the permission is missing. The actor also carries the member's site scope (`siteIds`).
 */
import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { GrantedPermission, PmsPermission } from "../../modules/pms/core/permissions";
import type { PmsActor } from "../../modules/pms/core/types";
import { actionContext, type AppContext } from "../auth/session";
import type { MemberRole } from "../auth/roles";
import { getDataCipher } from "../crypto";
import { getDb } from "../db";
import type { RepoContext } from "../repos/context";
import { findPractitionerByUser } from "../repos/pms/directory";
import { resolveMemberAccess } from "./access";
import { hasPackage, requireEntitlement } from "./entitlements";
import { pmsNow } from "../../modules/pms/core/clock";

export interface ClinicActor {
  tenantId: string;
  organizationId: string;
  clinicName: string;
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  role: MemberRole;
  /** Effective permissions ("clinic.view" + the grid's ids); empty when their clinic-system access is off. */
  permissions: readonly GrantedPermission[];
  /** Effective check; old permission ids are accepted as aliases. */
  can: (permission: PmsPermission) => boolean;
  /** The sites the member may see (works at ∪ can see); null = every site. */
  siteIds: ReadonlySet<string> | null;
  /** Who did it, for the repositories' audit rows. */
  actor: PmsActor;
  /** The repositories' context (database + data cipher). */
  repo: () => RepoContext;
}

async function toActor(ctx: AppContext): Promise<ClinicActor> {
  const role = ctx.membership.role;
  const access = await resolveMemberAccess({ db: getDb() }, ctx.membership.tenantId, ctx.session.user.id, role);
  return {
    tenantId: ctx.membership.tenantId,
    organizationId: ctx.membership.organizationId,
    clinicName: ctx.membership.clinicName,
    userId: ctx.session.user.id,
    sessionId: ctx.session.session.id,
    name: ctx.session.user.name,
    email: ctx.session.user.email,
    role,
    permissions: Array.from(access.permissions),
    can: access.can,
    siteIds: access.siteIds,
    actor: { userId: ctx.session.user.id, sessionId: ctx.session.session.id },
    repo: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }),
  };
}

/**
 * The member, read once per request (React's request cache): a page's generateMetadata, its layouts and the page
 * itself share one read, so the permission can be checked in generateMetadata (see ./page-gate.ts) at no extra cost.
 */
const clinicActorForRequest = cache(async (): Promise<ClinicActor> => toActor(await requireEntitlement("clinic")));

/** For pages and layouts under /app/clinic. */
export async function requireClinicActor(options: { permission?: PmsPermission } = {}): Promise<ClinicActor> {
  const actor = await clinicActorForRequest();
  if (!actor.can(options.permission ?? "clinic.view")) notFound();
  return actor;
}

export type ClinicActorError = "signed_out" | "forbidden" | "no_clinic" | "not_entitled";

/** For server actions and route handlers: the actor, or an error code (nothing done). */
export async function clinicActionActor(options: { permission?: PmsPermission } = {}): Promise<ClinicActor | { error: ClinicActorError }> {
  const ctx = await actionContext();
  if ("error" in ctx) return { error: ctx.error };
  if (!(await hasPackage(ctx.membership.tenantId, "clinic"))) return { error: "not_entitled" };
  const actor = await toActor(ctx);
  if (!actor.can(options.permission ?? "clinic.view")) return { error: "forbidden" };
  return actor;
}

/** Plain-English message for an actor error (forms show it). */
export function actorErrorMessage(error: ClinicActorError): string {
  switch (error) {
    case "signed_out":
      return "You have been signed out. Sign in again to carry on.";
    case "no_clinic":
      return "Choose a clinic first.";
    case "not_entitled":
      return "This clinic does not use this part of the system.";
    default:
      return "You do not have permission to do that.";
  }
}

/** HTTP status for an actor error (route handlers). */
export function actorErrorStatus(error: ClinicActorError): number {
  return error === "signed_out" ? 401 : error === "no_clinic" ? 409 : 403;
}

/** The practitioner row of the signed-in member, if they are one (diary "my day", note signing). */
export async function currentPractitionerId(actor: ClinicActor): Promise<string | null> {
  const p = await findPractitionerByUser(actor.repo(), actor.tenantId, actor.userId);
  return p?.id ?? null;
}
