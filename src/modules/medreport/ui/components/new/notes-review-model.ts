/**
 * The "check the notes" step's state (production wave 3): pure helpers over a NotesReview
 * (connectors/file-import/review-contract.ts) for the Studio's review panel (./notes-review.tsx) – edits, the
 * clinicians found, live counts and what still blocks confirming. The server checks everything again on confirm.
 *
 * Owner: studio-a agent.
 */
import {
  NOTES_REVIEW_COPY,
  NOTES_REVIEW_FIELD_LABELS,
  NOTES_REVIEW_REQUIRED,
  type NotesReview,
  type NotesReviewEntry,
  type NotesReviewRegistration,
} from "../../../connectors/file-import/review-contract";

export interface ReviewClinician {
  name: string;
  hcpc: string;
}

/** The clinicians named in the entries (once each, in order of first appearance). */
export function reviewClinicians(review: NotesReview): ReviewClinician[] {
  const out: ReviewClinician[] = [];
  for (const e of review.entries) {
    const name = e.clinicianName.trim();
    if (!name || name === NOTES_REVIEW_COPY.clinicianNotRecorded) continue;
    if (!out.some((c) => c.name === name && c.hcpc === e.clinicianHcpc.trim())) out.push({ name, hcpc: e.clinicianHcpc.trim() });
  }
  return out;
}

export function clinicianKey(c: ReviewClinician): string {
  return `${c.name}\u0000${c.hcpc}`;
}

export function clinicianLabel(c: ReviewClinician): string {
  return c.hcpc ? `${c.name} (${c.hcpc})` : c.name;
}

export function updateEntry(review: NotesReview, key: string, patch: Partial<NotesReviewEntry>): NotesReview {
  return { ...review, entries: review.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)) };
}

export function updateRegistration<K extends keyof NotesReviewRegistration>(review: NotesReview, field: K, value: NotesReviewRegistration[K]): NotesReview {
  return { ...review, registration: { ...review.registration, [field]: value } };
}

/** Set one clinician on every listed entry. */
export function applyClinician(review: NotesReview, keys: readonly string[], clinician: ReviewClinician): NotesReview {
  return {
    ...review,
    entries: review.entries.map((e) => (keys.indexOf(e.key) >= 0 ? { ...e, clinicianName: clinician.name, clinicianHcpc: clinician.hcpc } : e)),
  };
}

export interface ReviewCounts {
  entries: number;
  included: number;
  clinicians: number;
  scores: number;
  /** Included entries without a clinician / without a date; blocks without a date (any). */
  noClinician: string[];
  includedNoDate: string[];
  undated: string[];
}

export function reviewCounts(review: NotesReview): ReviewCounts {
  const included = review.entries.filter((e) => e.include);
  const usedKeys = new Set(included.filter((e) => e.date).map((e) => e.key));
  return {
    entries: review.entries.length,
    included: included.length,
    clinicians: reviewClinicians({ ...review, entries: included }).length,
    scores: review.outcomes.filter((o) => usedKeys.has(o.entryKey)).length,
    noClinician: included.filter((e) => !e.clinicianName.trim()).map((e) => e.key),
    includedNoDate: included.filter((e) => !e.date).map((e) => e.key),
    undated: review.entries.filter((e) => !e.date && !e.include).map((e) => e.key),
  };
}

/** What still stops the review from being confirmed, in plain English (empty = ready). */
export function reviewBlockers(review: NotesReview): string[] {
  const out: string[] = [];
  for (const field of NOTES_REVIEW_REQUIRED) {
    if (!String(review.registration[field]).trim()) {
      out.push(NOTES_REVIEW_COPY.missingField(field === "instructingPartyType" ? "type of who the form is for" : NOTES_REVIEW_FIELD_LABELS[field]));
    }
  }
  const c = reviewCounts(review);
  if (c.includedNoDate.length) out.push(NOTES_REVIEW_COPY.includedNoDate(c.includedNoDate.length));
  if (c.noClinician.length) out.push(NOTES_REVIEW_COPY.noClinician(c.noClinician.length));
  if (!review.entries.some((e) => e.include && e.date)) out.push(NOTES_REVIEW_COPY.nothingIncluded);
  if (review.attendance) {
    const noTime = review.entries.filter((e) => e.include && e.status && !e.time).length;
    if (noTime) out.push(`add the time of ${noTime === 1 ? "1 appointment" : `${noTime} appointments`}`);
  }
  return out;
}

/** The first lines of a note for the list (the full text is one click away). */
export function firstLines(text: string, lines = 3, chars = 320): string {
  const kept = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .slice(0, lines)
    .join("\n");
  return kept.length > chars ? `${kept.slice(0, chars).trimEnd()}…` : kept;
}
