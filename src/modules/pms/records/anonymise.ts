/**
 * Anonymising a patient's record (pure rule). Clinical records are kept for the record-keeping period
 * (src/modules/pms/core/retention.ts) and NOTHING removes them automatically. Anonymising is a person's decision,
 * made after that period:
 *
 * - never while the record is on hold;
 * - never before the record's review date (adults: 8 years after the last treatment; children longer);
 * - when the rules cannot give a date (no date of birth, no treatment recorded) a person may still decide, after
 *   confirming they have reviewed the record;
 * - always confirmed by typing the patient's number.
 *
 * What it does (src/server/repos/pms/records/anonymise.ts): removes the name, contact details, date of birth, GP,
 * free text and attached files; keeps the dates, note types, outcome scores and case payer types for the clinic's
 * figures. It cannot be undone.
 */
import { retentionReviewFrom, type RetentionDecision, type RetentionPolicy } from "../core/retention";

export interface AnonymiseSubject {
  dateOfBirth: string | null;
  lastTreatmentOn: string | null;
  legalHold: boolean;
  status: "active" | "archived" | "deceased";
  deceasedOn?: string | null;
  alreadyAnonymised: boolean;
}

export type AnonymiseCheck =
  | { allowed: true; needsReview: boolean; decision: RetentionDecision }
  | { allowed: false; reason: "legal_hold" | "too_early" | "already"; decision: RetentionDecision | null; message: string };

export function anonymiseCheck(subject: AnonymiseSubject, today: string, policy: RetentionPolicy): AnonymiseCheck {
  if (subject.alreadyAnonymised) return { allowed: false, reason: "already", decision: null, message: "This record has already been anonymised." };
  const decision = retentionReviewFrom(
    { dateOfBirth: subject.dateOfBirth, lastTreatmentOn: subject.lastTreatmentOn, legalHold: subject.legalHold, deceasedOn: subject.deceasedOn ?? null },
    policy,
  );
  if (decision.kind === "needs_person" && decision.reason === "legal_hold") {
    return { allowed: false, reason: "legal_hold", decision, message: "The record is on hold, so it must be kept as it is. Take the hold off first if it no longer applies." };
  }
  if (decision.kind === "review_from" && decision.date > today) {
    return { allowed: false, reason: "too_early", decision, message: "The record-keeping period has not ended yet." };
  }
  return { allowed: true, needsReview: decision.kind === "needs_person", decision };
}

/** The latest treatment date known from the record: last seen, the last signed note, the last case closed. */
export function lastTreatmentDate(dates: readonly (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

export const ANONYMISED_FIRST_NAME = "Anonymised";
export function anonymisedLastName(patientNumber: number): string {
  return `patient ${patientNumber}`;
}
