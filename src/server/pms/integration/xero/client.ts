/**
 * Xero sync: the HTTP client for Xero's identity service (OAuth 2.0 code flow with the client secret – a server-side
 * app, so no PKCE) and the Accounting API, written against Xero's public API docs
 * (developer.xero.com/documentation/guides/oauth2/auth-flow, …/api/accounting/*). No SDK: plain fetch, injected, so
 * the tests run it against a fake Xero (./testing/fake-xero.ts) and nothing ever reaches the real one.
 *
 * Errors are classified for the send list (XeroError.errorClass):
 *   transient  – 429 (Retry-After kept), 5xx, timeouts, network errors: retried with back-off;
 *   validation – 400 / 404 and Xero's ValidationErrors: blocked until the clinic fixes it and presses Retry;
 *   auth       – 401 after a refresh, 403, invalid_grant: the clinic must reconnect.
 * Xero's own message text never leaves this file: it is mapped to a fixed plain-English line (xeroMessageText) –
 * Xero quotes names, numbers and e-mail addresses, quoted or not.
 * Every call checks the run's deadline first (XeroDeferred): an item is never left half-sent by a killed function.
 *
 * Secrets: the client secret only goes in the Basic header of the token, refresh and revocation calls; tokens are
 * never logged or put in an error message.
 */
import "server-only";
import { XERO_URLS, oneLine, xeroMessageText, type XeroErrorClass } from "../../../../modules/pms/integration/xero";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface XeroAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface XeroClientDeps {
  fetch: FetchLike;
  /** Tests only: the fake server's addresses. */
  urls?: Partial<Record<keyof typeof XERO_URLS, string>>;
  /** Short in-request retries on 429 (Retry-After ≤ 5 s) and 5xx before the send list's back-off takes over. */
  inlineRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class XeroError extends Error {
  readonly errorClass: Exclude<XeroErrorClass, "waiting">;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  /** 401 on an API call: the access token may only need a refresh. */
  readonly unauthorized: boolean;
  constructor(errorClass: Exclude<XeroErrorClass, "waiting">, status: number, message: string, options: { retryAfterSeconds?: number | null; unauthorized?: boolean } = {}) {
    super(oneLine(message));
    this.name = "XeroError";
    this.errorClass = errorClass;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.unauthorized = options.unauthorized === true;
  }
}

/** The run's time is up: nothing was sent by this call; the item goes back on the list untouched. */
export class XeroDeferred extends Error {
  constructor() {
    super("Will be sent on the next run.");
    this.name = "XeroDeferred";
  }
}

export interface XeroTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds the access token lives (Xero: 1800). */
  expiresIn: number;
  scope: string;
  /** The authentication_event_id claim of the access token: picks the organisation(s) this sign-in connected. */
  authEventId: string | null;
}

export interface XeroConnectionInfo {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  authEventId: string | null;
  createdDateUtc: string | null;
}

export interface XeroAccount {
  code: string;
  name: string;
  type: string;
  status: string;
  enablePayments: boolean;
}
export interface XeroTaxRate {
  taxType: string;
  name: string;
  status: string;
  canApplyToRevenue: boolean;
  effectiveRate: number | null;
}
export interface XeroTrackingCategory {
  id: string;
  name: string;
  status: string;
  options: { id: string; name: string; status: string }[];
}
export interface XeroOrganisation {
  name: string;
  baseCurrency: string;
}

const MAX_RETRY_AFTER_INLINE = 5;

function retryAfterOf(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

/** Xero's validation messages from a 400 body (ValidationException), joined. */
function validationText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as { Message?: unknown; Detail?: unknown; Elements?: { ValidationErrors?: { Message?: unknown }[] }[]; error?: unknown };
  const msgs = (b.Elements ?? []).flatMap((e) => (e.ValidationErrors ?? []).map((v) => (typeof v.Message === "string" ? v.Message : ""))).filter(Boolean);
  if (msgs.length) return Array.from(new Set(msgs)).join(" ");
  if (typeof b.Detail === "string") return b.Detail;
  if (typeof b.Message === "string") return b.Message;
  if (typeof b.error === "string") return b.error;
  return "";
}

