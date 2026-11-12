/**
 * Xero sync (xe05): one clinic's send run. Queue what is due (repos queueDueItems), then send item by item in order
 * (invoices, credit notes, payments, payment removals), each claimed by one worker (lease), with:
 *
 * - IDEMPOTENCY three ways: a record with a link (pms_xero_links) is never created again; before creating, Xero is
 *   asked for the same number (an earlier try that timed out after Xero saved it); and every create carries an
 *   Idempotency-Key stable for the item and its payload version.
 * - RETRY: Xero's 429 / 5xx / timeouts go back on the list with back-off (Retry-After honoured); a missing map or a
 *   Xero validation error is "blocked" (shown with Retry / Skip); refused tokens pause the clinic's connection.
 * - TOKENS: refreshed under the row's rev (one refresh at a time – a refresh token works once), 401 → one refresh and
 *   one more try.
 * - TENANT ISOLATION: everything is read with the clinic's id; the Xero organisation id comes from that clinic's own
 *   connection row only.
 *
 * Nothing is read back from Xero except look-ups that stop a duplicate and an invoice's amount due (to allocate a
 * credit note no further than Xero allows).
 */
import "server-only";
import { PAYMENT_METHOD_LABELS } from "../../../../modules/pms/billing/copy";
import { XERO_ACCESS_SKEW_SECONDS, XERO_ITEMS_PER_RUN, XERO_COPY, idempotencyKeyFor } from "../../../../modules/pms/integration/xero";
import {
  allocationToXero,
  contactNumberFor,
  contactToXero,
  creditNoteToXero,
  invoiceToXero,
  pounds,
  type XeroContactSource,
  type XeroCreditNoteSource,
  type XeroInvoiceSource,
  type XeroLineSource,
  type XeroMaps,
} from "../../../../modules/pms/integration/xero-mappers";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { nowIso, num, parseLines, type RepoContext } from "../../../repos/pms/context";
import {
  auditPush,
  claimItem,
  claimTokenRefresh,
  dueItems,
  finishItem,
  getLink,
  getXeroMaps,
  openConnection,
  pauseXero,
  putLink,
  queueDueItems,
  releaseTokenRefresh,
  sha256Hex,
  storeRefreshedTokens,
  type ItemOutcome,
  type OpenConnection,
  type SyncItem,
} from "../../../repos/pms/integration/xero";
import { londonDate } from "../../../../modules/pms/diary/time";
import { XeroError, type XeroClient, type XeroOrgApi } from "./client";

const ALLOCATED = sha256Hex("credit-note-allocated");

/* ------------------------------------------------------------------------------------------------
 * Tokens
 * ----------------------------------------------------------------------------------------------*/

class AuthStop extends Error {}

/** The clinic's access token for this run: refreshed when close to its end, once on a 401. */
export class TokenSession {
  constructor(
    private readonly ctx: RepoContext,
    private readonly tenantId: string,
    private readonly client: XeroClient,
    private conn: OpenConnection,
  ) {}

  get xeroTenantId(): string {
    return this.conn.xeroTenantId;
  }

  private fresh(): boolean {
    const left = this.conn.accessExpiresAt ? Date.parse(this.conn.accessExpiresAt) - Date.parse(nowIso(this.ctx)) : -1;
    return left > XERO_ACCESS_SKEW_SECONDS * 1000;
  }

  async accessToken(force = false): Promise<string> {
    if (!force && this.fresh()) return this.conn.tokens.accessToken;
    const claimed = await claimTokenRefresh(this.ctx, this.tenantId, this.conn.rev);
    if (claimed === null) {
      // Someone else refreshed (or is refreshing): use theirs if it is there.
      const again = await openConnection(this.ctx, this.tenantId);
      if (!again) throw new AuthStop("The Xero connection is not active.");
      const moved = again.tokens.accessToken !== this.conn.tokens.accessToken;
      this.conn = again;
      if (moved && this.fresh()) return this.conn.tokens.accessToken;
      throw new XeroError("transient", 0, "Xero sign-in is being renewed – trying again shortly.");
    }
    let next;
    try {
      next = await this.client.refresh(this.conn.tokens.refreshToken);
    } catch (err) {
      if (err instanceof XeroError && err.errorClass === "auth") {
        await pauseXero(this.ctx, this.tenantId, err.message);
        throw new AuthStop(err.message);
      }
      await releaseTokenRefresh(this.ctx, this.tenantId, claimed);
      throw err;
    }
    const expiresAt = new Date(Date.parse(nowIso(this.ctx)) + next.expiresIn * 1000).toISOString();
    const stored = await storeRefreshedTokens(this.ctx, this.tenantId, claimed, { accessToken: next.accessToken, refreshToken: next.refreshToken }, expiresAt);
    if (!stored) throw new XeroError("transient", 0, "Xero sign-in changed meanwhile – trying again shortly.");
    this.conn = { ...this.conn, tokens: { accessToken: next.accessToken, refreshToken: next.refreshToken }, accessExpiresAt: expiresAt, rev: claimed + 1, refreshLockUntil: null };
    return next.accessToken;
  }

