"use client";
/**
 * New letter (design round 3, letter editor's left column): choose the template (with who it is to), the case, the
 * recipient – "Start letter" merges the template with the record and opens the editor. messages.letters.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { LetterStartView } from "@/modules/pms/comms/view";
import { cn } from "@/lib/utils";
import { FormField, PmsButton, PmsNotice, SelectInput } from "@/components/pms/ui";
import { startLetterAction } from "@/app/app/clinic/letters/actions";
import { MESSAGES_PATH, focusRing } from "./format";

export function LetterStart({ view }: { view: LetterStartView }) {
  const router = useRouter();
  const [templateId, setTemplateId] = React.useState(view.templates[0]?.id ?? "");
  const t = view.templates.find((x) => x.id === templateId);
  const [caseId, setCaseId] = React.useState(view.cases[0]?.id ?? "");
  const options = view.recipients.filter((r) => !t || r.kind === t.recipientKind || t.recipientKind === "other");
  const [recipient, setRecipient] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setRecipient(options[0]?.value ?? ""), [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setBusy(true);
    setError(null);
    const r = await startLetterAction({ patientId: view.patient.id, templateId, caseId: caseId || null, recipient: recipient || undefined });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(`/app/clinic/letters/${r.id}`);
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={`/app/clinic/patients/${view.patient.id}/messages`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          {view.patient.name}
        </Link>
        <span aria-hidden> / </span>
        <Link href={`${MESSAGES_PATH}?tab=letters`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Letters
        </Link>
        <span aria-hidden> / </span>
        <span>New letter</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">New letter for {view.patient.name}</h1>
      <fieldset className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-4" data-testid="letter-templates">
        <legend className="px-1 text-sm font-semibold">Template</legend>
        {view.templates.map((x) => (
          <label key={x.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5", templateId === x.id ? "border-[#0E958A] bg-[#F0FDFA]" : "border-border")}>
            <input type="radio" name="letter-template" value={x.id} checked={templateId === x.id} onChange={() => setTemplateId(x.id)} className="mt-1 h-4 w-4 accent-[#0B7970]" />
            <span className="flex flex-col">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{x.name}</span>
                {x.recipientKind === "gp" || x.recipientKind === "referrer" ? <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[11px] font-semibold text-[#864E0E]">Clinical</span> : null}
              </span>
              <span className="text-xs text-[#475569]">{x.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-white p-4 sm:grid-cols-2">
        <FormField id="letter-case" label="Case">
          <SelectInput value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">No case</option>
            {view.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectInput>
        </FormField>
        <FormField id="letter-recipient" label="Recipient">
          <SelectInput value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            {options.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
            <option value="other">Someone else (type their details)</option>
          </SelectInput>
        </FormField>
      </div>
      {error ? <PmsNotice tone="error" title={error} /> : null}
      <div className="flex justify-end">
        <PmsButton loading={busy} disabled={!templateId} onClick={() => void start()} data-testid="start-letter">
          Start letter
        </PmsButton>
      </div>
    </div>
  );
}
