"use client";

/**
 * Preview tab: the referrer's form filled with the current answers, in its ORIGINAL layout
 * (POST /forms/fill-preview → docx-preview for Word, pdfjs canvas for PDF), refreshed a moment after
 * each edit and marked DRAFT until a clinician approves it. After approval it shows the final
 * completed form (POST /render with the receipt). Built-in template reports preview the draft PDF.
 *
 * Owner: studio-b agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertTriangle, Expand, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { CONTENT_TYPES } from "../../../api/contract";
import { NOTICES } from "../../../config.public";
import { formatUkDateTime } from "../../../core/dates";
import { buildFormAnswers } from "../../../core/forms";
import type { FormDefinition, Report } from "../../../core/types";
import { ApiError, api, type FileDownload } from "../../api-client";
import { DOCX_PREVIEW_OPTIONS, loadPdfjsBrowser, renderDocxPreview } from "../../preview-libs";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn } from "../../primitives";
import { DemoNoticeBar } from "../shared/demo-notice";
import { InlineAlert } from "./review-ui";

export type FormFileState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; base64: string; fileName: string; mimeType: string };

const REFRESH_DELAY_MS = 1200;

const DOCX_STYLES = `
.medreport-docx-host .docx-wrapper { background: #e2e8f0; padding: 16px 16px 0; }
.medreport-docx-host .docx-wrapper > section.docx { box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18); margin-bottom: 16px; }
.medreport-docx-host a { pointer-events: none; cursor: default; }
`;

/* Renderers ------------------------------------------------------------------------------------- */

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (w: number) => setWidth((prev) => (Math.abs(prev - w) >= 8 ? Math.floor(w) : prev));
    update(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function DocxView({ blob, width, label, onError }: { blob: Blob; width: number; label: string; onError(message: string): void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const host = document.createElement("div");
      host.className = "medreport-docx-host";
      // Rendered detached and made inert (no live links from the referrer's file) before it is shown.
      await renderDocxPreview(blob, host, DOCX_PREVIEW_OPTIONS);
      const stage = stageRef.current;
      if (cancelled || !stage) return;
      stage.replaceChildren(host);
      setNatural({ w: Math.max(stage.scrollWidth, 1), h: Math.max(stage.scrollHeight, 1) });
    })().catch(() => {
      if (!cancelled) onError("The Word preview could not be drawn in this browser. Download the draft to view it.");
    });
    return () => {
      cancelled = true;
    };
  }, [blob, onError]);

  const scale = natural && width ? Math.min(1, width / natural.w) : 1;
  const height = natural ? Math.ceil(natural.h * scale) : Math.round((width || 400) * 1.414);
  return (
    <div role="region" aria-label={label} className="relative overflow-hidden rounded-lg bg-slate-200" style={{ height }}>
      <style>{DOCX_STYLES}</style>
      <div
        ref={stageRef}
        className="absolute left-0 top-0"
        style={{ width: "max-content", transform: `scale(${scale})`, transformOrigin: "top left" }}
      />
      {!natural && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Drawing the form…
        </div>
      )}
    </div>
  );
}

