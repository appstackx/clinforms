/**
 * Bulk email – the shapes the server hands the screens (browser-safe types only). The repository
 * (src/server/repos/pms/comms/campaigns.ts) and the service (src/server/pms/comms/campaigns/service.ts) build them.
 */
import type { AudienceFilters, CampaignPurpose, CampaignStatus } from "./campaigns";
import type { MarketingSource } from "../core/types";

export interface BulkEmailSettings {
  tenantId: string;
  /** 0 = never saved (the defaults: off). */
  rev: number;
  enabled: boolean;
  dailyCap: number;
  updatedAt: string | null;
}

export interface CampaignSummary {
  tenantId: string;
  id: string;
  rev: number;
  name: string;
  purpose: CampaignPurpose;
  serviceReason: string | null;
  audience: AudienceFilters;
  status: CampaignStatus;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  recipientsTotal: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign extends CampaignSummary {
  subject: string;
  body: string;
}

export interface CampaignReport {
  recipients: number;
  pending: number;
  /** Handed to the email service (sent or delivered). */
  sent: number;
  /** The email service confirmed delivery (when it reports it). */
  delivered: number;
  failed: number;
  /** Kept in the outbox (no email service set up). */
  outbox: number;
  skipped: number;
  skipReasons: Record<string, number>;
  unsubscribed: number;
}

export interface AudienceCount {
  /** Patient records that match. */
  patients: number;
  /** Different addresses among them (what will be sent – one email per address). */
  addresses: number;
}

export type EmailMode = "outbox" | "test" | "mailpit" | "live" | "misconfigured";

export interface CampaignRow extends CampaignSummary {
  report: CampaignReport | null;
}

export interface CampaignsHomeView {
  settings: BulkEmailSettings;
  canManage: boolean;
  campaigns: CampaignRow[];
  emailMode: EmailMode;
}

export interface CampaignEditorView {
  campaign: Campaign | null;
  report: CampaignReport | null;
  sites: { id: string; name: string }[];
  /** Fixed to the member's sites when they are limited to some. */
  siteLocked: boolean;
  sender: { name: string; postalAddress: string | null; phone: string | null };
  settings: BulkEmailSettings;
  emailMode: EmailMode;
  memberEmail: string;
  now: string;
}

export interface MarketingConsentView {
  patientId: string;
  agreed: boolean;
  /** When the opt-in was recorded (UTC ISO). */
  agreedAt: string | null;
  how: MarketingSource | null;
  /** The latest withdrawal of marketing emails (UTC ISO) and how ("staff", "email_link"…). */
  withdrawnAt: string | null;
  withdrawnHow: string | null;
  canChange: boolean;
}

/** Why a recipient was not sent the email (the report). */
export const CAMPAIGN_SKIP_LABELS: Readonly<Record<string, string>> = {
  deceased: "Record says the patient has died",
  archived: "Record archived",
  no_email: "No email address",
  no_marketing_consent: "No longer agrees to marketing",
  opted_out: "Stopped these emails",
  not_in_audience: "No longer in the group (record or filters changed)",
  address_changed: "Email address changed since the email started",
};
