/**
 * Everything the clinic system holds about ONE patient, decrypted – the content of a subject-access copy
 * (UK GDPR Article 15) and the basis of anonymisation. Read-only: the export route writes the audit row.
 *
 * Covers the shared record (patient, cases, authorisations) and the records module (notes with their
 * amendments, outcome measures, the list of attached files). Other modules' data about the patient
 * (appointments, invoices, messages, forms) is added by those modules through the export's extraSections /
 * extraJson (src/server/pms/records/export-service.ts).
 */
import type { Authorisation, Case, Patient } from "../../../../modules/pms/core/types";
import type { AttachmentDetails, ClinicalNote, OutcomeRecord } from "../../../../modules/pms/records/types";
import type { ClinicalFlag } from "../../../../modules/pms/records/flags";
import { getAuthorisation, getCase, listAuthorisations, listCasesForPatient } from "../cases";
import { listPractitioners, listSites } from "../directory";
import { getPatient } from "../patients";
import { listReferrers } from "../referrers";
import { assertTenantId, type RepoContext } from "../context";
import { getPatientAttachments } from "./attachments";
import { getNote, listNotesForPatient } from "./notes";
import { getOutcome, listOutcomesForPatient } from "./outcomes";
import { getPatientExtras, listClinicalFlags } from "./patient-extras";

export interface SubjectAccessData {
  patient: Patient;
  cases: Case[];
  authorisations: Authorisation[];
  notes: ClinicalNote[];
  outcomes: OutcomeRecord[];
  attachments: AttachmentDetails[];
  /** 0125: the patient's pronouns and every clinical flag (active and ended). */
  pronouns: string | null;
  clinicalFlags: ClinicalFlag[];
  /** id → display name, for the copy's readers. */
  names: { practitioners: Record<string, string>; referrers: Record<string, string>; sites: Record<string, string> };
}

export async function collectSubjectAccess(ctx: RepoContext, tenantId: string, patientId: string): Promise<SubjectAccessData | null> {
  assertTenantId(tenantId);
  const patient = await getPatient(ctx, tenantId, patientId);
  if (!patient) return null;
  const [caseSummaries, authSummaries, noteSummaries, outcomeSummaries, attachments, practitioners, referrers, sites, extras, clinicalFlags] = await Promise.all([
    listCasesForPatient(ctx, tenantId, patientId),
    listAuthorisations(ctx, tenantId, { patientId }),
    listNotesForPatient(ctx, tenantId, patientId, { includeDiscarded: true, limit: 500 }),
    listOutcomesForPatient(ctx, tenantId, patientId, { includeErrors: true }),
    getPatientAttachments(ctx, tenantId, patientId, { includeWithdrawn: true }),
    listPractitioners(ctx, tenantId, { includeInactive: true }),
    listReferrers(ctx, tenantId, { includeInactive: true, limit: 500 }),
    listSites(ctx, tenantId, { includeInactive: true }),
    getPatientExtras(ctx, tenantId, patientId),
    listClinicalFlags(ctx, tenantId, patientId, { includeEnded: true }),
  ]);
  const cases: Case[] = [];
  for (const c of caseSummaries) {
    const full = await getCase(ctx, tenantId, c.id);
    if (full) cases.push(full);
  }
  const authorisations: Authorisation[] = [];
  for (const a of authSummaries) {
    const full = await getAuthorisation(ctx, tenantId, a.id);
    if (full) authorisations.push(full);
  }
  const notes: ClinicalNote[] = [];
  for (const n of noteSummaries) {
    const full = await getNote(ctx, tenantId, n.id);
    if (full) notes.push(full);
  }
  const outcomes: OutcomeRecord[] = [];
  for (const o of outcomeSummaries) {
    const full = await getOutcome(ctx, tenantId, o.id);
    if (full) outcomes.push(full);
  }
  const byId = <T extends { id: string }>(rows: T[], name: (r: T) => string) => Object.fromEntries(rows.map((r) => [r.id, name(r)]));
  return {
    patient,
    cases,
    authorisations,
    notes: notes.sort((a, b) => (a.seenOn === b.seenOn ? a.id.localeCompare(b.id) : a.seenOn.localeCompare(b.seenOn))),
    outcomes,
    attachments,
    pronouns: extras.pronouns,
    clinicalFlags,
    names: {
      practitioners: byId(practitioners, (p) => (p.registrationNumber ? `${p.displayName} (${p.registrationNumber})` : p.displayName)),
      referrers: byId(referrers, (r) => r.name),
      sites: byId(sites, (s) => s.name),
    },
  };
}
