/**
 * Navigation entries of the integration module (owned by the integration builder – contract §3). Band 70–79.
 * Import data lives under Set-up (reporting's "reporting.import" entry → /app/clinic/setup/import, M8), so the
 * integration module adds no entry of its own for it.
 *
 * API keys (public clinic API v1, xt03): a Set-up page for the clinic's owner. Behind the platform switch
 * CLINFORMS_CLINIC_API=on – the clinic layout leaves the entry out while it is off (CLINIC_API_NAV_ID).
 */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const CLINIC_API_NAV_ID = "integration.api";

export const INTEGRATION_NAV: readonly PmsNavEntry[] = [
  { id: CLINIC_API_NAV_ID, module: "integration", label: "API keys", href: `${CLINIC_BASE_PATH}/setup/api`, order: 70, permission: "settings.owner", group: "manage" },
];
