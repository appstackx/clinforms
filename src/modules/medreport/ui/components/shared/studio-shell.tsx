"use client";

/**
 * Studio chrome. Stable API: `<StudioShell title? description? actions? back?>{children}</StudioShell>`.
 *
 * - The outermost StudioShell (rendered once by src/app/reports/layout.tsx) draws the header with the
 *   navigation and the AI mode badge, and the footer.
 * - A StudioShell rendered inside it (by a screen) draws only the page header (title, description,
 *   actions, back link) around its children, so screens can always wrap themselves in StudioShell.
 *
 * The header is sticky at the top of the viewport (top-0); the review and form-mapping screens' sticky
 * side panels sit just below it.
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { ArrowLeft, FileText, LayoutTemplate, ShieldCheck } from "lucide-react";
import { PRODUCT } from "../../../config.public";
import { cn } from "../../primitives";
import { AiModeBadge } from "./ai-mode";

const NAV = [
  { href: "/reports", label: "Reports", match: (p: string) => p === "/reports" || /^\/reports\/(?!new|forms|batch|templates|security)[^/]+$/.test(p) },
  { href: "/reports/new", label: "Complete a form", match: (p: string) => p.startsWith("/reports/new") },
  { href: "/reports/forms", label: "Referrer forms", match: (p: string) => p.startsWith("/reports/forms") },
  { href: "/reports/batch", label: "Batch", match: (p: string) => p.startsWith("/reports/batch") },
] as const;

const ShellDepth = createContext(0);

export interface StudioShellProps {
  children: ReactNode;
  /** Page title (inner shells only). */
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons shown at the right of the page title. */
  actions?: ReactNode;
  /** Optional back link above the title. */
  back?: { href: string; label: string };
}

export function StudioShell(props: StudioShellProps) {
  const depth = useContext(ShellDepth);
  return (
    <ShellDepth.Provider value={depth + 1}>{depth === 0 ? <OuterShell {...props} /> : <PageFrame {...props} />}</ShellDepth.Provider>
  );
}

function PageFrame({ title, description, actions, back, children }: StudioShellProps) {
  return (
    <div className="space-y-6">
      {title || actions || back ? (
        <div className="space-y-2">
          {back ? (
            <Link
              href={back.href}
              className="inline-flex items-center gap-1 rounded text-sm text-slate-600 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {back.label}
            </Link>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              {title ? <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1> : null}
              {description ? <div className="mt-1 max-w-3xl text-sm text-slate-600">{description}</div> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function OuterShell({ children, ...page }: StudioShellProps) {
  const pathname = usePathname() ?? "/reports";
  const hasPage = Boolean(page.title || page.actions || page.back);
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#studio-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 pt-3 sm:px-6 lg:px-8 lg:pb-3">
          <Link
            href="/reports"
            className="flex min-w-0 items-center gap-2 rounded-lg font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0D9488] text-white">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
            <span className="truncate">{PRODUCT.name}</span>
          </Link>
          <nav aria-label="Studio" className="ml-4 hidden items-center gap-1 text-sm lg:flex">
            <NavLinks pathname={pathname} />
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link
              href="/reports/security"
              className={cn(
                "hidden items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:inline-flex",
                pathname.startsWith("/reports/security") && "ring-1 ring-teal-400",
              )}
              aria-current={pathname.startsWith("/reports/security") ? "page" : undefined}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Security &amp; GDPR
            </Link>
            <Link
              href="/reports/templates"
              className={cn(
                "hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:inline-flex",
                pathname.startsWith("/reports/templates") && "font-medium text-teal-800",
              )}
              aria-current={pathname.startsWith("/reports/templates") ? "page" : undefined}
            >
              <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
              Built-in templates
            </Link>
            <AiModeBadge />
          </div>
        </div>
        <nav aria-label="Studio (compact)" className="mx-auto max-w-7xl overflow-x-auto px-2 pb-2 pt-2 sm:px-4 lg:hidden">
          <div className="flex w-max items-center gap-1 text-sm">
            <NavLinks pathname={pathname} />
            <Link
              href="/reports/templates"
              className={cn(
                "rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100 md:hidden",
                pathname.startsWith("/reports/templates") && "bg-teal-50 font-medium text-teal-800",
              )}
            >
              Built-in templates
            </Link>
            <Link
              href="/reports/security"
              className={cn(
                "rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100 sm:hidden",
                pathname.startsWith("/reports/security") && "bg-teal-50 font-medium text-teal-800",
              )}
            >
              Security &amp; GDPR
            </Link>
          </div>
        </nav>
      </header>
      <main id="studio-main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {hasPage ? <PageFrame {...page}>{children}</PageFrame> : children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            <span className="font-medium text-slate-700">Fictional data only</span> · This demo keeps reports in your browser ·{" "}
            <Link href="/reports/security" className="font-medium text-teal-800 underline-offset-2 hover:underline">
              Security &amp; data protection
            </Link>
          </p>
          <p>
            <Link href="/pms-sandbox" className="underline-offset-2 hover:text-slate-800 hover:underline">
              Simulated TM3 sandbox – demo data, not affiliated with TM3
            </Link>
            <span aria-hidden> · </span>
            {PRODUCT.name} v{PRODUCT.version}
          </p>
        </div>
      </footer>
    </div>
  );
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <>
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
              active ? "bg-teal-50 font-medium text-teal-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
