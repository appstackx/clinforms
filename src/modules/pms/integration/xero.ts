/**
 * Xero sync (trackers xe03–xe06, docs/clinic-system/decisions/xero-sync-scope.md) – its pure rules: the platform
 * switch, the OAuth scopes, the map kinds, the send list's statuses and back-off, the Idempotency-Key, error classes
 * and the screen's plain-English copy. Browser-safe. Mappers: ./xero-mappers.ts. Server side:
 * src/server/pms/integration/xero/*, src/server/repos/pms/integration/xero.ts. Docs: docs/clinic-guides/xero.md
 * (clinics) and docs/clinic-system/xero.md (internal: how to switch it on).
 *
 * Off unless BOTH the platform switch CLINFORMS_XERO=on AND the clinic's own setting (pms_xero_connections.enabled)
 * are on. Switch off: the set-up page is the 404 page, /api/xero/* answer 404 and nothing is ever sent.
 *
 * ONE WAY ONLY: ClinDesk → Xero. Nothing is read back from Xero except the set-up lists (organisation, accounts, tax
 * rates, tracking categories) and look-ups that stop a record being created twice.
 */
import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

export const XERO_ENV = "CLINFORMS_XERO";
/** The Xero app's credentials and its registered redirect address: env NAMES only – values live in the host's env. */
export const XERO_CLIENT_ID_ENV = "XERO_CLIENT_ID";
export const XERO_CLIENT_SECRET_ENV = "XERO_CLIENT_SECRET";
export const XERO_REDIRECT_URI_ENV = "XERO_REDIRECT_URI";

/** The platform switch: "on" (any case, trimmed) – anything else is off. */
export function xeroSwitchOn(env: Env): boolean {
  return (
    String(env[XERO_ENV] ?? "")
      .trim()
      .toLowerCase() === "on"
  );
}

/**
 * Granular scopes (apps created after 2 March 2026 cannot ask for accounting.transactions). accounting.invoices
 * covers credit notes; accounting.settings.read the organisation, accounts, tax rates and tracking categories.
 */
export const XERO_SCOPES = ["openid", "profile", "email", "offline_access", "accounting.invoices", "accounting.payments", "accounting.contacts", "accounting.settings.read"] as const;

/** Xero's fixed addresses (the client takes overrides only in tests). */
export const XERO_URLS = {
  authorize: "https://login.xero.com/identity/connect/authorize",
  token: "https://identity.xero.com/connect/token",
  revoke: "https://identity.xero.com/connect/revocation",
  connections: "https://api.xero.com/connections",
  api: "https://api.xero.com/api.xro/2.0",
} as const;

/** The clinic must keep its books in pounds (checked when it connects). */
export const XERO_REQUIRED_CURRENCY = "GBP";

/* ------------------------------------------------------------------------------------------------
 * Mappings (xe04)
 * ----------------------------------------------------------------------------------------------*/

export const XERO_MAP_KINDS = ["default_account", "item_account", "visit_account", "service_account", "write_off_account", "payment_account", "tax_type", "tracking"] as const;
export type XeroMapKind = (typeof XERO_MAP_KINDS)[number];

/** The single-value maps use this local key. */
export const XERO_SINGLE_KEY = "*";

/** VAT code → the UK Xero TaxType pre-filled (when the organisation has it active). Checked against the Demo Company in xe04. */
export const XERO_DEFAULT_TAX_TYPES: Readonly<Record<string, string>> = {
  standard: "OUTPUT2",
  reduced: "RROUTPUT",
  exempt: "EXEMPTOUTPUT",
  zero: "ZERORATEDOUTPUT",
  none: "NONE",
};

/** A payment account map's local key: the method, or "<method>@<site id>" for one site's own account. */
export function paymentMapKey(method: string, siteId: string | null): string {
  return siteId ? `${method}@${siteId}` : method;
}

