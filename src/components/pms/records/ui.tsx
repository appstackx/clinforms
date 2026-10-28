/** Small server-safe pieces of the records screens (no hooks): badges, definition lists, empty states, link buttons. */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { pmsButtonVariants } from "@/components/pms/ui/button";

export type Tone = "neutral" | "teal" | "amber" | "red" | "blue";

const TONES: Record<Tone, string> = {
  neutral: "bg-[#F1F5F9] text-[#334155] ring-[#CBD5E1]",
  teal: "bg-[#D5F5F0] text-[#0B5F58] ring-[#99E2D8]",
  amber: "bg-[#FEF3C7] text-[#864E0E] ring-[#FBD38D]",
  red: "bg-[#FEE2E2] text-[#991B1B] ring-[#FCA5A5]",
  blue: "bg-[#E8EEFB] text-[#1842B4] ring-[#C7D4F5]",
};

/** A label in a coloured pill – the words always carry the meaning (never colour alone). */
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export function DetailList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "");
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded.</p>;
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {shown.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[13px] text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words text-foreground">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white px-5 py-8 text-center">
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(pmsButtonVariants({ variant }), className)}
    >
      {children}
    </Link>
  );
}

export function TextLinkTo({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("rounded font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", className)}>
      {children}
    </Link>
  );
}

/** A heading row: title on the left, actions on the right (they wrap under it on a phone). */
export function SectionHeader({ title, description, actions, level = 2 }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <H className={level === 2 ? "text-base font-semibold text-foreground" : "text-[15px] font-semibold text-foreground"}>{title}</H>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** A table that scrolls inside its own box on a narrow screen (the page never scrolls sideways). */
export function TableBox({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const TH = "whitespace-nowrap bg-[#F8FAFC] px-4 py-2.5 text-xs font-semibold text-[#475569]";
export const TD = "px-4 py-2.5 align-top text-foreground";

/** A white card with a heading and an optional link/action on the right (design round 2: the record's cards). */
export function Card({ title, description, action, children, className, id, level = 2 }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section id={id} aria-label={typeof title === "string" ? title : undefined} className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-white p-5", className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3">
          {title ? <H className="text-base font-semibold text-foreground">{title}</H> : <span />}
          {action}
        </div>
      ) : null}
      {description ? <p className="-mt-2 text-[13px] text-[#475569]">{description}</p> : null}
      {children}
    </section>
  );
}

/** "Coming with billing" – a tab or card whose module is not part of this build yet (never a broken page). */
export function ComingSoon({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-input-strong bg-white px-6 py-8 text-center text-sm">
      <strong className="text-[15px] font-semibold text-foreground">{title}</strong>
      {children ? <p className="max-w-[360px] text-muted-foreground">{children}</p> : null}
    </div>
  );
}
