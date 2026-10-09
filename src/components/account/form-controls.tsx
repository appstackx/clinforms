"use client";
/** Client-side form helpers for server-action forms (pending state, copy-to-clipboard). */
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className,
  confirmText,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  /** Ask before submitting (destructive actions). */
  confirmText?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-teal-600 text-white hover:bg-teal-700 focus-visible:ring-teal-600",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-400",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-500",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold shadow-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        styles,
        className,
      )}
    >
      {pending ? (pendingText ?? "Please wait…") : children}
    </button>
  );
}

export function CopyButton({ value, label = "Copy", copiedLabel = "Copied" }: { value: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

/** A one-time secret (link, key, backup codes) shown in a box with a copy button. */
export function SecretBox({ value, label, note }: { value: string; label: string; note?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-900">{label}</span>
        <CopyButton value={value} />
      </div>
      <code className="block break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-slate-900">{value}</code>
      {note ? <p className="text-xs text-amber-900">{note}</p> : null}
    </div>
  );
}
