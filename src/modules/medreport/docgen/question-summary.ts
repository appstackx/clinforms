import "server-only";

/**
 * The PDF summary of a portal question set (FormKind "questions"): there is no referrer file to fill,
 * so the record copy is the built-in report layout (docgen/pdf) with one numbered section per question
 * and its answer exactly as "Copy answers" gives it (core/answer-copy.ts) – "[to complete]" for an
 * unanswered question ("[left blank]" once approved), the DRAFT watermark until approval, the
 * signature block and fingerprint after.
 *
 * Used by POST /render (format original|pdf) and POST /forms/fill-preview for a question set.
 *
 * Owner: forms-engine agent.
 */
import { copyEntries, missingAnswerText } from "../core/answer-copy";
import type { FormDefinition, Report, ReportTemplate, SignReceipt } from "../core/types";
import { renderPdf } from "./pdf";
import { buildViewModel, type ReportViewModel, type ReportViewSection } from "./view-model";

/**
 * The view model of the summary. Pass `receipt` ONLY when verifyReceipt() accepted it (it makes the
 * copy final and fills sign-off answers).
 */
export function buildQuestionSummaryViewModel(
  report: Report,
  form: Pick<FormDefinition, "fields">,
  template: ReportTemplate,
  opts: { receipt?: SignReceipt; now?: Date } = {},
): ReportViewModel {
  const vm = buildViewModel(report, report.bundleSnapshot, template, { receipt: opts.receipt, now: opts.now });
  const kinds = new Map(report.sections.map((s) => [s.key, s.kind]));
  const entries = copyEntries({ sections: report.sections, status: opts.receipt ? "signed" : "draft", receipt: opts.receipt }, form);
  const sections: ReportViewSection[] = entries.map((e) => {
    const number = String(e.number);
    const paragraphs = e.answer
      ? e.answer
          .split(/\n\s*\n/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text) => ({ text }))
      : [{ text: missingAnswerText(e.status, Boolean(opts.receipt)) }];
    return {
      key: e.key,
      number,
      heading: `${number}. ${e.question}`,
      title: e.question,
      kind: kinds.get(e.key) ?? "ai_narrative",
      isPlaceholder: e.answer === null,
      paragraphs,
      showAttendance: false,
      showOutcomes: false,
      showRecordsReviewed: false,
    };
  });
  return { ...vm, sections, hasDeclaration: false, declarationHeading: "", declarationParagraphs: [] };
}

/** The summary as PDF bytes, with its suggested file name (no extension). */
export async function renderQuestionSummaryPdf(
  report: Report,
  form: Pick<FormDefinition, "fields">,
  template: ReportTemplate,
  opts: { receipt?: SignReceipt; now?: Date } = {},
): Promise<{ bytes: Uint8Array; baseName: string }> {
  const vm = buildQuestionSummaryViewModel(report, form, template, opts);
  return { bytes: await renderPdf(vm), baseName: vm.fileBaseName };
}
