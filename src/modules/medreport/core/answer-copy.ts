/**
 * "Copy answers": a completed form's answers as plain text, for an insurer portal, an e-mail or a
 * letter – one answer at a time, all of them as numbered "Question: answer" blocks, or a .txt file.
 * Also the content of a portal question set's PDF summary (docgen/question-summary.ts).
 *
 * Rules (the same text as the forms engine writes, made portal-friendly):
 * - text answers: the answer's paragraphs, separated by a blank line;
 * - dates DD/MM/YYYY, numbers as digits;
 * - yes/no and tick boxes as the option chosen (the printed "Yes – see notes" when the form prints it,
 *   else "Yes" / "No"; a single tick box with one printed option gives that option); choices as the
 *   option text;
 * - sign-off answers from the approval receipt (blank before approval: "[completed on approval]");
 * - questions nobody has answered: "[to complete]" ("[left blank]" once approved: only an optional
 *   question can be approved blank); questions left for the referrer's use are skipped.
 * - before approval every copy is marked "Draft – not yet approved"; after approval the approved text
 *   is copied, with who approved it and when.
 *
 * Pure: no React, no Node built-ins, no env. Safe in the browser and on the server.
 */
import { formatUkDate, isValidIsoDate, todayIso } from "./dates";
import { answerToText, isSectionAnswered, parseFormAnswerValue, signoffValuesFromReceipt } from "./forms";
import { WORDING } from "./wording";
import type { FormDefinition, FormField, Report, ReportSection, SignReceipt } from "./types";

export type CopyEntryStatus = "answered" | "to_complete" | "on_approval";

export interface CopyEntry {
  /** Section key / form field ID ("F-07"). */
  key: string;
  /** 1-based number among the copied questions. */
  number: number;
  /** The question as printed (or as typed into a question set). */
  question: string;
  /** The form's heading the question sits under, if any. */
  section?: string;
  /** The answer as plain text, or null when there is none yet. */
  answer: string | null;
  status: CopyEntryStatus;
}

export interface AnswersCopy {
  /** True when the report is approved (status "signed" with a receipt): the text is the approved answers. */
  approved: boolean;
  entries: CopyEntry[];
  /** Questions without an answer (not counting sign-off answers): to complete, or left blank once approved. */
  toComplete: number;
  /** Header lines: title, patient, approval (or the draft marker). */
  header: string[];
  /** Everything, as copied by "Copy all answers" and written to the .txt (LF line endings). */
  text: string;
}

type CopyField = Pick<FormField, "id" | "label" | "section" | "answerType" | "options" | "fillSource">;

/** The printed option for a yes/no value ("Yes – see notes" when the form prints it), else Yes/No. */
function yesNoText(field: Pick<FormField, "answerType" | "options"> | null, value: boolean): string {
  for (const option of field?.options ?? []) {
    if (parseFormAnswerValue({ answerType: "yes_no", options: field?.options }, option).value === value) return option.trim();
  }
  return value ? "Yes" : "No";
}

/**
 * One answer as plain text for copying, or null when there is no answer yet. `receipt` (approved
 * reports only) supplies sign-off answers.
 */
export function copyAnswerValue(
  field: Pick<FormField, "answerType" | "options" | "fillSource"> | null,
  section: Pick<ReportSection, "paragraphs" | "answer"> | null,
  receipt?: Pick<SignReceipt, "signer" | "signedAt"> | null,
): string | null {
  if (field?.fillSource.kind === "signoff") {
    if (!receipt) return null;
    const values = signoffValuesFromReceipt(receipt);
    return values[field.fillSource.part] || null;
  }
  if (!section || !isSectionAnswered(section)) return null;
  const answer = section.answer;
  if (answer && answer.kind !== "text") {
    const v = answer.value;
    if (v === null || v === "") return null;
    switch (answer.kind) {
      case "yes_no":
        return typeof v === "boolean" ? yesNoText(field, v) : String(v);
      case "checkbox": {
        if (typeof v !== "boolean") return String(v);
        const printed = (field?.options ?? []).map((o) => o.trim()).filter(Boolean);
        if (v && printed.length === 1) return printed[0];
        return v ? "Yes" : "No";
      }
      case "date":
        return typeof v === "string" && isValidIsoDate(v) ? formatUkDate(v) : String(v);
      case "choice":
      case "number":
        return String(v).trim() || null;
      default:
        // Any other structured answer: the same text the forms engine writes (core/forms.ts).
        return answerToText(section).trim() || null;
    }
  }
  const text = answerToText(section).trim();
  return text || null;
}

/** "Is the patient fit for work?" / "Date of birth:" – a question as it starts its copied block. */
export function questionLead(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  return /[?:]$/.test(q) ? q : `${q}:`;
}

/** The text shown for a question without an answer. */
export function missingAnswerText(status: CopyEntryStatus, approved: boolean): string {
  const w = WORDING.answersCopy;
  return status === "on_approval" ? w.onApproval : approved ? w.leftBlank : w.toComplete;
}

