/**
 * Safety corpus: a case's input → the report, its template and (form cases) its fictional form map and Word file.
 *
 * Built with the product's own factory (createReport / createFormReport) so every case starts the way a real report
 * does. The release schema's additive fields are written too (report.approver, paragraph `by` / `ownWords`,
 * section `answerBy` / `disposition`); readers that do not know them ignore them, so a case pins the behaviour the
 * release must have and simply fails (pending) on a tree that does not have it yet.
 */
import { computeFacts } from "../../../computed-facts";
import { answerKindFor, formToTemplate } from "../../../forms";
import { createFormReport, createReport } from "../../../report-factory";
import type { ComputedFact, FormAnswer, FormDefinition, Gap, Paragraph, Report, ReportSection, ReportTemplate } from "../../../types";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "../../../../templates/registry";
import { withAttestedConfirmation } from "../../../../auth/attestations";
import { findFormMergeFields } from "../../../../forms/merge-scan";
import { DOCX_MIME, sha256Hex as fileSha256 } from "../../../../forms/file";
import {
  CORPUS_TENANT,
  DEMO_TENANT,
  actorOf,
  buildBundle,
  buildDocx,
  clinicianOf,
  fictionalFormJson,
  layoutWith,
  person,
  type CellSpec,
} from "./fixtures";
import type { CaseInput, ParagraphInput, PersonKey } from "./types";

/** Fixed clock: reports are created on 21/10/2026 (after every fictional note). */
export const CORPUS_NOW = new Date("2026-10-21T09:00:00.000Z");
export const CORPUS_AT = CORPUS_NOW.toISOString();
export const FACTS_DATE = "2026-10-21";
export const SUBJECT_PARAGRAPH_ID = "corpus-p1";

export interface Built {
  report: Report;
  template: ReportTemplate;
  form: FormDefinition | null;
  /** The form's Word file (form cases). */
  fileBytes: Uint8Array | null;
  computedFacts: ComputedFact[];
  /** The subject box and paragraph (when the case has one). */
  box: string | null;
  paragraphId: string | null;
  approver: PersonKey | null;
  author: PersonKey | null;
  signer: PersonKey;
  actor: PersonKey;
  tenantId: string;
}

export function approverKeyOf(input: CaseInput): PersonKey | null {
  return input.approver === undefined ? "sarah" : input.approver;
}

export function rolesOf(input: CaseInput): { approver: PersonKey | null; author: PersonKey | null; signer: PersonKey; actor: PersonKey } {
  const approver = approverKeyOf(input);
  const author = input.author === undefined ? approver : input.author;
  const signer = input.signer ?? approver ?? "sarah";
  const actor = input.actor ?? approver ?? "sarah";
  return { approver, author, signer, actor };
}

function stamp(key: PersonKey): { memberId: string; name: string } {
  const p = person(key);
  return { memberId: p.memberId, name: p.name };
}

/** One paragraph of the case, with the release's provenance stamps. */
export function paragraphOf(p: ParagraphInput, id: string): Paragraph {
  const out: Paragraph & Record<string, unknown> = {
    id,
    text: p.text,
    sourceIds: p.cites ?? [],
    origin: p.origin as Paragraph["origin"],
    ...(p.basis ? { basis: p.basis } : {}),
    ...(p.originalText !== undefined ? { originalText: p.originalText } : p.origin === "edited" ? { originalText: "(drafted wording)" } : {}),
    ...(p.ackReason ? { ackReason: p.ackReason } : {}),
  };
  if (p.by) out.by = stamp(p.by);
  if (p.ownWords) out.ownWords = { ...stamp(p.ownWords), by: stamp(p.ownWords), at: CORPUS_AT };
  return out;
}

export interface FormBuild {
  form: FormDefinition;
  bytes: Uint8Array;
}

