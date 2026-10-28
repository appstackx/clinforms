"use server";
/**
 * The waiting list's server actions: add, change, remove or put back, offer a slot, answer an offer,
 * book an offer. Each action: the member, the clinic's package and the
 * role's permission first (contract §6), then src/server/pms/diary/writes.ts, which checks the permission and
 * the member's sites again, validates the input and writes the change with its audit row in one batch.
 * Answers are DiaryActionResult (plain words, never an internal error).
 */
import { revalidatePath } from "next/cache";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import {
  type AddToWaitingListRequest,
  type AnswerWaitingListOfferRequest,
  type BookWaitingListOfferRequest,
  type OfferWaitingListSlotRequest,
  type UpdateWaitingListEntryRequest,
  type WaitingListStatusRequest,
  addToWaitingListFor,
  answerWaitingListOfferFor,
  bookWaitingListOfferFor,
  offerWaitingListSlotFor,
  setWaitingListStatusFor,
  updateWaitingListEntryFor,
} from "@/server/pms/diary/writes";

function done(result: DiaryActionResult): DiaryActionResult {
  if (result.ok) revalidatePath("/app/clinic", "layout");
  return result;
}

export async function addToWaitingListAction(input: AddToWaitingListRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await addToWaitingListFor(await diaryCallerOf(actor), input));
}

export async function updateWaitingListEntryAction(input: UpdateWaitingListEntryRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await updateWaitingListEntryFor(await diaryCallerOf(actor), input));
}

export async function setWaitingListStatusAction(input: WaitingListStatusRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await setWaitingListStatusFor(await diaryCallerOf(actor), input));
}

export async function offerWaitingListSlotAction(input: OfferWaitingListSlotRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await offerWaitingListSlotFor(await diaryCallerOf(actor), input));
}

export async function answerWaitingListOfferAction(input: AnswerWaitingListOfferRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.rota" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await answerWaitingListOfferFor(await diaryCallerOf(actor), input));
}

export async function bookWaitingListOfferAction(input: BookWaitingListOfferRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await bookWaitingListOfferFor(await diaryCallerOf(actor), input));
}
