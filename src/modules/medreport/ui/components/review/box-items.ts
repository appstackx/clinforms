/**
 * What still blocks approval, one item per question (fix 10/2026, Blue Heart test run findings 2 and 3) – pure, no
 * React. The approval gate itself is unchanged: core/validation canSign() decides; this only groups its blocking list
 * for the review screen and its counts.
 *
 * - One item per box: a question's open gaps and the checks its own answer clears – "required and has no answer",
 *   "optional and has no answer", and a mail-merge field that only this question replaces – are one item with one
 *   plain instruction ("Type 10Bridge's reference from their letter"). Every other check stays an item of its own.
 *   The item stays (and approval stays blocked) until the gap is closed and the answer is there.
 * - Required and optional: items on optional questions are counted and listed apart from the rest.
 * - "Leave optional boxes blank": optional questions that are simply blank – drafted, no answer and no text, nothing
 *   on them but open gaps and the "optional and has no answer" warning – are acknowledged in one action with one
 *   reason. Each gap and each warning is acknowledged exactly as a single acknowledgement is (resolveGap /
 *   acknowledgeFlag: on the report, so in the approved content, and one activity entry each). Never included:
 *   required questions, questions that ask for the clinician's opinion (their gaps are clinical decisions), a box
 *   the draft proposed an answer for that was held back, and any box with another check (a mail-merge field, opinion
 *   wording, a figure…).
 *
 * Owner: studio-b agent.
 */
import { answerKindFor, isBlankByDesign, isSectionAnswered } from "../../../core/forms";
import { showsReferrerReferenceNotice } from "../../../core/form-record-rules";
import { findMergeTokens, practiceCodeInWords, unresolvedMergeFields } from "../../../core/merge-fields";
import type { FormAnswer, FormDefinition, FormField, Gap, Report, ReportFlag, ReportSection, ReportTemplate } from "../../../core/types";
import { canSign, validateReport } from "../../../core/validation";
import { MIN_GAP_REASON, acknowledgeFlag, answeredByPerson, resolveGap } from "./review-model";

/** The validators' evidence for "required and has no answer" / "optional and has no answer" (validation/placeholders.ts). */
const NO_ANSWER = "empty section";
const OPTIONAL_BLANK = "optional field blank";
/** The validators' evidence prefix for a mail-merge field left on the form (validation/merge-fields.ts). */
const MERGE = "mail-merge field ";

export interface BoxItem {
  /** The question (section key). */
  key: string;
  label: string;
  required: boolean;
  answered: boolean;
  /** Open gaps on the question. */
  gaps: Gap[];
  /** The checks this item stands for (they clear when the question is answered); not listed separately. */
  covered: ReportFlag[];
  /** "Required – no answer yet", "Optional – needs your opinion", … */
  heading: string;
  /** What to do, in one sentence. */
  instruction: string;
}

export type ReviewItem = { type: "box"; key: string; box: BoxItem } | { type: "flag"; key: string | null; flag: ReportFlag };

export interface ReviewItems {
  /** Items on required questions and every other blocking check (report order; whole-report checks last). */
  required: ReviewItem[];
  /** Items on optional questions. */
  optional: ReviewItem[];
  /** The box items, by question. */
  boxes: Map<string, BoxItem>;
  /** Flags shown inside a box item (by flag ID), so the screen does not list them again. */
  coveredIds: Set<string>;
  count: number;
}

export interface BoxContext {
  template: Pick<ReportTemplate, "sections"> | null;
  form: Pick<FormDefinition, "analysis" | "fields"> | null;
}

/* ------------------------------------------------------------------------------------------------
 * Grouping
 * ----------------------------------------------------------------------------------------------*/

/** As the validators decide it: a referrer form's question by its map; a built-in report's section always. */
function isRequired(section: Pick<ReportSection, "key" | "fieldId">, ctx: BoxContext): boolean {
  if (!section.fieldId) return true;
  return ctx.template?.sections.find((s) => s.key === section.key)?.required ?? true;
}

function answeredByRules(section: ReportSection, field: FormField | undefined): boolean {
  // The same rule the validators use (validation/placeholders.ts).
  return isSectionAnswered({ paragraphs: section.paragraphs ?? [], answer: section.answer, blankFromRecords: isBlankByDesign(section, field) });
}

