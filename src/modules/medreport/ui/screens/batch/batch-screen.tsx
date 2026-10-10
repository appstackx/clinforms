"use client";

/**
 * Batch (/reports/batch): queue several patient + referrer-form pairs and complete them in the
 * background, at most BATCH_CONCURRENCY /drafts calls at once. Each item fetches the episode, creates
 * the form report (code-filled answers), drafts the remaining questions and is saved to this browser,
 * ready for clinician review. Nothing is approved or issued automatically.
 * Batch reads episodes from a connected clinic system (the Simulated TM3 in the demo). A clinic's own
 * Studio (tenant mode) has no connected system yet, so it explains that instead.
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, CircleDashed, ListPlus, Play, Plus, Square, Trash2, XCircle } from "lucide-react";
import { BATCH_CONCURRENCY } from "../../../config.public";
import { formatUkDate } from "../../../core/dates";
import type { EpisodeSummary, FormDefinition, PatientSummary } from "../../../core/types";
import { api, passcodeVerifier } from "../../api-client";
import { useStudioMode } from "../../host-hooks";
import { useStudioPaths } from "../../routes";
import { saveReport, useForms } from "../../store";
import { TENANT_COPY } from "../../studio-copy";
import { Button, Skeleton, cn } from "../../primitives";
import { generateReport } from "../../components/new/generate";
import { getRememberedFormId, matchReferrerForm } from "../../components/new/referrer-match";
import { ensureDemoSession } from "../../components/new/source-step";
import { runPool } from "../../components/shared/pool";
import { errorMessage, plural } from "../../components/shared/format";
import { StudioShell } from "../../components/shared/studio-shell";
import { EmptyState, Notice, Select, Spinner } from "../../components/shared/ui-bits";

type ItemStatus =
  | { kind: "queued" }
  | { kind: "fetching" }
  | { kind: "drafting"; done: number; total: number }
  | { kind: "done"; reportId: string; openGaps: number; failedGroups: number }
  | { kind: "failed"; message: string }
  | { kind: "stopped" };

interface QueueItem {
  key: string;
  patient: PatientSummary;
  episode: EpisodeSummary;
  formId: string;
  status: ItemStatus;
}

interface Row {
  patient: PatientSummary;
  episode: EpisodeSummary;
}

export function BatchScreen() {
  return useStudioMode() === "tenant" ? <BatchNotConnected /> : <SimulatedBatchScreen />;
}

/** Tenant mode: no connected clinic system to read episodes from. */
function BatchNotConnected() {
  const paths = useStudioPaths();
  return (
    <StudioShell title={TENANT_COPY.batch.title}>
      <EmptyState
        icon={ListPlus}
        title={TENANT_COPY.batch.unavailableTitle}
        actions={
          <Button asChild>
            <Link href={paths.newReport}>Complete a form</Link>
          </Button>
        }
      >
        {TENANT_COPY.batch.unavailableBody}
      </EmptyState>
    </StudioShell>
  );
}

