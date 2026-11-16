/**
 * The practice patient (16/11/2026 – Blue Heart's clinicians asked for "a test program": a way to try the service
 * without uploading a real patient's notes).
 *
 * A clinic's own Studio offers one MADE-UP patient (Priya Nair – connectors/file-import/samples) in step 1 of
 * "Complete a form". Her record goes through the same reading as any uploaded notes, so a practice report works
 * exactly like a real one – the clinic's own forms, drafting, review, approval – with one difference, decided by the
 * SERVER from the report's record (never by a flag the browser sets):
 *
 * - every output carries the practice notice (practiceOutputNotice below): the draft preview, the Word / PDF files
 *   (referrer's form, its PDF copy, a portal question set's summary, a built-in report) and copied answers.
 *
 * A practice report is recognised by the record's patient id (PRACTICE_PATIENT_ID): the id the practice record
 * carries through the import (source.externalPatientId, registration.externalPatientId, the report's episodeRef). A
 * clinic system's own export never carries it. Marking a report as practice only ever ADDS the notice, so a record
 * that claims the id gains nothing by it.
 *
 * Usage is unchanged: a practice report is drafted like any other and counts as one report (the Studio says so).
 *
 * Pure and browser-safe (no env, no Node built-ins).
 */
import { WORDING } from "./wording";

/** The patient id of the practice record – and of nothing else. */
export const PRACTICE_PATIENT_ID = "practice-patient-1";
/** The episode id of the practice record. */
export const PRACTICE_EPISODE_ID = "practice-episode-1";

interface BundleLike {
  source?: { externalPatientId?: string | null } | null;
  registration?: { externalPatientId?: string | null } | null;
}

/** Whether a record (EpisodeBundle) is the practice patient's. */
export function isPracticeBundle(bundle: BundleLike | null | undefined): boolean {
  return bundle?.source?.externalPatientId === PRACTICE_PATIENT_ID || bundle?.registration?.externalPatientId === PRACTICE_PATIENT_ID;
}

/** Whether a report was made from the practice patient's record. */
export function isPracticeReport(report: { bundleSnapshot?: BundleLike | null; episodeRef?: { patientId?: string | null } | null } | null | undefined): boolean {
  if (!report) return false;
  return report.episodeRef?.patientId === PRACTICE_PATIENT_ID || isPracticeBundle(report.bundleSnapshot);
}

/**
 * The notice a practice report's outputs carry: the form's own demonstration notice when it has one (a public form
 * used in a demo), else the practice notice. undefined for any other report – nothing changes for real patients.
 */
export function practiceOutputNotice(form: { demoNotice?: string | null } | null | undefined, practice: boolean): string | undefined {
  if (!practice) return undefined;
  const own = form?.demoNotice?.replace(/\s+/g, " ").trim();
  return own || WORDING.practice.outputNotice;
}
