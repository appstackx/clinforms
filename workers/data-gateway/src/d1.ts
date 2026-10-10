/**
 * The subset of the D1 binding the gateway uses. Declared here (structurally compatible with
 * @cloudflare/workers-types' D1Database) so the same source also type-checks under Node in the tests,
 * where a node:sqlite-backed stand-in plays the binding.
 */
export interface D1ResultLike {
  results?: Record<string, unknown>[];
  meta?: { changes?: number; last_row_id?: number | null };
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<D1ResultLike[]>;
}

export interface Env {
  DB: D1DatabaseLike;
  /** HMAC secret shared with the app (wrangler secret put GATEWAY_SECRET). */
  GATEWAY_SECRET?: string;
}
