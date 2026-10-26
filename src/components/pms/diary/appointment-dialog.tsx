"use client";
/**
 * One appointment (or blocked time): who, when, where, the booking note, the case and authorisation; and what
 * reception does with it – arrived, attended, did not attend, cancel or late cancellation (with the fee flag),
 * reinstate or undo, move (the keyboard alternative to drag and drop), change the note / case / authorisation,
 * cancel the rest of a recurring booking. Every change carries the revision shown; a stale one is refused and the
 * dialog reloads.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { BLOCK_KIND_LABELS, CANCEL_REASON_LABELS, DIARY_COPY, STATUS_ACTIONS, STATUS_LABELS } from "@/modules/pms/diary/copy";
import { CANCEL_REASONS, type AppointmentStatus, type CancelReason } from "@/modules/pms/diary/rules";
import { formatDayHeading, formatHhmm } from "@/modules/pms/diary/time";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import type { AppointmentDetailsView, DiaryViewData } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { ActionButton, ActionError, CheckboxField, SelectField, TextAreaField, TextField } from "./fields";
import { STATUS_TAG } from "./status-style";
import type { DiaryActions } from "./types";

type Options = Pick<DiaryViewData, "sites" | "practitioners" | "rooms" | "services">;

function statusButtonLabel(kind: AppointmentDetailsView["kind"], from: AppointmentStatus, to: AppointmentStatus): string {
  if (kind === "block") return to === "cancelled" ? "Remove blocked time" : "Restore blocked time";
  if (to === "booked") return from === "cancelled" || from === "late_cancelled" ? "Reinstate" : "Undo: back to booked";
  if (to === "arrived" && from === "attended") return "Undo: back to arrived";
  if (to === "cancelled" && from === "late_cancelled") return "Waive the fee (ordinary cancellation)";
  if (to === "late_cancelled" && from === "cancelled") return "Make it a late cancellation";
  return STATUS_ACTIONS[to];
}

export function AppointmentDialog({
  appointmentId,
  options,
  actions,
  canBook,
  onClose,
  onChanged,
}: {
  appointmentId: string | null;
  options: Options;
  actions: DiaryActions;
  canBook: boolean;
  onClose: () => void;
  onChanged: (message: string, warnings: string[]) => void;
}) {
  return (
    <Dialog open={appointmentId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto bg-white text-slate-900">
        {appointmentId ? <Details key={appointmentId} id={appointmentId} options={options} actions={actions} canBook={canBook} onChanged={onChanged} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Details({ id, options, actions, canBook, onChanged, onClose }: { id: string; options: Options; actions: DiaryActions; canBook: boolean; onChanged: (message: string, warnings: string[]) => void; onClose: () => void }) {
  const [view, setView] = useState<AppointmentDetailsView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [panel, setPanel] = useState<"none" | "cancel" | "move" | "edit">("none");
  const [result, setResult] = useState<Extract<DiaryActionResult, { ok: false }> | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/app/clinic/diary/api/appointments/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setLoadState("missing");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView(((await res.json()) as { appointment: AppointmentDetailsView }).appointment);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = (work: () => Promise<DiaryActionResult>) => {
    setResult(null);
    startTransition(async () => {
      const r = await work();
      if (r.ok) {
        onChanged(r.message, r.warnings);
        setPanel("none");
        await load();
      } else {
        setResult(r);
        if (r.conflict) await load();
      }
    });
  };

  if (loadState === "loading") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Appointment</DialogTitle>
          <DialogDescription className="text-slate-600">Loading…</DialogDescription>
        </DialogHeader>
      </>
    );
  }
  if (loadState !== "ready" || !view) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Appointment</DialogTitle>
          <DialogDescription className="text-slate-700">{loadState === "missing" ? DIARY_COPY.notFound : "The appointment could not be loaded. Close this and try again."}</DialogDescription>
        </DialogHeader>
        <ActionButton variant="secondary" onClick={onClose}>
          Close
        </ActionButton>
      </>
    );
  }

  const v = view;
  const end = formatHhmm((Number(v.startTime.slice(0, 2)) * 60 + Number(v.startTime.slice(3, 5)) + v.durationMinutes) % 1440);
  const title = v.kind === "block" ? (v.title ?? (v.blockKind ? BLOCK_KIND_LABELS[v.blockKind] : "Blocked time")) : (v.patient?.name ?? "Appointment");
  const rows: [string, React.ReactNode][] = [
    ["When", `${formatDayHeading(v.startsOn)}, ${v.startTime}–${end} (${v.durationMinutes} min)`],
    ...(v.kind === "appointment" ? ([["Appointment type", v.serviceName ?? "–"]] as [string, React.ReactNode][]) : []),
    ["Practitioner", v.practitionerName ?? "–"],
    ["Room", v.roomName ?? "No room"],
    ["Site", v.siteName ?? "–"],
  ];
  if (v.patient) {
    rows.push([
      "Patient",
      <span key="p">
        No. {v.patient.number}
        {v.patient.dateOfBirth ? ` · born ${v.patient.dateOfBirth}` : ""}
        {v.patient.phone ? ` · ${v.patient.phone}` : ""}
        {v.patient.hasAlerts ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Medical alert on the record</span> : null}
      </span>,
    ]);
  }
  if (v.caseTitle) rows.push(["Case", v.caseTitle]);
  if (v.authorisation) {
    const a = v.authorisation;
    rows.push([
      "Authorisation",
      `${a.code}${a.sessionsAuthorised === null ? "" : ` – ${a.sessionsUsed} of ${a.sessionsAuthorised} sessions used`}${a.expiresOn ? `, until ${formatUkDate(a.expiresOn)}` : ""}${v.authSessionUsed ? " (this one counted)" : ""}`,
    ]);
  }
  if (v.cancelReason) rows.push(["Reason", CANCEL_REASON_LABELS[v.cancelReason as CancelReason] ?? v.cancelReason]);
  if (v.cancelNote) rows.push(["Cancellation note", v.cancelNote]);
  if (v.feeDue) rows.push(["Fee", `To be charged${v.feePence !== null ? `: ${formatPence(v.feePence)}` : ""}`]);
  if (v.source !== "staff") rows.push(["Booked", v.source === "online" ? "Online by the patient" : "Imported"]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
          <span>{title}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_TAG[v.status])}>{v.kind === "block" ? (v.status === "cancelled" ? "Removed" : "Blocked") : STATUS_LABELS[v.status]}</span>
        </DialogTitle>
        <DialogDescription className="text-slate-600">
          {v.kind === "block" ? "Nothing can be booked over blocked time." : v.seriesId ? "Part of a recurring booking." : "Single appointment."}
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-slate-600">{k}</dt>
            <dd className="min-w-0 break-words text-slate-900">{val}</dd>
          </div>
        ))}
        {v.notes ? (
          <div className="contents">
            <dt className="text-slate-600">Booking note</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-900">{v.notes}</dd>
          </div>
        ) : null}
      </dl>

      {v.patient ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={`/app/clinic/patients/${v.patient.id}`} className="font-medium text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
            Open the patient&apos;s record
          </Link>
          <Link href={`/app/clinic/patients/${v.patient.id}/appointments`} className="font-medium text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
            All their appointments
          </Link>
        </p>
      ) : null}

      <ActionError error={result?.error ?? null} details={result?.clashes} />

      {canBook ? (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Change the status">
            {v.nextStatuses.map((to) =>
              to === "cancelled" || to === "late_cancelled" ? (
                v.kind === "block" || v.status === "cancelled" || v.status === "late_cancelled" ? (
                  <ActionButton key={to} variant={to === "cancelled" && v.kind === "block" ? "danger" : "secondary"} disabled={pending} onClick={() => run(() => actions.status({ id: v.id, expectedRev: v.rev, status: to }))}>
                    {statusButtonLabel(v.kind, v.status, to)}
                  </ActionButton>
                ) : to === "cancelled" ? (
                  <ActionButton key={to} variant="danger" disabled={pending} aria-expanded={panel === "cancel"} onClick={() => setPanel(panel === "cancel" ? "none" : "cancel")}>
                    Cancel…
                  </ActionButton>
                ) : null
              ) : (
                <ActionButton key={to} variant={to === "attended" ? "primary" : "secondary"} disabled={pending} onClick={() => run(() => actions.status({ id: v.id, expectedRev: v.rev, status: to }))}>
                  {statusButtonLabel(v.kind, v.status, to)}
                </ActionButton>
              ),
            )}
            {v.canMove ? (
              <ActionButton variant="secondary" disabled={pending} aria-expanded={panel === "move"} onClick={() => setPanel(panel === "move" ? "none" : "move")}>
                Move…
              </ActionButton>
            ) : null}
            <ActionButton variant="secondary" disabled={pending} aria-expanded={panel === "edit"} onClick={() => setPanel(panel === "edit" ? "none" : "edit")}>
              {v.kind === "block" ? "Edit note…" : "Edit details…"}
            </ActionButton>
          </div>
          {panel === "cancel" ? <CancelForm view={v} pending={pending} onSubmit={(input) => run(() => actions.status({ id: v.id, expectedRev: v.rev, ...input }))} /> : null}
          {panel === "move" ? <MoveForm view={v} options={options} pending={pending} fieldErrors={result?.fieldErrors} onSubmit={(input) => run(() => actions.move({ id: v.id, expectedRev: v.rev, ...input }))} /> : null}
          {panel === "edit" ? <EditForm view={v} options={options} pending={pending} onSubmit={(input) => run(() => actions.details({ id: v.id, expectedRev: v.rev, ...input }))} /> : null}
          {v.seriesId && v.seriesLater > 0 && v.status === "booked" ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="text-slate-700">
                {v.seriesLater} booked {v.seriesLater === 1 ? "appointment" : "appointments"} of this course from this one on.
              </p>
              <ActionButton
                variant="danger"
                className="mt-2"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Cancel ${v.seriesLater} ${v.seriesLater === 1 ? "appointment" : "appointments"} of this course (this one and later)?`)) {
                    run(() => actions.cancelSeries({ seriesId: v.seriesId as string, fromDate: v.startsOn }));
                  }
                }}
              >
                Cancel this and the later ones
              </ActionButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CancelForm({ view, pending, onSubmit }: { view: AppointmentDetailsView; pending: boolean; onSubmit: (input: { status: "cancelled" | "late_cancelled"; cancelReason: CancelReason; cancelNote: string; feeDue: boolean; feePence: number | null }) => void }) {
  const [late, setLate] = useState(view.lateIfCancelledNow);
  const [reason, setReason] = useState<CancelReason>("patient");
  const [fee, setFee] = useState(view.lateIfCancelledNow);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const pence = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
        onSubmit({ status: late ? "late_cancelled" : "cancelled", cancelReason: reason, cancelNote: note, feeDue: late && fee, feePence: late && fee && pence !== null && Number.isFinite(pence) ? pence : null });
      }}
    >
      <p className="text-sm font-semibold text-slate-900">Cancel the appointment</p>
      {view.lateIfCancelledNow ? <p className="text-sm text-slate-700">It starts within 24 hours, so this counts as a late cancellation unless you untick it.</p> : null}
      <CheckboxField id="cancel-late" label="Late cancellation" checked={late} onChange={(e) => setLate(e.target.checked)} hint="Frees the slot and keeps a record for the clinic's cancellation policy." />
      {late ? <CheckboxField id="cancel-fee" label="Charge the cancellation fee" checked={fee} onChange={(e) => setFee(e.target.checked)} hint="Shows in billing as a fee to invoice." /> : null}
      {late && fee ? <TextField id="cancel-amount" label="Fee in pounds (leave empty for the clinic's usual fee)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /> : null}
      <SelectField id="cancel-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
        {CANCEL_REASONS.map((r) => (
          <option key={r} value={r}>
            {CANCEL_REASON_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <TextAreaField id="cancel-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <button type="submit" disabled={pending} className="inline-flex min-h-[40px] items-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-60">
        {pending ? "Cancelling…" : late ? "Record the late cancellation" : "Cancel the appointment"}
      </button>
    </form>
  );
}

function MoveForm({
  view,
  options,
  pending,
  fieldErrors,
  onSubmit,
}: {
  view: AppointmentDetailsView;
  options: Options;
  pending: boolean;
  fieldErrors?: Record<string, string>;
  onSubmit: (input: { date: string; startTime: string; durationMinutes: number; practitionerId?: string | null; roomId: string | null; siteId: string }) => void;
}) {
  const [date, setDate] = useState(view.startsOn);
  const [time, setTime] = useState(view.startTime);
  const [duration, setDuration] = useState(String(view.durationMinutes));
  const [practitionerId, setPractitionerId] = useState(view.practitionerId ?? "");
  const [siteId, setSiteId] = useState(view.siteId);
  const [roomId, setRoomId] = useState(view.roomId ?? "");
  const rooms = options.rooms.filter((r) => r.siteId === siteId);
  const fe = fieldErrors ?? {};
  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ date, startTime: time, durationMinutes: Number(duration), practitionerId: view.kind === "block" && !practitionerId ? null : practitionerId || undefined, roomId: roomId || null, siteId });
      }}
    >
      <p className="text-sm font-semibold text-slate-900">Move to</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="move-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={fe.date} />
        <TextField id="move-time" label="Start time (24-hour)" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} error={fe.startTime} />
        <TextField id="move-duration" label="Length in minutes" type="number" inputMode="numeric" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} error={fe.durationMinutes} />
        <SelectField id="move-practitioner" label="Practitioner" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
          {view.kind === "block" ? <option value="">No practitioner</option> : null}
          {options.practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="move-site"
          label="Site"
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            setRoomId("");
          }}
        >
          {options.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="move-room" label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">No room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
      </div>
      <button type="submit" disabled={pending} className="inline-flex min-h-[40px] items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-60">
        {pending ? "Moving…" : "Move"}
      </button>
    </form>
  );
}

function EditForm({ view, options, pending, onSubmit }: { view: AppointmentDetailsView; options: Options; pending: boolean; onSubmit: (input: { notes: string; caseId?: string | null; authorisationId?: string | null; serviceId?: string }) => void }) {
  const [notes, setNotes] = useState(view.notes ?? "");
  const [caseId, setCaseId] = useState(view.caseId ?? "");
  const [authorisationId, setAuthorisationId] = useState(view.authorisation?.id ?? "");
  const [serviceId, setServiceId] = useState(view.serviceId ?? "");
  const auths = view.authorisations.filter((a) => a.caseId === caseId);
  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          view.kind === "block"
            ? { notes }
            : { notes, caseId: caseId || null, authorisationId: auths.some((a) => a.id === authorisationId) ? authorisationId : null, serviceId: serviceId || undefined },
        );
      }}
    >
      {view.kind === "appointment" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField id="edit-service" label="Appointment type" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {options.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <SelectField id="edit-case" label="Case" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">No case</option>
            {view.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
          <SelectField id="edit-auth" label="Treatment authorisation" value={authorisationId} onChange={(e) => setAuthorisationId(e.target.value)} disabled={view.authSessionUsed} hint={view.authSessionUsed ? "Counted already – mark the appointment as booked to change it." : undefined}>
            <option value="">None</option>
            {auths.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code}
                {a.sessionsLeft === null ? "" : ` – ${a.sessionsLeft} left`}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      <TextAreaField id="edit-notes" label="Booking note" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} hint={DIARY_COPY.bookingNoteHint} />
      <button type="submit" disabled={pending} className="inline-flex min-h-[40px] items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
