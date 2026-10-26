"use client";
/**
 * The draft note editor: one box per template section, the body chart when the template has one, the consultation
 * date and case. "Save draft" keeps it as a draft; "Sign and lock" saves and signs in one go (after a confirmation):
 * from then on the note can only be amended. Leaving the page with unsaved changes asks first.
 */
import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import type { BodyChart } from "@/modules/pms/records/body-chart";
import type { TemplateSnapshot } from "@/modules/pms/records/templates";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { BodyChartEditor } from "./body-chart-editor";
import { INPUT_CLASS, Submit, type Option, type RecordsAction } from "./form";

export interface NoteEditorProps {
  action: RecordsAction;
  patientId: string;
  noteId: string;
  rev: number;
  template: TemplateSnapshot;
  sections: Record<string, string>;
  bodyChart: BodyChart | null;
  seenOn: string;
  caseId: string | null;
  cases: Option[];
  canSign: boolean;
  today: string;
}

export function NoteEditor(props: NoteEditorProps) {
  const [state, formAction] = useFormState(props.action, null as RecordsActionState);
  const [dirty, setDirty] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const rev = Math.max(props.rev, state?.rev ?? 0);

  useEffect(() => {
    if (state) {
      noticeRef.current?.focus();
      if (state.ok) setDirty(false);
    }
  }, [state]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const errors = state && state.ok === false ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} onChange={() => setDirty(true)} className="space-y-5">
      <input type="hidden" name="patientId" value={props.patientId} />
      <input type="hidden" name="noteId" value={props.noteId} />
      <input type="hidden" name="expectedRev" value={rev} />
      <div ref={noticeRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {state?.ok === false ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </div>
        ) : null}
        {state?.ok === true ? (
          <div role="status" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {state.message ?? "Saved."}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="note-seen-on" className="block text-sm font-medium text-slate-800">
            Consultation date
          </label>
          <input id="note-seen-on" name="seenOn" type="date" max={props.today} defaultValue={props.seenOn} required aria-invalid={errors.seenOn ? true : undefined} aria-describedby={errors.seenOn ? "note-seen-on-error" : undefined} className={`${INPUT_CLASS} h-10`} />
          {errors.seenOn ? (
            <p id="note-seen-on-error" className="text-xs font-medium text-red-700">
              {errors.seenOn}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="note-case" className="block text-sm font-medium text-slate-800">
            Case
          </label>
          <select id="note-case" name="caseId" defaultValue={props.caseId ?? ""} className={`${INPUT_CLASS} h-10`}>
            <option value="">Not linked to a case</option>
            {props.cases.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {props.template.sections.map((s) => {
        const id = `note-section-${s.key}`;
        const error = errors[`sections.${s.key}`] ?? errors[s.key];
        return (
          <div key={s.key} className="space-y-1.5">
            <label htmlFor={id} className="block text-sm font-semibold text-slate-900">
              {s.label}
            </label>
            {s.hint ? (
              <p id={`${id}-hint`} className="text-xs text-slate-600">
                {s.hint}
              </p>
            ) : null}
            {s.kind === "line" ? (
              <input id={id} name={`section_${s.key}`} defaultValue={props.sections[s.key] ?? ""} maxLength={300} aria-describedby={s.hint ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined} className={`${INPUT_CLASS} h-10`} />
            ) : (
              <textarea id={id} name={`section_${s.key}`} defaultValue={props.sections[s.key] ?? ""} rows={4} aria-describedby={s.hint ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined} className={`${INPUT_CLASS} py-2 leading-relaxed`} />
            )}
            {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
          </div>
        );
      })}

      {props.template.bodyChart ? (
        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Body chart</legend>
          <BodyChartEditor initial={props.bodyChart} onChange={() => setDirty(true)} />
        </fieldset>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Submit name="intent" value="save" variant="secondary" pendingText="Saving…">
          Save draft
        </Submit>
        {props.canSign ? (
          <Submit name="intent" value="sign" pendingText="Signing…" confirmText="Sign and lock this note? Once signed it cannot be changed – only amended, with your name and the time shown.">
            Sign and lock
          </Submit>
        ) : null}
        <span className="text-xs text-slate-600">{dirty ? "Unsaved changes" : "All changes saved"}</span>
      </div>
    </form>
  );
}
