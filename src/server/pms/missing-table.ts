/** Recognising a clinic-system table that does not exist yet (a release ahead of its migrations). Pure. */

/**
 * Whether `err` says `table` does not exist – a database the clinic system's migrations have not reached yet
 * (SQLite / D1 through the gateway: "no such table: <table>"; Postgres: SQLSTATE 42P01, relation "<table>" does not
 * exist). Follows `cause` like src/server/repos/usage-period.ts isMissingUsageTable.
 */
export function isMissingPmsTable(err: unknown, table: string): boolean {
  if (!err || typeof err !== "object" || !/^[a-z0-9_]+$/.test(table)) return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (e.code === "42P01" && new RegExp(`\\b${table}\\b`).test(message)) return true;
  if (new RegExp(`no such table: (?:main\\.)?${table}\\b|relation "(?:public\\.)?${table}" does not exist`, "i").test(message)) return true;
  return e.cause !== undefined && e.cause !== err ? isMissingPmsTable(e.cause, table) : false;
}
