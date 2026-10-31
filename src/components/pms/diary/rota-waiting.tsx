"use client";
/**
 * "Rota and waiting list" (design round 2): left, a practitioner's weekly working pattern from a date – per day on/
 * off, site, hours, break, a bar of the day – with its exceptions (leave, training) and "Add leave or change";
 * right, the site's waiting list – the freed slot banner, each patient's wants / availability / days waiting, "Matches
 * slot", Offer slot by text, Book, Remove – and "Add". Rota and waiting-list changes need diary.rota; booking from the list diary.book.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Check, Plus, Search } from "lucide-react";
import { createBlockAction, saveWeeklyRotaAction } from "@/app/app/clinic/diary/actions";
import { addToWaitingListAction, answerWaitingListOfferAction, bookWaitingListOfferAction, offerWaitingListSlotAction, setWaitingListStatusAction } from "@/app/app/clinic/diary/waiting-list/actions";
import { OFFER_HOLD_CHOICES, OFFER_HOLD_DEFAULT_MINUTES } from "@/modules/pms/diary/schemas";
import { PRIORITY_LABELS, TIME_OF_DAY_LABELS } from "@/modules/pms/diary/copy";
import { TIMES_OF_DAY, WAITING_PRIORITIES, type TimeOfDay, type WaitingPriority } from "@/modules/pms/diary/rules";
import { WEEKDAY_NAMES, parseHhmm } from "@/modules/pms/diary/time";
import type { WaitingListRow } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { PmsButton } from "../ui/button";
import { Checkbox, SelectInput, Switch, TextInput } from "../ui/inputs";
import { useToast } from "../ui/toast";
import { DIARY_PATH, diaryApi } from "./api";
import { weekdayDate } from "./grid-model";

export interface RotaDay {
  weekday: number;
  working: boolean;
  siteId: string | null;
  roomId: string | null;
  start: string;
  end: string;
  breakStart: string | null;
  breakEnd: string | null;
  irregular: boolean;
}

export interface RotaWaitingProps {
  site: { id: string; name: string } | null;
  sites: { id: string; name: string }[];
  rooms: { id: string; name: string; siteId: string }[];
  practitioners: { id: string; name: string; registration: string | null }[];
  services: { id: string; name: string }[];
  rota: {
    show: boolean;
    canEdit: boolean;
    practitionerId: string | null;
    from: string;
    days: RotaDay[];
    exceptions: { id: string; date: string; label: string; bookingsToMove: number }[];
  };
  waiting: {
    /** diary.book: "Book" (a booking from the list). */
    canBook: boolean;
    /** diary.rota: add, offer, remove. */
    canEdit: boolean;
    rows: WaitingListRow[];
    freed: { date: string; time: string; endTime: string; practitionerId: string; practitionerName: string | null; siteId: string; roomId: string | null; reason: string; matches: string[] } | null;
  };
  today: string;
}

const BAR_START = 7 * 60;
const BAR_END = 20 * 60;
const pct = (m: number) => `${Math.max(0, Math.min(100, ((m - BAR_START) / (BAR_END - BAR_START)) * 100))}%`;

export function RotaWaiting(props: RotaWaitingProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href={DIARY_PATH} className="text-primary-strong underline">
          Diary
        </Link>{" "}
        / {props.rota.show ? "Rota and waiting list" : "Waiting list"}
      </p>
      <h1 className="sr-only">{props.rota.show ? "Rota and waiting list" : "Waiting list"}</h1>
      <div className={cn("grid gap-5", props.rota.show ? "lg:grid-cols-[minmax(0,1fr)_380px]" : "")}>
        {props.rota.show ? <RotaEditor {...props} /> : null}
        <WaitingList {...props} />
      </div>
    </div>
  );
}

