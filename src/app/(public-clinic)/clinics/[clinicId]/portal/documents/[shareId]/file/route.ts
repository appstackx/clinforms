/**
 * GET /clinics/<clinic>/portal/documents/<share>/file – the signed-in patient downloads a FILE the clinic shared with
 * them (PORTAL-004): only their own share, only while it is not withdrawn and the file is still on the record. The
 * file is read from the record (decrypted, checked against its fingerprint) and always sent as a download (sandboxed,
 * nosniff, never cached); the download is recorded in the clinic's trail. No staff cookie is read.
 */
import { asciiFileName } from "@/modules/pms/records/attachments";
import { AttachmentIntegrityError, getAttachmentFile } from "@/server/repos/pms/records/attachments";
import { markShareViewed, recordShareDownload } from "@/server/repos/pms/portal/shares";
import { patientShare } from "@/server/pms/portal/portal-views";
import { portalViewer, publicClinicFor, publicCtx } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });

export async function GET(_req: Request, { params }: { params: { clinicId: string; shareId: string } }) {
  const clinic = await publicClinicFor(params.clinicId);
  if (!clinic || !clinic.settings.portal) return notFound();
  const viewer = await portalViewer(clinic);
  if (!viewer) return notFound();
  const ctx = publicCtx();
  const found = await patientShare(ctx, clinic.tenantId, viewer.patientId, params.shareId);
  if (!found || !found.file) return notFound();
  let file;
  try {
    file = await getAttachmentFile(ctx, clinic.tenantId, found.file.id);
  } catch (err) {
    if (err instanceof AttachmentIntegrityError) return new Response("This file cannot be downloaded. Please contact the clinic.", { status: 500, headers: { "cache-control": "no-store" } });
    throw err;
  }
  if (!file || file.details.patientId !== viewer.patientId || file.details.status !== "active") return notFound();
  await recordShareDownload(ctx, clinic.tenantId, found.share.id, file.details.id, viewer.actor);
  if (!found.share.viewedAt) await markShareViewed(ctx, clinic.tenantId, found.share.id, viewer.actor);
  const name = file.details.fileName;
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "content-type": file.details.mimeType,
      "content-length": String(file.bytes.byteLength),
      "content-disposition": `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
