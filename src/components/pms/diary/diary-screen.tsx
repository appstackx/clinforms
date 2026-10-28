"use client";
/**
 * The diary (design round 2): day view with practitioner or room columns, week view of one practitioner or room,
 * the phone list below 768 px. The address carries the site and the date (K2-SITE-002); the shell's site switcher
 * changes the site and keeps the date. Toolbar: previous / Today / next, Day | Week, Practitioners | Rooms, Show
 * cancelled, Waiting list (n), print the day sheet, New appointment (N). Keyboard: Tab to an appointment, Enter
 * opens it, M moves it with the arrow keys (Enter drops, Esc cancels) with a live hint, Shift+↑/↓ shortens or
 * lengthens it; T today, [ and ] previous / next. Every change offers Undo in a toast.
 *
 * Double-booking (Khuram's decision A, 28/10/2026): a member holding "diary.override" may drop an appointment over
 * the practitioner's other appointment with Shift+Enter (keyboard move) or "Move anyway" on the refusal (drag and
 * drop); the server logs it and both appointments show the clash marker. Rooms and blocked time never.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Hourglass, Move, Plus, Printer } from "lucide-react";
import { moveAppointmentAction, resizeAppointmentAction, setAppointmentStatusAction } from "@/app/app/clinic/diary/actions";
import { formatHhmm, londonParts } from "@/modules/pms/diary/time";
import type { AppointmentStatus } from "@/modules/pms/diary/rules";
import { diaryHref, stepDate, type AppointmentDetailsView, type DiaryCard, type DiaryParams, type DiaryViewData } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { PmsButton } from "../ui/button";
import { Kbd, ShortcutsSheet } from "../ui/keyboard-hint";
import { SelectInput, Switch } from "../ui/inputs";
import { DIARY_SHORTCUTS, isPlainKey, isTypingTarget } from "../ui/shortcuts";
import { useToast } from "../ui/toast";
import { SITE_COOKIE, SITE_COOKIE_MAX_AGE } from "../shell/site-cookie";
import { DIARY_PATH } from "./api";
import { AppointmentDrawer } from "./appointment-drawer";
import { BookingDialog, type BookingPreset } from "./booking-dialog";
import { DiaryGrid, ResourceHeader, type GridPreview } from "./diary-grid";
import { bookedText, cardSpan, clampLength, clampStart, clashInColumn, longDate, patientClash, weekRange } from "./grid-model";
import { MobileDiary } from "./mobile-diary";

export interface DiaryScreenProps {
  data: DiaryViewData;
  /** The shell's site cookie as the server read it (the switcher writes it). */
  cookieSite: string | null;
  can: {
    book: boolean;
    /** diary.rota: rotas and the waiting list. */
    rota: boolean;
    /** diary.override: "Book anyway (double-booking is logged)". */
    override: boolean;
    patientsEdit: boolean;
    /** clinical.write: Start treatment also opens the note. */
    clinical: boolean;
    /** billing.pay: the drawer's "Take payment". */
    pay?: boolean;
  };
  payers: { id: string; name: string; kind: string }[];
  unsignedNotes: { count: number; href: string | null } | null;
}

interface Moving {
  card: DiaryCard;
  columnIndex: number;
  start: number;
  length: number;
}

