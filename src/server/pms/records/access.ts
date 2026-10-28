/**
 * The records module's server layer (src/server/pms/records/*-service.ts) – what the screens' server actions, route
 * handlers and server components call. Every service function:
 *
 *   1. checks the member's permission FIRST (core/permissions.ts), before anything is read – so a member without it
 *      learns nothing, not even whether the record exists (reception/staff never reach clinical content);
 *   2. reads the patient (and the case, note, file… of the request) from the member's OWN clinic only and checks it
 *      belongs to that patient – ids from the request are never trusted;
 *   3. validates the input with the module's zod schemas (the repositories validate again);
 *   4. answers a Result: { ok: true, value } or { ok: false, code, error } with a plain message that never holds
 *      patient data or a database message (unexpected errors are logged by name only).
 *
 * The actor is the page's / action's ClinicActor (src/server/pms/actor.ts) – the service only needs the parts below,
 * so tests build one for any role without a session.
 */
import { canWith, effectivePermissions, type PermissionChoices, type PmsPermission, type PmsRole } from "../../../modules/pms/core/permissions";
import type { Patient, PmsActor, PmsSaveResult } from "../../../modules/pms/core/types";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { logAuthEvent } from "../../email/log";
import { RepoInputError, type RepoContext } from "../../repos/context";
import { findPractitionerByUser } from "../../repos/pms/directory";
import { getPatient } from "../../repos/pms/patients";
import { patientVisibleInScope } from "../access";
import { isLockedError, type NoteAuthor } from "../../repos/pms/records/notes";
import type { ClinicActor } from "../actor";

export type RecordsActor = Pick<ClinicActor, "tenantId" | "userId" | "name" | "email" | "can" | "actor" | "repo"> &
  Partial<Pick<ClinicActor, "siteIds">> & {
    /** The member's role (amending others' signed notes is for owners and admins only). */
    role?: string;
  };

/** "registration": signing or amending a clinical note without a registration number on the member's profile. */
export type FailureCode = "forbidden" | "not_found" | "invalid" | "conflict" | "locked" | "registration" | "error";

export interface Failure {
  ok: false;
  code: FailureCode;
  error: string;
  fieldErrors?: Record<string, string>;
  /** The record's current revision (conflict), or the revision a partly done save reached. */
  rev?: number;
}

export type Result<T> = { ok: true; value: T } | Failure;

export const FORBIDDEN_MESSAGE = "You do not have permission to do that.";
export const NOT_FOUND_MESSAGE = "This record no longer exists in this clinic.";
export const CONFLICT_MESSAGE = "Someone else changed this record while you were editing it. Reload the page to see their changes, then make yours again.";
export const LOCKED_MESSAGE = "This note is signed and locked. Add an amendment instead.";
export const ERROR_MESSAGE = "Something went wrong. Please try again.";
/**
 * Khuram's decision 28/10/2026: a clinical note is signed (and amended) only by a member with a registration number
 * on their practitioner profile – shown on Member access (Set-up → Staff access → the member).
 */
export const REGISTRATION_NEEDED_MESSAGE =
  "Add your registration number to sign notes. It is kept on your practitioner profile (Set-up → Staff access → your name): ask the clinic owner or an administrator to add it.";

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail(code: FailureCode, error: string, extra: Partial<Pick<Failure, "fieldErrors" | "rev">> = {}): Failure {
  return { ok: false, code, error, ...extra };
}

export const forbidden = (): Failure => fail("forbidden", FORBIDDEN_MESSAGE);
export const notFound = (): Failure => fail("not_found", NOT_FOUND_MESSAGE);

/** null when the actor holds every permission named; otherwise the refusal. */
export function guard(actor: RecordsActor, ...permissions: PmsPermission[]): Failure | null {
  return permissions.every((p) => actor.can(p)) ? null : forbidden();
}

/** A revisioned save that did not happen, as a failure. */
export function saveFailure(result: Exclude<PmsSaveResult, { ok: true }>): Failure {
  return result.reason === "conflict" ? fail("conflict", CONFLICT_MESSAGE, { rev: result.currentRev }) : notFound();
}

/**
 * Turns a thrown error into a plain failure: a repository's input error keeps its (plain, data-free) message without
 * the "Thing: field:" prefix; the lock trigger becomes the lock message; anything else is logged by name only.
 */
export function failureFrom(err: unknown, what: string): Failure {
  if (err instanceof RepoInputError) {
    return fail("invalid", err.message.replace(/^[A-Z][A-Za-z ]*: [a-z][A-Za-z0-9.]*: /, "").replace(/; [a-z][A-Za-z0-9.]*: /g, "; "));
  }
  if (isLockedError(err)) return fail("locked", LOCKED_MESSAGE);
  logAuthEvent("pms.records_service_failed", { what, error: err instanceof Error ? err.name : "error" });
  return fail("error", ERROR_MESSAGE);
}

/** Runs `work`, answering its value or a plain failure. */
export async function attempt<T>(what: string, work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (err) {
    return failureFrom(err, what);
  }
}

/**
 * The patient of a request in the actor's clinic (null = not in this clinic, not a plausible id, or outside the
 * member's sites – K2-SITE-004, src/server/pms/access.ts: answered exactly like "no such patient").
 */
export async function patientInClinic(actor: RecordsActor, patientId: unknown): Promise<Patient | null> {
  if (!isPlausibleRecordId(patientId)) return null;
  const scope = actor.siteIds ?? null;
  if (scope !== null && !(await patientVisibleInScope(actor.repo(), actor.tenantId, patientId, scope))) return null;
  return getPatient(actor.repo(), actor.tenantId, patientId);
}

/** The member as a note's author or signer: their name and, when they are a practitioner, the registration number. */
export async function noteAuthorOf(actor: RecordsActor): Promise<NoteAuthor & { practitionerId: string | null }> {
  const practitioner = await findPractitionerByUser(actor.repo(), actor.tenantId, actor.userId);
  return { name: actor.name || actor.email, registration: practitioner?.registrationNumber ?? null, practitionerId: practitioner?.id ?? null };
}

/** null when the member has a registration number to sign with; otherwise the refusal (nothing is signed). */
export function registrationFailure(author: Pick<NoteAuthor, "registration">): Failure | null {
  return author.registration && author.registration.trim() ? null : fail("registration", REGISTRATION_NEEDED_MESSAGE);
}

/**
 * TESTS and scripts only: an actor of `role` over `ctx` (no session). Its permissions are the real effective ones
 * (role default → `access.roleOverrides` → `access.exceptions` → locks); `access.siteIds` limits its sites.
 */
export function testActor(
  ctx: RepoContext,
  tenantId: string,
  role: PmsRole,
  user: { userId: string; name: string; email?: string; sessionId?: string },
  access: { roleOverrides?: PermissionChoices; exceptions?: PermissionChoices; siteIds?: string[] | null } = {},
): RecordsActor & { role: PmsRole } {
  const actor: PmsActor = { userId: user.userId, sessionId: user.sessionId ?? `sess_${user.userId}` };
  return {
    role,
    tenantId,
    userId: user.userId,
    name: user.name,
    email: user.email ?? `${user.userId}@example.com`,
    can: canWith(effectivePermissions({ role, roleOverrides: access.roleOverrides, exceptions: access.exceptions })),
    siteIds: access.siteIds ? new Set(access.siteIds) : null,
    actor,
    repo: () => ctx,
  };
}
