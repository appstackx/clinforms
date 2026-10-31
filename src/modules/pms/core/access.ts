/**
 * Configurable access (foundation, migration 0103): the clinic's overrides of a role's permissions, a member's own
 * exceptions, the sites a member works at and can see, and the change history. Pure – types, input schemas, the
 * site-scope rule and the plain-English wording used by both screens and the history.
 *
 * Site scope (K2-SITE-004): "works at" puts someone on a site's rota or front desk; "can see" decides which diaries
 * and patients they can open. A site they work at is always visible. With no stored access (the default) or "can
 * see all sites", a member sees every site. The OWNER always sees every site (they cannot lock themselves out).
 */
import { safeCsvText } from "./csv-safe";
import { z } from "zod";
import {
  ACCESS_PERMISSION_DEFS,
  LOCK_REASONS,
  PMS_ROLE_LABELS,
  accessPermissionDef,
  effectivePermissions,
  isAccessPermission,
  isPmsRole,
  lockOf,
  rolePermission,
  type AccessPermission,
  type PermissionChoices,
  type PmsRole,
} from "./permissions";

/* ------------------------------------------------------------------------------------------------
 * Stored shapes
 * ----------------------------------------------------------------------------------------------*/

export interface RoleOverride {
  role: PmsRole;
  permission: AccessPermission;
  allowed: boolean;
}

export interface MemberSite {
  siteId: string;
  worksAt: boolean;
  canSee: boolean;
}

