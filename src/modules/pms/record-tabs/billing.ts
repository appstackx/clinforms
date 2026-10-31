/** Patient record tabs of the billing module (owned by the billing builder – contract §3). */
import type { PmsRecordTab } from "../core/record-tabs";

export const BILLING_RECORD_TABS: readonly PmsRecordTab[] = [{ id: "billing.invoices", module: "billing", label: "Invoices", segment: "invoices", order: 30, permission: "billing.view" }];
