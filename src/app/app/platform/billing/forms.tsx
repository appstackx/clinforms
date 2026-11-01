"use client";
/** Platform page – subscriptions: the override switch and "Re-read" for one clinic. */
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/account/form-controls";
import { billingOverrideAction, resyncSubscriptionAction, type PlatformBillingResult } from "./actions";

function Result({ state }: { state: PlatformBillingResult | null }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-xs text-teal-800" : "text-xs text-red-700"}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

export function OverrideForm({ tenantId, on }: { tenantId: string; on: boolean }) {
  const [state, action] = useFormState(billingOverrideAction, null as PlatformBillingResult | null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      {!on ? <input name="note" placeholder="Note (optional)" maxLength={200} className="h-8 rounded border border-slate-300 px-2 text-xs" /> : null}
      <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Saving…">
        {on ? "Follow the subscription again" : "Manage by hand (override)"}
      </SubmitButton>
      <Result state={state} />
    </form>
  );
}

export function ResyncForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useFormState(resyncSubscriptionAction, null as PlatformBillingResult | null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="tenantId" value={tenantId} />
      <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Reading…">
        Re-read
      </SubmitButton>
      <Result state={state} />
    </form>
  );
}
