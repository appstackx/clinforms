"use client";
/**
 * Messages → Templates (design round 2c): the list (name, channel and when it goes) and the editor – name, the
 * message, the characters and texts it takes, "Insert merge field", a preview with fictional values, "Save template".
 * Editing needs messages.templates (owner and administrators by default); everyone else reads. A standard template
 * is copied on its first save and the copy becomes the clinic's own for its kind and channel.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { TemplateRowView } from "@/modules/pms/comms/view";
import { CHANNEL_LABELS, TEMPLATE_KIND_LABELS, TEMPLATE_WHEN } from "@/modules/pms/comms/copy";
import { checkTemplate, contextForKind, fieldsFor, renderTemplate } from "@/modules/pms/comms/merge-fields";
import { normaliseSmsText, smsInfo } from "@/modules/pms/comms/sms";
import { cn } from "@/lib/utils";
import { FormField, PmsButton, PmsNotice, TextArea, TextInput, useToast } from "@/components/pms/ui";
import { saveTemplateAction } from "@/app/app/clinic/messages/actions";
import { MESSAGES_PATH, focusRing } from "./format";

/** The text a template gives with these values (texts: GSM-7 tidy). */
export function previewOf(body: string, channel: "sms" | "email", examples: Record<string, string>): string {
  const text = renderTemplate(body, examples, { missing: "empty" }).text;
  return channel === "sms" ? normaliseSmsText(text) : text;
}

export function TemplatesEditor({ rows, canEdit, examples }: { rows: TemplateRowView[]; canEdit: boolean; examples: Record<string, string> }) {
  const visible = rows.filter((r) => r.active && (r.isDefault || !r.standard));
  const [selected, setSelected] = React.useState(visible[0]?.id ?? null);
  const t = visible.find((r) => r.id === selected) ?? visible[0] ?? null;
  if (!t) return <p className="p-4 text-sm text-[#475569]">No templates.</p>;
  return (
    <div className="grid min-w-0 grid-cols-1 md:grid-cols-[300px_1fr]">
      <div className="flex flex-col border-b border-border md:border-b-0 md:border-r">
        <ul aria-label="Templates" data-testid="templates-list">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r.id)}
                aria-current={r.id === t.id ? "true" : undefined}
                className={cn("flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left text-sm", focusRing, r.id === t.id ? "bg-[#F0FDFA]" : "bg-white hover:bg-[#F8FAFC]")}
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-[#475569]">{r.meta}</span>
              </button>
            </li>
          ))}
        </ul>
        <Link href={`${MESSAGES_PATH}/patient-view`} className={cn("m-3 text-sm text-primary-strong underline underline-offset-2", focusRing)}>
          See what patients receive
        </Link>
      </div>
      <TemplateForm key={`${t.id}:${t.rev}`} t={t} canEdit={canEdit} examples={examples} onSaved={setSelected} />
    </div>
  );
}

/** The editor of one template (keyed by template and revision: its fields start from the saved wording). */
function TemplateForm({ t, canEdit, examples, onSaved }: { t: TemplateRowView; canEdit: boolean; examples: Record<string, string>; onSaved: (id: string) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = React.useState(t.name);
  const [subject, setSubject] = React.useState(t.subject ?? "");
  const [body, setBody] = React.useState(t.body);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const context = contextForKind(t.kind);
  const fields = fieldsFor(context, t.channel);
  const check = checkTemplate(body, context, t.channel);
  const preview = previewOf(body, t.channel, examples);
  const info = t.channel === "sms" ? smsInfo(preview) : null;

  function insert(key: string) {
    const token = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) return setBody((b) => `${b}${b.endsWith(" ") || !b ? "" : " "}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveTemplateAction({ id: t.id, rev: t.rev, name, subject: t.channel === "email" ? subject : null, body });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success("Template saved. Messages use it from now on.");
    onSaved(r.id);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-testid="template-editor">
      {!canEdit ? (
        <PmsNotice tone="info" title="Read only">
          Only the clinic owner and administrators change templates.
        </PmsNotice>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField id="tn" label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={120} />
        </FormField>
        <FormField id="tc" label="Channel">
          <TextInput value={CHANNEL_LABELS[t.channel]} readOnly />
        </FormField>
        <FormField id="tw" label="Send">
          <TextInput value={TEMPLATE_WHEN[t.kind]} readOnly title={TEMPLATE_KIND_LABELS[t.kind]} />
        </FormField>
      </div>
      {t.channel === "email" ? (
        <FormField id="ts" label="Subject">
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} maxLength={200} />
        </FormField>
      ) : null}
      <FormField
        id="tb"
        label="Message"
        hint={info ? `${info.units} characters in preview · ${info.segments} text${info.segments === 1 ? "" : "s"} per patient${info.encoding === "ucs2" ? " · a special character makes texts shorter (70 a part)" : ""}` : undefined}
        error={check.errors[0] ?? error}
      >
        <TextArea ref={bodyRef} rows={t.channel === "sms" ? 4 : 10} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} />
      </FormField>
      {canEdit ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Insert merge field</span>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <button key={f.key} type="button" onClick={() => insert(f.key)} title={f.label} className={cn("rounded-md border border-[#C7D4F5] bg-[#EFF4FF] px-2 py-1 font-mono text-xs text-[#1842B4]", focusRing)}>
                {`{{${f.key}}}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Preview for a fictional patient</span>
        <div className={cn("whitespace-pre-wrap break-words rounded-xl p-3 text-sm", t.channel === "sms" ? "max-w-[360px] bg-[#F1F5F9]" : "border border-border bg-white")} data-testid="template-preview">
          {t.channel === "email" && subject ? <strong className="mb-2 block">{previewOf(subject, "email", examples)}</strong> : null}
          {preview}
        </div>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <PmsButton loading={busy} disabled={check.errors.length > 0 || !body.trim()} onClick={() => void save()} data-testid="save-template">
            Save template
          </PmsButton>
        </div>
      ) : null}
    </div>
  );
}
