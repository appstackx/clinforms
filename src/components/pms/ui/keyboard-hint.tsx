"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./return-focus";
import type { Shortcut, ShortcutGroup } from "./shortcuts";

/** One key, as in menus and the "?" sheet. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-block min-w-[22px] rounded-[5px] border border-b-2 border-border bg-[#F8FAFC] px-1.5 text-center font-sans text-xs leading-5 text-[#334155]", className)}>
      {children}
    </kbd>
  );
}

const KEY_NAMES: Readonly<Record<string, string>> = { "↑": "Up arrow", "↓": "Down arrow", "←": "Left arrow", "→": "Right arrow", "/": "Slash", "?": "Question mark", "[": "Left bracket", "]": "Right bracket" };

/** A shortcut row: what it does, then its keys (design system v1, "Keyboard hints"). */
export function KeyboardHint({ shortcut, className }: { shortcut: Shortcut; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-sm", className)}>
      <span>{shortcut.label}</span>
      <span className="flex gap-1">
        <span className="sr-only">{shortcut.keys.map((k) => KEY_NAMES[k] ?? k).join(", ")}</span>
        <span className="flex gap-1" aria-hidden>
          {shortcut.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      </span>
    </div>
  );
}

export interface ShortcutsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly ShortcutGroup[];
}

/** The "?" sheet: every shortcut on this page, grouped. */
export function ShortcutsSheet({ open, onOpenChange, groups }: ShortcutsSheetProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content
          {...returnFocus}
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-white p-5 shadow-[0_24px_48px_rgba(15,23,42,0.24)] focus:outline-none"
        >
          <div className="flex items-center justify-between gap-3">
            <DialogPrimitive.Title className="text-base font-semibold">Keyboard shortcuts</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          {groups.map((g) => (
            <section key={g.title} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]">{g.title}</h3>
              {g.shortcuts.map((s) => (
                <KeyboardHint key={s.label} shortcut={s} />
              ))}
            </section>
          ))}
          <p className="text-xs text-muted-foreground">Shortcuts do nothing while you are typing in a box.</p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
