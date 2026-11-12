/**
 * Navigation entries of the integration module (owned by the integration builder – contract §3). Band 70–79.
 * Import data lives under Set-up (reporting's "reporting.import" entry → /app/clinic/setup/import, M8), so the
 * integration module adds no entry of its own for it.
 *
 * API keys (public clinic API v1, xt03): a Set-up page for the clinic's owner. Behind the platform switch
 * CLINFORMS_CLINIC_API=on – the clinic layout leaves the entry out while it is off (CLINIC_API_NAV_ID).
 *
 * Xero (xe03–xe05): a Set-up page for owners and admins ("settings.setup"; the page also checks the role). Behind
 * CLINFORMS_XERO=on (XERO_NAV_ID).
 */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const CLINIC_API_NAV_ID = "integration.api";
/** Xero (xe03–xe05): owners and admins, behind CLINFORMS_XERO=on – left out by the clinic layout while it is off. */
export const XERO_NAV_ID = "integration.xero";

export const INTEGRATION_NAV: readonly PmsNavEntry[] = [
  { id: CLINIC_API_NAV_ID, module: "integration", label: "API keys", href: `${CLINIC_BASE_PATH}/setup/api`, order: 70, permission: "settings.owner", group: "manage" },
  { id: XERO_NAV_ID, module: "integration", label: "Xero", href: `${CLINIC_BASE_PATH}/setup/xero`, order: 71, permission: "settings.setup", group: "manage" },
];
