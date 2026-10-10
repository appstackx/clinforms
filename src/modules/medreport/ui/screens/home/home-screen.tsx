"use client";

/**
 * Studio home (/reports): what the product does, the clinic-system connections, the referrer forms
 * library at a glance, and every report in this browser (patient, referrer form, status, flags,
 * last updated) with export, import and "Reset demo".
 * Tenant mode (a clinic's own Studio, /app/studio): a work queue (fix wave 2) – the clinic's forms first, in
 * progress / approved / all with a search, who approved and which version; a first-run list (referrer form,
 * then the notes) while there are none; no hero, demo tools, Simulated TM3 tiles or hints.
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileInput,
  FileStack,
  FileUp,
  Files,
  Lock,
  MonitorSmartphone,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wrench,
} from "lucide-react";
import type { ConnectorInfo, Report } from "../../../core/types";
import { formatUkDateTime } from "../../../core/dates";
import { prefillSigners, prefillSignersText } from "../../../core/parties";
import { api, saveBlob } from "../../api-client";
import { useHostHooks, useStudioMode } from "../../host-hooks";
import { useStudioPaths } from "../../routes";
import { TENANT_COPY } from "../../studio-copy";
import {
  caseExportFileName,
  deleteReport,
  ensureSampleForms,
  exportCase,
  importCase,
  resetDemo,
  saveReportDurable,
  useForms,
  useReports,
} from "../../store";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  cn,
} from "../../primitives";
import { plural } from "../../components/shared/format";
import { WORDING } from "../../wording";
import { StudioShell } from "../../components/shared/studio-shell";
import { EmptyState, FormKindBadge, Notice, ReportStatusBadge } from "../../components/shared/ui-bits";
import { QUEUE_FILTERS, defaultQueueFilter, filterQueue, queueCounts, type QueueFilter } from "./work-queue";

export function HomeScreen() {
  const { reports, ready } = useReports();
  const { forms, ready: formsReady } = useForms();
  const hooks = useHostHooks();
  const paths = useStudioPaths();
  const tenant = useStudioMode() === "tenant";
  const [resetOpen, setResetOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const confirmedForms = forms.filter((f) => f.status === "confirmed").length;
  // Forms the clinic only prefills for others to sign (a patient's claim form): approved, never "signed".
  const prefillFor = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of forms) {
      const signers = prefillSigners(f);
      if (signers) out.set(f.id, prefillSignersText(signers));
    }
    return out;
  }, [forms]);
  const referrers = new Set(forms.map((f) => f.referrer.name)).size;

  if (tenant) {
    return (
      <StudioShell>
        <TenantHome reports={reports} ready={ready} confirmedForms={confirmedForms} formsReady={formsReady} prefillFor={prefillFor} />
      </StudioShell>
    );
  }

  const onImport = async (file: File) => {
    const result = importCase(await file.text());
    if (!result.ok) {
      setImportMsg({ tone: "error", text: result.error });
      return;
    }
    // Stored before it is reported as imported (a clinic's Studio: on the server).
    if (await saveReportDurable(result.report)) setImportMsg({ tone: "success", text: `Imported the case for ${result.report.patientLabel}.` });
    else setImportMsg({ tone: "error", text: "The case could not be stored. Please try again." });
  };

  return (
    <StudioShell>
      <div className="space-y-8">
        <Hero />

        <ConnectorTiles formsReady={formsReady} formCount={forms.length} confirmedForms={confirmedForms} referrers={referrers} />

        <section aria-labelledby="reports-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="reports-heading" className="text-lg font-semibold text-slate-900">
                Completed and in-progress forms
              </h2>
              <p className="text-sm text-slate-600">
                Fictional data only. This demo keeps reports in your browser –{" "}
                <Link href={paths.security} className="font-medium text-teal-800 underline underline-offset-2 hover:no-underline">
                  how real patient data is protected
                </Link>
                .
              </p>
            </div>
              <details className="group relative" data-demo-tools="">
                <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden">
                  <Wrench className="h-4 w-4 text-slate-500" aria-hidden />
                  Demo tools
                  <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-56 space-y-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={(e) => {
                      (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                      importRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    <FileInput className="h-4 w-4 text-slate-500" aria-hidden />
                    Import case JSON
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                      setResetOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    <RotateCcw className="h-4 w-4 text-slate-500" aria-hidden />
                    Reset demo
                  </button>
                </div>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void onImport(f);
                  }}
                />
              </details>
          </div>
          {importMsg ? <Notice tone={importMsg.tone}>{importMsg.text}</Notice> : null}
          {!ready ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : reports.length === 0 ? (
            <EmptyState
              icon={FileStack}
              title="No forms completed yet"
              actions={
                <>
                  <Button asChild>
                    <Link href="/pms-sandbox">
                      <MonitorSmartphone className="mr-2 h-4 w-4" aria-hidden />
                      Launch from Simulated TM3
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={paths.newReport}>Complete a form</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={paths.forms}>Referrer forms</Link>
                  </Button>
                </>
              }
            >
              Open a patient in the Simulated TM3 sandbox and click the report button – or start here and choose the patient.
            </EmptyState>
          ) : (
            <ReportsTable reports={reports} prefillFor={prefillFor} />
          )}
        </section>
      </div>

      {/* Demo tools (a clinic's Studio is TenantHome above: no "Reset demo"). */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset the demo?</DialogTitle>
            <DialogDescription>
              Removes every report, form mapping and uploaded form from this browser, and the documents saved to the simulated
              TM3 record. The sample referrer forms come back with their confirmed mappings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                resetDemo();
                void ensureSampleForms();
                try {
                  await hooks.onResetDemo?.();
                } catch {
                  // the host's own state; ignore
                }
                setResetOpen(false);
                setImportMsg({ tone: "success", text: "Demo reset." });
              }}
            >
              Reset demo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StudioShell>
  );
}

