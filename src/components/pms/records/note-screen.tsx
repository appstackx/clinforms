"use client";
/**
 * Clinical note – editor, sign, amend (design round 2, "Clinical notes – editor, sign, amend, unsigned").
 *
 *   Draft (the author's own): template choice and "Copy from last note", the template's sections (S/O/A/P with their
 *   hints; a checklist section such as "Red flags screened" as tick boxes), the body chart, "Outcome measures today",
 *   autosave ("Draft saved 11:40"), and a sticky footer with Save draft / Sign and lock (the footer sits in the page's
 *   flow at the end, so it never covers the Plan box – the design's overlap is fixed). Discard draft asks first.
 *   Signed: read-only with the locked banner; "Add amendment" adds one below the original (who, when, why) – the
 *   original stays visible and unchanged.
 *
 * Keyboard: everything is a native control; Ctrl/Cmd+S saves the draft. Leaving with unsaved changes asks first.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, FilePlus2, Lock, Trash2 } from "lucide-react";
import type { BodyChart } from "@/modules/pms/records/body-chart";
import type { AmendmentKind } from "@/modules/pms/records/notes";
import { checkedOptions, sectionLetter, type TemplateSection } from "@/modules/pms/records/templates";
import { cn } from "@/lib/utils";
import { Checkbox, ConfirmDialog, FlagPill, FormField, PmsButton, PmsNotice, SelectInput, TextArea, TextInput, inputClasses } from "@/components/pms/ui";
import { BodyChartPanel } from "./body-chart-panel";
import { timeLabel } from "./format";

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; code?: string; rev?: number; fieldErrors?: Record<string, string> };

export interface NoteScreenActions {
  save: (input: { patientId: string; noteId: string; expectedRev: number; sections: Record<string, string>; bodyChart?: BodyChart | null; sign?: boolean }) => Promise<Result<{ rev: number; signed: boolean; savedAt: string }>>;
  changeTemplate: (input: { patientId: string; noteId: string; expectedRev: number; templateId: string }) => Promise<Result<{ rev: number }>>;
  copyLast: (input: { patientId: string; noteId: string }) => Promise<Result<{ copy: { noteId: string; seenOn: string; templateName: string; sections: Record<string, string> } | null }>>;
  discard: (input: { patientId: string; noteId: string; expectedRev: number }) => Promise<Result>;
  amend: (input: { patientId: string; noteId: string; kind: AmendmentKind; sectionKey?: string | null; text: string; reason?: string | null }) => Promise<Result>;
  /** The diary's merged status action (mark the appointment attended after signing). */
  completeAppointment?: (input: { id: string; expectedRev: number; status: "attended" }) => Promise<{ ok: boolean; error?: string }>;
}

export interface AmendmentView {
  id: string;
  kind: AmendmentKind;
  sectionLabel: string | null;
  text: string | null;
  reason: string | null;
  author: string;
  at: string;
}

export interface NoteScreenProps {
  patientId: string;
  noteId: string;
  rev: number;
  status: "draft" | "signed" | "discarded";
  enteredInError: boolean;
  title: string;
  meta: string;
  templateId: string;
  templates: { id: string; name: string }[];
  sections: TemplateSection[];
  values: Record<string, string>;
  bodyChartEnabled: boolean;
  bodyChart: BodyChart | null;
  updatedAt: string;
  /** The member may edit / sign this draft (their own). */
  editable: boolean;
  signable: boolean;
  amendable: boolean;
  /** Not the member's own draft. */
  draftOf: string | null;
  signedLine: string | null;
  signerLabel: string;
  /**
   * The member has no registration number on their practitioner profile, so may not sign or amend (Khuram,
   * 28/10/2026; the server refuses too). `href` = their Member access page when they may open it.
   */
  registrationMissing: { href: string | null } | null;
  amendments: AmendmentView[];
  outcomesToday: { label: string; value: string }[];
  outcomesHref: string;
  appointment: { id: string; rev: number; canComplete: boolean } | null;
  backHref: string;
  actions: NoteScreenActions;
}

const AMEND_REASONS: { value: string; label: string; kind: AmendmentKind }[] = [
  { value: "info", label: "Additional information received", kind: "addendum" },
  { value: "late", label: "Late entry", kind: "addendum" },
  { value: "correction", label: "Correction of factual error", kind: "correction" },
  { value: "error", label: "Entered in error (wrong patient or note)", kind: "entered_in_error" },
];

