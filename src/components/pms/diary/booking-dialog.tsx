"use client";
/**
 * "Book an appointment": patient, appointment type, practitioner, site and room, date and time (UK), length, the
 * case and its treatment authorisation, a weekly or fortnightly repeat, a booking note. Can look up the next free
 * times inside the rota. Clashes come back in plain words; a recurring booking can then book only its free dates,
 * and a patient seen by two practitioners together can be booked anyway.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatUkDate } from "@/modules/pms/core/text";
import { DIARY_COPY } from "@/modules/pms/diary/copy";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import type { DiaryViewData } from "@/modules/pms/diary/view";
import { ActionButton, ActionError, CheckboxField, SelectField, TextAreaField, TextField } from "./fields";
import { PatientSearch, type PatientHit } from "./patient-search";
import type { DiaryActions } from "./types";

export interface BookingRequest {
  patient?: { id: string; name: string } | null;
  waitingListId?: string | null;
  serviceId?: string | null;
  practitionerId?: string | null;
  siteId?: string | null;
  roomId?: string | null;
  caseId?: string | null;
  date: string;
  startTime?: string | null;
}

interface CaseOption {
  id: string;
  title: string;
  practitionerId: string | null;
  siteId: string | null;
}
interface AuthOption {
  id: string;
  caseId: string;
  code: string;
  sessionsLeft: number | null;
  expiresOn: string | null;
}
interface SlotOption {
  date: string;
  time: string;
  practitionerId: string;
  practitionerName: string | null;
  siteId: string;
  roomId: string | null;
}

type Options = Pick<DiaryViewData, "sites" | "practitioners" | "rooms" | "services">;

export function BookingDialog({
  request,
  options,
  book,
  onClose,
  onDone,
}: {
  request: BookingRequest | null;
  options: Options;
  book: DiaryActions["book"];
  onClose: () => void;
  onDone: (message: string, warnings: string[], itemId: string | undefined, date: string) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle>Book an appointment</DialogTitle>
          <DialogDescription className="text-slate-600">Times are UK time. Fields marked * are needed.</DialogDescription>
        </DialogHeader>
        {request ? <BookingForm key={JSON.stringify(request)} request={request} options={options} book={book} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BookingForm({
  request,
  options,
  book,
  onDone,
}: {
  request: BookingRequest;
  options: Options;
  book: DiaryActions["book"];
  onDone: (message: string, warnings: string[], itemId: string | undefined, date: string) => void;
}) {
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(request.patient ?? null);
  const [serviceId, setServiceId] = useState(request.serviceId ?? options.services[0]?.id ?? "");
  const [practitionerId, setPractitionerId] = useState(request.practitionerId ?? options.practitioners[0]?.id ?? "");
  const [siteId, setSiteId] = useState(request.siteId ?? options.sites[0]?.id ?? "");
  const [roomId, setRoomId] = useState(request.roomId ?? "");
  const [date, setDate] = useState(request.date);
  const [startTime, setStartTime] = useState(request.startTime ?? "09:00");
  const service = options.services.find((s) => s.id === serviceId);
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 30));
  const [caseId, setCaseId] = useState(request.caseId ?? "");
  const [authorisationId, setAuthorisationId] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [intervalWeeks, setIntervalWeeks] = useState("1");
  const [occurrences, setOccurrences] = useState("6");
  const [notes, setNotes] = useState("");
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [auths, setAuths] = useState<AuthOption[]>([]);
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [slotState, setSlotState] = useState<"idle" | "loading" | "error">("idle");
  const [result, setResult] = useState<Extract<DiaryActionResult, { ok: false }> | null>(null);
  const [pending, startTransition] = useTransition();
  const siteRooms = useMemo(() => options.rooms.filter((r) => r.siteId === siteId), [options.rooms, siteId]);

  useEffect(() => {
    if (!patient) {
      setCases([]);
      setAuths([]);
      return;
    }
    let live = true;
    void fetch(`/app/clinic/diary/api/patients/${encodeURIComponent(patient.id)}`)
      .then((r) => (r.ok ? r.json() : { cases: [], authorisations: [] }))
      .then((body: { cases: CaseOption[]; authorisations: AuthOption[] }) => {
        if (!live) return;
        setCases(body.cases);
        setAuths(body.authorisations);
        if (!request.caseId && body.cases.length === 1) setCaseId(body.cases[0].id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [patient, request.caseId]);

  const caseAuths = auths.filter((a) => a.caseId === caseId);
  useEffect(() => {
    if (authorisationId && !caseAuths.some((a) => a.id === authorisationId)) setAuthorisationId("");
  }, [caseAuths, authorisationId]);

  const findSlots = async () => {
    setSlotState("loading");
    try {
      const q = new URLSearchParams({ service: serviceId, from: date });
      if (practitionerId) q.set("practitioner", practitionerId);
      if (siteId) q.set("site", siteId);
      const res = await fetch(`/app/clinic/diary/api/slots?${q.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      setSlots(((await res.json()) as { slots: SlotOption[] }).slots);
      setSlotState("idle");
    } catch {
      setSlotState("error");
    }
  };

  const submit = (extra: { skipClashes?: boolean; allowPatientOverlap?: boolean } = {}) => {
    if (!patient) {
      setResult({ ok: false, error: "Choose the patient first.", fieldErrors: { patientId: "Choose a patient" } });
      return;
    }
    startTransition(async () => {
      const r = await book({
        patientId: patient.id,
        serviceId,
        practitionerId,
        siteId,
        roomId: roomId || null,
        caseId: caseId || null,
        authorisationId: authorisationId || null,
        date,
        startTime,
        durationMinutes: Number(duration),
        notes,
        repeat: repeat ? { intervalWeeks: Number(intervalWeeks), occurrences: Number(occurrences) } : null,
        waitingListId: request.waitingListId ?? null,
        ...extra,
      });
      if (r.ok) onDone(r.message, r.warnings, r.itemId, date);
      else setResult(r);
    });
  };

  const fe = result?.fieldErrors ?? {};
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {patient ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2">
          <p className="text-sm">
            <span className="text-slate-700">Patient: </span>
            <span className="font-semibold text-slate-900">{patient.name}</span>
          </p>
          {request.patient ? null : (
            <ActionButton variant="quiet" onClick={() => setPatient(null)}>
              Change patient
            </ActionButton>
          )}
        </div>
      ) : (
        <div>
          <PatientSearch id="book-patient" label="Patient *" autoFocus onPick={(h: PatientHit) => setPatient({ id: h.id, name: `${h.name} (No. ${h.number})` })} />
          {fe.patientId ? <p className="mt-1 text-xs font-medium text-red-700">{fe.patientId}</p> : null}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id="book-service"
          label="Appointment type *"
          value={serviceId}
          error={fe.serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            const s = options.services.find((x) => x.id === e.target.value);
            if (s) setDuration(String(s.durationMinutes));
            setSlots(null);
          }}
        >
          {options.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMinutes} min)
            </option>
          ))}
        </SelectField>
        <SelectField
          id="book-practitioner"
          label="Practitioner *"
          value={practitionerId}
          error={fe.practitionerId}
          onChange={(e) => {
            setPractitionerId(e.target.value);
            setSlots(null);
          }}
        >
          {options.practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="book-site"
          label="Site *"
          value={siteId}
          error={fe.siteId}
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
        <SelectField id="book-room" label="Room" value={roomId} error={fe.roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">No room</option>
          {siteRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <TextField id="book-date" label="Date *" type="date" value={date} error={fe.date} onChange={(e) => setDate(e.target.value)} required />
        <TextField id="book-time" label="Start time (24-hour) *" type="time" step={300} value={startTime} error={fe.startTime} onChange={(e) => setStartTime(e.target.value)} required />
        <TextField id="book-duration" label="Length in minutes *" type="number" inputMode="numeric" min={5} max={480} step={5} value={duration} error={fe.durationMinutes} onChange={(e) => setDuration(e.target.value)} />
      </div>

      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">Not sure when? See the next free times in the rota.</p>
          <ActionButton variant="secondary" onClick={findSlots} disabled={!serviceId || slotState === "loading"}>
            {slotState === "loading" ? "Looking…" : "Find a free time"}
          </ActionButton>
        </div>
        {slotState === "error" ? <p className="mt-2 text-sm text-red-700">Free times could not be loaded. Try again.</p> : null}
        {slots ? (
          slots.length === 0 ? (
            <p className="mt-2 text-sm text-slate-700" role="status">
              No free time in the next three weeks for this practitioner and appointment type.
            </p>
          ) : (
            <ul aria-label="Free times" className="mt-2 flex flex-wrap gap-2">
              {slots.map((s) => (
                <li key={`${s.date}-${s.time}-${s.practitionerId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setDate(s.date);
                      setStartTime(s.time);
                      setPractitionerId(s.practitionerId);
                      setSiteId(s.siteId);
                      setRoomId(s.roomId ?? "");
                    }}
                    className="rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  >
                    {formatUkDate(s.date)} {s.time}
                    {s.practitionerName && !practitionerId ? ` · ${s.practitionerName}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {patient ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField id="book-case" label="Case" value={caseId} error={fe.caseId} onChange={(e) => setCaseId(e.target.value)} hint={cases.length ? undefined : "The patient has no open case."}>
            <option value="">No case</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
          <SelectField id="book-auth" label="Treatment authorisation" value={authorisationId} error={fe.authorisationId} onChange={(e) => setAuthorisationId(e.target.value)} disabled={caseAuths.length === 0}>
            <option value="">{caseAuths.length ? "None" : "None for this case"}</option>
            {caseAuths.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code}
                {a.sessionsLeft === null ? "" : ` – ${a.sessionsLeft} ${a.sessionsLeft === 1 ? "session" : "sessions"} left`}
                {a.expiresOn ? `, until ${formatUkDate(a.expiresOn)}` : ""}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}

      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-800">Repeat</legend>
        <CheckboxField id="book-repeat" label="Book a course of appointments at the same time" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
        {repeat ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField id="book-interval" label="How often" value={intervalWeeks} onChange={(e) => setIntervalWeeks(e.target.value)} error={fe["repeat.intervalWeeks"]}>
              <option value="1">Every week</option>
              <option value="2">Every 2 weeks</option>
              <option value="3">Every 3 weeks</option>
              <option value="4">Every 4 weeks</option>
            </SelectField>
            <TextField id="book-occurrences" label="Number of appointments" type="number" inputMode="numeric" min={2} max={52} value={occurrences} onChange={(e) => setOccurrences(e.target.value)} error={fe["repeat.occurrences"]} />
          </div>
        ) : null}
      </fieldset>

      <TextAreaField id="book-notes" label="Booking note" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} hint={DIARY_COPY.bookingNoteHint} error={fe.notes} />

      <ActionError error={result?.error ?? null} details={result?.clashes} />
      <div className="flex flex-wrap justify-end gap-2">
        {result?.canSkipClashes ? (
          <ActionButton variant="secondary" disabled={pending} onClick={() => submit({ skipClashes: true })}>
            Book the free dates only
          </ActionButton>
        ) : null}
        {result?.patientOnly ? (
          <ActionButton variant="secondary" disabled={pending} onClick={() => submit({ allowPatientOverlap: true })}>
            Book anyway (seen together)
          </ActionButton>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? "Booking…" : repeat ? "Book the course" : "Book"}
        </button>
      </div>
    </form>
  );
}
