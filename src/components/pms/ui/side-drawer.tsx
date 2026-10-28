"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./return-focus";

export interface SideDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record it is about ("James Okafor"). */
  title: React.ReactNode;
  /** Small line above the title ("Appointment"). */
  eyebrow?: React.ReactNode;
  /** Under the title (a StatusPill). */
  meta?: React.ReactNode;
  children?: React.ReactNode;
  /** Actions pinned to the bottom. */
  footer?: React.ReactNode;
  /** Optional trigger (else control it with open/onOpenChange). */
  trigger?: React.ReactNode;
  className?: string;
}

/**
 * Details beside the page (design system v1, "Side drawer"): 400 px from the right, full width on a phone, Esc or
 * the × closes it and focus returns to what opened it (Radix Dialog).
 */
export function SideDrawer({ open, onOpenChange, title, eyebrow, meta, children, footer, trigger, className }: SideDrawerProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.3)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          {...returnFocus}
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[400px] flex-col bg-white text-sm shadow-[-12px_0_32px_rgba(15,23,42,0.14)] focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right motion-reduce:data-[state=open]:animate-none",
            className,
          )}
        >
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {eyebrow ? <span className="text-xs text-muted-foreground">{eyebrow}</span> : null}
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">{title}</DialogPrimitive.Title>
              {meta ? <div className="self-start">{meta}</div> : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-primary-strong hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-4 text-[#334155]">{children}</div>
          {footer ? <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
