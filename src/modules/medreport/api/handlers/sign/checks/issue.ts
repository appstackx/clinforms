import "server-only";

/**
 * POST /sign – what would be issued (bh2 WA1 design 6), in the order sign/index.ts runs them:
 *
 * 1. staleReportCheck (before the validators): in a clinic's Studio the approval is of exactly the copy the clinic
 *    holds. The stored revision is loaded by id; when the hashed content of the request body differs from it (an
 *    edit not saved yet, or a newer revision someone else saved) the approval is refused – 409 STALE_REPORT. A report
 *    the clinic does not hold yet has nothing to be stale against. The public demo stores nothing on the server.
 * 2. validationCheck: the validators re-run on the report (core/validation validateReport, with the form map – the
 *    issue state decides which boxes issue nothing); 409 SIGNOFF_BLOCKED (problem.flags) if blocking items remain.
 * 3. issuedDocumentCheck (after them): a dry-run FINAL fill of the referrer's own file – the clinic's stored copy, or in
 *    the public demo the request's fileBase64 – with the issue state's answers and the exact signer and time the
 *    receipt will carry. Any refusal of the forms engine (a merge code left on it, an answer that does not fit) or a
 *    fatal fill outcome (forms engine, WA2) refuses the approval with the boxes concerned – 409 ISSUE_REFUSED – so an
 *    approval is never followed by a FINAL copy that cannot be issued (AC-ISSUE-5). The receipt then binds the
 *    document's content hash and the hash of the acknowledgements the approval relied on (sign/receipt.ts).
 *    When no file is at hand (a clinic's stored copy is missing and none was sent), there is no dry run: the receipt
 *    binds the acknowledgements only, and /render FINAL still refuses a document with a merge code left on it.
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split). Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { readReportFingerprint } from "../../../../auth/sign-receipt";
import { StoredReportSchema } from "../../../../core/stored-schemas";
import { ReportSchema } from "../../../../core/schemas";
import { validateReport, type ValidateReportResult } from "../../../../core/validation";
import type { FormDefinition, Report, ReportTemplate } from "../../../../core/types";
import { assertFormFileMatches, type DecodedFormFile } from "../../../../forms/file";
import type { ProblemIssue } from "../../../contract";
import { HttpError, logEvent, problem } from "../../../http";
import { formFileForRequest } from "../../store-form-file";
import { acknowledgementsSha256, bindsIssuedDocument, issuedContentSha256, issuedDocument } from "../receipt";
import type { SignCheckContext } from "./context";

/** The validators' result, and the refusal (409 SIGNOFF_BLOCKED) when blocking items remain. */
export function validationCheck(input: { report: Report; template: ReportTemplate; form: FormDefinition | null; started: number }): { result: ValidateReportResult; response: Response | null } {
  const { report, template, started } = input;
  // A form report: the form map too (10/2026 – mail-merge fields left on the form block approval).
  const result = validateReport(report, template, { form: input.form });
  if (!result.canSign) {
    logEvent("sign_blocked", { template: template.id, blocking: result.blocking.length, ms: Date.now() - started });
    return {
      result,
      response: problem(409, "Blocking items remain", {
        code: "SIGNOFF_BLOCKED",
        detail: `${result.blocking.length} item${result.blocking.length === 1 ? "" : "s"} must be resolved before approval.`,
        flags: result.blocking,
      }),
    };
  }
  return { result, response: null };
}

