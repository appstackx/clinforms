/**
 * 15/11/2026 (Khuram): a self-serve trial's SAMPLE clinic has no report forms (Reports is paused there on purpose –
 * src/server/trial/sample.ts); they are in the owner's real clinic. This card says so and switches to the real clinic
 * in one click (the same clinic-switch form as "Choose a clinic"). Server component; the form is the client part.
 */
import { SwitchClinicForm } from "@/app/app/session-forms";
import { SubmitButton } from "@/components/account/form-controls";

export function ReportFormsElsewhere({ label, clinicName, organizationId, compact = false }: { label: string; clinicName: string; organizationId: string; compact?: boolean }) {
  return (
    <SwitchClinicForm
      organizationId={organizationId}
      className={compact ? "rounded-[10px] border border-[#BFD0F5] bg-[#EFF4FF] p-3 text-xs text-[#334155]" : "rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-700"}
    >
      <p className={compact ? "font-semibold text-[#1842B4]" : "text-base font-semibold text-blue-900"}>{label}</p>
      <p className="mt-1">
        This sample clinic has no {label.toLowerCase()}. They are in your own clinic, {clinicName}.
      </p>
      <SubmitButton variant="secondary" className={compact ? "mt-2 h-8 w-full px-3 text-xs" : "mt-3"} pendingText="Opening…">
        Switch to your clinic
      </SubmitButton>
    </SwitchClinicForm>
  );
}