function decodeJwtClaim(token: string, claim: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
    const v = json[claim];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export class XeroClient {
  private readonly app: XeroAppConfig;
  private readonly deps: XeroClientDeps;
  private readonly urls: Record<keyof typeof XERO_URLS, string>;

  constructor(app: XeroAppConfig, deps: XeroClientDeps) {
    this.app = app;
    this.deps = deps;
    this.urls = { ...XERO_URLS, ...(deps.urls ?? {}) };
  }

  /** Longest a single call may take (the send run keeps every item well inside its lease). */
  get timeoutMs(): number {
    return this.deps.timeoutMs ?? 10_000;
  }

  get redirectUri(): string {
    return this.app.redirectUri;
  }

  /** The address the owner's browser is sent to (state = the one-time value stored, hashed, on the clinic's row). */
  authorizeUrl(state: string, scopes: readonly string[]): string {
    const u = new URL(this.urls.authorize);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.app.clientId);
    u.searchParams.set("redirect_uri", this.app.redirectUri);
    u.searchParams.set("scope", scopes.join(" "));
    u.searchParams.set("state", state);
    return u.toString();
  }

  private basic(): string {
    return `Basic ${Buffer.from(`${this.app.clientId}:${this.app.clientSecret}`, "utf8").toString("base64")}`;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const timeout = this.timeoutMs;
    try {
      return await this.deps.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new XeroError("transient", 0, "Xero could not be reached (network or timeout).");
    }
  }

  private async tokenCall(params: Record<string, string>): Promise<XeroTokenSet> {
    const res = await this.send(this.urls.token, {
      method: "POST",
      headers: { authorization: this.basic(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 429 || res.status >= 500) throw new XeroError("transient", res.status, "Xero's sign-in service is busy.", { retryAfterSeconds: retryAfterOf(res) });
    if (!res.ok || !body) {
      // invalid_grant = the code or refresh token is used up, expired or revoked: the clinic must connect again.
      throw new XeroError("auth", res.status, str(body?.error) === "invalid_grant" ? "Xero no longer accepts this connection." : "Xero refused the sign-in.");
    }
    const accessToken = str(body.access_token);
    const refreshToken = str(body.refresh_token);
    if (!accessToken || !refreshToken) throw new XeroError("auth", res.status, "Xero's answer had no tokens.");
    const expiresIn = Number(body.expires_in);
    return {
      accessToken,
      refreshToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 1800,
      scope: str(body.scope),
      authEventId: decodeJwtClaim(accessToken, "authentication_event_id"),
    };
  }

  exchangeCode(code: string): Promise<XeroTokenSet> {
    return this.tokenCall({ grant_type: "authorization_code", code, redirect_uri: this.app.redirectUri });
  }

  /** A refresh token works ONCE: the answer carries its replacement, which must be stored before anything else. */
  refresh(refreshToken: string): Promise<XeroTokenSet> {
    return this.tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  /** Revokes the refresh token (and with it every connection of this sign-in). Best effort. */
  async revoke(refreshToken: string): Promise<void> {
    const res = await this.send(this.urls.revoke, {
      method: "POST",
      headers: { authorization: this.basic(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    if (!res.ok && res.status !== 400) throw new XeroError(res.status >= 500 ? "transient" : "auth", res.status, "Xero did not revoke the connection.");
  }

  /** One call with the short inline retries; JSON answer or a classified XeroError. */
  private async apiCall(accessToken: string, xeroTenantId: string | null, method: string, url: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const retries = this.deps.inlineRetries ?? 2;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
      if (xeroTenantId) headers["xero-tenant-id"] = xeroTenantId;
      if (body !== undefined) headers["content-type"] = "application/json";
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      const res = await this.send(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) {
        if (res.status === 204) return null;
        const text = await res.text().catch(() => null);
        if (text === null) throw new XeroError("transient", res.status, "Xero's answer could not be read. It will be checked again.");
        if (text === "") return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new XeroError("transient", res.status, "Xero's answer could not be read. It will be checked again.");
        }
      }
      const retryAfter = retryAfterOf(res);
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < retries && (res.status !== 429 || (retryAfter ?? 0) <= MAX_RETRY_AFTER_INLINE)) {
        await sleep(res.status === 429 ? (retryAfter ?? 1) * 1000 : 250 * 4 ** attempt);
        continue;
      }
      const parsed = await res.json().catch(() => null);
      if (res.status === 429) {
        const problem = res.headers.get("x-rate-limit-problem");
        throw new XeroError("transient", 429, problem === "day" ? "Xero's daily limit for this organisation is reached." : "Xero asked for fewer requests – trying again shortly.", { retryAfterSeconds: retryAfter });
      }
      if (res.status >= 500) throw new XeroError("transient", res.status, "Xero had a problem and could not take this right now.", { retryAfterSeconds: retryAfter });
      if (res.status === 401) throw new XeroError("auth", 401, "Xero did not accept the sign-in token.", { unauthorized: true });
      if (res.status === 403) throw new XeroError("auth", 403, "Xero refused access – the connection may have been removed in Xero.");
      throw new XeroError("validation", res.status, xeroMessageText(validationText(parsed) || (res.status === 404 ? "not found" : "")));
    }
  }

  async connections(accessToken: string): Promise<XeroConnectionInfo[]> {
    const rows = (await this.apiCall(accessToken, null, "GET", this.urls.connections)) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.map((r: Record<string, unknown>) => ({
      id: str(r.id),
      tenantId: str(r.tenantId),
      tenantType: str(r.tenantType),
      tenantName: str(r.tenantName),
      authEventId: str(r.authEventId) || null,
      createdDateUtc: str(r.createdDateUtc) || null,
    }));
  }

  async deleteConnection(accessToken: string, connectionId: string): Promise<void> {
    await this.apiCall(accessToken, null, "DELETE", `${this.urls.connections}/${encodeURIComponent(connectionId)}`);
  }

  /**
   * The Accounting API for one organisation. `deadline` (ms, by `now`): a call that could not finish before it is not
   * started (XeroDeferred) – the run never outlives its function or an item's lease.
   */
  org(accessToken: string, xeroTenantId: string, limits: { deadline?: number; now?: () => number } = {}): XeroOrgApi {
    const now = limits.now ?? (() => Date.now());
    return new XeroOrgApi((method, path, body, key) => {
      if (limits.deadline !== undefined && now() + this.timeoutMs > limits.deadline) return Promise.reject(new XeroDeferred());
      return this.apiCall(accessToken, xeroTenantId, method, `${this.urls.api}${path}`, body, key);
    });
  }
}

type Call = (method: string, path: string, body?: unknown, idempotencyKey?: string) => Promise<unknown>;

function list(answer: unknown, key: string): Record<string, unknown>[] {
  const v = answer && typeof answer === "object" ? (answer as Record<string, unknown>)[key] : null;
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function whereEq(field: string, value: string): string {
  return `where=${encodeURIComponent(`${field}=="${value.replace(/["\\]/g, "")}"`)}`;
}

/** The first created record's id from a PUT answer, or a validation error when Xero flagged the element. */
function created(answer: unknown, key: string, idField: string): { id: string; number: string | null; raw: Record<string, unknown> } {
  const first = list(answer, key)[0];
  // An accepted call whose answer we cannot read may still have created the record: TRANSIENT (same Idempotency-Key,
  // and the look-ups before the next create), never "blocked" – a blocked item is retried under a new key.
  if (!first) throw new XeroError("transient", 200, "Xero's answer could not be read. It will be checked again.");
  const errors = Array.isArray(first.ValidationErrors) ? (first.ValidationErrors as { Message?: unknown }[]).map((e) => str(e.Message)).filter(Boolean) : [];
  if (first.HasValidationErrors === true || (errors.length && !str(first[idField]))) throw new XeroError("validation", 200, xeroMessageText(errors.join(" ")));
  const id = str(first[idField]);
  if (!id) throw new XeroError("transient", 200, "Xero's answer could not be read. It will be checked again.");
  return { id, number: str(first.InvoiceNumber) || str(first.CreditNoteNumber) || null, raw: first };
}

export interface XeroDocMatch {
  id: string;
  type: string;
  /** Pounds. */
  total: number | null;
  contactId: string | null;
}

function docMatch(d: Record<string, unknown>, idField: string): XeroDocMatch {
  const contact = d.Contact && typeof d.Contact === "object" ? str((d.Contact as Record<string, unknown>).ContactID) : "";
  return { id: str(d[idField]), type: str(d.Type), total: typeof d.Total === "number" ? d.Total : null, contactId: contact || null };
}

export class XeroOrgApi {
  constructor(private readonly call: Call) {}

  async organisation(): Promise<XeroOrganisation> {
    const o = list(await this.call("GET", "/Organisation"), "Organisations")[0] ?? {};
    return { name: str(o.Name), baseCurrency: str(o.BaseCurrency) };
  }

  async accounts(): Promise<XeroAccount[]> {
    return list(await this.call("GET", "/Accounts"), "Accounts").map((a) => ({
      code: str(a.Code),
      name: str(a.Name),
      type: str(a.Type),
      status: str(a.Status),
      enablePayments: a.EnablePaymentsToAccount === true || a.Type === "BANK",
    }));
  }

  async taxRates(): Promise<XeroTaxRate[]> {
    return list(await this.call("GET", "/TaxRates"), "TaxRates").map((t) => ({
      taxType: str(t.TaxType),
      name: str(t.Name),
      status: str(t.Status),
      canApplyToRevenue: t.CanApplyToRevenue !== false,
      effectiveRate: typeof t.EffectiveRate === "number" ? t.EffectiveRate : null,
    }));
  }

  async trackingCategories(): Promise<XeroTrackingCategory[]> {
    return list(await this.call("GET", "/TrackingCategories"), "TrackingCategories").map((c) => ({
      id: str(c.TrackingCategoryID),
      name: str(c.Name),
      status: str(c.Status),
      options: (Array.isArray(c.Options) ? (c.Options as Record<string, unknown>[]) : []).map((o) => ({ id: str(o.TrackingOptionID), name: str(o.Name), status: str(o.Status) })),
    }));
  }

  /** The active contact with this ContactNumber (its id and name), or null. */
  async findContactByNumber(contactNumber: string): Promise<{ id: string; name: string } | null> {
    const hit = list(await this.call("GET", `/Contacts?${whereEq("ContactNumber", contactNumber)}`), "Contacts").find((c) => str(c.ContactNumber) === contactNumber && str(c.ContactStatus) !== "ARCHIVED");
    return hit && str(hit.ContactID) ? { id: str(hit.ContactID), name: str(hit.Name) } : null;
  }

  /** An active contact whose name is exactly `name` (case-insensitive) – Xero keeps contact names unique. */
  async findContactByName(name: string): Promise<string | null> {
    const want = name.trim().toLowerCase();
    const hits = list(await this.call("GET", `/Contacts?searchTerm=${encodeURIComponent(name.trim().slice(0, 100))}`), "Contacts");
    const hit = hits.find((c) => str(c.Name).trim().toLowerCase() === want && str(c.ContactStatus) !== "ARCHIVED");
    return hit ? str(hit.ContactID) || null : null;
  }

  async createContact(body: unknown, idempotencyKey: string): Promise<string> {
    return created(await this.call("PUT", "/Contacts", { Contacts: [body] }, idempotencyKey), "Contacts", "ContactID").id;
  }

  /** A live document with this invoice number: what it is, its total and its contact (to check it is OURS). */
  async findInvoiceByNumber(number: string): Promise<XeroDocMatch | null> {
    const hit = list(await this.call("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(number)}`), "Invoices").find((i) => str(i.InvoiceNumber) === number && str(i.Status) !== "DELETED" && str(i.Status) !== "VOIDED");
    return hit && str(hit.InvoiceID) ? docMatch(hit, "InvoiceID") : null;
  }

  async createInvoice(body: unknown, idempotencyKey: string): Promise<{ id: string; number: string | null }> {
    const r = created(await this.call("PUT", "/Invoices", { Invoices: [body] }, idempotencyKey), "Invoices", "InvoiceID");
    return { id: r.id, number: r.number };
  }

  /** An invoice's amount due (pounds) and its payments (to find one we sent whose answer was lost). */
  async invoiceState(invoiceId: string): Promise<{ amountDue: number | null; payments: { id: string; reference: string; amount: number }[] }> {
    const inv = list(await this.call("GET", `/Invoices/${encodeURIComponent(invoiceId)}`), "Invoices")[0];
    if (!inv) return { amountDue: null, payments: [] };
    const payments = (Array.isArray(inv.Payments) ? (inv.Payments as Record<string, unknown>[]) : [])
      .filter((p) => str(p.Status) !== "DELETED")
      .map((p) => ({ id: str(p.PaymentID), reference: str(p.Reference), amount: typeof p.Amount === "number" ? p.Amount : Number(p.Amount) }));
    return { amountDue: typeof inv.AmountDue === "number" ? inv.AmountDue : null, payments };
  }

  async findCreditNoteByNumber(number: string): Promise<XeroDocMatch | null> {
    const hit = list(await this.call("GET", `/CreditNotes?${whereEq("CreditNoteNumber", number)}`), "CreditNotes").find((c) => str(c.CreditNoteNumber) === number && str(c.Status) !== "DELETED" && str(c.Status) !== "VOIDED");
    return hit && str(hit.CreditNoteID) ? docMatch(hit, "CreditNoteID") : null;
  }

  /** What is left of a credit note to allocate (pounds), or null when Xero did not say. */
  async creditNoteRemaining(creditNoteId: string): Promise<number | null> {
    const cn = list(await this.call("GET", `/CreditNotes/${encodeURIComponent(creditNoteId)}`), "CreditNotes")[0];
    return cn && typeof cn.RemainingCredit === "number" ? cn.RemainingCredit : null;
  }

  async createCreditNote(body: unknown, idempotencyKey: string): Promise<{ id: string; number: string | null }> {
    const r = created(await this.call("PUT", "/CreditNotes", { CreditNotes: [body] }, idempotencyKey), "CreditNotes", "CreditNoteID");
    return { id: r.id, number: r.number };
  }

  /** Allocates (part of) a credit note to an invoice. */
  async allocateCreditNote(creditNoteId: string, invoiceId: string, amount: number, date: string, idempotencyKey: string): Promise<void> {
    await this.call("PUT", `/CreditNotes/${encodeURIComponent(creditNoteId)}/Allocations`, { Allocations: [{ Amount: amount, Date: date, Invoice: { InvoiceID: invoiceId } }] }, idempotencyKey);
  }

  async createPayment(body: unknown, idempotencyKey: string): Promise<string> {
    return created(await this.call("PUT", "/Payments", { Payments: [body] }, idempotencyKey), "Payments", "PaymentID").id;
  }

  /** Payments are never edited in Xero, only deleted (status DELETED). */
  async deletePayment(paymentId: string, idempotencyKey: string): Promise<void> {
    await this.call("POST", `/Payments/${encodeURIComponent(paymentId)}`, { Payments: [{ Status: "DELETED" }] }, idempotencyKey);
  }
}
