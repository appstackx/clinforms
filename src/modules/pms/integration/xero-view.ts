/**
 * Set-up → Xero: the screen's data (browser-safe types; assembled by src/server/pms/integration/xero/screen.ts).
 */
import type { XeroMapKind, XeroSyncStatus } from "./xero";

export interface XeroConnectionView {
  enabled: boolean;
  status: "not_connected" | "connected" | "paused" | "disconnected";
  orgName: string | null;
  baseCurrency: string | null;
  sendFrom: string | null;
  sendContactDetails: boolean;
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
  rev: number;
}

export interface XeroOption {
  value: string;
  label: string;
}

export interface XeroLists {
  revenueAccounts: XeroOption[];
  paymentAccounts: XeroOption[];
  taxRates: XeroOption[];
  tracking: XeroOption[];
}

export interface XeroScreenView {
  configured: boolean;
  /** The host the connect must start on (redirect address), when this request is on another one. */
  wrongHost: string | null;
  connection: XeroConnectionView;
  lists: XeroLists | null;
  listsError: string | null;
  maps: { kind: XeroMapKind; key: string; value: string | null; label: string | null }[];
  services: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  methods: { id: string; name: string }[];
  vatCodes: { id: string; name: string; suggested: string | null }[];
  missing: string[];
  counts: Record<XeroSyncStatus, number>;
  problems: { id: string; what: string; status: XeroSyncStatus; message: string | null; attempts: number; updatedAt: string }[];
  recent: { id: string; what: string; status: XeroSyncStatus; updatedAt: string }[];
}