/** The section as if a person had answered it (to see which mail-merge fields its answer clears). */
function asAnswered(section: ReportSection): ReportSection {
  const kind = section.answer?.kind;
  const value: FormAnswer["value"] = kind === "rows" ? [{ answer: "x" }] : kind === "yes_no" || kind === "checkbox" ? true : "x";
  return {
    ...section,
    blankFromRecords: false,
    paragraphs: [{ id: `${section.key}-probe`, text: "x", sourceIds: [], origin: "clinician" }],
    ...(kind && kind !== "text" && { answer: { kind, value } }),
  };
}

const mergeEvidence = (m: { text: string; where: string }) => `${MERGE}${m.text} in ${m.where}`;

/**
 * Which unanswered question each mail-merge field left on the form is cleared by: the one question whose answer alone
 * removes it (evidence → question key). A field that no single answer clears is not listed.
 */
function mergeOwners(report: Report, form: BoxContext["form"]): Map<string, string> {
  const owners = new Map<string, string>();
  if (!form?.analysis.mergeFields?.length) return owners;
  const before = unresolvedMergeFields(form, report).filter((m) => !m.fixed);
  if (before.length === 0) return owners;
  const fields = new Map(form.fields.map((f) => [f.id, f]));
  for (const section of report.sections) {
    const field = fields.get(section.key);
    if (!field || section.kind === "declaration" || answeredByRules(section, field)) continue;
    const after = new Set(unresolvedMergeFields(form, { sections: report.sections.map((s) => (s === section ? asAnswered(s) : s)) }).map(mergeEvidence));
    for (const m of before) if (!after.has(mergeEvidence(m)) && !owners.has(mergeEvidence(m))) owners.set(mergeEvidence(m), section.key);
  }
  return owners;
}

/** The question a blocking check belongs to when the question's own answer (or gap) clears it; null otherwise. */
function boxOf(flag: ReportFlag, owners: Map<string, string>): string | null {
  if (flag.code === "OPEN_GAP") return flag.sectionKey ?? null;
  if (flag.code !== "MISSING_PLACEHOLDER" || flag.paragraphId) return null;
  if (flag.evidence === NO_ANSWER) return flag.sectionKey ?? null;
  if (flag.evidence?.startsWith(MERGE)) return owners.get(flag.evidence) ?? null;
  return null;
}

/**
 * The review screen's list of what blocks approval: canSign()'s blocking checks, grouped one item per question where
 * the question's answer or gap clears them. `count` is 0 exactly when canSign() allows approval.
 */
export function reviewItems(report: Report, ctx: BoxContext): ReviewItems {
  const { blocking } = canSign(report.flags ?? [], report.gaps ?? []);
  const sections = new Map(report.sections.map((s, i) => [s.key, { s, i }]));
  const fields = new Map((ctx.form?.fields ?? []).map((f) => [f.id, f]));
  const owners = blocking.some((f) => f.evidence?.startsWith(MERGE)) ? mergeOwners(report, ctx.form) : new Map<string, string>();
  const gapsById = new Map((report.gaps ?? []).map((g) => [g.id, g]));

  const boxes = new Map<string, BoxItem>();
  const order: Array<{ item: ReviewItem; rank: number; seq: number }> = [];
  const coveredIds = new Set<string>();
  blocking.forEach((flag, seq) => {
    const key = boxOf(flag, owners);
    const at = key ? sections.get(key) : undefined;
    if (!key || !at) {
      const rank = flag.sectionKey !== undefined ? (sections.get(flag.sectionKey)?.i ?? 9_999) : 10_000;
      order.push({ item: { type: "flag", key: flag.sectionKey ?? null, flag }, rank, seq });
      return;
    }
    let box = boxes.get(key);
    if (!box) {
      box = { key, label: at.s.title, required: isRequired(at.s, ctx), answered: answeredByRules(at.s, fields.get(key)), gaps: [], covered: [], heading: "", instruction: "" };
      boxes.set(key, box);
      order.push({ item: { type: "box", key, box }, rank: at.i, seq });
    }
    const gap = flag.code === "OPEN_GAP" && flag.gapId ? gapsById.get(flag.gapId) : undefined;
    if (gap) {
      if (!box.gaps.includes(gap)) box.gaps.push(gap);
    } else {
      box.covered.push(flag);
    }
    coveredIds.add(flag.id);
  });

  // An optional question's "has no answer" warning is part of its item while the item blocks.
  for (const flag of report.flags ?? []) {
    const box = flag.sectionKey ? boxes.get(flag.sectionKey) : undefined;
    if (box && !flag.acknowledged && !flag.paragraphId && flag.code === "MISSING_PLACEHOLDER" && flag.evidence === OPTIONAL_BLANK) {
      box.covered.push(flag);
      coveredIds.add(flag.id);
    }
  }

  boxes.forEach((box) => {
    const at = sections.get(box.key);
    if (at) Object.assign(box, describeBox(box, at.s, fields.get(box.key), report));
  });

  order.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  const required: ReviewItem[] = [];
  const optional: ReviewItem[] = [];
  for (const { item } of order) (item.type === "box" && !item.box.required ? optional : required).push(item);
  return { required, optional, boxes, coveredIds, count: order.length };
}

