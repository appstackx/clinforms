"use client";
/**
 * Clinical flags of a record (K2-PAT-014; clinicians, owners, administrators – never reception): the active flags,
 * each with "End" (kept in the record's history, never deleted), and a field to add one. Shown on the record's
 * Details page; the header shows the active flags as "Clinical: …" pills.
 */
import { AlertTriangle } from "lucide-react";
import { ActionForm, Submit, TextField, type RecordsAction } from "./form";

export interface FlagView {
  id: string;
  rev: number;
  text: string;
  since: string;
}

export function ClinicalFlagsEditor({ patientId, flags, canEdit, addAction, endAction }: { patientId: string; flags: FlagView[]; canEdit: boolean; addAction: RecordsAction; endAction: RecordsAction }) {
  return (
    <div className="flex flex-col gap-3">
      {flags.length ? (
        <ul className="flex flex-col gap-2">
          {flags.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#FBD38D] bg-[#FFFBEB] px-3.5 py-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#864E0E]" aria-hidden />
              <span className="min-w-0 flex-1">
                <strong className="font-semibold text-[#864E0E]">{f.text}</strong>
                <span className="block text-xs text-[#475569]">Since {f.since}</span>
              </span>
              {canEdit ? (
                <ActionForm action={endAction} className="space-y-0" successMessage="Ended.">
                  <input type="hidden" name="patientId" value={patientId} />
                  <input type="hidden" name="flagId" value={f.id} />
                  <input type="hidden" name="expectedRev" value={f.rev} />
                  <Submit variant="secondary" pendingText="Ending…" confirmText={`End the flag "${f.text}"? It stays in the record's history.`}>
                    End<span className="sr-only"> flag {f.text}</span>
                  </Submit>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No clinical flags.</p>
      )}
      {canEdit ? (
        <ActionForm action={addAction} className="space-y-3" successMessage="Clinical flag added.">
          <input type="hidden" name="patientId" value={patientId} />
          <TextField label="Add a clinical flag" name="text" maxLength={120} hint='Shown to clinicians on the record and in notes, e.g. "On anticoagulants". Never shown to reception.' />
          <Submit variant="secondary" pendingText="Adding…">
            Add flag
          </Submit>
        </ActionForm>
      ) : null}
    </div>
  );
}
