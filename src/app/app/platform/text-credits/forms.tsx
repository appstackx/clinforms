"use client";
/** The support adjustment form (platform page – text credits). */
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/account/form-controls";
import { adjustTextCreditsAction, type AdjustCreditsResult } from "./actions";

/** `requestId`: a one-time id made by the page – a second submit of the same form adjusts nothing (review fix 31/10/2026). */
export function AdjustCreditsForm({ tenantId, clinicName, requestId }: { tenantId: string; clinicName: string; requestId: string }) {
  const [state, action] = useFormState<AdjustCreditsResult | null, FormData>(adjustTextCreditsAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={`Adjust text credits for ${clinicName}`}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="adjust-credits" className="mb-1 block text-sm font-medium text-slate-800">
            Credits (+ to add, − to take off)
          </label>
          <input id="adjust-credits" name="credits" inputMode="numeric" required className="h-10 w-36 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" />
        </div>
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="adjust-reason" className="mb-1 block text-sm font-medium text-slate-800">
            Reason (no patient details)
          </label>
          <input id="adjust-reason" name="reason" required maxLength={200} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" />
        </div>
        <SubmitButton pendingText="Saving…">Adjust credits</SubmitButton>
      </div>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-teal-800" : "text-sm text-red-700"} data-testid="adjust-result">
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </form>
  );
}
