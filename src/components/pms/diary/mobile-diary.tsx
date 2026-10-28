"use client";
/**
 * The diary on a phone (design round 2, "Diary – 375 px"): "My diary" (or the chosen practitioner) at the site,
 * a strip of the week's days, the day as a list of cards – time and length, patient, type and room, status pill –
 * with the current time as a line and blocked time hatched. A card opens the same details drawer.
 */
import * as React from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import type { DiaryCard, DiaryColumn } from "@/modules/pms/diary/view";
import { formatHhmm, isoWeekday, weekDates, weekdayName } from "@/modules/pms/diary/time";
import { cn } from "@/lib/utils";
import { SelectInput } from "../ui/inputs";
import { StatusPill } from "../ui/status-pill";
import { cardSpan, weekdayDate } from "./grid-model";

export interface MobileDiaryProps {
  date: string;
  today: string;
  siteName: string | null;
  columns: DiaryColumn[];
  cards: DiaryCard[];
  /** The member's own column ("My diary"), when they are a practitioner here. */
  myColumnKey: string | null;
  dayHref: (date: string) => string;
  nowMinute: number | null;
  unsignedNotes: { count: number; href: string | null } | null;
  onOpen: (id: string) => void;
}

export function MobileDiary({ date, today, siteName, columns, cards, myColumnKey, dayHref, nowMinute, unsignedNotes, onOpen }: MobileDiaryProps) {
  const [chosen, setChosen] = React.useState<string | null>(myColumnKey ?? columns[0]?.key ?? null);
  React.useEffect(() => {
    if (!columns.some((c) => c.key === chosen)) setChosen(myColumnKey ?? columns[0]?.key ?? null);
  }, [columns, chosen, myColumnKey]);
  const column = columns.find((c) => c.key === chosen) ?? null;
  const mine = column ? cards.filter((c) => c.columnKey === column.key).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [];
  const appointments = mine.filter((c) => c.kind === "appointment" && c.status !== "cancelled");
  const days = weekDates(date).slice(0, 6);
  const isMine = Boolean(myColumnKey && chosen === myColumnKey);
  let nowShown = false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{isMine ? "My diary" : "Diary"}</h1>
          {siteName ? <p className="text-xs text-[#475569]">{siteName}</p> : null}
        </div>
        {columns.length > 1 ? (
          <div className="w-[170px]">
            <label htmlFor="m-who" className="sr-only">
              Whose diary
            </label>
            <SelectInput id="m-who" value={chosen ?? ""} onChange={(e) => setChosen(e.target.value)}>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key === myColumnKey ? `${c.label} (me)` : c.label}
                </option>
              ))}
            </SelectInput>
          </div>
        ) : null}
      </div>
      <nav aria-label="Days of the week" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {days.map((d) => {
          const current = d === date;
          return (
            <Link
              key={d}
              href={dayHref(d)}
              aria-current={current ? "date" : undefined}
              className={cn(
                "flex min-w-[52px] flex-1 flex-col items-center rounded-[10px] border py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                current ? "border-primary-strong bg-primary-strong text-white" : "border-border bg-white text-foreground",
              )}
            >
              <span className="font-medium">{weekdayName(isoWeekday(d)).slice(0, 3)}</span>
              <span className="text-base font-semibold leading-5">{Number(d.slice(8))}</span>
              {d === today && !current ? <span className="sr-only">(today)</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between text-xs text-[#475569]">
        <span>
          {weekdayDate(date)} · {appointments.length} {appointments.length === 1 ? "appointment" : "appointments"}
        </span>
        {unsignedNotes && unsignedNotes.count > 0 ? (
          unsignedNotes.href ? (
            <Link href={unsignedNotes.href} className="inline-flex items-center gap-1 font-semibold text-[#864E0E]">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {unsignedNotes.count} unsigned {unsignedNotes.count === 1 ? "note" : "notes"}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-[#864E0E]">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {unsignedNotes.count} unsigned {unsignedNotes.count === 1 ? "note" : "notes"}
            </span>
          )
        ) : null}
      </div>
      {mine.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[#475569]">Nothing booked on this day.</p> : null}
      <ul className="flex flex-col gap-2">
        {mine.map((c) => {
          const span = cardSpan(c, date);
          const items: React.ReactNode[] = [];
          if (!nowShown && nowMinute !== null && date === today && span.start > nowMinute) {
            nowShown = true;
            items.push(
              <li key="now" aria-hidden className="flex items-center gap-2 text-xs font-semibold text-primary-strong">
                Now {formatHhmm(nowMinute)}
                <span className="h-0.5 flex-1 bg-primary-strong" />
              </li>,
            );
          }
          if (c.kind === "block") {
            items.push(
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-[#CBD5E1] bg-[repeating-linear-gradient(135deg,#F8FAFC_0_6px,#EEF2F6_6px_12px)] px-3 py-2.5 text-left text-[#334155]"
                >
                  <span className="w-11 font-semibold tabular-nums">{formatHhmm(span.start)}</span>
                  <span>
                    {c.title || "Blocked"} until {formatHhmm(span.end % 1440)}
                  </span>
                </button>
              </li>,
            );
          } else {
            const tone = c.status === "arrived" ? "border-[#FBD38D] bg-[#FFFBEB]" : c.status === "in_treatment" ? "border-[#99E2D8] bg-[#F0FDFA]" : "border-border bg-white";
            items.push(
              <li key={c.id}>
                <button type="button" onClick={() => onOpen(c.id)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left", tone)}>
                  <span className="flex w-11 shrink-0 flex-col">
                    <span className="font-semibold tabular-nums text-foreground">{formatHhmm(span.start)}</span>
                    <span className="text-xs text-[#475569]">{span.end - span.start} min</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate font-semibold text-foreground", (c.status === "cancelled" || c.status === "late_cancelled") && "line-through")}>{c.patientName ?? "Appointment"}</span>
                    <span className="truncate text-xs text-[#475569]">{[c.serviceName, c.roomName].filter(Boolean).join(" · ")}</span>
                  </span>
                  <StatusPill kind="appointment" status={c.status} size="sm" label={c.status === "dna" ? "DNA" : c.status === "late_cancelled" ? "Late cancel" : undefined} />
                </button>
              </li>,
            );
          }
          return items;
        })}
      </ul>
    </div>
  );
}
