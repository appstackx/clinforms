"use client";

/**
 * A patient completes a form on their phone (design round 3 "Intake form – patient", 375 px): the form's parts one
 * at a time ("Part 2 of 3 · Your health"), health questions marked as seen only by the practitioner, then consent
 * ticks and a typed signature ("Your typed name counts as your signature. We record the date and time."). One form
 * post at the end; the server checks every answer again and seals the signed copy.
 */
import * as React from "react";
import { Check, Lock } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import type { FormDefinition, FormField } from "@/modules/pms/portal/forms";

type Answer = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface Part {
  title: string;
  help: string | null;
  fields: FormField[];
}

function partsOf(def: FormDefinition): Part[] {
  const parts: Part[] = [];
  let current: Part | null = null;
  for (const f of def.fields) {
    if (f.type === "heading") {
      current = { title: f.label, help: f.help ?? null, fields: [] };
      parts.push(current);
    } else {
      if (!current) {
        current = { title: "Your answers", help: null, fields: [] };
        parts.push(current);
      }
      current.fields.push(f);
    }
  }
  return parts.filter((p) => p.fields.length > 0);
}

const inputCls = "w-full rounded-[10px] border border-[#CBD5E1] bg-white px-3 text-[16px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

function FieldInput({ f, error }: { f: FormField; error?: string }) {
  const id = `q-${f.id}`;
  const name = `q_${f.id}`;
  const describedBy = [f.help ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const label = (
    <>
      {f.label}
      {!f.required && f.type !== "consent" ? <span className="font-normal text-[#475569]"> (optional)</span> : null}
    </>
  );
  const help = f.help ? (
    <p id={`${id}-help`} className="text-[13px] text-[#475569]">
      {f.help}
    </p>
  ) : null;
  const err = error ? (
    <p id={`${id}-err`} role="alert" className="text-[13px] text-destructive-strong">
      {error}
    </p>
  ) : null;
  if (f.type === "yes_no" || f.type === "choice" || f.type === "multi") {
    const options = f.type === "yes_no" ? [["yes", "Yes"], ["no", "No"]] : (f.options ?? []).map((o) => [o, o]);
    return (
      <fieldset className="space-y-2" aria-describedby={describedBy}>
        <legend className="text-[15px] font-medium text-foreground">{label}</legend>
        {help}
        {options.map(([value, text]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 rounded-[10px] border border-border bg-white px-3 py-2 text-[15px]">
            <input type={f.type === "multi" ? "checkbox" : "radio"} name={name} value={value} className="h-5 w-5 shrink-0 accent-[#0B7970]" />
            {text}
          </label>
        ))}
        {err}
      </fieldset>
    );
  }
  if (f.type === "consent") {
    return (
      <div className="space-y-1">
        <label className="flex min-h-11 items-start gap-3 text-[15px] text-foreground">
          <input type="checkbox" name={name} className="mt-0.5 h-5 w-5 shrink-0 accent-[#0B7970]" aria-describedby={describedBy} />
          <span>{f.label}</span>
        </label>
        {help}
        {err}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-medium text-foreground">
        {label}
      </label>
      {help}
      {f.type === "textarea" ? (
        <textarea id={id} name={name} rows={3} className={`${inputCls} py-2`} aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
      ) : (
        <input id={id} name={name} type={f.type === "date" ? "date" : "text"} className={`${inputCls} h-12`} aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
      )}
      {err}
    </div>
  );
}

export interface FormFillerProps {
  title: string;
  form: FormDefinition;
  requiresSignature: boolean;
  signatureStatement: string | null;
  submit: (form: FormData) => Promise<Answer>;
  doneHref: string;
  doneLabel: string;
}

export function FormFiller({ title, form, requiresSignature, signatureStatement, submit, doneHref, doneLabel }: FormFillerProps) {
  const parts = React.useMemo(() => {
    const p = partsOf(form);
    if (requiresSignature) p.push({ title: "Consent and signature", help: null, fields: [] });
    return p;
  }, [form, requiresSignature]);
  const [part, setPart] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState<{ at: string; name: string } | null>(null);
  const [typed, setTyped] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const last = part === parts.length - 1;

  React.useEffect(() => {
    headingRef.current?.focus();
  }, [part, done]);

  const send = async () => {
    if (!formRef.current) return;
    setPending(true);
    setError(null);
    const data = new FormData(formRef.current);
    const r = await submit(data);
    setPending(false);
    if (r.ok) {
      setDone({ at: new Date().toLocaleString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " at"), name: typed.trim() });
      return;
    }
    setError(r.error);
    const errs = r.fieldErrors ?? {};
    setFieldErrors(errs);
    const firstBad = parts.findIndex((p) => p.fields.some((f) => errs[f.id])) ?? -1;
    if (firstBad >= 0) setPart(firstBad);
    else if (errs.signature) setPart(parts.length - 1);
  };

  if (done) {
    return (
      <div role="status" className="space-y-3 rounded-[12px] border border-[#BBF7D0] bg-[#F0FDF4] p-4">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#166534] text-white">
          <Check className="h-7 w-7" />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
          {requiresSignature ? "Signed and sent" : "Sent"}
        </h1>
        <p className="text-[15px] text-foreground">{requiresSignature ? `Signed by ${done.name} on ${done.at}. You'll find a copy under "Shared with you" in your portal.` : "Thanks – your answers have been sent to the clinic."}</p>
        <a href={doneHref} className="inline-flex h-11 items-center rounded-[10px] bg-primary-strong px-4 text-[15px] font-semibold text-white">
          {doneLabel}
        </a>
      </div>
    );
  }

  const current = parts[part];
  const sensitive = current.fields.some((f) => f.sensitive);
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (last) void send();
        else setPart(part + 1);
      }}
    >
      <p className="text-[13px] text-[#475569]">{title}</p>
      <p className="mt-1 text-[13px] text-[#334155]">
        Part {part + 1} of {parts.length} · {current.title}
      </p>
      <div className="mt-1.5 h-1 rounded-full bg-[#E2E8F0]" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={parts.length} aria-valuenow={part + 1}>
        <div className="h-1 rounded-full bg-primary" style={{ width: `${((part + 1) / parts.length) * 100}%` }} />
      </div>
      {error ? (
        <p role="alert" className="mt-4 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
          {error}
        </p>
      ) : null}
      {parts.map((p, i) => (
        <section key={i} hidden={i !== part} className="mt-4 space-y-5">
          <h1 ref={i === part ? headingRef : undefined} tabIndex={-1} className="text-[22px] font-bold text-foreground outline-none">
            {p.title}
          </h1>
          {p.help ? <p className="text-[14px] text-[#334155]">{p.help}</p> : null}
          {i === part && sensitive ? (
            <div role="note" className="flex gap-2 rounded-[10px] border border-[#FBD38D] bg-[#FFFBEB] p-3 text-[14px] text-[#864E0E]">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Only your physiotherapist sees these answers. Reception staff don&apos;t.</span>
            </div>
          ) : null}
          {p.fields.map((f) => (
            <FieldInput key={f.id} f={f} error={fieldErrors[f.id]} />
          ))}
          {requiresSignature && i === parts.length - 1 ? (
            <div className="space-y-3 rounded-[12px] border border-border bg-white p-4">
              {signatureStatement ? <p className="text-[15px] text-foreground">{signatureStatement}</p> : null}
              <div className="space-y-1.5">
                <label htmlFor="sig" className="block text-[15px] font-medium text-foreground">
                  Type your full name to sign
                </label>
                <input id="sig" name="signature" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="name" className={`${inputCls} h-12`} aria-describedby="sig-help" aria-invalid={fieldErrors.signature ? true : undefined} />
                <p id="sig-help" className="text-[13px] text-[#475569]">
                  Your typed name counts as your signature. We record the date and time.
                </p>
                {fieldErrors.signature ? (
                  <p role="alert" className="text-[13px] text-destructive-strong">
                    {fieldErrors.signature}
                  </p>
                ) : null}
              </div>
              <label className="flex min-h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-5 w-5 accent-[#0B7970]" />I understand that typing my name counts as my signature
              </label>
            </div>
          ) : null}
        </section>
      ))}
      <div className="mt-6 flex gap-2">
        {part > 0 ? (
          <PmsButton type="button" variant="secondary" size="lg" onClick={() => setPart(part - 1)}>
            Back
          </PmsButton>
        ) : null}
        <PmsButton type="submit" size="lg" className="flex-1" disabled={last && requiresSignature && !(typed.trim().length > 3 && agree)} loading={pending} loadingText="Sending…">
          {last ? (requiresSignature ? "Sign and send" : "Send") : "Continue"}
        </PmsButton>
      </div>
    </form>
  );
}

/** A completed copy, read-only (the patient's own answers and signature). */
export function SignedCopy({ title, rows, signature }: { title: string; rows: { q: string; a: string }[]; signature: string | null }) {
  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-bold text-foreground">{title}</h1>
      <p className="text-[14px] text-[#334155]">Sent and sealed – it can&apos;t be changed. To update an answer, contact the clinic.</p>
      <dl className="divide-y divide-border rounded-[12px] border border-border bg-white">
        {rows.map((r, i) => (
          <div key={i} className="px-4 py-3">
            <dt className="text-[13px] text-[#475569]">{r.q}</dt>
            <dd className="text-[15px] text-foreground">{r.a}</dd>
          </div>
        ))}
      </dl>
      {signature ? <p className="text-[14px] text-[#334155]">{signature}</p> : null}
    </div>
  );
}
