"use client";
/**
 * The ICD-10 diagnosis code field with a small searchable list of common musculoskeletal codes (HC10,
 * src/modules/pms/billing/icd10.ts). Any code in ICD-10 format can be typed; the list only helps. The format is
 * checked as you type and again on the server.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { PmsButton, useToast } from "@/components/pms/ui";
import { ICD10_FORMAT_MESSAGE, icd10Label, normaliseIcd10, searchIcd10 } from "@/modules/pms/billing/icd10";
import { cn } from "@/lib/utils";

export interface DiagnosisPickerProps {
  id: string;
  label: string;
  hint?: string;
  initial: string | null;
  canEdit: boolean;
  save: (code: string) => Promise<{ ok: true; code: string | null } | { ok: false; error: string }>;
  /** Shown when nothing is recorded. */
  emptyText?: string;
}

export function DiagnosisPicker({ id, label, hint, initial, canEdit, save, emptyText = "None recorded" }: DiagnosisPickerProps) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = React.useState(initial ?? "");
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const listId = `${id}-options`;
  const options = searchIcd10(value);
  const trimmed = value.trim();
  const invalid = trimmed !== "" && normaliseIcd10(trimmed) === null;
  const dirty = (normaliseIcd10(trimmed) ?? trimmed) !== (initial ?? "");

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{label}</span>
        <span data-testid={`${id}-value`}>{initial ? `${initial}${icd10Label(initial) ? ` – ${icd10Label(initial)}` : ""}` : emptyText}</span>
      </div>
    );
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (invalid) {
      setError(ICD10_FORMAT_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    const r = await save(trimmed);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setValue(r.code ?? "");
    toast.success(r.code ? `Diagnosis code ${r.code} saved.` : "Diagnosis code cleared.");
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-1.5" onSubmit={submit} data-testid={id}>
      <label htmlFor={id + "-input"} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative flex flex-wrap items-start gap-2">
        <div className="relative min-w-[220px] flex-1">
          <input
            id={id + "-input"}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={invalid || undefined}
            aria-describedby={hint ? `${id}-hint` : undefined}
            autoComplete="off"
            maxLength={20}
            value={value}
            placeholder="Code or condition, e.g. M54.5 or back pain"
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              setError(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            className={cn("h-9 w-full rounded-[8px] border border-[#94A3B8] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", invalid && "border-destructive")}
            data-testid={`${id}-input`}
          />
          {open && options.length > 0 ? (
            <ul id={listId} role="listbox" className="absolute left-0 right-0 top-10 z-20 max-h-64 overflow-auto rounded-[8px] border border-border bg-white py-1 shadow-lg">
              {options.map((o) => (
                <li key={o.code} role="option" aria-selected={normaliseIcd10(value) === o.code}>
                  <button
                    type="button"
                    className="flex w-full gap-3 px-3 py-1.5 text-left text-sm hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9] focus-visible:outline-none"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setValue(o.code);
                      setOpen(false);
                    }}
                  >
                    <span className="w-14 shrink-0 font-mono font-semibold">{o.code}</span>
                    <span>{o.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <PmsButton type="submit" variant="secondary" loading={saving} disabled={!dirty || invalid} data-testid={`${id}-save`}>
          Save
        </PmsButton>
      </div>
      {trimmed && !invalid && icd10Label(normaliseIcd10(trimmed)) ? <span className="text-xs text-[#475569]">{icd10Label(normaliseIcd10(trimmed))}</span> : null}
      {invalid ? <span className="text-xs text-destructive-strong">{ICD10_FORMAT_MESSAGE}</span> : null}
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
    </form>
  );
}
