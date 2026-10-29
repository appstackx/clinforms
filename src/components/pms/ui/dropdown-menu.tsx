"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useDismiss, useKeepInView } from "./popover";

export type DropdownMenuEntry =
  | {
      type?: "item";
      label: string;
      onSelect?: () => void;
      /** A link item (rendered as <a>). */
      href?: string;
      icon?: React.ReactNode;
      /** A key hint on the right ("A"). */
      shortcut?: string;
      destructive?: boolean;
      disabled?: boolean;
    }
  | { type: "separator" }
  | { type: "label"; label: string };

export interface DropdownMenuTriggerProps {
  ref: React.Ref<HTMLButtonElement>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface DropdownMenuProps {
  /** The menu's accessible name ("Appointment actions"). */
  label: string;
  items: readonly DropdownMenuEntry[];
  /** Renders the button; spread the props on a <button>. */
  trigger: (props: DropdownMenuTriggerProps) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
}

/** Next enabled item index from `from` in direction `dir` (wrapping), or -1 when none is enabled. */
export function nextEnabled(enabled: readonly boolean[], from: number, dir: 1 | -1): number {
  const n = enabled.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (enabled[i]) return i;
  }
  return -1;
}

/** First enabled item after `from` whose label starts with `ch` (type-ahead), or -1. */
export function typeAhead(labels: readonly string[], enabled: readonly boolean[], from: number, ch: string): number {
  const n = labels.length;
  const c = ch.toLowerCase();
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (enabled[i] && labels[i].toLowerCase().startsWith(c)) return i;
  }
  return -1;
}

/**
 * Dropdown menu (brief Part A; WAI-ARIA menu button): a button that opens a list of actions. Enter, Space (a click) or ↓
 * open it on the first item (↑ on the last); ↓/↑ move, Home/End jump, a letter jumps to the next item starting with it, Enter
 * runs it, Esc closes and returns focus to the button, Tab closes and moves on. Items are 36 px, 44 px on a phone.
 * Destructive items are red text with their word ("Cancel appointment…"), never colour alone.
 */
export function DropdownMenu({ label, items, trigger, align = "end", className }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<(HTMLElement | null)[]>([]);
  const id = React.useId();
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  useKeepInView(menuRef, open);

  const actionable = items.map((e) => (e.type === undefined || e.type === "item" ? e : null));
  const enabled = actionable.map((e) => Boolean(e && !e.disabled));
  const labels = actionable.map((e) => e?.label ?? "");

  React.useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  const openAt = (where: "first" | "last") => {
    const i = where === "first" ? nextEnabled(enabled, -1, 1) : nextEnabled(enabled, items.length, -1);
    setActive(Math.max(i, 0));
    setOpen(true);
  };

  const shut = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openAt("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAt("last");
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    let next = -1;
    if (e.key === "ArrowDown") next = nextEnabled(enabled, active, 1);
    else if (e.key === "ArrowUp") next = nextEnabled(enabled, active, -1);
    else if (e.key === "Home") next = nextEnabled(enabled, -1, 1);
    else if (e.key === "End") next = nextEnabled(enabled, items.length, -1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return shut(true);
    } else if (e.key === "Tab") return shut(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) next = typeAhead(labels, enabled, active, e.key);
    if (next >= 0) {
      e.preventDefault();
      setActive(next);
    }
  };

  const run = (entry: Extract<DropdownMenuEntry, { label: string; type?: "item" }>) => {
    if (entry.disabled) return;
    shut(true);
    entry.onSelect?.();
  };

  const itemCls = (entry: { destructive?: boolean; disabled?: boolean }) =>
    cn(
      "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none max-sm:h-11 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
      entry.disabled ? "cursor-not-allowed text-[#64748B]" : entry.destructive ? "text-destructive-strong hover:bg-[#FEF2F2] focus:bg-[#FEF2F2]" : "text-foreground hover:bg-[#F1F5F9] focus:bg-[#F1F5F9]",
      "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
    );

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      {trigger({ ref: buttonRef, "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": open ? id : undefined, onClick: () => (open ? shut(false) : openAt("first")), onKeyDown: onTriggerKey })}
      {open ? (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 flex w-[min(260px,calc(100vw-32px))] flex-col rounded-xl border border-border bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)]",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((entry, i) => {
            if (entry.type === "separator") return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border" />;
            if (entry.type === "label")
              return (
                <div key={`lbl-${i}`} role="presentation" className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-[#475569]">
                  {entry.label}
                </div>
              );
            const inner = (
              <>
                {entry.icon ? <span aria-hidden className="inline-flex">{entry.icon}</span> : null}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.shortcut ? (
                  <kbd aria-hidden className="rounded-[4px] border border-b-2 border-border bg-white px-[5px] font-sans text-[11px] leading-[18px] text-[#475569]">
                    {entry.shortcut}
                  </kbd>
                ) : null}
              </>
            );
            const common = {
              ref: (el: HTMLElement | null) => {
                itemRefs.current[i] = el;
              },
              role: "menuitem" as const,
              tabIndex: -1,
              "aria-disabled": entry.disabled || undefined,
              "aria-keyshortcuts": entry.shortcut,
              className: itemCls(entry),
            };
            return entry.href && !entry.disabled ? (
              <a key={`${entry.label}-${i}`} {...common} href={entry.href} onClick={() => shut(false)}>
                {inner}
              </a>
            ) : (
              <button key={`${entry.label}-${i}`} {...common} type="button" onClick={() => run(entry)}>
                {inner}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
