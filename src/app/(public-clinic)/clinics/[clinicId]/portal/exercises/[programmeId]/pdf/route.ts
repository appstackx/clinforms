/**
 * GET /clinics/<clinic>/portal/exercises/<programme>/pdf – the signed-in patient downloads their own SHARED exercise
 * programme as a PDF (only while the clinic has the feature and its portal on). Recorded in the clinic's trail
 * (pms.exercise_programme.portal_pdf). Always a download, never cached. No staff cookie is read.
 */
import { portalProgrammePdfFor } from "@/server/pms/records/exercises-service";
import { portalViewer, publicClinicFor, publicCtx } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });

export async function GET(_req: Request, { params }: { params: { clinicId: string; programmeId: string } }) {
  const clinic = await publicClinicFor(params.clinicId);
  if (!clinic || !clinic.settings.portal) return notFound();
  const viewer = await portalViewer(clinic);
  if (!viewer) return notFound();
  const file = await portalProgrammePdfFor(publicCtx(), clinic, viewer, params.programmeId);
  if (!file) return notFound();
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(file.bytes.byteLength),
      "content-disposition": `attachment; filename="${file.fileName}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
