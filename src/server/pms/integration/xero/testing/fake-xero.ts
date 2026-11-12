/**
 * TESTS ONLY: an in-memory fake of Xero's identity service and Accounting API, shaped after Xero's public API docs –
 * enough of it for the sync: the token endpoint (authorization_code and refresh_token, refresh tokens single-use and
 * rotated), revocation, /connections, Organisation / Accounts / TaxRates / TrackingCategories, Contacts, Invoices,
 * CreditNotes (+ Allocations) and Payments, with Idempotency-Key replay, per-organisation access checks and
 * injected failures (429 with Retry-After, 5xx, a 5xx AFTER the record was saved, 401, 403). Nothing real is called.
 *
 * Use: const xero = new FakeXero(); new XeroClient(xero.app, { fetch: xero.fetch, urls: xero.urls, sleep: async () => {} }).
 */
import { randomUUID } from "node:crypto";
import type { XeroAppConfig } from "../client";

type Json = Record<string, unknown>;

export interface FakeOrg {
  tenantId: string;
  name: string;
  currency: string;
  accounts: Json[];
  taxRates: Json[];
  tracking: Json[];
  contacts: Json[];
  invoices: Json[];
  creditNotes: Json[];
  payments: Json[];
}

interface Grant {
  authEventId: string;
  orgIds: string[];
}

export interface InjectedFailure {
  /** Matched against "<METHOD> <path>" (path without the host, with the query). */
  match: RegExp;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Answer the failure AFTER handling the request (the record IS saved – a lost answer). */
  afterSave?: boolean;
  times?: number;
}

const BASE = "https://fake-xero.test";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const validation = (message: string) => jsonResponse(400, { ErrorNumber: 10, Type: "ValidationException", Message: "A validation exception occurred", Elements: [{ ValidationErrors: [{ Message: message }] }] });

