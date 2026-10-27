/**
 * Release rule (bh2 WA1 design 7): no forms-engine change is deployed while approved trial reports exist without first
 * running this check. For every approved report of a clinic it reads the report, its form map and the referrer's file
 * from the clinic's encrypted store, issues the FINAL copy again exactly as this build's /render FINAL does, and compares.
 *
 * An approval this release made (its receipt binds the issued document and the acknowledgements):
 *   OK           the document and the acknowledgements still hash to what the receipt records
 *   CHANGED      a FINAL copy would now be refused (409 ISSUED_COPY_CHANGED) – do not deploy; investigate first
 * An approval made BEFORE this release (a receipt production minted – no issued-document or acknowledgement hash; bh2 fix
 * round 1, R1T-WA1-01 / RG-1 – these were reported UNBOUND before, which compared nothing): the FINAL copy is issued twice,
 * by this build and by PRODUCTION's own code (the baseline: a tree of the production commit, `--baseline-ref` or
 * `--baseline`), and the two are compared – the Word document by its content hash and its text, a PDF by its text:
 *   SAME         this build issues what production issued (detail: "identical", or "same text" for a PDF)
 *   CHANGED      it does not: "text: N lines differ" (with the boxes whose answers differ, by id), "layout only (same
 *                text)", "this build refuses the final copy (…)" or "production refused it; this build issues it".
 *                Khuram decides on every CHANGED report before the deploy (re-approve it as an amended version, or accept)
 *   NOT_COMPARED no baseline was given – the gate is NOT passed (pass --baseline-ref <production commit>)
 * Either kind:
 *   MAP_CHANGED  the clinic's stored form map is not the one approved (receipt.formMapSha256): /render refuses that map
 *                for this receipt anyway, so there is nothing to compare – the approved map is no longer in the store
 *   NO_FILE      the referrer's file is not in the clinic's store (nothing to compare)
 *   ERROR        the report could not be checked (the error's name only)
 * READ-ONLY: nothing is written to the clinic and nothing decrypted is written to disk (both copies are made and compared
 * in memory). Prints report ids, form ids, field ids, counts and outcomes only – never patient data, wording or keys.
 * Exit code 1 when any report is CHANGED, NOT_COMPARED or ERROR.
 *
 *   node --disable-warning=ExperimentalWarning --import ./scripts/medreport/test-setup.mjs --import tsx \
 *     scripts/admin/check-issued.ts --slug <clinic id> [--env preview|production] [--baseline-ref <ref> | --baseline <dir>]
 *
 * --baseline-ref <ref>  the production commit (default origin/main while main is production: c883ce5 on 27/10/2026):
 *                       `git archive <ref> src/modules/medreport` into node_modules/.cache/clinforms-baseline/<sha>/
 *                       (source code only; it uses this checkout's packages – the same versions as production's).
 * --baseline <dir>      a tree holding production's src/modules/medreport instead (e.g. a checkout of the commit).
 * A baseline that already holds this release's issue state (core/issue-state.ts) is refused: it is not the code that
 * approved those reports.
 *
 * --env production reads production with the PRODUCTION_* settings of the secrets file – Khuram's go only (it reads
 * a clinic's encrypted reports, even though it changes nothing).
 * Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { formToTemplate } from "../../src/modules/medreport/core/forms";
import { StoredFormDefinitionSchema, StoredReportSchema } from "../../src/modules/medreport/core/stored-schemas";
import type { FormDefinition, Report, ReportTemplate, SignReceipt } from "../../src/modules/medreport/core/types";
import { validateReport } from "../../src/modules/medreport/core/validation";
import { defaultVoiceOwner } from "../../src/modules/medreport/core/validation/attribution-owner";
import { acknowledgementsSha256, bindsIssuedDocument, finalCopyAnswers, isPreReleaseReceipt, issuedContentSha256, issuedDocument } from "../../src/modules/medreport/api/handlers/sign/receipt";
import { asNotYetApproved } from "../../src/modules/medreport/api/handlers/sign/checks/issue";
import { continuationLabelFor, finalFormCopy } from "../../src/modules/medreport/api/handlers/render";
import { formMapMatches } from "../../src/modules/medreport/auth/attestations";
import type { TenantStore } from "../../src/modules/medreport/api/store-port";
import { decodeFormFile } from "../../src/modules/medreport/forms/file";
import { loadPdfjs, pdfjsDocumentParams } from "../../src/modules/medreport/forms/pdfjs";
import { renderQuestionSummaryPdf } from "../../src/modules/medreport/docgen/question-summary";
import { buildViewModel } from "../../src/modules/medreport/docgen/view-model";
import { docxPlainText, getBuiltinTemplateDocx, renderDocx } from "../../src/modules/medreport/docgen/docx";
import { renderPdf } from "../../src/modules/medreport/docgen/pdf";
import { getTemplate } from "../../src/modules/medreport/templates/registry";
import { applyTarget, parseArgs, resolveTarget, runCli, str } from "./cli";

export type CheckIssuedOutcome = "OK" | "CHANGED" | "SAME" | "NOT_COMPARED" | "MAP_CHANGED" | "NO_FILE" | "ERROR";

export interface CheckIssuedRow {
  reportId: string;
  formId: string | null;
  outcome: CheckIssuedOutcome;
  /** "release": this release approved it (its receipt binds the issued copy); "pre-release": production did. */
  receipt?: "release" | "pre-release";
  /** CHANGED: what differs; SAME: how it was compared; ERROR: the error's name. Ids and counts only. */
  detail?: string;
}

