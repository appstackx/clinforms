/**
 * GET /app/clinic/patients/[patientId]/attachments/[attachmentId] – download an attached file (decrypted, checked
 * against its fingerprint). clinical.view (clinicRoute, and again in the records service); a withdrawn file only
 * with reports.export. Always as a download, never shown in the page (sandboxed, nosniff); the download is
 * recorded in the patient's history.
 */
import { asciiFileName } from "@/modules/pms/records/attachments";
import { clinicRoute } from "@/server/pms/http";
import { downloadFileFor } from "@/server/pms/records/attachments-service";
import { failureStatus } from "@/server/pms/records/http-status";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ patientId: string; attachmentId: string }>({ permission: "clinical.view" }, async (_req, actor, params) => {
  const result = await downloadFileFor(actor, params.patientId, params.attachmentId);
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.code === "not_found" ? "This file does not exist in this clinic, or it was removed." : result.error } }, { status: failureStatus(result.code) });
  const { fileName, mimeType, bytes } = result.value;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    },
  });
});