export function defaultOrg(name: string, currency = "GBP"): FakeOrg {
  return {
    tenantId: randomUUID(),
    name,
    currency,
    accounts: [
      { AccountID: randomUUID(), Code: "200", Name: "Sales", Type: "REVENUE", Status: "ACTIVE" },
      { AccountID: randomUUID(), Code: "260", Name: "Other Revenue", Type: "OTHERINCOME", Status: "ACTIVE" },
      { AccountID: randomUUID(), Code: "684", Name: "Bad debts", Type: "EXPENSE", Status: "ACTIVE" },
      { AccountID: randomUUID(), Code: "090", Name: "Business Bank Account", Type: "BANK", Status: "ACTIVE", EnablePaymentsToAccount: false },
      { AccountID: randomUUID(), Code: "610", Name: "Card clearing", Type: "CURRLIAB", Status: "ACTIVE", EnablePaymentsToAccount: true },
      { AccountID: randomUUID(), Code: "999", Name: "Old sales", Type: "REVENUE", Status: "ARCHIVED" },
    ],
    taxRates: [
      { Name: "20% (VAT on Income)", TaxType: "OUTPUT2", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 20 },
      { Name: "5% (VAT on Income)", TaxType: "RROUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 5 },
      { Name: "Exempt Income", TaxType: "EXEMPTOUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0 },
      { Name: "Zero Rated Income", TaxType: "ZERORATEDOUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0 },
      { Name: "No VAT", TaxType: "NONE", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0 },
    ],
    tracking: [
      {
        TrackingCategoryID: randomUUID(),
        Name: "Clinic site",
        Status: "ACTIVE",
        Options: [
          { TrackingOptionID: randomUUID(), Name: "Bletchley", Status: "ACTIVE" },
          { TrackingOptionID: randomUUID(), Name: "Towcester", Status: "ACTIVE" },
        ],
      },
    ],
    contacts: [],
    invoices: [],
    creditNotes: [],
    payments: [],
  };
}

export class FakeXero {
  readonly app: XeroAppConfig = { clientId: "fake-client-id", clientSecret: "fake-client-secret-not-real", redirectUri: "https://clinic.example.com/api/xero/callback" };
  readonly urls = {
    authorize: `${BASE}/identity/connect/authorize`,
    token: `${BASE}/connect/token`,
    revoke: `${BASE}/connect/revocation`,
    connections: `${BASE}/connections`,
    api: `${BASE}/api.xro/2.0`,
  };
  readonly orgs = new Map<string, FakeOrg>();
  /** connection id → org (every connection the fake Xero user made). */
  readonly connections = new Map<string, { id: string; tenantId: string; authEventId: string; created: string }>();
  private readonly codes = new Map<string, Grant>();
  private readonly access = new Map<string, { exp: number; orgIds: string[] }>();
  private readonly refreshTokens = new Map<string, Grant>();
  private readonly idempotency = new Map<string, Response>();
  private failures: InjectedFailure[] = [];
  readonly calls: string[] = [];
  /** The fake's own clock (ms) for token expiry. */
  now = () => Date.now();

  addOrg(org: FakeOrg): FakeOrg {
    this.orgs.set(org.tenantId, org);
    return org;
  }

  /** What Xero hands the redirect after the user allowed these organisations: a one-time code. */
  issueCode(orgIds: string[]): string {
    const code = `code-${randomUUID()}`;
    const authEventId = randomUUID();
    this.codes.set(code, { authEventId, orgIds });
    for (const tenantId of orgIds) {
      const id = randomUUID();
      this.connections.set(id, { id, tenantId, authEventId, created: new Date(this.now()).toISOString() });
    }
    return code;
  }

  fail(f: InjectedFailure): void {
    this.failures.push({ times: 1, ...f });
  }

  clearFailures(): void {
    this.failures = [];
  }

  /** Expires every access token now (forces a refresh). */
  expireAccessTokens(): void {
    this.access.forEach((v) => {
      v.exp = 0;
    });
  }

  /** Revokes every refresh token (as when the clinic removes the app in Xero). */
  revokeAll(): void {
    this.refreshTokens.clear();
    this.access.clear();
  }

  count(re: RegExp): number {
    return this.calls.filter((c) => re.test(c)).length;
  }

  private mint(grant: Grant): Json {
    const accessToken = `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify({ authentication_event_id: grant.authEventId, jti: randomUUID() }))}.sig`;
    const refreshToken = `rt-${randomUUID()}`;
    this.access.set(accessToken, { exp: this.now() + 1800_000, orgIds: grant.orgIds });
    this.refreshTokens.set(refreshToken, grant);
    return { access_token: accessToken, refresh_token: refreshToken, expires_in: 1800, token_type: "Bearer", scope: "openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read" };
  }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}${url.search}`;
    this.calls.push(key);
    const f = this.failures.find((x) => x.match.test(key) && (x.times ?? 1) > 0);
    if (f && !f.afterSave) {
      f.times = (f.times ?? 1) - 1;
      return jsonResponse(f.status, f.body ?? { Message: "Injected failure" }, f.headers);
    }
    const res = await this.handle(url, method, init);
    if (f && f.afterSave) {
      f.times = (f.times ?? 1) - 1;
      return jsonResponse(f.status, f.body ?? { Message: "Injected failure after save" }, f.headers);
    }
    return res;
  };

  private headerOf(init: RequestInit, name: string): string | null {
    const h = new Headers(init.headers);
    return h.get(name);
  }

  private async handle(url: URL, method: string, init: RequestInit): Promise<Response> {
    const path = url.pathname;
    if (path === "/connect/token" || path === "/connect/revocation") {
      const basic = this.headerOf(init, "authorization");
      if (basic !== `Basic ${Buffer.from(`${this.app.clientId}:${this.app.clientSecret}`).toString("base64")}`) return jsonResponse(401, { error: "invalid_client" });
      const form = new URLSearchParams(String(init.body ?? ""));
      if (path === "/connect/revocation") {
        this.refreshTokens.delete(form.get("token") ?? "");
        return new Response(null, { status: 200 });
      }
      if (form.get("grant_type") === "authorization_code") {
        const grant = this.codes.get(form.get("code") ?? "");
        if (!grant || form.get("redirect_uri") !== this.app.redirectUri) return jsonResponse(400, { error: "invalid_grant" });
        this.codes.delete(form.get("code") ?? "");
        return jsonResponse(200, this.mint(grant));
      }
      if (form.get("grant_type") === "refresh_token") {
        const old = form.get("refresh_token") ?? "";
        const grant = this.refreshTokens.get(old);
        if (!grant) return jsonResponse(400, { error: "invalid_grant" });
        this.refreshTokens.delete(old); // single use: rotated
        return jsonResponse(200, this.mint(grant));
      }
      return jsonResponse(400, { error: "unsupported_grant_type" });
    }

    const bearer = (this.headerOf(init, "authorization") ?? "").replace(/^Bearer /, "");
    const tok = this.access.get(bearer);
    if (!tok || tok.exp <= this.now()) return jsonResponse(401, { Title: "Unauthorized", Detail: "TokenExpired" });

    if (path === "/connections" && method === "GET") {
      return jsonResponse(
        200,
        Array.from(this.connections.values())
          .filter((c) => tok.orgIds.includes(c.tenantId))
          .map((c) => ({ id: c.id, authEventId: c.authEventId, tenantId: c.tenantId, tenantType: "ORGANISATION", tenantName: this.orgs.get(c.tenantId)?.name ?? "", createdDateUtc: c.created })),
      );
    }
    const delConn = /^\/connections\/(.+)$/.exec(path);
    if (delConn && method === "DELETE") {
      this.connections.delete(delConn[1]);
      return new Response(null, { status: 204 });
    }

    const tenant = this.headerOf(init, "xero-tenant-id") ?? "";
    const org = this.orgs.get(tenant);
    const connected = Array.from(this.connections.values()).some((c) => c.tenantId === tenant);
    if (!org || !tok.orgIds.includes(tenant) || !connected) return jsonResponse(403, { Title: "Forbidden", Detail: "AuthenticationUnsuccessful" });

    const idem = this.headerOf(init, "idempotency-key");
    const idemKey = idem ? `${tenant}:${idem}` : null;
    if (idemKey && this.idempotency.has(idemKey)) return this.idempotency.get(idemKey)!.clone();
    const res = this.api(org, url, method, init.body ? (JSON.parse(String(init.body)) as Json) : null);
    if (idemKey && (method === "PUT" || method === "POST") && res.ok) this.idempotency.set(idemKey, res.clone());
    return res;
  }

  private api(org: FakeOrg, url: URL, method: string, body: Json | null): Response {
    const p = url.pathname.replace(/^\/api\.xro\/2\.0/, "");
    const where = url.searchParams.get("where") ?? "";
    const eq = /^(\w+)=="(.*)"$/.exec(where);
    if (method === "GET" && p === "/Organisation") return jsonResponse(200, { Organisations: [{ Name: org.name, BaseCurrency: org.currency, CountryCode: "GB" }] });
    if (method === "GET" && p === "/Accounts") return jsonResponse(200, { Accounts: org.accounts });
    if (method === "GET" && p === "/TaxRates") return jsonResponse(200, { TaxRates: org.taxRates });
    if (method === "GET" && p === "/TrackingCategories") return jsonResponse(200, { TrackingCategories: org.tracking });
    if (method === "GET" && p === "/Contacts") {
      const term = (url.searchParams.get("searchTerm") ?? "").toLowerCase();
      const rows = org.contacts.filter((c) => (eq ? String(c[eq[1]]) === eq[2] : term ? String(c.Name).toLowerCase().includes(term) : true));
      return jsonResponse(200, { Contacts: rows });
    }
    if (method === "PUT" && p === "/Contacts") {
      const c = (body?.Contacts as Json[])[0];
      if (org.contacts.some((x) => String(x.Name).toLowerCase() === String(c.Name).toLowerCase())) return validation(`The contact name ${String(c.Name)} is already assigned to another contact.`);
      const row = { ...c, ContactID: randomUUID(), ContactStatus: "ACTIVE" };
      org.contacts.push(row);
      return jsonResponse(200, { Contacts: [row] });
    }
    if (method === "GET" && p === "/Invoices") {
      const numbers = (url.searchParams.get("InvoiceNumbers") ?? "").split(",").filter(Boolean);
      return jsonResponse(200, { Invoices: org.invoices.filter((i) => numbers.includes(String(i.InvoiceNumber))) });
    }
    const invOne = /^\/Invoices\/([^/]+)$/.exec(p);
    if (method === "GET" && invOne) {
      const inv = org.invoices.find((i) => i.InvoiceID === invOne[1]);
      return inv ? jsonResponse(200, { Invoices: [inv] }) : jsonResponse(404, { Message: "Not found" });
    }
    if (method === "PUT" && p === "/Invoices") {
      const inv = (body?.Invoices as Json[])[0];
      const err = this.checkDoc(org, inv, "InvoiceNumber", org.invoices);
      if (err) return validation(err);
      const total = this.total(inv);
      const row = { ...inv, InvoiceID: randomUUID(), Total: total, AmountDue: total, AmountPaid: 0, AmountCredited: 0 };
      org.invoices.push(row);
      return jsonResponse(200, { Invoices: [row] });
    }
    if (method === "GET" && p === "/CreditNotes") return jsonResponse(200, { CreditNotes: org.creditNotes.filter((c) => (eq ? String(c[eq[1]]) === eq[2] : true)) });
    if (method === "PUT" && p === "/CreditNotes") {
      const cn = (body?.CreditNotes as Json[])[0];
      const err = this.checkDoc(org, cn, "CreditNoteNumber", org.creditNotes);
      if (err) return validation(err);
      const total = this.total(cn);
      const row = { ...cn, CreditNoteID: randomUUID(), Total: total, RemainingCredit: total, Allocations: [] as Json[] };
      org.creditNotes.push(row);
      return jsonResponse(200, { CreditNotes: [row] });
    }
    const alloc = /^\/CreditNotes\/([^/]+)\/Allocations$/.exec(p);
    if (method === "PUT" && alloc) {
      const cn = org.creditNotes.find((c) => c.CreditNoteID === alloc[1]);
      const a = (body?.Allocations as Json[])[0];
      const inv = org.invoices.find((i) => i.InvoiceID === (a.Invoice as Json).InvoiceID);
      const amount = Number(a.Amount);
      if (!cn || !inv) return validation("Credit note or invoice not found.");
      if (amount > Number(inv.AmountDue) + 1e-9 || amount > Number(cn.RemainingCredit) + 1e-9) return validation("Amount allocated is more than the amount due.");
      inv.AmountDue = Math.round((Number(inv.AmountDue) - amount) * 100) / 100;
      inv.AmountCredited = Math.round((Number(inv.AmountCredited) + amount) * 100) / 100;
      cn.RemainingCredit = Math.round((Number(cn.RemainingCredit) - amount) * 100) / 100;
      (cn.Allocations as Json[]).push({ Amount: amount, Invoice: { InvoiceID: inv.InvoiceID } });
      return jsonResponse(200, { Allocations: [a] });
    }
    if (method === "PUT" && p === "/Payments") {
      const pay = (body?.Payments as Json[])[0];
      const inv = org.invoices.find((i) => i.InvoiceID === (pay.Invoice as Json).InvoiceID);
      const account = org.accounts.find((a) => a.Code === (pay.Account as Json).Code);
      if (!inv) return validation("Invoice could not be found.");
      if (!account || account.Status !== "ACTIVE" || !(account.EnablePaymentsToAccount === true || account.Type === "BANK")) return validation("Payments cannot be made to this account.");
      if (Number(pay.Amount) > Number(inv.AmountDue) + 1e-9) return validation("Payment amount exceeds the amount outstanding on this document.");
      inv.AmountDue = Math.round((Number(inv.AmountDue) - Number(pay.Amount)) * 100) / 100;
      inv.AmountPaid = Math.round((Number(inv.AmountPaid) + Number(pay.Amount)) * 100) / 100;
      const row = { ...pay, PaymentID: randomUUID(), Status: "AUTHORISED" };
      org.payments.push(row);
      return jsonResponse(200, { Payments: [row] });
    }
    const payOne = /^\/Payments\/([^/]+)$/.exec(p);
    if (method === "POST" && payOne) {
      const pay = org.payments.find((x) => x.PaymentID === payOne[1]);
      if (!pay) return jsonResponse(404, { Message: "Not found" });
      if (pay.Status === "DELETED") return validation("Payment has already been deleted.");
      pay.Status = "DELETED";
      const inv = org.invoices.find((i) => i.InvoiceID === (pay.Invoice as Json).InvoiceID);
      if (inv) {
        inv.AmountDue = Math.round((Number(inv.AmountDue) + Number(pay.Amount)) * 100) / 100;
        inv.AmountPaid = Math.round((Number(inv.AmountPaid) - Number(pay.Amount)) * 100) / 100;
      }
      return jsonResponse(200, { Payments: [pay] });
    }
    return jsonResponse(404, { Message: `The fake has no ${method} ${p}` });
  }

  private checkDoc(org: FakeOrg, doc: Json, numberField: string, existing: Json[]): string | null {
    if (existing.some((d) => d[numberField] === doc[numberField])) return `${numberField} must be unique.`;
    const contact = org.contacts.find((c) => c.ContactID === (doc.Contact as Json)?.ContactID);
    if (!contact) return "The contact could not be found.";
    for (const l of (doc.LineItems as Json[]) ?? []) {
      const acc = org.accounts.find((a) => a.Code === l.AccountCode);
      if (!acc || acc.Status !== "ACTIVE") return `Account code ${String(l.AccountCode)} is not a valid code for this document.`;
      if (!org.taxRates.some((t) => t.TaxType === l.TaxType && t.Status === "ACTIVE")) return `The TaxType code ${String(l.TaxType)} does not exist or cannot be used for this type of transaction.`;
    }
    return null;
  }

  /** The document total as Xero would work it out from the lines (pounds). */
  total(doc: Json): number {
    const lines = (doc.LineItems as Json[]) ?? [];
    const sum = lines.reduce((s, l) => s + Number(l.LineAmount) + (doc.LineAmountTypes === "Exclusive" ? Number(l.TaxAmount ?? 0) : 0), 0);
    return Math.round(sum * 100) / 100;
  }
}
