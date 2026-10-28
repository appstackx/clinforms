"use server";
/**
 * The rota (practitioners' working times) server actions: add, change, end. Each action: the member, the clinic's package and the
 * role's permission first (contract §6), then src/server/pms/diary/writes.ts, which checks the permission and
 * the member's sites again, validates the input and writes the change with its audit row in one batch.
 * Answers are DiaryActionResult (plain words, never an internal error).
 */
import { revalidatePath } from "next/cache";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import {
  type CreateRotaEntryRequest,
  type EndRotaEntryRequest,
  type UpdateRotaEntryRequest,
  createRotaEntryFor,
  endRotaEntryFor,
  updateRotaEntryFor,
} from "@/server/pms/diary/writes";

function done(result: DiaryActionResult): DiaryActionResult {
  if (result.ok) revalidatePath("/app/clinic", "layout");
  return result;
}

export async function createRotaEntryAction(input: CreateRotaEntryRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await createRotaEntryFor(await diaryCallerOf(actor), input));
}

export async function updateRotaEntryAction(input: UpdateRotaEntryRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await updateRotaEntryFor(await diaryCallerOf(actor), input));
}

export async function endRotaEntryAction(input: EndRotaEntryRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await endRotaEntryFor(await diaryCallerOf(actor), input));
}
