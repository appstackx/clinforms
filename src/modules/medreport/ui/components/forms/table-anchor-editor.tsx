"use client";

/**
 * Mapping-editor parts for table questions and printed tick boxes (S2):
 * - AppointmentColumnsEditor: what each printed column of a table holds when it is filled from the
 *   appointment record (date, clinician, treatment, clinic, fee, paid – or left blank);
 * - AnchorJsonEditor: the exact table rows / columns, tick boxes or date slots, edited as JSON (staff
 *   rarely need it; a hand-made map is checked against the schema before it is used).
 *
 * Owner: S2 (pdf-tables-flat).
 */
import { useEffect, useState } from "react";
import { APPOINTMENT_COLUMN_LABELS, tableColumnsOf } from "../../../core/form-tables";
import { AppointmentColumnSchema, FormAnchorSchema } from "../../../core/schemas";
import type { AppointmentColumn, FormAnchor } from "../../../core/types";
import { FieldLabel, Select, Textarea } from "../shared/ui-bits";

export function AppointmentColumnsEditor({
  id,
  anchor,
  columns,
  onChange,
}: {
  id: string;
  anchor: FormAnchor;
  columns: Record<string, AppointmentColumn>;
  onChange(columns: Record<string, AppointmentColumn>): void;
}) {
  const printed = tableColumnsOf(anchor);
  if (printed.length === 0) {
    return <p className="text-xs text-amber-800">This question has no table position yet, so its columns cannot be chosen.</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {printed.map((c) => (
        <div key={c.key}>
          <FieldLabel htmlFor={`${id}-col-${c.key}`}>{c.header || c.key}</FieldLabel>
          <Select
            id={`${id}-col-${c.key}`}
            value={columns[c.key] ?? ""}
            onChange={(e) => {
              const next = { ...columns };
              if (e.target.value) next[c.key] = AppointmentColumnSchema.parse(e.target.value);
              else delete next[c.key];
              onChange(next);
            }}
          >
            <option value="">Left blank</option>
            {AppointmentColumnSchema.options.map((o) => (
              <option key={o} value={o}>
                {APPOINTMENT_COLUMN_LABELS[o]}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

/** The anchor as JSON; applied on blur when it is a valid anchor. */
export function AnchorJsonEditor({ id, anchor, onChange }: { id: string; anchor: FormAnchor; onChange(anchor: FormAnchor): void }) {
  const shown = JSON.stringify(anchor, null, 1);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(shown);
    setError(null);
  }, [shown]);
  return (
    <div className="sm:col-span-2">
      <FieldLabel htmlFor={`${id}-anchor-json`} hint="(PDF points from the bottom-left of the page)">
        Exact position
      </FieldLabel>
      <Textarea
        id={`${id}-anchor-json`}
        rows={6}
        className="font-mono text-[11px]"
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const parsed = FormAnchorSchema.safeParse(JSON.parse(text));
            if (!parsed.success) return setError("This is not a valid position – check the numbers and names.");
            setError(null);
            if (JSON.stringify(parsed.data) !== JSON.stringify(anchor)) onChange(parsed.data);
          } catch {
            setError("This is not valid JSON.");
          }
        }}
      />
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
