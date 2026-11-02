"use client";
/**
 * The Healthcode panel of an insurer invoice (docs/clinic-system/healthcode.md): its bill status, set by hand for now
 * (HC13), and its ICD-10 diagnosis code (HC10). Presentational; the server checks every change again.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { setBillStatusAction, setInvoiceDiagnosisAction } from "@/app/app/clinic/billing/actions";
import { HEALTHCODE_BILL_STATUSES, HEALTHCODE_BILL_STATUS_HINTS, HEALTHCODE_BILL_STATUS_LABELS, NO_BILL_STATUS_LABEL, type InvoiceHealthcodeView } from "@/modules/pms/billing/healthcode";
import { PmsButton, SelectInput, useToast } from "@/components/pms/ui";
import { BillStatusPill } from "./bill-status-pill";
import { DiagnosisPicker } from "./diagnosis-picker";

function BillStatusForm({ view }: { view: InvoiceHealthcodeView }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = React.useState<string>(view.billStatus ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-1.5"
      data-testid="bill-status-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const r = await setBillStatusAction(view.invoiceId, value);
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success(r.status ? `Bill status: ${HEALTHCODE_BILL_STATUS_LABELS[r.status as keyof typeof HEALTHCODE_BILL_STATUS_LABELS]}.` : "Bill status cleared.");
        router.refresh();
      }}
    >
      <label htmlFor="bill-status-select" className="text-sm font-medium">
        Change the bill status
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px]">
          <SelectInput id="bill-status-select" value={value} onChange={(e) => setValue(e.target.value)} data-testid="bill-status-select">
            <option value="">{NO_BILL_STATUS_LABEL}</option>
            {HEALTHCODE_BILL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {HEALTHCODE_BILL_STATUS_LABELS[s]}
              </option>
            ))}
          </SelectInput>
        </div>
        <PmsButton type="submit" variant="secondary" loading={saving} disabled={value === (view.billStatus ?? "")} data-testid="bill-status-save">
          Save
        </PmsButton>
      </div>
      <span className="text-xs text-muted-foreground">Set by hand for now – each change is kept in the audit trail.</span>
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function InvoiceHealthcodePanel({ view }: { view: InvoiceHealthcodeView }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5" aria-labelledby="hc-invoice-h" data-testid="invoice-healthcode">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="hc-invoice-h" className="text-base font-semibold">
          Healthcode
        </h2>
        <BillStatusPill status={view.billStatus} />
      </div>
      {view.billStatus ? <p className="text-sm text-[#475569]">{HEALTHCODE_BILL_STATUS_HINTS[view.billStatus]}</p> : null}
      {view.canSetBillStatus ? <BillStatusForm key={view.billStatus ?? "none"} view={view} /> : null}
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
