"use client";
/**
 * The clinic system's app shell (design: docs/clinic-system/design/clinic-system-design-v1.html, "App shell"):
 * product switch, site switcher, patient search ("/"), keyboard shortcuts ("?"), user menu; the left navigation
 * from the modules' registry (already filtered by the member's permissions on the server); "Go to ClinForms" and
 * the clinic's name at the bottom. Below md (phones) the navigation folds behind a "Menu" button.
 *
 * Plain data in, no data fetching: src/app/app/clinic/layout.tsx checks the member and the package and builds the
 * props. A layout never protects a page: every page and action checks for itself.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Calendar,
  ChevronDown,
  Globe,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PoundSterling,
  Search,
  SlidersHorizontal,
  Upload,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOutAndReload } from "@/app/app/session-forms";
import { cn } from "@/lib/utils";
import { InlineKbd } from "../ui/inputs";
import { ShortcutsSheet } from "../ui/keyboard-hint";
import { PmsAvatar } from "../ui/pms-avatar";
import { GLOBAL_SHORTCUTS, isPlainKey, isTypingTarget, type ShortcutGroup } from "../ui/shortcuts";
import { SiteSwitcher, type SiteOption } from "../ui/site-switcher";
import { ToastProvider } from "../ui/toast";
import { currentNavId, type ShellNav, type ShellNavIcon, type ShellNavItem } from "./nav-model";
import { SITE_COOKIE, SITE_COOKIE_MAX_AGE } from "./site-cookie";

export interface ClinicShellProps {
  productName: string;
  /** The clinic's home in this product (the overview). */
  homeHref: string;
  clinicName: string;
  user: { name: string; email: string; roleLabel: string; sitesSummary: string };
  nav: ShellNav;
  sites: { options: SiteOption[]; value: string | null; total: number };
  /** null = the member may not search patients. */
  searchHref: string | null;
  /** ClinForms (reports) for this clinic, or null when the clinic has only the clinic system. */
  clinForms: { href: string; label: string; waiting?: number } | null;
  /** Owners/administrators: their account page; everyone: theirs. */
  accountHref: string;
  children: React.ReactNode;
}

