"use client";
import * as React from "react";
import { CheckCircle, FileText, UploadCloud, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PmsButton } from "./button";

/** 1536 → "1.5 KB"; 5 * 1024 * 1024 → "5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${units[u]}`;
}

/**
 * Why a file is refused, in plain words, or null when it is fine. `accept` lists extensions (".pdf") and/or MIME types
 * ("image/*", "application/pdf"); empty accepts any type.
 */
export function checkFile(file: { name: string; type: string; size: number }, accept: readonly string[], maxBytes?: number): string | null {
  if (accept.length) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    const ok = accept.some((a) => {
      const x = a.toLowerCase();
      if (x.startsWith(".")) return name.endsWith(x);
      if (x.endsWith("/*")) return type.startsWith(x.slice(0, -1));
      return type === x;
    });
    if (!ok) return `${file.name} isn’t a file type we accept. Use ${acceptText(accept)}.`;
  }
  if (maxBytes !== undefined && file.size > maxBytes) return `${file.name} is ${formatBytes(file.size)} – the limit is ${formatBytes(maxBytes)}.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** [".pdf", ".jpg", ".png"] → "PDF, JPG or PNG". */
export function acceptText(accept: readonly string[]): string {
  const names = accept.map((a) => (a.startsWith(".") ? a.slice(1).toUpperCase() : a.endsWith("/*") ? `any ${a.slice(0, -2)}` : a));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "any file";
}

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** 0–100 while uploading; null when waiting. */
  progress: number | null;
  done?: boolean;
  error?: string;
}

export interface FileUploadProps {
  id: string;
  label: string;
  /** Extensions and/or MIME types; also sets the file chooser's filter. */
  accept: readonly string[];
  maxBytes?: number;
  multiple?: boolean;
  /** Files that passed the checks, and those that did not (with the reason in words). */
  onFiles: (accepted: File[], rejected: { file: File; reason: string }[]) => void;
  /** The files in progress or finished (the screen owns the upload). */
  items: readonly UploadItem[];
  onRemove?: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * File upload (brief Part A): a drop zone – drag files on to it, or "Choose files" (a real button, so it works by
 * keyboard and on phones) – with the allowed types and size limit spelt out, then each file's progress bar
 * (role="progressbar"), a tick when done, or the reason it was refused (wrong type, too big) in red with an icon.
 * The list is a polite live region. The screen does the actual upload and passes progress back in `items`.
 */
export function FileUpload({ id, label, accept, maxBytes, multiple = true, onFiles, items, onRemove, disabled, className }: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const labelId = `${id}-label`;
  const rulesId = `${id}-rules`;

  const take = (list: FileList | null) => {
    if (!list || disabled) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    const ok: File[] = [];
    const bad: { file: File; reason: string }[] = [];
    for (const f of files) {
      const reason = checkFile(f, accept, maxBytes);
      if (reason) bad.push({ file: f, reason });
      else ok.push(f);
    }
    onFiles(ok, bad);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span id={labelId} className="text-sm font-medium text-foreground">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={rulesId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          over ? "border-primary bg-[#F0FDFA]" : "border-input-strong bg-[#F8FAFC]",
          disabled && "opacity-60",
        )}
      >
        <UploadCloud className={cn("h-7 w-7", over ? "text-primary-strong" : "text-[#64748B]")} aria-hidden />
        <p className="text-sm text-foreground">{over ? "Drop to upload" : "Drag files here, or"}</p>
        <PmsButton variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()} className="max-sm:h-11">
          Choose {multiple ? "files" : "a file"}
        </PmsButton>
        <p id={rulesId} className="text-xs text-[#475569]">
          {acceptText(accept)}
          {maxBytes !== undefined ? `, up to ${formatBytes(maxBytes)} each` : ""}
        </p>
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="hidden"
          tabIndex={-1}
          multiple={multiple}
          accept={accept.join(",")}
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <ul aria-live="polite" aria-label="Files" className="flex flex-col gap-2 empty:hidden">
        {items.map((f) => (
          <li key={f.id} className={cn("flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-sm", f.error ? "border-[#FECACA]" : "border-border")}>
            {f.error ? <XCircle className="h-4 w-4 shrink-0 text-destructive-strong" aria-hidden /> : f.done ? <CheckCircle className="h-4 w-4 shrink-0 text-[#166534]" aria-hidden /> : <FileText className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden />}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate font-medium text-foreground">{f.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-[#475569]">{f.error ? "Not uploaded" : f.done ? "Uploaded" : f.progress === null ? "Waiting" : `${Math.round(f.progress)}%`}</span>
              </span>
              {f.error ? (
                <span className="text-xs text-destructive-strong">{f.error}</span>
              ) : f.done ? (
                <span className="text-xs text-[#475569]">{formatBytes(f.size)}</span>
              ) : (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${f.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={f.progress === null ? undefined : Math.round(f.progress)}
                  className="h-1.5 overflow-hidden rounded-full bg-[#E2E8F0]"
                >
                  <div className="h-full rounded-full bg-primary-strong transition-[width] motion-reduce:transition-none" style={{ width: `${f.progress ?? 0}%` }} />
                </div>
              )}
            </div>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                aria-label={`Remove ${f.name}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#475569] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-sm:h-11 max-sm:w-11"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
