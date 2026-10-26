/**
 * Words of the reports and set-up screens (pure, UK English, neutral – no product, vendor or technology names;
 * the product name only through src/lib/brand.ts in host code). Labels of the shared record's enumerations are
 * here too because the set-up screens are their first users (other modules may import them).
 */
import type { PayerType, Profession, ReferrerKind, ServiceCategory } from "../core/types";
import type { DebtBucket } from "./metrics";

export const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const PAYER_TYPE_LABELS: Readonly<Record<PayerType, string>> = {
  self_pay: "Self-pay",
  insurer: "Insurer",
  mlc: "Medico-legal company",
  solicitor: "Solicitor",
  employer: "Employer",
  other: "Other",
};

export const REFERRER_KIND_LABELS: Readonly<Record<ReferrerKind, string>> = {
  gp: "GP",
  consultant: "Consultant",
  insurer: "Insurer",
  mlc: "Medico-legal company",
  solicitor: "Solicitor",
  employer: "Employer",
  case_manager: "Case manager",
  self: "Self-referral",
  other: "Other",
};

export const PROFESSION_LABELS: Readonly<Record<Profession, string>> = {
  physiotherapist: "Physiotherapist",
  sports_therapist: "Sports therapist",
  osteopath: "Osteopath",
  chiropractor: "Chiropractor",
  podiatrist: "Podiatrist",
  massage_therapist: "Massage therapist",
  other: "Other",
};

export const SERVICE_CATEGORY_LABELS: Readonly<Record<ServiceCategory, string>> = {
  initial: "Initial appointment",
  follow_up: "Follow-up",
  assessment: "Assessment",
  treatment: "Treatment",
  class: "Class",
  admin: "Administration",
  other: "Other",
};

export const DEBT_BUCKET_LABELS: Readonly<Record<DebtBucket, string>> = {
  not_due: "Not yet due",
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d91_plus: "Over 90 days",
};

export const AUTHORISATION_REASON_LABELS = {
  expires_soon: "Expires soon",
  expired_recently: "Expired",
  few_sessions_left: "1 session or fewer left",
  little_value_left: "Little value left",
  used_up: "Used up",
} as const;

export const REPORTS_COPY = {
  title: "Reports",
  intro: "Figures for the period and sites you choose. Downloads hold the same figures as the screen.",
  periodLabel: "Period",
  fromLabel: "From",
  toLabel: "To",
  siteLabel: "Site",
  allSites: "All sites",
  yourSites: "Your sites",
  practitionerLabel: "Practitioner",
  allPractitioners: "All practitioners",
  apply: "Show",
  download: "Download (CSV)",
  downloadNote: "The download is recorded in the clinic's audit trail.",
  needsDiary: "These figures come from the diary. They appear once appointments are booked in the diary.",
  needsBilling: "These figures come from invoicing. They appear once invoices are raised in the clinic system.",
  noData: "Nothing in this period.",
  previous: "previous period",
  limitedSites: "You see the sites you work at only.",
  attendanceDefinition:
    "Rates are out of the appointments that were due: attended, did not attend and late cancellations. Appointments cancelled in good time are left out; past appointments not yet marked are counted as not recorded.",
  utilisationDefinition:
    "Booked time (including did-not-attend and late cancellations, which still used the time) against available time: opening hours less closures for sites and rooms (a site counts each room), working hours from the diary for practitioners.",
  patientsDefinition:
    "A patient is new when their first case with the clinic opened in the period, and returning when they had an earlier case. Once the diary is in use, new and returning also count attended appointments.",
  revenueDefinition: "Invoiced and credited by the date of the invoice or credit note; received by the date of the payment. Void invoices are left out.",
  debtDefinition: "What is still owed on each invoice after payments and credit notes, by how long it has been due.",
  authorisationsDefinition: "Active authorisations that expire within the days chosen, expired in the last 30 days, or have one session or little value left.",
  caseloadDefinition: "Open cases now, and cases opened and closed in the period. A case belongs to the site and practitioner it was opened with.",
} as const;

export const SETUP_COPY = {
  title: "Clinic set-up",
  intro: "Sites, rooms and opening hours, appointment types and prices, practitioners, referrers and payers, staff access and record keeping.",
  inactiveNote: "Nothing here is ever deleted: switch an item off and it disappears from new bookings while history keeps pointing at it.",
  saved: "Saved.",
  conflict: "Someone else changed this in the meantime. Reload the page and try again.",
  notFound: "This item does not exist in this clinic.",
  unscopedOnly: "Only an owner, or an administrator who works at every site, can change this.",
} as const;

/** Plain-English label of an enumeration value (unknown values as given). */
export function labelOf<T extends string>(labels: Readonly<Record<T, string>>, value: string | null | undefined): string {
  if (!value) return "";
  return (labels as Record<string, string>)[value] ?? value;
}
