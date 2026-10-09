"use client";

/**
 * "Upload a referrer form": pick or drop a .docx / .pdf, optionally name the referrer, analyse it
 * (POST /forms/analyse) with honest progress, then show what was found and go to the mapping review.
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, CircleDashed, FileSearch, ListChecks, TriangleAlert } from "lucide-react";
import { MAX_FORM_FILE_BYTES } from "../../../config.public";
import { FORM_ANALYSIS_MODE_LABELS, FORM_KIND_LABELS, REFERRER_TYPE_LABELS } from "../../../core/labels";
import { ReferrerTypeSchema } from "../../../core/schemas";
import type { FormDefinition, ReferrerType } from "../../../core/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "../../primitives";
import { useAiMode } from "../shared/ai-mode";
import { FileDrop } from "../shared/file-drop";
import { errorMessage, formatBytes, formatMs, plural } from "../shared/format";
import { FieldLabel, Notice, Select, Spinner } from "../shared/ui-bits";
import { analyseAndStore, findFormByFile, FORM_ACCEPT, readFormFile, type AnalyseResult, type LocalFormFile } from "./analyse";
import { WORDING } from "../../wording";

type Phase =
  | { kind: "pick" }
  | { kind: "ready"; local: LocalFormFile; existing: FormDefinition | null }
  | { kind: "analysing"; local: LocalFormFile; started: number }
  | { kind: "done"; result: AnalyseResult }
  | { kind: "error"; message: string; local?: LocalFormFile };

export interface UploadFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Start with this file (e.g. a bundled sample the user chose to analyse). */
  initialFile?: { name: string; bytes: Uint8Array } | null;
  initialReferrer?: { name: string; type: ReferrerType } | null;
}

