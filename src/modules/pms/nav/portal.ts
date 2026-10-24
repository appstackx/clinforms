/** Navigation entries of the portal module (owned by the portal builder – contract §3). Band 50–59. */
import type { PmsNavEntry } from "../core/nav";
import { STAFF_PORTAL_PATHS } from "../portal/paths";

export const PORTAL_NAV: readonly PmsNavEntry[] = [
  { id: "portal.online_booking", module: "portal", label: "Online booking", href: STAFF_PORTAL_PATHS.onlineBooking, order: 50, permission: "diary.view", group: "main" },
  { id: "portal.forms", module: "portal", label: "Patient forms", href: STAFF_PORTAL_PATHS.intake, order: 51, permission: "patients.view", group: "main" },
  { id: "portal.setup", module: "portal", label: "Online booking set-up", href: STAFF_PORTAL_PATHS.settings, order: 55, permission: "booking.manage", group: "manage" },
];