function PdfView({ blob, width, label, onError }: { blob: Blob; width: number; label: string; onError(message: string): void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    let retryCleanup: (() => void) | null = null;
    const draw = async () => {
      const pdfjs = await loadPdfjsBrowser();
      const data = new Uint8Array(await blob.arrayBuffer());
      const task = pdfjs.getDocument({ data });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      const cssWidth = Math.max(160, width - 24);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvases: HTMLCanvasElement[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = cssWidth / base.width;
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssWidth)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        canvas.className = "mx-auto block rounded bg-white shadow";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Page ${i} of ${doc.numPages}`);
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        canvases.push(canvas);
      }
      const container = containerRef.current;
      if (cancelled || !container) return;
      container.replaceChildren(...canvases);
      setDrawn(true);
    };
    // A draw started while the tab is in the background can fail: try again once (when the tab is
    // visible again) before saying the preview is unavailable.
    const attempt = (retried: boolean) => {
      draw().catch(() => {
        if (cancelled) return;
        if (retried) return onError("The PDF preview could not be drawn in this browser. Download the draft to view it.");
        destroy?.();
        const retry = () => {
          retryCleanup = null;
          if (!cancelled) attempt(true);
        };
        if (document.visibilityState === "hidden") {
          document.addEventListener("visibilitychange", retry, { once: true });
          retryCleanup = () => document.removeEventListener("visibilitychange", retry);
        } else {
          const t = window.setTimeout(retry, 300);
          retryCleanup = () => window.clearTimeout(t);
        }
      });
    };
    attempt(false);
    return () => {
      cancelled = true;
      retryCleanup?.();
      destroy?.();
    };
  }, [blob, width, onError]);

  return (
    <div role="region" aria-label={label} className="relative min-h-[320px] rounded-lg bg-slate-200 p-3">
      <div ref={containerRef} className="space-y-3" />
      {!drawn && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Drawing the form…
        </div>
      )}
    </div>
  );
}

/** A completed form (or report) drawn at the width of its container. */
export function DocumentView({ doc, label }: { doc: FileDownload; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((m: string) => setError(m), []);
  useEffect(() => setError(null), [doc]);
  return (
    <div ref={ref} className="w-full">
      {error ? (
        <InlineAlert tone="warning" title="Preview unavailable">
          {error}
        </InlineAlert>
      ) : width === 0 ? null : doc.contentType === CONTENT_TYPES.pdf ? (
        <PdfView blob={doc.blob} width={width} label={label} onError={onError} />
      ) : (
        <DocxView blob={doc.blob} width={width} label={label} onError={onError} />
      )}
    </div>
  );
}

/* Panel ----------------------------------------------------------------------------------------- */

export function PreviewPanel({
  report,
  form,
  file,
  active,
  onPreviewed,
}: {
  report: Report;
  /** The form map (form reports); null for a built-in template report or a missing map. */
  form: FormDefinition | null;
  file: FormFileState;
  /** The panel is visible: only then does it fetch. */
  active: boolean;
  onPreviewed?: (warnings: string[]) => void;
}) {
  const isForm = Boolean(report.form);
  const signed = report.status === "signed" && Boolean(report.receipt);
  const [doc, setDoc] = useState<FileDownload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [renderedAt, setRenderedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const onPreviewedRef = useRef(onPreviewed);
  onPreviewedRef.current = onPreviewed;

  const key = useMemo(() => {
    if (isForm) return form ? JSON.stringify([report.status, buildFormAnswers(report, form)]) : null;
    return JSON.stringify([report.status, report.sections]);
  }, [isForm, form, report]);

  const blocked: string | null = isForm
    ? !form
      ? "The form map for this report is not in this browser's forms library, so the form cannot be previewed."
      : file.status === "missing"
        ? "The referrer's original file is not stored in this browser. Add it again in the forms library to preview the completed form."
        : null
    : null;

  const fetchPreview = useCallback(async () => {
    if (!key) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const current = reportRef.current;
    setLoading(true);
    setError(null);
    try {
      let out: FileDownload;
      if (isForm) {
        if (!form || file.status !== "ready") return;
        out =
          signed && current.receipt
            ? await api.render("original", { report: current, receipt: current.receipt, form, fileBase64: file.base64, requireFinal: true }, { signal: ctrl.signal })
            : await api.fillPreview({ report: current, form, fileBase64: file.base64, mode: "draft" }, { signal: ctrl.signal });
      } else {
        out = await api.render(
          "pdf",
          signed && current.receipt ? { report: current, receipt: current.receipt, requireFinal: true } : { report: current },
          { signal: ctrl.signal },
        );
      }
      if (ctrl.signal.aborted) return;
      setDoc(out);
      setRenderedKey(key);
      setRenderedAt(new Date().toISOString());
      onPreviewedRef.current?.(out.warnings);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : "The preview could not be produced. Try again.");
      setRenderedKey(key);
    } finally {
      if (abortRef.current === ctrl) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [key, isForm, form, file, signed]);

  // Fetch when visible and stale: at once the first time, then a moment after the last edit.
  useEffect(() => {
    if (!active || blocked || !key || key === renderedKey) return;
    if (isForm && file.status !== "ready") return;
    const t = window.setTimeout(() => void fetchPreview(), renderedKey === null ? 0 : REFRESH_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [active, blocked, key, renderedKey, isForm, file.status, fetchPreview]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stale = Boolean(doc) && key !== renderedKey;
  const label = isForm ? `Preview of the completed form “${report.form?.title ?? ""}” in its original layout` : "Preview of the report";

  if (blocked) {
    return (
      <InlineAlert tone="warning" title="Preview unavailable">
        {blocked}
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wide",
          signed ? "bg-teal-600 text-white" : "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
        )}
      >
        {signed ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
        <span className="flex-1">{signed ? "FINAL – approved by the clinician" : "DRAFT – awaiting clinician approval"}</span>
      </div>
      {isForm ? <DemoNoticeBar notice={form?.demoNotice} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {isForm ? NOTICES.originalLayout : "Built-in template (house layout)."}
          {renderedAt && !loading && <span className="ml-1">Updated {formatUkDateTime(renderedAt).slice(11)}.</span>}
        </span>
        <div className="flex items-center gap-1">
          {(loading || stale) && (
            <span className="inline-flex items-center gap-1 text-slate-500" role="status">
              <Loader2 className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
              {loading ? "Updating…" : "Changes pending…"}
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => void fetchPreview()} disabled={loading} aria-label="Refresh the preview">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setExpanded(true)} disabled={!doc} aria-label="Open a larger preview">
            <Expand className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {error && (
        <InlineAlert
          tone="error"
          title="The preview could not be updated"
          role="alert"
          action={
            <Button type="button" size="sm" variant="outline" className="h-8 bg-white" onClick={() => void fetchPreview()}>
              Try again
            </Button>
          }
        >
          {error}
        </InlineAlert>
      )}

      {doc ? (
        <div className={cn("transition-opacity", (loading || stale) && "opacity-70")}>
          <DocumentView doc={doc} label={label} />
        </div>
      ) : (
        !error && (
          <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm text-slate-500">
            {isForm && file.status === "loading" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-[#0D9488]" aria-hidden /> Loading the referrer&apos;s form…
              </>
            ) : (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-[#0D9488]" aria-hidden /> Filling in the form…
              </>
            )}
          </div>
        )
      )}

      {doc && doc.warnings.length > 0 && (
        <InlineAlert tone="warning" title="Notes from filling the form">
          <ul className="list-disc space-y-0.5 pl-4">
            {doc.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-3 overflow-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{isForm ? report.form?.title : "Report preview"}</DialogTitle>
            <DialogDescription>
              {signed ? "Final completed form." : "DRAFT – awaiting clinician approval. "}
              {isForm ? ` ${report.form?.referrer.name ?? ""} – original layout.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">{doc && expanded && <DocumentView doc={doc} label={label} />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
