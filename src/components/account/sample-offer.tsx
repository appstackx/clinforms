"use client";
/**
 * "Explore with sample data" – offered to the owner of a self-serve trial clinic on its start page (/app and the clinic
 * system's Today page) until a sample clinic exists or the owner says "No thanks". The sample is a SEPARATE clinic with
 * made-up patients (src/server/trial/sample.ts): the owner switches between it and their own clinic with Switch clinic.
 */
import * as React from "react";
import { createSampleClinicAction, declineSampleClinicAction } from "@/app/app/sample-actions";

export function SampleOfferCard({ creating }: { creating: boolean }) {
  const [state, setState] = React.useState<{ busy: boolean; error: string | null; hidden: boolean; progress?: string }>({ busy: false, error: null, hidden: false });
  if (state.hidden) return null;
  const create = async () => {
    setState({ busy: true, error: null, hidden: false });
    // The sample clinic is made in short steps: call again until it is ready (at most 20 calls).
    for (let i = 0; i < 20; i++) {
      const r = await createSampleClinicAction();
      if (r.ok === true) {
        window.location.assign(r.next);
        return;
      }
      if (r.ok === "continue") {
        setState({ busy: true, error: null, hidden: false, progress: `Setting up the sample clinic… (step ${r.step} of ${r.steps})` });
        continue;
      }
      setState({ busy: false, error: r.error, hidden: false });
      return;
    }
    setState({ busy: false, error: "The sample clinic is taking longer than expected – please try again in a minute.", hidden: false });
  };
  const decline = async () => {
    setState((s) => ({ ...s, hidden: true }));
    await declineSampleClinicAction();
  };
  return (
    <section aria-labelledby="sample-offer-title" data-testid="sample-offer" className="mb-6 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
      <h2 id="sample-offer-title" className="text-base font-semibold">
        Explore with sample data
      </h2>
      <p className="mt-1">
        Look around with a ready-made sample clinic: made-up patients, a week of appointments, notes and invoices. It is a separate clinic, so nothing in it
        ever mixes with your own records – switch between the two with Switch clinic. It ends with your free trial.
      </p>
      {creating ? <p className="mt-2 font-medium">Your sample clinic is being set up…</p> : null}
      {state.error ? (
        <p role="alert" className="mt-2 font-medium text-red-700">
          {state.error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={create} disabled={state.busy} className="rounded-md bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800 disabled:opacity-60" data-testid="sample-create">
          {state.busy ? (state.progress ?? "Setting up the sample clinic…") : "Explore with sample data"}
        </button>
        <button type="button" onClick={decline} disabled={state.busy} className="rounded-md border border-teal-300 bg-white px-3 py-1.5 font-medium text-teal-900 hover:bg-teal-100">
          No thanks
        </button>
      </div>
    </section>
  );
}
