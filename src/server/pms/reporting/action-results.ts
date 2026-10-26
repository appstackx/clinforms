/**
 * Results of the set-up actions: plain messages for forms, never the cause of an unexpected error (logged by
 * name only).
 */
import "server-only";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import type { FormResult } from "../../../modules/pms/reporting/forms";
import { SETUP_COPY } from "../../../modules/pms/reporting/copy";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** A schema's problems as a form result (messages next to the fields). */
export function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): FormResult {
  return { ok: false, error: "Check the fields marked below.", fieldErrors: fieldErrors(error as never) };
}

/** An error from a repository as a form result. */
export function failed(err: unknown, where: string): FormResult {
  if (err instanceof RepoInputError) return { ok: false, error: err.message };
  logAuthEvent("pms.setup_failed", { where, error: err instanceof Error ? err.name : "error" });
  return { ok: false, error: GENERIC_ERROR };
}

export const NOT_WHOLE_CLINIC: FormResult = { ok: false, error: SETUP_COPY.unscopedOnly };
export const CONFLICT: FormResult = { ok: false, error: SETUP_COPY.conflict };
export const NOT_FOUND: FormResult = { ok: false, error: SETUP_COPY.notFound };
