"use client";

/**
 * A table answer on the review screen (S2): the rows as a simple table under the printed column
 * headers. Staff can correct a cell, add a row or remove one (each change is logged); a signed form
 * shows the table read-only.
 *
 * Owner: S2 (pdf-tables-flat).
 */
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { tableCapacity } from "../../../core/form-tables";
import type { FormAnswerRow, FormField } from "../../../core/types";
import { cn } from "../../primitives";
import { tableColumnsForReview } from "./table-answer-model";

export interface TableAnswerProps {
  questionKey: string;
  label: string;
  field: FormField | null | undefined;
  rows: FormAnswerRow[];
  readOnly: boolean;
  onChange(rows: FormAnswerRow[]): void;
}

export function TableAnswer({ questionKey, label, field, rows, readOnly, onChange }: TableAnswerProps) {
  const columns = tableColumnsForReview(field, rows);
  const capacity = field ? tableCapacity(field.anchor) : 0;
  const [draft, setDraft] = useState<FormAnswerRow[]>(rows);
  const shown = JSON.stringify(rows);
  useEffect(() => {
    setDraft(JSON.parse(shown) as FormAnswerRow[]);
  }, [shown]);

  const commit = (next: FormAnswerRow[]) => {
    if (JSON.stringify(next) !== shown) onChange(next);
  };
  const setCell = (i: number, key: string, value: string) => setDraft((d) => d.map((row, r) => (r === i ? { ...row, [key]: value } : row)));
  const emptyRow = (): FormAnswerRow => Object.fromEntries(columns.map((c) => [c.key, ""]));

  if (columns.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-500">This table has no columns in the form map.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[32rem] border-collapse text-left text-[13px]">
          <caption className="sr-only">Answer to “{label}”</caption>
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="w-10 px-2 py-1.5 font-medium">
                Row
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-2 py-1.5 font-medium normal-case tracking-normal">
                  {c.header || c.key}
                </th>
              ))}
              {!readOnly && (
                <th scope="col" className="w-9 px-1 py-1.5">
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {draft.length === 0 && (
              <tr>
                <td colSpan={columns.length + (readOnly ? 1 : 2)} className="px-2 py-2 text-slate-500">
                  No rows yet.
                </td>
              </tr>
            )}
            {draft.map((row, i) => (
              <tr key={i} className={cn("border-t border-slate-100", capacity > 0 && i >= capacity && "bg-amber-50/60")}>
                <td className="px-2 py-1 align-top tabular-nums text-slate-500">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-1 align-top">
                    {readOnly ? (
                      <span className="block px-1 py-0.5 text-slate-900">{row[c.key] || <span className="text-slate-400">–</span>}</span>
                    ) : (
                      <input
                        type="text"
                        aria-label={`${c.header || c.key}, row ${i + 1} of “${label}”`}
                        id={`table-${questionKey}-${i}-${c.key}`}
                        value={row[c.key] ?? ""}
                        onChange={(e) => setCell(i, c.key, e.target.value)}
                        onBlur={() => commit(draft)}
                        className="h-8 w-full min-w-[5rem] rounded-md border border-transparent bg-transparent px-1 text-[13px] text-slate-900 hover:border-slate-200 focus:border-[#0D9488] focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                      />
                    )}
                  </td>
                ))}
                {!readOnly && (
                  <td className="px-1 py-1 align-top">
                    <button
                      type="button"
                      onClick={() => {
                        const next = draft.filter((_, r) => r !== i);
                        setDraft(next);
                        commit(next);
                      }}
                      aria-label={`Remove row ${i + 1} of “${label}”`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!readOnly && (
          <button
            type="button"
            onClick={() => setDraft((d) => [...d, emptyRow()])}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add a row
          </button>
        )}
        {capacity > 0 && draft.length > capacity && (
          <p className="text-[12px] text-amber-800">
            The form has room for {capacity} row{capacity === 1 ? "" : "s"}; rows {capacity + 1}–{draft.length} are printed on the continuation sheet.
          </p>
        )}
      </div>
    </div>
  );
}