/** The hashed content of a report as read, and as this build knows it (a stored copy may hold a later release's keys). */
async function fingerprints(report: unknown): Promise<string[]> {
  const out: string[] = [];
  const asRead = await readReportFingerprint(report as Report);
  if (asRead) out.push(asRead);
  const known = ReportSchema.safeParse(report);
  if (known.success) {
    const k = await readReportFingerprint(known.data);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Tenant mode: refuse (409 STALE_REPORT) an approval whose body's hashed content differs from the stored revision of
 * the report – the clinic approves what it holds, never an unsaved or overtaken copy.
 */
export const staleReportCheck = async (ctx: SignCheckContext): Promise<Response | null> => {
  const { actor, deps, report } = ctx;
  if (actor.via === "demo" || !deps.tenantStore) return null;
  let stored: Awaited<ReturnType<NonNullable<typeof deps.tenantStore>["getReport"]>>;
  try {
    stored = await deps.tenantStore.getReport(actor.tenantId, report.id);
  } catch (err) {
    // The clinic's store cannot be read here at all (a deployment without its data keys): nothing can be held in it,
    // so there is no stored revision to be stale against – and the approved report cannot be stored either.
    logEvent("sign_stale_check_unavailable", { report: report.id, error: err instanceof Error ? err.name : typeof err });
    return null;
  }
  if (!stored) return null;
  const parsed = StoredReportSchema.safeParse(stored.payload);
  if (!parsed.success) {
    logEvent("sign_stale_unreadable", { report: report.id });
    return problem(409, "This report could not be checked against the clinic's copy", {
      code: "STALE_REPORT",
      detail: "Reload the report and approve it again.",
    });
  }
  const [body, held] = await Promise.all([fingerprints(report), fingerprints(parsed.data)]);
  if (body.some((h) => held.includes(h))) return null;
  logEvent("sign_refused_stale", { report: report.id, rev: stored.rev });
  return problem(409, "This report has changed since you opened it", {
    code: "STALE_REPORT",
    detail: "The clinic's copy of this report differs from the one you are approving – a change is not saved yet, or someone else saved a newer version. Reload the report, check it, and approve it again.",
  });
};

/** The referrer's file for the dry run: the clinic's stored copy, else the request's; null when neither is at hand. */
async function fileForDryRun(ctx: SignCheckContext, form: FormDefinition, fileBase64: string | undefined): Promise<DecodedFormFile | null> {
  const expected = ctx.report.form?.fileSha256 ?? form.file.sha256;
  let file: DecodedFormFile;
  try {
    file = await formFileForRequest(ctx.deps, { fileBase64, sha256: expected, tenantId: ctx.actor.via === "demo" ? null : ctx.actor.tenantId });
  } catch (err) {
    // No file at hand: no dry run (see the file comment). A file sent that cannot be read refuses the approval.
    if (err instanceof HttpError && err.status === 422 && !fileBase64) return null;
    throw err;
  }
  assertFormFileMatches(file, expected);
  return file;
}

/** What the issued-document check needs besides the pipeline's context. */
export interface IssueCheckInput {
  /** The approval time – the receipt's signedAt (mintReceipt `now`). */
  signedAt: Date;
  /** The validators' result (its flags carry the acknowledgements the approval relies on). */
  validation: ValidateReportResult;
  /** The public demo's copy of the referrer's file (SignRequest.fileBase64). */
  fileBase64?: string;
}

/**
 * The dry-run FINAL fill and the receipt's bindings (see the file comment): sets receiptAdditions
 * acknowledgementsSha256 (every approval) and issuedContentSha256 (a Word form whose file is at hand); refuses with
 * 409 ISSUE_REFUSED and per-box items when the document could not be issued. sign/index.ts always passes `input` (the
 * approval time and the validators' result); called as a plain pipeline check without it, there is nothing to bind and
 * it refuses nothing.
 */
export async function issuedDocumentCheck(ctx: SignCheckContext, input?: IssueCheckInput): Promise<Response | null> {
  if (!input) return null;
  const { report, form, signer } = ctx;
  ctx.receiptAdditions.acknowledgementsSha256 = acknowledgementsSha256(input.validation.flags, report.gaps ?? []);
  if (!form || form.kind === "questions") return null;
  const approval = { signer, signedAt: input.signedAt.toISOString() };
  let refusal: { detail: string; issues: ProblemIssue[] } | null = null;
  try {
    const file = await fileForDryRun(ctx, form, input.fileBase64);
    if (!file) {
      logEvent("sign_no_dry_run", { report: report.id, form: form.id });
      return null;
    }
    const out = await issuedDocument({ report, form, file, approval });
    const fatal = (out.outcomes ?? []).filter((o) => o.fatal);
    if (fatal.length > 0) {
      refusal = {
        detail: `${fatal.length === 1 ? "One box" : `${fatal.length} boxes`} would not be issued as approved.`,
        issues: fatal.map((o) => ({ path: `form.fields.${o.fieldId}`, message: `${o.fieldId}: ${o.residue?.length ? `${o.residue.join(", ")} would be left on the form` : o.outcome === "not_found" ? "its place on the form was not found" : o.outcome === "collision" ? "another answer was written in the same place" : "it would not be filled as approved"}${o.note ? ` (${o.note})` : ""}.` })),
      };
    } else if (out.errors?.length) {
      refusal = { detail: out.errors.join(" "), issues: [] };
    } else if (bindsIssuedDocument(form)) {
      ctx.receiptAdditions.issuedContentSha256 = issuedContentSha256(out.bytes);
    }
  } catch (err) {
    if (!(err instanceof HttpError) || err.status >= 500) throw err;
    if (err.init.code === "FORM_MISMATCH" || err.init.code === "PAYLOAD_TOO_LARGE") return err.toResponse();
    refusal = { detail: err.init.detail ?? err.message, issues: err.init.issues ?? [] };
  }
  if (!refusal) return null;
  logEvent("sign_refused_issue", { report: report.id, form: form.id, items: refusal.issues.length, ms: Date.now() - ctx.started });
  return problem(409, "The completed form could not be issued as approved", {
    code: "ISSUE_REFUSED",
    detail: `${refusal.detail} Nothing was approved. Correct the boxes named, then approve again.`,
    ...(refusal.issues.length ? { issues: refusal.issues } : {}),
  });
}
