/**
 * Review workspace model (pure, no React): how the review screen groups and labels questions, derives
 * each question's status, summarises how the report was drafted, and applies the clinician's edits.
 *
 * Every edit is immutable and bumps `updatedAt`. The validators (core/validation) re-run on the result
 * in the screen; nothing here decides whether a report can be approved.
 *
 * Owner: studio-b agent.
 */
import { inOwnClinicalWording, isOwnVoiceCandidate } from "../../../core/voice";
import { formatUkDate, formatUkDayMonth, nowIso } from "../../../core/dates";
import { answerKindFor, answerToText, isSectionAnswered, parseFormAnswerValue } from "../../../core/forms";
import { appendActivity } from "../../../core/report-factory";
import { WORDING } from "../../wording";
import type {
  ActivityEntry,
  AnswerType,
  ConnectorId,
  EpisodeBundle,
  FormDefinition,
  FormField,
  Gap,
  GenerationMeta,
  Paragraph,
  ParagraphOrigin,
  Report,
  ReportFlag,
  ReportSection,
  ReportTemplate,
  SignReceipt,
  TemplateSection,
} from "../../../core/types";

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

const UNTITLED_GROUP = "Form questions";

/**
 * The questions in form order, grouped by the form's own headings. A field whose "section" is the label
 * of an earlier question (a sub-question such as "If modified duties, please give details") stays in
 * that question's group; consecutive fields with no heading share one group. Fields left blank for the
 * referrer's use are included (no section) so every question on the form is accounted for.
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

  const groups: ReviewGroup[] = [];
  const groupOfLabel = new Map<string, ReviewGroup>();
  let current: ReviewGroup | null = null;
  form.fields.forEach((field, i) => {
    const heading = field.section?.trim() || "";
    const parentGroup = heading ? groupOfLabel.get(heading.toLowerCase()) : undefined;
    let group: ReviewGroup;
    let context: string | undefined;
    if (parentGroup) {
      group = parentGroup;
      context = heading;
    } else if (heading) {
      group = current && current.title === heading ? current : { id: `g-${groups.length + 1}`, title: heading, questions: [] };
    } else {
      group = current && current.title === UNTITLED_GROUP ? current : { id: `g-${groups.length + 1}`, title: UNTITLED_GROUP, questions: [] };
    }
    if (groups.indexOf(group) < 0) groups.push(group);
    current = group;
    const section = sections.get(field.id) ?? null;
    const spec = specs.get(field.id) ?? null;
    group.questions.push({
      key: field.id,
      section,
      field,
      spec,
      label: field.label,
      context,
      guidance: field.guidance,
      answerType: field.answerType,
      required: field.required,
      number: i + 1,
    });
    groupOfLabel.set(field.label.trim().toLowerCase(), group);
  });
  return groups;
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
  | "blank";

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
};

/** Legend order. */
export const QUESTION_STATUS_ORDER: QuestionStatus[] = ["records", "drafted", "clinician", "needs_input", "confirm", "blocked", "pending"];

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
 * - signoff / blank: filled on approval / left for the referrer;
 * - needs_input: no answer yet (an opinion nobody recorded, a value the record lacks);
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
): QuestionStatus {
  const section = q.section;
  if (!section) return "blank";
  if (section.kind === "declaration" && section.fieldId) return "signoff";
  if (section.status === "pending" && !isSectionAnswered(section)) return "pending";
  const answered = isSectionAnswered(section);
  if (!answered) return "needs_input";
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

export interface StatusCounts {
  total: number;
  counts: Record<QuestionStatus, number>;
}

export function countStatuses(statuses: readonly QuestionStatus[]): StatusCounts {
  const counts = { records: 0, drafted: 0, clinician: 0, needs_input: 0, confirm: 0, blocked: 0, pending: 0, signoff: 0, blank: 0 } as Record<QuestionStatus, number>;
  statuses.forEach((s) => (counts[s] += 1));
  return { total: statuses.length, counts };
}

/* ------------------------------------------------------------------------------------------------
 * Generation badge (honest provenance)
 * ----------------------------------------------------------------------------------------------*/

export interface GenerationSummary {
  label: string;
  tone: "live" | "recorded" | "prewritten" | "none";
  /** One line per drafted group, e.g. "F-07, F-08 · drafted 06/10/2026 21:04 · 6 s" (core/wording.ts). */
  lines: string[];
}

function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s >= 90 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/**
 * The generation badge: "Drafted from the notes in 34 s" (wall time from the first call's start to
 * the last call's end) / "Prepared demo draft (DD/MM/YYYY)" / "Sample draft (demo)" – customer-facing
 * wording from core/wording.ts. Null when nothing has been drafted.
 */
export function generationSummary(generation: readonly GenerationMeta[]): GenerationSummary | null {
  if (generation.length === 0) return null;
  const w = WORDING.generation;
  const lines = generation.map((g) =>
    w.line(
      {
        sectionKeys: g.sectionKeys,
        mode: g.mode,
        at: g.mode === "demo_recorded" ? g.recordedAt ?? g.at : g.at,
        durationMs: g.durationMs,
        model: g.model,
        tokens: g.usage ? g.usage.inputTokens + g.usage.outputTokens : undefined,
      },
      seconds,
    ),
  );
  const live = generation.filter((g) => g.mode === "live");
  const recorded = generation.filter((g) => g.mode === "demo_recorded");
  const others = (n: number) => (n > 0 ? ` (+${n} other group${n === 1 ? "" : "s"})` : "");
  if (live.length > 0) {
    const starts = live.map((g) => Date.parse(g.at)).filter((n) => !Number.isNaN(n));
    const ends = live
      .filter((g) => g.durationMs !== undefined)
      .map((g) => Date.parse(g.at) + (g.durationMs ?? 0))
      .filter((n) => !Number.isNaN(n));
    const wall = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null;
    return {
      label: `${w.live(wall !== null && wall > 0 ? seconds(wall) : null)}${others(generation.length - live.length)}`,
      tone: "live",
      lines,
    };
  }
  if (recorded.length > 0) {
    const dates = recorded.map((g) => g.recordedAt ?? g.at).sort();
    return { label: `${w.recorded(formatUkDate(dates[dates.length - 1]))}${others(generation.length - recorded.length)}`, tone: "recorded", lines };
  }
  return { label: w.prewritten, tone: "prewritten", lines };
}

/* ------------------------------------------------------------------------------------------------
 * Labels: origins and citations
 * ----------------------------------------------------------------------------------------------*/

/** Origin pill text. From-records answers name the clinic system they came from. */
export function originLabel(origin: ParagraphOrigin, connectorId: ConnectorId): string {
  switch (origin) {
    case "from_records":
      return connectorId === "file-import" ? "From clinic records" : "From TM3 records";
    case "ai":
      return WORDING.origin.drafted;
    case "edited":
      return "Edited";
    case "clinician":
      return "Clinician";
  }
}

export const ORIGIN_PILL_CLASSES: Record<ParagraphOrigin, string> = {
  from_records: "border-teal-200 bg-teal-50 text-teal-800",
  ai: "border-sky-200 bg-sky-50 text-sky-800",
  edited: "border-violet-200 bg-violet-50 text-violet-800",
  clinician: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

export type SourceKind = "note" | "fact" | "registration" | "unknown";

export function sourceKind(id: string): SourceKind {
  if (id === "REG") return "registration";
  if (/^N-\d{3,}$/.test(id)) return "note";
  if (/^FACT-/.test(id)) return "fact";
  return "unknown";
}

/** Chip text: "N-003 · 21/03", "FACT-attendance", "REG". */
export function citationLabel(id: string, bundle: Pick<EpisodeBundle, "notes">): string {
  const kind = sourceKind(id);
  if (kind === "note") {
    const note = bundle.notes.find((n) => n.id === id);
    return note ? `${id} · ${formatUkDayMonth(note.date)}` : id;
  }
  // Plain words for the record's other sources (the internal ID stays in the chip's accessible name).
  if (kind === "registration") return "Registration";
  if (kind === "fact") {
    if (id === "FACT-attendance") return "Attendance record";
    if (id === "FACT-age") return "Age";
    if (id === "FACT-episode") return "Episode dates";
    const instrument = /^FACT-outcomes-(.+)$/.exec(id)?.[1];
    if (instrument) return `${instrument} scores`;
  }
  return id;
}

/** Accessible name for a citation chip. */
export function citationAriaLabel(id: string, bundle: Pick<EpisodeBundle, "notes">): string {
  const kind = sourceKind(id);
  if (kind === "note") {
    const note = bundle.notes.find((n) => n.id === id);
    return note ? `Source ${id}: note of ${formatUkDate(note.date)} by ${note.author.name}. Show in Sources.` : `Source ${id} (not in this record)`;
  }
  if (kind === "fact") return `Source ${id}: computed from the record. Show in Sources.`;
  if (kind === "registration") return "Source REG: registration details. Show in Sources.";
  return `Unknown source ${id}`;
}

/** Where each source is cited: source ID → section keys, in report order, de-duplicated. */
export function citationsBySource(report: Pick<Report, "sections">): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const section of report.sections) {
    for (const p of section.paragraphs) {
      for (const id of p.sourceIds) {
        const list = out.get(id) ?? [];
        if (list.indexOf(section.key) < 0) list.push(section.key);
        out.set(id, list);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Structured answers: options shown to the reviewer
 * ----------------------------------------------------------------------------------------------*/

export interface AnswerOption {
  /** Shown and written text. */
  label: string;
  value: string | boolean;
}

/** The radio options of a yes/no or single-choice question (as printed where the form prints them). */
export function answerOptions(field: Pick<FormField, "answerType" | "options">): AnswerOption[] {
  const kind = answerKindFor(field.answerType);
  if (kind === "yes_no") {
    const printed = field.options?.length ? field.options : ["Yes", "No"];
    const out: AnswerOption[] = [];
    for (const label of printed) {
      const parsed = parseFormAnswerValue(field, label);
      if (typeof parsed.value === "boolean" && !out.some((o) => o.value === parsed.value)) out.push({ label, value: parsed.value });
    }
    if (!out.some((o) => o.value === true)) out.unshift({ label: "Yes", value: true });
    if (!out.some((o) => o.value === false)) out.push({ label: "No", value: false });
    return out;
  }
  if (kind === "choice") return (field.options ?? []).map((o) => ({ label: o, value: o }));
  return [];
}

/* ------------------------------------------------------------------------------------------------
 * Edits (immutable; each bumps updatedAt)
 * ----------------------------------------------------------------------------------------------*/

function touch(report: Report, sections: ReportSection[], now?: Date): Report {
  return { ...report, sections, updatedAt: nowIso(now) };
}

function settleStatus(section: ReportSection): ReportSection["status"] {
  if (isSectionAnswered(section)) return section.status === "drafted" ? "drafted" : "complete";
  return section.status === "pending" ? "pending" : "needs_input";
}

function mapSection(report: Report, key: string, fn: (s: ReportSection) => ReportSection): ReportSection[] {
  return report.sections.map((s) => {
    if (s.key !== key) return s;
    const next = fn(s);
    return next === s ? s : { ...next, status: settleStatus(next) };
  });
}

/**
 * Change a paragraph's text. AI text becomes "edited" (its first wording is kept in `originalText`, so
 * it can be reverted); typing it back exactly reverts it to "ai". A changed paragraph loses any
 * acknowledgement reason (the clinician re-acknowledges the new wording). From-records text is locked.
 */
export function editParagraph(report: Report, key: string, paragraphId: string, text: string, now?: Date): Report {
  let changed = false;
  const sections = mapSection(report, key, (s) => {
    const paragraphs = s.paragraphs.map((p): Paragraph => {
      if (p.id !== paragraphId || p.text === text || p.origin === "from_records") return p;
      changed = true;
      const next: Paragraph = { ...p, text };
      delete next.ackReason;
      if (p.origin === "ai") {
        next.origin = "edited";
        next.originalText = p.originalText ?? p.text;
      } else if (p.origin === "edited" && p.originalText !== undefined && text === p.originalText) {
        next.origin = "ai";
      }
      return next;
    });
    return changed ? { ...s, paragraphs } : s;
  });
  return changed ? touch(report, sections, now) : report;
}

/** Put an edited paragraph back to the AI's wording. */
export function revertParagraph(report: Report, key: string, paragraphId: string, now?: Date): Report {
  let changed = false;
  const sections = mapSection(report, key, (s) => {
    const paragraphs = s.paragraphs.map((p): Paragraph => {
      if (p.id !== paragraphId || p.origin !== "edited" || p.originalText === undefined) return p;
      changed = true;
      const next: Paragraph = { ...p, text: p.originalText, origin: "ai" };
      delete next.ackReason;
      return next;
    });
    return changed ? { ...s, paragraphs } : s;
  });
  return changed ? touch(report, sections, now) : report;
}

/** The ID the next clinician paragraph of this section gets ("F-14-c1", "F-14-c2"…). */
export function nextClinicianParagraphId(section: Pick<ReportSection, "key" | "paragraphs">): string {
  let n = section.paragraphs.length + 1;
  const taken = new Set(section.paragraphs.map((p) => p.id));
  while (taken.has(`${section.key}-c${n}`)) n += 1;
  return `${section.key}-c${n}`;
}

/** A new paragraph written by the clinician (origin "clinician", no citations needed). */
export function addClinicianParagraph(report: Report, key: string, text = "", now?: Date): { report: Report; paragraphId: string } {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return { report, paragraphId: "" };
  const paragraphId = nextClinicianParagraphId(section);
  const sections = mapSection(report, key, (s) => ({
    ...s,
    paragraphs: [...s.paragraphs, { id: paragraphId, text, sourceIds: [], origin: "clinician" }],
  }));
  return { report: touch(report, sections, now), paragraphId };
}

/** Remove a paragraph (not from-records text). */
export function removeParagraph(report: Report, key: string, paragraphId: string, now?: Date): Report {
  let changed = false;
  const sections = mapSection(report, key, (s) => {
    const paragraphs = s.paragraphs.filter((p) => {
      const drop = p.id === paragraphId && p.origin !== "from_records";
      if (drop) changed = true;
      return !drop;
    });
    return changed ? { ...s, paragraphs } : s;
  });
  return changed ? touch(report, sections, now) : report;
}

function answerDisplay(value: string | boolean | null | Array<Record<string, string>>, kind: string): string {
  if (Array.isArray(value)) return `${value.length} row${value.length === 1 ? "" : "s"}`;
  if (value === null || value === "") return "blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return kind === "date" ? formatUkDate(value) : value;
}

/**
 * Set a structured answer (yes/no, tick box, choice, date, number). The change is recorded in the
 * activity log ("answer_set", detail starting "<key>:"), which is how the screen shows it as edited.
 */
export function setStructuredAnswer(
  report: Report,
  key: string,
  value: string | boolean | null,
  actor: string,
  now?: Date,
): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section?.answer || section.answer.kind === "text") return report;
  const before = section.answer.value;
  if (before === value) return report;
  const kind = section.answer.kind;
  const sections = mapSection(report, key, (s) => ({ ...s, answer: { kind, value } }));
  return appendActivity(touch(report, sections, now), {
    actor,
    action: "answer_set",
    detail: `${key}: answer to “${section.title}” set to ${answerDisplay(value, kind)} (was ${answerDisplay(before, kind)}).`,
  }, now);
}

/** True when the clinician has changed this question's structured answer (see setStructuredAnswer). */
export function answerChangedByClinician(report: Pick<Report, "activity">, key: string): boolean {
  return report.activity.some((a: ActivityEntry) => a.action === "answer_set" && a.detail.startsWith(`${key}:`));
}

/* ------------------------------------------------------------------------------------------------
 * Gaps: what "Resolve" may claim
 * ----------------------------------------------------------------------------------------------*/

/** Minimum length of a typed resolution or reason (something a reader of the audit trail can use). */
export const MIN_GAP_REASON = 15;

/**
 * True when a person (not the AI) has answered this question: a paragraph they wrote or edited, or a
 * structured answer they set themselves.
 */
export function answeredByPerson(report: Pick<Report, "sections" | "activity">, key: string): boolean {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return false;
  if (section.paragraphs.some((p) => (p.origin === "clinician" || p.origin === "edited") && p.text.trim() !== "")) return true;
  const structured = section.answer && section.answer.kind !== "text" && section.answer.value !== null && section.answer.value !== "";
  return Boolean(structured && answerChangedByClinician(report, key));
}

export interface GapResolutionOptions {
  /** "Resolve" is offered (otherwise only "Acknowledge with a reason"). */
  canResolve: boolean;
  /** Text the resolution form starts with ("" = the person types their own). */
  prefill: string;
  /** Minimum length of the typed text. */
  minLength: number;
  /** Why "Resolve" is not offered, or what resolving means here. */
  hint: string | null;
}

/**
 * What resolving a gap may claim, so the audit trail never says something untrue:
 * - the question has an answer a PERSON wrote or set → "Resolve" pre-filled with that fact;
 * - an opinion question (prognosis, restrictions, recommendations, fitness for work) with only an AI
 *   draft or nothing → no "Resolve": the clinician writes their opinion first, or acknowledges the gap
 *   with a reason;
 * - any other gap → "Resolve" with the person's own words (at least MIN_GAP_REASON characters).
 */
export function gapResolutionOptions(report: Pick<Report, "sections" | "activity">, gap: Gap, actor: string): GapResolutionOptions {
  const section = report.sections.find((s) => s.key === gap.sectionKey);
  return resolutionOptionsFor({ own: answeredByPerson(report, gap.sectionKey), opinion: section?.kind === "clinician_opinion", gap, actor });
}

/** gapResolutionOptions() from what the question card already knows. */
export function resolutionOptionsFor(input: { own: boolean; opinion: boolean; gap: Gap; actor: string }): GapResolutionOptions {
  const { own, gap, actor } = input;
  if (own) {
    const prefill = gap.id.endsWith("-referrer")
      ? `Entered by ${actor} from the referrer's instruction letter.`
      : `Answered on the form by ${actor}.`;
    return { canResolve: true, prefill, minLength: 3, hint: null };
  }
  if (input.opinion) {
    return {
      canResolve: false,
      prefill: "",
      minLength: MIN_GAP_REASON,
      hint: "Only the clinician can answer this: write your opinion in the answer box (or choose an answer) to resolve it, or acknowledge it with a reason.",
    };
  }
  return { canResolve: true, prefill: "", minLength: MIN_GAP_REASON, hint: null };
}

/** Resolve or acknowledge a gap with the clinician's text. */
export function resolveGap(
  report: Report,
  gapId: string,
  kind: "resolved" | "acknowledged",
  text: string,
  actor: string,
  now?: Date,
): Report {
  const gap = report.gaps.find((g) => g.id === gapId);
  const clean = text.trim();
  if (!gap || !clean) return report;
  const at = nowIso(now);
  const gaps = report.gaps.map((g) => (g.id === gapId ? { ...g, resolution: { kind, text: clean, at } } : g));
  return appendActivity(
    { ...report, gaps, updatedAt: at },
    { actor, action: kind === "resolved" ? "gap_resolved" : "gap_acknowledged", detail: `${gap.sectionKey}: ${kind === "resolved" ? "resolved" : "acknowledged"} gap “${gap.issue}” – ${clean}` },
    now,
  );
}

/**
 * A value entered after its gap was acknowledged as "left blank" supersedes the acknowledgement: the gap
 * becomes resolved by the answer ("Answered on the form by …"), so the card no longer says "Left blank
 * for the office to add…" beside the value. Only gaps of `key` that were acknowledged (not resolved),
 * and only when the section now holds a person's own answer.
 */
export function supersedeAcknowledgedGaps(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return report;
  const personAnswered =
    section.paragraphs.some((p) => (p.origin === "clinician" || p.origin === "edited") && p.text.trim() !== "") ||
    (section.answer !== undefined && section.answer.kind !== "text" && section.answer.value !== null && section.answer.value !== "");
  if (!personAnswered) return report;
  const stale = report.gaps.filter((g) => g.sectionKey === key && g.resolution?.kind === "acknowledged");
  if (stale.length === 0) return report;
  const at = nowIso(now);
  const text = `Answered on the form by ${actor} (replaces “${(stale[0].resolution?.text ?? "").replace(/[.\s]+$/, "")}”).`;
  const gaps = report.gaps.map((g) => (stale.indexOf(g) >= 0 ? { ...g, resolution: { kind: "resolved" as const, text, at } } : g));
  return appendActivity({ ...report, gaps, updatedAt: at }, { actor, action: "gap_resolved", detail: `${key}: a value was entered, so the earlier “left blank” acknowledgement no longer applies.` }, now);
}

/** Undo a gap's resolution. */
export function reopenGap(report: Report, gapId: string, actor: string, now?: Date): Report {
  const gap = report.gaps.find((g) => g.id === gapId);
  if (!gap?.resolution) return report;
  const at = nowIso(now);
  const gaps = report.gaps.map((g) => {
    if (g.id !== gapId) return g;
    const next = { ...g };
    delete next.resolution;
    return next;
  });
  return appendActivity({ ...report, gaps, updatedAt: at }, { actor, action: "edited", detail: `${gap.sectionKey}: reopened gap “${gap.issue}”.` }, now);
}

/**
 * Acknowledge a flag with a reason. On an OPINION_LANGUAGE flag the reason is also stored on the
 * paragraph (`ackReason`), so it travels with the signed content.
 */
export function acknowledgeFlag(report: Report, flagId: string, reason: string, actor: string, now?: Date): Report {
  const flag = report.flags.find((f) => f.id === flagId);
  const clean = reason.trim();
  if (!flag || !clean) return report;
  const at = nowIso(now);
  const flags = report.flags.map((f) => (f.id === flagId ? { ...f, acknowledged: { reason: clean, at } } : f));
  let sections = report.sections;
  if (flag.code === "OPINION_LANGUAGE" && flag.paragraphId) {
    sections = report.sections.map((s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => (p.id === flag.paragraphId && p.origin === "edited" ? { ...p, ackReason: clean } : p)),
    }));
  }
  return appendActivity(
    { ...report, flags, sections, updatedAt: at },
    { actor, action: "flag_acknowledged", detail: `${flag.sectionKey ? `${flag.sectionKey}: ` : ""}acknowledged the check: ${flag.message.trim().replace(/[.\s]+$/, "")}. Reason: ${clean}` },
    now,
  );
}

