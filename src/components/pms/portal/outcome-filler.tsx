"use client";

/**
 * An outcome questionnaire on the patient's phone (design round 3 "Outcome questionnaire – patient", 375 px): one
 * question at a time ("Question 3 of 10 · about 3 minutes"), a plain answer scale, "Prefer not to answer" where a
 * question is optional, then "Send to my physio". The score is worked out by the clinic system (records module).
 */
import * as React from "react";
import { Check, ChevronLeft } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import type { FormDefinition } from "@/modules/pms/portal/forms";

type Answer = { ok: true; message?: string; score?: string | null } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface OutcomeFillerProps {
  title: string;
  form: FormDefinition;
  submit: (form: FormData) => Promise<Answer>;
  doneHref: string;
  firstName: string;
}

export function OutcomeFiller({ title, form, submit, doneHref, firstName }: OutcomeFillerProps) {
  const questions = form.fields.filter((f) => f.type === "choice");
  const [i, setI] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ score: string | null } | null>(null);
  const legendRef = React.useRef<HTMLHeadingElement>(null);
  const q = questions[i];
  const last = i === questions.length - 1;
  const minutes = Math.max(1, Math.round(questions.length / 3));

  React.useEffect(() => {
    legendRef.current?.focus();
  }, [i, done]);

  const send = async () => {
    setPending(true);
    setError(null);
    const data = new FormData();
    for (const [k, v] of Object.entries(answers)) data.set(`q_${k}`, v);
    const r = await submit(data);
    setPending(false);
    if (r.ok) setDone({ score: r.score ?? null });
    else setError(r.error);
  };
  const next = () => (last ? void send() : setI(i + 1));

  if (done) {
    return (
      <div role="status" className="space-y-3 pt-2">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#166534] text-white">
          <Check className="h-7 w-7" />
        </span>
        <h1 ref={legendRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
          Thank you, {firstName}
        </h1>
        <p className="text-[15px] text-foreground">
          Your answers have gone to your physiotherapist.
          {done.score ? (
            <>
              {" "}
              Your score: <strong>{done.score}</strong> – they will talk it through with you.
            </>
          ) : null}
        </p>
        <a href={doneHref} className="inline-flex h-11 items-center rounded-[10px] bg-primary-strong px-4 text-[15px] font-semibold text-white">
          Back to my appointments
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label="Previous question" className="-ml-2 flex h-9 w-9 items-center justify-center rounded-[8px] text-foreground disabled:text-[#CBD5E1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <ChevronLeft className="h-[22px] w-[22px]" aria-hidden="true" />
        </button>
        <span className="text-[14px] font-semibold text-foreground">{title}</span>
      </div>
      <p className="mt-2 text-[13px] text-[#334155]">
        Question {i + 1} of {questions.length} · about {minutes} minute{minutes === 1 ? "" : "s"}
      </p>
      <div className="mt-1.5 h-1 rounded-full bg-[#E2E8F0]" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={questions.length} aria-valuenow={i + 1}>
        <div className="h-1 rounded-full bg-primary" style={{ width: `${((i + 1) / questions.length) * 100}%` }} />
      </div>
      {error ? (
        <p role="alert" className="mt-4 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
          {error}
        </p>
      ) : null}
      <fieldset className="mt-5 space-y-2">
        <legend className="w-full">
          <h1 ref={legendRef} tabIndex={-1} className="text-[20px] font-bold text-foreground outline-none">
            {q.label}
          </h1>
          {q.help ? <span className="mt-1 block text-[14px] text-[#334155]">{q.help}</span> : null}
        </legend>
        {(q.options ?? []).map((o) => {
          const on = answers[q.id] === o;
          return (
            <label key={o} className={`flex min-h-12 items-center gap-3 rounded-[10px] border px-3 py-2 text-[15px] ${on ? "border-primary bg-[#F0FDFA]" : "border-border bg-white"}`}>
              <input type="radio" name={`q_${q.id}`} value={o} checked={on} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o }))} className="h-5 w-5 shrink-0 accent-[#0B7970]" />
              <span>{o}</span>
            </label>
          );
        })}
      </fieldset>
      {!q.required ? (
        <PmsButton type="button" variant="link" className="mt-2 px-0" onClick={next}>
          Prefer not to answer
        </PmsButton>
      ) : null}
      <PmsButton type="button" size="lg" className="mt-6 h-12 w-full text-[16px]" disabled={!answers[q.id]} loading={pending} loadingText="Sending…" onClick={next}>
        {last ? "Send to my physio" : "Next"}
      </PmsButton>
    </div>
  );
}
