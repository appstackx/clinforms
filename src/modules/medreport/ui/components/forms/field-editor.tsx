"use client";

/**
 * Editor for one question of a referrer's form map: what is asked, the answer type, where the answer
 * comes from (fill source) and where it goes in the original document (anchor).
 *
 * Owner: studio-a agent.
 */
import { useId } from "react";
import { Crosshair, Trash2 } from "lucide-react";
import {
  ANSWER_TYPE_LABELS,
  COMPUTED_FACT_FORMAT_LABELS,
  FILL_SOURCE_LABELS,
  REGISTRATION_PATH_LABELS,
  SIGNOFF_PART_LABELS,
} from "../../../core/labels";
import {
  AnswerTypeSchema,
  ComputedFactFormatSchema,
  DocxAnchorTargetSchema,
  FactIdSchema,
  PdfFieldTypeSchema,
  RegistrationPathSchema,
  SignoffPartSchema,
} from "../../../core/schemas";
import type { FillSource, FormAnchor, FormField, FormKind } from "../../../core/types";
import { Button, Input, cn } from "../../primitives";
import { WORDING } from "../../wording";
import { FILL_SOURCE_SHORT, FieldLabel, Select, Textarea } from "../shared/ui-bits";
import { DOCX_TARGET_LABELS, FACT_OPTIONS, describeAnchor, fillSourceOfKind, parseOptions, plainAnchorDescription } from "./mapping";

const FILL_KINDS: FillSource["kind"][] = ["registration", "computed_fact", "fixed", "notes_narrative", "clinician_opinion", "signoff", "leave_blank"];

const FILL_HELP: Record<FillSource["kind"], string> = {
  registration: WORDING.byCode.fillHelpRegistration,
  computed_fact: WORDING.byCode.fillHelpComputed,
  notes_narrative: "Drafted strictly from the physiotherapy notes, with the note IDs it relies on. Anything not recorded is left blank and flagged.",
  clinician_opinion:
    "Only an opinion a clinician actually recorded is used, attributed with its date (“On 07/07/2026 the treating physiotherapist recorded …”). Otherwise left blank for the clinician.",
  signoff: "Completed from the approving clinician's server-signed receipt. Blank on drafts.",
  leave_blank: "Not completed by the clinic (e.g. “for office use”).",
  fixed: "The same answer for every patient (e.g. “Physiotherapist”, “United Kingdom”), filled in by the system. Tick boxes take Yes or No; choices take an option as printed.",
};

const OPTION_TYPES = new Set(["single_choice", "yes_no", "checkbox"]);

export interface FieldEditorProps {
  field: FormField;
  formKind: FormKind;
  onChange(field: FormField): void;
  onRemove(): void;
  picking: boolean;
  onTogglePick(): void;
  readOnly?: boolean;
}

