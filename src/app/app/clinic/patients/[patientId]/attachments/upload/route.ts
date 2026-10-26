/**
 * POST /app/clinic/patients/[patientId]/attachments/upload – attach a file to the patient's record (multipart:
 * file, description, noteId). Same-origin only (clinicRoute); the size is checked before the body is read and again on
 * the bytes; the type comes from the file's own bytes; stored encrypted (src/server/repos/pms/records/attachments.ts).
 */
import { MAX_ATTACHMENT_BYTES } from "@/modules/pms/records/attachments";
import { isPlausibleRecordId } from "@/modules/pms/records/form-values";
import { clinicRoute } from "@/server/pms/http";
import { getPatient } from "@/server/repos/pms/patients";
import { putAttachment } from "@/server/repos/pms/records/attachments";
import { getNote } from "@/server/repos/pms/records/notes";

export const dynamic = "force-dynamic";

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export const POST = clinicRoute<{ patientId: string }>({ permission: "clinical.edit" }, async (req, actor, params) => {
  if (!isPlausibleRecordId(params.patientId)) return fail(404, "NOT_FOUND", "This record no longer exists in this clinic.");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES + 64 * 1024) return fail(413, "TOO_LARGE", "The file is larger than 4 MB.");
  const ctx = actor.repo();
  const patient = await getPatient(ctx, actor.tenantId, params.patientId);
  if (!patient) return fail(404, "NOT_FOUND", "This record no longer exists in this clinic.");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "BAD_FORM", "The upload could not be read. Choose the file again.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return fail(400, "NO_FILE", "Choose a file to attach.");
  if (file.size > MAX_ATTACHMENT_BYTES) return fail(413, "TOO_LARGE", "The file is larger than 4 MB.");
  const noteIdRaw = form.get("noteId");
  const noteId = typeof noteIdRaw === "string" && noteIdRaw ? noteIdRaw : null;
  if (noteId) {
    const note = await getNote(ctx, actor.tenantId, noteId);
    if (!note || note.patientId !== patient.id) return fail(404, "NOT_FOUND", "That note is not part of this record.");
  }
  const description = form.get("description");
  const meta = await putAttachment(
    ctx,
    actor.tenantId,
    { patientId: patient.id, noteId, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, description: typeof description === "string" ? description : null },
    actor.actor,
  );
  return Response.json({ ok: true, id: meta.id, type: meta.type, sizeBytes: meta.sizeBytes });
});