export interface MemberAccess {
  userId: string;
  /** False = deactivated in the clinic system (no access at all; their ClinForms membership is unchanged). */
  active: boolean;
  allSites: boolean;
  sites: MemberSite[];
  /** permission → allowed (only the permissions that differ for this person). */
  exceptions: Partial<Record<AccessPermission, boolean>>;
  rev: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** One line of a change, stored as data (no patient data; names are resolved when shown). */
export type AccessChangeItem =
  | { type: "role_permission"; role: PmsRole; permission: AccessPermission; from: boolean; to: boolean }
  | { type: "exception"; permission: AccessPermission; to: boolean | null }
  | { type: "role"; from: PmsRole; to: PmsRole }
  | { type: "sites"; allSites: boolean; worksAt: number; canSee: number }
  | { type: "active"; to: boolean }
  | { type: "refused"; role: PmsRole | null; permission: AccessPermission };

export interface AccessChange {
  id: string;
  at: string;
  byUserId: string | null;
  kind: "role" | "member";
  subjectRole: PmsRole | null;
  subjectUserId: string | null;
  items: AccessChangeItem[];
}

/** The default access of a member with nothing stored. */
export function defaultMemberAccess(userId: string): MemberAccess {
  return { userId, active: true, allSites: true, sites: [], exceptions: {}, rev: 0, updatedAt: null, updatedBy: null };
}

/* ------------------------------------------------------------------------------------------------
 * Inputs
 * ----------------------------------------------------------------------------------------------*/

const RoleSchema = z.enum(["owner", "admin", "clinician", "staff"]);
const PermissionSchema = z.string().refine(isAccessPermission, "Not a permission");
const SiteIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Not a valid id");

/** Role grid save: the cells that change, each to its new value. */
export const RolePermissionChangesSchema = z
  .array(z.object({ role: RoleSchema, permission: PermissionSchema, allowed: z.boolean() }))
  .min(1, "Nothing to save")
  .max(ACCESS_PERMISSION_DEFS.length * 4);
export type RolePermissionChange = { role: PmsRole; permission: AccessPermission; allowed: boolean };

/** Member access save: the whole state of the form. */
export const MemberAccessInputSchema = z
  .object({
    exceptions: z.record(z.string(), z.boolean()).refine((r) => Object.keys(r).every(isAccessPermission), "Not a permission"),
    allSites: z.boolean(),
    sites: z.array(z.object({ siteId: SiteIdSchema, worksAt: z.boolean(), canSee: z.boolean() })).max(200),
  })
  .refine((v) => v.allSites || v.sites.some((s) => s.worksAt || s.canSee), { message: "Choose at least one site they can see, or switch on “Can see all sites”.", path: ["sites"] });
export type MemberAccessInput = { exceptions: Partial<Record<AccessPermission, boolean>>; allSites: boolean; sites: MemberSite[] };

/* ------------------------------------------------------------------------------------------------
 * Rules
 * ----------------------------------------------------------------------------------------------*/

/** Overrides as a lookup for one role. */
export function overridesFor(role: PmsRole, overrides: readonly RoleOverride[]): PermissionChoices {
  const out: Record<string, boolean> = {};
  for (const o of overrides) if (o.role === role) out[o.permission] = o.allowed;
  return out;
}

/** The cells a request asks to change that are locked (the server refuses the whole request). */
export function lockedRoleChanges(changes: readonly RolePermissionChange[]): RolePermissionChange[] {
  return changes.filter((c) => lockOf(c.role, c.permission) !== null);
}

/** The exceptions a request asks for that are locked for the member's role. */
export function lockedExceptions(role: PmsRole, exceptions: Partial<Record<AccessPermission, boolean>>): AccessPermission[] {
  return (Object.keys(exceptions) as AccessPermission[]).filter((p) => lockOf(role, p) !== null);
}

/**
 * Keeps only real exceptions: those that differ from what the role grants at this clinic (an "exception" equal to
 * the role is dropped, so the stored data always means "differs for this person").
 */
export function normaliseExceptions(role: PmsRole, exceptions: Partial<Record<AccessPermission, boolean>>, overrides: PermissionChoices): Partial<Record<AccessPermission, boolean>> {
  const out: Partial<Record<AccessPermission, boolean>> = {};
  for (const [p, v] of Object.entries(exceptions) as [AccessPermission, boolean][]) {
    if (!isAccessPermission(p) || typeof v !== "boolean") continue;
    if (v !== rolePermission(role, p, overrides)) out[p] = v;
  }
  return out;
}

/**
 * The sites a member may see: null = every site. Owner → every site. No stored access, or "all sites" → every site.
 * Otherwise works-at ∪ can-see (a site they work at is always visible).
 */
export function visibleSiteIds(role: string | null | undefined, access: Pick<MemberAccess, "allSites" | "sites"> | null): ReadonlySet<string> | null {
  if (role === "owner" || !access || access.allSites) return null;
  return new Set(access.sites.filter((s) => s.worksAt || s.canSee).map((s) => s.siteId));
}

/* ------------------------------------------------------------------------------------------------
 * Wording
 * ----------------------------------------------------------------------------------------------*/

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const allowedWord = (v: boolean) => (v ? "allowed" : "not allowed");

/** One history line in plain English ("Reception · Refunds and credit notes: not allowed → allowed"). */
export function describeChangeItem(item: AccessChangeItem): string {
  switch (item.type) {
    case "role_permission":
      return `${PMS_ROLE_LABELS[item.role]} · ${accessPermissionDef(item.permission).label}: ${allowedWord(item.from)} → ${allowedWord(item.to)}`;
    case "exception":
      return item.to === null
        ? `Back to the role default: “${accessPermissionDef(item.permission).label}”`
        : `${item.to ? "Added" : "Removed"} “${accessPermissionDef(item.permission).label}”`;
    case "role":
      return `Role: ${PMS_ROLE_LABELS[item.from]} → ${PMS_ROLE_LABELS[item.to]}`;
    case "sites":
      return item.allSites ? `Sites: can see all sites, works at ${item.worksAt}` : `Sites: works at ${item.worksAt}, can see ${item.canSee}`;
    case "active":
      return item.to ? "Clinic-system access switched back on" : "Clinic-system access switched off (deactivated)";
    case "refused":
      return `Refused – locked: ${item.role ? `${PMS_ROLE_LABELS[item.role]} · ` : ""}${accessPermissionDef(item.permission).label}`;
  }
}

export interface MemberSummaryLine {
  text: string;
  /** Differs from the role because of this person's exception. */
  exception: boolean;
}

export interface MemberSummary {
  can: MemberSummaryLine[];
  cannot: MemberSummaryLine[];
}

/** "What X can do" / "cannot do": every permission of the grid in plain words, with exceptions marked. */
export function memberSummary(role: string, overrides: PermissionChoices, exceptions: Partial<Record<AccessPermission, boolean>>, active = true): MemberSummary {
  const eff = effectivePermissions({ role, roleOverrides: overrides, exceptions, active });
  const can: MemberSummaryLine[] = [];
  const cannot: MemberSummaryLine[] = [];
  for (const d of ACCESS_PERMISSION_DEFS) {
    const p = d.id as AccessPermission;
    const on = eff.has(p);
    const locked = isPmsRole(role) ? lockOf(role, p) : null;
    const exception = !locked && typeof exceptions[p] === "boolean" && isPmsRole(role) && exceptions[p] !== rolePermission(role, p, overrides);
    const text = cap(d.phrase) + (!on && locked?.reason === LOCK_REASONS.noClinical ? " – never, for reception" : "");
    (on ? can : cannot).push({ text, exception });
  }
  return { can, cannot };
}

/** "Jess is a reception who works at Harbour Road and Kingsmead and can see 3 of 11 sites. 2 exceptions to the role." */
export function memberLead(first: string, role: PmsRole, worksAtNames: readonly string[], seeCount: number | "all", totalSites: number, exceptionCount: number): string {
  const label = PMS_ROLE_LABELS[role].toLowerCase();
  const article = /^[aeiou]/.test(label) ? "an" : "a";
  const works = worksAtNames.length === 0 ? "no sites yet" : worksAtNames.length === 1 ? worksAtNames[0] : `${worksAtNames.slice(0, -1).join(", ")} and ${worksAtNames[worksAtNames.length - 1]}`;
  const sees = seeCount === "all" || seeCount >= totalSites ? `all ${totalSites} ${totalSites === 1 ? "site" : "sites"}` : `${seeCount} of ${totalSites} sites`;
  const ex = exceptionCount === 0 ? "No exceptions to the role." : `${exceptionCount} ${exceptionCount === 1 ? "exception" : "exceptions"} to the role.`;
  return `${first} is ${article} ${label} who works at ${works} and can see ${sees}. ${ex}`;
}

/** The change history as CSV rows (Export log): when, who, what. No patient data is ever in it. */
export function historyCsv(changes: readonly AccessChange[], nameOf: (userId: string | null) => string, formatWhen: (iso: string) => string): string {
  const esc = (v: string) => safeCsvText(v);
  const lines = ["When,Who,What,Change"];
  for (const c of changes) {
    for (const item of c.items) lines.push([formatWhen(c.at), nameOf(c.byUserId), c.kind === "role" ? "Roles and permissions" : `Member access: ${nameOf(c.subjectUserId)}`, describeChangeItem(item)].map(esc).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** "28/10/2026 05:02" in UK time (Europe/London), for the history and its CSV. */
export function formatUkDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}
