import "server-only";

/**
 * One place that turns (form map + original file + answers) into the completed file, used by
 * POST /forms/fill-preview (always DRAFT) and POST /render for form reports (DRAFT or FINAL):
 *
 *   Word form  → original: filled .docx   · pdf: filled .docx converted by LibreOffice (null when absent)
 *   PDF form   → original / pdf: filled PDF, flattened (DRAFT: watermark on top of the answers)
 *
 * Also: review-copy source markers for the answers, the fill-warnings header and file names.
 *
 * A demonstration form (FormDefinition.demoNotice) gets its footer line on every page of the draft and
 * the final file (forms/demo-notice.ts); any other form is returned exactly as the fill produced it – except in a
 * demo clinic, whose handlers pass `demoNotice` (core/demo-clinic.ts demoOutputNotice: the form's own
 * notice, else the clinic notice). The notice is never part of the form map, so the approved map's hash is unchanged.
 *
 * Mail-merge fields (10/2026, core/merge-fields.ts): the completed file is scanned for «Name» / <<Name>> /
 * MERGEFIELD. A FINAL copy with any is refused (422 FORM_INVALID) – approval is normally blocked before
 * that by validation; a Word DRAFT lists them first in its warnings.
 *
 * bh2 WA2 (plan WA2 designs 1–3): the output carries the fill's outcome per field (FormRenderOutput.outcomes; the
 * fill-preview's HEADERS.fillOutcomes header, fillOutcomesHeader). A FINAL copy with a fatal outcome – an answer not
 * written or written over another, its place not on the form, residue on a decided box (a pre-printed mark, an option
 * list, a printed default, a merge code, a blank sentence opener's words) – is refused 422 FORM_INVALID with one issue
 * per field (FillRefusedError, which also carries the outcomes: WA1's /sign dry run reads them). `strict: false`
 * (report-only) returns the outcomes without refusing for them – for the verification runs only; the whole-document
 * merge-code guard still refuses every FINAL copy, as on production (review 26/10). `states` passes WA1's issue state
 * through to the fill (forms/docx-fill.ts DocxFillOptions).
 *
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json.
 */
import { CONTENT_TYPES, HEADERS } from "../api/contract";
import { HttpError } from "../api/http";
import { NOTICES } from "../config.public";
import { answerableFields, formTemplateId, type FormFillAnswers } from "../core/forms";
import { prefillSigners } from "../core/parties";
import type { BoxState, FillOutcome } from "../core/issue-types";
import type { FormDefinition, Report } from "../core/types";
import { buildFileBaseName } from "../docgen/view-model";
import { docxToPdf } from "./convert";
import { addDocxDemoNotice, stampPdfDemoNotice } from "./demo-notice";
import { fillDocxReport } from "./docx-fill";
import { DOCX_MIME, PDF_MIME, type DecodedFormFile } from "./file";
import { mergeTokensInOutput } from "./merge-scan";
import { findMergeTokens, listMergeTokensInWords } from "../core/merge-fields";
import { fillPdfReport } from "./pdf-fill";

export type FormOutputFormat = "original" | "pdf";

export interface FormRenderInput {
  form: FormDefinition;
  file: DecodedFormFile;
  answers: FormFillAnswers;
  draft: boolean;
  reviewMarkers?: boolean;
  format: FormOutputFormat;
  /** PDF: printed on every continuation page (fix wave 3), e.g. "Claimant: … · Reference: …". */
  continuationLabel?: string;
  /**
   * The demonstration notice to print on every page (a demo clinic: core/demo-clinic.ts demoOutputNotice).
   * Default: the form's own demoNotice (none for an ordinary form – the file is then exactly as filled).
   */
  demoNotice?: string;
  /** What each box issues (WA1's issueState), when the caller has it – passed to the fill (forms/docx-fill.ts). */
  states?: Readonly<Record<string, BoxState | undefined>>;
  /**
   * FINAL only: refuse a copy with a fatal fill outcome (default true). false = report-only – the copy is made and the
   * outcomes say what is wrong (plan WA2 design 1: the 17 × 3 verification run before strict mode). A FINAL copy still
   * printing a mail-merge field is refused either way.
   */
  strict?: boolean;
}

