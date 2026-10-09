import "server-only";

/**
 * Server attestations that bind what a clinician reviewed to what is issued and filed:
 *
 * 1. Form-map confirmation. A form map ("FormDefinition") lives in the browser, so "confirmed" alone is
 *    only the browser's claim. POST /forms/confirm (and GET /forms/samples for the bundled maps) adds
 *    `confirmed.mapSha256` = formMapSha256(form) and `confirmed.mac` =
 *    HMAC(signingKey("form-confirmation"), canonical {v, tenantId, formId, mapSha256, by, at}).
 *    /drafts, /sign and /render accept a map as confirmed only when both verify, so a client cannot
 *    swap anchors, tick-box options, fill sources or "required" after confirmation.
 *
 * 2. Filed-document token. POST /render issues a FINAL file with `x-medreport-file-token` =
 *    HMAC(signingKey("file-token"), canonical {v, receiptMac, sha256 of the bytes, tenant, connector,
 *    patient, episode}). POST /connectors/{id}/documents recomputes it from the uploaded bytes and the
 *    request, so only the exact FINAL file the server issued for that patient's episode is filed.
 *
 * Owner: forms-engine agent.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { signingKey } from "../config.server";
import { canonicalize } from "../core/fingerprint";
import type { FormDefinition } from "../core/types";

function hmac(key: string, payload: unknown): string {
  return createHmac("sha256", key).update(canonicalize(payload), "utf8").digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------------------------------------
 * Form-map confirmation
 * ----------------------------------------------------------------------------------------------*/

/**
 * SHA-256 of everything that decides where and how answers are written: the form ID, its kind, the
 * file it is bound to and every field (label, answer type, options, anchor, fill source, required…).
 * Title, referrer and analysis notes are not part of it.
 */
export function formMapSha256(form: Pick<FormDefinition, "id" | "kind" | "file" | "fields">): string {
  const payload = { v: 1, id: form.id, kind: form.kind, fileSha256: form.file.sha256, fields: form.fields };
  return createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
}

export interface FormConfirmation {
  by: string;
  at: string;
  mapSha256: string;
  mac: string;
}

function confirmationPayload(form: Pick<FormDefinition, "id" | "tenantId">, mapSha256: string, by: string, at: string) {
  return { v: 1, purpose: "form-confirmation", tenantId: form.tenantId, formId: form.id, mapSha256, by, at };
}

/** A server-signed confirmation of this exact map. */
export function attestFormConfirmation(
  form: Pick<FormDefinition, "id" | "tenantId" | "kind" | "file" | "fields">,
  by: string,
  at: string,
): FormConfirmation {
  const mapSha256 = formMapSha256(form);
  return { by, at, mapSha256, mac: hmac(signingKey("form-confirmation"), confirmationPayload(form, mapSha256, by, at)) };
}

/** The form with its confirmation attested (status "confirmed"). */
export function withAttestedConfirmation(form: FormDefinition, by: string, at: string): FormDefinition {
  return { ...form, status: "confirmed", confirmed: attestFormConfirmation(form, by, at) };
}

export type FormConfirmationCheck =
  | { ok: true; mapSha256: string }
  | { ok: false; reason: "NOT_CONFIRMED" | "NOT_ATTESTED" | "MAP_CHANGED" | "BAD_MAC" };

/** Verify that the map is confirmed AND that the server attested exactly this map. */
export function verifyFormConfirmation(form: FormDefinition): FormConfirmationCheck {
  if (form.status !== "confirmed" || !form.confirmed) return { ok: false, reason: "NOT_CONFIRMED" };
  const { by, at, mapSha256, mac } = form.confirmed;
  if (!mapSha256 || !mac) return { ok: false, reason: "NOT_ATTESTED" };
  const actual = formMapSha256(form);
  if (actual !== mapSha256) return { ok: false, reason: "MAP_CHANGED" };
  const expected = hmac(signingKey("form-confirmation"), confirmationPayload(form, mapSha256, by, at));
  return safeEqual(expected, mac) ? { ok: true, mapSha256 } : { ok: false, reason: "BAD_MAC" };
}

/** Plain-English reason for a failed check (problem detail). */
export function formConfirmationProblem(reason: Exclude<FormConfirmationCheck, { ok: true }>["reason"]): string {
  switch (reason) {
    case "NOT_CONFIRMED":
      return "A staff member must check and confirm this referrer form's mapping in the forms library before it is used for a patient.";
    case "NOT_ATTESTED":
      return "This mapping was confirmed before confirmations were checked by the server. Open it in the forms library and confirm it again.";
    case "MAP_CHANGED":
      return "The mapping has changed since it was confirmed. Open it in the forms library, check it and confirm it again.";
    case "BAD_MAC":
      return "The confirmation of this mapping could not be verified. Open it in the forms library and confirm it again.";
  }
}

/* ------------------------------------------------------------------------------------------------
 * Filed-document token
 * ----------------------------------------------------------------------------------------------*/

export interface FileTokenInput {
  receiptMac: string;
  /** SHA-256 (hex) of the exact bytes issued. */
  sha256: string;
  tenantId: string;
  connectorId: string;
  patientId: string;
  episodeId: string;
}

export function createFileToken(input: FileTokenInput): string {
  return hmac(signingKey("file-token"), { v: 1, purpose: "file-token", ...input });
}

export function verifyFileToken(token: string, input: FileTokenInput): boolean {
  return safeEqual(createFileToken(input), token);
}

export function sha256HexOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
