"use client";

/**
 * Drag-and-drop file picker (keyboard accessible: the whole zone is a button that opens the file
 * dialog). Validation is left to the caller.
 *
 * Owner: studio-a agent.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "../../primitives";

export function FileDrop({
  accept,
  onFile,
  title,
  hint,
  disabled,
  className,
  children,
}: {
  accept: string;
  onFile(file: File): void;
  title: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={cn(
        "rounded-2xl border-2 border-dashed transition-colors",
        over ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-white hover:border-teal-400",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-describedby={hint ? hintId : undefined}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl px-4 py-8 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <UploadCloud className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-sm font-medium text-slate-900">{title}</span>
        {hint ? (
          <span id={hintId} className="text-xs text-slate-500">
            {hint}
          </span>
        ) : null}
      </button>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
