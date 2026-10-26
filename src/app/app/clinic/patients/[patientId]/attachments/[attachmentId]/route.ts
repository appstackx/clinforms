/**
 * GET /app/clinic/patients/[patientId]/attachments/[attachmentId] – download an attached file (decrypted, checked
 * against its fingerprint). Always as a download, never shown in the page; the download is recorded in the
 * patient's history.
 */
import { asciiFileName } from "@/modules/pms/records/attachments";
import { isPlausibleRecordId } from "@/modules/pms/records/form-values";
import { clinicRoute } from "@/server/pms/http";
import { AttachmentIntegrityError, getAttachmentFile, recordAttachmentDownload } from "@/server/repos/pms/records/attachments";

export const dynamic = "force-dynamic";

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export const GET = clinicRoute<{ patientId: string; attachmentId: string }>({ permission: "clinical.view" }, async (_req, actor, params) => {
  if (!isPlausibleRecordId(params.patientId) || !isPlausibleRecordId(params.attachmentId)) return fail(404, "NOT_FOUND", "This file does not exist in this clinic.");
  const ctx = actor.repo();
  let file;
  try {
    file = await getAttachmentFile(ctx, actor.tenantId, params.attachmentId);
  } catch (err) {
    if (err instanceof AttachmentIntegrityError) return fail(409, "INTEGRITY", "The stored file failed its check and cannot be downloaded. Contact support.");
    throw err;
  }
  if (!file || file.details.patientId !== params.patientId) return fail(404, "NOT_FOUND", "This file does not exist in this clinic, or it was removed.");
  await recordAttachmentDownload(ctx, actor.tenantId, file.details.id, actor.actor);
  const name = file.details.fileName;
  const body = new Uint8Array(file.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": file.details.mimeType,
      "content-length": String(body.byteLength),
      "content-disposition": `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    },
  });
});
