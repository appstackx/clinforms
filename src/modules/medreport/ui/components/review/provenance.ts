/**
 * Review workspace model – provenance: who answered a question (a person, or the drafting step), from the stamps the
 * review writes (bh2 WC design 7): Paragraph.by, Section.answerBy, Paragraph.ownWords and Section.adoptedBy – never
 * from the activity log's wording. The rules about who may decide what live in core/provenance.ts.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split; review-model.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import { boxContentSha, enteredByName, isPersonParagraph, sameMember } from "../../../core/provenance";
import type { Actor, ActivityEntry, Paragraph, Report, ReportSection } from "../../../core/types";

/**
 * @deprecated (WC design 7) – reads the activity log's wording. Nothing in the review decides from it any more (the
 * labels read Section.answerBy); kept only while the earlier review-model test still imports it.
 */
export function answerChangedByClinician(report: Pick<Report, "activity">, key: string): boolean {
  return report.activity.some((a: ActivityEntry) => a.action === "answer_set" && a.detail.startsWith(`${key}:`));
}

/** A structured answer (yes/no, tick, choice, date, number, rows) a person set – its stamp says who (Section.answerBy). */
export function structuredAnswerBy(section: Pick<ReportSection, "answer" | "answerBy">): Actor | null {
  const a = section.answer;
  if (!a || a.kind === "text" || a.value === null || a.value === "" || (Array.isArray(a.value) && a.value.length === 0)) return null;
  return section.answerBy ?? null;
}

/** The person paragraphs of a box that hold text (typed, entered or edited by a person). */
function personParagraphs(section: Pick<ReportSection, "paragraphs">): Paragraph[] {
  return section.paragraphs.filter((p) => isPersonParagraph(p) && p.text.trim() !== "" && !(p.origin === "edited" && p.originalText !== undefined));
}

/**
 * True when a person (not the drafting step) has answered this question: a paragraph they wrote or edited, or a
 * structured answer they set (its stamp, Section.answerBy).
 */
export function answeredByPerson(report: Pick<Report, "sections" | "activity">, key: string): boolean {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return false;
  if (section.paragraphs.some((p) => (p.origin === "clinician" || p.origin === "edited" || p.origin === "staff") && p.text.trim() !== "")) return true;
  return structuredAnswerBy(section) !== null;
}

/** Where the answer of an answered, clear box comes from – the status a card, the navigator and the summary show. */
export type AnswerSource = "records" | "drafted" | "clinician" | "staff";

function isStaffStamp(by: Pick<Actor, "role"> | null | undefined, origin?: Paragraph["origin"]): boolean {
  return by ? by.role === "staff" : origin === "staff";
}

/**
 * Who the answer is from (WC design 7, B1-7, B2-20, B2-21):
 * - a structured answer a person set: theirs – "staff" for a staff member, else "clinician" – even beside drafted
 *   supporting text, and even on a box filled from the records;
 * - text: a person's own paragraph (not drafted text they changed) – "staff" when every one is a staff member's (an
 *   older one with no stamp: by its origin), else "clinician"; drafted text, kept or changed: "drafted"; text filled
 *   by code: "records".
 */
export function answerSource(section: Pick<ReportSection, "kind" | "paragraphs" | "answer" | "answerBy">): AnswerSource {
  const answerBy = structuredAnswerBy(section);
  if (answerBy) return isStaffStamp(answerBy) ? "staff" : "clinician";
  const texts = section.paragraphs.filter((p) => p.text.trim());
  if (texts.every((p) => p.origin === "from_records")) return section.kind === "from_records" || texts.length > 0 ? "records" : "clinician";
  if (texts.some((p) => p.origin === "ai" || (p.origin === "edited" && p.originalText !== undefined))) return "drafted";
  const own = personParagraphs(section);
  if (own.length > 0 && own.every((p) => isStaffStamp(p.by, p.origin))) return "staff";
  return "clinician";
}

/**
 * "Entered by Pat Morgan (staff)" / "Your own words" / "Adopted by Sarah Reid" – the line under a person's paragraph
 * (B1-7(b)): from its stamps, never from the box's fill source alone.
 */
export function paragraphProvenanceLine(p: Paragraph, section: Pick<ReportSection, "adoptedBy"> & Partial<Pick<ReportSection, "answer" | "paragraphs">>, viewer: Pick<Actor, "memberId"> | null): string | null {
  if (!isPersonParagraph(p)) return null;
  // "– adopted by …" only while the adoption covers the box as it is, and only for someone else's words (the approver's
  // own entry confirms the box as theirs without an adoption to show).
  const a = section.adoptedBy;
  const current = Boolean(a && (!section.paragraphs || a.contentSha === boxContentSha({ answer: section.answer, paragraphs: section.paragraphs })));
  const adopted = a && current && !(p.by ? sameMember(p.by, a.by) : p.origin === "clinician") ? a : undefined;
  if (p.ownWords) return sameMember(p.ownWords.by, viewer) ? "Recorded as your own words" : `Recorded as ${p.ownWords.by.name}'s own words`;
  if (p.by && viewer && sameMember(p.by, viewer)) return p.origin === "edited" && p.originalText !== undefined ? "Edited by you" : p.origin === "edited" ? "Typed by you – checked like drafted text" : "Your own words – no citation needed";
  const who = p.by ? enteredByName(p.by) : p.origin === "staff" ? "staff" : null;
  const base = who ? (p.origin === "edited" && p.originalText !== undefined ? `Edited by ${who}` : `Entered by ${who}`) : p.origin === "clinician" ? "The clinician's own words" : "Entered by a person";
  return adopted ? `${base} – adopted by ${adopted.by.name}` : base;
}
