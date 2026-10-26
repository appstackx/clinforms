"use server";
/**
 * The diary's server actions: book, block time, move (drag and drop and the keyboard form), change the status,
 * change the details, cancel the rest of a series. Each checks the member, the clinic's package and the role's
 * permission first (contract §6), validates with the module's zod schemas, and answers DiaryActionResult.
 */
import { revalidatePath } from "next/cache";
import { PMS_ID_PATTERN } from "@/modules/pms/core/ids";
import { isIsoDate } from "@/modules/pms/core/text";
import { STATUS_LABELS } from "@/modules/pms/diary/copy";
import { CANCEL_REASONS, type CancelReason } from "@/modules/pms/diary/rules";
import {
  AppointmentDetailsPatchSchema,
  AppointmentStatusChangeSchema,
  BlockInputSchema,
  BookAppointmentSchema,
  MoveAppointmentSchema,
  type AppointmentDetailsPatch,
  type AppointmentStatusChange,
  type BlockInput,
  type BookAppointmentInput,
  type MoveAppointmentInput,
} from "@/modules/pms/diary/schemas";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { clashMessages, diaryAction, fromSaveResult, invalid, warningMessages, type DiaryActionResult } from "@/server/pms/diary/actions-support";
import { bookAppointment, cancelSeriesFrom, createBlock, moveAppointment, setAppointmentStatus, updateAppointmentDetails } from "@/server/repos/pms/diary/appointments";

const CLINIC = "/app/clinic";

function refresh(): void {
  revalidatePath(CLINIC, "layout");
}

const badId = (): DiaryActionResult => ({ ok: false, error: "This appointment no longer exists.", conflict: true });

export type BookActionInput = BookAppointmentInput & { skipClashes?: boolean; allowPatientOverlap?: boolean; waitingListId?: string | null };

export async function bookAppointmentAction(input: BookActionInput): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const { skipClashes, allowPatientOverlap, waitingListId, ...booking } = input ?? ({} as BookActionInput);
  const parsed = BookAppointmentSchema.safeParse(booking);
  if (!parsed.success) return invalid(parsed.error);
  if (waitingListId && !PMS_ID_PATTERN.test(waitingListId)) return { ok: false, error: "That waiting-list entry does not exist." };
  return diaryAction("book", async () => {
    const r = await bookAppointment(actor.repo(), actor.tenantId, booking, actor.actor, {
      skipClashes: skipClashes === true,
      allowPatientOverlap: allowPatientOverlap === true,
      waitingListId: waitingListId || undefined,
    });
    if (!r.ok) {
      const occurrences = parsed.data.repeat?.occurrences ?? 1;
      const clashDates = new Set(r.clashes.map((c) => c.date));
      return {
        ok: false,
        error: occurrences > 1 ? `${clashDates.size} of the ${occurrences} dates are not free.` : "That time is not free.",
        clashes: clashMessages(r.clashes),
        canSkipClashes: occurrences > 1 && clashDates.size < occurrences,
        patientOnly: r.clashes.every((c) => c.resource === "patient"),
      };
    }
    refresh();
    const n = r.items.length;
    const skipped = r.skippedDates.length;
    return {
      ok: true,
      message: n === 1 ? "Appointment booked." : `${n} appointments booked${skipped ? ` (${skipped} ${skipped === 1 ? "date" : "dates"} skipped)` : ""}.`,
      warnings: warningMessages(r.warnings),
      itemId: r.items[0]?.id,
    };
  });
}

export async function createBlockAction(input: BlockInput): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const parsed = BlockInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("block", async () => {
    const r = await createBlock(actor.repo(), actor.tenantId, input, actor.actor);
    if (!r.ok) return { ok: false, error: "Something is already booked in that time. Move or cancel it first.", clashes: clashMessages(r.clashes) };
    refresh();
    return { ok: true, message: "Time blocked.", warnings: [], itemId: r.item.id };
  });
}

export type MoveActionInput = MoveAppointmentInput & { id: string };

export async function moveAppointmentAction(input: MoveActionInput): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const { id, ...move } = input ?? ({} as MoveActionInput);
  if (typeof id !== "string" || !PMS_ID_PATTERN.test(id)) return badId();
  const parsed = MoveAppointmentSchema.safeParse(move);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("move", async () => {
    const r = await moveAppointment(actor.repo(), actor.tenantId, id, move, actor.actor);
    if (r.ok) refresh();
    return fromSaveResult(r, "Moved.");
  });
}

export type StatusActionInput = AppointmentStatusChange & { id: string };

export async function setAppointmentStatusAction(input: StatusActionInput): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const { id, ...change } = input ?? ({} as StatusActionInput);
  if (typeof id !== "string" || !PMS_ID_PATTERN.test(id)) return badId();
  const parsed = AppointmentStatusChangeSchema.safeParse(change);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("status", async () => {
    const r = await setAppointmentStatus(actor.repo(), actor.tenantId, id, change, actor.actor);
    if (r.ok) refresh();
    return fromSaveResult(r, `${STATUS_LABELS[parsed.data.status]}.`);
  });
}

export type DetailsActionInput = AppointmentDetailsPatch & { id: string; expectedRev: number };

export async function updateAppointmentDetailsAction(input: DetailsActionInput): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const { id, expectedRev, ...patch } = input ?? ({} as DetailsActionInput);
  if (typeof id !== "string" || !PMS_ID_PATTERN.test(id)) return badId();
  if (!Number.isInteger(expectedRev) || expectedRev < 1) return badId();
  const parsed = AppointmentDetailsPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("details", async () => {
    const r = await updateAppointmentDetails(actor.repo(), actor.tenantId, id, expectedRev, patch, actor.actor);
    if (r.ok) refresh();
    return fromSaveResult(r, "Saved.");
  });
}

export type CancelSeriesInput = { seriesId: string; fromDate: string; reason?: CancelReason };

export async function cancelSeriesAction(input: CancelSeriesInput): Promise<DiaryActionResult> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const { seriesId, fromDate, reason } = input ?? ({} as CancelSeriesInput);
  if (typeof seriesId !== "string" || !PMS_ID_PATTERN.test(seriesId) || !isIsoDate(fromDate)) return { ok: false, error: "That recurring booking no longer exists." };
  if (reason !== undefined && !(CANCEL_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "Choose a reason." };
  return diaryAction("cancel_series", async () => {
    const n = await cancelSeriesFrom(actor.repo(), actor.tenantId, seriesId, fromDate, actor.actor, reason ?? "patient");
    refresh();
    return { ok: true, message: n === 0 ? "Nothing left to cancel." : `${n} ${n === 1 ? "appointment" : "appointments"} cancelled.`, warnings: [] };
  });
}
