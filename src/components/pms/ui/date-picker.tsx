"use client";
import * as React from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { PmsPopover } from "./popover";
import { SelectInput } from "./inputs";
import {
  addMonths,
  clampDate,
  formatUkDate,
  inRange,
  longUkDate,
  MONTH_NAMES,
  monthGrid,
  monthOf,
  moveFocus,
  parseUkDate,
  timeSlots,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
} from "./date-model";

export interface DatePickerProps {
  /** The input's id (pair with FormField for the label, hint and error). */
  id: string;
  /** ISO date (YYYY-MM-DD) or "" for none. */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest and latest dates that may be picked (ISO). */
  min?: string;
  max?: string;
  /** Today (ISO) – passed in so the clinic's own calendar day is used, not the browser's. */
  today: string;
  disabled?: boolean;
  /** Spread by FormField (aria-describedby, aria-invalid). */
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  className?: string;
}

/**
 * Date picker (brief Part A): a DD/MM/YYYY text box – typing works, and is the fastest way for reception – plus a
 * calendar button that opens a month grid in a popover. Keyboard (WAI-ARIA date picker dialog): arrows move a day or a
 * week, Home/End the start/end of the week, PageUp/PageDown a month (Shift: a year), Enter or Space picks, Esc closes
 * and returns to the button. "Today" jumps to today. Days outside min/max are disabled. Weeks start on Monday.
 */
