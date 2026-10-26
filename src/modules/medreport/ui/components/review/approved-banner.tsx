"use client";

/**
 * The approved banner (moved out of review-header.tsx unchanged – bh2 W0 follow-up, seam "approved-summary-counts",
 * bh2-base2): after approval, who approved and when, the content fingerprint, the downloads, "Save to clinic record",
 * "File again" and "Create amended version". review-header.tsx re-exports it, so every import path still works.
 *
 * WA1 design 4: the approved summary's counts come from the issue state (answered, not applicable, left blank on
 * purpose, nothing in the record, left for the referrer, sign-off).
 * Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { forwardRef } from "react";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, Loader2, PenLine, Save, ShieldCheck } from "lucide-react";
import { formatUkDateTime } from "../../../core/dates";
import { shortFingerprint } from "../../../core/fingerprint";
import type { ActivityEntry, Report } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { Button } from "../../primitives";
import { TENANT_COPY } from "../../studio-copy";
import { WORDING } from "../../wording";
import type { DownloadKind } from "./use-review-actions";

export const ApprovedBanner = forwardRef<
  HTMLDivElement,
  {
    report: Report;
    isWordForm: boolean;
    isPdfForm: boolean;
    downloading: DownloadKind | null;
    /** Why a Word form has no PDF copy here (shown instead of its PDF button), or null. */
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
          {tenant ? (
            <p className="text-[12px] text-teal-900/80">
              {TENANT_COPY.review.approvalCode} <span className="font-mono font-semibold tracking-wider">{shortFingerprint(receipt.contentSha256, 4)}</span> –{" "}
              {TENANT_COPY.review.approvalCodeHint}
            </p>
          ) : (
            <p className="text-[12px] text-teal-900/80">
              Content fingerprint <span className="font-mono font-semibold tracking-wider">{shortFingerprint(receipt.contentSha256, 4)}</span> · server-signed
              receipt
            </p>
          )}
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
            {(isPdfForm || pdfUnavailable === null) && (
              <Button
                type="button"
                variant={isPdfForm ? "default" : "outline"}
                onClick={() => onDownload(isPdfForm ? "original" : "pdf")}
                disabled={downloading !== null || fileMissing}
              >
                {spin(isPdfForm ? "original" : "pdf")} {questionSet ? WORDING.questionSet.summaryPdf : "Completed form (PDF)"}
              </Button>
            )}
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
        ) : tenant && !canFile ? null : (
          // A clinic's Studio has no clinic-system connection (fix wave 2): no permanently disabled button.
          <Button type="button" variant="outline" onClick={onSave} disabled={filing || !canFile || fileMissing} className="bg-white">
            {filing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
            Save to clinic record
          </Button>
        )}
      </div>
      {/* Directly under the Word download it is about. */}
      {pdfUnavailable && (
        <p id="pdf-unavailable" role="status" className="mt-2 text-[13px] text-slate-700">
          {pdfUnavailable}
        </p>
      )}
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

      {!canFile && (
        <p className="mt-2 text-[12px] text-slate-600">
          {report.episodeRef.connectorId === "file-import"
            ? tenant
              ? "Made from the uploaded notes – download the completed form and attach it to the patient's record in your clinic system."
              : "Made from an uploaded export – download the completed form and attach it to the patient record."
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
