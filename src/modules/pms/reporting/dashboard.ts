/**
 * The clinic system's start page – "Today" (design round 3: dashboard per role, 1440 and 375 px). Pure view model:
 * the server (src/server/pms/reporting/dashboard.ts) fills it from the modules' own read functions, the client
 * (src/components/pms/reporting/dashboard.tsx) draws it. Each tile is shown only to who may see its data, and a
 * tile whose data could not be read says so on its own ("Couldn't load") without hiding the rest.
 */

/** Which day-to-day view: owners and administrators, clinicians, reception (ClinForms role "staff"). */
export type DashboardRole = "manager" | "clinician" | "reception";

export type DashboardIcon = "calendar" | "chart" | "pound" | "alert" | "file" | "users" | "user-check" | "message" | "clock" | "shield";

export type PillTone = "blue" | "amber" | "teal" | "red" | "green";

export interface DashboardPill {
  tone: PillTone;
  label: string;
  icon: DashboardIcon | "activity" | "x" | "send";
}

/** A button on a list row (runs a server action on the client) or a link styled as one. */
export type DashboardAction =
  | { kind: "retry"; messageId: string; label: string }
  | { kind: "arrived"; appointmentId: string; rev: number; label: string }
  | { kind: "send-reminder"; invoiceId: string; label: string }
  | { kind: "payment-link"; invoiceId: string; label: string }
  | { kind: "link"; href: string; label: string; primary?: boolean };

export interface DashboardKpi {
  id: string;
  label: string;
  icon: DashboardIcon;
  /** null = could not be read. */
  value: string | null;
  sub: string;
  href: string | null;
  /** Red figure (overdue money, unsigned notes). */
  warn?: boolean;
}

export interface DashboardListItem {
  id: string;
  /** A time ("10:30") before the name. */
  lead?: string | null;
  primary: string;
  href?: string | null;
  secondary: string;
  /** The patient's record carries medical alerts (never the text). */
  alert?: boolean;
  pill?: DashboardPill | null;
  action?: DashboardAction | null;
}

export interface DashboardBar {
  id: string;
  label: string;
  /** 0–100 (rounded). */
  percent: number;
  /** At or above the target – darker bar. */
  onTarget: boolean;
}

export interface DashboardCard {
  id: string;
  title: string;
  /** The number in the grey/red badge, or null for none. */
  count: number | null;
  /** "5 of 11 sites" instead of a number. */
  countLabel?: string | null;
  warn?: boolean;
  link: { href: string; text: string } | null;
  kind: "list" | "bars";
  /** Could not be read: "Couldn't load this card." */
  failed?: boolean;
  items: DashboardListItem[];
  bars: DashboardBar[];
  /** Bars: the target line (percent). */
  target?: number | null;
  empty: { title: string; body: string };
}

export interface DashboardView {
  role: DashboardRole;
  /** "Wednesday 28/10/2026 · my 5 sites" */
  subtitle: string;
  /** "Updated 10:40" (UK time). */
  updatedAt: string;
  kpis: DashboardKpi[];
  cards: DashboardCard[];
  /** Some tiles could not be read. */
  partial: boolean;
  /** The clinic has no sites yet (a new clinic): Today points to Set-up. */
  noSites: boolean;
}

/** £1,234.56 */
export function pounds(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The day-to-day view a role gets (an unknown role gets reception's – the narrowest). */
export function dashboardRoleOf(role: string): DashboardRole {
  if (role === "owner" || role === "admin") return "manager";
  if (role === "clinician") return "clinician";
  return "reception";
}

/** "82%" or "–" without available time. */
export function percentText(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}