/** The report after a successful POST /sign: locked, with its receipt and the server's flags. */
export function markApproved(
  sent: Report,
  receipt: SignReceipt,
  flags: ReportFlag[],
  opts: { isForm: boolean; now?: Date; prefill?: boolean; plain?: boolean },
): Report {
  const at = nowIso(opts.now);
  // plain (a clinic's Studio, fix wave 2): the same facts without "server-signed receipt" / "fingerprint".
  const proof = opts.plain
    ? `Approval check code ${receipt.contentSha256.slice(0, 12)}…`
    : `Server-signed receipt over content fingerprint ${receipt.contentSha256.slice(0, 12)}…`;
  return appendActivity(
    { ...sent, flags, receipt, status: "signed", updatedAt: at },
    {
      actor: receipt.signer.name,
      action: opts.isForm ? "approved" : "signed",
      detail: `${opts.prefill ? "Prefill checked and approved (nobody at the clinic signs this form)" : opts.isForm ? "Approved" : "Signed"} by ${receipt.signer.name} (HCPC ${receipt.signer.hcpc}). ${proof}`,
    },
    opts.now,
  );
}

/** Text of an answer for the read-only view (structured value, or the paragraphs). */
export function answerText(section: ReportSection): string {
  return answerToText(section);
}

/** Filing entries in the activity log (Save to clinic record). */
export function filedEntries(report: Pick<Report, "activity">): ActivityEntry[] {
  return report.activity.filter((a) => a.action === "filed");
}

