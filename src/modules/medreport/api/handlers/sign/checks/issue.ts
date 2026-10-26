import "server-only";

/**
 * POST /sign – what would be issued (bh2 WA1 design 6), in the order sign/index.ts runs them:
 *
 * 1. staleReportCheck (before the validators): in a clinic's Studio the approval is of exactly the copy the clinic
 *    holds. The stored revision is loaded by id; the approval is refused – 409 STALE_REPORT – when the clinic holds no
 *    revision of the report (a body the store never saw skips the store's own checks: its server stamps, the refusal
 *    of a forged decision), when its store cannot be read (any error – on production or a preview a wrong data keyring
 *    too, harden-WA1 check2 N5), or when the hashed content of the request body differs from the stored revision (an edit not saved yet, or a
 *    newer revision someone else saved). Skipped only where the deployment has no clinic store at all: deps.tenantStore
 *    absent, or – on a local or test server only, never on production or a preview (VERCEL_ENV) – a store it has no
 *    data keys to open. The public demo stores nothing on the server.
 *    legacyReadingCheck (harden-WA1, check2 N1): a report from before this release (no reportModel, no frozen
 *    condition) is read by the earlier run-time reading of its printed questions – which a client controls (it can
 *    remove reportModel and the frozen conditions, or rewrite a question). The approval is refused – 409 ISSUE_REFUSED,
 *    with the boxes – when that reading rules out a box that the server's own reading keeps (core/issue-state.ts
 *    legacyRuleOutsBeyondServer: this release's reading of the attested map; a built-in template's own questions).
 * 2. validationCheck: the validators re-run on the report (core/validation validateReport, with the form map – the
 *    issue state decides which boxes issue nothing); 409 SIGNOFF_BLOCKED (problem.flags) if blocking items remain.
 * 3. issuedDocumentCheck (after them): a dry-run FINAL fill of the referrer's own file with the issue state's answers
 *    and the exact signer and time the receipt will carry. Any refusal of the forms engine (a merge code left on it, an
 *    answer that does not fit) or a fatal fill outcome (forms engine, WA2) refuses the approval with the boxes
 *    concerned – 409 ISSUE_REFUSED – so an approval is never followed by a FINAL copy that cannot be issued
 *    (AC-ISSUE-5). The receipt then binds the document's content hash and the hash of the acknowledgements the approval
 *    relied on (sign/receipt.ts). Which file: in a clinic's Studio the clinic's stored copy (else the request's
 *    fileBase64, checked against the map's SHA-256 like any copy); a store that cannot be read, or no copy at all,
 *    refuses the approval (409 ISSUE_REFUSED). In the public demo the request MUST carry fileBase64 for a Word or PDF
 *    form (422 VALIDATION_FAILED otherwise; the demo Studio always sends it). Either way one of the bundled fictional
 *    forms (forms/samples) is completed with the server's own copy of exactly that file when no other is at hand. Only a
 *    deployment with no clinic store (as above) may approve a tenant's form with no file at hand – the receipt then binds
 *    the acknowledgements only.
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split). Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { readReportFingerprint } from "../../../../auth/sign-receipt";
import { StoredReportSchema } from "../../../../core/stored-schemas";
import { ReportSchema } from "../../../../core/schemas";
import { legacyRuleOutsBeyondServer } from "../../../../core/issue-state";
import { validateReport, type ValidateReportResult } from "../../../../core/validation";
import type { FormDefinition, Report, ReportTemplate } from "../../../../core/types";
import { assertFormFileMatches, decodeFormFile, type DecodedFormFile } from "../../../../forms/file";
import { SAMPLE_FORM_FILES, type SampleFormFileId } from "../../../../forms/samples/generated/manifest";
import { getSampleForm } from "../../../../forms/samples/registry";
import type { ProblemIssue } from "../../../contract";
import { HttpError, logEvent, problem } from "../../../http";
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

const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

/**
 * harden-WA1 (check2 N5): a clinic store the deployment cannot open – no data keys (src/server/crypto/envelope.ts
 * DataCryptoError "BAD_KEYRING", matched by name: the module does not import the server's code) – counts as "no clinic
 * store" ONLY on a server that is not a hosted deployment (a local or test server: VERCEL_ENV neither "production" nor
 * "preview"), where nothing can be stored or approved for real. On production or a preview, a wrong or missing keyring
 * refuses like any other store error – it is never a reason to skip the checks.
 */
function storeUnopenableOffDeployment(err: unknown): boolean {
  const hosted = process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
  return !hosted && err instanceof Error && err.name === "DataCryptoError" && (err as { code?: unknown }).code === "BAD_KEYRING";
}

/** The approvals (pipeline contexts) on a local or test server whose clinic store cannot be opened (see above). */
const withoutStore = new WeakSet<SignCheckContext>();

/**
 * Tenant mode: refuse (409 STALE_REPORT) an approval of anything but the clinic's stored revision – a report it does not
 * hold, a store that cannot be read, or a body whose hashed content differs from the stored revision.
 */