export interface FormRenderOutput {
  bytes: Uint8Array;
  contentType: typeof CONTENT_TYPES.docx | typeof CONTENT_TYPES.pdf;
  extension: "docx" | "pdf";
  /** Plain-English warnings, errors first (a draft lists its errors here too, for the fill-warnings header). */
  warnings: string[];
  /** Problems that make the written form wrong (PDF fill's onError). A final copy is refused with any. */
  errors?: string[];
  /**
   * bh2 W0 follow-up (seam "fill-outcomes", bh2-base2): what the fill did at each field (core/issue-types.ts FillOutcome) –
   * filled in by WA2's engine (design 1), read by WA1's /sign dry run (design 6). Absent until then: no outcome known.
   */
  outcomes?: FillOutcome[];
}

/** 422 when the file type does not match the form map's kind (cannot happen when the SHA-256 matched). */
function assertKind(form: FormDefinition, file: DecodedFormFile): void {
  const wantDocx = form.kind === "docx";
  if ((wantDocx && file.mimeType !== DOCX_MIME) || (!wantDocx && file.mimeType !== PDF_MIME)) {
    throw new HttpError(422, "The file does not match the form map", {
      code: "FORM_INVALID",
      detail: `This form map is for a ${wantDocx ? "Word" : "PDF"} form, but the file sent is a ${file.mimeType === PDF_MIME ? "PDF" : "Word document"}.`,
    });
  }
}

function mergeFieldsLeft(tokens: string[]): string {
  // A clinic-system code in plain words (<<P_GROUPREF>> → "your clinic system's placeholder for the referrer's reference…").
  return `The completed form still contains ${tokens.length === 1 ? "a mail-merge field" : `${tokens.length} mail-merge fields`} (${listMergeTokensInWords(tokens)}).`;
}

/**
 * A DRAFT's merge fields less the ones a sign-off question replaces (the clinician's name, the date of the report):
 * those are filled from the approval receipt, as the review's checks count them (core/merge-fields.ts
 * unresolvedMergeFields), so the draft's note does not ask anyone to answer them. The final copy still checks all.
 */
function withoutSignoffFields(tokens: string[], form: FormDefinition): string[] {
  const left = tokens.slice();
  for (const f of form.fields) {
    if (f.fillSource.kind !== "signoff" || f.anchor.kind !== "docx" || f.anchor.target !== "replace_placeholder" || f.anchor.writeAfter) continue;
    for (const token of findMergeTokens(f.anchor.placeholderText ?? "")) {
      const at = left.indexOf(token);
      if (at >= 0) left.splice(at, 1);
    }
  }
  return left;
}

/**
 * 422 for a FINAL copy the fill could not complete exactly as decided (plan WA2 design 2): one issue per field
 * (`fields.<id>`), and the outcomes for a caller that shows them per box (WA1's /sign dry run).
 */
export class FillRefusedError extends HttpError {
  readonly outcomes: FillOutcome[];

  constructor(form: Pick<FormDefinition, "fields">, outcomes: FillOutcome[]) {
    const fatal = outcomes.filter((o) => o.fatal);
    const label = (id: string) => form.fields.find((f) => f.id === id)?.label ?? id;
    const why = (o: FillOutcome) => [o.note, ...(o.residue ?? [])].filter(Boolean).join("; ") || "it could not be completed as approved";
    const issues = fatal.map((o) => ({ path: `fields.${o.fieldId}`, message: `${o.fieldId} (“${label(o.fieldId)}”): ${why(o)}.` }));
    const shown = issues.slice(0, 3).map((i) => i.message.replace(/\.$/, "")).join("; ");
    super(422, "The form could not be completed exactly as approved", {
      code: "FORM_INVALID",
      detail: `${fatal.length === 1 ? "One answer" : `${fatal.length} answers`} could not be put on the form exactly as approved – ${shown}${fatal.length > 3 ? `; and ${fatal.length - 3} more` : ""}. The final copy was not made. Correct the form's mapping, or the answer – an approved report cannot be edited, so use “Create amended version”.`,
      issues,
    });
    this.outcomes = outcomes;
  }
}

/** A final copy never leaves with a mail-merge field on it (see the file comment). */
async function assertNoMergeFields(bytes: Uint8Array, kind: "docx" | "pdf"): Promise<void> {
  const tokens = await mergeTokensInOutput(bytes, kind);
  if (tokens.length === 0) return;
  throw new HttpError(422, "This form still contains a mail-merge field", {
    code: "FORM_INVALID",
    detail: `${mergeFieldsLeft(tokens)} The final copy was not made. Answer the question in that box, or change the form's mapping so a question replaces it – an approved report cannot be edited, so use “Create amended version”.`,
  });
}

