"use client";

/**
 * "Copy answers" on the review screen of a form report: a copy button on every question (plain text,
 * dates DD/MM/YYYY, ticks as the option chosen), "Copy all answers" (numbered "Question: answer"
 * blocks, unanswered questions as "[to complete]") and "Download answers (.txt)". It works before
 * approval, but every copy of an unapproved draft is marked "Draft – not yet approved"; after approval it
 * copies the approved answers. For a portal question set (no file) this is the main output.
 *
 * The text itself comes from core/answer-copy.ts (shared with the server's PDF summary); the wording
 * from core/wording.ts (WORDING.answersCopy).
 *
 * Owner: studio-b agent.
 */
import { useCallback, useMemo, useRef } from "react";
import { CheckCircle2, ClipboardCopy, Copy, Download, PenLine } from "lucide-react";
import { answersFileName, answersTxt, buildAnswersCopy, copyFormOf, copyTextForAnswer, type AnswersCopy } from "../../../core/answer-copy";
import type { FormDefinition, Report } from "../../../core/types";
import { saveBlob } from "../../api-client";
import { Button, cn } from "../../primitives";
import { WORDING } from "../../wording";
import type { Toast } from "./review-ui";
import type { ReviewAction } from "./use-review-state";

/* Clipboard ------------------------------------------------------------------------------------- */

/**
 * Put text on the clipboard: the async Clipboard API where the page may use it, else a hidden
 * textarea and execCommand("copy"). Resolves false when the browser refused both.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && (typeof window === "undefined" || window.isSecureContext)) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    const active = document.activeElement as HTMLElement | null;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    active?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}

/* Hook ------------------------------------------------------------------------------------------ */

export interface AnswersCopyActions {
  copy: AnswersCopy;
  /** Copy one question's answer (stable callback, safe for memoised question cards). */
  copyOne(key: string): void;
  copyAll(): void;
  downloadTxt(): void;
  /** Keys of the questions that have an answer to copy. */
  copyable: Set<string>;
}

export function useAnswersCopy(opts: {
  report: Report;
  form: FormDefinition | null;
  actor: string;
  dispatch(action: ReviewAction): void;
  toast(t: Omit<Toast, "id">): void;
}): AnswersCopyActions {
  const { report, form, actor, dispatch, toast } = opts;
  const copy = useMemo(() => buildAnswersCopy({ report, form: copyFormOf(form) }), [report, form]);
  const copyable = useMemo(() => new Set(copy.entries.filter((e) => e.answer !== null).map((e) => e.key)), [copy]);
  const latest = useRef({ copy, report, actor, dispatch, toast });
  latest.current = { copy, report, actor, dispatch, toast };
  const w = WORDING.answersCopy;

  const copyOne = useCallback((key: string) => {
    const { copy: c, toast: t } = latest.current;
    const entry = c.entries.find((e) => e.key === key);
    if (!entry?.answer) {
      t({ tone: "info", title: w.nothingToCopy });
      return;
    }
    void copyToClipboard(copyTextForAnswer(entry.answer, c.approved)).then((ok) =>
      ok
        ? t({ tone: "success", title: w.copiedOne(entry.question), detail: c.approved ? w.copiedApprovedDetail : w.copiedDraftDetail })
        : t({ tone: "error", title: w.copyFailed }),
    );
  }, [w]);

  const copyAll = useCallback(() => {
    const { copy: c, actor: a, dispatch: d, toast: t } = latest.current;
    void copyToClipboard(c.text).then((ok) => {
      if (!ok) return t({ tone: "error", title: w.copyFailed });
      // The same count as the panel and the progress summary: sign-off answers are not questions to answer.
      const answered = c.entries.filter((e) => e.answer !== null && !e.signoff).length;
      t({
        tone: "success",
        title: w.copiedAll(answered),
        detail: [c.approved ? w.copiedApprovedDetail : w.copiedDraftDetail, c.toComplete ? (c.approved ? w.leftBlankCount(c.toComplete) : `${w.gapsCount(c.toComplete)}.`) : ""]
          .filter(Boolean)
          .join(" "),
      });
      d({ type: "activity", action: "exported", actor: a, detail: `Copied all answers (${c.approved ? "the approved answers" : w.draftMarker.toLowerCase()}).` });
    });
  }, [w]);

  const downloadTxt = useCallback(() => {
    const { copy: c, report: r, actor: a, dispatch: d, toast: t } = latest.current;
    const fileName = answersFileName(r);
    saveBlob(new Blob([answersTxt(c)], { type: "text/plain;charset=utf-8" }), fileName);
    t({ tone: "success", title: w.downloaded, detail: fileName });
    d({ type: "activity", action: "rendered", actor: a, detail: `Downloaded the answers as text: ${fileName}.` });
  }, [w]);

  return { copy, copyOne, copyAll, downloadTxt, copyable };
}