export const staleReportCheck = async (ctx: SignCheckContext): Promise<Response | null> => {
  const { actor, deps, report } = ctx;
  if (actor.via === "demo" || !deps.tenantStore) return null;
  let stored: Awaited<ReturnType<NonNullable<typeof deps.tenantStore>["getReport"]>>;
  try {
    stored = await deps.tenantStore.getReport(actor.tenantId, report.id);
  } catch (err) {
    if (storeUnopenableOffDeployment(err)) {
      // A local or test server without data keys: nothing is held in its store, and nothing approved here is real.
      withoutStore.add(ctx);
      logEvent("sign_store_not_configured", { report: report.id });
      return null;
    }
    // Any other error – a store that failed to answer, or a hosted deployment whose data keys are missing or wrong: the
    // approval cannot be checked, so it is refused.
    logEvent("sign_stale_check_failed", { report: report.id, error: errorName(err) });
    return problem(409, "This report could not be checked against the clinic's copy", {
      code: "STALE_REPORT",
      detail: "Reload the report and approve it again.",
    });
  }
  if (!stored) {
    logEvent("sign_refused_not_stored", { report: report.id });
    return problem(409, "This report is not saved in the clinic's Studio", {
      code: "STALE_REPORT",
      detail: "Only the clinic's saved copy of a report can be approved. Reload the report, check it, and approve it again.",
    });
  }
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

/**
 * Refuse (409 ISSUE_REFUSED, with the boxes) a report from before this release whose earlier reading of its printed
 * questions rules out a box the server's own reading keeps (see the file comment). A report of this release passes: its
 * conditions are read from the attested map already (core/issue-state.ts).
 */
export const legacyReadingCheck = async (ctx: SignCheckContext): Promise<Response | null> => {
  const keys = legacyRuleOutsBeyondServer(ctx.report, ctx.form, ctx.form ? undefined : ctx.template.sections);
  if (keys.length === 0) return null;
  logEvent("sign_refused_legacy_reading", { report: ctx.report.id, boxes: keys.length });
  return problem(409, "The completed form could not be issued as approved", {
    code: "ISSUE_REFUSED",
    detail: `${keys.length === 1 ? "One box this report leaves out is" : `${keys.length} boxes this report leaves out are`} asked on the form as the Studio reads it now (the report was started before the current version). Nothing was approved. Mark ${keys.length === 1 ? "the box" : "each box"} as applying and answer it, or start a new report of this form.`,
    issues: keys.map((k) => ({ path: `form.fields.${k}`, message: `${k}: asked on the form, but left out by this report.` })),
  });
};

/** Why the dry run has no file: a refusal to send back (the approval cannot be checked), or "no_store" (no clinic store). */
type NoFile = { refusal: Response } | "no_store";

/**
 * The referrer's file for the dry run (see the file comment): the clinic's stored copy, else the request's; in the
 * public demo the request's, which it must send. Returns the file, a refusal, or "no_store" on a deployment without a
 * clinic store when no copy was sent.
 */
async function fileForDryRun(ctx: SignCheckContext, form: FormDefinition, fileBase64: string | undefined): Promise<DecodedFormFile | NoFile> {
  const expected = ctx.report.form?.fileSha256 ?? form.file.sha256;
  const { actor, deps } = ctx;
  let file: DecodedFormFile | null = null;
  if (actor.via !== "demo" && deps.tenantStore && !withoutStore.has(ctx) && /^[0-9a-f]{64}$/.test(expected)) {
    try {
      const held = await deps.tenantStore.getFile(actor.tenantId, expected);
      // Same checks as an uploaded file (type from the bytes, size and decompression limits).
      if (held) file = decodeFormFile(Buffer.from(held.bytes).toString("base64"));
    } catch (err) {
      if (!storeUnopenableOffDeployment(err)) {
        // Any error (on a hosted deployment, a wrong data keyring included): the completed form cannot be checked.
        logEvent("sign_form_file_unreadable", { report: ctx.report.id, form: form.id, error: errorName(err) });
        return { refusal: cannotCheck("The clinic's copy of the referrer's form could not be read, so the completed form could not be checked.", "Reload the report and approve it again.") };
      }
      withoutStore.add(ctx);
    }
  }
  if (!file && fileBase64) file = decodeFormFile(fileBase64, { convertRtf: true });
  // One of the bundled fictional forms (forms/samples): the server's own copy of exactly that file.
  if (!file) file = await bundledFormFile(expected);
  if (!file) {
    if (actor.via === "demo") {
      return {
        refusal: problem(422, "The referrer's form file is missing", {
          code: "VALIDATION_FAILED",
          issues: [{ path: "fileBase64", message: "Send the referrer's original form file (from the forms library) as fileBase64 with the approval." }],
        }),
      };
    }
    if (!deps.tenantStore || withoutStore.has(ctx)) return "no_store";
    logEvent("sign_form_file_missing", { report: ctx.report.id, form: form.id });
    return { refusal: cannotCheck("The clinic does not hold the referrer's form file, so the completed form could not be checked.", "Add the form again in the forms library, then approve again.") };
  }
  assertFormFileMatches(file, expected);
  return file;
}

/** The bundled fictional form (GET /forms/samples) whose file has this SHA-256, decoded and checked, or null. */
async function bundledFormFile(sha256: string): Promise<DecodedFormFile | null> {
  const id = (Object.keys(SAMPLE_FORM_FILES) as SampleFormFileId[]).find((k) => SAMPLE_FORM_FILES[k].sha256 === sha256);
  const sample = id ? getSampleForm(id) : undefined;
  if (!sample) return null;
  return decodeFormFile(Buffer.from(await sample.loadFile()).toString("base64"));
}

/** 409 ISSUE_REFUSED when the completed form cannot even be checked: nothing was approved. */
function cannotCheck(why: string, next: string): Response {
  return problem(409, "The completed form could not be issued as approved", { code: "ISSUE_REFUSED", detail: `${why} Nothing was approved. ${next}` });
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
    if (file === "no_store") {
      logEvent("sign_no_dry_run", { report: report.id, form: form.id });
      return null;
    }
    if ("refusal" in file) return file.refusal;
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
