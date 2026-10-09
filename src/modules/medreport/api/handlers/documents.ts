import "server-only";

/**
 * POST /api/reports/v1/connectors/[id]/documents  (write-back)
 *
 * An actor (auth/actor.ts: a clinic's signed-in member, or a public-demo session). Body DocumentsRequest
 * {patientId, episodeId, title, fileName, mimeType, contentBase64, sha256, signReceipt} →
 * DocumentsResponse {attachReceipt, trace}.
 *
 * Before anything is sent to the clinic system:
 * 1. the actor must cover the connector and episode (403 SESSION_MISMATCH); the simulated TM3 sandbox is
 *    the public demo's only (403 CONNECTOR_NOT_AVAILABLE);
 * 2. the connector must support write-back (422 CONNECTOR_UNSUPPORTED; 503 for real TM3);
 * 3. the decoded file must match `sha256` and be a real .docx/.pdf (422 VALIDATION_FAILED);
 * 4. the SignReceipt's MAC must verify with MEDREPORT_SIGNING_SECRET, for this tenant
 *    (422 RECEIPT_INVALID) – only signed, unaltered receipts are filed;
 * 5. `fileToken` (from the FINAL /render response) must match these exact bytes, this receipt, this
 *    connector and this patient's episode (422 RECEIPT_INVALID) – a DRAFT, an edited file or another
 *    patient's file is never filed as signed.
 * Then the connector files it (simulated TM3: POST /patients/{id}/documents, which returns a receipt
 * and stores nothing; the Studio keeps the copy in this browser via HostHooks.onDocumentFiled).
 * The clinic system's checksum must match ours (502 CONNECTOR_ERROR otherwise).
 *
 * The request carries the receipt but not the report; the file token ties the bytes to the /render call
 * that verified the report, its receipt and its form map in full.
 *
 * Wave 2: the receipt must be the actor's clinic's (the MAC covers tenantId; another clinic's receipt is
 * refused even though its MAC verifies), and a clinic's file-back is written to its audit trail.
 *
 * Owner: integration agent (wave 2: API slice).
 */
import { createHash } from "node:crypto";
import { verifyFileToken } from "../../auth/attestations";
import { PRODUCT } from "../../config.public";
import { AUDIT_ACTIONS, assertActorConnector, assertActorEpisode, auditActor, macPrefix, requireActor } from "../../auth/actor";
import { verifyReceiptMac } from "../../auth/sign-receipt";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { CONTENT_TYPES, DocumentsRequestSchema, type DocumentsResponse } from "../contract";
import { HttpError, json, logEvent, parseBody, type MedreportHandler } from "../http";

function looksLike(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === CONTENT_TYPES.pdf) return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  // .docx is a ZIP container: "PK\x03\x04".
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export const handleDocuments: MedreportHandler = async (req, ctx, deps) => {
  const actor = await requireActor(req, deps);
  const connector = requireConnector(deps, ctx.params.id, { capability: "writeBackDocuments", action: "filing documents back", tenantId: actor.tenantId });
  assertActorConnector(actor, connector.id);
  const parsed = await parseBody(req, DocumentsRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  assertActorEpisode(actor, { connectorId: connector.id, patientId: body.patientId, episodeId: body.episodeId });
  const attachDocument = connector.attachDocument;
  if (!attachDocument) {
    throw new HttpError(422, "Not supported by this connector", {
      code: "CONNECTOR_UNSUPPORTED",
      detail: `${connector.label} does not support filing documents back.`,
    });
  }

  const extension = body.mimeType === CONTENT_TYPES.pdf ? ".pdf" : ".docx";
  if (!body.fileName.toLowerCase().endsWith(extension)) {
    throw new HttpError(422, "File name does not match the file type", {
      code: "VALIDATION_FAILED",
      detail: `A ${extension === ".pdf" ? "PDF" : "Word"} file name must end in ${extension}.`,
      issues: [{ path: "fileName", message: `Must end in ${extension}.` }],
    });
  }
  const bytes = Buffer.from(body.contentBase64, "base64");
  if (bytes.length === 0 || !looksLike(body.mimeType, bytes)) {
    throw new HttpError(422, "The file is not a valid document", {
      code: "VALIDATION_FAILED",
      detail: `The content is not a ${body.mimeType === CONTENT_TYPES.pdf ? "PDF" : "Word (.docx)"} file.`,
      issues: [{ path: "contentBase64", message: "Not a valid file of the declared type." }],
    });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== body.sha256) {
    throw new HttpError(422, "Checksum mismatch", {
      code: "VALIDATION_FAILED",
      detail: "The file's SHA-256 does not match the checksum sent with it. It may have been corrupted in transit.",
      issues: [{ path: "sha256", message: "Does not match the decoded file." }],
    });
  }
  if (body.signReceipt.tenantId !== actor.tenantId || !verifyReceiptMac(body.signReceipt, { tenantId: actor.tenantId })) {
    throw new HttpError(422, "Sign-off receipt invalid", {
      code: "RECEIPT_INVALID",
      detail: "Only signed reports can be filed back to the clinic system, and this receipt could not be verified. Sign the report again.",
    });
  }
  // The exact FINAL bytes the server issued for this approval and this patient's episode – not a draft,
  // not an edited copy, not another patient's file (auth/attestations.ts file token from /render).
  const tokenOk =
    typeof body.fileToken === "string" &&
    verifyFileToken(body.fileToken, {
      receiptMac: body.signReceipt.mac,
      sha256,
      tenantId: actor.tenantId,
      connectorId: connector.id,
      patientId: body.patientId,
      episodeId: body.episodeId,
    });
  if (!tokenOk) {
    throw new HttpError(422, "Not the issued final document", {
      code: "RECEIPT_INVALID",
      detail: `Only the final completed document issued by ${PRODUCT.name} for this approval and this patient can be filed. Download the final copy again and file that.`,
    });
  }

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, actor.tenantId);
  const attachReceipt = await callConnector(connector.id, () =>
    attachDocument.call(connector, cctx, {
      patientId: body.patientId,
      episodeId: body.episodeId,
      title: body.title,
      fileName: body.fileName,
      mimeType: body.mimeType,
      contentBase64: body.contentBase64,
      sha256,
      receipt: body.signReceipt,
    }),
  );
  if (attachReceipt.sha256.toLowerCase() !== sha256) {
    throw new HttpError(502, "The clinic system stored a different file", {
      code: "CONNECTOR_ERROR",
      detail: "The checksum returned by the clinic system does not match the file we sent.",
    });
  }
  logEvent("document_filed", {
    connectorId: connector.id,
    patientId: body.patientId,
    episodeId: body.episodeId,
    reportId: body.signReceipt.reportId,
    bytes: bytes.length,
    ms: Date.now() - started,
  });
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.fileBack,
    targetType: "report",
    targetId: body.signReceipt.reportId,
    detail: { connectorId: connector.id, receiptMac: macPrefix(body.signReceipt.mac), mimeType: body.mimeType, bytes: bytes.length },
  });
  const res: DocumentsResponse = { attachReceipt, trace: cctx.trace };
  return json(res, { status: 201 });
};
