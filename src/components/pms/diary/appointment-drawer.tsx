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
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarX2, ChevronDown, History, Repeat, X } from "lucide-react";
import { cancelAppointmentAction, cancelSeriesAction } from "@/app/app/clinic/diary/actions";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { CANCEL_REASON_LABELS, DOUBLE_BOOKED_LABEL } from "@/modules/pms/diary/copy";
import { CANCEL_REASONS, type CancelReason } from "@/modules/pms/diary/rules";
import { londonDate } from "@/modules/pms/diary/time";
import type { AppointmentDetailsView } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { PmsButton } from "../ui/button";
import { Checkbox, SelectInput } from "../ui/inputs";
import { FlagPill, StatusPill } from "../ui/status-pill";
import { Kbd } from "../ui/keyboard-hint";
import { useModalLayer } from "../ui/modal-layer";
import { TakePaymentDialog } from "../billing/take-payment-dialog";
import { SendMessageDialog } from "../comms/send-message-dialog";
import { diaryApi } from "./api";
import { useAppointmentActions, type DrawerPanel, type DrawerPermissions, type StatusUndo } from "./appointment-actions";
import { weekdayDate } from "./grid-model";

export type { DrawerPermissions, DrawerPanel } from "./appointment-actions";

export interface AppointmentDrawerProps {
  id: string | null;
  /** Bumped by the screen after a change so the open drawer reloads. */
  version: number;
  can: DrawerPermissions;
  /** Open on one of its panels (the block's context menu: Cancel…, Take payment, Send message). */
  initialPanel?: DrawerPanel | null;
  onClose: () => void;
  /** A status change or cancellation worked: the screen refreshes and offers Undo. */
  onChanged: (message: string, undo: StatusUndo | null) => void;
  onError: (message: string) => void;
  onMove: (id: string) => void;
  onRebook: (details: AppointmentDetailsView) => void;
}

interface HistoryRow {
  id: string;
  when: string;
  who: string;
  what: string;
  detail: string | null;
}