/** Plain-English list of what still blocks approval (for the tooltip and the dialog). */
export function blockingLines(blocking: readonly ReportFlag[], report: Pick<Report, "sections">, max = 6): string[] {
  const titles = new Map(report.sections.map((s) => [s.key, s.title]));
  const lines = blocking.slice(0, max).map((f) => {
    const where = f.sectionKey ? `${f.sectionKey.startsWith("F-") ? `${f.sectionKey} ` : ""}${titles.get(f.sectionKey) ?? ""}`.trim() : "Whole report";
    return `${where}: ${f.message}`;
  });
  if (blocking.length > max) lines.push(`…and ${blocking.length - max} more.`);
  return lines;
}

/* ------------------------------------------------------------------------------------------------
 * The signer's own voice, leftover "not recorded" sentences, amendments
 * ----------------------------------------------------------------------------------------------*/

/**
 * Drafted paragraphs that report `authorName`'s own notes as record-keeping – in the third person ("Sarah
 * Reid recorded…", "she recorded…") or as "I recorded…" – which "Write in my own voice" turns into the
 * signer's plain clinical wording (core/voice.ts inOwnClinicalWording).
 */
export function ownVoiceCandidates(report: Pick<Report, "sections" | "bundleSnapshot">, authorName: string): Array<{ key: string; paragraphId: string }> {
  const out: Array<{ key: string; paragraphId: string }> = [];
  for (const s of report.sections) {
    for (const p of s.paragraphs) {
      if (isOwnVoiceCandidate(p, report.bundleSnapshot, authorName, { pronouns: true }) && inOwnClinicalWording(p.text, authorName, { pronouns: true }) !== p.text) out.push({ key: s.key, paragraphId: p.id });
    }
  }
  return out;
}

