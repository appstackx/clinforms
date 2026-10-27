/**
 * What each box issues (bh2 WA1 design 1): ONE answer, worked out from the report's hashed content alone, that every
 * consumer reads – the forms fill (core/forms/answers.ts buildFormAnswers), Copy answers and the question summary
 * (core/answer-copy.ts), the review's statuses and counts (ui/components/review/status.ts), the approved summary, the
 * validators (core/validation/run.ts: a box's checks are dropped only when it issues nothing) and /sign and /render
 * (the issued document is bound to the receipt).
 *
 *   answer          the box prints this answer (text, a structured value or table rows), entered by `by`
 *   blank           the box prints nothing: left blank on purpose, no answer, or the record has nothing for it
 *   not_applicable  the box is not asked: its frozen condition rules it out, a session the patient did not attend, or
 *                   a person decided it does not apply
 *   signoff         filled from the receipt at approval
 *   referrer_use    left for the referrer's own use (the map's leave_blank)
 *
 * Rules:
 * - Only the report's CONTENT counts: flags, activity, status, updatedAt and the receipt are removed at run time
 *   before anything is read (issueContentOf), not only by type – so a forged flag, activity entry or status can never
 *   change what a box issues (R-security-1).
 * - Only people's decisions are stored (ReportSection.disposition, hashed): a person's "not applicable" (on a
 *   clinician's box: the approver's only), the approver's "applies anyway", and "left blank" (optional boxes only,
 *   B2-26). An answer cancels "left blank"; a change to a controlling answer since the decision (controllerSnapshot)
 *   cancels "applies anyway" and a person's "not applicable". Rule outcomes – a condition, a session not attended, a
 *   record line that is empty by design – are worked out each time and never stored.
 * - Conditions are read once, when the report is created, and frozen on the section (core/conditions.ts). A box with no
 *   frozen condition is an ordinary box: a report from before this release (no reportModel, no frozen condition) issues
 *   every box as production did, which never read a condition (bh2 fix round 1, R1T-WA1-01 – the earlier run-time
 *   reading of the printed questions is not applied to any report).
 * - The server decides which conditions a box has, never the report (harden-WA1, check2 N1): with the form map at hand,
 *   a report of this release reads the conditions the attested map's questions carry (core/conditions.ts
 *   mapConditions – what report creation froze on an honest report), whatever its sections hold; a built-in template's
 *   report has none (creation never freezes one there). Only a form report read without its map (a browser view
 *   without the map) reads the copy on its sections. A report presented as one from before this release (reportModel
 *   and the frozen conditions removed) only gets more checks: every box is then an ordinary box.
 * - "Approved" (sign-off values, every blank box printed blank) comes only from a verified receipt passed in by the
 *   caller – never from the report's own status.
 *
 * Pure; browser and server. Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { conditionFieldsOf, compileConditions, conditionOf, heldText, mapConditions, type Condition } from "./conditions";
import { answerToText, isBlankByDesign, isSectionAnswered } from "./forms/answers";
import { ISSUE_EXCLUDED_KEYS, type BoxState, type IssueExcludedKey, type IssueOutcomeCounts, type IssueState } from "./issue-types";
import { REPORT_MODEL } from "./schemas";
import type { Actor, ControllerSnapshot, FormAnswer, FormDefinition, FormField, Report, ReportSection, SectionDisposition, SignReceipt } from "./types";

/** What issueState reads: a report without the keys that never change what is issued. */
export type IssueContent = Pick<Report, "sections"> & Partial<Omit<Report, IssueExcludedKey | "sections">>;

/** The approval, from a VERIFIED receipt only (the sign-off values and "every blank box prints blank"). */
export type IssueApproval = Pick<SignReceipt, "signer" | "signedAt">;

type IssueForm = Pick<FormDefinition, "fields">;

/**
 * How a caller reads the boxes. `conditions`: "map" (the default with a form map – the server's reading of the attested
 * map) or "report" (the conditions as the sections hold them: only for a caller that passes a form with some of its
 * fields, such as one box's status, which cannot work the map's reading out).
 */
export interface IssueOptions {
  conditions?: "map" | "report";
  /**
   * The caller has a report's sections only (no reportModel at hand – one box's status from a list of sections): which
   * release made the report is then read from reportModel alone, as before (a list of sections says nothing about it).
   * Display only; the server always reads a whole report.
   */
  sectionsOnly?: boolean;
}

/**
 * The report without flags, activity, status, updatedAt and receipt – removed at run time (a forging client can send
 * any of them; none of them may change what is issued).
 */
