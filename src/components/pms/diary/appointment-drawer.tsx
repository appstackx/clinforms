"use client";
/**
 * The appointment's side drawer (design round 2, "Diary – day view"): name with status and type, the patient's
 * alert, When / Service / With / Payer / Mobile, quick actions by status, cancelling (late cancellation with the
 * fee), the rest of a recurring booking, and "Booked by …" at the bottom. Blocked time gets its own short drawer.
 * Statuses (Khuram's decision B): Arrived → Start treatment ("In treatment"; a clinician's note opens) → Completed;
 * each step can be undone. A logged double-booking shows a note naming the other appointment.
 * The data comes from the appointments route when it opens; changes go through the diary's server actions and the
 * screen shows the undo toast.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, CalendarCheck, CalendarX2, CreditCard, Move, Repeat, User, UserCheck, UserX, X, XCircle, CheckCircle2, Ban } from "lucide-react";
import { cancelAppointmentAction, cancelSeriesAction, setAppointmentStatusAction, startTreatmentAction } from "@/app/app/clinic/diary/actions";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { BLOCK_KIND_LABELS, CANCEL_REASON_LABELS, DOUBLE_BOOKED_LABEL } from "@/modules/pms/diary/copy";
import { CANCEL_REASONS, type AppointmentStatus, type BlockKind, type CancelReason } from "@/modules/pms/diary/rules";
import { londonDate } from "@/modules/pms/diary/time";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import type { AppointmentDetailsView } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { PmsButton } from "../ui/button";
import { Checkbox, SelectInput } from "../ui/inputs";
import { FlagPill, StatusPill } from "../ui/status-pill";
import { Kbd } from "../ui/keyboard-hint";
import { diaryApi } from "./api";
import { weekdayDate } from "./grid-model";

export interface DrawerPermissions {
  book: boolean;
  /** clinical.write: "Start treatment" also opens the clinical note for the appointment. */
  clinical: boolean;
}

export interface AppointmentDrawerProps {
  id: string | null;
  /** Bumped by the screen after a change so the open drawer reloads. */
  version: number;
  can: DrawerPermissions;
  onClose: () => void;
  /** A status change or cancellation worked: the screen refreshes and offers Undo. */
  onChanged: (message: string, undo: { id: string; rev: number; status: AppointmentStatus } | null) => void;
  onError: (message: string) => void;
  onMove: (id: string) => void;
  onRebook: (details: AppointmentDetailsView) => void;
}

const fullName = (d: AppointmentDetailsView) => d.patient?.name ?? (d.kind === "block" ? (d.title || (d.blockKind ? BLOCK_KIND_LABELS[d.blockKind as BlockKind] : "Blocked time")) : "Appointment");