/** Fill the referrer's original file (and convert a Word form to PDF when asked). */
export async function renderFormFile(input: FormRenderInput): Promise<FormRenderOutput> {
  const { form, file, answers, draft } = input;
  assertKind(form, file);
  const notice = input.demoNotice ?? form.demoNotice;
  const warnings: string[] = [];
  const onWarning = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };
  const strict = !draft && input.strict !== false;
  if (form.kind === "docx") {
    const filled = fillDocxReport(file.bytes, form, answers, { draft, reviewMarkers: input.reviewMarkers, onWarning, ...(input.states ? { states: input.states } : {}) });
    const outcomes = filled.outcomes;
    // Never issue a form whose content is not exactly what was decided (plan WA2 design 2).
    if (strict && outcomes.some((o) => o.fatal)) throw new FillRefusedError(form, outcomes);
    const docx = addDocxDemoNotice(filled.bytes, notice);
    if (draft) {
      const left = withoutSignoffFields(await mergeTokensInOutput(docx, "docx"), form);
      if (left.length > 0) warnings.unshift(`${mergeFieldsLeft(left)} The form cannot be approved until each is answered or replaced.`);
    } else await assertNoMergeFields(docx, "docx"); // every FINAL copy, report-only too (review 26/10)
    if (input.format === "original") return { bytes: docx, contentType: CONTENT_TYPES.docx, extension: "docx", warnings, outcomes };
    let pdf: Uint8Array | null;
    try {
      pdf = await docxToPdf(docx);
    } catch {
      throw new HttpError(502, "The PDF copy could not be made", {
        code: "INTERNAL",
        detail: "The PDF converter did not finish. Download the completed Word form instead, or try again.",
        retryable: true,
      });
    }
    if (!pdf) {
      throw new HttpError(503, "PDF conversion is not available here", { code: "PDF_CONVERSION_UNAVAILABLE", detail: NOTICES.pdfConversionUnavailable });
    }
    return { bytes: pdf, contentType: CONTENT_TYPES.pdf, extension: "pdf", warnings, outcomes };
  }
  // Flattened in both cases: FINAL by rule; DRAFT so the watermark is drawn above the filled boxes.
  const errors: string[] = [];
  const onError = (m: string) => {
    if (!errors.includes(m)) errors.push(m);
  };
  const { bytes: filled, outcomes } = await fillPdfReport(file.bytes, form, answers, {
    draft,
    flatten: true,
    reviewMarkers: input.reviewMarkers,
    onWarning,
    onError,
    ...(input.continuationLabel ? { continuationLabel: input.continuationLabel } : {}),
  });
  if (strict && outcomes.some((o) => o.fatal)) throw new FillRefusedError(form, outcomes);
  if (errors.length > 0 && !draft) {
    // Never issue a form with a value cut to fit (e.g. a date written "14/02/19").
    throw new HttpError(422, "An answer does not fit the form", {
      code: "FORM_INVALID",
      detail: `${errors.join(" ")} The final copy was not made. Correct the answer and approve the report again – an approved report cannot be edited, so use “Create amended version”, correct the answer there and approve the amended version.`,
    });
  }
  const pdf = await stampPdfDemoNotice(filled, notice, { draft });
  if (!draft) await assertNoMergeFields(pdf, "pdf"); // every FINAL copy, report-only too (review 26/10)
  return { bytes: pdf, contentType: CONTENT_TYPES.pdf, extension: "pdf", warnings: [...errors, ...warnings], ...(errors.length > 0 && { errors }), outcomes };
}

/**
 * Review copies: append the answer's sources to each written text answer, e.g. " [N-001, N-006]"
 * (internal use only – a FINAL copy never carries them).
 */
