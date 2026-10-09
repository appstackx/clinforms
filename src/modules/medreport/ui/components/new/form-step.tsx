"use client";

/**
 * Step 3 of "Complete a form": which referrer form to complete. Defaults to the referral's referrer's
 * own form when the library holds a confirmed one; every confirmed form is offered; forms still to be
 * confirmed are shown but cannot be used yet. Secondary: "No form from the referrer? Use a built-in
 * report".
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, LayoutTemplate, Upload } from "lucide-react";
import { answerableFields } from "../../../core/forms";
import { INSTRUCTING_PARTY_LABELS, REFERRER_TYPE_LABELS } from "../../../core/labels";
import type { FormDefinition, InstructingParty, ReportTemplate } from "../../../core/types";
import { api } from "../../api-client";
import { Skeleton, cn } from "../../primitives";
import { errorMessage, plural } from "../shared/format";
import { breakdownText, FormKindBadge, Notice, questionBreakdown } from "../shared/ui-bits";
import { getRememberedFormId, matchReasonLabel, matchReferrerForm, type FormMatch } from "./referrer-match";

export type TargetChoice = { kind: "form"; formId: string } | { kind: "template"; templateId: string } | null;

export interface FormStepProps {
  party: InstructingParty;
  forms: FormDefinition[];
  formsReady: boolean;
  choice: TargetChoice;
  onChoice(choice: TargetChoice): void;
  /** Built-in templates, once loaded (the screen needs the chosen one to generate). */
  onTemplates(templates: ReportTemplate[]): void;
  /** Preferred form from the URL (?form=…). */
  preferredFormId?: string;
}

export function FormStep({ party, forms, formsReady, choice, onChoice, onTemplates, preferredFormId }: FormStepProps) {
  const confirmed = useMemo(() => forms.filter((f) => f.status === "confirmed"), [forms]);
  const proposed = useMemo(() => forms.filter((f) => f.status !== "confirmed"), [forms]);
  const match: FormMatch | null = useMemo(
    () => (formsReady ? matchReferrerForm(party, confirmed, getRememberedFormId(party.name)) : null),
    [formsReady, party, confirmed],
  );
  const [showBuiltIn, setShowBuiltIn] = useState(choice?.kind === "template");
  const [templates, setTemplates] = useState<ReportTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Default choice: ?form=, else the referral's referrer's form.
  useEffect(() => {
    if (!formsReady || choice) return;
    const preferred = preferredFormId ? confirmed.find((f) => f.id === preferredFormId) : undefined;
    const pick = preferred ?? match?.form;
    if (pick) onChoice({ kind: "form", formId: pick.id });
  }, [formsReady, choice, preferredFormId, confirmed, match, onChoice]);

  // Built-in templates, loaded when that option is opened.
  useEffect(() => {
    if (!showBuiltIn || templates) return;
    let live = true;
    api.templates().then(
      (res) => {
        if (!live) return;
        setTemplates(res.templates);
        onTemplates(res.templates);
        if (choice?.kind !== "template") {
          const t = res.templates.find((x) => x.audience === party.type) ?? res.templates[0];
          if (t) onChoice({ kind: "template", templateId: t.id });
        }
      },
      (err) => live && setTemplatesError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [showBuiltIn, templates, choice, party.type, onChoice, onTemplates]);

  if (!formsReady) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  const ordered = match ? [match.form, ...confirmed.filter((f) => f.id !== match.form.id)] : confirmed;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <p className="text-slate-600">
          Referred by <span className="font-medium text-slate-900">{party.name}</span> ({INSTRUCTING_PARTY_LABELS[party.type].toLowerCase()})
          {party.reference ? (
            <>
              {" "}
              · reference <span className="font-mono text-slate-900">{party.reference}</span>
            </>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {match
            ? `“${match.form.title}” is selected: ${matchReasonLabel(match.reason).toLowerCase()}.`
            : "No form in the library is linked to this referrer yet. Choose the form they sent – it will be remembered for them."}
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Referrer forms ready to use</legend>
        {ordered.length === 0 ? (
          <Notice tone="info" title="No confirmed referrer forms yet">
            Upload the referrer&apos;s form and confirm its mapping in{" "}
            <Link href="/reports/forms" className="font-medium underline">
              Referrer forms
            </Link>
            , or use a built-in report below.
          </Notice>
        ) : (
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Referrer forms">
            {ordered.map((form) => {
              const selected = choice?.kind === "form" && choice.formId === form.id;
              return (
                <button
                  key={form.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setShowBuiltIn(false);
                    onChoice({ kind: "form", formId: form.id });
                  }}
                  className={cn(
                    "relative flex flex-col gap-2 rounded-2xl border bg-white p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
                    selected ? "border-teal-500 ring-2 ring-teal-500" : "border-slate-200 hover:border-teal-300",
                  )}
                >
                  {selected ? <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-teal-600" aria-hidden /> : null}
                  <div className="pr-7">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{form.referrer.name}</p>
                    <p className="font-semibold text-slate-900">{form.title}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FormKindBadge kind={form.kind} />
                    <span className="text-xs text-slate-500">{REFERRER_TYPE_LABELS[form.referrer.type]}</span>
                    {match?.form.id === form.id ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800">{matchReasonLabel(match.reason)}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-600">
                    {breakdownText(questionBreakdown(form))}
                  </p>
                </button>
              );
            })}
          </div>
        )}
        {proposed.length ? (
          <p className="text-xs text-slate-500">
            Not ready yet:{" "}
            {proposed.map((f, i) => (
              <span key={f.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/reports/forms/${encodeURIComponent(f.id)}`} className="underline hover:text-slate-800">
                  {f.title} ({f.referrer.name})
                </Link>
              </span>
            ))}{" "}
            – confirm the mapping first.
          </p>
        ) : null}
        <Link href="/reports/forms" className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:underline">
          <Upload className="h-4 w-4" aria-hidden />
          The referrer sent a new form? Add it to the library
        </Link>
      </fieldset>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
        <button
          type="button"
          onClick={() => {
            const next = !showBuiltIn;
            setShowBuiltIn(next);
            if (!next && choice?.kind === "template") onChoice(null);
          }}
          aria-expanded={showBuiltIn}
          className="flex w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          <LayoutTemplate className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
          <span>
            <span className="block text-sm font-medium text-slate-900">No form from the referrer? Use a built-in report</span>
            <span className="block text-xs text-slate-500">Our own report layouts, for when a referrer has not sent a form.</span>
          </span>
        </button>
        {showBuiltIn ? (
          <div className="mt-3 space-y-2">
            {templatesError ? <Notice tone="error">{templatesError}</Notice> : null}
            {!templates && !templatesError ? <Skeleton className="h-16 rounded-xl" /> : null}
            {templates?.map((t) => {
              const selected = choice?.kind === "template" && choice.templateId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChoice({ kind: "template", templateId: t.id })}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
                    selected ? "border-teal-500 bg-teal-50/40 ring-1 ring-teal-500" : "border-slate-200 hover:border-teal-300",
                  )}
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{t.name}</span>
                    <span className="block text-xs text-slate-600">{t.description}</span>
                    <span className="block text-[11px] text-slate-500">
                      Written for: {INSTRUCTING_PARTY_LABELS[t.audience]} · {plural(t.sections.length, "section")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
