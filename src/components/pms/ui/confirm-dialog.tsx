"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PmsButton } from "./button";
import { useReturnFocus } from "./return-focus";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question: "Cancel appointment?" */
  title: React.ReactNode;
  /** What will happen, in plain words. */
  description?: React.ReactNode;
  /** Extra fields (a reason, a fee checkbox). */
  children?: React.ReactNode;
  /** Says what it does: "Cancel appointment", "Void invoice". */
  confirmLabel: string;
  /** Says what keeping does: "Keep appointment". Default "Go back". */
  cancelLabel?: string;
  destructive?: boolean;
  /** Running: the confirm button shows a spinner and the dialog stays open. */
  pending?: boolean;
  onConfirm: () => void;
}

/**
 * Asks before something that cannot simply be undone (design system v1, "Dialogs": AlertDialog). Radix Dialog keeps
 * focus inside, Esc and "Keep…" close it, and focus goes back to the button that opened it.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, cancelLabel = "Go back", destructive, pending, onConfirm }: ConfirmDialogProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          {...returnFocus}
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-white text-sm shadow-[0_24px_48px_rgba(15,23,42,0.24)] focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-1.5 px-5 pt-5">
            <DialogPrimitive.Title className="text-base font-semibold text-foreground">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="text-[#475569]">{description}</DialogPrimitive.Description> : null}
          </div>
          {children ? <div className="flex flex-col gap-1.5 px-5 py-4">{children}</div> : <div className="h-4" />}
          <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-3">
            <DialogPrimitive.Close asChild>
              <PmsButton variant="secondary" disabled={pending}>
                {cancelLabel}
              </PmsButton>
            </DialogPrimitive.Close>
            <PmsButton variant={destructive ? "destructive" : "primary"} loading={pending} onClick={onConfirm}>
              {confirmLabel}
            </PmsButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
