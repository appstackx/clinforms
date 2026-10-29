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
   * module exactly as its own range is. Numbered in the order the follow-ups were built.
   */
  extra?: readonly (readonly [number, number])[];
}

export const PMS_MODULES: Readonly<Record<PmsModuleId, PmsModuleInfo>> = {
  foundation: { id: "foundation", title: "Foundation: entitlements, shell, shared patient record", sqlite: [100, 109], postgresPrefix: "2026102400" },
  diary: { id: "diary", title: "Multi-site diary", sqlite: [110, 119], postgresPrefix: "2026102400", extra: [[180, 181], [189, 189]] },
  records: { id: "records", title: "Patient record screens and clinical notes", sqlite: [120, 129], postgresPrefix: "2026102400", extra: [[188, 188]] },
  billing: { id: "billing", title: "Invoicing, insurer and MLC accounts, payments", sqlite: [130, 139], postgresPrefix: "2026102400" },
  comms: { id: "comms", title: "Reminders, messages, letters", sqlite: [140, 149], postgresPrefix: "2026102400" },
  portal: { id: "portal", title: "Online booking, patient portal, intake forms", sqlite: [150, 159], postgresPrefix: "2026102400", extra: [[182, 185], [190, 190]] },
  reporting: { id: "reporting", title: "Reporting, clinic set-up and administration", sqlite: [160, 169], postgresPrefix: "2026102400", extra: [[186, 187]] },
  integration: { id: "integration", title: "Data import and the native connector", sqlite: [170, 179], postgresPrefix: "2026102400" },
};

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
