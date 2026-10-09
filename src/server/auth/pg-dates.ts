/**
 * Postgres only: Better Auth's Kysely adapter expects `Date` objects back from timestamptz columns
 * (it compares `expiresAt < new Date()`), but ClinForms' Postgres dialect parses timestamptz to ISO strings
 * so that rows look the same on SQLite/D1 and Postgres (src/server/db/dialects/postgres.ts). Comparing an
 * ISO string with a Date is always false – an expired session would look valid.
 *
 * This Kysely plugin turns the ISO strings of Better Auth's date columns back into Dates. It is applied only
 * to the Kysely instance handed to Better Auth (`db.withPlugin(...)` shares the pool), and only to the
 * camelCase date columns of Better Auth's own tables, which never collide with our snake_case columns.
 */
import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, RootOperationNode, UnknownRow } from "kysely";

/** Every `date` field in the Better Auth tables ClinForms uses (checked against the schema by a test). */
export const AUTH_DATE_COLUMNS: readonly string[] = [
  "createdAt",
  "updatedAt",
  "expiresAt",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "lockedUntil",
];

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

export class AuthDateParsePlugin implements KyselyPlugin {
  private readonly columns: ReadonlySet<string>;
  constructor(columns: readonly string[] = AUTH_DATE_COLUMNS) {
    this.columns = new Set(columns);
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const { result } = args;
    if (!result.rows || result.rows.length === 0) return result;
    let changed = false;
    const rows = result.rows.map((row) => {
      let copy: UnknownRow | null = null;
      for (const key of Object.keys(row)) {
        const value = row[key];
        if (typeof value === "string" && this.columns.has(key) && ISO.test(value)) {
          copy ??= { ...row };
          copy[key] = new Date(value);
        }
      }
      if (copy) changed = true;
      return copy ?? row;
    });
    return changed ? { ...result, rows } : result;
  }
}
