"use client";
/**
 * What can be done with one diary item, shared by the appointment drawer (its Quick actions buttons) and the
 * block's context menu (right-click, Shift+F10 or the menu key) – the same actions, in the same order, by status:
 * Arrived → Start treatment ("In treatment"; a clinician's note opens) → Completed, Did not attend, Cancel…, Move,
 * the undo of each step, Open record, Send message, Take payment, Rebook; blocked time: Remove / Restore.
 * The server leaves out what the time of day does not allow yet (nextStatuses), so neither offers a button the
 * server would refuse.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Activity, Ban, CalendarCheck, CheckCircle2, CreditCard, MessageSquare, Move, Repeat, User, UserCheck, UserX, XCircle } from "lucide-react";
import { setAppointmentStatusAction, startTreatmentAction } from "@/app/app/clinic/diary/actions";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { BLOCK_KIND_LABELS } from "@/modules/pms/diary/copy";
import type { AppointmentStatus, BlockKind } from "@/modules/pms/diary/rules";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import type { AppointmentDetailsView } from "@/modules/pms/diary/view";

export interface DrawerPermissions {
  book: boolean;
  /** billing.pay: "Take payment" opens billing's take-payment dialog for the patient. */
  pay?: boolean;
  /** clinical.write: "Start treatment" also opens the clinical note for the appointment. */
  clinical: boolean;
  /** messages.send: "Send message" opens the comms module's send form for the patient (COMMS-011). */
  message?: boolean;
}

/** A panel of the drawer an action opens (the context menu opens the drawer on it). */
export type DrawerPanel = "cancel" | "pay" | "message";

export type StatusUndo = { id: string; rev: number; status: AppointmentStatus };

export interface AppointmentActionSpec {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  primary?: boolean;
  danger?: boolean;
  /** The drawer's shortcut hint ("A", "M"). */
  kbd?: string;
  /** A link (Open record): the drawer renders it as a link, the menu navigates. */
  href?: string;
  /** Opens a drawer panel instead of acting at once. */
  panel?: DrawerPanel;
  testId?: string;
  run: () => void;
}

export interface AppointmentActionHandlers {
  onChanged: (message: string, undo: StatusUndo | null) => void;
  onError: (message: string) => void;
  onMove: (id: string) => void;
  onRebook: (details: AppointmentDetailsView) => void;
  /** Opens one of the drawer's panels (cancel form, take payment, send message). */
  openPanel: (panel: DrawerPanel) => void;
  /** After a change that worked (the drawer closes its cancel form). */
  onDone?: () => void;
}

export const itemName = (d: AppointmentDetailsView) => d.patient?.name ?? (d.kind === "block" ? (d.title || (d.blockKind ? BLOCK_KIND_LABELS[d.blockKind as BlockKind] : "Blocked time")) : "Appointment");

