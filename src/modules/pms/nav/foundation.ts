/** Navigation entries of the foundation (the clinic overview). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const FOUNDATION_NAV: readonly PmsNavEntry[] = [
  { id: "foundation.overview", module: "foundation", label: "Overview", href: CLINIC_BASE_PATH, order: 0, permission: "clinic.view", group: "main" },
];
