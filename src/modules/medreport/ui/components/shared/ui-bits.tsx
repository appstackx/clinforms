"use client";

/**
 * Small presentational pieces shared by the Studio screens: status badges, chips, form controls styled
 * like the host's Input, empty/error states and formatting helpers.
 *
 * Owner: studio-a agent.
 */
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, type LucideIcon } from "lucide-react";
import { FILL_SOURCE_LABELS, FORM_ANALYSIS_MODE_LABELS, FORM_KIND_LABELS } from "../../../core/labels";
import { useStudioMode } from "../../host-hooks";
import { TENANT_COPY } from "../../studio-copy";
import { blankForCounts, blankForSummary } from "../../../core/parties";
import type { FillSource, FormDefinition, FormKind, FormStatus, Report } from "../../../core/types";
import { cn } from "../../primitives";

export { errorMessage, formatBytes, formatMs, plural } from "./format";

/* ------------------------------------------------------------------------------------------------
 * Fill sources (short labels for chips; core/labels.ts FILL_SOURCE_LABELS has the long form)
 * ----------------------------------------------------------------------------------------------*/

export type FillSourceKind = FillSource["kind"];

export const FILL_SOURCE_SHORT: Record<FillSourceKind, string> = {
  registration: "From TM3 registration",
  computed_fact: "Calculated from records",
  notes_narrative: "Drafted from notes",
  clinician_opinion: "Clinician opinion",
  signoff: "Sign-off",
  leave_blank: "Leave blank",
  fixed: "Fixed answer",
  appointments_table: "From appointments",
};

const FILL_SOURCE_CLASSES: Record<FillSourceKind, string> = {
  registration: "border-sky-200 bg-sky-50 text-sky-800",
  computed_fact: "border-indigo-200 bg-indigo-50 text-indigo-800",
  notes_narrative: "border-teal-200 bg-teal-50 text-teal-800",
  clinician_opinion: "border-violet-200 bg-violet-50 text-violet-800",
  signoff: "border-slate-300 bg-slate-100 text-slate-700",
  leave_blank: "border-dashed border-slate-300 bg-white text-slate-500",
  fixed: "border-cyan-200 bg-cyan-50 text-cyan-800",
  appointments_table: "border-sky-200 bg-sky-50 text-sky-800",
};

/**
 * Fill-source labels for this Studio (fix wave 2): a clinic's Studio fills "registration" answers from the
 * uploaded notes' patient record – it has no practice-system link, so its labels never name one.
 */
export function useFillSourceLabels(): { short: Record<FillSourceKind, string>; long: Record<FillSourceKind, string> } {
  const tenant = useStudioMode() === "tenant";
  if (!tenant) return { short: FILL_SOURCE_SHORT, long: FILL_SOURCE_LABELS };
  return {
    short: { ...FILL_SOURCE_SHORT, registration: TENANT_COPY.sources.registrationShort },
    long: { ...FILL_SOURCE_LABELS, registration: TENANT_COPY.sources.registrationLong },
  };
}

/** How a form map was analysed, for this Studio (fix wave 2: a clinic's Studio never says "demo" or "live"). */
export function useAnalysisModeLabels(): Record<keyof typeof FORM_ANALYSIS_MODE_LABELS, string> {
  const tenant = useStudioMode() === "tenant";
  if (!tenant) return FORM_ANALYSIS_MODE_LABELS;
  return {
    live: TENANT_COPY.forms.analysisLive,
    demo_recorded: TENANT_COPY.forms.analysisRecorded,
    demo_prewritten: TENANT_COPY.forms.analysisPrewritten,
    rules: TENANT_COPY.forms.analysisRules,
  };
}

export function FillSourceChip({ kind, className }: { kind: FillSourceKind; className?: string }) {
  const labels = useFillSourceLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        FILL_SOURCE_CLASSES[kind],
        className,
      )}
    >
      {labels.short[kind]}
    </span>
  );
}

/** Counts of fields per fill source. */
export function fillSourceCounts(form: Pick<FormDefinition, "fields">): Record<FillSourceKind, number> {
  const counts: Record<FillSourceKind, number> = {
    registration: 0,
    computed_fact: 0,
    notes_narrative: 0,
    clinician_opinion: 0,
    signoff: 0,
    leave_blank: 0,
    fixed: 0,
    appointments_table: 0,
  };
  for (const f of form.fields) counts[f.fillSource.kind] += 1;
  return counts;
}

