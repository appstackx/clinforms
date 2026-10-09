"use client";

/**
 * Hand editing of a fillable-PDF answer space beyond its field name (inside the field editor's "Edit
 * the location by hand"):
 * - the label printed beside each value of a radio group / list / multi-box tick box ("Choice5" →
 *   "Mrs"), so the printed answer selects the right value;
 * - one question across several tick boxes ("Yes = Check Box5", "No = Check Box6"): the matching box is
 *   ticked and the others cleared;
 * - one-character boxes: which boxes, left to right, and whether a date is written DDMMYYYY / DDMMYY.
 *
 * Owner: studio-a agent.
 */
import { PdfCharFormatSchema } from "../../../core/schemas";
import type { FormAnchor, PdfCharFieldsAnchor, PdfFieldAnchor } from "../../../core/types";
import { Input } from "../../primitives";
import { FieldLabel, Select, Textarea } from "../shared/ui-bits";
import { CHAR_FORMAT_LABELS, formatOptionFields, parseFieldNames, parseOptionFields, withOptionFields, withOptionLabel } from "./mapping";

export interface PdfAnchorFieldsProps {
  anchor: PdfFieldAnchor | PdfCharFieldsAnchor;
  idPrefix: string;
  onChange(anchor: FormAnchor): void;
}

export function PdfAnchorFields({ anchor, idPrefix, onChange }: PdfAnchorFieldsProps) {
  if (anchor.kind === "pdf_char_fields") {
    return (
      <>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={`${idPrefix}-chars`} hint="(one per line, left to right)">
            Character boxes
          </FieldLabel>
          <Textarea
            key={anchor.fieldNames.join("|")}
            id={`${idPrefix}-chars`}
            rows={4}
            className="font-mono text-[11px]"
            defaultValue={anchor.fieldNames.join("\n")}
            onBlur={(e) => {
              const names = parseFieldNames(e.target.value);
              if (names.length > 0) onChange({ ...anchor, fieldNames: names });
            }}
          />
        </div>
        <div>
          <FieldLabel htmlFor={`${idPrefix}-charfmt`}>Written as</FieldLabel>
          <Select id={`${idPrefix}-charfmt`} value={anchor.format} onChange={(e) => onChange({ ...anchor, format: PdfCharFormatSchema.parse(e.target.value) })}>
            {PdfCharFormatSchema.options.map((f) => (
              <option key={f} value={f}>
                {CHAR_FORMAT_LABELS[f]}
              </option>
            ))}
          </Select>
        </div>
      </>
    );
  }

  const values = anchor.optionFields?.length ? [] : anchor.options ?? [];
  return (
    <>
      {values.length > 1 ? (
        <div className="sm:col-span-2 space-y-1.5">
          <p className="text-xs font-medium text-slate-700">Printed label for each value</p>
          {values.map((v, i) => (
            <div key={`${v}-${i}`} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-2">
              <label htmlFor={`${idPrefix}-lbl-${i}`} className="truncate font-mono text-[11px] text-slate-500" title={v}>
                {v}
              </label>
              <Input
                id={`${idPrefix}-lbl-${i}`}
                value={anchor.optionLabels?.[i] ?? ""}
                placeholder="As printed beside the box"
                onChange={(e) => onChange(withOptionLabel(anchor, i, e.target.value))}
              />
            </div>
          ))}
        </div>
      ) : null}
      {anchor.fieldType === "checkbox" ? (
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={`${idPrefix}-optfields`} hint="(one per line: Option = field name; empty for a single box)">
            One tick box per option
          </FieldLabel>
          <Textarea
            key={formatOptionFields(anchor.optionFields)}
            id={`${idPrefix}-optfields`}
            rows={3}
            className="font-mono text-[11px]"
            defaultValue={formatOptionFields(anchor.optionFields)}
            placeholder={"Yes = Check Box5\nNo = Check Box6"}
            onBlur={(e) => onChange(withOptionFields(anchor, parseOptionFields(e.target.value)))}
          />
        </div>
      ) : null}
    </>
  );
}