const NAV_ICONS: Readonly<Record<ShellNavIcon, LucideIcon>> = {
  overview: LayoutDashboard,
  diary: Calendar,
  patients: Users,
  billing: PoundSterling,
  messages: MessageSquare,
  online: Globe,
  reports: BarChart3,
  setup: SlidersHorizontal,
  import: Upload,
};

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [{ title: "Everywhere", shortcuts: GLOBAL_SHORTCUTS }];

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function ClinicShell(props: ClinicShellProps) {
  const { productName, homeHref, clinicName, user, nav, sites, searchHref, clinForms, accountHref, children } = props;
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [navOpen, setNavOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const current = currentNavId(pathname, [...nav.main, ...nav.manage]);

  // The phone menu closes when the page changes.
  React.useEffect(() => setNavOpen(false), [pathname]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target as HTMLElement | null)) return;
      if (isPlainKey(e, "/") && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      } else if (isPlainKey(e, "?")) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const chooseSite = (value: string) => {
    document.cookie = `${SITE_COOKIE}=${encodeURIComponent(value)}; path=/app/clinic; max-age=${SITE_COOKIE_MAX_AGE}; samesite=lax`;
    router.refresh();
  };

  const siteSwitcher = (className?: string) =>
    sites.options.length > 0 && sites.value ? (
      <SiteSwitcher className={className} sites={sites.options} value={sites.value} onChange={chooseSite} totalSites={sites.total} />
    ) : null;

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-background text-sm text-foreground">
        <a
          href="#clinic-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
        >
          Skip to content
        </a>
        <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-white px-4 py-2.5">
          <button
            type="button"
            className={cn("inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[#334155] hover:bg-[#F1F5F9] md:hidden", focusRing)}
            aria-expanded={navOpen}
            aria-controls="clinic-nav"
            onClick={() => setNavOpen((o) => !o)}
          >
            {navOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="sr-only">{navOpen ? "Close menu" : "Menu"}</span>
          </button>
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href={homeHref} className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary-strong text-white", focusRing)} aria-label={`${productName} home`}>
              <Activity className="h-4 w-4" aria-hidden />
            </Link>
            {clinForms ? <span className="truncate font-semibold text-foreground lg:hidden">{productName}</span> : null}
            {clinForms ? (
              <nav aria-label="Product areas" className="hidden gap-0.5 rounded-[10px] bg-[#F1F5F9] p-[3px] lg:flex">
                <Link href={homeHref} aria-current="page" className={cn("inline-flex h-[30px] items-center rounded-[8px] bg-white px-3 font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)]", focusRing)}>
                  {productName}
                </Link>
                <Link href={clinForms.href} className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-3 font-medium text-[#475569] hover:text-foreground", focusRing)}>
                  {clinForms.label}
                  {clinForms.waiting ? (
                    <>
                      <span className="rounded-full bg-[#E8EEFB] px-1.5 text-[11px] font-semibold leading-[18px] text-[#1842B4]" aria-hidden>
                        {clinForms.waiting}
                      </span>
                      <span className="sr-only">({clinForms.waiting} forms waiting)</span>
                    </>
                  ) : null}
                </Link>
              </nav>
            ) : (
              <span className="truncate font-semibold text-foreground">{productName}</span>
            )}
          </div>
          {siteSwitcher("hidden w-[200px] md:block")}
          {searchHref ? (
            <form
              role="search"
              action={searchHref}
              method="get"
              className={cn(
                "flex h-9 min-w-0 flex-[1_1_100%] items-center gap-2 rounded-[8px] border border-input-strong bg-[#F8FAFC] px-2.5 focus-within:bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary max-md:order-last md:max-w-[480px] md:flex-[1_1_200px]",
              )}
            >
              <Search className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                name="q"
                aria-label="Search patients"
                placeholder="Search patients – name, DOB, phone, email"
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-[#64748B] focus:outline-none"
              />
              <span className="hidden sm:inline-flex">
                <InlineKbd>/</InlineKbd>
              </span>
            </form>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Keyboard shortcuts"
              onClick={() => setShortcutsOpen(true)}
              className={cn("hidden h-9 w-9 items-center justify-center rounded-[8px] text-[#475569] hover:bg-[#F1F5F9] sm:inline-flex", focusRing)}
            >
              <Keyboard className="h-[18px] w-[18px]" aria-hidden />
            </button>
            <UserMenu
              user={user}
              accountHref={accountHref}
              clinForms={clinForms}
              onShortcuts={() => setShortcutsOpen(true)}
            />
          </div>
        </header>
        <div className="flex flex-1 flex-col md:flex-row">
          <div
            id="clinic-nav"
            className={cn("border-b border-border bg-white md:block md:w-[216px] md:shrink-0 md:border-b-0 md:border-r", navOpen ? "block" : "hidden")}
          >
            <div className="flex flex-col gap-0.5 px-2 py-3 md:sticky md:top-0 md:max-h-screen md:min-h-[calc(100vh-57px)]">
              {siteSwitcher("mb-2 px-1 md:hidden")}
              <nav aria-label={productName} className="flex flex-col gap-0.5">
                {nav.main.map((item) => (
                  <NavLink key={item.id} item={item} current={current === item.id} />
                ))}
                {nav.manage.length > 0 ? (
                  <>
                    <span className="mt-3 px-2.5 pb-1 text-xs font-semibold uppercase tracking-[0.04em] text-[#475569]" id="clinic-nav-setup">
                      Set-up
                    </span>
                    {nav.manage.map((item) => (
                      <NavLink key={item.id} item={item} current={current === item.id} />
                    ))}
                  </>
                ) : null}
              </nav>
              <div className="mt-4 flex flex-col gap-2 border-t border-border px-1 pt-3 md:mt-auto">
                {clinForms ? (
                  <Link href={clinForms.href} className={cn("flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 font-medium text-[#1842B4] hover:bg-[#EFF4FF]", focusRing)}>
                    <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />
                    Go to {clinForms.label}
                  </Link>
                ) : null}
                <span className="px-2.5 text-xs text-muted-foreground">{clinicName}</span>
              </div>
            </div>
          </div>
          <main id="clinic-main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 focus:outline-none sm:px-6">
            {children}
          </main>
        </div>
      </div>
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} groups={SHORTCUT_GROUPS} />
    </ToastProvider>
  );
}

function NavLink({ item, current }: { item: ShellNavItem; current: boolean }) {
  const Icon = NAV_ICONS[item.icon] ?? LayoutDashboard;
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-[8px] px-2.5",
        current ? "bg-[#E6F7F5] font-semibold text-[#0B5F58]" : "font-medium text-[#334155] hover:bg-[#F1F5F9] hover:text-foreground",
        focusRing,
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="min-w-5 rounded-full bg-[#EFF4FF] px-1.5 text-center text-xs font-semibold tabular-nums text-[#1842B4]" data-testid={`nav-badge-${item.id}`}>
          <span aria-hidden>{item.badge}</span>
          <span className="sr-only">({item.badge} {item.badgeLabel ?? "waiting"})</span>
        </span>
      ) : null}
    </Link>
  );
}

