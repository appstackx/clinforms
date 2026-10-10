"use client";

/**
 * "Add portal questions": some insurers take treatment reports through an online portal, not a form.
 * Staff name the insurer / portal, paste or type its questions (one per line, optional answer type
 * hints) and see what was understood before adding it. The question set (FormKind "questions", no
 * file – core/question-set.ts) is saved as a PROPOSED form map and opened in the mapping review, where
 * it is checked and confirmed like any uploaded form.
 * A clinic's Studio (tenant mode) reports it as form_uploaded (form_kind "questions") through
 * HostHooks.track.
 *
 * Owner: studio-a agent.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ListPlus, Loader2, TriangleAlert } from "lucide-react";
import { ANSWER_TYPE_LABELS, REFERRER_TYPE_LABELS } from "../../../core/labels";
import { EXAMPLE_PORTAL_QUESTIONS, classifyPortalQuestion, createQuestionSet, parsePortalQuestions } from "../../../core/question-set";
import { ReferrerTypeSchema } from "../../../core/schemas";
import type { ReferrerType } from "../../../core/types";
import { useHostHooks } from "../../host-hooks";
import { useStudioPaths } from "../../routes";
import { saveFormDurable } from "../../store";
import { formEventProps } from "../../studio-events";
import { WORDING } from "../../wording";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "../../primitives";
import { errorMessage, plural } from "../shared/format";
import { FieldLabel, FillSourceChip, Notice, Select, Textarea } from "../shared/ui-bits";

export interface PortalQuestionsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function PortalQuestionsDialog({ open, onOpenChange }: PortalQuestionsDialogProps) {
  const router = useRouter();
  const hooks = useHostHooks();
  const paths = useStudioPaths();
  const ids = useId();
  const w = WORDING.questionSet;
  const [referrerName, setReferrerName] = useState("");
  const [referrerType, setReferrerType] = useState<ReferrerType>("insurer");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Reset each time the dialog opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setReferrerName("");
    setReferrerType("insurer");
    setTitle("");
    setText("");
    setBusy(false);
    setError(null);
    setTouched(false);
  }, [open]);

  const parsed = useMemo(() => parsePortalQuestions(text), [text]);
  const hasText = text.trim().length > 0;
  const nameMissing = !referrerName.trim();
  const canSubmit = !busy && !nameMissing && hasText && parsed.errors.length === 0 && parsed.questions.length > 0;

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const form = await createQuestionSet({
        // A clinic's question set is the clinic's (the demo's default is the demo tenant).
        ...(hooks.clinic?.tenantId ? { tenantId: hooks.clinic.tenantId } : {}),
        referrer: { name: referrerName.trim(), type: referrerType },
        title: title.trim() || undefined,
        questions: parsed.questions,
        warnings: parsed.warnings,
      });
      // Stored before its mapping screen opens (a clinic's Studio: on the server).
      if (!(await saveFormDurable(form))) throw new Error("The question set could not be saved. Please try again.");
      hooks.track?.("form_uploaded", formEventProps(form));
      onOpenChange(false);
      router.push(paths.form(form.id));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  let section: string | undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{w.dialogTitle}</DialogTitle>
          <DialogDescription>{w.dialogDescription}</DialogDescription>
        </DialogHeader>

        <form
          id={`${ids}-form`}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor={`${ids}-referrer`}>Insurer or portal</FieldLabel>
              <Input
                id={`${ids}-referrer`}
                value={referrerName}
                onChange={(e) => setReferrerName(e.target.value)}
                placeholder={hooks.mode === "tenant" ? "e.g. the insurer's name" : "e.g. Northbridge Health Insurance (fictional)"}
                aria-invalid={touched && nameMissing ? true : undefined}
                aria-describedby={touched && nameMissing ? `${ids}-referrer-error` : undefined}
                required
              />
              {touched && nameMissing ? (
                <p id={`${ids}-referrer-error`} className="mt-1 text-xs text-red-700">
                  Name the insurer or portal these questions come from.
                </p>
              ) : null}
            </div>
            <div>
              <FieldLabel htmlFor={`${ids}-type`}>Referrer type</FieldLabel>
              <Select id={`${ids}-type`} value={referrerType} onChange={(e) => setReferrerType(ReferrerTypeSchema.parse(e.target.value))}>
                {ReferrerTypeSchema.options.map((t) => (
                  <option key={t} value={t}>
                    {REFERRER_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor={`${ids}-title`} hint="(optional)">
                Name for this question set
              </FieldLabel>
              <Input
                id={`${ids}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${referrerName.trim() || "Insurer"} – portal questions`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <FieldLabel htmlFor={`${ids}-questions`}>The portal&apos;s questions</FieldLabel>
              {!hasText ? (
                <button
                  type="button"
                  onClick={() => setText(EXAMPLE_PORTAL_QUESTIONS)}
                  className="text-xs font-medium text-teal-800 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                >
                  {w.exampleButton}
                </button>
              ) : null}
            </div>
            <Textarea
              id={`${ids}-questions`}
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={`${ids}-hint`}
              aria-invalid={touched && parsed.errors.length > 0 ? true : undefined}
              placeholder={"Date of initial assessment\nCurrent symptoms and progress [long]\nIs further treatment requested? [yes/no]"}
              className="font-mono text-[13px]"
              spellCheck
            />
            <p id={`${ids}-hint`} className="text-xs text-slate-500">
              {w.hintHelp}
            </p>
          </div>

          {hasText ? (
            <section aria-labelledby={`${ids}-found`} className="space-y-2">
              <h3 id={`${ids}-found`} className="text-sm font-semibold text-slate-900">
                {plural(parsed.questions.length, "question")} found
              </h3>
              {parsed.errors.length ? (
                <Notice tone="error" title="Fix these first">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {parsed.errors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              {parsed.warnings.length ? (
                <Notice tone="warning" title="Check these">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {parsed.warnings.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              {parsed.questions.length ? (
                <ol className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2" aria-label="Questions as they will be added">
                  {parsed.questions.map((q, i) => {
                    const heading = q.section && q.section !== section ? q.section : null;
                    section = q.section;
                    const c = classifyPortalQuestion(q.label);
                    const type = q.hinted ? q.answerType : c.answerType ?? q.answerType;
                    return (
                      <li key={`${q.line}-${i}`} className="space-y-1">
                        {heading ? <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{heading}</p> : null}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white px-2 py-1.5 text-sm ring-1 ring-slate-200">
                          <span className="font-mono text-[11px] text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 flex-1 basis-48 text-slate-900">
                            {q.label}
                            {!q.required ? <span className="ml-1 text-xs text-slate-500">(optional)</span> : null}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {ANSWER_TYPE_LABELS[type]}
                            {q.options?.length ? `: ${q.options.join(" / ")}` : ""}
                          </span>
                          <FillSourceChip kind={c.fillSource.kind} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </section>
          ) : null}

          <p className="text-xs leading-relaxed text-slate-600">{w.howItWorks}</p>

          {error ? (
            <Notice tone="error" title="Not added">
              {error}
            </Notice>
          ) : null}
          {touched && !hasText ? (
            <p className="flex items-center gap-1.5 text-xs text-red-700" role="alert">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Paste or type at least one question.
            </p>
          ) : null}
        </form>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={busy || (touched && !canSubmit)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ListPlus className="mr-2 h-4 w-4" aria-hidden />}
            {w.submit}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
