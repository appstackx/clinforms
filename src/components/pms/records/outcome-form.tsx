"use client";
/**
 * Record an outcome measure: choose the measure, enter the patient's answer to each item (from the clinic's own
 * questionnaire) and see the score before saving. The server scores it again – this preview is only a help.
 */
import { useState } from "react";
import { MEASURES, OUTCOME_MEASURES, formatScore, scoreOutcome, type OutcomeMeasureId } from "@/modules/pms/records/outcomes";
import { ActionForm, INPUT_CLASS, SelectField, Submit, TextField, type Option, type RecordsAction } from "./form";

export function OutcomeForm({ action, patientId, cases, defaultCaseId, today }: { action: RecordsAction; patientId: string; cases: Option[]; defaultCaseId?: string | null; today: string }) {
  const [measure, setMeasure] = useState<OutcomeMeasureId>("nprs");
  const [values, setValues] = useState<Record<string, string>>({});
  const [activities, setActivities] = useState<Record<string, string>>({});
  const def = MEASURES[measure];
  const items: Record<string, number | null> = {};
  for (const item of def.items) items[item.key] = values[item.key] === undefined || values[item.key] === "" ? null : Number(values[item.key]);
  const preview = scoreOutcome(measure, def.namedActivities ? { items, activities } : { items });
  const answered = Object.values(items).filter((v) => v !== null).length;
  const choices = Array.from({ length: def.max - def.min + 1 }, (_, i) => def.min + i);

  return (
    <ActionForm action={action} successMessage="The measure is recorded.">
      <input type="hidden" name="patientId" value={patientId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="outcome-measure" className="block text-sm font-medium text-slate-800">
            Measure
          </label>
          <select
            id="outcome-measure"
            name="measure"
            value={measure}
            onChange={(e) => {
              setMeasure(e.target.value as OutcomeMeasureId);
              setValues({});
              setActivities({});
            }}
            className={`${INPUT_CLASS} h-10`}
          >
            {OUTCOME_MEASURES.map((id) => (
              <option key={id} value={id}>
                {MEASURES[id].short} – {MEASURES[id].name}
              </option>
            ))}
          </select>
        </div>
        <TextField label="Date" name="takenOn" type="date" defaultValue={today} required />
        <SelectField label="Case" name="caseId" options={cases} defaultValue={defaultCaseId} emptyLabel="Not linked to a case" />
      </div>
      <p className="text-sm text-slate-700">{def.instructions}</p>
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">{def.short} answers</legend>
        <div className={def.namedActivities ? "space-y-3" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"}>
          {def.items.map((item) => (
            <div key={`${measure}-${item.key}`} className={def.namedActivities ? "grid gap-2 sm:grid-cols-[1fr_9rem]" : "space-y-1.5"}>
              {def.namedActivities ? (
                <div className="space-y-1.5">
                  <label htmlFor={`activity-${item.key}`} className="block text-sm font-medium text-slate-800">
                    {item.label}
                  </label>
                  <input
                    id={`activity-${item.key}`}
                    name={`activity_${item.key}`}
                    maxLength={120}
                    value={activities[item.key] ?? ""}
                    onChange={(e) => setActivities({ ...activities, [item.key]: e.target.value })}
                    placeholder="In the patient's words"
                    className={`${INPUT_CLASS} h-10`}
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <label htmlFor={`item-${item.key}`} className="block text-sm font-medium text-slate-800">
                  {def.namedActivities ? <span className="sr-only">{item.label}: </span> : null}
                  {def.namedActivities ? "Rating" : item.label}
                </label>
                <select id={`item-${item.key}`} name={`item_${item.key}`} value={values[item.key] ?? ""} onChange={(e) => setValues({ ...values, [item.key]: e.target.value })} className={`${INPUT_CLASS} h-10`}>
                  <option value="">Not answered</option>
                  {choices.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <div role="status" aria-live="polite" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        {answered === 0
          ? "The score appears as you enter the answers."
          : preview.ok
            ? `Score: ${formatScore(measure, preview.scoreTenths)}${preview.band ? ` – ${preview.band}` : ""}${def.higherIsBetter ? " (higher is better)" : " (lower is better)"}`
            : preview.error}
      </div>
      <Submit pendingText="Recording…">Record {def.short}</Submit>
    </ActionForm>
  );
}
