/**
 * GET /app/clinic/patients/[patientId]/export?format=pdf|json – the subject-access copy of the patient's record
 * (UK GDPR Article 15): everything the clinic system holds about this one patient. patients.export (owner /
 * administrator) in clinicRoute and again in the records service; recorded in the patient's history. Always a
 * download, never cached.
 */
import { asciiFileName } from "@/modules/pms/records/attachments";
import { clinicRoute } from "@/server/pms/http";
import { subjectAccessExportFor } from "@/server/pms/records/export-service";
import { failureStatus } from "@/server/pms/records/http-status";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ patientId: string }>({ permission: "patients.export" }, async (req, actor, params) => {
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "pdf";
  const result = await subjectAccessExportFor(actor, params.patientId, format, { clinicName: actor.clinicName });
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: failureStatus(result.code) });
  const { fileName, mimeType, bytes } = result.value;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${asciiFileName(fileName)}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    },
  });
});
