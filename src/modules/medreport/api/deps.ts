import "server-only";

/**
 * Dependencies the Report API handlers receive from the host app. The module never imports the
 * sandbox or the app; `src/app/api/_medreport-glue.ts` builds these (connector registry with the
 * tm3-sim connector, in-process transport, credentials, sign-in, shared state, audit trail) and binds
 * them to each route.
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
  /** The member's display name (from the account). Wave 2: recorded as who confirmed a form map. */
  name?: string;
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

/** One fixed window of a shared counter (rate_limits). */
export interface SharedCounterWindow {
  /** Hits in this window (including the one just counted, for hit()). */
  count: number;
  /** When the window ends (ISO). */
  resetAt: string;
}

/**
 * State shared by every server instance (wave 2: the database tables `rate_limits` and
 * `launch_token_uses`). The module falls back to per-instance memory when this is absent or fails –
 * except where a missing shared store would weaken a clinic's security (see auth/shared-limits.ts).
 */
export interface SharedStateStore {
  /** Count one hit for `key` in the current fixed window of `windowMs`. Atomic. */
  hit(key: string, windowMs: number): Promise<SharedCounterWindow>;
  /** The current window's count without counting a hit. */
  peek(key: string, windowMs: number): Promise<SharedCounterWindow>;
  /** Forget every window of `key`. */
  reset(key: string): Promise<void>;
  /** Single use: true the first time `id` is claimed, false on every later attempt (until `expiresAt`). */
  claimOnce(id: string, expiresAt: string): Promise<boolean>;
}

/** An audit-trail row (append-only). Ids, actions and counts only – never patient data. */
export interface AuditEvent {
  userId?: string | null;
  sessionId?: string | null;
  /** e.g. "report.sign" – [a-z0-9_.:-], ≤ 64. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Small JSON (≤ 4 KB). No names, notes or answers. */
  detail?: Record<string, unknown> | null;
}

/** A clinic's partner (API) key, as verified by the host. */
export interface VerifiedPartnerKey {
  id: string;
  tenantId: TenantId;
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
   * Tenant mode: the signed-in member behind this request, or null when there is none (no sign-in
   * cookie). May throw an api/http HttpError (e.g. 403 when the session has no active clinic).
   * Used by auth/actor.ts requireActor(). Absent → only the public demo works.
   */
  authenticate?(req: Request): Promise<AuthContext | null>;
  /** Tenant mode: the clinic's profile, or null. */
  clinicProfile?(tenantId: TenantId): Promise<ClinicProfile | null>;
  /** Wave 2: shared counters and single-use ids (rate limits, passcode guesses, launch-token replay). */
  sharedState?: SharedStateStore;
  /** Wave 2: append a row to the clinic's audit trail (tenant actors only; never the demo). */
  audit?(tenantId: TenantId, event: AuditEvent): Promise<void>;
  /** Wave 2: a clinic's partner key (`x-partner-key` on POST /launch) → its tenant, or null when unknown/revoked. */
  verifyPartnerKey?(key: string): Promise<VerifiedPartnerKey | null>;
  /**
   * Tenant mode (wave 2, docs/production-architecture.md §5): the clinic's server storage for the Studio
   * (reports, form maps, form files, settings, audit), used by the /store/** handlers and by /render and
   * /forms/fill-preview to read a stored form file. Built by the host (src/server/store/tenant-store.ts).
   * Absent in the public demo: the store endpoints then answer 501.
   */
  tenantStore?: TenantStore;
}