/* ------------------------------------------------------------------------------------------------
 * Issuing a FINAL copy – with this build's code, or with production's (the baseline)
 * ----------------------------------------------------------------------------------------------*/

type Loose = Record<string, unknown>;
type FillAnswers = Record<string, unknown>;
type Rendered = { bytes: Uint8Array };

/** The functions a build issues a FINAL copy with (POST /render FINAL, minus a clinic's demonstration notice). */
export interface IssuingCode {
  label: string;
  formToTemplate(form: FormDefinition): ReportTemplate;
  getTemplate(id: string): ReportTemplate | undefined;
  decodeFormFile(base64: string): { bytes: Uint8Array; mimeType: string };
  /** The answers /render FINAL fills a referrer's form with, for this verified receipt (CHANGED names the boxes that differ). */
  finalAnswers(report: Report, form: FormDefinition, receipt: SignReceipt): FillAnswers;
  /** The FINAL copy of a referrer's form /render issues for this verified receipt (no clinic notice). */
  finalFormCopy(input: { report: Report; form: FormDefinition; file: { bytes: Uint8Array; mimeType: string }; receipt: SignReceipt; continuationLabel: string }): Promise<Rendered>;
  renderQuestionSummaryPdf(report: Report, form: FormDefinition, template: ReportTemplate, opts: Loose): Promise<Rendered>;
  buildViewModel(report: Report, bundle: Report["bundleSnapshot"], template: ReportTemplate, opts: Loose): unknown;
  renderDocx(vm: unknown, template: Uint8Array): Promise<Rendered>;
  getBuiltinTemplateDocx(id: string): Uint8Array | null;
  renderPdf(vm: unknown): Promise<Uint8Array>;
  /** Whether /render would make a FINAL copy at all (its validators allow signing). */
  canIssue(report: Report, template: ReportTemplate, form: FormDefinition | null, receipt: SignReceipt): boolean;
}

/** This build: exactly the calls api/handlers/render.ts makes for a FINAL copy (check-issued.test.ts pins it). */
export const RELEASE_CODE: IssuingCode = {
  label: "this build",
  formToTemplate,
  getTemplate: (id) => getTemplate(id) ?? undefined,
  decodeFormFile: (b64) => decodeFormFile(b64),
  finalAnswers: (report, form, receipt) => finalCopyAnswers(report, form, receipt),
  // The handler's own function (api/handlers/render.ts finalFormCopy): whatever /render issues, this re-issues.
  finalFormCopy: (input) => finalFormCopy({ ...input, file: input.file as Parameters<typeof finalFormCopy>[0]["file"], format: "original" }),
  renderQuestionSummaryPdf: (report, form, template, opts) => renderQuestionSummaryPdf(report, form, template, opts as Parameters<typeof renderQuestionSummaryPdf>[3]),
  buildViewModel: (report, bundle, template, opts) => buildViewModel(report, bundle, template, opts as Parameters<typeof buildViewModel>[3]),
  renderDocx: (vm, t) => renderDocx(vm as Parameters<typeof renderDocx>[0], t),
  getBuiltinTemplateDocx,
  renderPdf: async (vm) => renderPdf(vm as Parameters<typeof renderPdf>[0]),
  canIssue(report, template, form, receipt) {
    // As /render: checked as not yet approved, in the voice /sign used (the approver, else the receipt's signer).
    const owner = report.approver?.name.trim() ? { name: report.approver.name, hcpc: report.approver.hcpc } : (receipt.signer ?? defaultVoiceOwner(asNotYetApproved(report)));
    return validateReport(asNotYetApproved(report), template, { form, voice: { owner } }).canSign;
  },
};