/**
 * A clinic's Studio home (fix wave 2): the work queue. Exported for the render tests.
 */
export function TenantHome({
  reports,
  ready,
  confirmedForms,
  formsReady,
  prefillFor,
}: {
  reports: Report[];
  ready: boolean;
  confirmedForms: number;
  formsReady: boolean;
  prefillFor: ReadonlyMap<string, string>;
}) {
  const hooks = useHostHooks();
  const paths = useStudioPaths();
  const counts = queueCounts(reports);
  const [chosen, setChosen] = useState<QueueFilter | null>(null);
  const [query, setQuery] = useState("");
  const filter = chosen ?? defaultQueueFilter(counts);
  const shown = filterQueue(reports, filter, query);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">{hooks.clinic?.name ?? TENANT_COPY.home.eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Completed and in-progress forms</h1>
          <p className="mt-1 text-sm text-slate-600">
            {TENANT_COPY.home.reportsIntro}{" "}
            <Link href={paths.security} className="font-medium text-teal-800 underline underline-offset-2 hover:no-underline">
              {TENANT_COPY.home.securityLink}
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild>
            <Link href={paths.newReport}>
              <FileUp className="mr-2 h-4 w-4" aria-hidden />
              Complete a form
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={paths.forms}>
              <Files className="mr-2 h-4 w-4" aria-hidden />
              Referrer forms{formsReady ? ` · ${confirmedForms} confirmed` : ""}
            </Link>
          </Button>
        </div>
      </header>

      {hooks.clinic?.draftingEnabled === false ? <Notice tone="info">{TENANT_COPY.home.draftingOff}</Notice> : null}

      {!ready ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : reports.length === 0 ? (
        <FirstRun confirmedForms={confirmedForms} formsReady={formsReady} />
      ) : (
        <section aria-labelledby="queue-heading" className="space-y-3">
          <h2 id="queue-heading" className="sr-only">
            {TENANT_COPY.home.queueHeading}
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label={TENANT_COPY.home.filterLabel} className="inline-flex w-full rounded-xl border border-slate-200 bg-white p-1 sm:w-auto">
              {QUEUE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setChosen(f.id)}
                  className={cn(
                    "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:flex-none",
                    filter === f.id ? "bg-teal-50 text-teal-900" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {f.label} <span className="tabular-nums text-slate-500">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={TENANT_COPY.home.searchLabel}
              placeholder={TENANT_COPY.home.searchPlaceholder}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:w-72"
            />
          </div>
          {shown.length ? (
            <ReportsTable reports={shown} prefillFor={prefillFor} />
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
              {query.trim() ? TENANT_COPY.home.noMatch : filter === "open" ? TENANT_COPY.home.noneOpen : TENANT_COPY.home.noneApproved}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** A new clinic's first steps in the Studio: a confirmed referrer form, then a patient's notes. */
function FirstRun({ confirmedForms, formsReady }: { confirmedForms: number; formsReady: boolean }) {
  const paths = useStudioPaths();
  const formDone = formsReady && confirmedForms > 0;
  const steps = [
    { done: formDone, href: paths.forms, title: TENANT_COPY.home.firstFormTitle, text: TENANT_COPY.home.firstFormText, action: "Referrer forms" },
    { done: false, href: paths.newReport, title: TENANT_COPY.home.firstReportTitle, text: TENANT_COPY.home.firstReportText, action: "Complete a form" },
  ];
  return (
    <section aria-labelledby="first-run-heading" className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 id="first-run-heading" className="text-base font-semibold text-slate-900">
        {TENANT_COPY.home.firstRunTitle}
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => {
          const next = !step.done && steps.slice(0, i).every((s) => s.done);
          return (
            <li key={step.title} className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done ? "bg-teal-600 text-white" : next ? "bg-teal-50 text-teal-800 ring-1 ring-teal-300" : "bg-slate-100 text-slate-500",
                )}
              >
                {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {step.title}
                  <span className="sr-only">{step.done ? " – done" : " – to do"}</span>
                </p>
                <p className="text-sm text-slate-600">{step.text}</p>
                {next ? (
                  <Button asChild size="sm" className="mt-2">
                    <Link href={step.href}>{step.action}</Link>
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The public demo's hero (a clinic's Studio leads with its work queue instead). */
function Hero() {
  const paths = useStudioPaths();
  const steps = [
    { icon: Files, title: "Their form, once", text: "Upload each insurer or medico-legal form; staff confirm where every answer comes from." },
    { icon: MonitorSmartphone, title: "From the patient's record", text: "Registration details and notes from your clinic system, or an upload of the notes." },
    { icon: Stethoscope, title: "Clinician reviews", text: "Every answer cites its note; gaps and unrecorded opinions are left for you." },
    { icon: ClipboardCheck, title: "Approve and file", text: "The referrer's own Word or PDF, completed and saved back to the record." },
  ];
  return (
    <section className="overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-white via-white to-teal-50 p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">For physiotherapy clinics</p>
      <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Complete insurer &amp; medico-legal report forms from your clinic notes
      </h1>
      <p className="mt-3 max-w-2xl text-base text-slate-600">
        Each referrer&apos;s own form, in its original layout – filled from the patient&apos;s registration details and
        physiotherapy notes, with every answer traceable to its source, and approved by the treating clinician before it is issued.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild size="lg">
          <Link href={paths.newReport}>
            Complete a form
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={paths.forms}>Referrer forms library</Link>
        </Button>
      </div>
      <ol className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
              <s.icon className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </p>
              <p className="text-xs leading-relaxed text-slate-600">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const TILE_FALLBACK: Record<ConnectorInfo["id"], { title: string; status: string; note: string }> = {
  "tm3-sim": { title: "Simulated TM3", status: "Connected", note: "Simulated TM3 sandbox – demo data, not affiliated with TM3." },
  "file-import": { title: "Notes upload", status: "Available now", note: "Upload the patient's notes printed or saved as a PDF from your clinic system, or an export (JSON / CSV)." },
  tm3: { title: "Direct TM3 connection", status: "Subject to TM3", note: "A direct connection, subject to TM3 providing access." },
};

function ConnectorTiles({
  formsReady,
  formCount,
  confirmedForms,
  referrers,
}: {
  formsReady: boolean;
  formCount: number;
  confirmedForms: number;
  referrers: number;
}) {
  const paths = useStudioPaths();
  const [connectors, setConnectors] = useState<ConnectorInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    api.connectors().then(
      (res) => live && setConnectors(res.connectors),
      () => live && setConnectors([]),
    );
    return () => {
      live = false;
    };
  }, []);

  const byId = (id: ConnectorInfo["id"]) => connectors?.find((c) => c.id === id);
  // The public demo only: a clinic's Studio shows no connection tiles (its home is the work queue).
  const order: ConnectorInfo["id"][] = ["tm3-sim", "file-import", "tm3"];
  const icons = { "tm3-sim": PlugZap, "file-import": FileUp, tm3: Lock } as const;
  const hrefs = { "tm3-sim": "/pms-sandbox", "file-import": paths.newReport, tm3: null } as const;

  return (
    <section aria-labelledby="connections-heading" className="space-y-3">
      <h2 id="connections-heading" className="text-lg font-semibold text-slate-900">
        Connections and forms
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {order.map((id) => {
          const info = byId(id);
          const fb = TILE_FALLBACK[id];
          const connected = id === "tm3-sim" ? (info ? info.status === "connected" : true) : false;
          const available = id === "file-import";
          const Icon = icons[id];
          const href = hrefs[id];
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl",
                    connected ? "bg-teal-600 text-white" : available ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    connected ? "bg-emerald-50 text-emerald-800" : available ? "bg-sky-50 text-sky-800" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {connected ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                      Connected
                    </span>
                  ) : (
                    fb.status
                  )}
                </span>
              </div>
              <p className="mt-3 font-semibold text-slate-900">
                {id === "tm3-sim" ? "Simulated TM3 connected" : id === "file-import" ? "Notes upload – available now" : "Direct TM3 connection – subject to TM3 providing access"}
              </p>
              <p className="mt-1 text-xs text-slate-600">{fb.note}</p>
            </>
          );
          return href ? (
            <Link
              key={id}
              href={href}
              className="rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              {body}
            </Link>
          ) : (
            <div key={id} className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
              {body}
            </div>
          );
        })}
        <Link
          href={paths.forms}
          className="rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-800">
              <Files className="h-4 w-4" aria-hidden />
            </span>
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800">Library</span>
          </div>
          <p className="mt-3 font-semibold text-slate-900">
            {formsReady ? `${plural(formCount, "referrer form")}` : "Referrer forms"}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {formsReady ? `${confirmedForms} confirmed · ${plural(referrers, "referrer")} · each in its own layout` : "Loading the library…"}
          </p>
        </Link>
        <Link
          href={paths.security}
          className="rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800">UK GDPR</span>
          </div>
          <p className="mt-3 font-semibold text-slate-900">Security &amp; data protection</p>
          <p className="mt-1 text-xs text-slate-600">{WORDING.home.securityCardBlurb}</p>
        </Link>
      </div>
    </section>
  );
}

function flagSummary(report: Report): { blocking: number; warnings: number; gaps: number } {
  const open = report.flags.filter((f) => !f.acknowledged);
  return {
    blocking: open.filter((f) => f.severity === "blocking").length,
    warnings: open.filter((f) => f.severity === "warning").length,
    gaps: report.gaps.filter((g) => !g.resolution).length,
  };
}

function ReportsTable({ reports, prefillFor }: { reports: Report[]; prefillFor: ReadonlyMap<string, string> }) {
  const paths = useStudioPaths();
  const tenant = useStudioMode() === "tenant";
  const [confirmDelete, setConfirmDelete] = useState<Report | null>(null);
  const download = (r: Report) => {
    const blob = exportCase(r.id);
    if (blob) saveBlob(blob, caseExportFileName(r));
  };
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Patient</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Referrer form</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{tenant ? "Next step" : "Flags"}</th>
              {tenant ? <th scope="col" className="px-4 py-2.5 font-medium">Approved by</th> : null}
              <th scope="col" className="px-4 py-2.5 font-medium">Updated</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reports.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <Link href={paths.report(r.id)} className="font-medium text-slate-900 hover:text-teal-800 hover:underline">
                    {r.patientLabel}
                  </Link>
                  <p className="text-xs text-slate-500">{r.bundleSnapshot.source.simulated ? "Simulated TM3" : r.bundleSnapshot.source.label ?? r.episodeRef.connectorId}</p>
                </td>
                <td className="px-4 py-3">
                  <FormCell report={r} />
                </td>
                <td className="px-4 py-3">
                  <StatusCell report={r} />
                </td>
                <td className="px-4 py-3">
                  <FlagCell report={r} prefillFor={r.form ? (prefillFor.get(r.form.formId) ?? null) : null} />
                </td>
                {tenant ? <td className="px-4 py-3 text-xs text-slate-700">{r.receipt?.signer.name ?? "–"}</td> : null}
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatUkDateTime(r.updatedAt)}</td>
                <td className="px-4 py-3">
                  <RowActions report={r} onExport={() => download(r)} onDelete={() => setConfirmDelete(r)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {reports.map((r) => (
          <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <Link href={paths.report(r.id)} className="font-medium text-slate-900 hover:underline">
                {r.patientLabel}
              </Link>
              <StatusCell report={r} />
            </div>
            <div className="mt-2">
              <FormCell report={r} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <FlagCell report={r} prefillFor={r.form ? (prefillFor.get(r.form.formId) ?? null) : null} />
              <span className="text-xs text-slate-500">
                {tenant && r.receipt ? `${r.receipt.signer.name} · ` : ""}
                {formatUkDateTime(r.updatedAt)}
              </span>
            </div>
            <div className="mt-2 border-t border-slate-100 pt-2">
              <RowActions report={r} onExport={() => download(r)} onDelete={() => setConfirmDelete(r)} />
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this report?</DialogTitle>
            <DialogDescription>
              {confirmDelete
                ? `The ${confirmDelete.form?.title ?? "report"} for ${confirmDelete.patientLabel} will be removed${tenant ? " from your clinic's records" : " from this browser"}.`
                : ""}{" "}
              {tenant ? TENANT_COPY.home.deleteNote : "Export the case JSON first if you want to keep it."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete) deleteReport(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormCell({ report }: { report: Report }) {
  if (report.form) {
    return (
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-slate-900">
          <span className="truncate">{report.form.title}</span>
          <FormKindBadge kind={report.form.kind} />
        </p>
        <p className="truncate text-xs text-slate-500">{report.form.referrer.name}</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-slate-900">Built-in report</p>
      <p className="truncate text-xs text-slate-500">
        {report.instructingParty.name} · {report.templateId}
      </p>
    </div>
  );
}

/** Status, and which version an amended form is (an amended v2 must not look like the original). */
function StatusCell({ report }: { report: Report }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <ReportStatusBadge status={report.status} />
      {report.version && report.version > 1 ? (
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900 ring-1 ring-violet-200">Amended – v{report.version}</span>
      ) : null}
    </span>
  );
}

function FlagCell({ report, prefillFor }: { report: Report; prefillFor: string | null }) {
  const tenant = useStudioMode() === "tenant";
  const { blocking, warnings, gaps } = flagSummary(report);
  if (report.status === "signed" && prefillFor) return <span className="text-xs text-emerald-700">Prefill checked – for {prefillFor} to complete and sign</span>;
  if (report.status === "signed") return <span className="text-xs text-emerald-700">{tenant ? TENANT_COPY.review.listApproved : "Approved – signed receipt"}</span>;
  if (!blocking && !warnings && !gaps) return <span className="text-xs text-slate-500">{tenant ? TENANT_COPY.home.readyForApproval : "None open"}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {gaps ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{plural(gaps, "gap")}</span> : null}
      {blocking ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{blocking} blocking</span> : null}
      {warnings ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">{plural(warnings, "warning")}</span> : null}
    </div>
  );
}

function RowActions({ report, onExport, onDelete }: { report: Report; onExport(): void; onDelete(): void }) {
  const paths = useStudioPaths();
  const hooks = useHostHooks();
  const tenant = hooks.mode === "tenant";
  // A clinic's Studio (fix wave 2): no case download from the browser (a patient's whole record, unrecorded);
  // an approved report is deleted only by the clinic's owner or an administrator (the server enforces it too).
  const role = hooks.member?.role;
  const canDelete = !tenant || report.status !== "signed" || role === "owner" || role === "admin";
  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild size="sm" variant="ghost">
        <Link href={paths.report(report.id)}>{report.status === "signed" ? "Open" : "Review"}</Link>
      </Button>
      {tenant ? null : (
        <Button size="sm" variant="ghost" onClick={onExport} title="Export case JSON" aria-label={`Export case JSON for ${report.patientLabel}`}>
          <Download className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canDelete ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          title="Delete"
          aria-label={`Delete the report for ${report.patientLabel}`}
          className="text-slate-500 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
