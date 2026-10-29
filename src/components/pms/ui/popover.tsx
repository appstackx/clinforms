"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Keeps an absolutely placed overlay (popover, dropdown menu) inside the viewport: after it opens it is measured and
 * nudged sideways so it never sticks out past a 16 px gutter – no sideways scroll on a 375 px phone.
 */
export function useKeepInView(ref: React.RefObject<HTMLElement>, open: boolean) {
  const layout = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
  layout(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.translate = "";
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const gutter = 16;
    let dx = 0;
    if (r.right > vw - gutter) dx = vw - gutter - r.right;
    if (r.left + dx < gutter) dx = gutter - r.left;
    if (dx) el.style.translate = `${Math.round(dx)}px 0`;
  }, [open, ref]);
}

/** Closes on a pointer press outside `root` and when focus leaves it (Tab away). */
export function useDismiss(root: React.RefObject<HTMLElement>, open: boolean, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [root, open, close]);
}

export interface PopoverTriggerProps {
  ref: React.Ref<HTMLButtonElement>;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog";
  onClick: () => void;
}

export interface PmsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The panel's accessible name (it is a non-modal dialog). */
  label: string;
  /** Renders the button that opens it; spread the props on a <button>. */
  trigger: (props: PopoverTriggerProps) => React.ReactNode;
  children: React.ReactNode;
  /** Which edge of the trigger the panel lines up with. Default "start". */
  align?: "start" | "end";
  /** Selector inside the panel to focus when it opens (default: its first focusable element, else the panel). */
  initialFocus?: string;
  className?: string;
  panelClassName?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A small panel tied to a button (brief Part A, "Popover"): a non-modal dialog under the button – focus moves in when
 * it opens, Esc closes it and returns focus to the button, a click outside or tabbing away closes it. Used by the date
 * picker; use it for short extra detail or a few controls, not for whole forms (that is the side drawer).
 */
export function PmsPopover({ open, onOpenChange, label, trigger, children, align = "start", initialFocus, className, panelClassName }: PmsPopoverProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismiss(rootRef, open, close);
  useKeepInView(panelRef, open);

  React.useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const target = (initialFocus && panel.querySelector<HTMLElement>(initialFocus)) || panel.querySelector<HTMLElement>(FOCUSABLE) || panel;
    target.focus();
  }, [open, initialFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)} onKeyDown={open ? onKeyDown : undefined}>
      {trigger({ ref: triggerRef, "aria-expanded": open, "aria-controls": id, "aria-haspopup": "dialog", onClick: () => onOpenChange(!open) })}
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 w-max max-w-[calc(100vw-32px)] rounded-xl border border-border bg-white p-3 text-sm text-foreground shadow-[0_12px_32px_rgba(15,23,42,0.14)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
