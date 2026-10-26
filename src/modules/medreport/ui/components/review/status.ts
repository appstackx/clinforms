/**
 * Review workspace model – the questions and their status: how the review screen groups the form's questions (by
 * the form's own headings) and derives each question's status for its card, the navigator and the counts.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * bh2 W0 follow-up (seam "review-groups", bh2-base2): how the form's questions are grouped – headings, sub-questions
 * and the untitled run – moved, unchanged, to core/forms/headings.ts formOutline (WE: one outline for the review and the
 * mapping page); buildQuestionGroups builds the review's questions from it.
 * Owner: WA1 (issue state) – docs/bh2-ownership.json.
 */
import { notApplicable } from "../../../core/conditions";
import { isBlankByDesign, isSectionAnswered } from "../../../core/forms";
import { formOutline } from "../../../core/forms/headings";
import type { AnswerType, FormDefinition, FormField, Gap, Report, ReportFlag, ReportSection, ReportTemplate, TemplateSection } from "../../../core/types";

/* ------------------------------------------------------------------------------------------------
 * Questions and groups
 * ----------------------------------------------------------------------------------------------*/

export interface ReviewQuestion {
  /** Section key (form field ID such as "F-07", or a built-in section key). */
  key: string;
  /** The report section answering it; null for a field left blank for the referrer's own use. */
  section: ReportSection | null;
  /** The referrer form's field (form reports only). */
  field: FormField | null;
  /** The template section spec (guidance, required). */
  spec: TemplateSection | null;
  /** The question or label as printed on the form (or the built-in section title). */
  label: string;
  /** Printed context when the question sits under another question, e.g. "4. Is the claimant fit for work?". */
  context?: string;
  /** What the referrer wants, in plain English. */
  guidance: string;
  answerType: AnswerType | null;
  required: boolean;
  /** 1-based position in the form. */
  number: number;
}

export interface ReviewGroup {
  id: string;
  title: string;
  questions: ReviewQuestion[];
}

/**
 * The questions in form order, grouped by the form's own headings (core/forms/headings.ts formOutline: a sub-question
 * stays in its question's group, a run with no heading takes the heading around it or shares one untitled group).
 * Fields left blank for the referrer's use are included (no section) so every question on the form is accounted for.
 * Built-in template reports: one group, one question per section.
 */
export function buildQuestionGroups(
  report: Pick<Report, "sections" | "form">,
  form: Pick<FormDefinition, "fields"> | null,
  template: Pick<ReportTemplate, "sections"> | null,
): ReviewGroup[] {
  const specs = new Map((template?.sections ?? []).map((s) => [s.key, s]));
  const sections = new Map(report.sections.map((s) => [s.key, s]));

  if (!form || !report.form) {
    const questions = report.sections.map((section, i): ReviewQuestion => {
      const spec = specs.get(section.key) ?? null;
      return {
        key: section.key,
        section,
        field: null,
        spec,
        label: section.title,
        guidance: spec?.guidance ?? "",
        answerType: spec?.answerType ?? null,
        required: spec?.required ?? true,
        number: i + 1,
      };
    });
    return questions.length ? [{ id: "g-1", title: "Report sections", questions }] : [];
  }

  return formOutline(form.fields).map((g, gi): ReviewGroup => ({
    id: `g-${gi + 1}`,
    title: g.title,
    questions: g.entries.map(({ index: i, context }): ReviewQuestion => {
      const field = form.fields[i];
      return {
        key: field.id,
        section: sections.get(field.id) ?? null,
        field,
        spec: specs.get(field.id) ?? null,
        label: field.label,
        context,
        guidance: field.guidance,
        answerType: field.answerType,
        required: field.required,
        number: i + 1,
      };
    }),
  }));
}

/** Every question of the groups, in order. */
export function flattenQuestions(groups: ReviewGroup[]): ReviewQuestion[] {
  const out: ReviewQuestion[] = [];
  groups.forEach((g) => out.push(...g.questions));
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Status of a question
 * ----------------------------------------------------------------------------------------------*/

export type QuestionStatus =
  | "records"
  | "drafted"
  | "clinician"
  | "needs_input"
  | "confirm"
  | "blocked"
  | "pending"
  | "signoff"
  | "blank"
  | "left_blank"
  /** Fix round 1 (B0-22): a record line the record leaves empty on purpose (an address line it does not have). */
  | "record_empty";

export const QUESTION_STATUS_META: Record<QuestionStatus, { label: string; short: string; dot: string; text: string }> = {
  records: { label: "Filled from records", short: "From records", dot: "bg-teal-600", text: "text-teal-800" },
  drafted: { label: "Drafted from the notes", short: "Drafted", dot: "bg-sky-500", text: "text-sky-800" },
  clinician: { label: "Answered by the clinician", short: "Clinician", dot: "bg-indigo-500", text: "text-indigo-800" },
  needs_input: { label: "Needs clinician input", short: "Needs input", dot: "bg-amber-500", text: "text-amber-800" },
  confirm: { label: "Answered – confirm the gap", short: "Confirm", dot: "bg-amber-400 ring-2 ring-amber-200", text: "text-amber-800" },
  blocked: { label: "Blocked – check required", short: "Blocked", dot: "bg-red-600", text: "text-red-700" },
  pending: { label: "Not drafted yet", short: "Not drafted", dot: "border-2 border-slate-400 bg-white", text: "text-slate-600" },
  signoff: { label: "Filled on approval", short: "On approval", dot: "bg-slate-400", text: "text-slate-600" },
  blank: { label: "Left blank on the form", short: "Left blank", dot: "border border-dashed border-slate-400 bg-white", text: "text-slate-500" },
  left_blank: { label: "Left blank on approval", short: "Left blank", dot: "border border-dashed border-slate-400 bg-white", text: "text-slate-600" },
  record_empty: { label: "Left blank – nothing in the record", short: "Left blank (nothing in the record)", dot: "border border-dashed border-teal-500 bg-white", text: "text-slate-600" },
};

/** Legend order. */
export const QUESTION_STATUS_ORDER: QuestionStatus[] = ["records", "drafted", "clinician", "left_blank", "record_empty", "needs_input", "confirm", "blocked", "pending"];

/** Same rule as core/validation canSign: a blocking flag that still blocks approval. */
export function isOpenBlocking(flag: ReportFlag, gaps: readonly Gap[]): boolean {
  if (flag.severity !== "blocking" || flag.acknowledged) return false;
  if (flag.code === "OPEN_GAP" && flag.gapId) {
    const gap = gaps.find((g) => g.id === flag.gapId);
    if (gap?.resolution) return false;
  }
  return true;
}

export function groupBySection<T extends { sectionKey?: string }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    if (!item.sectionKey) continue;
    const list = out.get(item.sectionKey) ?? [];
    list.push(item);
    out.set(item.sectionKey, list);
  }
  return out;
}

