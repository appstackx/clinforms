"use client";
import * as React from "react";
import { AlertTriangle, CalendarClock, Phone, Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PmsAvatar } from "./pms-avatar";
import { InlineKbd } from "./inputs";

export interface PatientHit {
  id: string;
  name: string;
  /** DD/MM/YYYY. */
  dateOfBirth?: string;
  phone?: string;
  /** "Tue 03/11 09:00" – or absent. */
  nextAppointment?: string;
  /** Alert flags shown in words ("Latex allergy"). */
  alerts?: readonly string[];
}

export interface PatientComboboxProps {
  id: string;
  /** Visible label ("Patient"). */
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** The matches for the query – the screen searches (server or local); this only shows them. */
  results: readonly PatientHit[];
  onSelect: (hit: PatientHit) => void;
  /** Offer "Create new patient" at the bottom (members who may create patients). */
  onCreate?: (query: string) => void;
  /** Searching… (keeps the list, says so). */
  loading?: boolean;
  /** The possible-duplicate warning (e.g. before creating "Margaret Ellis" when one exists). */
  duplicateWarning?: React.ReactNode;
  /** Minimum characters before the list opens. Default 2. */
  minChars?: number;
  hint?: string;
  className?: string;
}

/**
 * Patient search combobox (brief Part A): a search box whose list shows each match's name, date of birth, phone, next
 * appointment and alert flags (in words), with "Create new patient" last. WAI-ARIA combobox: ↓/↑ move through the
 * list (focus stays in the box, aria-activedescendant), Enter picks, Esc closes the list (a second Esc clears).
 * Results and the "N patients found" count are announced. Options are 44 px tall or more.
 */
export function PatientCombobox({ id, label, query, onQueryChange, results, onSelect, onCreate, loading, duplicateWarning, minChars = 2, hint, className }: PatientComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const ready = query.trim().length >= minChars;
  const count = results.length + (onCreate ? 1 : 0);
  const showList = open && ready;

  React.useEffect(() => setActive(-1), [query]);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const choose = (i: number) => {
    if (i < results.length) {
      onSelect(results[i]);
      setOpen(false);
    } else if (onCreate) {
      onCreate(query);
      setOpen(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (!ready || count === 0) return;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % count : a <= 0 ? count - 1 : a - 1));
    } else if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      if (showList) {
        e.preventDefault();
        setOpen(false);
      } else if (query) {
        e.preventDefault();
        onQueryChange("");
      }
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const status = !ready ? "" : loading ? "Searching…" : results.length === 0 ? "No patients found" : `${results.length} patient${results.length === 1 ? "" : "s"} found`;

  return (
    <div ref={rootRef} className={cn("relative flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-[8px] border border-input-strong bg-white px-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary max-sm:h-11">
        <Search className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-describedby={hint ? hintId : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Name, date of birth or phone"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-[#64748B] focus:outline-none"
        />
        <InlineKbd>/</InlineKbd>
      </div>
      {hint ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {showList ? status : ""}
      </span>
      {/* The list stays in the DOM (hidden) so aria-controls always points at an element. */}
      <div
        id={listId}
        role="listbox"
        aria-label={`Patients matching ${query}`}
        hidden={!showList}
        className={cn("absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-[360px] flex-col overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-[0_12px_32px_rgba(15,23,42,0.14)]", showList ? "flex" : "hidden")}
      >
        {showList && loading && results.length === 0 ? <div className="px-3 py-3 text-sm text-[#475569]">Searching…</div> : null}
        {showList && !loading && results.length === 0 ? <div className="px-3 py-3 text-sm text-[#475569]">No patients match “{query.trim()}”.</div> : null}
        {showList
          ? results.map((h, i) => (
              <div
                key={h.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2", i === active ? "bg-[#F0FDFA] outline outline-2 -outline-offset-2 outline-primary" : "hover:bg-[#F8FAFC]")}
              >
                <PmsAvatar name={h.name} size={32} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold text-foreground">{h.name}</span>
                    {(h.alerts ?? []).map((a) => (
                      <span key={a} className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border border-[#FBD38D] bg-[#FFFBEB] px-2 text-[11px] font-medium text-accent-text">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Alert: {a}
                      </span>
                    ))}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-[#475569]">
                    {h.dateOfBirth ? <span>DOB {h.dateOfBirth}</span> : null}
                    {h.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" aria-hidden />
                        {h.phone}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" aria-hidden />
                      {h.nextAppointment ? `Next ${h.nextAppointment}` : "No upcoming appointment"}
                    </span>
                  </span>
                </span>
              </div>
            ))
          : null}
        {showList && onCreate ? (
          <div
            id={optionId(results.length)}
            role="option"
            aria-selected={active === results.length}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => choose(results.length)}
            className={cn(
              "mt-1 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border-t border-border px-2.5 py-2 font-medium text-primary-strong",
              active === results.length ? "bg-[#F0FDFA] outline outline-2 -outline-offset-2 outline-primary" : "hover:bg-[#F8FAFC]",
            )}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Create new patient{query.trim() ? ` “${query.trim()}”` : ""}
          </div>
        ) : null}
      </div>
      {duplicateWarning ? (
        <div role="alert" className="flex gap-2.5 rounded-xl border border-[#FBD38D] bg-[#FFFBEB] px-3.5 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
          <div className="min-w-0 text-foreground">{duplicateWarning}</div>
        </div>
      ) : null}
    </div>
  );
}
