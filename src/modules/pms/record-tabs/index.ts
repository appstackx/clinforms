/** Every module's patient record tabs (orchestrator-owned aggregator: builders edit only record-tabs/<module>.ts). */
import type { PmsRecordTab } from "../core/record-tabs";
import { BILLING_RECORD_TABS } from "./billing";
import { COMMS_RECORD_TABS } from "./comms";
import { DIARY_RECORD_TABS } from "./diary";
import { INTEGRATION_RECORD_TABS } from "./integration";
import { PORTAL_RECORD_TABS } from "./portal";
import { RECORDS_RECORD_TABS } from "./records";
import { REPORTING_RECORD_TABS } from "./reporting";

export const PMS_RECORD_TABS: readonly PmsRecordTab[] = [
  ...RECORDS_RECORD_TABS,
  ...DIARY_RECORD_TABS,
  ...BILLING_RECORD_TABS,
  ...COMMS_RECORD_TABS,
  ...PORTAL_RECORD_TABS,
  ...REPORTING_RECORD_TABS,
  ...INTEGRATION_RECORD_TABS,
];
