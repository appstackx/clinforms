/**
 * Set-up → Audit trail, search by patient (K2-AUD-003): the text typed (a name, patient number or date of birth) is
 * looked up with the ordinary patient search – its search keys, limited to the member's sites – and the ids found
 * become the audit search's "related" records. Nothing is stored and no name is ever written to an audit row; the
 * names of the patients found are shown only to a member who may view patients.
 */
import type { RepoContext } from "../../repos/context";
import { searchPatients } from "../../repos/pms/patients";
import type { AuditScreen } from "../../../modules/pms/reporting/setup-view";

/** At most this many patients are matched by one search (the screen asks for more of the name beyond it). */
export const AUDIT_PATIENT_MATCHES = 20;

export interface AuditPatientActor {
  tenantId: string;
  can: (permission: "patients.view") => boolean;
  repo: () => RepoContext;
  siteIds?: ReadonlySet<string> | null;
}

export interface AuditPatientFilter {
  /** The patients the text matched (null = no patient search). */
  ids: string[] | null;
  matches: AuditScreen["patient"];
}

export async function auditPatientFilter(actor: AuditPatientActor, text: string | null): Promise<AuditPatientFilter | { error: string }> {
  if (!text) return { ids: null, matches: null };
  if (!actor.can("patients.view")) return { error: "Searching by patient needs permission to view patients." };
  const found = await searchPatients(actor.repo(), actor.tenantId, { q: text, status: "any", limit: AUDIT_PATIENT_MATCHES + 1, siteIds: actor.siteIds ?? null });
  const list = found.slice(0, AUDIT_PATIENT_MATCHES);
  return {
    ids: list.map((x) => x.id),
    matches: {
      text,
      patients: list.map((x) => ({ id: x.id, label: `${[x.firstName, x.lastName].filter(Boolean).join(" ")} · patient no. ${x.patientNumber}` })),
      more: found.length > AUDIT_PATIENT_MATCHES,
    },
  };
}
