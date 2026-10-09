"use client";

/**
 * The referrer's form rendered in its ORIGINAL layout (Word via docx-preview, PDF via pdfjs-dist on a
 * canvas), with the selected question's answer space highlighted and an optional "pick a location"
 * mode for the mapping editor. Both libraries are lazy-loaded through ui/preview-libs.ts.
 *
 * Highlighting is best effort:
 * - Word: block IDs ("p12", "t2.r3.c1", "t2.r3.c1.p0") are resolved against the rendered DOM in the
 *   same document order the forms engine uses (body paragraphs and tables; rows; cells; a cell's own
 *   paragraphs and nested tables). If a block cannot be found, the question's label is searched for
 *   instead.
 * - PDF: AcroForm widgets (from pdfjs annotations) are outlined by field name; flat-PDF overlay boxes are
 *   drawn from their page coordinates.
 *
 * Reusable by the review screen (pass the filled DRAFT file from /forms/fill-preview).
 *
 * Owner: studio-a agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileWarning, MousePointerClick } from "lucide-react";
import { formAnchorPdfFieldNames } from "../../../core/forms";
import type { FormAnchor, FormMimeType, PdfFieldType } from "../../../core/types";
import { cn } from "../../primitives";
import { DOCX_PREVIEW_OPTIONS, loadPdfjsBrowser, renderDocxPreview } from "../../preview-libs";
import { indexDocxDom, type DocxIndex } from "./docx-index";
import { Spinner } from "./ui-bits";

export interface PreviewFile {
  bytes: Uint8Array;
  mimeType: FormMimeType;
  fileName: string;
}

export type PreviewPick =
  | { kind: "docx"; blockId: string; isCell: boolean; text: string }
  | { kind: "pdf_field"; fieldName: string; fieldType: PdfFieldType; options?: string[] }
  | { kind: "pdf_overlay"; page: number; x: number; y: number };

export interface PreviewHighlight {
  anchor: FormAnchor;
  /** The question's label (fallback text search for Word). */
  label?: string;
}

export interface OriginalFormPreviewProps {
  file: PreviewFile | null;
  /** The file is still loading. */
  loading?: boolean;
  /** Could not load the file. */
  error?: string | null;
  highlight?: PreviewHighlight | null;
  /** Click a cell / paragraph / PDF field to choose where an answer goes. */
  pickMode?: boolean;
  onPick?(pick: PreviewPick): void;
  /** Accessible name of the preview region. */
  label?: string;
  className?: string;
}

const HL_STYLE_ID = "medreport-preview-styles";
const HL_CSS = `
.mr-preview .docx-wrapper{background:#e2e8f0;padding:16px;}
.mr-preview .docx-wrapper>section.docx{box-shadow:0 1px 3px rgba(15,23,42,.18);margin-bottom:16px;}
.mr-preview a{pointer-events:none;cursor:default;}
.mr-hl{outline:3px solid #0D9488!important;outline-offset:1px;background-color:rgba(13,148,136,.14)!important;}
.mr-picking [data-mr-block]{cursor:crosshair;}
.mr-picking [data-mr-block]:hover{outline:2px dashed #0D9488;outline-offset:-2px;background-color:rgba(13,148,136,.08);}
`;

function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(HL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HL_STYLE_ID;
  style.textContent = HL_CSS;
  document.head.appendChild(style);
}

function isPdf(mime: FormMimeType): boolean {
  return mime === "application/pdf";
}