/* Panel ----------------------------------------------------------------------------------------- */

export function CopyAnswersPanel({
  actions,
  questionSet,
  referrerName,
  className,
}: {
  actions: Pick<AnswersCopyActions, "copy" | "copyAll" | "downloadTxt">;
  /**
   * A portal question set: the copied answers are the output, so the panel explains it in full. For a
   * form with a file it is a compact bar (copying is the secondary output there).
   */
  questionSet: boolean;
  referrerName: string;
  className?: string;
}) {
  const { copy, copyAll, downloadTxt } = actions;
  const w = WORDING.answersCopy;
  // The questions to answer – the same count as the progress summary: sign-off answers (completed from the
  // approval) are not among them, before or after approval.
  const questions = copy.entries.filter((e) => !e.signoff && e.status !== "on_approval");
  const answered = questions.filter((e) => e.answer !== null).length;
  const toAnswer = questions.length;
  const notice = `${copy.approved ? w.approvedNotice : w.draftNotice}${
    copy.toComplete > 0 ? ` ${copy.approved ? w.leftBlankCount(copy.toComplete) : `${w.gapsCount(copy.toComplete)} – they are copied as “${w.toComplete}”.`}` : ""
  }`;
  const status = (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold",
        copy.approved ? "bg-teal-600 text-white" : "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
      )}
    >
      {copy.approved ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <PenLine className="h-3 w-3" aria-hidden />}
      {copy.approved ? "Approved" : w.draftMarker}
    </span>
  );
  const buttons = (
    <>
      <Button type="button" size="sm" className="h-9" onClick={copyAll} disabled={copy.entries.length === 0}>
        <Copy className="mr-1.5 h-4 w-4" aria-hidden /> {w.copyAll}
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-9" onClick={downloadTxt} disabled={copy.entries.length === 0}>
        <Download className="mr-1.5 h-4 w-4" aria-hidden /> {w.downloadTxt}
      </Button>
      <span className="text-xs text-slate-500">
        {answered} of {toAnswer} answered
      </span>
    </>
  );

  if (!questionSet) {
    return (
      <section aria-labelledby="copy-answers-title" className={cn("rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm", className)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="copy-answers-title" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ClipboardCopy className="h-4 w-4 text-teal-700" aria-hidden /> {w.panelTitle}
          </h2>
          {status}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">{buttons}</div>
        <p className="mt-2 text-xs leading-relaxed text-slate-600" role="note">
          {w.panelIntro} {notice}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="copy-answers-title" className={cn("rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5", className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
          <ClipboardCopy className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h2 id="copy-answers-title" className="text-[15px] font-semibold text-slate-900">
            {w.panelTitlePortal}
          </h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{w.panelIntroPortal(referrerName)}</p>
        </div>
        {status}
      </div>
      <p className={cn("mt-3 rounded-lg px-3 py-2 text-[13px]", copy.approved ? "bg-teal-50 text-teal-900" : "bg-amber-50 text-amber-900")} role="note">
        {notice}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">{buttons}</div>
    </section>
  );
}

/** The small per-question copy button (question card header). */
export function CopyAnswerButton({ label, enabled, onCopy }: { label: string; enabled: boolean; onCopy(): void }) {
  const w = WORDING.answersCopy;
  return (
    <button
      type="button"
      onClick={enabled ? onCopy : undefined}
      aria-disabled={!enabled || undefined}
      aria-label={enabled ? w.copyOneAria(label) : `${w.copyOneAria(label)} – ${w.nothingToCopy.toLowerCase()}`}
      title={enabled ? w.copyOneAria(label) : w.nothingToCopy}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]",
        enabled ? "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-900" : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400",
      )}
    >
      <Copy className="h-3 w-3" aria-hidden />
      {w.copyOne}
    </button>
  );
}
