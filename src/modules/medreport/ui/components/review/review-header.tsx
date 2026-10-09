"use client";

/**
 * Review header: who and what (patient, referrer, form), status (Draft / Approved), an honest badge
 * for how the answers were drafted, the save state, and the primary actions (Draft copy, Approve).
 * After approval: the approved banner with the fingerprint, downloads and "Save to clinic record".
 *
 * Owner: studio-b agent.
 */
import { forwardRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Lock,
  PenLine,
  Save,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatUkDateTime } from "../../../core/dates";
import { shortFingerprint } from "../../../core/fingerprint";
import { referrerNamesMatch } from "../../../core/forms";
import { FORM_KIND_LABELS, INSTRUCTING_PARTY_LABELS } from "../../../core/labels";
import type { ActivityEntry, Report, ReportTemplate } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "../../primitives";
import { useStudioPaths } from "../../routes";
import { TENANT_COPY } from "../../studio-copy";
import { WORDING } from "../../wording";
import type { GenerationSummary } from "./review-model";
import { Pill } from "./review-ui";
import type { SaveState } from "./use-review-state";
import type { DownloadKind } from "./use-review-actions";

const GEN_TONE: Record<GenerationSummary["tone"], { cls: string; Icon: LucideIcon }> = {
  live: { cls: "border-teal-200 bg-teal-50 text-teal-900", Icon: Zap },
  recorded: { cls: "border-sky-200 bg-sky-50 text-sky-900", Icon: History },
  prewritten: { cls: "border-slate-300 bg-slate-100 text-slate-700", Icon: FileText },
  none: { cls: "border-slate-200 bg-white text-slate-600", Icon: FileText },
};