/** A fictional form's map and Word file (optionally with layout patches), confirmed and attested for `tenantId`. */
export async function buildForm(
  formId: string,
  tenantId: string,
  patches: ReadonlyArray<{ table: number; row: number; cell: number; spec: CellSpec }> = [],
  fieldPatches: Record<string, Record<string, unknown>> = {},
): Promise<FormBuild> {
  const f = fictionalFormJson(formId);
  const bytes = buildDocx(layoutWith(formId, patches));
  const mergeFields = await findFormMergeFields({ bytes, mimeType: DOCX_MIME });
  const form: FormDefinition = {
    id: `frm_${formId.replace(/-/g, "_")}`,
    tenantId,
    referrer: f.referrer,
    title: f.title,
    file: { fileName: f.fileName, mimeType: DOCX_MIME, sha256: fileSha256(bytes), sizeBytes: bytes.byteLength },
    kind: "docx",
    fields: (JSON.parse(JSON.stringify(f.fields)) as FormDefinition["fields"]).map((x) => (fieldPatches[x.id] ? ({ ...x, ...fieldPatches[x.id] } as typeof x) : x)),
    status: "proposed",
    analysis: { mode: "rules", promptVersion: "corpus", at: CORPUS_AT, warnings: [], ...(mergeFields.length ? { mergeFields } : {}) },
    createdAt: CORPUS_AT,
    updatedAt: CORPUS_AT,
  };
  return { form: withAttestedConfirmation(form, "Pat Morgan", CORPUS_AT), bytes };
}

function templateOf(name: string): ReportTemplate {
  if (name === "solicitor_rta") return SOLICITOR_RTA_TEMPLATE;
  if (name === "employer_ffw") return EMPLOYER_FFW_TEMPLATE;
  throw new Error(`unknown template ${name}`);
}

function setSection(report: Report, key: string, patch: (s: ReportSection) => ReportSection): Report {
  if (!report.sections.some((s) => s.key === key)) throw new Error(`no box ${key} on this report`);
  return { ...report, sections: report.sections.map((s) => (s.key === key ? patch(s) : s)) };
}

function withoutGaps(report: Report, key: string): Report {
  return { ...report, gaps: report.gaps.filter((g) => g.sectionKey !== key) };
}

/** A structured answer value in the shape the box stores it. */
export function answerFor(report: Report, form: FormDefinition | null, key: string, value: string | boolean | null): FormAnswer {
  const field = form?.fields.find((f) => f.id === key);
  if (!field) return { kind: "text", value: typeof value === "string" ? value : null } as FormAnswer;
  const kind = answerKindFor(field.answerType);
  if (kind === "yes_no" || kind === "checkbox") return { kind, value: typeof value === "boolean" ? value : value === null ? null : /^y/i.test(value) } as FormAnswer;
  return { kind, value } as FormAnswer;
}

