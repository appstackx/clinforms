import { SkeletonBar } from "@/components/pms/ui/skeleton";

/**
 * Loading skeleton for the clinic's public pages (booking, patient portal), in their own narrow mobile style
 * (design round 2g) – the clinic's header from the public layout stays above it, never the staff shell.
 * An accessible status for screen readers; the bars stop pulsing when the person asks for less motion.
 */
export function PublicLoading({ label, variant = "list" }: { label: string; variant?: "list" | "steps" }) {
  return (
    <main role="status" aria-busy="true" aria-live="polite" className="space-y-5 px-4 pb-16 pt-5" data-testid="public-loading">
      <span className="sr-only">Loading {label}…</span>
      {variant === "steps" ? (
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonBar key={i} className="h-1.5 flex-1 rounded-full" />
          ))}
        </div>
      ) : null}
      <SkeletonBar className="h-7 w-48 rounded-[8px]" />
      <SkeletonBar className="w-3/4" />
      <ul className="space-y-2" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 rounded-[12px] border border-border bg-white p-3">
            <SkeletonBar className="h-12 w-12 shrink-0 rounded-[8px]" />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonBar className="w-2/3" />
              <SkeletonBar className="w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
