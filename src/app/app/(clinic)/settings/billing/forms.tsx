"use client";
/** Settings → Plan and billing: the plan chooser and the "Manage billing" button (owners and admins). */
import * as React from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/account/form-controls";
import { Notice, Panel } from "@/components/account/shell";
import type { BillingView } from "@/server/billing/views";
import { choosePlanAction, manageBillingAction, type BillingActionResult } from "./actions";

const CARD = "flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm has-[:checked]:border-teal-600 has-[:checked]:ring-2 has-[:checked]:ring-teal-600/30";

function useRedirectOn(state: BillingActionResult | null) {
  React.useEffect(() => {
    if (state?.ok && state.url) window.location.assign(state.url);
  }, [state]);
}

function Result({ state }: { state: BillingActionResult | null }) {
  if (!state) return null;
  if (state.ok && state.url) return <p className="text-sm text-slate-700" role="status">Opening the secure payment page…</p>;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-teal-800" : "text-sm text-red-700"} data-testid="plan-result">
      {state.ok ? state.message : state.error}
    </p>
  );
}

export function ChoosePlanForm({ view }: { view: BillingView }) {
  const [state, action] = useFormState(choosePlanAction, null as BillingActionResult | null);
  useRedirectOn(state);
  const current = view.current.choice;
  const [interval, setInterval] = React.useState<"month" | "year">(current?.product === "clindesk" ? current.interval : "month");
  const button = view.changesRunning ? "Change plan" : "Continue to payment";
  if (view.product === "clinforms") {
    return (
      <form action={action} className="space-y-4" aria-label="Choose a ClinForms plan" data-testid="plan-form">
        <input type="hidden" name="product" value="clinforms" />
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium text-slate-800">Reports a month</legend>
          {view.clinforms.map((t) => (
            <label key={t.key} className={CARD}>
              <input type="radio" name="tier" value={t.key} required defaultChecked={current?.product === "clinforms" && current.tier === t.key} className="mt-1" />
              <span>
                <span className="block font-semibold text-slate-900">
                  {t.label} · {t.monthly} a month
                </span>
                <span className="block text-slate-600">Up to {t.reports} reports a month, then {view.extraReport} each</span>
              </span>
            </label>
          ))}
        </fieldset>
        <SubmitButton pendingText="Please wait…">{button}</SubmitButton>
        <Result state={state} />
      </form>
    );
  }
  return (
    <form action={action} className="space-y-5" aria-label="Choose a plan" data-testid="plan-form">
      <input type="hidden" name="product" value="clindesk" />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-800">Billing</legend>
        <div className="flex flex-wrap gap-3">
          {(["month", "year"] as const).map((i) => (
            <label key={i} className={`${CARD} py-2`}>
              <input type="radio" name="interval" value={i} checked={interval === i} onChange={() => setInterval(i)} className="mt-1" />
              <span className="font-medium text-slate-900">{i === "month" ? "Monthly" : "Yearly (2 months free)"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium text-slate-800">Practitioners</legend>
        {view.clindesk.map((b) => (
          <label key={b.key} className={CARD}>
            <input type="radio" name="band" value={b.key} required defaultChecked={current?.product === "clindesk" && current.band === b.key} className="mt-1" />
            <span>
              <span className="block font-semibold text-slate-900">
                {b.label} · {interval === "year" ? `${b.yearly} a year` : `${b.monthly} a month`}
              </span>
              <span className="block text-slate-600">{b.range}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="plan-reports" className="mb-1 block text-sm font-medium text-slate-800">
          Reports add-on (referrer forms completed for you)
        </label>
        <select
          id="plan-reports"
          name="reports"
          defaultValue={current?.product === "clindesk" && current.reports ? current.reports : "none"}
          className="h-10 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
        >
          <option value="none">No Reports add-on</option>
          {view.addons.map((a) => (
            <option key={a.key} value={a.key}>
              Up to {a.reports} reports a month · {interval === "year" ? `${a.yearly} a year` : `${a.monthly} a month`}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-600">
          {`The add-on is billed ${interval === "year" ? "yearly" : "monthly"} with your plan; the allowance is per month. Extra reports above it are ${view.extraReport} each, billed after each month.`}
        </p>
      </div>
      <SubmitButton pendingText="Please wait…">{button}</SubmitButton>
      <Result state={state} />
    </form>
  );
}

/**
 * "Add the Reports add-on" (01/11/2026): a running ClinDesk plan without the add-on (`offer`, decided by the page).
 * Same plan and interval, plus the chosen allowance – the running subscription is changed in place (choosePlanAction →
 * changePlan: only the add-on is added, prorated on the next invoice). Always rendered in the same place, so the
 * confirmation stays on screen after the page refreshes with the add-on on (and the offer gone).
 */
export function AddReportsPanel({ view, offer }: { view: BillingView; offer: boolean }) {
  const [state, action] = useFormState(choosePlanAction, null as BillingActionResult | null);
  useRedirectOn(state);
  const current = view.current.choice;
  if (state?.ok && !state.url) {
    return (
      <div className="mt-6" data-testid="add-reports-done">
        <Notice tone="success">{state.message}</Notice>
      </div>
    );
  }
  if (!offer || current?.product !== "clindesk" || current.reports) return null;
  const yearly = current.interval === "year";
  return (
    <Panel
      title="Add the Reports add-on"
      description="Referrer forms – solicitors', insurers' and employers' own forms – completed from your notes, ready for the clinician to check and approve."
      className="mt-6"
    >
      <form id="add-reports" action={action} className="space-y-4" aria-label="Add the Reports add-on" data-testid="add-reports-form">
        <input type="hidden" name="product" value="clindesk" />
        <input type="hidden" name="band" value={current.band} />
        <input type="hidden" name="interval" value={current.interval} />
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium text-slate-800">Reports a month</legend>
          {view.addons.map((a, i) => (
            <label key={a.key} className={CARD}>
              <input type="radio" name="reports" value={a.key} required defaultChecked={i === 0} className="mt-1" />
              <span>
                <span className="block font-semibold text-slate-900">
                  Up to {a.reports} reports a month · {yearly ? `${a.yearly} a year` : `${a.monthly} a month`}
                </span>
                <span className="block text-slate-600">Then {view.extraReport} each</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-slate-600">
          {`Billed ${yearly ? "yearly" : "monthly"} with your plan; the allowance is per month. It starts straight away and the part of this billing period that is left is added to your next invoice.`}
        </p>
        <SubmitButton pendingText="Please wait…">Add the Reports add-on</SubmitButton>
        <Result state={state} />
      </form>
    </Panel>
  );
}

export function ManageBillingButton() {
  const [state, action] = useFormState(manageBillingAction, null as BillingActionResult | null);
  useRedirectOn(state);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary" pendingText="Opening…">
        Manage billing
      </SubmitButton>
      <p className="text-xs text-slate-600">Change your card or Direct Debit, download invoices or cancel your plan.</p>
      <Result state={state} />
    </form>
  );
}
