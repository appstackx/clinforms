/**
 * GET /app/clinic/patients/<patient>/forms/<copy>/pdf – the sealed, signed copy as a PDF (patients.view; health
 * answers only with clinical.view, an outcome questionnaire only for clinicians – the same rules as the screen).
 * Always a download, never cached; recorded in the clinic's trail.
 */
import { clinicRoute } from "@/server/pms/http";
import { signedCopyPdfFor } from "@/server/pms/portal/signed-copy";
import { patientVisible } from "@/server/pms/portal/staff-scope";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ patientId: string; responseId: string }>({ permission: "patients.view" }, async (_req, actor, params) => {
  const missing = () => Response.json({ error: { code: "NOT_FOUND", message: "This form does not exist in this clinic, or it is not completed." } }, { status: 404 });
  if (!(await patientVisible(actor, params.patientId))) return missing();
  const pdf = await signedCopyPdfFor(actor, params.patientId, params.responseId);
  if (!pdf) return missing();
  return new Response(new Uint8Array(pdf.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.bytes.byteLength),
      "content-disposition": `attachment; filename="${pdf.fileName}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
