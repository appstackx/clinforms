/**
 * Secrets the patient holds (the "manage this booking" link, a one-time sign-in link, the portal cookie): 32
 * random bytes, base64url. The database stores only their SHA-256 (hex), compared in constant time.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { LINK_TOKEN_PATTERN } from "../../../modules/pms/portal/paths";

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A link's secret as it appears in an address (anything else is refused before the database is asked). */
export function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && LINK_TOKEN_PATTERN.test(value);
}

export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
