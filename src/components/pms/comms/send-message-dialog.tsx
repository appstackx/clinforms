"use client";
/**
 * "Send message" as a dialog (COMMS-011 – from the diary's appointment drawer): the comms module's own Send a
 * message form (templates, text or email with the reason when one is not possible, care or marketing, preview,
 * "Send now") for one patient, loaded when it opens. Through the outbox / test service only; messages.send (the
 * server checks it again). The drawer passes what the message is about (shown above the form, never sent).
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { SendFormView } from "@/modules/pms/comms/view";
import { PmsNotice } from "@/components/pms/ui";
import { loadSendFormAction } from "@/app/app/clinic/messages/actions";
import { SendMessageForm } from "./send-form";
import { focusRing } from "./format";

export interface SendMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  /** "Margaret Ellis · Thu 29/10/2026 10:30, Follow-up" – context for the member only. */
  context?: string;
  onSent?: () => void;
}

export function SendMessageDialog({ open, onOpenChange, patientId, context, onSent }: SendMessageDialogProps) {
  const [view, setView] = React.useState<SendFormView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setView(null);
    setError(null);
    void loadSendFormAction(patientId).then((r) => {
      if (!live) return;
      if (r.ok) setView(r.view);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, patientId]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content
          data-testid="send-message-dialog"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white text-sm focus:outline-none md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-32px)] md:w-[calc(100vw-32px)] md:max-w-[680px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:shadow-[0_24px_48px_rgba(15,23,42,0.24)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex flex-col gap-0.5">
              <DialogPrimitive.Title className="text-lg font-semibold text-foreground">Send a message</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-[#475569]">{context ?? "To the patient, by text or email."}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" aria-label="Close" className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#334155] hover:bg-[#F1F5F9] ${focusRing}`}>
                <X className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4">
            {error ? <PmsNotice tone="error" title={error} /> : null}
            {!view && !error ? <p className="text-[#475569]">Loading…</p> : null}
            {view ? (
              <SendMessageForm
                view={view}
                onSent={() => {
                  onSent?.();
                  onOpenChange(false);
                }}
              />
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
