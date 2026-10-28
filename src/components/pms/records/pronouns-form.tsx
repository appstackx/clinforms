"use client";
/** The patient's pronouns (shown beside the title in the record's header) – saved on their own, revision-checked. */
import { ActionForm, Submit, TextField, type RecordsAction } from "./form";

export function PronounsForm({ action, patientId, rev, pronouns }: { action: RecordsAction; patientId: string; rev: number; pronouns: string | null }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3 space-y-0" successMessage="Pronouns saved.">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="expectedRev" value={rev} />
      <TextField label="Pronouns" name="pronouns" defaultValue={pronouns} maxLength={40} hint="Optional, e.g. she/her" className="w-full max-w-[260px]" />
      <Submit variant="secondary" pendingText="Saving…">
        Save pronouns
      </Submit>
    </ActionForm>
  );
}
