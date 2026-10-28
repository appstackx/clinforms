"use client";

/**
 * "Preview as patient" in the intake builder: the form EXACTLY as the patient sees it on their phone (the same filler
 * component the portal, the booking link and the clinic device use, at 375 px under the clinic's public header) –
 * with the builder's current, unsaved questions. Read-only: nothing can be sent.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, X } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import type { FormDefinition } from "@/modules/pms/portal/forms";
import { FormFiller } from "./form-filler";
import { PublicHeader } from "./public-shell";

export interface IntakePreviewProps {
  clinicName: string;
  clinicInitials: string;
  demo: boolean;
  title: string;
  form: FormDefinition;
  requiresSignature: boolean;
  signatureStatement: string | null;
}

const neverSend = async () => ({ ok: false as const, error: "This is a preview – nothing is sent." });

export function IntakePreview(p: IntakePreviewProps) {
  const [open, setOpen] = React.useState(false);
  // A fresh filler every time the preview opens (back at part 1, nothing typed).
  const [key, setKey] = React.useState(0);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setKey((k) => k + 1);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <PmsButton variant="secondary" className="w-full">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Preview as patient
        </PmsButton>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content
          aria-describedby="ip-desc"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(407px,calc(100vw-16px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[20px] bg-[#0F172A] p-4 shadow-2xl focus:outline-none"
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-white">
            <DialogPrimitive.Title className="text-sm font-semibold">Preview as patient</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close the preview" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <p id="ip-desc" className="sr-only">
            The form as the patient sees it on a phone. Nothing can be sent.
          </p>
          <div data-testid="patient-preview" className="min-h-0 w-full max-w-[375px] flex-1 self-center overflow-y-auto rounded-[14px] bg-[#F8FAFC]">
            <PublicHeader name={p.clinicName} initials={p.clinicInitials} demo={p.demo} />
            <main className="px-4 pb-10 pt-5">
              <FormFiller
                key={key}
                title={p.title}
                form={p.form}
                requiresSignature={p.requiresSignature}
                signatureStatement={p.signatureStatement}
                submit={neverSend}
                doneHref="#"
                doneLabel="Done"
                preview
              />
            </main>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