/**
 * Rewrite every candidate paragraph in the author's own voice. Each becomes "edited" (the AI wording
 * stays available through "Revert to AI draft"); citations are unchanged. One activity entry.
 */
export function writeInOwnVoice(report: Report, authorName: string, actor: string, now?: Date): Report {
  const targets = ownVoiceCandidates(report, authorName);
  if (targets.length === 0) return report;
  let next = report;
  for (const t of targets) {
    const p = next.sections.find((s) => s.key === t.key)?.paragraphs.find((x) => x.id === t.paragraphId);
    if (p) next = editParagraph(next, t.key, t.paragraphId, inOwnClinicalWording(p.text, authorName, { pronouns: true }), now);
  }
  return appendActivity(
    next,
    { actor, action: "edited", detail: `Wrote ${targets.length} drafted answer${targets.length === 1 ? "" : "s"} about ${authorName}'s own notes in ${authorName}'s own clinical wording (citations unchanged).` },
    now,
  );
}

/** Sentences of drafted text that only say something was NOT recorded. */
export function notRecordedSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+/g) ?? [])
    .map((x) => x.trim())
    .filter((x) => /\b(?:no|not|nothing)\b[^.!?]*\b(?:recorded|documented|noted|stated)\b/i.test(x) && !/\bI recorded\b/.test(x));
}

