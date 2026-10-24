/**
 * How long clinical records are kept (pure rules). Clinical records are NEVER deleted automatically: this only
 * says from when a record may be REVIEWED for deletion by a person (a later admin screen lists them).
 *
 * Default policy (CSP record-keeping guidance, as summarised in docs/strategy/all-in-one-pms-feasibility.md §3b
 * row 4 – to be confirmed with a solicitor):
 * - adults (18 or over at the last treatment): 8 years after the last treatment;
 * - children: until their 25th birthday, or their 26th if they were 17 at the last treatment, and never less than
 *   8 years after the last treatment – whichever is latest;
 * - unknown date of birth or no treatment date: the child rule cannot be applied, so a person decides
 *   ("needs_person");
 * - deceased patients: 8 years (the adult years) after the date of death;
 * - a legal hold always needs a person.
 * The adult years and the child age are per clinic (pms_settings), never below 8 years / the 25th birthday.
 */
import { addYears, isIsoDate, yearsBetween } from "./text";

export interface RetentionPolicy {
  adultYears: number;
  childUntilAge: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { adultYears: 8, childUntilAge: 25 };

export interface RetentionSubject {
  dateOfBirth: string | null;
  /** Last attended appointment or the case's close date, "YYYY-MM-DD". */
  lastTreatmentOn: string | null;
  legalHold?: boolean;
  /** Date of death when known. */
  deceasedOn?: string | null;
}

export type RetentionDecision =
  | { kind: "review_from"; date: string; rule: "adult" | "child" | "deceased" }
  | { kind: "needs_person"; reason: "legal_hold" | "no_date_of_birth" | "no_treatment_date" };

export function retentionReviewFrom(subject: RetentionSubject, policy: RetentionPolicy = DEFAULT_RETENTION): RetentionDecision {
  const adultYears = Math.max(8, Math.floor(policy.adultYears));
  const childAge = Math.max(25, Math.floor(policy.childUntilAge));
  if (subject.legalHold) return { kind: "needs_person", reason: "legal_hold" };
  if (subject.deceasedOn && isIsoDate(subject.deceasedOn)) {
    return { kind: "review_from", date: addYears(subject.deceasedOn, adultYears), rule: "deceased" };
  }
  if (!subject.lastTreatmentOn || !isIsoDate(subject.lastTreatmentOn)) return { kind: "needs_person", reason: "no_treatment_date" };
  if (!subject.dateOfBirth || !isIsoDate(subject.dateOfBirth)) return { kind: "needs_person", reason: "no_date_of_birth" };
  const last = subject.lastTreatmentOn;
  const ageAtLast = yearsBetween(subject.dateOfBirth, last);
  const afterLast = addYears(last, adultYears);
  if (ageAtLast >= 18) return { kind: "review_from", date: afterLast, rule: "adult" };
  const birthdayLimit = addYears(subject.dateOfBirth, ageAtLast === 17 ? childAge + 1 : childAge);
  return { kind: "review_from", date: birthdayLimit > afterLast ? birthdayLimit : afterLast, rule: "child" };
}
