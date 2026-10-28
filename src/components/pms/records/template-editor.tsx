"use client";
/**
 * Note templates (settings; owners and administrators): the built-in templates (read-only – copy one to change it)
 * and the clinic's own, edited here: name, note type, body chart on/off, and the sections – heading, hint, kind
 * ("Several lines", "One line", "Tick boxes" with their options, e.g. the red flags screened), in order. Every save is
 * a new version; notes already written keep the version they were started from. Also the clinic's unsigned-notes
 * threshold (records settings).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { NOTE_TYPES, NOTE_TYPE_LABELS, type NoteType, type SectionKind } from "@/modules/pms/records/templates";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { cn } from "@/lib/utils";
import { FormField, PmsButton, PmsNotice, SelectInput, Switch, TextInput, inputClasses } from "@/components/pms/ui";

export interface TemplateRow {
  id: string;
  name: string;
  noteType: NoteType;
  builtin: boolean;
  active: boolean;
  bodyChart: boolean;
  rev: number;
  sections: { key: string; label: string; hint: string | null; kind: SectionKind; options?: string[] }[];
}

type Action<A extends unknown[]> = (...args: A) => Promise<RecordsActionState>;

export interface TemplateEditorActions {
  create: Action<[{ name: string; noteType: NoteType; sections: EditSection[]; bodyChart: boolean }]>;
  copy: Action<[string, string]>;
  update: Action<[string, number, { name: string; noteType: NoteType; sections: EditSection[]; bodyChart: boolean }]>;
  retire: Action<[string, number, boolean]>;
  saveSettings: Action<[number, number]>;
}

interface EditSection {
  key?: string | null;
  label: string;
  hint?: string | null;
  kind: SectionKind;
  options?: string[];
}

const KIND_LABELS: Record<SectionKind, string> = { text: "Several lines", line: "One line", checklist: "Tick boxes" };

export function TemplateManager({ templates, settings, actions }: { templates: TemplateRow[]; settings: { days: number; rev: number }; actions: TemplateEditorActions }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [days, setDays] = useState(String(settings.days));

  const run = (p: Promise<RecordsActionState>, after?: () => void) =>
    start(async () => {
      const r = await p;
      if (r?.ok) {
        setMessage({ ok: true, text: r.message ?? "Saved." });
        after?.();
        router.refresh();
      } else if (r) setMessage({ ok: false, text: r.error });
    });

  const current = editing && editing !== "new" ? templates.find((t) => t.id === editing) : null;

  return (
    <div className="flex flex-col gap-5">
      <div aria-live="polite">{message ? <PmsNotice tone={message.ok ? "success" : "error"} title={message.ok ? "Done" : "Not saved"}>{message.text}</PmsNotice> : null}</div>

      <section aria-labelledby="unsigned-setting" className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-5">
        <h2 id="unsigned-setting" className="text-base font-semibold">
          Unsigned notes
        </h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(actions.saveSettings(settings.rev, Number(days)));
          }}
        >
          <FormField id="unsigned-days" label="A draft is overdue after (days)" hint="1 day = “Over 24 h”, as in the design. At most 60.">
            <TextInput type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
          </FormField>
          <PmsButton type="submit" variant="secondary" loading={pending}>
            Save
          </PmsButton>
        </form>
      </section>

      <section aria-labelledby="templates-heading" className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="templates-heading" className="text-base font-semibold">
            Templates
          </h2>
          <PmsButton variant="secondary" onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            New template
          </PmsButton>
        </div>
        <ul className="flex flex-col">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-t-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <strong className={cn("font-semibold", !t.active && "text-muted-foreground line-through")}>{t.name}</strong>
                <span className="text-xs text-[#475569]">
                  {NOTE_TYPE_LABELS[t.noteType]} · {t.sections.length} sections{t.bodyChart ? " · body chart" : ""}
                  {t.builtin ? " · built in" : ""}
                  {!t.active ? " · retired" : ""}
                </span>
              </span>
              {t.builtin ? (
                <PmsButton variant="secondary" size="sm" disabled={pending} onClick={() => run(actions.copy(t.id, `${t.name} (clinic)`))}>
                  Copy<span className="sr-only"> {t.name}</span>
                </PmsButton>
              ) : (
                <>
                  <PmsButton variant="secondary" size="sm" onClick={() => setEditing(t.id)}>
                    Edit<span className="sr-only"> {t.name}</span>
                  </PmsButton>
                  <PmsButton variant="ghost" size="sm" disabled={pending} onClick={() => run(actions.retire(t.id, t.rev, t.active))}>
                    {t.active ? "Retire" : "Bring back"}
                    <span className="sr-only"> {t.name}</span>
                  </PmsButton>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {editing ? (
        <TemplateForm
          key={editing}
          initial={current ?? { id: "", name: "", noteType: "follow_up", builtin: false, active: true, bodyChart: false, rev: 0, sections: [{ key: "subjective", label: "Subjective", hint: null, kind: "text" }] }}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSave={(v) => run(current ? actions.update(current.id, current.rev, v) : actions.create(v), () => setEditing(null))}
        />
      ) : null}
    </div>
  );
}

function TemplateForm({ initial, pending, onCancel, onSave }: { initial: TemplateRow; pending: boolean; onCancel: () => void; onSave: (v: { name: string; noteType: NoteType; sections: EditSection[]; bodyChart: boolean }) => void }) {
  const [name, setName] = useState(initial.name);
  const [noteType, setNoteType] = useState<NoteType>(initial.noteType);
  const [bodyChart, setBodyChart] = useState(initial.bodyChart);
  const [sections, setSections] = useState<EditSection[]>(initial.sections.map((s) => ({ ...s, options: s.options ? [...s.options] : undefined })));
  const patch = (i: number, change: Partial<EditSection>) => setSections((all) => all.map((s, k) => (k === i ? { ...s, ...change } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSections((all) => {
      const j = i + d;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <section aria-labelledby="template-form-heading" className="flex flex-col gap-4 rounded-2xl border-2 border-[#99E2D8] bg-white p-5">
      <h2 id="template-form-heading" className="text-base font-semibold">
        {initial.id ? `Edit ${initial.name}` : "New template"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <FormField id="tpl-name" label="Name" required>
          <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField id="tpl-type" label="Note type">
          <SelectInput value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {NOTE_TYPE_LABELS[t]}
              </option>
            ))}
          </SelectInput>
        </FormField>
      </div>
      <Switch checked={bodyChart} onCheckedChange={setBodyChart} label="Body chart in notes written with this template" />
      <ol className="flex flex-col gap-3" aria-label="Sections">
        {sections.map((s, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_160px]">
              <FormField id={`sec-${i}-label`} label={`Section ${i + 1} heading`}>
                <TextInput value={s.label} maxLength={80} onChange={(e) => patch(i, { label: e.target.value })} />
              </FormField>
              <FormField id={`sec-${i}-hint`} label="Hint">
                <TextInput value={s.hint ?? ""} maxLength={200} onChange={(e) => patch(i, { hint: e.target.value })} />
              </FormField>
              <FormField id={`sec-${i}-kind`} label="Kind">
                <SelectInput value={s.kind} onChange={(e) => patch(i, { kind: e.target.value as SectionKind, options: e.target.value === "checklist" ? (s.options ?? [""]) : undefined })}>
                  {(Object.keys(KIND_LABELS) as SectionKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
            </div>
            {s.kind === "checklist" ? (
              <FormField id={`sec-${i}-options`} label="Tick boxes" hint="One per line (at most 12)">
                <textarea
                  value={(s.options ?? []).join("\n")}
                  onChange={(e) => patch(i, { options: e.target.value.split("\n") })}
                  onBlur={(e) => patch(i, { options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean) })}
                  rows={4}
                  className={cn(inputClasses, "h-auto px-3 py-2")}
                />
              </FormField>
            ) : null}
            <div className="flex gap-1.5">
              <PmsButton variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                <ArrowUp aria-hidden />
                <span className="sr-only">Move section {i + 1} up</span>
              </PmsButton>
              <PmsButton variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === sections.length - 1}>
                <ArrowDown aria-hidden />
                <span className="sr-only">Move section {i + 1} down</span>
              </PmsButton>
              <PmsButton variant="ghost" size="sm" onClick={() => setSections((all) => all.filter((_, k) => k !== i))} disabled={sections.length === 1}>
                <X aria-hidden />
                Remove<span className="sr-only"> section {i + 1}</span>
              </PmsButton>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <PmsButton variant="secondary" onClick={() => setSections((all) => [...all, { label: "", hint: null, kind: "text" }])}>
          <Plus aria-hidden />
          Add section
        </PmsButton>
        <span className="flex-1" />
        <PmsButton variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </PmsButton>
        <PmsButton loading={pending} onClick={() => onSave({ name, noteType, bodyChart, sections: sections.map((s) => ({ ...s, options: s.kind === "checklist" ? (s.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })) })}>
          Save template
        </PmsButton>
      </div>
    </section>
  );
}