export async function buildCase(input: CaseInput, opts: { signMode?: "tenant" | "demo" } = {}): Promise<Built> {
  const { approver, author, signer, actor } = rolesOf(input);
  const tenantId = (opts.signMode ?? input.signMode ?? "tenant") === "demo" ? DEMO_TENANT : CORPUS_TENANT;
  const bundle = buildBundle(input.bundle ?? "owen", tenantId, input.notes ?? [], input.dropNotes ?? []);
  const computedFacts = computeFacts(bundle, { asOf: FACTS_DATE });
  const reportSpec = input.report ?? "template:solicitor_rta";
  let report: Report;
  let template: ReportTemplate;
  let form: FormDefinition | null = null;
  let fileBytes: Uint8Array | null = null;
  const approverRef = approver ? { ...stamp(approver), hcpc: person(approver).hcpc ?? "" } : null;
  if (reportSpec.startsWith("form:")) {
    const patches = (input.fill?.layoutPatches ?? []) as Array<{ table: number; row: number; cell: number; spec: CellSpec }>;
    const built = await buildForm(reportSpec.slice(5), tenantId, patches, (input.fill?.fieldPatches ?? {}) as Record<string, Record<string, unknown>>);
    form = built.form;
    fileBytes = built.bytes;
    template = formToTemplate(form);
    const factoryInput = {
      form,
      bundle,
      instructingParty: bundle.referral,
      computedFacts,
      author: author ? clinicianOf(author) : null,
      ...(approver && person(approver).hcpc ? { clinician: clinicianOf(approver) } : {}),
      // The release's factory takes the approver (W0.6); older factories ignore it.
      approver: approverRef,
      id: "rpt_corpus",
      now: CORPUS_NOW,
    };
    report = createFormReport(factoryInput as Parameters<typeof createFormReport>[0]);
  } else {
    template = templateOf(reportSpec.replace(/^template:/, ""));
    const factoryInput = { template, bundle, instructingParty: bundle.referral, computedFacts, approver: approverRef, id: "rpt_corpus", now: CORPUS_NOW };
    report = createReport(factoryInput as Parameters<typeof createReport>[0]);
    if (author) report = { ...report, author: clinicianOf(author) };
  }
  if (!author) {
    const { author: _drop, ...rest } = report;
    report = rest as Report;
  }
  const r = report as Report & Record<string, unknown>;
  if (approverRef && r.approver === undefined) r.approver = approverRef;
  if (!approverRef) delete r.approver;

  // Answers on structured boxes (the controllers of conditional boxes, choices …).
  for (const [key, value] of Object.entries(input.answers ?? {})) {
    const by = input.answersBy?.[key] ?? actor;
    report = setSection(report, key, (s) => ({ ...s, answer: answerFor(report, form, key, value), status: "complete", ...({ answerBy: stamp(by) } as object) }));
    report = withoutGaps(report, key);
  }
  // Other boxes' text.
  let n = 0;
  for (const [key, paras] of Object.entries(input.boxes ?? {})) {
    report = setSection(report, key, (s) => ({ ...s, status: "drafted", paragraphs: paras.map((p) => paragraphOf(p, `corpus-b${++n}`)) }));
    report = withoutGaps(report, key);
  }
  // The subject.
  const box = input.box ?? null;
  let paragraphId: string | null = null;
  if (box && input.paragraph) {
    paragraphId = SUBJECT_PARAGRAPH_ID;
    const p = paragraphOf(input.paragraph, SUBJECT_PARAGRAPH_ID);
    report = setSection(report, box, (s) => ({ ...s, status: "drafted", paragraphs: [p] }));
    report = withoutGaps(report, box);
  }
  // Gaps the case adds.
  for (const g of input.gaps ?? []) {
    const gap: Gap = {
      id: g.id ?? `gap-${g.box}-corpus`,
      sectionKey: g.box,
      issue: g.issue,
      suggestedQuestion: "What should this box say?",
      relatedNoteIds: [],
      raisedBy: "ai",
      ...(g.suggestedAnswer ? { suggestedAnswer: g.suggestedAnswer } : {}),
    };
    report = { ...report, gaps: [...report.gaps, gap] };
    // As drafting leaves it: a box with an open gap needs input.
    report = setSection(report, g.box, (s) => (s.status === "pending" ? { ...s, status: "needs_input" } : s));
  }
  // People's decisions (release schema).
  for (const [key, d] of Object.entries(input.dispositions ?? {})) {
    report = setSection(report, key, (s) => ({ ...s, ...({ disposition: { kind: d.kind, by: stamp(d.by), at: CORPUS_AT, ...(d.reason ? { reason: d.reason } : {}) } } as object) }));
  }
  const touched = new Set<string>([
    ...(box ? [box] : []),
    ...Object.keys(input.answers ?? {}),
    ...Object.keys(input.boxes ?? {}),
    ...Object.keys(input.dispositions ?? {}),
    ...(input.gaps ?? []).map((g) => g.box),
    ...(input.steps ?? []).map((s) => s.box ?? box ?? "").filter(Boolean),
  ]);
  report = completeOthers(report, form, touched, box, approver ?? "sarah", fillerOf(input.bundle ?? "owen"));
  return { report, template, form, fileBytes, computedFacts, box, paragraphId, approver, author, signer, actor, tenantId };
}

/**
 * Everything the case does not set is completed the safe way, so /sign and FINAL see only the subject's problems:
 * a required text box gets the approver's own neutral line (no opinion, no figure), a required structured box its
 * first option, and the other boxes' gaps are settled (an optional box's: left blank on purpose). The structured boxes
 * that may control a conditional subject are left alone.
 */