export function AppointmentDrawer({ id, version, can, onClose, onChanged, onError, onMove, onRebook }: AppointmentDrawerProps) {
  const router = useRouter();
  const [details, setDetails] = React.useState<AppointmentDetailsView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState<CancelReason>("patient");
  const [charge, setCharge] = React.useState(true);
  const [seriesOpen, setSeriesOpen] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    setCancelOpen(false);
    setSeriesOpen(false);
    if (!id) {
      setDetails(null);
      return;
    }
    let live = true;
    setLoadError(null);
    void diaryApi.appointment<AppointmentDetailsView>(id).then((r) => {
      if (!live) return;
      if (r.ok) setDetails(r.data);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [id, version]);

  // Focus moves into the drawer when it opens; Esc closes it (the screen returns focus to the block).
  React.useEffect(() => {
    if (id) window.setTimeout(() => closeRef.current?.focus(), 0);
  }, [id]);

  // Esc closes the drawer wherever focus is (unless a dialog above it handles Esc itself).
  React.useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog],[role=alertdialog]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  if (!id) return null;
  const d = details && details.id === id ? details : null;

  const run = async (label: string, work: () => Promise<DiaryActionResult>, okMessage: (r: Extract<DiaryActionResult, { ok: true }>) => string, undo?: (r: Extract<DiaryActionResult, { ok: true }>) => { id: string; rev: number; status: AppointmentStatus } | null) => {
    setBusy(label);
    const r = await work();
    setBusy(null);
    if (!r.ok) {
      onError([r.error, ...(r.clashes ?? [])].join(" "));
      if (r.conflict) router.refresh();
      return;
    }
    setCancelOpen(false);
    onChanged(okMessage(r), undo ? undo(r) : null);
  };

  const setStatus = (to: AppointmentStatus, message: string) =>
    d &&
    run(
      to,
      () => setAppointmentStatusAction({ id: d.id, expectedRev: d.rev, status: to }),
      () => message,
      (r) => ({ id: d.id, rev: r.rev ?? d.rev + 1, status: d.status }),
    );

  const name = d ? fullName(d) : "";
  const fee = d?.pricePence ?? null;
  const isLate = d ? d.lateIfCancelledNow && reason !== "clinic" && reason !== "practitioner_unavailable" : false;

  const confirmCancel = () =>
    d &&
    run(
      "cancel",
      () => cancelAppointmentAction({ id: d.id, expectedRev: d.rev, reason, late: isLate, feeDue: isLate && charge && fee !== null, feePence: isLate && charge && fee !== null ? fee : null }),
      () => (isLate ? `${name} – late cancellation recorded${charge && fee !== null ? `, fee ${formatPence(fee)} noted for billing` : ""}` : `${name} cancelled`),
      // Undo reinstates the booking (a cancelled appointment goes back to "booked").
      (r) => ({ id: d.id, rev: r.rev ?? d.rev + 1, status: "booked" }),
    );

  /** Start treatment (or, once in treatment, open the note again): the status, and the clinician's note. */
  const startTreatment = async () => {
    if (!d) return;
    setBusy("treat");
    const r = await startTreatmentAction({ id: d.id });
    setBusy(null);
    if (!r.ok) {
      onError(r.error);
      if (r.conflict) router.refresh();
      return;
    }
    if (d.status === "arrived") onChanged(`${name} – treatment started`, { id: d.id, rev: r.rev ?? d.rev + 1, status: "arrived" });
    if (d.patient && r.noteId) router.push(`${CLINIC_BASE_PATH}/patients/${d.patient.id}/notes/${r.noteId}`);
  };

  const action = (key: string, label: string, Icon: React.ComponentType<{ className?: string }>, onClick: () => void, opts: { primary?: boolean; danger?: boolean; kbd?: string } = {}) => (
    <PmsButton
      key={key}
      variant={opts.primary ? "primary" : "secondary"}
      className={cn("h-10 w-full justify-center", opts.danger && "text-destructive-strong")}
      onClick={onClick}
      loading={busy === key}
      disabled={busy !== null && busy !== key}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
      {opts.kbd ? <Kbd className={cn("ml-1", opts.primary && "border-white/50 bg-transparent text-white")}>{opts.kbd}</Kbd> : null}
    </PmsButton>
  );

  const openRecord = d?.patient ? (
    <PmsButton key="record" asChild variant="secondary" className="h-10 w-full justify-center">
      <Link href={`${CLINIC_BASE_PATH}/patients/${d.patient.id}`}>
        <User className="h-4 w-4" aria-hidden />
        Open record
      </Link>
    </PmsButton>
  ) : null;
  // Billing is not on this branch yet: the button is there, switched off, with the reason.
  const takePayment = d?.kind === "appointment" ? (
    <span key="pay" className="block" title="Billing coming" tabIndex={0} aria-describedby="drawer-pay-note">
      <PmsButton variant="secondary" className="pointer-events-none h-10 w-full justify-center" disabled aria-disabled>
        <CreditCard className="h-4 w-4" aria-hidden />
        Take payment
      </PmsButton>
      <span id="drawer-pay-note" className="sr-only">
        Billing coming – payments can be taken once billing is switched on.
      </span>
    </span>
  ) : null;

  const actions: React.ReactNode[] = [];
  if (d && can.book && d.kind === "appointment") {
    const s = d.status;
    const complete = (primary: boolean) => action("attended", "Completed", CheckCircle2, () => setStatus("attended", `${name} marked as completed`), { primary });
    if (s === "booked") {
      actions.push(action("arrived", "Arrived", UserCheck, () => setStatus("arrived", `${name} marked as arrived`), { primary: true, kbd: "A" }));
      actions.push(action("dna", "Did not attend", UserX, () => setStatus("dna", `${name} marked as DNA`), { kbd: "D" }));
      actions.push(action("cancel", "Cancel…", XCircle, () => setCancelOpen(true), { danger: true }));
      if (d.canMove) actions.push(action("move", "Move", Move, () => onMove(d.id), { kbd: "M" }));
      actions.push(complete(false));
    } else if (s === "arrived") {
      actions.push(action("treat", "Start treatment", Activity, () => void startTreatment(), { primary: true }));
      actions.push(complete(false));
      actions.push(action("cancel", "Cancel…", XCircle, () => setCancelOpen(true), { danger: true }));
      actions.push(action("booked", "Undo arrival", CalendarCheck, () => setStatus("booked", "Arrival removed")));
    } else if (s === "in_treatment") {
      if (can.clinical) actions.push(action("treat", "Open note", Activity, () => void startTreatment(), { primary: true }));
      actions.push(complete(!can.clinical));
      actions.push(action("arrived", "Undo start of treatment", CalendarCheck, () => setStatus("arrived", "Back to arrived")));
    } else if (s === "attended") {
      const back: AppointmentStatus = d.treatmentStarted ? "in_treatment" : "arrived";
      actions.push(action(back, "Undo completed", CalendarCheck, () => setStatus(back, "Completion removed")));
    } else if (s === "dna") {
      actions.push(action("booked", "Undo DNA", CalendarCheck, () => setStatus("booked", "DNA removed")));
      actions.push(complete(false));
    } else {
      actions.push(action("booked", "Restore booking", CalendarCheck, () => setStatus("booked", "Booking restored")));
    }
  }
  if (d?.kind === "appointment") {
    if (openRecord) actions.push(openRecord);
    if (takePayment) actions.push(takePayment);
    if (can.book && d.patient && (d.status === "dna" || d.status === "cancelled" || d.status === "late_cancelled" || d.status === "booked" || d.status === "arrived")) {
      actions.push(action("rebook", "Rebook", Repeat, () => onRebook(d)));
    }
  }
  if (d && can.book && d.kind === "block") {
    if (d.status === "booked") actions.push(action("cancelled", "Remove blocked time", Ban, () => setStatus("cancelled", "Blocked time removed"), { danger: true }));
    else actions.push(action("booked", "Restore blocked time", CalendarCheck, () => setStatus("booked", "Blocked time restored")));
  }

  const statusLabel = d && d.kind === "appointment" ? undefined : "Blocked";
  return (
    <aside
      ref={panelRef}
      aria-label="Appointment details"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-border bg-white text-sm shadow-[-12px_0_32px_rgba(15,23,42,0.14)]"
    >
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {d?.patient ? (
            <Link href={`${CLINIC_BASE_PATH}/patients/${d.patient.id}`} className="truncate text-lg font-semibold text-foreground hover:underline">
              <h2 className="inline">{name}</h2>
            </Link>
          ) : (
            <h2 className="truncate text-lg font-semibold text-foreground">{d ? name : "Loading…"}</h2>
          )}
          {d ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {d.kind === "appointment" ? <StatusPill kind="appointment" status={d.status} size="sm" /> : <FlagPill>{statusLabel}</FlagPill>}
              {d.kind === "appointment" ? <FlagPill>{d.initial ? "Initial" : "Follow-up"}</FlagPill> : null}
              {d.source === "online" ? <FlagPill>Booked online</FlagPill> : null}
            </div>
          ) : null}
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#334155] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-[#334155]">
        {loadError ? <p role="alert" className="text-destructive-strong">{loadError}</p> : null}
        {d && d.doubleBookedWith.length > 0 ? (
          <div role="note" data-testid="double-booked-note" className="flex items-start gap-2 rounded-[10px] border border-[#FDBA74] bg-[#FFF7ED] px-3.5 py-3 text-[#0F172A]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9A3412]" aria-hidden />
            <span>
              <strong>{DOUBLE_BOOKED_LABEL}:</strong> {d.practitionerName ?? "The practitioner"} also has{" "}
              {d.doubleBookedWith.map((x, i) => (
                <React.Fragment key={x.id}>
                  {i > 0 ? ", " : ""}
                  {x.patientName ?? "another appointment"} {x.timeLabel}
                </React.Fragment>
              ))}
              . The double-booking is logged.
            </span>
          </div>
        ) : null}
        {d?.alertText ? (
          <div role="note" className="flex items-start gap-2 rounded-[10px] border border-[#FBD38D] bg-[#FFFBEB] px-3.5 py-3 text-[#0F172A]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#864E0E]" aria-hidden />
            <span>
              <strong>Alert:</strong> {d.alertText}
            </span>
          </div>
        ) : null}
        {d ? (
          <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2">
            <dt className="text-[#475569]">When</dt>
            <dd className="text-foreground">
              {weekdayDate(londonDate(d.startsAt))}, {d.startTime}–{endTimeOf(d)} ({d.durationMinutes} min)
            </dd>
            {d.kind === "appointment" ? (
              <>
                <dt className="text-[#475569]">Service</dt>
                <dd className="text-foreground">
                  {d.serviceName ?? "–"}
                  {d.pricePence !== null ? ` · ${formatPence(d.pricePence)}` : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-[#475569]">With</dt>
            <dd className="text-foreground">{[d.practitionerName, d.roomName].filter(Boolean).join(" · ") || "–"}</dd>
            {d.kind === "appointment" ? (
              <>
                <dt className="text-[#475569]">Payer</dt>
                <dd className="text-foreground">{d.payerLabel ?? "No case linked"}</dd>
                {d.patient ? (
                  <>
                    <dt className="text-[#475569]">Mobile</dt>
                    <dd className="text-foreground">{d.patient.phone ?? "Not recorded"}</dd>
                  </>
                ) : null}
              </>
            ) : null}
            {d.cancelReason ? (
              <>
                <dt className="text-[#475569]">Cancelled</dt>
                <dd className="text-foreground">
                  {CANCEL_REASON_LABELS[d.cancelReason as CancelReason] ?? d.cancelReason}
                  {d.feeDue && d.feePence !== null ? ` · fee ${formatPence(d.feePence)}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}

        {d && cancelOpen ? (
          <div className="flex flex-col gap-3 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3.5">
            <strong className="text-foreground">Cancel this appointment</strong>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cx-reason" className="text-sm font-medium text-foreground">
                Reason
              </label>
              <SelectInput id="cx-reason" value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CANCEL_REASON_LABELS[r]}
                  </option>
                ))}
              </SelectInput>
            </div>
            {isLate ? (
              <>
                <div role="note" className="flex items-start gap-2 rounded-[8px] border border-[#FDBA74] bg-[#FFF7ED] px-3 py-2 text-[#0F172A]">
                  <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-[#9A3412]" aria-hidden />
                  <span>
                    Less than 24 hours&apos; notice. This is recorded as a <strong>Late cancellation</strong>.
                  </span>
                </div>
                {fee !== null ? <Checkbox checked={charge} onChange={(e) => setCharge(e.target.checked)} label={`Charge late cancellation fee (${formatPence(fee)})`} /> : null}
              </>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <PmsButton variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy === "cancel"}>
                Keep appointment
              </PmsButton>
              <PmsButton variant="destructive" onClick={() => void confirmCancel()} loading={busy === "cancel"}>
                Cancel appointment
              </PmsButton>
            </div>
          </div>
        ) : null}

        {d && actions.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]">Quick actions</span>
            <div className="grid grid-cols-2 gap-2">{actions}</div>
          </div>
        ) : null}

        {d && can.book && d.seriesId && d.seriesLater > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]">Recurring booking</span>
            {seriesOpen ? (
              <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
                <span>
                  Cancel the {d.seriesLater} booked {d.seriesLater === 1 ? "appointment" : "appointments"} of this series from {formatUkDate(d.startsOn)} on?
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  <PmsButton variant="secondary" onClick={() => setSeriesOpen(false)}>
                    Keep them
                  </PmsButton>
                  <PmsButton
                    variant="destructive"
                    loading={busy === "series"}
                    onClick={() => void run("series", () => cancelSeriesAction({ seriesId: d.seriesId as string, fromDate: d.startsOn, reason: "patient" }), (r) => r.message, () => null)}
                  >
                    Cancel the rest
                  </PmsButton>
                </div>
              </div>
            ) : (
              <PmsButton variant="secondary" className="justify-center" onClick={() => setSeriesOpen(true)}>
                <Repeat className="h-4 w-4" aria-hidden />
                Cancel the rest of the series ({d.seriesLater})
              </PmsButton>
            )}
          </div>
        ) : null}
      </div>
      {d && (d.bookedBy || d.confirmationRequested) ? (
        <div className="border-t border-border px-5 py-3 text-xs text-[#475569]">
          {[d.bookedBy ? `Booked by ${d.bookedBy}${d.bookedAt ? ` ${formatUkDate(londonDate(d.bookedAt))}` : ""}` : null, d.confirmationRequested ? "confirmation requested" : null].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </aside>
  );
}

function endTimeOf(d: AppointmentDetailsView): string {
  const [h, m] = d.startTime.split(":").map(Number);
  const end = (h * 60 + m + d.durationMinutes) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
