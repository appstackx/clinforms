/**
 * What the Set-up pages hand their screens (pure types, browser-safe). Built by src/server/pms/reporting/setup.ts
 * and audit-trail.ts.
 */
import type { ContributionMode } from "../billing/excess";
import type { PmsRole } from "../core/permissions";
import type { Practitioner, PriceList, PriceListItem, Referrer, Service, Site } from "../core/types";
import type { AuditArea } from "./audit-search";

export interface DayHours {
  weekday: number;
  open: boolean;
  from: string;
  to: string;
}

export interface ClosureView {
  id: string;
  /** null = every site. */
  siteId: string | null;
  startsOn: string;
  endsOn: string;
  reason: string | null;
}

export interface SitesScreen {
  sites: (Site & { rooms: number })[];
  selected: { site: Site; days: DayHours[]; hoursSet: boolean; closures: ClosureView[]; canEdit: boolean } | null;
  canAddSite: boolean;
}

export interface PricesScreen {
  lists: PriceList[];
  selected: { list: PriceList; items: PriceListItem[] } | null;
  services: Service[];
  payers: Referrer[];
}

export interface ReferrersScreen {
  referrers: Referrer[];
  selected: { referrer: Referrer; payer: { mode: ContributionMode; priceLists: PriceList[]; accountTermsDays: number } | null } | null;
  priceLists: PriceList[];
}

export interface PractitionersScreen {
  practitioners: Practitioner[];
  selected: Practitioner | null;
  /** The clinic's members; `linkedTo` = the practitioner they are already linked to. */
  members: { userId: string; name: string; email: string; role: PmsRole; linkedTo: string | null }[];
  sites: Site[];
}

/** The clinic's report targets (no row = 80 % / 4.0 %). */
export interface ReportTargets {
  /** 0 = no row yet (the defaults). */
  rev: number;
  utilisationTargetPercent: number;
  /** Tenths of a percent (40 = 4.0 %). */
  dnaTargetTenths: number;
}

export interface AuditRow {
  id: string;
  at: string;
  who: string;
  action: string;
  label: string;
  recordType: string;
  recordId: string | null;
  /** Field names, counts, statuses (never patient data – that is the audit rule). */
  detail: string;
}

export interface AuditScreen {
  rows: AuditRow[];
  hasOlder: boolean;
  hasNewer: boolean;
  areas: AuditArea[];
  members: { userId: string; name: string }[];
  types: { id: string; label: string }[];
  canExport: boolean;
}
