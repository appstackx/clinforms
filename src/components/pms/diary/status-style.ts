/**
 * Colours of the diary by status. Text is always slate-900/800 on a light tint (contrast well above 4.5:1), and
 * every card also carries its status in words – colour is never the only signal. Browser-safe.
 */
import type { AppointmentStatus, DiaryItemKind } from "@/modules/pms/diary/rules";

export const STATUS_CARD: Readonly<Record<AppointmentStatus, string>> = {
  booked: "border-sky-600 bg-sky-50",
  arrived: "border-amber-500 bg-amber-50",
  attended: "border-emerald-600 bg-emerald-50",
  dna: "border-rose-600 bg-rose-50",
  late_cancelled: "border-orange-500 bg-orange-50 opacity-90",
  cancelled: "border-slate-400 bg-slate-50 opacity-90",
};

export const STATUS_TAG: Readonly<Record<AppointmentStatus, string>> = {
  booked: "bg-sky-100 text-sky-900",
  arrived: "bg-amber-100 text-amber-900",
  attended: "bg-emerald-100 text-emerald-900",
  dna: "bg-rose-100 text-rose-900",
  late_cancelled: "bg-orange-100 text-orange-900",
  cancelled: "bg-slate-200 text-slate-800",
};

export const BLOCK_CARD = "border-slate-500 bg-slate-200 [background-image:repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(100,116,139,0.18)_6px,rgba(100,116,139,0.18)_12px)]";

export function cardClass(kind: DiaryItemKind, status: AppointmentStatus): string {
  if (kind === "block") return status === "cancelled" ? STATUS_CARD.cancelled : BLOCK_CARD;
  return STATUS_CARD[status];
}
