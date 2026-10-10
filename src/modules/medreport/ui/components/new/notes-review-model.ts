/**
 * The "check the notes" step's state (production wave 3): pure helpers over a NotesReview
 * (connectors/file-import/review-contract.ts) for the Studio's review panel (./notes-review.tsx) – edits, the
 * clinicians found, live counts and what still blocks confirming. The server checks everything again on confirm.
 *
 * Owner: studio-a agent.
 */
import {
  NOTES_REVIEW_COPY,
  NOTES_REVIEW_REQUIRED,
  missingFieldText,
  reviewAttendance,
  type NotesReview,
  type NotesReviewEntry,
  type NotesReviewRegistration,
} from "../../../connectors/file-import/review-contract";

export interface ReviewClinician {
  name: string;
  hcpc: string;
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/**
 * The clinicians named in the entries (once each, in order of first appearance), then – fix wave 3 – the clinic's own
 * members (a clinic's Studio: names and HCPC numbers from their profiles) that the notes do not already name.
 */
export function reviewClinicians(review: NotesReview, members: readonly ReviewClinician[] = []): ReviewClinician[] {
  const out: ReviewClinician[] = [];
  for (const e of review.entries) {
    const name = e.clinicianName.trim();
    if (!name || name === NOTES_REVIEW_COPY.clinicianNotRecorded) continue;
    if (!out.some((c) => c.name === name && c.hcpc === e.clinicianHcpc.trim())) out.push({ name, hcpc: e.clinicianHcpc.trim() });
  }
  for (const m of members) {
    const name = m.name.trim();
    if (!name) continue;
    if (!out.some((c) => nameKey(c.name) === nameKey(name) && (!c.hcpc || !m.hcpc || c.hcpc === m.hcpc.trim()))) out.push({ name, hcpc: m.hcpc.trim() });
  }
  return out;
}

/**
 * Fix wave 3: an entry that names a clinic member without an HCPC number gets the member's number (exactly one
 * member of that name, with a number). Nothing else changes.
 */
export function withMemberNumbers(review: NotesReview, members: readonly ReviewClinician[]): NotesReview {
  if (!members.length) return review;
  let changed = false;
  const entries = review.entries.map((e) => {
    if (!e.clinicianName.trim() || e.clinicianHcpc.trim()) return e;
    const same = members.filter((m) => nameKey(m.name) === nameKey(e.clinicianName) && m.hcpc.trim());
    if (same.length !== 1) return e;
    changed = true;
    return { ...e, clinicianHcpc: same[0].hcpc.trim() };
  });
  return changed ? { ...review, entries } : review;
}

export function clinicianKey(c: ReviewClinician): string {
  return `${c.name}\u0000${c.hcpc}`;
}

export function clinicianLabel(c: ReviewClinician): string {
  return c.hcpc ? `${c.name} (${c.hcpc})` : c.name;
}

/** The review with its attendance flag worked out again (every included dated entry has a status and a time). */
function withAttendance(review: NotesReview): NotesReview {
  const on = reviewAttendance(review).on;
  return on === review.attendance ? review : { ...review, attendance: on };
}

export function updateEntry(review: NotesReview, key: string, patch: Partial<NotesReviewEntry>): NotesReview {
  return withAttendance({ ...review, entries: review.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)) });
}

/** Fix wave 3: every included dated entry without an attendance status is marked as attended. */
export function markOthersAttended(review: NotesReview): NotesReview {
  return withAttendance({ ...review, entries: review.entries.map((e) => (e.include && e.date && !e.status ? { ...e, status: "ATT" as const } : e)) });
}

/**
 * What the attendance needs, in plain English (null when there is nothing to say): set for some entries only, or
 * appointments without a time. Not a blocker – the notes can be used without an attendance record.
 */
export function attendanceNotice(review: NotesReview): { text: string; canMarkOthers: boolean } | null {
  const a = reviewAttendance(review);
  if (a.on || a.withStatus === 0) return null;
  if (a.withStatus < a.dated) return { text: NOTES_REVIEW_COPY.attendancePartial(a.withStatus, a.dated), canMarkOthers: true };
  return a.statusNoTime ? { text: NOTES_REVIEW_COPY.attendanceNoTime(a.statusNoTime), canMarkOthers: false } : null;
}

/** Fix wave 3: the report cannot be approved without the patient's consent to share it – say so before drafting. */
export function consentMissing(review: NotesReview): boolean {
  return review.registration.consent !== "yes";
}

export function updateRegistration<K extends keyof NotesReviewRegistration>(review: NotesReview, field: K, value: NotesReviewRegistration[K]): NotesReview {
  return { ...review, registration: { ...review.registration, [field]: value } };
}

/** Set one clinician on every listed entry. */
export function applyClinician(review: NotesReview, keys: readonly string[], clinician: ReviewClinician): NotesReview {
  return withAttendance({
    ...review,
    entries: review.entries.map((e) => (keys.indexOf(e.key) >= 0 ? { ...e, clinicianName: clinician.name, clinicianHcpc: clinician.hcpc } : e)),
  });
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
    if (!String(review.registration[field]).trim()) out.push(missingFieldText(field));
  }
  const c = reviewCounts(review);
  if (c.includedNoDate.length) out.push(NOTES_REVIEW_COPY.includedNoDate(c.includedNoDate.length));
  if (c.noClinician.length) out.push(NOTES_REVIEW_COPY.noClinician(c.noClinician.length));
  if (!review.entries.some((e) => e.include && e.date)) out.push(NOTES_REVIEW_COPY.nothingIncluded);
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
