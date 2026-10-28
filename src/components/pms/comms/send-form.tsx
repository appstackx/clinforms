"use client";
/**
 * "Send a message" (design round 2c): To (a patient search, or the record's patient), how it goes – text or email,
 * with the reason when one is not possible ("Owen has opted out of texts. This message will go by email") –, about
 * their care or marketing (marketing only to patients who agreed, PECR), a template to start from, the message with
 * its text count and a preview, "Send now". Through the outbox / test service only.
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import type { SendFormView } from "@/modules/pms/comms/view";
import { renderTemplate } from "@/modules/pms/comms/merge-fields";
import { normaliseSmsText, smsInfo } from "@/modules/pms/comms/sms";
import { formatUkDate } from "@/modules/pms/core/text";
import { cn } from "@/lib/utils";
import { FormField, PmsButton, PmsNotice, SelectInput, TextArea, TextInput, useToast } from "@/components/pms/ui";
import { loadSendFormAction, searchPatientsAction, sendMessageAction } from "@/app/app/clinic/messages/actions";
import { MESSAGES_PATH, focusRing } from "./format";

export function PatientPicker({ id, label, onPick }: { id: string; label: string; onPick: (hit: { id: string; name: string }) => void }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<{ id: string; name: string; number: number; dateOfBirth: string | null }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchPatientsAction(q).then((r) => {
        if (r.ok) {
          setHits(r.hits);
          setError(null);
        } else setError(r.error);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="flex flex-col gap-1.5">
      <FormField id={id} label={label} hint="Name, patient number or date of birth" error={error}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </FormField>
      {hits.length ? (
        <ul className="flex flex-col rounded-lg border border-border" aria-label="Matching patients">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} className={cn("flex w-full justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[#F8FAFC]", focusRing)}>
                <strong>{h.name}</strong>
                <span className="text-[#475569]">
                  No. {h.number}
                  {h.dateOfBirth ? ` · ${formatUkDate(h.dateOfBirth)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SendMessageForm({ view: initial, onSent }: { view: SendFormView; onSent?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = React.useState(initial);
  React.useEffect(() => setView(initial), [initial]);
  const p = view.patient;
  const firstChannel: "sms" | "email" = p && !p.sms ? "sms" : "email";
  const [channel, setChannel] = React.useState<"sms" | "email">(firstChannel);
  const [purpose, setPurpose] = React.useState<"service" | "marketing">("service");
  const [templateId, setTemplateId] = React.useState("");
  const [subject, setSubject] = React.useState(`A message from ${view.clinicName}`);
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setChannel(p && !p.sms ? "sms" : "email"), [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(hit: { id: string }) {
    const r = await loadSendFormAction(hit.id);
    if (r.ok) setView(r.view);
    else setError(r.error);
  }

  if (!p) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <PatientPicker id="sm-to" label="To" onPick={(h) => void pick(h)} />
        {error ? <p role="alert" className="text-sm text-destructive-strong">{error}</p> : null}
      </div>
    );
  }

  const why = (c: "sms" | "email") => (c === "sms" ? (purpose === "marketing" ? p.smsMarketing : p.sms) : purpose === "marketing" ? p.emailMarketing : p.emailService);
  const blocked = why(channel);
  const templates = view.templates.filter((t) => t.channel === channel && t.purpose === purpose);
  const examples: Record<string, string> = { "patient.first_name": p.name.split(" ")[0], "clinic.name": view.clinicName, "clinic.short_name": view.shortName };
  const preview = (channel === "sms" ? normaliseSmsText : (x: string) => x)(renderTemplate(body, examples, { missing: "empty" }).text);
  const info = channel === "sms" ? smsInfo(preview) : null;

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => `${x.name}` === id || x.id === id);
    if (!t) return;
    setBody(t.body);
    if (t.subject) setSubject(t.subject);
  }

  async function send() {
    if (!p) return;
    setBusy(true);
    setError(null);
    const tpl = templates.find((x) => x.name === templateId || x.id === templateId);
    const r = await sendMessageAction({ patientId: p.id, channel, purpose, templateId: tpl?.id || null, subject: channel === "email" ? subject : null, body });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.sent.label);
    setBody("");
    onSent?.();
    router.refresh();
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3" data-testid="send-form">
      <FormField id="sm-to" label="To">
        <TextInput value={`${p.name}${channel === "sms" ? (p.mobile ? ` – ${p.mobile}` : "") : p.email ? ` – ${p.email}` : ""}`} readOnly />
      </FormField>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">About</legend>
        {(["service", "marketing"] as const).map((x) => (
          <label key={x} className="flex items-center gap-2 text-sm">
            <input type="radio" name="sm-purpose" value={x} checked={purpose === x} onChange={() => setPurpose(x)} className="h-4 w-4 accent-[#0B7970]" />
            {x === "service" ? "Their care or appointments" : "News and offers (marketing)"}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">Send by</legend>
        {(["sms", "email"] as const).map((c) => (
          <label key={c} className={cn("flex items-center gap-2 text-sm", why(c) && "text-[#64748B]")}>
            <input type="radio" name="sm-channel" value={c} checked={channel === c} onChange={() => setChannel(c)} className="h-4 w-4 accent-[#0B7970]" />
            {c === "sms" ? "Text" : "Email"}
            {why(c) ? <span className="text-xs">(not possible)</span> : null}
          </label>
        ))}
      </fieldset>
      {p.sms && !why("email") && channel === "email" ? (
        <PmsNotice tone="warning" title={`${p.name} cannot get texts`}>
          {p.sms} This message will go by <strong>email</strong>{p.email ? ` (${p.email})` : ""}.
        </PmsNotice>
      ) : null}
      {blocked ? (
        <PmsNotice tone="error" title="This message cannot be sent this way">
          {blocked}
        </PmsNotice>
      ) : null}
      {templates.length ? (
        <FormField id="sm-t" label="Template">
          <SelectInput value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Start from blank</option>
            {templates.map((t) => (
              <option key={t.id || t.name} value={t.id || t.name}>
                {t.name}
              </option>
            ))}
          </SelectInput>
        </FormField>
      ) : null}
      {channel === "email" ? (
        <FormField id="sm-s" label="Subject">
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </FormField>
      ) : null}
      <FormField id="sm-b" label="Message" hint={info ? `${info.units} characters · ${info.segments} text${info.segments === 1 ? "" : "s"}` : undefined} error={error}>
        <TextArea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={channel === "sms" ? 918 : 8000} />
      </FormField>
      {body.trim() ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Preview</span>
          <div className={cn("whitespace-pre-wrap break-words rounded-xl p-3 text-sm", channel === "sms" ? "max-w-[360px] bg-[#F1F5F9]" : "border border-border")}>{preview}</div>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <PmsButton variant="ghost" onClick={() => router.push(`${MESSAGES_PATH}?tab=send`)}>
          Someone else
        </PmsButton>
        <PmsButton loading={busy} disabled={Boolean(blocked) || !body.trim()} onClick={() => void send()} data-testid="send-now">
          Send now
        </PmsButton>
      </div>
    </div>
  );
}
