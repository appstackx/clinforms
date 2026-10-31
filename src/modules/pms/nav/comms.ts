/** Navigation entries of the comms module (owned by the comms builder – contract §3). Band 40–49. */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const MESSAGES_PATH = `${CLINIC_BASE_PATH}/messages`;
export const LETTERS_PATH = `${CLINIC_BASE_PATH}/letters`;

/**
 * "Messages" in the main navigation (messages.send – everyone by default; a badge counts the replies waiting for
 * someone). Its tabs hold the outbox, replies, templates, letters and "Send a message" (design round 2c). Message
 * settings (quiet hours, reminders, confirmations) sit in Set-up (messages.templates).
 */
export const COMMS_NAV: readonly PmsNavEntry[] = [
  { id: "comms.messages", module: "comms", label: "Messages", href: MESSAGES_PATH, order: 40, permission: "messages.send", group: "main" },
  { id: "comms.settings", module: "comms", label: "Message settings", href: `${MESSAGES_PATH}/settings`, order: 45, permission: "messages.templates", group: "manage" },
];
