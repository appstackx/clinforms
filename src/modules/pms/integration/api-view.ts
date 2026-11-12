/**
 * What the Set-up → API keys screen shows (built by src/server/pms/integration/api/screen.ts). Pure, browser-safe.
 */
import type { ApiScope } from "./api";

export interface ApiKeyRow {
  id: string;
  name: string;
  label: string;
  scopes: ApiScope[];
  /** Site names, or null = every site. */
  sites: string[] | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  callsToday: number;
  calls30: number;
  patientReads30: number;
  /** active | expired | revoked | replaced (still working until its expiry) */
  state: "active" | "expired" | "revoked" | "replaced";
}

export interface ApiScreenView {
  enabled: boolean;
  keys: ApiKeyRow[];
  sites: { id: string; name: string }[];
}