/* ------------------------------------------------------------------------------------------------
 * Wording
 * ----------------------------------------------------------------------------------------------*/

function answerVerb(field: FormField | undefined): { verb: string; opinion: string } {
  const kind = field ? answerKindFor(field.answerType) : "text";
  if (kind === "yes_no" || kind === "checkbox" || kind === "choice") return { verb: "Choose the answer", opinion: "choose your own answer" };
  if (kind === "date") return { verb: "Enter the date", opinion: "enter the date yourself" };
  if (kind === "number") return { verb: "Enter the number", opinion: "enter the number yourself" };
  if (kind === "rows") return { verb: "Fill in the rows", opinion: "fill in the rows yourself" };
  return { verb: "Write the answer", opinion: "write your own opinion" };
}

/** The heading and the one instruction of a question's item, in plain words. */
function describeBox(box: BoxItem, section: ReportSection, field: FormField | undefined, report: Report): Pick<BoxItem, "heading" | "instruction"> {
  const req = box.required ? "Required" : "Optional";
  const { verb, opinion } = answerVerb(field);
  if (box.answered) {
    return answeredByPerson(report, box.key)
      ? { heading: `${req} – confirm your answer`, instruction: "Check your answer, then click Mark resolved." }
      : { heading: `${req} – check the gap`, instruction: "Check the answer against the notes, then resolve or acknowledge the gap." };
  }
  const merge = box.covered.find((f) => f.evidence?.startsWith(MERGE));
  if (merge && !box.required) {
    const words = practiceCodeInWords(findMergeTokens(merge.evidence ?? "")[0] ?? "") ?? "a mail-merge field";
    return { heading: "Optional, but must be filled in", instruction: `Fill it in: leaving it blank would leave ${words} on the form.` };
  }
  if (section.status === "pending") return { heading: `${req} – not drafted yet`, instruction: "Draft it from the notes, or answer it yourself." };
  if (section.kind === "from_records") {
    const referrer = report.form?.referrer.name ?? null;
    const path = field?.fillSource.kind === "registration" ? field.fillSource.path : null;
    if (box.gaps.some((g) => g.id.endsWith("-referrer")) || (path && showsReferrerReferenceNotice(path, referrer, report.bundleSnapshot))) {
      return { heading: `${req} – no answer yet`, instruction: `Type ${referrer ? `${referrer}'s` : "the referrer's"} reference from their letter.` };
    }
    return { heading: `${req} – no answer yet`, instruction: `${verb === "Write the answer" ? "Type it" : verb} from your own records – the clinic record does not hold it.` };
  }
  if (section.kind === "clinician_opinion") {
    return box.required
      ? { heading: "Required – needs your opinion", instruction: `Only you can answer this: ${opinion}.` }
      : { heading: "Optional – needs your opinion", instruction: `Only you can answer this: ${opinion}, or acknowledge the gap with a reason to leave it blank.` };
  }
  return box.required
    ? { heading: "Required – no answer yet", instruction: `${verb} yourself – the notes do not settle it.` }
    : { heading: "Optional – no answer yet", instruction: "Answer it if you can, or leave it blank." };
}

/** One line per item for the approve button's tooltip ("F-01 Case Reference: Type …"). */
export function reviewItemLines(items: ReviewItems, report: Pick<Report, "sections">, max = 6): string[] {
  const titles = new Map(report.sections.map((s) => [s.key, s.title]));
  const all = [...items.required, ...items.optional];
  const lines = all.slice(0, max).map((it) => {
    const key = it.key;
    const where = key ? `${key.startsWith("F-") ? `${key} ` : ""}${titles.get(key) ?? ""}`.trim() : "Whole report";
    return `${where}: ${it.type === "box" ? it.box.instruction : it.flag.message}`;
  });
  if (all.length > max) lines.push(`…and ${all.length - max} more.`);
  return lines;
}

/* ------------------------------------------------------------------------------------------------
 * "Leave optional boxes blank"
 * ----------------------------------------------------------------------------------------------*/

export interface BlankCandidate {
  key: string;
  label: string;
  /** Open gaps acknowledged by the action. */
  gaps: Gap[];
  /** The "optional and has no answer" warning acknowledged by the action, when it is open. */
  warning: ReportFlag | null;
}

/** A gap where the draft proposed an answer that was held back (core: ai/assemble.ts "-fit", "-choice"): a person decides. */
function heldBackAnswer(gap: Gap): boolean {
  return /-(?:fit|choice)$/.test(gap.id);
}

/**
 * The optional questions "Leave optional boxes blank" may acknowledge, in report order (see the file comment). Reads
 * `report.flags` as they are: leaveOptionalBoxesBlank() re-runs the validators first.
 */
export function optionalBlankCandidates(report: Report, ctx: BoxContext): BlankCandidate[] {
  if (report.status === "signed") return [];
  const fields = new Map((ctx.form?.fields ?? []).map((f) => [f.id, f]));
  const out: BlankCandidate[] = [];
  for (const section of report.sections) {
    if (!section.fieldId || section.kind === "declaration" || section.kind === "clinician_opinion" || section.status === "pending") continue;
    const field = fields.get(section.key);
    if (isRequired(section, ctx) || field?.required !== false) continue;
    if (answeredByRules(section, field) || section.paragraphs.some((p) => p.text.trim() !== "")) continue;
    const flags = (report.flags ?? []).filter((f) => f.sectionKey === section.key && !f.acknowledged);
    const warning = flags.find((f) => f.code === "MISSING_PLACEHOLDER" && f.evidence === OPTIONAL_BLANK && !f.paragraphId) ?? null;
    if (flags.some((f) => f !== warning && f.code !== "OPEN_GAP")) continue;
    const gaps = (report.gaps ?? []).filter((g) => g.sectionKey === section.key && !g.resolution);
    if (gaps.some(heldBackAnswer)) continue;
    if (gaps.length === 0 && !warning) continue;
    out.push({ key: section.key, label: section.title, gaps, warning });
  }
  return out;
}

/**
 * Acknowledging the gap of an optional question that has no answer is deciding to leave it blank: the same reason also
 * acknowledges its "optional and has no answer" warning (as "Leave optional boxes blank" does), so the person is not
 * asked twice. Anything else is returned unchanged.
 */
export function acknowledgeGapLeavingBlank(report: Report, gapId: string, reason: string, actor: string, now?: Date): Report {
  const gap = report.gaps.find((g) => g.id === gapId);
  const next = resolveGap(report, gapId, "acknowledged", reason, actor, now);
  const section = gap ? next.sections.find((s) => s.key === gap.sectionKey) : undefined;
  // Flags can be a moment behind an edit: never on a box that has an answer now.
  if (!gap || !section || next === report || answeredByRules(section, undefined)) return next;
  const warning = next.flags.find((f) => f.sectionKey === gap.sectionKey && !f.paragraphId && !f.acknowledged && f.code === "MISSING_PLACEHOLDER" && f.evidence === OPTIONAL_BLANK);
  return warning ? acknowledgeFlag(next, warning.id, reason, actor, now) : next;
}

/** The reason "Leave optional boxes blank" starts with (the person may change it). */
export const LEAVE_BLANK_REASON = "Optional on the form – left blank.";

/**
 * Acknowledge the chosen optional questions' gaps and warnings with one reason (at least MIN_GAP_REASON characters).
 * Re-runs the validators first and re-checks every question, so nothing outside optionalBlankCandidates() is ever
 * acknowledged – whatever `keys` says. A signed report, or a short reason, is returned unchanged.
 */
export function leaveOptionalBoxesBlank(
  report: Report,
  input: { template: ReportTemplate; form: FormDefinition | null; keys: readonly string[]; reason: string; actor: string; now?: Date },
): Report {
  const reason = input.reason.trim();
  if (report.status === "signed" || reason.length < MIN_GAP_REASON || !input.actor.trim()) return report;
  const { flags } = validateReport(report, input.template, { form: input.form });
  const fresh: Report = { ...report, flags };
  const chosen = new Set(input.keys);
  const candidates = optionalBlankCandidates(fresh, { template: input.template, form: input.form }).filter((c) => chosen.has(c.key));
  if (candidates.length === 0) return report;
  let next = fresh;
  for (const c of candidates) {
    for (const gap of c.gaps) next = resolveGap(next, gap.id, "acknowledged", reason, input.actor, input.now);
    if (c.warning) next = acknowledgeFlag(next, c.warning.id, reason, input.actor, input.now);
  }
  return next;
}
