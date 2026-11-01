/**
 * The offer of the full clinic management system to a ClinForms clinic (01/11/2026, Khuram's R2) – browser-safe and
 * pure. Shown on the ClinForms app's Overview (dismissible per person, a host-only cookie) and on Plan and billing
 * (always, while it applies). Owners and admins only – they are the ones who can buy it (the billing page's rule);
 * nobody else sees it. Never shown to a clinic that has the clinic system, or to a clinic of the clinic brand.
 */
import { BRANDS, CLINFORMS_NAME, CLINIC_SYSTEM_NAME, type BrandId } from "./brand";

/** Plan and billing, opened on the clinic system's plans (the running ClinForms plan is changed in place). */
export const CLINDESK_OFFER_BUY_HREF = "/app/settings/billing?product=clindesk";

/** The cookie that hides the offer on the Overview for this browser (host-only, 180 days). */
export const CLINDESK_OFFER_COOKIE = "cf_clinic_offer_hidden";
export const CLINDESK_OFFER_COOKIE_DAYS = 180;

export const CLINDESK_OFFER = {
  title: `Run your whole clinic with ${CLINIC_SYSTEM_NAME}`,
  pitch: `The full clinic management system: the diary, patient notes, billing, the patient portal and text reminders – with your ${CLINFORMS_NAME} reports built in.`,
  features: ["Diary and online booking", "Patient records and notes", "Invoices and payments", "Patient portal and text reminders"],
  switchNote: `Your ${CLINFORMS_NAME} reports carry on: your plan becomes a ${CLINIC_SYSTEM_NAME} plan with the Reports add-on, and any difference is charged today.`,
  /**
   * V-01 (01/11/2026): a ClinForms clinic choosing a clinic-system plan WITHOUT the Reports add-on – shown under the
   * add-on choice, which starts on the smallest add-on for such a clinic, so its reports are never dropped silently.
   */
  dropReportsWarning: `Without the Reports add-on your ${CLINFORMS_NAME} reports stop when the ${CLINIC_SYSTEM_NAME} plan starts. Choose an allowance to keep them.`,
  buy: `See ${CLINIC_SYSTEM_NAME} plans`,
  info: "See what is included",
  infoHref: `${BRANDS.clinic.siteUrl}/features`,
  hide: "Hide this",
} as const;

/**
 * The Reports add-on a clinic-system plan form starts on (V-01): the current clinic-system plan's; a running ClinForms
 * plan's matching allowance; a clinic that has Reports now (`keepReports`: a ClinForms clinic, plan or no plan) the
 * smallest add-on; otherwise none.
 */
export function defaultReportsAddon(input: {
  current: { product: "clindesk"; reports?: string | null } | { product: "clinforms" } | null;
  matchingAddon: string | null;
  smallestAddon: string | null;
  keepReports: boolean;
}): string {
  const c = input.current;
  if (c?.product === "clindesk") return c.reports ?? "none";
  if (c?.product === "clinforms") return input.matchingAddon ?? input.smallestAddon ?? "none";
  return input.keepReports ? (input.smallestAddon ?? "none") : "none";
}

/** Whether a member sees the offer: a ClinForms clinic without the clinic system, and an owner or admin. */
export function showClinDeskOffer(input: { clinicSystem: boolean; clinicBrand: BrandId; role: string }): boolean {
  if (input.clinicSystem || input.clinicBrand !== "clinforms") return false;
  return input.role === "owner" || input.role === "admin";
}
