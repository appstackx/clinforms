/**
 * The SMS Works (thesmsworks.co.uk) – the clinic system's LIVE text provider (Khuram, 31/10/2026: UK, charges only
 * for delivered texts). REST over fetch, no SDK. Server only. Nothing leaves the system unless SMSWORKS_API_KEY is
 * set AND CLINIC_SMS_PROVIDER=smsworks (./index.ts) – otherwise texts stay in the outbox.
 *
 *   SMSWORKS_API_KEY         the account's JSON Web Token (Dashboard → API Key → generate; sent as the
 *                            Authorization header – a leading "JWT " is accepted and kept as given)
 *   SMSWORKS_SENDER          default alphanumeric sender (4–11 letters/digits, no spaces); default "ClinDesk". A
 *                            clinic's own sender name (Messages → Settings) wins when it is valid for the network
 *   SMSWORKS_RECEIPT_SECRET  32+ characters: the delivery-receipt webhook's token (POST
 *                            /api/clinic-messages/sms-receipts?token=…). With it and an app origin, every text
 *                            carries its own receipt URL (deliveryreporturl); else set the URL in the dashboard
 *   SMSWORKS_API_BASE        LOCAL tests only: a stand-in on this machine (loopback); anything else is refused
 *
 * API (public docs, https://thesmsworks.co.uk/developers): base https://api.thesmsworks.co.uk/v1, header
 * Authorization: <JWT>; POST /message/send {sender, destination (447…, no +), content, deliveryreporturl,
 * metadata:[{key,value}], tag} → 201 with the message id ("messageid"); GET /message/{messageid} → the delivery
 * report (status SCHEDULED | SENT | DELIVERED | UNDELIVERABLE | EXPIRED | REJECTED). Receipts are POSTed as JSON on
 * every status change (unsigned – the token in the URL authenticates them and the status is RE-READ from the API).
 *
 * Answers: 2xx with a message id → sent. A 4xx refusal → failed (the text did not go: its credits come back). A 5xx,
 * a timeout or a dropped connection → THROWS: the dispatcher records it as unknown and keeps the credits until the
 * receipt says what happened (review fix 6). Each text carries our clinic and message ids as metadata, so a receipt
 * for a text whose send never answered still finds it.
 */
import { CLINIC_SYSTEM_NAME } from "../../../../lib/brand";
import type { OutboundSms, SmsProvider } from "./types";

export const SMSWORKS_PROVIDER_ID = "smsworks";
export const SMSWORKS_API = "https://api.thesmsworks.co.uk/v1";
/** The default sender: the product's own name (4–11 letters). */
export const SMSWORKS_DEFAULT_SENDER = CLINIC_SYSTEM_NAME;
export const SMSWORKS_RECEIPT_PATH = "/api/clinic-messages/sms-receipts";
export const RECEIPT_SECRET_MIN_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class SmsWorksError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SmsWorksError";
  }
}

/** The API base: The SMS Works' own, or a loopback stand-in for local tests. */
export function smsWorksApiBase(override: string | undefined): string {
  if (!override) return SMSWORKS_API;
  const url = new URL(override);
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  const own = url.protocol === "https:" && url.hostname === "api.thesmsworks.co.uk";
  if (!loopback && !own) throw new SmsWorksError("Refused: the text provider address must be its own or this machine's.", null);
  return override.replace(/\/+$/, "");
}

/** A sender the network accepts: 4–11 letters or digits (spaces and other characters dropped), else the default. */
export function smsWorksSender(clinicSender: string | null | undefined, env: Env = process.env): string {
  const clean = (v: string | null | undefined) => String(v ?? "").replace(/[^A-Za-z0-9]/g, "");
  const ok = (v: string) => v.length >= 4 && v.length <= 11 && /[A-Za-z]/.test(v);
  const own = clean(clinicSender);
  if (ok(own)) return own;
  const configured = clean(env.SMSWORKS_SENDER);
  return ok(configured) ? configured : SMSWORKS_DEFAULT_SENDER;
}

/** "+447700900123" → "447700900123" (the API wants no + and no 00). */
export function smsWorksDestination(e164: string): string {
  return e164.replace(/^\+/, "").replace(/^00/, "").replace(/\D/g, "");
}

export interface SmsWorksConfig {
  token: string;
  apiBase: string;
  /** The receipt URL with its token, or null (receipts then come from the dashboard's URL). */
  receiptUrl: string | null;
}