/**
 * On an opinion question the clinician has now answered: the AI paragraphs' "No … was recorded."
 * sentences, which the clinician's own answer replaces.
 */
export function supersededAbsenceSentences(section: Pick<ReportSection, "kind" | "paragraphs">): Array<{ paragraphId: string; sentence: string }> {
  if (section.kind !== "clinician_opinion") return [];
  if (!section.paragraphs.some((p) => p.origin === "clinician" && p.text.trim())) return [];
  const out: Array<{ paragraphId: string; sentence: string }> = [];
  for (const p of section.paragraphs) {
    if (p.origin !== "ai" && p.origin !== "edited") continue;
    for (const sentence of notRecordedSentences(p.text)) out.push({ paragraphId: p.id, sentence });
  }
  return out;
}

/** Remove superseded "not recorded" sentences (paragraphs left empty are removed). */
export function removeAbsenceSentences(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return report;
  const found = supersededAbsenceSentences(section);
  if (found.length === 0) return report;
  let next = report;
  for (const { paragraphId, sentence } of found) {
    const p = next.sections.find((s) => s.key === key)?.paragraphs.find((x) => x.id === paragraphId);
    if (!p) continue;
    const text = p.text.replace(sentence, "").replace(/\s{2,}/g, " ").trim();
    next = text ? editParagraph(next, key, paragraphId, text, now) : removeParagraph(next, key, paragraphId, now);
  }
  return appendActivity(next, { actor, action: "edited", detail: `${key}: removed the draft's “not recorded” wording now that the clinician has answered.` }, now);
}

/**
 * A new version of an approved report for an amendment (a referrer's query or a factual correction):
 * same content, status draft, no receipt, a fresh ID; the activity says which approval it supersedes.
 * The original stays as it was approved.
 */
export function createAmendedVersion(approved: Report, actor: string, newId: string, now?: Date): Report {
  const at = nowIso(now);
  const version = (approved.version ?? 1) + 1;
  const base: Report = { ...approved, id: newId, status: "draft", createdAt: at, updatedAt: at, version, amends: { reportId: approved.id, version: approved.version ?? 1, approvedAt: approved.receipt?.signedAt ?? at } };
  delete base.receipt;
  return appendActivity(
    { ...base, activity: approved.activity.slice() },
    {
      actor,
      action: "amendment_started",
      detail: `Amended version ${version} started from version ${approved.version ?? 1} (approved ${approved.receipt ? formatUkDate(approved.receipt.signedAt.slice(0, 10)) : "earlier"} by ${approved.receipt?.signer.name ?? "the clinician"}). The earlier approval is superseded once this version is approved; it needs approving again.`,
    },
    now,
  );
}