function SimulatedBatchScreen() {
  const paths = useStudioPaths();
  const { forms, ready: formsReady } = useForms();
  const confirmed = useMemo(() => forms.filter((f) => f.status === "confirmed"), [forms]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await ensureDemoSession("tm3-sim", "batch");
        const res = await api.patients("tm3-sim");
        if (!live) return;
        setRows(res.patients.flatMap((patient) => (patient.registrationOnly ? [] : patient.episodes.map((episode) => ({ patient, episode })))));
      } catch (err) {
        if (live) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, []);

  const rowKey = (r: Row) => `${r.patient.id}/${r.episode.id}`;
  const defaultForm = (r: Row): FormDefinition | null => {
    const name = r.episode.instructingPartyName ?? "";
    return name ? (matchReferrerForm({ name }, confirmed, getRememberedFormId(name))?.form ?? null) : null;
  };
  const formFor = (r: Row) => choices[rowKey(r)] ?? defaultForm(r)?.id ?? "";

  const add = (r: Row) => {
    const formId = formFor(r);
    if (!formId) return;
    setQueue((q) =>
      q.some((i) => i.key === `${rowKey(r)}#${formId}` && (i.status.kind === "queued" || i.status.kind === "fetching" || i.status.kind === "drafting"))
        ? q
        : [...q, { key: `${rowKey(r)}#${formId}`, patient: r.patient, episode: r.episode, formId, status: { kind: "queued" } }],
    );
  };
  const addAll = () => rows?.forEach((r) => add(r));

  const setStatus = (key: string, status: ItemStatus) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, status } : i)));

  const run = async () => {
    const pending = queue.filter((i) => i.status.kind === "queued" || i.status.kind === "stopped" || i.status.kind === "failed");
    if (!pending.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    pending.forEach((i) => setStatus(i.key, { kind: "queued" }));
    await runPool(
      pending,
      BATCH_CONCURRENCY,
      async (item) => {
        const form = forms.find((f) => f.id === item.formId);
        if (!form || form.status !== "confirmed") {
          setStatus(item.key, { kind: "failed", message: "This form is no longer confirmed in the library." });
          return;
        }
        try {
          setStatus(item.key, { kind: "fetching" });
          await ensureDemoSession("tm3-sim", "batch");
          const data = await api.bundle("tm3-sim", item.patient.id, item.episode.id, { signal: controller.signal });
          const result = await generateReport({
            client: api,
            data,
            target: { kind: "form", form },
            // Only a passcode the server accepted on this page load (ui/passcode-check.ts).
            livePossible: Boolean(passcodeVerifier.verifiedPasscode()),
            concurrency: 1,
            signal: controller.signal,
            actor: "Batch",
            onReport: (report) => void saveReport(report),
            onProgress: (groups) =>
              setStatus(item.key, {
                kind: "drafting",
                done: groups.filter((g) => g.status === "done" || g.status === "failed").length,
                total: groups.length,
              }),
          });
          setStatus(item.key, {
            kind: "done",
            reportId: result.report.id,
            openGaps: result.report.gaps.filter((g) => !g.resolution).length,
            failedGroups: result.failedGroups,
          });
        } catch (err) {
          setStatus(item.key, controller.signal.aborted ? { kind: "stopped" } : { kind: "failed", message: errorMessage(err) });
        }
      },
      controller.signal,
    );
    setQueue((q) => q.map((i) => (i.status.kind === "queued" && controller.signal.aborted ? { ...i, status: { kind: "stopped" } } : i)));
    setRunning(false);
    abortRef.current = null;
  };

  const done = queue.filter((i) => i.status.kind === "done").length;
  const pendingCount = queue.filter((i) => i.status.kind === "queued" || i.status.kind === "stopped" || i.status.kind === "failed").length;

  return (
    <StudioShell
      title="Batch"
      description={`Queue several patients and referrer forms. Forms are completed ${BATCH_CONCURRENCY === 2 ? "two" : BATCH_CONCURRENCY} at a time; each completed form waits for clinician review and approval – nothing is issued automatically.`}
    >
      <section aria-labelledby="episodes-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="episodes-heading" className="text-lg font-semibold text-slate-900">
              Episodes in Simulated TM3
            </h2>
            <p className="text-xs text-slate-500">
              Simulated TM3 sandbox – demo data, not affiliated with TM3. Choose a form for any episode whose referrer has no
              form linked yet; it is skipped by “Queue all”.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addAll} disabled={!rows?.length || running}>
            <ListPlus className="mr-1.5 h-4 w-4" aria-hidden />
            Queue all with their referrer&apos;s form
          </Button>
        </div>
        {loadError ? <Notice tone="error" title="Could not load patients">{loadError}</Notice> : null}
        {!rows || !formsReady ? (
          loadError ? null : <Skeleton className="h-40 rounded-2xl" />
        ) : rows.length === 0 ? (
          <EmptyState icon={ListPlus} title="No episodes to report on" />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {rows.map((r) => {
              const key = rowKey(r);
              const selected = formFor(r);
              return (
                <li key={key} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{r.patient.displayName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[
                        r.episode.title,
                        r.episode.instructingPartyName,
                        r.episode.startDate ? `from ${formatUkDate(r.episode.startDate)}` : null,
                        r.episode.status === "discharged" ? "Discharged" : "Open",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 md:w-[440px]">
                    <label htmlFor={`form-${key}`} className="sr-only">
                      Referrer form for {r.patient.displayName}
                    </label>
                    <Select id={`form-${key}`} value={selected} onChange={(e) => setChoices((c) => ({ ...c, [key]: e.target.value }))} className="min-w-0 flex-1">
                      <option value="">Choose a referrer form…</option>
                      {confirmed.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.title} – {f.referrer.name}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => add(r)} disabled={!selected || running} aria-label={`Add ${r.patient.displayName} to the queue`}>
                      <Plus className="h-4 w-4" aria-hidden />
                      <span className="ml-1 hidden sm:inline">Queue</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {formsReady && confirmed.length === 0 ? (
          <Notice tone="info">
            No confirmed referrer forms yet –{" "}
            <Link href={paths.forms} className="font-medium underline">
              confirm a mapping
            </Link>{" "}
            first.
          </Notice>
        ) : null}
      </section>

      <section aria-labelledby="queue-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="queue-heading" className="text-lg font-semibold text-slate-900">
              Queue
            </h2>
            <p className="text-xs text-slate-500" aria-live="polite">
              {queue.length ? `${done} of ${plural(queue.length, "form")} completed` : "Nothing queued yet."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
                <Square className="mr-1.5 h-4 w-4" aria-hidden />
                Stop
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" disabled={!queue.length} onClick={() => setQueue((q) => q.filter((i) => i.status.kind !== "done"))}>
                  Clear completed
                </Button>
                <Button size="sm" onClick={() => void run()} disabled={!pendingCount}>
                  <Play className="mr-1.5 h-4 w-4" aria-hidden />
                  Run {pendingCount ? plural(pendingCount, "form") : "queue"}
                </Button>
              </>
            )}
          </div>
        </div>
        {queue.length ? (
          <ul className="space-y-2">
            {queue.map((item) => {
              const form = forms.find((f) => f.id === item.formId);
              return (
                <li key={item.key} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{item.patient.displayName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {form ? `${form.title} – ${form.referrer.name}` : "Form removed from the library"}
                    </p>
                  </div>
                  <StatusCell status={item.status} />
                  <div className="flex items-center gap-1">
                    {item.status.kind === "done" ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={paths.report(item.status.reportId)}>
                          Review
                          <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                        </Link>
                      </Button>
                    ) : null}
                    {!running && item.status.kind !== "done" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setQueue((q) => q.filter((i) => i.key !== item.key))}
                        aria-label={`Remove ${item.patient.displayName} from the queue`}
                        className="text-slate-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </StudioShell>
  );
}

function StatusCell({ status }: { status: ItemStatus }) {
  const base = "inline-flex items-center gap-1.5 text-xs sm:w-56";
  switch (status.kind) {
    case "queued":
      return (
        <span className={cn(base, "text-slate-500")}>
          <CircleDashed className="h-4 w-4" aria-hidden /> Queued
        </span>
      );
    case "fetching":
      return (
        <span className={cn(base, "text-slate-700")}>
          <Spinner /> Fetching the record
        </span>
      );
    case "drafting":
      return (
        <span className={cn(base, "text-slate-700")}>
          <Spinner /> Drafting {status.total ? `${status.done} of ${status.total} groups` : "…"}
        </span>
      );
    case "done":
      return status.openGaps || status.failedGroups ? (
        <span className={cn(base, "text-amber-800")}>
          <CheckCircle2 className="h-4 w-4 text-amber-600" aria-hidden />
          Needs input ({status.openGaps + status.failedGroups})
        </span>
      ) : (
        <span className={cn(base, "text-emerald-800")}>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          Ready for review
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "text-red-700")} title={status.message}>
          <XCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="line-clamp-2">Failed: {status.message}</span>
        </span>
      );
    case "stopped":
      return <span className={cn(base, "text-slate-500")}>Stopped</span>;
  }
}
