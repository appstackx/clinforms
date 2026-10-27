"use server";
/**
 * Clinical notes: start a draft, save it, sign and lock it, discard a draft, amend a signed note. The records service
 * (src/server/pms/records/notes-service.ts) checks the clinical permission again BEFORE reading anything, reads the
 * note from the member's own clinic and checks it is the patient's; the repositories enforce the rest (only the
 * author edits or signs a draft; a signed note is locked – a database trigger backs it up).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AmendmentKind } from "@/modules/pms/records/notes";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { intField, optional, text } from "@/server/pms/records/forms";
import { amendNoteFor, discardNoteFor, saveNoteFor, startNoteFor } from "@/server/pms/records/notes-service";
import { patientPath } from "@/server/pms/records/record";

function sectionsFrom(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Array.from(form.entries())) {
    if (key.startsWith("section_") && typeof value === "string") out[key.slice("section_".length)] = value;
  }
  return out;
}

/** The body chart field: absent = unchanged; unreadable = refused by the service. */
function chartFrom(form: FormData): unknown {
  const raw = text(form, "bodyChart");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return { markers: "unreadable" };
  }
}

export async function startNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await startNoteFor(actor, patientId, { templateId: text(form, "templateId"), seenOn: text(form, "seenOn"), caseId: optional(form, "caseId"), appointmentId: optional(form, "appointmentId") });
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  revalidatePath(patientPath(patientId, "notes"));
  redirect(patientPath(patientId, `notes/${result.value.id}`));
}

export async function saveNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const sign = text(form, "intent") === "sign";
  const result = await saveNoteFor(actor, patientId, text(form, "noteId"), {
    expectedRev: intField(form, "expectedRev"),
    sections: sectionsFrom(form),
    bodyChart: chartFrom(form) as never,
    seenOn: text(form, "seenOn") || undefined,
    caseId: optional(form, "caseId"),
    sign,
  });
  if (result.ok || result.rev !== undefined) revalidatePath(patientPath(patientId, "notes"), "layout");
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: v.signed ? "Signed and locked." : "Draft saved." }));
}

export async function discardNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await discardNoteFor(actor, patientId, text(form, "noteId"), intField(form, "expectedRev"));
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  revalidatePath(patientPath(patientId, "notes"), "layout");
  redirect(patientPath(patientId, "notes"));
}

export async function amendNote(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.sign" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await amendNoteFor(actor, patientId, text(form, "noteId"), {
    kind: text(form, "kind") as AmendmentKind,
    sectionKey: optional(form, "sectionKey"),
    text: text(form, "text"),
    reason: optional(form, "reason"),
  });
  if (result.ok) revalidatePath(patientPath(patientId, "notes"), "layout");
  return actionState(result, (v) => ({ ok: true, id: v.id, message: "The amendment is added and locked." }));
}
