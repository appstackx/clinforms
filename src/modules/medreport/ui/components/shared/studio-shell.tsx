"use client";

/**
 * Studio chrome. Stable API: `<StudioShell title? description? actions? back?>{children}</StudioShell>`.
 *
 * - The outermost StudioShell (rendered once by the host layout: src/app/reports/layout.tsx for the public
 *   demo, src/app/app/studio/layout.tsx for a clinic's own Studio) draws the header with the navigation,
 *   and the footer with the legal links.
 * - A StudioShell rendered inside it (by a screen) draws only the page header (title, description,
 *   actions, back link) around its children, so screens can always wrap themselves in StudioShell.
 *
 * Demo mode (default): the drafting-mode badge, "Fictional data only" and the Simulated TM3 link.
 * Tenant mode (HostHooks.mode = "tenant"): the clinic's name, the signed-in member's menu (clinic
 * settings, sign out) and no demo wording. Paths come from HostHooks.basePath (ui/routes.ts).
 *
 * The header is sticky at the top of the viewport (top-0); the review and form-mapping screens' sticky
 * side panels sit just below it.
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, LayoutTemplate, LogOut, Settings, ShieldCheck } from "lucide-react";
import { PRODUCT } from "../../../config.public";
import { useHostHooks, useStudioMode } from "../../host-hooks";
import { cn } from "../../primitives";
import { studioSection, useStudioPaths, type StudioPaths, type StudioSection } from "../../routes";
import { AiModeBadge } from "./ai-mode";
import { BrandMark } from "./brand-mark";
import { StudioLegalLinks } from "./legal-links";
import { useScrollFade } from "./scroll-fade";

interface NavItem {
  href: string;
  label: string;
  section: StudioSection;
}

function navItems(paths: StudioPaths, tenant: boolean): NavItem[] {
  return [
    { href: paths.home, label: "Reports", section: "reports" },
    { href: paths.newReport, label: "Complete a form", section: "new" },
    { href: paths.forms, label: "Referrer forms", section: "forms" },
    // Batch works through a connected clinic system; a clinic's Studio has none yet.
    ...(tenant ? [] : [{ href: paths.batch, label: "Batch", section: "batch" as const }]),
  ];
}

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
  const paths = useStudioPaths();
  const mode = useStudioMode();
  const tenant = mode === "tenant";
  const { clinic } = useHostHooks();
  const pathname = usePathname() ?? paths.home;
  const section = studioSection(pathname, paths.basePath);
  const items = navItems(paths, tenant);
  const hasPage = Boolean(page.title || page.actions || page.back);
  const onSecurity = section === "security";
  const onTemplates = section === "templates";
  const compactNav = useScrollFade<HTMLElement>();
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
            href={paths.home}
            className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <BrandMark className="h-8 w-8 shrink-0" />
            <span className="truncate">{PRODUCT.name}</span>
          </Link>
          {tenant && clinic?.name ? (
            <span className="hidden min-w-0 items-center gap-2 text-sm text-slate-700 sm:flex" data-studio-clinic="">
              <span className="text-slate-300" aria-hidden>
                /
              </span>
              <span className="max-w-[16rem] truncate font-medium">{clinic.name}</span>
            </span>
          ) : null}
          <nav aria-label="Studio" className="ml-4 hidden items-center gap-1 text-sm lg:flex">
            <NavLinks items={items} section={section} />
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link
              href={paths.security}
              className={cn(
                "hidden items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:inline-flex",
                onSecurity && "ring-1 ring-teal-400",
              )}
              aria-current={onSecurity ? "page" : undefined}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Security &amp; GDPR
            </Link>
            <Link
              href={paths.templates}
              className={cn(
                "hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:inline-flex",
                onTemplates && "font-medium text-teal-800",
              )}
              aria-current={onTemplates ? "page" : undefined}
            >
              <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
              Built-in templates
            </Link>
            {tenant ? <AccountMenu /> : <AiModeBadge />}
          </div>
        </div>
        <nav
          ref={compactNav.ref}
          style={compactNav.style}
          aria-label="Studio (compact)"
          className="mx-auto max-w-7xl overflow-x-auto px-2 pb-2 pt-2 sm:px-4 lg:hidden"
        >
          <div className="flex w-max items-center gap-1 text-sm">
            <NavLinks items={items} section={section} />
            <Link
              href={paths.templates}
              className={cn("rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100 md:hidden", onTemplates && "bg-teal-50 font-medium text-teal-800")}
            >
              Built-in templates
            </Link>
            <Link
              href={paths.security}
              className={cn("rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100 sm:hidden", onSecurity && "bg-teal-50 font-medium text-teal-800")}
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
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          {tenant ? (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <StudioLegalLinks />
              <p>
                {PRODUCT.name} v{PRODUCT.version}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  <span className="font-medium text-slate-700">Fictional data only</span> · This demo keeps reports in your browser ·{" "}
                  <Link href={paths.security} className="font-medium text-teal-800 underline-offset-2 hover:underline">
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
              <StudioLegalLinks />
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Tenant mode: the signed-in member, the clinic's own pages and sign out. */
function AccountMenu() {
  const { member, clinic, accountHref, onSignOut } = useHostHooks();
  const [signingOut, setSigningOut] = useState(false);
  if (!member) return null;
  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600";
  return (
    <details className="group relative" data-studio-account="">
      <summary className="inline-flex h-8 max-w-[14rem] cursor-pointer list-none items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden">
        <span className="truncate">{member.name}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-64 space-y-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium text-slate-900">{member.name}</p>
          {member.email ? <p className="truncate text-xs text-slate-500">{member.email}</p> : null}
          <p className="mt-0.5 truncate text-xs text-slate-500">{[member.roleLabel, clinic?.name].filter(Boolean).join(" · ")}</p>
        </div>
        <Link href={accountHref ?? "/app"} className={itemClass}>
          <Settings className="h-4 w-4 text-slate-500" aria-hidden />
          Clinic settings
        </Link>
        {onSignOut ? (
          <button
            type="button"
            className={itemClass}
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await onSignOut();
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <LogOut className="h-4 w-4 text-slate-500" aria-hidden />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function NavLinks({ items, section }: { items: NavItem[]; section: StudioSection | null }) {
  return (
    <>
      {items.map((item) => {
        const active = item.section === section;
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
