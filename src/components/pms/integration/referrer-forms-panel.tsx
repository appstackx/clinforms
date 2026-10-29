"use client";
/**
 * The case's "Referrer and insurer forms" panel (design round 3 ReferrerForm): "Complete referrer form" opens a picker
 * of the clinic's ClinForms library (the case's referrer's and insurer's forms first), "Open in ClinForms" records the
 * request and opens the Studio with this case loaded; approved forms come back here (and to the record's Forms tab)
 * with who approved them and when.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileText } from "lucide-react";
import { PmsButton, PmsNotice } from "@/components/pms/ui";
import { useReturnFocus } from "@/components/pms/ui/return-focus";
import { formatFiledLine } from "./format";

export interface PanelLibraryForm {
  id: string;
  title: string;
  referrer: string | null;
  forThisCase: boolean;
}

export interface PanelFiledForm {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  signerName: string | null;
  signerRegistration: string | null;
  signedAt: string | null;
  filedAt: string;
  href: string | null;
}

export interface ReferrerFormsPanelProps {
  caseSummary: string;
  canStart: boolean;
  clinForms: boolean;
  clinicalPrefill: boolean;
  library: PanelLibraryForm[];
  filed: PanelFiledForm[];
  start: (input: {
    formId: string;
    consentRecorded: boolean;
  }) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}

export function ReferrerFormsPanel({
  caseSummary,
  canStart,
  clinForms,
  clinicalPrefill,
  library,
  filed,
  start,
}: ReferrerFormsPanelProps) {
  const [open, setOpen] = React.useState(false);
  const [formId, setFormId] = React.useState<string>(library[0]?.id ?? "");
  const [consent, setConsent] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const returnFocus = useReturnFocus(open);

  const openForm = async () => {
    if (!formId) return setError("Choose a form.");
    setPending(true);
    setError(null);
    const r = await start({ formId, consentRecorded: consent });
    if (!r.ok) {
      setPending(false);
      return setError(r.error);
    }
    window.location.assign(r.url);
  };

  return (
    <section
      aria-labelledby="referrer-forms-title"
      data-testid="referrer-forms"
      className="rounded-xl border border-[#C7D2FE] bg-[#F5F8FF] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="referrer-forms-title"
          className="text-sm font-semibold text-foreground"
        >
          Referrer and insurer forms
        </h2>
        {canStart ? (
          <PmsButton
            type="button"
            onClick={() => setOpen(true)}
            className="bg-[#1842B4] hover:bg-[#12348F]"
            data-testid="complete-referrer-form"
          >
            Complete referrer form
          </PmsButton>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[#475569]">{caseSummary}</p>
      {!clinForms ? (
        <p className="mt-3 text-sm text-[#334155]">
          Completing a referrer&apos;s own form from this case needs ClinForms,
          which is not switched on for this clinic.
        </p>
      ) : null}
      {filed.length === 0 ? (
        <p className="mt-3 text-sm text-[#334155]">
          No forms on this case yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {filed.map((f) => (
            <li
              key={f.id}
              role="status"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-white px-3 py-2.5"
              data-testid="filed-form"
            >
              <FileText
                className="h-4 w-4 shrink-0 text-[#1842B4]"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-foreground">
                  {f.title}
                </strong>
                <span className="block text-xs text-[#475569]">
                  {formatFiledLine(f)} · filed to this case and the Forms tab
                </span>
              </span>
              <span className="inline-flex h-6 items-center rounded-full border border-[#BBF7D0] bg-[#DCFCE7] px-2 text-xs font-semibold text-[#166534]">
                Approved
              </span>
              {f.href ? (
                <a
                  href={f.href}
                  className="text-sm font-medium text-primary-strong underline underline-offset-2"
                >
                  View {f.mimeType === "application/pdf" ? "PDF" : "Word file"}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(o) => (pending ? undefined : setOpen(o))}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
          <DialogPrimitive.Content
            {...returnFocus}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-white text-sm shadow-[0_24px_48px_rgba(15,23,42,0.24)] focus:outline-none"
          >
            <div className="px-5 pt-5">
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                Choose a form
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[#475569]">
                From your clinic&apos;s ClinForms library, filtered to this
                case&apos;s referrer and insurer.
              </DialogPrimitive.Description>
            </div>
            <div className="px-5 py-4">
              {library.length === 0 ? (
                <PmsNotice tone="info" title="No forms in your library yet">
                  Add the referrer&apos;s form in ClinForms (Forms → Upload a
                  referrer form) and confirm its mapping, then come back to this
                  case.
                </PmsNotice>
              ) : (
                <div role="radiogroup" aria-label="Forms" className="space-y-2">
                  {library.map((f) => (
                    <label
                      key={f.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${formId === f.id ? "border-[#1842B4] bg-[#F5F8FF]" : "border-border bg-white"}`}
                    >
                      <input
                        type="radio"
                        name="referrer-form"
                        value={f.id}
                        checked={formId === f.id}
                        onChange={() => setFormId(f.id)}
                        className="mt-1 accent-[#1842B4]"
                      />
                      <span>
                        <strong className="block text-foreground">
                          {f.title}
                        </strong>
                        <span className="block text-xs text-[#475569]">
                          {[
                            f.referrer,
                            f.forThisCase ? "for this case" : "other referrer",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <label className="mt-4 flex items-start gap-2 text-[#334155]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  The patient agreed that the completed form may be shared with
                  the referrer (recorded with today&apos;s date).
                </span>
              </label>
              <p className="mt-3 text-xs text-[#475569]">
                {clinicalPrefill
                  ? "ClinForms gets the patient, the case, the referrer and authorisations, appointments, and the signed notes and outcome scores of this case. Unsigned notes are never used."
                  : "ClinForms gets the patient, the case, the referrer and authorisations and appointments. Clinical notes are not shared from your account – a clinician completes the clinical answers."}
              </p>
              {error ? (
                <p role="alert" className="mt-3 text-sm text-[#B91C1C]">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              <span className="mr-auto text-xs text-[#475569]">
                Opens in the ClinForms area
              </span>
              <DialogPrimitive.Close asChild>
                <PmsButton variant="secondary" disabled={pending}>
                  Cancel
                </PmsButton>
              </DialogPrimitive.Close>
              <PmsButton
                type="button"
                loading={pending}
                disabled={library.length === 0}
                onClick={() => void openForm()}
                data-testid="open-in-clinforms"
              >
                Open in ClinForms
              </PmsButton>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
