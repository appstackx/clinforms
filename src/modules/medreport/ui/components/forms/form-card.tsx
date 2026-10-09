"use client";

/**
 * One referrer form in the forms library grid: thumbnail of the original first page, referrer, title,
 * kind, how many questions are mapped (and where their answers come from), status and actions.
 * A portal question set (no file) shows its first questions instead of a page thumbnail.
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useState } from "react";
import { Download, FilePlus2, ListChecks, Trash2 } from "lucide-react";
import { formatUkDate } from "../../../core/dates";
import { answerableFields } from "../../../core/forms";
import { isQuestionSet } from "../../../core/question-set";
import { REFERRER_TYPE_LABELS } from "../../../core/labels";
import type { FormDefinition } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { useStudioPaths } from "../../routes";
import { deleteForm } from "../../store";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../primitives";
import { FormThumbnail } from "../shared/original-form-preview";
import { FormKindBadge, FormStatusBadge, SampleBadge, questionBreakdown } from "../shared/ui-bits";
import { QuestionSetThumbnail } from "./question-set-preview";
import { downloadStoredFile, useFormFile } from "./use-form-file";

export function FormCard({ form }: { form: FormDefinition }) {
  const questionSet = isQuestionSet(form);
  const { file, loading } = useFormFile(questionSet ? null : form);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const b = questionBreakdown(form);
  const paths = useStudioPaths();
  const tenant = useStudioMode() === "tenant";
  const href = paths.form(form.id);

  return (
    <Card className="flex flex-col overflow-hidden rounded-2xl border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <Link href={href} className="group relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600" aria-label={`Review the mapping of ${form.title}`}>
        <div className="h-44 overflow-hidden border-b border-slate-200 bg-slate-100 p-3">
          {questionSet ? <QuestionSetThumbnail form={form} className="h-[220px] rounded-md shadow-sm ring-1 ring-slate-200 transition-transform group-hover:-translate-y-0.5" /> : null}
          <FormThumbnail
            file={file}
            className={questionSet ? "hidden" : "h-[220px] rounded-md shadow-sm ring-1 ring-slate-200 transition-transform group-hover:-translate-y-0.5"}
          />
          {loading ? <span className="sr-only">Loading preview</span> : null}
        </div>
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate pt-1 text-xs font-medium uppercase tracking-wide text-slate-500" title={form.referrer.name}>
              {form.referrer.name}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className={questionSet ? "hidden" : "h-7 w-7 shrink-0 px-0"}
              disabled={!file}
              onClick={() => file && downloadStoredFile(file)}
              aria-label={`Download the original ${form.title}`}
              title="Download original"
            >
              <Download className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Remove ${form.title} from the library`}
              title="Remove from library"
              className="h-7 w-7 shrink-0 px-0 text-slate-500 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <h3 className="mt-0.5 text-base font-semibold leading-snug text-slate-900">
            <Link href={href} className="hover:text-teal-800 hover:underline">
              {form.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {REFERRER_TYPE_LABELS[form.referrer.type]}
            {form.versionLabel ? ` · ${form.versionLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FormKindBadge kind={form.kind} />
          <FormStatusBadge status={form.status} />
          {form.builtIn ? <SampleBadge /> : null}
        </div>
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center">
          <div>
            <dt className="text-[11px] text-slate-500">To answer</dt>
            <dd className="text-sm font-semibold text-slate-900">{b.toAnswer}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">From records</dt>
            <dd className="text-sm font-semibold text-slate-900">{b.fromRecords}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Notes / clinician</dt>
            <dd className="text-sm font-semibold text-slate-900">{b.fromNotes}</dd>
          </div>
        </dl>
        {b.onApproval || b.referrerUse ? (
          <p className="-mt-1 text-[11px] text-slate-500">
            {[b.onApproval ? `${b.onApproval} completed on approval` : "", b.referrerUse ? `${b.referrerUse} for the referrer's office` : ""].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <p className="text-xs text-slate-500">
          {form.status === "confirmed" && form.confirmed
            ? `Confirmed by ${form.confirmed.by} on ${formatUkDate(form.confirmed.at.slice(0, 10))}`
            : "Check the proposed mapping before using this form for patients."}
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant={form.status === "confirmed" ? "outline" : "default"}>
            <Link href={href}>
              <ListChecks className="mr-1.5 h-4 w-4" aria-hidden />
              {form.status === "confirmed" ? "View mapping" : "Review mapping"}
            </Link>
          </Button>
          {form.status === "confirmed" ? (
            <Button asChild size="sm">
              <Link href={paths.newReportWithForm(form.id)}>
                <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden />
                Use for a patient
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this form?</DialogTitle>
            <DialogDescription>
              “{form.title}” from {form.referrer.name} and its mapping will be removed{tenant ? " from your clinic's library" : " from this browser"}.
              Reports already completed with it are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteForm(form.id);
                setConfirmDelete(false);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