  /** Runs `work` against the organisation; a 401 refreshes once and tries once more. */
  async withApi<T>(work: (api: XeroOrgApi) => Promise<T>): Promise<T> {
    const api = this.client.org(await this.accessToken(), this.conn.xeroTenantId);
    try {
      return await work(api);
    } catch (err) {
      if (!(err instanceof XeroError) || !err.unauthorized) throw err;
      const retry = this.client.org(await this.accessToken(true), this.conn.xeroTenantId);
      try {
        return await work(retry);
      } catch (err2) {
        if (err2 instanceof XeroError && err2.unauthorized) {
          await pauseXero(this.ctx, this.tenantId, err2.message);
          throw new AuthStop(err2.message);
        }
        throw err2;
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Loaders (every statement scoped to the clinic)
 * ----------------------------------------------------------------------------------------------*/

interface LoadedInvoice extends XeroInvoiceSource {
  contact: XeroContactSource & { localType: "patient" | "referrer"; localId: string };
}

async function loadLines(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<XeroLineSource[]> {
  const rows = await ctx.db
    .selectFrom("pms_invoice_lines as l")
    .leftJoin("pms_services as s", (j) => j.onRef("s.tenant_id", "=", "l.tenant_id").onRef("s.id", "=", "l.service_id"))
    .select(["l.id", "l.kind", "l.service_id", "s.name as service_name", "l.service_on", "l.visit_status", "l.quantity", "l.unit_price_pence", "l.discount_pence", "l.vat_code", "l.net_pence", "l.vat_pence", "l.total_pence"])
    .where("l.tenant_id", "=", tenantId)
    .where("l.invoice_id", "=", invoiceId)
    .orderBy("l.line_no")
    .limit(500)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    serviceId: r.service_id,
    serviceName: r.service_name ?? null,
    serviceOn: r.service_on,
    visitStatus: r.visit_status,
    quantity: num(r.quantity),
    unitPricePence: num(r.unit_price_pence),
    discountPence: num(r.discount_pence),
    vatCode: r.vat_code,
    netPence: num(r.net_pence),
    vatPence: num(r.vat_pence),
    totalPence: num(r.total_pence),
  }));
}

async function loadContact(ctx: RepoContext, tenantId: string, inv: { bill_to: string; payer_referrer_id: string | null; patient_id: string }): Promise<LoadedInvoice["contact"] | null> {
  if (inv.bill_to === "payer" && inv.payer_referrer_id) {
    const r = await ctx.db.selectFrom("pms_referrers").select(["id", "name", "email", "address_json", "postcode"]).where("tenant_id", "=", tenantId).where("id", "=", inv.payer_referrer_id).executeTakeFirst();
    if (!r) return null;
    return { kind: "referrer", key: r.id, name: r.name, email: r.email, address: { lines: parseLines(r.address_json) ?? [], postcode: r.postcode }, localType: "referrer", localId: r.id };
  }
  const p = await ctx.db.selectFrom("pms_patients").select(["id", "patient_number", "first_name", "last_name", "email", "address_json", "postcode"]).where("tenant_id", "=", tenantId).where("id", "=", inv.patient_id).executeTakeFirst();
  if (!p) return null;
  return {
    kind: "patient",
    key: String(num(p.patient_number)),
    name: `${p.first_name} ${p.last_name}`,
    email: p.email,
    address: { lines: parseLines(p.address_json) ?? [], postcode: p.postcode },
    localType: "patient",
    localId: p.id,
  };
}

async function loadInvoice(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<LoadedInvoice | null> {
  const inv = await ctx.db
    .selectFrom("pms_invoices")
    .select(["id", "status", "number_prefix", "number_seq", "issued_on", "due_on", "prices_include_vat", "site_id", "bill_to", "payer_referrer_id", "patient_id", "authorisation_id", "total_pence"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId)
    .executeTakeFirst();
  if (!inv || inv.status !== "issued" || !inv.issued_on || inv.number_seq === null) return null;
  const [settings, lines, contact, auth] = await Promise.all([
    ctx.db.selectFrom("pms_billing_settings").select("vat_registered").where("tenant_id", "=", tenantId).executeTakeFirst(),
    loadLines(ctx, tenantId, invoiceId),
    loadContact(ctx, tenantId, inv),
    inv.authorisation_id ? ctx.db.selectFrom("pms_authorisations").select("code").where("tenant_id", "=", tenantId).where("id", "=", inv.authorisation_id).executeTakeFirst() : Promise.resolve(undefined),
  ]);
  if (!contact) return null;
  return {
    id: inv.id,
    number: `${inv.number_prefix ?? ""}${num(inv.number_seq)}`,
    issuedOn: inv.issued_on,
    dueOn: inv.due_on,
    pricesIncludeVat: num(inv.prices_include_vat) === 1,
    vatRegistered: num(settings?.vat_registered ?? 0) === 1,
    siteId: inv.site_id,
    reference: auth?.code ?? (contact.kind === "patient" ? `P${contact.key}` : ""),
    totalPence: num(inv.total_pence),
    lines,
    contact,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Senders
 * ----------------------------------------------------------------------------------------------*/

interface RunCtx {
  ctx: RepoContext;
  tenantId: string;
  session: TokenSession;
  maps: XeroMaps;
  withDetails: boolean;
  key: (suffix: string) => string;
}

function blocked(missing: string[]): ItemOutcome {
  return { kind: "validation", message: `${XERO_COPY.mappingsMissing} ${missing.join(", ")}.` };
}

async function ensureContact(run: RunCtx, contact: LoadedInvoice["contact"]): Promise<string> {
  const link = await getLink(run.ctx, run.tenantId, contact.localType, contact.localId);
  if (link) return link.xeroId;
  const body = contactToXero(contact, run.withDetails);
  const number = contactNumberFor(contact.kind, contact.key);
  const id = await run.session.withApi(async (api) => {
    const found = (await api.findContactByNumber(number)) ?? (contact.kind === "referrer" ? await api.findContactByName(contact.name) : null);
    return found ?? (await api.createContact(body, idempotencyKeyFor(run.tenantId, `contact:${contact.localType}:${contact.localId}`, 1, sha256Hex)));
  });
  return putLink(run.ctx, run.tenantId, contact.localType, contact.localId, id, number, sha256Hex(JSON.stringify(body)));
}

async function sendInvoice(run: RunCtx, item: SyncItem): Promise<ItemOutcome> {
  const link = await getLink(run.ctx, run.tenantId, "invoice", item.localId);
  if (link) return { kind: "done", xeroId: link.xeroId };
  const inv = await loadInvoice(run.ctx, run.tenantId, item.localId);
  if (!inv) return { kind: "skipped", message: "This invoice is no longer issued – nothing to send." };
  // Maps first: nothing (not even a contact) is created in Xero for an invoice that cannot be sent.
  const check = invoiceToXero(inv, "00000000-0000-0000-0000-000000000000", run.maps);
  if (!check.ok) return blocked(check.missing);
  const contactId = await ensureContact(run, inv.contact);
  const mapped = invoiceToXero(inv, contactId, run.maps);
  if (!mapped.ok) return blocked(mapped.missing);
  const xeroId = await run.session.withApi(async (api) => (await api.findInvoiceByNumber(inv.number)) ?? (await api.createInvoice(mapped.body, run.key("")) ).id);
  return { kind: "done", xeroId: await putLink(run.ctx, run.tenantId, "invoice", inv.id, xeroId, inv.number, null) };
}

async function sendCreditNote(run: RunCtx, item: SyncItem): Promise<ItemOutcome> {
  const { ctx, tenantId } = run;
  const cn = await ctx.db
    .selectFrom("pms_credit_notes")
    .select(["id", "invoice_id", "number_prefix", "number_seq", "issued_on", "kind", "total_pence"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", item.localId)
    .executeTakeFirst();
  if (!cn) return { kind: "skipped", message: "This credit note no longer exists – nothing to send." };
  const invLink = await getLink(ctx, tenantId, "invoice", cn.invoice_id);
  if (!invLink) return { kind: "waiting", message: "Waiting for its invoice to be sent first." };
  const inv = await loadInvoice(ctx, tenantId, cn.invoice_id);
  if (!inv) return { kind: "skipped", message: "Its invoice is no longer issued – nothing to send." };
  const number = `${cn.number_prefix}${num(cn.number_seq)}`;
  let link = await getLink(ctx, tenantId, "credit_note", cn.id);
  if (!link) {
    const cnLines = await ctx.db.selectFrom("pms_credit_note_lines").select(["invoice_line_id", "net_pence", "vat_pence", "total_pence"]).where("tenant_id", "=", tenantId).where("credit_note_id", "=", cn.id).limit(500).execute();
    const byId = new Map(inv.lines.map((l) => [l.id, l]));
    const src: XeroCreditNoteSource = {
      id: cn.id,
      number,
      kind: cn.kind,
      issuedOn: cn.issued_on,
      totalPence: num(cn.total_pence),
      invoice: inv,
      lines: cnLines.flatMap((l) => {
        const invoiceLine = byId.get(l.invoice_line_id);
        return invoiceLine ? [{ netPence: num(l.net_pence), vatPence: num(l.vat_pence), totalPence: num(l.total_pence), invoiceLine }] : [];
      }),
    };
    const contactId = await ensureContact(run, inv.contact);
    const mapped = creditNoteToXero(src, contactId, run.maps);
    if (!mapped.ok) return blocked(mapped.missing);
    const xeroId = await run.session.withApi(async (api) => (await api.findCreditNoteByNumber(number)) ?? (await api.createCreditNote(mapped.body, run.key(""))).id);
    await putLink(ctx, tenantId, "credit_note", cn.id, xeroId, number, null);
    link = { xeroId, sentHash: null };
  }
  if (link.sentHash !== ALLOCATED) {
    // Allocate to its invoice, no further than Xero says is still due (anything left stays on the credit note).
    const total = num(cn.total_pence);
    await run.session.withApi(async (api) => {
      const due = await api.invoiceAmountDue(invLink.xeroId);
      const amount = Math.min(pounds(total), due ?? pounds(total));
      if (amount > 0) await api.allocateCreditNote(link.xeroId, invLink.xeroId, Math.round(amount * 100) / 100, cn.issued_on, run.key(":allocate"));
    });
    await ctx.db.updateTable("pms_xero_links").set({ sent_hash: ALLOCATED, updated_at: nowIso(ctx) }).where("tenant_id", "=", tenantId).where("local_type", "=", "credit_note").where("local_id", "=", cn.id).execute();
  }
  return { kind: "done", xeroId: link.xeroId };
}

async function sendAllocation(run: RunCtx, item: SyncItem): Promise<ItemOutcome> {
  const { ctx, tenantId } = run;
  const link = await getLink(ctx, tenantId, "allocation", item.localId);
  if (link) return { kind: "done", xeroId: link.xeroId };
  const a = await ctx.db
    .selectFrom("pms_payment_allocations as a")
    .innerJoin("pms_payments as p", (j) => j.onRef("p.tenant_id", "=", "a.tenant_id").onRef("p.id", "=", "a.payment_id"))
    .select(["a.id", "a.invoice_id", "a.amount_pence", "a.reversed", "p.status", "p.kind", "p.received_on", "p.method", "p.site_id", "p.reference"])
    .where("a.tenant_id", "=", tenantId)
    .where("a.id", "=", item.localId)
    .executeTakeFirst();
  if (!a || num(a.reversed) === 1 || a.status !== "recorded") return { kind: "skipped", message: "Taken off or reversed before it was sent – nothing to send." };
  const invLink = await getLink(ctx, tenantId, "invoice", a.invoice_id);
  if (!invLink) return { kind: "waiting", message: "Waiting for its invoice to be sent first." };
  const label = PAYMENT_METHOD_LABELS[a.method as keyof typeof PAYMENT_METHOD_LABELS] ?? a.method;
  const mapped = allocationToXero({ id: a.id, amountPence: num(a.amount_pence), receivedOn: a.received_on, method: a.method, siteId: a.site_id, reference: a.reference }, invLink.xeroId, run.maps, label);
  if (!mapped.ok) return blocked(mapped.missing);
  const xeroId = await run.session.withApi((api) => api.createPayment(mapped.body, run.key("")));
  return { kind: "done", xeroId: await putLink(ctx, tenantId, "allocation", a.id, xeroId, null, null) };
}

async function removeAllocation(run: RunCtx, item: SyncItem): Promise<ItemOutcome> {
  const link = await getLink(run.ctx, run.tenantId, "allocation", item.localId);
  if (!link) return { kind: "skipped", message: "This payment was never in Xero – nothing to take off." };
  await run.session.withApi((api) => api.deletePayment(link.xeroId, run.key("")));
  return { kind: "done", xeroId: link.xeroId };
}

async function sendItem(run: RunCtx, item: SyncItem): Promise<ItemOutcome> {
  try {
    if (item.localType === "invoice") return await sendInvoice(run, item);
    if (item.localType === "credit_note") return await sendCreditNote(run, item);
    if (item.op === "delete") return await removeAllocation(run, item);
    return await sendAllocation(run, item);
  } catch (err) {
    if (err instanceof AuthStop) return { kind: "auth", message: err.message };
    if (err instanceof XeroError) {
      if (err.errorClass === "auth") {
        await pauseXero(run.ctx, run.tenantId, err.message);
        return { kind: "auth", message: err.message };
      }
      return err.errorClass === "transient" ? { kind: "transient", message: err.message, retryAfterSeconds: err.retryAfterSeconds } : { kind: "validation", message: err.message };
    }
    // Our own problem (database, a bug): retried with back-off, never shown with internal detail.
    return { kind: "transient", message: "This could not be sent just now. It will be tried again." };
  }
}

/* ------------------------------------------------------------------------------------------------
 * The run
 * ----------------------------------------------------------------------------------------------*/

export interface ClinicRunResult {
  connected: boolean;
  queued: number;
  attempted: number;
  done: number;
  waiting: number;
  retrying: number;
  blocked: number;
  failed: number;
  skipped: number;
  paused: boolean;
}

export interface ClinicRunOptions {
  maxItems?: number;
  budgetMs?: number;
  /** Who started it (Send now); the scheduled run is nobody. */
  actor?: PmsActor;
  nowMs?: () => number;
}

/** One clinic's run. Never throws for Xero's sake: what happened is on each item. */
export async function sendForClinic(ctx: RepoContext, tenantId: string, client: XeroClient, options: ClinicRunOptions = {}): Promise<ClinicRunResult> {
  const result: ClinicRunResult = { connected: false, queued: 0, attempted: 0, done: 0, waiting: 0, retrying: 0, blocked: 0, failed: 0, skipped: 0, paused: false };
  const conn = await openConnection(ctx, tenantId);
  if (!conn) return result;
  result.connected = true;
  result.queued = await queueDueItems(ctx, tenantId, conn.sendFrom ?? londonDate(nowIso(ctx)));
  const clock = options.nowMs ?? (() => Date.now());
  const started = clock();
  const budget = options.budgetMs ?? 20_000;
  const session = new TokenSession(ctx, tenantId, client, conn);
  const run: RunCtx = {
    ctx,
    tenantId,
    session,
    maps: await getXeroMaps(ctx, tenantId),
    withDetails: conn.sendContactDetails,
    key: () => "",
  };
  for (const item of await dueItems(ctx, tenantId, options.maxItems ?? XERO_ITEMS_PER_RUN)) {
    if (clock() - started > budget) break;
    if (!(await claimItem(ctx, tenantId, item.id))) continue;
    result.attempted++;
    run.key = (suffix: string) => idempotencyKeyFor(tenantId, `${item.id}${suffix}`, item.payloadVersion, sha256Hex);
    const outcome = await sendItem(run, item);
    const status = await finishItem(ctx, tenantId, item, outcome);
    if (outcome.kind === "done") result.done++;
    else if (outcome.kind === "skipped") result.skipped++;
    else if (outcome.kind === "waiting") result.waiting++;
    else if (outcome.kind === "auth") {
      result.paused = true;
      break;
    } else if (status === "failed") result.failed++;
    else if (status === "blocked") result.blocked++;
    else result.retrying++;
  }
  if (result.attempted > 0) {
    await auditPush(ctx, tenantId, options.actor ?? { userId: null, sessionId: null }, {
      sent: result.done,
      blocked: result.blocked,
      failed: result.failed,
      retrying: result.retrying,
      waiting: result.waiting,
      skipped: result.skipped,
    });
  }
  return result;
}
