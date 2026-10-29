"use client";
import * as React from "react";
import { Eye, Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { PmsButton } from "./button";

/** "1 unsaved change" / "3 unsaved changes" / "Unsaved changes". */
export function unsavedText(count?: number): string {
  if (count === undefined) return "Unsaved changes";
  return `${count} unsaved change${count === 1 ? "" : "s"}`;
}

export interface UnsavedChangesBannerProps {
  /** How many changes (omit for a plain "Unsaved changes"). */
  count?: number;
  /** What happens if they are not saved. */
  children?: React.ReactNode;
  onDiscard?: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  className?: string;
}

/**
 * "Unsaved changes" banner (brief Part A; the pattern of the roles grid): amber, a pencil and the words, announced
 * politely when it appears. Discard and Save sit on it so the person never has to hunt for them. Pair with
 * useWarnBeforeLeaving so closing the tab asks first.
 */
export function UnsavedChangesBanner({ count, children, onDiscard, onSave, saving, saveLabel = "Save changes", className }: UnsavedChangesBannerProps) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#FBD38D] bg-[#FFFBEB] px-3.5 py-2.5 text-sm", className)}>
      <Pencil className="h-4 w-4 shrink-0 text-accent-text" aria-hidden />
      <span className="min-w-0 flex-1 text-foreground">
        <strong className="font-semibold">{unsavedText(count)}</strong>
        {children ? <span className="text-[#334155]"> – {children}</span> : null}
      </span>
      {onDiscard || onSave ? (
        <span className="flex flex-wrap items-center gap-2">
          {onDiscard ? (
            <PmsButton variant="ghost" size="sm" onClick={onDiscard} disabled={saving} className="max-sm:h-11">
              Discard
            </PmsButton>
          ) : null}
          {onSave ? (
            <PmsButton size="sm" onClick={onSave} loading={saving} loadingText="Saving…" className="max-sm:h-11">
              {saveLabel}
            </PmsButton>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Asks before the tab is closed or reloaded while `dirty` (the browser shows its own wording). */
export function useWarnBeforeLeaving(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);
}

export interface LockedBannerProps {
  /** "signed": a signed clinical note or a paid invoice – locked for good (green). "read-only": the person may look but not change it (slate). */
  variant?: "signed" | "read-only";
  title: React.ReactNode;
  children?: React.ReactNode;
  /** The one way forward ("Add amendment", "Ask an administrator"). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Locked / read-only banner (brief Part A; the pattern of the signed note): a lock and the reason in words, never a
 * greyed-out form with no explanation. role="note" – it describes the page; it is not news.
 */
export function LockedBanner({ variant = "signed", title, children, action, className }: LockedBannerProps) {
  const signed = variant === "signed";
  const Icon = signed ? Lock : Eye;
  return (
    <div role="note" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 text-sm", signed ? "border-[#A7E8BE] bg-[#F0FDF4]" : "border-input-strong bg-[#F8FAFC]", className)}>
      <Icon className={cn("h-4 w-4 shrink-0", signed ? "text-[#166534]" : "text-[#475569]")} aria-hidden />
      <span className="min-w-0 flex-1 text-foreground">
        <strong className="font-semibold">{title}</strong>
        {children ? <span className="text-[#334155]"> {children}</span> : null}
      </span>
      {action}
    </div>
  );
}