const AUTOSAVE_MS = 2500;

export function NoteScreen(props: NoteScreenProps) {
  const { patientId, noteId, actions } = props;
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(props.values);
  const [chart, setChart] = useState<BodyChart | null>(props.bodyChart);
  const [rev, setRev] = useState(props.rev);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(props.status === "draft" ? props.updatedAt : null);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmSign, setConfirmSign] = useState(false);
  const [complete, setComplete] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amending, setAmending] = useState(false);
  const revRef = useRef(rev);
  revRef.current = rev;
  const savingRef = useRef(false);
  const latest = useRef({ values, chart });
  latest.current = { values, chart };

  const editable = props.editable && props.status === "draft";
  const locked = props.status === "signed";

  const save = useCallback(
    async (opts: { sign?: boolean } = {}) => {
      if (savingRef.current) return null;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      const res = await actions.save({ patientId, noteId, expectedRev: revRef.current, sections: latest.current.values, bodyChart: props.bodyChartEnabled ? latest.current.chart : undefined, sign: opts.sign });
      savingRef.current = false;
      setSaving(false);
      if (res.ok) {
        setRev(res.rev);
        setDirty(false);
        setSavedAt(res.savedAt);
        return res;
      }
      if (res.rev !== undefined && res.code !== "conflict") setRev(res.rev);
      setError({ text: res.error, conflict: res.code === "conflict" });
      return res;
    },
    [actions, noteId, patientId, props.bodyChartEnabled],
  );

  // Autosave a short pause after the last change.
  useEffect(() => {
    if (!editable || !dirty || error?.conflict) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [values, chart, dirty, editable, save, error?.conflict]);

  // Ctrl/Cmd+S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    if (!editable) return;
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", leave);
    };
  }, [editable, dirty, save]);

  const setSection = (key: string, text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    setDirty(true);
  };

  const doSign = async () => {
    setBusy(true);
    const res = await save({ sign: true });
    if (res && res.ok && complete && props.appointment?.canComplete && actions.completeAppointment) {
      const done = await actions.completeAppointment({ id: props.appointment.id, expectedRev: props.appointment.rev, status: "attended" });
      if (!done.ok) setNotice(`The note is signed. The appointment was not marked as completed: ${done.error ?? "try again from the diary."}`);
    }
    setBusy(false);
    setConfirmSign(false);
    if (res && res.ok) router.refresh();
  };

  const doDiscard = async () => {
    setBusy(true);
    const res = await actions.discard({ patientId, noteId, expectedRev: revRef.current });
    setBusy(false);
    setConfirmDiscard(false);
    if (res.ok) {
      setDirty(false);
      router.push(props.backHref);
    } else setError({ text: res.error, conflict: res.code === "conflict" });
  };

  const doChangeTemplate = async (templateId: string) => {
    if (dirty) await save();
    setBusy(true);
    const res = await actions.changeTemplate({ patientId, noteId, expectedRev: revRef.current, templateId });
    setBusy(false);
    setPendingTemplate(null);
    if (res.ok) {
      setRev(res.rev);
      router.refresh();
    } else setError({ text: res.error, conflict: res.code === "conflict" });
  };

  const doCopy = async () => {
    setBusy(true);
    const res = await actions.copyLast({ patientId, noteId });
    setBusy(false);
    if (!res.ok) return setError({ text: res.error, conflict: false });
    if (!res.copy) return setNotice("There is no earlier signed note for this patient to copy from.");
    const keys = props.sections.map((s) => s.key);
    let n = 0;
    const next = { ...values };
    for (const k of keys) {
      const text = res.copy.sections[k];
      if (text && !next[k]?.trim()) {
        next[k] = text;
        n++;
      }
    }
    setValues(next);
    if (n) setDirty(true);
    setNotice(n ? `Copied ${n} section${n === 1 ? "" : "s"} from ${res.copy.templateName} (${res.copy.seenOn.split("-").reverse().join("/")}). Sections you had written are unchanged.` : "Nothing to copy: the sections that note shares with this one already have text.");
  };

  const statusPill = locked ? (
    props.enteredInError ? (
      <FlagPill>Entered in error</FlagPill>
    ) : props.amendments.length ? (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#C7D4F5] bg-[#E8EEFB] px-3 text-[13px] font-medium text-[#1842B4]">
        <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
        Signed · amended
      </span>
    ) : (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7E8BE] bg-[#DCFCE7] px-3 text-[13px] font-medium text-[#166534]">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Signed and locked
      </span>
    )
  ) : props.status === "discarded" ? (
    <FlagPill>Discarded draft</FlagPill>
  ) : (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#FBD38D] bg-[#FEF3C7] px-3 text-[13px] font-medium text-[#864E0E]">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      Unsigned draft
    </span>
  );

  const templateName = useMemo(() => props.templates.find((t) => t.id === pendingTemplate)?.name ?? "", [pendingTemplate, props.templates]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={cn("text-xl font-semibold text-foreground", props.enteredInError && "line-through")}>{props.title}</h1>
          <span className="text-sm text-[#334155]">{props.meta}</span>
        </div>
        {statusPill}
      </div>

      {error ? (
        <PmsNotice tone="error" title={error.conflict ? "This note changed elsewhere" : "Not saved"}>
          {error.text}{" "}
          {error.conflict ? (
            <button type="button" className="font-medium text-primary-strong underline" onClick={() => router.refresh()}>
              Reload the note
            </button>
          ) : null}
        </PmsNotice>
      ) : null}
      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-[#C7D4F5] bg-[#EFF4FF] px-3.5 py-2.5 text-sm">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-medium text-primary-strong underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {props.registrationMissing && (props.signable || props.amendable) ? (
        <div id="registration-needed">
          <PmsNotice tone="warning" title="Add your registration number to sign notes">
            You can write and save drafts, but signing and amending need the registration number on your practitioner profile (Set-up → Staff access → your name).{" "}
            {props.registrationMissing.href ? (
              <Link href={props.registrationMissing.href} className="font-medium text-primary-strong underline underline-offset-2">
                Open your member access
              </Link>
            ) : (
              "Ask the clinic owner or an administrator to add it."
            )}
          </PmsNotice>
        </div>
      ) : null}
      {props.draftOf ? <PmsNotice tone="info" title={`Draft by ${props.draftOf}`}>Only the note&apos;s author can change or sign a draft.</PmsNotice> : null}

      {editable ? (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-white p-4">
          <FormField id="note-template" label="Template" className="w-full sm:w-[240px]">
            <SelectInput value={props.templateId} onChange={(e) => setPendingTemplate(e.target.value)} disabled={busy}>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <PmsButton variant="secondary" onClick={doCopy} loading={busy && !pendingTemplate} loadingText="Copying…">
            Copy from last note
          </PmsButton>
          <span role="status" aria-live="polite" className="ml-auto inline-flex items-center gap-1 text-[13px] text-[#475569]">
            {saving ? (
              "Saving…"
            ) : dirty ? (
              "Unsaved changes"
            ) : savedAt ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#166534]" aria-hidden />
                Draft saved {timeLabel(savedAt)}
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {locked ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#A7E8BE] bg-[#F0FDF4] px-4 py-3 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-[#166534]" aria-hidden />
          <span className="min-w-0 flex-1">
            {props.signedLine} This note is locked – changes are added as amendments.
          </span>
          {props.amendable && !amending ? (
            <PmsButton variant="secondary" onClick={() => setAmending(true)} disabled={Boolean(props.registrationMissing)} aria-describedby={props.registrationMissing ? "registration-needed" : undefined}>
              Add amendment
            </PmsButton>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {props.sections.map((s) => (
            <SectionBox key={s.key} section={s} value={values[s.key] ?? ""} editable={editable} onChange={(t) => setSection(s.key, t)} />
          ))}
          {props.amendments.map((a, i) => (
            <section key={a.id} aria-label={`Amendment ${i + 1}`} className="flex flex-col gap-2 rounded-2xl border border-[#C7D4F5] bg-[#F7F9FE] p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#E8EEFB] px-2.5 text-xs font-semibold text-[#1842B4]">
                  <FilePlus2 className="h-3 w-3" aria-hidden />
                  Amendment {i + 1}
                </span>
                <span className="text-xs text-[#475569]">
                  {a.author} · {a.at} · signed
                </span>
              </div>
              {a.reason ? (
                <span>
                  <strong className="font-semibold">Reason:</strong> {a.reason}
                </span>
              ) : null}
              {a.kind === "correction" && a.sectionLabel ? <span className="text-[#475569]">Correction to “{a.sectionLabel}”</span> : null}
              {a.kind === "entered_in_error" ? <span className="font-medium text-[#991B1B]">The note is marked as entered in error.</span> : null}
              {a.text ? <div className="whitespace-pre-wrap text-foreground">{a.text}</div> : null}
              <span className="text-xs text-[#475569]">The original note above is unchanged.</span>
            </section>
          ))}
          {amending ? (
            <AmendmentPanel
              sections={props.sections}
              onCancel={() => setAmending(false)}
              onSave={async (input) => {
                const res = await actions.amend({ patientId, noteId, ...input });
                if (res.ok) {
                  setAmending(false);
                  router.refresh();
                }
                return res;
              }}
            />
          ) : null}
        </div>

        <aside aria-label="Body chart and outcome measures" className="flex flex-col gap-4 self-start rounded-2xl border border-border bg-white p-4 lg:sticky lg:top-4">
          {props.bodyChartEnabled || (chart && chart.markers.length) ? (
            <BodyChartPanel
              chart={chart}
              editable={editable && props.bodyChartEnabled}
              onChange={(c) => {
                setChart(c);
                setDirty(true);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">This template has no body chart.</p>
          )}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <strong className="text-sm font-semibold">Outcome measures today</strong>
            {props.outcomesToday.length ? (
              <ul className="flex flex-wrap gap-2">
                {props.outcomesToday.map((o) => (
                  <li key={o.label} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#F1F5F9] px-2.5 text-[13px]">
                    {o.label} <strong className="font-semibold tabular-nums">{o.value}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">None recorded on this date.</p>
            )}
            <Link href={props.outcomesHref} className="text-[13px] font-medium text-primary-strong underline underline-offset-2">
              Record a score
            </Link>
          </div>
        </aside>
      </div>

      {editable ? (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <span className="hidden min-w-0 flex-1 text-sm text-[#475569] md:block">Signing locks the note. You can add amendments later; the original stays visible.</span>
          <PmsButton variant="ghost" onClick={() => setConfirmDiscard(true)} className="text-destructive-strong">
            <Trash2 aria-hidden />
            <span className="sr-only md:not-sr-only">Discard draft</span>
          </PmsButton>
          <span className="flex-1 md:hidden" />
          <PmsButton variant="secondary" onClick={() => void save()} loading={saving && !confirmSign} loadingText="Saving…" className="h-11 md:h-9">
            Save draft
          </PmsButton>
          {props.signable ? (
            <PmsButton onClick={() => setConfirmSign(true)} className="h-11 md:h-9" disabled={Boolean(props.registrationMissing)} aria-describedby={props.registrationMissing ? "registration-needed" : undefined}>
              <Lock aria-hidden />
              Sign and lock
            </PmsButton>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmSign}
        onOpenChange={setConfirmSign}
        title="Sign this note?"
        description={`It will be signed as ${props.signerLabel} and locked. After signing, changes can only be added as dated amendments.`}
        confirmLabel="Sign and lock"
        cancelLabel="Keep editing"
        pending={busy}
        onConfirm={() => void doSign()}
      >
        {props.appointment?.canComplete && actions.completeAppointment ? <Checkbox checked={complete} onChange={(e) => setComplete(e.target.checked)} label="Mark appointment as completed" /> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this draft?"
        description="The draft is kept in the record's history but no longer counts as a note. This cannot be undone."
        confirmLabel="Discard draft"
        cancelLabel="Keep the draft"
        destructive
        pending={busy}
        onConfirm={() => void doDiscard()}
      />
      <ConfirmDialog
        open={pendingTemplate !== null && pendingTemplate !== props.templateId}
        onOpenChange={(open) => !open && setPendingTemplate(null)}
        title={`Switch to ${templateName}?`}
        description="Text in sections that both templates have is kept. Text in sections the new template does not have is removed from this draft."
        confirmLabel="Switch template"
        cancelLabel="Keep this template"
        pending={busy}
        onConfirm={() => pendingTemplate && void doChangeTemplate(pendingTemplate)}
      />
    </div>
  );
}

function SectionBox({ section, value, editable, onChange }: { section: TemplateSection; value: string; editable: boolean; onChange: (text: string) => void; error?: string }) {
  const id = `section-${section.key}`;
  const hintId = section.hint ? `${id}-hint` : undefined;
  const head = (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span aria-hidden className="mr-0.5 inline-flex h-6 w-6 items-center justify-center rounded-[6px] bg-[#F0FDFA] text-xs font-bold text-[#0B5F58]">
        {sectionLetter(section)}
      </span>
      {section.kind === "checklist" ? (
        <span id={`${id}-label`} className="text-[15px] font-semibold text-foreground">
          {section.label}
        </span>
      ) : (
        <label htmlFor={id} className="text-[15px] font-semibold text-foreground">
          {section.label}
        </label>
      )}
      {section.hint ? (
        <span id={hintId} className="text-xs text-[#475569]">
          {section.hint}
        </span>
      ) : null}
    </div>
  );
  if (section.kind === "checklist") {
    const ticked = new Set(checkedOptions(section, value));
    const toggle = (o: string, on: boolean) => {
      const next = (section.options ?? []).filter((x) => (x === o ? on : ticked.has(x)));
      onChange(next.join("\n"));
    };
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4">
        <fieldset aria-labelledby={`${id}-label`} aria-describedby={hintId} className="flex flex-col gap-3">
          {head}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(section.options ?? []).map((o) =>
              editable ? (
                <Checkbox key={o} checked={ticked.has(o)} onChange={(e) => toggle(o, e.target.checked)} label={`${o} – none`} />
              ) : (
                <span key={o} className="inline-flex items-center gap-1.5 text-sm">
                  {ticked.has(o) ? <Check className="h-4 w-4 text-[#166534]" aria-hidden /> : <span aria-hidden className="inline-block h-4 w-4 rounded border border-input-strong" />}
                  {o} – {ticked.has(o) ? "none" : "not recorded"}
                </span>
              ),
            )}
          </div>
        </fieldset>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4">
      {head}
      {editable ? (
        section.kind === "line" ? (
          <TextInput id={id} value={value} maxLength={300} aria-describedby={hintId} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <TextArea id={id} value={value} rows={section.key === "assessment" ? 3 : 4} aria-describedby={hintId} onChange={(e) => onChange(e.target.value)} className="min-h-[96px] text-[15px] leading-relaxed" />
        )
      ) : (
        <div id={id} className={cn("whitespace-pre-wrap text-[15px] leading-relaxed text-foreground", !value && "text-muted-foreground")}>
          {value || "Nothing written."}
        </div>
      )}
    </section>
  );
}

function AmendmentPanel({ sections, onCancel, onSave }: { sections: TemplateSection[]; onCancel: () => void; onSave: (input: { kind: AmendmentKind; sectionKey?: string | null; text: string; reason?: string | null }) => Promise<Result> }) {
  const [reason, setReason] = useState(AMEND_REASONS[0].value);
  const [section, setSection] = useState(sections.find((s) => s.kind !== "checklist")?.key ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; fields: Record<string, string> } | null>(null);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const r = AMEND_REASONS.find((x) => x.value === reason) ?? AMEND_REASONS[0];
  const submit = async () => {
    setBusy(true);
    const res = await onSave({ kind: r.kind, sectionKey: r.kind === "correction" ? section : null, text, reason: r.label });
    setBusy(false);
    if (!res.ok) setErr({ text: res.error, fields: res.fieldErrors ?? {} });
  };
  return (
    <section aria-labelledby="amend-heading" className="flex flex-col gap-3 rounded-2xl border-2 border-[#C7D4F5] bg-white p-4">
      <h2 id="amend-heading" ref={ref} tabIndex={-1} className="text-[15px] font-semibold outline-none">
        New amendment
      </h2>
      {err ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive-strong">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {err.text}
        </p>
      ) : null}
      <FormField id="amend-reason" label="Reason for amendment" error={err?.fields.reason}>
        <SelectInput value={reason} onChange={(e) => setReason(e.target.value)}>
          {AMEND_REASONS.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </SelectInput>
      </FormField>
      {r.kind === "correction" ? (
        <FormField id="amend-section" label="Section corrected" error={err?.fields.sectionKey}>
          <SelectInput value={section} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </SelectInput>
        </FormField>
      ) : null}
      <FormField id="amend-text" label={r.kind === "entered_in_error" ? "Details (optional)" : "Amendment"} error={err?.fields.text}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={cn(inputClasses, "h-auto min-h-[88px] resize-y px-3 py-2")} />
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <PmsButton variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </PmsButton>
        <PmsButton onClick={() => void submit()} loading={busy} loadingText="Signing…">
          Sign amendment
        </PmsButton>
      </div>
    </section>
  );
}
