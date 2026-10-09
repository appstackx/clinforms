"use client";

/**
 * Approve dialog: the declaration (the form's own sign-off fields, or the built-in template's
 * declaration), the clinician's name and HCPC number (prefilled from the launch), a typed signature and
 * the attestations. Approval goes to POST /sign, which re-runs every check and returns a server-signed
 * receipt over the exact content approved.
 * Tenant mode (a clinic's own Studio): the signer is the signed-in member, from their clinic profile
 * (name and HCPC number shown read-only when the profile has them); no demo hints.
 *
 * Owner: studio-b agent.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, PenLine, ShieldCheck } from "lucide-react";
import { signoffValuesFromReceipt } from "../../../core/forms";
import { SIGNOFF_PART_LABELS } from "../../../core/labels";
import type { Clinician, FormDefinition, Report, ReportFlag, ReportTemplate } from "../../../core/types";
import { useStudioMode } from "../../host-hooks";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, cn } from "../../primitives";
import { TENANT_COPY } from "../../studio-copy";
import { InlineAlert } from "./review-ui";

export interface ApproveInput {
  signer: Clinician;
  typedSignature: string;
  statementAccepted: boolean;
  attestations: string[];
}

export type ApproveResult = { ok: true } | { ok: false; title: string; detail?: string; issues?: string[]; blocking?: ReportFlag[] };

const normaliseName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange(v: boolean): void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#0D9488] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1"
      />
      <label htmlFor={id} className="text-[13px] leading-relaxed text-slate-800">
        {children}
      </label>
    </div>
  );
}

export function ApproveDialog({
  open,
  onOpenChange,
  report,
  template,
  form,
  defaultSigner,
  onApprove,
  onApproved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  report: Report;
  template: ReportTemplate;
  form: FormDefinition | null;
  defaultSigner: Clinician | null;
  onApprove(input: ApproveInput): Promise<ApproveResult>;
  /** Called after the dialog closes following a successful approval (move focus to the result). */
  onApproved(): void;
}) {
  const ids = useId();
  const tenant = useStudioMode() === "tenant";
  // A clinic's signer is the signed-in member: their profile's name and HCPC number are not retyped.
  const signerLocked = tenant && Boolean(defaultSigner?.name && defaultSigner.hcpc);
  const isForm = Boolean(report.form);
  // A portal question set: no file and no sign-off boxes – the answers are copied into the portal.
  const questionSet = report.form?.kind === "questions";
  const [name, setName] = useState(defaultSigner?.name ?? "");
  const [hcpc, setHcpc] = useState(defaultSigner?.hcpc ?? "");
  const [typed, setTyped] = useState("");
  const [statement, setStatement] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<ApproveResult, { ok: false }> | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const signerRef = useRef(defaultSigner);
  signerRef.current = defaultSigner;
  // Start afresh each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(signerRef.current?.name ?? "");
    setHcpc(signerRef.current?.hcpc ?? "");
    setTyped("");
    setStatement(false);
    setTicked([]);
    setFailure(null);
    setSucceeded(false);
  }, [open]);

  const signoffFields = useMemo(
    () => (form ? form.fields.filter((f) => f.fillSource.kind === "signoff") : []),
    [form],
  );
  const previewValues = useMemo(
    () => signoffValuesFromReceipt({ signer: { name: name.trim() || "—", hcpc: hcpc.trim() || "—" }, signedAt: new Date().toISOString() }),
    [name, hcpc],
  );

  const nameOk = name.trim().length >= 2;
  const hcpcOk = hcpc.trim().length >= 2;
  const typedOk = typed.trim().length > 0 && normaliseName(typed) === normaliseName(name);
  const allTicked = template.attestations.every((a) => ticked.includes(a));
  const canSubmit = nameOk && hcpcOk && typedOk && statement && allTicked && !busy;

  const referrer = report.form?.referrer.name ?? report.instructingParty.name;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setFailure(null);
    const signer: Clinician = { name: name.trim(), hcpc: hcpc.trim(), ...(defaultSigner?.role && normaliseName(defaultSigner.name) === normaliseName(name) ? { role: defaultSigner.role } : {}) };
    const result = await onApprove({ signer, typedSignature: typed.trim(), statementAccepted: true, attestations: template.attestations.filter((a) => ticked.includes(a)) });
    setBusy(false);
    if (result.ok) {
      setSucceeded(true);
      onOpenChange(false);
    } else {
      setFailure(result);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(e) => {
          if (succeeded) {
            e.preventDefault();
            onApproved();
          }
        }}
      >
        <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-[#0D9488]" aria-hidden />
            {isForm ? "Approve the completed form" : "Sign the report"}
          </DialogTitle>
          <DialogDescription>
            {report.patientLabel} · {isForm ? `${referrer}'s “${report.form?.title}”` : template.name}. Nothing is issued until you approve it.
          </DialogDescription>
        </DialogHeader>

        <form
          id={`${ids}-form`}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <section aria-labelledby={`${ids}-decl`} className="space-y-2.5">
            <h3 id={`${ids}-decl`} className="text-sm font-semibold text-slate-900">
              Declaration
            </h3>
            {isForm ? (
              <>
                {signoffFields.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[13px] text-slate-700">On approval these fields on {referrer}&apos;s form are completed from your approval:</p>
                    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
                      {signoffFields.map((f) => {
                        const part = f.fillSource.kind === "signoff" ? f.fillSource.part : "signature";
                        return (
                          <div key={f.id} className="contents">
                            <dt className="text-slate-500">
                              {f.label} <span className="font-mono text-[11px]">({f.id})</span>
                            </dt>
                            <dd className="font-medium text-slate-900">
                              {previewValues[part]}
                              <span className="sr-only"> ({SIGNOFF_PART_LABELS[part]})</span>
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-600">
                    {questionSet ? "These portal questions have" : "This form has"} no sign-off fields. Your approval is recorded in the server-signed receipt
                    and the activity log.
                  </p>
                )}
                <Check id={`${ids}-statement`} checked={statement} onChange={setStatement}>
                  {questionSet
                    ? `I confirm that these answers are accurate to the best of my knowledge and belief, and I approve them for entry in ${referrer}'s portal.`
                    : `I confirm that the answers on this completed form are accurate to the best of my knowledge and belief, and I approve it for issue to ${referrer}.`}
                </Check>
              </>
            ) : (
              <>
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-800">
                  {template.declarationText || "This report contains no declaration wording."}
                </div>
                {template.declarationNote && <p className="text-xs italic text-slate-500">{template.declarationNote}</p>}
                <Check id={`${ids}-statement`} checked={statement} onChange={setStatement}>
                  I confirm the declaration above.
                </Check>
              </>
            )}
          </section>

          <section aria-labelledby={`${ids}-who`} className="space-y-3">
            <h3 id={`${ids}-who`} className="text-sm font-semibold text-slate-900">
              Approving clinician
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${ids}-name`} className="text-xs font-medium text-slate-700">
                  Full name
                </label>
                <Input
                  id={`${ids}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={signerLocked}
                  className={signerLocked ? "bg-slate-50 text-slate-700" : undefined}
                  autoComplete="name"
                  aria-invalid={!nameOk && name !== "" ? true : undefined}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${ids}-hcpc`} className="text-xs font-medium text-slate-700">
                  HCPC registration number
                </label>
                <Input
                  id={`${ids}-hcpc`}
                  value={hcpc}
                  onChange={(e) => setHcpc(e.target.value)}
                  readOnly={signerLocked}
                  className={signerLocked ? "bg-slate-50 text-slate-700" : undefined}
                  placeholder={tenant ? "Your HCPC registration number" : "e.g. PH-DEMO-01"}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${ids}-typed`} className="text-xs font-medium text-slate-700">
                Typed signature – type your full name exactly as above
              </label>
              <Input
                id={`${ids}-typed`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="font-serif text-base italic"
                placeholder={name || "Your full name"}
                aria-describedby={`${ids}-typed-help`}
                aria-invalid={typed !== "" && !typedOk ? true : undefined}
              />
              <p id={`${ids}-typed-help`} className={cn("text-xs", typed !== "" && !typedOk ? "text-red-700" : "text-slate-500")}>
                {typed !== "" && !typedOk
                  ? "The typed signature must match the name above."
                  : tenant
                    ? TENANT_COPY.review.approveSignerHint
                    : "Demo data only – use the fictional clinician, e.g. Sarah Reid, PH-DEMO-01."}
              </p>
            </div>
          </section>

          <section aria-labelledby={`${ids}-att`} className="space-y-2.5">
            <h3 id={`${ids}-att`} className="text-sm font-semibold text-slate-900">
              Attestations
            </h3>
            {template.attestations.map((a, i) => (
              <Check
                key={a}
                id={`${ids}-att-${i}`}
                checked={ticked.includes(a)}
                onChange={(v) => setTicked((list) => (v ? Array.from(new Set([...list, a])) : list.filter((x) => x !== a)))}
              >
                {a}
              </Check>
            ))}
          </section>

          <InlineAlert tone="info">
            <span className="inline-flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {questionSet
                ? "The server re-runs every check, then signs a receipt over the exact content you approve (its fingerprint). The answers are then locked, ready to copy into the portal, and a summary PDF is kept for the record."
                : "The server re-runs every check, then signs a receipt over the exact content you approve (its fingerprint). The form is then locked, and the final document is the referrer's original file with the answers and your sign-off written in."}
            </span>
          </InlineAlert>

          {failure && (
            <InlineAlert tone="error" title={failure.title} role="alert">
              {failure.detail && <p>{failure.detail}</p>}
              {failure.issues && failure.issues.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {failure.issues.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
              {failure.blocking && failure.blocking.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {failure.blocking.slice(0, 6).map((f) => (
                    <li key={f.id}>
                      {f.sectionKey ? `${f.sectionKey}: ` : ""}
                      {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </InlineAlert>
          )}
        </form>

        <DialogFooter className="gap-2 border-t border-slate-200 px-5 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={!canSubmit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />}
            {isForm ? "Approve and sign" : "Sign report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
