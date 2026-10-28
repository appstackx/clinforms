/** Navigation entries of the portal module (owned by the portal builder – contract §3). Band 50–59. */
import type { PmsNavEntry } from "../core/nav";
import { STAFF_PORTAL_PATHS } from "../portal/paths";

export const PORTAL_NAV: readonly PmsNavEntry[] = [
  { id: "portal.setup", module: "portal", label: "Online booking", href: STAFF_PORTAL_PATHS.onlineBooking, order: 55, permission: "settings.setup", group: "manage" },
  { id: "portal.forms", module: "portal", label: "Intake forms", href: STAFF_PORTAL_PATHS.intake, order: 56, permission: "settings.setup", group: "manage" },
];