function completeOthers(report: Report, form: FormDefinition | null, touched: ReadonlySet<string>, box: string | null, approver: PersonKey, filler: string): Report {
  const subjectAt = box ? report.sections.findIndex((s) => s.key === box) : -1;
  // The structured boxes that may control a conditional subject are left as the case sets them: the nearest one up to
  // 3 before it, or the whole run before it when its condition refers to the questions "above".
  const controllers = new Set<string>();
  if (subjectAt >= 0) {
    const subject = report.sections[subjectAt];
    const field = form?.fields.find((f) => f.id === subject.key);
    const conditional = /\bif\b/i.test(subject.title) || /\bonly (?:if|when)\b/i.test(field?.guidance ?? "");
    const structured = (s: ReportSection) => s.answer !== undefined && s.answer.kind !== "text";
    if (conditional) {
      if (/\babove\b/i.test(subject.title)) {
        for (let j = subjectAt - 1; j >= 0 && structured(report.sections[j]); j--) controllers.add(report.sections[j].key);
      } else {
        for (let j = subjectAt - 1; j >= Math.max(0, subjectAt - 3); j--) {
          if (structured(report.sections[j])) {
            controllers.add(report.sections[j].key);
            break;
          }
        }
      }
    }
  }
  let n = 0;
  const sections = report.sections.map((s) => {
    if (touched.has(s.key) || s.kind === "declaration") return s;
    if (s.kind === "from_records" && s.status !== "needs_input") return s;
    const field = form?.fields.find((f) => f.id === s.key);
    const required = field ? field.required : true;
    if (!required) return s;
    if (s.answer && s.answer.kind !== "text") {
      if (s.answer.value !== null && s.answer.value !== undefined) return s;
      if (controllers.has(s.key)) return s;
      const kind = s.answer.kind;
      const value = kind === "yes_no" || kind === "checkbox" ? false : kind === "rows" ? [] : kind === "date" ? FACTS_DATE : (field?.options?.[0] ?? "Not recorded");
      return { ...s, status: "complete" as const, answer: { kind, value } as FormAnswer, ...({ answerBy: stamp(approver) } as object) };
    }
    if (s.paragraphs.some((p) => p.text.trim() !== "")) return s;
    return {
      ...s,
      status: "complete" as const,
      paragraphs: [paragraphOf({ text: filler, cites: [], origin: "clinician", by: approver, ownWords: approver }, `corpus-fill-${++n}`)],
    };
  });
  const filled = new Set(sections.filter((s, i) => s !== report.sections[i]).map((s) => s.key));
  // An optional box the case does not touch is left blank on purpose by the approver (its gap acknowledged).
  const optional = new Set((form?.fields ?? []).filter((f) => !f.required && !touched.has(f.id)).map((f) => f.id));
  const gaps = report.gaps
    .filter((g) => !filled.has(g.sectionKey))
    .map((g) =>
      optional.has(g.sectionKey) && !g.resolution
        ? { ...g, resolution: { kind: "acknowledged" as const, text: "Optional on the form – left blank.", at: CORPUS_AT, leftBlank: true } }
        : g,
    );
  return { ...report, sections, gaps };
}

function fillerOf(bundle: string): string {
  return bundle === "gemma" ? "Right knee sprain at netball." : "Lower back pain after lifting at work.";
}

/** The release's voice owner for validateReport: the approver (null = strict mode). */
export function ownerOf(built: Pick<Built, "approver">): Record<string, unknown> | null {
  if (!built.approver) return null;
  const p = person(built.approver);
  return { memberId: p.memberId, name: p.name, ...(p.hcpc ? { hcpc: p.hcpc } : {}) };
}

/** The release's Actor for a person (W0.3), and the r1 stop-gap context flag. */
export function reducerActor(key: PersonKey): { actor: string; actorIsStaff: boolean; by: ReturnType<typeof actorOf> } {
  const a = actorOf(key);
  return { actor: a.name, actorIsStaff: a.role === "staff", by: a };
}
