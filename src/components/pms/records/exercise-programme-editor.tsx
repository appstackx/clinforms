"use client";
/**
 * The programme builder (ex03): a draft's title, note to the patient and case, and its exercises – picked from the
 * clinic's library (a copy is taken) or written for this patient – each with sets, repetitions, hold, times a day,
 * days a week and a note. Saved as one form (the exercises as JSON in a hidden field); the server validates again.
 * Browser-safe.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm, INPUT_CLASS, SelectField, Submit, TextAreaField, TextField, type RecordsAction } from "@/components/pms/records/form";
import { pmsButtonVariants } from "@/components/pms/ui";
import { MAX_PROGRAMME_ITEMS, doseLine, itemFromLibrary, type LibraryExercise, type ProgrammeItem } from "@/modules/pms/records/exercises";

type DoseKey = "sets" | "reps" | "holdSeconds" | "timesPerDay" | "daysPerWeek";
const DOSE: { key: DoseKey; label: string; max: number }[] = [
  { key: "sets", label: "Sets", max: 20 },
  { key: "reps", label: "Reps", max: 100 },
  { key: "holdSeconds", label: "Hold (s)", max: 600 },
  { key: "timesPerDay", label: "Times a day", max: 10 },
  { key: "daysPerWeek", label: "Days a week", max: 7 },
];

const blank = (): ProgrammeItem => ({ exerciseId: null, name: "", instructions: null, cautions: null, imageUrl: null, videoUrl: null, sets: null, reps: null, holdSeconds: null, timesPerDay: null, daysPerWeek: null, notes: null });

export function ProgrammeEditor({
  action,
  patientId,
  programmeId,
  rev,
  title,
  notes,
  caseId,
  cases,
  initialItems,
  library,
}: {
  action: RecordsAction;
  patientId: string;
  programmeId: string;
  rev: number;
  title: string;
  notes: string | null;
  caseId: string | null;
  cases: { value: string; label: string }[];
  initialItems: ProgrammeItem[];
  library: Pick<LibraryExercise, "id" | "name" | "bodyArea" | "instructions" | "cautions" | "imageUrl" | "videoUrl">[];
}) {
  const [items, setItems] = useState<ProgrammeItem[]>(initialItems);
  const [pick, setPick] = useState("");
  const full = items.length >= MAX_PROGRAMME_ITEMS;
  const update = (i: number, patch: Partial<ProgrammeItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const copy = xs.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const addFromLibrary = () => {
    const e = library.find((x) => x.id === pick);
    if (!e || full) return;
    setItems((xs) => [...xs, itemFromLibrary(e)]);
    setPick("");
  };
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  return (
    <ActionForm action={action} successMessage="Draft saved.">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="programmeId" value={programmeId} />
      <input type="hidden" name="rev" value={rev} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <TextField label="Title" name="title" required maxLength={120} defaultValue={title} hint="The patient sees this title." />
      <TextAreaField label="Note to the patient (optional)" name="notes" rows={3} maxLength={2000} defaultValue={notes} />
      {cases.length > 0 ? <SelectField label="Case (optional)" name="caseId" options={cases} defaultValue={caseId ?? ""} emptyLabel="No case" /> : <input type="hidden" name="caseId" value={caseId ?? ""} />}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-foreground">Exercises ({items.length})</legend>
        {items.length === 0 ? <p className="text-sm text-[#475569]">No exercises yet. Add one from the library or write your own.</p> : null}
        <ol className="space-y-3">
          {items.map((it, i) => {
            const base = `ex-${i}`;
            return (
              <li key={i} className="rounded-xl border border-border bg-white p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="mt-2 text-sm font-semibold tabular-nums text-[#475569]">{i + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-name`}>
                      Exercise name
                    </label>
                    <input id={`${base}-name`} className={`${INPUT_CLASS} h-9`} value={it.name} maxLength={120} required onChange={(e) => update(i, { name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {DOSE.map((d) => (
                        <div key={d.key}>
                          <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-${d.key}`}>
                            {d.label}
                          </label>
                          <input
                            id={`${base}-${d.key}`}
                            className={`${INPUT_CLASS} h-9 tabular-nums`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={d.max}
                            step={1}
                            value={it[d.key] ?? ""}
                            onChange={(e) => update(i, { [d.key]: num(e.target.value) } as Partial<ProgrammeItem>)}
                          />
                        </div>
                      ))}
                    </div>
                    {doseLine(it) ? <p className="text-xs text-[#0F766E]">{doseLine(it)}</p> : null}
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-primary-strong">Instructions, cautions and links</summary>
                      <div className="mt-2 space-y-2">
                        <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-ins`}>
                          Instructions
                        </label>
                        <textarea id={`${base}-ins`} className={INPUT_CLASS} rows={3} maxLength={2000} value={it.instructions ?? ""} onChange={(e) => update(i, { instructions: e.target.value || null })} />
                        <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-cau`}>
                          Take care
                        </label>
                        <textarea id={`${base}-cau`} className={INPUT_CLASS} rows={2} maxLength={1000} value={it.cautions ?? ""} onChange={(e) => update(i, { cautions: e.target.value || null })} />
                        <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-vid`}>
                          Video link (https)
                        </label>
                        <input id={`${base}-vid`} className={`${INPUT_CLASS} h-9`} maxLength={500} value={it.videoUrl ?? ""} onChange={(e) => update(i, { videoUrl: e.target.value || null })} />
                        <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-img`}>
                          Picture link (https)
                        </label>
                        <input id={`${base}-img`} className={`${INPUT_CLASS} h-9`} maxLength={500} value={it.imageUrl ?? ""} onChange={(e) => update(i, { imageUrl: e.target.value || null })} />
                      </div>
                    </details>
                    <label className="block text-xs font-medium text-[#334155]" htmlFor={`${base}-notes`}>
                      Note for this patient (optional)
                    </label>
                    <input id={`${base}-notes`} className={`${INPUT_CLASS} h-9`} maxLength={500} value={it.notes ?? ""} onChange={(e) => update(i, { notes: e.target.value || null })} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <button type="button" className={pmsButtonVariants({ variant: "secondary", size: "icon" })} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${it.name || `exercise ${i + 1}`} up`}>
                      <ArrowUp aria-hidden />
                    </button>
                    <button type="button" className={pmsButtonVariants({ variant: "secondary", size: "icon" })} onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${it.name || `exercise ${i + 1}`} down`}>
                      <ArrowDown aria-hidden />
                    </button>
                    <button type="button" className={pmsButtonVariants({ variant: "secondary", size: "icon" })} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} aria-label={`Remove ${it.name || `exercise ${i + 1}`}`}>
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs font-medium text-[#334155]" htmlFor="ex-pick">
              Add from the clinic&apos;s library
            </label>
            <select id="ex-pick" className={`${INPUT_CLASS} h-9`} value={pick} onChange={(e) => setPick(e.target.value)} disabled={library.length === 0}>
              <option value="">{library.length === 0 ? "The library is empty (Set-up → Exercises)" : "Choose an exercise"}</option>
              {library.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.bodyArea ? ` – ${e.bodyArea}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={pmsButtonVariants({ variant: "secondary" })} onClick={addFromLibrary} disabled={!pick || full}>
            <Plus aria-hidden />
            Add
          </button>
          <button type="button" className={pmsButtonVariants({ variant: "secondary" })} onClick={() => !full && setItems((xs) => [...xs, blank()])} disabled={full}>
            <Plus aria-hidden />
            Write your own
          </button>
        </div>
      </fieldset>
      <Submit pendingText="Saving…">Save draft</Submit>
    </ActionForm>
  );
}
