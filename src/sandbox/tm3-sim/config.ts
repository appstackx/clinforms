/**
 * Simulated TM3 sandbox – constants. Demo scaffolding, NOT the product.
 * The sandbox may not import src/modules/medreport (they talk over HTTP only).
 *
 * Owner: sandbox agent.
 */

/** Must appear on every sandbox screen and response. Never imply a partnership with TM3. */
export const SANDBOX_LABEL = "Simulated TM3 sandbox – demo data, not affiliated with TM3" as const;

/** Shown on filed documents in the sandbox Documents tab. */
export const BROWSER_RECORD_LABEL = "stored in this browser – simulated record" as const;

export const SIM_API_BASE = "/api/tm3-sim/v1" as const;

/** Report API endpoint the sandbox server calls (server-to-server, with the partner key). */
export const REPORT_API_LAUNCH_PATH = "/api/reports/v1/launch" as const;

/**
 * Fixed demo fallbacks (duplicated from the module's config.server.ts – keep in step). Used only when
 * the env var is unset in a demo deployment.
 */
export const DEMO_FALLBACKS = {
  TM3_SIM_TOKEN: "demo-only-tm3-sim-token-v1",
  MEDREPORT_PARTNER_KEY: "demo-only-partner-key-v1",
} as const;

/** Browser storage keys used by the sandbox. */
export const SANDBOX_STORAGE = {
  documentsKey: "tm3sim.documents",
  idbName: "tm3sim",
  idbStore: "documents",
} as const;
