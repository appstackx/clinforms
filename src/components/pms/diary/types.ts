/**
 * The diary's server actions as the client components receive them (passed down from the server page, so the
 * components never import app or server code). Browser-safe types only.
 */
import type { CancelReason } from "@/modules/pms/diary/rules";
import type { AppointmentDetailsPatch, AppointmentStatusChange, BlockInput, BookAppointmentInput, MoveAppointmentInput } from "@/modules/pms/diary/schemas";
import type { DiaryActionResult } from "@/modules/pms/diary/types";

export interface DiaryActions {
  book: (input: BookAppointmentInput & { skipClashes?: boolean; allowPatientOverlap?: boolean; waitingListId?: string | null }) => Promise<DiaryActionResult>;
  block: (input: BlockInput) => Promise<DiaryActionResult>;
  move: (input: MoveAppointmentInput & { id: string }) => Promise<DiaryActionResult>;
  status: (input: AppointmentStatusChange & { id: string }) => Promise<DiaryActionResult>;
  details: (input: AppointmentDetailsPatch & { id: string; expectedRev: number }) => Promise<DiaryActionResult>;
  cancelSeries: (input: { seriesId: string; fromDate: string; reason?: CancelReason }) => Promise<DiaryActionResult>;
}