export function FieldEditor({ field, formKind, onChange, onRemove, picking, onTogglePick, readOnly }: FieldEditorProps) {
  const id = useId();
  const set = <K extends keyof FormField>(key: K, value: FormField[K]) => onChange({ ...field, [key]: value });
  const setSource = (fillSource: FillSource) => onChange({ ...field, fillSource });
  const setAnchor = (anchor: FormAnchor) => onChange({ ...field, anchor });
  const src = field.fillSource;
  const a = field.anchor;

  return (
    <fieldset disabled={readOnly} className="space-y-4 rounded-xl border border-teal-200 bg-white p-4 shadow-sm">
      <legend className="sr-only">Edit {field.id}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-label`}>Question as printed</FieldLabel>
          <Input id={`${id}-label`} value={field.label} onChange={(e) => set("label", e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-section`} hint="(the form's own heading)">
            Section
          </FieldLabel>
          <Input id={`${id}-section`} value={field.section ?? ""} onChange={(e) => set("section", e.target.value || undefined)} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-type`}>Answer type</FieldLabel>
          <Select
            id={`${id}-type`}
            value={field.answerType}
            onChange={(e) => set("answerType", AnswerTypeSchema.parse(e.target.value))}
          >
            {AnswerTypeSchema.options.map((t) => (
              <option key={t} value={t}>
                {ANSWER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        {OPTION_TYPES.has(field.answerType) ? (
          <div className="sm:col-span-2">
            <FieldLabel htmlFor={`${id}-options`} hint="(one per line, exactly as printed)">
              Options
            </FieldLabel>
            <Textarea
              id={`${id}-options`}
              rows={3}
              defaultValue={(field.options ?? []).join("\n")}
              onBlur={(e) => set("options", parseOptions(e.target.value))}
            />
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-guidance`} hint="(what the referrer wants – also the brief for drafting)">
            Guidance
          </FieldLabel>
          <Textarea id={`${id}-guidance`} rows={2} value={field.guidance} onChange={(e) => set("guidance", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-700">Where the answer comes from</p>
        <div role="radiogroup" aria-label="Where the answer comes from" className="flex flex-wrap gap-1.5">
          {FILL_KINDS.map((kind) => {
            const active = src.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSource(fillSourceOfKind(kind, src))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
                  active ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-teal-400",
                )}
                title={FILL_SOURCE_LABELS[kind]}
              >
                {FILL_SOURCE_SHORT[kind]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-600">{FILL_HELP[src.kind]}</p>
        {src.kind === "registration" ? (
          <div>
            <FieldLabel htmlFor={`${id}-path`}>TM3 value</FieldLabel>
            <Select id={`${id}-path`} value={src.path} onChange={(e) => setSource({ kind: "registration", path: RegistrationPathSchema.parse(e.target.value) })}>
              {RegistrationPathSchema.options.map((p) => (
                <option key={p} value={p}>
                  {REGISTRATION_PATH_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {src.kind === "computed_fact" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${id}-fact`}>Calculated value</FieldLabel>
              <Select
                id={`${id}-fact`}
                value={src.factId}
                onChange={(e) => setSource({ ...src, factId: FactIdSchema.parse(e.target.value) })}
              >
                {FACT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor={`${id}-format`}>Written as</FieldLabel>
              <Select
                id={`${id}-format`}
                value={src.format ?? "summary"}
                onChange={(e) => setSource({ ...src, format: ComputedFactFormatSchema.parse(e.target.value) })}
              >
                {ComputedFactFormatSchema.options.map((f) => (
                  <option key={f} value={f}>
                    {COMPUTED_FACT_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
        {src.kind === "fixed" ? (
          <div>
            <FieldLabel htmlFor={`${id}-fixed`}>Fixed answer</FieldLabel>
            <Input id={`${id}-fixed`} value={src.value} onChange={(e) => setSource({ kind: "fixed", value: e.target.value })} />
          </div>
        ) : null}
        {src.kind === "signoff" ? (
          <div>
            <FieldLabel htmlFor={`${id}-part`}>Sign-off part</FieldLabel>
            <Select id={`${id}-part`} value={src.part} onChange={(e) => setSource({ kind: "signoff", part: SignoffPartSchema.parse(e.target.value) })}>
              {SignoffPartSchema.options.map((p) => (
                <option key={p} value={p}>
                  {SIGNOFF_PART_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-700">Where it goes in the original form</p>
          <Button type="button" size="sm" variant={picking ? "default" : "outline"} onClick={onTogglePick} aria-pressed={picking}>
            <Crosshair className="mr-1.5 h-4 w-4" aria-hidden />
            {picking ? "Click in the form…" : "Choose in the form"}
          </Button>
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{plainAnchorDescription({ anchor: a, label: field.label })}</p>
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Edit the location by hand</summary>
          <p className="mt-2 font-mono text-[11px] text-slate-500">{describeAnchor(a)}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {a.kind === "docx" ? (
              <>
                <div>
                  <FieldLabel htmlFor={`${id}-target`}>How it is written</FieldLabel>
                  <Select id={`${id}-target`} value={a.target} onChange={(e) => setAnchor({ ...a, target: DocxAnchorTargetSchema.parse(e.target.value) })}>
                    {DocxAnchorTargetSchema.options.map((t) => (
                      <option key={t} value={t}>
                        {DOCX_TARGET_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor={`${id}-block`} hint="(e.g. p12 or t2.r3.c1)">
                    Block
                  </FieldLabel>
                  <Input id={`${id}-block`} value={a.blockId} onChange={(e) => setAnchor({ ...a, blockId: e.target.value.trim() })} />
                </div>
                {a.target === "replace_placeholder" ? (
                  <div className="sm:col-span-2">
                    <FieldLabel htmlFor={`${id}-ph`}>Placeholder text to replace</FieldLabel>
                    <Input id={`${id}-ph`} value={a.placeholderText ?? ""} onChange={(e) => setAnchor({ ...a, placeholderText: e.target.value || undefined })} />
                  </div>
                ) : null}
              </>
            ) : null}
            {a.kind === "pdf_field" ? (
              <>
                <div>
                  <FieldLabel htmlFor={`${id}-pdfname`}>PDF field name</FieldLabel>
                  <Input id={`${id}-pdfname`} value={a.fieldName} onChange={(e) => setAnchor({ ...a, fieldName: e.target.value })} />
                </div>
                <div>
                  <FieldLabel htmlFor={`${id}-pdftype`}>Field type</FieldLabel>
                  <Select id={`${id}-pdftype`} value={a.fieldType} onChange={(e) => setAnchor({ ...a, fieldType: PdfFieldTypeSchema.parse(e.target.value) })}>
                    {PdfFieldTypeSchema.options.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            ) : null}
            {a.kind === "pdf_overlay" ? (
              <>
                {(["page", "x", "y", "width", "height"] as const).map((k) => (
                  <div key={k}>
                    <FieldLabel htmlFor={`${id}-ov-${k}`} hint={k === "page" ? undefined : "(pt)"}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </FieldLabel>
                    <Input
                      id={`${id}-ov-${k}`}
                      type="number"
                      min={k === "page" ? 1 : 0}
                      value={a[k]}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && (k !== "width" && k !== "height" ? n >= 0 : n > 0)) setAnchor({ ...a, [k]: k === "page" ? Math.max(1, Math.round(n)) : n });
                      }}
                    />
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </details>
        {formKind === "pdf_flat" ? (
          <p className="text-xs text-amber-800">Flat PDF: answers are written on top of the page at this position (best effort).</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 accent-teal-600"
            checked={field.required}
            onChange={(e) => set("required", e.target.checked)}
          />
          The referrer requires an answer
        </label>
        <Button type="button" size="sm" variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={onRemove}>
          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
          Remove question
        </Button>
      </div>
      {field.note ? <p className="text-xs text-slate-500">Note: {field.note}</p> : null}
    </fieldset>
  );
}
