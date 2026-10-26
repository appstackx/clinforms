/**
 * Server helpers of the records module's pages, actions and routes: the patient of a URL (scoped to the actor's
 * clinic – anything else is the 404 page), the signed-in member as a note author, and plain messages for the
 * repositories' outcomes.
 */
import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import type { Patient, PmsSaveResult } from "../../../modules/pms/core/types";
import type { ClinicActor } from "../actor";
import { RepoInputError } from "../../repos/context";
import { findPractitionerByUser } from "../../repos/pms/directory";
import { getPatient } from "../../repos/pms/patients";
import type { NoteAuthor } from "../../repos/pms/records/notes";
import { logAuthEvent } from "../../email/log";
import { getDataCipher } from "../../crypto";
import { getDb } from "../../db";

export const PATIENTS_PATH = "/app/clinic/patients";

export function patientPath(patientId: string, segment = ""): string {
  return `${PATIENTS_PATH}/${encodeURIComponent(patientId)}${segment ? `/${segment}` : ""}`;
}

/** One read per request for the record's layout and its page (keyed by the clinic and the patient). */
const loadPatient = cache(async (tenantId: string, patientId: string) => getPatient({ db: getDb(), cipher: getDataCipher() }, tenantId, patientId));

/** The patient of a URL in the actor's clinic, or the 404 page (never another clinic's, never an error). */
export async function patientOr404(actor: ClinicActor, patientId: string): Promise<Patient> {
  if (!isPlausibleRecordId(patientId)) notFound();
  const patient = await loadPatient(actor.tenantId, patientId);
  if (!patient) notFound();
  return patient;
}

/** The patient for a server action (null = not in this clinic). */
export async function patientForAction(actor: ClinicActor, patientId: unknown): Promise<Patient | null> {
  if (!isPlausibleRecordId(patientId)) return null;
  return getPatient(actor.repo(), actor.tenantId, patientId);
}

/** The member as a note's author or signer: their name and, when they are a practitioner, the registration number. */
export async function noteAuthor(actor: ClinicActor): Promise<NoteAuthor & { practitionerId: string | null }> {
  const practitioner = await findPractitionerByUser(actor.repo(), actor.tenantId, actor.userId);
  return { name: actor.name || actor.email, registration: practitioner?.registrationNumber ?? null, practitionerId: practitioner?.id ?? null };
}

export const CONFLICT_MESSAGE = "Someone else changed this record while you were editing it. Reload the page to see their changes, then make yours again.";
export const NOT_FOUND_MESSAGE = "This record no longer exists in this clinic.";

/** A revisioned save's outcome as an action answer. */
export function saveError(result: Exclude<PmsSaveResult, { ok: true }>): { ok: false; error: string; conflict?: boolean } {
  return result.reason === "conflict" ? { ok: false, error: CONFLICT_MESSAGE, conflict: true } : { ok: false, error: NOT_FOUND_MESSAGE };
}

/** A repository's input error as an action answer; anything else is logged by name and answered plainly. */
export function actionError(err: unknown, what: string): { ok: false; error: string } {
  if (err instanceof RepoInputError) {
    // "Patient: dateOfBirth: Enter a date…" → "Enter a date…" (forms show field errors next to the field already).
    return { ok: false, error: err.message.replace(/^[A-Z][A-Za-z ]*: [a-z][A-Za-z0-9.]*: /, "").replace(/; [a-z][A-Za-z0-9.]*: /g, "; ") };
  }
  logAuthEvent("pms.records_action_failed", { what, error: err instanceof Error ? err.name : "error" });
  return { ok: false, error: "Something went wrong. Please try again." };
}
