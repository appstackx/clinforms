"use server";
/**
 * Set-up → Exercises (ex03): the clinic's switch and its own exercise library. settings.setup, behind
 * CLINFORMS_EXERCISE=on. The service (src/server/pms/records/exercises-service.ts) checks the permission and the
 * switch again and validates.
 */
import { revalidatePath } from "next/cache";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { actionState } from "@/server/pms/records/action-state";
import { addDemoExercisesFor, saveLibraryExerciseFor, setExercisesEnabledFor, setLibraryExerciseActiveFor } from "@/server/pms/records/exercises-service";
import { intField, optional, text } from "@/server/pms/records/forms";

const PATH = "/app/clinic/setup/exercises";

export async function setExercisesSwitch(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const on = text(form, "enabled") === "on";
  const result = await setExercisesEnabledFor(actor, on);
  if (result.ok) revalidatePath(PATH);
  return actionState(result, () => ({ ok: true, message: on ? "Exercise programmes are on for this clinic." : "Exercise programmes are off. Programmes already given are kept on the records." }));
}

export async function saveLibraryExercise(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const exerciseId = optional(form, "exerciseId");
  const result = await saveLibraryExerciseFor(actor, {
    id: exerciseId,
    rev: exerciseId ? intField(form, "rev") : undefined,
    name: text(form, "name"),
    bodyArea: optional(form, "bodyArea"),
    instructions: optional(form, "instructions"),
    cautions: optional(form, "cautions"),
    imageUrl: optional(form, "imageUrl"),
    videoUrl: optional(form, "videoUrl"),
  });
  if (result.ok) revalidatePath(PATH);
  return actionState(result, (v) => ({ ok: true, id: v.id, rev: v.rev, message: exerciseId ? "Saved. Programmes already given keep their own copy." : "Added to the library." }));
}

export async function setLibraryExerciseActive(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const active = text(form, "active") === "on";
  const result = await setLibraryExerciseActiveFor(actor, text(form, "exerciseId"), intField(form, "rev"), active);
  if (result.ok) revalidatePath(PATH);
  return actionState(result, () => ({ ok: true, message: active ? "Back in the library." : "Archived. It no longer shows in the programme builder." }));
}

export async function addDemoExercises(_prev: RecordsActionState, _form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const result = await addDemoExercisesFor(actor);
  if (result.ok) revalidatePath(PATH);
  return actionState(result, (v) => ({ ok: true, message: v.added ? `${v.added} demo exercises added.` : "The demo exercises are already in the library." }));
}
