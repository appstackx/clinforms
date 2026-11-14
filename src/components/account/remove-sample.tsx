"use client";
/**
 * "Remove sample clinic" (14/11/2026) – shown to the OWNER of a clinic that paid after its free trial, while its separate
 * sample clinic (made-up data – src/server/trial/sample.ts) still exists. Two steps: the button, then a confirmation
 * that says what goes (the sample clinic only – never the clinic's own records) and that it cannot be undone.
 */
import * as React from "react";
import { removeSampleClinicAction } from "@/app/app/sample-actions";
import { SAMPLE_REMOVED_PARAM } from "@/lib/trial-copy";

/** "The sample clinic has been removed" – shown by the page after the reload (?sample=removed). */
export function SampleRemovedNotice() {
  return (
    <p role="status" data-testid="sample-removed" className="mb-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
      The sample clinic has been removed. Your own clinic&rsquo;s records are unchanged.
    </p>
  );
}

export function RemoveSampleClinicCard() {
  const [state, setState] = React.useState<{ confirming: boolean; busy: boolean; error: string | null }>({ confirming: false, busy: false, error: null });
  const remove = async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    const r = await removeSampleClinicAction();
    // A full reload: the clinic list (Switch clinic) and the page change with it.
    if (r.ok === true) window.location.assign(`${window.location.pathname}?${SAMPLE_REMOVED_PARAM}=removed`);
    else setState({ confirming: true, busy: false, error: r.ok === false ? r.error : null });
  };
  return (
    <section aria-labelledby="remove-sample-title" data-testid="remove-sample" className="mb-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <h2 id="remove-sample-title" className="text-base font-semibold">
        Sample clinic
      </h2>
      <p className="mt-1 text-slate-600">
        The sample clinic from your free trial (made-up patients, appointments, notes and invoices) is still available under Switch clinic. You can remove it now
        that you are on a paid plan.
      </p>
      {state.error ? (
        <p role="alert" className="mt-2 font-medium text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.confirming ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3" data-testid="remove-sample-confirm">
          <p className="font-medium text-red-900">Remove the sample clinic permanently?</p>
          <p className="mt-1 text-red-900">This deletes the sample clinic and all of its made-up data. It cannot be undone. Your own clinic and its records are not affected.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={state.busy} className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-800 disabled:opacity-60" data-testid="remove-sample-yes">
              {state.busy ? "Removing…" : "Remove permanently"}
            </button>
            <button type="button" onClick={() => setState({ confirming: false, busy: false, error: null })} disabled={state.busy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <button type="button" onClick={() => setState((s) => ({ ...s, confirming: true, error: null }))} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100" data-testid="remove-sample-start">
            Remove sample clinic
          </button>
        </div>
      )}
    </section>
  );
}
