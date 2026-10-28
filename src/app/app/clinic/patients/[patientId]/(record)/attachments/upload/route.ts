/**
 * POST /app/clinic/patients/[patientId]/attachments/upload – attach a file to the patient's record (multipart:
 * file, description, noteId, caseId). Same-origin only and clinical.edit (clinicRoute); the body is read with a hard
 * limit whatever Content-Length says; the records service checks the permission again, the patient, note and case,
 * the size, and the type from the file's own bytes; stored encrypted (src/server/pms/records/attachments-service.ts).
 * Answers JSON { ok, id, type, sizeBytes } or { error: { code, message } }.
 */
import { MAX_ATTACHMENT_BYTES } from "@/modules/pms/records/attachments";
import { clinicRoute } from "@/server/pms/http";
import { readLimitedBody, uploadFileFor } from "@/server/pms/records/attachments-service";
import { failureStatus } from "@/server/pms/records/http-status";

export const dynamic = "force-dynamic";

/** Room for the multipart envelope and the small text fields around the file. */
const BODY_LIMIT = MAX_ATTACHMENT_BYTES + 64 * 1024;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export const POST = clinicRoute<{ patientId: string }>({ permission: "clinical.edit" }, async (req, actor, params) => {
  if (Number(req.headers.get("content-length") ?? "0") > BODY_LIMIT) return fail(413, "TOO_LARGE", "The file is larger than 4 MB.");
  const body = await readLimitedBody(req, BODY_LIMIT);
  if (!body) return fail(413, "TOO_LARGE", "The file is larger than 4 MB.");
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return fail(400, "BAD_FORM", "The upload could not be read. Choose the file again.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return fail(400, "NO_FILE", "Choose a file to attach.");
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" && v !== "" ? v : null;
  };
  const result = await uploadFileFor(actor, params.patientId, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    description: field("description"),
    noteId: field("noteId"),
    caseId: field("caseId"),
  });
  if (!result.ok) return fail(failureStatus(result.code), result.code.toUpperCase(), result.error);
  return Response.json({ ok: true, id: result.value.id, type: result.value.type, sizeBytes: result.value.sizeBytes });
});