export function GenerationBadge({ summary }: { summary: GenerationSummary | null }) {
  if (!summary) {
    return <Pill className="h-6 border-slate-200 bg-white px-2.5 text-slate-600">Filled from the record – nothing drafted yet</Pill>;
  }
  const tone = GEN_TONE[summary.tone];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]",
            tone.cls,
          )}
        >
          <tone.Icon className="h-3 w-3" aria-hidden />
          {summary.label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <p className="mb-1 text-xs font-semibold">How each group of answers was drafted</p>
        <ul className="space-y-0.5 text-xs">
          {summary.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The reference shown next to the referrer. On a form from ANOTHER organisation than the referral, the
 * referral's reference is not theirs (it is never copied into their form), so the header shows the
 * reference staff entered for that referrer, or none yet.
 */
function headerReference(report: Report): string | null {
  const form = report.form;
  if (!form || referrerNamesMatch(form.referrer.name, report.instructingParty.name)) return report.instructingParty.reference ?? null;
  const gap = report.gaps.find((g) => g.id.endsWith("-referrer"));
  const section = gap ? report.sections.find((s) => s.key === gap.sectionKey) : undefined;
  const entered = section?.paragraphs.map((p) => p.text.trim()).filter(Boolean).join(" ");
  return entered || null;
}

export function ReviewHeader({
  report,
  template,
  generation,
  saveState,
  savedAt,
  blockingLines,
  blockingCount,
  canApprove,
  approveUnavailable,
  onApprove,
  onShowFlags,
  onDraftCopy,
  draftCopyUnavailable,
  downloading,
  prefillFor = null,
}: {
  report: Report;
  template: ReportTemplate | null;
  /** A form the clinic only prefills: who completes and signs it ("the patient and their GP or doctor"). */
  prefillFor?: string | null;
  generation: GenerationSummary | null;
  saveState: SaveState;
  savedAt: string | null;
  blockingLines: string[];
  blockingCount: number;
  canApprove: boolean;
  /** Why approval cannot start at all (missing form map…), or null. */
  approveUnavailable: string | null;
  onApprove(): void;
  onShowFlags(): void;
  onDraftCopy(): void;
  /** The draft copy needs the form map and the referrer's file in this browser. */
  draftCopyUnavailable: boolean;
  downloading: DownloadKind | null;
}) {
  const paths = useStudioPaths();
  const tenant = useStudioMode() === "tenant";
  const signed = report.status === "signed";
  const form = report.form;
  const approveLabel = form ? "Approve…" : "Sign…";
  const reference = headerReference(report);
  const disabledReason = approveUnavailable;

  return (
    <header className="space-y-3">
      <Link
        href={paths.home}
        className="inline-flex items-center gap-1 rounded text-sm text-slate-600 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Reports
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">{report.patientLabel}</h1>
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold",
                signed ? "bg-teal-600 text-white" : "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
              )}
            >
              {signed ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <PenLine className="h-3.5 w-3.5" aria-hidden />}
              {signed ? (prefillFor ? "Approved prefill" : form ? "Approved" : "Signed") : "Draft"}
            </span>
            {report.version && report.version > 1 ? (
              <span className="inline-flex h-6 items-center rounded-full bg-violet-100 px-2.5 text-xs font-semibold text-violet-900 ring-1 ring-violet-200">
                Amended – v{report.version}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-600">
            {form ? (
              <>
                <span className="font-medium text-slate-800">{form.referrer.name}</span>
                <span className="text-slate-400"> · </span>
                {form.title}
                <span className="text-slate-400"> · </span>
                <span className="whitespace-nowrap">{FORM_KIND_LABELS[form.kind]}</span>
              </>
            ) : (
              <>
                <span className="font-medium text-slate-800">{report.instructingParty.name}</span>
                <span className="text-slate-400"> · </span>
                {INSTRUCTING_PARTY_LABELS[report.instructingParty.type]}
                <span className="text-slate-400"> · </span>
                {template?.name ?? report.templateId}
              </>
            )}
            {reference && <span className="whitespace-nowrap text-slate-500"> · Ref. {reference}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <GenerationBadge summary={generation} />
            <span className="inline-flex h-6 items-center gap-1 text-[11px] text-slate-500" role="status" aria-live="polite">
              {saveState === "saving" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
                </>
              ) : saveState === "failed" ? (
                <span className="text-red-700">{tenant ? TENANT_COPY.review.saveFailed : "Could not save in this browser (storage full or blocked)"}</span>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 text-teal-600" aria-hidden /> {tenant ? TENANT_COPY.review.saved : "Saved in this browser"}
                  {savedAt ? ` · ${formatUkDateTime(savedAt).slice(11)}` : ""}
                </>
              )}
            </span>
          </div>
        </div>

        {!signed && (
          <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onDraftCopy} disabled={downloading !== null || draftCopyUnavailable}>
                {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}
                Draft copy
              </Button>
              {canApprove ? (
                <Button type="button" onClick={onApprove}>
                  <ShieldCheck className="mr-2 h-4 w-4" aria-hidden /> {approveLabel}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]" aria-describedby="approve-blocked">
                      <Button type="button" disabled aria-disabled className="pointer-events-none">
                        <Lock className="mr-2 h-4 w-4" aria-hidden /> {approveLabel}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="max-w-sm">
                    <p className="mb-1 text-xs font-semibold">{disabledReason ?? "Resolve these before approval:"}</p>
                    {!disabledReason && (
                      <ul className="list-disc space-y-0.5 pl-4 text-xs">
                        {blockingLines.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p id="approve-blocked" className="text-xs text-slate-600">
              {approveUnavailable ? (
                <span className="text-amber-800">{approveUnavailable}</span>
              ) : blockingCount > 0 ? (
                <button type="button" onClick={onShowFlags} className="font-medium text-red-700 underline underline-offset-2 hover:no-underline">
                  {blockingCount} item{blockingCount === 1 ? "" : "s"} to resolve before approval
                </button>
              ) : (
                <span className="text-teal-800">Ready for your approval</span>
              )}
            </p>
          </div>
        )}
      </div>
    </header>
  );
}

export const ApprovedBanner = forwardRef<
  HTMLDivElement,
  {
    report: Report;
    isWordForm: boolean;
    isPdfForm: boolean;
    downloading: DownloadKind | null;
    pdfUnavailable: string | null;
    filing: boolean;
    filed: ActivityEntry[];
    canFile: boolean;
    clinicRecordUrl: string | null;
    fileMissing: boolean;
    onDownload(kind: DownloadKind): void;
    onSave(): void;
    /** Start an amended version (a referrer's query or a factual correction). */
    onAmend?: () => void;
    /** A portal question set: its PDF is the summary of the questions and answers. */
    questionSet?: boolean;
    /** A form the clinic only prefills: who completes and signs it. */
    prefillFor?: string | null;
  }
>(function ApprovedBanner(props, ref) {
  const { report, isWordForm, isPdfForm, downloading, pdfUnavailable, filing, filed, canFile, clinicRecordUrl, fileMissing, onDownload, onSave, onAmend, questionSet, prefillFor } = props;
  const tenant = useStudioMode() === "tenant";
  const receipt = report.receipt;
  if (!receipt) return null;
  const isForm = Boolean(report.form);
  const lastFiled = filed[filed.length - 1];
  const spin = (k: DownloadKind) => (downloading === k ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />);

  return (
    <div ref={ref} tabIndex={-1} className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold text-teal-950">
            {questionSet
              ? WORDING.questionSet.approvedTitle
              : prefillFor
                ? `Prefill approved – ready for ${prefillFor} to complete and sign`
                : isForm
                  ? "Approved – the completed form is final"
                  : "Signed – the report is final"}
          </h2>
          <p className="text-[13px] text-teal-900">
            {prefillFor ? "Checked and approved" : isForm ? "Approved" : "Signed"} by <span className="font-medium">{receipt.signer.name}</span> (HCPC{" "}
            {receipt.signer.hcpc}) on {formatUkDateTime(receipt.signedAt)}.{prefillFor ? " Nobody at the clinic signs this form." : ""} Read-only from now on.
          </p>
          <p className="text-[12px] text-teal-900/80">
            Content fingerprint <span className="font-mono font-semibold tracking-wider">{shortFingerprint(receipt.contentSha256, 4)}</span> · server-signed
            receipt
          </p>
        </div>
      </div>

      {fileMissing && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 ring-1 ring-amber-200">
          {tenant
            ? TENANT_COPY.files.missingForCompletion
            : "The referrer's original file is not stored in this browser, so the completed form cannot be produced here. Add the form again in the forms library."}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {isForm ? (
          <>
            {isWordForm && (
              <Button type="button" onClick={() => onDownload("original")} disabled={downloading !== null || fileMissing}>
                {spin("original")} Completed form (Word)
              </Button>
            )}
            <Button
              type="button"
              variant={isPdfForm ? "default" : "outline"}
              onClick={() => onDownload(isPdfForm ? "original" : "pdf")}
              disabled={downloading !== null || fileMissing || (!isPdfForm && pdfUnavailable !== null)}
              aria-describedby={!isPdfForm && pdfUnavailable ? "pdf-unavailable" : undefined}
            >
              {spin(isPdfForm ? "original" : "pdf")} {questionSet ? WORDING.questionSet.summaryPdf : "Completed form (PDF)"}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={() => onDownload("docx")} disabled={downloading !== null}>
              {spin("docx")} Report (Word)
            </Button>
            <Button type="button" variant="outline" onClick={() => onDownload("pdf")} disabled={downloading !== null}>
              {spin("pdf")} Report (PDF)
            </Button>
          </>
        )}
        {lastFiled ? (
          <span className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-teal-200 bg-white px-3 text-sm font-medium text-teal-900">
            <CheckCircle2 className="h-4 w-4 text-teal-600" aria-hidden />
            Filed {formatUkDateTime(lastFiled.at)}
          </span>
        ) : (
          <Button type="button" variant="outline" onClick={onSave} disabled={filing || !canFile || fileMissing} className="bg-white">
            {filing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
            Save to clinic record
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {lastFiled && canFile && !fileMissing && (
          <button
            type="button"
            onClick={onSave}
            disabled={filing}
            className="inline-flex items-center gap-1 font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 hover:no-underline disabled:opacity-60"
          >
            {filing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            File again
          </button>
        )}
        {onAmend && (
          <button type="button" onClick={onAmend} className="inline-flex items-center gap-1 font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 hover:no-underline">
            <PenLine className="h-3 w-3" aria-hidden /> Create amended version
          </button>
        )}
      </div>

      {pdfUnavailable && (
        <p id="pdf-unavailable" role="status" className="mt-2 text-[13px] text-slate-700">
          {pdfUnavailable}
        </p>
      )}
      {!canFile && (
        <p className="mt-2 text-[12px] text-slate-600">
          {report.episodeRef.connectorId === "file-import"
            ? "Made from an uploaded export – download the completed form and attach it to the patient record."
            : "Filing to TM3 needs the live TM3 connection (partner access)."}
        </p>
      )}
      {lastFiled && (
        <p className="mt-2 flex items-start gap-2 text-[12px] text-teal-900">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            Filed {formatUkDateTime(lastFiled.at)} – {lastFiled.detail}{" "}
            {clinicRecordUrl && (
              <Link href={clinicRecordUrl} className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline">
                Open the patient record <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </span>
        </p>
      )}
    </div>
  );
});
