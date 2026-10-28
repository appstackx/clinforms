import "server-only";

/**
 * POST /sign – the receipt: how the approval came in (approvedVia) and the server-signed receipt minted for it
 * (auth/sign-receipt.ts createReceipt: an HMAC over the report fingerprint, signer, time, attestations, the verified
 * form map's hash and the session the approval came through).
 *
 * bh2 WA1 design 6–7: what the receipt binds besides the report's content – the issued document and the
 * acknowledgements the approval relied on (MAC-covered SignReceipt.issuedContentSha256 / acknowledgementsSha256):
 *   issuedDocument          the FINAL Word document exactly as it is issued: the referrer's file filled with the issue
 *                           state's answers (core/forms buildFormAnswers) and the receipt's signer and time – no clinic
 *                           notice (a deployment stamp, not content). /sign makes it as a dry run; /render FINAL makes it
 *                           again and compares.
 *   issuedContentSha256     SHA-256 over the document's zip entries, sorted by name, uncompressed, with the docProps
 *                           created / modified timestamps removed.
 *   acknowledgementsSha256  SHA-256 over the sorted {flagId, code, sectionKey, by, reason} of the acknowledged blocking
 *                           flags and the acknowledged gaps.
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split): the same code, moved; sign/index.ts calls it in the same order.
 * Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { createHash } from "node:crypto";
import type { Actor } from "../../../auth/actor";
import { createReceipt, type ReceiptAdditions } from "../../../auth/sign-receipt";
import { canonicalize } from "../../../core/fingerprint";
import { buildFormAnswers, productionFormAnswers, type FormFillAnswers } from "../../../core/forms";
import type { Clinician, FormDefinition, Gap, Report, ReportFlag, ReportTemplate, SignReceipt } from "../../../core/types";
import type { DecodedFormFile } from "../../../forms/file";
import { renderFormFile, type FormRenderOutput } from "../../../forms/render-form";
import { openZipSafely } from "../../../forms/zip-guard";

export function approvedVia(actor: Actor): NonNullable<SignReceipt["approvedVia"]> {
  if (actor.via === "demo") {
    const claims = actor.session;
    return {
      kind: claims?.kind ?? "demo",
      sid: actor.sid,
      ...(claims?.clinician ? { clinician: claims.clinician } : {}),
    };
  }
  return {
    kind: "user",
    sid: actor.sid,
    ...(actor.userId ? { userId: actor.userId } : {}),
    ...(actor.session ? { launchSid: actor.session.sid } : {}),
    ...(actor.session?.clinician ? { clinician: actor.session.clinician } : {}),
  };
}

/**
 * The receipt for an approval that passed every check. `formMapSha256`: the form map's attested hash
 * (resolve-template.ts checkAttestedForm – the map as read, or as this build knows it; rollback shim). `additions`: what
 * the pipeline's checks added (checks/context.ts SignerCheckContext.receiptAdditions – bh2 W0 follow-up).
 */
