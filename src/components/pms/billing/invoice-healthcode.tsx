"use client";
/**
 * The Healthcode panel of an insurer invoice (docs/clinic-system/healthcode.md): its ICD-10 diagnosis code (HC10).
 * Presentational; the server checks every change again.
 */
import * as React from "react";
import { setInvoiceDiagnosisAction } from "@/app/app/clinic/billing/actions";
import type { InvoiceHealthcodeView } from "@/modules/pms/billing/healthcode";
import { DiagnosisPicker } from "./diagnosis-picker";

export function InvoiceHealthcodePanel({ view }: { view: InvoiceHealthcodeView }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5" aria-labelledby="hc-invoice-h" data-testid="invoice-healthcode">
      <h2 id="hc-invoice-h" className="text-base font-semibold">
        Healthcode
      </h2>
      {view.showDiagnosis ? (
        <DiagnosisPicker
          id="invoice-diagnosis"
          label="Diagnosis code (ICD-10)"
          initial={view.diagnosisCode}
          canEdit={view.canEditDiagnosis}
          emptyText={view.caseDiagnosisCode ? `The case's: ${view.caseDiagnosisCode}` : "None recorded"}
          hint={view.caseDiagnosisCode ? `Leave blank to use the case's code (${view.caseDiagnosisCode}).` : "Leave blank to use the case's code once it has one."}
          save={async (code) => {
            const r = await setInvoiceDiagnosisAction(view.invoiceId, code);
            return r.ok ? { ok: true, code: r.code } : { ok: false, error: r.error };
          }}
        />
      ) : (
        <p className="text-sm text-[#475569]">The diagnosis code is shown to members who can see clinical records.</p>
      )}
    </section>
  );
}
