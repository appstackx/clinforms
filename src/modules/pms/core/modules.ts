/**
 * The clinic-system modules, their file-ownership prefix and their migration number ranges.
 * SINGLE SOURCE for docs/clinic-system/contract.md §3 and for the migration-range test
 * (src/modules/pms/core/modules.test.ts): a migration numbered 0100 or above must fall inside one module's range
 * and have its Postgres twin with the same number (0110 ↔ 20261024000110).
 *
 * Pure: no imports. Orchestrator-owned (a module builder never edits this file).
 */

export const PMS_MODULE_IDS = ["foundation", "diary", "records", "billing", "comms", "portal", "reporting", "integration"] as const;
export type PmsModuleId = (typeof PMS_MODULE_IDS)[number];

export interface PmsModuleInfo {
  id: PmsModuleId;
  /** Internal name (contract, branch names). Not shown to clinics. */
  title: string;
  /** SQLite/D1 migration numbers (inclusive): db/migrations/sqlite/NNNN_*.sql */
  sqlite: readonly [number, number];
  /** Postgres twins: supabase/migrations/2026102400NNNN_*.sql with the same NNNN. */
  postgresPrefix: "2026102400";
  /**
   * Follow-up numbers past the first ranges (M9b polish, 0180 onwards, handover §19): each number is owned by one
   * module exactly as its own range is. Numbered in the order the follow-ups were built. M10 performance (0210–0219,
   * handover §20.4, indexes only): diary 0210, records 0211, billing 0212, foundation 0213. Healthcode e-billing
   * groundwork (11/2026, docs/clinic-system/healthcode.md): billing 0220–0229. File store (B07): records 0230.
   * Courses, gift cards and products (PK, 11/2026): billing 0231–0239. Bulk email to patient groups (xt02, 11/2026):
   * comms 0146 (inside comms' own range – reserved here so no other comms branch takes it; 0147–0149 stay free).
   * Public clinic API v1 (xt03, 11/2026, docs/clinic-system/api.md): integration 0171 (inside integration's own range –
   * reserved here; 0172–0179 stay free).
   */
  extra?: readonly (readonly [number, number])[];
}

export const PMS_MODULES: Readonly<Record<PmsModuleId, PmsModuleInfo>> = {
  foundation: { id: "foundation", title: "Foundation: entitlements, shell, shared patient record", sqlite: [100, 109], postgresPrefix: "2026102400", extra: [[213, 213]] },
  diary: { id: "diary", title: "Multi-site diary", sqlite: [110, 119], postgresPrefix: "2026102400", extra: [[180, 181], [189, 189], [210, 210]] },
  records: { id: "records", title: "Patient record screens and clinical notes", sqlite: [120, 129], postgresPrefix: "2026102400", extra: [[188, 188], [211, 211], [230, 230]] },
  billing: { id: "billing", title: "Invoicing, insurer and MLC accounts, payments", sqlite: [130, 139], postgresPrefix: "2026102400", extra: [[212, 212], [220, 229], [231, 239]] },
  comms: { id: "comms", title: "Reminders, messages, letters", sqlite: [140, 149], postgresPrefix: "2026102400" },
  portal: { id: "portal", title: "Online booking, patient portal, intake forms", sqlite: [150, 159], postgresPrefix: "2026102400", extra: [[182, 185], [190, 190]] },
  reporting: { id: "reporting", title: "Reporting, clinic set-up and administration", sqlite: [160, 169], postgresPrefix: "2026102400", extra: [[186, 187]] },
  integration: { id: "integration", title: "Data import and the native connector", sqlite: [170, 179], postgresPrefix: "2026102400" },
};

/**
 * ClinForms' OWN migrations (below 0100 – not a clinic-system module), as reserved on branches not merged yet, so no
 * two branches take the same number (13/11/2026). 0010 is used twice on purpose, under different names and Postgres
 * versions that coexist (SQLite/D1 track applied files by NAME, Postgres by the 14-digit version):
 *   0010_self_signup     / 20261112000010  main (self sign-up)
 *   0010_lifecycle_email / 20261111000010  parked branch feat/lifecycle-emails – ALREADY APPLIED to production (two empty
 *                                          tables lifecycle_email, lifecycle_email_pref); never reuse those table names
 *   0011_self_trial      / 20261113000011  feat/self-serve-trial (self_trial, trial_email)
 * Next free: 0012. Numbers reserved by other unreleased branches in the module ranges: 0172 (xero), 0126–0128
 * (exercises), 0226–0229 and 0239–0241 (card payments).
 */
export const CLINFORMS_OWN_MIGRATIONS = [
  { number: 10, name: "self_signup", postgres: "20261112000010", branch: "main" },
  { number: 10, name: "lifecycle_email", postgres: "20261111000010", branch: "feat/lifecycle-emails (parked; applied to production)" },
  { number: 11, name: "self_trial", postgres: "20261113000011", branch: "feat/self-serve-trial" },
] as const;

/** The module whose range holds a SQLite migration number, or null (numbers below 100 are ClinForms' own). */
export function moduleForMigration(n: number): PmsModuleId | null {
  for (const id of PMS_MODULE_IDS) {
    for (const [lo, hi] of [PMS_MODULES[id].sqlite, ...(PMS_MODULES[id].extra ?? [])]) if (n >= lo && n <= hi) return id;
  }
  return null;
}

/** "0110_diary_core.sql" → "20261024000110_diary_core.sql" (the Postgres twin's file name). */
export function postgresTwinName(sqliteFile: string): string | null {
  const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(sqliteFile);
  if (!m) return null;
  return `2026102400${m[1]}_${m[2]}.sql`;
}

/** Base path of the clinic area in the app. Every clinic-system page lives under it. */
export const CLINIC_BASE_PATH = "/app/clinic";
