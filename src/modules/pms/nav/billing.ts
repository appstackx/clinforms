/** Navigation entries of the billing module (owned by the billing builder – contract §3). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const BILLING_BASE_PATH = `${CLINIC_BASE_PATH}/billing`;

/**
 * "Billing" in the main navigation (billing.view). Billing settings (VAT, numbering, terms, bank details) have no
 * screen yet – they come with Set-up (M8); until then the defaults apply (pms_billing_settings).
 */
export const BILLING_NAV: readonly PmsNavEntry[] = [{ id: "billing.home", module: "billing", label: "Billing", href: BILLING_BASE_PATH, order: 30, permission: "billing.view", group: "main" }];
