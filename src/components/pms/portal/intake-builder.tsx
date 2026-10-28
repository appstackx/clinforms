"use client";

/**
 * The intake form builder (design round 3 "Intake forms – builder"): the form's name, its questions in order (type,
 * required, "Mark clinical" – clinical answers are shown only to clinicians, admins and the owner), add a question by
 * type, sending rules, who sees the answers, Save draft / Publish v{n+1}. Forms already signed keep the version the
 * patient saw (each patient's copy is a snapshot). The typed signature is always last.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { PmsButton, SelectInput, Switch, TextArea, TextInput, useToast } from "@/components/pms/ui";
import { FIELD_TYPE_LABELS, RECORD_FIELDS, recordFieldFits, type FieldType, type FormField, type RecordField } from "@/modules/pms/portal/forms";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { INTAKE_FORM_KIND_LABELS, SEND_WHEN_LABELS, type IntakeFormKind, type SendWhen } from "@/modules/pms/portal/schemas";
import type { IntakeTemplate } from "@/modules/pms/portal/types";

type Answer = { ok: true; message?: string; rev?: number } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const ADD_TYPES: { type: FieldType; label: string }[] = [
  { type: "text", label: "Short text" },
  { type: "textarea", label: "Long text" },
  { type: "yes_no", label: "Yes / no" },
  { type: "choice", label: "Choice" },
  { type: "multi", label: "Tick all that apply" },
  { type: "date", label: "Date" },
  { type: "consent", label: "Consent tick" },
  { type: "heading", label: "Part heading" },
];

function newId(fields: FormField[], label: string): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 30) || "q";
  let id = base;
  for (let n = 2; fields.some((f) => f.id === id); n++) id = `${base}_${n}`;
  return id;
}

export function IntakeBuilder({ template, save }: { template: IntakeTemplate; save: (id: string, rev: number, patch: unknown) => Promise<Answer> }) {
  const router = useRouter();
  const toast = useToast();
  const [rev, setRev] = React.useState(template.rev);
  const [name, setName] = React.useState(template.name);
  const [kind, setKind] = React.useState<IntakeFormKind>(template.kind);
  const [sendWhen, setSendWhen] = React.useState<SendWhen>(template.sendWhen);
  const [requiresSignature, setRequiresSignature] = React.useState(template.requiresSignature);
  const [statement, setStatement] = React.useState(template.signatureStatement ?? "");
  const [setsConsent, setSetsConsent] = React.useState(template.setsTreatmentConsent);
  const [fields, setFields] = React.useState<FormField[]>(template.definition.fields);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const update = (i: number, patch: Partial<FormField>) => setFields((all) => all.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((all) => {
      const j = i + d;
      if (j < 0 || j >= all.length) return all;
      const copy = all.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const add = (type: FieldType) =>
    setFields((all) => {
      const label = type === "heading" ? "New part" : type === "consent" ? "I agree to …" : "New question";
      const f: FormField = { id: newId(all, label), type, label, required: type === "consent", ...(type === "choice" || type === "multi" ? { options: ["Option 1", "Option 2"] } : {}) };
      return [...all, f];
    });
  const clinicalCount = fields.filter((f) => f.sensitive).length;

  async function submit(status: "draft" | "active") {
    setBusy(status);
    setError(null);
    const clean = fields.map((f) => ({ ...f, help: f.help || null, recordField: f.recordField || null }));
    const r = await save(template.id, rev, {
      name,
      kind,
      sendWhen,
      requiresSignature,
      signatureStatement: statement.trim() || null,
      setsTreatmentConsent: setsConsent,
      definition: { fields: clean },
      status,
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.rev) setRev(r.rev);
    toast.success(r.message ?? "Saved.");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={STAFF_PORTAL_PATHS.intake} className="text-primary-strong underline underline-offset-2">
          Intake forms
        </Link>
        <span aria-hidden> / </span>
        <span>{template.name}</span>
      </nav>
      {error ? (
        <p role="alert" className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="b-h" className="min-w-0 rounded-[12px] border border-border bg-white p-5">
          <h1 id="b-h" className="sr-only">
            Form builder
          </h1>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1 space-y-1">
              <label htmlFor="fname" className="block text-sm font-medium text-foreground">
                Form name
              </label>
              <TextInput id="fname" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <span className="rounded-full bg-[#F1F5F9] px-2.5 py-1 text-xs font-medium text-[#334155]">
              {template.status === "active" ? "Published" : template.status === "draft" ? "Draft" : "Archived"} · v{template.version}
            </span>
          </div>
          <ol className="mt-4 space-y-2">
            {fields.map((f, i) => {
              const canClinical = f.type !== "heading" && f.type !== "consent";
              return (
                <li key={`${f.id}-${i}`} className={`rounded-[10px] border p-3 ${f.sensitive ? "border-[#FBD38D] bg-[#FFFBEB]" : "border-border bg-white"}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="mt-2 w-6 text-xs tabular-nums text-[#475569]">{i + 1}</span>
                    <div className="min-w-[200px] flex-1 space-y-1">
                      <label htmlFor={`q-label-${i}`} className="sr-only">
                        Question {i + 1} wording
                      </label>
                      <TextInput id={`q-label-${i}`} value={f.label} onChange={(e) => update(i, { label: e.target.value })} className={f.type === "heading" ? "font-semibold" : undefined} />
                      <span className="block text-xs text-[#475569]">
                        {FIELD_TYPE_LABELS[f.type]}
                        {f.required ? " · required" : ""}
                      </span>
                    </div>
                    {canClinical ? (
                      <button
                        type="button"
                        aria-pressed={Boolean(f.sensitive)}
                        onClick={() => update(i, { sensitive: !f.sensitive })}
                        className={`h-8 rounded-full border px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${f.sensitive ? "border-[#FBD38D] bg-[#FEF3C7] text-[#864E0E]" : "border-border bg-white text-[#475569]"}`}
                      >
                        {f.sensitive ? "Clinical" : "Mark clinical"}
                      </button>
                    ) : null}
                    <div className="flex gap-1">
                      <PmsButton size="icon" variant="secondary" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </PmsButton>
                      <PmsButton size="icon" variant="secondary" aria-label={`Move question ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </PmsButton>
                      <PmsButton size="icon" variant="secondary" aria-label={`Remove question ${i + 1}`} onClick={() => setFields((all) => all.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </PmsButton>
                    </div>
                  </div>
                  {f.type !== "heading" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-4 pl-8">
                      <Switch id={`q-req-${i}`} checked={Boolean(f.required)} onCheckedChange={(v) => update(i, { required: v })} label="Required" />
                      <div className="flex items-center gap-2">
                        <label htmlFor={`q-rec-${i}`} className="text-xs text-[#475569]">
                          Copies to the record as
                        </label>
                        <SelectInput id={`q-rec-${i}`} value={f.recordField ?? ""} onChange={(e) => update(i, { recordField: (e.target.value || null) as RecordField | null })} className="h-8 w-48 text-xs">
                          <option value="">– nothing –</option>
                          {(Object.keys(RECORD_FIELDS) as RecordField[])
                            .filter((k) => recordFieldFits(f.type, k))
                            .map((k) => (
                              <option key={k} value={k}>
                                {RECORD_FIELDS[k].label}
                              </option>
                            ))}
                        </SelectInput>
                      </div>
                    </div>
                  ) : null}
                  {f.type === "choice" || f.type === "multi" ? (
                    <div className="mt-2 space-y-1 pl-8">
                      <label htmlFor={`q-opt-${i}`} className="block text-xs text-[#475569]">
                        Choices (one per line)
                      </label>
                      <TextArea id={`q-opt-${i}`} rows={3} value={(f.options ?? []).join("\n")} onChange={(e) => update(i, { options: e.target.value.split("\n") })} />
                    </div>
                  ) : null}
                </li>
              );
            })}
            {requiresSignature ? (
              <li className="flex items-center gap-2 rounded-[10px] border border-dashed border-border bg-[#F8FAFC] p-3 text-sm text-[#475569]">
                <span className="w-6 text-xs">{fields.length + 1}</span>
                <span className="flex-1">Signature – typed e-signature</span>
                <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs">Always last</span>
              </li>
            ) : null}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Add a question">
            <span className="text-sm text-[#475569]">Add a question</span>
            {ADD_TYPES.map((a) => (
              <PmsButton key={a.type} size="sm" variant="secondary" onClick={() => add(a.type)}>
                + {a.label}
              </PmsButton>
            ))}
          </div>
        </section>
        <aside className="flex flex-col gap-4">
          <section aria-labelledby="b-send" className="rounded-[12px] border border-border bg-white p-4">
            <h2 id="b-send" className="text-base font-semibold text-foreground">
              Sending
            </h2>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <label htmlFor="b-kind" className="block text-sm font-medium text-foreground">
                  Kind of form
                </label>
                <SelectInput id="b-kind" value={kind} onChange={(e) => setKind(e.target.value as IntakeFormKind)}>
                  {(Object.keys(INTAKE_FORM_KIND_LABELS) as IntakeFormKind[]).map((k) => (
                    <option key={k} value={k}>
                      {INTAKE_FORM_KIND_LABELS[k]}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="space-y-1">
                <label htmlFor="b-when" className="block text-sm font-medium text-foreground">
                  Sent
                </label>
                <SelectInput id="b-when" value={sendWhen} onChange={(e) => setSendWhen(e.target.value as SendWhen)}>
                  {(Object.keys(SEND_WHEN_LABELS) as SendWhen[]).map((k) => (
                    <option key={k} value={k}>
                      {SEND_WHEN_LABELS[k]}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <Switch id="b-sign" checked={requiresSignature} onCheckedChange={setRequiresSignature} label="Patient signs it (typed name)" />
              {requiresSignature ? (
                <div className="space-y-1">
                  <label htmlFor="b-stmt" className="block text-sm font-medium text-foreground">
                    Above the signature
                  </label>
                  <TextArea id="b-stmt" rows={3} maxLength={600} value={statement} onChange={(e) => setStatement(e.target.value)} />
                </div>
              ) : null}
              <Switch id="b-consent" checked={setsConsent} onCheckedChange={setSetsConsent} label="Records consent to treatment when signed" />
            </div>
          </section>
          <section aria-labelledby="b-who" className="rounded-[12px] border border-border bg-white p-4">
            <h2 id="b-who" className="text-base font-semibold text-foreground">
              Who sees the answers
            </h2>
            <p className="mt-2 text-sm text-[#334155]">
              {clinicalCount} question{clinicalCount === 1 ? " is" : "s are"} marked <strong>Clinical</strong>. Only clinicians, admins and the owner see those answers. Reception sees the rest, the consent ticks and the signature.
            </p>
          </section>
          <div className="flex gap-2">
            <PmsButton variant="secondary" className="flex-1" loading={busy === "draft"} onClick={() => void submit("draft")}>
              Save draft
            </PmsButton>
            <PmsButton className="flex-1" loading={busy === "active"} onClick={() => void submit("active")}>
              Publish v{template.status === "active" ? template.version + 1 : template.version}
            </PmsButton>
          </div>
          <p className="text-xs text-[#475569]">Forms already signed keep the version the patient saw.</p>
        </aside>
      </div>
    </div>
  );
}