export async function mintReceipt(input: {
  report: Report;
  signer: Clinician;
  template: ReportTemplate;
  formMapSha256?: string;
  actor: Actor;
  additions?: ReceiptAdditions;
  /** The approval time – the same instant the /sign dry run filled the sign-off boxes with (WA1 design 6). */
  now?: Date;
}): Promise<SignReceipt> {
  const { report, signer, template, actor } = input;
  return createReceipt({
    report,
    signer,
    statementAccepted: true,
    attestations: [...template.attestations],
    ...(input.formMapSha256 ? { formMapSha256: input.formMapSha256 } : {}),
    approvedVia: approvedVia(actor),
    ...(input.additions ? { additions: input.additions } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
}

/* ------------------------------------------------------------------------------------------------
 * What the receipt binds (WA1 design 6–7)
 * ----------------------------------------------------------------------------------------------*/

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * The acknowledgements the approval relied on: every acknowledged blocking flag (as the validators carried it over) and
 * every acknowledged gap, as sorted {flagId, code, sectionKey, by, reason}. A later change to any of them – a flag
 * acknowledged by someone else, a reason rewritten, an acknowledgement removed – changes the hash.
 */
export function acknowledgementsSha256(flags: readonly ReportFlag[], gaps: readonly Gap[]): string {
  const items = [
    ...flags
      .filter((f) => f.severity === "blocking" && f.acknowledged)
      .map((f) => ({ flagId: f.id, code: f.code, sectionKey: f.sectionKey ?? null, by: f.acknowledged?.by ?? null, reason: f.acknowledged?.reason ?? "" })),
    ...gaps
      .filter((g) => g.resolution?.kind === "acknowledged")
      .map((g) => ({ flagId: g.id, code: "OPEN_GAP", sectionKey: g.sectionKey, by: g.resolution?.by ?? null, reason: g.resolution?.text ?? "" })),
  ].sort((a, b) => (a.flagId < b.flagId ? -1 : a.flagId > b.flagId ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return sha256(canonicalize(items));
}

/** docProps/core.xml without its created / modified timestamps (they change with every save, not with the content). */
function withoutTimestamps(xml: string): string {
  return xml.replace(/<dcterms:(created|modified)\b[^>]*>[\s\S]*?<\/dcterms:\1>/g, "").replace(/<dcterms:(created|modified)\b[^>]*\/>/g, "");
}

/**
 * SHA-256 of a Word document's content: its zip entries sorted by name, each as name, length and uncompressed bytes,
 * with the docProps created / modified timestamps removed. Compression, zip dates and entry order do not count.
 */
export function issuedContentSha256(docx: Uint8Array): string {
  const zip = openZipSafely(docx);
  const hash = createHash("sha256");
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .sort();
  for (const name of names) {
    let bytes = zip.files[name].asUint8Array();
    if (name === "docProps/core.xml") bytes = new TextEncoder().encode(withoutTimestamps(new TextDecoder().decode(bytes)));
    hash.update(`${name}\n${bytes.byteLength}\n`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/**
 * bh2 fix round 1 (R1T-WA1-01): a receipt production minted, before this release – it binds neither the issued document
 * nor the acknowledgements. Every approval this release makes binds the acknowledgements at least (sign/checks/issue.ts
 * issuedDocumentCheck sets acknowledgementsSha256 on every approval; a portal question set has that hash only), so a
 * receipt with neither key is one production approved: what it approved is the document production issued. /render
 * FINAL issues it with production's answers (core/forms productionFormAnswers) and scripts/admin/check-issued.ts compares
 * it with production's own engine before a deploy.
 */
export function isPreReleaseReceipt(receipt: Pick<SignReceipt, "issuedContentSha256" | "acknowledgementsSha256">): boolean {
  return !receipt.issuedContentSha256 && !receipt.acknowledgementsSha256;
}

/**
 * The answers a FINAL copy of a referrer's form is filled with for a VERIFIED receipt (POST /render; check-issued): an
 * approval production made – the answers production wrote (core/forms productionFormAnswers); any other – the issue
 * state's (core/forms buildFormAnswers). Never for /sign's dry run, whose approval carries no hashes yet: issuedDocument.
 */
export function finalCopyAnswers(report: Report, form: FormDefinition, receipt: SignReceipt): FormFillAnswers {
  return isPreReleaseReceipt(receipt) ? productionFormAnswers(report, form, { receipt }) : buildFormAnswers(report, form, { receipt });
}

/** Whether the issued document of this form can be bound to the receipt: a Word form (Dell's are Word or RTF). */
export function bindsIssuedDocument(form: Pick<FormDefinition, "kind"> | null): boolean {
  return form?.kind === "docx";
}

/**
 * The FINAL document exactly as it is issued for `approval` (WA1 design 6): the referrer's file filled with the issue
 * state's answers and the approval's signer and time, in the form's own format, with the form's own notice only (never
 * a clinic's demonstration notice). Throws the forms engine's refusal (422 FORM_INVALID – e.g. a merge code left on it)
 * as /render FINAL would.
 */
export async function issuedDocument(input: {
  report: Report;
  form: FormDefinition;
  file: DecodedFormFile;
  approval: Pick<SignReceipt, "signer" | "signedAt">;
}): Promise<FormRenderOutput> {
  const answers = buildFormAnswers(input.report, input.form, { receipt: input.approval });
  return renderFormFile({ form: input.form, file: input.file, answers, draft: false, format: "original" });
}