export function issueContentOf<T extends object>(report: T): Omit<T, IssueExcludedKey> {
  const out: Record<string, unknown> = { ...(report as Record<string, unknown>) };
  for (const key of ISSUE_EXCLUDED_KEYS) delete out[key];
  return out as Omit<T, IssueExcludedKey>;
}

/**
 * A report made by this release (people's decisions stored, conditions frozen): Report.reportModel 2, or any section
 * carrying a frozen condition – only this release freezes them, so removing reportModel never turns a report of this
 * release into one from before it (harden-WA1, check2 N1).
 */
export function isReleaseModel(content: Pick<IssueContent, "reportModel"> & Partial<Pick<IssueContent, "sections">>): boolean {
  return (content.reportModel ?? 0) >= 2 || (content.sections ?? []).some((s) => Boolean(s.condition));
}

/**
 * A built-in template's report (no referrer's form): report creation never freezes a condition on one. ("form:" is
 * core/forms.ts FORM_TEMPLATE_PREFIX – not imported: core/forms.ts reads this file through core/forms/answers.ts.)
 */
function builtInTemplateReport(content: IssueContent): boolean {
  return typeof content.templateId === "string" && !content.templateId.startsWith("form:") && !content.form;
}

/**
 * The content the boxes are read from, with each section's condition as the SERVER reads it (see the file comment): a
 * report of this release with the form map – the map's conditions, at the reader version its frozen conditions name; a
 * built-in template's report – none. Otherwise the sections as they are. A report of this release stays one
 * (reportModel 2 on the copy read) even when the map gives it no condition.
 */
function serverReading(content: IssueContent, form: IssueForm | null, opts: IssueOptions): IssueContent {
  if (opts.sectionsOnly || !isReleaseModel(content)) return content;
  const release = { ...content, reportModel: Math.max(content.reportModel ?? 0, REPORT_MODEL) };
  if (form && opts.conditions !== "report") {
    const version = content.sections.find((s) => s.condition?.parser)?.condition?.parser;
    const conditions = mapConditions(form.fields, version);
    return { ...release, sections: content.sections.map((s) => withCondition(s, conditions.get(s.key))) };
  }
  if (!form && builtInTemplateReport(content)) return { ...release, sections: content.sections.map((s) => withCondition(s, undefined)) };
  return content;
}

function withCondition(section: ReportSection, condition: ReportSection["condition"]): ReportSection {
  if (condition) return section.condition === condition ? section : { ...section, condition };
  if (!section.condition) return section;
  const { condition: _dropped, ...rest } = section;
  void _dropped;
  return rest;
}

/* ------------------------------------------------------------------------------------------------
 * People's decisions (ReportSection.disposition)
 * ----------------------------------------------------------------------------------------------*/

const normText = (t: string) => t.normalize("NFKC").replace(/\s+/g, " ").trim();

/** One controlling answer, compared: a structured value by kind and value; a text box's text, whitespace aside. */
function answerKey(x: FormAnswer | undefined): string {
  if (x === undefined || x.value === null || x.value === undefined || x.value === "") return "∅";
  if (x.kind === "text") return typeof x.value === "string" && normText(x.value) ? `text:${normText(x.value)}` : "∅";
  return `${x.kind}:${JSON.stringify(x.value)}`;
}

/**
 * What a controlling box holds now, as a person's decision records it: its structured answer, else – a text box (the
 * B2-13 "filled" readings: "Only when a task is still limited") – the text it holds, drafted paragraphs included
 * (harden-WA1, check2 N4: a drafted text box keeps its text in paragraphs, not in `answer`).
 */
function controllerValue(section: ReportSection | undefined): FormAnswer | undefined {
  if (!section) return undefined;
  const a = section.answer;
  if (a && a.kind !== "text") return a.value === null || a.value === "" ? undefined : a;
  const text = normText(heldText(section));
  return text ? { kind: "text", value: text } : undefined;
}

/**
 * The controlling answers of `key` now – what a person's decision about it records (disposition.controllerSnapshot):
 * a structured answer, or a text box's text. `release`: the report was made by this release (isReleaseModel) – its
 * frozen conditions only.
 */
export function controllerSnapshotOf(sections: readonly ReportSection[], key: string, opts: { release?: boolean } = {}): ControllerSnapshot[] {
  const condition = conditionOf(sections, key, opts);
  if (!condition) return [];
  return condition.controllers.map((c) => {
    const value = controllerValue(sections.find((s) => s.key === c.key));
    return { sectionKey: c.key, ...(value ? { answer: value } : {}) };
  });
}

