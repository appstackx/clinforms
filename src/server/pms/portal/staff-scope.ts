/** Whether a patient is in the member's clinic and sites (the actions' check before any portal staff write). */
import "server-only";
import { getDb } from "../../db";
import { getPatient } from "../../repos/pms/patients";
import { patientVisibleInScope } from "../access";
import type { ClinicActor } from "../actor";

export async function patientVisible(actor: ClinicActor, patientId: string): Promise<boolean> {
  if (typeof patientId !== "string" || !/^pat_[0-9A-HJKMNP-TV-Z]{26}$/.test(patientId)) return false;
  if (actor.siteIds !== null && !(await patientVisibleInScope({ db: getDb() }, actor.tenantId, patientId, actor.siteIds))) return false;
  return Boolean(await getPatient(actor.repo(), actor.tenantId, patientId));
}
