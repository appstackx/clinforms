/**
 * Shared plumbing for the tenant-scoped repositories (src/server/repos/*).
 *
 * Rules every repository follows:
 * - every function takes the tenant (or organization) id explicitly and puts it in EVERY WHERE clause and
 *   primary key, so a read or write can never reach another tenant's rows;
 * - patient payloads are encrypted with AAD "<tenantId>:<table>:<rowId>", so even a row copied into another
 *   tenant cannot be decrypted there;
 * - timestamps are ISO-8601 UTC strings from ctx.now() (one clock, testable);
 * - multi-statement writes go through runBatch() (atomic on D1, Postgres and SQLite).
 */
import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { DataCipher } from "../crypto/envelope";
import type { Database } from "../db/schema";

export interface RepoContext {
  db: Kysely<Database>;
  cipher: DataCipher;
  /** Clock (tests pin it). Default: new Date(). */
  now?: () => Date;
}

export function nowIso(ctx: RepoContext): string {
  return (ctx.now ? ctx.now() : new Date()).toISOString();
}

export class RepoInputError extends Error {
  readonly code = "INVALID_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "RepoInputError";
  }
}

/** tenantId = organization slug: ^[a-z0-9][a-z0-9-]*$, at most 63 characters. */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertTenantId(tenantId: string): string {
  if (typeof tenantId !== "string" || !TENANT_ID_PATTERN.test(tenantId)) {
    throw new RepoInputError("tenantId must be an organization slug (a-z, 0-9, '-').");
  }
  return tenantId;
}

/** Record ids from the app (forms, reports, users…): printable, no whitespace, ≤ 128 characters. */
export function assertId(value: string, what: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value)) {
    throw new RepoInputError(`${what} is not a valid id.`);
  }
  return value;
}

export function assertText(value: string, what: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new RepoInputError(`${what} must be 1–${max} characters.`);
  }
  return value;
}

export function optionalText(value: string | null | undefined, what: string, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new RepoInputError(`${what} must be at most ${max} characters.`);
  return value;
}

export function assertSha256(value: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new RepoInputError("sha256 must be 64 lowercase hex characters.");
  return value;
}

export function assertIso(value: string, what: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new RepoInputError(`${what} must be an ISO-8601 UTC timestamp.`);
  }
  return new Date(value).toISOString();
}

export function flag(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

/** Rows from SQLite are numbers already; Postgres int8 is parsed to number by the dialect. */
export function toInt(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastUlidTime = -1;
let lastUlidRandom: number[] = [];

/** ULID: 48-bit ms timestamp + 80 random bits, Crockford base32; monotonic within a millisecond. */
export function ulid(time: number = Date.now()): string {
  let random: number[];
  if (time === lastUlidTime) {
    random = lastUlidRandom.slice();
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i] < 31) {
        random[i] += 1;
        break;
      }
      random[i] = 0;
    }
  } else {
    const bytes = randomBytes(16);
    random = Array.from(bytes.subarray(0, 16), (b) => b & 31);
  }
  lastUlidTime = time;
  lastUlidRandom = random;
  let timePart = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  return timePart + random.map((v) => CROCKFORD[v]).join("");
}

/** Random id with a prefix, e.g. "pk_3f9…" (128 bits). */
export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export function jsonOrNull(value: unknown, what: string, maxBytes: number): string | null {
  if (value === undefined || value === null) return null;
  const text = JSON.stringify(value);
  if (text === undefined) throw new RepoInputError(`${what} is not JSON-serialisable.`);
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new RepoInputError(`${what} is larger than ${maxBytes} bytes.`);
  return text;
}

export function parseJson<T = unknown>(text: string | null): T | null {
  return text === null ? null : (JSON.parse(text) as T);
}
