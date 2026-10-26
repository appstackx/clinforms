import "server-only";

/**
 * Sign-off receipts: POST /sign issues one after re-running the validators; POST /render and the
 * write-back verify it before producing or accepting a FINAL copy.
 *
 * mac = base64url(HMAC-SHA256(MEDREPORT_SIGNING_SECRET, canonicalize(receipt without mac)))
 * contentSha256 = reportFingerprint(report)   (core/fingerprint.ts; receipt/status/activity excluded)
 * Rollback shim (core/stored-schemas.ts): the MAC and the content hash are checked over the receipt and the report as
 * stored – so keys a later release signed count – and, failing that, as this build knows them (core/schemas.ts),
 * which is how they were checked before the shim. So whatever verified before still verifies, and a receipt the later
 * release issued verifies too.
 *
 * Owner: forms-engine agent (formerly docgen). (Implemented by the foundation.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { signingKey } from "../config.server";
import { canonicalize, reportFingerprint } from "../core/fingerprint";
import { ReportSchema, SignReceiptSchema } from "../core/schemas";
import { StoredSignReceiptSchema } from "../core/stored-schemas";
import type { Clinician, Report, SignReceipt } from "../core/types";

export interface CreateReceiptInput {
  report: Report;
  signer: Clinician;
  statementAccepted: boolean;
  attestations: string[];
  /** Form reports: the verified map's SHA-256 (auth/attestations.ts formMapSha256). */
  formMapSha256?: string;
  /** The authenticated session the approval came through. */
  approvedVia?: SignReceipt["approvedVia"];
  now?: Date;
  /** Override the secret (tests). Default: getSecret("MEDREPORT_SIGNING_SECRET"). */
  secret?: string;
}

export type ReceiptFailureReason = "MALFORMED" | "BAD_MAC" | "REPORT_MISMATCH" | "TENANT_MISMATCH" | "HASH_MISMATCH";

export type ReceiptVerification = { ok: true; contentSha256: string } | { ok: false; reason: ReceiptFailureReason };

function computeMac(unsigned: Omit<SignReceipt, "mac">, secret: string): string {
  return createHmac("sha256", secret).update(canonicalize(unsigned), "utf8").digest("base64url");
}

export async function createReceipt(input: CreateReceiptInput): Promise<SignReceipt> {
  const unsigned: Omit<SignReceipt, "mac"> = {
    reportId: input.report.id,
    tenantId: input.report.tenantId,
    contentSha256: await reportFingerprint(input.report),
    signer: input.signer,
    signedAt: (input.now ?? new Date()).toISOString(),
    statementAccepted: input.statementAccepted,
    attestations: input.attestations,
    ...(input.formMapSha256 ? { formMapSha256: input.formMapSha256 } : {}),
    ...(input.approvedVia ? { approvedVia: input.approvedVia } : {}),
  };
  return { ...unsigned, mac: computeMac(unsigned, input.secret ?? signingKey("receipt")) };
}

/*
 * canonicalize() throws on a value no ClinForms build writes – a non-finite number (JSON's 1e400) or nesting deep enough
 * to exhaust the stack. The read schemas (core/stored-schemas.ts) keep such a value under a key this build does not know;
 * the strict schemas left it out. So a record that holds one does not match as read and is checked as this build knows
 * it, as before the shim: never an exception (a 500) instead of an answer.
 */

function macMatches(receipt: SignReceipt, secret: string): boolean {
  const { mac, ...unsigned } = receipt;
  let computed: string;
  try {
    computed = computeMac(unsigned, secret);
  } catch {
    return false;
  }
  const expected = Buffer.from(computed, "utf8");
  const given = Buffer.from(mac, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function fingerprintOrNull(report: Report): Promise<string | null> {
  try {
    return await reportFingerprint(report);
  } catch {
    return null;
  }
}

/**
 * The report's fingerprint as read (core/stored-schemas.ts), else as this build knows it (core/schemas.ts – how it was
 * computed before the shim); null when neither can be computed (only for a report e132057 refused outright).
 */
export async function readReportFingerprint(report: Report): Promise<string | null> {
  const asRead = await fingerprintOrNull(report);
  if (asRead !== null) return asRead;
  const known = ReportSchema.safeParse(report);
  return known.success ? fingerprintOrNull(known.data) : null;
}

/** The receipt whose MAC verifies: as stored, else as this build knows it (before the shim); null when neither does. */
function signedReceipt(stored: SignReceipt, raw: unknown, secret: string): SignReceipt | null {
  if (macMatches(stored, secret)) return stored;
  const known = SignReceiptSchema.safeParse(raw);
  return known.success && macMatches(known.data, secret) ? known.data : null;
}

/**
 * Shape and MAC only (constant time) – for callers that do not hold the report (write-back). With
 * `tenantId` (wave 2: the caller's clinic) the receipt must also be that clinic's (the MAC covers tenantId).
 */
export function verifyReceiptMac(receipt: SignReceipt, opts: { secret?: string; tenantId?: string } = {}): boolean {
  if (opts.tenantId !== undefined && receipt?.tenantId !== opts.tenantId) return false;
  const parsed = StoredSignReceiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  return signedReceipt(parsed.data, receipt, opts.secret ?? signingKey("receipt")) !== null;
}

/**
 * Checks shape, MAC (constant time), report/tenant binding and the recomputed content hash. With `tenantId`
 * (wave 2: the caller's clinic) the receipt and the report must both be that clinic's: a receipt issued to
 * clinic A is TENANT_MISMATCH for clinic B even though its MAC verifies.
 */
export async function verifyReceipt(
  receipt: SignReceipt,
  report: Report,
  opts: { secret?: string; tenantId?: string } = {},
): Promise<ReceiptVerification> {
  const parsed = StoredSignReceiptSchema.safeParse(receipt);
  if (!parsed.success) return { ok: false, reason: "MALFORMED" };
  if (opts.tenantId !== undefined && (parsed.data.tenantId !== opts.tenantId || report.tenantId !== opts.tenantId)) {
    return { ok: false, reason: "TENANT_MISMATCH" };
  }
  const signed = signedReceipt(parsed.data, receipt, opts.secret ?? signingKey("receipt"));
  if (!signed) return { ok: false, reason: "BAD_MAC" };
  if (signed.reportId !== report.id) return { ok: false, reason: "REPORT_MISMATCH" };
  if (signed.tenantId !== report.tenantId) return { ok: false, reason: "TENANT_MISMATCH" };
  if ((await fingerprintOrNull(report)) === signed.contentSha256) return { ok: true, contentSha256: signed.contentSha256 };
  // As before the shim: the report as this build knows it (keys it does not know left out).
  const known = ReportSchema.safeParse(report);
  if (known.success && (await fingerprintOrNull(known.data)) === signed.contentSha256) return { ok: true, contentSha256: signed.contentSha256 };
  return { ok: false, reason: "HASH_MISMATCH" };
}
