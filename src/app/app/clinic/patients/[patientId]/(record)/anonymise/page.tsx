import type { Metadata } from "next";
import { ActionForm, CheckboxField, Submit, TextField } from "@/components/pms/records/form";
import { Card } from "@/components/pms/records/ui";
import { PmsNotice } from "@/components/pms/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { requireClinicActor } from "@/server/pms/actor";
import { anonymiseEligibilityFor } from "@/server/pms/records/patients-service";
import { patientOr404 } from "@/server/pms/records/record";
import { anonymiseRecord } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Anonymise record", robots: { index: false, follow: false } };

/**
 * Anonymise a record (K2-PAT-010; owners and administrators): only after the record-keeping period, never on hold,
 * confirmed by typing the patient's number. Who the patient was and every free text go; dates and scores stay.
 */
export default async function AnonymisePage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.merge" });
  const patient = await patientOr404(actor, params.patientId);
  const state = await anonymiseEligibilityFor(actor, patient.id);
  return (
    <div className="max-w-2xl">
      <Card title="Anonymise this record">
        {!state.ok ? (
          <PmsNotice tone="error" title="Couldn't check the record">{state.error}</PmsNotice>
        ) : !state.value.check.allowed ? (
          <PmsNotice tone="info" title="Not possible yet">
            {state.value.check.message}
            {state.value.lastTreatmentOn ? ` Last treatment on record: ${formatUkDate(state.value.lastTreatmentOn)}.` : ""}
          </PmsNotice>
        ) : (
          <ActionForm action={anonymiseRecord} successMessage="The record is anonymised.">
            <PmsNotice tone="warning" title="This cannot be undone">
              The patient&apos;s name, date of birth, contact details, alerts, notes&apos; text, files and clinical flags are removed for good. Dates and scores stay for the clinic&apos;s figures.
            </PmsNotice>
            <input type="hidden" name="patientId" value={patient.id} />
            <TextField label={`Type the patient's number (${state.value.patientNumber}) to confirm`} name="confirmNumber" inputMode="numeric" required />
            <CheckboxField label="I have checked that nothing requires the record to be kept (complaint, claim, safeguarding)" name="reviewed" />
            <Submit variant="danger" pendingText="Anonymising…">
              Anonymise record
            </Submit>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
