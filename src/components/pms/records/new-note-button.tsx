"use client";
/**
 * "New note" on the record: posts the record's newNote action (it picks the template, the open case and today's
 * appointment, or reopens the member's own draft from today) and the editor opens. A refusal is shown next to it.
 */
import { useFormState, useFormStatus } from "react-dom";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { cn } from "@/lib/utils";
import type { RecordsAction } from "./form";

function Inner({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cn(className, pending && "cursor-progress opacity-80")} aria-busy={pending || undefined} disabled={pending}>
      {children}
    </button>
  );
}

export function NewNoteButton({ action, patientId, caseId, appointmentId, className, children }: { action: RecordsAction; patientId: string; caseId: string | null; appointmentId: string | null; className?: string; children: React.ReactNode }) {
  const [state, formAction] = useFormState(action, null as RecordsActionState);
  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="patientId" value={patientId} />
      {caseId ? <input type="hidden" name="caseId" value={caseId} /> : null}
      {appointmentId ? <input type="hidden" name="appointmentId" value={appointmentId} /> : null}
      <Inner className={className}>{children}</Inner>
      {state && state.ok === false ? (
        <span role="alert" className="basis-full text-xs text-destructive-strong">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