/**
 * The ONE way question counts are described everywhere (library card, form choice, mapping screen,
 * review progress): questions the clinic answers = from the records (code) + from the notes or the
 * clinician; sign-off boxes are completed on approval; referrer's-use boxes are left blank.
 */
export interface QuestionBreakdown {
  toAnswer: number;
  fromRecords: number;
  fromNotes: number;
  onApproval: number;
  referrerUse: number;
  /** Boxes left blank, by whose part they are ("50 for the patient or their GP", "2 not needed"). */
  leftBlank: string[];
}

export function questionBreakdown(form: Pick<FormDefinition, "fields"> & { referrer?: { name: string } }): QuestionBreakdown {
  const c = fillSourceCounts(form);
  const fromRecords = c.registration + c.computed_fact + c.fixed + c.appointments_table;
  const fromNotes = c.notes_narrative + c.clinician_opinion;
  return {
    toAnswer: fromRecords + fromNotes,
    fromRecords,
    fromNotes,
    onApproval: c.signoff,
    referrerUse: c.leave_blank,
    leftBlank: blankForSummary(blankForCounts(form.fields), form.referrer?.name),
  };
}

/** "6 completed on approval · 50 for the patient or their GP · 2 not needed" – the boxes the clinic does not answer. */
export function notAnsweredText(b: QuestionBreakdown): string {
  return [b.onApproval ? `${b.onApproval} completed on approval` : "", ...b.leftBlank].filter(Boolean).join(" · ");
}

/** "16 to answer (8 from records · 8 from notes/clinician) · 4 completed on approval · 2 for office use" */
export function breakdownText(b: QuestionBreakdown): string {
  const parts = [`${b.toAnswer} to answer (${b.fromRecords} from records · ${b.fromNotes} from notes/clinician)`];
  const rest = notAnsweredText(b);
  if (rest) parts.push(rest);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------------------------------------
 * Badges
 * ----------------------------------------------------------------------------------------------*/

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium";

export function FormKindBadge({ kind, className }: { kind: FormKind; className?: string }) {
  const short: Record<FormKind, string> = { docx: "Word", pdf_acroform: "Fillable PDF", pdf_flat: "Flat PDF", questions: "Portal questions" };
  const tone: Record<FormKind, string> = {
    docx: "border-blue-200 bg-blue-50 text-blue-800",
    pdf_acroform: "border-rose-200 bg-rose-50 text-rose-800",
    pdf_flat: "border-orange-200 bg-orange-50 text-orange-800",
    questions: "border-violet-200 bg-violet-50 text-violet-800",
  };
  return (
    <span className={cn(PILL, tone[kind], className)} title={FORM_KIND_LABELS[kind]}>
      <FileText className="h-3 w-3" aria-hidden />
      {short[kind]}
    </span>
  );
}

export function FormStatusBadge({ status, className }: { status: FormStatus; className?: string }) {
  return status === "confirmed" ? (
    <span className={cn(PILL, "border-teal-200 bg-teal-50 text-teal-800", className)}>
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Confirmed
    </span>
  ) : (
    <span className={cn(PILL, "border-amber-200 bg-amber-50 text-amber-800", className)}>
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Proposed – needs review
    </span>
  );
}

export function ReportStatusBadge({ status, className }: { status: Report["status"]; className?: string }) {
  return status === "signed" ? (
    <span className={cn(PILL, "border-emerald-200 bg-emerald-50 text-emerald-800", className)}>
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Approved
    </span>
  ) : (
    <span className={cn(PILL, "border-slate-300 bg-slate-100 text-slate-700", className)}>Draft</span>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return <span className={cn(PILL, "border-slate-200 bg-white text-slate-600", className)}>Sample (fictional)</span>;
}

/* ------------------------------------------------------------------------------------------------
 * Form controls (styled like the host Input)
 * ----------------------------------------------------------------------------------------------*/

const CONTROL =
  "w-full rounded-xl border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, "h-10 py-2", className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL, "min-h-[80px] py-2", className)} {...props} />;
});

export function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-700">
      {children}
      {hint ? <span className="ml-1 font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

/* ------------------------------------------------------------------------------------------------
 * States
 * ----------------------------------------------------------------------------------------------*/

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className={cn("h-4 w-4 animate-spin text-teal-600", className)} aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center", className)}>
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {children ? <div className="mx-auto mt-1 max-w-lg text-sm text-slate-600">{children}</div> : null}
      {actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
  icon,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  } as const;
  const Icon = icon ?? (tone === "success" ? CheckCircle2 : AlertTriangle);
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cn("flex gap-3 rounded-xl border p-3 text-sm", tones[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-[13px] leading-relaxed opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