function RotaEditor({ rota, sites, rooms, practitioners, site, today }: RotaWaitingProps) {
  const router = useRouter();
  const toast = useToast();
  const [days, setDays] = React.useState<RotaDay[]>(rota.days);
  const [from, setFrom] = React.useState(rota.from);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  React.useEffect(() => setDays(rota.days), [rota.days]);
  const set = (i: number, patch: Partial<RotaDay>) => setDays((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const hours = days.reduce((sum, d) => {
    if (!d.working) return sum;
    const s = parseHhmm(d.start) ?? 0;
    const e = parseHhmm(d.end) ?? 0;
    const b = d.breakStart && d.breakEnd ? (parseHhmm(d.breakEnd) ?? 0) - (parseHhmm(d.breakStart) ?? 0) : 0;
    return sum + Math.max(0, e - s - b) / 60;
  }, 0);
  const pick = (id: string) => router.push(`${DIARY_PATH}/rotas?practitioner=${id}&from=${from}${site ? `&site=${site.id}` : ""}`);

  const save = async () => {
    if (!rota.practitionerId) return;
    setSaving(true);
    setError(null);
    const r = await saveWeeklyRotaAction({
      practitionerId: rota.practitionerId,
      from,
      days: days.filter((d) => !d.irregular).map((d) => ({ weekday: d.weekday, working: d.working, siteId: d.siteId, roomId: d.roomId, start: d.start, end: d.end, breakStart: d.breakStart ?? "", breakEnd: d.breakEnd ?? "" })),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.message);
    router.refresh();
  };

  return (
    <section aria-labelledby="rota-h" className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 id="rota-h" className="text-lg font-semibold text-foreground">
            Rota
          </h2>
          <p className="text-sm text-[#475569]">Weekly working pattern. The diary only offers times inside it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="rota-who" className="sr-only">
            Practitioner
          </label>
          <SelectInput id="rota-who" value={rota.practitionerId ?? ""} onChange={(e) => pick(e.target.value)} className="w-[230px]">
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.registration ? ` (${p.registration})` : ""}
              </option>
            ))}
          </SelectInput>
          <label htmlFor="rota-from" className="text-sm text-[#475569]">
            From
          </label>
          <TextInput id="rota-from" type="date" value={from} min={today} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-[150px]" disabled={!rota.canEdit} />
        </div>
      </div>
      {/* A scroll region the keyboard can reach (M10 finding 6): focusable, named, with a focus outline. */}
      <div tabIndex={0} role="region" aria-label="Weekly working pattern" className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Working pattern per day</caption>
          <thead className="bg-[#F8FAFC] text-left text-xs text-[#475569]">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Day</th>
              <th scope="col" className="px-2 py-2 font-medium">Site</th>
              <th scope="col" className="px-2 py-2 font-medium">Hours</th>
              <th scope="col" className="px-2 py-2 font-medium">Break</th>
              <th scope="col" className="px-4 py-2 font-medium">07:00 – 20:00</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => {
              const name = WEEKDAY_NAMES[d.weekday - 1];
              const s = parseHhmm(d.start) ?? 0;
              const e = parseHhmm(d.end) ?? 0;
              const bs = d.breakStart ? parseHhmm(d.breakStart) : null;
              const be = d.breakEnd ? parseHhmm(d.breakEnd) : null;
              const disabled = !rota.canEdit || d.irregular;
              return (
                <tr key={d.weekday} className={cn("border-t border-border", !d.working && "bg-[#F8FAFC]")}>
                  <td className="px-4 py-2">
                    <Switch checked={d.working} disabled={disabled} onCheckedChange={(on) => set(i, { working: on, siteId: d.siteId ?? site?.id ?? sites[0]?.id ?? null })} label={name} />
                  </td>
                  {d.working ? (
                    <>
                      <td className="px-2 py-2">
                        <SelectInput aria-label={`${name} site`} value={d.siteId ?? ""} disabled={disabled} onChange={(ev) => set(i, { siteId: ev.target.value, roomId: null })} className="w-[150px]">
                          {sites.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </SelectInput>
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1">
                          <TextInput aria-label={`${name} start`} type="time" step={900} value={d.start} disabled={disabled} onChange={(ev) => set(i, { start: ev.target.value })} className="w-[96px]" />
                          <span aria-hidden>–</span>
                          <TextInput aria-label={`${name} end`} type="time" step={900} value={d.end} disabled={disabled} onChange={(ev) => set(i, { end: ev.target.value })} className="w-[96px]" />
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1">
                          <TextInput aria-label={`${name} break start`} type="time" step={900} value={d.breakStart ?? ""} disabled={disabled} onChange={(ev) => set(i, { breakStart: ev.target.value || null })} className="w-[96px]" />
                          <span aria-hidden>–</span>
                          <TextInput aria-label={`${name} break end`} type="time" step={900} value={d.breakEnd ?? ""} disabled={disabled} onChange={(ev) => set(i, { breakEnd: ev.target.value || null })} className="w-[96px]" />
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div aria-hidden className="relative h-3 rounded-full bg-[#EEF2F6]">
                          <div className="absolute inset-y-0 rounded-full bg-primary-strong" style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} />
                          {bs !== null && be !== null ? (
                            <div className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,#99E2D8_0_3px,#F0FDFA_3px_6px)]" style={{ left: pct(bs), width: `calc(${pct(be)} - ${pct(bs)})` }} />
                          ) : null}
                        </div>
                        {d.irregular ? <span className="text-xs text-[#9A3412]">Several entries or every few weeks – change them under the diary&apos;s rota entries.</span> : null}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-2 py-2 text-[#475569]">
                      Not working
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground">Exceptions</h3>
          {rota.canEdit ? (
            <PmsButton variant="secondary" onClick={() => setLeaveOpen((o) => !o)} aria-expanded={leaveOpen}>
              <Plus aria-hidden />
              Add leave or change
            </PmsButton>
          ) : null}
        </div>
        {leaveOpen && rota.practitionerId ? <LeaveForm practitionerId={rota.practitionerId} sites={sites} defaultSite={days.find((d) => d.working)?.siteId ?? site?.id ?? sites[0]?.id ?? ""} onDone={() => setLeaveOpen(false)} today={today} /> : null}
        {rota.exceptions.length === 0 ? <p className="text-sm text-[#475569]">No leave or blocked time in the coming eight weeks.</p> : null}
        <ul className="flex flex-col gap-2">
          {rota.exceptions.map((x) => (
            <li key={x.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border px-3.5 py-2.5", x.bookingsToMove > 0 ? "border-[#FBD38D] bg-[#FFFBEB]" : "border-border")}>
              <span className="w-[130px] font-medium text-foreground">{weekdayDate(x.date)}</span>
              <span className="min-w-0 flex-1">{x.label}</span>
              {x.bookingsToMove > 0 ? (
                <span className="flex items-center gap-2 text-xs text-[#864E0E]">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {x.bookingsToMove} {x.bookingsToMove === 1 ? "booking" : "bookings"} to move
                  <Link className="font-medium text-primary-strong underline" href={`${DIARY_PATH}?date=${x.date}${site ? `&site=${site.id}` : ""}`}>
                    Review
                  </Link>
                </span>
              ) : (
                <span className="text-xs text-[#475569]">No bookings affected</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {rota.canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
          <span className="text-sm text-[#334155]">{Number.isInteger(hours) ? hours : hours.toFixed(1)} bookable hours per week</span>
          {error ? (
            <p role="alert" className="basis-full text-sm text-destructive-strong">
              {error}
            </p>
          ) : null}
          <div className="ml-auto flex gap-2">
            <PmsButton variant="secondary" onClick={() => setDays(rota.days)} disabled={saving}>
              Discard
            </PmsButton>
            <PmsButton onClick={() => void save()} loading={saving} loadingText="Saving…">
              Save rota
            </PmsButton>
          </div>
        </div>
      ) : null}
      <p className="sr-only">{rooms.length} rooms</p>
    </section>
  );
}

function LeaveForm({ practitionerId, sites, defaultSite, onDone, today }: { practitionerId: string; sites: { id: string; name: string }[]; defaultSite: string; onDone: () => void; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = React.useState({ date: today, start: "09:00", end: "17:00", kind: "leave", title: "Annual leave", siteId: defaultSite });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="grid gap-3 rounded-[10px] border border-border bg-[#F8FAFC] p-3 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await createBlockAction({ siteId: v.siteId, practitionerId, blockKind: v.kind as "leave", title: v.title, date: v.date, startTime: v.start, endTime: v.end });
        setBusy(false);
        if (!r.ok) return setError([r.error, ...(r.clashes ?? [])].join(" "));
        toast.success("Time blocked.");
        onDone();
        router.refresh();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Date
        <TextInput type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        From
        <TextInput type="time" step={900} value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Until
        <TextInput type="time" step={900} value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        What
        <SelectInput value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          <option value="leave">Leave</option>
          <option value="training">Training</option>
          <option value="meeting">Meeting</option>
          <option value="admin">Admin time</option>
          <option value="other">Other</option>
        </SelectInput>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Label
        <TextInput value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Site
        <SelectInput value={v.siteId} onChange={(e) => setV({ ...v, siteId: e.target.value })}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectInput>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong sm:col-span-3">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <PmsButton variant="secondary" type="button" onClick={onDone}>
          Cancel
        </PmsButton>
        <PmsButton type="submit" loading={busy}>
          Block the time
        </PmsButton>
      </div>
    </form>
  );
}

function WaitingList({ waiting, site, practitioners, services }: RotaWaitingProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const rows = waiting.rows;
  const freed = waiting.freed;
  const open = rows.filter((r) => r.status === "waiting" || r.status === "offered");
  const [holdMinutes, setHoldMinutes] = React.useState<number>(OFFER_HOLD_DEFAULT_MINUTES);

  // The offered slot is HELD for the patient (nobody else can book over it) until the hold ends, they answer, or
  // the offer is withdrawn (M9b).
  const offer = async (r: WaitingListRow) => {
    if (!freed) return;
    setBusy(`offer:${r.id}`);
    const res = await offerWaitingListSlotAction({ id: r.id, expectedRev: r.rev, siteId: freed.siteId, practitionerId: freed.practitionerId, roomId: freed.roomId, date: freed.date, startTime: freed.time, holdMinutes });
    setBusy(null);
    if (res.ok) toast.success(res.message ?? `Slot offered to ${r.patientName ?? "the patient"}.`);
    else toast.error(res.error);
    router.refresh();
  };
  const answer = async (r: WaitingListRow, status: "declined" | "withdrawn") => {
    if (!r.offer) return;
    setBusy(`${status}:${r.id}`);
    const res = await answerWaitingListOfferAction({ offerId: r.offer.id, expectedRev: r.rev, status });
    setBusy(null);
    if (res.ok) toast.success(status === "declined" ? "Offer declined – the slot is free again." : "Offer withdrawn – the slot is free again.");
    else toast.error(res.error);
    router.refresh();
  };
  const bookOffer = async (r: WaitingListRow) => {
    if (!r.offer) return;
    setBusy(`book:${r.id}`);
    const res = await bookWaitingListOfferAction({ offerId: r.offer.id });
    setBusy(null);
    if (res.ok) toast.success(`${r.patientName ?? "The patient"} is booked into the offered slot.`);
    else toast.error(res.error);
    router.refresh();
  };
  const remove = async (r: WaitingListRow) => {
    setBusy(`remove:${r.id}`);
    const res = await setWaitingListStatusAction({ id: r.id, expectedRev: r.rev, status: "removed" });
    setBusy(null);
    if (res.ok) toast.success(`${r.patientName ?? "Patient"} removed from the waiting list`);
    else toast.error(res.error);
    router.refresh();
  };

  return (
    <section aria-labelledby="wl-h" className="flex flex-col overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 id="wl-h" className="text-lg font-semibold text-foreground">
            Waiting list
          </h2>
          <p className="text-sm text-[#475569]">
            {site?.name ?? "All sites"} · {open.length} waiting
          </p>
        </div>
        {waiting.canEdit ? (
          <PmsButton variant="secondary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <Plus aria-hidden />
            Add
          </PmsButton>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {adding ? <AddToWaitingList siteId={site?.id ?? null} practitioners={practitioners} services={services} onDone={() => setAdding(false)} /> : null}
        {freed ? (
          <div role="status" className="rounded-[10px] border border-[#99E2D8] bg-[#F0FDFA] px-3.5 py-3">
            <p className="flex items-center gap-2 font-semibold text-[#0B5F58]">
              <CalendarClock className="h-4 w-4" aria-hidden />
              Slot freed: {weekdayDate(freed.date)} {freed.time}–{freed.endTime}, {freed.practitionerName}
            </p>
            <p className="text-sm text-[#334155]">From {freed.reason}. Patients matched to it are marked below.</p>
            {waiting.canEdit ? (
              <label className="mt-2 flex items-center gap-2 text-sm text-[#334155]">
                Hold an offered slot for
                <SelectInput data-testid="offer-hold" value={String(holdMinutes)} onChange={(e) => setHoldMinutes(Number(e.target.value))} className="w-[130px]">
                  {OFFER_HOLD_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : m < 1440 ? `${m / 60} hours` : "1 day"}
                    </option>
                  ))}
                </SelectInput>
              </label>
            ) : null}
          </div>
        ) : null}
        {open.length === 0 ? <p className="text-sm text-[#475569]">Nobody is waiting.</p> : null}
        {open.map((r) => {
          const match = freed?.matches.includes(r.id) ?? false;
          return (
            <article key={r.id} aria-label={r.patientName ?? "Patient"} className={cn("flex flex-col gap-2 rounded-[10px] border px-3.5 py-3", match ? "border-[#99E2D8]" : "border-border")}>
              <div className="flex items-center justify-between gap-2">
                <strong className="text-foreground">{r.patientName ?? `Patient No. ${r.patientNumber ?? ""}`}</strong>
                {match ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-xs font-medium text-[#166534]">
                    <Check className="h-3 w-3" aria-hidden />
                    Matches slot
                  </span>
                ) : r.status === "offered" ? (
                  <span className="rounded-full bg-[#E8EEFB] px-2 py-0.5 text-xs font-medium text-[#1842B4]">{r.statusLabel}</span>
                ) : r.priority !== "routine" ? (
                  <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#864E0E]">{r.priorityLabel}</span>
                ) : null}
              </div>
              <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-[#475569]">Wants</dt>
                <dd>
                  {r.serviceName ?? "Any appointment"} · {r.practitionerName ?? "any practitioner"}
                </dd>
                <dt className="text-[#475569]">Available</dt>
                <dd>{r.preferenceLabel}</dd>
                <dt className="text-[#475569]">Waiting</dt>
                <dd>
                  {r.waitingDays} {r.waitingDays === 1 ? "day" : "days"}
                </dd>
              </dl>
              {r.offer ? (
                <p data-testid="offer-held" className="flex items-start gap-2 rounded-[8px] border border-dashed border-[#7C93E8] bg-[#F5F7FE] px-2.5 py-1.5 text-sm text-[#1E3A8A]">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Offered {r.offer.dateLabel} {r.offer.timeLabel}
                    {r.offer.practitionerName ? ` with ${r.offer.practitionerName}` : ""}.{" "}
                    {r.offer.held ? <strong>Held until {r.offer.holdUntilLabel}.</strong> : "The hold has ended – the slot can be booked by anyone."}
                  </span>
                </p>
              ) : null}
              {r.offer && (waiting.canBook || waiting.canEdit) ? (
                <div className="flex flex-wrap gap-2">
                  {waiting.canBook ? (
                    <PmsButton size="sm" loading={busy === `book:${r.id}`} onClick={() => void bookOffer(r)}>
                      Book offered slot
                    </PmsButton>
                  ) : null}
                  {waiting.canEdit ? (
                    <>
                      <PmsButton size="sm" variant="secondary" loading={busy === `declined:${r.id}`} onClick={() => void answer(r, "declined")}>
                        Patient declined
                      </PmsButton>
                      <PmsButton size="sm" variant="ghost" loading={busy === `withdrawn:${r.id}`} onClick={() => void answer(r, "withdrawn")}>
                        Withdraw offer
                      </PmsButton>
                    </>
                  ) : null}
                </div>
              ) : null}
              {waiting.canBook || waiting.canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {match && waiting.canEdit ? (
                    <PmsButton size="sm" loading={busy === `offer:${r.id}`} onClick={() => void offer(r)}>
                      Offer slot by text
                    </PmsButton>
                  ) : null}
                  {waiting.canBook ? (
                  <PmsButton size="sm" variant="secondary" asChild>
                    <Link href={`${DIARY_PATH}?book=${r.id}${r.siteId ? `&site=${r.siteId}` : site ? `&site=${site.id}` : ""}${freed && match ? `&date=${freed.date}` : ""}`}>Book</Link>
                  </PmsButton>
                  ) : null}
                  {waiting.canEdit ? (
                    <PmsButton size="sm" variant="ghost" loading={busy === `remove:${r.id}`} onClick={() => void remove(r)}>
                      Remove
                    </PmsButton>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface Hit {
  id: string;
  name: string;
  number: number;
  dateOfBirth: string | null;
}

function AddToWaitingList({ siteId, practitioners, services, onDone }: { siteId: string | null; practitioners: { id: string; name: string }[]; services: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [patient, setPatient] = React.useState<Hit | null>(null);
  const [serviceId, setServiceId] = React.useState("");
  const [practitionerId, setPractitionerId] = React.useState("");
  const [days, setDays] = React.useState<number[]>([]);
  const [time, setTime] = React.useState<TimeOfDay>("any");
  const [priority, setPriority] = React.useState<WaitingPriority>("routine");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (q.trim().length < 2 || patient) return setHits([]);
    let live = true;
    const t = window.setTimeout(() => void diaryApi.searchPatients<Hit[]>(q.trim()).then((r) => live && setHits(r.ok ? r.data : [])), 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, patient]);
  return (
    <form
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-[#F8FAFC] p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!patient) return setError("Choose the patient.");
        setBusy(true);
        const r = await addToWaitingListAction({ patientId: patient.id, serviceId: serviceId || null, practitionerId: practitionerId || null, siteId, preferredDays: days, preferredTime: time, priority });
        setBusy(false);
        if (!r.ok) return setError(r.error);
        toast.success(`${patient.name} added to the waiting list`);
        onDone();
        router.refresh();
      }}
    >
      <label htmlFor="wl-q" className="text-sm font-medium">
        Patient
      </label>
      <div className="flex h-9 items-center gap-2 rounded-[8px] border border-input-strong bg-white px-2.5">
        <Search className="h-4 w-4 text-[#64748B]" aria-hidden />
        <input
          id="wl-q"
          type="search"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPatient(null);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        />
      </div>
      {hits.length > 0 ? (
        <ul aria-label="Matching patients" className="flex flex-col rounded-[8px] border border-border bg-white">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[#F8FAFC]"
                onClick={() => {
                  setPatient(h);
                  setQ(h.name);
                  setHits([]);
                }}
              >
                <strong>{h.name}</strong> <span className="text-xs text-[#475569]">{h.dateOfBirth ? `DOB ${h.dateOfBirth}` : `No. ${h.number}`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Appointment type
          <SelectInput value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Any</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Practitioner
          <SelectInput value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
            <option value="">Any practitioner</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Time of day
          <SelectInput value={time} onChange={(e) => setTime(e.target.value as TimeOfDay)}>
            {TIMES_OF_DAY.map((t) => (
              <option key={t} value={t}>
                {TIME_OF_DAY_LABELS[t]}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Priority
          <SelectInput value={priority} onChange={(e) => setPriority(e.target.value as WaitingPriority)}>
            {WAITING_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-sm font-medium">Days (none ticked = any day)</legend>
        {WEEKDAY_NAMES.slice(0, 6).map((n, i) => (
          <Checkbox key={n} label={n.slice(0, 3)} checked={days.includes(i + 1)} onChange={(e) => setDays((d) => (e.target.checked ? [...d, i + 1] : d.filter((x) => x !== i + 1)))} />
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <PmsButton variant="secondary" type="button" onClick={onDone}>
          Cancel
        </PmsButton>
        <PmsButton type="submit" loading={busy}>
          Add to waiting list
        </PmsButton>
      </div>
    </form>
  );
}
