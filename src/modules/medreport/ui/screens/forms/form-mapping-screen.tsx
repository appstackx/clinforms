"use client";

/**
 * Mapping review for one referrer form (/reports/forms/[formId]). Left: the referrer's form in its
 * original layout with the selected question's answer space highlighted. Right: every question with
 * its section, answer type, where the answer comes from and how sure the analysis was – editable,
 * with add/remove. Staff check it once and confirm; the confirmed map is saved against this exact
 * file and reused for every patient. A portal question set (no file) shows its questions on the left
 * instead of a file, and has no answer locations to pick.
 * A clinic's Studio (tenant mode) reports form_confirmed through HostHooks.track (counts and enumerated
 * values only) and prefills "confirmed by" with the signed-in member.
 *
 * bh2 WE (designs 2 and 4): the questions are grouped by the same outline as the review (formOutline); the map lint's
 * findings show as checks (and L5 blocks confirming, as the server does); guidance shows as stored, and – for a map from
 * before this release – as it reads on reports now; every note is shown (in tenant mode too).
 *
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Eye, EyeOff, FilePlus2, Loader2, Pencil, Plus, Save, ShieldCheck } from "lucide-react";
import { formatUkDate, formatUkDateTime, nowIso } from "../../../core/dates";
import { answerableFields, checkFormDefinition } from "../../../core/forms";
import { currentGuidance } from "../../../core/forms/guidance";
import { LINT_RULE_TITLES } from "../../../core/form-map-lint";
import { humaniseMergeCodes } from "../../../core/practice-merge-codes";
import { isQuestionSet, withQuestionSetFile } from "../../../core/question-set";
import { isConvertedFromRtf, isRtfConversionNote, rtfNoteText } from "../../../core/rtf/notes";
import { instructionsMappingNote } from "../../../core/template-instructions";
import {
  ANSWER_TYPE_LABELS,
  FORM_FIELD_CONFIDENCE_LABELS,
  FORM_KIND_LABELS,
  REFERRER_TO_BE_CONFIRMED,
  REFERRER_TYPE_LABELS,
} from "../../../core/labels";
import { ReferrerTypeSchema } from "../../../core/schemas";
import type { FormDefinition, FormField } from "../../../core/types";
import { ApiError, api } from "../../api-client";
import { useHostHooks, useStudioMode, type StudioMember } from "../../host-hooks";
import { useStudioPaths } from "../../routes";
import { formWriteError, getSession, saveFormDurable, useForm } from "../../store";
import { TENANT_COPY } from "../../studio-copy";
import { formEventProps } from "../../studio-events";
import { WORDING } from "../../wording";
import { sessionTokenFor } from "../../components/shared/session";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  cn,
} from "../../primitives";
import { FieldEditor } from "../../components/forms/field-editor";
import {
  anchorFromPick,
  firstQuestionToCheck,
  judgementConfirmProblem,
  listedInOrder,
  mappingGroups,
  mappingConfirmStatus,
  mappingLint,
  mayAcceptJudgement,
  mayConfirmForms,
  newField,
  plainAnchorDescription,
  sameMapping,
} from "../../components/forms/mapping";
import { QuestionSetPreview } from "../../components/forms/question-set-preview";
import { downloadStoredFile, useFormFile } from "../../components/forms/use-form-file";
import { formatMs, plural } from "../../components/shared/format";
import { DemoNoticeBar } from "../../components/shared/demo-notice";
import { type PreviewInstructions } from "../../components/shared/docx-instructions";
import { OriginalFormPreview, type PreviewPick } from "../../components/shared/original-form-preview";
import { StudioShell } from "../../components/shared/studio-shell";
import {
  EmptyState,
  FieldLabel,
  FillSourceChip,
  fillSourceCounts,
  notAnsweredText,
  questionBreakdown,
  FormKindBadge,
  FormStatusBadge,
  Notice,
  SampleBadge,
  Select,
  useAnalysisModeLabels,
  useFillSourceLabels,
  type FillSourceKind,
} from "../../components/shared/ui-bits";

type Filter = "all" | "check" | FillSourceKind;

export function FormMappingScreen({ formId }: { formId: string }) {
  const { form, ready } = useForm(formId);
  const paths = useStudioPaths();
  const tenant = useStudioMode() === "tenant";

  if (!ready) {
    return (
      <StudioShell back={{ href: paths.forms, label: "Referrer forms" }}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[70vh] rounded-xl" />
          <Skeleton className="h-[70vh] rounded-xl" />
        </div>
      </StudioShell>
    );
  }
  if (!form) {
    return (
      <StudioShell back={{ href: paths.forms, label: "Referrer forms" }}>
        <EmptyState
          icon={FilePlus2}
          title={tenant ? TENANT_COPY.forms.notFoundTitle : "This form is not in this browser"}
          actions={
            <Button asChild>
              <Link href={paths.forms}>Go to the forms library</Link>
            </Button>
          }
        >
          {tenant ? (
            TENANT_COPY.forms.notFoundBody
          ) : (
            <>Form maps are stored in the browser where they were created (demo). Upload the referrer&apos;s form again to map it here.</>
          )}
        </EmptyState>
      </StudioShell>
    );
  }
  return <MappingEditor key={form.id} saved={form} />;
}

function MappingEditor({ saved }: { saved: FormDefinition }) {
  const hooks = useHostHooks();
  const paths = useStudioPaths();
  const tenant = hooks.mode === "tenant";
  const sourceLabels = useFillSourceLabels();
  const analysisLabels = useAnalysisModeLabels();
  const [draft, setDraft] = useState<FormDefinition>(saved);
  const [editing, setEditing] = useState(saved.status !== "confirmed");
  const [selected, setSelected] = useState<string | null>(firstQuestionToCheck(saved.fields));
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [showPreviewMobile, setShowPreviewMobile] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  // Fix round 1 (B0-9): the server's refusal of a save, shown instead of "Changes saved".
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Fix round 1 (B0-9, B0-25): staff check proposed maps; an owner, administrator or clinician confirms and changes them.
  const mayConfirm = mayConfirmForms(hooks.member);
  // 10/2026: the form author's instructions for whoever completes it, as found in the preview (left off the completed form).
  const [instructions, setInstructions] = useState<PreviewInstructions>({ found: [], rows: false });
  // A portal question set has no file: its questions are shown instead, and nothing is picked in a file.
  const questionSet = isQuestionSet(saved);
  const { file, loading, error } = useFormFile(questionSet ? null : saved);

  const dirty = !sameMapping(draft, saved) || draft.status !== saved.status;
  // A clinic's map names its referrer before it is confirmed (fix wave 2: never "completed for every patient
  // Referrer to be confirmed refers").
  // bh2 WE design 2: the map lint – checks on the page; an unaccepted L5 blocks confirming (as /forms/confirm does).
  const lint = useMemo(() => mappingLint(draft), [draft]);
  const mayAccept = mayAcceptJudgement(hooks.member);
  // check-WE minor 9: a map that accepts a clinical judgement as worded is confirmed by a clinician (or a member who may
  // sign) – said here, before the click, instead of the server's refusal.
  const judgementProblem = judgementConfirmProblem(lint, mayAccept);
  // Fix round 1 (R1T-WE-L1): what the member can fix here; who confirms (their role, or a judgement map) is said apart.
  const fixable = useMemo(
    () => [
      ...checkFormDefinition(draft),
      ...(tenant && (!draft.referrer.name.trim() || draft.referrer.name.trim() === REFERRER_TO_BE_CONFIRMED) ? [TENANT_COPY.forms.referrerNeeded] : []),
      ...lint.blocking,
    ],
    [draft, tenant, lint],
  );
  const confirmStatus = mappingConfirmStatus({
    fixable,
    judgementObstacle: judgementProblem,
    mayConfirm,
    dirty,
    confirmed: saved.status === "confirmed",
    confirmRole: TENANT_COPY.forms.confirmRole,
  });
  const counts = fillSourceCounts(draft);
  const breakdown = questionBreakdown(draft);
  const toCheck = draft.fields.filter((f) => f.confidence !== "high").length;
  const selectedField = draft.fields.find((f) => f.id === selected) ?? null;

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // A saved change elsewhere (another tab) while not editing: follow it.
  useEffect(() => {
    if (!editing) setDraft(saved);
  }, [saved, editing]);

  const updateField = (next: FormField) => setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.id === next.id ? next : f)) }));
  const removeField = (id: string) => {
    setDraft((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== id) }));
    setSelected(null);
    setPicking(false);
  };
  const addField = () => {
    const field = newField(draft, selectedField?.section);
    setDraft((d) => ({ ...d, fields: [...d.fields, field] }));
    setSelected(field.id);
    setFilter("all");
    if (!questionSet) {
      setPicking(true);
      setShowPreviewMobile(true);
    }
  };
  const onPick = (pick: PreviewPick) => {
    if (!selectedField) return;
    updateField({ ...selectedField, anchor: anchorFromPick(selectedField.anchor, pick), confidence: "high" });
    setPicking(false);
  };

  const saveAsProposed = async () => {
    // A question set's placeholder file is the hash of its questions (core/question-set.ts): keep it current.
    const next: FormDefinition = await withQuestionSetFile({ ...draft, status: "proposed", updatedAt: nowIso() });
    delete next.confirmed;
    // Fix round 1 (B0-9): "Changes saved" only once the clinic's storage holds them – never on a refusal.
    setSaving(true);
    setSaveError(null);
    setSavedNotice(null);
    const ok = await saveFormDurable(next);
    setSaving(false);
    if (ok) {
      setSavedNotice("Changes saved. Confirm the mapping before using this form for patients.");
      setDraft(next);
    } else {
      setSaveError(formWriteError(next.id) ?? "The changes could not be saved. Please try again.");
    }
  };
  /**
   * The server checks the map and returns it confirmed, with its attestation of exactly these fields
   * (POST /forms/confirm). Completing, approving and issuing the form all re-verify that attestation.
   */
  const confirm = async (by: string): Promise<string | null> => {
    try {
      const sessionToken = await sessionTokenFor({ tenantId: draft.tenantId });
      const { form: next } = await api.confirmForm({ form: { ...draft, status: "proposed" }, confirmedBy: by }, { sessionToken });
      // The confirmed map must be stored before it is used for patients (a clinic's Studio: on the server).
      if (!(await saveFormDurable(next))) return "The confirmed mapping could not be saved. Please try again.";
      hooks.track?.("form_confirmed", formEventProps(next));
      setDraft(next);
      setEditing(false);
      setPicking(false);
      setConfirmOpen(false);
      setSavedNotice(`Mapping confirmed by ${by} on ${formatUkDate((next.confirmed?.at ?? nowIso()).slice(0, 10))}. It will be reused for every patient ${draft.referrer.name} refers.`);
      return null;
    } catch (err) {
      if (err instanceof ApiError) return err.problem.detail ?? err.problem.title;
      return "The mapping could not be confirmed. Check your connection and try again.";
    }
  };

  // Fix round 1 (B0-29): numbered questions in a table's columns by their number ("date 1, 2, 3…", not "1, 7, 2, 8").
  const visible = listedInOrder(draft.fields).filter((f) =>
    filter === "all" ? true : filter === "check" ? f.confidence !== "high" : f.fillSource.kind === filter,
  );
  // bh2 WE design 4: the same groups as the review (core/forms/headings.ts formOutline), in this page's list order.
  const groups = mappingGroups(draft.fields, visible);

  const a = draft.analysis;
  // A form converted from RTF when it was added: its conversion notes get their own note (not the analysis list).
  const fromRtf = !questionSet && isConvertedFromRtf(draft.file);
  const rtfNotes = fromRtf ? a.warnings.filter(isRtfConversionNote) : [];
  const analysisNotes = fromRtf ? a.warnings.filter((w) => !isRtfConversionNote(w)) : a.warnings;

  return (
    <StudioShell
      back={{ href: paths.forms, label: "Referrer forms" }}
      title={draft.title}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{draft.referrer.name}</span>
          <span aria-hidden>·</span>
          <span>{REFERRER_TYPE_LABELS[draft.referrer.type]}</span>
          <FormKindBadge kind={draft.kind} />
          <FormStatusBadge status={saved.status} />
          {draft.builtIn ? <SampleBadge /> : null}
        </span>
      }
      actions={
        <>
          <Button variant="outline" size="sm" className={questionSet ? "hidden" : undefined} disabled={!file} onClick={() => file && downloadStoredFile(file)}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden />
            {fromRtf ? "Download Word version" : "Download original"}
          </Button>
          {saved.status === "confirmed" && !editing ? (
            <>
              {mayConfirm ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
                  Edit mapping
                </Button>
              ) : null}
              <Button asChild size="sm">
                <Link href={paths.newReportWithForm(saved.id)}>
                  <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden />
                  Use for a patient
                </Link>
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {saveError ? (
        <Notice tone="error" title="Not saved">
          {saveError}
        </Notice>
      ) : savedNotice ? (
        <Notice tone="success" title={savedNotice} />
      ) : saved.status === "confirmed" && saved.confirmed && !editing ? (
        <Notice tone="success" icon={ShieldCheck} title={`Confirmed by ${saved.confirmed.by} on ${formatUkDate(saved.confirmed.at.slice(0, 10))}`}>
          This mapping is used every time this form is completed for a patient.{" "}
          {mayConfirm ? "Editing it sends it back for confirmation." : TENANT_COPY.forms.confirmedLocked}
        </Notice>
      ) : (
        <Notice tone="warning" title="Proposed mapping – check it once, then confirm">
          {questionSet
            ? "Check each question's answer type and where its answer comes from. Questions marked “Check” or “Needs review” were matched from their wording."
            : "Click each question to see where its answer goes in the original form. Questions marked “Check” or “Needs review” were less certain."}{" "}
          {tenant ? TENANT_COPY.sources.mappingIdentifiers : WORDING.byCode.mappingIdentifiers}
        </Notice>
      )}

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="To answer"
          value={String(breakdown.toAnswer)}
          detail={notAnsweredText(breakdown) || (questionSet ? "Every question" : "Every box on the form")}
        />
        <Stat
          label="From records"
          value={String(breakdown.fromRecords)}
          detail={hooks.mode === "tenant" ? "Filled by code: registration details and calculated figures" : "Filled by code: TM3 registration and calculated figures"}
        />
        <Stat label="From notes / clinician" value={String(breakdown.fromNotes)} detail={`${counts.clinician_opinion} need the clinician's own opinion`} />
        <Stat
          label="How it was analysed"
          value={
            questionSet
              ? WORDING.questionSet.analysisLabel
              : a.mode === "demo_prewritten" && draft.demoNotice
                ? WORDING.labels.prewrittenDemoFormMap
                : analysisLabels[a.mode]
          }
          detail={[WORDING.formReading.showModel ? a.model : null, formatUkDateTime(a.at), a.durationMs ? formatMs(a.durationMs) : null].filter(Boolean).join(" · ")}
          small
        />
      </div>

      {fromRtf ? (
        // RTF (10/2026): the template was converted to Word when it was added (core/rtf); say so, and what was left out.
        <Notice tone="info" title="Converted from RTF">
          “{draft.file.fileName}” was uploaded as an RTF file and converted to a Word document when it was added, so it is
          completed and downloaded as Word (.docx). Check the preview against the template.
          {rtfNotes.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {rtfNotes.map((w) => (
                <li key={w}>{humaniseMergeCodes(rtfNoteText(w))}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      {instructions.found.length && !questionSet ? (
        <Notice tone="info" title="Left off the completed form">
          {instructionsMappingNote(instructions.found, instructions.rows)}
        </Notice>
      ) : null}

      {lint.mapLevel.length ? (
        <Notice tone="warning" title="Checks on this map">
          <ul className="list-disc space-y-0.5 pl-4">
            {lint.mapLevel.map((i) => (
              <li key={`${i.rule}-${i.message}`}>
                {LINT_RULE_TITLES[i.rule]}: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {analysisNotes.length ? (
        <Notice tone="warning" title="Notes from the analysis">
          <ul className="list-disc space-y-0.5 pl-4">
            {analysisNotes.map((w) => (
              <li key={w}>{humaniseMergeCodes(w)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {editing ? <DetailsEditor draft={draft} onChange={setDraft} /> : null}

      <div className="lg:hidden">
        <Button variant="outline" size="sm" onClick={() => setShowPreviewMobile((v) => !v)} aria-expanded={showPreviewMobile}>
          {showPreviewMobile ? <EyeOff className="mr-1.5 h-4 w-4" aria-hidden /> : <Eye className="mr-1.5 h-4 w-4" aria-hidden />}
          {showPreviewMobile ? (questionSet ? "Hide the question list" : "Hide the original form") : questionSet ? "Show the question list" : "Show the original form"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className={cn("lg:block", showPreviewMobile ? "block" : "hidden")}>
          <div className="lg:sticky lg:top-[96px]">
            <p className="mb-2 text-xs text-slate-500">
              {questionSet ? `${FORM_KIND_LABELS[draft.kind]} · ${WORDING.questionSet.noFile}` : `${FORM_KIND_LABELS[draft.kind]} · ${draft.file.fileName} · shown in its original layout`}
              {selectedField ? ` · highlighting ${selectedField.id}` : ""}
            </p>
            <DemoNoticeBar notice={draft.demoNotice} className="mb-2" />
            {questionSet ? (
              <QuestionSetPreview form={draft} selectedId={selected} onSelect={setSelected} className="h-[70vh] lg:h-[calc(100vh-154px)]" />
            ) : null}
            <OriginalFormPreview
              file={file}
              loading={loading}
              error={error}
              highlight={selectedField ? { anchor: selectedField.anchor, label: selectedField.label } : null}
              pickMode={picking && editing}
              onPick={onPick}
              onInstructions={setInstructions}
              className={questionSet ? "hidden" : "h-[70vh] lg:h-[calc(100vh-154px)]"}
              label={`${draft.title} – original layout`}
            />
          </div>
        </div>

        <div className="space-y-4 pb-24">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter questions">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              All {draft.fields.length}
            </FilterChip>
            {toCheck ? (
              <FilterChip active={filter === "check"} onClick={() => setFilter("check")}>
                To check {toCheck}
              </FilterChip>
            ) : null}
            {(Object.keys(counts) as FillSourceKind[])
              .filter((k) => counts[k] > 0)
              .map((k) => (
                <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>
                  {sourceLabels.short[k]} {counts[k]}
                </FilterChip>
              ))}
          </div>

          {groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No questions match this filter.</p>
          ) : null}

          {groups.map((group, gi) => (
            <section key={`${group.key}-${gi}`} aria-label={group.title || "Questions on the form"} className="space-y-2">
              {/* A form that prints no headings: one group, no title (the same on the review). */}
              {group.title ? <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h2> : null}
              <ul className="space-y-2">
                {group.fields.map((field) => {
                  const active = field.id === selected;
                  const checks = lint.byField.get(field.id) ?? [];
                  const open = checks.filter((c) => c.severity === "error");
                  return (
                    <li key={field.id} className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(active ? null : field.id);
                          setPicking(false);
                        }}
                        aria-expanded={active}
                        className={cn(
                          "w-full rounded-xl border bg-white p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
                          active ? "border-teal-500 ring-1 ring-teal-500" : "border-slate-200 hover:border-teal-300",
                          field.fillSource.kind === "leave_blank" && !active && "opacity-70",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{field.id}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug text-slate-900">
                              {humaniseMergeCodes(field.label)}
                              {field.required ? (
                                <span className="ml-1 text-red-600" title="Required by the referrer">
                                  *
                                </span>
                              ) : null}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <FillSourceChip kind={field.fillSource.kind} field={field} />
                              <span className="text-[11px] text-slate-500">{ANSWER_TYPE_LABELS[field.answerType]}</span>
                              {field.confidence !== "high" ? (
                                <span
                                  className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                                    field.confidence === "low" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800",
                                  )}
                                >
                                  {FORM_FIELD_CONFIDENCE_LABELS[field.confidence]}
                                </span>
                              ) : null}
                            </div>
                            {!active && !questionSet ? <p className="mt-1 truncate text-[11px] text-slate-500">{plainAnchorDescription(field)}</p> : null}
                            {open.length ? (
                              <p className="mt-1 text-[11px] font-medium text-amber-800">Check: {Array.from(new Set(open.map((c) => LINT_RULE_TITLES[c.rule]))).join(" · ")}</p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                      {active ? (
                        editing ? (
                          <FieldEditor
                            key={field.id}
                            field={field}
                            formKind={draft.kind}
                            guidanceVersion={draft.analysis.guidanceVersion}
                            lint={checks}
                            mayAcceptJudgement={mayAccept}
                            onChange={updateField}
                            onRemove={() => removeField(field.id)}
                            picking={picking}
                            onTogglePick={() => {
                              setPicking((p) => !p);
                              setShowPreviewMobile(true);
                            }}
                          />
                        ) : (
                          <ReadOnlyField field={field} questionSet={questionSet} guidanceVersion={draft.analysis.guidanceVersion} />
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {editing ? (
            <Button variant="outline" onClick={addField} className="w-full border-dashed">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {questionSet ? "Add a question" : "Add a question the analysis missed"}
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
            <p className="text-xs text-slate-600" aria-live="polite">
              {confirmStatus.status}
              {confirmStatus.roleNote ? <span className="block text-[11px] text-slate-500">{confirmStatus.roleNote}</span> : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {saved.status === "confirmed" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(saved);
                    setEditing(false);
                    setPicking(false);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => void saveAsProposed()}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1.5 h-4 w-4" aria-hidden />}
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button size="sm" disabled={!mayConfirm} title={mayConfirm ? undefined : TENANT_COPY.forms.confirmRole} onClick={() => setConfirmOpen(true)}>
                <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden />
                Confirm mapping
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} problems={fixable} whoConfirms={judgementProblem} draft={draft} onConfirm={confirm} />
    </StudioShell>
  );
}

function Stat({ label, value, detail, small }: { label: string; value: string; detail?: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("font-semibold text-slate-900", small ? "text-sm" : "text-xl")}>{value}</p>
      {detail ? <p className="truncate text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
      )}
    >
      {children}
    </button>
  );
}

function ReadOnlyField({ field, questionSet, guidanceVersion }: { field: FormField; questionSet?: boolean; guidanceVersion?: number }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      {/* WE design 4: a map from before this release shows its guidance as it reads now; a v2 map exactly as stored. */}
      {field.guidance ? <p className="text-slate-700">{humaniseMergeCodes(currentGuidance(field.guidance, field, { guidanceVersion }))}</p> : null}
      {field.options?.length ? <p className="text-xs text-slate-600">Options: {field.options.join(" · ")}</p> : null}
      <p className="text-xs text-slate-600">{questionSet ? WORDING.questionSet.noFile : `Goes in: ${plainAnchorDescription(field)}`}</p>
      {field.note ? <p className="text-xs text-slate-500">Note: {humaniseMergeCodes(field.note)}</p> : null}
    </div>
  );
}

function DetailsEditor({ draft, onChange }: { draft: FormDefinition; onChange(d: FormDefinition): void }) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4" open={draft.status !== "confirmed" && !draft.confirmed}>
      <summary className="cursor-pointer text-sm font-medium text-slate-900">Form details – referrer, title and version</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <FieldLabel htmlFor="map-referrer">Referrer</FieldLabel>
          <Input
            id="map-referrer"
            value={draft.referrer.name}
            onChange={(e) => onChange({ ...draft, referrer: { ...draft.referrer, name: e.target.value || " " } })}
          />
        </div>
        <div>
          <FieldLabel htmlFor="map-referrer-type">Referrer type</FieldLabel>
          <Select
            id="map-referrer-type"
            value={draft.referrer.type}
            onChange={(e) => onChange({ ...draft, referrer: { ...draft.referrer, type: ReferrerTypeSchema.parse(e.target.value) } })}
          >
            {ReferrerTypeSchema.options.map((t) => (
              <option key={t} value={t}>
                {REFERRER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="map-version" hint="(optional)">
            Version
          </FieldLabel>
          <Input id="map-version" value={draft.versionLabel ?? ""} onChange={(e) => onChange({ ...draft, versionLabel: e.target.value || undefined })} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <FieldLabel htmlFor="map-title">Form title</FieldLabel>
          <Input id="map-title" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value || " " })} />
        </div>
      </div>
      {draft.referrer.type === "employer" ? (
        <p className="mt-2 text-xs text-slate-600">
          Employer forms: past medical and social history are removed from the notes before anything is drafted.
        </p>
      ) : null}
    </details>
  );
}

/**
 * What to do next when this member may not confirm a judgement map (the box used to end with "Back" only): an owner or
 * administrator who is a physiotherapist adds their own signing details; staff (the only other role it reaches – a
 * clinician may always confirm) ask a clinician.
 */
function WhoConfirmsNext({ role }: { role: StudioMember["role"] }) {
  const manager = role === "owner" || role === "admin";
  return (
    <span className="mt-2 block" data-who-confirms-next>
      {manager ? (
        <>
          If you are a physiotherapist, add your HCPC number and tick “May sign” on your own row in{" "}
          <Link href="/app/settings/members" className="font-medium underline">
            Clinic settings → Members
          </Link>
          , then come back and confirm. Otherwise, ask a clinician in your clinic to open this form and confirm it.
        </>
      ) : (
        <>
          Ask a clinician in your clinic to open this form and confirm it. Staff members prepare forms but do not confirm
          clinical judgements.
        </>
      )}
    </span>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  problems,
  whoConfirms,
  draft,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  problems: string[];
  /** Fix round 1 (R1T-WE-L1): who confirms this map instead of this member (a judgement map) – not a problem to fix. */
  whoConfirms: string | null;
  draft: FormDefinition;
  onConfirm(by: string): Promise<string | null>;
}) {
  const { member, mode } = useHostHooks();
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setChecked(false);
    setError(null);
    // A clinic's Studio: the signed-in member confirms; the demo: the launched clinician, if any.
    setName((n) => n || (mode === "tenant" ? member?.name : getSession()?.claims.clinician?.name) || "");
  }, [open, member, mode]);
  const submit = async () => {
    if (!name.trim() || !checked || busy) return;
    setBusy(true);
    setError(null);
    const problem = await onConfirm(name.trim());
    setBusy(false);
    if (problem) setError(problem);
  };
  const toCheck = draft.fields.filter((f) => f.confidence === "low").length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm this mapping</DialogTitle>
          <DialogDescription>
            Once confirmed, “{draft.title}” is completed this way for every patient {draft.referrer.name} refers. Each completed
            form is still reviewed and approved by the treating clinician.
          </DialogDescription>
        </DialogHeader>
        {problems.length ? (
          <Notice tone="error" title="Fix these first">
            <ul className="list-disc space-y-0.5 pl-4">
              {problems.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {problems.length > 8 ? <li>…and {problems.length - 8} more</li> : null}
            </ul>
          </Notice>
        ) : whoConfirms ? (
          <Notice tone="warning" title="Who confirms this mapping">
            {whoConfirms}
            {mode === "tenant" ? <WhoConfirmsNext role={member?.role} /> : null}
          </Notice>
        ) : (
          <form
            id="confirm-mapping"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {toCheck ? (
              <Notice tone="warning">{plural(toCheck, "question")} still marked “Needs review”. Confirming accepts them as they are.</Notice>
            ) : null}
            <div>
              <FieldLabel htmlFor="confirm-by">Your name</FieldLabel>
              <Input id="confirm-by" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-teal-600"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              {isQuestionSet(draft)
                ? "I have checked each question's wording, its answer type and where its answer comes from."
                : "I have checked each question's answer type, where its answer comes from and where it goes in the form."}
            </label>
            {error ? (
              <Notice tone="error" title="Not confirmed">
                {error}
              </Notice>
            ) : null}
          </form>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          {problems.length || whoConfirms ? null : (
            <Button type="submit" form="confirm-mapping" disabled={!name.trim() || !checked || busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />}
              {busy ? "Confirming…" : "Confirm mapping"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
