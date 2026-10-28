"use client";
/**
 * "New appointment" (design round 2, "Booking dialog"): 1. Patient – find existing (search by name, DOB or phone,
 * with DOB · mobile · last seen) or create new (the records module's possible-duplicate check), 2. Case and payer,
 * 3. Service and time with the live clash check (what is in the way, the next free slot, "Book anyway" for what may
 * be overridden), 4. Repeat (none / weekly / fortnightly) with every date's status – free, or skipped because of a
 * clash or leave – and "untick to skip". "Send confirmation text and email" is stored with the booking; the
 * messages module sends it. The primary button says "Resolve clash to book" until the clash is resolved.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, Search, X } from "lucide-react";
import { bookAppointmentAction, openBookingCaseAction, rebookAppointmentAction, registerBookingPatientAction } from "@/app/app/clinic/diary/actions";
import { formatPence } from "@/modules/pms/core/text";
import type { BookingCheck } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { PmsButton } from "../ui/button";
import { Checkbox, Radio, SelectInput, TextInput } from "../ui/inputs";
import { PmsAvatar } from "../ui/pms-avatar";
import { diaryApi } from "./api";
import { startTimeOptions, ukToIso, weekdayDate } from "./grid-model";

export interface BookingPreset {
  date: string;
  time: string;
  practitionerId: string | null;
  roomId: string | null;
  patient?: { id: string; name: string } | null;
  serviceId?: string | null;
  caseId?: string | null;
  waitingListId?: string | null;
  /** Rebooking a cancelled / missed appointment: the new one is linked to it. */
  rebookOf?: string | null;
}

export interface BookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: { id: string; name: string };
  practitioners: { id: string; name: string }[];
  rooms: { id: string; name: string }[];
  services: { id: string; name: string; durationMinutes: number; pricePence: number | null }[];
  /** Payer accounts for a new case (insurers, medico-legal companies…). */
  payers: { id: string; name: string; kind: string }[];
  preset: BookingPreset;
  can: {
    /** patients.edit: register a new patient, open a new case. */
    createPatient: boolean;
    /**
     * "Book anyway". TODO(permissions): gated on diary.manage until the configurable "Override clashes"
     * permission (feat/cs-access) lands – then ask for that one instead.
     */
    override: boolean;
  };
  onBooked: (message: string) => void;
}

interface PatientHit {
  id: string;
  name: string;
  number: number;
  dateOfBirth: string | null;
  phone: string | null;
  lastSeen: string | null;
  hasAlerts: boolean;
}

interface BookingOptions {
  cases: { id: string; title: string; payerType: string; payerLabel: string }[];
}

type RepeatChoice = "none" | "weekly" | "fortnightly";
const OCCURRENCES = 6;