export function OriginalFormPreview(props: OriginalFormPreviewProps) {
  const { file, loading, error, label = "Original form preview", className } = props;
  return (
    <div
      role="region"
      aria-label={label}
      className={cn("mr-preview relative flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-200", className)}
    >
      {props.pickMode ? (
        <div className="flex items-center gap-2 border-b border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900">
          <MousePointerClick className="h-4 w-4" aria-hidden />
          Click the place in the form where this answer goes.
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-600">
          <FileWarning className="h-6 w-6 text-slate-400" aria-hidden />
          {error}
        </div>
      ) : loading || !file ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-600">
          <Spinner label="Loading the original form…" />
        </div>
      ) : isPdf(file.mimeType) ? (
        <PdfPreview {...props} file={file} />
      ) : (
        <DocxPreview {...props} file={file} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Word
 * ----------------------------------------------------------------------------------------------*/

function docxAnchorBlocks(anchor: FormAnchor): string[] {
  if (anchor.kind !== "docx") return [];
  const ids = [anchor.blockId, ...(anchor.optionGlyphs ?? []).map((g) => g.blockId)];
  return Array.from(new Set(ids));
}

function findByText(root: HTMLElement, text: string): HTMLElement | null {
  const needle = text.trim().toLowerCase().slice(0, 48);
  if (needle.length < 3) return null;
  const candidates = root.querySelectorAll<HTMLElement>("section.docx > article p, section.docx > article td");
  for (const el of Array.from(candidates)) {
    if (el.tagName === "TD" && el.querySelector("td")) continue;
    if ((el.textContent ?? "").toLowerCase().includes(needle)) return el;
  }
  return null;
}

function scrollWithin(container: HTMLElement, el: HTMLElement): void {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const top = container.scrollTop + (r.top - c.top) - container.clientHeight / 2 + r.height / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function DocxPreview({ file, highlight, pickMode, onPick }: OriginalFormPreviewProps & { file: PreviewFile }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<DocxIndex | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [renderId, setRenderId] = useState(0);

  useEffect(() => {
    ensureStyles();
    let cancelled = false;
    const content = contentRef.current;
    if (!content) return;
    setState("loading");
    content.innerHTML = "";
    renderDocxPreview(new Blob([file.bytes.slice()]), content, { ...DOCX_PREVIEW_OPTIONS, className: "docx" })
      .then(() => {
        if (cancelled) return;
        indexRef.current = indexDocxDom(content);
        setState("ready");
        setRenderId((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Fit the page width to the panel (CSS zoom keeps layout and hit-testing consistent).
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || state !== "ready") return;
    const fit = () => {
      const page = content.querySelector<HTMLElement>("section.docx");
      if (!page) return;
      content.style.zoom = "1";
      const needed = page.offsetWidth + 32;
      const zoom = Math.min(1, Math.max(0.3, (viewport.clientWidth - 4) / needed));
      content.style.zoom = String(zoom);
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(viewport);
    return () => ro?.disconnect();
  }, [state]);

  // Highlight the anchor.
  useEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    const index = indexRef.current;
    if (!content || !viewport || !index || state !== "ready") return;
    content.querySelectorAll(".mr-hl").forEach((el) => el.classList.remove("mr-hl"));
    if (!highlight) return;
    let els = docxAnchorBlocks(highlight.anchor)
      .map((id) => index.byId.get(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0 && highlight.label) {
      const found = findByText(content, highlight.label);
      if (found) els = [found];
    }
    els.forEach((el) => el.classList.add("mr-hl"));
    if (els[0]) scrollWithin(viewport, els[0]);
  }, [highlight, state, renderId]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!pickMode || !onPick) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-mr-block]");
      if (!target?.dataset.mrBlock) return;
      e.preventDefault();
      onPick({
        kind: "docx",
        blockId: target.dataset.mrBlock,
        isCell: target.tagName === "TD" || target.tagName === "TH",
        text: (target.textContent ?? "").trim().slice(0, 200),
      });
    },
    [pickMode, onPick],
  );

  return (
    <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto">
      {state === "loading" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-200/80 text-sm text-slate-600">
          <Spinner label="Rendering the Word form…" />
        </div>
      ) : null}
      {state === "error" ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
          This Word file could not be previewed here. Download it to view it in Word.
        </div>
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div ref={contentRef} onClick={onClick} className={cn(pickMode && "mr-picking")} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * PDF
 * ----------------------------------------------------------------------------------------------*/

interface PdfWidget {
  name: string;
  type: PdfFieldType;
  /** Viewport CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  exportValue?: string;
  options?: string[];
}

interface PdfPageView {
  number: number;
  width: number;
  height: number;
  widgets: PdfWidget[];
  /** PDF points → viewport pixels. */
  toView(x: number, y: number): [number, number];
  /** Viewport pixels → PDF points. */
  toPdf(x: number, y: number): [number, number];
}

type PdfLoadingTask = ReturnType<Awaited<ReturnType<typeof loadPdfjsBrowser>>["getDocument"]>;
type PdfDoc = Awaited<PdfLoadingTask["promise"]>;

interface RawAnnotation {
  subtype?: string;
  fieldName?: string;
  fieldType?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
  exportValue?: string;
  options?: Array<{ exportValue?: string; displayValue?: string }>;
  rect?: number[];
}

function widgetType(a: RawAnnotation): PdfFieldType {
  if (a.fieldType === "Btn") return a.radioButton ? "radio" : "checkbox";
  if (a.fieldType === "Ch") return "dropdown";
  return "text";
}

function pdfFieldMatches(widgetName: string, fieldName: string): boolean {
  return widgetName === fieldName || widgetName.startsWith(`${fieldName}.`);
}

function PdfPreview({ file, highlight, pickMode, onPick }: OriginalFormPreviewProps & { file: PreviewFile }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<PdfPageView[]>([]);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let task: PdfLoadingTask | null = null;
    setState("loading");
    setDoc(null);
    setPages([]);
    loadPdfjsBrowser()
      .then((pdfjs) => {
        if (cancelled) return null;
        task = pdfjs.getDocument({ data: file.bytes.slice() });
        return task.promise;
      })
      .then((d) => {
        if (d && !cancelled) setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      if (task) void (task as PdfLoadingTask).destroy();
    };
  }, [file]);

  // Track the panel width.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(Math.max(240, Math.floor(el.clientWidth - 24))), 80);
    };
    setWidth(Math.max(240, Math.floor(el.clientWidth - 24)));
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      clearTimeout(timer);
      ro?.disconnect();
    };
  }, []);

  // Lay out pages and widgets for the current width.
  useEffect(() => {
    if (!doc || width === 0) return;
    let cancelled = false;
    (async () => {
      const views: PdfPageView[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.6, width / base.width);
        const vp = page.getViewport({ scale });
        const annotations = (await page.getAnnotations()) as RawAnnotation[];
        const toView = (x: number, y: number) => vp.convertToViewportPoint(x, y) as [number, number];
        const widgets: PdfWidget[] = [];
        for (const a of annotations) {
          if (a.subtype !== "Widget" || !a.fieldName || !a.rect || a.rect.length < 4) continue;
          const [x1, y1] = toView(a.rect[0], a.rect[1]);
          const [x2, y2] = toView(a.rect[2], a.rect[3]);
          widgets.push({
            name: a.fieldName,
            type: widgetType(a),
            left: Math.min(x1, x2),
            top: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
            exportValue: a.buttonValue ?? a.exportValue,
            options: a.options?.map((o) => o.exportValue ?? o.displayValue ?? "").filter(Boolean),
          });
        }
        views.push({
          number: n,
          width: vp.width,
          height: vp.height,
          widgets,
          toView,
          toPdf: (x: number, y: number) => vp.convertToPdfPoint(x, y) as [number, number],
        });
      }
      if (!cancelled) setPages(views);
    })().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [doc, width]);

  // Draw the canvases.
  useEffect(() => {
    if (!doc || pages.length === 0) return;
    let cancelled = false;
    const tasks: Array<{ cancel(): void }> = [];
    (async () => {
      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      for (const view of pages) {
        const canvas = canvasRefs.current[view.number - 1];
        if (!canvas || cancelled) continue;
        const page = await doc.getPage(view.number);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: view.width / base.width });
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        const task = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        tasks.push(task);
        await task.promise.catch(() => undefined);
      }
      if (!cancelled) setState("ready");
    })().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
    };
  }, [doc, pages]);

  const anchor = highlight?.anchor;
  const boxes = useMemo(() => {
    const out: Array<{ page: number; left: number; top: number; width: number; height: number }> = [];
    if (!anchor) return out;
    for (const view of pages) {
      if (anchor.kind === "pdf_field" || anchor.kind === "pdf_char_fields") {
        // Every box the answer uses (each tick box of an option group, each character box).
        const names = formAnchorPdfFieldNames(anchor);
        for (const w of view.widgets) if (names.some((n) => pdfFieldMatches(w.name, n))) out.push({ page: view.number, ...w });
      } else if (anchor.kind === "pdf_overlay" && anchor.page === view.number) {
        const [x1, y1] = view.toView(anchor.x, anchor.y);
        const [x2, y2] = view.toView(anchor.x + anchor.width, anchor.y + anchor.height);
        out.push({ page: view.number, left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
      }
    }
    return out;
  }, [anchor, pages]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const first = boxes[0];
    if (!viewport || !first) return;
    const pageEl = pageRefs.current[first.page - 1];
    if (!pageEl) return;
    const top = pageEl.offsetTop + first.top - viewport.clientHeight / 2 + first.height / 2;
    viewport.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [boxes]);

  const pickWidget = (view: PdfPageView, w: PdfWidget) => {
    if (!onPick) return;
    const siblings = pages.flatMap((p) => p.widgets).filter((x) => x.name === w.name);
    const options =
      w.type === "radio"
        ? Array.from(new Set(siblings.map((s) => s.exportValue).filter((v): v is string => Boolean(v) && v !== "Off")))
        : w.type === "dropdown"
          ? w.options
          : undefined;
    void view;
    onPick({ kind: "pdf_field", fieldName: w.name, fieldType: w.type, ...(options?.length ? { options } : {}) });
  };

  return (
    <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto p-3">
      {state === "loading" ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-200/80 text-sm text-slate-600">
          <Spinner label="Rendering the PDF form…" />
        </div>
      ) : null}
      {state === "error" ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
          This PDF could not be previewed here. Download it to view it.
        </div>
      ) : null}
      <div className="mx-auto flex w-max flex-col gap-3">
        {pages.map((view) => (
          <div
            key={view.number}
            ref={(el) => {
              pageRefs.current[view.number - 1] = el;
            }}
            className={cn("relative bg-white shadow", pickMode && !view.widgets.length && "cursor-crosshair")}
            style={{ width: view.width, height: view.height }}
            onClick={(e) => {
              if (!pickMode || !onPick || view.widgets.length > 0) return;
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const [x, y] = view.toPdf(e.clientX - rect.left, e.clientY - rect.top);
              onPick({ kind: "pdf_overlay", page: view.number, x: Math.round(x), y: Math.round(y) });
            }}
            aria-label={`Page ${view.number} of ${pages.length}`}
            role="img"
          >
            <canvas
              ref={(el) => {
                canvasRefs.current[view.number - 1] = el;
              }}
              className="block"
            />
            {pickMode
              ? view.widgets.map((w, i) => (
                  <button
                    key={`${w.name}-${i}`}
                    type="button"
                    title={w.name}
                    aria-label={`Use PDF field ${w.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      pickWidget(view, w);
                    }}
                    className="absolute rounded-sm border border-dashed border-teal-500/60 bg-teal-400/5 hover:border-2 hover:border-teal-600 hover:bg-teal-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                    style={{ left: w.left, top: w.top, width: Math.max(w.width, 8), height: Math.max(w.height, 8) }}
                  />
                ))
              : null}
            {boxes
              .filter((b) => b.page === view.number)
              .map((b, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute rounded-sm border-[3px] border-[#0D9488] bg-teal-500/15"
                  style={{ left: b.left - 2, top: b.top - 2, width: b.width + 4, height: b.height + 4 }}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Thumbnail (first page only, lazy when scrolled into view)
 * ----------------------------------------------------------------------------------------------*/

export function FormThumbnail({ file, className }: { file: PreviewFile | null; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !file) return;
    let cancelled = false;
    setFailed(false);
    if (isPdf(file.mimeType)) {
      let task: PdfLoadingTask | null = null;
      loadPdfjsBrowser()
        .then((pdfjs) => {
          task = pdfjs.getDocument({ data: file.bytes.slice() });
          return task.promise;
        })
        .then(async (d) => {
          const canvas = canvasRef.current;
          const host = hostRef.current;
          if (cancelled || !canvas || !host) return;
          const page = await d.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (host.clientWidth * 1.5) / base.width });
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          await page.render({ canvas, viewport: vp }).promise;
        })
        .catch(() => !cancelled && setFailed(true));
      return () => {
        cancelled = true;
        if (task) void (task as PdfLoadingTask).destroy();
      };
    }
    const target = docxRef.current;
    if (!target) return;
    target.innerHTML = "";
    renderDocxPreview(new Blob([file.bytes.slice()]), target, {
      ...DOCX_PREVIEW_OPTIONS,
      className: "docx",
      renderFooters: false,
      renderFootnotes: false,
    })
      .then(() => {
        const host = hostRef.current;
        const page = target.querySelector<HTMLElement>("section.docx");
        if (cancelled || !host || !page) return;
        target.style.zoom = String(host.clientWidth / (page.offsetWidth + 2));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [visible, file]);

  const pdf = file ? isPdf(file.mimeType) : false;
  return (
    <div ref={hostRef} aria-hidden className={cn("relative overflow-hidden bg-white", className)}>
      {!file || failed ? (
        <div className="flex h-full items-center justify-center text-slate-300">
          <FileWarning className="h-8 w-8" />
        </div>
      ) : pdf ? (
        <canvas ref={canvasRef} className="block w-full" />
      ) : (
        <div ref={docxRef} className="pointer-events-none [&_.docx-wrapper]:!bg-white [&_.docx-wrapper]:!p-0 [&_section.docx]:!shadow-none" />
      )}
    </div>
  );
}
