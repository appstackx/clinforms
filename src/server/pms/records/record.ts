/**
 * Page helpers of the records module: the patients paths and the patient of a URL for server components (scoped to
 * the actor's clinic – anything else is the 404 page). Actions and routes go through the records services
 * (./*-service.ts), which check permissions, scope and input themselves (./access.ts).
 */
import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import type { Patient } from "../../../modules/pms/core/types";
import type { ClinicActor } from "../actor";
import { getPatient } from "../../repos/pms/patients";
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
