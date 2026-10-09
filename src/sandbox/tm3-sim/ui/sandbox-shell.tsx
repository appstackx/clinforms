/**
 * Sandbox chrome: a permanent slate/blue "Simulated TM3 sandbox – demo data, not affiliated with TM3"
 * strip (slate and blue, never amber), a neutral clinic-system header and a footer with the public
 * site's legal links. No TM3 logo, colours or copied screens.
 *
 * Owner: sandbox agent.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, FlaskConical, UserRound } from "lucide-react";
import { SANDBOX_LABEL } from "../config";
import { SARAH_REID, SIM_CLINIC } from "../fixtures/clinic";

/** The public website's legal and trust pages (fixed paths on the host site). */
const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/cookies", label: "Cookie policy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
] as const;

export function SandboxShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <a
        href="#sandbox-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-blue-800 focus:shadow"
      >
        Skip to content
      </a>
      <div className="bg-slate-800 text-slate-50" role="note" aria-label="Sandbox notice">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6 sm:text-sm lg:px-8">
          <FlaskConical className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
          <span>{SANDBOX_LABEL}</span>
        </div>
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/pms-sandbox"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900">{SIM_CLINIC.name}</span>
              <span className="block truncate text-xs text-slate-500">Practice management · simulated</span>
            </span>
          </Link>
          <nav aria-label="Sandbox" className="flex items-center gap-1 sm:gap-4">
            <Link
              href="/pms-sandbox"
              className="rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Patients
            </Link>
            <span className="hidden items-center gap-2 border-l border-slate-200 pl-4 text-sm text-slate-600 md:flex">
              <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
              <span>
                Signed in as <span className="font-medium text-slate-800">{SARAH_REID.name}</span>
              </span>
            </span>
          </nav>
        </div>
      </header>
      <main id="sandbox-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>{SANDBOX_LABEL}</p>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                prefetch={false}
                className="rounded underline-offset-2 hover:text-slate-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
