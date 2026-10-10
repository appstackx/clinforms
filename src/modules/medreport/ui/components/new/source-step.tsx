"use client";

/**
 * Step 1 of "Complete a form": where the patient's record comes from – the Simulated TM3 patient picker
 * or an uploaded TM3 export (our documented JSON / CSV format, or pasted anonymised notes). The launch
 * from TM3 itself is handled by the screen (launch token) and skips this step.
 * Tenant mode (a clinic's own Studio): the notes upload only – no Simulated TM3 picker, no sandbox link,
 * no fictional samples to try – and the signed-in member's own sign-in authorises the upload (no demo
 * session).
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, ExternalLink, FileUp, MonitorSmartphone, Search, Upload, UserRound } from "lucide-react";
import type { BundleResponse } from "../../../api/contract";
import { IMPORT_FORMAT_GUIDE } from "../../../connectors/file-import/format";
import { SAMPLE_IMPORT_FILES, SAMPLE_PRINTED_NOTES_PDF } from "../../../connectors/file-import/samples";
import { formatUkDate } from "../../../core/dates";
import { INSTRUCTING_PARTY_LABELS } from "../../../core/labels";
import type { ConnectorId, EpisodeSummary, PatientSummary } from "../../../core/types";
import { ApiError, api, saveBlob, toBase64 } from "../../api-client";
import { useHostHooks, useStudioMode } from "../../host-hooks";
import { getSession, setSession } from "../../store";
import { TENANT_COPY } from "../../studio-copy";
import { Button, Input, Skeleton, cn } from "../../primitives";
import { FileDrop } from "../shared/file-drop";
import { errorMessage } from "../shared/format";
import { FieldLabel, Notice, Spinner, Textarea } from "../shared/ui-bits";

export interface SourceResult {
  data: BundleResponse;
  sourceLabel: string;
}

/** A demo-tenant session limited to one connector (reused while valid). */
export async function ensureDemoSession(connectorId: ConnectorId, purpose: "picker" | "upload" | "batch"): Promise<void> {
  const current = getSession();
  if (current && current.claims.kind === "demo" && current.claims.connectorId === connectorId) return;
  const { session } = await api.demoSession({ purpose, connectorId });
  setSession(session);
}

type Tab = "tm3" | "upload";

