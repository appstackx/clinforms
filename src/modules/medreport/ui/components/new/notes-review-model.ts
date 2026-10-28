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

/** A full name without case, accents, full stops, apostrophes or extra spaces ("Anne-Marie O'Neil" = "anne marie oneil"). */
const nameKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'\u2019]/g, "")
    .replace(/[\s,\-\u2010-\u2015]+/g, " ")
    .trim();
/** A number as written, without spaces, hyphens or case ("" for none or "Not recorded"). */
const numberKey = (s: string) => {
  const k = s.replace(/[\s-]+/g, "").toUpperCase();
  return k === "NOTRECORDED" ? "" : k;
};
/** HCPC registration numbers: 2–3 letters and 4–6 digits – the format src/lib/hcpc.ts checks on member profiles. */
const HCPC_FORMAT = /^[A-Z]{2,3}\d{4,6}$/;

/**
 * The HCPC number in `hcpc`, normalised ("ph 123-456" → "PH123456"), or "" when there is none: blank, "Not recorded",
 * or a number in another format – such as the made-up PH-DEMO-01 – which counts as no number when people are matched.
 */
export function validHcpcNumber(hcpc: string): string {
  const k = numberKey(hcpc);
  return HCPC_FORMAT.test(k) ? k : "";
}

interface Person extends ReviewClinician {
  /** The clinic's member (their profile's name and number). */
  member: boolean;
}

/**
 * Fix (Blue Heart trial, finding 5): one person per clinician, whether the notes or the clinic's members name them.
 * Two clinicians are the same person when their full names match (`nameKey`) and they do not carry two different
 * HCPC numbers; a missing number, "Not recorded" or another format (PH-DEMO-01) counts as no number. When several
 * people of one name have different HCPC numbers, a clinician of that name without one cannot be told apart and
 * stays separate. A person is shown with the member's name, else as first written, and with their HCPC number (a
 * member's first), else the number first written.
 */
function matchPeople(review: NotesReview, members: readonly ReviewClinician[]) {
  const named: Person[] = [];
  for (const e of review.entries) {
    const name = e.clinicianName.trim();
    if (name && name !== NOTES_REVIEW_COPY.clinicianNotRecorded) named.push({ name, hcpc: e.clinicianHcpc.trim(), member: false });
  }
  for (const m of members) if (m.name.trim()) named.push({ name: m.name.trim(), hcpc: m.hcpc.trim(), member: true });

  const numbersByName = new Map<string, Set<string>>();
  for (const c of named) {
    const set = numbersByName.get(nameKey(c.name)) ?? new Set<string>();
    if (validHcpcNumber(c.hcpc)) set.add(validHcpcNumber(c.hcpc));
    numbersByName.set(nameKey(c.name), set);
  }
  const personKey = (c: ReviewClinician) => {
    const numbers = numbersByName.get(nameKey(c.name));
    return numbers && numbers.size > 1 ? `${nameKey(c.name)}\u0000${validHcpcNumber(c.hcpc)}` : nameKey(c.name);
  };

  // Notes first (in order of first appearance), then members the notes do not name.
  const groups = new Map<string, Person[]>();
  for (const c of named) groups.set(personKey(c), [...(groups.get(personKey(c)) ?? []), c]);
  const people = new Map<string, Person>();
  groups.forEach((group, key) => {
    const byMembers = group.filter((c) => c.member).concat(group.filter((c) => !c.member));
    const number = byMembers.find((c) => validHcpcNumber(c.hcpc)) ?? byMembers.find((c) => numberKey(c.hcpc));
    people.set(key, { name: byMembers[0].name, hcpc: number?.hcpc ?? "", member: group.some((c) => c.member) });
  });
  return { people, personOf: (c: ReviewClinician) => people.get(personKey(c)) };
}

/**
 * The clinicians to choose from: the people named in the entries (in order of first appearance), then – fix wave 3 –
 * the clinic's own members (a clinic's Studio: names and HCPC numbers from their profiles), each person once
 * (`matchPeople`).
 */
export function reviewClinicians(review: NotesReview, members: readonly ReviewClinician[] = []): ReviewClinician[] {
  return Array.from(matchPeople(review, members).people.values()).map(({ name, hcpc }) => ({ name, hcpc }));
}

/**
 * Fix wave 3: an entry names its clinician as the list does – a clinic member named in the notes gets the member's
 * name and HCPC number (also when the notes give none, or a number in another format such as PH-DEMO-01), and the
 * same person is written the same way on every entry. Entries without a clinician stay without one.
 */
export function withMemberNumbers(review: NotesReview, members: readonly ReviewClinician[]): NotesReview {
  const { personOf } = matchPeople(review, members);
  let changed = false;
  const entries = review.entries.map((e) => {
    const person = e.clinicianName.trim() ? personOf({ name: e.clinicianName.trim(), hcpc: e.clinicianHcpc.trim() }) : undefined;
    if (!person || (person.name === e.clinicianName && person.hcpc === e.clinicianHcpc)) return e;
    changed = true;
    return { ...e, clinicianName: person.name, clinicianHcpc: person.hcpc };
  });
  return changed ? { ...review, entries } : review;
}

/**
 * What staff should know about that matching (one line per clinician): a number written in the notes that is shown
 * as another number – a member's HCPC number in place of PH-DEMO-01, say. A number the notes left out, or wrote with
 * other spaces or case, needs no line.
 */
export function clinicianMatchNotices(review: NotesReview, members: readonly ReviewClinician[]): string[] {
  const { personOf } = matchPeople(review, members);
  const out: string[] = [];
  for (const e of review.entries) {
    const written = { name: e.clinicianName.trim(), hcpc: e.clinicianHcpc.trim() };
    const person = written.name ? personOf(written) : undefined;
    if (!person || !numberKey(written.hcpc) || numberKey(written.hcpc) === numberKey(person.hcpc)) continue;
    const line = NOTES_REVIEW_COPY.clinicianMatched(clinicianLabel(written), clinicianLabel(person), person.member);
    if (out.indexOf(line) < 0) out.push(line);
  }
  return out;
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
