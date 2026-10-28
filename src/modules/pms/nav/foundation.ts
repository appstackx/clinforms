import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const FOUNDATION_NAV: readonly PmsNavEntry[] = [
  { id: "foundation.overview", module: "foundation", label: "Overview", href: CLINIC_BASE_PATH, order: 0, permission: "clinic.view", group: "main" },
  // Configurable access (owners and admins by default: "Manage members and permissions").
  { id: "foundation.staff-access", module: "foundation", label: "Staff access", href: `${CLINIC_BASE_PATH}/access`, order: 7, permission: "settings.members", group: "manage" },
  { id: "foundation.roles", module: "foundation", label: "Roles and permissions", href: `${CLINIC_BASE_PATH}/access/roles`, order: 8, permission: "settings.members", group: "manage" },
];