/**
 * Whether a controlling answer changed since the decision was taken (its snapshot no longer matches what the box holds
 * now – a text box's text included). A snapshot that recorded no text for a text box that holds some now counts as a
 * change: the decision is cancelled rather than kept on a guess.
 */
export function dispositionIsStale(disposition: Pick<SectionDisposition, "controllerSnapshot">, sections: readonly ReportSection[]): boolean {
  for (const snap of disposition.controllerSnapshot ?? []) {
    const now = sections.find((s) => s.key === snap.sectionKey);
    if (answerKey(snap.answer) !== answerKey(controllerValue(now))) return true;
  }
  return false;
}

/** The person is the report's approving clinician (Report.approver) and may approve. */
function byTheApprover(by: SectionDisposition["by"] | undefined, content: Pick<IssueContent, "approver">): boolean {
  return Boolean(by && content.approver && by.memberId === content.approver.memberId && by.role !== "staff" && by.canSign);
}

export type DispositionVerdict = "none" | "valid" | "stale" | "not_allowed" | "cancelled";

/**
 * A clinician's box: the attested form map says the physio answers it (fillSource clinician_opinion). The section's own
 * kind (report content a client could rewrite) counts only where there is no map (a built-in template's report).
 */
function isClinicianBox(section: ReportSection, field: Pick<FormField, "fillSource"> | null): boolean {
  if (field) return field.fillSource.kind === "clinician_opinion";
  return section.kind === "clinician_opinion";
}

/**
 * Whether a box's stored decision counts: "valid", or why not – "stale" (a controlling answer changed since),
 * "not_allowed" (applies anyway by anyone but the approver; not applicable on a clinician's box by anyone but the
 * approver; left blank on a required box), "cancelled" (left blank on a box that now has an answer).
 */
export function dispositionVerdict(
  content: IssueContent,
  section: ReportSection,
  field: (Pick<FormField, "required"> & Partial<Pick<FormField, "fillSource">>) | null,
  answered: boolean,
): DispositionVerdict {
  const d = section.disposition;
  if (!d) return "none";
  switch (d.kind) {
    case "left_blank":
      if (field?.required !== false) return "not_allowed";
      return answered ? "cancelled" : "valid";
    case "applies_anyway":
      if (!byTheApprover(d.by, content)) return "not_allowed";
      return dispositionIsStale(d, content.sections) ? "stale" : "valid";
    case "not_applicable":
      if (isClinicianBox(section, field?.fillSource ? { fillSource: field.fillSource } : null) && !byTheApprover(d.by, content)) return "not_allowed";
      return dispositionIsStale(d, content.sections) ? "stale" : "valid";
    default:
      return "not_allowed";
  }
}

/* ------------------------------------------------------------------------------------------------
 * One box
 * ----------------------------------------------------------------------------------------------*/

/** What a box issues, with why (for the fill, the validators and the review's wording). */
export interface BoxIssue {
  key: string;
  state: BoxState;
  /** The box's condition as evaluated now (null: an ordinary box). */
  condition: Condition | null;
  /** The box's condition was frozen at creation – since bh2 fix round 1 (R1T-WA1-01) the only kind of condition there is. */
  frozenCondition: boolean;
  /** The stored decision and whether it counts. */
  disposition: SectionDisposition | null;
  dispositionVerdict: DispositionVerdict;
  /** The box holds content a person wrote or chose (paragraph origin other than "ai"/"from_records", or a stamped answer). */
  personContent: boolean;
}

const SESSION_PATHS = new Set(["episode.attendedDate", "episode.attendedTime"]);

/** A record line that is empty by design is a session the patient did not attend (rather than an address line). */
function sessionNotAttended(field: Pick<FormField, "fillSource"> | null): boolean {
  return Boolean(field && field.fillSource.kind === "registration" && SESSION_PATHS.has(field.fillSource.path));
}

/** A person (not drafting, not the record) wrote or set something in this box. */
function holdsPersonContent(section: ReportSection): boolean {
  if ((section.paragraphs ?? []).some((p) => (p.text ?? "").trim() !== "" && p.origin !== "ai" && p.origin !== "from_records")) return true;
  return Boolean(section.answerBy && section.answer && section.answer.kind !== "text" && section.answer.value !== null && section.answer.value !== "");
}

