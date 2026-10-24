/** Navigation entries of the comms module (owned by the comms builder – contract §3). Band 40–49. */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const COMMS_NAV: readonly PmsNavEntry[] = [
  { id: "comms.messages", module: "comms", label: "Messages", href: `${CLINIC_BASE_PATH}/messages`, order: 40, permission: "messages.view", group: "main" },
  { id: "comms.letters", module: "comms", label: "Letters", href: `${CLINIC_BASE_PATH}/letters`, order: 41, permission: "clinical.view", group: "main" },
  { id: "comms.templates", module: "comms", label: "Message templates", href: `${CLINIC_BASE_PATH}/messages/templates`, order: 45, permission: "messages.manage", group: "manage" },
  { id: "comms.reminders", module: "comms", label: "Reminders", href: `${CLINIC_BASE_PATH}/messages/settings`, order: 46, permission: "messages.manage", group: "manage" },
  { id: "comms.letter-templates", module: "comms", label: "Letter templates", href: `${CLINIC_BASE_PATH}/letters/templates`, order: 47, permission: "messages.manage", group: "manage" },
];