export function DatePicker({ id, value, onChange, min, max, today, disabled, className, ...aria }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(formatUkDate(value));
  const [focusDay, setFocusDay] = React.useState(() => clampDate(value || today, min, max));
  const gridRef = React.useRef<HTMLTableElement>(null);
  const moved = React.useRef(false);
  const labelId = `${id}-month`;

  React.useEffect(() => setText(formatUkDate(value)), [value]);

  const openWith = (next: boolean) => {
    if (next) setFocusDay(clampDate(value || today, min, max));
    setOpen(next);
  };

  // Keep DOM focus on the focused day after a keyboard move (also across months).
  React.useEffect(() => {
    if (!open || !moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-iso="${focusDay}"]`)?.focus();
  }, [focusDay, open]);

  const pick = (iso: string) => {
    if (!inRange(iso, min, max)) return;
    onChange(iso);
    setOpen(false);
    document.getElementById(`${id}-button`)?.focus();
  };

  const { year, month } = monthOf(focusDay);
  const weeks = monthGrid(year, month);

  const onGridKey = (e: React.KeyboardEvent) => {
    const next = moveFocus(focusDay, e.key, e.shiftKey);
    if (next) {
      e.preventDefault();
      moved.current = true;
      setFocusDay(clampDate(next, min, max));
    }
  };

  const shiftMonth = (n: number) => setFocusDay(clampDate(addMonths(focusDay, n), min, max));
  const prevDisabled = Boolean(min && addMonths(focusDay, -1).slice(0, 7) < min.slice(0, 7));
  const nextDisabled = Boolean(max && addMonths(focusDay, 1).slice(0, 7) > max.slice(0, 7));
  const todayDisabled = !inRange(today, min, max);
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-foreground hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:text-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-sm:h-11 max-sm:w-11";

  return (
    <div
      className={cn(
        "flex h-9 min-w-0 items-center gap-1 rounded-[8px] border border-input-strong bg-white pl-3 pr-1 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary has-[[aria-invalid=true]]:border-destructive-strong max-sm:h-11 max-sm:pr-0",
        disabled && "bg-[#F8FAFC]",
        className,
      )}
    >
      <input
        id={id}
        {...aria}
        value={text}
        disabled={disabled}
        placeholder="DD/MM/YYYY"
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) return onChange("");
          const iso = parseUkDate(text);
          if (iso && inRange(iso, min, max)) onChange(iso);
          else setText(formatUkDate(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const iso = parseUkDate(text);
            if (iso && inRange(iso, min, max)) onChange(iso);
          }
        }}
        className="h-full w-full min-w-0 flex-1 bg-transparent text-sm tabular-nums text-foreground placeholder:text-[#64748B] focus:outline-none disabled:text-[#64748B]"
      />
      <PmsPopover
        open={open}
        onOpenChange={openWith}
        label="Choose a date"
        align="end"
        initialFocus={`button[data-iso="${focusDay}"]`}
        trigger={(t) => (
          <button
            {...t}
            id={`${id}-button`}
            type="button"
            disabled={disabled}
            aria-label={value ? `Choose a date, selected ${longUkDate(value)}` : "Choose a date"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[#475569] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed max-sm:-my-px max-sm:h-11 max-sm:w-11"
          >
            <Calendar className="h-4 w-4" aria-hidden />
          </button>
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={navBtn} onClick={() => shiftMonth(-1)} disabled={prevDisabled} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <h3 id={labelId} className="text-sm font-semibold" aria-live="polite">
              {MONTH_NAMES[month - 1]} {year}
            </h3>
            <button type="button" className={navBtn} onClick={() => shiftMonth(1)} disabled={nextDisabled} aria-label="Next month">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <table ref={gridRef} role="grid" aria-labelledby={labelId} className="border-collapse" onKeyDown={onGridKey}>
            <thead>
              <tr>
                {WEEKDAY_SHORT.map((d, i) => (
                  <th key={d} scope="col" abbr={WEEKDAY_LONG[i]} className="h-7 text-center text-xs font-medium text-[#475569]">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0].iso}>
                  {week.map((d) => {
                    const selected = d.iso === value;
                    const allowed = inRange(d.iso, min, max);
                    const isToday = d.iso === today;
                    return (
                      <td key={d.iso} aria-selected={selected} className="p-0.5 text-center max-sm:p-0">
                        <button
                          type="button"
                          data-iso={d.iso}
                          tabIndex={d.iso === focusDay ? 0 : -1}
                          aria-current={isToday ? "date" : undefined}
                          aria-label={longUkDate(d.iso)}
                          disabled={!allowed}
                          onClick={() => pick(d.iso)}
                          className={cn(
                            "inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary max-sm:h-11 max-sm:w-11",
                            selected ? "bg-primary-strong font-semibold text-white" : d.inMonth ? "text-foreground hover:bg-[#F1F5F9]" : "text-[#64748B] hover:bg-[#F1F5F9]",
                            isToday && !selected && "font-semibold ring-1 ring-inset ring-primary",
                            !allowed && "cursor-not-allowed text-[#94A3B8] line-through hover:bg-transparent",
                          )}
                        >
                          {Number(d.iso.slice(8))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <button
              type="button"
              disabled={todayDisabled}
              onClick={() => pick(today)}
              className="inline-flex h-8 items-center rounded-[8px] px-2.5 text-sm font-medium text-primary-strong hover:bg-[#F0FDFA] disabled:cursor-not-allowed disabled:text-[#64748B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-sm:h-11"
            >
              Today
            </button>
            {min || max ? (
              <span className="text-xs text-[#475569]">
                {min && max ? `${formatUkDate(min)} – ${formatUkDate(max)}` : min ? `From ${formatUkDate(min)}` : `Until ${formatUkDate(max as string)}`}
              </span>
            ) : null}
          </div>
        </div>
      </PmsPopover>
    </div>
  );
}

export interface TimePickerProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  id: string;
  /** "HH:MM" (24-hour) or "" for none. */
  value: string;
  onChange: (time: string) => void;
  /** Minutes between options. Default 15 (the diary's grid); 5 for exact times. */
  step?: 5 | 10 | 15 | 30 | 60;
  /** First and last time offered ("08:00", "20:00"). */
  from?: string;
  to?: string;
  /** Offer an empty "Choose a time" option. */
  placeholder?: string;
}

/**
 * Time picker (brief Part A): 24-hour times in 5- or 15-minute steps, as a native select – it is keyboard- and
 * screen-reader-friendly everywhere, typing "14" jumps to 14:00, and phones show their own wheel. A value that is not
 * on the step (an imported 09:07) is still shown as its own option, never silently changed.
 */
export function TimePicker({ id, value, onChange, step = 15, from = "07:00", to = "21:00", placeholder, className, ...rest }: TimePickerProps) {
  const options = React.useMemo(() => {
    const list = timeSlots(step, from, to);
    if (value && !list.includes(value)) return [...list, value].sort();
    return list;
  }, [step, from, to, value]);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Clock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" aria-hidden />
      <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value)} className="pl-8 tabular-nums max-sm:h-11" {...rest}>
        {placeholder !== undefined || !value ? <option value="">{placeholder ?? "Choose a time"}</option> : null}
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
