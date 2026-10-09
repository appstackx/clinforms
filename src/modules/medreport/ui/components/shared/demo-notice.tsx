"use client";

/**
 * The demonstration notice of a demonstration form (FormDefinition.demoNotice – e.g. a public insurer
 * form in a private demo), shown in the header of the Studio's form previews. The same line is printed
 * at the foot of every page of that form's drafts and final files (forms/demo-notice.ts). Renders
 * nothing for an ordinary form.
 */
import { Info } from "lucide-react";
import { cn } from "../../primitives";

export function DemoNoticeBar({ notice, className }: { notice?: string | null; className?: string }) {
  const text = (notice ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return (
    <p
      role="note"
      aria-label="Demonstration form"
      className={cn("flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600", className)}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
      <span>
        <span className="font-semibold text-slate-700">Demonstration form · </span>
        {text}
      </span>
    </p>
  );
}
