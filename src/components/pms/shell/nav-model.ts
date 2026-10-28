/**
 * The clinic shell's navigation, from the modules' registry (src/modules/pms/nav): filtered by the member's
 * permissions, split into the main list and "Set-up", each with its icon, and which entry is the current page.
 * Pure – the layout builds it on the server and hands plain data to the client shell.
 */
import type { PmsNavEntry } from "@/modules/pms/core/nav";
import type { PmsModuleId } from "@/modules/pms/core/modules";
import type { PmsPermission } from "@/modules/pms/core/permissions";
import { visibleNav } from "@/modules/pms/core/nav";

export type ShellNavIcon =
  | "overview"
  | "diary"
  | "patients"
  | "billing"
  | "messages"
  | "online"
  | "reports"
  | "setup"
  | "import"
  | "site"
  | "room"
  | "list"
  | "shield"
  | "file"
  | "lock"
  | "clock"
  | "user"
  | "target"
  | "form";

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

/** Set-up pages' icons (design round 2c); others share the sliders. */
const SETUP_ICONS: Readonly<Record<string, ShellNavIcon>> = {
  "reporting.sites": "site",
  "reporting.rooms": "room",
  "reporting.services": "list",
  "reporting.prices": "billing",
  "reporting.referrers": "shield",
  "reporting.practitioners": "user",
  "diary.rotas": "clock",
  "reporting.records": "file",
  "reporting.audit": "list",
  "foundation.staff-access": "lock",
  "foundation.roles": "shield",
  "portal.setup": "online",
  "portal.forms": "form",
  "reporting.billing": "billing",
  "comms.settings": "messages",
  "reporting.targets": "target",
  "reporting.import": "import",
};

function toItem(e: PmsNavEntry): ShellNavItem {
  const icon = e.group === "manage" ? (SETUP_ICONS[e.id] ?? (e.module === "integration" ? "import" : "setup")) : (MODULE_ICONS[e.module] ?? "overview");
  return { id: e.id, href: e.href, label: e.label, icon, exact: e.module === "foundation" && e.group === "main" };
}

/** A part of the clinic with its own list in the left navigation ("← Clinic navigation" goes back): Set-up, Reports. */
export interface ShellSection {
  id: string;
  /** Its heading ("Set-up"). */
  label: string;
  groups: { label: string | null; items: ShellNavItem[] }[];
}

export interface ShellNav {
  main: ShellNavItem[];
  /** Every set-up page the member may open (also in sections[setup]). */
  manage: ShellNavItem[];
  sections: ShellSection[];
}

/** The Set-up entry of the main list (design: "Set-up", sliders icon) – its start page picks the first set-up page. */
export const SETUP_ENTRY_ID = "shell.setup";
export const SETUP_START_PATH = "/app/clinic/setup";

/**
 * The order of the Set-up list (design round 2c): sites, rooms, services, prices, payers, practitioners and their
 * rotas, record templates, staff and roles, online booking and forms, billing and messages, targets, import.
 * Entries not named here follow, in the modules' order.
 */
export const SETUP_ORDER: readonly string[] = [
  "reporting.sites",
  "reporting.rooms",
  "reporting.services",
  "reporting.prices",
  "reporting.referrers",
  "reporting.practitioners",
  "diary.rotas",
  "reporting.records",
  "foundation.staff-access",
  "foundation.roles",
  "portal.setup",
  "portal.forms",
  "reporting.billing",
  "comms.settings",
  "reporting.targets",
  "reporting.audit",
  "reporting.import",
];

/** Set-up entries that are day-to-day work too: without the Set-up area (reception) they stay in the main list. */
const OPERATIONAL_SETUP = new Set(["diary.rotas"]);

function setupRank(id: string): number {
  const i = SETUP_ORDER.indexOf(id);
  return i === -1 ? SETUP_ORDER.length : i;
}

/**
 * What this member sees: entries their role allows, main first, each list in its modules' order. `badges`: counts by
 * entry id (the layout reads them, e.g. comms' replies waiting). The Set-up area is shown (one "Set-up" entry in the
 * main list, the pages in its own list) when the member may open any set-up page besides the operational ones;
 * otherwise those (Rotas for reception) sit in the main list. `sections`: further sections (Reports) from the layout.
 */
export function shellNav(
  entries: readonly PmsNavEntry[],
  can: (p: PmsPermission) => boolean,
  badges: Readonly<Record<string, { count: number; label: string }>> = {},
  extraSections: readonly ShellSection[] = [],
): ShellNav {
  const visible = visibleNav(entries, can);
  const withBadge = (e: PmsNavEntry): ShellNavItem => {
    const item = toItem(e);
    const b = badges[e.id];
    return b && b.count > 0 ? { ...item, badge: b.count, badgeLabel: b.label } : item;
  };
  const manage = visible
    .filter((e) => e.group === "manage")
    .map((e, i) => ({ e, i }))
    .sort((a, b) => setupRank(a.e.id) - setupRank(b.e.id) || a.i - b.i)
    .map(({ e }) => withBadge(e));
  const hasSetupArea = manage.some((m) => !OPERATIONAL_SETUP.has(m.id));
  const main = visible.filter((e) => e.group === "main").map(withBadge);
  if (hasSetupArea) {
    main.push({ id: SETUP_ENTRY_ID, href: SETUP_START_PATH, label: "Set-up", icon: "setup", exact: false });
  } else {
    for (const m of manage) main.push({ ...m, icon: "diary" });
  }
  const sections: ShellSection[] = [...extraSections];
  if (hasSetupArea) sections.push({ id: "setup", label: "Set-up", groups: [{ label: null, items: manage }] });
  return { main, manage: hasSetupArea ? manage : [], sections };
}

/** The section the current page belongs to (its list replaces the main list), or null. */
export function currentSection(pathname: string, nav: ShellNav): ShellSection | null {
  const current = currentNavId(pathname, sectionItems(nav));
  if (current) {
    const found = nav.sections.find((s) => s.groups.some((g) => g.items.some((i) => i.id === current)));
    if (found) return found;
  }
  const path = pathname.replace(/\/+$/, "");
  if (path === SETUP_START_PATH || path.startsWith(`${SETUP_START_PATH}/`)) return nav.sections.find((s) => s.id === "setup") ?? null;
  return null;
}

/** Every entry of the main list and the sections (for the current-page match). */
export function sectionItems(nav: ShellNav): ShellNavItem[] {
  return [...nav.main, ...nav.sections.flatMap((s) => s.groups.flatMap((g) => g.items))];
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
