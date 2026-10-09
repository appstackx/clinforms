"use client";

/**
 * /reports/[id] – review, amend and approve. For a report that completes a referrer's own form:
 * the questions in the form's order (left: grouped by the form's headings with status dots), each
 * answer with where it came from and its citations (centre), and Sources / Flags & gaps / Preview (the
 * filled form in its ORIGINAL layout) / Activity (right). Approval goes through POST /sign; the final
 * document is the referrer's original file with the answers and sign-off written in, and can be saved
 * back to the (simulated) clinic record. Built-in template reports use the same workspace.
 * A report ID that is not in this browser shows NOTICES.otherBrowser.
 *
 * Owner: studio-b agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenText, FileQuestion, Flag, History, Loader2, NotebookPen, PanelRight, PenLine, X } from "lucide-react";
import { NOTICES } from "../../../config.public";
import { formatUkDateTime } from "../../../core/dates";
import { computeFacts } from "../../../core/computed-facts";
import { formToTemplate, primaryTreatingClinician } from "../../../core/forms";
import type { Clinician, FormDefinition, Report, ReportFlag, ReportTemplate } from "../../../core/types";
import { canAcknowledge as coreCanAcknowledge, canSign, reportFactsDate } from "../../../core/validation";
import { getTemplate } from "../../../templates/registry";
import { toBase64 } from "../../api-client";
import { useHostHooks } from "../../host-hooks";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipProvider,
  cn,
} from "../../primitives";
import { getSession, loadFormFile, saveReport, useForm, useReport } from "../../store";
import { WORDING } from "../../wording";
import { createId } from "../../../core/ids";
import { useAiMode } from "../../components/shared/ai-mode";
import { ActivityPanel } from "../../components/review/activity-panel";
import { ApproveDialog } from "../../components/review/approve-dialog";
import { FlagsPanel } from "../../components/review/flags-panel";
import { PreviewPanel, type FormFileState } from "../../components/review/preview-panel";
import { QuestionCard } from "../../components/review/question-card";
import { SourcesPanel } from "../../components/review/sources-panel";
import { ProgressSummary, QuestionJump, QuestionNav } from "../../components/review/question-nav";
import { ApprovedBanner, ReviewHeader } from "../../components/review/review-header";
import {
  answerChangedByClinician,
  answeredByPerson,
  createAmendedVersion,
  ownVoiceCandidates,
  blockingLines as toBlockingLines,
  buildQuestionGroups,
  citationsBySource,
  countStatuses,
  filedEntries,
  flattenQuestions,
  generationSummary,
  groupBySection,
  questionStatus,
  type QuestionStatus,
} from "../../components/review/review-model";
import { InlineAlert, ToastProvider, useMediaQuery, useToast } from "../../components/review/review-ui";
import { useReviewActions } from "../../components/review/use-review-actions";
import { useReviewState } from "../../components/review/use-review-state";

type PanelTab = "sources" | "flags" | "preview" | "activity";

const EMPTY: never[] = [];

/* Loading and not-found ------------------------------------------------------------------------- */

function ReviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the report" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        <div className="hidden space-y-2 xl:block">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
        <Skeleton className="hidden h-[480px] w-full rounded-2xl lg:block" />
      </div>
    </div>
  );
}

function NotInThisBrowser({ reportId }: { reportId: string }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
          <FileQuestion className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-slate-900">{NOTICES.otherBrowser}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Reports in this demo are kept in the browser that created them, so report <span className="font-mono text-[13px]">{reportId}</span> cannot be
          opened here. Open it in the browser you used to create it, or export it there as case JSON and import it on the Reports page.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/reports">Go to Reports</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/reports/new">Complete a form</Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-slate-500">{NOTICES.browserStorage}</p>
      </div>
    </div>
  );
}

/* Screen ---------------------------------------------------------------------------------------- */

export function ReviewScreen({ reportId }: { reportId: string }) {
  const { report, ready } = useReport(reportId);
  // The copy the workspace starts from; later stored copies are merged by the workspace itself.
  const [initial, setInitial] = useState<Report | null>(null);
  useEffect(() => {
    if (report && !initial) setInitial(report);
  }, [report, initial]);
  const base = initial ?? report;

  if (!ready) return <ReviewSkeleton />;
  if (!base || !report) return <NotInThisBrowser reportId={reportId} />;
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <ReviewWorkspace key={base.id} initial={base} stored={report} />
      </ToastProvider>
    </TooltipProvider>
  );
}

