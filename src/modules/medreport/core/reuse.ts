/**
 * "Complete another form for this patient" (25/10/2026): a NEW report on another referrer form from the record an
 * earlier report of the clinic was completed from – the patient's notes as staff confirmed them – without uploading
 * the notes again. Pure and browser-safe; the server uses it on the report it loads from the clinic's own store
 * (api/handlers/store-report-reuse.ts) and the Studio uses the summary wording.
 *
 * What the new report gets is what a fresh upload of the same notes would give:
 * - the record exactly as the earlier report holds it (bundleSnapshot – notes, appointments, scores, registration,
 *   referral, clinicians), with the clinic's current details stamped on by the server;
 * - EXCEPT consent recorded on the earlier report itself (review "Record consent", activity "consent_recorded"):
 *   that consent was given for that report, so it is not carried over – the record comes back as the notes gave it
 *   (consent not recorded) and the new report needs the patient's consent recorded before approval, as for any upload.
 *   Consent that the notes themselves recorded stays, exactly as a fresh upload of the same notes would keep it.
 * The new report is never an amendment of the earlier one (no `amends`, version 1): it counts as its own report.
 */
import type { EpisodeBundle, Report } from "./types";

/** The activity action of a consent recorded on a report in the Studio (ui/components/review/review-model.ts). */
export const CONSENT_RECORDED_ACTION = "consent_recorded";

/** The activity action the new report starts with (core/report-factory.ts KNOWN_ACTIVITY_ACTIONS). */
export const NOTES_REUSED_ACTION = "notes_reused";

/** True when the report's consent was recorded on the report itself (not found in the uploaded notes). */
export function consentRecordedOnReport(report: Pick<Report, "activity">): boolean {
  return report.activity.some((a) => a.action === CONSENT_RECORDED_ACTION);
}

export interface RecordForAnotherForm {
  /** The record a new report starts from. */
  bundle: EpisodeBundle;
  /** Consent recorded on the earlier report was left out (it must be recorded again on the new report). */
  consentReset: boolean;
}

/** The record of `report` for a new report on another form (see the header). */
export function recordForAnotherForm(report: Pick<Report, "bundleSnapshot" | "activity">): RecordForAnotherForm {
  const bundle = report.bundleSnapshot;
  if (bundle.consent.disclosureConsentRecorded && consentRecordedOnReport(report)) {
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
    (source.consentReset ? " Consent recorded on that report is not carried over: record it on this report before approval." : "")
  );
}
