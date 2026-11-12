"use client";
/**
 * "Install the app" (12/11/2026, tracker xt05): opened from the clinic account menu. Browsers with an install prompt get
 * an Install button; Safari on iPhone/iPad gets the three Share → Add to Home Screen steps. "Don't show this again"
 * removes the menu item on this device. Same dialog frame as the keyboard shortcuts sheet (pms/ui/keyboard-hint.tsx).
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Share, SquarePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstallHint } from "@/lib/pwa/install-hint";
import { useReturnFocus } from "../pms/ui/return-focus";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const buttonBase = cn("inline-flex h-10 items-center justify-center rounded-[8px] px-4 text-sm font-semibold", focusRing);

export interface InstallAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appName: string;
  hint: Exclude<InstallHint, null>;
  onInstall: () => Promise<void>;
  onDismiss: () => void;
}

export function InstallAppDialog({ open, onOpenChange, appName, hint, onInstall, onDismiss }: InstallAppDialogProps) {
  const returnFocus = useReturnFocus(open);
  const [busy, setBusy] = React.useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content
          {...returnFocus}
          data-testid="install-app-dialog"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-white p-5 text-sm shadow-[0_24px_48px_rgba(15,23,42,0.24)] focus:outline-none"
        >
          <div className="flex items-center justify-between gap-3">
            <DialogPrimitive.Title className="text-base font-semibold">Install the {appName} app</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close" className={cn("inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-[#F1F5F9]", focusRing)}>
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="text-[#334155]">
            {hint === "ios"
              ? `Add ${appName} to your home screen: it opens full screen, straight to the clinic.`
              : `Add ${appName} to your home screen or desktop: it opens in its own window, straight to the clinic.`}{" "}
            You still sign in as usual, and nothing about your patients is kept on the device.
          </DialogPrimitive.Description>
          {hint === "ios" ? (
            <ol className="flex list-none flex-col gap-2.5 p-0" data-testid="install-ios-steps">
              <li className="flex items-center gap-2.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-semibold">1</span>
                <span>
                  Tap <Share className="inline h-4 w-4 align-[-3px]" aria-hidden /> <strong>Share</strong> in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-semibold">2</span>
                <span>
                  Choose <SquarePlus className="inline h-4 w-4 align-[-3px]" aria-hidden /> <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-semibold">3</span>
                <span>
                  Tap <strong>Add</strong>.
                </span>
              </li>
            </ol>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={cn(buttonBase, "mr-auto px-2 font-medium text-[#475569] underline underline-offset-2 hover:text-foreground")}
              onClick={() => {
                onDismiss();
                onOpenChange(false);
              }}
            >
              Don&apos;t show this again
            </button>
            {hint === "browser" ? (
              <button
                type="button"
                disabled={busy}
                className={cn(buttonBase, "bg-[#0B6B65] text-white hover:bg-[#08463F] disabled:opacity-60")}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onInstall();
                  } finally {
                    setBusy(false);
                    onOpenChange(false);
                  }
                }}
              >
                Install
              </button>
            ) : (
              <DialogPrimitive.Close className={cn(buttonBase, "bg-[#0B6B65] text-white hover:bg-[#08463F]")}>Done</DialogPrimitive.Close>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