/* Workspace ------------------------------------------------------------------------------------- */

function useFormFile(form: FormDefinition | null, needed: boolean): FormFileState {
  const [state, setState] = useState<FormFileState>(needed ? { status: "loading" } : { status: "none" });
  const sha = form?.file.sha256 ?? null;
  const formRef = useRef(form);
  formRef.current = form;
  useEffect(() => {
    const current = formRef.current;
    if (!needed || !current) {
      setState(needed ? { status: "missing" } : { status: "none" });
      return;
    }
    let live = true;
    const ctrl = new AbortController();
    setState({ status: "loading" });
    (async () => {
      const stored = await loadFormFile(current, { signal: ctrl.signal });
      if (!live) return;
      if (!stored) return setState({ status: "missing" });
      const copy = new Uint8Array(stored.bytes.byteLength);
      copy.set(stored.bytes);
      const base64 = await toBase64(copy.buffer);
      if (live) setState({ status: "ready", base64, fileName: stored.fileName, mimeType: stored.mimeType });
    })().catch(() => {
      if (live) setState({ status: "missing" });
    });
    return () => {
      live = false;
      ctrl.abort();
    };
  }, [needed, sha]);
  return state;
}

function ReviewWorkspace({ initial, stored }: { initial: Report; stored: Report }) {
  const hooks = useHostHooks();
  const { push: toast } = useToast();
  const formInfo = initial.form ?? null;
  const { form: libraryForm, ready: formReady } = useForm(formInfo?.formId ?? "");

  // The form map, only when it is the one this report was started from.
  const form: FormDefinition | null = formInfo && libraryForm && libraryForm.file.sha256 === formInfo.fileSha256 ? libraryForm : null;
  const formProblem: null | "loading" | "missing" | "mismatch" = !formInfo
    ? null
    : !formReady
      ? "loading"
      : !libraryForm
        ? "missing"
        : libraryForm.file.sha256 !== formInfo.fileSha256
          ? "mismatch"
          : null;

  const template: ReportTemplate | null = useMemo(() => {
    if (formInfo) return form ? formToTemplate(form) : null;
    return getTemplate(initial.templateId) ?? null;
  }, [formInfo, form, initial.templateId]);

  const { report, dispatch, validating, saveState, savedAt, validateNow, commit } = useReviewState(initial, stored, template);
  const file = useFormFile(form, Boolean(formInfo));
  const signed = report.status === "signed";
  const isForm = Boolean(report.form);
  const bundle = report.bundleSnapshot;

  // Who is acting, for the audit trail: the clinician the clinic system opened THIS report for, else
  // the report's author (saved when it was started), never an anonymous "Reviewer".
  const session = getSession();
  const sessionCoversReport =
    session?.claims.kind === "launch" && session.claims.patientId === initial.episodeRef.patientId && session.claims.episodeId === initial.episodeRef.episodeId;
  const actor = (sessionCoversReport ? session?.claims.clinician?.name : undefined) ?? initial.author?.name ?? session?.claims.clinician?.name ?? "Clinic staff (demo session)";
  const defaultSigner: Clinician | null = useMemo(() => {
    const s = getSession();
    const claims = s?.claims;
    if (claims?.clinician && (claims.kind === "demo" || (claims.patientId === initial.episodeRef.patientId && claims.episodeId === initial.episodeRef.episodeId))) {
      return claims.clinician;
    }
    return primaryTreatingClinician(initial.bundleSnapshot);
  }, [initial]);

  /* Derived ------------------------------------------------------------------------------------ */

  const facts = useMemo(() => computeFacts(bundle, { asOf: reportFactsDate(report) }), [bundle, report.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => buildQuestionGroups(report, form, template), [report, form, template]);
  const questions = useMemo(() => flattenQuestions(groups), [groups]);
  const flagsBySection = useMemo(() => groupBySection(report.flags), [report.flags]);
  const gapsBySection = useMemo(() => groupBySection(report.gaps), [report.gaps]);
  const personAnswered = useMemo(() => new Set(questions.filter((q) => answeredByPerson(report, q.key)).map((q) => q.key)), [questions, report]);
  const statuses = useMemo(() => {
    const map = new Map<string, QuestionStatus>();
    for (const q of questions) map.set(q.key, questionStatus(q, flagsBySection.get(q.key) ?? EMPTY, report.gaps, personAnswered.has(q.key)));
    return map;
  }, [questions, flagsBySection, report.gaps, personAnswered]);
  const counts = useMemo(() => countStatuses(Array.from(statuses.values())), [statuses]);
  const blocking = useMemo(() => canSign(report.flags, report.gaps).blocking, [report.flags, report.gaps]);
  const generation = useMemo(() => generationSummary(report.generation), [report.generation]);
  const citedBy = useMemo(() => citationsBySource(report), [report]);
  const pendingKeys = useMemo(() => report.sections.filter((s) => s.status === "pending").map((s) => s.key), [report.sections]);
  const editedAnswers = useMemo(() => new Set(questions.filter((q) => answerChangedByClinician(report, q.key)).map((q) => q.key)), [questions, report]);
  const labelOf = useCallback((key: string) => questions.find((q) => q.key === key)?.label ?? key, [questions]);

  const reportRef = useRef(report);
  reportRef.current = report;
  const canAck = useCallback((flag: ReportFlag) => coreCanAcknowledge(flag, reportRef.current), []);

  const actions = useReviewActions({ report, form, template, file, actor, hooks, dispatch, commit, validateNow, toast });
  const router = useRouter();
  const aiMode = useAiMode();
  // Demo deployment, no live passcode and no recorded answers for this record: a drafting call would
  // fail, so the Studio says what to do instead of offering it.
  const draftingUnavailable = !aiMode.expectLive && report.demoDraftsAvailable === false;

  // Answers that describe the signer's own notes in the third person ("Sarah Reid recorded…").
  const voiceAuthor = report.author?.name ?? (bundle.notes.some((n) => n.author.name === actor) ? actor : null);
  const ownVoice = useMemo(() => (voiceAuthor && !signed ? ownVoiceCandidates(report, voiceAuthor) : []), [report, voiceAuthor, signed]);

  const startAmendment = useCallback(() => {
    const id = createId("rpt");
    const amended = createAmendedVersion(report, actor, id);
    if (!saveReport(amended)) {
      toast({ tone: "error", title: "This browser could not save the amended version (storage full or blocked)." });
      return;
    }
    dispatch({
      type: "activity",
      action: "superseded",
      actor,
      detail: `Amended version ${amended.version} started (${id}). This approval is superseded once the amended version is approved.`,
    });
    router.push(`/reports/${encodeURIComponent(id)}`);
  }, [report, actor, toast, dispatch, router]);

  const approveUnavailable: string | null = signed
    ? null
    : formProblem === "loading"
      ? "Loading the form map…"
      : formProblem === "missing"
        ? "The form map is not in this browser's forms library."
        : formProblem === "mismatch"
          ? "The forms library holds a different version of this form."
          : form && form.status !== "confirmed"
            ? "The form's mapping has not been confirmed yet."
            : !template
              ? "This report's template is not available."
              : actions.draftingKeys.size > 0
                ? "Drafting is still running."
                : null;
  const canApprove = !signed && !approveUnavailable && !validating && blocking.length === 0;

  /* Layout state ------------------------------------------------------------------------------- */

  const wide = useMediaQuery("(min-width: 1280px)");
  const mid = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<PanelTab>(initial.form ? "preview" : "flags");
  const [sheetOpen, setSheetOpen] = useState(false);
  // `seq` re-scrolls to a source that is already highlighted when its chip is clicked again.
  const [sourceRequest, setSourceRequest] = useState<{ id: string; seq: number } | null>(null);
  const activeSourceId = sourceRequest?.id ?? null;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const approvedRef = useRef<HTMLDivElement>(null);
  const centreRef = useRef<HTMLDivElement>(null);

  const openPanel = useCallback(
    (next: PanelTab) => {
      setTab(next);
      if (!mid) setSheetOpen(true);
    },
    [mid],
  );

  const onOpenSource = useCallback(
    (id: string) => {
      setSourceRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
      openPanel("sources");
    },
    [openPanel],
  );

  const sheetOpenRef = useRef(sheetOpen);
  sheetOpenRef.current = sheetOpen;
  const pendingJump = useRef<string | null>(null);
  const scrollToQuestion = useCallback((key: string) => {
    const el = document.getElementById(`q-${key}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      document.getElementById(`q-${key}-label`)?.focus({ preventScroll: true });
    }, 30);
  }, []);
  // From the mobile sheet: close it first, then move focus to the question (not back to the opener).
  const jumpTo = useCallback(
    (key: string) => {
      setActiveKey(key);
      if (sheetOpenRef.current) {
        pendingJump.current = key;
        setSheetOpen(false);
        return;
      }
      scrollToQuestion(key);
    },
    [scrollToQuestion],
  );

  // Highlight the question in view in the left list.
  useEffect(() => {
    const root = centreRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).id.replace(/^q-/, "");
          if (e.isIntersecting) visible.set(key, e.boundingClientRect.top);
          else visible.delete(key);
        }
        const top = Array.from(visible.entries()).sort((a, b) => a[1] - b[1])[0];
        if (top) setActiveKey(top[0]);
      },
      { rootMargin: "-120px 0px -50% 0px" },
    );
    root.querySelectorAll("article[id^='q-']").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [questions.length]);

  /* Render ------------------------------------------------------------------------------------- */

  const failuresByKey = new Map<string, string>();
  actions.draftFailures.forEach((f) => f.keys.forEach((k) => failuresByKey.set(k, f.message)));

  const panel = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
        <TabsTrigger value="sources" className="h-8 px-1 text-xs sm:text-[13px]">
          Sources
        </TabsTrigger>
        <TabsTrigger value="flags" className="h-8 px-1 text-xs sm:text-[13px]">
          Flags
          {blocking.length > 0 && !signed && (
            <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white" aria-label={`${blocking.length} blocking`}>
              {blocking.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="preview" className="h-8 px-1 text-xs sm:text-[13px]">
          Preview
        </TabsTrigger>
        <TabsTrigger value="activity" className="h-8 px-1 text-xs sm:text-[13px]">
          Activity
        </TabsTrigger>
      </TabsList>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <TabsContent value="sources" className="mt-0">
          <SourcesPanel
            bundle={bundle}
            facts={facts}
            template={template}
            activeSourceId={activeSourceId}
            requestSeq={sourceRequest?.seq ?? 0}
            citedBy={citedBy}
            onJump={jumpTo}
            questionLabel={labelOf}
          />
        </TabsContent>
        <TabsContent value="flags" className="mt-0">
          <FlagsPanel
            report={report}
            bundle={bundle}
            blockingCount={blocking.length}
            readOnly={signed}
            validating={validating}
            actor={actor}
            dispatch={dispatch}
            onJump={jumpTo}
            onOpenSource={onOpenSource}
            canAcknowledge={canAck}
            questionLabel={labelOf}
          />
        </TabsContent>
        <TabsContent value="preview" className="mt-0" forceMount hidden={tab !== "preview"}>
          <PreviewPanel report={report} form={form} file={file} active={tab === "preview" && (mid || sheetOpen)} />
        </TabsContent>
        <TabsContent value="activity" className="mt-0">
          <ActivityPanel activity={report.activity} />
        </TabsContent>
      </div>
    </Tabs>
  );

  return (
    <div className="space-y-5">
      <ReviewHeader
        report={report}
        template={template}
        generation={generation}
        saveState={saveState}
        savedAt={savedAt}
        blockingLines={toBlockingLines(blocking, report)}
        blockingCount={blocking.length}
        canApprove={canApprove}
        approveUnavailable={approveUnavailable}
        onApprove={() => setApproveOpen(true)}
        onShowFlags={() => openPanel("flags")}
        onDraftCopy={() => void actions.download(isForm ? "original" : "docx")}
        draftCopyUnavailable={isForm && (!form || file.status !== "ready")}
        downloading={actions.downloading}
      />

      {formProblem === "missing" && formInfo && (
        <InlineAlert tone="warning" title={`The form map for “${formInfo.title}” is not in this browser`} action={<Link className="font-medium underline" href="/reports/forms">Open the forms library</Link>}>
          You can read the answers, but previewing, checking and approving need {formInfo.referrer.name}&apos;s form map and file. Add the form to the forms
          library again (the same file), then reopen this report.
        </InlineAlert>
      )}
      {formProblem === "mismatch" && formInfo && (
        <InlineAlert tone="warning" title="A different version of this form is in the library">
          This report was started from another version of {formInfo.referrer.name}&apos;s form file. Start a new report from the current form, or add the original file back to the library.
        </InlineAlert>
      )}
      {form && form.status !== "confirmed" && !signed && (
        <InlineAlert
          tone="warning"
          title="The form's mapping has not been confirmed"
          action={
            <Link className="font-medium underline" href={`/reports/forms/${encodeURIComponent(form.id)}`}>
              Review the mapping
            </Link>
          }
        >
          A staff member checks and confirms each referrer form&apos;s mapping once before completed forms can be approved.
        </InlineAlert>
      )}

      {report.amends && (
        <InlineAlert tone="info" title={`Amended version ${report.version ?? 2}`}>
          This version amends the form approved on {formatUkDateTime(report.amends.approvedAt)}. Make the corrections, then approve it again – the
          earlier approval is superseded, and the files are marked “Amended – v{report.version ?? 2}”.
        </InlineAlert>
      )}

      {ownVoice.length > 0 && voiceAuthor && (
        <InlineAlert
          tone="info"
          title={`${ownVoice.length} answer${ownVoice.length === 1 ? " describes" : "s describe"} ${voiceAuthor}'s own notes in the third person`}
          action={
            <Button type="button" size="sm" className="h-8" onClick={() => dispatch({ type: "writeInOwnVoice", authorName: voiceAuthor, actor })}>
              <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Write in my own voice
            </Button>
          }
        >
          This form is {voiceAuthor}&apos;s own report: “On 22/09/2026 {voiceAuthor} recorded that…” becomes “On 22/09/2026 I recorded that…”. Other
          clinicians stay named, citations are unchanged, and each answer can be reverted.
        </InlineAlert>
      )}

      {!signed && (pendingKeys.length > 0 || actions.draftFailures.length > 0) && template && draftingUnavailable && actions.draftFailures.length === 0 && (
        <InlineAlert tone="info" title={`${pendingKeys.length} question${pendingKeys.length === 1 ? " is" : "s are"} for the clinician to answer`}>
          {WORDING.drafting.reviewNoDemoAnswers}
        </InlineAlert>
      )}

      {!signed && (pendingKeys.length > 0 || actions.draftFailures.length > 0) && template && !(draftingUnavailable && actions.draftFailures.length === 0) && (
        <InlineAlert
          tone={actions.draftFailures.length > 0 ? "error" : "info"}
          title={
            actions.draftingKeys.size > 0
              ? `Drafting ${actions.draftingKeys.size} question${actions.draftingKeys.size === 1 ? "" : "s"} from the notes…`
              : actions.draftFailures.length > 0
                ? "Some questions could not be drafted"
                : `${pendingKeys.length} question${pendingKeys.length === 1 ? " has" : "s have"} not been drafted yet`
          }
          action={
            actions.draftingKeys.size > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Answers appear as each group finishes.
              </span>
            ) : (
              <>
                <Button type="button" size="sm" className="h-8" onClick={() => void actions.draft(null)}>
                  <NotebookPen className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {actions.draftFailures.length > 0 ? "Try again" : "Draft them now"}
                </Button>
                {actions.draftFailures.some((f) => f.code !== "NO_DEMO_DRAFT") && (
                  <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => void actions.draft(null, "demo")}>
                    Use the prepared demo draft
                  </Button>
                )}
              </>
            )
          }
        >
          {actions.draftFailures.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {actions.draftFailures.map((f, i) => (
                <li key={i}>
                  {f.keys.join(", ")}: {f.message}
                </li>
              ))}
            </ul>
          ) : (
            "Answers are drafted strictly from the notes, with citations. Opinions are only attributed where a clinician recorded one."
          )}
        </InlineAlert>
      )}

      {signed && (
        <ApprovedBanner
          ref={approvedRef}
          report={report}
          isWordForm={report.form?.kind === "docx"}
          isPdfForm={report.form?.kind === "pdf_acroform" || report.form?.kind === "pdf_flat"}
          downloading={actions.downloading}
          pdfUnavailable={actions.pdfUnavailable}
          filing={actions.filing}
          filed={filedEntries(report)}
          canFile={report.episodeRef.connectorId === "tm3-sim"}
          clinicRecordUrl={hooks.clinicRecordUrl?.({ connectorId: report.episodeRef.connectorId, patientId: report.episodeRef.patientId }) ?? null}
          fileMissing={isForm && file.status === "missing"}
          onDownload={(k) => void actions.download(k)}
          onSave={() => void actions.saveToRecord()}
          onAmend={startAmendment}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        {wide && (
          <aside className="sticky top-[4.25rem] hidden max-h-[calc(100vh-5.25rem)] space-y-4 overflow-y-auto overscroll-contain pb-6 pr-1 xl:block">
            <ProgressSummary counts={counts} className="rounded-xl border border-slate-200 bg-white p-3" />
            <QuestionNav groups={groups} statuses={statuses} activeKey={activeKey} onJump={jumpTo} />
          </aside>
        )}

        <div ref={centreRef} className="min-w-0 space-y-6">
          {!wide && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
              <ProgressSummary counts={counts} />
              <QuestionJump groups={groups} statuses={statuses} onJump={jumpTo} />
            </div>
          )}
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={`${g.id}-title`} className="space-y-3">
              <h2 id={`${g.id}-title`} className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {g.title}
              </h2>
              {g.questions.map((q) => (
                <QuestionCard
                  key={q.key}
                  q={q}
                  status={statuses.get(q.key) ?? "pending"}
                  flags={flagsBySection.get(q.key) ?? EMPTY}
                  gaps={gapsBySection.get(q.key) ?? EMPTY}
                  bundle={bundle}
                  connectorId={report.episodeRef.connectorId}
                  referrerName={report.form?.referrer.name ?? null}
                  readOnly={signed}
                  answerEdited={editedAnswers.has(q.key)}
                  answeredByPerson={personAnswered.has(q.key)}
                  referralValue={
                    q.field?.fillSource.kind === "registration"
                      ? q.field.fillSource.path === "referral.reference"
                        ? report.instructingParty.reference ?? null
                        : q.field.fillSource.path === "referral.referrerName"
                          ? report.instructingParty.name
                          : null
                      : null
                  }
                  receipt={report.receipt}
                  activeSourceId={activeSourceId}
                  drafting={actions.draftingKeys.has(q.key)}
                  actor={actor}
                  dispatch={dispatch}
                  onOpenSource={onOpenSource}
                  canAcknowledge={canAck}
                  onDraft={
                    draftingUnavailable
                      ? undefined
                      : template && !failuresByKey.has(q.key)
                        ? (key) => void actions.draft([key])
                        : (key) => void actions.draft([key], "demo")
                  }
                />
              ))}
            </section>
          ))}
          {groups.length === 0 && (
            <InlineAlert tone="info" title="No questions">
              This report has no questions to review.
            </InlineAlert>
          )}
        </div>

        {mid && (
          <aside aria-label="Sources, checks, preview and activity" className="sticky top-[4.25rem] hidden h-[calc(100vh-5.25rem)] min-h-[480px] lg:block">
            <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">{panel}</div>
          </aside>
        )}
      </div>

      {!mid && (
        <>
          <nav aria-label="Review tools" className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur sm:-mx-6">
            <div className="mx-auto grid max-w-lg grid-cols-4 gap-1">
              {(
                [
                  { tab: "flags", label: "Flags", Icon: Flag },
                  { tab: "sources", label: "Sources", Icon: BookOpenText },
                  { tab: "preview", label: "Preview", Icon: PanelRight },
                  { tab: "activity", label: "Activity", Icon: History },
                ] as const
              ).map((b) => (
                <button
                  key={b.tab}
                  type="button"
                  onClick={() => openPanel(b.tab)}
                  className="relative flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
                >
                  <b.Icon className="h-5 w-5" aria-hidden />
                  {b.label}
                  {b.tab === "flags" && blocking.length > 0 && !signed && (
                    <span className="absolute right-[22%] top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white">
                      {blocking.length}
                      <span className="sr-only"> blocking</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </nav>
          <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
            <DialogContent
              onCloseAutoFocus={(e) => {
                const key = pendingJump.current;
                if (!key) return;
                e.preventDefault();
                pendingJump.current = null;
                scrollToQuestion(key);
              }}
              className="bottom-0 left-0 top-auto flex h-[88vh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-2 rounded-b-none rounded-t-2xl p-3 data-[state=closed]:!slide-out-to-bottom-full data-[state=closed]:slide-out-to-right-0 data-[state=open]:!slide-in-from-bottom-full data-[state=open]:slide-in-from-right-0 [&>button:last-child]:hidden">
              <div className="flex items-center justify-between px-1">
                <DialogTitle className="text-base">Review tools</DialogTitle>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setSheetOpen(false)} aria-label="Close review tools">
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <DialogDescription className="sr-only">Sources, flags and gaps, the preview of the completed form, and the activity log.</DialogDescription>
              <div className="min-h-0 flex-1">{panel}</div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {template && (
        <ApproveDialog
          open={approveOpen}
          onOpenChange={setApproveOpen}
          report={report}
          template={template}
          form={form}
          defaultSigner={defaultSigner}
          onApprove={actions.approve}
          onApproved={() => approvedRef.current?.focus()}
        />
      )}
    </div>
  );
}