/** Who entered the answer (the release's stamps; null when none is recorded). */
function answeredBy(section: ReportSection): Actor | null {
  if (section.answer && section.answer.kind !== "text" && section.answerBy) return section.answerBy;
  const last = [...section.paragraphs].reverse().find((p) => p.text.trim() !== "");
  return last?.by ?? null;
}

/**
 * A gap of the box was acknowledged as leaving it blank and nothing on it is open (content: gaps are hashed). Read for
 * every report, not only those from before the release (design 8 would keep it to them): the review's "Leave optional
 * boxes blank" still records its decision this way until it writes a left_blank disposition (WC). It only ever turns an
 * optional box's "no answer" into "left blank" – the FINAL copy is the same either way ({leftBlank: true}).
 */
function blankByAcknowledgement(content: IssueContent, key: string): boolean {
  const gaps = (content.gaps ?? []).filter((g) => g.sectionKey === key);
  if (gaps.length === 0 || gaps.some((g) => !g.resolution)) return false;
  return gaps.some((g) => g.resolution?.kind === "acknowledged" && g.resolution.leftBlank !== false);
}

function boxIssue(content: IssueContent, field: FormField | null, section: ReportSection | undefined, release: boolean): BoxIssue {
  const key = field?.id ?? section?.key ?? "";
  const base = { key, condition: null, frozenCondition: false, disposition: section?.disposition ?? null, dispositionVerdict: "none" as DispositionVerdict, personContent: section ? holdsPersonContent(section) : false };
  if (field?.fillSource.kind === "leave_blank") return { ...base, state: { kind: "referrer_use" } };
  if (field?.fillSource.kind === "signoff" || (section?.kind === "declaration" && section.fieldId)) return { ...base, state: { kind: "signoff" } };
  if (!section) return { ...base, state: { kind: "blank", reason: "no_answer" } };

  const blankByDesign = isBlankByDesign(section, field);
  const answered = isSectionAnswered({ paragraphs: section.paragraphs, answer: section.answer, blankFromRecords: blankByDesign });
  const verdict = dispositionVerdict(content, section, field, answered);
  const decided = verdict === "valid" ? section.disposition : null;
  // Only the conditions frozen when the report was created count (no run-time reading of the printed words, on any
  // report – R1T-WA1-01).
  const condition = conditionOf(content.sections, section.key, { release });
  const issue = { ...base, condition, frozenCondition: Boolean(condition?.frozen), dispositionVerdict: verdict };

  if (decided?.kind === "not_applicable") return { ...issue, state: { kind: "not_applicable", reason: "person" } };
  if (condition?.applies === false && decided?.kind !== "applies_anyway") return { ...issue, state: { kind: "not_applicable", reason: "condition" } };
  // An empty-by-design record line: a session the patient did not attend, or an address line the record does not have.
  if (blankByDesign && !section.paragraphs.some((p) => p.text.trim() !== "")) {
    return { ...issue, state: sessionNotAttended(field) ? { kind: "not_applicable", reason: "session_not_attended" } : { kind: "blank", reason: "record_empty" } };
  }
  if (!answered) {
    const leftBlank = decided?.kind === "left_blank" || (field?.required === false && blankByAcknowledgement(content, section.key));
    return { ...issue, state: { kind: "blank", reason: leftBlank ? "left_blank" : "no_answer" } };
  }
  const text = answerToText(section);
  const structured = section.answer && section.answer.kind !== "text" ? section.answer.value : undefined;
  const by = answeredBy(section);
  if (Array.isArray(structured)) return { ...issue, state: { kind: "answer", text, rows: structured, by } };
  return { ...issue, state: structured === undefined ? { kind: "answer", text, by } : { kind: "answer", text, value: structured as string | boolean | null, by } };
}

/* ------------------------------------------------------------------------------------------------
 * The whole report
 * ----------------------------------------------------------------------------------------------*/

/**
 * Every box with why it issues what it does, in form order (the form's fields, else the report's sections). The
 * report is stripped of flags, activity, status, updatedAt and the receipt first.
 */
export function issueDetails(report: IssueContent | Report, form: IssueForm | null, opts: IssueOptions = {}): BoxIssue[] {
  const content = serverReading(issueContentOf(report) as IssueContent, form, opts);
  const release = opts.sectionsOnly ? (content.reportModel ?? 0) >= REPORT_MODEL : isReleaseModel(content);
  const sections = new Map(content.sections.map((s) => [s.key, s]));
  if (form) return form.fields.map((field) => boxIssue(content, field, sections.get(field.id), release));
  return content.sections.map((section) => boxIssue(content, null, section, release));
}

