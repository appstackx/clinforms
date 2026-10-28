import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** The clinic's header on its public pages (design round 2g): its badge and name – never the app's shell. */
export function PublicHeader({ name, initials, demo }: { name: string; initials: string; demo: boolean }) {
  return (
    <header className="border-b border-border bg-white px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary-strong text-[12px] font-bold text-white">
          {initials}
        </span>
        <span className="text-[14px] font-semibold text-foreground">{name}</span>
      </div>
      {demo ? <p className="mt-1 text-[12px] text-[#475569]">A demonstration clinic – fictional people and times only.</p> : null}
    </header>
  );
}

/** A page's own top line: back link, title row, progress. */
export function PublicTop({ back, children }: { back?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-white px-4 py-2">
      {back ? (
        <Link href={back.href} className="-ml-1 inline-flex h-9 items-center gap-1 rounded-[8px] px-1 text-[14px] font-medium text-primary-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function PublicMain({ children }: { children: React.ReactNode }) {
  return <main className="px-4 pb-28 pt-5">{children}</main>;
}

export function PublicTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-[22px] font-bold leading-tight text-foreground">{children}</h1>;
}
