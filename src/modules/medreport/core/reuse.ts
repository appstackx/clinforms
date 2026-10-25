/**
 * "Complete another form for this patient" (25/10/2026): a NEW report on another referrer form from the record an
 * earlier report of the clinic was completed from – the patient's notes as staff confirmed them – without uploading
 * the notes again. Pure and browser-safe; the server uses it on the report it loads from the clinic's own store
 * (api/handlers/store-report-reuse.ts) and the Studio uses the summary wording.
 *
 * What the new report gets:
 * - the record exactly as the earlier report holds it (bundleSnapshot – notes, appointments, scores, registration,
 *   referral, clinicians), with the clinic's current details stamped on by the server;
 * - EXCEPT the patient's consent to share the report, for a record from UPLOADED notes (review fix 25/10/2026): it is
 *   never carried over. The stored record cannot tell consent the notes showed from consent staff entered at the
 *   notes check ("Consent to share the report: Recorded" + date) or later on the report ("Record consent", activity
 *   "consent_recorded") – and the other form may go to another organisation. So the new report starts with consent
 *   NOT recorded: CONSENT_NOT_RECORDED blocks approval until a member records it on the new report ("Record consent"
 *   works on any draft from uploaded notes).
 * - A record from a clinic system keeps the consent the clinic system holds (fetching it afresh would give the same;
 *   consent for such a record is recorded in the clinic system, never in ClinForms) – unless it was recorded on the
 *   earlier report itself (belt and braces: "Record consent" is offered for uploaded notes only).
 * The new report is never an amendment of the earlier one (no `amends`, version 1): it counts as its own report.
 */
import type { EpisodeBundle, Report } from "./types";

/** The activity action of a consent recorded on a report in the Studio (ui/components/review/review-model.ts). */
export const CONSENT_RECORDED_ACTION = "consent_recorded";

/** The activity action the new report starts with (core/report-factory.ts KNOWN_ACTIVITY_ACTIONS). */
export const NOTES_REUSED_ACTION = "notes_reused";

/** True when the report's consent was recorded on the report itself (review "Record consent"). */
export function consentRecordedOnReport(report: Pick<Report, "activity">): boolean {
  return report.activity.some((a) => a.action === CONSENT_RECORDED_ACTION);
}

/** True when the record was built from uploaded notes (the notes check), not fetched from a clinic system. */
export function fromUploadedNotes(bundle: Pick<EpisodeBundle, "source">): boolean {
  return bundle.source.connectorId === "file-import";
}

export interface RecordForAnotherForm {
  /** The record a new report starts from. */
  bundle: EpisodeBundle;
  /** The earlier report's recorded consent was left out (it must be recorded again on the new report). */
  consentReset: boolean;
}

/** The record of `report` for a new report on another form (see the header). */
export function recordForAnotherForm(report: Pick<Report, "bundleSnapshot" | "activity">): RecordForAnotherForm {
  const bundle = report.bundleSnapshot;
  if (bundle.consent.disclosureConsentRecorded && (fromUploadedNotes(bundle) || consentRecordedOnReport(report))) {
    return { bundle: { ...bundle, consent: { disclosureConsentRecorded: false } }, consentReset: true };
  }
  return { bundle, consentReset: false };
}

/** What the Studio shows about the earlier report (no patient data beyond what the report screen shows). */
export interface ReuseSource {
  reportId: string;
  status: Report["status"];
  version: number;
  /** The referrer form the earlier report completed (null for a built-in report). */
  formId: string | null;
  formTitle: string | null;
  referrerName: string;
  consentReset: boolean;
}

export function reuseSourceOf(report: Report, consentReset: boolean): ReuseSource {
  return {
    reportId: report.id,
    status: report.status,
    version: report.version ?? 1,
    formId: report.form?.formId ?? null,
    formTitle: report.form?.title ?? null,
    referrerName: report.form?.referrer.name ?? report.instructingParty.name,
    consentReset,
  };
}

/** The new report's first activity line after "created": where its record came from (plain words, no ids). */
export function notesReusedDetail(source: Pick<ReuseSource, "formTitle" | "status" | "consentReset">): string {
  const which = source.formTitle ? `the report on “${source.formTitle}”` : "an earlier report";
  const state = source.status === "signed" ? "approved" : "draft";
  return (
    `Started from the patient's notes as already checked for ${which} (${state}) – the notes were not uploaded again.` +
    (source.consentReset ? " The patient's consent to share that report is not carried over: record it on this report before approval." : "")
  );
}