/**
 * What each box issues (field id → BoxState). Pure: the same content and form give the same answer, whatever flags,
 * activity, status or updatedAt the report carries. `approval` (a verified receipt's signer and time, or null) does
 * not change any box's state: sign-off values and the approved form's blanks are the fill's (buildFormAnswers).
 */
export function issueState(content: IssueContent | Report, form: IssueForm | null, approval?: IssueApproval | null): IssueState {
  void approval;
  const out: IssueState = {};
  for (const box of issueDetails(content, form)) out[box.key] = box.state;
  return out;
}

/** One box's issue details (null when neither the form nor the report has it). */
export function boxIssueOf(report: IssueContent | Report, form: IssueForm | null, key: string): BoxIssue | null {
  return issueDetails(report, form).find((b) => b.key === key) ?? null;
}

/**
 * Why a box is not asked, in words, for its card ("“Is more treatment advised?” is “No”"), or null when it is
 * asked. A person's "not applicable" names who decided it; a session not attended says so.
 */
export function notApplicableBecause(report: IssueContent | Report, form: IssueForm | null, key: string): string | null {
  const box = boxIssueOf(report, form, key);
  return box ? reasonNotAsked(box) : null;
}

/** Why each box that is not asked is not asked (box key → the card's words) – the whole report worked out once. */
export function notApplicableReasons(report: IssueContent | Report, form: IssueForm | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const box of issueDetails(report, form)) {
    const why = reasonNotAsked(box);
    if (why) out.set(box.key, why);
  }
  return out;
}

function reasonNotAsked(box: BoxIssue): string | null {
  if (box.state.kind !== "not_applicable") return null;
  if (box.state.reason === "condition") return box.condition?.because || "the answer it depends on rules it out";
  if (box.state.reason === "session_not_attended") return "no attended session in the notes matches it";
  const by = box.disposition?.by?.name;
  return by ? `${by} decided it does not apply` : "a person decided it does not apply";
}

/** Count what the boxes issue; the counts add up to `total` (every field of the form, or every section). */
export function countOutcomes(state: IssueState): IssueOutcomeCounts {
  const counts: IssueOutcomeCounts = { answered: 0, notApplicable: 0, leftBlank: 0, recordEmpty: 0, noAnswer: 0, referrerUse: 0, signoff: 0, total: 0 };
  for (const s of Object.values(state)) {
    counts.total += 1;
    switch (s.kind) {
      case "answer":
        counts.answered += 1;
        break;
      case "not_applicable":
        counts.notApplicable += 1;
        break;
      case "signoff":
        counts.signoff += 1;
        break;
      case "referrer_use":
        counts.referrerUse += 1;
        break;
      case "blank":
        if (s.reason === "left_blank") counts.leftBlank += 1;
        else if (s.reason === "record_empty") counts.recordEmpty += 1;
        else counts.noAnswer += 1;
        break;
    }
  }
  return counts;
}

/** The boxes a code in the form clears when filled (core/merge-fields.ts): answered, sign-off, ruled out, empty by design. */
export function clearsItsPlaceholder(box: BoxIssue): boolean {
  const s = box.state;
  if (s.kind === "answer" || s.kind === "signoff") return true;
  // A box ruled out by a frozen condition (the only kind there is – R1T-WA1-01), a person's decision or a session not
  // attended prints nothing: the fill removes what is printed in its place.
  if (s.kind === "not_applicable") return s.reason !== "condition" || box.frozenCondition;
  return s.kind === "blank" && s.reason === "record_empty";
}

/**
 * Drafts migrate on load (WA1 design 8): a report from before this release that is still a draft gets its conditions
 * frozen from the form map and becomes a release report (reportModel 2). Its people's decisions start from here (the
 * earlier inference is not carried over: nothing was approved yet). An approved report, or one this release made, is
 * returned unchanged.
 */
export function migrateDraftToReleaseModel<R extends Report>(report: R, form: Pick<FormDefinition, "fields"> | null): R {
  if (isReleaseModel(report) || report.status === "signed" || report.receipt || !form) return report;
  // Exactly as report creation reads them (core/conditions.ts conditionFieldsOf).
  const conditions = compileConditions(conditionFieldsOf(form.fields));
  const sections = report.sections.map((s) => {
    if (s.condition || !s.fieldId) return s;
    const condition = conditions.get(s.key);
    return condition ? { ...s, condition } : s;
  });
  return { ...report, sections, reportModel: REPORT_MODEL };
}