export function useAppointmentActions(d: AppointmentDetailsView | null, can: DrawerPermissions, h: AppointmentActionHandlers) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const name = d ? itemName(d) : "";

  const run = async (label: string, work: () => Promise<DiaryActionResult>, okMessage: (r: Extract<DiaryActionResult, { ok: true }>) => string, undo?: (r: Extract<DiaryActionResult, { ok: true }>) => StatusUndo | null) => {
    setBusy(label);
    const r = await work();
    setBusy(null);
    if (!r.ok) {
      h.onError([r.error, ...(r.clashes ?? [])].join(" "));
      if (r.conflict) router.refresh();
      return;
    }
    h.onDone?.();
    h.onChanged(okMessage(r), undo ? undo(r) : null);
  };

  const setStatus = (to: AppointmentStatus, message: string) =>
    d &&
    void run(
      to,
      () => setAppointmentStatusAction({ id: d.id, expectedRev: d.rev, status: to }),
      () => message,
      (r) => ({ id: d.id, rev: r.rev ?? d.rev + 1, status: d.status }),
    );

  /** Start treatment (or, once in treatment, open the note again): the status, and the clinician's note. */
  const startTreatment = async () => {
    if (!d) return;
    setBusy("treat");
    const r = await startTreatmentAction({ id: d.id });
    setBusy(null);
    if (!r.ok) {
      h.onError(r.error);
      if (r.conflict) router.refresh();
      return;
    }
    if (d.status === "arrived") h.onChanged(`${name} – treatment started`, { id: d.id, rev: r.rev ?? d.rev + 1, status: "arrived" });
    if (d.patient && r.noteId) router.push(`${CLINIC_BASE_PATH}/patients/${d.patient.id}/notes/${r.noteId}`);
  };

  const actions: AppointmentActionSpec[] = [];
  const a = (key: string, label: string, icon: AppointmentActionSpec["icon"], runIt: () => void, opts: Partial<AppointmentActionSpec> = {}) => actions.push({ key, label, icon, run: runIt, ...opts });
  if (d && can.book && d.kind === "appointment") {
    const s = d.status;
    const allowed = (to: AppointmentStatus) => d.nextStatuses.includes(to);
    const complete = (primary: boolean) => a("attended", "Completed", CheckCircle2, () => setStatus("attended", `${name} marked as completed`), { primary });
    const cancel = () => a("cancel", "Cancel…", XCircle, () => h.openPanel("cancel"), { danger: true, panel: "cancel" });
    if (s === "booked") {
      if (allowed("arrived")) a("arrived", "Arrived", UserCheck, () => setStatus("arrived", `${name} marked as arrived`), { primary: true, kbd: "A" });
      if (allowed("dna")) a("dna", "Did not attend", UserX, () => setStatus("dna", `${name} marked as DNA`), { kbd: "D" });
      cancel();
      if (d.canMove) a("move", "Move", Move, () => h.onMove(d.id), { kbd: "M" });
      if (allowed("attended")) complete(false);
    } else if (s === "arrived") {
      a("treat", "Start treatment", Activity, () => void startTreatment(), { primary: true });
      complete(false);
      cancel();
      a("booked", "Undo arrival", CalendarCheck, () => setStatus("booked", "Arrival removed"));
    } else if (s === "in_treatment") {
      if (can.clinical) a("treat", "Open note", Activity, () => void startTreatment(), { primary: true });
      complete(!can.clinical);
      a("arrived", "Undo start of treatment", CalendarCheck, () => setStatus("arrived", "Back to arrived"));
    } else if (s === "attended") {
      const back: AppointmentStatus = d.treatmentStarted ? "in_treatment" : "arrived";
      a(back, "Undo completed", CalendarCheck, () => setStatus(back, "Completion removed"));
    } else if (s === "dna") {
      a("booked", "Undo DNA", CalendarCheck, () => setStatus("booked", "DNA removed"));
      if (allowed("attended")) complete(false);
    } else {
      a("booked", "Restore booking", CalendarCheck, () => setStatus("booked", "Booking restored"));
    }
  }
  if (d?.kind === "appointment") {
    if (d.patient) {
      const href = `${CLINIC_BASE_PATH}/patients/${d.patient.id}`;
      a("record", "Open record", User, () => router.push(href), { href });
    }
    // Comms (COMMS-011) and billing (M5): the dialogs for the patient; left out without the permission.
    if (d.patient && can.message) a("message", "Send message", MessageSquare, () => h.openPanel("message"), { panel: "message", testId: "drawer-send-message" });
    if (d.patient && can.pay) a("pay", "Take payment", CreditCard, () => h.openPanel("pay"), { panel: "pay", testId: "drawer-take-payment" });
    if (can.book && d.patient && (d.status === "dna" || d.status === "cancelled" || d.status === "late_cancelled" || d.status === "booked" || d.status === "arrived")) {
      a("rebook", "Rebook", Repeat, () => h.onRebook(d));
    }
  }
  if (d && can.book && d.kind === "block") {
    if (d.status === "booked") a("cancelled", "Remove blocked time", Ban, () => setStatus("cancelled", "Blocked time removed"), { danger: true });
    else a("booked", "Restore blocked time", CalendarCheck, () => setStatus("booked", "Blocked time restored"));
  }

  return { actions, busy, run, name };
}