export function withSourceMarkers(answers: FormFillAnswers, report: Pick<Report, "sections">, form: Pick<FormDefinition, "fields">): FormFillAnswers {
  const out: FormFillAnswers = { ...answers };
  for (const field of answerableFields(form)) {
    // Only drafted / reviewed text answers: identifiers, numbers and dates stay exactly as on the record.
    if (field.fillSource.kind !== "notes_narrative" && field.fillSource.kind !== "clinician_opinion") continue;
    if (field.answerType !== "long_text" && field.answerType !== "short_text") continue;
    if (field.anchor.kind === "docx" && (field.anchor.target === "checkbox_glyph" || field.anchor.target === "mark_cell" || field.anchor.target === "delete_options")) continue;
    const answer = out[field.id];
    if (!answer?.text) continue;
    const section = report.sections.find((s) => s.key === field.id);
    const ids = Array.from(new Set((section?.paragraphs ?? []).flatMap((p) => p.sourceIds))).filter((id) => /^(N-\d{3,}|FACT-|REG$)/.test(id));
    if (ids.length) out[field.id] = { ...answer, text: `${answer.text} [${ids.join(", ")}]` };
  }
  return out;
}

/** Header value for HEADERS.fillWarnings: URI-encoded JSON, capped so proxies accept it. */
export function fillWarningsHeader(warnings: string[]): Record<string, string> {
  if (warnings.length === 0) return {};
  const list: string[] = [];
  let size = 2;
  for (const w of warnings) {
    const enc = encodeURIComponent(JSON.stringify(w)).length + 3;
    if (size + enc > 6000 || list.length >= 25) {
      list.push(`…and ${warnings.length - list.length} more.`);
      break;
    }
    list.push(w);
    size += enc;
  }
  return { [HEADERS.fillWarnings]: encodeURIComponent(JSON.stringify(list)) };
}

/** Most bytes of the HEADERS.fillOutcomes header (URI-encoded JSON), so proxies accept it with the other headers. */
const MAX_OUTCOMES_HEADER = 7_000;

/**
 * Header value for HEADERS.fillOutcomes (plan WA2 design 3): URI-encoded JSON of the outcomes, compact (a note cut to
 * 120 characters). When they do not all fit, the most telling come first – fatal, then residue or a note, then what was
 * cleared or removed, then the rest – and the list stops where the next would not fit (a box without an entry shows no
 * outcome; ui/api-client.ts reads the list).
 */
export function fillOutcomesHeader(outcomes: readonly FillOutcome[] | undefined): Record<string, string> {
  if (!outcomes || outcomes.length === 0) return {};
  const rank = (o: FillOutcome) => (o.fatal ? 0 : o.residue?.length || o.note ? 1 : o.outcome === "cleared" || o.outcome === "removed" ? 2 : 3);
  const compact = outcomes.map((o, i) => ({
    i,
    rank: rank(o),
    o: { ...o, ...(o.note && { note: o.note.length > 120 ? `${o.note.slice(0, 119)}…` : o.note }), ...(o.residue && { residue: o.residue.slice(0, 3).map((r) => (r.length > 120 ? `${r.slice(0, 119)}…` : r)) }) },
  }));
  const kept: typeof compact = [];
  let size = 2;
  for (const c of compact.slice().sort((a, b) => a.rank - b.rank || a.i - b.i)) {
    const enc = encodeURIComponent(JSON.stringify(c.o)).length + 3;
    if (size + enc > MAX_OUTCOMES_HEADER) continue;
    kept.push(c);
    size += enc;
  }
  kept.sort((a, b) => a.i - b.i);
  return { [HEADERS.fillOutcomes]: encodeURIComponent(JSON.stringify(kept.map((c) => c.o))) };
}

/**
 * e.g. "Hart_M_Treating-Physiotherapist-Report_2026-10-07_SIGNED" (no extension). A form the clinic only
 * prefills for someone else to sign (core/parties.ts prefillSigners – a patient's claim form) is never
 * "_SIGNED": its approved file is "…_PREFILLED".
 */
export function formFileBaseName(report: Pick<Report, "bundleSnapshot" | "version">, form: FormDefinition, opts: { signed: boolean; dateIso: string; preview?: boolean }): string {
  const reg = report.bundleSnapshot.registration;
  const built0 = buildFileBaseName({
    firstName: reg.firstName,
    lastName: reg.lastName,
    template: { id: formTemplateId(form.id), documentTitle: form.title },
    dateIso: opts.dateIso,
    signed: opts.signed,
  });
  const built = opts.signed && prefillSigners(form) ? built0.replace(/_SIGNED$/, "_PREFILLED") : built0;
  // An amended version says so in its file name ("…_AMENDED-v2_SIGNED").
  const base = report.version && report.version > 1 ? built.replace(/(_SIGNED|_PREFILLED|_DRAFT)?$/, `_AMENDED-v${report.version}$1`) : built;
  return opts.preview ? `${base}_PREVIEW` : base;
}
