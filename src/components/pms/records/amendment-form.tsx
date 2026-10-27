"use client";
/** Add an amendment to a signed note: an addendum, a correction of one section, or marking the note as entered in error. */
import { useState } from "react";
import { AMENDMENT_KIND_LABELS, type AmendmentKind } from "@/modules/pms/records/notes";
import { ActionForm, SelectField, Submit, TextAreaField, TextField, type Option, type RecordsAction } from "./form";
import { INPUT_CLASS } from "./form";

const HELP: Record<AmendmentKind, string> = {
  addendum: "Add information that came later (a phone call, a result). The note itself stays as it was signed.",
  correction: "Correct one section. The original text stays visible with your correction and the reason.",
  entered_in_error: "The whole note was written in error (for example in the wrong patient's record). It stays readable, marked as an error.",
};

export function AmendmentForm({ action, patientId, noteId, sections, enteredInError }: { action: RecordsAction; patientId: string; noteId: string; sections: Option[]; enteredInError: boolean }) {
  const [kind, setKind] = useState<AmendmentKind>("addendum");
  const kinds = (Object.keys(AMENDMENT_KIND_LABELS) as AmendmentKind[]).filter((k) => !(k === "entered_in_error" && enteredInError));
  return (
    <ActionForm action={action} successMessage="The amendment is added and locked.">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="noteId" value={noteId} />
      <div className="space-y-1.5">
        <label htmlFor="amendment-kind" className="block text-sm font-medium text-slate-800">
          Kind of amendment
        </label>
        <select id="amendment-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as AmendmentKind)} aria-describedby="amendment-kind-hint" className={`${INPUT_CLASS} h-10 sm:max-w-xs`}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === "entered_in_error" ? "Mark the note as entered in error" : AMENDMENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <p id="amendment-kind-hint" className="text-xs text-slate-600">
          {HELP[kind]}
        </p>
      </div>
      {kind === "correction" ? <SelectField label="Section" name="sectionKey" options={sections} emptyLabel="Choose the section" required /> : null}
      {kind !== "entered_in_error" ? <TextAreaField label={kind === "correction" ? "Corrected text" : "Addendum"} name="text" rows={3} required /> : <input type="hidden" name="text" value="" />}
      {kind !== "addendum" ? <TextField label="Reason" name="reason" required maxLength={500} /> : null}
      <Submit pendingText="Adding…" confirmText="Add this amendment? It is locked as soon as it is added.">
        {kind === "entered_in_error" ? "Mark as entered in error" : "Add amendment"}
      </Submit>
    </ActionForm>
  );
}
