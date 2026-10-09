"use client";

/**
 * A portal question set has no original file to show, so the forms library card and the mapping
 * screen show its questions instead: a small "page" of the first questions (thumbnail), and the full
 * numbered list with the selected question highlighted (mapping review).
 *
 * Owner: studio-a agent.
 */
import { ListChecks } from "lucide-react";
import { ANSWER_TYPE_LABELS } from "../../../core/labels";
import type { FormDefinition } from "../../../core/types";
import { cn } from "../../primitives";
import { WORDING } from "../../wording";
import { FillSourceChip } from "../shared/ui-bits";

const THUMBNAIL_QUESTIONS = 7;

/** The forms library card's picture of a question set: the first questions on a page. */
export function QuestionSetThumbnail({ form, className }: { form: Pick<FormDefinition, "fields" | "title">; className?: string }) {
  const shown = form.fields.slice(0, THUMBNAIL_QUESTIONS);
  const more = form.fields.length - shown.length;
  return (
    <div aria-hidden className={cn("overflow-hidden bg-white px-4 py-3 text-left", className)}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
        <ListChecks className="h-3 w-3" />
        {WORDING.questionSet.noFile}
      </p>
      <ol className="mt-2 space-y-1.5">
        {shown.map((f, i) => (
          <li key={f.id} className="flex gap-1.5 text-[11px] leading-snug text-slate-700">
            <span className="w-4 shrink-0 text-right font-mono text-slate-400">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate">{f.label}</span>
          </li>
        ))}
      </ol>
      {more > 0 ? <p className="mt-1.5 pl-5 text-[11px] text-slate-400">+{more} more</p> : null}
    </div>
  );
}

/** The mapping screen's left panel for a question set: every question, numbered, selectable. */
export function QuestionSetPreview({
  form,
  selectedId,
  onSelect,
  className,
}: {
  form: Pick<FormDefinition, "fields" | "title">;
  selectedId: string | null;
  onSelect(id: string): void;
  className?: string;
}) {
  let heading: string | undefined;
  return (
    <div className={cn("overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3", className)} role="region" aria-label={`${form.title} – the portal's questions`}>
      <p className="mb-2 text-xs text-slate-600">{WORDING.questionSet.howItWorks}</p>
      <ol className="space-y-1.5">
        {form.fields.map((f, i) => {
          const showHeading = f.section && f.section !== heading ? f.section : null;
          heading = f.section;
          const active = f.id === selectedId;
          return (
            <li key={f.id} className="space-y-1">
              {showHeading ? <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{showHeading}</p> : null}
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
                  active ? "ring-2 ring-teal-500" : "ring-slate-200 hover:ring-teal-300",
                )}
              >
                <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[11px] text-slate-400">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-slate-900">{f.label}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <FillSourceChip kind={f.fillSource.kind} />
                    <span className="text-[11px] text-slate-500">
                      {ANSWER_TYPE_LABELS[f.answerType]}
                      {f.options?.length ? `: ${f.options.join(" / ")}` : ""}
                      {f.required ? "" : " · optional"}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