/** The production code under `dir` (a tree holding src/modules/medreport), loaded as a separate module graph. */
export async function loadProductionCode(dir: string): Promise<IssuingCode> {
  const root = path.resolve(dir, "src/modules/medreport");
  if (!fs.existsSync(path.join(root, "core/forms.ts"))) throw new Error(`No ClinForms code at ${dir} (src/modules/medreport/core/forms.ts is missing).`);
  if (fs.existsSync(path.join(root, "core/issue-state.ts"))) {
    throw new Error(`${dir} already holds this release's issue state (core/issue-state.ts): it is not the production code that approved the reports. Pass the production commit (c883ce5) as --baseline-ref.`);
  }
  const imp = async (p: string) => (await import(path.join(root, p))) as Loose;
  const forms = await imp("core/forms.ts");
  const file = await imp("forms/file.ts");
  const render = await imp("forms/render-form.ts");
  const summary = await imp("docgen/question-summary.ts");
  const view = await imp("docgen/view-model.ts");
  const docx = await imp("docgen/docx.ts");
  const pdf = await imp("docgen/pdf.ts");
  const templates = await imp("templates/registry.ts");
  const validation = await imp("core/validation/index.ts");
  const fn = <T>(mod: Loose, name: string) => {
    const f = mod[name];
    if (typeof f !== "function") throw new Error(`The baseline has no ${name}.`);
    return f as T;
  };
  const validate = fn<(r: Report, t: ReportTemplate, o: Loose) => { canSign: boolean }>(validation, "validateReport");
  const build = fn<(r: Report, f: FormDefinition, o: Loose) => FillAnswers>(forms, "buildFormAnswers");
  return {
    label: `production (${dir})`,
    formToTemplate: fn(forms, "formToTemplate"),
    getTemplate: fn(templates, "getTemplate"),
    decodeFormFile: fn(file, "decodeFormFile"),
    // Production's /render FINAL: buildFormAnswers with the verified receipt (it had no other reading), then its fill.
    finalAnswers: (report, form, receipt) => build(report, form, { receipt }),
    finalFormCopy: (input) =>
      fn<(i: Loose) => Promise<Rendered>>(render, "renderFormFile")({ form: input.form, file: input.file, answers: build(input.report, input.form, { receipt: input.receipt }), draft: false, format: "original", continuationLabel: input.continuationLabel }),
    renderQuestionSummaryPdf: fn(summary, "renderQuestionSummaryPdf"),
    buildViewModel: fn(view, "buildViewModel"),
    renderDocx: fn(docx, "renderDocx"),
    getBuiltinTemplateDocx: fn(docx, "getBuiltinTemplateDocx"),
    renderPdf: fn(pdf, "renderPdf"),
    canIssue: (report, template, form) => validate(report, template, { ...(form ? { form } : {}) }).canSign,
  };
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** `git archive <ref> src/modules/medreport` of this checkout, extracted once per commit (source code only). */
export function baselineTree(ref: string, repoRoot: string): { dir: string; commit: string } {
  const commit = git(["rev-parse", "--verify", `${ref}^{commit}`], repoRoot).trim();
  const dir = path.join(repoRoot, "node_modules/.cache/clinforms-baseline", commit);
  if (!fs.existsSync(path.join(dir, "src/modules/medreport/core/forms.ts"))) {
    fs.mkdirSync(dir, { recursive: true });
    const tar = execFileSync("git", ["archive", "--format=tar", commit, "src/modules/medreport"], { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", dir], { input: tar });
  }
  return { dir, commit };
}

/** One FINAL copy: a Word document or a PDF – or the refusal /render would send instead (its code only). */
type Copy = { kind: "docx" | "pdf"; bytes: Uint8Array } | { refused: string };

const refusalOf = (err: unknown) => {
  const e = err as { status?: unknown; init?: { code?: unknown } };
  return typeof e?.status === "number" && e.status < 500 ? `${e.status} ${String(e.init?.code ?? "")}`.trim() : null;
};

async function attempt(make: () => Promise<{ kind: "docx" | "pdf"; bytes: Uint8Array }>): Promise<Copy> {
  try {
    return await make();
  } catch (err) {
    const refused = refusalOf(err);
    if (refused) return { refused };
    throw err;
  }
}

/** The FINAL copies /render issues for this approval with `code`: one per format the referrer's file or report has. */
async function finalCopies(code: IssuingCode, input: { report: Report; form: FormDefinition | null; template: ReportTemplate; fileBase64: string | null; receipt: SignReceipt }): Promise<Copy[]> {
  const { report, form, template, receipt } = input;
  if (!code.canIssue(report, template, form, receipt)) return [{ refused: "409 SIGNOFF_BLOCKED" }];
  if (form?.kind === "questions") return [await attempt(async () => ({ kind: "pdf", bytes: (await code.renderQuestionSummaryPdf(report, form, template, { receipt })).bytes }))];
  if (form) {
    if (input.fileBase64 === null) return [];
    const file = code.decodeFormFile(input.fileBase64);
    return [
      await attempt(async () => ({
        kind: form.kind === "docx" ? "docx" : "pdf",
        bytes: (await code.finalFormCopy({ report, form, file, receipt, continuationLabel: continuationLabelFor(report) })).bytes,
      })),
    ];
  }
  const vm = code.buildViewModel(report, report.bundleSnapshot, template, { receipt, reviewCopy: false });
  const word = code.getBuiltinTemplateDocx(template.docxTemplateId);
  return [
    ...(word ? [await attempt(async () => ({ kind: "docx" as const, bytes: (await code.renderDocx(vm, word)).bytes }))] : []),
    await attempt(async () => ({ kind: "pdf" as const, bytes: await code.renderPdf(vm) })),
  ];
}

/** A PDF's text, page by page, one line per text line. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** How many lines of `a` and `b` differ (a multiset difference – order changes count as one each way). */
function differingLines(a: string[], b: string[]): number {
  const count = new Map<string, number>();
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
  let extra = 0;
  for (const l of b) {
    const n = count.get(l) ?? 0;
    if (n > 0) count.set(l, n - 1);
    else extra += 1;
  }
  let missing = 0;
  count.forEach((n) => {
    missing += n;
  });
  return Math.max(extra, missing);
}

const answerKey = (a: unknown) => JSON.stringify(a ?? null);

/** The boxes whose FINAL answers differ between the two builds (ids only). */
function differingAnswers(report: Report, form: FormDefinition, receipt: SignReceipt, a: IssuingCode, b: IssuingCode): string[] {
  const x = a.finalAnswers(report, form, receipt);
  const y = b.finalAnswers(report, form, receipt);
  return Array.from(new Set([...Object.keys(x), ...Object.keys(y)]))
    .filter((k) => answerKey(x[k]) !== answerKey(y[k]))
    .sort();
}

/** Compare this build's FINAL copies with production's: the CHANGED detail, or the SAME detail. */
async function compareCopies(mine: Copy[], theirs: Copy[]): Promise<{ same: boolean; detail: string }> {
  const n = Math.max(mine.length, theirs.length);
  const same: string[] = [];
  const changed: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = mine[i];
    const t = theirs[i];
    if (!m || !t) {
      changed.push("a copy one build issues and the other does not");
      continue;
    }
    if ("refused" in m && "refused" in t) {
      same.push(`both refuse it (${m.refused})`);
      continue;
    }
    if ("refused" in m) {
      changed.push(`this build refuses the final copy (${m.refused})`);
      continue;
    }
    if ("refused" in t) {
      changed.push(`production refused it (${t.refused}); this build issues it`);
      continue;
    }
    if (m.kind === "docx" && t.kind === "docx") {
      if (issuedContentSha256(m.bytes) === issuedContentSha256(t.bytes)) {
        same.push("Word: identical");
        continue;
      }
      const diff = differingLines(lines(docxPlainText(t.bytes)), lines(docxPlainText(m.bytes)));
      changed.push(diff === 0 ? "Word: layout only (same text)" : `Word text: ${diff} line${diff === 1 ? "" : "s"} differ`);
      continue;
    }
    const [a, b] = await Promise.all([pdfText(t.bytes), pdfText(m.bytes)]);
    const diff = differingLines(lines(a), lines(b));
    if (diff === 0) same.push("PDF: same text");
    else changed.push(`PDF text: ${diff} line${diff === 1 ? "" : "s"} differ`);
  }
  return changed.length ? { same: false, detail: changed.join("; ") } : { same: true, detail: same.join("; ") || "nothing to issue" };
}

/* ------------------------------------------------------------------------------------------------
 * The check
 * ----------------------------------------------------------------------------------------------*/

export interface CheckIssuedOptions {
  /** Production's code, to compare an approval made before this release with (null/absent: NOT_COMPARED). */
  production?: IssuingCode | null;
}

/** Re-issue one approved report and compare it with its receipt (this release) or with production's copy (before it). */
export async function checkIssuedReport(store: TenantStore, tenantId: string, report: Report, opts: CheckIssuedOptions = {}): Promise<CheckIssuedRow> {
  const receipt = report.receipt;
  const row = { reportId: report.id, formId: report.form?.formId ?? null };
  if (!receipt) return { ...row, outcome: "ERROR", detail: "no receipt" };
  const preRelease = isPreReleaseReceipt(receipt);
  const kind = { receipt: preRelease ? ("pre-release" as const) : ("release" as const) };
  let form: FormDefinition | null = null;
  if (report.form) {
    const stored = await store.getForm(tenantId, report.form.formId);
    const parsed = stored ? StoredFormDefinitionSchema.safeParse(stored.payload) : null;
    if (!parsed?.success) return { ...row, ...kind, outcome: "ERROR", detail: "form map not readable" };
    form = parsed.data;
    // Only the map that was approved is ever issued with this receipt (/render FINAL checks the same hash).
    if (receipt.formMapSha256 && !formMapMatches(form, receipt.formMapSha256)) return { ...row, ...kind, outcome: "MAP_CHANGED" };
  }
  const fileBase64 = async (): Promise<string | null> => {
    if (!report.form || !form || form.kind === "questions") return null;
    const file = await store.getFile(tenantId, report.form.fileSha256);
    return file ? Buffer.from(file.bytes).toString("base64") : null;
  };

  if (preRelease) {
    if (!opts.production) return { ...row, ...kind, outcome: "NOT_COMPARED", detail: "approved before this release – pass --baseline-ref <production commit>" };
    const template = form ? formToTemplate(form) : (getTemplate(report.templateId) ?? null);
    if (!template) return { ...row, ...kind, outcome: "ERROR", detail: "template not known" };
    const b64 = await fileBase64();
    if (form && form.kind !== "questions" && b64 === null) return { ...row, ...kind, outcome: "NO_FILE" };
    const prodTemplate = form ? opts.production.formToTemplate(form) : (opts.production.getTemplate(report.templateId) ?? template);
    const [mine, theirs] = [
      await finalCopies(RELEASE_CODE, { report, form, template, fileBase64: b64, receipt }),
      await finalCopies(opts.production, { report, form, template: prodTemplate, fileBase64: b64, receipt }),
    ];
    const compared = await compareCopies(mine, theirs);
    if (compared.same) return { ...row, ...kind, outcome: "SAME", detail: compared.detail };
    const boxes = form && form.kind !== "questions" ? differingAnswers(report, form, receipt, RELEASE_CODE, opts.production) : [];
    const listed = boxes.length ? `; answers differ in ${boxes.slice(0, 12).join(", ")}${boxes.length > 12 ? ` and ${boxes.length - 12} more` : ""}` : form && form.kind !== "questions" ? "; the answers are the same (the forms engine writes them differently)" : "";
    return { ...row, ...kind, outcome: "CHANGED", detail: `${compared.detail}${listed}` };
  }

  const template = form ? formToTemplate(form) : null;
  const changed: string[] = [];
  if (receipt.acknowledgementsSha256 && template) {
    const { flags } = validateReport(report, template, { form });
    if (acknowledgementsSha256(flags, report.gaps ?? []) !== receipt.acknowledgementsSha256) changed.push("acknowledgements");
  }
  if (receipt.issuedContentSha256 && form && bindsIssuedDocument(form) && report.form) {
    const b64 = await fileBase64();
    if (b64 === null) return { ...row, ...kind, outcome: changed.length ? "CHANGED" : "NO_FILE", ...(changed.length ? { detail: changed.join(", ") } : {}) };
    const decoded = decodeFormFile(b64);
    const issued = await issuedDocument({ report, form, file: decoded, approval: receipt });
    if (issuedContentSha256(issued.bytes) !== receipt.issuedContentSha256) changed.push("document");
  }
  return changed.length ? { ...row, ...kind, outcome: "CHANGED", detail: changed.join(", ") } : { ...row, ...kind, outcome: "OK" };
}

/** Every approved report of the clinic, re-issued and compared (read-only). */
export async function checkIssuedReports(store: TenantStore, tenantId: string, opts: CheckIssuedOptions = {}): Promise<CheckIssuedRow[]> {
  const out: CheckIssuedRow[] = [];
  for (const meta of await store.listReports(tenantId)) {
    if (meta.status !== "signed") continue;
    try {
      const stored = await store.getReport(tenantId, meta.id);
      const parsed = stored ? StoredReportSchema.safeParse(stored.payload) : null;
      if (!parsed?.success) {
        out.push({ reportId: meta.id, formId: meta.formId ?? null, outcome: "ERROR", detail: "report not readable" });
        continue;
      }
      out.push(await checkIssuedReport(store, tenantId, parsed.data, opts));
    } catch (err) {
      out.push({ reportId: meta.id, formId: meta.formId ?? null, outcome: "ERROR", detail: err instanceof Error ? err.name : typeof err });
    }
  }
  return out;
}

/** Outcomes that stop a deploy. */
export const BLOCKING_OUTCOMES: readonly CheckIssuedOutcome[] = ["CHANGED", "NOT_COMPARED", "ERROR"];

if (process.argv[1] && /check-issued\.ts$/.test(process.argv[1])) {
  void runCli(async () => {
    const args = parseArgs(process.argv.slice(2));
    const target = resolveTarget(args);
    applyTarget(target);
    const tenantId = (str(args, "slug", true) as string).trim();
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    const dir = str(args, "baseline");
    const ref = str(args, "baseline-ref") ?? (dir ? undefined : "origin/main");
    const baseline = dir ? { dir: path.resolve(dir), commit: "(a directory)" } : baselineTree(ref as string, repoRoot);
    const production = await loadProductionCode(baseline.dir);
    console.log(`Approvals made before this release are compared with production's code at ${dir ? baseline.dir : `${ref} = ${baseline.commit.slice(0, 12)}`}.`);
    // Server modules load only now, with the target's settings in place.
    const { getDb } = await import("../../src/server/db");
    const { getDataCipher } = await import("../../src/server/crypto");
    const { createTenantStore } = await import("../../src/server/store/tenant-store");
    const store = createTenantStore(() => ({ db: getDb(), cipher: getDataCipher() }));
    const rows = await checkIssuedReports(store, tenantId, { production });
    if (rows.length === 0) {
      console.log("No approved reports.");
      return;
    }
    for (const r of rows) console.log([r.outcome.padEnd(12), (r.receipt ?? "-").padEnd(11), r.reportId.padEnd(36), (r.formId ?? "-").padEnd(36), r.detail ?? ""].join("  ").trimEnd());
    const count = (o: CheckIssuedOutcome) => rows.filter((r) => r.outcome === o).length;
    const bad = rows.filter((r) => BLOCKING_OUTCOMES.includes(r.outcome));
    console.log(
      `\n${rows.length} approved report(s): ${count("OK")} OK, ${count("SAME")} SAME, ${count("CHANGED")} CHANGED, ${count("NOT_COMPARED")} NOT_COMPARED, ${count("ERROR")} ERROR, ${count("MAP_CHANGED")} MAP_CHANGED, ${count("NO_FILE")} NO_FILE.`,
    );
    if (bad.length > 0) {
      console.log("Do not deploy until Khuram has decided on every CHANGED report (and every NOT_COMPARED or ERROR one is checked).");
      process.exitCode = 1;
    }
  });
}
