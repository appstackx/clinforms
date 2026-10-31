import { cn } from "@/lib/utils";
import { SkeletonBar } from "./skeleton";

/** The rough shape of a section while its page loads (route loading.tsx files under /app/clinic). */
export type SectionLayout = "cards" | "table" | "diary" | "record" | "panel" | "split" | "form";

/** Literal class names so Tailwind keeps them (no string building). */
const WIDTHS = {
  760: "max-w-[760px]",
  880: "max-w-[880px]",
  980: "max-w-[980px]",
  1180: "max-w-[1180px]",
  1200: "max-w-[1200px]",
  1280: "max-w-[1280px]",
  full: "max-w-none",
} as const;

export interface SectionLoadingProps {
  /** Read to screen readers as "Loading <label>…", e.g. "the diary". */
  label: string;
  layout: SectionLayout;
  width?: keyof typeof WIDTHS;
  /** Hide the title row (the patient record's tabs, where the record layout keeps its own header). */
  header?: boolean;
}

const card = "rounded-2xl border border-border bg-white";

function HeaderRow() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SkeletonBar className="h-7 w-48 rounded-[8px]" />
      <SkeletonBar className="h-9 w-32 rounded-[8px]" />
    </div>
  );
}

function FilterRow() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SkeletonBar className="h-9 w-full rounded-[8px] md:w-[320px]" />
      <SkeletonBar className="h-8 w-24 rounded-full" />
      <SkeletonBar className="h-8 w-24 rounded-full" />
    </div>
  );
}

function TableCard({ rows = 8 }: { rows?: number }) {
  return (
    <div className={cn(card, "overflow-hidden")}>
      <div className="flex items-center gap-4 border-b border-border bg-[#F8FAFC] px-4 py-3">
        <SkeletonBar className="w-24" />
        <SkeletonBar className="w-40" />
        <SkeletonBar className="ml-auto hidden w-24 sm:block" />
      </div>
      <div className="flex flex-col divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <SkeletonBar className="h-8 w-8 shrink-0 rounded-full" />
            <SkeletonBar className="flex-1" style={{ maxWidth: `${60 + ((i * 17) % 30)}%` }} />
            <SkeletonBar className="hidden w-24 sm:block" />
            <SkeletonBar className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsBody() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cn(card, "flex flex-col gap-3 p-4")}>
            <SkeletonBar className="w-24" />
            <SkeletonBar className="h-7 w-16 rounded-[8px]" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className={cn(card, "flex flex-col gap-3.5 p-4")}>
          <SkeletonBar className="h-4 w-40" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <SkeletonBar className="w-12" />
              <SkeletonBar className="flex-1" />
              <SkeletonBar className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
        <div className={cn(card, "flex flex-col gap-3.5 p-4")}>
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar />
          <SkeletonBar className="w-3/4" />
          <SkeletonBar className="w-1/2" />
        </div>
      </div>
    </>
  );
}

function DiaryBody() {
  const columns = 4;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonBar className="h-9 w-9 rounded-[8px]" />
        <SkeletonBar className="h-9 w-40 rounded-[8px]" />
        <SkeletonBar className="h-9 w-9 rounded-[8px]" />
        <SkeletonBar className="ml-auto h-9 w-48 rounded-[8px]" />
      </div>
      <div className={cn(card, "flex overflow-hidden")}>
        <div className="flex w-14 shrink-0 flex-col gap-[52px] border-r border-border px-2 py-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonBar key={i} className="w-9" />
          ))}
        </div>
        <div className="grid min-h-[480px] flex-1 grid-cols-2 md:grid-cols-4">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className={cn("flex flex-col gap-3 border-r border-border p-2 last:border-r-0", c >= 2 && "hidden md:flex")}>
              <SkeletonBar className="h-5 w-28" />
              <SkeletonBar className="h-16 w-full rounded-[8px]" style={{ marginTop: `${(c * 37) % 60}px` }} />
              <SkeletonBar className="h-10 w-full rounded-[8px]" />
              <SkeletonBar className="h-20 w-full rounded-[8px]" style={{ marginTop: `${(c * 23) % 50}px` }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PanelBody() {
  return (
    <div className={cn(card, "flex flex-col gap-3.5 p-4")}>
      <SkeletonBar className="h-4 w-40" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonBar className="w-20" />
          <SkeletonBar className="flex-1" />
          <SkeletonBar className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function RecordBody() {
  return (
    <>
      <SkeletonBar className="w-40" />
      <div className={cn(card, "flex gap-4 p-4 sm:p-5")}>
        <SkeletonBar className="h-12 w-12 shrink-0 rounded-full sm:h-14 sm:w-14" />
        <div className="flex flex-1 flex-col gap-2.5">
          <SkeletonBar className="h-6 w-56 rounded-[8px]" />
          <SkeletonBar className="w-3/4 max-w-[420px]" />
          <div className="flex gap-1.5">
            <SkeletonBar className="h-6 w-24 rounded-[6px]" />
            <SkeletonBar className="h-6 w-28 rounded-[6px]" />
          </div>
        </div>
      </div>
      <div className="flex gap-5 border-b border-border pb-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBar key={i} className={cn("w-16", i >= 3 && "hidden sm:block")} />
        ))}
      </div>
      <PanelBody />
    </>
  );
}

function SplitBody() {
  return (
    <div className="grid gap-4 md:grid-cols-[340px_1fr]">
      <div className={cn(card, "flex flex-col divide-y divide-border")}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <SkeletonBar className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonBar className="w-1/2" />
              <SkeletonBar className="w-5/6" />
            </div>
          </div>
        ))}
      </div>
      <div className={cn(card, "hidden flex-col gap-4 p-4 md:flex")}>
        <SkeletonBar className="h-5 w-48" />
        <SkeletonBar className="h-14 w-2/3 rounded-xl" />
        <SkeletonBar className="ml-auto h-14 w-1/2 rounded-xl" />
        <SkeletonBar className="h-14 w-3/5 rounded-xl" />
        <SkeletonBar className="mt-auto h-20 w-full rounded-[8px]" />
      </div>
    </div>
  );
}

function FormBody() {
  return (
    <div className={cn(card, "flex flex-col gap-5 p-4 sm:p-5")}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <SkeletonBar className="w-32" />
          <SkeletonBar className="h-9 w-full max-w-[480px] rounded-[8px]" />
        </div>
      ))}
      <SkeletonBar className="h-9 w-28 rounded-[8px]" />
    </div>
  );
}

const BODIES: Record<SectionLayout, () => React.ReactElement> = {
  cards: CardsBody,
  table: () => (
    <>
      <FilterRow />
      <TableCard />
    </>
  ),
  diary: DiaryBody,
  record: RecordBody,
  panel: PanelBody,
  split: SplitBody,
  form: FormBody,
};

/**
 * A clinic-system section's loading skeleton: an accessible status ("Loading the diary…" for screen readers, busy),
 * grey bars shaped like the section (header, then cards, a table, the diary grid…). The bars stop pulsing when the
 * person asks for less motion (SkeletonBar).
 */
export function SectionLoading({ label, layout, width = 1180, header = true }: SectionLoadingProps) {
  const Body = BODIES[layout];
  const showHeader = header && layout !== "record";
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("mx-auto flex w-full min-w-0 flex-col gap-4", WIDTHS[width])} data-testid="section-loading">
      <span className="sr-only">Loading {label}…</span>
      {showHeader ? <HeaderRow /> : null}
      <Body />
    </div>
  );
}
