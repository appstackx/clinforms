/**
 * GET /app/clinic/patients/[patientId]/filed-forms/[filedFormId] – an approved referrer form ClinForms filed back to the
 * patient's case (decrypted, checked against its checksum). clinical.view (clinicRoute, and again in the service): a
 * completed referrer form holds clinical content. Always a download (sandboxed, nosniff); each opening is audited.
 */
import { asciiFileName } from "@/modules/pms/records/attachments";
import { clinicRoute } from "@/server/pms/http";
import { filedFormFileFor } from "@/server/pms/integration/referrer-forms";
import { failureStatus } from "@/server/pms/records/http-status";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ patientId: string; filedFormId: string }>({ permission: "clinical.view" }, async (_req, actor, params) => {
  const result = await filedFormFileFor(actor, params.patientId, params.filedFormId);
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: failureStatus(result.code) });
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
