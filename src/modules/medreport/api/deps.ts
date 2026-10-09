import "server-only";

/**
 * Dependencies the Report API handlers receive from the host app. The module never imports the
 * sandbox or the app; `src/app/api/_medreport-glue.ts` builds these (connector registry with the
 * tm3-sim connector, in-process transport, credentials) and binds them to each route.
 *
 * Shared contract (orchestrator-owned): additive optional members only.
 */
import type { ConnectorContext, ConnectorRegistry } from "../connectors/types";
import type { ConnectorId, TenantId } from "../core/types";
import type { TenantStore } from "./store-port";

/** A clinic member's role (docs/production-architecture.md §3). */
export type MemberRole = "owner" | "admin" | "clinician" | "staff";

/**
 * Who is calling, worked out by the HOST from its own sign-in (Better Auth session + active clinic): the
 * module never reads cookies itself. Built by src/server/auth/medreport-actor.ts.
 */
export interface AuthContext {
  userId: string;
  /** The sign-in session's id (audit trail; not a secret). */
  authSessionId: string;
  /** The active clinic (= its organization slug). */
  tenantId: TenantId;
  role: MemberRole;
  /** The signer identity from the member's clinic profile, when they have one. */
  clinician?: {
    name: string;
    hcpc?: string;
    jobTitle?: string;
    /** The clinic allows this member to sign (approve) forms. */
    canSign: boolean;
  };
  /** The member has two-step verification on (sessions are only issued after the second factor then). */
  twoFactorVerified: boolean;
}

/** The clinic written into referrer forms in tenant mode (replaces DEMO_CLINIC there). */
export interface ClinicProfile {
  tenantId: TenantId;
  displayName: string;
  legalName?: string;
  addressLines: string[];
  postcode?: string;
  phone?: string;
  email?: string;
  retentionDays: number;
  draftingEnabled: boolean;
}

export interface MedreportDeps {
  connectors: ConnectorRegistry;
  /**
   * Build the per-request connector context: credentials (e.g. Bearer TM3_SIM_TOKEN for tm3-sim),
   * base URL (TM3_SIM_BASE_URL or the request origin), transport (HTTP with in-process fallback) and an
   * empty trace array the handler returns to the client.
   */
  createConnectorContext(req: Request, connectorId: ConnectorId, tenantId: TenantId): ConnectorContext;
  /**
   * Tenant mode (wave 2): the signed-in member behind this request, or null when there is none. Absent in
   * the public demo. Not used by any handler yet.
   */
  authenticate?(req: Request): Promise<AuthContext | null>;
  /** Tenant mode (wave 2): the clinic's profile, or null. Not used by any handler yet. */
  clinicProfile?(tenantId: TenantId): Promise<ClinicProfile | null>;
  /**
   * Tenant mode (wave 2, docs/production-architecture.md §5): the clinic's server storage for the Studio
   * (reports, form maps, form files, settings, audit), used by the /store/** handlers and by /render and
   * /forms/fill-preview to read a stored form file. Built by the host (src/server/store/tenant-store.ts).
   * Absent in the public demo: the store endpoints then answer 501.
   */
  tenantStore?: TenantStore;
}