export function BookingDialog(props: BookingDialogProps) {
  const { open, onOpenChange, site, practitioners, rooms, services, payers, preset, can, onBooked } = props;
  const [mode, setMode] = React.useState<"find" | "new">("find");
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<PatientHit[]>([]);
  const [active, setActive] = React.useState(-1);
  const [patient, setPatient] = React.useState<{ id: string; name: string } | null>(preset.patient ?? null);
  const [np, setNp] = React.useState({ firstName: "", lastName: "", dob: "", mobile: "", email: "", reminders: true, different: false });
  const [duplicates, setDuplicates] = React.useState<string[]>([]);
  const [options, setOptions] = React.useState<BookingOptions>({ cases: [] });
  const [caseId, setCaseId] = React.useState<string>(preset.caseId ?? "new");
  const [payerId, setPayerId] = React.useState<string>("self");
  const [serviceId, setServiceId] = React.useState<string>(preset.serviceId ?? services[0]?.id ?? "");
  const [practitionerId, setPractitionerId] = React.useState<string>(preset.practitionerId ?? practitioners[0]?.id ?? "");
  const [roomId, setRoomId] = React.useState<string>(preset.roomId ?? "");
  const [date, setDate] = React.useState(preset.date);
  const [time, setTime] = React.useState(preset.time);
  const [repeat, setRepeat] = React.useState<RepeatChoice>("none");
  const [unticked, setUnticked] = React.useState<Set<string>>(new Set());
  const [override, setOverride] = React.useState(false);
  const [confirm, setConfirm] = React.useState(true);
  const [check, setCheck] = React.useState<BookingCheck | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState<{ title: string; body: string } | null>(null);
  const listId = React.useId();

  // Each opening starts from the preset.
  React.useEffect(() => {
    if (!open) return;
    setMode("find");
    setQuery("");
    setHits([]);
    setActive(-1);
    setPatient(preset.patient ?? null);
    setNp({ firstName: "", lastName: "", dob: "", mobile: "", email: "", reminders: true, different: false });
    setDuplicates([]);
    setCaseId(preset.caseId ?? "new");
    setPayerId("self");
    setServiceId(preset.serviceId ?? services[0]?.id ?? "");
    setPractitionerId(preset.practitionerId ?? practitioners[0]?.id ?? "");
    setRoomId(preset.roomId ?? "");
    setDate(preset.date);
    setTime(preset.time);
    setRepeat("none");
    setUnticked(new Set());
    setOverride(false);
    setConfirm(true);
    setError(null);
    setFieldErrors({});
    setDone(null);
    // Only a new opening or a new preset resets the form – not the diary refreshing its lists behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset]);

  // Patient search (2+ characters, 200 ms after typing stops).
  React.useEffect(() => {
    if (mode !== "find" || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      void diaryApi.searchPatients<PatientHit[]>(query.trim()).then((r) => {
        if (!live) return;
        setHits(r.ok ? r.data : []);
        setActive(r.ok && r.data.length > 0 ? 0 : -1);
      });
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query, mode]);

  // The chosen patient's open cases.
  React.useEffect(() => {
    if (!patient) {
      setOptions({ cases: [] });
      return;
    }
    let live = true;
    void diaryApi.bookingOptions<BookingOptions>(patient.id).then((r) => {
      if (!live) return;
      const cases = r.ok ? r.data.cases : [];
      setOptions({ cases });
      setCaseId((c) => (c !== "new" && cases.some((x) => x.id === c) ? c : (preset.caseId && cases.some((x) => x.id === preset.caseId) ? preset.caseId : (cases[0]?.id ?? "new"))));
    });
    return () => {
      live = false;
    };
  }, [patient, preset.caseId]);

  const occurrences = repeat === "none" ? 1 : OCCURRENCES;
  const intervalWeeks = repeat === "fortnightly" ? 2 : 1;

  // The live clash check.
  React.useEffect(() => {
    if (!open || !serviceId || !practitionerId || !date || !time || done) return;
    let live = true;
    setChecking(true);
    const t = window.setTimeout(() => {
      void diaryApi
        .bookingCheck<BookingCheck>({ patientId: patient?.id, serviceId, practitionerId, siteId: site.id, roomId, date, startTime: time, occurrences: occurrences > 1 ? occurrences : null, intervalWeeks })
        .then((r) => {
          if (!live) return;
          setChecking(false);
          setCheck(r.ok ? r.data : null);
          setOverride(false);
          if (r.ok) setUnticked(new Set(r.data.occurrences.slice(1).filter((o) => o.status !== "free").map((o) => o.date)));
        });
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [open, patient, serviceId, practitionerId, roomId, date, time, occurrences, intervalWeeks, site.id, done]);

  const service = services.find((s) => s.id === serviceId);
  const practitionerName = practitioners.find((p) => p.id === practitionerId)?.name ?? "";
  const roomName = rooms.find((r) => r.id === roomId)?.name ?? null;
  const firstClash = check !== null && check.first.status !== "free";
  const overridable = firstClash && check.first.patientOnly;
  const blocked = firstClash && !(overridable && override && can.override);
  const toBook = check ? check.occurrences.filter((o, i) => i === 0 || (o.status === "free" && !unticked.has(o.date))).length : occurrences;
  const patientReady = mode === "find" ? patient !== null : np.firstName.trim() !== "" && np.lastName.trim() !== "";

  const pick = (h: PatientHit) => {
    setPatient({ id: h.id, name: h.name });
    setQuery(h.name);
    setHits([]);
  };

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    if (!patientReady) {
      setError(mode === "find" ? "Choose the patient first." : "Enter the patient's first and last name.");
      return;
    }
    if (blocked) return;
    setSaving(true);
    try {
      let who = patient;
      let createdPatient = false;
      if (mode === "new") {
        const dob = np.dob.trim() ? ukToIso(np.dob) : "";
        if (dob === null) {
          setFieldErrors({ dateOfBirth: "Enter the date of birth as DD/MM/YYYY" });
          return;
        }
        const r = await registerBookingPatientAction({ firstName: np.firstName, lastName: np.lastName, dateOfBirth: dob, phoneMobile: np.mobile, email: np.email, reminders: np.reminders, confirmNotDuplicate: np.different });
        if (!r.ok) {
          setError(r.error);
          setFieldErrors(r.fieldErrors ?? {});
          setDuplicates(r.clashes ?? []);
          return;
        }
        who = { id: r.itemId as string, name: `${np.firstName.trim()} ${np.lastName.trim()}` };
        setPatient(who);
        setMode("find");
        createdPatient = true;
      }
      if (!who) return;
      let useCase: string | null = caseId === "new" ? null : caseId;
      if (caseId === "new" && can.createPatient && !preset.rebookOf) {
        const payer = payers.find((p) => p.id === payerId);
        const r = await openBookingCaseAction({
          patientId: who.id,
          title: `${service?.name ?? "Appointment"} ${weekdayDate(date).slice(4)}`,
          openedOn: date,
          payerType: payer ? (payer.kind === "mlc" ? "mlc" : payer.kind === "solicitor" ? "solicitor" : payer.kind === "employer" ? "employer" : "insurer") : "self_pay",
          payerReferrerId: payer?.id ?? null,
          practitionerId,
          siteId: site.id,
        });
        if (!r.ok) {
          setError(`The case could not be opened: ${r.error}`);
          return;
        }
        useCase = r.itemId ?? null;
      }
      const skipDates = check ? check.occurrences.slice(1).filter((o) => o.status === "free" && unticked.has(o.date)).map((o) => o.date) : [];
      const result = preset.rebookOf
        ? await rebookAppointmentAction({ id: preset.rebookOf, date, startTime: time, practitionerId, siteId: site.id, roomId: roomId || null, allowPatientOverlap: override && can.override })
        : await bookAppointmentAction({
            patientId: who.id,
            serviceId,
            practitionerId,
            siteId: site.id,
            roomId: roomId || null,
            caseId: useCase,
            date,
            startTime: time,
            repeat: occurrences > 1 ? { intervalWeeks, occurrences } : null,
            skipClashes: occurrences > 1,
            skipDates,
            allowPatientOverlap: override && can.override,
            waitingListId: preset.waitingListId ?? null,
            sendConfirmation: confirm,
          });
      if (!result.ok) {
        setError([result.error, ...(result.clashes ?? [])].join(" "));
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      const count = result.itemIds?.length ?? 1;
      const title = count > 1 ? `${count} appointments booked` : preset.rebookOf ? "Appointment rebooked" : "Appointment booked";
      const body = `${who.name} with ${practitionerName}, ${count > 1 ? "from " : ""}${weekdayDate(date)} at ${time}.${confirm && !preset.rebookOf ? " Confirmation text and email requested – it is sent once messages are switched on." : ""}${createdPatient ? " A new patient record has been created." : ""}`;
      setDone({ title, body });
      onBooked(count > 1 ? `${count} appointments booked for ${who.name}` : `${who.name} booked ${time}`);
    } finally {
      setSaving(false);
    }
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setHits([]);
    }
  };

  const times = React.useMemo(() => {
    const list = startTimeOptions();
    return list.includes(time) ? list : [...list, time].sort();
  }, [time]);

  const segment = (on: boolean) => cn("inline-flex h-[30px] items-center rounded-[8px] px-3 text-[13px] font-medium", on ? "bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-[#475569] hover:text-foreground");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (saving ? undefined : onOpenChange(o))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[860px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-white text-sm shadow-[0_24px_48px_rgba(15,23,42,0.24)] focus:outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <DialogPrimitive.Title className="flex-1 text-lg font-semibold text-foreground">{preset.rebookOf ? "Rebook appointment" : "New appointment"}</DialogPrimitive.Title>
            <span className="text-xs text-[#475569]">{site.name}</span>
            <DialogPrimitive.Close aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          {done ? (
            <div role="status" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-[#166534]" aria-hidden />
              <strong className="text-lg text-foreground">{done.title}</strong>
              <span className="max-w-[520px] text-[#334155]">{done.body}</span>
              <div className="mt-2 flex gap-2">
                <PmsButton variant="secondary" onClick={() => onOpenChange(false)}>
                  Back to diary
                </PmsButton>
                <PmsButton
                  onClick={() => {
                    setDone(null);
                    setPatient(null);
                    setQuery("");
                  }}
                >
                  Book another
                </PmsButton>
              </div>
            </div>
          ) : (
            <>
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto px-5 py-5 md:grid-cols-2">
                <section aria-labelledby="bk-p" className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id="bk-p" className="font-semibold text-foreground">
                      1. Patient
                    </h3>
                    {!preset.rebookOf ? (
                      <div role="group" aria-label="Patient" className="flex gap-0.5 rounded-[10px] bg-[#F1F5F9] p-[3px]">
                        <button type="button" aria-pressed={mode === "find"} className={segment(mode === "find")} onClick={() => setMode("find")}>
                          Find existing
                        </button>
                        {can.createPatient ? (
                          <button
                            type="button"
                            aria-pressed={mode === "new"}
                            className={segment(mode === "new")}
                            onClick={() => {
                              setMode("new");
                              setPatient(null);
                            }}
                          >
                            Create new
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {mode === "find" ? (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="bk-search" className="font-medium text-foreground">
                        Search by name, DOB or phone
                      </label>
                      <div className="flex h-9 items-center gap-2 rounded-[8px] border border-primary bg-white px-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
                        <Search className="h-4 w-4 text-[#64748B]" aria-hidden />
                        <input
                          id="bk-search"
                          type="search"
                          role="combobox"
                          aria-expanded={hits.length > 0}
                          aria-controls={listId}
                          aria-autocomplete="list"
                          aria-activedescendant={active >= 0 && hits[active] ? `${listId}-${hits[active].id}` : undefined}
                          autoComplete="off"
                          value={query}
                          disabled={Boolean(preset.rebookOf)}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            if (patient && e.target.value !== patient.name) setPatient(null);
                          }}
                          onKeyDown={onSearchKey}
                          className="h-full min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
                        />
                      </div>
                      {patient ? (
                        <p className="text-xs text-[#166534]" role="status">
                          Chosen: <strong>{patient.name}</strong>
                        </p>
                      ) : null}
                      {hits.length > 0 ? (
                        <div id={listId} role="listbox" aria-label="Matching patients" className="flex flex-col overflow-hidden rounded-[10px] border border-border">
                          {hits.map((h, i) => (
                            <div
                              key={h.id}
                              id={`${listId}-${h.id}`}
                              role="option"
                              aria-selected={i === active}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => pick(h)}
                              className={cn("flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0", i === active ? "bg-[#F0FDFA]" : "bg-white hover:bg-[#F8FAFC]")}
                            >
                              <PmsAvatar name={h.name} size={32} />
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate font-semibold text-foreground">
                                  {h.name}
                                  {h.hasAlerts ? <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-[#864E0E]" aria-label="has an alert" /> : null}
                                </span>
                                <span className="truncate text-xs text-[#475569]">{[h.dateOfBirth ? `DOB ${h.dateOfBirth}` : `No. ${h.number}`, h.phone].filter(Boolean).join(" · ")}</span>
                              </span>
                              <span className="shrink-0 text-xs text-[#475569]">{h.lastSeen ? `Last seen ${h.lastSeen}` : "Not seen yet"}</span>
                            </div>
                          ))}
                        </div>
                      ) : query.trim().length >= 2 && !patient ? (
                        <p className="text-xs text-[#475569]">No patient found yet – keep typing{can.createPatient ? ", or create a new patient" : ""}.</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <Field id="np-f" label="First name" error={fieldErrors.firstName}>
                        <TextInput id="np-f" value={np.firstName} onChange={(e) => setNp({ ...np, firstName: e.target.value })} autoComplete="off" />
                      </Field>
                      <Field id="np-l" label="Last name" error={fieldErrors.lastName}>
                        <TextInput id="np-l" value={np.lastName} onChange={(e) => setNp({ ...np, lastName: e.target.value })} autoComplete="off" />
                      </Field>
                      <Field id="np-d" label="Date of birth" error={fieldErrors.dateOfBirth}>
                        <TextInput id="np-d" value={np.dob} placeholder="DD/MM/YYYY" inputMode="numeric" onChange={(e) => setNp({ ...np, dob: e.target.value })} />
                      </Field>
                      <Field id="np-m" label="Mobile" error={fieldErrors.phoneMobile}>
                        <TextInput id="np-m" type="tel" value={np.mobile} onChange={(e) => setNp({ ...np, mobile: e.target.value })} />
                      </Field>
                      <Field id="np-e" label="Email" error={fieldErrors.email} className="col-span-2">
                        <TextInput id="np-e" type="email" value={np.email} onChange={(e) => setNp({ ...np, email: e.target.value })} />
                      </Field>
                      <Checkbox className="col-span-2" checked={np.reminders} onChange={(e) => setNp({ ...np, reminders: e.target.checked })} label="Patient agrees to appointment reminders by text and email" />
                      {duplicates.length > 0 ? (
                        <div role="alert" className="col-span-2 flex flex-col gap-2 rounded-[10px] border border-[#FBD38D] bg-[#FFFBEB] px-3 py-2.5">
                          <strong>Possible existing record</strong>
                          <ul className="list-disc pl-5">
                            {duplicates.map((d) => (
                              <li key={d}>{d}</li>
                            ))}
                          </ul>
                          <Checkbox checked={np.different} onChange={(e) => setNp({ ...np, different: e.target.checked })} label="This is a different person" />
                        </div>
                      ) : (
                        <p role="note" className="col-span-2 text-xs text-[#475569]">
                          Checked against existing records (name and date of birth, phone, email) when you book. Address and GP can be added later.
                        </p>
                      )}
                    </div>
                  )}

                  <h3 className="mt-2 font-semibold text-foreground">2. Case and payer</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="bk-case" label="Case">
                      <SelectInput id="bk-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} disabled={Boolean(preset.rebookOf)}>
                        {can.createPatient ? <option value="new">New case</option> : <option value="new">No case</option>}
                        {options.cases.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field id="bk-pay" label="Payer">
                      {caseId === "new" ? (
                        <SelectInput id="bk-pay" value={payerId} onChange={(e) => setPayerId(e.target.value)} disabled={!can.createPatient}>
                          <option value="self">Self-pay</option>
                          {payers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </SelectInput>
                      ) : (
                        <SelectInput id="bk-pay" value="case" disabled>
                          <option value="case">{options.cases.find((c) => c.id === caseId)?.payerLabel ?? "Self-pay"}</option>
                        </SelectInput>
                      )}
                    </Field>
                  </div>
                </section>

                <section aria-labelledby="bk-w" className="flex min-w-0 flex-col gap-3">
                  <h3 id="bk-w" className="font-semibold text-foreground">
                    3. Service and time
                  </h3>
                  <Field id="bk-svc" label="Service" error={fieldErrors.serviceId}>
                    <SelectInput id="bk-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={Boolean(preset.rebookOf)}>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {[s.name, `${s.durationMinutes} min`, s.pricePence !== null ? formatPence(s.pricePence) : null].filter(Boolean).join(" – ")}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="bk-pr" label="Practitioner" error={fieldErrors.practitionerId}>
                      <SelectInput id="bk-pr" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
                        {practitioners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field id="bk-rm" label="Room" error={fieldErrors.roomId}>
                      <SelectInput id="bk-rm" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                        <option value="">No room</option>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field id="bk-dt" label="Date" error={fieldErrors.date}>
                      <TextInput id="bk-dt" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                    </Field>
                    <Field id="bk-tm" label="Start time" error={fieldErrors.startTime}>
                      <SelectInput id="bk-tm" value={time} aria-describedby="bk-slot" aria-invalid={firstClash || undefined} onChange={(e) => setTime(e.target.value)}>
                        {times.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                  </div>
                  <div
                    id="bk-slot"
                    role={firstClash ? "alert" : "status"}
                    aria-live="polite"
                    className={cn("flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3", firstClash ? "border-[#FECACA] bg-[#FEF2F2]" : "border-[#A7E8BE] bg-[#F0FDF4]", !check && "border-border bg-[#F8FAFC]")}
                  >
                    {firstClash ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#166534]" aria-hidden />}
                    <div className="flex min-w-0 flex-col gap-1.5">
                      {!check ? (
                        <span className="text-[#475569]">{checking ? "Checking the time…" : "Choose a service, practitioner, date and time."}</span>
                      ) : firstClash ? (
                        <>
                          <strong className="text-destructive-strong">This time clashes</strong>
                          <span className="text-[#334155]">
                            {check.clashText}
                            {check.nextFree ? ` The next free ${check.durationMinutes}-minute slot is ${check.nextFree.label}.` : " There is no free slot with this practitioner in the next two weeks."}
                          </span>
                          {check.nextFree ? (
                            <button
                              type="button"
                              className="self-start text-sm font-medium text-primary-strong underline underline-offset-2"
                              onClick={() => {
                                setDate(check.nextFree!.date);
                                setTime(check.nextFree!.time);
                              }}
                            >
                              Use {check.nextFree.label}
                            </button>
                          ) : null}
                          {overridable && can.override ? (
                            <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} label="Book anyway (double-booking is logged)" />
                          ) : (
                            <span className="text-xs text-[#475569]">
                              {overridable
                                ? "Only an owner or administrator can book over the patient's other appointment."
                                : "A practitioner or room cannot be double-booked – choose another time, practitioner or room."}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <strong className="text-[#166534]">Slot available</strong>
                          <span className="text-[#334155]">
                            {practitionerName}
                            {roomName ? ` and ${roomName}` : ""} {roomName ? "are" : "is"} free {check.startTime}–{check.endTime}.{check.first.outsideHours ? " This is outside the practitioner's working hours." : ""}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {!preset.rebookOf ? (
                    <>
                      <h3 className="mt-1 font-semibold text-foreground">4. Repeat</h3>
                      <fieldset className="flex flex-wrap gap-4">
                        <legend className="sr-only">Repeat</legend>
                        {(
                          [
                            ["none", "Does not repeat"],
                            ["weekly", "Weekly"],
                            ["fortnightly", "Fortnightly"],
                          ] as const
                        ).map(([v, label]) => (
                          <Radio key={v} name="bk-rep" checked={repeat === v} onChange={() => setRepeat(v)} label={label} />
                        ))}
                      </fieldset>
                      {repeat !== "none" && check ? (
                        <div className="overflow-hidden rounded-[10px] border border-border">
                          <div className="flex justify-between bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
                            <span>{check.occurrences.length} occurrences · untick to skip</span>
                            <span>{toBook} will be booked</span>
                          </div>
                          {check.occurrences.map((o, i) => {
                            const free = o.status === "free";
                            const on = i === 0 || (free && !unticked.has(o.date));
                            return (
                              <label key={o.date} className="flex items-center gap-3 border-t border-border px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-[#0B7970]"
                                  checked={on}
                                  disabled={i === 0 || !free}
                                  onChange={(e) =>
                                    setUnticked((s) => {
                                      const next = new Set(s);
                                      if (e.target.checked) next.delete(o.date);
                                      else next.add(o.date);
                                      return next;
                                    })
                                  }
                                />
                                <span className={cn("w-[120px] shrink-0 text-foreground", !on && "text-[#64748B] line-through")}>{o.dateLabel}</span>
                                <span className={cn("min-w-0 flex-1 text-right text-xs", free ? "text-[#475569]" : "text-[#9A3412]")}>
                                  {!free ? <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden /> : null}
                                  {i === 0 ? (free ? "This booking" : o.note) : free ? (on ? o.note : "Skipped") : `Skipped – ${skippedWords(o.note)}`}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
                {!preset.rebookOf ? <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} label="Send confirmation text and email" /> : null}
                {error ? (
                  <p role="alert" className="basis-full text-sm text-destructive-strong">
                    {error}
                  </p>
                ) : null}
                <div className="ml-auto flex gap-2">
                  <DialogPrimitive.Close asChild>
                    <PmsButton variant="secondary" disabled={saving}>
                      Cancel
                    </PmsButton>
                  </DialogPrimitive.Close>
                  <PmsButton onClick={() => void submit()} loading={saving} loadingText="Booking…" disabled={blocked || !check}>
                    {blocked ? "Resolve clash to book" : toBook > 1 ? `Book ${toBook} appointments` : preset.rebookOf ? "Rebook" : "Book appointment"}
                  </PmsButton>
                </div>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Field({ id, label, error, className, children }: { id: string; label: string; error?: string; className?: string; children: React.ReactElement }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-medium text-foreground">
        {label}
      </label>
      {React.cloneElement(children, error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {})}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-xs text-destructive-strong">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "Clashes with Grace Kim 11:00" → "clashes with Grace Kim 11:00" after "Skipped –"; names keep their capitals
 * ("Sarah Reid – annual leave"). (The design lower-cased whole names – fixed here.)
 */
export function skippedWords(note: string): string {
  return /^(Clashes|The patient's|Free)\b/.test(note) ? note.charAt(0).toLowerCase() + note.slice(1) : note;
}
