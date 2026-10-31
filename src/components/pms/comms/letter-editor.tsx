"use client";
/**
 * The letter editor (design round 3, "Letter editor"): breadcrumb, the template and the recipient on the left (name,
 * address, email) with the merge fields still to fill, Edit / A4 preview, the letter (subject and text), the
 * signature that will be added ("Signature from your signing details. Added when you sign."), and Save draft ·
 * Print · Download PDF / Download Word (the saved letter as a file, ./file?format=pdf|docx) · Sign and send by email (or Sign only, for post).
 * A signed letter no longer changes (it can be sent, printed or withdrawn). messages.letters – never reception.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { PenLine, Printer, Send } from "lucide-react";
import type { LetterEditorView } from "@/modules/pms/comms/view";
import { LETTER_STATUS_LABELS, RECIPIENT_KIND_LABELS, SENT_VIA_LABELS } from "@/modules/pms/comms/copy";
import { hasUnfilledFields } from "@/modules/pms/comms/merge-fields";
import { cn } from "@/lib/utils";
import { ConfirmDialog, FormField, PmsButton, PmsNotice, TextArea, TextInput, pmsButtonVariants, useToast } from "@/components/pms/ui";
import { saveLetterAction, signLetterAction, voidLetterAction } from "@/app/app/clinic/letters/actions";
import { LETTERS_PATH, MESSAGES_PATH, focusRing } from "./format";
import { LetterSheet } from "./letter-sheet";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";

export function LetterEditor({ view }: { view: LetterEditorView }) {
  const router = useRouter();
  const toast = useToast();
  const l = view.letter;
  const draft = l.status === "draft";
  const [rev, setRev] = React.useState(l.rev);
  const [mode, setMode] = React.useState<"edit" | "preview">(draft ? "edit" : "preview");
  const [subject, setSubject] = React.useState(l.subject);
  const [body, setBody] = React.useState(l.body);
  const [rName, setRName] = React.useState(l.recipientName ?? "");
  const [rAddress, setRAddress] = React.useState((l.recipientAddress ?? []).join("\n"));
  const [rPostcode, setRPostcode] = React.useState(l.recipientPostcode ?? "");
  const [rEmail, setREmail] = React.useState(l.recipientEmail ?? "");
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [confirmVoid, setConfirmVoid] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => setRev(l.rev), [l.rev]);

  const unfilled = hasUnfilledFields(subject) || hasUnfilledFields(body);
  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setDirty(true);
  };

  async function save(): Promise<number | null> {
    setBusy("save");
    setError(null);
    setFieldErrors({});
    const r = await saveLetterAction({
      id: l.id,
      rev,
      subject,
      body,
      recipientName: rName || null,
      recipientAddress: rAddress.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6),
      recipientPostcode: rPostcode || null,
      recipientEmail: rEmail.trim() || null,
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setFieldErrors(r.fieldErrors ?? {});
      return null;
    }
    setRev(r.rev);
    setDirty(false);
    return r.rev;
  }

  async function sign(send: "email" | "post" | null) {
    let current = rev;
    if (draft && dirty) {
      const saved = await save();
      if (saved === null) return;
      current = saved;
    }
    setBusy(send === "email" ? "send" : "sign");
    setError(null);
    const r = await signLetterAction({ id: l.id, rev: current, send });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setFieldErrors(r.fieldErrors ?? {});
      return;
    }
    toast.success(send === "email" ? `Signed. ${r.sent?.label ?? ""}` : send === "post" ? "Signed and marked as posted." : "Signed.");
    router.refresh();
  }

  function insert(key: string) {
    const token = `{{${key}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setDirty(true);
  }

  const sheet = (
    <LetterSheet
      clinic={view.clinic}
      letterOn={l.letterOn}
      recipient={{ name: rName || null, address: rAddress.split("\n").filter(Boolean), postcode: rPostcode || null }}
      subject={subject}
      body={body}
      signature={l.signatureText}
      draft={draft}
      withdrawn={l.status === "void"}
    />
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={`/app/clinic/patients/${l.patientId}/messages`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          {view.patientName}
        </Link>
        <span aria-hidden> / </span>
        <Link href={`${MESSAGES_PATH}?tab=letters`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Letters
        </Link>
        <span aria-hidden> / </span>
        <span>{view.templateName}</span>
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{view.templateName}</h1>
        <span className="text-sm text-[#475569]" data-testid="letter-status">
          {l.status === "final" ? `Signed${l.sentVia ? ` · sent ${SENT_VIA_LABELS[l.sentVia].toLowerCase()}` : ""}` : LETTER_STATUS_LABELS[l.status]}
          {draft ? (dirty ? " · not saved yet" : " · saved") : ""}
        </span>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-white p-4">
          <h2 className="text-sm font-semibold">Recipient</h2>
          <p className="text-xs text-[#475569]">{RECIPIENT_KIND_LABELS[l.recipientKind]}</p>
          <FormField id="lr-name" label="Name">
            <TextInput value={rName} onChange={(e) => mark(setRName)(e.target.value)} disabled={!draft} maxLength={160} />
          </FormField>
          <FormField id="lr-address" label="Address" hint="One line each">
            <TextArea rows={3} value={rAddress} onChange={(e) => mark(setRAddress)(e.target.value)} disabled={!draft} />
          </FormField>
          <FormField id="lr-postcode" label="Postcode">
            <TextInput value={rPostcode} onChange={(e) => mark(setRPostcode)(e.target.value)} disabled={!draft} maxLength={10} />
          </FormField>
          <FormField id="lr-email" label="Email (to send it by email)" error={fieldErrors.recipientEmail}>
            <TextInput type="email" value={rEmail} onChange={(e) => mark(setREmail)(e.target.value)} disabled={!draft} />
          </FormField>
          {draft ? (
            <div className="flex flex-col gap-1.5">
              <h2 className="text-sm font-semibold">Merge fields</h2>
              <div className="flex flex-wrap gap-1.5">
                {view.fields.map((f) => (
                  <button key={f.key} type="button" onClick={() => insert(f.key)} title={f.label} className={cn("rounded-md border border-[#C7D4F5] bg-[#EFF4FF] px-2 py-1 font-mono text-[11px] text-[#1842B4]", focusRing)}>
                    {`{{${f.key}}}`}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[#475569]">Click to insert at the cursor. Filled in when you save.</span>
            </div>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Letter view" className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
              {(["edit", "preview"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  disabled={m === "edit" && !draft}
                  onClick={() => setMode(m)}
                  className={cn("h-8 rounded-md px-3 text-sm font-medium", focusRing, mode === m ? "bg-white shadow-sm" : "text-[#475569]", m === "edit" && !draft && "opacity-50")}
                  data-testid={`letter-${m}`}
                >
                  {m === "edit" ? "Edit" : "A4 preview"}
                </button>
              ))}
            </div>
            {unfilled && draft ? <span className="text-sm text-accent-text">There are gaps to fill: &quot;[[…]]&quot; or &quot;[not recorded: …]&quot;.</span> : null}
          </div>

          {mode === "edit" && draft ? (
            <div className="flex flex-col rounded-2xl border border-border bg-white">
              <div className="flex flex-col gap-3 p-4">
                <FormField id="l-subject" label="Subject (the Re: line)">
                  <TextInput value={subject} onChange={(e) => mark(setSubject)(e.target.value)} maxLength={200} />
                </FormField>
                <FormField id="l-body" label="Letter" hint='Blank line = new paragraph; lines starting "- " are bullets.'>
                  <TextArea ref={bodyRef} rows={18} value={body} onChange={(e) => mark(setBody)(e.target.value)} className="font-[inherit] leading-6" />
                </FormField>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border px-4 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <PenLine className="h-4 w-4" aria-hidden />
                  <span>
                    <span className="block font-[cursive] text-base">{view.signatureWillBe.split(",")[0]}</span>
                    <span className="text-[#334155]" data-testid="signature-will-be">
                      {view.signatureWillBe}
                    </span>
                  </span>
                </span>
                <span className="text-xs text-[#475569]">Signature from your signing details. Added when you sign.</span>
              </div>
            </div>
          ) : (
            <ScrollRegion label="Letter preview" className="relative overflow-x-auto rounded-2xl bg-[#E2E8F0] p-4" data-testid="letter-a4">
              {sheet}
            </ScrollRegion>
          )}

          {error ? <PmsNotice tone="error" title={error} /> : null}
          {view.sentByEmail ? (
            <PmsNotice tone="success" title="Sent by email">
              {view.emailTo} – {view.sentByEmail.status === "outbox" ? "kept in the outbox (not sent)" : view.sentByEmail.status}
            </PmsNotice>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {draft ? (
              <PmsButton variant="secondary" loading={busy === "save"} onClick={() => void save().then((r) => r !== null && toast.success("Draft saved."))} data-testid="save-draft">
                Save draft
              </PmsButton>
            ) : null}
            <Link href={`${LETTERS_PATH}/${l.id}/print`} className={pmsButtonVariants({ variant: "secondary" })} data-testid="print-letter">
              <Printer aria-hidden />
              Print
            </Link>
            <a href={`${LETTERS_PATH}/${l.id}/file?format=pdf`} download className={pmsButtonVariants({ variant: "secondary" })} data-testid="download-letter-pdf">
              Download PDF
            </a>
            <a href={`${LETTERS_PATH}/${l.id}/file?format=docx`} download className={pmsButtonVariants({ variant: "secondary" })} data-testid="download-letter-docx">
              Download Word
            </a>
            {draft ? (
              <PmsButton variant="secondary" loading={busy === "sign"} disabled={unfilled} onClick={() => void sign("post")}>
                Sign (to post)
              </PmsButton>
            ) : null}
            {l.status !== "void" && !l.sentAt ? (
              <PmsButton loading={busy === "send"} disabled={draft && unfilled} onClick={() => void sign("email")} data-testid="sign-send">
                <Send aria-hidden />
                {draft ? "Sign and send by email" : "Send by email"}
              </PmsButton>
            ) : null}
            {l.status !== "void" ? (
              <PmsButton variant="ghost" onClick={() => setConfirmVoid(true)}>
                Withdraw
              </PmsButton>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmVoid}
        onOpenChange={setConfirmVoid}
        title="Withdraw this letter?"
        description="It is kept on the record, marked withdrawn. Use this for a letter written in error."
        confirmLabel="Withdraw letter"
        destructive
        pending={busy === "void"}
        onConfirm={() => {
          setBusy("void");
          void voidLetterAction(l.id).then((r) => {
            setBusy(null);
            if (!r.ok) toast.error(r.error);
            else toast.success("Letter withdrawn.");
            setConfirmVoid(false);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
