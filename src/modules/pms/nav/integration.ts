/** Navigation entries of the integration module (owned by the integration builder – contract §3). Band 70–79. */
import type { PmsNavEntry } from "../core/nav";

export const INTEGRATION_NAV: readonly PmsNavEntry[] = [
  { id: "integration.import", module: "integration", label: "Import data", href: "/app/clinic/import", order: 75, permission: "settings.import", group: "manage" },
];