interface UserMenuProps {
  user: ClinicShellProps["user"];
  accountHref: string;
  clinForms: ClinicShellProps["clinForms"];
  onShortcuts: () => void;
}

/** The account menu (role="menu"): ↓/↑ move, Esc closes and returns to the button, Tab leaves. */
function UserMenu({ user, accountHref, clinForms, onShortcuts }: UserMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);

  React.useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const itemClass = cn("flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-foreground hover:bg-[#F1F5F9] focus-visible:bg-[#F1F5F9]", focusRing);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn("inline-flex h-10 items-center gap-2 rounded-[8px] pl-1 pr-2 text-foreground hover:bg-[#F1F5F9]", open && "bg-[#F1F5F9]", focusRing)}
      >
        <PmsAvatar name={user.name} size={32} />
        <span className="hidden flex-col items-start leading-4 lg:flex">
          <span className="font-semibold">{user.name}</span>
          <span className="text-xs text-[#475569]">{user.roleLabel}</span>
        </span>
        <span className="sr-only lg:hidden">
          {user.name}, {user.roleLabel}
        </span>
        <ChevronDown className="h-4 w-4 text-[#475569]" aria-hidden />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-[calc(100%+6px)] z-50 flex w-[min(300px,calc(100vw-32px))] flex-col rounded-xl border border-border bg-white p-1.5 text-sm shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
        >
          <div className="mb-1 flex flex-col gap-0.5 border-b border-border p-2.5" role="none">
            <strong className="font-semibold">{user.name}</strong>
            <span className="break-all text-xs text-muted-foreground">{user.email}</span>
            <span className="mt-1.5 text-xs text-[#475569]">
              Role: {user.roleLabel} · {user.sitesSummary}
            </span>
          </div>
          <Link role="menuitem" tabIndex={-1} href={accountHref} className={itemClass} onClick={() => close(false)}>
            <User className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">My account and security</span>
          </Link>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className={itemClass}
            onClick={() => {
              close(false);
              onShortcuts();
            }}
          >
            <Keyboard className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Keyboard shortcuts</span>
            <span className="text-xs text-muted-foreground" aria-hidden>
              ?
            </span>
          </button>
          {clinForms ? (
            <Link role="menuitem" tabIndex={-1} href={clinForms.href} className={itemClass} onClick={() => close(false)}>
              <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">Switch to {clinForms.label}</span>
            </Link>
          ) : null}
          <button role="menuitem" tabIndex={-1} type="button" className={itemClass} onClick={() => void signOutAndReload()}>
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
