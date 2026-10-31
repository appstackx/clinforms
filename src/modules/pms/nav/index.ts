/** Every module's navigation entries (orchestrator-owned aggregator: builders edit only their own nav/<module>.ts). */
import type { PmsNavEntry } from "../core/nav";
import { BILLING_NAV } from "./billing";
import { COMMS_NAV } from "./comms";
import { DIARY_NAV } from "./diary";
import { FOUNDATION_NAV } from "./foundation";
import { INTEGRATION_NAV } from "./integration";
import { PORTAL_NAV } from "./portal";
import { RECORDS_NAV } from "./records";
import { REPORTING_NAV } from "./reporting";

export const PMS_NAV: readonly PmsNavEntry[] = [
  ...FOUNDATION_NAV,
  ...DIARY_NAV,
  ...RECORDS_NAV,
  ...BILLING_NAV,
  ...COMMS_NAV,
  ...PORTAL_NAV,
  ...REPORTING_NAV,
  ...INTEGRATION_NAV,
];
