"use server";
/**
 * The note-template editor and the clinic's note settings (owner / administrator: settings.setup). The editor is a
 * client component, so these actions take plain objects (validated in the records service,
 * src/server/pms/records/templates-service.ts, which checks the permission again). Every change is a new revision:
 * notes keep the snapshot and version of the template they were started from.
 */
import { revalidatePath } from "next/cache";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { PATIENTS_PATH } from "@/server/pms/records/record";
import {
  copyTemplateFor,
  createTemplateFor,
  saveRecordsSettingsFor,
  setTemplateRetiredFor,
  updateTemplateFor,
  type TemplateEditorInput,
} from "@/server/pms/records/templates-service";

const TEMPLATES_PATH = `${PATIENTS_PATH}/note-templates`;

export async function createNoteTemplateAction(input: TemplateEditorInput): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const result = await createTemplateFor(actor, input);
  if (result.ok) revalidatePath(TEMPLATES_PATH);
  return actionState(result, (t) => ({ ok: true, id: t.id, rev: t.rev, message: "The template is added." }));
}

export async function copyNoteTemplateAction(fromTemplateId: string, name: string): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const result = await copyTemplateFor(actor, fromTemplateId, name);
  if (result.ok) revalidatePath(TEMPLATES_PATH);
  return actionState(result, (t) => ({ ok: true, id: t.id, rev: t.rev, message: "The copy is made." }));
}

export async function updateNoteTemplateAction(templateId: string, expectedRev: number, patch: Partial<TemplateEditorInput>): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const result = await updateTemplateFor(actor, templateId, expectedRev, patch);
  if (result.ok) revalidatePath(TEMPLATES_PATH);
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: "The template is saved. Notes already written keep the version they were started from." }));
}

export async function retireNoteTemplateAction(templateId: string, expectedRev: number, retired: boolean): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const result = await setTemplateRetiredFor(actor, templateId, expectedRev, retired);
  if (result.ok) revalidatePath(TEMPLATES_PATH);
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: retired ? "The template is retired. Notes already written with it are unchanged." : "The template is in use again." }));
}

export async function saveRecordsSettingsAction(expectedRev: number, unsignedNoteDays: number): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const result = await saveRecordsSettingsFor(actor, expectedRev, { unsignedNoteDays });
  if (result.ok) revalidatePath(TEMPLATES_PATH);
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: "The settings are saved." }));
}