export function AppointmentDrawer({ id, version, can, initialPanel = null, onClose, onChanged, onError, onMove, onRebook }: AppointmentDrawerProps) {
  const router = useRouter();
  const [details, setDetails] = React.useState<AppointmentDetailsView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState<CancelReason>("patient");
  const [charge, setCharge] = React.useState(true);
  const [seriesOpen, setSeriesOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [messageOpen, setMessageOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState<{ id: string; rows: HistoryRow[] | null; error: string | null } | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const titleId = React.useId();

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    setCancelOpen(false);
    setSeriesOpen(false);
    setPayOpen(false);
    setMessageOpen(false);
    if (!id) {
      setDetails(null);
      setHistoryOpen(false);
      setHistory(null);
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

  // The context menu's Cancel… / Take payment / Send message open the drawer on that panel once it has loaded.
  const panelUsed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!id || !initialPanel || !details || details.id !== id) return;
    const key = `${id}:${initialPanel}`;
    if (panelUsed.current === key) return;
    panelUsed.current = key;
    if (initialPanel === "cancel") setCancelOpen(true);
    else if (initialPanel === "pay") setPayOpen(true);
    else setMessageOpen(true);
  }, [id, initialPanel, details]);
  React.useEffect(() => {
    if (!id) panelUsed.current = null;
  }, [id]);

  // The history of changes loads when it is first opened, and again after a change while it is open.
  React.useEffect(() => {
    if (!id || !historyOpen) return;
    let live = true;
    void diaryApi.appointmentHistory<HistoryRow[]>(id).then((r) => {
      if (!live) return;
      setHistory(r.ok ? { id, rows: r.data, error: null } : { id, rows: null, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [id, historyOpen, version]);

  // Modal (WCAG 2.4.11 / 2.4.3): the page behind is inert while the drawer is open, Tab stays inside, focus moves
  // into it when it opens; Esc closes it and the screen returns focus to the block that opened it.
  useModalLayer(panelRef, Boolean(id) && mounted);
  React.useEffect(() => {
    if (id) window.setTimeout(() => closeRef.current?.focus(), 0);
  }, [id]);

  // Esc closes the drawer wherever focus is (unless a dialog above it handles Esc itself).
  React.useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog]:not([data-appointment-drawer]),[role=alertdialog]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  const d = id && details && details.id === id ? details : null;
  const { actions: specs, busy, run, name } = useAppointmentActions(d, can, {
    onChanged,
    onError,
    onMove,
    onRebook,
    onDone: () => setCancelOpen(false),
    openPanel: (panel) => (panel === "cancel" ? setCancelOpen(true) : panel === "pay" ? setPayOpen(true) : setMessageOpen(true)),
  });

  if (!id || !mounted) return null;

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

  // Touch targets: 44 px on a phone (design rule), the design's 40 px from 768 px.
  const BUTTON = "h-11 w-full justify-center md:h-10";
  const actions: React.ReactNode[] = specs.map((x) => {
    const Icon = x.icon;
    if (x.href) {
      return (
        <PmsButton key={x.key} asChild variant="secondary" className={BUTTON}>
          <Link href={x.href}>
            <Icon className="h-4 w-4" aria-hidden />
            {x.label}
          </Link>
        </PmsButton>
      );
    }
    return (
      <PmsButton
        key={x.key}
        variant={x.primary ? "primary" : "secondary"}
        className={cn(BUTTON, x.danger && "text-destructive-strong")}
        onClick={x.run}
        loading={busy === x.key}
        disabled={busy !== null && busy !== x.key}
        data-testid={x.testId}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {x.label}
        {x.kbd ? <Kbd className={cn("ml-1", x.primary && "border-white/50 bg-transparent text-white")}>{x.kbd}</Kbd> : null}
      </PmsButton>
    );
  });
  if (d && can.book && d.kind === "appointment" && d.status === "booked" && !d.nextStatuses.includes("arrived")) {
    // After Move (or Cancel… when Move is not offered), as before: where Arrived / Completed would be.
    const at = specs.findIndex((x) => x.key === "record");
    const note = (
      <p key="future-note" data-testid="future-status-note" className="text-[13px] leading-5 text-[#475569]">
        Arrived and Completed open 60 minutes before the start time.
      </p>
    );
    actions.splice(at < 0 ? actions.length : at, 0, note);
  }

  const statusLabel = d && d.kind === "appointment" ? undefined : "Blocked";
  return createPortal(
    <>
    {/* The page behind is inert; a click on it closes the drawer (like the kit's side drawer). */}
    <div aria-hidden data-modal-keep data-testid="drawer-overlay" className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.18)]" onClick={onClose} />
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Appointment details"
      aria-describedby={titleId}
      data-appointment-drawer
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-border bg-white text-sm shadow-[-12px_0_32px_rgba(15,23,42,0.14)] focus:outline-none"
    >
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {d?.patient ? (
            <Link href={`${CLINIC_BASE_PATH}/patients/${d.patient.id}`} className="truncate text-lg font-semibold text-foreground hover:underline">
              <h2 id={titleId} className="inline">{name}</h2>
            </Link>
          ) : (
            <h2 id={titleId} className="truncate text-lg font-semibold text-foreground">{d ? name : "Loading…"}</h2>
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
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-[#334155] md:h-8 md:w-8 hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
        {d ? (
          <div className="flex flex-col gap-2" data-testid="drawer-history">
            <button
              type="button"
              aria-expanded={historyOpen}
              aria-controls={`${titleId}-history`}
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex min-h-[44px] items-center gap-2 rounded-[8px] text-left text-xs font-semibold uppercase tracking-[0.04em] text-[#475569] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:min-h-[32px]"
            >
              <History className="h-4 w-4" aria-hidden />
              History of changes
              <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform motion-reduce:transition-none", historyOpen && "rotate-180")} aria-hidden />
            </button>
            {historyOpen ? (
              <div id={`${titleId}-history`}>
                {!history || history.id !== d.id ? (
                  <p className="text-[#475569]">Loading…</p>
                ) : history.error ? (
                  <p role="alert" className="text-destructive-strong">{history.error}</p>
                ) : history.rows && history.rows.length > 0 ? (
                  <ol className="flex flex-col gap-2 border-l-2 border-[#E2E8F0] pl-3">
                    {history.rows.map((r) => (
                      <li key={r.id} className="flex flex-col">
                        <span className="font-medium text-foreground">{r.what}</span>
                        <span className="text-xs text-[#475569]">
                          <span className="tabular-nums">{r.when}</span> · {r.who}
                          {r.detail ? ` · ${r.detail}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[#475569]">Nothing recorded yet.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {d && (d.bookedBy || d.confirmationRequested) ? (
        <div className="border-t border-border px-5 py-3 text-xs text-[#475569]">
          {[d.bookedBy ? `Booked by ${d.bookedBy}${d.bookedAt ? ` ${formatUkDate(londonDate(d.bookedAt))}` : ""}` : null, d.confirmationRequested ? "confirmation requested" : null].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {d?.patient && can.message ? (
        <SendMessageDialog
          open={messageOpen}
          onOpenChange={setMessageOpen}
          patientId={d.patient.id}
          context={`About the appointment on ${weekdayDate(londonDate(d.startsAt))} at ${d.startTime}${d.serviceName ? `, ${d.serviceName}` : ""}.`}
        />
      ) : null}
      {d?.patient && can.pay ? (
        <TakePaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          patientId={d.patient.id}
          context={`diary drawer · ${d.patient.name}, ${weekdayDate(londonDate(d.startsAt))} ${d.startTime}`}
          onDone={() => router.refresh()}
        />
      ) : null}
    </aside>
    </>,
    document.body,
  );
}

function endTimeOf(d: AppointmentDetailsView): string {
  const [h, m] = d.startTime.split(":").map(Number);
  const end = (h * 60 + m + d.durationMinutes) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}
