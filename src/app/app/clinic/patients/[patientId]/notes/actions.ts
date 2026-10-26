"use server";
/**
 * Clinical notes: start a draft, save it, sign and lock it, discard a draft, amend a signed note. The repositories
 * enforce the rules (only the author edits or signs a draft; a signed note is locked); these actions read the note
 * from the member's own clinic and check it belongs to the patient of the form.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BodyChartSchema } from "@/modules/pms/records/body-chart";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor, type ClinicActor } from "@/server/pms/actor";
import { intField, optional, text } from "@/server/pms/records/forms";
import { NOT_FOUND_MESSAGE, actionError, noteAuthor, patientForAction, patientPath, saveError } from "@/server/pms/records/record";
import { addAmendment, createNoteDraft, discardNoteDraft, getNote, saveNoteDraft, signNote } from "@/server/repos/pms/records/notes";

async function noteOfPatient(actor: ClinicActor, form: FormData) {
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return null;
  const note = await getNote(actor.repo(), actor.tenantId, text(form, "noteId"));
  return note && note.patientId === patient.id ? { patient, note } : null;
}

function sectionsFrom(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Array.from(form.entries())) {
    if (key.startsWith("section_") && typeof value === "string") out[key.slice("section_".length)] = value;
  }
  return out;
}

function chartFrom(form: FormData) {
  const raw = text(form, "bodyChart");
  if (!raw) return undefined;
  try {
    const parsed = BodyChartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function startNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patient = await patientForAction(actor, form.get("patientId"));
  if (!patient) return { ok: false, error: NOT_FOUND_MESSAGE };
  const seenOn = text(form, "seenOn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seenOn)) return { ok: false, error: "Enter the consultation date.", fieldErrors: { seenOn: "Enter the consultation date." } };
  let id: string;
  try {
    const author = await noteAuthor(actor);
    const draft = await createNoteDraft(
      actor.repo(),
      actor.tenantId,
      { patientId: patient.id, caseId: optional(form, "caseId"), templateId: text(form, "templateId"), seenOn, practitionerId: author.practitionerId },
      author,
      actor.actor,
    );
    id = draft.id;
  } catch (err) {
    return actionError(err, "start_note");
  }
  revalidatePath(patientPath(patient.id, "notes"));
  redirect(patientPath(patient.id, `notes/${id}`));
}

export async function saveNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await noteOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  const sign = text(form, "intent") === "sign";
  if (sign && !actor.can("clinical.sign")) return { ok: false, error: actorErrorMessage("forbidden") };
  const chart = chartFrom(form);
  if (chart === null) return { ok: false, error: "The body chart could not be read. Reload the page and try again." };
  const seenOn = text(form, "seenOn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seenOn)) return { ok: false, error: "Enter the consultation date.", fieldErrors: { seenOn: "Enter the consultation date." } };
  const ctx = actor.repo();
  let rev = intField(form, "expectedRev");
  try {
    const saved = await saveNoteDraft(ctx, actor.tenantId, found.note.id, rev, { sections: sectionsFrom(form), bodyChart: chart, seenOn, caseId: optional(form, "caseId") }, actor.actor);
    if (!saved.ok) return saveError(saved);
    rev = saved.rev;
    if (sign) {
      const signed = await signNote(ctx, actor.tenantId, found.note.id, rev, await noteAuthor(actor), actor.actor);
      if (!signed.ok) return saveError(signed);
      rev = signed.rev;
    }
  } catch (err) {
    const answer = actionError(err, sign ? "sign_note" : "save_note");
    if (!sign || rev === intField(form, "expectedRev")) return answer;
    // Saved but not signed (e.g. an empty note): say so, and give the form the new revision.
    revalidatePath(patientPath(found.patient.id, "notes"), "layout");
    return { ...answer, rev, error: `Your changes are saved, but the note is not signed: ${answer.error}` };
  }
  revalidatePath(patientPath(found.patient.id, "notes"), "layout");
  return { ok: true, rev, message: sign ? "Signed and locked." : "Draft saved." };
}

export async function discardNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await noteOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  try {
    const result = await discardNoteDraft(actor.repo(), actor.tenantId, found.note.id, intField(form, "expectedRev"), actor.actor);
    if (!result.ok) return saveError(result);
  } catch (err) {
    return actionError(err, "discard_note");
  }
  revalidatePath(patientPath(found.patient.id, "notes"), "layout");
  redirect(patientPath(found.patient.id, "notes"));
}

export async function amendNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.sign" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const found = await noteOfPatient(actor, form);
  if (!found) return { ok: false, error: NOT_FOUND_MESSAGE };
  const kind = text(form, "kind");
  const fieldErrors: Record<string, string> = {};
  if (kind === "correction" && !optional(form, "sectionKey")) fieldErrors.sectionKey = "Choose the section you are correcting.";
  if (kind !== "entered_in_error" && !optional(form, "text")) fieldErrors.text = "Write the amendment.";
  if (kind !== "addendum" && !optional(form, "reason")) fieldErrors.reason = "Give the reason.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Some details need checking.", fieldErrors };
  try {
    await addAmendment(
      actor.repo(),
      actor.tenantId,
      found.note.id,
      { kind: kind as "addendum" | "correction" | "entered_in_error", sectionKey: optional(form, "sectionKey"), text: text(form, "text"), reason: optional(form, "reason") },
      await noteAuthor(actor),
      actor.actor,
    );
  } catch (err) {
    return actionError(err, "amend_note");
  }
  revalidatePath(patientPath(found.patient.id, "notes"), "layout");
  return { ok: true, message: "The amendment is added and locked." };
}
