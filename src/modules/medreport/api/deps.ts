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
import type { ConnectorId, TenantId, TokenUsage } from "../core/types";
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
  /**
   * The clinic's trial (10/2026, the host's clinic_plan), when it has one; absent = no trial. "pending" = it starts
   * when an owner first opens the clinic area; "ended" = nothing new can be created (reports, drafts, uploads,
   * form readings – auth/clinic-access.ts), existing records stay readable and downloadable.
   */
  trial?: { state: "pending" | "running" | "ended"; endsAt?: string; daysLeft?: number };
  /** The clinic's own drafting limits (10/2026, set by ClinForms staff); absent = the deployment's defaults. */
  draftingLimits?: { perMinute?: number; perDay?: number };
  /** Where the clinic asks about its account (shown when the trial has ended). */
  contactEmail?: string;
  /**
   * A DEMO clinic (the host's clinic_plan.demo_clinic, migration 0008, set by ClinForms platform staff only): made-up
   * data only. Every output then carries the demonstration notice (core/demo-clinic.ts demoOutputNotice: POST /render,
   * POST /forms/fill-preview), and members' made-up PH-DEMO-NN numbers may approve (POST /sign refuses them in any
   * other clinic: 403 DEMO_NUMBER_NOT_ALLOWED). Absent / false = a real clinic, unchanged.
   */
  demoClinic?: boolean;
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
  /** Count one hit (or `amount` – fix wave 2, e.g. kilobytes stored) for `key` in the current fixed window of `windowMs`. Atomic. */
  hit(key: string, windowMs: number, amount?: number): Promise<SharedCounterWindow>;
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

/**
 * A usage event of a clinic (25/10/2026 – packages and usage): what the counters of the clinic's month record. Ids,
 * counts and token totals only – never patient data. The host decides how a report counts (once: at its first live
 * drafting, or at its first approval when nothing was drafted – src/server/repos/usage.ts).
 */
export type UsageEvent =
  /** A new report was stored for the clinic (POST/PUT create in the clinic's storage). */
  | { kind: "report_started"; reportId: string; amendsReportId?: string }
  /**
   * One live drafting call (POST /drafts in live mode), successful (answers drafted) or not. `reportId` = the report
   * being drafted (the Studio always sends it); `usage`/`model` when the drafting service answered.
   */
  | { kind: "drafting_call"; reportId?: string; amendsReportId?: string; succeeded: boolean; model?: string; usage?: TokenUsage }
  /**
   * A referrer form reading (POST /forms/analyse): `read` = a proposed map came back; `liveCalls` = successful live
   * calls (a long form is read in parallel parts), `failedCalls` = live calls that failed (the reading then fell back
   * to a stored map or rules, or failed); `usage`/`model` = the tokens of the live calls.
   */
  | { kind: "form_read"; read: boolean; liveCalls: number; failedCalls: number; model?: string; usage?: TokenUsage }
  /** A report was approved (POST /sign issued a receipt). */
  | { kind: "report_approved"; reportId: string; amendsReportId?: string }
  /** A portal question set was stored for the clinic for the first time. */
  | { kind: "question_set_created"; formId: string };

/** The host's usage counters (src/server/usage/recorder.ts). Best effort: the module never lets it fail a request. */
export interface UsageRecorder {
  record(tenantId: TenantId, event: UsageEvent): Promise<void>;
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
  /**
   * 25/10/2026: the clinic's usage counters (packages and usage). Called for clinic members only – never for the
   * public demo – through api/usage.ts recordUsage(), which never fails or blocks the request (errors are logged).
   */
  usage?: UsageRecorder;
}
