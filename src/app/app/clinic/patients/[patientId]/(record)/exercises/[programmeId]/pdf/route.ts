/**
 * GET /app/clinic/patients/<patient>/exercises/<programme>/pdf – the programme as a printable PDF (clinical.view; a
 * draft is marked). Both switches, the patient's clinic and sites are checked by the records service; recorded in the
 * patient's history. Always a download, never cached; the file name holds no patient detail.
 */
import { clinicRoute } from "@/server/pms/http";
import { programmePdfFor } from "@/server/pms/records/exercises-service";
import { failureStatus } from "@/server/pms/records/http-status";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ patientId: string; programmeId: string }>({ permission: "clinical.view" }, async (_req, actor, params) => {
  const result = await programmePdfFor(actor, params.patientId, params.programmeId);
  if (!result.ok) return Response.json({ error: { code: result.code.toUpperCase(), message: result.error } }, { status: failureStatus(result.code) });
  const { fileName, bytes } = result.value;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${fileName}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    },
  });
});
