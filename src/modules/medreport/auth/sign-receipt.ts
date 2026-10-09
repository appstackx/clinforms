import "server-only";

/**
 * Sign-off receipts: POST /sign issues one after re-running the validators; POST /render and the
 * write-back verify it before producing or accepting a FINAL copy.
 *
 * mac = base64url(HMAC-SHA256(MEDREPORT_SIGNING_SECRET, canonicalize(receipt without mac)))
 * contentSha256 = reportFingerprint(report)   (core/fingerprint.ts; receipt/status/activity excluded)
 *
 * Owner: forms-engine agent (formerly docgen). (Implemented by the foundation.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { signingKey } from "../config.server";
import { canonicalize, reportFingerprint } from "../core/fingerprint";
import { SignReceiptSchema } from "../core/schemas";
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

/** Shape and MAC only (constant time) – for callers that do not hold the report (write-back). */
export function verifyReceiptMac(receipt: SignReceipt, opts: { secret?: string } = {}): boolean {
  const parsed = SignReceiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  const { mac, ...unsigned } = parsed.data;
  const expected = Buffer.from(computeMac(unsigned, opts.secret ?? signingKey("receipt")), "utf8");
  const given = Buffer.from(mac, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Checks shape, MAC (constant time), report/tenant binding and the recomputed content hash. */
export async function verifyReceipt(
  receipt: SignReceipt,
  report: Report,
  opts: { secret?: string } = {},
): Promise<ReceiptVerification> {
  const parsed = SignReceiptSchema.safeParse(receipt);
  if (!parsed.success) return { ok: false, reason: "MALFORMED" };
  const { mac, ...unsigned } = parsed.data;
  const expected = Buffer.from(computeMac(unsigned, opts.secret ?? signingKey("receipt")), "utf8");
  const given = Buffer.from(mac, "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "BAD_MAC" };
  if (unsigned.reportId !== report.id) return { ok: false, reason: "REPORT_MISMATCH" };
  if (unsigned.tenantId !== report.tenantId) return { ok: false, reason: "TENANT_MISMATCH" };
  const contentSha256 = await reportFingerprint(report);
  if (contentSha256 !== unsigned.contentSha256) return { ok: false, reason: "HASH_MISMATCH" };
  return { ok: true, contentSha256 };
}