/**
 * - pending: not drafted yet;
 * - signoff / blank: filled on approval / left for the referrer – or an optional box a person chose to leave blank
 *   (its gap or its "no answer" warning acknowledged, nothing open on it: fix 10/2026);
 * - needs_input: no answer yet (an opinion nobody recorded, a value the record lacks);
 * - left_blank: the report was approved without an answer here, so nothing is waiting for anyone;
 * - confirm: a person has answered it and only its gap is still open (one click: "Mark resolved");
 * - blocked: answered, but a blocking check or an open gap remains;
 * - records / drafted / clinician: answered and clear, by where the answer came from.
 */
export function questionStatus(
  q: Pick<ReviewQuestion, "section" | "field">,
  flags: readonly ReportFlag[],
  gaps: readonly Gap[],
  /** A person (not the drafting step) answered it (answeredByPerson). */
  byPerson = false,
  /** The report is approved (read-only). */
  approved = false,
  /** The report's sections, for conditional questions (fix round 1, B0-7). */
  conditionSections?: readonly ReportSection[],
): QuestionStatus {
  const section = q.section;
  if (!section) return "blank";
  if (section.kind === "declaration" && section.fieldId) return "signoff";
  // Fix round 1 (B0-7): not asked – the answer before it says it does not apply.
  if (conditionSections && notApplicable(conditionSections, section.key)) return approved ? "left_blank" : "blank";
  // Fix round 1 (B0-22): counted as left blank (as "Copy answers" says), not as filled from the records.
  if (isBlankByDesign(section, q.field) && !section.paragraphs.some((p) => p.text.trim() !== "")) return "record_empty";
  const answered = isSectionAnswered(section);
  if (!answered && approved) return "left_blank";
  if (section.status === "pending" && !answered) return "pending";
  if (!answered) return q.field?.required === false && leftBlankOnPurpose(section.key, flags, gaps) ? "blank" : "needs_input";
  const blockingFlags = flags.filter((f) => f.sectionKey === section.key && isOpenBlocking(f, gaps));
  const openGap = gaps.some((g) => g.sectionKey === section.key && !g.resolution);
  // Answered by a person and only the gap itself is open: not a failed check, just confirm it.
  if (openGap && byPerson && blockingFlags.every((f) => f.code === "OPEN_GAP")) return "confirm";
  if (blockingFlags.length > 0 || openGap) return "blocked";
  const origins = section.paragraphs.filter((p) => p.text.trim()).map((p) => p.origin);
  if (origins.every((o) => o === "from_records")) return section.kind === "from_records" || origins.length > 0 ? "records" : "clinician";
  if (origins.some((o) => o === "ai" || o === "edited")) return "drafted";
  return "clinician";
}

/** Nothing open on the box, and a person acknowledged its gap or its "optional and has no answer" warning. */
function leftBlankOnPurpose(key: string, flags: readonly ReportFlag[], gaps: readonly Gap[]): boolean {
  const own = gaps.filter((g) => g.sectionKey === key);
  if (own.some((g) => !g.resolution) || flags.some((f) => f.sectionKey === key && isOpenBlocking(f, gaps))) return false;
  return own.some((g) => g.resolution?.kind === "acknowledged") || flags.some((f) => f.sectionKey === key && f.evidence === "optional field blank" && Boolean(f.acknowledged));
}

export interface StatusCounts {
  total: number;
  counts: Record<QuestionStatus, number>;
}

export function countStatuses(statuses: readonly QuestionStatus[]): StatusCounts {
  const counts = { records: 0, drafted: 0, clinician: 0, needs_input: 0, confirm: 0, blocked: 0, pending: 0, signoff: 0, blank: 0, left_blank: 0, record_empty: 0 } as Record<QuestionStatus, number>;
  statuses.forEach((s) => (counts[s] += 1));
  return { total: statuses.length, counts };
}
