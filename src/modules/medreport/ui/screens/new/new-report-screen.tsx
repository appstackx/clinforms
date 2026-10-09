"use client";

/**
 * "Complete a form" wizard (/reports/new).
 *
 * 1. Patient record: launched from (simulated) TM3 with a launch token, or picked in Simulated TM3, or
 *    an uploaded TM3 export. `launchToken` is the `lt` query parameter read by the SERVER page; it is
 *    verified once (POST /launch/verify), the session is stored and `lt` is stripped from the address
 *    bar without a navigation.
 * 2. Check the data: counts, figures calculated by code, data checks, integration log.
 * 3. Referrer form: the referral's referrer's confirmed form by default; any confirmed form; or a
 *    built-in report when the referrer sent no form.
 * 4. Complete: createFormReport() fills registration and calculated answers by code, then /drafts runs
 *    in groups (3 at a time) with honest per-group progress; the report opens for review.
 * Tenant mode (a clinic's own Studio): the notes upload is the source, production wording, and the
 * finished draft is reported to the host's analytics (draft_completed, counts only).
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, FileCheck2, RotateCcw } from "lucide-react";
import type { BundleResponse } from "../../../api/contract";
import type { Clinician, FormDefinition, ReportTemplate } from "../../../core/types";
import { ApiError, api } from "../../api-client";
import { useHostHooks, useStudioMode } from "../../host-hooks";
import { useStudioPaths } from "../../routes";
import { flushStore, saveReport, setSession, useForms } from "../../store";
import { TENANT_COPY } from "../../studio-copy";
import { durationSeconds, reportEventProps } from "../../studio-events";
import { WORDING } from "../../wording";
import { Button, Skeleton, cn } from "../../primitives";
import { useAiMode } from "../../components/shared/ai-mode";
import { errorMessage, plural } from "../../components/shared/format";
import { StudioShell } from "../../components/shared/studio-shell";
import { Notice } from "../../components/shared/ui-bits";
import { DataStep, importedSummary } from "../../components/new/data-step";
import { DraftProgress } from "../../components/new/draft-progress";
import { FormStep, type TargetChoice } from "../../components/new/form-step";
import { generateReport, instructingPartyOf, type DraftGroupProgress, type GenerateTarget } from "../../components/new/generate";
import { rememberFormForReferrer } from "../../components/new/referrer-match";
import { SourceStep, type SourceResult } from "../../components/new/source-step";

type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Patient record" },
  { n: 2, label: "Check the data" },
  { n: 3, label: "Referrer form" },
  { n: 4, label: "Complete" },
];

type LaunchState =
  | { status: "none" }
  | { status: "verifying" }
  | { status: "loading"; patientName?: string }
  | { status: "done" }
  | { status: "error"; message: string };

function launchErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "TOKEN_EXPIRED") return "This launch link has expired (links last 10 minutes). Launch again from the patient's record.";
    if (err.code === "TOKEN_INVALID") return "This launch link is not valid. Launch again from the patient's record.";
  }
  return errorMessage(err);
}

interface GenerationState {
  running: boolean;
  groups: DraftGroupProgress[];
  reportId?: string;
  failedGroups?: number;
  codeFilled?: number;
  error?: string;
  storageWarning?: boolean;
}

export function NewReportScreen({ launchToken, initialFormId }: { launchToken?: string; initialFormId?: string }) {
  const router = useRouter();
  const hooks = useHostHooks();
  const paths = useStudioPaths();
  const tenant = useStudioMode() === "tenant";
  const { expectLive, livePossible } = useAiMode();
  const { forms, ready: formsReady } = useForms();
  const [step, setStep] = useState<Step>(1);
  const [launch, setLaunch] = useState<LaunchState>(launchToken ? { status: "verifying" } : { status: "none" });
  const [data, setData] = useState<BundleResponse | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [clinician, setClinician] = useState<Clinician | undefined>();
  const [choice, setChoice] = useState<TargetChoice>(null);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [gen, setGen] = useState<GenerationState>({ running: false, groups: [] });
  const abortRef = useRef<AbortController | null>(null);
  const launchStarted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Launch from the clinic system: verify once, strip `lt`, fetch the episode.
  useEffect(() => {
    if (!launchToken || launchStarted.current) return;
    launchStarted.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("lt");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // ignore
    }
    (async () => {
      try {
        const verified = await api.verifyLaunch(launchToken);
        setSession(verified.session);
        setLaunch({ status: "loading" });
        const { claims } = verified;
        const bundle = await api.bundle(claims.connectorId, claims.patientId, claims.episodeId, { sessionToken: verified.session.token });
        setData(bundle);
        setClinician(claims.clinician);
        setSourceLabel(claims.connectorId === "tm3-sim" ? "Simulated TM3" : bundle.bundle.source.label ?? "TM3");
        setLaunch({ status: "done" });
        setStep(2);
      } catch (err) {
        setLaunch({ status: "error", message: launchErrorMessage(err) });
      }
    })();
  }, [launchToken]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Move focus to the step heading on step change (screen readers, keyboard users).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const onLoaded = useCallback((result: SourceResult) => {
    setData(result.data);
    setSourceLabel(result.sourceLabel);
    setClinician(undefined);
    setChoice(null);
    setStep(2);
  }, []);

  const party = useMemo(() => (data ? instructingPartyOf(data.bundle) : null), [data]);
  const chosenForm: FormDefinition | undefined = choice?.kind === "form" ? forms.find((f) => f.id === choice.formId) : undefined;
  const chosenTemplate = choice?.kind === "template" ? templates.find((t) => t.id === choice.templateId) : undefined;
  const canGenerate = Boolean(data && (chosenForm?.status === "confirmed" || chosenTemplate));

  const generate = async () => {
    if (!data || !party) return;
    const target: GenerateTarget | null = chosenForm ? { kind: "form", form: chosenForm } : chosenTemplate ? { kind: "template", template: chosenTemplate } : null;
    if (!target) return;
    if (target.kind === "form") rememberFormForReferrer(party.name, target.form.id);
    const controller = new AbortController();
    abortRef.current = controller;
    setStep(4);
    setGen({ running: true, groups: [] });
    const started = Date.now();
    let storageWarning = false;
    try {
      const result = await generateReport({
        client: api,
        data,
        target,
        clinician,
        livePossible: livePossible(),
        concurrency: 3,
        signal: controller.signal,
        onReport: (report) => {
          if (!saveReport(report)) storageWarning = true;
        },
        onProgress: (groups) => setGen((g) => ({ ...g, groups })),
      });
      // Every save of the generated report must be stored before its review opens (a clinic's Studio: the server).
      if (!(await flushStore())) storageWarning = true;
      const codeFilled = result.report.sections.filter((s) => s.kind === "from_records" && s.status === "complete").length;
      setGen({
        running: false,
        groups: result.groups,
        reportId: result.report.id,
        failedGroups: result.failedGroups,
        codeFilled,
        storageWarning,
      });
      if (!controller.signal.aborted) {
        hooks.track?.("draft_completed", { ...reportEventProps(result.report), duration_s: durationSeconds(started), batch: false });
      }
      if (result.failedGroups === 0 && !storageWarning && !controller.signal.aborted) {
        setTimeout(() => router.push(paths.report(result.report.id)), 900);
      }
    } catch (err) {
      setGen((g) => ({ ...g, running: false, error: errorMessage(err) }));
    } finally {
      abortRef.current = null;
    }
  };

  const restart = () => {
    abortRef.current?.abort();
    setData(null);
    setChoice(null);
    setGen({ running: false, groups: [] });
    setLaunch({ status: "none" });
    setStep(1);
  };

  const stepTitle: Record<Step, string> = {
    1: "Where is the patient's record?",
    2: "Check what was imported",
    3: "Which referrer form?",
    4: chosenForm ? `Completing “${chosenForm.title}”` : "Drafting the report",
  };

  return (
    <StudioShell
      title="Complete a referrer form"
      description={
        tenant
          ? TENANT_COPY.wizard.description
          : "Fill the referrer's own form from the TM3 registration details and physiotherapy notes. Identifiers and figures are filled by code; answers from the notes are drafted with citations; anything not recorded is left blank and flagged for the clinician."
      }
    >
      <Stepper step={step} />

      {launch.status !== "none" && launch.status !== "error" && step < 4 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900" aria-live="polite">
          {launch.status === "done" && data ? (
            <>
              <CheckCircle2 className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
              <p>
                <span className="font-semibold">Imported from {sourceLabel}:</span> {importedSummary(data.bundle)}
                {clinician ? <span className="text-teal-800"> · launched by {clinician.name}</span> : null}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="h-5 w-5 rounded-full" />
              <p>{launch.status === "verifying" ? "Checking the launch link from TM3…" : "Fetching the episode from TM3 (notes, appointments, scores)…"}</p>
            </>
          )}
        </div>
      ) : null}

      {launch.status === "error" ? (
        <Notice tone="error" title="Could not open the patient from TM3">
          {launch.message}{" "}
          {tenant ? (
            TENANT_COPY.wizard.launchFailed
          ) : (
            <>
              <Link href="/pms-sandbox" className="font-medium underline">
                Open the Simulated TM3 sandbox
              </Link>{" "}
              or choose the patient below.
            </>
          )}
        </Notice>
      ) : null}

      <section aria-labelledby="step-heading" className="space-y-4">
        <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 focus:outline-none">
          {stepTitle[step]}
        </h2>

        {step === 1 ? (
          launch.status === "verifying" || launch.status === "loading" ? (
            <div className="space-y-3">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-48 rounded-2xl" />
            </div>
          ) : (
            <SourceStep onLoaded={onLoaded} />
          )
        ) : null}

        {step === 2 && data ? (
          <>
            {launch.status !== "done" ? (
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-900">Imported from {sourceLabel}:</span> {importedSummary(data.bundle)}
              </p>
            ) : null}
            <DataStep data={data} />
            <NavBar
              back={{ label: "Choose another patient", onClick: restart }}
              next={{ label: "Choose the referrer form", onClick: () => setStep(3) }}
            />
          </>
        ) : null}

        {step === 3 && data && party ? (
          <>
            <FormStep
              party={party}
              forms={forms}
              formsReady={formsReady}
              choice={choice}
              onChoice={setChoice}
              onTemplates={setTemplates}
              preferredFormId={initialFormId}
            />
            <NavBar
              back={{ label: "Back", onClick: () => setStep(2) }}
              next={{
                label: chosenTemplate ? "Draft the built-in report" : "Complete this form",
                onClick: () => void generate(),
                disabled: !canGenerate,
                icon: FileCheck2,
              }}
              hint={
                chosenForm
                  ? `${data.bundle.registration.fullName} · ${chosenForm.title} (${chosenForm.referrer.name})`
                  : chosenTemplate
                    ? `${data.bundle.registration.fullName} · built-in ${chosenTemplate.name}`
                    : "Choose a form to continue"
              }
            />
          </>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            {gen.groups.length === 0 && gen.running ? (
              <p className="text-sm text-slate-600">Filling registration details and calculated figures by code…</p>
            ) : null}
            {gen.groups.length ? <DraftProgress groups={gen.groups} expectLive={expectLive} noteCount={data?.bundle.notes.length} /> : null}
            {!gen.running && gen.reportId ? (
              gen.failedGroups && gen.groups.every((g) => g.status !== "failed" || g.code === "NO_DEMO_DRAFT") ? (
                <Notice tone="info" title={tenant ? TENANT_COPY.wizard.draftingOffTitle : "Demo mode: the remaining questions are left for the clinician"}>
                  {gen.codeFilled ? `${plural(gen.codeFilled, "answer")} filled by code from the record. ` : ""}
                  {tenant ? TENANT_COPY.wizard.draftingOffBody : WORDING.drafting.noDemoAnswersNotice}
                </Notice>
              ) : gen.failedGroups ? (
                <Notice tone="warning" title={`${plural(gen.failedGroups, "group")} of questions could not be drafted`}>
                  Those questions are left blank and marked for the clinician to complete in review.
                  {gen.groups.some((g) => g.code === "NO_DEMO_DRAFT")
                    ? tenant
                      ? TENANT_COPY.wizard.draftingOffSuffix
                      : WORDING.drafting.noDemoAnswersSuffix
                    : ""}
                </Notice>
              ) : (
                <Notice tone="success" title="Ready for clinician review">
                  {gen.codeFilled ? `${plural(gen.codeFilled, "answer")} filled by code from the record. ` : ""}Opening the form for review…
                </Notice>
              )
            ) : null}
            {gen.storageWarning ? (
              tenant ? (
                <Notice tone="warning" title={TENANT_COPY.wizard.saveFailedTitle}>
                  {TENANT_COPY.wizard.saveFailedBody}
                </Notice>
              ) : (
                <Notice tone="warning" title="This browser could not save the report">
                  Storage is full or blocked. Export or reset the demo data from the Reports page and try again.
                </Notice>
              )
            ) : null}
            {gen.error ? <Notice tone="error" title="Could not complete the form">{gen.error}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              {gen.running ? (
                <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                  Stop
                </Button>
              ) : null}
              {!gen.running && gen.reportId ? (
                <Button asChild>
                  <Link href={paths.report(gen.reportId)}>
                    Open for review
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              ) : null}
              {!gen.running ? (
                <Button variant="outline" onClick={restart}>
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  Another patient
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </StudioShell>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = s.n < step ? "done" : s.n === step ? "current" : "todo";
        return (
          <li key={s.n} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                state === "done" && "bg-teal-600 text-white",
                state === "current" && "bg-teal-50 text-teal-800 ring-2 ring-teal-600",
                state === "todo" && "bg-slate-200 text-slate-600",
              )}
            >
              {state === "done" ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : s.n}
            </span>
            <span className={cn(state === "current" ? "font-medium text-slate-900" : "text-slate-600", "hidden sm:inline")}>{s.label}</span>
            <span className="sr-only sm:hidden">{s.label}</span>
            {i < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-slate-300 sm:w-10" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function NavBar({
  back,
  next,
  hint,
}: {
  back?: { label: string; onClick(): void };
  next: { label: string; onClick(): void; disabled?: boolean; icon?: typeof ArrowRight };
  hint?: string;
}) {
  const Icon = next.icon ?? ArrowRight;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:bg-white">
      {back ? (
        <Button variant="ghost" onClick={back.onClick}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
          {back.label}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {hint ? (
          <p className="hidden max-w-md truncate text-xs text-slate-500 md:block">
            {next.disabled ? <CircleAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden /> : null}
            {hint}
          </p>
        ) : null}
        <Button onClick={next.onClick} disabled={next.disabled}>
          {next.label}
          <Icon className="ml-2 h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