export function UploadFormDialog({ open, onOpenChange, initialFile, initialReferrer }: UploadFormDialogProps) {
  const router = useRouter();
  const { expectLive } = useAiMode();
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [referrerName, setReferrerName] = useState("");
  const [referrerType, setReferrerType] = useState<ReferrerType>("mlc");
  const [title, setTitle] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const accept = useCallback(async (file: File | { name: string; bytes: Uint8Array }) => {
    try {
      const local = await readFormFile(file);
      setPhase({ kind: "ready", local, existing: findFormByFile(local.sha256) });
    } catch (err) {
      setPhase({ kind: "error", message: errorMessage(err) });
    }
  }, []);

  // Reset each time the dialog opens (not on every render while open).
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setPhase({ kind: "pick" });
    setReferrerName(initialReferrer?.name ?? "");
    setReferrerType(initialReferrer?.type ?? "mlc");
    setTitle("");
    if (initialFile) void accept(initialFile);
  }, [open, initialFile, initialReferrer, accept]);

  // Elapsed timer while analysing.
  useEffect(() => {
    if (phase.kind !== "analysing") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - phase.started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (local: LocalFormFile) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "analysing", local, started: Date.now() });
    try {
      const result = await analyseAndStore(local, {
        referrer: referrerName.trim() ? { name: referrerName.trim(), type: referrerType } : undefined,
        title,
        signal: controller.signal,
      });
      setPhase({ kind: "done", result });
    } catch (err) {
      if (controller.signal.aborted) setPhase({ kind: "ready", local, existing: findFormByFile(local.sha256) });
      else setPhase({ kind: "error", message: errorMessage(err), local });
    } finally {
      abortRef.current = null;
    }
  };

  const close = (next: boolean) => {
    if (!next) abortRef.current?.abort();
    onOpenChange(next);
  };

  const busy = phase.kind === "analysing";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload a referrer form</DialogTitle>
          <DialogDescription>
            The MLC, insurer or case manager&apos;s own form, exactly as they sent it. It is analysed once, you check the
            mapping, and it is reused for every patient they refer.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === "pick" || phase.kind === "error" ? (
          <div className="space-y-3">
            <FileDrop
              accept={FORM_ACCEPT}
              onFile={(f) => void accept(f)}
              title="Drop the form here, or choose a file"
              hint={`Word (.docx) or PDF · up to ${formatBytes(MAX_FORM_FILE_BYTES)} · fillable PDFs work best; flat PDFs are best effort`}
            />
            {phase.kind === "error" ? (
              <Notice tone="error" title="That file could not be analysed">
                {phase.message}
              </Notice>
            ) : null}
          </div>
        ) : null}

        {phase.kind === "ready" ? (
          <div className="space-y-4">
            <FileSummary local={phase.local} />
            {phase.existing ? (
              <Notice tone="info" title="This exact file is already in your forms library">
                “{phase.existing.title}” from {phase.existing.referrer.name} was mapped from the same file.{" "}
                <Link className="font-medium underline" href={`/reports/forms/${encodeURIComponent(phase.existing.id)}`} onClick={() => close(false)}>
                  Open the existing mapping
                </Link>{" "}
                or analyse it again as a new entry.
              </Notice>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="upload-referrer" hint="(optional – proposed from the form if blank)">
                  Referrer
                </FieldLabel>
                <Input
                  id="upload-referrer"
                  value={referrerName}
                  onChange={(e) => setReferrerName(e.target.value)}
                  placeholder="e.g. Harrow & Pike Medico-Legal (fictional)"
                />
              </div>
              <div>
                <FieldLabel htmlFor="upload-referrer-type">Referrer type</FieldLabel>
                <Select id="upload-referrer-type" value={referrerType} onChange={(e) => setReferrerType(ReferrerTypeSchema.parse(e.target.value))}>
                  {ReferrerTypeSchema.options.map((t) => (
                    <option key={t} value={t}>
                      {REFERRER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="upload-title" hint="(optional)">
                  Form title
                </FieldLabel>
                <Input id="upload-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taken from the form" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {expectLive ? WORDING.formReading.introLive : WORDING.formReading.introDemo}
            </p>
          </div>
        ) : null}

        {phase.kind === "analysing" ? <AnalysingPanel local={phase.local} expectLive={expectLive} elapsed={elapsed} /> : null}

        {phase.kind === "done" ? <AnalysedPanel result={phase.result} /> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {phase.kind === "ready" ? (
            <>
              <Button variant="outline" onClick={() => setPhase({ kind: "pick" })}>
                Choose another file
              </Button>
              <Button onClick={() => void run(phase.local)}>
                <FileSearch className="mr-2 h-4 w-4" aria-hidden />
                {phase.existing ? "Analyse again" : "Analyse form"}
              </Button>
            </>
          ) : null}
          {phase.kind === "error" && phase.local ? (
            <Button onClick={() => void run(phase.local as LocalFormFile)}>Try again</Button>
          ) : null}
          {busy ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          ) : null}
          {phase.kind === "done" ? (
            <Button
              onClick={() => {
                close(false);
                router.push(`/reports/forms/${encodeURIComponent(phase.result.form.id)}`);
              }}
            >
              <ListChecks className="mr-2 h-4 w-4" aria-hidden />
              Review the mapping
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileSummary({ local }: { local: LocalFormFile }) {
  const word = local.mimeType !== "application/pdf";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <span className={word ? "rounded-lg bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800" : "rounded-lg bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800"}>
        {word ? "DOCX" : "PDF"}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{local.fileName}</p>
        <p className="text-xs text-slate-500">
          {formatBytes(local.bytes.byteLength)} · fingerprint {local.sha256.slice(0, 12)}…
        </p>
      </div>
    </div>
  );
}

function AnalysingPanel({ local, expectLive, elapsed }: { local: LocalFormFile; expectLive: boolean; elapsed: number }) {
  const steps = [
    { label: `File checked and uploaded (${formatBytes(local.bytes.byteLength)})`, done: true },
    { label: "Reading the form layout… headings, tables, answer boxes, tick boxes and fields", done: false },
    { label: expectLive ? WORDING.formReading.stepLive : WORDING.formReading.stepDemo, done: false },
  ];
  return (
    <div className="space-y-3" aria-live="polite">
      <FileSummary local={local} />
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {s.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
            ) : i === 1 ? (
              <Spinner className="mt-0.5" />
            ) : (
              <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            )}
            <span className={s.done ? "text-slate-700" : "text-slate-900"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">
        Running on the server · {elapsed}s{expectLive ? " · a long form usually takes 20–60 s" : ""}. The steps above are what
        happens; the exact timings are shown when it finishes.
      </p>
    </div>
  );
}

function AnalysedPanel({ result }: { result: AnalyseResult }) {
  const { form, outlineSummary: o, trace } = result;
  const lowFields = form.fields.filter((f) => f.confidence !== "high");
  const low = lowFields.length;
  // The questions counted as "to check" are listed with the layout notes, so the count has its items.
  const checks = [
    ...(low ? [`${low === 1 ? "Question" : "Questions"} to check in the mapping review: ${lowFields.map((f) => `“${f.label.trim().replace(/[.:;]$/, "")}”`).join(", ")}`] : []),
    ...Array.from(new Set([...o.warnings, ...form.analysis.warnings])),
  ];
  const facts = [
    FORM_KIND_LABELS[o.kind],
    o.pages !== undefined ? plural(o.pages, "page") : null,
    o.tables !== undefined ? plural(o.tables, "table") : null,
    o.fillableFields !== undefined ? plural(o.fillableFields, "fillable field") : null,
    plural(o.answerSpaces, "answer space"),
    o.headings.length ? plural(o.headings.length, "heading") : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3" aria-live="polite">
      <Notice tone="success" title={`${plural(form.fields.length, "question")} found in “${form.title}”`}>
        {form.referrer.name} · {FORM_ANALYSIS_MODE_LABELS[form.analysis.mode]}
        {WORDING.formReading.showModel && form.analysis.model ? ` · ${form.analysis.model}` : ""}
        {low ? ` · ${plural(low, "question")} to check` : ""}
      </Notice>
      <p className="text-xs text-slate-600">Layout read: {facts.join(" · ")}</p>
      {trace?.length ? (
        <ol className="space-y-1.5 rounded-xl border border-slate-200 p-3">
          {trace.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              {step.status === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
              ) : step.status === "warning" ? (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              ) : (
                <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              )}
              <span className="min-w-0 flex-1 text-slate-700">
                {step.label}
                {step.detail ? <span className="text-slate-500"> – {step.detail}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{formatMs(step.ms)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {checks.length ? (
        <Notice tone="warning" title="Things to check">
          <ul className="list-disc space-y-0.5 pl-4">
            {checks.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {!result.fileStored ? (
        <Notice tone="warning" title="File kept for this tab only">
          This browser would not store the original file, so you will need to upload it again after closing the tab.
        </Notice>
      ) : null}
      <p className="text-sm text-slate-600">Nothing is used for patients until a member of staff checks and confirms the mapping.</p>
    </div>
  );
}