export function SourceStep({ onLoaded }: { onLoaded(result: SourceResult): void }) {
  const tenant = useStudioMode() === "tenant";
  const [tab, setTab] = useState<Tab>("tm3");
  if (tenant) {
    return (
      <div className="space-y-4">
        <ExportUpload onLoaded={onLoaded} tenant />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SourceTab active={tab === "tm3"} onClick={() => setTab("tm3")} icon={UserRound} title="Simulated TM3" detail="Choose a patient and episode" />
        <SourceTab active={tab === "upload"} onClick={() => setTab("upload")} icon={FileUp} title="Upload the notes" detail="Available now – notes printed to PDF, or an export" />
        <Link
          href="/pms-sandbox"
          className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <MonitorSmartphone className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
              Launch from the patient record <ExternalLink className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            </span>
            <span className="block text-xs text-slate-600">How it works in practice: open the Simulated TM3 sandbox and click the button on a patient.</span>
          </span>
        </Link>
      </div>
      {tab === "tm3" ? <PatientPicker onLoaded={onLoaded} /> : <ExportUpload onLoaded={onLoaded} />}
    </div>
  );
}

function SourceTab({
  active,
  onClick,
  icon: Icon,
  title,
  detail,
}: {
  active: boolean;
  onClick(): void;
  icon: typeof UserRound;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
        active ? "border-teal-500 bg-teal-50/60 ring-1 ring-teal-500" : "border-slate-200 bg-white hover:border-teal-300",
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", active ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700")}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-600">{detail}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Patient picker (Simulated TM3)
 * ----------------------------------------------------------------------------------------------*/

function PatientPicker({ onLoaded }: { onLoaded(result: SourceResult): void }) {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingEpisode, setLoadingEpisode] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const req = ++reqRef.current;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          setError(null);
          await ensureDemoSession("tm3-sim", "picker");
          const res = await api.patients("tm3-sim", search.trim() || undefined, { signal: controller.signal });
          if (req === reqRef.current) setPatients(res.patients);
        } catch (err) {
          if (!controller.signal.aborted && req === reqRef.current) setError(errorMessage(err));
        }
      },
      search ? 300 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const choose = async (patient: PatientSummary, episode: EpisodeSummary) => {
    setLoadingEpisode(episode.id);
    setError(null);
    try {
      await ensureDemoSession("tm3-sim", "picker");
      const data = await api.bundle("tm3-sim", patient.id, episode.id);
      onLoaded({ data, sourceLabel: "Simulated TM3" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingEpisode(null);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <FieldLabel htmlFor="patient-search">Find a patient in Simulated TM3</FieldLabel>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            id="patient-search"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, e.g. Megan"
            autoComplete="off"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">Simulated TM3 sandbox – demo data, not affiliated with TM3.</p>
      </div>
      {error ? <Notice tone="error" title="Could not load patients">{error}</Notice> : null}
      {patients === null && !error ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : null}
      {patients && patients.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No patients match “{search}”.</p> : null}
      {patients?.length ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Patients">
          {patients.map((p) => (
            <li key={p.id} className="p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium text-slate-900">{p.displayName}</p>
                <p className="text-xs text-slate-500">
                  {p.dob ? `DOB ${formatUkDate(p.dob)}` : ""}
                  {p.ageYears !== undefined ? ` · ${p.ageYears} years` : ""}
                </p>
              </div>
              {p.registrationOnly || p.episodes.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">Registration details only – no episode of care to report on.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {p.episodes.map((ep) => (
                    <li key={ep.id}>
                      <button
                        type="button"
                        onClick={() => void choose(p, ep)}
                        disabled={loadingEpisode !== null}
                        className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:border-teal-400 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-800">{ep.title || "Episode of care"}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {[
                              ep.referralType ? INSTRUCTING_PARTY_LABELS[ep.referralType] : null,
                              ep.instructingPartyName,
                              ep.startDate ? `${formatUkDate(ep.startDate)} – ${ep.endDate ? formatUkDate(ep.endDate) : "ongoing"}` : null,
                              ep.status === "discharged" ? "Discharged" : "Open",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {loadingEpisode === ep.id ? <Spinner /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Notes upload: printed notes (PDF) or an export in our documented format
 * ----------------------------------------------------------------------------------------------*/

type ImportFormat = "json" | "csv" | "text" | "pdf";

/**
 * The import guide's examples name the demo's fictional clinician; a clinic's Studio shows a neutral
 * example instead (pinned by ui/tenant-mode.test.ts).
 */
export function tenantFormatDescription(description: string): string {
  return description
    .replace(/Sarah Reid \(PH-DEMO-\d+\)/g, "the clinician's name (HCPC number)")
    .replace(/^Paste anonymised notes\./, "Paste the notes.");
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function formatFor(fileName: string): ImportFormat | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "json") return "json";
  if (ext === "csv") return "csv";
  if (ext === "txt" || ext === "text") return "text";
  return null;
}

function ExportUpload({ onLoaded, tenant = false }: { onLoaded(result: SourceResult): void; tenant?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const [pasted, setPasted] = useState("");

  const submit = async (format: ImportFormat, content: string, fileName?: string) => {
    setBusy(true);
    setError(null);
    try {
      // The public demo authorises the upload with a demo session; a clinic's Studio with the member's sign-in.
      if (!tenant) await ensureDemoSession("file-import", "upload");
      const data = await api.fileImportBundle({ format, content, ...(fileName && { fileName }) });
      onLoaded({ data, sourceLabel: fileName ? `${format === "pdf" ? "Printed notes" : "Notes export"} (${fileName})` : "Pasted notes" });
    } catch (err) {
      const issues = err instanceof ApiError ? (err.problem.issues ?? []).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)) : [];
      setError({ message: err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : errorMessage(err), issues });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    const format = formatFor(file.name);
    if (!format) {
      setError({ message: `“${file.name}” is not a PDF, .json, .csv or .txt file.`, issues: [] });
      return;
    }
    if (file.size > 2_000_000) {
      setError({ message: `“${file.name}” is larger than 2 MB.`, issues: [] });
      return;
    }
    await submit(format, format === "pdf" ? await toBase64(file) : await file.text(), file.name);
  };

  return (
    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <div className="space-y-3">
        <FileDrop
          accept=".pdf,.json,.csv,.txt,application/pdf,application/json,text/csv,text/plain"
          onFile={(f) => void onFile(f)}
          title={busy ? "Reading the notes…" : "Drop the patient's notes here, or choose a file"}
          hint={
            tenant
              ? "The notes printed or saved as a PDF from your clinic system, or JSON / CSV in our documented format"
              : "The notes printed or saved as a PDF from your clinic system, or JSON / CSV in our documented format · fictional data only"
          }
          disabled={busy}
        />
        <div>
          <FieldLabel htmlFor="paste-notes" hint={tenant ? "(no attendance record from pasted notes)" : "(anonymised – no attendance record from pasted notes)"}>
            Or paste notes
          </FieldLabel>
          <Textarea
            id="paste-notes"
            rows={5}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={
              tenant
                ? "Date of birth: …\nInstructing party: …\n\nDD/MM/YYYY – Initial assessment – clinician's name (HCPC number)\nS: …"
                : "Date of birth: 04/05/1988\nInstructing party: …\n\n18/03/2026 – Initial assessment – Sarah Reid (PH-DEMO-01)\nS: …"
            }
          />
          <Button className="mt-2" size="sm" disabled={busy || pasted.trim().length < 20} onClick={() => void submit("text", pasted)}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden />
            Use pasted notes
          </Button>
        </div>
        {busy ? <Spinner label="Mapping the export to a patient record…" /> : null}
        {error ? (
          <Notice tone="error" title={tenant ? "The notes could not be read" : "The export could not be read"}>
            <p>{error.message}</p>
            {error.issues.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {error.issues.slice(0, 8).map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
            {tenant && error.issues.some((i) => /Add a line/.test(i)) ? <p className="mt-1">{TENANT_COPY.wizard.missingLineHint}</p> : null}
          </Notice>
        ) : null}
      </div>
      {tenant ? <TenantFormatGuide /> : <DemoFormatGuide busy={busy} submit={submit} />}
    </div>
  );
}

/**
 * A clinic's Studio (fix wave 2): the format guide folded away, no fictional sample downloads, and where to get
 * help when the clinic's own printout is not read.
 */
function TenantFormatGuide() {
  const hooks = useHostHooks();
  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
      <p className="font-medium text-slate-900">{TENANT_COPY.wizard.notesHelpTitle}</p>
      <p className="text-xs text-slate-600">
        {TENANT_COPY.wizard.notesHelp}
        {hooks.supportEmail ? (
          <>
            {" "}
            <a href={`mailto:${hooks.supportEmail}`} className="font-medium text-teal-700 underline-offset-4 hover:underline">
              {hooks.supportEmail}
            </a>
          </>
        ) : null}
      </p>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-800">{TENANT_COPY.wizard.formatGuideSummary}</summary>
        <p className="mt-2">{IMPORT_FORMAT_GUIDE.summary}</p>
        <ul className="mt-1.5 space-y-1.5">
          {IMPORT_FORMAT_GUIDE.formats.map((f) => (
            <li key={f.id}>
              <span className="font-medium text-slate-800">{f.label}:</span> {tenantFormatDescription(f.description)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function DemoFormatGuide({ busy, submit }: { busy: boolean; submit(format: ImportFormat, content: string, fileName?: string): Promise<void> }) {
  const tenant = false;
  return (
      <div className="space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-medium text-slate-900">{IMPORT_FORMAT_GUIDE.title}</p>
        <p className="text-xs text-slate-600">{IMPORT_FORMAT_GUIDE.summary}</p>
        <ul className="space-y-1.5 text-xs text-slate-600">
          {IMPORT_FORMAT_GUIDE.formats.map((f) => (
            <li key={f.id}>
              <span className="font-medium text-slate-800">{f.label}:</span> {tenant ? tenantFormatDescription(f.description) : f.description}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveBlob(new Blob([base64ToBytes(SAMPLE_PRINTED_NOTES_PDF.base64)], { type: SAMPLE_PRINTED_NOTES_PDF.mimeType }), SAMPLE_PRINTED_NOTES_PDF.fileName)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {SAMPLE_PRINTED_NOTES_PDF.label}
          </Button>
          {(Object.keys(SAMPLE_IMPORT_FILES) as Array<keyof typeof SAMPLE_IMPORT_FILES>).map((k) => {
            const s = SAMPLE_IMPORT_FILES[k];
            return (
              <Button key={k} size="sm" variant="outline" onClick={() => saveBlob(new Blob([s.content], { type: s.mimeType }), s.fileName)}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {s.label}
              </Button>
            );
          })}
        </div>
        {tenant ? null : (
          <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void submit("pdf", SAMPLE_PRINTED_NOTES_PDF.base64, SAMPLE_PRINTED_NOTES_PDF.fileName)}>
            Try the printed notes PDF (Priya Nair, fictional)
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void submit("json", SAMPLE_IMPORT_FILES.json.content, SAMPLE_IMPORT_FILES.json.fileName)}>
            Try the sample export (JSON)
          </Button>
        </div>
        )}
        {tenant ? null : <p className="text-xs text-slate-500">{IMPORT_FORMAT_GUIDE.privacy}</p>}
      </div>
  );
}
