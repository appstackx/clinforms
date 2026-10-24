/** Navigation entries of the billing module (owned by the billing builder – contract §3). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const BILLING_BASE_PATH = `${CLINIC_BASE_PATH}/billing`;

export const BILLING_NAV: readonly PmsNavEntry[] = [
  { id: "billing.home", module: "billing", label: "Billing", href: BILLING_BASE_PATH, order: 30, permission: "billing.view", group: "main" },
  { id: "billing.settings", module: "billing", label: "Billing settings", href: `${BILLING_BASE_PATH}/settings`, order: 39, permission: "billing.manage", group: "manage" },
];

/** The billing area's own tabs (src/app/app/clinic/billing/layout.tsx). */
export const BILLING_SECTIONS: readonly { href: string; label: string; exact?: boolean }[] = [
  { href: BILLING_BASE_PATH, label: "Invoices", exact: true },
  { href: `${BILLING_BASE_PATH}/payments`, label: "Payments" },
  { href: `${BILLING_BASE_PATH}/accounts`, label: "Accounts" },
  { href: `${BILLING_BASE_PATH}/debtors`, label: "Debtors" },
  { href: `${BILLING_BASE_PATH}/e-billing`, label: "Insurer billing" },
  { href: `${BILLING_BASE_PATH}/prices`, label: "Prices" },
];
