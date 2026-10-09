/**
 * One error vocabulary for the three dialects (D1 through the gateway, Postgres, local SQLite), so
 * repositories can react to "unique violation" or "append-only" the same way everywhere.
 */

export type DbErrorCode =
  | "CONSTRAINT_UNIQUE"
  | "CONSTRAINT_FOREIGN_KEY"
  | "CONSTRAINT_CHECK"
  | "CONSTRAINT_NOT_NULL"
  | "APPEND_ONLY"
  | "SQL_ERROR"
  | "SQL_DENIED"
  | "TRANSACTIONS_UNSUPPORTED"
  | "BAD_PARAMETER"
  | "GATEWAY_AUTH"
  | "GATEWAY_LIMIT"
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_PROTOCOL"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export class DbError extends Error {
  readonly code: DbErrorCode;
  readonly status?: number;
  constructor(code: DbErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DbError";
    this.code = code;
    this.status = options?.status;
  }
}

/** Classify a message from SQLite / D1 / Postgres. Shared with the gateway's wording. */
export function classifySqlMessage(message: string): DbErrorCode {
  if (/append-only/i.test(message)) return "APPEND_ONLY";
  if (/UNIQUE constraint failed|PRIMARY KEY constraint failed|duplicate key value violates unique constraint/i.test(message)) {
    return "CONSTRAINT_UNIQUE";
  }
  if (/FOREIGN KEY constraint failed|violates foreign key constraint/i.test(message)) return "CONSTRAINT_FOREIGN_KEY";
  if (/CHECK constraint failed|violates check constraint/i.test(message)) return "CONSTRAINT_CHECK";
  if (/NOT NULL constraint failed|violates not-null constraint/i.test(message)) return "CONSTRAINT_NOT_NULL";
  return "SQL_ERROR";
}

const PG_CODES: Record<string, DbErrorCode> = {
  "23505": "CONSTRAINT_UNIQUE",
  "23503": "CONSTRAINT_FOREIGN_KEY",
  "23514": "CONSTRAINT_CHECK",
  "23502": "CONSTRAINT_NOT_NULL",
};

/** Map any database error (any dialect) to a DbErrorCode. */
export function classifyDbError(err: unknown): DbErrorCode {
  if (err instanceof DbError) return err.code;
  if (!err || typeof err !== "object") return "UNKNOWN";
  const e = err as { code?: unknown; errcode?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  // Postgres (pg and PGlite): SQLSTATE in `code`.
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
    if (e.code === "P0001" && /append-only/i.test(message)) return "APPEND_ONLY";
    const mapped = PG_CODES[e.code];
    if (mapped) return mapped;
    return message ? classifySqlMessage(message) : "SQL_ERROR";
  }
  // node:sqlite: extended result code in `errcode`; the message carries the same words.
  if (typeof e.errcode === "number" || message) return classifySqlMessage(message);
  return "UNKNOWN";
}

export function isUniqueViolation(err: unknown): boolean {
  return classifyDbError(err) === "CONSTRAINT_UNIQUE";
}
