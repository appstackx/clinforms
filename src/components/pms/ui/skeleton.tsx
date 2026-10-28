import { cn } from "@/lib/utils";

/** A grey placeholder bar that pulses (stops when the person asks for less motion). */
export function SkeletonBar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("h-3 animate-pulse rounded-[6px] bg-[#E2E8F0] motion-reduce:animate-none", className)} style={style} />;
}

/** Loading rows of a list or table (design: "Loading skeleton"): code, text, pill. */
export function SkeletonRows({ rows = 3, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-3.5 rounded-2xl border border-border bg-white p-4", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonBar className="w-20" />
          <SkeletonBar className="flex-1" />
          <SkeletonBar className="h-5 w-16 rounded-full" />
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}