const ACCOUNT_CODE = /^[A-Za-z0-9._-]{1,10}$/;
const TAX_TYPE = /^[A-Z0-9_]{1,40}$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const LOCAL_KEY = /^[A-Za-z0-9_*@-]{1,100}$/;

export function isGuid(value: unknown): value is string {
  return typeof value === "string" && GUID.test(value);
}

/** The shape a map's Xero value must have (the server also checks it against the organisation's live lists). */
export function validXeroValue(kind: XeroMapKind, value: string): boolean {
  if (kind === "tax_type") return TAX_TYPE.test(value);
  if (kind === "tracking") {
    const [cat, opt] = value.split("|");
    return isGuid(cat) && isGuid(opt);
  }
  return ACCOUNT_CODE.test(value);
}

export const XeroMappingInputSchema = z
  .object({
    kind: z.enum(XERO_MAP_KINDS),
    localKey: z.string().regex(LOCAL_KEY),
    /** null / "" = remove the map. */
    xeroValue: z.string().max(100).nullable(),
  })
  .strict();
export type XeroMappingInput = z.infer<typeof XeroMappingInputSchema>;

export const XeroOptionsInputSchema = z
  .object({
    sendFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sendContactDetails: z.boolean(),
  })
  .strict();
export type XeroOptionsInput = z.infer<typeof XeroOptionsInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * The send list (xe05)
 * ----------------------------------------------------------------------------------------------*/

export const XERO_SYNC_STATUSES = ["pending", "in_flight", "done", "failed", "blocked", "skipped"] as const;
export type XeroSyncStatus = (typeof XERO_SYNC_STATUSES)[number];
export const XERO_ERROR_CLASSES = ["transient", "validation", "auth", "waiting"] as const;
export type XeroErrorClass = (typeof XERO_ERROR_CLASSES)[number];
export const XERO_LOCAL_TYPES = ["invoice", "credit_note", "allocation"] as const;
export type XeroLocalType = (typeof XERO_LOCAL_TYPES)[number];
export type XeroOp = "create" | "delete";

/** The send list id: "<local_type>:<op>:<local id>" (queuing the same thing twice is a no-op). */
export function syncItemId(localType: XeroLocalType, op: XeroOp, localId: string): string {
  return `${localType}:${op}:${localId}`;
}

/** Order within one clinic: invoices before their credit notes and payments; a payment's removal last. */
export function syncOrder(localType: string, op: string): number {
  if (localType === "invoice") return 0;
  if (localType === "credit_note") return 1;
  return op === "delete" ? 3 : 2;
}

/** Back-off after a transient failure: 1 min, 5 min, 30 min, 2 h, 12 h – then the item is "failed". */
export const XERO_BACKOFF_SECONDS = [60, 300, 1800, 7200, 43_200] as const;
export const XERO_MAX_ATTEMPTS = XERO_BACKOFF_SECONDS.length + 1;

/**
 * When a transient failure after `attempts` tries (1 = the first) may be tried again, or null = give up ("failed").
 * Xero's Retry-After (seconds) wins when it is longer.
 */
export function nextAttemptDelaySeconds(attempts: number, retryAfterSeconds?: number | null): number | null {
  if (attempts >= XERO_MAX_ATTEMPTS) return null;
  const base = XERO_BACKOFF_SECONDS[Math.max(0, Math.min(attempts - 1, XERO_BACKOFF_SECONDS.length - 1))];
  const ra = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.min(retryAfterSeconds, 86_400) : 0;
  return Math.max(base, ra);
}

/** A waiting item (its invoice not in Xero yet) is looked at again after this long. Waiting never counts as a try. */
export const XERO_WAIT_SECONDS = 60;
/** How long one worker holds an item it is sending. */
export const XERO_LEASE_SECONDS = 120;
/** How long one worker holds the token refresh. */
export const XERO_REFRESH_LOCK_SECONDS = 30;
/** Refresh the access token when it has less than this left. */
export const XERO_ACCESS_SKEW_SECONDS = 120;
/** The OAuth state's life. */
export const XERO_STATE_SECONDS = 600;
/** Items one run sends per clinic at most (Xero: 60 calls a minute per organisation; each item is 1–4 calls). */
export const XERO_ITEMS_PER_RUN = 25;