/** The configuration, or null when the key is not set (the provider stays off). */
export function smsWorksConfig(env: Env = process.env, origin: string | null = null): SmsWorksConfig | null {
  const token = (env.SMSWORKS_API_KEY ?? "").trim();
  if (token.length < 20) return null;
  const secret = (env.SMSWORKS_RECEIPT_SECRET ?? "").trim();
  const receiptUrl = secret.length >= RECEIPT_SECRET_MIN_LENGTH && origin ? `${origin}${SMSWORKS_RECEIPT_PATH}?token=${encodeURIComponent(secret)}` : null;
  return { token, apiBase: smsWorksApiBase(env.SMSWORKS_API_BASE || undefined), receiptUrl };
}

export type SmsWorksStatus = "SCHEDULED" | "SENT" | "DELIVERED" | "UNDELIVERABLE" | "EXPIRED" | "REJECTED";

export interface SmsWorksReport {
  messageId: string;
  status: SmsWorksStatus | string;
  /** Our own ids, from the metadata sent with the text. */
  tenantId: string | null;
  ourMessageId: string | null;
  failureCode: string | null;
}

/** Final outcome of a report: delivered, failed (not delivered – SMS Works charges nothing) or still pending. */
export function reportOutcome(status: string): "delivered" | "failed" | "pending" {
  const s = status.toUpperCase();
  if (s === "DELIVERED") return "delivered";
  if (s === "UNDELIVERABLE" || s === "EXPIRED" || s === "REJECTED") return "failed";
  return "pending";
}

function metaValue(meta: unknown, key: string): string | null {
  if (!Array.isArray(meta)) return null;
  for (const m of meta) if (m && typeof m === "object" && (m as Record<string, unknown>).key === key) return String((m as Record<string, unknown>).value ?? "") || null;
  return null;
}

/** Reads a delivery report (a receipt's body or GET /message/{id}). */
export function parseReport(o: Record<string, unknown>): SmsWorksReport | null {
  const id = typeof o.messageid === "string" ? o.messageid : typeof o.messageId === "string" ? o.messageId : null;
  if (!id || !/^[A-Za-z0-9_-]{4,120}$/.test(id)) return null;
  const fr = o.failurereason && typeof o.failurereason === "object" ? (o.failurereason as Record<string, unknown>) : null;
  return {
    messageId: id,
    status: typeof o.status === "string" ? o.status : "",
    tenantId: metaValue(o.metadata, "clinic"),
    ourMessageId: metaValue(o.metadata, "message"),
    failureCode: fr && (typeof fr.code === "string" || typeof fr.code === "number") ? `smsworks_${String(fr.code)}`.slice(0, 40) : null,
  };
}

export interface SmsWorksClient {
  getReport(messageId: string): Promise<SmsWorksReport | null>;
}

export function createSmsWorks(config: SmsWorksConfig, fetchImpl: Fetch = (url, init) => fetch(url, init)): SmsProvider & SmsWorksClient {
  const headers = { authorization: config.token, "content-type": "application/json", accept: "application/json" };
  return {
    id: SMSWORKS_PROVIDER_ID,
    mode: "live",
    async send(message: OutboundSms) {
      const metadata = [{ key: "message", value: message.messageId }, ...(message.tenantId ? [{ key: "clinic", value: message.tenantId }] : [])];
      const body = {
        sender: smsWorksSender(message.from),
        destination: smsWorksDestination(message.to),
        content: message.body.slice(0, 1280),
        tag: message.messageId.slice(0, 280),
        metadata,
        ...(config.receiptUrl ? { deliveryreporturl: config.receiptUrl } : {}),
      };
      // Throws on a timeout or dropped connection: the dispatcher records "unknown" and keeps the credits.
      const res = await fetchImpl(`${config.apiBase}/message/send`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status >= 500) throw new SmsWorksError("The text provider had a problem; the text may or may not have gone.", res.status);
      if (res.status < 200 || res.status >= 300) return { status: "failed", errorCode: `smsworks_${res.status}` };
      const id = typeof json.messageid === "string" ? json.messageid : typeof json.messageId === "string" ? json.messageId : null;
      if (!id) throw new SmsWorksError("The text provider gave no message id.", res.status);
      const st = typeof json.status === "string" ? json.status.toUpperCase() : "SENT";
      if (st === "REJECTED" || st === "UNDELIVERABLE") return { status: "failed", errorCode: `smsworks_${st.toLowerCase()}` };
      return { status: "sent", providerMessageId: id };
    },
    async getReport(messageId: string) {
      if (!/^[A-Za-z0-9_-]{4,120}$/.test(messageId)) return null;
      const res = await fetchImpl(`${config.apiBase}/message/${encodeURIComponent(messageId)}`, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new SmsWorksError("The text provider could not be reached to confirm a receipt.", res.status);
      const json = (await res.json().catch(() => null)) as unknown;
      const o = Array.isArray(json) ? json[0] : json;
      return o && typeof o === "object" ? parseReport(o as Record<string, unknown>) : null;
    },
  };
}
