"use server";
/**
 * The diary's server actions: book (single or recurring), rebook, move, resize, status changes, cancel,
 * details, the rest of a series, blocked time. Each action: the member, the clinic's package and the
 * role's permission first (contract §6), then src/server/pms/diary/writes.ts, which checks the permission and
 * the member's sites again, validates the input and writes the change with its audit row in one batch.
 * Answers are DiaryActionResult (plain words, never an internal error).
 */
import { revalidatePath } from "next/cache";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import {
  type AppointmentDetailsRequest,
  type AppointmentStatusRequest,
  type BookAppointmentRequest,
  type CancelAppointmentRequest,
  type CancelSeriesRequest,
  type CreateBlockRequest,
  type MoveAppointmentRequest,
  type RebookAppointmentRequest,
  type ResizeAppointmentRequest,
  type OpenBookingCaseRequest,
  type RegisterBookingPatientRequest,
  type SaveWeeklyRotaRequest,
  type SetDaySheetDobRequest,
  openBookingCaseFor,
  registerBookingPatientFor,
  saveWeeklyRotaFor,
  setDaySheetDobFor,
  startTreatmentFor,
  bookAppointmentFor,
  cancelAppointmentFor,
  cancelSeriesFor,
  createBlockFor,
  moveAppointmentFor,
  rebookAppointmentFor,
  resizeAppointmentFor,
  setAppointmentStatusFor,
  updateAppointmentDetailsFor,
} from "@/server/pms/diary/writes";

function done(result: DiaryActionResult): DiaryActionResult {
  if (result.ok) revalidatePath("/app/clinic", "layout");
  return result;
}

export async function bookAppointmentAction(input: BookAppointmentRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await bookAppointmentFor(await diaryCallerOf(actor), input));
}

export async function rebookAppointmentAction(input: RebookAppointmentRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await rebookAppointmentFor(await diaryCallerOf(actor), input));
}

export async function moveAppointmentAction(input: MoveAppointmentRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await moveAppointmentFor(await diaryCallerOf(actor), input));
}

export async function resizeAppointmentAction(input: ResizeAppointmentRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await resizeAppointmentFor(await diaryCallerOf(actor), input));
}

export async function setAppointmentStatusAction(input: AppointmentStatusRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await setAppointmentStatusFor(await diaryCallerOf(actor), input));
}

export async function cancelAppointmentAction(input: CancelAppointmentRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await cancelAppointmentFor(await diaryCallerOf(actor), input));
}

export async function updateAppointmentDetailsAction(input: AppointmentDetailsRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await updateAppointmentDetailsFor(await diaryCallerOf(actor), input));
}

export async function cancelSeriesAction(input: CancelSeriesRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await cancelSeriesFor(await diaryCallerOf(actor), input));
}

export async function createBlockAction(input: CreateBlockRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await createBlockFor(await diaryCallerOf(actor), input));
}

export async function registerBookingPatientAction(input: RegisterBookingPatientRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await registerBookingPatientFor(await diaryCallerOf(actor), input));
}

export async function openBookingCaseAction(input: OpenBookingCaseRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "patients.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await openBookingCaseFor(await diaryCallerOf(actor), input));
}

export async function startTreatmentAction(input: { id: string }): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "clinical.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await startTreatmentFor(await diaryCallerOf(actor), input));
}

export async function saveWeeklyRotaAction(input: SaveWeeklyRotaRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await saveWeeklyRotaFor(await diaryCallerOf(actor), input));
}

export async function setDaySheetDobAction(input: SetDaySheetDobRequest): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return done(await setDaySheetDobFor(await diaryCallerOf(actor), input));
}