/** Idempotency-Key header (Xero: at most 128 characters): stable for one item and payload version. */
export function idempotencyKeyFor(tenantId: string, itemId: string, payloadVersion: number, sha256Hex: (text: string) => string): string {
  return `cd-${sha256Hex(`${tenantId}\u0000${itemId}`).slice(0, 48)}-v${payloadVersion}`;
}

/**
 * An error message fit to store and show: one line, at most 300 characters, every quoted value removed (Xero quotes
 * names, numbers and e-mail addresses in its messages – those may be a patient's), long digit runs and e-mail
 * addresses masked.
 */
export function redactXeroMessage(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  return (
    text
      .replace(/[\r\n\t]+/g, " ")
      .replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g, "[…]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[…]")
      .replace(/\d{6,}/g, "[…]")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 300) || "Xero did not say why."
  );
}

/* ------------------------------------------------------------------------------------------------
 * Copy (customer-facing: plain English, Xero is named – it is the integration)
 * ----------------------------------------------------------------------------------------------*/

export const XERO_STATUS_LABELS: Readonly<Record<XeroSyncStatus, string>> = {
  pending: "Waiting to send",
  in_flight: "Sending",
  done: "Sent",
  failed: "Failed – needs you",
  blocked: "Needs a fix",
  skipped: "Skipped",
};

export const XERO_TYPE_LABELS: Readonly<Record<string, string>> = {
  "invoice:create": "Invoice",
  "credit_note:create": "Credit note",
  "allocation:create": "Payment",
  "allocation:delete": "Payment taken off",
};

export const XERO_COPY = {
  title: "Xero",
  intro:
    "Send this clinic's invoices, credit notes and payments to the clinic's own Xero organisation. You keep billing here – nothing comes back from Xero, and nothing clinical is ever sent.",
  off: "Off – nothing is sent to Xero.",
  notConfigured: "Xero is not set up on this system yet. Ask support to switch it on.",
  connectHint: "You will sign in to Xero, choose ONE organisation and allow this system to add invoices, contacts and payments.",
  wrongHost: (host: string) => `Open this system at ${host} to connect Xero.`,
  disconnectConfirm: "Sending to Xero stops at once. Everything already in Xero stays there, and the list of what was sent is kept here.",
  paused: "Xero stopped accepting the connection (it may have been removed in Xero). Connect again to carry on – nothing is lost.",
  mappingsMissing: "Choose these before anything is sent:",
  retried: "Queued again – it will be sent on the next run.",
  sendNow: "Send now",
} as const;

/** Why a connect or callback did not finish (the ?error= of the set-up page), in plain words. */
export const XERO_CONNECT_ERRORS: Readonly<Record<string, string>> = {
  denied: "Xero was not connected – permission was not given in Xero.",
  state: "That connection attempt had expired or was started elsewhere. Please try again from this page.",
  exchange: "Xero did not accept the sign-in. Please try again.",
  no_org: "No Xero organisation was chosen. Please try again and choose one organisation.",
  many_orgs: "More than one Xero organisation was chosen. Please try again and choose only one.",
  currency: "That Xero organisation does not keep its books in pounds (GBP). Only a GBP organisation can be connected.",
  other_org: "This clinic already sent records to a different Xero organisation. Connect that organisation again (or ask support to start afresh).",
  off: "Xero is switched off for this clinic.",
  forbidden: "Only the clinic's owner or an admin can connect Xero.",
  error: "Something went wrong while connecting Xero. Please try again.",
};

export function connectErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return XERO_CONNECT_ERRORS[code] ?? XERO_CONNECT_ERRORS.error;
}
