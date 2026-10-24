/** Patient record tabs of the comms module (owned by the comms builder – contract §3). */
import type { PmsRecordTab } from "../core/record-tabs";

export const COMMS_RECORD_TABS: readonly PmsRecordTab[] = [
  { id: "comms.messages", module: "comms", label: "Messages and letters", segment: "messages", order: 40, permission: "messages.view" },
];