/** One numbered block: "3. Date of birth: 22/11/1991", or the question then the answer on its own lines. */
export function formatCopyBlock(entry: Pick<CopyEntry, "number" | "question" | "answer" | "status">, approved = false): string {
  const value = entry.answer ?? missingAnswerText(entry.status, approved);
  const lead = `${entry.number}. ${questionLead(entry.question)}`;
  return value.includes("\n") ? `${lead}\n${value}` : `${lead} ${value}`;
}

/** The text one per-question "Copy" puts on the clipboard (marked while the answers are a draft). */
export function copyTextForAnswer(answer: string, approved: boolean): string {
  return approved ? answer : `[${WORDING.answersCopy.draftMarker}] ${answer}`;
}

/** The copy entries of a report: its form's questions in order (sign-off included, referrer's-use boxes skipped). */
export function copyEntries(
  report: Pick<Report, "sections" | "receipt" | "status">,
  form: { fields: readonly CopyField[] } | null,
): CopyEntry[] {
  const receipt = report.status === "signed" ? report.receipt ?? null : null;
  const sections = new Map(report.sections.map((s) => [s.key, s]));
  const out: CopyEntry[] = [];
  if (form) {
    for (const field of form.fields) {
      if (field.fillSource.kind === "leave_blank") continue;
      const section = sections.get(field.id) ?? null;
      if (!section && field.fillSource.kind !== "signoff") continue;
      const answer = copyAnswerValue(field, section, receipt);
      out.push({
        key: field.id,
        number: out.length + 1,
        question: field.label.trim(),
        ...(field.section?.trim() ? { section: field.section.trim() } : {}),
        answer,
        status: answer !== null ? "answered" : field.fillSource.kind === "signoff" ? "on_approval" : "to_complete",
      });
    }
    return out;
  }
  // No form map in this browser: the report's own sections (title = the question as printed).
  for (const section of report.sections) {
    const signoff = section.kind === "declaration" && Boolean(section.fieldId);
    const answer = signoff && !isSectionAnswered(section) ? null : copyAnswerValue(null, section, receipt);
    out.push({
      key: section.key,
      number: out.length + 1,
      question: section.title.trim(),
      answer,
      status: answer !== null ? "answered" : signoff ? "on_approval" : "to_complete",
    });
  }
  return out;
}

/** Everything "Copy all answers" copies, with its header (title, patient, approval or draft marker). */
export function buildAnswersCopy(input: {
  report: Pick<Report, "sections" | "receipt" | "status" | "patientLabel" | "form" | "instructingParty">;
  form: { fields: readonly CopyField[]; title?: string; referrer?: { name: string } } | null;
  /** Title when there is no form ref (built-in report): its template name. */
  title?: string;
}): AnswersCopy {
  const { report, form } = input;
  const w = WORDING.answersCopy;
  const approved = report.status === "signed" && Boolean(report.receipt);
  const entries = copyEntries(report, form);
  const toComplete = entries.filter((e) => e.status === "to_complete").length;
  const title = report.form?.title ?? form?.title ?? input.title ?? "Answers";
  const referrer = report.form?.referrer.name ?? form?.referrer?.name ?? report.instructingParty.name;
  const receipt = report.receipt;
  const header = [
    title.toLowerCase().includes(referrer.toLowerCase()) ? title : `${title} – ${referrer}`,
    `Patient: ${report.patientLabel}`,
    approved && receipt ? w.approvedHeader(receipt.signer.name, receipt.signer.hcpc, formatUkDate(todayIso(new Date(receipt.signedAt)))) : w.draftMarker,
  ];
  const blocks = entries.map((e) => formatCopyBlock(e, approved));
  const footer = approved ? [] : ["", w.draftMarker];
  const text = [...header, "", blocks.join("\n\n"), ...footer].join("\n");
  return { approved, entries, toComplete, header, text };
}

/** The .txt download: CRLF line endings (opens cleanly in any editor) and a final newline. */
export function answersTxt(copy: Pick<AnswersCopy, "text">): string {
  return `${copy.text.replace(/\r?\n/g, "\r\n")}\r\n`;
}

function asciiSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Hart_M_Portal-questions_answers_2026-10-09_DRAFT.txt" (APPROVED once approved). */
export function answersFileName(
  report: Pick<Report, "bundleSnapshot" | "status" | "receipt" | "form">,
  opts: { title?: string; now?: Date } = {},
): string {
  const reg = report.bundleSnapshot.registration;
  const last = asciiSlug(reg.lastName) || "Patient";
  const initial = (asciiSlug(reg.firstName).charAt(0) || "X").toUpperCase();
  const title = asciiSlug(report.form?.title ?? opts.title ?? "") || "Form";
  const approved = report.status === "signed" && Boolean(report.receipt);
  const date = approved && report.receipt ? todayIso(new Date(report.receipt.signedAt)) : todayIso(opts.now);
  return `${last}_${initial}_${title.slice(0, 60)}_answers_${date}_${approved ? "APPROVED" : "DRAFT"}.txt`;
}

/** Fields of a form map in the shape the copy builder reads (a narrowing helper for callers). */
export function copyFormOf(form: Pick<FormDefinition, "fields" | "title" | "referrer"> | null): { fields: readonly CopyField[]; title: string; referrer: { name: string } } | null {
  return form ? { fields: form.fields, title: form.title, referrer: form.referrer } : null;
}
