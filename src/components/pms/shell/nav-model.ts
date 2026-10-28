/**
 * The clinic shell's navigation, from the modules' registry (src/modules/pms/nav): filtered by the member's
 * permissions, split into the main list and "Set-up", each with its icon, and which entry is the current page.
 * Pure – the layout builds it on the server and hands plain data to the client shell.
 */
import type { PmsNavEntry } from "@/modules/pms/core/nav";
import type { PmsModuleId } from "@/modules/pms/core/modules";
import type { PmsPermission } from "@/modules/pms/core/permissions";
import { visibleNav } from "@/modules/pms/core/nav";

export type ShellNavIcon = "overview" | "diary" | "patients" | "billing" | "messages" | "online" | "reports" | "setup" | "import";

export interface ShellNavItem {
  id: string;
  href: string;
  label: string;
  icon: ShellNavIcon;
  /** Current only on exactly this address (a section's start page, e.g. the overview). */
  exact: boolean;
  /** A count beside the entry (Messages: replies waiting for an answer); 0 / undefined = none. */
  badge?: number;
  /** What the count is, for screen readers ("replies to answer"). */
  badgeLabel?: string;
}

export interface ShellNav {
  main: ShellNavItem[];
  manage: ShellNavItem[];
}

const MODULE_ICONS: Readonly<Record<PmsModuleId, ShellNavIcon>> = {
  foundation: "overview",
  diary: "diary",
  records: "patients",
  billing: "billing",
  comms: "messages",
  portal: "online",
  reporting: "reports",
  integration: "import",
};

function toItem(e: PmsNavEntry): ShellNavItem {
  // Set-up entries share the sliders icon (the design's "Set-up"), except data import, which keeps its own.
  const icon = e.group === "manage" && e.module !== "integration" ? "setup" : MODULE_ICONS[e.module] ?? "overview";
  return { id: e.id, href: e.href, label: e.label, icon, exact: e.module === "foundation" && e.group === "main" };
}

/**
 * What this member sees: entries their role allows, main first, each list in its modules' order. `badges`: counts by
 * entry id (the layout reads them, e.g. comms' replies waiting).
 */
export function shellNav(entries: readonly PmsNavEntry[], can: (p: PmsPermission) => boolean, badges: Readonly<Record<string, { count: number; label: string }>> = {}): ShellNav {
  const visible = visibleNav(entries, can);
  const withBadge = (e: PmsNavEntry): ShellNavItem => {
    const item = toItem(e);
    const b = badges[e.id];
    return b && b.count > 0 ? { ...item, badge: b.count, badgeLabel: b.label } : item;
  };
  return {
    main: visible.filter((e) => e.group === "main").map(withBadge),
    manage: visible.filter((e) => e.group === "manage").map(withBadge),
  };
}

/**
 * The one current entry for an address: an exact entry must match exactly; otherwise the entry with the longest
 * address that the page is at or under ("/app/clinic/diary/rotas" → Rotas, not Diary). Null when none matches.
 */
export function currentNavId(pathname: string, items: readonly ShellNavItem[]): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: ShellNavItem | null = null;
  for (const item of items) {
    const href = item.href.replace(/\/+$/, "") || "/";
    const match = item.exact ? path === href : path === href || path.startsWith(`${href}/`);
    if (match && (!best || href.length > best.href.replace(/\/+$/, "").length)) best = item;
  }
  return best?.id ?? null;
}

/** "Role: Reception · 3 sites" – the sites part of the user menu. */
export function sitesSummary(accessible: number, total: number): string {
  if (total === 0) return "no sites yet";
  if (accessible >= total) return total === 1 ? "1 site" : `all ${total} sites`;
  return accessible === 1 ? "1 site" : `${accessible} sites`;
}

const CLINIC_ROLE_LABELS: Readonly<Record<string, string>> = { owner: "Owner", admin: "Administrator", clinician: "Clinician", staff: "Reception" };

/**
 * The role's name in the clinic system (design v1: ClinForms' "Staff" is "Reception" here – contract §6, staff =
 * reception). Anything else falls back to the caller's label.
 */
export function clinicRoleLabel(role: string, fallback: string): string {
  return CLINIC_ROLE_LABELS[role] ?? fallback;
}
