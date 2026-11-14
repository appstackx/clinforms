/** Navigation entries of the billing module (owned by the billing builder – contract §3). */
import type { PmsNavEntry } from "../core/nav";
import { CLINIC_BASE_PATH } from "../core/modules";

export const BILLING_BASE_PATH = `${CLINIC_BASE_PATH}/billing`;

/** Set-up → Card payments (the clinic's own payment account). Behind CLINFORMS_CARD_PAYMENTS=on – the clinic layout leaves it out while off. */
export const CARD_PAYMENTS_NAV_ID = "billing.card-payments";

/**
 * "Billing" in the main navigation (billing.view). Billing settings (VAT, numbering, terms, bank details) have no
 * screen yet – they come with Set-up (M8); until then the defaults apply (pms_billing_settings).
 */
export const BILLING_NAV: readonly PmsNavEntry[] = [
  { id: "billing.home", module: "billing", label: "Billing", href: BILLING_BASE_PATH, order: 30, permission: "billing.view", group: "main" },
  // Healthcode groundwork (HC09): each insurer's treatment code per service – a Set-up page.
  // Courses (PK02): the blocks of sessions the clinic sells – a Set-up page.
  { id: "billing.courses", module: "billing", label: "Courses", href: `${CLINIC_BASE_PATH}/setup/courses`, order: 32, permission: "settings.setup", group: "manage" },
  // Products (PK05): what the clinic sells over the counter – a Set-up page (stock is under Billing → Stock).
  { id: "billing.products", module: "billing", label: "Products", href: `${CLINIC_BASE_PATH}/setup/products`, order: 33, permission: "settings.setup", group: "manage" },
  { id: CARD_PAYMENTS_NAV_ID, module: "billing", label: "Card payments", href: `${CLINIC_BASE_PATH}/setup/card-payments`, order: 34, permission: "settings.owner", group: "manage" },
  { id: "billing.insurer-codes", module: "billing", label: "Insurer codes", href: `${CLINIC_BASE_PATH}/setup/insurer-codes`, order: 31, permission: "settings.setup", group: "manage" },
];
