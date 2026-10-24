/**
 * Records as the repositories return them (decrypted, camelCase). Pure types – browser-safe.
 * Inputs are the zod schemas in ./schemas.ts.
 */
import type { PackageId, EntitlementStatus, PriceSource } from "./entitlements";
import type {
  AUTHORISATION_STATUSES,
  CASE_STATUSES,
  MARKETING_SOURCES,
  PATIENT_STATUSES,
  PAYER_TYPES,
  PROFESSIONS,
  REFERRER_KINDS,
  SERVICE_CATEGORIES,
  SEX_VALUES,
} from "./schemas";

export type Sex = (typeof SEX_VALUES)[number];
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export type PayerType = (typeof PAYER_TYPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type ReferrerKind = (typeof REFERRER_KINDS)[number];
export type Profession = (typeof PROFESSIONS)[number];
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type MarketingSource = (typeof MARKETING_SOURCES)[number];
export type AuthorisationStatus = (typeof AUTHORISATION_STATUSES)[number];

/** Who did something: the signed-in member, or a named system job ("demo-seed", "import"). */
export interface PmsActor {
  userId: string | null;
  sessionId: string | null;
}

export interface Entitlement {
  tenantId: string;
  package: PackageId;
  status: EntitlementStatus;
  planCode: string | null;
  priceSource: PriceSource | null;
  limits: Record<string, number> | null;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PmsSettings {
  tenantId: string;
  retentionAdultYears: number;
  retentionChildUntilAge: number;
  /** A demonstration clinic: fictional data only (the demo seed refuses any other clinic on a server database). */
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  tenantId: string;
  id: string;
  name: string;
  code: string | null;
  address: string[] | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  sortOrder: number;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  tenantId: string;
  id: string;
  siteId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Practitioner {
  tenantId: string;
  id: string;
  userId: string | null;
  displayName: string;
  profession: Profession;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  colour: string | null;
  defaultSiteId: string | null;
  bookable: boolean;
  onlineBookable: boolean;
  active: boolean;
  sortOrder: number;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  tenantId: string;
  id: string;
  name: string;
  code: string | null;
  category: ServiceCategory;
  durationMinutes: number;
  bufferMinutes: number;
  defaultPricePence: number | null;
  colour: string | null;
  onlineBookable: boolean;
  active: boolean;
  sortOrder: number;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Referrer {
  tenantId: string;
  id: string;
  rev: number;
  kind: ReferrerKind;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string[] | null;
  postcode: string | null;
  /** Decrypted (null when none). */
  notes: string | null;
  active: boolean;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PriceList {
  tenantId: string;
  id: string;
  name: string;
  payerType: PayerType | null;
  referrerId: string | null;
  isDefault: boolean;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListItem {
  tenantId: string;
  id: string;
  priceListId: string;
  serviceId: string;
  pricePence: number;
  billingCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What lists and the diary show (no free text, nothing decrypted). */
export interface PatientSummary {
  tenantId: string;
  id: string;
  patientNumber: number;
  title: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  phoneMobile: string | null;
  email: string | null;
  postcode: string | null;
  status: PatientStatus;
  /** True when the record carries medical alerts (the text itself needs the full record). */
  hasAlerts: boolean;
  legalHold: boolean;
  lastSeenOn: string | null;
  importRef: string | null;
  updatedAt: string;
}

export interface Patient extends PatientSummary {
  rev: number;
  sex: Sex | null;
  phoneHome: string | null;
  phoneWork: string | null;
  address: string[] | null;
  occupation: string | null;
  employer: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelationship: string | null;
  gpName: string | null;
  gpPractice: string | null;
  gpPhone: string | null;
  gpAddress: string[] | null;
  gpPostcode: string | null;
  consentTreatment: boolean;
  consentTreatmentAt: string | null;
  consentShareGp: boolean;
  reminderSms: boolean;
  reminderEmail: boolean;
  marketingEmail: boolean;
  marketingSms: boolean;
  marketingConsentAt: string | null;
  marketingConsentSource: MarketingSource | null;
  /** Decrypted. */
  alerts: string | null;
  /** Decrypted. */
  notes: string | null;
  mergedIntoId: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CaseSummary {
  tenantId: string;
  id: string;
  patientId: string;
  title: string;
  status: CaseStatus;
  openedOn: string;
  closedOn: string | null;
  practitionerId: string | null;
  siteId: string | null;
  payerType: PayerType;
  payerReferrerId: string | null;
  updatedAt: string;
}

export interface Case extends CaseSummary {
  rev: number;
  membershipNumber: string | null;
  claimReference: string | null;
  excessPence: number | null;
  priceListId: string | null;
  referrerId: string | null;
  referralReceivedOn: string | null;
  injuryOn: string | null;
  /** Decrypted. */
  referralReason: string | null;
  /** Decrypted. */
  notes: string | null;
  importRef: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface Authorisation {
  tenantId: string;
  id: string;
  rev: number;
  caseId: string;
  patientId: string;
  referrerId: string | null;
  code: string;
  sessionsAuthorised: number | null;
  valueAuthorisedPence: number | null;
  sessionsUsed: number;
  valueUsedPence: number;
  validFrom: string | null;
  expiresOn: string | null;
  status: AuthorisationStatus;
  /** Decrypted. */
  notes: string | null;
  importRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Optimistic-concurrency outcome of an update (same shape as the ClinForms repositories). */
export type PmsSaveResult = { ok: true; rev: number; updatedAt: string } | { ok: false; reason: "conflict"; currentRev: number } | { ok: false; reason: "not_found" };