export function DiaryScreen({ data, cookieSite, can, payers, unsignedNotes }: DiaryScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const p = data.params;
  const href = React.useCallback((patch: Partial<DiaryParams>) => diaryHref(DIARY_PATH, { ...p, focusId: null, bookFromWaitingId: null, ...patch }), [p]);
  const [selectedId, setSelectedId] = React.useState<string | null>(p.focusId);
  const [drawerVersion, setDrawerVersion] = React.useState(0);
  const [moving, setMoving] = React.useState<Moving | null>(null);
  const [moveMessage, setMoveMessage] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState<BookingPreset | null>(null);
  const [shortcuts, setShortcuts] = React.useState(false);
  const [nowMinute, setNowMinute] = React.useState<number | null>(null);
  const [isToday, setIsToday] = React.useState<string>(data.today);
  const blocks = React.useRef(new Map<string, HTMLButtonElement>());

  // The current time (client only – the server's render has none, so hydration matches).
  React.useEffect(() => {
    const tick = () => {
      const parts = londonParts(Date.now());
      setNowMinute(parts.minute);
      setIsToday(parts.date);
    };
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Site: the address wins when the page loads (the shell's switcher is set to match); a change in the switcher
  // afterwards (its cookie changes) moves the diary to that site, keeping the date. Idempotent (React runs effects
  // twice in development): it acts only when the cookie value it is given changes, and ignores its own write.
  const prevCookie = React.useRef<string | null | undefined>(undefined);
  const wroteCookie = React.useRef<string | null>(null);
  React.useEffect(() => {
    const site = data.site?.id ?? null;
    if (!site) return;
    if (prevCookie.current === undefined) {
      prevCookie.current = cookieSite;
      if (cookieSite !== site) {
        document.cookie = `${SITE_COOKIE}=${encodeURIComponent(site)}; path=/app/clinic; max-age=${SITE_COOKIE_MAX_AGE}; samesite=lax`;
        wroteCookie.current = site;
        router.refresh();
      }
      return;
    }
    if (cookieSite === prevCookie.current) return;
    prevCookie.current = cookieSite;
    if (cookieSite === wroteCookie.current) return;
    if (cookieSite && cookieSite !== site && data.sites.some((s) => s.id === cookieSite)) router.replace(href({ siteId: cookieSite, resourceId: null }));
  }, [cookieSite, data.site, data.sites, href, router]);

  // Booking from the waiting list (?book=<entry>) or for a patient from their record (?patient=<id>) – once per
  // preset (a refresh after booking must not open the form again).
  const presetUsed = React.useRef<string | null>(null);
  React.useEffect(() => {
    const preset = data.bookingPreset;
    if (!preset || !can.book) return;
    const key = `${preset.waitingListId ?? ""}:${preset.patientId}`;
    if (presetUsed.current === key) return;
    presetUsed.current = key;
    setBooking({
      date: p.date < data.today ? data.today : p.date,
      time: "09:00",
      practitionerId: preset.practitionerId,
      roomId: null,
      patient: { id: preset.patientId, name: preset.patientName },
      serviceId: preset.serviceId,
      caseId: preset.caseId,
      waitingListId: preset.waitingListId,
    });
  }, [data.bookingPreset, can.book, p.date, data.today]);

  const refresh = React.useCallback(() => {
    router.refresh();
    setDrawerVersion((v) => v + 1);
  }, [router]);

  const columns = data.columns;
  const grid = data.hours;
  const cardsShown = data.cards;
  const siteRooms = data.rooms.filter((r) => r.siteId === data.site?.id);
  const columnName = (i: number) => {
    const c = columns[i];
    if (!c) return "";
    return p.view === "week" ? longDate(c.date) : c.detail ? `${c.label} (${c.detail})` : c.label;
  };

  const placement = (columnIndex: number, start: number) => {
    const c = columns[columnIndex];
    const base: { date: string; startTime: string; practitionerId?: string | null; roomId?: string | null } = { date: c.date, startTime: formatHhmm(start) };
    if (p.view === "day" && p.by === "practitioner") base.practitionerId = c.practitionerId;
    if (p.view === "day" && p.by === "room") base.roomId = c.roomId;
    return base;
  };

  const undoToast = (message: string, undo: () => Promise<void>) => toast.success(message, { action: { label: "Undo", onClick: () => void undo() } });

  const saveMove = async (card: DiaryCard, columnIndex: number, start: number, override = false) => {
    const from = columns.findIndex((c) => c.key === card.columnKey);
    const span = cardSpan(card, columns[from]?.date ?? columns[columnIndex].date);
    const r = await moveAppointmentAction({ id: card.id, expectedRev: card.rev, ...placement(columnIndex, start), ...(override ? { override: true } : {}) });
    if (!r.ok) {
      const text = [r.error, ...(r.clashes ?? [])].join(" ");
      // A clash this member may book over (the practitioner's other appointment): offer it, logged.
      if (r.overridable && can.override && !override) toast.error(text, { action: { label: "Move anyway", onClick: () => void saveMove(card, columnIndex, start, true) } });
      else toast.error(text);
      if (r.conflict) refresh();
      return;
    }
    refresh();
    undoToast(`${card.patientName ?? "Appointment"} moved to ${formatHhmm(start)}${p.view === "day" ? ` with ${columns[columnIndex].label}` : ` on ${longDate(columns[columnIndex].date)}`}${r.warnings.length ? `. ${r.warnings.join(" ")}` : ""}`, async () => {
      const back = await moveAppointmentAction({ id: card.id, expectedRev: r.rev ?? card.rev + 1, ...placement(from, span.start) });
      if (!back.ok) toast.error(back.error);
      refresh();
    });
  };

  const saveResize = async (card: DiaryCard, length: number) => {
    const span = cardSpan(card, card.startsOn);
    const r = await resizeAppointmentAction({ id: card.id, expectedRev: card.rev, durationMinutes: length });
    if (!r.ok) {
      toast.error([r.error, ...(r.clashes ?? [])].join(" "));
      if (r.conflict) refresh();
      return;
    }
    refresh();
    undoToast(`${card.patientName ?? "Appointment"} now ${length} min`, async () => {
      const back = await resizeAppointmentAction({ id: card.id, expectedRev: r.rev ?? card.rev + 1, durationMinutes: span.end - span.start });
      if (!back.ok) toast.error(back.error);
      refresh();
    });
  };

  const clashWith = (card: DiaryCard, columnIndex: number, start: number, length: number) =>
    clashInColumn(data.cards, columns[columnIndex], card.id, start, start + length) ?? patientClash(data.cards, card, columns[columnIndex].date, start, start + length);
  /**
   * Whether this member may drop over `clash` (Shift+Enter): an appointment of the same practitioner – a practitioner
   * column or a practitioner's week – never a room column, never blocked time, never the patient's own other one
   * (that needs the booking dialog).
   */
  const overridableClash = (card: DiaryCard, clash: DiaryCard, columnIndex: number) =>
    can.override && card.kind === "appointment" && clash.kind === "appointment" && clash.patientId !== card.patientId && Boolean(columns[columnIndex]?.practitionerId ?? (p.view === "week" && p.by === "practitioner"));
  const clashAt = (cardId: string, columnIndex: number, start: number, length: number) => {
    const card = data.cards.find((c) => c.id === cardId);
    return card ? clashWith(card, columnIndex, start, length) !== null : false;
  };

  const startMove = (id: string) => {
    const card = data.cards.find((c) => c.id === id);
    if (!card || !can.book || card.kind !== "appointment" || !(card.status === "booked" || card.status === "arrived")) return;
    const columnIndex = columns.findIndex((c) => c.key === card.columnKey);
    if (columnIndex < 0) return;
    const span = cardSpan(card, columns[columnIndex].date);
    setSelectedId(null);
    setMoveMessage(null);
    setMoving({ card, columnIndex, start: span.start, length: span.end - span.start });
    window.setTimeout(() => blocks.current.get(id)?.focus(), 0);
  };

  const onBlockKey = (e: React.KeyboardEvent<HTMLButtonElement>, card: DiaryCard, columnIndex: number) => {
    if (moving && moving.card.id === card.id) {
      const m = { ...moving };
      if (e.key === "ArrowUp") m.start = clampStart(m.start - 15, m.length, grid);
      else if (e.key === "ArrowDown") m.start = clampStart(m.start + 15, m.length, grid);
      else if (e.key === "ArrowLeft") m.columnIndex = Math.max(0, m.columnIndex - 1);
      else if (e.key === "ArrowRight") m.columnIndex = Math.min(columns.length - 1, m.columnIndex + 1);
      else if (e.key === "Escape") {
        e.preventDefault();
        setMoving(null);
        setMoveMessage("Move cancelled.");
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        const clash = clashWith(card, m.columnIndex, m.start, m.length);
        // Shift+Enter: drop over the practitioner's other appointment anyway (diary.override, logged).
        const anyway = e.shiftKey && clash !== null && overridableClash(card, clash, m.columnIndex);
        if (clash && !anyway) {
          setMoveMessage("blocked");
          return;
        }
        setMoving(null);
        const span = cardSpan(card, columns[columnIndex].date);
        if (m.start !== span.start || m.columnIndex !== columnIndex) void saveMove(card, m.columnIndex, m.start, anyway);
        return;
      } else return;
      e.preventDefault();
      setMoveMessage(null);
      setMoving(m);
      return;
    }
    if (moving || !can.book || card.kind !== "appointment") return;
    if (isPlainKey(e, "m") || isPlainKey(e, "M")) {
      e.preventDefault();
      startMove(card.id);
    } else if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && (card.status === "booked" || card.status === "arrived")) {
      e.preventDefault();
      const span = cardSpan(card, columns[columnIndex].date);
      const length = clampLength(span.end - span.start + (e.key === "ArrowDown" ? 15 : -15), span.start, grid);
      if (length !== span.end - span.start) void saveResize(card, length);
    }
  };

  // Page shortcuts: N new appointment, T today, [ ] previous / next, ? the sheet (the shell has "/" and "?").
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target as HTMLElement | null) || booking || moving) return;
      if ((isPlainKey(e, "n") || isPlainKey(e, "N")) && can.book && data.site) {
        e.preventDefault();
        openNew();
      } else if (isPlainKey(e, "t") || isPlainKey(e, "T")) {
        e.preventDefault();
        router.push(href({ date: data.today }));
      } else if (isPlainKey(e, "[")) {
        e.preventDefault();
        router.push(href({ date: stepDate(p, -1) }));
      } else if (isPlainKey(e, "]")) {
        e.preventDefault();
        router.push(href({ date: stepDate(p, 1) }));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const firstPractitioner = columns.find((c) => c.practitionerId)?.practitionerId ?? data.practitioners[0]?.id ?? null;
  const openNew = (preset?: Partial<BookingPreset>) => {
    const date = p.view === "week" ? (columns.find((c) => c.date >= data.today)?.date ?? columns[0]?.date ?? p.date) : p.date;
    const minute = nowMinute !== null && date === isToday ? Math.ceil((nowMinute + 1) / 15) * 15 : 9 * 60;
    setBooking({ date, time: formatHhmm(Math.min(minute, 20 * 60)), practitionerId: p.by === "practitioner" && p.view === "week" ? p.resourceId : firstPractitioner, roomId: null, ...preset });
  };

  const onSlot = (columnIndex: number, minute: number) => {
    const c = columns[columnIndex];
    const rotaRoom = c.practitionerId ? (data.rooms.find((r) => r.name === c.detail && r.siteId === data.site?.id)?.id ?? null) : null;
    openNew({
      date: c.date,
      time: formatHhmm(minute),
      practitionerId: c.practitionerId ?? (p.view === "week" && p.by === "practitioner" ? p.resourceId : firstPractitioner),
      roomId: c.roomId ?? rotaRoom,
    });
  };

  const onRebook = (d: AppointmentDetailsView) => {
    setSelectedId(null);
    setBooking({
      date: d.startsOn < data.today ? data.today : d.startsOn,
      time: d.startTime,
      practitionerId: d.practitionerId,
      roomId: d.roomId,
      patient: d.patient ? { id: d.patient.id, name: d.patient.name } : null,
      serviceId: d.serviceId,
      caseId: d.caseId,
      rebookOf: d.id,
    });
  };

  const closeDrawer = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id) window.setTimeout(() => blocks.current.get(id)?.focus(), 0);
  };

  const preview: GridPreview | null = moving ? { id: moving.card.id, columnIndex: moving.columnIndex, start: moving.start, length: moving.length, clash: clashAt(moving.card.id, moving.columnIndex, moving.start, moving.length) } : null;
  const movingClash = moving ? clashWith(moving.card, moving.columnIndex, moving.start, moving.length) : null;

  const segment = (on: boolean) =>
    cn("inline-flex h-[30px] items-center rounded-[8px] px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", on ? "bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-[#475569] hover:text-foreground");

  const heading = p.view === "week" && data.dates.length > 0 ? weekRange(data.dates[0], data.dates[data.dates.length - 1]) : longDate(p.date);
  const resources = p.by === "practitioner" ? data.practitioners.map((x) => ({ id: x.id, name: x.name })) : siteRooms.map((r) => ({ id: r.id, name: r.name }));

  return (
    <div className="flex flex-col gap-3" data-diary-ready={nowMinute !== null ? "true" : undefined}>
      {/* Phone (< 768 px): the list. */}
      <div className="md:hidden">
        <MobileDiary
          date={p.date}
          today={isToday}
          siteName={data.site?.name ?? null}
          columns={p.view === "day" && p.by === "practitioner" ? columns : []}
          cards={data.cards}
          myColumnKey={data.myPractitionerId && columns.some((c) => c.key === `p:${data.myPractitionerId}`) ? `p:${data.myPractitionerId}` : null}
          dayHref={(date) => href({ date, view: "day", by: "practitioner" })}
          nowMinute={nowMinute}
          unsignedNotes={unsignedNotes}
          onOpen={setSelectedId}
        />
        {p.view !== "day" || p.by !== "practitioner" ? (
          <p className="mt-2 text-sm">
            <Link className="text-primary-strong underline" href={href({ view: "day", by: "practitioner" })}>
              Show the day by practitioner
            </Link>
          </p>
        ) : null}
        {can.book && data.site ? (
          <PmsButton size="lg" className="mt-3 w-full" onClick={() => openNew()}>
            <Plus aria-hidden />
            New appointment
          </PmsButton>
        ) : null}
      </div>

      {/* Laptop and up: the grid. */}
      <div className="hidden flex-col gap-3 md:flex">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <Link aria-label={p.view === "week" ? "Previous week" : "Previous day"} href={href({ date: stepDate(p, -1) })} className={cn("inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-white hover:bg-[#F8FAFC]", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary")}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
            <PmsButton asChild variant="secondary">
              <Link href={href({ date: data.today })}>{p.view === "week" ? "This week" : "Today"}</Link>
            </PmsButton>
            <Link aria-label={p.view === "week" ? "Next week" : "Next day"} href={href({ date: stepDate(p, 1) })} className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-white hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{heading}</h1>
          <div role="group" aria-label="View" className="flex gap-0.5 rounded-[10px] bg-[#F1F5F9] p-[3px]">
            <Link href={href({ view: "day" })} aria-current={p.view === "day" ? "page" : undefined} className={segment(p.view === "day")}>
              Day
            </Link>
            <Link href={href({ view: "week" })} aria-current={p.view === "week" ? "page" : undefined} className={segment(p.view === "week")}>
              Week
            </Link>
          </div>
          {p.view === "day" ? (
            <div role="group" aria-label="Columns" className="flex gap-0.5 rounded-[10px] bg-[#F1F5F9] p-[3px]">
              <Link href={href({ by: "practitioner", resourceId: null })} aria-current={p.by === "practitioner" ? "true" : undefined} className={segment(p.by === "practitioner")}>
                Practitioners
              </Link>
              <Link href={href({ by: "room", resourceId: null })} aria-current={p.by === "room" ? "true" : undefined} className={segment(p.by === "room")}>
                Rooms
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <SelectInput aria-label="Whose week" value={`${p.by}:${p.resourceId ?? ""}`} onChange={(e) => {
                const [by, id] = e.target.value.split(":");
                router.push(href({ by: by as DiaryParams["by"], resourceId: id || null }));
              }} className="w-[240px]">
                <optgroup label="Practitioners">
                  {data.practitioners.map((x) => (
                    <option key={x.id} value={`practitioner:${x.id}`}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Rooms">
                  {siteRooms.map((r) => (
                    <option key={r.id} value={`room:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              </SelectInput>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Switch checked={p.showCancelled} onCheckedChange={(on) => router.push(href({ showCancelled: on }))} label="Show cancelled" />
            <PmsButton asChild variant="secondary">
              <Link href={`${DIARY_PATH}/waiting-list${data.site ? `?site=${data.site.id}` : ""}`}>
                <Hourglass aria-hidden />
                Waiting list
                <span className="rounded-full bg-[#E8EEFB] px-1.5 text-xs font-semibold text-[#1842B4]">{data.waitingCount}</span>
              </Link>
            </PmsButton>
            {data.site ? (
              <PmsButton asChild variant="secondary" size="icon">
                <Link href={`${DIARY_PATH}/day-sheet?site=${data.site.id}&date=${p.view === "week" ? (columns.find((c) => c.date === data.today)?.date ?? p.date) : p.date}${p.view === "week" && p.by === "practitioner" && p.resourceId ? `&practitioner=${p.resourceId}` : ""}`} aria-label="Print day sheet">
                  <Printer aria-hidden />
                </Link>
              </PmsButton>
            ) : null}
            {can.book && data.site ? (
              <PmsButton onClick={() => openNew()}>
                <Plus aria-hidden />
                New appointment
                <Kbd className="border-white/40 bg-transparent text-white">N</Kbd>
              </PmsButton>
            ) : null}
          </div>
        </div>
        {p.view === "week" && data.summary ? (
          <p className="text-right text-sm text-[#334155]">
            This week: <strong>{data.summary.appointments} appointments</strong>
            {data.summary.bookedPercent !== null ? ` · ${data.summary.bookedPercent}% booked` : ""} · {data.summary.dna} DNA
          </p>
        ) : null}

        <div aria-live="polite" className="min-h-[28px]">
          {moving ? (
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border px-3 py-1.5 text-sm", movingClash ? "border-[#FECACA] bg-[#FEF2F2] text-destructive-strong" : "border-[#99E2D8] bg-[#F0FDFA] text-[#0B5F58]")}>
              {movingClash ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Move className="h-4 w-4" aria-hidden />}
              <span className="font-semibold">
                Moving {moving.card.patientName ?? "appointment"} → {formatHhmm(moving.start)}–{formatHhmm(moving.start + moving.length)}, {columnName(moving.columnIndex)}
              </span>
              <span>
                {movingClash
                  ? `${moveMessage === "blocked" ? "Can't drop here – " : ""}${movingClash.patientId && movingClash.patientId === moving.card.patientId ? `the patient already has ${movingClash.practitionerName ?? "another appointment"}` : `clashes with ${movingClash.kind === "block" ? (movingClash.title ?? "blocked time") : (movingClash.patientName ?? "another appointment")}`} ${movingClash.timeLabel}`
                  : "Slot is free"}
              </span>
              {movingClash && overridableClash(moving.card, movingClash, moving.columnIndex) ? (
                <span className="text-xs">
                  <Kbd>Shift+Enter</Kbd> book anyway (double-booking is logged)
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1 text-xs text-[#475569]">
                <Kbd>↑↓</Kbd> 15 min <Kbd>←→</Kbd> {p.view === "week" ? "day" : "column"} <Kbd>Enter</Kbd> drop <Kbd>Esc</Kbd> cancel
              </span>
            </div>
          ) : (
            <p className="text-xs text-[#475569]">
              Tab to an appointment · <Kbd>Enter</Kbd> details{can.book ? <> · <Kbd>M</Kbd> move · <Kbd>Shift+↑↓</Kbd> shorten / lengthen · or drag a block, or its bottom edge</> : null}
              {moveMessage && moveMessage !== "blocked" ? ` · ${moveMessage}` : ""}
              <button type="button" className="ml-2 underline" onClick={() => setShortcuts(true)}>
                All shortcuts
              </button>
            </p>
          )}
        </div>

        {!data.site ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[#475569]">The clinic has no sites yet. Add a site in the clinic&apos;s set-up first.</p>
        ) : columns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[#475569]">{p.by === "room" ? "This site has no rooms yet." : "No practitioners work at this site yet. Add them in the clinic's set-up first."}</p>
        ) : (
          <DiaryGrid
            label={p.view === "week" ? `Appointments, week of ${heading}, ${resources.find((r) => r.id === p.resourceId)?.name ?? ""}` : `Appointments, ${heading}`}
            view={p.view}
            columns={columns}
            cards={cardsShown}
            grid={grid}
            today={isToday}
            nowMinute={nowMinute}
            selectedId={selectedId}
            preview={preview}
            canBook={can.book}
            compact={p.view === "week"}
            header={(c) =>
              p.view === "week" ? (
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("font-semibold", c.date === isToday ? "text-primary-strong" : "text-foreground")}>
                    {c.label.split(" ")[0]} <span className="font-normal text-[#475569]">{c.date.slice(8)}/{c.date.slice(5, 7)}</span>
                  </span>
                  <span className="text-xs text-[#475569]">{data.cards.filter((x) => x.columnKey === c.key && x.kind === "appointment" && x.status !== "cancelled").length} appts</span>
                </div>
              ) : (
                <ResourceHeader name={c.label} detail={c.detail} booked={bookedText(c.bookedPercent)} />
              )
            }
            onOpen={(id) => {
              if (moving) return;
              setSelectedId(id);
            }}
            onBlockKey={onBlockKey}
            onSlot={onSlot}
            onDrop={(card, change) => (change.resize ? void saveResize(card, change.length) : void saveMove(card, change.columnIndex, change.start))}
            clashAt={clashAt}
            blockRef={(id, el) => {
              if (el) blocks.current.set(id, el);
              else blocks.current.delete(id);
            }}
          />
        )}
        {p.view === "week" ? <p className="text-xs text-[#475569]">&quot;+&quot; marks an initial assessment. Hatched areas are outside the rota or blocked. Click an empty slot to book it.</p> : null}
        {data.truncated ? <p className="text-xs text-[#9A3412]">Only the first 500 items are shown.</p> : null}
      </div>

      <AppointmentDrawer
        id={selectedId}
        version={drawerVersion}
        can={{ book: can.book, clinical: can.clinical, pay: can.pay }}
        onClose={closeDrawer}
        onError={(m) => toast.error(m)}
        onChanged={(message, undo) => {
          refresh();
          if (undo) {
            undoToast(message, async () => {
              const r = await setAppointmentStatusAction({ id: undo.id, expectedRev: undo.rev, status: undo.status as AppointmentStatus });
              if (!r.ok) toast.error(r.error);
              refresh();
            });
          } else toast.success(message);
        }}
        onMove={(id) => startMove(id)}
        onRebook={onRebook}
      />

      {booking && data.site ? (
        <BookingDialog
          open={booking !== null}
          onOpenChange={(o) => {
            if (!o) {
              setBooking(null);
              if (data.bookingPreset) router.replace(href({}));
            }
          }}
          site={{ id: data.site.id, name: data.site.name }}
          practitioners={data.practitioners.map((x) => ({ id: x.id, name: x.name }))}
          rooms={siteRooms.map((r) => ({ id: r.id, name: r.name }))}
          services={data.services}
          payers={payers}
          preset={booking}
          can={{ createPatient: can.patientsEdit, override: can.override }}
          onBooked={() => refresh()}
        />
      ) : null}
      <ShortcutsSheet open={shortcuts} onOpenChange={setShortcuts} groups={[{ title: "Diary", shortcuts: [...DIARY_SHORTCUTS, { label: "Shorten / lengthen selected appointment", keys: ["Shift", "↑", "↓"] }] }]} />
    </div>
  );
}
