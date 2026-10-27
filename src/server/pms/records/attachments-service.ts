/**
 * Files attached to a patient's record (referral letters, scan reports, photos of exercise sheets) for the records
 * screens: list, upload (type from the file's own bytes, size limits, encrypted in pieces), download (verified,
 * always as a download, recorded in the history), withdraw (hidden, kept). Rules: ./access.ts.
 *
 *   clinical.view   – list, download active files
 *   clinical.edit   – upload, withdraw
 *   patients.export – also download a withdrawn file (subject access: the patient's copy of everything kept)
 */
import { MAX_ATTACHMENT_BYTES, MAX_DESCRIPTION_CHARS } from "../../../modules/pms/records/attachments";
import type { AttachmentDetails, AttachmentMeta } from "../../../modules/pms/records/types";
import { getCase } from "../../repos/pms/cases";
import { getAnonymisation } from "../../repos/pms/records/anonymise";
import { AttachmentIntegrityError, getAttachment, getAttachmentFile, getPatientAttachments, putAttachment, recordAttachmentDownload, withdrawAttachment } from "../../repos/pms/records/attachments";
import { getNote } from "../../repos/pms/records/notes";
import { attempt, fail, guard, notFound, ok, patientInClinic, type RecordsActor, type Result } from "./access";

export async function listFilesFor(actor: RecordsActor, patientId: string, options: { includeWithdrawn?: boolean } = {}): Promise<Result<AttachmentDetails[]>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("list_files", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    return ok(await getPatientAttachments(actor.repo(), actor.tenantId, patient.id, { includeWithdrawn: options.includeWithdrawn === true }));
  });
}

export interface UploadFileInput {
  bytes: Uint8Array;
  fileName: string;
  description?: string | null;
  noteId?: string | null;
  caseId?: string | null;
}

export async function uploadFileFor(actor: RecordsActor, patientId: string, input: UploadFileInput): Promise<Result<AttachmentMeta>> {
  const denied = guard(actor, "clinical.edit");
  if (denied) return denied;
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) return fail("invalid", "Choose a file to attach.");
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) return fail("invalid", "The file is larger than 4 MB.");
  if (typeof input.description === "string" && input.description.trim().length > MAX_DESCRIPTION_CHARS) return fail("invalid", `The description can be at most ${MAX_DESCRIPTION_CHARS} characters.`, { fieldErrors: { description: "Too long." } });
  return attempt("upload_file", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    if (await getAnonymisation(actor.repo(), actor.tenantId, patient.id)) return fail("invalid", "This record has been anonymised. No files can be added.");
    if (input.noteId) {
      const note = await getNote(actor.repo(), actor.tenantId, input.noteId);
      if (!note || note.patientId !== patient.id) return fail("invalid", "That note is not part of this record.");
    }
    if (input.caseId) {
      const c = await getCase(actor.repo(), actor.tenantId, input.caseId);
      if (!c || c.patientId !== patient.id) return fail("invalid", "That case is not part of this record.");
    }
    return ok(await putAttachment(actor.repo(), actor.tenantId, { patientId: patient.id, noteId: input.noteId ?? null, caseId: input.caseId ?? null, bytes: input.bytes, fileName: input.fileName, description: input.description ?? null }, actor.actor));
  });
}

export interface FileDownload {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function downloadFileFor(actor: RecordsActor, patientId: string, attachmentId: string): Promise<Result<FileDownload>> {
  const denied = guard(actor, "clinical.view");
  if (denied) return denied;
  return attempt("download_file", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient || !attachmentId) return notFound();
    const meta = await getAttachment(actor.repo(), actor.tenantId, attachmentId);
    if (!meta || meta.patientId !== patient.id) return notFound();
    if (meta.status === "withdrawn" && !actor.can("patients.export")) return notFound();
    let file;
    try {
      file = await getAttachmentFile(actor.repo(), actor.tenantId, meta.id);
    } catch (err) {
      if (err instanceof AttachmentIntegrityError) return fail("error", "The stored file failed its check and cannot be downloaded. Contact support.");
      throw err;
    }
    if (!file) return notFound();
    await recordAttachmentDownload(actor.repo(), actor.tenantId, meta.id, actor.actor);
    return ok({ fileName: file.details.fileName, mimeType: file.details.mimeType, bytes: new Uint8Array(file.bytes) });
  });
}

export async function withdrawFileFor(actor: RecordsActor, patientId: string, attachmentId: string, reason: string): Promise<Result<{ changed: boolean }>> {
  const denied = guard(actor, "clinical.edit");
  if (denied) return denied;
  const text = String(reason ?? "").trim();
  if (!text) return fail("invalid", "Give the reason.", { fieldErrors: { reason: "Give the reason." } });
  return attempt("withdraw_file", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient || !attachmentId) return notFound();
    const meta = await getAttachment(actor.repo(), actor.tenantId, attachmentId);
    if (!meta || meta.patientId !== patient.id) return notFound();
    return ok({ changed: await withdrawAttachment(actor.repo(), actor.tenantId, meta.id, text, actor.actor) });
  });
}

/**
 * Reads a request body of at most `maxBytes` (the upload route): stops reading – and answers null – as soon as the
 * body is longer, whatever Content-Length says (a missing or false header cannot make the server buffer more).
 */
export async function readLimitedBody(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
